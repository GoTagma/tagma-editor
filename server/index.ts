import express from 'express';
import cors from 'cors';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, mkdtempSync, rmSync, cpSync } from 'node:fs';
import { resolve, relative, dirname, basename, sep, join } from 'node:path';
import { tmpdir } from 'node:os';
import * as tar from 'tar';
import yaml from 'js-yaml';
import {
  createEmptyPipeline,
  upsertTrack,
  removeTrack,
  updateTrack,
  upsertTask,
  removeTask,
  moveTask,
  transferTask,
  moveTrack,
  validateRaw,
  buildRawDag,
  parseYaml,
  serializePipeline,
  bootstrapBuiltins,
  listRegistered,
  loadPlugins,
  loadPipeline,
  validateConfig,
  setPipelineField,
  clip,
  runPipeline,
  InMemoryApprovalGateway,
  hasHandler,
  getHandler,
  registerPlugin,
  discoverTemplates,
  loadTemplateManifest,
} from '@tagma/sdk';
import type {
  TemplateManifest,
  PipelineEvent,
  EngineResult,
} from '@tagma/sdk';
import type {
  DriverPlugin,
  DriverCapabilities,
  TriggerPlugin,
  CompletionPlugin,
  MiddlewarePlugin,
  PluginSchema as SdkPluginSchema,
  PluginParamDef,
  TaskState,
  TaskStatus,
  ApprovalRequest,
  ApprovalEvent,
  Permissions,
} from '@tagma/types';
import {
  startWatching as startFileWatching,
  stopWatching as stopFileWatching,
  onFileWatcherEvent,
  markSynced as markWatcherSynced,
  type ExternalChangeEvent,
} from './file-watcher.js';
import type { RawPipelineConfig, RawTrackConfig, RawTaskConfig } from '@tagma/sdk';
import type { ValidationError, RawDag } from '@tagma/sdk';

// Register built-in plugins so we can list available drivers etc.
bootstrapBuiltins();

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// ── In-memory state ──
let config: RawPipelineConfig = createEmptyPipeline('Untitled Pipeline');
let yamlPath: string | null = null;
let workDir: string = '';

/**
 * B1: Validate that a resolved path is within a given root directory.
 * Prevents path traversal attacks (e.g. /api/fs/list?path=/etc).
 * Returns the resolved absolute path if safe, or null if it escapes.
 */
function isPathWithin(child: string, root: string): boolean {
  const rel = relative(root, child);
  return !rel.startsWith('..') && !resolve(root, rel).includes('..' + sep);
}

/** Max number of run log directories to keep. Shared with the SDK's engine
 *  (maxLogRuns) and the history listing endpoint so both agree on the cap. */
const MAX_LOG_RUNS = 20;

// ── Revision / ETag (C6) ──
//
// `stateRevision` increments on every successful mutation. Clients track their
// last-seen revision and send `If-Match: <revision>` (or body field
// `expectedRevision`) on mutations. If the numbers don't match, the server
// responds 409 with `{ error, currentState }` so the client can re-apply.
//
// Contract (documented here for future pipeline-store integration):
//   Request  → headers: { 'If-Match': '<number>' }
//              body:    { ..., expectedRevision?: number }
//   Success  → 2xx JSON, state includes `revision` field incremented by 1+
//   Conflict → 409 JSON: { error: 'revision mismatch', currentState: ServerState }
//
// Group 5 leaves client consumption for a future cycle; pipeline-store is
// owned by other groups and must not be touched here.
let stateRevision = 0;
function bumpRevision(): number {
  stateRevision += 1;
  return stateRevision;
}

/** Editor layout data stored alongside the YAML file as .layout.json */
interface EditorLayout {
  positions: Record<string, { x: number }>;
}

let layout: EditorLayout = { positions: {} };

function layoutPath(): string | null {
  if (!yamlPath) return null;
  return yamlPath.replace(/\.ya?ml$/i, '.layout.json');
}

function loadLayout(): void {
  const lp = layoutPath();
  if (!lp || !existsSync(lp)) { layout = { positions: {} }; return; }
  try {
    layout = JSON.parse(readFileSync(lp, 'utf-8'));
  } catch {
    layout = { positions: {} };
  }
}

function saveLayout(): void {
  const lp = layoutPath();
  if (!lp) return;
  try {
    writeFileSync(lp, JSON.stringify(layout, null, 2), 'utf-8');
  } catch { /* best-effort */ }
}

/** Auto-reconcile continue_from: if a prompt task depends on another prompt task, set continue_from. */
function reconcileContinueFrom(cfg: RawPipelineConfig): RawPipelineConfig {
  const taskMap = new Map<string, RawTaskConfig>();
  for (const track of cfg.tracks) {
    for (const task of track.tasks) {
      taskMap.set(`${track.id}.${task.id}`, task);
    }
  }

  let changed = false;
  const newTracks = cfg.tracks.map((track) => {
    const newTasks = track.tasks.map((task) => {
      const isPromptTask = !!task.prompt && !task.command && !task.use;
      const deps = task.depends_on ?? [];

      if (!isPromptTask || deps.length === 0) {
        // Not a prompt task or no deps — clear continue_from if set
        if (task.continue_from) {
          changed = true;
          const { continue_from: _, ...rest } = task;
          return rest as RawTaskConfig;
        }
        return task;
      }

      // Find last dep that is also a prompt task — that's the continue_from source
      let continueRef: string | undefined;
      for (const dep of deps) {
        const qid = dep.includes('.') ? dep : `${track.id}.${dep}`;
        const depTask = taskMap.get(qid);
        if (depTask && !!depTask.prompt && !depTask.command && !depTask.use) {
          continueRef = dep; // use the raw ref as written in depends_on
        }
      }

      if (continueRef && task.continue_from !== continueRef) {
        changed = true;
        return { ...task, continue_from: continueRef };
      }
      if (!continueRef && task.continue_from) {
        changed = true;
        const { continue_from: _, ...rest } = task;
        return rest as RawTaskConfig;
      }
      return task;
    });
    return newTasks !== track.tasks ? { ...track, tasks: newTasks } : track;
  });

  return changed ? { ...cfg, tracks: newTracks } : cfg;
}

// Keys that must not be stripped even when empty
const TASK_REQUIRED_KEYS = new Set(['id']);
const TRACK_REQUIRED_KEYS = new Set(['id', 'name', 'tasks']);

/**
 * Return a copy of `obj` with keys whose value is '', undefined, null,
 * empty arrays, or empty objects removed — except keys in `required`.
 * Pure function — the input is never mutated.
 */
function stripEmptyFields(obj: Record<string, unknown>, required: Set<string>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(obj)) {
    if (required.has(key)) { result[key] = v; continue; }
    if (v === '' || v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 0) continue;
    result[key] = v;
  }
  return result;
}

function getState() {
  let validationErrors: ValidationError[] = [];
  let dag: RawDag = { nodes: new Map(), edges: [] };
  try {
    validationErrors = validateRaw(config);
  } catch (err) {
    console.error('[getState] validateRaw threw:', err);
    validationErrors = [{ path: '', message: 'Internal validation error' }];
  }
  try {
    dag = buildRawDag(config);
  } catch (err) {
    console.error('[getState] buildRawDag threw:', err);
  }
  // Serialize dag for JSON (Map → object)
  const dagNodes: Record<string, any> = {};
  for (const [k, v] of dag.nodes) dagNodes[k] = v;
  return {
    config,
    validationErrors,
    dag: { nodes: dagNodes, edges: dag.edges },
    yamlPath,
    workDir,
    layout,
    revision: stateRevision,
  };
}

/**
 * Fetch DriverCapabilities for every currently-registered driver (F2).
 * Silently omits drivers that throw during lookup.
 */
function getDriverCapabilities(): Record<string, DriverCapabilities> {
  const out: Record<string, DriverCapabilities> = {};
  for (const name of listRegistered('drivers')) {
    try {
      const plugin = getHandler<DriverPlugin>('drivers', name);
      out[name] = plugin.capabilities;
    } catch { /* ignore broken plugin */ }
  }
  return out;
}

/**
 * Convert SDK's record-shaped PluginSchema → the client's array-shaped wire
 * descriptor. The array form lets the client preserve declared field order in
 * the form generator. Unknown param types are passed through verbatim.
 */
function serializeSdkSchema(schema: SdkPluginSchema | undefined):
  | { description?: string; fields: Array<{ key: string } & PluginParamDef> }
  | undefined {
  if (!schema || !schema.fields) return undefined;
  const fields: Array<{ key: string } & PluginParamDef> = [];
  for (const [key, def] of Object.entries(schema.fields)) {
    fields.push({ key, ...def });
  }
  return { description: schema.description, fields };
}

/**
 * Pull per-plugin schema metadata out of the registry for one category (F10).
 * Plugins that don't declare a schema are silently omitted.
 */
function getPluginSchemas(
  kind: 'triggers' | 'completions' | 'middlewares',
): Record<string, ReturnType<typeof serializeSdkSchema>> {
  const out: Record<string, ReturnType<typeof serializeSdkSchema>> = {};
  for (const name of listRegistered(kind)) {
    try {
      const plugin =
        kind === 'triggers'
          ? getHandler<TriggerPlugin>('triggers', name)
          : kind === 'completions'
            ? getHandler<CompletionPlugin>('completions', name)
            : getHandler<MiddlewarePlugin>('middlewares', name);
      const wire = serializeSdkSchema(plugin.schema);
      if (wire) out[name] = wire;
    } catch { /* ignore broken plugin */ }
  }
  return out;
}

// ── Mutation middleware: revision bump + If-Match check (C6) ──
//
// Applied via `app.use` BEFORE any mutation routes are registered (see order
// below). The middleware is a no-op for GET/HEAD/OPTIONS and for non-/api
// paths. For mutations it:
//   1. Validates `If-Match` / `expectedRevision` against `stateRevision`
//   2. On mismatch → 409 with the current ServerState
//   3. On match (or when no expectation provided) → hooks `res.on('finish')`
//      to bump `stateRevision` after a successful 2xx response
//
// Requests that did not send an expectation are still accepted (backward
// compat for older clients) but will still bump the revision on success.
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  if (!MUTATION_METHODS.has(req.method)) return next();

  // Skip If-Match checks on endpoints that Group 4 owns and on plugin/FS
  // utilities where revision doesn't carry meaning.
  const skipRoutes = [
    '/api/run/',
    '/api/plugins/',
    '/api/fs/',
    '/api/state/events',
    '/api/layout',
  ];
  if (skipRoutes.some((p) => req.path.startsWith(p))) return next();

  const headerMatch = req.header('If-Match');
  const bodyExpected =
    req.body && typeof req.body === 'object' && 'expectedRevision' in req.body
      ? Number((req.body as Record<string, unknown>).expectedRevision)
      : undefined;
  const expected =
    headerMatch !== undefined && headerMatch !== ''
      ? Number(headerMatch)
      : bodyExpected;

  // B3: Reject non-numeric If-Match values with 400 instead of silently
  // bypassing the revision check (NaN is not finite → check was skipped).
  if (expected !== undefined && !Number.isFinite(expected)) {
    return res.status(400).json({ error: 'If-Match header must be a numeric revision' });
  }

  if (expected !== undefined && expected !== stateRevision) {
    return res.status(409).json({
      error: 'revision mismatch',
      expected,
      current: stateRevision,
      currentState: getState(),
    });
  }

  // Strip `expectedRevision` from body so downstream handlers never see it
  // as a stray field (avoids accidentally persisting it into YAML).
  if (req.body && typeof req.body === 'object' && 'expectedRevision' in req.body) {
    delete (req.body as Record<string, unknown>).expectedRevision;
  }

  // Bump pre-emptively so the getState() embedded in the response body already
  // carries the new revision. If the handler errors (4xx/5xx) we roll back so
  // clients don't see a phantom jump.
  const pre = stateRevision;
  bumpRevision();
  res.on('finish', () => {
    if (res.statusCode >= 400) {
      stateRevision = pre;
    }
  });

  next();
});

// ── GET state ──
app.get('/api/state', (_req, res) => {
  res.json(getState());
});

// ── Plugin registry ──
// F2: additionally expose per-driver DriverCapabilities so the UI can grey
// out sessionResume / systemPrompt / outputFormat fields when a driver does
// not support them. Legacy `drivers` field (string[]) is preserved for
// backward compatibility.
app.get('/api/registry', (_req, res) => {
  res.json({
    drivers: listRegistered('drivers'),
    triggers: listRegistered('triggers'),
    completions: listRegistered('completions'),
    middlewares: listRegistered('middlewares'),
    driverCapabilities: getDriverCapabilities(),
    triggerSchemas: getPluginSchemas('triggers'),
    completionSchemas: getPluginSchemas('completions'),
    middlewareSchemas: getPluginSchemas('middlewares'),
    templates: getTemplatesSnapshot(),
  });
});

// ── F1: Templates ──
// Discovery endpoint — returns the list of `@tagma/template-*` packages
// installed in the current workspace along with each manifest's name,
// description, and parameter definitions. The UI template browser in
// TaskConfigPanel populates from here.
app.get('/api/templates', (_req, res) => {
  res.json({ templates: getTemplatesSnapshot() });
});

// Single-template lookup for deeper form generation (one task at a time).
app.get('/api/templates/*ref', (req, res) => {
  if (!workDir) return res.status(400).json({ error: 'no workspace opened' });
  try {
    const refParam = req.params.ref;
    const ref = Array.isArray(refParam) ? refParam.join('/') : String(refParam ?? '');
    const manifest = loadTemplateManifest(ref, workDir);
    if (!manifest) return res.status(404).json({ error: 'template not found' });
    res.json({ template: manifest });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── External file-change SSE (C5) ──
//
// Clients subscribe to `/api/state/events` to get notified when the
// in-memory state's backing YAML was modified outside the editor. We emit
// one of:
//   { type: 'external-change', newState }  → server already reloaded; client should re-apply
//   { type: 'external-conflict', path }    → client has in-memory changes; must resolve manually
//
// This piggybacks on the same SSE pattern as /api/run/events. A follow-up
// client task will wire consumption; today the endpoint just streams events
// and logs conflicts server-side. For clients that cannot use SSE,
// `/api/state/reload` returns the latest state on demand.
interface StateEventClient {
  res: import('express').Response;
}
const stateEventClients = new Set<StateEventClient>();

// B5: Sequence counter for state events so reconnecting clients can detect
// missed events. EventSource natively sends Last-Event-ID on reconnect.
let stateEventSeq = 0;

function broadcastStateEvent(payload: Record<string, unknown>): void {
  stateEventSeq++;
  const data = JSON.stringify({ ...payload, seq: stateEventSeq });
  for (const client of stateEventClients) {
    try { client.res.write(`id: ${stateEventSeq}\nevent: state_event\ndata: ${data}\n\n`); } catch { /* best-effort */ }
  }
}

app.get('/api/state/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('\n');
  // B5: Send current state on connect so reconnecting clients are immediately
  // up-to-date even if they missed prior state events during disconnection.
  const syncData = JSON.stringify({ type: 'state_sync', newState: getState(), seq: stateEventSeq });
  res.write(`id: ${stateEventSeq}\nevent: state_event\ndata: ${syncData}\n\n`);
  const client: StateEventClient = { res };
  stateEventClients.add(client);
  req.on('close', () => stateEventClients.delete(client));
});

// Polling fallback — returns current state. Intended for clients that can't
// keep an SSE connection open.
app.get('/api/state/reload', (_req, res) => {
  res.json(getState());
});

// Wire the file-watcher into the SSE broadcaster. When the watcher detects
// an external change with clean in-memory state, auto-reload the YAML and
// push the new state to subscribers.
onFileWatcherEvent((event: ExternalChangeEvent) => {
  if (event.type === 'external-change') {
    try {
      config = parseYaml(event.content);
    } catch {
      try {
        const doc = yaml.load(event.content) as any;
        const p = doc?.pipeline ?? doc ?? {};
        config = {
          name: p.name || 'Untitled',
          driver: p.driver,
          timeout: p.timeout,
          tracks: Array.isArray(p.tracks) ? p.tracks : [],
        } as RawPipelineConfig;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[file-watcher] failed to parse reloaded YAML', err);
        broadcastStateEvent({ type: 'external-conflict', path: event.path, error: 'parse-failed' });
        return;
      }
    }
    bumpRevision();
    markWatcherSynced(event.content, null);
    broadcastStateEvent({ type: 'external-change', newState: getState() });
  } else if (event.type === 'external-conflict') {
    broadcastStateEvent({ type: 'external-conflict', path: event.path });
  }
});

/** Helper: begin watching a path (after load/save) and seed the baseline. */
function beginWatching(path: string, content: string): void {
  try {
    markWatcherSynced(content, existsSync(path) ? statSync(path).mtimeMs : null);
    startFileWatching(path, () => serializePipeline(config));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[file-watcher] beginWatching failed', err);
  }
}

// ── Plugin management ──

const NPM_REGISTRY = 'https://registry.npmjs.org';

// ── Built-in npm registry installer (tarball download, no CLI needed) ──

/** Encode a package name for the npm registry URL */
function registryUrl(name: string): string {
  // Scoped: @scope/pkg → @scope%2fpkg
  if (name.startsWith('@')) {
    return `${NPM_REGISTRY}/${name.replace('/', '%2f')}`;
  }
  return `${NPM_REGISTRY}/${encodeURIComponent(name)}`;
}

/** Fetch package metadata from the npm registry (uses Bun's built-in fetch) */
async function registryMeta(name: string): Promise<{ version: string; description: string | null; tarball: string }> {
  const res = await fetch(registryUrl(name), {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Package "${name}" not found on registry (${res.status})`);
  const meta = await res.json() as any;
  const latest = meta['dist-tags']?.latest;
  if (!latest) throw new Error(`No published version for "${name}"`);
  const info = meta.versions?.[latest];
  if (!info?.dist?.tarball) throw new Error(`No tarball for ${name}@${latest}`);
  return {
    version: latest,
    description: info.description ?? null,
    tarball: info.dist.tarball,
  };
}

/**
 * Install a package from the npm registry without npm CLI.
 * Downloads tarball → extracts via system tar → updates package.json.
 */
async function directRegistryInstall(name: string): Promise<void> {
  const meta = await registryMeta(name);

  // Download tarball
  const tarRes = await fetch(meta.tarball);
  if (!tarRes.ok) throw new Error(`Tarball download failed (${tarRes.status})`);
  const tarBuffer = Buffer.from(await tarRes.arrayBuffer());

  const tmpDir = mkdtempSync(join(tmpdir(), 'tagma-pkg-'));
  const tgzPath = join(tmpDir, 'package.tgz');
  writeFileSync(tgzPath, tarBuffer);

  try {
    // Prepare destination in node_modules
    const parts = name.startsWith('@') ? name.split('/') : [name];
    const destDir = resolve(workDir, 'node_modules', ...parts);
    mkdirSync(destDir, { recursive: true });

    // Extract via pure-JS `tar` so install works on every platform without
    // needing a `tar` binary on PATH. (Git Bash's GNU tar chokes on Windows
    // drive letters, and we don't want to depend on the user's environment.)
    await tar.x({ file: tgzPath, cwd: destDir, strip: 1 });
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  // Record in workspace package.json
  ensureWorkDirPackageJson();
  const pkgPath = resolve(workDir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  pkg.dependencies = pkg.dependencies ?? {};
  pkg.dependencies[name] = `^${meta.version}`;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), 'utf-8');
}

/**
 * Install a package from the npm registry. Fully self-contained: downloads the
 * tarball with Bun's built-in fetch and extracts it with the bundled `tar`
 * package. No external CLI — registry installs work in any environment where
 * the editor runs, including compiled standalone binaries.
 */
async function installPackage(name: string): Promise<void> {
  ensureWorkDirPackageJson();
  await directRegistryInstall(name);
}

/**
 * Install a plugin from a local path (directory or .tgz file) via pure
 * filesystem ops — no package manager CLI required. Returns the package name
 * that was installed.
 */
async function installFromLocalPath(absPath: string): Promise<string> {
  ensureWorkDirPackageJson();
  const stat = statSync(absPath);

  // Stage the package contents in a temp dir (for tarballs) or point at the
  // directory directly. `sourceDir` always contains a top-level package.json.
  let sourceDir: string;
  let cleanupTmp: string | null = null;

  if (stat.isDirectory()) {
    sourceDir = absPath;
  } else {
    cleanupTmp = mkdtempSync(join(tmpdir(), 'tagma-local-'));
    await tar.x({ file: absPath, cwd: cleanupTmp, strip: 1 });
    sourceDir = cleanupTmp;
  }

  try {
    const srcPkgPath = resolve(sourceDir, 'package.json');
    if (!existsSync(srcPkgPath)) {
      throw new Error('Source does not contain a package.json');
    }
    const srcPkg = JSON.parse(readFileSync(srcPkgPath, 'utf-8'));
    const pkgName: string | undefined = srcPkg.name;
    if (!pkgName) {
      throw new Error('Source package.json has no "name" field');
    }

    // Copy into the workspace's node_modules.
    const parts = pkgName.startsWith('@') ? pkgName.split('/') : [pkgName];
    const destDir = resolve(workDir, 'node_modules', ...parts);
    // Remove any previous copy so we get a clean overwrite.
    if (existsSync(destDir)) {
      rmSync(destDir, { recursive: true, force: true });
    }
    mkdirSync(destDir, { recursive: true });
    cpSync(sourceDir, destDir, { recursive: true });

    // Record the dependency in the workspace package.json using a file: spec.
    const pkgPath = resolve(workDir, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    pkg.dependencies = pkg.dependencies ?? {};
    pkg.dependencies[pkgName] = `file:${absPath}`;
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), 'utf-8');

    return pkgName;
  } finally {
    if (cleanupTmp) {
      rmSync(cleanupTmp, { recursive: true, force: true });
    }
  }
}

/**
 * Uninstall a package: remove from node_modules + package.json.
 * Done via direct filesystem ops — no package manager CLI required.
 */
function uninstallPackage(name: string): void {
  // Remove from node_modules
  const parts = name.startsWith('@') ? name.split('/') : [name];
  const pkgDir = resolve(workDir, 'node_modules', ...parts);
  if (existsSync(pkgDir)) {
    rmSync(pkgDir, { recursive: true, force: true });
  }

  // Clean up empty scope directory
  if (name.startsWith('@') && parts.length > 1) {
    const scopeDir = resolve(workDir, 'node_modules', parts[0]);
    try {
      if (existsSync(scopeDir) && readdirSync(scopeDir).length === 0) {
        rmSync(scopeDir, { recursive: true, force: true });
      }
    } catch {}
  }

  // Remove from package.json
  const pkgPath = resolve(workDir, 'package.json');
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    if (pkg.dependencies?.[name]) {
      delete pkg.dependencies[name];
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), 'utf-8');
    }
  }
}

/** Set of plugin package names that have been dynamically loaded into the registry this session */
const loadedPlugins = new Set<string>();

/** Ensure workDir has a package.json so the installer has somewhere to record dependencies. */
function ensureWorkDirPackageJson(): void {
  const pkgPath = resolve(workDir, 'package.json');
  if (!existsSync(pkgPath)) {
    writeFileSync(pkgPath, JSON.stringify({ name: 'tagma-workspace', private: true, dependencies: {} }, null, 2), 'utf-8');
  }
}

interface PluginInfo {
  name: string;
  installed: boolean;
  loaded: boolean;
  version: string | null;
  description: string | null;
  categories: string[];
}

function getPluginInfo(name: string): PluginInfo {
  let installed = false;
  let version: string | null = null;
  let description: string | null = null;
  try {
    const pkgPath = resolve(workDir, 'node_modules', ...name.split('/'), 'package.json');
    if (existsSync(pkgPath)) {
      installed = true;
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      version = pkg.version ?? null;
      description = pkg.description ?? null;
    }
  } catch {}

  const loaded = loadedPlugins.has(name);

  const categories: string[] = [];
  const match = name.match(/@tagma\/(driver|trigger|completion|middleware)-(.+)/);
  if (match) {
    const [, cat, type] = match;
    const pluralCat = cat + 's' as 'drivers' | 'triggers' | 'completions' | 'middlewares';
    if (hasHandler(pluralCat, type)) {
      categories.push(pluralCat);
    }
  }

  return { name, installed, loaded, version, description, categories };
}

function getRegistrySnapshot() {
  return {
    drivers: listRegistered('drivers'),
    triggers: listRegistered('triggers'),
    completions: listRegistered('completions'),
    middlewares: listRegistered('middlewares'),
    driverCapabilities: getDriverCapabilities(),
    triggerSchemas: getPluginSchemas('triggers'),
    completionSchemas: getPluginSchemas('completions'),
    middlewareSchemas: getPluginSchemas('middlewares'),
    templates: getTemplatesSnapshot(),
  };
}

/**
 * Discover installed `@tagma/template-*` packages under the current workDir
 * and return their manifests. Returns an empty array when no workDir is set
 * or no template packages are installed.
 */
function getTemplatesSnapshot(): TemplateManifest[] {
  if (!workDir) return [];
  try {
    return discoverTemplates(workDir);
  } catch {
    return [];
  }
}

/** Dynamically import a plugin from the workDir's node_modules */
async function loadPluginFromWorkDir(name: string): Promise<void> {
  // Resolve to the plugin's entry point inside workDir/node_modules
  const pluginPkgPath = resolve(workDir, 'node_modules', ...name.split('/'), 'package.json');
  const pluginPkg = JSON.parse(readFileSync(pluginPkgPath, 'utf-8'));
  const entryPoint = pluginPkg.exports?.['.'] ?? pluginPkg.main ?? './src/index.ts';
  const pluginDir = resolve(workDir, 'node_modules', ...name.split('/'));
  const modulePath = resolve(pluginDir, entryPoint);

  // B2: Validate the resolved entry point is within the plugin directory to
  // prevent a malicious plugin's "main" field from escaping (e.g. "../../../evil.js").
  if (!isPathWithin(modulePath, pluginDir)) {
    throw new Error(
      `Plugin "${name}" entry point "${entryPoint}" resolves outside its package directory. Refusing to load.`
    );
  }

  // Use file:// URL for Windows compatibility with dynamic import
  const fileUrl = `file:///${modulePath.replace(/\\/g, '/')}`;
  const mod = await import(fileUrl);

  if (!mod.pluginCategory || !mod.pluginType || !mod.default) {
    throw new Error(`Plugin "${name}" must export pluginCategory, pluginType, and default`);
  }
  registerPlugin(mod.pluginCategory, mod.pluginType, mod.default);
}

/** Read/write .tagma/plugins.json — the persistent manifest of installed plugins */
function readPluginManifest(): string[] {
  try {
    const p = resolve(workDir, '.tagma', 'plugins.json');
    if (!existsSync(p)) return [];
    return JSON.parse(readFileSync(p, 'utf-8'));
  } catch {
    return [];
  }
}

function writePluginManifest(names: string[]): void {
  const dir = resolve(workDir, '.tagma');
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'plugins.json'), JSON.stringify(names, null, 2), 'utf-8');
}

function addToPluginManifest(name: string): void {
  const list = readPluginManifest();
  if (!list.includes(name)) {
    list.push(name);
    writePluginManifest(list);
  }
}

function removeFromPluginManifest(name: string): void {
  const list = readPluginManifest();
  const filtered = list.filter((n) => n !== name);
  if (filtered.length !== list.length) {
    writePluginManifest(filtered);
  }
}

/** List all managed plugins (from pipeline config + manifest + loaded this session) */
app.get('/api/plugins', (_req, res) => {
  const declared = config.plugins ?? [];
  const manifest = readPluginManifest();
  const allNames = [...new Set([...declared, ...manifest, ...loadedPlugins])];
  const plugins = allNames.map(getPluginInfo);
  res.json({ plugins });
});

/** Look up a single plugin from npm registry */
app.get('/api/plugins/info', async (req, res) => {
  const name = req.query.name as string;
  if (!name) return res.status(400).json({ error: 'name query parameter required' });

  const local = getPluginInfo(name);
  if (local.installed) return res.json(local);

  try {
    const meta = await registryMeta(name);
    res.json({
      name, installed: false, loaded: false,
      version: meta.version, description: meta.description,
      categories: [],
    });
  } catch (e: any) {
    res.status(404).json({ error: `Package "${name}" not found on registry` });
  }
});

// B9: Validate plugin name format — must be a scoped npm package or tagma-plugin-*.
// Reuse the SDK's regex to stay in sync.
const EDITOR_PLUGIN_NAME_RE = /^@[a-z0-9-]+\/[a-z0-9._-]+$|^tagma-plugin-[a-z0-9._-]+$/;

/** Install a plugin into workDir and load it into the registry */
app.post('/api/plugins/install', async (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'name is required' });
  }
  if (!EDITOR_PLUGIN_NAME_RE.test(name)) {
    return res.status(400).json({ error: `Invalid plugin name "${name}". Must be a scoped npm package (e.g. @tagma/trigger-xyz) or tagma-plugin-*.` });
  }
  if (!workDir) {
    return res.status(400).json({ error: 'Set a working directory first' });
  }

  try {
    await installPackage(name);
    addToPluginManifest(name);

    // Load into SDK registry
    try {
      await loadPluginFromWorkDir(name);
      loadedPlugins.add(name);
    } catch (loadErr: any) {
      return res.json({
        plugin: getPluginInfo(name),
        registry: getRegistrySnapshot(),
        warning: `Installed but failed to load: ${loadErr.message}`,
      });
    }

    res.json({ plugin: getPluginInfo(name), registry: getRegistrySnapshot() });
  } catch (e: any) {
    res.status(500).json({ error: `Install failed: ${e.message}` });
  }
});

/** Uninstall a plugin from workDir via direct filesystem ops (no package manager required) */
app.post('/api/plugins/uninstall', (_req, res) => {
  const { name } = _req.body;
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'name is required' });
  }

  try {
    uninstallPackage(name);
    removeFromPluginManifest(name);
    loadedPlugins.delete(name);

    res.json({
      plugin: getPluginInfo(name),
      registry: getRegistrySnapshot(),
      note: 'Plugin uninstalled. Registry entries persist until server restart.',
    });
  } catch (e: any) {
    res.status(500).json({ error: `Uninstall failed: ${e.message}` });
  }
});

/** Import a plugin from a local directory or .tgz file */
app.post('/api/plugins/import-local', async (req, res) => {
  const { path: localPath } = req.body;
  if (!localPath || typeof localPath !== 'string') {
    return res.status(400).json({ error: 'path is required' });
  }
  if (!workDir) {
    return res.status(400).json({ error: 'Set a working directory first' });
  }

  const absPath = resolve(localPath);
  if (!existsSync(absPath)) {
    return res.status(400).json({ error: `Path does not exist: ${absPath}` });
  }

  try {
    const pkgName = await installFromLocalPath(absPath);
    addToPluginManifest(pkgName);

    // Load into SDK registry
    try {
      await loadPluginFromWorkDir(pkgName);
      loadedPlugins.add(pkgName);
    } catch (loadErr: any) {
      return res.json({
        plugin: getPluginInfo(pkgName),
        registry: getRegistrySnapshot(),
        warning: `Installed but failed to load: ${loadErr.message}`,
      });
    }

    res.json({ plugin: getPluginInfo(pkgName), registry: getRegistrySnapshot() });
  } catch (e: any) {
    res.status(500).json({ error: `Local import failed: ${e.message}` });
  }
});

/** Load an already-installed plugin from workDir into the registry */
app.post('/api/plugins/load', async (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'name is required' });
  }

  const info = getPluginInfo(name);
  if (!info.installed) {
    return res.status(404).json({ error: `Plugin "${name}" is not installed. Install it first.` });
  }

  if (loadedPlugins.has(name)) {
    return res.json({ plugin: getPluginInfo(name), registry: getRegistrySnapshot() });
  }

  try {
    await loadPluginFromWorkDir(name);
    loadedPlugins.add(name);
    res.json({ plugin: getPluginInfo(name), registry: getRegistrySnapshot() });
  } catch (e: any) {
    res.status(500).json({ error: `Load failed: ${e.message}` });
  }
});

// ── Pipeline name ──
app.patch('/api/pipeline', (req, res) => {
  const { name, driver, timeout, plugins, hooks } = req.body;
  const patch: Partial<RawPipelineConfig> = {};
  if (name !== undefined) patch.name = name;
  if (driver !== undefined) patch.driver = driver || undefined;
  if (timeout !== undefined) patch.timeout = timeout || undefined;
  if (plugins !== undefined) patch.plugins = Array.isArray(plugins) && plugins.length > 0 ? plugins : undefined;
  if (hooks !== undefined) patch.hooks = hooks && Object.keys(hooks).length > 0 ? hooks : undefined;
  config = setPipelineField(config, patch);
  res.json(getState());
});

// ── Tracks ──
app.post('/api/tracks', (req, res) => {
  const { id, name, color } = req.body;
  const track: RawTrackConfig = { id, name, color, tasks: [] };
  config = upsertTrack(config, track);
  res.json(getState());
});

app.patch('/api/tracks/:trackId', (req, res) => {
  const { trackId } = req.params;
  const fields = stripEmptyFields({ ...req.body }, TRACK_REQUIRED_KEYS);
  config = updateTrack(config, trackId, fields);
  res.json(getState());
});

app.delete('/api/tracks/:trackId', (_req, res) => {
  const prev = config;
  config = removeTrack(config, _req.params.trackId);
  if (config === prev) return res.status(404).json({ error: 'Track not found' });
  res.json(getState());
});

app.post('/api/tracks/reorder', (req, res) => {
  const { trackId, toIndex } = req.body;
  config = moveTrack(config, trackId, toIndex);
  res.json(getState());
});

// ── Tasks ──
app.post('/api/tasks', (req, res) => {
  const { trackId, task } = req.body;
  config = upsertTask(config, trackId, task as RawTaskConfig);
  res.json(getState());
});

app.patch('/api/tasks/:trackId/:taskId', (req, res) => {
  const { trackId, taskId } = req.params;
  const patch = req.body;
  const track = config.tracks.find((t) => t.id === trackId);
  if (!track) return res.status(404).json({ error: 'Track not found' });
  const existing = track.tasks.find((t) => t.id === taskId);
  if (!existing) return res.status(404).json({ error: 'Task not found' });
  let updated = { ...existing, ...patch } as RawTaskConfig;
  // prompt and command are mutually exclusive
  // jsonBody converts undefined → null, so check for truthy or explicit empty string
  if ('command' in patch && patch.command != null) {
    delete updated.prompt;
  } else if ('prompt' in patch && patch.prompt != null) {
    delete updated.command;
  }
  // Strip empty optional fields so they don't appear as '' in YAML
  updated = stripEmptyFields(updated, TASK_REQUIRED_KEYS) as RawTaskConfig;
  config = upsertTask(config, trackId, updated);
  res.json(getState());
});

app.delete('/api/tasks/:trackId/:taskId', (req, res) => {
  const { trackId, taskId } = req.params;
  const prev = config;
  config = removeTask(config, trackId, taskId, true);
  if (config === prev) return res.status(404).json({ error: 'Task not found' });
  res.json(getState());
});

app.post('/api/tasks/move', (req, res) => {
  const { trackId, taskId, toIndex } = req.body;
  config = moveTask(config, trackId, taskId, toIndex);
  res.json(getState());
});

app.post('/api/tasks/transfer', (req, res) => {
  const { fromTrackId, taskId, toTrackId } = req.body;
  const prev = config;
  config = transferTask(config, fromTrackId, taskId, toTrackId);
  if (config === prev) return res.status(404).json({ error: 'Task or track not found' });
  res.json(getState());
});

// ── Dependencies ──
app.post('/api/dependencies', (req, res) => {
  const { fromTrackId, fromTaskId, toTrackId, toTaskId } = req.body;
  const track = config.tracks.find((t) => t.id === toTrackId);
  if (!track) return res.status(404).json({ error: 'Track not found' });
  const task = track.tasks.find((t) => t.id === toTaskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const depRef = fromTrackId === toTrackId ? fromTaskId : `${fromTrackId}.${fromTaskId}`;
  const existing = task.depends_on ?? [];
  if (!existing.includes(depRef)) {
    const updated = { ...task, depends_on: [...existing, depRef] } as RawTaskConfig;
    config = upsertTask(config, toTrackId, updated);
    // Auto-default continue_from on a newly connected prompt→prompt edge.
    // Users can still override the field in the config panel afterwards.
    config = reconcileContinueFrom(config);
  }
  res.json(getState());
});

app.delete('/api/dependencies', (req, res) => {
  const { trackId, taskId, depRef } = req.body;
  const track = config.tracks.find((t) => t.id === trackId);
  if (!track) return res.status(404).json({ error: 'Track not found' });
  const task = track.tasks.find((t) => t.id === taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const filtered = (task.depends_on ?? []).filter((d) => d !== depRef);
  const { depends_on: _, ...rest } = task;
  let updated = (filtered.length > 0 ? { ...rest, depends_on: filtered } : rest) as RawTaskConfig;
  // Clear continue_from if it pointed at the removed dep (dangling cleanup).
  if (updated.continue_from === depRef) {
    const { continue_from: _cf, ...noCf } = updated;
    updated = noCf as RawTaskConfig;
  }
  config = upsertTask(config, trackId, updated);
  res.json(getState());
});

// ── YAML Import/Export ──
// INVARIANT: The editor's in-memory `config` is always a *raw* (unresolved)
// pipeline config. Resolution and template expansion happen only at run time
// via `loadPipeline()`. Exporting the raw config directly is therefore correct.
// If a future feature stores a *resolved* config, use `deresolvePipeline()`
// from the SDK to strip inherited/expanded values before serializing.
app.get('/api/export', (_req, res) => {
  res.type('text/yaml').send(serializePipeline(config));
});

app.post('/api/import', (req, res) => {
  try {
    const { yaml } = req.body;
    config = parseYaml(yaml);
    res.json(getState());
  } catch (e: any) {
    res.status(400).json({ error: e.message ?? 'Invalid YAML' });
  }
});

// ── Workspace ──
app.get('/api/workspace', (_req, res) => {
  res.json({ yamlPath, workDir });
});

app.patch('/api/workspace', (req, res) => {
  const { workDir: wd } = req.body;
  if (wd !== undefined) {
    workDir = resolve(wd);
    mkdirSync(join(workDir, '.tagma'), { recursive: true });
  }
  res.json(getState());
});

// ── Filesystem browsing ──
app.get('/api/fs/list', (req, res) => {
  let dirPath = resolve((req.query.path as string) || workDir);
  // B1: Allow browsing outside workDir (for file picker / drive roots) but
  // still resolve the path to prevent relative traversal tricks.
  dirPath = resolve(dirPath);
  try {
    if (!existsSync(dirPath)) {
      dirPath = dirname(dirPath);
      if (!existsSync(dirPath)) {
        return res.status(404).json({ error: `Directory not found: ${dirPath}` });
      }
    }
    if (!statSync(dirPath).isDirectory()) {
      dirPath = dirname(dirPath);
    }
    const entries = readdirSync(dirPath, { withFileTypes: true })
      .filter((e) => !e.name.startsWith('.'))
      .map((e) => ({
        name: e.name,
        path: resolve(dirPath, e.name),
        type: e.isDirectory() ? 'directory' as const : 'file' as const,
      }))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    const parent = dirname(dirPath);
    res.json({ path: dirPath, parent: parent !== dirPath ? parent : null, entries });
  } catch (e: any) {
    res.status(500).json({ error: e.message ?? 'Failed to list directory' });
  }
});

app.get('/api/workspace/yamls', (_req, res) => {
  if (!workDir) return res.json({ entries: [] });
  const tagmaDir = resolve(workDir, '.tagma');
  if (!existsSync(tagmaDir)) return res.json({ entries: [] });
  try {
    const entries = readdirSync(tagmaDir, { withFileTypes: true })
      .filter((e) => e.isFile() && /\.ya?ml$/i.test(e.name))
      .map((e) => {
        const absPath = resolve(tagmaDir, e.name);
        let pipelineName: string | null = null;
        try {
          const doc = yaml.load(readFileSync(absPath, 'utf-8')) as any;
          const candidate =
            (doc && typeof doc?.pipeline?.name === 'string' && doc.pipeline.name) ||
            (doc && typeof doc?.name === 'string' && doc.name) ||
            null;
          if (candidate && String(candidate).trim()) pipelineName = String(candidate).trim();
        } catch {}
        return { name: e.name, path: absPath, pipelineName };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json({ entries });
  } catch (e: any) {
    res.status(500).json({ error: e.message ?? 'Failed to list workspace yamls' });
  }
});

app.get('/api/fs/roots', (_req, res) => {
  // On Windows, list drive letters; on Unix, just "/"
  if (process.platform === 'win32') {
    const drives: string[] = [];
    for (let c = 65; c <= 90; c++) {
      const drive = String.fromCharCode(c) + ':\\';
      try { if (existsSync(drive)) drives.push(drive); } catch {}
    }
    res.json({ roots: drives });
  } else {
    res.json({ roots: ['/'] });
  }
});

app.post('/api/fs/mkdir', (req, res) => {
  const { path: dirPath } = req.body;
  if (!dirPath) return res.status(400).json({ error: 'path is required' });
  const absPath = resolve(dirPath);
  // B1: mkdir must stay within workDir to prevent creating directories anywhere on the filesystem.
  if (workDir && !isPathWithin(absPath, workDir)) {
    return res.status(403).json({ error: 'Path is outside the workspace directory' });
  }
  try {
    mkdirSync(absPath, { recursive: true });
    res.json({ path: absPath });
  } catch (e: any) {
    res.status(500).json({ error: e.message ?? 'Failed to create directory' });
  }
});

app.post('/api/fs/reveal', (req, res) => {
  const { path: filePath } = req.body;
  if (!filePath) return res.status(400).json({ error: 'path is required' });
  const absPath = resolve(filePath);
  // B1: reveal must stay within workDir to prevent revealing arbitrary filesystem paths.
  if (workDir && !isPathWithin(absPath, workDir)) {
    return res.status(403).json({ error: 'Path is outside the workspace directory' });
  }
  if (!existsSync(absPath)) return res.status(404).json({ error: 'File not found' });
  try {
    const dir = statSync(absPath).isDirectory() ? absPath : dirname(absPath);
    if (process.platform === 'win32') {
      // explorer.exe returns exit 1 even on success — don't check result.
      Bun.spawnSync(['explorer', `/select,${absPath}`]);
    } else if (process.platform === 'darwin') {
      Bun.spawnSync(['open', '-R', absPath]);
    } else {
      Bun.spawnSync(['xdg-open', dir]);
    }
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message ?? 'Failed to reveal' });
  }
});

// ── File operations ──
app.post('/api/open', (req, res) => {
  const { path: filePath } = req.body;
  if (!filePath) return res.status(400).json({ error: 'path is required' });
  const absPath = resolve(filePath);
  try {
    if (!existsSync(absPath)) {
      return res.status(404).json({ error: `File not found: ${absPath}` });
    }
    const content = readFileSync(absPath, 'utf-8');
    try {
      config = parseYaml(content);
    } catch {
      // parseYaml is strict — fall back to lenient loading
      const doc = yaml.load(content) as any;
      const p = doc?.pipeline ?? doc ?? {};
      config = {
        name: p.name || basename(absPath, '.yaml').replace(/[-_]/g, ' '),
        driver: p.driver,
        timeout: p.timeout,
        tracks: Array.isArray(p.tracks) ? p.tracks : [],
      } as RawPipelineConfig;
    }
    yamlPath = absPath;
    loadLayout();
    beginWatching(absPath, content);
    res.json(getState());
  } catch (e: any) {
    res.status(400).json({ error: e.message ?? 'Failed to open file' });
  }
});

app.post('/api/save', (_req, res) => {
  let savePath = yamlPath;
  if (!savePath) {
    if (!workDir) return res.status(400).json({ error: 'No file path and no workspace configured.' });
    const tagmaDir = join(workDir, '.tagma');
    mkdirSync(tagmaDir, { recursive: true });
    const randomId = Math.random().toString(36).slice(2, 10);
    savePath = join(tagmaDir, `pipeline-${randomId}.yaml`);
  }
  try {
    // B4: Stop the existing watcher BEFORE writing so the old watcher's
    // debounced check() can't fire between writeFileSync and beginWatching,
    // which would falsely detect our own write as an external change.
    stopFileWatching();
    const content = serializePipeline(config);
    writeFileSync(savePath, content, 'utf-8');
    yamlPath = savePath;
    saveLayout();
    beginWatching(savePath, content);
    res.json(getState());
  } catch (e: any) {
    res.status(500).json({ error: e.message ?? 'Failed to save file' });
  }
});

app.post('/api/save-as', (req, res) => {
  const { path: filePath } = req.body;
  if (!filePath) return res.status(400).json({ error: 'path is required' });
  const absPath = resolve(filePath);
  try {
    // B4: Stop watcher before write to prevent false external-change detection.
    stopFileWatching();
    const yaml = serializePipeline(config);
    writeFileSync(absPath, yaml, 'utf-8');
    yamlPath = absPath;
    saveLayout();
    beginWatching(absPath, yaml);
    res.json(getState());
  } catch (e: any) {
    res.status(500).json({ error: e.message ?? 'Failed to save file' });
  }
});

app.post('/api/new', (req, res) => {
  const { name } = req.body;
  if (!workDir) return res.status(400).json({ error: 'Workspace directory is not set' });
  const tagmaDir = join(workDir, '.tagma');
  mkdirSync(tagmaDir, { recursive: true });
  const randomId = Math.random().toString(36).slice(2, 10);
  const fileName = `pipeline-${randomId}.yaml`;
  config = createEmptyPipeline(name || 'Untitled Pipeline');
  // Seed a default track + task so new pipelines start without validation errors
  const trackId = Math.random().toString(36).slice(2, 10);
  config = upsertTrack(config, { id: trackId, name: 'Track 1', color: '#3b82f6', tasks: [] });
  const taskId = Math.random().toString(36).slice(2, 10);
  config = upsertTask(config, trackId, { id: taskId, name: 'Task 1', prompt: 'Hello world!' });
  yamlPath = join(tagmaDir, fileName);
  layout = { positions: {} };
  const content = serializePipeline(config);
  writeFileSync(yamlPath, content, 'utf-8');
  beginWatching(yamlPath, content);
  res.json(getState());
});

// ── Layout (editor positions) ──
app.patch('/api/layout', (req, res) => {
  const { positions } = req.body;
  if (positions) layout.positions = positions;
  saveLayout();
  res.json({ ok: true });
});

/** Given a YAML path, return the companion layout.json path. */
function companionLayoutPath(yamlFilePath: string): string {
  return yamlFilePath.replace(/\.ya?ml$/i, '.layout.json');
}

// Import: copy external YAML (and its companion .layout.json, if present)
// into .tagma/ and open the copy
app.post('/api/import-file', (req, res) => {
  const { sourcePath } = req.body;
  if (!sourcePath) return res.status(400).json({ error: 'sourcePath is required' });
  if (!workDir) return res.status(400).json({ error: 'Workspace directory is not set' });
  const absSource = resolve(sourcePath);
  if (!existsSync(absSource)) return res.status(404).json({ error: `File not found: ${absSource}` });
  const tagmaDir = join(workDir, '.tagma');
  mkdirSync(tagmaDir, { recursive: true });
  const destPath = join(tagmaDir, basename(absSource));
  try {
    const content = readFileSync(absSource, 'utf-8');
    writeFileSync(destPath, content, 'utf-8');
    // Copy the companion layout file alongside the YAML, if it exists.
    const sourceLayoutFile = companionLayoutPath(absSource);
    const destLayoutFile = companionLayoutPath(destPath);
    if (existsSync(sourceLayoutFile)) {
      try {
        writeFileSync(destLayoutFile, readFileSync(sourceLayoutFile, 'utf-8'), 'utf-8');
      } catch { /* best-effort — missing or unreadable layout should not block import */ }
    }
    try {
      config = parseYaml(content);
    } catch {
      const doc = yaml.load(content) as any;
      const p = doc?.pipeline ?? doc ?? {};
      config = {
        name: p.name || basename(absSource, '.yaml').replace(/[-_]/g, ' '),
        driver: p.driver,
        timeout: p.timeout,
        tracks: Array.isArray(p.tracks) ? p.tracks : [],
      } as RawPipelineConfig;
    }
    yamlPath = destPath;
    loadLayout();
    beginWatching(destPath, content);
    res.json(getState());
  } catch (e: any) {
    res.status(400).json({ error: e.message ?? 'Failed to import file' });
  }
});

// Export: serialize current config and copy to destination directory,
// along with its companion .layout.json so positions travel with the YAML.
app.post('/api/export-file', (req, res) => {
  const { destDir } = req.body;
  if (!destDir) return res.status(400).json({ error: 'destDir is required' });
  if (!yamlPath) return res.status(400).json({ error: 'No pipeline file to export' });
  const absDestDir = resolve(destDir);
  if (!existsSync(absDestDir)) return res.status(404).json({ error: `Directory not found: ${absDestDir}` });
  // B1: Ensure export destination is within workDir.
  if (workDir && !isPathWithin(absDestDir, workDir)) {
    return res.status(403).json({ error: 'Export destination is outside the workspace directory' });
  }
  try {
    const content = serializePipeline(config);
    writeFileSync(yamlPath, content, 'utf-8');
    // Keep the source-of-truth layout in sync on disk before copying.
    saveLayout();
    const destPath = join(absDestDir, basename(yamlPath));
    writeFileSync(destPath, content, 'utf-8');
    // Write the companion layout next to the exported YAML.
    const destLayoutFile = companionLayoutPath(destPath);
    writeFileSync(destLayoutFile, JSON.stringify(layout, null, 2), 'utf-8');
    res.json({ ok: true, path: destPath });
  } catch (e: any) {
    res.status(500).json({ error: e.message ?? 'Failed to export file' });
  }
});

// Delete a YAML and its companion .layout.json. If the deleted file is the
// one currently loaded, reset in-memory state back to a blank pipeline so the
// client can decide what to open next.
app.post('/api/delete-file', (req, res) => {
  const { path: filePath } = req.body;
  if (!filePath) return res.status(400).json({ error: 'path is required' });
  const absPath = resolve(filePath);
  try {
    if (existsSync(absPath)) {
      rmSync(absPath, { force: true });
    }
    const layoutFile = companionLayoutPath(absPath);
    if (existsSync(layoutFile)) {
      rmSync(layoutFile, { force: true });
    }
    if (yamlPath === absPath) {
      yamlPath = null;
      config = createEmptyPipeline('Untitled Pipeline');
      layout = { positions: {} };
      stopFileWatching();
    }
    res.json(getState());
  } catch (e: any) {
    res.status(500).json({ error: e.message ?? 'Failed to delete file' });
  }
});

// ── Load demo ──
app.post('/api/demo', (_req, res) => {
  const DEMO = `pipeline:
  name: Demo Pipeline
  tracks:
    - id: research
      name: Research
      color: '#60a5fa'
      tasks:
        - id: gather
          name: Gather Sources
          prompt: Find and summarize the top 5 sources on the given topic.
        - id: analyze
          name: Analyze Data
          prompt: Analyze the gathered sources and extract key insights.
          depends_on:
            - gather
    - id: writing
      name: Writing
      color: '#34d399'
      tasks:
        - id: draft
          name: Write Draft
          prompt: Write a comprehensive draft based on the research analysis.
          depends_on:
            - research.analyze
        - id: review
          name: Review & Edit
          prompt: Review the draft for accuracy, clarity, and style.
          depends_on:
            - draft
`;
  try {
    config = parseYaml(DEMO);
    res.json(getState());
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ═══ Pipeline Run ═══

interface RunInitialTask {
  taskId: string;
  trackId: string;
  taskName: string;
  status: TaskStatus;
  startedAt: null;
  finishedAt: null;
  durationMs: null;
  exitCode: null;
  stdout: string;
  stderr: string;
  outputPath: null;
  stderrPath: null;
  sessionId: null;
  normalizedOutput: null;
  resolvedDriver: null;
  resolvedModelTier: null;
  resolvedPermissions: null;
  logs: never[];
}

type RunEvent =
  | { type: 'run_start'; runId: string; tasks: RunInitialTask[] }
  | {
      type: 'task_update';
      runId: string;
      taskId: string;
      status: TaskStatus;
      startedAt?: string;
      finishedAt?: string;
      durationMs?: number;
      exitCode?: number;
      stdout?: string;
      stderr?: string;
      outputPath?: string | null;
      stderrPath?: string | null;
      sessionId?: string | null;
      normalizedOutput?: string | null;
      resolvedDriver?: string | null;
      resolvedModelTier?: string | null;
      resolvedPermissions?: Permissions | null;
    }
  | { type: 'run_end'; runId: string; success: boolean }
  | { type: 'run_error'; runId: string; error: string }
  | { type: 'log'; runId: string; line: string }
  | {
      type: 'task_log';
      runId: string;
      taskId: string | null;
      level: 'info' | 'warn' | 'error' | 'debug' | 'section' | 'quiet';
      timestamp: string;
      text: string;
    }
  | { type: 'approval_request'; runId: string; request: { id: string; taskId: string; trackId?: string; message: string; createdAt: string; timeoutMs: number; metadata?: Record<string, unknown> } }
  | { type: 'approval_resolved'; runId: string; requestId: string; outcome: 'approved' | 'rejected' | 'timeout' | 'aborted' };

// ── In-process pipeline run state ──
// We embed the SDK directly instead of spawning `tagma-cli` as a subprocess
// and regex-parsing its stdout. The server becomes the authoritative host
// for the pipeline so the full TaskState (including TaskResult with stdout,
// stderr, outputPath, sessionId, etc.) is available on every event.
let activeRunAbort: AbortController | null = null;
let activeRunGateway: InMemoryApprovalGateway | null = null;
let activeRunId: string | null = null;
// B4: Synchronous lock to prevent TOCTOU race between checking activeRunAbort
// and setting it (loadPipeline + validateConfig are async).
let runStarting = false;
const sseClients = new Set<import('express').Response>();

// ── Event seq + replay buffer (§1.3 / §4.5) ──
// Every broadcast RunEvent is stamped with a monotonic `seq` field tied
// to the current run. A bounded ring buffer holds the most recent events
// so that SSE clients reconnecting with `Last-Event-ID: <seq>` can replay
// everything they missed. The buffer resets at run_start.
const RUN_EVENT_BUFFER_MAX = 1024;
let currentRunSeq = 0;
let runEventBuffer: Array<RunEvent & { seq: number }> = [];

function broadcast(event: RunEvent) {
  currentRunSeq += 1;
  const stamped = { ...event, seq: currentRunSeq };
  runEventBuffer.push(stamped);
  if (runEventBuffer.length > RUN_EVENT_BUFFER_MAX) {
    runEventBuffer.splice(0, runEventBuffer.length - RUN_EVENT_BUFFER_MAX);
  }
  const data = JSON.stringify(stamped);
  for (const client of sseClients) {
    client.write(`id: ${currentRunSeq}\nevent: run_event\ndata: ${data}\n\n`);
  }
}

function resetRunEventBuffer() {
  runEventBuffer = [];
  currentRunSeq = 0;
}

app.get('/api/run/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  // EventSource sends its last-seen event id in `Last-Event-ID` on
  // automatic reconnect. We replay every buffered event with seq > that
  // value so the client's task map can be brought back up to date
  // without refetching anything.
  //
  // First-connect race fix: even when no Last-Event-ID is present, replay
  // the entire current-run buffer. The browser's `runStore.startRun`
  // creates the EventSource and immediately POSTs `/api/run/start`, so
  // the server may emit `run_start` + `approval_request` before this
  // GET handler has added `res` to `sseClients`. Replaying lastSeen=0
  // closes the gap; the reducer's `seq <= lastEventSeq` dedupe makes
  // duplicates harmless.
  const lastSeenRaw = parseInt(String(req.header('Last-Event-ID') ?? ''), 10);
  const lastSeen = Number.isFinite(lastSeenRaw) && lastSeenRaw > 0 ? lastSeenRaw : 0;
  res.write('\n');
  sseClients.add(res);
  const missed = runEventBuffer.filter((e) => e.seq > lastSeen);
  for (const e of missed) {
    res.write(`id: ${e.seq}\nevent: run_event\ndata: ${JSON.stringify(e)}\n\n`);
  }
  req.on('close', () => sseClients.delete(res));
});

app.post('/api/run/start', async (_req, res) => {
  // B4: Check both the active controller AND the synchronous lock so two
  // concurrent POST requests can't both pass the check before either sets it.
  if (activeRunAbort || runStarting) {
    return res.status(409).json({ error: 'A run is already in progress' });
  }
  runStarting = true;

  // Serialize the in-memory editor config to YAML and hand it to the SDK.
  // The round-trip is intentional: it exercises the same load path the CLI
  // uses (parse + template expansion + inheritance resolution) so the run
  // sees exactly what YAML-driven consumers would see.
  const content = serializePipeline(config);
  const cwd = workDir || process.cwd();

  let pipelineConfig;
  try {
    pipelineConfig = await loadPipeline(content, cwd);
  } catch (err: unknown) {
    runStarting = false; // B4: release lock on error
    const message = err instanceof Error ? err.message : String(err);
    return res.status(400).json({ error: `Configuration error: ${message}` });
  }

  // Validate the resolved config (catches DAG errors introduced by template
  // expansion, e.g. duplicate qualified IDs, broken cross-template references).
  const configErrors = validateConfig(pipelineConfig);
  if (configErrors.length > 0) {
    runStarting = false; // B4: release lock on error
    return res.status(400).json({ error: configErrors.join('; ') });
  }

  // Build initial task list from the raw (editor-side) config. This keeps
  // the qualified taskIds aligned with the pipeline DAG that the SDK
  // produces internally (`{trackId}.{taskId}`).
  const initialTasks: RunInitialTask[] = config.tracks.flatMap((track) =>
    track.tasks.map((task) => ({
      taskId: `${track.id}.${task.id}`,
      trackId: track.id,
      taskName: task.name || task.id,
      status: 'waiting',
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      exitCode: null,
      stdout: '',
      stderr: '',
      outputPath: null,
      stderrPath: null,
      sessionId: null,
      normalizedOutput: null,
      resolvedDriver: null,
      resolvedModelTier: null,
      resolvedPermissions: null,
      logs: [],
    })),
  );

  const runId = `run_${Date.now().toString(36)}`;
  const runStartedAt = new Date().toISOString();
  const abortController = new AbortController();
  const gateway = new InMemoryApprovalGateway();

  // Running tally of the most recent TaskState per qualified id. Populated
  // from the SDK's task_status_change events and flushed to summary.json
  // at run completion so the RunHistoryBrowser can render a rich per-task
  // timeline instead of a plaintext log (§3.12).
  const taskSnapshots = new Map<string, RunSummaryTask>();
  for (const t of initialTasks) {
    taskSnapshots.set(t.taskId, {
      taskId: t.taskId,
      trackId: t.trackId,
      trackName: config.tracks.find((tr) => tr.id === t.trackId)?.name ?? t.trackId,
      taskName: t.taskName,
      status: t.status,
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      exitCode: null,
      driver: null,
      modelTier: null,
    });
  }

  activeRunAbort = abortController;
  activeRunGateway = gateway;
  activeRunId = runId;
  // Start this run's event sequence fresh — clients treat `seq` as
  // monotonic per run, so the Last-Event-ID they cached from a previous
  // run must not be used against this one.
  resetRunEventBuffer();

  // Subscribe to approval gateway events and forward them to the SSE
  // clients. This replaces the old WebSocket-bridge-to-CLI path — the
  // gateway lives in-process now so there's no IPC hop.
  const unsubscribeApprovals = gateway.subscribe((event: ApprovalEvent) => {
    if (event.type === 'requested') {
      broadcast({
        type: 'approval_request',
        runId,
        request: approvalRequestToWire(event.request),
      });
      return;
    }
    if (event.type === 'resolved' || event.type === 'expired' || event.type === 'aborted') {
      const outcome = event.type === 'resolved'
        ? event.decision.outcome
        : event.type === 'expired' ? 'timeout' : 'aborted';
      broadcast({
        type: 'approval_resolved',
        runId,
        requestId: event.request.id,
        outcome: outcome as 'approved' | 'rejected' | 'timeout' | 'aborted',
      });
    }
  });

  broadcast({ type: 'run_start', runId, tasks: initialTasks });

  // Kick off the run in the background. Event translation happens in
  // onEvent; errors and finalization flow through .then/.catch/.finally.
  let runSuccess: boolean | null = null;
  let runErrorMessage: string | null = null;

  runPipeline(pipelineConfig, cwd, {
    approvalGateway: gateway,
    signal: abortController.signal,
    maxLogRuns: MAX_LOG_RUNS,
    runId,
    onEvent: (event: PipelineEvent) => {
      if (event.type === 'task_status_change') {
        // Update local snapshot for summary persistence.
        const existing = taskSnapshots.get(event.taskId);
        if (existing) {
          const state = event.state;
          const result = state.result;
          taskSnapshots.set(event.taskId, {
            ...existing,
            status: event.status,
            startedAt: state.startedAt ?? existing.startedAt,
            finishedAt: state.finishedAt ?? existing.finishedAt,
            durationMs: result?.durationMs ?? existing.durationMs,
            exitCode: result?.exitCode ?? existing.exitCode,
            driver: state.config.driver ?? existing.driver,
            modelTier: state.config.model_tier ?? existing.modelTier,
          });
        }
        broadcast(taskStateChangeToWire(runId, event.taskId, event.status, event.state));
      } else if (event.type === 'task_log') {
        // Stream every pipeline.log line out to SSE clients so the RunTaskPanel
        // can show the same process detail the log file has.
        broadcast({
          type: 'task_log',
          runId,
          taskId: event.taskId,
          level: event.level,
          timestamp: event.timestamp,
          text: event.text,
        });
      }
      // pipeline_start and pipeline_end are implicit in run_start / run_end
      // — we already broadcast run_start above, and run_end is emitted in
      // the .then/.catch below so we can include the actual success flag.
    },
  }).then((result: EngineResult) => {
    runSuccess = result.success;
    broadcast({ type: 'run_end', runId, success: result.success });
  }).catch((err: unknown) => {
    // AbortError from an explicit abort() → emit run_end with success:false
    // so the UI transitions to "Aborted" rather than "Error".
    const isAbort = err instanceof Error && (err.name === 'AbortError' || /abort/i.test(err.message));
    runSuccess = false;
    if (isAbort) {
      broadcast({ type: 'run_end', runId, success: false });
    } else {
      const message = err instanceof Error ? err.message : String(err);
      runErrorMessage = message;
      broadcast({ type: 'run_error', runId, error: message });
    }
  }).finally(() => {
    unsubscribeApprovals();
    // Abort any dangling approvals so consumers get a deterministic
    // timeout/aborted event rather than a silent drop.
    gateway.abortAll('run finished');
    // Persist a rich summary.json so RunHistoryBrowser can render a
    // per-task timeline for this run (§3.12).
    try {
      persistRunSummary(cwd, runId, {
        runId,
        pipelineName: config.name,
        startedAt: runStartedAt,
        finishedAt: new Date().toISOString(),
        success: runSuccess ?? false,
        error: runErrorMessage,
        tasks: Array.from(taskSnapshots.values()),
      });
    } catch (persistErr) {
      console.error('[run] failed to persist summary.json:', persistErr);
    }
    if (activeRunId === runId) {
      activeRunAbort = null;
      activeRunGateway = null;
      activeRunId = null;
    }
    runStarting = false; // B4: release lock when run completes
  });

  res.json({ ok: true, runId });
});

app.post('/api/run/abort', (_req, res) => {
  if (!activeRunAbort) {
    return res.status(404).json({ error: 'No run in progress' });
  }
  activeRunAbort.abort();
  // run_end (success: false) is emitted in the runPipeline chain's .catch
  // once the engine actually tears down, so we do not broadcast it here —
  // doing so would race with the engine's own final events.
  res.json({ ok: true });
});

// ── Run summary persistence (§3.12) ──
interface RunSummaryTask {
  taskId: string;
  trackId: string;
  trackName: string;
  taskName: string;
  status: TaskStatus;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  exitCode: number | null;
  driver: string | null;
  modelTier: string | null;
}

interface RunSummary {
  runId: string;
  pipelineName: string;
  startedAt: string;
  finishedAt: string;
  success: boolean;
  error: string | null;
  tasks: RunSummaryTask[];
}

function persistRunSummary(cwd: string, runId: string, summary: RunSummary): void {
  const logsDir = join(cwd, '.tagma', 'logs', runId);
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true });
  }
  writeFileSync(join(logsDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf-8');
}

function readRunSummary(cwd: string, runId: string): RunSummary | null {
  const summaryPath = join(cwd, '.tagma', 'logs', runId, 'summary.json');
  if (!existsSync(summaryPath)) return null;
  try {
    return JSON.parse(readFileSync(summaryPath, 'utf-8')) as RunSummary;
  } catch {
    return null;
  }
}

// Translate an SDK ApprovalRequest into the wire shape consumed by the
// editor's ApprovalDialog.
function approvalRequestToWire(req: ApprovalRequest): {
  id: string;
  taskId: string;
  trackId?: string;
  message: string;
  createdAt: string;
  timeoutMs: number;
  metadata?: Record<string, unknown>;
} {
  return {
    id: req.id,
    taskId: req.taskId,
    trackId: req.trackId,
    message: req.message,
    createdAt: req.createdAt,
    timeoutMs: req.timeoutMs,
    metadata: req.metadata ? { ...req.metadata } : undefined,
  };
}

// Translate a task_status_change PipelineEvent into a RunEvent.task_update.
// We project the full TaskState onto the wire shape, flattening TaskResult
// fields and pulling resolved driver / tier / permissions from state.config
// (which is the post-inheritance TaskConfig the engine actually used).
function taskStateChangeToWire(
  runId: string,
  taskId: string,
  status: TaskStatus,
  state: TaskState,
): RunEvent {
  const result = state.result;
  const cfg = state.config;
  return {
    type: 'task_update',
    runId,
    taskId,
    status,
    startedAt: state.startedAt ?? undefined,
    finishedAt: state.finishedAt ?? undefined,
    durationMs: result?.durationMs,
    exitCode: result?.exitCode,
    stdout: result?.stdout,
    stderr: result?.stderr,
    outputPath: result?.outputPath ?? null,
    stderrPath: result?.stderrPath ?? null,
    sessionId: result?.sessionId ?? null,
    normalizedOutput: result?.normalizedOutput ?? null,
    resolvedDriver: cfg.driver ?? null,
    resolvedModelTier: cfg.model_tier ?? null,
    resolvedPermissions: cfg.permissions ?? null,
  };
}

// ── Approval (F3) ──
// POST a decision for a pending approval request. The request originates
// from the in-process InMemoryApprovalGateway bound to the active run, so
// we resolve it directly — no IPC bridge, no stdout parsing.
app.post('/api/run/approval/:requestId', (req, res) => {
  const { requestId } = req.params;
  const { outcome, reason, actor } = req.body ?? {};
  if (outcome !== 'approved' && outcome !== 'rejected') {
    return res.status(400).json({ error: 'outcome must be approved|rejected' });
  }
  if (!activeRunGateway) {
    return res.status(503).json({
      error: 'approval gateway not available — no run in progress',
    });
  }
  const ok = activeRunGateway.resolve(requestId, {
    outcome,
    reason,
    actor: actor ?? 'editor',
  });
  if (!ok) {
    return res.status(404).json({
      error: `approval ${requestId} not pending (already resolved or expired)`,
    });
  }
  res.json({ ok: true });
});

// ── Run History (F8 / §3.12) ──
// Lists prior run directories under `<workDir>/.tagma/logs/` sorted by
// mtime desc, capped at 20. Each entry surfaces the summary.json data
// (if present) so the history browser can show per-run success/failure
// counts without loading individual logs. The raw pipeline.log is still
// fetchable via /api/run/history/:runId for debugging.
interface RunHistoryEntry {
  runId: string;
  path: string;
  startedAt: string;
  sizeBytes: number;
  pipelineName?: string;
  success?: boolean;
  finishedAt?: string;
  taskCounts?: { total: number; success: number; failed: number; timeout: number; skipped: number; blocked: number; running: number; waiting: number; idle: number };
}

function computeTaskCounts(tasks: RunSummaryTask[]): NonNullable<RunHistoryEntry['taskCounts']> {
  const counts = { total: tasks.length, success: 0, failed: 0, timeout: 0, skipped: 0, blocked: 0, running: 0, waiting: 0, idle: 0 };
  for (const t of tasks) {
    const k = t.status;
    if (k in counts) (counts as any)[k] += 1;
  }
  return counts;
}

app.get('/api/run/history', (_req, res) => {
  const cwd = workDir || process.cwd();
  const logsDir = join(cwd, '.tagma', 'logs');
  if (!existsSync(logsDir)) {
    return res.json({ runs: [] });
  }
  try {
    const entries = readdirSync(logsDir)
      .filter((name) => name.startsWith('run_'))
      .map((name): RunHistoryEntry | null => {
        const full = join(logsDir, name);
        try {
          const st = statSync(full);
          if (!st.isDirectory()) return null;
          const logFile = join(full, 'pipeline.log');
          const logStat = existsSync(logFile) ? statSync(logFile) : null;
          const summary = readRunSummary(cwd, name);
          return {
            runId: name,
            path: full,
            startedAt: summary?.startedAt ?? st.mtime.toISOString(),
            sizeBytes: logStat?.size ?? 0,
            pipelineName: summary?.pipelineName,
            success: summary?.success,
            finishedAt: summary?.finishedAt,
            taskCounts: summary ? computeTaskCounts(summary.tasks) : undefined,
          };
        } catch {
          return null;
        }
      })
      .filter((x): x is RunHistoryEntry => x !== null)
      .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
      .slice(0, MAX_LOG_RUNS);
    res.json({ runs: entries });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/run/history/:runId', (req, res) => {
  const { runId } = req.params;
  if (!/^run_[A-Za-z0-9_-]+$/.test(runId)) {
    return res.status(400).json({ error: 'invalid runId' });
  }
  const cwd = workDir || process.cwd();
  const logFile = join(cwd, '.tagma', 'logs', runId, 'pipeline.log');
  if (!existsSync(logFile)) {
    return res.status(404).json({ error: 'log not found' });
  }
  try {
    const MAX_LOG_BYTES = 1024 * 1024; // 1 MB cap
    const stat = statSync(logFile);
    const raw = readFileSync(logFile, 'utf-8');
    const content = stat.size > MAX_LOG_BYTES ? clip(raw, MAX_LOG_BYTES) : raw;
    res.json({ runId, content });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Rich summary view — lets the browser render per-task status + timing
// without parsing the pipeline.log text.
app.get('/api/run/history/:runId/summary', (req, res) => {
  const { runId } = req.params;
  if (!/^run_[A-Za-z0-9_-]+$/.test(runId)) {
    return res.status(400).json({ error: 'invalid runId' });
  }
  const cwd = workDir || process.cwd();
  const summary = readRunSummary(cwd, runId);
  if (!summary) {
    return res.status(404).json({ error: 'summary not found' });
  }
  res.json(summary);
});

// ── B5: Global error handler ──
// Catches unhandled errors in route handlers so the process doesn't crash.
// Must be registered after all routes (Express identifies error handlers by
// their 4-parameter signature).
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[server] unhandled error:', err);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = parseInt(process.env.PORT ?? '3001');
const server = app.listen(PORT, () => {
  console.log(`Tagma Editor server running on http://localhost:${PORT}`);
});

// ── B6: Graceful shutdown ──
function gracefulShutdown() {
  console.log('[server] shutting down...');
  // Abort any active pipeline run
  if (activeRunAbort) {
    activeRunAbort.abort();
    activeRunAbort = null;
    activeRunGateway = null;
    activeRunId = null;
    runStarting = false;
  }
  // Close file watcher
  stopFileWatching();
  // Close all SSE connections
  for (const client of sseClients) {
    try { client.end(); } catch { /* best-effort */ }
  }
  sseClients.clear();
  for (const client of stateEventClients) {
    try { client.res.end(); } catch { /* best-effort */ }
  }
  stateEventClients.clear();
  // Close HTTP server
  server.close(() => {
    console.log('[server] shutdown complete');
    process.exit(0);
  });
  // Force exit after 5s if connections don't close
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

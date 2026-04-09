import express from 'express';
import cors from 'cors';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, mkdtempSync, rmSync } from 'fs';
import { resolve, dirname, basename, sep, join } from 'path';
import { execSync, spawn, type ChildProcess } from 'child_process';
import { tmpdir } from 'os';
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
  hasHandler,
  registerPlugin,
} from '@tagma/sdk';
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
let workDir: string = process.cwd();

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
 * Delete keys whose value is '', undefined, or null — except required keys.
 * Arrays/objects with content are kept; empty arrays/objects are removed.
 * Mutates the object in place.
 */
function stripEmptyFields(obj: Record<string, unknown>, required: Set<string>) {
  for (const key of Object.keys(obj)) {
    if (required.has(key)) continue;
    const v = obj[key];
    if (v === '' || v === undefined || v === null) {
      delete obj[key];
    } else if (Array.isArray(v) && v.length === 0) {
      delete obj[key];
    } else if (typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 0) {
      delete obj[key];
    }
  }
}

function getState() {
  // Auto-reconcile continue_from before returning state
  config = reconcileContinueFrom(config);
  let validationErrors: ValidationError[] = [];
  let dag: RawDag = { nodes: new Map(), edges: [] };
  try { validationErrors = validateRaw(config); } catch {}
  try { dag = buildRawDag(config); } catch {}
  // Serialize dag for JSON (Map → object)
  const dagNodes: Record<string, any> = {};
  for (const [k, v] of dag.nodes) dagNodes[k] = v;
  return {
    config,
    validationErrors,
    dag: { nodes: dagNodes, edges: dag.edges },
    yamlPath,
    workDir,
  };
}

// ── GET state ──
app.get('/api/state', (_req, res) => {
  res.json(getState());
});

// ── Plugin registry ──
app.get('/api/registry', (_req, res) => {
  res.json({
    drivers: listRegistered('drivers'),
    triggers: listRegistered('triggers'),
    completions: listRegistered('completions'),
    middlewares: listRegistered('middlewares'),
  });
});

// ── Plugin management ──

const NPM_REGISTRY = 'https://registry.npmjs.org';

/** Build npm proxy flags from system env vars (http_proxy / https_proxy) */
function npmProxyFlags(): string {
  const flags: string[] = [];
  const httpProxy = process.env.http_proxy || process.env.HTTP_PROXY;
  const httpsProxy = process.env.https_proxy || process.env.HTTPS_PROXY;
  if (httpProxy) flags.push(`--proxy ${httpProxy}`);
  if (httpsProxy) flags.push(`--https-proxy ${httpsProxy}`);
  return flags.join(' ');
}

/** Check whether npm CLI is available on this machine */
function hasNpmCli(): boolean {
  try {
    execSync('npm --version', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 });
    return true;
  } catch { return false; }
}

// ── Built-in npm registry installer (no npm CLI required) ──

/** Encode a package name for the npm registry URL */
function registryUrl(name: string): string {
  // Scoped: @scope/pkg → @scope%2fpkg
  if (name.startsWith('@')) {
    return `${NPM_REGISTRY}/${name.replace('/', '%2f')}`;
  }
  return `${NPM_REGISTRY}/${encodeURIComponent(name)}`;
}

/** Fetch package metadata from npm registry (uses Node.js built-in fetch) */
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

    // Extract (tar is built-in on Windows 10+, macOS, Linux)
    execSync(`tar -xzf "${tgzPath}" -C "${destDir}" --strip-components=1`, {
      timeout: 30000,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
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
 * Install a package: try built-in registry fetch first, fall back to npm CLI.
 * This lets users without npm/bun install @tagma/* plugins directly.
 */
async function installPackage(name: string): Promise<void> {
  ensureWorkDirPackageJson();
  try {
    await directRegistryInstall(name);
  } catch (directErr: any) {
    if (hasNpmCli()) {
      execSync(`npm install ${name} --legacy-peer-deps ${npmProxyFlags()}`, {
        cwd: workDir, timeout: 120000, encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return;
    }
    throw new Error(`${directErr.message}${directErr.cause ? '' : ' (npm CLI not available as fallback)'}`);
  }
}

/**
 * Uninstall a package: remove from node_modules + package.json.
 * No npm CLI required.
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

/** Ensure workDir has a package.json so npm install works there */
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
  };
}

/** Dynamically import a plugin from the workDir's node_modules */
async function loadPluginFromWorkDir(name: string): Promise<void> {
  // Resolve to the plugin's entry point inside workDir/node_modules
  const pluginPkgPath = resolve(workDir, 'node_modules', ...name.split('/'), 'package.json');
  const pluginPkg = JSON.parse(readFileSync(pluginPkgPath, 'utf-8'));
  const entryPoint = pluginPkg.exports?.['.'] ?? pluginPkg.main ?? './src/index.ts';
  const pluginDir = resolve(workDir, 'node_modules', ...name.split('/'));
  const modulePath = resolve(pluginDir, entryPoint);

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

/** Install a plugin into workDir and load it into the registry */
app.post('/api/plugins/install', async (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'name is required' });
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

/** Uninstall a plugin from workDir (no npm CLI required) */
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

  // Read package name from local package.json (for directories)
  let pkgName: string | undefined;
  const stat = statSync(absPath);
  if (stat.isDirectory()) {
    const localPkg = resolve(absPath, 'package.json');
    if (!existsSync(localPkg)) {
      return res.status(400).json({ error: 'Directory does not contain a package.json' });
    }
    pkgName = JSON.parse(readFileSync(localPkg, 'utf-8')).name;
  }

  try {
    ensureWorkDirPackageJson();
    execSync(`npm install "${absPath}" --legacy-peer-deps ${npmProxyFlags()}`, {
      cwd: workDir,
      timeout: 120000,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // For tarballs, discover the package name from what npm actually installed
    if (!pkgName) {
      const output = execSync('npm ls --json --depth=0 2>nul', {
        cwd: workDir, timeout: 10000, encoding: 'utf-8',
      });
      const deps = JSON.parse(output).dependencies ?? {};
      // Find the dependency whose resolved path matches
      for (const [name, info] of Object.entries<any>(deps)) {
        if (info.resolved && resolve(info.resolved).startsWith(absPath)) {
          pkgName = name;
          break;
        }
      }
      // Fallback: the most recently added dep
      if (!pkgName) {
        const names = Object.keys(deps);
        pkgName = names[names.length - 1];
      }
    }

    if (!pkgName) {
      return res.status(500).json({ error: 'Could not determine package name after install' });
    }

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
  config = { ...config, ...patch };
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
  const fields = { ...req.body };
  // Strip empty optional fields
  stripEmptyFields(fields, TRACK_REQUIRED_KEYS);
  config = updateTrack(config, trackId, fields);
  res.json(getState());
});

app.delete('/api/tracks/:trackId', (_req, res) => {
  config = removeTrack(config, _req.params.trackId);
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
  if (patch.prompt !== undefined) {
    delete updated.command;
  } else if (patch.command !== undefined) {
    delete updated.prompt;
  }
  // Strip empty optional fields so they don't appear as '' in YAML
  stripEmptyFields(updated, TASK_REQUIRED_KEYS);
  config = upsertTask(config, trackId, updated);
  res.json(getState());
});

app.delete('/api/tasks/:trackId/:taskId', (req, res) => {
  const { trackId, taskId } = req.params;
  config = removeTask(config, trackId, taskId, true);
  res.json(getState());
});

app.post('/api/tasks/move', (req, res) => {
  const { trackId, taskId, toIndex } = req.body;
  config = moveTask(config, trackId, taskId, toIndex);
  res.json(getState());
});

app.post('/api/tasks/transfer', (req, res) => {
  const { fromTrackId, taskId, toTrackId } = req.body;
  config = transferTask(config, fromTrackId, taskId, toTrackId);
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
  const updated = filtered.length > 0 ? { ...rest, depends_on: filtered } : rest;
  config = upsertTask(config, trackId, updated as RawTaskConfig);
  res.json(getState());
});

// ── YAML Import/Export ──
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
  try {
    if (!existsSync(dirPath)) {
      // If path doesn't exist, try its parent (e.g. when path is a new file)
      dirPath = dirname(dirPath);
      if (!existsSync(dirPath)) {
        return res.status(404).json({ error: `Directory not found: ${dirPath}` });
      }
    }
    if (!statSync(dirPath).isDirectory()) {
      // If path is a file, list its parent directory
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
  if (!existsSync(absPath)) return res.status(404).json({ error: 'File not found' });
  try {
    const dir = statSync(absPath).isDirectory() ? absPath : dirname(absPath);
    if (process.platform === 'win32') {
      execSync(`explorer /select,"${absPath}"`);
    } else if (process.platform === 'darwin') {
      execSync(`open -R "${absPath}"`);
    } else {
      execSync(`xdg-open "${dir}"`);
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
    const content = serializePipeline(config);
    writeFileSync(savePath, content, 'utf-8');
    yamlPath = savePath;
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
    const yaml = serializePipeline(config);
    writeFileSync(absPath, yaml, 'utf-8');
    yamlPath = absPath;
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
  const content = serializePipeline(config);
  writeFileSync(yamlPath, content, 'utf-8');
  res.json(getState());
});

// Import: copy external YAML into .tagma/ and open the copy
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
    res.json(getState());
  } catch (e: any) {
    res.status(400).json({ error: e.message ?? 'Failed to import file' });
  }
});

// Export: serialize current config and copy to destination directory
app.post('/api/export-file', (req, res) => {
  const { destDir } = req.body;
  if (!destDir) return res.status(400).json({ error: 'destDir is required' });
  if (!yamlPath) return res.status(400).json({ error: 'No pipeline file to export' });
  const absDestDir = resolve(destDir);
  if (!existsSync(absDestDir)) return res.status(404).json({ error: `Directory not found: ${absDestDir}` });
  try {
    const content = serializePipeline(config);
    writeFileSync(yamlPath, content, 'utf-8');
    const destPath = join(absDestDir, basename(yamlPath));
    writeFileSync(destPath, content, 'utf-8');
    res.json({ ok: true, path: destPath });
  } catch (e: any) {
    res.status(500).json({ error: e.message ?? 'Failed to export file' });
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

type RunEvent =
  | { type: 'run_start'; runId: string; tasks: { taskId: string; trackId: string; taskName: string; status: string; startedAt: null; finishedAt: null; durationMs: null; exitCode: null; stdout: string; stderr: string }[] }
  | { type: 'task_update'; taskId: string; status: string; startedAt?: string; finishedAt?: string; durationMs?: number; exitCode?: number; stdout?: string; stderr?: string }
  | { type: 'run_end'; success: boolean }
  | { type: 'run_error'; error: string }
  | { type: 'log'; line: string };

let runProcess: ChildProcess | null = null;
const sseClients = new Set<import('express').Response>();

function broadcast(event: RunEvent) {
  const data = JSON.stringify(event);
  for (const client of sseClients) {
    client.write(`event: run_event\ndata: ${data}\n\n`);
  }
}

app.get('/api/run/events', (_req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('\n');
  sseClients.add(res);
  _req.on('close', () => sseClients.delete(res));
});

app.post('/api/run/start', (_req, res) => {
  if (runProcess) {
    return res.status(409).json({ error: 'A run is already in progress' });
  }

  // Save current config to a temp YAML file
  const content = serializePipeline(config);
  const tmpDir = mkdtempSync(join(tmpdir(), 'tagma-run-'));
  const tmpYaml = join(tmpDir, 'pipeline.yaml');
  writeFileSync(tmpYaml, content, 'utf-8');

  // Build initial task list from current config
  const initialTasks = config.tracks.flatMap((track) =>
    track.tasks.map((task) => ({
      taskId: `${track.id}.${task.id}`,
      trackId: track.id,
      taskName: task.name || task.id,
      status: 'waiting' as const,
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      exitCode: null,
      stdout: '',
      stderr: '',
    }))
  );

  // Determine the CLI path
  const cliPath = resolve(import.meta.dirname ?? '.', '../../tagma-cli/src/index.ts');
  const cwd = workDir || process.cwd();

  // Spawn bun with the CLI
  const child = spawn('bun', ['run', cliPath, tmpYaml, '--cwd', cwd], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  runProcess = child;

  // Generate a run ID
  const runId = `run_${Date.now().toString(36)}`;

  broadcast({ type: 'run_start', runId, tasks: initialTasks });

  function parseLine(line: string) {
    // Engine log format: "HH:MM:SS.mmm [task:<qid>] <message>"
    // info goes to stdout, error goes to stderr (with "ERROR: " prefix in msg)
    const taskMatch = line.match(/\[task:([^\]]+)\]\s+(.*)/);
    if (!taskMatch) return;
    const [, taskId, rawMsg] = taskMatch;
    // Strip "ERROR: " prefix from stderr lines
    const msg = rawMsg.replace(/^ERROR:\s*/, '');

    if (msg.startsWith('running')) {
      broadcast({ type: 'task_update', taskId, status: 'running', startedAt: new Date().toISOString() });
    } else if (msg.startsWith('success')) {
      const durMatch = msg.match(/\((\d+\.?\d*)s\)/);
      const durationMs = durMatch ? Math.round(parseFloat(durMatch[1]) * 1000) : undefined;
      broadcast({ type: 'task_update', taskId, status: 'success', finishedAt: new Date().toISOString(), durationMs, exitCode: 0 });
    } else if (msg.match(/^(failed|timeout)/)) {
      const exitMatch = msg.match(/exit=(-?\d+)/);
      const durMatch = msg.match(/duration=(\d+\.?\d*)s/);
      broadcast({
        type: 'task_update', taskId,
        status: msg.startsWith('timeout') ? 'timeout' : 'failed',
        finishedAt: new Date().toISOString(),
        exitCode: exitMatch ? parseInt(exitMatch[1]) : -1,
        durationMs: durMatch ? Math.round(parseFloat(durMatch[1]) * 1000) : undefined,
      });
    } else if (msg.startsWith('skipped')) {
      broadcast({ type: 'task_update', taskId, status: 'skipped', finishedAt: new Date().toISOString() });
    } else if (msg.startsWith('blocked')) {
      broadcast({ type: 'task_update', taskId, status: 'blocked', finishedAt: new Date().toISOString() });
    }
  }

  child.stdout?.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n').filter(Boolean)) {
      parseLine(line);
    }
  });

  child.stderr?.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n').filter(Boolean)) {
      parseLine(line);
    }
  });

  child.on('close', (code) => {
    broadcast({ type: 'run_end', success: code === 0 });
    runProcess = null;
    // Clean up temp files
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  child.on('error', (err) => {
    broadcast({ type: 'run_error', error: err.message });
    runProcess = null;
  });

  res.json({ ok: true, runId });
});

app.post('/api/run/abort', (_req, res) => {
  if (!runProcess) {
    return res.status(404).json({ error: 'No run in progress' });
  }
  runProcess.kill('SIGTERM');
  runProcess = null;
  broadcast({ type: 'run_end', success: false });
  res.json({ ok: true });
});

const PORT = parseInt(process.env.PORT ?? '3001');
app.listen(PORT, () => {
  console.log(`Tagma Editor server running on http://localhost:${PORT}`);
});

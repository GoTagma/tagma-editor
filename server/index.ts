import express from 'express';
import cors from 'cors';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'fs';
import { resolve, dirname, basename, sep } from 'path';
import { execSync } from 'child_process';
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
} from '@tagma/sdk';
import type { RawPipelineConfig, RawTrackConfig, RawTaskConfig } from '@tagma/sdk';
import type { ValidationError, RawDag } from '@tagma/sdk';

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// ── In-memory state ──
let config: RawPipelineConfig = createEmptyPipeline('Untitled Pipeline');
let yamlPath: string | null = null;
let workDir: string = process.cwd();

function getState() {
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

// ── Pipeline name ──
app.patch('/api/pipeline', (req, res) => {
  const { name, driver, timeout } = req.body;
  const patch: Partial<RawPipelineConfig> = {};
  if (name !== undefined) patch.name = name;
  if (driver !== undefined) patch.driver = driver || undefined;
  if (timeout !== undefined) patch.timeout = timeout || undefined;
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
  const fields = req.body;
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
  const updated = { ...existing, ...patch } as RawTaskConfig;
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
  if (wd !== undefined) workDir = resolve(wd);
  res.json(getState());
});

// ── Filesystem browsing ──
app.get('/api/fs/list', (req, res) => {
  const dirPath = resolve((req.query.path as string) || workDir);
  try {
    if (!existsSync(dirPath)) {
      return res.status(404).json({ error: `Directory not found: ${dirPath}` });
    }
    const stat = statSync(dirPath);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: 'Path is not a directory' });
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
  if (!yamlPath) return res.status(400).json({ error: 'No file path set. Use save-as.' });
  try {
    const yaml = serializePipeline(config);
    writeFileSync(yamlPath, yaml, 'utf-8');
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
  config = createEmptyPipeline(name || 'Untitled Pipeline');
  yamlPath = null;
  res.json(getState());
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

const PORT = parseInt(process.env.PORT ?? '3001');
app.listen(PORT, () => {
  console.log(`Tagma Editor server running on http://localhost:${PORT}`);
});

const BASE = '/api';

/**
 * Serialize an object to JSON, converting undefined → null so the server
 * receives "clear this field" instead of silently dropping the key.
 * Single choke-point: every API method uses this instead of JSON.stringify.
 */
function jsonBody(obj: unknown): string {
  return JSON.stringify(obj, (_key, value) => (value === undefined ? null : value));
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? 'Request failed');
  }
  if (res.headers.get('content-type')?.includes('text/yaml')) {
    return (await res.text()) as unknown as T;
  }
  return res.json();
}

export interface ServerState {
  config: RawPipelineConfig;
  validationErrors: ValidationError[];
  dag: { nodes: Record<string, any>; edges: DagEdge[] };
  yamlPath: string | null;
  workDir: string;
}

export type HookCommand = string | string[];

export interface HooksConfig {
  pipeline_start?: HookCommand;
  task_start?: HookCommand;
  task_success?: HookCommand;
  task_failure?: HookCommand;
  pipeline_complete?: HookCommand;
  pipeline_error?: HookCommand;
}

export interface Permissions {
  read?: boolean;
  write?: boolean;
  execute?: boolean;
}

export interface MiddlewareConfig {
  type: string;
  file?: string;
  label?: string;
  [key: string]: unknown;
}

export interface TriggerConfig {
  type: string;
  message?: string;
  options?: string[];
  timeout?: string;
  path?: string;
  metadata?: Record<string, unknown>;
}

export interface CompletionConfig {
  type: string;
  expect?: number | number[];
  path?: string;
  kind?: 'file' | 'dir' | 'any';
  min_size?: number;
  check?: string;
  timeout?: string;
}

export interface RawPipelineConfig {
  name: string;
  driver?: string;
  timeout?: string;
  plugins?: string[];
  hooks?: HooksConfig;
  tracks: RawTrackConfig[];
}

export interface RawTrackConfig {
  id: string;
  name: string;
  color?: string;
  driver?: string;
  model_tier?: string;
  agent_profile?: string;
  cwd?: string;
  permissions?: Permissions;
  on_failure?: 'skip_downstream' | 'stop_all' | 'ignore';
  middlewares?: MiddlewareConfig[];
  tasks: RawTaskConfig[];
}

export interface RawTaskConfig {
  id: string;
  name?: string;
  prompt?: string;
  command?: string;
  depends_on?: string[];
  continue_from?: string;
  output?: string;
  driver?: string;
  model_tier?: string;
  agent_profile?: string;
  cwd?: string;
  timeout?: string;
  permissions?: Permissions;
  middlewares?: MiddlewareConfig[];
  trigger?: TriggerConfig;
  completion?: CompletionConfig;
  use?: string;
  with?: Record<string, unknown>;
}

export interface ValidationError {
  path: string;
  message: string;
}

export interface DagEdge {
  from: string;
  to: string;
}

export interface PluginRegistry {
  drivers: string[];
  triggers: string[];
  completions: string[];
  middlewares: string[];
}

export interface PluginInfo {
  name: string;
  installed: boolean;
  loaded: boolean;
  version: string | null;
  description: string | null;
  categories: string[];
}

export interface PluginActionResult {
  plugin: PluginInfo;
  registry: PluginRegistry;
  warning?: string;
  note?: string;
}

export interface FsEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
}

export interface FsListResult {
  path: string;
  parent: string | null;
  entries: FsEntry[];
}

// ── Run types ──

export type TaskStatus = 'idle' | 'waiting' | 'running' | 'success' | 'failed' | 'timeout' | 'skipped' | 'blocked';

export interface RunTaskState {
  taskId: string;
  trackId: string;
  taskName: string;
  status: TaskStatus;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface RunState {
  runId: string | null;
  status: 'idle' | 'starting' | 'running' | 'done' | 'aborted' | 'error';
  tasks: RunTaskState[];
  error: string | null;
}

export type RunEvent =
  | { type: 'run_start'; runId: string; tasks: RunTaskState[] }
  | { type: 'task_update'; taskId: string; status: TaskStatus; startedAt?: string; finishedAt?: string; durationMs?: number; exitCode?: number; stdout?: string; stderr?: string }
  | { type: 'run_end'; success: boolean }
  | { type: 'run_error'; error: string }
  | { type: 'log'; line: string };

export const api = {
  getState: () => request<ServerState>('/state'),

  getRegistry: () => request<PluginRegistry>('/registry'),

  updatePipeline: (fields: Record<string, unknown>) =>
    request<ServerState>('/pipeline', { method: 'PATCH', body: jsonBody(fields) }),

  addTrack: (id: string, name: string, color?: string) =>
    request<ServerState>('/tracks', { method: 'POST', body: jsonBody({ id, name, color }) }),

  updateTrack: (trackId: string, fields: Record<string, unknown>) =>
    request<ServerState>(`/tracks/${trackId}`, { method: 'PATCH', body: jsonBody(fields) }),

  deleteTrack: (trackId: string) =>
    request<ServerState>(`/tracks/${trackId}`, { method: 'DELETE' }),

  reorderTrack: (trackId: string, toIndex: number) =>
    request<ServerState>('/tracks/reorder', { method: 'POST', body: jsonBody({ trackId, toIndex }) }),

  addTask: (trackId: string, task: RawTaskConfig) =>
    request<ServerState>('/tasks', { method: 'POST', body: jsonBody({ trackId, task }) }),

  updateTask: (trackId: string, taskId: string, patch: Partial<RawTaskConfig>) =>
    request<ServerState>(`/tasks/${trackId}/${taskId}`, { method: 'PATCH', body: jsonBody(patch) }),

  deleteTask: (trackId: string, taskId: string) =>
    request<ServerState>(`/tasks/${trackId}/${taskId}`, { method: 'DELETE' }),

  transferTask: (fromTrackId: string, taskId: string, toTrackId: string) =>
    request<ServerState>('/tasks/transfer', { method: 'POST', body: jsonBody({ fromTrackId, taskId, toTrackId }) }),

  addDependency: (fromTrackId: string, fromTaskId: string, toTrackId: string, toTaskId: string) =>
    request<ServerState>('/dependencies', { method: 'POST', body: jsonBody({ fromTrackId, fromTaskId, toTrackId, toTaskId }) }),

  removeDependency: (trackId: string, taskId: string, depRef: string) =>
    request<ServerState>('/dependencies', { method: 'DELETE', body: jsonBody({ trackId, taskId, depRef }) }),

  exportYaml: () => request<string>('/export'),

  importYaml: (yaml: string) =>
    request<ServerState>('/import', { method: 'POST', body: jsonBody({ yaml }) }),

  loadDemo: () => request<ServerState>('/demo', { method: 'POST' }),

  listDir: (path?: string) =>
    request<FsListResult>(`/fs/list${path ? `?path=${encodeURIComponent(path)}` : ''}`),

  listRoots: () =>
    request<{ roots: string[] }>('/fs/roots'),

  mkdir: (path: string) =>
    request<{ path: string }>('/fs/mkdir', { method: 'POST', body: jsonBody({ path }) }),

  reveal: (path: string) =>
    request<{ ok: boolean }>('/fs/reveal', { method: 'POST', body: jsonBody({ path }) }),

  setWorkDir: (workDir: string) =>
    request<ServerState>('/workspace', { method: 'PATCH', body: jsonBody({ workDir }) }),

  openFile: (path: string) =>
    request<ServerState>('/open', { method: 'POST', body: jsonBody({ path }) }),

  saveFile: () =>
    request<ServerState>('/save', { method: 'POST' }),

  saveFileAs: (path: string) =>
    request<ServerState>('/save-as', { method: 'POST', body: jsonBody({ path }) }),

  newPipeline: (name?: string) =>
    request<ServerState>('/new', { method: 'POST', body: jsonBody({ name }) }),

  importFile: (sourcePath: string) =>
    request<ServerState>('/import-file', { method: 'POST', body: jsonBody({ sourcePath }) }),

  exportFile: (destDir: string) =>
    request<{ ok: boolean; path: string }>('/export-file', { method: 'POST', body: jsonBody({ destDir }) }),

  startRun: () =>
    request<{ ok: boolean }>('/run/start', { method: 'POST' }),

  abortRun: () =>
    request<{ ok: boolean }>('/run/abort', { method: 'POST' }),

  subscribeRunEvents: (onEvent: (event: RunEvent) => void): (() => void) => {
    const es = new EventSource(`${BASE}/run/events`);
    es.addEventListener('run_event', (e) => {
      try {
        const event: RunEvent = JSON.parse(e.data);
        onEvent(event);
      } catch {}
    });
    es.onerror = () => {
      // EventSource auto-reconnects
    };
    return () => es.close();
  },

  // ── Plugin management ──

  listPlugins: () =>
    request<{ plugins: PluginInfo[] }>('/plugins'),

  getPluginInfo: (name: string) =>
    request<PluginInfo>(`/plugins/info?name=${encodeURIComponent(name)}`),

  installPlugin: (name: string) =>
    request<PluginActionResult>('/plugins/install', { method: 'POST', body: jsonBody({ name }) }),

  uninstallPlugin: (name: string) =>
    request<PluginActionResult>('/plugins/uninstall', { method: 'POST', body: jsonBody({ name }) }),

  loadPlugin: (name: string) =>
    request<PluginActionResult>('/plugins/load', { method: 'POST', body: jsonBody({ name }) }),

  importLocalPlugin: (path: string) =>
    request<PluginActionResult>('/plugins/import-local', { method: 'POST', body: jsonBody({ path }) }),
};

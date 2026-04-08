const BASE = '/api';

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

export interface RawPipelineConfig {
  name: string;
  driver?: string;
  timeout?: string;
  tracks: RawTrackConfig[];
}

export interface RawTrackConfig {
  id: string;
  name: string;
  color?: string;
  driver?: string;
  tasks: RawTaskConfig[];
}

export interface RawTaskConfig {
  id: string;
  name?: string;
  prompt?: string;
  command?: string;
  depends_on?: string[];
  driver?: string;
  model_tier?: string;
  timeout?: string;
  output?: string;
  permissions?: { read: boolean; write: boolean; execute: boolean };
  continue_from?: string;
}

export interface ValidationError {
  path: string;
  message: string;
}

export interface DagEdge {
  from: string;
  to: string;
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

export const api = {
  getState: () => request<ServerState>('/state'),

  updatePipeline: (fields: Record<string, unknown>) =>
    request<ServerState>('/pipeline', { method: 'PATCH', body: JSON.stringify(fields) }),

  addTrack: (id: string, name: string, color?: string) =>
    request<ServerState>('/tracks', { method: 'POST', body: JSON.stringify({ id, name, color }) }),

  updateTrack: (trackId: string, fields: Record<string, unknown>) =>
    request<ServerState>(`/tracks/${trackId}`, { method: 'PATCH', body: JSON.stringify(fields) }),

  deleteTrack: (trackId: string) =>
    request<ServerState>(`/tracks/${trackId}`, { method: 'DELETE' }),

  reorderTrack: (trackId: string, toIndex: number) =>
    request<ServerState>('/tracks/reorder', { method: 'POST', body: JSON.stringify({ trackId, toIndex }) }),

  addTask: (trackId: string, task: RawTaskConfig) =>
    request<ServerState>('/tasks', { method: 'POST', body: JSON.stringify({ trackId, task }) }),

  updateTask: (trackId: string, taskId: string, patch: Partial<RawTaskConfig>) =>
    request<ServerState>(`/tasks/${trackId}/${taskId}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  deleteTask: (trackId: string, taskId: string) =>
    request<ServerState>(`/tasks/${trackId}/${taskId}`, { method: 'DELETE' }),

  transferTask: (fromTrackId: string, taskId: string, toTrackId: string) =>
    request<ServerState>('/tasks/transfer', { method: 'POST', body: JSON.stringify({ fromTrackId, taskId, toTrackId }) }),

  addDependency: (fromTrackId: string, fromTaskId: string, toTrackId: string, toTaskId: string) =>
    request<ServerState>('/dependencies', { method: 'POST', body: JSON.stringify({ fromTrackId, fromTaskId, toTrackId, toTaskId }) }),

  removeDependency: (trackId: string, taskId: string, depRef: string) =>
    request<ServerState>('/dependencies', { method: 'DELETE', body: JSON.stringify({ trackId, taskId, depRef }) }),

  exportYaml: () => request<string>('/export'),

  importYaml: (yaml: string) =>
    request<ServerState>('/import', { method: 'POST', body: JSON.stringify({ yaml }) }),

  loadDemo: () => request<ServerState>('/demo', { method: 'POST' }),

  listDir: (path?: string) =>
    request<FsListResult>(`/fs/list${path ? `?path=${encodeURIComponent(path)}` : ''}`),

  listRoots: () =>
    request<{ roots: string[] }>('/fs/roots'),

  mkdir: (path: string) =>
    request<{ path: string }>('/fs/mkdir', { method: 'POST', body: JSON.stringify({ path }) }),

  setWorkDir: (workDir: string) =>
    request<ServerState>('/workspace', { method: 'PATCH', body: JSON.stringify({ workDir }) }),

  openFile: (path: string) =>
    request<ServerState>('/open', { method: 'POST', body: JSON.stringify({ path }) }),

  saveFile: () =>
    request<ServerState>('/save', { method: 'POST' }),

  saveFileAs: (path: string) =>
    request<ServerState>('/save-as', { method: 'POST', body: JSON.stringify({ path }) }),

  newPipeline: (name?: string) =>
    request<ServerState>('/new', { method: 'POST', body: JSON.stringify({ name }) }),
};

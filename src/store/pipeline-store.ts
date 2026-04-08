import { create } from 'zustand';
import { api } from '../api/client';
import type { ServerState, RawPipelineConfig, RawTaskConfig, ValidationError, DagEdge } from '../api/client';

export interface TaskPosition { x: number; }

interface PipelineState {
  config: RawPipelineConfig;
  positions: Map<string, TaskPosition>;
  selectedTaskId: string | null;
  selectedTrackId: string | null;
  validationErrors: ValidationError[];
  dagEdges: DagEdge[];
  yamlPath: string | null;
  workDir: string;
  isDirty: boolean;
  loading: boolean;

  applyState: (state: ServerState) => void;
  init: () => Promise<void>;
  setPipelineName: (name: string) => void;
  updatePipelineFields: (fields: Record<string, unknown>) => void;
  addTrack: (name: string) => void;
  renameTrack: (trackId: string, name: string) => void;
  updateTrackFields: (trackId: string, fields: Record<string, unknown>) => void;
  deleteTrack: (trackId: string) => void;
  moveTrackTo: (trackId: string, toIndex: number) => void;
  addTask: (trackId: string, name: string, positionX?: number) => void;
  updateTask: (trackId: string, taskId: string, patch: Partial<RawTaskConfig>) => void;
  deleteTask: (trackId: string, taskId: string) => void;
  transferTaskToTrack: (fromTrackId: string, taskId: string, toTrackId: string) => void;
  addDependency: (fromTrackId: string, fromTaskId: string, toTrackId: string, toTaskId: string) => void;
  removeDependency: (trackId: string, taskId: string, depRef: string) => void;
  selectTask: (qualifiedId: string | null) => void;
  selectTrack: (trackId: string | null) => void;
  setTaskPosition: (qualifiedId: string, x: number) => void;
  setWorkDir: (workDir: string) => void;
  openFile: (path: string) => Promise<void>;
  saveFile: () => Promise<void>;
  saveFileAs: (path: string) => Promise<void>;
  newPipeline: (name?: string) => void;
  exportYaml: () => Promise<string>;
  importYaml: (yaml: string) => Promise<void>;
  loadDemo: () => Promise<void>;
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export const usePipelineStore = create<PipelineState>((set, _get) => {
  const applyState = (state: ServerState) => {
    set({
      config: state.config,
      validationErrors: state.validationErrors,
      dagEdges: state.dag.edges,
      yamlPath: state.yamlPath,
      workDir: state.workDir,
      isDirty: true,
      loading: false,
    });
  };

  const fire = (fn: () => Promise<ServerState>) => {
    fn().then(applyState).catch((e) => console.error('API error:', e));
  };

  return {
    config: { name: 'Loading...', tracks: [] },
    positions: new Map(),
    selectedTaskId: null,
    selectedTrackId: null,
    validationErrors: [],
    dagEdges: [],
    yamlPath: null,
    workDir: '',
    isDirty: false,
    loading: true,

    applyState,

    init: async () => {
      try {
        const state = await api.getState();
        applyState(state);
        set({ isDirty: false });
      } catch (e) {
        console.error('Failed to init:', e);
        set({ loading: false });
      }
    },

    setPipelineName: (name) => fire(() => api.updatePipeline({ name })),
    updatePipelineFields: (fields) => fire(() => api.updatePipeline(fields)),
    addTrack: (name) => fire(() => api.addTrack(generateId(), name)),
    renameTrack: (trackId, name) => fire(() => api.updateTrack(trackId, { name })),
    updateTrackFields: (trackId, fields) => fire(() => api.updateTrack(trackId, fields)),

    deleteTrack: (trackId) => {
      set((s) => {
        const positions = new Map(s.positions);
        for (const key of positions.keys()) {
          if (key.startsWith(trackId + '.')) positions.delete(key);
        }
        return { positions, selectedTaskId: s.selectedTaskId?.startsWith(trackId + '.') ? null : s.selectedTaskId };
      });
      fire(() => api.deleteTrack(trackId));
    },

    moveTrackTo: (trackId, toIndex) => fire(() => api.reorderTrack(trackId, toIndex)),

    addTask: (trackId, name, positionX) => {
      const id = generateId();
      const task: RawTaskConfig = { id, name, prompt: '' };
      if (positionX !== undefined) {
        set((s) => {
          const positions = new Map(s.positions);
          positions.set(`${trackId}.${id}`, { x: positionX });
          return { positions };
        });
      }
      fire(() => api.addTask(trackId, task));
    },

    updateTask: (trackId, taskId, patch) => fire(() => api.updateTask(trackId, taskId, patch)),

    deleteTask: (trackId, taskId) => {
      const qid = `${trackId}.${taskId}`;
      set((s) => ({
        selectedTaskId: s.selectedTaskId === qid ? null : s.selectedTaskId,
        positions: (() => { const p = new Map(s.positions); p.delete(qid); return p; })(),
      }));
      fire(() => api.deleteTask(trackId, taskId));
    },

    transferTaskToTrack: (fromTrackId, taskId, toTrackId) => {
      const qidOld = `${fromTrackId}.${taskId}`;
      const qidNew = `${toTrackId}.${taskId}`;
      set((s) => {
        const positions = new Map(s.positions);
        const pos = positions.get(qidOld);
        if (pos) { positions.delete(qidOld); positions.set(qidNew, pos); }
        return { positions, selectedTaskId: s.selectedTaskId === qidOld ? qidNew : s.selectedTaskId };
      });
      fire(() => api.transferTask(fromTrackId, taskId, toTrackId));
    },

    addDependency: (fromTrackId, fromTaskId, toTrackId, toTaskId) =>
      fire(() => api.addDependency(fromTrackId, fromTaskId, toTrackId, toTaskId)),

    removeDependency: (trackId, taskId, depRef) =>
      fire(() => api.removeDependency(trackId, taskId, depRef)),

    selectTask: (qualifiedId) => set({ selectedTaskId: qualifiedId, selectedTrackId: null }),
    selectTrack: (trackId) => set({ selectedTrackId: trackId, selectedTaskId: null }),

    setTaskPosition: (qualifiedId, x) => {
      set((s) => {
        const positions = new Map(s.positions);
        positions.set(qualifiedId, { x });
        return { positions };
      });
    },

    setWorkDir: (wd) => fire(() => api.setWorkDir(wd)),

    openFile: async (path) => {
      try {
        const state = await api.openFile(path);
        set({ positions: new Map(), selectedTaskId: null, selectedTrackId: null });
        applyState(state);
        set({ isDirty: false });
      } catch (e: any) {
        alert('Failed to open: ' + (e.message ?? e));
      }
    },

    saveFile: async () => {
      try {
        const state = await api.saveFile();
        applyState(state);
        set({ isDirty: false });
      } catch (e: any) {
        alert('Failed to save: ' + (e.message ?? e));
      }
    },

    saveFileAs: async (path) => {
      try {
        const state = await api.saveFileAs(path);
        applyState(state);
        set({ isDirty: false });
      } catch (e: any) {
        alert('Failed to save: ' + (e.message ?? e));
      }
    },

    newPipeline: (name) => {
      set({ positions: new Map(), selectedTaskId: null, selectedTrackId: null });
      fire(() => api.newPipeline(name));
    },

    exportYaml: () => api.exportYaml(),

    importYaml: async (yaml) => {
      try {
        const state = await api.importYaml(yaml);
        set({ positions: new Map(), selectedTaskId: null });
        applyState(state);
        set({ isDirty: false });
      } catch (e: any) {
        alert('Invalid YAML: ' + (e.message ?? e));
      }
    },

    loadDemo: async () => {
      try {
        const state = await api.loadDemo();
        set({ positions: new Map(), selectedTaskId: null });
        applyState(state);
        set({ isDirty: false });
      } catch (e) { console.error('Failed to load demo:', e); }
    },
  };
});

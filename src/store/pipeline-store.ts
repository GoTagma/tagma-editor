import { create } from 'zustand';
import { api } from '../api/client';
import type { ServerState, RawPipelineConfig, RawTaskConfig, ValidationError, DagEdge, PluginRegistry, EditorLayout } from '../api/client';

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
  errorMessage: string | null;
  registry: PluginRegistry;

  applyState: (state: ServerState) => void;
  clearError: () => void;
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
  setRegistry: (registry: PluginRegistry) => void;
  selectTask: (qualifiedId: string | null) => void;
  selectTrack: (trackId: string | null) => void;
  setTaskPosition: (qualifiedId: string, x: number) => void;
  setWorkDir: (workDir: string) => Promise<void>;
  openFile: (path: string) => Promise<void>;
  saveFile: () => Promise<void>;
  saveFileAs: (path: string) => Promise<void>;
  newPipeline: (name?: string) => Promise<void>;
  importFile: (sourcePath: string) => Promise<void>;
  exportFile: (destDir: string) => Promise<string | null>;
  exportYaml: () => Promise<string>;
  importYaml: (yaml: string) => Promise<void>;
  loadDemo: () => Promise<void>;
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

const TRACK_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
];

export const usePipelineStore = create<PipelineState>((set, _get) => {
  const flushLayout = () => {
    const positions = _get().positions;
    const obj: Record<string, { x: number }> = {};
    for (const [k, v] of positions) obj[k] = v;
    api.saveLayout(obj).catch(() => {});
  };

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

  /** Apply server state and restore layout positions from server */
  const applyStateWithLayout = (state: ServerState) => {
    const positions = new Map<string, TaskPosition>();
    if (state.layout?.positions) {
      for (const [k, v] of Object.entries(state.layout.positions)) {
        positions.set(k, v);
      }
    }
    set({
      config: state.config,
      validationErrors: state.validationErrors,
      dagEdges: state.dag.edges,
      yamlPath: state.yamlPath,
      workDir: state.workDir,
      positions,
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
    errorMessage: null,
    registry: { drivers: [], triggers: [], completions: [], middlewares: [] },

    applyState,
    clearError: () => set({ errorMessage: null }),

    init: async () => {
      try {
        const [state, registry] = await Promise.all([
          api.getState(),
          api.getRegistry().catch(() => ({ drivers: [], triggers: [], completions: [], middlewares: [] })),
        ]);
        applyStateWithLayout(state);
        set({ isDirty: false, registry });
      } catch (e) {
        console.error('Failed to init:', e);
        set({ loading: false });
      }
    },

    setPipelineName: (name) => fire(() => api.updatePipeline({ name })),
    updatePipelineFields: (fields) => fire(() => api.updatePipeline(fields)),
    addTrack: (name) => {
      const trackCount = _get().config.tracks.length;
      const color = TRACK_COLORS[trackCount % TRACK_COLORS.length];
      fire(() => api.addTrack(generateId(), name, color));
    },
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

    moveTrackTo: (trackId, toIndex) => {
      // Optimistically reorder tracks locally before API round-trip.
      // ValidationError paths are JSONPath with numeric indices (e.g.
      // "tracks[1].tasks[0].prompt"); if we only reorder config.tracks but
      // leave validationErrors untouched, the index-based attribution in
      // App.tsx will briefly point errors at the wrong tracks, causing
      // warning icons to flash on adjacent rows until the server re-validates.
      // Remap each error's track index through the same permutation so the
      // attribution stays correct within the same render.
      set((s) => {
        const tracks = s.config.tracks;
        const fromIndex = tracks.findIndex((t) => t.id === trackId);
        if (fromIndex < 0 || fromIndex === toIndex) return s;
        const without = tracks.filter((t) => t.id !== trackId);
        const moved = tracks[fromIndex];
        const newTracks = [...without];
        newTracks.splice(Math.min(toIndex, newTracks.length), 0, moved);

        const newIdxById = new Map<string, number>();
        newTracks.forEach((t, i) => newIdxById.set(t.id, i));
        const oldToNew = new Map<number, number>();
        tracks.forEach((t, oldIdx) => {
          const n = newIdxById.get(t.id);
          if (n !== undefined) oldToNew.set(oldIdx, n);
        });

        const validationErrors = s.validationErrors.map((err) => {
          const m = err.path.match(/^tracks\[(\d+)\](.*)$/);
          if (!m) return err;
          const newIdx = oldToNew.get(parseInt(m[1], 10));
          if (newIdx === undefined) return err;
          return { ...err, path: `tracks[${newIdx}]${m[2]}` };
        });

        return { config: { ...s.config, tracks: newTracks }, validationErrors };
      });
      fire(() => api.reorderTrack(trackId, toIndex));
    },

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
      // Optimistically move the task between tracks and remap positions + dag
      // edges so the canvas reflects the new location on the same frame the
      // pointer is released. Without this, config/dagEdges still reference the
      // old qid until the server responds, causing connection lines to snap
      // back to a default grid slot before jumping to the correct position.
      set((s) => {
        let moved: RawTaskConfig | undefined;
        const withoutTask = s.config.tracks.map((t) => {
          if (t.id !== fromTrackId) return t;
          const remaining: RawTaskConfig[] = [];
          for (const k of t.tasks) {
            if (k.id === taskId) moved = k;
            else remaining.push(k);
          }
          return { ...t, tasks: remaining };
        });
        if (!moved) return s;
        const newTracks = withoutTask.map((t) =>
          t.id === toTrackId ? { ...t, tasks: [...t.tasks, moved!] } : t,
        );

        // Rename position key unless the new qid was already set (e.g. by a
        // preceding setTaskPosition call from the drop handler).
        const positions = new Map(s.positions);
        const oldPos = positions.get(qidOld);
        if (!positions.has(qidNew) && oldPos) positions.set(qidNew, oldPos);
        positions.delete(qidOld);

        // Rewrite any dag edge endpoint that pointed at the old qid.
        const dagEdges = s.dagEdges.map((e) => ({
          from: e.from === qidOld ? qidNew : e.from,
          to: e.to === qidOld ? qidNew : e.to,
        }));

        return {
          config: { ...s.config, tracks: newTracks },
          positions,
          dagEdges,
          selectedTaskId: s.selectedTaskId === qidOld ? qidNew : s.selectedTaskId,
          isDirty: true,
        };
      });

      fire(() => api.transferTask(fromTrackId, taskId, toTrackId));
    },

    addDependency: (fromTrackId, fromTaskId, toTrackId, toTaskId) =>
      fire(() => api.addDependency(fromTrackId, fromTaskId, toTrackId, toTaskId)),

    removeDependency: (trackId, taskId, depRef) =>
      fire(() => api.removeDependency(trackId, taskId, depRef)),

    setRegistry: (registry) => set({ registry }),

    selectTask: (qualifiedId) => set({ selectedTaskId: qualifiedId, selectedTrackId: null }),
    selectTrack: (trackId) => set({ selectedTrackId: trackId, selectedTaskId: null }),

    setTaskPosition: (qualifiedId, x) => {
      set((s) => {
        const positions = new Map(s.positions);
        positions.set(qualifiedId, { x });
        return { positions, isDirty: true };
      });
    },

    setWorkDir: async (wd) => {
      try {
        // Auto-save current pipeline before switching workspace
        const current = _get();
        if (current.isDirty && current.yamlPath) {
          await api.saveFile().catch(() => {});
        }
        // Set new workspace, then reset to a blank pipeline via store's newPipeline
        await api.setWorkDir(wd);
        await _get().newPipeline();
      } catch (e: any) {
        set({ errorMessage: 'Failed to set workspace: ' + (e.message ?? e) });
      }
    },

    openFile: async (path) => {
      try {
        const state = await api.openFile(path);
        set({ selectedTaskId: null, selectedTrackId: null });
        applyStateWithLayout(state);
        set({ isDirty: false });
      } catch (e: any) {
        set({ errorMessage: 'Failed to open file: ' + (e.message ?? e) });
      }
    },

    saveFile: async () => {
      try {
        flushLayout();
        const state = await api.saveFile();
        applyState(state);
        set({ isDirty: false });
      } catch (e: any) {
        set({ errorMessage: 'Failed to save: ' + (e.message ?? e) });
      }
    },

    saveFileAs: async (path) => {
      try {
        const state = await api.saveFileAs(path);
        applyState(state);
        set({ isDirty: false });
      } catch (e: any) {
        set({ errorMessage: 'Failed to save: ' + (e.message ?? e) });
      }
    },

    newPipeline: async (name) => {
      try {
        set({ selectedTaskId: null, selectedTrackId: null });
        const state = await api.newPipeline(name);
        applyStateWithLayout(state);
        set({ isDirty: false });
      } catch (e: any) {
        set({ errorMessage: 'Failed to create pipeline: ' + (e.message ?? e) });
      }
    },

    importFile: async (sourcePath) => {
      try {
        const state = await api.importFile(sourcePath);
        set({ selectedTaskId: null, selectedTrackId: null });
        applyStateWithLayout(state);
        set({ isDirty: false });
      } catch (e: any) {
        set({ errorMessage: 'Failed to import file: ' + (e.message ?? e) });
      }
    },

    exportFile: async (destDir) => {
      try {
        const result = await api.exportFile(destDir);
        return result.path;
      } catch (e: any) {
        set({ errorMessage: 'Failed to export: ' + (e.message ?? e) });
        return null;
      }
    },

    exportYaml: () => api.exportYaml(),

    importYaml: async (yaml) => {
      try {
        const state = await api.importYaml(yaml);
        set({ selectedTaskId: null });
        applyStateWithLayout(state);
        set({ isDirty: false });
      } catch (e: any) {
        set({ errorMessage: 'Invalid YAML: ' + (e.message ?? e) });
      }
    },

    loadDemo: async () => {
      try {
        const state = await api.loadDemo();
        set({ selectedTaskId: null });
        applyStateWithLayout(state);
        set({ isDirty: false });
      } catch (e) { console.error('Failed to load demo:', e); }
    },
  };
});

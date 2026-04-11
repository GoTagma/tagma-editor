import { create } from 'zustand';
import { api, RevisionConflictError } from '../api/client';
import type { ServerState, RawPipelineConfig, RawTrackConfig, RawTaskConfig, ValidationError, DagEdge, PluginRegistry } from '../api/client';

/**
 * User-facing toast shown when a mutation is rejected with HTTP 409 because
 * the client's observed revision is stale. The store reconciles by adopting
 * `currentState` from the error payload and surfacing this message so the
 * user knows their edit was dropped and the UI now reflects the latest
 * authoritative server truth. We intentionally do NOT auto-retry the
 * mutation — the new base state may invalidate it.
 */
const REVISION_CONFLICT_MESSAGE =
  'Your change was rejected — another client updated the pipeline first. Reloaded to the latest version; please retry if needed.';

export interface TaskPosition { x: number; }

/**
 * Undo/redo history entry. Captures only config-level state — selection,
 * transient UI and layoutDirty are intentionally excluded because they
 * should not be part of the undo stack (see Group 6 docs).
 */
export interface HistoryEntry {
  config: RawPipelineConfig;
  positions: Map<string, TaskPosition>;
  dagEdges: DagEdge[];
  validationErrors: ValidationError[];
}

/** Maximum entries kept in each history stack before oldest is dropped. */
const HISTORY_LIMIT = 50;

/**
 * Clipboard slot for copy/paste of a task or an entire track.
 * Payload is a deep-clonable plain object that keeps all fields except
 * identity (ids are regenerated on paste).
 */
export type ClipboardSlot =
  | { kind: 'task'; trackId: string; task: RawTaskConfig }
  | { kind: 'track'; track: RawTrackConfig }
  | null;

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
  layoutDirty: boolean;
  loading: boolean;
  errorMessage: string | null;
  registry: PluginRegistry;
  past: HistoryEntry[];
  future: HistoryEntry[];
  clipboard: ClipboardSlot;

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

  // Undo/redo (config-level history only).
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // Clipboard: copy / paste / duplicate selected task or track.
  copySelection: () => boolean;
  pasteClipboard: () => boolean;
  duplicateSelection: () => boolean;
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Extract a human-readable message from any thrown value. Fetch errors from
 * `request()` in api/client.ts are thrown as `new Error(err.error ?? ...)`,
 * so `.message` normally carries the server-reported reason.
 */
function errorToMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object' && 'message' in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  try { return JSON.stringify(e); } catch { return String(e); }
}

const TRACK_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
];

/** Snapshot of mutable slice used for optimistic rollback. */
interface Snapshot {
  config: RawPipelineConfig;
  positions: Map<string, TaskPosition>;
  dagEdges: DagEdge[];
  validationErrors: ValidationError[];
  selectedTaskId: string | null;
  selectedTrackId: string | null;
  isDirty: boolean;
  layoutDirty: boolean;
}

export const usePipelineStore = create<PipelineState>((set, _get) => {
  const takeSnapshot = (): Snapshot => {
    const s = _get();
    return {
      config: s.config,
      positions: new Map(s.positions),
      dagEdges: s.dagEdges,
      validationErrors: s.validationErrors,
      selectedTaskId: s.selectedTaskId,
      selectedTrackId: s.selectedTrackId,
      isDirty: s.isDirty,
      layoutDirty: s.layoutDirty,
    };
  };

  const restoreSnapshot = (snap: Snapshot) => {
    set({
      config: snap.config,
      positions: snap.positions,
      dagEdges: snap.dagEdges,
      validationErrors: snap.validationErrors,
      selectedTaskId: snap.selectedTaskId,
      selectedTrackId: snap.selectedTrackId,
      isDirty: snap.isDirty,
      layoutDirty: snap.layoutDirty,
    });
  };

  /**
   * Flush pending layout positions to the server.
   * Returns a promise that resolves on success and rejects on failure so
   * callers (saveFile) can await the result. On success, clear layoutDirty.
   * On failure, surface the error via errorMessage.
   */
  const flushLayout = async (): Promise<void> => {
    const positions = _get().positions;
    const obj: Record<string, { x: number }> = {};
    for (const [k, v] of positions) obj[k] = v;
    try {
      await api.saveLayout(obj);
      set({ layoutDirty: false });
    } catch (e) {
      if (e instanceof RevisionConflictError) {
        // C6: same reconciliation strategy as fire() — adopt the server's
        // authoritative state, drop history, and surface the conflict toast.
        // We do NOT rethrow here: callers (e.g. saveFile) treat a resolved
        // conflict as a terminal state, not a transient failure to retry.
        applyState(e.currentState);
        set({
          isDirty: false,
          layoutDirty: false,
          past: [],
          future: [],
          errorMessage: REVISION_CONFLICT_MESSAGE,
        });
        return;
      }
      set({ errorMessage: 'Failed to save layout: ' + errorToMessage(e) });
      throw e;
    }
  };

  /**
   * Apply a fresh ServerState from the backend. Only server-derived fields
   * are updated; dirty tracking is owned by the caller (mutation actions set
   * isDirty true before firing, save actions set it false after success).
   */
  const applyState = (state: ServerState) => {
    set({
      config: state.config,
      validationErrors: state.validationErrors,
      dagEdges: state.dag.edges,
      yamlPath: state.yamlPath,
      workDir: state.workDir,
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
      loading: false,
    });
  };

  // Monotonic request counter used to reject out-of-order responses from
  // `fire()`. Rapid edits (rename, drag) can race: if request A is dispatched
  // first but its response arrives *after* request B's, A's stale ServerState
  // would overwrite B's — causing the UI to flicker back to an older value.
  // We stamp each fire() call with its epoch and only apply the response if
  // no newer request was dispatched in the meantime.
  let fireEpoch = 0;

  /** Snapshot → HistoryEntry projection (config-level fields only). */
  const snapshotToHistory = (snap: Snapshot): HistoryEntry => ({
    config: snap.config,
    positions: new Map(snap.positions),
    dagEdges: snap.dagEdges,
    validationErrors: snap.validationErrors,
  });

  /**
   * Push a pre-mutation snapshot onto the undo stack and clear redo.
   * Called only when a mutation CONFIRMS success, so failed/rolled-back
   * operations never leak into history.
   */
  const pushHistory = (entry: HistoryEntry) => {
    set((s) => {
      const past = [...s.past, entry];
      if (past.length > HISTORY_LIMIT) past.shift();
      return { past, future: [] };
    });
  };

  /**
   * Fire a mutation request. On success applies the authoritative ServerState
   * AND pushes the pre-mutation snapshot onto the undo history. On failure
   * surfaces the error into `errorMessage` and optionally restores an
   * optimistic snapshot so local state does not diverge from the server.
   *
   * History invariant: the snapshot pushed onto `past` is the state BEFORE
   * the mutation. Only pushed on success — so rolled-back failures never
   * enter the undo stack.
   */
  const fire = (
    fn: () => Promise<ServerState>,
    opts?: { snapshot?: Snapshot; errorPrefix?: string; skipHistory?: boolean },
  ) => {
    const myEpoch = ++fireEpoch;
    // Capture pre-mutation snapshot for history. Reuse `opts.snapshot` when
    // provided (it's already a pre-mutation snapshot captured by the caller
    // BEFORE any optimistic local edits). Otherwise take one now.
    const preSnapshot: Snapshot = opts?.snapshot ?? takeSnapshot();
    // Every mutation implies a dirty document.
    set({ isDirty: true });
    fn().then(
      (state) => {
        if (myEpoch !== fireEpoch) return; // a newer request superseded us
        applyState(state);
        if (!opts?.skipHistory) pushHistory(snapshotToHistory(preSnapshot));
      },
      (e) => {
        // Still honor epoch ordering for error reporting — if a later request
        // was dispatched after ours, it will apply its own result and we
        // should not clobber that with a stale rollback. The same guard
        // applies to revision-conflict reconciliation below: a newer in-flight
        // request's response (success or conflict) should win over ours.
        if (myEpoch !== fireEpoch) return;

        if (e instanceof RevisionConflictError) {
          // C6: server rejected our mutation because our cached revision was
          // stale. Adopt the authoritative `currentState` returned in the
          // payload — do NOT restore the pre-mutation snapshot, because the
          // server's state is NEWER than our snapshot and is the correct
          // baseline to continue from. A brief UI flicker (optimistic state
          // → reconciled state) is acceptable and documented.
          //
          // We also clear `past`/`future` because the prior undo stack was
          // relative to a now-stale base config; replaying those entries
          // against the new baseline would produce confusing results. This
          // is deliberately aggressive — undo history is per-session UX, not
          // a source of truth, so dropping it on reconciliation is safer
          // than letting a stale stack silently corrupt future edits.
          applyState(e.currentState);
          set({
            isDirty: false,
            layoutDirty: false,
            past: [],
            future: [],
            errorMessage: REVISION_CONFLICT_MESSAGE,
          });
          return;
        }

        if (opts?.snapshot) restoreSnapshot(opts.snapshot);
        const prefix = opts?.errorPrefix ?? 'Operation failed';
        set({ errorMessage: `${prefix}: ${errorToMessage(e)}` });
      },
    );
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
    layoutDirty: false,
    loading: true,
    errorMessage: null,
    registry: { drivers: [], triggers: [], completions: [], middlewares: [] },
    past: [],
    future: [],
    clipboard: null,

    applyState,
    clearError: () => set({ errorMessage: null }),

    init: async () => {
      try {
        const [state, registry] = await Promise.all([
          api.getState(),
          api.getRegistry().catch(() => ({ drivers: [], triggers: [], completions: [], middlewares: [] })),
        ]);
        applyStateWithLayout(state);
        set({ isDirty: false, layoutDirty: false, registry, past: [], future: [] });
      } catch (e) {
        set({ loading: false, errorMessage: 'Failed to initialize: ' + errorToMessage(e) });
      }
    },

    setPipelineName: (name) => fire(() => api.updatePipeline({ name }), { errorPrefix: 'Failed to rename pipeline' }),
    updatePipelineFields: (fields) => fire(() => api.updatePipeline(fields), { errorPrefix: 'Failed to update pipeline' }),
    addTrack: (name) => {
      const trackCount = _get().config.tracks.length;
      const color = TRACK_COLORS[trackCount % TRACK_COLORS.length];
      fire(() => api.addTrack(generateId(), name, color), { errorPrefix: 'Failed to add track' });
    },
    renameTrack: (trackId, name) => fire(() => api.updateTrack(trackId, { name }), { errorPrefix: 'Failed to rename track' }),
    updateTrackFields: (trackId, fields) => fire(() => api.updateTrack(trackId, fields), { errorPrefix: 'Failed to update track' }),

    deleteTrack: (trackId) => {
      const snapshot = takeSnapshot();
      set((s) => {
        const positions = new Map(s.positions);
        for (const key of positions.keys()) {
          if (key.startsWith(trackId + '.')) positions.delete(key);
        }
        return {
          positions,
          selectedTaskId: s.selectedTaskId?.startsWith(trackId + '.') ? null : s.selectedTaskId,
        };
      });

      fire(() => api.deleteTrack(trackId), { snapshot, errorPrefix: 'Failed to delete track' });
    },

    moveTrackTo: (trackId, toIndex) => {
      // Optimistically reorder tracks locally before API round-trip. We used
      // to also remap validationErrors paths via regex, but the server
      // response already contains authoritative validationErrors — just wait
      // for it. A brief single-frame mis-attribution is preferable to a
      // locally-invented path that could drift from the server.
      const snapshot = takeSnapshot();
      set((s) => {
        const tracks = s.config.tracks;
        const fromIndex = tracks.findIndex((t) => t.id === trackId);
        if (fromIndex < 0 || fromIndex === toIndex) return s;
        const without = tracks.filter((t) => t.id !== trackId);
        const moved = tracks[fromIndex];
        const newTracks = [...without];
        newTracks.splice(Math.min(toIndex, newTracks.length), 0, moved);
        return { config: { ...s.config, tracks: newTracks }, layoutDirty: true };
      });
      fire(() => api.reorderTrack(trackId, toIndex), { snapshot, errorPrefix: 'Failed to reorder track' });
    },

    addTask: (trackId, name, positionX) => {
      const id = generateId();
      const task: RawTaskConfig = { id, name, prompt: '' };
      const snapshot = takeSnapshot();
      if (positionX !== undefined) {
        set((s) => {
          const positions = new Map(s.positions);
          positions.set(`${trackId}.${id}`, { x: positionX });
          return { positions, layoutDirty: true };
        });
      }
      fire(() => api.addTask(trackId, task), { snapshot, errorPrefix: 'Failed to add task' });
    },

    updateTask: (trackId, taskId, patch) =>
      fire(() => api.updateTask(trackId, taskId, patch), { errorPrefix: 'Failed to update task' }),

    deleteTask: (trackId, taskId) => {
      const qid = `${trackId}.${taskId}`;
      const snapshot = takeSnapshot();
      set((s) => ({
        selectedTaskId: s.selectedTaskId === qid ? null : s.selectedTaskId,
        positions: (() => { const p = new Map(s.positions); p.delete(qid); return p; })(),
      }));

      fire(() => api.deleteTask(trackId, taskId), { snapshot, errorPrefix: 'Failed to delete task' });
    },

    transferTaskToTrack: (fromTrackId, taskId, toTrackId) => {
      const qidOld = `${fromTrackId}.${taskId}`;
      const qidNew = `${toTrackId}.${taskId}`;
      // Minimal optimistic move: relocate the task to the new track in
      // config and rename its position key. We do NOT recompute dagEdges
      // locally — the server response is authoritative and will replace them
      // on success. A single-frame mismatch (edges still pointing at the old
      // qid) is preferable to a hand-rolled rewrite that could drift.
      const snapshot = takeSnapshot();
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

        return {
          config: { ...s.config, tracks: newTracks },
          positions,
          selectedTaskId: s.selectedTaskId === qidOld ? qidNew : s.selectedTaskId,
          layoutDirty: true,
        };
      });

      fire(
        () => api.transferTask(fromTrackId, taskId, toTrackId),
        { snapshot, errorPrefix: 'Failed to move task' },
      );
    },

    addDependency: (fromTrackId, fromTaskId, toTrackId, toTaskId) =>
      fire(
        () => api.addDependency(fromTrackId, fromTaskId, toTrackId, toTaskId),
        { errorPrefix: 'Failed to add dependency' },
      ),

    removeDependency: (trackId, taskId, depRef) =>
      fire(
        () => api.removeDependency(trackId, taskId, depRef),
        { errorPrefix: 'Failed to remove dependency' },
      ),

    setRegistry: (registry) => set({ registry }),

    selectTask: (qualifiedId) => set({ selectedTaskId: qualifiedId, selectedTrackId: null }),
    selectTrack: (trackId) => set({ selectedTrackId: trackId, selectedTaskId: null }),

    setTaskPosition: (qualifiedId, x) => {
      set((s) => {
        const positions = new Map(s.positions);
        positions.set(qualifiedId, { x });
        return { positions, isDirty: true, layoutDirty: true };
      });
    },

    setWorkDir: async (wd) => {
      try {
        // Auto-save current pipeline before switching workspace.
        // If the save fails we MUST abort the switch — otherwise the
        // follow-up newPipeline() call overwrites the in-memory pipeline
        // and the user silently loses their unsaved work.
        const current = _get();
        if (current.isDirty && current.yamlPath) {
          try {
            await flushLayout();
            await api.saveFile();
          } catch (saveErr) {
            set({
              errorMessage:
                'Cannot switch workspace: failed to save current pipeline — ' +
                errorToMessage(saveErr) +
                '. Save manually or discard changes before switching.',
            });
            return;
          }
        }
        // Set new workspace, then reset to a blank pipeline via store's newPipeline
        await api.setWorkDir(wd);
        await _get().newPipeline();
      } catch (e) {
        set({ errorMessage: 'Failed to set workspace: ' + errorToMessage(e) });
      }
    },

    openFile: async (path) => {
      try {
        const state = await api.openFile(path);
        set({ selectedTaskId: null, selectedTrackId: null });
        applyStateWithLayout(state);
        set({ isDirty: false, layoutDirty: false, past: [], future: [] });
      } catch (e) {
        set({ errorMessage: 'Failed to open file: ' + errorToMessage(e) });
      }
    },

    saveFile: async () => {
      try {
        // Flush layout first so the layout file lands on disk alongside the
        // YAML. Awaiting surfaces any layout error before we commit the save.
        await flushLayout();
        const state = await api.saveFile();
        applyState(state);
        set({ isDirty: false, layoutDirty: false });
      } catch (e) {
        set({ errorMessage: 'Failed to save: ' + errorToMessage(e) });
      }
    },

    saveFileAs: async (path) => {
      try {
        const state = await api.saveFileAs(path);
        applyState(state);
        set({ isDirty: false, layoutDirty: false });
      } catch (e) {
        set({ errorMessage: 'Failed to save: ' + errorToMessage(e) });
      }
    },

    newPipeline: async (name) => {
      try {
        set({ selectedTaskId: null, selectedTrackId: null });
        const state = await api.newPipeline(name);
        applyStateWithLayout(state);
        set({ isDirty: false, layoutDirty: false, past: [], future: [] });
      } catch (e) {
        set({ errorMessage: 'Failed to create pipeline: ' + errorToMessage(e) });
      }
    },

    importFile: async (sourcePath) => {
      try {
        const state = await api.importFile(sourcePath);
        set({ selectedTaskId: null, selectedTrackId: null });
        applyStateWithLayout(state);
        set({ isDirty: false, layoutDirty: false, past: [], future: [] });
      } catch (e) {
        set({ errorMessage: 'Failed to import file: ' + errorToMessage(e) });
      }
    },

    exportFile: async (destDir) => {
      try {
        const result = await api.exportFile(destDir);
        return result.path;
      } catch (e) {
        set({ errorMessage: 'Failed to export: ' + errorToMessage(e) });
        return null;
      }
    },

    exportYaml: () => api.exportYaml(),

    importYaml: async (yaml) => {
      try {
        const state = await api.importYaml(yaml);
        set({ selectedTaskId: null });
        applyStateWithLayout(state);
        set({ isDirty: false, layoutDirty: false, past: [], future: [] });
      } catch (e) {
        set({ errorMessage: 'Invalid YAML: ' + errorToMessage(e) });
      }
    },

    loadDemo: async () => {
      try {
        const state = await api.loadDemo();
        set({ selectedTaskId: null });
        applyStateWithLayout(state);
        set({ isDirty: false, layoutDirty: false, past: [], future: [] });
      } catch (e) {
        set({ errorMessage: 'Failed to load demo: ' + errorToMessage(e) });
      }
    },

    // ---- Undo / Redo ----------------------------------------------------
    // Semantics: local-only restore. We pop the previous snapshot into
    // local state (config, positions, dagEdges, validationErrors) and mark
    // the document dirty so the user can Ctrl+S to persist. We do NOT
    // auto-push to the server because:
    //   (1) the client has no generic "set full config" API — existing
    //       mutation endpoints are per-field/per-entity;
    //   (2) keeping undo local avoids races with in-flight fire() calls.
    // Selection and transient UI state are intentionally untouched.

    canUndo: () => _get().past.length > 0,
    canRedo: () => _get().future.length > 0,

    undo: () => {
      const s = _get();
      if (s.past.length === 0) return;
      const current: HistoryEntry = {
        config: s.config,
        positions: new Map(s.positions),
        dagEdges: s.dagEdges,
        validationErrors: s.validationErrors,
      };
      const prev = s.past[s.past.length - 1];
      set({
        config: prev.config,
        positions: new Map(prev.positions),
        dagEdges: prev.dagEdges,
        validationErrors: prev.validationErrors,
        past: s.past.slice(0, -1),
        future: [...s.future, current],
        isDirty: true,
        layoutDirty: true,
      });
    },

    redo: () => {
      const s = _get();
      if (s.future.length === 0) return;
      const current: HistoryEntry = {
        config: s.config,
        positions: new Map(s.positions),
        dagEdges: s.dagEdges,
        validationErrors: s.validationErrors,
      };
      const next = s.future[s.future.length - 1];
      set({
        config: next.config,
        positions: new Map(next.positions),
        dagEdges: next.dagEdges,
        validationErrors: next.validationErrors,
        past: [...s.past, current],
        future: s.future.slice(0, -1),
        isDirty: true,
        layoutDirty: true,
      });
    },

    // ---- Clipboard ------------------------------------------------------
    // Copy/paste/duplicate operate on the current selection. Paste creates
    // new ids so clones are independent. Paste routes through the normal
    // mutation path (fire() → api.addTask / addTrack), so clones
    // participate in undo history automatically.

    copySelection: () => {
      const s = _get();
      if (s.selectedTaskId) {
        const [trackId, taskId] = s.selectedTaskId.split('.');
        const track = s.config.tracks.find((t) => t.id === trackId);
        const task = track?.tasks.find((t) => t.id === taskId);
        if (!task) return false;
        set({ clipboard: { kind: 'task', trackId, task: { ...task } } });
        return true;
      }
      if (s.selectedTrackId) {
        const track = s.config.tracks.find((t) => t.id === s.selectedTrackId);
        if (!track) return false;
        set({ clipboard: { kind: 'track', track: { ...track, tasks: track.tasks.map((t) => ({ ...t })) } } });
        return true;
      }
      return false;
    },

    pasteClipboard: () => {
      const s = _get();
      const clip = s.clipboard;
      if (!clip) return false;
      if (clip.kind === 'task') {
        // Target track: selected track, else selected task's track, else
        // the clipboard's original track, else the first track.
        let targetTrackId = clip.trackId;
        if (s.selectedTrackId) targetTrackId = s.selectedTrackId;
        else if (s.selectedTaskId) targetTrackId = s.selectedTaskId.split('.')[0];
        if (!s.config.tracks.some((t) => t.id === targetTrackId)) {
          targetTrackId = s.config.tracks[0]?.id ?? '';
        }
        if (!targetTrackId) return false;
        const cloned: RawTaskConfig = {
          ...clip.task,
          id: generateId(),
          name: clip.task.name ? `${clip.task.name} (copy)` : undefined,
          // Strip dependencies: referenced ids may not resolve in the new
          // location and would fail server-side validation.
          depends_on: undefined,
        };
        fire(() => api.addTask(targetTrackId, cloned), { errorPrefix: 'Failed to paste task' });
        return true;
      }
      if (clip.kind === 'track') {
        // Server exposes addTrack(id, name, color) + per-task addTask, so
        // clone the track and replay tasks sequentially. History records
        // the initial addTrack entry; subsequent task adds extend it.
        const newTrackId = generateId();
        const newName = `${clip.track.name} (copy)`;
        const tasksToClone: RawTaskConfig[] = clip.track.tasks.map((t) => ({
          ...t,
          id: generateId(),
          depends_on: undefined,
        }));
        const preSnapshot = takeSnapshot();
        set({ isDirty: true });
        api.addTrack(newTrackId, newName, clip.track.color)
          .then(async (state) => {
            applyState(state);
            for (const task of tasksToClone) {
              try {
                const next = await api.addTask(newTrackId, task);
                applyState(next);
              } catch (e) {
                set({ errorMessage: 'Failed to paste task in cloned track: ' + errorToMessage(e) });
                return;
              }
            }
            pushHistory(snapshotToHistory(preSnapshot));
          })
          .catch((e) => {
            set({ errorMessage: 'Failed to paste track: ' + errorToMessage(e) });
          });
        return true;
      }
      return false;
    },

    duplicateSelection: () => {
      // Ctrl+D = copy + paste in place, without disturbing the clipboard.
      const s = _get();
      if (s.selectedTaskId) {
        const [trackId, taskId] = s.selectedTaskId.split('.');
        const track = s.config.tracks.find((t) => t.id === trackId);
        const task = track?.tasks.find((t) => t.id === taskId);
        if (!task) return false;
        const cloned: RawTaskConfig = {
          ...task,
          id: generateId(),
          name: task.name ? `${task.name} (copy)` : undefined,
          depends_on: undefined,
        };
        fire(() => api.addTask(trackId, cloned), { errorPrefix: 'Failed to duplicate task' });
        return true;
      }
      if (s.selectedTrackId) {
        const track = s.config.tracks.find((t) => t.id === s.selectedTrackId);
        if (!track) return false;
        const prevClip = s.clipboard;
        set({ clipboard: { kind: 'track', track: { ...track, tasks: track.tasks.map((t) => ({ ...t })) } } });
        const result = _get().pasteClipboard();
        set({ clipboard: prevClip });
        return result;
      }
      return false;
    },
  };
});

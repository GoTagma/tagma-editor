import { create } from 'zustand';
import { api } from '../api/client';
import type {
  RunTaskState,
  RunEvent,
  RawPipelineConfig,
  ApprovalRequestInfo,
  ApprovalOutcome,
} from '../api/client';
import { foldRunEvent, type RunFoldState } from './run-event-reducer';

interface RunStoreState extends RunFoldState {
  active: boolean;
  selectedTaskId: string | null;
  selectedTrackId: string | null;
  snapshot: RawPipelineConfig | null;

  startRun: (config: RawPipelineConfig) => Promise<void>;
  abortRun: () => Promise<void>;
  selectTask: (taskId: string | null) => void;
  selectTrack: (trackId: string | null) => void;
  resolveApproval: (requestId: string, outcome: ApprovalOutcome, choice?: string) => Promise<void>;
  reset: () => void;
}

function pickFoldState(s: RunStoreState): RunFoldState {
  return {
    runId: s.runId,
    status: s.status,
    tasks: s.tasks,
    logs: s.logs,
    error: s.error,
    pendingApprovals: s.pendingApprovals,
    lastEventSeq: s.lastEventSeq,
  };
}

export const useRunStore = create<RunStoreState>((set, get) => {
  let unsubscribe: (() => void) | null = null;

  function handleEvent(event: RunEvent) {
    const current = pickFoldState(get());
    const next = foldRunEvent(current, event);
    // foldRunEvent returns the same reference when the event is a no-op
    // (dropped by seq dedupe / runId mismatch) — skip the zustand set
    // call in that case to avoid a spurious re-render.
    if (next !== current) {
      set(next);
    }
  }

  return {
    active: false,
    runId: null,
    status: 'idle',
    tasks: new Map<string, RunTaskState>(),
    logs: [],
    error: null,
    selectedTaskId: null,
    selectedTrackId: null,
    snapshot: null,
    pendingApprovals: new Map<string, ApprovalRequestInfo>(),
    lastEventSeq: 0,

    startRun: async (config) => {
      set({
        active: true,
        status: 'starting',
        tasks: new Map(),
        logs: [],
        error: null,
        selectedTaskId: null,
        selectedTrackId: null,
        snapshot: config,
        pendingApprovals: new Map(),
        lastEventSeq: 0,
      });
      // Subscribe to SSE events before starting
      unsubscribe = api.subscribeRunEvents(handleEvent);
      try {
        await api.startRun();
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Failed to start run';
        set({ status: 'error', error: message });
      }
    },

    abortRun: async () => {
      try {
        await api.abortRun();
      } catch {
        // Intentionally swallow — abort is best-effort; state is finalized below.
      }
      set({ status: 'aborted' });
    },

    selectTask: (taskId) => set({ selectedTaskId: taskId, selectedTrackId: null }),

    selectTrack: (trackId) => set({ selectedTrackId: trackId, selectedTaskId: null }),

    resolveApproval: async (requestId, outcome, choice) => {
      // Optimistically remove from queue; if the server fails we can
      // surface the error but keep UX snappy.
      const state = get();
      const pending = new Map(state.pendingApprovals);
      pending.delete(requestId);
      set({ pendingApprovals: pending });
      try {
        await api.resolveApproval(requestId, outcome, choice);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Failed to resolve approval';
        set({ error: message });
      }
    },

    reset: () => {
      if (unsubscribe) { unsubscribe(); unsubscribe = null; }
      set({
        active: false,
        runId: null,
        status: 'idle',
        tasks: new Map(),
        logs: [],
        error: null,
        selectedTaskId: null,
        selectedTrackId: null,
        snapshot: null,
        pendingApprovals: new Map(),
        lastEventSeq: 0,
      });
    },
  };
});

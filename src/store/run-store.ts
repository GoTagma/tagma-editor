import { create } from 'zustand';
import { api } from '../api/client';
import type {
  RunTaskState,
  RunEvent,
  RawPipelineConfig,
  ApprovalRequestInfo,
  ApprovalOutcome,
} from '../api/client';

interface RunStoreState {
  active: boolean;
  runId: string | null;
  status: 'idle' | 'starting' | 'running' | 'done' | 'aborted' | 'error';
  tasks: Map<string, RunTaskState>;
  logs: string[];
  error: string | null;
  selectedTaskId: string | null;
  snapshot: RawPipelineConfig | null;
  // Approvals (F3) — requests keyed by requestId, plus a queue for UI display.
  pendingApprovals: Map<string, ApprovalRequestInfo>;

  startRun: (config: RawPipelineConfig) => Promise<void>;
  abortRun: () => Promise<void>;
  selectTask: (taskId: string | null) => void;
  resolveApproval: (requestId: string, outcome: ApprovalOutcome, choice?: string) => Promise<void>;
  reset: () => void;
}

export const useRunStore = create<RunStoreState>((set, get) => {
  let unsubscribe: (() => void) | null = null;

  function handleEvent(event: RunEvent) {
    const state = get();

    // run_start always creates/resets the active run context.
    if (event.type === 'run_start') {
      const tasks = new Map<string, RunTaskState>();
      for (const t of event.tasks) tasks.set(t.taskId, t);
      set({
        runId: event.runId,
        status: 'running',
        tasks,
        error: null,
        pendingApprovals: new Map(),
      });
      return;
    }

    // C7: drop any event whose runId doesn't match the active run.
    // Events without a runId (legacy / defensive) are accepted to avoid
    // regressions if the server hasn't been upgraded.
    const eventRunId = (event as { runId?: string }).runId;
    if (eventRunId && state.runId && eventRunId !== state.runId) {
      return;
    }

    switch (event.type) {
      case 'task_update': {
        const tasks = new Map(state.tasks);
        const existing = tasks.get(event.taskId);
        if (existing) {
          tasks.set(event.taskId, {
            ...existing,
            status: event.status,
            startedAt: event.startedAt ?? existing.startedAt,
            finishedAt: event.finishedAt ?? existing.finishedAt,
            durationMs: event.durationMs ?? existing.durationMs,
            exitCode: event.exitCode ?? existing.exitCode,
            stdout: event.stdout ?? existing.stdout,
            stderr: event.stderr ?? existing.stderr,
          });
        }
        set({ tasks });
        break;
      }
      case 'run_end':
        set({ status: event.success ? 'done' : 'aborted' });
        break;
      case 'run_error':
        set({ status: 'error', error: event.error });
        break;
      case 'log':
        set({ logs: [...state.logs, event.line] });
        break;
      case 'approval_request': {
        const pending = new Map(state.pendingApprovals);
        pending.set(event.request.id, event.request);
        set({ pendingApprovals: pending });
        break;
      }
      case 'approval_resolved': {
        const pending = new Map(state.pendingApprovals);
        pending.delete(event.requestId);
        set({ pendingApprovals: pending });
        break;
      }
    }
  }

  return {
    active: false,
    runId: null,
    status: 'idle',
    tasks: new Map(),
    logs: [],
    error: null,
    selectedTaskId: null,
    snapshot: null,
    pendingApprovals: new Map(),

    startRun: async (config) => {
      set({
        active: true,
        status: 'starting',
        tasks: new Map(),
        logs: [],
        error: null,
        selectedTaskId: null,
        snapshot: config,
        pendingApprovals: new Map(),
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

    selectTask: (taskId) => set({ selectedTaskId: taskId }),

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
        snapshot: null,
        pendingApprovals: new Map(),
      });
    },
  };
});

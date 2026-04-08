import { create } from 'zustand';
import { api } from '../api/client';
import type { RunTaskState, TaskStatus, RunEvent, RawPipelineConfig } from '../api/client';

interface RunStoreState {
  active: boolean;
  runId: string | null;
  status: 'idle' | 'starting' | 'running' | 'done' | 'aborted' | 'error';
  tasks: Map<string, RunTaskState>;
  logs: string[];
  error: string | null;
  selectedTaskId: string | null;
  snapshot: RawPipelineConfig | null;

  startRun: (config: RawPipelineConfig) => Promise<void>;
  abortRun: () => Promise<void>;
  selectTask: (taskId: string | null) => void;
  reset: () => void;
}

export const useRunStore = create<RunStoreState>((set, get) => {
  let unsubscribe: (() => void) | null = null;

  function handleEvent(event: RunEvent) {
    const state = get();
    switch (event.type) {
      case 'run_start': {
        const tasks = new Map<string, RunTaskState>();
        for (const t of event.tasks) tasks.set(t.taskId, t);
        set({ runId: event.runId, status: 'running', tasks, error: null });
        break;
      }
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

    startRun: async (config) => {
      set({ active: true, status: 'starting', tasks: new Map(), logs: [], error: null, selectedTaskId: null, snapshot: config });
      // Subscribe to SSE events before starting
      unsubscribe = api.subscribeRunEvents(handleEvent);
      try {
        await api.startRun();
      } catch (e: any) {
        set({ status: 'error', error: e.message ?? 'Failed to start run' });
      }
    },

    abortRun: async () => {
      try {
        await api.abortRun();
      } catch {}
      set({ status: 'aborted' });
    },

    selectTask: (taskId) => set({ selectedTaskId: taskId }),

    reset: () => {
      if (unsubscribe) { unsubscribe(); unsubscribe = null; }
      set({
        active: false, runId: null, status: 'idle',
        tasks: new Map(), logs: [], error: null,
        selectedTaskId: null, snapshot: null,
      });
    },
  };
});

// Pure reducer for the run-store event stream.
//
// Extracted from run-store.ts so the fold logic can be exercised in
// unit tests without zustand / React / network dependencies. The store
// itself just wraps this in a zustand set/get loop.

import type {
  RunEvent,
  RunTaskState,
  ApprovalRequestInfo,
} from '../api/client';

export type RunStatus = 'idle' | 'starting' | 'running' | 'done' | 'aborted' | 'error';

export interface RunFoldState {
  runId: string | null;
  status: RunStatus;
  tasks: Map<string, RunTaskState>;
  logs: string[];
  error: string | null;
  pendingApprovals: Map<string, ApprovalRequestInfo>;
  lastEventSeq: number;
}

export function initialRunFoldState(): RunFoldState {
  return {
    runId: null,
    status: 'idle',
    tasks: new Map(),
    logs: [],
    error: null,
    pendingApprovals: new Map(),
    lastEventSeq: 0,
  };
}

/**
 * Fold a single RunEvent into a RunFoldState. Pure — never mutates
 * the input state. Returns either a new state or the same reference
 * when the event is a no-op (dropped by seq dedupe / runId mismatch).
 *
 * Contracts enforced here:
 *   - run_start always resets tasks and lastEventSeq
 *   - Events whose runId mismatches the active run are dropped
 *   - Events with seq <= lastEventSeq are dropped as replays
 *   - task_update merges partial fields onto the existing task state
 *     using `??` semantics so unset fields preserve their last value
 *   - approval_resolved with outcome=timeout|aborted surfaces an error
 *     banner so the user knows an approval silently expired
 */
export function foldRunEvent(state: RunFoldState, event: RunEvent): RunFoldState {
  // run_start always creates/resets the active run context.
  if (event.type === 'run_start') {
    const tasks = new Map<string, RunTaskState>();
    for (const t of event.tasks) tasks.set(t.taskId, t);
    return {
      ...state,
      runId: event.runId,
      status: 'running',
      tasks,
      error: null,
      pendingApprovals: new Map(),
      lastEventSeq: typeof event.seq === 'number' ? event.seq : 0,
    };
  }

  // C7: drop any event whose runId doesn't match the active run.
  const eventRunId = (event as { runId?: string }).runId;
  if (eventRunId && state.runId && eventRunId !== state.runId) {
    return state;
  }

  // §1.3 / §4.5: dedupe on `seq`. On SSE reconnect the server replays
  // every event after Last-Event-ID; we drop any whose seq is already
  // folded in.
  if (typeof event.seq === 'number' && event.seq <= state.lastEventSeq) {
    return state;
  }

  let next: RunFoldState = state;

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
          outputPath: event.outputPath ?? existing.outputPath,
          stderrPath: event.stderrPath ?? existing.stderrPath,
          sessionId: event.sessionId ?? existing.sessionId,
          normalizedOutput: event.normalizedOutput ?? existing.normalizedOutput,
          resolvedDriver: event.resolvedDriver ?? existing.resolvedDriver,
          resolvedModelTier: event.resolvedModelTier ?? existing.resolvedModelTier,
          resolvedPermissions: event.resolvedPermissions ?? existing.resolvedPermissions,
        });
      }
      next = { ...state, tasks };
      break;
    }
    case 'run_end':
      next = { ...state, status: event.success ? 'done' : 'aborted' };
      break;
    case 'run_error':
      next = { ...state, status: 'error', error: event.error };
      break;
    case 'log':
      next = { ...state, logs: [...state.logs, event.line] };
      break;
    case 'approval_request': {
      const pending = new Map(state.pendingApprovals);
      pending.set(event.request.id, event.request);
      next = { ...state, pendingApprovals: pending };
      break;
    }
    case 'approval_resolved': {
      const pending = new Map(state.pendingApprovals);
      const wasPending = pending.has(event.requestId);
      pending.delete(event.requestId);
      let error = state.error;
      if (wasPending && (event.outcome === 'timeout' || event.outcome === 'aborted')) {
        error = event.outcome === 'timeout'
          ? `Approval timed out (${event.requestId})`
          : `Approval aborted (${event.requestId})`;
      }
      next = { ...state, pendingApprovals: pending, error };
      break;
    }
  }

  // Advance the high-water mark so future duplicate replays of this
  // event (from SSE reconnect) are dropped.
  if (typeof event.seq === 'number' && event.seq > next.lastEventSeq) {
    next = { ...next, lastEventSeq: event.seq };
  }

  return next;
}

// Unit tests for the pure run event reducer. Covers the key behaviors
// called out in the Run parity audit:
//
//   §1.3 / §4.5  SSE seq dedupe on reconnect
//   §5.5         approval_resolved timeout / aborted surfacing
//   §1.1 / §2.2  task_update carries stdout/stderr/outputPath/etc
//   C7           runId mismatch dropped
//
// Run with:
//   bun test tests/run-event-reducer.test.ts
// (or `bun test` to run the whole suite).

import { test, expect } from 'bun:test';

import {
  foldRunEvent,
  initialRunFoldState,
  type RunFoldState,
} from '../src/store/run-event-reducer';
import type {
  RunEvent,
  RunTaskState,
  ApprovalRequestInfo,
} from '../src/api/client';

function makeTask(overrides: Partial<RunTaskState> = {}): RunTaskState {
  return {
    taskId: 'track_a.task_1',
    trackId: 'track_a',
    taskName: 'First task',
    status: 'waiting',
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    exitCode: null,
    stdout: '',
    stderr: '',
    outputPath: null,
    stderrPath: null,
    sessionId: null,
    normalizedOutput: null,
    resolvedDriver: null,
    resolvedModelTier: null,
    resolvedPermissions: null,
    ...overrides,
  };
}

function runStart(seq = 1, tasks: RunTaskState[] = [makeTask()]): RunEvent {
  return { type: 'run_start', runId: 'run_test', tasks, seq };
}

test('run_start resets tasks and populates lastEventSeq', () => {
  const state = initialRunFoldState();
  const next = foldRunEvent(state, runStart(1, [makeTask({ taskId: 'a.1' }), makeTask({ taskId: 'a.2' })]));

  expect(next.runId).toBe('run_test');
  expect(next.status).toBe('running');
  expect(next.tasks.size).toBe(2);
  expect(next.tasks.has('a.1')).toBe(true);
  expect(next.tasks.has('a.2')).toBe(true);
  expect(next.lastEventSeq).toBe(1);
  expect(next.error).toBeNull();
});

test('task_update merges partial fields and preserves untouched values', () => {
  let state = foldRunEvent(initialRunFoldState(), runStart(1));
  state = foldRunEvent(state, {
    type: 'task_update',
    runId: 'run_test',
    taskId: 'track_a.task_1',
    status: 'running',
    startedAt: '2026-04-11T10:00:00.000Z',
    seq: 2,
  });

  const t1 = state.tasks.get('track_a.task_1');
  expect(t1).toBeDefined();
  expect(t1!.status).toBe('running');
  expect(t1!.startedAt).toBe('2026-04-11T10:00:00.000Z');
  expect(t1!.stdout).toBe('');
  expect(t1!.finishedAt).toBeNull();

  // Second update completes the task with stdout + exit + resolved driver
  state = foldRunEvent(state, {
    type: 'task_update',
    runId: 'run_test',
    taskId: 'track_a.task_1',
    status: 'success',
    finishedAt: '2026-04-11T10:00:05.000Z',
    durationMs: 5000,
    exitCode: 0,
    stdout: 'hello world',
    outputPath: '/tmp/out.txt',
    sessionId: 'sess_abc',
    resolvedDriver: 'claude-code',
    resolvedModelTier: 'high',
    resolvedPermissions: { read: true, write: true, execute: false },
    seq: 3,
  });

  const t2 = state.tasks.get('track_a.task_1');
  expect(t2).toBeDefined();
  expect(t2!.status).toBe('success');
  // Started-at is preserved from the earlier update.
  expect(t2!.startedAt).toBe('2026-04-11T10:00:00.000Z');
  expect(t2!.finishedAt).toBe('2026-04-11T10:00:05.000Z');
  expect(t2!.durationMs).toBe(5000);
  expect(t2!.exitCode).toBe(0);
  expect(t2!.stdout).toBe('hello world');
  expect(t2!.outputPath).toBe('/tmp/out.txt');
  expect(t2!.sessionId).toBe('sess_abc');
  expect(t2!.resolvedDriver).toBe('claude-code');
  expect(t2!.resolvedModelTier).toBe('high');
  expect(t2!.resolvedPermissions).toEqual({ read: true, write: true, execute: false });
  expect(state.lastEventSeq).toBe(3);
});

test('SSE reconnect replay with seq dedupe: duplicates are dropped', () => {
  let state = foldRunEvent(initialRunFoldState(), runStart(1));
  // First update
  const ev2: RunEvent = {
    type: 'task_update',
    runId: 'run_test',
    taskId: 'track_a.task_1',
    status: 'running',
    seq: 2,
  };
  state = foldRunEvent(state, ev2);
  expect(state.tasks.get('track_a.task_1')!.status).toBe('running');
  expect(state.lastEventSeq).toBe(2);

  // Simulated reconnect replay: server replays seq 1 and 2 again.
  const replayedStart = foldRunEvent(state, runStart(1));
  // run_start ALWAYS resets (it's the contract). So it rebuilds tasks.
  // After run_start the lastEventSeq resets to the start's seq (1).
  expect(replayedStart.lastEventSeq).toBe(1);

  // But for a non-start event with the same seq, dedupe should kick in.
  // seq <= lastEventSeq should be dropped (no-op) — same reference returned.
  const replayedEv2 = foldRunEvent(state, ev2);
  expect(replayedEv2).toBe(state);

  // New event with higher seq goes through.
  const ev3: RunEvent = {
    type: 'task_update',
    runId: 'run_test',
    taskId: 'track_a.task_1',
    status: 'success',
    finishedAt: '2026-04-11T10:00:10.000Z',
    durationMs: 10000,
    exitCode: 0,
    seq: 3,
  };
  const after3 = foldRunEvent(state, ev3);
  expect(after3).not.toBe(state);
  expect(after3.tasks.get('track_a.task_1')!.status).toBe('success');
  expect(after3.lastEventSeq).toBe(3);
});

test('events whose runId mismatches the active run are dropped', () => {
  const state = foldRunEvent(initialRunFoldState(), runStart(1));
  const wrongRun: RunEvent = {
    type: 'task_update',
    runId: 'run_OTHER',
    taskId: 'track_a.task_1',
    status: 'success',
    seq: 2,
  };
  const next = foldRunEvent(state, wrongRun);
  // Same reference → no-op
  expect(next).toBe(state);
});

test('approval_request adds to pending map', () => {
  let state = foldRunEvent(initialRunFoldState(), runStart(1));
  const req: ApprovalRequestInfo = {
    id: 'req_1',
    taskId: 'track_a.task_1',
    trackId: 'track_a',
    message: 'Proceed?',
    options: ['yes', 'no'],
    createdAt: '2026-04-11T10:00:01.000Z',
    timeoutMs: 60000,
  };
  state = foldRunEvent(state, { type: 'approval_request', runId: 'run_test', request: req, seq: 2 });
  expect(state.pendingApprovals.size).toBe(1);
  expect(state.pendingApprovals.has('req_1')).toBe(true);
});

test('approval_resolved with timeout surfaces an error banner', () => {
  let state = foldRunEvent(initialRunFoldState(), runStart(1));
  const req: ApprovalRequestInfo = {
    id: 'req_1',
    taskId: 'track_a.task_1',
    message: 'Proceed?',
    options: ['yes', 'no'],
    createdAt: '2026-04-11T10:00:01.000Z',
    timeoutMs: 60000,
  };
  state = foldRunEvent(state, { type: 'approval_request', runId: 'run_test', request: req, seq: 2 });
  state = foldRunEvent(state, {
    type: 'approval_resolved',
    runId: 'run_test',
    requestId: 'req_1',
    outcome: 'timeout',
    seq: 3,
  });
  expect(state.pendingApprovals.size).toBe(0);
  expect(state.error ?? '').toMatch(/timed out/i);
});

test('approval_resolved with approved does NOT set an error banner', () => {
  let state = foldRunEvent(initialRunFoldState(), runStart(1));
  const req: ApprovalRequestInfo = {
    id: 'req_1',
    taskId: 'track_a.task_1',
    message: 'Proceed?',
    options: ['yes', 'no'],
    createdAt: '2026-04-11T10:00:01.000Z',
    timeoutMs: 60000,
  };
  state = foldRunEvent(state, { type: 'approval_request', runId: 'run_test', request: req, seq: 2 });
  state = foldRunEvent(state, {
    type: 'approval_resolved',
    runId: 'run_test',
    requestId: 'req_1',
    outcome: 'approved',
    choice: 'yes',
    seq: 3,
  });
  expect(state.pendingApprovals.size).toBe(0);
  expect(state.error).toBeNull();
});

test('run_end success flips status to done', () => {
  let state = foldRunEvent(initialRunFoldState(), runStart(1));
  state = foldRunEvent(state, { type: 'run_end', runId: 'run_test', success: true, seq: 2 });
  expect(state.status).toBe('done');
});

test('run_end failure flips status to aborted', () => {
  let state = foldRunEvent(initialRunFoldState(), runStart(1));
  state = foldRunEvent(state, { type: 'run_end', runId: 'run_test', success: false, seq: 2 });
  expect(state.status).toBe('aborted');
});

test('run_error sets status=error and surfaces the message', () => {
  let state = foldRunEvent(initialRunFoldState(), runStart(1));
  state = foldRunEvent(state, { type: 'run_error', runId: 'run_test', error: 'engine boom', seq: 2 });
  expect(state.status).toBe('error');
  expect(state.error).toBe('engine boom');
});

test('events without seq never advance lastEventSeq', () => {
  let state = foldRunEvent(initialRunFoldState(), runStart(1));
  state = foldRunEvent(state, {
    type: 'task_update',
    runId: 'run_test',
    taskId: 'track_a.task_1',
    status: 'running',
  });
  // lastEventSeq preserved because event had no seq
  expect(state.lastEventSeq).toBe(1);
  expect(state.tasks.get('track_a.task_1')!.status).toBe('running');
});

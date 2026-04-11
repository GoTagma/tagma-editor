// Unit tests for the pure run event reducer. Covers the key behaviors
// called out in the Run parity audit:
//
//   §1.3 / §4.5  SSE seq dedupe on reconnect
//   §5.5         approval_resolved timeout / aborted surfacing
//   §1.1 / §2.2  task_update carries stdout/stderr/outputPath/etc
//   C7           runId mismatch dropped
//
// Run with:
//   node --import tsx --test tests/run-event-reducer.test.ts
// (or `npm test` once a test script is wired in package.json).

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

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

  assert.equal(next.runId, 'run_test');
  assert.equal(next.status, 'running');
  assert.equal(next.tasks.size, 2);
  assert.ok(next.tasks.has('a.1'));
  assert.ok(next.tasks.has('a.2'));
  assert.equal(next.lastEventSeq, 1);
  assert.equal(next.error, null);
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
  assert.ok(t1);
  assert.equal(t1!.status, 'running');
  assert.equal(t1!.startedAt, '2026-04-11T10:00:00.000Z');
  assert.equal(t1!.stdout, '');
  assert.equal(t1!.finishedAt, null);

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
  assert.ok(t2);
  assert.equal(t2!.status, 'success');
  // Started-at is preserved from the earlier update.
  assert.equal(t2!.startedAt, '2026-04-11T10:00:00.000Z');
  assert.equal(t2!.finishedAt, '2026-04-11T10:00:05.000Z');
  assert.equal(t2!.durationMs, 5000);
  assert.equal(t2!.exitCode, 0);
  assert.equal(t2!.stdout, 'hello world');
  assert.equal(t2!.outputPath, '/tmp/out.txt');
  assert.equal(t2!.sessionId, 'sess_abc');
  assert.equal(t2!.resolvedDriver, 'claude-code');
  assert.equal(t2!.resolvedModelTier, 'high');
  assert.deepEqual(t2!.resolvedPermissions, { read: true, write: true, execute: false });
  assert.equal(state.lastEventSeq, 3);
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
  assert.equal(state.tasks.get('track_a.task_1')!.status, 'running');
  assert.equal(state.lastEventSeq, 2);

  // Simulated reconnect replay: server replays seq 1 and 2 again.
  const replayedStart = foldRunEvent(state, runStart(1));
  // run_start ALWAYS resets (it's the contract). So it rebuilds tasks.
  // After run_start the lastEventSeq resets to the start's seq (1).
  assert.equal(replayedStart.lastEventSeq, 1);

  // But for a non-start event with the same seq, dedupe should kick in.
  const replayedEv2 = foldRunEvent(state, ev2);
  assert.equal(replayedEv2, state, 'seq <= lastEventSeq should be dropped (no-op)');

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
  assert.notEqual(after3, state);
  assert.equal(after3.tasks.get('track_a.task_1')!.status, 'success');
  assert.equal(after3.lastEventSeq, 3);
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
  assert.equal(next, state);
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
  assert.equal(state.pendingApprovals.size, 1);
  assert.ok(state.pendingApprovals.has('req_1'));
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
  assert.equal(state.pendingApprovals.size, 0);
  assert.match(state.error ?? '', /timed out/i);
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
  assert.equal(state.pendingApprovals.size, 0);
  assert.equal(state.error, null);
});

test('run_end success flips status to done', () => {
  let state = foldRunEvent(initialRunFoldState(), runStart(1));
  state = foldRunEvent(state, { type: 'run_end', runId: 'run_test', success: true, seq: 2 });
  assert.equal(state.status, 'done');
});

test('run_end failure flips status to aborted', () => {
  let state = foldRunEvent(initialRunFoldState(), runStart(1));
  state = foldRunEvent(state, { type: 'run_end', runId: 'run_test', success: false, seq: 2 });
  assert.equal(state.status, 'aborted');
});

test('run_error sets status=error and surfaces the message', () => {
  let state = foldRunEvent(initialRunFoldState(), runStart(1));
  state = foldRunEvent(state, { type: 'run_error', runId: 'run_test', error: 'engine boom', seq: 2 });
  assert.equal(state.status, 'error');
  assert.equal(state.error, 'engine boom');
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
  assert.equal(state.lastEventSeq, 1);
  assert.equal(state.tasks.get('track_a.task_1')!.status, 'running');
});

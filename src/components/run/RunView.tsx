// RunView — read-only mirror of the editor board scoped to a running
// pipeline. It reuses TaskCard, TrackLane, Minimap, ZoomControls and
// TaskConfigPanel with readOnly props so the Run screen stays visually
// consistent with the editor.

import { useMemo, useCallback, useState, useEffect } from 'react';
import { ArrowLeft, Square, Loader2, Check, X, LayoutGrid, Settings, Search, Package } from 'lucide-react';
import { useRunStore } from '../../store/run-store';
import { TaskCard } from '../board/TaskCard';
import { TrackLane } from '../board/TrackLane';
import { Minimap } from '../board/Minimap';
import { ZoomControls } from '../board/ZoomControls';
import { RunTaskPanel } from './RunTaskPanel';
import { TrackInfoPanel } from './TrackInfoPanel';
import { RunPluginsPanel } from './RunPluginsPanel';
import { ApprovalDialog } from './ApprovalDialog';
import { RunHistoryBrowser } from './RunHistoryBrowser';
import { PipelineConfigPanel } from '../panels/PipelineConfigPanel';
import type { RawPipelineConfig, DagEdge, TaskStatus, RunTaskState } from '../../api/client';
import type { TaskPosition } from '../../store/pipeline-store';
import {
  HEADER_W,
  TASK_W,
  TASK_H,
  TASK_GAP,
  PAD_LEFT,
  TRACK_H,
  CANVAS_PAD_RIGHT,
} from '../board/layout-constants';

// Dedicated scroll container id so the Minimap (which samples DOM scroll
// extents by id) doesn't collide with the editor board when both components
// exist elsewhere in the tree.
const RUN_SCROLL_ID = 'run-scroll';

interface RunViewProps {
  config: RawPipelineConfig;
  dagEdges: DagEdge[];
  positions: Map<string, TaskPosition>;
  onBack: () => void;
}

const RUN_STATUS_LABEL: Record<string, string> = {
  idle: 'Idle',
  starting: 'Starting...',
  running: 'Running',
  done: 'Completed',
  aborted: 'Aborted',
  error: 'Error',
};

function countByStatus(tasks: Map<string, { status: TaskStatus }>) {
  const counts: Partial<Record<TaskStatus, number>> = {};
  for (const [, t] of tasks) {
    counts[t.status] = (counts[t.status] ?? 0) + 1;
  }
  return counts;
}

export function RunView({ config: liveConfig, dagEdges, positions, onBack }: RunViewProps) {
  const {
    status,
    tasks,
    error,
    selectedTaskId,
    selectedTrackId,
    selectTask,
    selectTrack,
    abortRun,
    pendingApprovals,
    resolveApproval,
    snapshot,
  } = useRunStore();

  // Prefer the snapshot captured at startRun time — that is the config the
  // pipeline is actually running with. Fall back to the live editor config
  // only when no snapshot exists (e.g. idle state showing history).
  const config = snapshot ?? liveConfig;

  const isTerminal = status === 'done' || status === 'aborted' || status === 'error';
  const isActive = status !== 'idle';

  const [showPipelineSettings, setShowPipelineSettings] = useState(false);
  const [showPlugins, setShowPlugins] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // First pending approval (FIFO by Map iteration order).
  const firstApproval = useMemo(() => {
    const it = pendingApprovals.values().next();
    return it.done ? null : it.value;
  }, [pendingApprovals]);

  // Build flat task list with positions (same layout as BoardCanvas).
  const flatTasks = useMemo(() => {
    type FT = { qid: string; trackId: string; trackIndex: number; task: (typeof config.tracks)[number]['tasks'][number] };
    const result: FT[] = [];
    for (let ti = 0; ti < config.tracks.length; ti++) {
      const track = config.tracks[ti];
      for (const task of track.tasks) {
        result.push({ qid: `${track.id}.${task.id}`, trackId: track.id, trackIndex: ti, task });
      }
    }
    return result;
  }, [config]);

  // Local runtime position map. `TaskPosition` from the store only carries
  // `x` — the y-coordinate is derived from the track index, which lives in
  // RunView since the read-only canvas owns its own layout.
  type RunPos = { x: number; y: number };
  const taskPositions = useMemo(() => {
    const taskCountPerTrack = new Map<string, number>();
    const posMap = new Map<string, RunPos>();
    for (const ft of flatTasks) {
      const count = taskCountPerTrack.get(ft.trackId) ?? 0;
      const stored = positions.get(ft.qid);
      const x = stored ? stored.x : PAD_LEFT + count * (TASK_W + TASK_GAP);
      const y = ft.trackIndex * TRACK_H + (TRACK_H - TASK_H) / 2;
      posMap.set(ft.qid, { x, y });
      taskCountPerTrack.set(ft.trackId, count + 1);
    }
    return posMap;
  }, [flatTasks, positions]);

  // Minimap reads from the pipeline store by default. We pass an override
  // shape (x-only) keyed on qualified id so the minimap's layout math maps
  // into the same coordinate space as the run canvas.
  const minimapPositions = useMemo(() => {
    const out = new Map<string, TaskPosition>();
    for (const [qid, pos] of taskPositions) {
      out.set(qid, { x: pos.x });
    }
    return out;
  }, [taskPositions]);

  const canvasWidth = useMemo(() => {
    let maxX = 0;
    for (const [, pos] of taskPositions) {
      if (pos.x + TASK_W > maxX) maxX = pos.x + TASK_W;
    }
    return maxX + CANVAS_PAD_RIGHT;
  }, [taskPositions]);

  const canvasHeight = config.tracks.length * TRACK_H;

  const edges = useMemo(() => {
    return dagEdges.map((edge) => {
      const from = taskPositions.get(edge.from);
      const to = taskPositions.get(edge.to);
      if (!from || !to) return null;
      const x1 = from.x + TASK_W + 4;
      const y1 = from.y + TASK_H / 2;
      const x2 = to.x - 4;
      const y2 = to.y + TASK_H / 2;
      const mx = (x1 + x2) / 2;
      return { key: `${edge.from}->${edge.to}`, d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}` };
    }).filter(Boolean) as { key: string; d: string }[];
  }, [dagEdges, taskPositions]);

  // Build selected task state. Fall back to the snapshot config when the
  // task hasn't received any runtime updates yet so the right-hand panel
  // can still show the readOnly task config.
  const selectedTask = useMemo((): RunTaskState | null => {
    if (!selectedTaskId) return null;
    const fromRun = tasks.get(selectedTaskId);
    if (fromRun) return fromRun;
    const [trackId, taskId] = selectedTaskId.split('.');
    const track = config.tracks.find((t) => t.id === trackId);
    const task = track?.tasks.find((t) => t.id === taskId);
    if (!task) return null;
    return {
      taskId: selectedTaskId,
      trackId,
      taskName: task.name || task.id,
      status: 'idle',
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
    };
  }, [selectedTaskId, tasks, config]);

  const counts = countByStatus(tasks);
  const showHistory = !isActive;

  // Keyboard: Ctrl+F opens search, Escape clears selection or closes search.
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      setSearchVisible(true);
      return;
    }
    if (e.key === 'Escape') {
      if (searchVisible) {
        setSearchVisible(false);
        setSearchQuery('');
      } else if (selectedTaskId) {
        selectTask(null);
      } else if (selectedTrackId) {
        selectTrack(null);
      }
    }
  }, [searchVisible, selectedTaskId, selectedTrackId, selectTask, selectTrack]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const searchMatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [] as { trackId: string; taskId: string; label: string; snippet: string }[];
    const out: { trackId: string; taskId: string; label: string; snippet: string }[] = [];
    for (const t of config.tracks) {
      for (const task of t.tasks) {
        const name = (task.name ?? '').toLowerCase();
        const prompt = (task.prompt ?? '').toLowerCase();
        if (name.includes(q) || prompt.includes(q)) {
          out.push({
            trackId: t.id,
            taskId: task.id,
            label: task.name ?? task.id,
            snippet: (task.prompt ?? '').slice(0, 80),
          });
        }
      }
    }
    return out;
  }, [searchQuery, config]);

  return (
    <div className="h-full flex flex-col bg-tagma-bg relative">
      {/* Header */}
      <header className="h-10 bg-tagma-surface border-b border-tagma-border flex items-center px-2 gap-2 shrink-0">
        <button onClick={onBack} className="flex items-center gap-1.5 text-xs text-tagma-muted hover:text-tagma-text transition-colors px-2 py-1">
          <ArrowLeft size={12} />
          <span>Back to Editor</span>
        </button>
        <div className="w-px h-5 bg-tagma-border" />

        <div className="flex items-center gap-1.5 px-2">
          <LayoutGrid size={13} className="text-tagma-accent" />
          <span className="text-xs font-medium text-tagma-text truncate max-w-[160px]">{config.name}</span>
        </div>

        <div className="w-px h-5 bg-tagma-border" />

        {/* Run status */}
        <div className="flex items-center gap-2 text-[10px] font-mono">
          {status === 'running' && <Loader2 size={11} className="text-tagma-ready animate-spin" />}
          {status === 'done' && <Check size={11} className="text-tagma-success" />}
          {(status === 'error' || status === 'aborted') && <X size={11} className="text-tagma-error" />}
          <span className={`
            ${status === 'running' ? 'text-tagma-ready' : ''}
            ${status === 'done' ? 'text-tagma-success' : ''}
            ${status === 'error' || status === 'aborted' ? 'text-tagma-error' : ''}
            ${status === 'starting' ? 'text-tagma-muted' : ''}
          `}>
            {RUN_STATUS_LABEL[status] ?? status}
          </span>
        </div>

        {tasks.size > 0 && (
          <div className="flex items-center gap-1.5 text-[9px] font-mono">
            {counts.success && <span className="text-tagma-success">{counts.success} ok</span>}
            {counts.failed && <span className="text-tagma-error">{counts.failed} fail</span>}
            {counts.running && <span className="text-tagma-ready">{counts.running} run</span>}
            {counts.waiting && <span className="text-tagma-muted">{counts.waiting} wait</span>}
            {counts.skipped && <span className="text-tagma-muted/50">{counts.skipped} skip</span>}
          </div>
        )}

        {pendingApprovals.size > 0 && (
          <span className="text-[9px] font-mono text-tagma-warning">
            {pendingApprovals.size} approval{pendingApprovals.size === 1 ? '' : 's'} pending
          </span>
        )}

        <div className="flex-1" />

        {/* Plugins (read-only) */}
        <button
          onClick={() => setShowPlugins(true)}
          className="flex items-center gap-1.5 px-2 py-1 text-xs text-tagma-muted hover:text-tagma-text transition-colors"
          title="View loaded plugins (read-only)"
        >
          <Package size={12} />
        </button>

        {/* Pipeline settings (read-only) */}
        <button
          onClick={() => setShowPipelineSettings(true)}
          className="flex items-center gap-1.5 px-2 py-1 text-xs text-tagma-muted hover:text-tagma-text transition-colors"
          title="View pipeline settings (read-only)"
        >
          <Settings size={12} />
        </button>

        {/* Search */}
        <button
          onClick={() => setSearchVisible(true)}
          className="flex items-center gap-1.5 px-2 py-1 text-xs text-tagma-muted hover:text-tagma-text transition-colors"
          title="Search tasks (Ctrl+F)"
        >
          <Search size={12} />
        </button>

        {/* Abort */}
        {!isTerminal && status !== 'idle' && (
          <button onClick={abortRun} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-tagma-error border border-tagma-error/20 hover:bg-tagma-error/10 transition-colors mr-1">
            <Square size={10} />
            <span>Abort</span>
          </button>
        )}
      </header>

      {error && (
        <div className="px-4 py-2 bg-tagma-error/5 border-b border-tagma-error/20 text-[11px] text-tagma-error font-mono">
          {error}
        </div>
      )}

      {/* Main area */}
      <div className="flex-1 flex overflow-hidden">
        {showHistory ? (
          <div className="flex-1 overflow-hidden">
            <RunHistoryBrowser />
          </div>
        ) : (
          <>
            <div className="flex-1 flex overflow-hidden relative">
              {/* Track headers (reuses TrackLane for metadata parity with editor) */}
              <div className="shrink-0 border-r border-tagma-border overflow-hidden" style={{ width: HEADER_W }}>
                {config.tracks.map((track, i) => {
                  const taskCount = track.tasks.length;
                  const isSelected = selectedTrackId === track.id;
                  return (
                    <div
                      key={track.id}
                      className={`border-b border-tagma-border/40 cursor-pointer transition-colors ${
                        isSelected ? 'bg-tagma-accent/6' : ''
                      } ${i % 2 === 1 ? 'track-row-odd' : ''}`}
                      style={{ height: TRACK_H }}
                      onClick={(e) => {
                        e.stopPropagation();
                        selectTrack(track.id);
                      }}
                    >
                      <TrackLane
                        track={track}
                        taskCount={taskCount}
                        hasParallelWarning={false}
                      />
                    </div>
                  );
                })}
              </div>

              {/* Task canvas */}
              <div id={RUN_SCROLL_ID} className="flex-1 overflow-auto">
                <div className="relative timeline-grid" style={{ width: canvasWidth, height: canvasHeight }}
                  onClick={() => selectTask(null)}>
                  {/* Track row backgrounds */}
                  {config.tracks.map((track, i) => (
                    <div
                      key={track.id}
                      className={`absolute left-0 right-0 border-b border-tagma-border/40 ${i % 2 === 1 ? 'track-row-odd' : ''}`}
                      style={{ top: i * TRACK_H, height: TRACK_H }}
                    />
                  ))}

                  {/* Edges */}
                  <svg className="absolute inset-0 pointer-events-none" style={{ width: canvasWidth, height: canvasHeight }}>
                    {edges.map((e) => (
                      <path key={e.key} d={e.d} fill="none" stroke="rgba(107,114,128,0.25)" strokeWidth={1.5} />
                    ))}
                  </svg>

                  {/* Task nodes (reuses TaskCard in readOnly mode) */}
                  {flatTasks.map((ft) => {
                    const pos = taskPositions.get(ft.qid);
                    if (!pos) return null;
                    const taskState = tasks.get(ft.qid);
                    const runtimeStatus: TaskStatus = taskState?.status ?? 'idle';
                    return (
                      <TaskCard
                        key={ft.qid}
                        task={ft.task}
                        trackId={ft.trackId}
                        pipelineConfig={config}
                        x={pos.x} y={pos.y} w={TASK_W} h={TASK_H}
                        isSelected={selectedTaskId === ft.qid}
                        isInvalid={false}
                        isDragging={false}
                        isTrackDragging={false}
                        isEdgeTarget={false}
                        readOnly
                        runtimeStatus={runtimeStatus}
                        runtimeDurationMs={taskState?.durationMs ?? null}
                        onClickRun={(taskId) => selectTask(`${ft.trackId}.${taskId}`)}
                      />
                    );
                  })}
                </div>
              </div>

              {/* Floating minimap + zoom controls — same UX as editor */}
              <Minimap scrollElementId={RUN_SCROLL_ID} config={config} positions={minimapPositions} />
              <ZoomControls />
            </div>

            {selectedTask && (
              <RunTaskPanel
                task={selectedTask}
                config={config}
                onClose={() => selectTask(null)}
              />
            )}

            {!selectedTask && selectedTrackId && (() => {
              const track = config.tracks.find((t) => t.id === selectedTrackId);
              if (!track) return null;
              return (
                <TrackInfoPanel
                  track={track}
                  config={config}
                  onClose={() => selectTrack(null)}
                />
              );
            })()}
          </>
        )}
      </div>

      {/* Approval overlay (F3) */}
      {firstApproval && (
        <ApprovalDialog
          request={firstApproval}
          config={config}
          onApprove={(choice) => resolveApproval(firstApproval.id, 'approved', choice)}
          onReject={() => resolveApproval(firstApproval.id, 'rejected')}
        />
      )}

      {/* Pipeline settings modal (read-only) */}
      {showPipelineSettings && (
        <PipelineConfigPanel
          config={config}
          drivers={[]}
          errors={[]}
          onUpdate={() => { /* readOnly — no-op */ }}
          onClose={() => setShowPipelineSettings(false)}
          readOnly
        />
      )}

      {/* Plugins modal (read-only) */}
      {showPlugins && (
        <RunPluginsPanel
          config={config}
          onClose={() => setShowPlugins(false)}
        />
      )}

      {/* Search overlay — read-only, navigates selection on click */}
      {searchVisible && (
        <div className="fixed top-14 right-4 z-[150] w-[340px] bg-tagma-surface border border-tagma-border shadow-panel animate-fade-in">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-tagma-border">
            <input
              autoFocus
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setSearchVisible(false); setSearchQuery(''); }
              }}
              placeholder="Search tasks by name or prompt..."
              className="flex-1 text-[11px] font-mono bg-tagma-bg border border-tagma-border focus:border-tagma-accent rounded px-2 py-1 text-tagma-text outline-none"
            />
            <button
              onClick={() => { setSearchVisible(false); setSearchQuery(''); }}
              className="p-1 text-tagma-muted hover:text-tagma-text"
            >
              <X size={12} />
            </button>
          </div>
          <div className="max-h-[240px] overflow-y-auto">
            {searchQuery.trim() === '' && (
              <div className="px-3 py-2 text-[10px] font-mono text-tagma-muted/60">Type to search tasks</div>
            )}
            {searchQuery.trim() !== '' && searchMatches.length === 0 && (
              <div className="px-3 py-2 text-[10px] font-mono text-tagma-muted/60">No matches</div>
            )}
            {searchMatches.map((m) => (
              <button
                key={`${m.trackId}.${m.taskId}`}
                className="w-full text-left px-3 py-2 border-b border-tagma-border/30 last:border-b-0 hover:bg-tagma-bg/60"
                onClick={() => {
                  selectTask(`${m.trackId}.${m.taskId}`);
                  setSearchVisible(false);
                }}
              >
                <div className="text-[11px] font-mono text-tagma-text truncate">{m.label}</div>
                {m.snippet && (
                  <div className="text-[10px] font-mono text-tagma-muted/60 truncate">{m.snippet}</div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


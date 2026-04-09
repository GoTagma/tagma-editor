import { useMemo } from 'react';
import { ArrowLeft, Square, Loader2, Check, X, LayoutGrid } from 'lucide-react';
import { useRunStore } from '../../store/run-store';
import { RunTaskNode } from './RunTaskNode';
import { RunTaskPanel } from './RunTaskPanel';
import type { RawPipelineConfig, DagEdge, TaskStatus } from '../../api/client';
import type { TaskPosition } from '../../store/pipeline-store';

// Reuse same layout constants as BoardCanvas
const HEADER_W = 210;
const TASK_W = 176;
const TASK_H = 52;
const TASK_GAP = 24;
const PAD_LEFT = 20;
const TRACK_H = 64;
const CANVAS_PAD_RIGHT = 300;

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

export function RunView({ config, dagEdges, positions, onBack }: RunViewProps) {
  const { status, tasks, error, selectedTaskId, selectTask, abortRun } = useRunStore();

  const isTerminal = status === 'done' || status === 'aborted' || status === 'error';

  // Build flat task list with positions (same logic as BoardCanvas)
  const flatTasks = useMemo(() => {
    const result: { qid: string; trackId: string; trackIndex: number; task: (typeof config.tracks)[0]['tasks'][0] }[] = [];
    for (let ti = 0; ti < config.tracks.length; ti++) {
      const track = config.tracks[ti];
      for (const task of track.tasks) {
        result.push({ qid: `${track.id}.${task.id}`, trackId: track.id, trackIndex: ti, task });
      }
    }
    return result;
  }, [config]);

  // Compute positions
  const taskPositions = useMemo(() => {
    const taskCountPerTrack = new Map<string, number>();
    const posMap = new Map<string, { x: number; y: number }>();
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

  // Canvas dimensions
  const canvasWidth = useMemo(() => {
    let maxX = 0;
    for (const [, pos] of taskPositions) {
      if (pos.x + TASK_W > maxX) maxX = pos.x + TASK_W;
    }
    return maxX + CANVAS_PAD_RIGHT;
  }, [taskPositions]);

  const canvasHeight = config.tracks.length * TRACK_H;

  // Build edges
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

  // Get selected task state (fallback to config if run hasn't populated tasks yet)
  const selectedTask = useMemo((): import('../../api/client').RunTaskState | null => {
    if (!selectedTaskId) return null;
    const fromRun = tasks.get(selectedTaskId);
    if (fromRun) return fromRun;
    // Build from config
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
    };
  }, [selectedTaskId, tasks, config]);

  const counts = countByStatus(tasks);

  return (
    <div className="h-full flex flex-col bg-tagma-bg">
      {/* Header */}
      <header className="h-10 bg-tagma-surface border-b border-tagma-border flex items-center px-2 gap-2 shrink-0">
        <button onClick={onBack} className="flex items-center gap-1.5 text-xs text-tagma-muted hover:text-tagma-text transition-colors px-2 py-1">
          <ArrowLeft size={12} />
          <span>Back to Editor</span>
        </button>

        <div className="w-px h-5 bg-tagma-border" />

        <div className="flex items-center gap-1.5 px-2">
          <LayoutGrid size={13} className="text-tagma-accent" />
          <span className="text-xs font-medium text-tagma-text">{config.name}</span>
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

        {/* Summary counts */}
        {tasks.size > 0 && (
          <div className="flex items-center gap-1.5 text-[9px] font-mono">
            {counts.success && <span className="text-tagma-success">{counts.success} ok</span>}
            {counts.failed && <span className="text-tagma-error">{counts.failed} fail</span>}
            {counts.running && <span className="text-tagma-ready">{counts.running} run</span>}
            {counts.waiting && <span className="text-tagma-muted">{counts.waiting} wait</span>}
            {counts.skipped && <span className="text-tagma-muted/50">{counts.skipped} skip</span>}
          </div>
        )}

        <div className="flex-1" />

        {/* Abort button */}
        {!isTerminal && status !== 'idle' && (
          <button onClick={abortRun} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-tagma-error border border-tagma-error/20 hover:bg-tagma-error/10 transition-colors mr-1">
            <Square size={10} />
            <span>Abort</span>
          </button>
        )}
      </header>

      {/* Error banner */}
      {error && (
        <div className="px-4 py-2 bg-tagma-error/5 border-b border-tagma-error/20 text-[11px] text-tagma-error font-mono">
          {error}
        </div>
      )}

      {/* Main area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Canvas */}
        <div className="flex-1 flex overflow-hidden">
          {/* Track headers */}
          <div className="shrink-0 border-r border-tagma-border overflow-hidden" style={{ width: HEADER_W }}>
            {config.tracks.map((track, i) => (
              <div
                key={track.id}
                className={`flex items-center px-4 border-b border-tagma-border/40 ${i % 2 === 1 ? 'track-row-odd' : ''}`}
                style={{ height: TRACK_H }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {track.color && <div className="w-2 h-2 shrink-0" style={{ backgroundColor: track.color }} />}
                  <span className="text-xs font-medium text-tagma-text truncate">{track.name}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Task area */}
          <div className="flex-1 overflow-auto">
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

              {/* Task nodes */}
              {flatTasks.map((ft) => {
                const pos = taskPositions.get(ft.qid);
                if (!pos) return null;
                const taskState = tasks.get(ft.qid);
                const taskStatus: TaskStatus = taskState?.status ?? 'idle';
                return (
                  <RunTaskNode
                    key={ft.qid}
                    task={ft.task}
                    status={taskStatus}
                    durationMs={taskState?.durationMs ?? null}
                    x={pos.x} y={pos.y} w={TASK_W} h={TASK_H}
                    isSelected={selectedTaskId === ft.qid}
                    onClick={(taskId) => { selectTask(`${ft.trackId}.${taskId}`); }}
                  />
                );
              })}
            </div>
          </div>
        </div>

        {/* Right panel: selected task details */}
        {selectedTask && (
          <RunTaskPanel task={selectedTask} onClose={() => selectTask(null)} />
        )}
      </div>

    </div>
  );
}

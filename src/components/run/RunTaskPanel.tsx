import { X, Clock, Check, AlertCircle, Terminal, MessageSquare, Loader2 } from 'lucide-react';
import type { RunTaskState, TaskStatus } from '../../api/client';

interface RunTaskPanelProps {
  task: RunTaskState;
  onClose: () => void;
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  idle: 'Idle',
  waiting: 'Waiting',
  running: 'Running',
  success: 'Success',
  failed: 'Failed',
  timeout: 'Timeout',
  skipped: 'Skipped',
  blocked: 'Blocked',
};

const STATUS_COLOR: Record<TaskStatus, string> = {
  idle: 'text-tagma-muted',
  waiting: 'text-tagma-muted',
  running: 'text-tagma-ready',
  success: 'text-tagma-success',
  failed: 'text-tagma-error',
  timeout: 'text-tagma-warning',
  skipped: 'text-tagma-muted',
  blocked: 'text-tagma-warning',
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

export function RunTaskPanel({ task, onClose }: RunTaskPanelProps) {
  return (
    <div className="w-80 h-full bg-tagma-surface border-l border-tagma-border flex flex-col animate-slide-in-right">
      <div className="panel-header">
        <h2 className="panel-title truncate">{task.taskName}</h2>
        <button onClick={onClose} className="p-1 text-tagma-muted hover:text-tagma-text transition-colors">
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {/* Task ID */}
        <div>
          <label className="field-label">Task ID</label>
          <div className="text-[11px] font-mono text-tagma-muted bg-tagma-bg border border-tagma-border px-2.5 py-1.5 truncate">
            {task.taskId}
          </div>
        </div>

        {/* Status */}
        <div>
          <label className="field-label">Status</label>
          <div className={`flex items-center gap-2 text-[12px] font-medium ${STATUS_COLOR[task.status]}`}>
            {task.status === 'running' && <Loader2 size={12} className="animate-spin" />}
            {task.status === 'success' && <Check size={12} />}
            {task.status === 'failed' && <AlertCircle size={12} />}
            {task.status === 'timeout' && <Clock size={12} />}
            {STATUS_LABEL[task.status]}
          </div>
        </div>

        {/* Timing */}
        {task.startedAt && (
          <div>
            <label className="field-label">Started</label>
            <div className="text-[11px] font-mono text-tagma-muted">{new Date(task.startedAt).toLocaleTimeString()}</div>
          </div>
        )}
        {task.finishedAt && (
          <div>
            <label className="field-label">Finished</label>
            <div className="text-[11px] font-mono text-tagma-muted">{new Date(task.finishedAt).toLocaleTimeString()}</div>
          </div>
        )}
        {task.durationMs != null && (
          <div>
            <label className="field-label">Duration</label>
            <div className="text-[11px] font-mono text-tagma-muted">{formatDuration(task.durationMs)}</div>
          </div>
        )}

        {/* Exit code */}
        {task.exitCode != null && (
          <div>
            <label className="field-label">Exit Code</label>
            <div className={`text-[11px] font-mono ${task.exitCode === 0 ? 'text-tagma-success' : 'text-tagma-error'}`}>
              {task.exitCode}
            </div>
          </div>
        )}

        {/* Stdout */}
        {task.stdout && (
          <div>
            <label className="field-label">Output</label>
            <pre className="text-[10px] font-mono text-tagma-text bg-tagma-bg border border-tagma-border px-2.5 py-2 overflow-auto max-h-[300px] whitespace-pre-wrap break-words">
              {task.stdout}
            </pre>
          </div>
        )}

        {/* Stderr */}
        {task.stderr && (
          <div>
            <label className="field-label">Errors</label>
            <pre className="text-[10px] font-mono text-tagma-error/80 bg-tagma-error/5 border border-tagma-error/20 px-2.5 py-2 overflow-auto max-h-[200px] whitespace-pre-wrap break-words">
              {task.stderr}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

import { Terminal, MessageSquare, Loader2, Check, X, Clock, SkipForward, ShieldOff } from 'lucide-react';
import type { TaskStatus, RawTaskConfig } from '../../api/client';

interface RunTaskNodeProps {
  task: RawTaskConfig;
  status: TaskStatus;
  x: number;
  y: number;
  w: number;
  h: number;
  isSelected: boolean;
  onClick: (taskId: string) => void;
}

const STATUS_CONFIG: Record<TaskStatus, { bar: string; bg: string; icon: typeof Check; iconColor: string }> = {
  idle:    { bar: 'bg-tagma-muted/30',  bg: 'bg-tagma-elevated',    icon: Clock,       iconColor: 'text-tagma-muted/40' },
  waiting: { bar: 'bg-tagma-muted/50',  bg: 'bg-tagma-elevated',    icon: Clock,       iconColor: 'text-tagma-muted/60' },
  running: { bar: 'bg-tagma-ready',     bg: 'bg-tagma-ready/5',     icon: Loader2,     iconColor: 'text-tagma-ready' },
  success: { bar: 'bg-tagma-success',   bg: 'bg-tagma-success/5',   icon: Check,       iconColor: 'text-tagma-success' },
  failed:  { bar: 'bg-tagma-error',     bg: 'bg-tagma-error/5',     icon: X,           iconColor: 'text-tagma-error' },
  timeout: { bar: 'bg-tagma-warning',   bg: 'bg-tagma-warning/5',   icon: Clock,       iconColor: 'text-tagma-warning' },
  skipped: { bar: 'bg-tagma-muted/40',  bg: 'bg-tagma-elevated/60', icon: SkipForward, iconColor: 'text-tagma-muted/50' },
  blocked: { bar: 'bg-tagma-warning',   bg: 'bg-tagma-warning/5',   icon: ShieldOff,   iconColor: 'text-tagma-warning' },
};

export function RunTaskNode({ task, status, x, y, w, h, isSelected, onClick }: RunTaskNodeProps) {
  const isCommand = !!task.command;
  const cfg = STATUS_CONFIG[status];
  const StatusIcon = cfg.icon;

  return (
    <div
      className={`
        absolute border select-none flex items-center px-2.5 gap-1.5 cursor-pointer
        ${isSelected ? 'border-tagma-accent' : 'border-tagma-border'}
        ${isSelected ? 'bg-tagma-accent/6' : cfg.bg}
      `}
      style={{ left: x, top: y, width: w, height: h }}
      onClick={(e) => { e.stopPropagation(); onClick(task.id); }}
    >
      {/* Status bar (left) */}
      <div className={`absolute left-0 top-0 bottom-0 w-[3px] ${isSelected ? 'bg-tagma-accent' : cfg.bar}`} />

      {isCommand
        ? <Terminal size={9} className="text-tagma-info/70 shrink-0" />
        : <MessageSquare size={9} className="text-tagma-muted/50 shrink-0" />
      }

      <span className={`text-[11px] font-medium truncate flex-1 ${status === 'skipped' ? 'text-tagma-muted/50 line-through' : 'text-tagma-text'}`}>
        {task.name || task.id}
      </span>

      <StatusIcon size={11} className={`shrink-0 ${cfg.iconColor} ${status === 'running' ? 'animate-spin' : ''}`} />
    </div>
  );
}

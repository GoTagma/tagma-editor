import { AlertTriangle, Terminal, MessageSquare } from 'lucide-react';
import type { RawTaskConfig } from '../../api/client';

interface TaskCardProps {
  task: RawTaskConfig;
  x: number;
  y: number;
  w: number;
  h: number;
  isSelected: boolean;
  isInvalid: boolean;
  isDragging: boolean;
  isEdgeTarget: boolean;
  onPointerDown: (taskId: string, e: React.PointerEvent) => void;
  onHandlePointerDown: (taskId: string, e: React.PointerEvent) => void;
  onTargetPointerUp: (taskId: string) => void;
  onContextMenu?: (taskId: string, e: React.MouseEvent) => void;
}

export function TaskCard({
  task, x, y, w, h,
  isSelected, isInvalid, isDragging, isEdgeTarget,
  onPointerDown, onHandlePointerDown, onTargetPointerUp, onContextMenu,
}: TaskCardProps) {
  const isCommand = !!task.command;

  const borderColor = isDragging
    ? 'border-tagma-accent'
    : isSelected
      ? 'border-tagma-accent'
      : isEdgeTarget
        ? 'border-tagma-accent/60'
        : 'border-tagma-border';

  const bgColor = isDragging
    ? 'bg-tagma-accent/10'
    : isSelected
      ? 'bg-tagma-accent/6'
      : isEdgeTarget
        ? 'bg-tagma-accent/4'
        : 'bg-tagma-elevated hover:bg-tagma-elevated/80';

  return (
    <div
      data-task-card="true"
      className={`
        absolute border select-none flex items-center px-2.5 gap-1.5
        ${borderColor} ${bgColor}
        ${isDragging ? 'z-30 shadow-glow-accent cursor-grabbing' : 'cursor-grab active:cursor-grabbing'}
      `}
      style={{
        left: x, top: y, width: w, height: h,
        transition: isDragging ? 'none' : 'left 100ms ease-out, top 100ms ease-out',
      }}
      onPointerDown={(e) => { if (e.button === 0) onPointerDown(task.id, e); }}
      onPointerUp={() => onTargetPointerUp(task.id)}
      onContextMenu={(e) => { if (onContextMenu) onContextMenu(task.id, e); }}
    >
      {/* Left handle (target) */}
      <div className={`
        absolute -left-[4px] top-1/2 -translate-y-1/2 w-[8px] h-[8px]
        border bg-tagma-bg transition-all duration-75
        ${isEdgeTarget ? 'border-tagma-accent bg-tagma-accent scale-125' : 'border-tagma-border hover:border-tagma-accent'}
      `} />

      {isSelected && (
        <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-tagma-accent" />
      )}

      {isCommand
        ? <Terminal size={9} className="text-tagma-info/70 shrink-0 pointer-events-none" />
        : <MessageSquare size={9} className="text-tagma-muted/50 shrink-0 pointer-events-none" />
      }

      <span className="text-[11px] font-medium truncate flex-1 pointer-events-none text-tagma-text">
        {task.name || task.id}
      </span>

      <div className="flex items-center gap-1 shrink-0 pointer-events-none">
        {isInvalid && <AlertTriangle size={9} className="text-tagma-warning" />}
      </div>

      {/* Right handle (source) */}
      <div
        className="absolute -right-[4px] top-1/2 -translate-y-1/2 w-[8px] h-[8px]
          border border-tagma-border bg-tagma-bg cursor-crosshair
          hover:border-tagma-accent hover:bg-tagma-accent/20 transition-all duration-75"
        onPointerDown={(e) => { if (e.button === 0) { e.stopPropagation(); onHandlePointerDown(task.id, e); } }}
      />
    </div>
  );
}

import { useState, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle, Terminal, MessageSquare, Lock, FileSearch,
  Clock, CheckCircle2, Layers, FileOutput, Package,
} from 'lucide-react';
import type { RawTaskConfig, RawPipelineConfig } from '../../api/client';
import { getZoom, viewportW, viewportH } from '../../utils/zoom';

interface TaskCardProps {
  task: RawTaskConfig;
  trackId: string;
  pipelineConfig: RawPipelineConfig;
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

/* Resolve effective value via inheritance: task → track → pipeline */
function resolveField<K extends 'driver' | 'model_tier'>(
  task: RawTaskConfig,
  trackId: string,
  config: RawPipelineConfig,
  field: K,
): string | undefined {
  if (task[field]) return task[field];
  const track = config.tracks.find((t) => t.id === trackId);
  if (track?.[field]) return track[field];
  if (field === 'driver') return config.driver;
  return undefined;
}

const TIER_COLORS: Record<string, string> = {
  high: 'text-blue-400 bg-blue-400/10 border-blue-400/30',
  medium: 'text-tagma-muted bg-tagma-muted/10 border-tagma-muted/30',
  low: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
};

const TIER_LABELS: Record<string, string> = { high: 'H', medium: 'M', low: 'L' };

function PermBadges({ task, trackId, config }: { task: RawTaskConfig; trackId: string; config: RawPipelineConfig }) {
  const track = config.tracks.find((t) => t.id === trackId);
  const perms = task.permissions ?? track?.permissions;
  if (!perms) return null;

  return (
    <span className="flex items-center gap-px">
      <span className={`text-[8px] font-mono font-bold ${perms.read ? 'text-emerald-400' : 'text-tagma-muted/30'}`}>R</span>
      <span className={`text-[8px] font-mono font-bold ${perms.write ? 'text-amber-400' : 'text-tagma-muted/30'}`}>W</span>
      <span className={`text-[8px] font-mono font-bold ${perms.execute ? 'text-red-400' : 'text-tagma-muted/30'}`}>X</span>
    </span>
  );
}

function TaskTooltip({ task, trackId, config, anchorRect }: { task: RawTaskConfig; trackId: string; config: RawPipelineConfig; anchorRect: DOMRect }) {
  const driver = resolveField(task, trackId, config, 'driver');
  const tier = resolveField(task, trackId, config, 'model_tier');
  const track = config.tracks.find((t) => t.id === trackId);
  const perms = task.permissions ?? track?.permissions;

  const rows: [string, string][] = [];
  if (driver) rows.push(['Driver', driver]);
  if (tier) rows.push(['Model', tier]);
  if (perms) {
    const parts = [perms.read && 'Read', perms.write && 'Write', perms.execute && 'Execute'].filter(Boolean);
    if (parts.length) rows.push(['Permissions', parts.join(', ')]);
  }
  if (task.timeout) rows.push(['Timeout', task.timeout]);
  if (task.trigger) rows.push(['Trigger', `${task.trigger.type}${task.trigger.message ? ` — ${task.trigger.message}` : ''}`]);
  if (task.completion) rows.push(['Completion', task.completion.type]);
  if (task.middlewares?.length) rows.push(['Middleware', task.middlewares.map((m) => m.type).join(', ')]);
  if (task.output) rows.push(['Output', task.output]);
  if (task.continue_from) rows.push(['Continue from', task.continue_from]);
  if (task.cwd) rows.push(['CWD', task.cwd]);
  if (task.agent_profile) rows.push(['Profile', task.agent_profile]);
  if (task.use) rows.push(['Template', task.use]);
  if (task.prompt) rows.push(['Prompt', task.prompt.length > 80 ? task.prompt.slice(0, 80) + '…' : task.prompt]);
  if (task.command) rows.push(['Command', task.command.length > 80 ? task.command.slice(0, 80) + '…' : task.command]);

  const tooltipRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = tooltipRef.current;
    if (!el) return;
    const z = getZoom();
    const gap = 8;
    const margin = 8;
    const vw = viewportW();
    const vh = viewportH();

    // All getBoundingClientRect values are in screen pixels; divide by zoom for logical coords
    const tW = el.getBoundingClientRect().width / z;
    const tH = el.getBoundingClientRect().height / z;
    const aLeft = anchorRect.left / z;
    const aTop = anchorRect.top / z;
    const aW = anchorRect.width / z;
    const aBottom = anchorRect.bottom / z;

    // Horizontal: center on card, clamp to viewport
    let left = aLeft + aW / 2 - tW / 2;
    left = Math.max(margin, Math.min(left, vw - tW - margin));

    // Vertical: prefer above; fall back to below if not enough room
    let top: number;
    if (aTop - gap - tH >= margin) {
      top = aTop - gap - tH;
    } else {
      top = aBottom + gap;
    }
    top = Math.max(margin, Math.min(top, vh - tH - margin));

    setPos({ left, top });
  }, [anchorRect]);

  if (rows.length === 0) return null;

  return createPortal(
    <div
      ref={tooltipRef}
      className="fixed pointer-events-none bg-tagma-surface border border-tagma-border shadow-panel p-2 animate-fade-in"
      style={{
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        width: 224,
        maxHeight: viewportH() - 16,
        overflow: 'hidden',
        zIndex: 9999,
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      <div className="text-[10px] font-semibold text-tagma-text mb-1 truncate">{task.name || task.id}</div>
      {rows.map(([label, value]) => (
        <div key={label} className="flex gap-2 text-[9px] leading-relaxed">
          <span className="text-tagma-muted shrink-0 w-16">{label}</span>
          <span className="text-tagma-text/80 truncate">{value}</span>
        </div>
      ))}
    </div>,
    document.body,
  );
}

export function TaskCard({
  task, trackId, pipelineConfig, x, y, w, h,
  isSelected, isInvalid, isDragging, isEdgeTarget,
  onPointerDown, onHandlePointerDown, onTargetPointerUp, onContextMenu,
}: TaskCardProps) {
  const [hovered, setHovered] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const isCommand = !!task.command;
  const isTemplate = !!task.use;

  const driver = resolveField(task, trackId, pipelineConfig, 'driver');
  const tier = resolveField(task, trackId, pipelineConfig, 'model_tier');

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

  const tierStyle = tier ? (TIER_COLORS[tier] ?? TIER_COLORS.medium) : null;

  // Indicator icons (right side, row 1)
  const indicators: { icon: React.ReactNode; title: string }[] = [];
  if (task.trigger) {
    const Icon = task.trigger.type === 'file' ? FileSearch : Lock;
    indicators.push({ icon: <Icon size={8} className="text-amber-400" />, title: `Trigger: ${task.trigger.type}` });
  }
  if (task.timeout) {
    indicators.push({ icon: <Clock size={8} className="text-sky-400" />, title: `Timeout: ${task.timeout}` });
  }
  if (task.completion) {
    indicators.push({ icon: <CheckCircle2 size={8} className="text-emerald-400" />, title: `Completion: ${task.completion.type}` });
  }
  if (task.middlewares?.length) {
    indicators.push({ icon: <Layers size={8} className="text-purple-400" />, title: `${task.middlewares.length} middleware(s)` });
  }
  if (task.output) {
    indicators.push({ icon: <FileOutput size={8} className="text-tagma-muted/70" />, title: `Output: ${task.output}` });
  }

  return (
    <div
      ref={cardRef}
      data-task-card="true"
      className={`
        absolute border select-none flex flex-col justify-center px-2.5 gap-0.5
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
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
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

      {/* Row 1: Icon + Name + Indicator icons */}
      <div className="flex items-center gap-1.5">
        {isTemplate
          ? <Package size={9} className="text-purple-400/70 shrink-0 pointer-events-none" />
          : isCommand
            ? <Terminal size={9} className="text-tagma-info/70 shrink-0 pointer-events-none" />
            : <MessageSquare size={9} className="text-tagma-muted/50 shrink-0 pointer-events-none" />
        }

        <span className="text-[11px] font-medium truncate flex-1 pointer-events-none text-tagma-text leading-tight">
          {task.name || task.id}
        </span>

        <div className="flex items-center gap-0.5 shrink-0 pointer-events-none">
          {indicators.map((ind, i) => (
            <span key={i} title={ind.title}>{ind.icon}</span>
          ))}
          {isInvalid && <AlertTriangle size={9} className="text-tagma-warning" />}
        </div>
      </div>

      {/* Row 2: Driver + Model Tier + Permissions */}
      <div className="flex items-center gap-1 pointer-events-none">
        {driver && (
          <span className="text-[8px] font-mono text-tagma-accent/60 truncate max-w-[60px] leading-none">
            {driver}
          </span>
        )}
        {tierStyle && (
          <span className={`text-[7px] font-mono font-bold px-1 border leading-none py-px ${tierStyle}`}>
            {TIER_LABELS[tier!] ?? tier}
          </span>
        )}
        <PermBadges task={task} trackId={trackId} config={pipelineConfig} />
        <span className="flex-1" />
      </div>

      {/* Right handle (source) */}
      <div
        className="absolute -right-[4px] top-1/2 -translate-y-1/2 w-[8px] h-[8px]
          border border-tagma-border bg-tagma-bg cursor-crosshair
          hover:border-tagma-accent hover:bg-tagma-accent/20 transition-all duration-75"
        onPointerDown={(e) => { if (e.button === 0) { e.stopPropagation(); onHandlePointerDown(task.id, e); } }}
      />

      {/* Hover tooltip */}
      {hovered && !isDragging && cardRef.current && (
        <TaskTooltip task={task} trackId={trackId} config={pipelineConfig} anchorRect={cardRef.current.getBoundingClientRect()} />
      )}
    </div>
  );
}

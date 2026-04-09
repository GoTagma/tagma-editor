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

const TIER_STYLE: Record<string, string> = {
  high: 'text-blue-400',
  medium: 'text-tagma-muted',
  low: 'text-emerald-400',
};
const TIER_LABEL: Record<string, string> = { high: 'H', medium: 'M', low: 'L' };

/* ── Indicator icon (uniform 10×10 box) ── */
function Indicator({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <span className="inline-flex items-center justify-center w-[10px] h-[10px] shrink-0" title={title}>
      {icon}
    </span>
  );
}

/* ── Tooltip ── */
function TaskTooltip({ task, trackId, config, anchorRect }: {
  task: RawTaskConfig; trackId: string; config: RawPipelineConfig; anchorRect: DOMRect;
}) {
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
    const tW = el.getBoundingClientRect().width / z;
    const tH = el.getBoundingClientRect().height / z;
    const aLeft = anchorRect.left / z;
    const aTop = anchorRect.top / z;
    const aW = anchorRect.width / z;
    const aBottom = anchorRect.bottom / z;

    let left = aLeft + aW / 2 - tW / 2;
    left = Math.max(margin, Math.min(left, vw - tW - margin));
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
      className="fixed pointer-events-none bg-tagma-surface border border-tagma-border shadow-panel animate-fade-in"
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
      <div className="px-2.5 pt-2 pb-0.5 text-[10px] font-semibold text-tagma-text truncate border-b border-tagma-border/40 mb-1">
        {task.name || task.id}
      </div>
      <div className="px-2.5 pb-2 pt-0.5">
        {rows.map(([label, value]) => (
          <div key={label} className="flex h-[16px] items-center text-[9px] font-mono">
            <span className="text-tagma-muted w-[62px] shrink-0 truncate">{label}</span>
            <span className="text-tagma-text/80 truncate">{value}</span>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}

/* ── Main component ── */
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
  const track = pipelineConfig.tracks.find((t) => t.id === trackId);
  const perms = task.permissions ?? track?.permissions;

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

  // Collect indicator icons
  const indicators: { icon: React.ReactNode; title: string }[] = [];
  if (task.trigger) {
    const Icon = task.trigger.type === 'file' ? FileSearch : Lock;
    indicators.push({ icon: <Icon size={8} className="text-amber-400" />, title: `Trigger: ${task.trigger.type}` });
  }
  if (task.timeout) indicators.push({ icon: <Clock size={8} className="text-sky-400" />, title: `Timeout: ${task.timeout}` });
  if (task.completion) indicators.push({ icon: <CheckCircle2 size={8} className="text-emerald-400" />, title: `Completion: ${task.completion.type}` });
  if (task.middlewares?.length) indicators.push({ icon: <Layers size={8} className="text-purple-400" />, title: `${task.middlewares.length} middleware(s)` });
  if (task.output) indicators.push({ icon: <FileOutput size={8} className="text-tagma-muted/60" />, title: `Output: ${task.output}` });

  return (
    <div
      ref={cardRef}
      data-task-card="true"
      className={`
        absolute border select-none flex flex-col justify-center px-2.5
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

      {/* Row 1: Icon + Name + Indicators — fixed 22px height */}
      <div className="flex items-center h-[22px] gap-1">
        {/* Type icon — fixed 12px box */}
        <span className="inline-flex items-center justify-center w-3 h-3 shrink-0 pointer-events-none">
          {isTemplate
            ? <Package size={10} className="text-purple-400/70" />
            : isCommand
              ? <Terminal size={10} className="text-tagma-info/70" />
              : <MessageSquare size={10} className="text-tagma-muted/50" />
          }
        </span>

        <span className="text-[10px] font-medium truncate flex-1 pointer-events-none text-tagma-text leading-[22px]">
          {task.name || task.id}
        </span>

        {/* Indicator icons — each in a 10px box */}
        {indicators.map((ind, i) => (
          <Indicator key={i} icon={ind.icon} title={ind.title} />
        ))}
        {isInvalid && <Indicator icon={<AlertTriangle size={8} className="text-tagma-warning" />} title="Validation error" />}
      </div>

      {/* Row 2: Driver · Tier · R W X — fixed 16px height */}
      <div className="flex items-center h-[16px] gap-1.5 pointer-events-none">
        {driver && (
          <span className="text-[8px] font-mono text-tagma-accent/60 truncate max-w-[58px] leading-[16px]">
            {driver}
          </span>
        )}
        {tier && (
          <span className={`text-[8px] font-mono font-bold leading-[16px] ${TIER_STYLE[tier] ?? 'text-tagma-muted'}`}>
            {TIER_LABEL[tier] ?? tier}
          </span>
        )}
        {/* Separator dot between tier and perms */}
        {tier && perms && (
          <span className="text-[6px] text-tagma-muted/30 leading-[16px]">·</span>
        )}
        {perms && (
          <span className="flex items-center h-[16px] gap-[2px]">
            <span className={`text-[8px] font-mono font-bold leading-[16px] ${perms.read ? 'text-emerald-400' : 'text-tagma-muted/25'}`}>R</span>
            <span className={`text-[8px] font-mono font-bold leading-[16px] ${perms.write ? 'text-amber-400' : 'text-tagma-muted/25'}`}>W</span>
            <span className={`text-[8px] font-mono font-bold leading-[16px] ${perms.execute ? 'text-red-400' : 'text-tagma-muted/25'}`}>X</span>
          </span>
        )}
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

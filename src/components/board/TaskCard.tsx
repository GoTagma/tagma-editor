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
  errorMessages?: string[];
  isDragging: boolean;
  isTrackDragging: boolean;
  isEdgeTarget: boolean;
  onPointerDown: (taskId: string, e: React.PointerEvent) => void;
  onHandlePointerDown: (taskId: string, e: React.PointerEvent) => void;
  onTargetPointerUp: (taskId: string) => void;
  onContextMenu?: (taskId: string, e: React.MouseEvent) => void;
}

function resolveField<K extends 'driver' | 'model_tier'>(
  task: RawTaskConfig, trackId: string, config: RawPipelineConfig, field: K,
): string | undefined {
  if (task[field]) return task[field];
  const track = config.tracks.find((t) => t.id === trackId);
  if (track?.[field]) return track[field];
  if (field === 'driver') return config.driver;
  return undefined;
}

/* ── Tiny pill chip for meta items ── */
function Chip({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center h-[14px] px-[4px] rounded-sm text-[7.5px] font-mono leading-none ${className}`}>
      {children}
    </span>
  );
}

/* ── Error Tooltip ── */
function ErrorTooltip({ messages, anchorRect }: { messages: string[]; anchorRect: DOMRect }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const z = getZoom();
    const gap = 6, margin = 8;
    const vw = viewportW(), vh = viewportH();
    const tW = el.getBoundingClientRect().width / z;
    const tH = el.getBoundingClientRect().height / z;
    const aL = anchorRect.left / z, aT = anchorRect.top / z;
    const aW = anchorRect.width / z, aB = anchorRect.bottom / z;

    let left = aL + aW / 2 - tW / 2;
    left = Math.max(margin, Math.min(left, vw - tW - margin));
    let top = aT - gap - tH >= margin ? aT - gap - tH : aB + gap;
    top = Math.max(margin, Math.min(top, vh - tH - margin));
    setPos({ left, top });
  }, [anchorRect]);

  return createPortal(
    <div
      ref={ref}
      className="fixed pointer-events-none bg-[#1a1a1e] border border-red-500/40 shadow-lg rounded-[3px] animate-fade-in"
      style={{
        left: pos?.left ?? -9999, top: pos?.top ?? -9999,
        width: 260, maxHeight: viewportH() - 16,
        overflow: 'hidden', zIndex: 9999,
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      <div className="px-3 py-1.5">
        {messages.map((msg, i) => (
          <div key={i} className="flex items-start gap-1.5 py-[2px] text-[9px] font-mono">
            <AlertTriangle size={8} className="text-red-400 shrink-0 mt-[2px]" />
            <span className="text-red-300/90">{msg}</span>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}

/* ── Config Tooltip ── */
function TaskTooltip({ task, trackId, config, anchorRect }: {
  task: RawTaskConfig; trackId: string; config: RawPipelineConfig; anchorRect: DOMRect;
}) {
  const driver = resolveField(task, trackId, config, 'driver');
  const tier = resolveField(task, trackId, config, 'model_tier');
  const track = config.tracks.find((t) => t.id === trackId);
  const perms = task.permissions ?? track?.permissions;

  const isCmd = !!task.command;
  const rows: [string, string][] = [];
  // AI-specific fields only for prompt/template tasks
  if (!isCmd && driver) rows.push(['Driver', driver]);
  if (!isCmd && tier) rows.push(['Model', tier]);
  if (!isCmd && perms) {
    const parts = [perms.read && 'Read', perms.write && 'Write', perms.execute && 'Execute'].filter(Boolean);
    if (parts.length) rows.push(['Permissions', parts.join(', ')]);
  }
  if (task.timeout) rows.push(['Timeout', task.timeout]);
  if (task.trigger) rows.push(['Trigger', `${task.trigger.type}${task.trigger.message ? ` — ${task.trigger.message}` : ''}`]);
  if (task.completion) rows.push(['Completion', task.completion.type]);
  if (task.middlewares?.length) rows.push(['Middleware', task.middlewares.map((m) => m.type).join(', ')]);
  if (task.output) rows.push(['Output', task.output]);
  if (task.continue_from) rows.push(['Continue', task.continue_from]);
  if (task.cwd) rows.push(['CWD', task.cwd]);
  if (!isCmd && task.agent_profile) rows.push(['Profile', task.agent_profile]);
  if (task.use) rows.push(['Template', task.use]);
  if (task.prompt) rows.push(['Prompt', task.prompt.length > 60 ? task.prompt.slice(0, 60) + '…' : task.prompt]);
  if (task.command) rows.push(['Command', task.command.length > 60 ? task.command.slice(0, 60) + '…' : task.command]);

  const tooltipRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = tooltipRef.current;
    if (!el) return;
    const z = getZoom();
    const gap = 6, margin = 8;
    const vw = viewportW(), vh = viewportH();
    const tW = el.getBoundingClientRect().width / z;
    const tH = el.getBoundingClientRect().height / z;
    const aL = anchorRect.left / z, aT = anchorRect.top / z;
    const aW = anchorRect.width / z, aB = anchorRect.bottom / z;

    let left = aL + aW / 2 - tW / 2;
    left = Math.max(margin, Math.min(left, vw - tW - margin));
    let top = aT - gap - tH >= margin ? aT - gap - tH : aB + gap;
    top = Math.max(margin, Math.min(top, vh - tH - margin));
    setPos({ left, top });
  }, [anchorRect]);

  if (rows.length === 0) return null;

  return createPortal(
    <div
      ref={tooltipRef}
      className="fixed pointer-events-none bg-[#1a1a1e] border border-[#2a2a30] shadow-lg rounded-[3px] animate-fade-in"
      style={{
        left: pos?.left ?? -9999, top: pos?.top ?? -9999,
        width: 260, maxHeight: viewportH() - 16,
        overflow: 'hidden', zIndex: 9999,
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      <div className="px-3 py-1.5 text-[10px] font-semibold text-tagma-text truncate border-b border-[#2a2a30]">
        {task.name || task.id}
      </div>
      <div className="px-3 py-1.5">
        {rows.map(([label, value]) => (
          <div key={label} className="flex py-[1.5px] text-[9px] font-mono gap-2 min-w-0">
            <span className="text-tagma-muted/70 w-[72px] shrink-0 truncate">{label}</span>
            <span className="text-tagma-text/80 truncate min-w-0 flex-1">{value}</span>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}

/* ── Main ── */
export function TaskCard({
  task, trackId, pipelineConfig, x, y, w, h,
  isSelected, isInvalid, errorMessages, isDragging, isTrackDragging, isEdgeTarget,
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
    : isInvalid ? 'border-red-500/60'
    : isSelected ? 'border-tagma-accent'
    : isEdgeTarget ? 'border-tagma-accent/60'
    : 'border-tagma-border/70';

  const bgColor = isDragging
    ? 'bg-tagma-accent/10'
    : isInvalid ? 'bg-red-500/8'
    : isSelected ? 'bg-tagma-accent/6'
    : isEdgeTarget ? 'bg-tagma-accent/4'
    : 'bg-tagma-elevated hover:bg-tagma-elevated/80';

  // Status indicators (compact)
  const badges: React.ReactNode[] = [];
  if (task.trigger) {
    const I = task.trigger.type === 'file' ? FileSearch : Lock;
    badges.push(<I key="trg" size={7} className="text-amber-400/80" />);
  }
  if (task.timeout) badges.push(<Clock key="to" size={7} className="text-sky-400/70" />);
  if (task.completion) badges.push(<CheckCircle2 key="ck" size={7} className="text-emerald-400/70" />);
  if (task.middlewares?.length) badges.push(<Layers key="mw" size={7} className="text-purple-400/70" />);
  if (task.output) badges.push(<FileOutput key="out" size={7} className="text-tagma-muted/50" />);

  return (
    <div
      ref={cardRef}
      data-task-card="true"
      className={`
        absolute border select-none flex flex-col justify-center px-2.5 rounded-[2px]
        ${borderColor} ${bgColor}
        ${isDragging ? 'z-30 shadow-glow-accent cursor-grabbing' : 'cursor-grab active:cursor-grabbing'}
      `}
      style={{
        left: x, top: y, width: w, height: h,
        transition: (isDragging || isTrackDragging) ? 'none' : 'left 100ms ease-out, top 100ms ease-out',
      }}
      onPointerDown={(e) => { if (e.button === 0) onPointerDown(task.id, e); }}
      onPointerUp={() => onTargetPointerUp(task.id)}
      onContextMenu={(e) => { if (onContextMenu) onContextMenu(task.id, e); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Connection handles */}
      <div className={`
        absolute -left-[4px] top-1/2 -translate-y-1/2 w-[8px] h-[8px]
        border bg-tagma-bg transition-all duration-75
        ${isEdgeTarget ? 'border-tagma-accent bg-tagma-accent scale-125' : 'border-tagma-border hover:border-tagma-accent'}
      `} />
      <div
        className="absolute -right-[4px] top-1/2 -translate-y-1/2 w-[8px] h-[8px]
          border border-tagma-border bg-tagma-bg cursor-crosshair
          hover:border-tagma-accent hover:bg-tagma-accent/20 transition-all duration-75"
        onPointerDown={(e) => { if (e.button === 0) { e.stopPropagation(); onHandlePointerDown(task.id, e); } }}
      />
      {isSelected && <div className={`absolute left-0 top-0 bottom-0 w-[2px] rounded-l-[2px] ${isInvalid ? 'bg-red-500' : 'bg-tagma-accent'}`} />}

      {/* ─── Row 1: Type icon · Name · Status badges ─── */}
      <div className="flex items-center h-[24px] gap-[6px] pointer-events-none min-w-0 overflow-hidden">
        <span className={`inline-flex items-center justify-center w-[16px] h-[16px] rounded-[2px] shrink-0
          ${isTemplate ? 'bg-purple-500/10' : isCommand ? 'bg-sky-500/10' : 'bg-tagma-muted/8'}`}>
          {isTemplate
            ? <Package size={9} className="text-purple-400" />
            : isCommand
              ? <Terminal size={9} className="text-sky-400" />
              : <MessageSquare size={9} className="text-tagma-muted/60" />}
        </span>

        <span className="text-[10px] font-medium text-tagma-text truncate flex-1 leading-[24px]">
          {task.name || task.id}
        </span>

        {badges.length > 0 && (
          <span className="flex items-center gap-[3px] shrink-0">
            {badges}
          </span>
        )}
        {isInvalid && <AlertTriangle size={8} className="text-red-400 shrink-0" />}
      </div>

      {/* ─── Row 2: Driver chip · Tier chip · Permissions (prompt/template only) ─── */}
      {!isCommand && (
        <div className="flex items-center h-[16px] gap-[4px] pointer-events-none min-w-0 overflow-hidden">
          {driver && (
            <Chip className="bg-tagma-accent/8 text-tagma-accent/70">{driver}</Chip>
          )}
          {tier && (
            <Chip className={`font-bold ${
              tier === 'high' ? 'bg-blue-500/10 text-blue-400/80'
              : tier === 'low' ? 'bg-emerald-500/10 text-emerald-400/80'
              : 'bg-tagma-muted/8 text-tagma-muted/70'
            }`}>
              {tier === 'high' ? 'HIGH' : tier === 'medium' ? 'MED' : tier === 'low' ? 'LOW' : tier}
            </Chip>
          )}
          {perms && (
            <span className="flex items-center h-[14px] gap-[1px] ml-auto">
              {(['read', 'write', 'execute'] as const).map((k) => (
                <span key={k} className={`text-[7px] font-mono font-bold w-[10px] text-center leading-[14px]
                  ${k === 'read' && perms.read ? 'text-emerald-400' : ''}
                  ${k === 'write' && perms.write ? 'text-amber-400' : ''}
                  ${k === 'execute' && perms.execute ? 'text-red-400' : ''}
                  ${!perms[k] ? 'text-tagma-muted/20' : ''}
                `}>
                  {k[0].toUpperCase()}
                </span>
              ))}
            </span>
          )}
        </div>
      )}

      {/* Hover tooltip */}
      {hovered && !isDragging && cardRef.current && (
        isInvalid && errorMessages?.length
          ? <ErrorTooltip messages={errorMessages} anchorRect={cardRef.current.getBoundingClientRect()} />
          : <TaskTooltip task={task} trackId={trackId} config={pipelineConfig} anchorRect={cardRef.current.getBoundingClientRect()} />
      )}
    </div>
  );
}

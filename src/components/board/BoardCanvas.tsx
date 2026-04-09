import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { Plus, Trash2, Pencil, ListPlus } from 'lucide-react';
import { TrackLane } from './TrackLane';
import { TaskCard } from './TaskCard';
import { ContextMenu, type MenuEntry } from './ContextMenu';
import type { RawPipelineConfig, RawTrackConfig, RawTaskConfig } from '../../api/client';

import type { TaskPosition } from '../../store/pipeline-store';
import type { DagEdge } from '../../api/client';
import { getZoom } from '../../utils/zoom';

// ── Layout constants ──
const HEADER_W = 210;
const TASK_W = 176;
const TASK_H = 52;
const TASK_GAP = 24;
const PAD_LEFT = 20;
const TRACK_H = 64;
const DRAG_THRESHOLD = 4;
const CANVAS_PAD_RIGHT = 300;

interface Pos { x: number; y: number }

interface BoardCanvasProps {
  config: RawPipelineConfig;
  dagEdges: DagEdge[];
  positions: Map<string, TaskPosition>;
  selectedTaskId: string | null;
  invalidTaskIds: Set<string>;
  errorsByTask: Map<string, string[]>;
  errorsByTrack: Map<string, string[]>;
  onSelectTask: (qualifiedId: string | null) => void;
  onSelectTrack: (trackId: string | null) => void;
  onAddTask: (trackId: string, name: string, positionX?: number) => void;
  onAddTrack: (name: string) => void;
  onDeleteTask: (trackId: string, taskId: string) => void;
  onDeleteTrack: (trackId: string) => void;
  onRenameTrack: (trackId: string, name: string) => void;
  onMoveTrackTo: (trackId: string, toIndex: number) => void;
  onAddDependency: (fromTrackId: string, fromTaskId: string, toTrackId: string, toTaskId: string) => void;
  onRemoveDependency: (trackId: string, taskId: string, depRef: string) => void;
  onSetTaskPosition: (qualifiedId: string, x: number) => void;
  onTransferTask: (fromTrackId: string, taskId: string, toTrackId: string) => void;
}

// Flatten tasks for rendering
interface FlatTask {
  trackId: string;
  task: RawTaskConfig;
  qid: string;
}

function flattenTasks(config: RawPipelineConfig): FlatTask[] {
  const result: FlatTask[] = [];
  for (const track of config.tracks) {
    for (const task of track.tasks) {
      result.push({ trackId: track.id, task, qid: `${track.id}.${task.id}` });
    }
  }
  return result;
}

function buildPositions(
  tracks: readonly RawTrackConfig[],
  allTasks: FlatTask[],
  storedPositions: Map<string, TaskPosition>,
) {
  const m = new Map<string, Pos>();
  let y = 0;
  for (const tr of tracks) {
    const tasksInTrack = allTasks.filter((ft) => ft.trackId === tr.id);
    tasksInTrack.forEach((ft, i) => {
      const stored = storedPositions.get(ft.qid);
      const x = stored ? stored.x : PAD_LEFT + i * (TASK_W + TASK_GAP);
      m.set(ft.qid, { x, y: y + (TRACK_H - TASK_H) / 2 });
    });
    y += TRACK_H;
  }
  return m;
}

function trackTopY(tracks: readonly RawTrackConfig[], trackId: string): number {
  let y = 0;
  for (const tr of tracks) {
    if (tr.id === trackId) return y;
    y += TRACK_H;
  }
  return y;
}

function trackAtY(tracks: readonly RawTrackConfig[], cursorY: number): string | null {
  let y = 0;
  for (const tr of tracks) {
    if (cursorY >= y && cursorY < y + TRACK_H) return tr.id;
    y += TRACK_H;
  }
  return null;
}

function stepPath(s: Pos, t: Pos) {
  const sx = s.x + TASK_W, sy = s.y + TASK_H / 2;
  const tx = t.x, ty = t.y + TASK_H / 2;
  return `M${sx} ${sy} H${(sx + tx) / 2} V${ty} H${tx}`;
}

function toContent(e: { clientX: number; clientY: number }, el: HTMLDivElement) {
  const r = el.getBoundingClientRect();
  const z = getZoom();
  // clientX/rect.left are in screen pixels; scrollLeft is in logical pixels.
  // Convert screen offset to logical before combining with scroll.
  return { x: (e.clientX - r.left) / z + el.scrollLeft, y: (e.clientY - r.top) / z + el.scrollTop };
}

function findNearestTarget(mx: number, my: number, positions: Map<string, Pos>, exclude: string): string | null {
  let best: string | null = null, bestD = 24;
  for (const [id, p] of positions) {
    if (id === exclude) continue;
    const d = Math.hypot(mx - p.x, my - (p.y + TASK_H / 2));
    if (d < bestD) { bestD = d; best = id; }
  }
  return best;
}

interface CtxState { x: number; y: number; items: MenuEntry[] }
interface TaskDragState { qid: string; taskId: string; trackId: string; contentX: number; targetTrackId: string }
interface EdgeDragState { srcQid: string; mx: number; my: number; target: string | null }
interface TrackDragState { trackId: string; startIndex: number; dropIndex: number; deltaY: number }

export function BoardCanvas({
  config, dagEdges, positions: storedPositions, selectedTaskId, invalidTaskIds, errorsByTask, errorsByTrack,
  onSelectTask, onSelectTrack, onAddTask, onAddTrack, onDeleteTask, onDeleteTrack,
  onRenameTrack, onMoveTrackTo, onAddDependency, onRemoveDependency,
  onSetTaskPosition, onTransferTask,
}: BoardCanvasProps) {
  const headerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [taskDrag, setTaskDrag] = useState<TaskDragState | null>(null);
  const [edgeDrag, setEdgeDrag] = useState<EdgeDragState | null>(null);
  const [trackDrag, setTrackDrag] = useState<TrackDragState | null>(null);
  const [hovEdge, setHovEdge] = useState<string | null>(null);
  const [selEdge, setSelEdge] = useState<string | null>(null);
  const [ctx, setCtx] = useState<CtxState | null>(null);
  const dropRef = useRef<{ trackId: string; positionX: number } | null>(null);
  const nearRef = useRef<string | null>(null);

  const [inlineAdd, setInlineAdd] = useState<{ type: 'task'; trackId: string; positionX?: number } | { type: 'track' } | { type: 'rename'; trackId: string } | null>(null);
  const [inlineValue, setInlineValue] = useState('');
  const inlineRef = useRef<HTMLInputElement>(null);

  const closeCtx = useCallback(() => setCtx(null), []);

  const tracks = config.tracks;
  const allTasks = useMemo(() => flattenTasks(config), [config]);

  // Build a lookup: qid → task for quick access
  const taskByQid = useMemo(() => {
    const m = new Map<string, RawTaskConfig>();
    for (const ft of allTasks) m.set(ft.qid, ft.task);
    return m;
  }, [allTasks]);

  // Visual sort during track drag
  const visualTracks = useMemo(() => {
    if (!trackDrag) return tracks;
    const { trackId, dropIndex } = trackDrag;
    const without = tracks.filter((t) => t.id !== trackId);
    const dragged = tracks.find((t) => t.id === trackId);
    if (!dragged) return tracks;
    const result = [...without];
    result.splice(Math.min(dropIndex, result.length), 0, dragged);
    return result;
  }, [tracks, trackDrag]);

  const staticPositions = useMemo(() => buildPositions(visualTracks, allTasks, storedPositions), [visualTracks, allTasks, storedPositions]);

  const positionsMap = useMemo(() => {
    if (!taskDrag) return staticPositions;
    const result = new Map(staticPositions);
    const targetY = trackTopY(visualTracks, taskDrag.targetTrackId);
    result.set(taskDrag.qid, { x: Math.max(PAD_LEFT, taskDrag.contentX), y: targetY + (TRACK_H - TASK_H) / 2 });
    return result;
  }, [taskDrag, staticPositions, visualTracks]);

  const syncScroll = useCallback(() => {
    if (headerRef.current && contentRef.current)
      headerRef.current.scrollTop = contentRef.current.scrollTop;
  }, []);

  const { contentW, contentH } = useMemo(() => {
    let maxX = 0;
    for (const [, pos] of positionsMap) {
      if (pos.x + TASK_W > maxX) maxX = pos.x + TASK_W;
    }
    return { contentW: Math.max(maxX + CANVAS_PAD_RIGHT, 2000), contentH: Math.max(visualTracks.length * TRACK_H, 200) };
  }, [positionsMap, visualTracks]);

  const panDidDragRef = useRef(false);

  const handleBackgroundPanMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = contentRef.current;
    if (!el) return;
    const startX = e.clientX, startY = e.clientY;
    const startSL = el.scrollLeft, startST = el.scrollTop;
    let started = false;
    panDidDragRef.current = false;

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (!started) { if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return; started = true; panDidDragRef.current = true; }
      const z = getZoom();
      el.scrollLeft = startSL - dx / z;
      el.scrollTop = startST - dy / z;
    };
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); document.body.style.cursor = ''; document.body.style.userSelect = ''; };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
  }, []);

  // ── Task drag ──
  const handleTaskPointerDown = useCallback((taskId: string, e: React.PointerEvent) => {
    e.preventDefault();
    const el = contentRef.current;
    if (!el) return;
    // Find which track this task belongs to
    const ft = allTasks.find((t) => t.task.id === taskId);
    if (!ft) return;
    const qid = ft.qid;
    const pos = staticPositions.get(qid);
    if (!pos) return;
    const cp = toContent(e, el);
    const offX = cp.x - pos.x;
    const startCX = e.clientX, startCY = e.clientY;
    let started = false;

    const onMove = (ev: PointerEvent) => {
      if (!started) { if (Math.abs(ev.clientX - startCX) + Math.abs(ev.clientY - startCY) < DRAG_THRESHOLD) return; started = true; }
      const c = toContent(ev, el);
      const cx = Math.max(PAD_LEFT, c.x - offX);
      const trkId = trackAtY(visualTracks, c.y) ?? ft.trackId;
      dropRef.current = { trackId: trkId, positionX: cx };
      setTaskDrag({ qid, taskId, trackId: ft.trackId, contentX: cx, targetTrackId: trkId });
    };

    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (!started) {
        onSelectTask(qid);
      } else {
        const d = dropRef.current;
        if (d) {
          onSetTaskPosition(`${d.trackId}.${taskId}`, d.positionX);
          if (d.trackId !== ft.trackId) {
            onTransferTask(ft.trackId, taskId, d.trackId);
          }
        }
      }
      dropRef.current = null;
      setTaskDrag(null);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.body.style.userSelect = 'none';
  }, [staticPositions, visualTracks, allTasks, onSelectTask, onSetTaskPosition, onTransferTask]);

  // ── Edge drag ──
  const handleHandlePointerDown = useCallback((taskId: string, _e: React.PointerEvent) => {
    _e.preventDefault();
    const el = contentRef.current;
    if (!el) return;
    const ft = allTasks.find((t) => t.task.id === taskId);
    if (!ft) return;
    const srcQid = ft.qid;

    const onMove = (ev: PointerEvent) => {
      const cp = toContent(ev, el);
      const near = findNearestTarget(cp.x, cp.y, positionsMap, srcQid);
      nearRef.current = near;
      setEdgeDrag({ srcQid, mx: cp.x, my: cp.y, target: near });
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      const targetQid = nearRef.current;
      if (targetQid) {
        const [srcTrack, srcTask] = srcQid.split('.');
        const [tgtTrack, tgtTask] = targetQid.split('.');
        onAddDependency(srcTrack, srcTask, tgtTrack, tgtTask);
      }
      nearRef.current = null;
      setEdgeDrag(null);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.body.style.cursor = 'crosshair';
  }, [allTasks, positionsMap, onAddDependency]);

  const handleTargetPointerUp = useCallback((taskId: string) => {
    if (edgeDrag) {
      const ft = allTasks.find((t) => t.task.id === taskId);
      if (ft && ft.qid !== edgeDrag.srcQid) nearRef.current = ft.qid;
    }
  }, [edgeDrag, allTasks]);

  // ── Track drag ──
  const handleTrackDragStart = useCallback((trackId: string, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startIndex = tracks.findIndex((t) => t.id === trackId);
    if (startIndex < 0) return;
    const headerEl = headerRef.current;
    if (!headerEl) return;
    const headerRect = headerEl.getBoundingClientRect();
    let started = false;
    const startClientY = e.clientY;
    const startRelY = (e.clientY - headerRect.top) / getZoom() + headerEl.scrollTop;
    const grabOffsetY = startRelY - startIndex * TRACK_H;

    const onMove = (ev: PointerEvent) => {
      if (!started) { if (Math.abs(ev.clientY - startClientY) < DRAG_THRESHOLD) return; started = true; }
      const relY = (ev.clientY - headerRect.top) / getZoom() + headerEl.scrollTop;
      const deltaY = relY - startRelY;
      // Use dragged track center for drop index — provides natural hysteresis
      const draggedCenterY = relY - grabOffsetY + TRACK_H / 2;
      const dropIdx = Math.max(0, Math.min(tracks.length - 1, Math.floor(draggedCenterY / TRACK_H)));
      setTrackDrag({ trackId, startIndex, dropIndex: dropIdx, deltaY });
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (started) {
        const current = trackDragRef.current;
        if (current && current.startIndex !== current.dropIndex) {
          onMoveTrackTo(trackId, current.dropIndex);
        }
      } else {
        onSelectTrack(trackId);
      }
      setTrackDrag(null);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
  }, [tracks, onMoveTrackTo, onSelectTrack]);

  const trackDragRef = useRef<TrackDragState | null>(null);
  useEffect(() => { trackDragRef.current = trackDrag; }, [trackDrag]);

  // ── Context menus ──
  const handleHeaderContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const headerEl = headerRef.current;
    if (!headerEl) return;
    const rect = headerEl.getBoundingClientRect();
    const relY = (e.clientY - rect.top) / getZoom() + headerEl.scrollTop;
    const trackId = trackAtY(visualTracks, relY);

    if (!trackId) {
      setCtx({ x: e.clientX, y: e.clientY, items: [{ label: 'Add Track', icon: <ListPlus size={12} />, onAction: () => { setInlineAdd({ type: 'track' }); setInlineValue(''); } }] });
      return;
    }

    const track = config.tracks.find((t) => t.id === trackId);
    setCtx({
      x: e.clientX, y: e.clientY,
      items: [
        { label: 'Add Task', icon: <Plus size={12} />, onAction: () => { setInlineAdd({ type: 'task', trackId }); setInlineValue(''); } },
        { label: 'Rename Track', icon: <Pencil size={12} />, onAction: () => { setInlineAdd({ type: 'rename', trackId }); setInlineValue(track?.name ?? ''); } },
        { separator: true },
        { label: 'Add Track', icon: <ListPlus size={12} />, onAction: () => { setInlineAdd({ type: 'track' }); setInlineValue(''); } },
        { label: 'Delete Track', icon: <Trash2 size={12} />, danger: true, onAction: () => onDeleteTrack(trackId) },
      ],
    });
  }, [visualTracks, config.tracks, onDeleteTrack]);

  const handleTaskContextMenu = useCallback((taskId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const ft = allTasks.find((t) => t.task.id === taskId);
    if (!ft) return;
    setCtx({
      x: e.clientX, y: e.clientY,
      items: [
        { label: 'Delete Task', icon: <Trash2 size={12} />, danger: true, onAction: () => onDeleteTask(ft.trackId, taskId) },
      ],
    });
  }, [allTasks, onDeleteTask]);

  const handleCanvasContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const el = contentRef.current;
    if (!el) return;
    const cp = toContent(e, el);
    const trackId = trackAtY(visualTracks, cp.y);
    if (!trackId) return;
    const clickX = Math.max(PAD_LEFT, cp.x);
    setCtx({
      x: e.clientX, y: e.clientY,
      items: [{ label: 'Add Task Here', icon: <Plus size={12} />, onAction: () => { setInlineAdd({ type: 'task', trackId, positionX: clickX }); setInlineValue(''); } }],
    });
  }, [visualTracks]);

  useEffect(() => { if (inlineAdd && inlineRef.current) inlineRef.current.focus(); }, [inlineAdd]);

  const commitInlineAdd = useCallback(() => {
    const name = inlineValue.trim();
    if (!name || !inlineAdd) { setInlineAdd(null); return; }
    if (inlineAdd.type === 'task') onAddTask(inlineAdd.trackId, name, inlineAdd.positionX);
    else if (inlineAdd.type === 'track') onAddTrack(name);
    else if (inlineAdd.type === 'rename') onRenameTrack(inlineAdd.trackId, name);
    setInlineAdd(null);
    setInlineValue('');
  }, [inlineValue, inlineAdd, onAddTask, onAddTrack, onRenameTrack]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setTaskDrag(null); setEdgeDrag(null); setTrackDrag(null); setCtx(null); setInlineAdd(null); setSelEdge(null); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Build edge key for selection
  const edgeKey = (from: string, to: string) => `${from}->${to}`;

  return (
    <div className="h-full w-full min-w-0 flex bg-tagma-bg relative">
      {/* Left: Track headers */}
      <div
        ref={headerRef}
        className="shrink-0 border-r border-tagma-border overflow-hidden bg-tagma-surface/50"
        style={{ width: HEADER_W }}
        onContextMenu={handleHeaderContextMenu}
      >
        {tracks.map((track, origIdx) => {
          const taskCount = track.tasks.length;
          // Check if tasks have dependencies connecting them all
          const depCount = dagEdges.filter((e) => e.from.startsWith(track.id + '.') && e.to.startsWith(track.id + '.')).length;
          const hasParallel = taskCount > 1 && depCount < taskCount - 1;
          const isDraggedTrack = trackDrag?.trackId === track.id;

          let translateY = 0;
          if (trackDrag) {
            if (isDraggedTrack) {
              translateY = trackDrag.deltaY;
            } else {
              const visIdx = visualTracks.findIndex((t) => t.id === track.id);
              translateY = (visIdx - origIdx) * TRACK_H;
            }
          }

          return (
            <div
              key={track.id}
              className={`relative border-b border-tagma-border/60 ${isDraggedTrack ? 'opacity-60 bg-tagma-accent/5' : ''}`}
              style={{
                height: TRACK_H,
                transform: translateY ? `translateY(${translateY}px)` : undefined,
                transition: trackDrag ? (isDraggedTrack ? 'none' : 'transform 150ms ease-out') : undefined,
                zIndex: isDraggedTrack ? 10 : 0,
                position: 'relative',
              }}
            >
              {/* Color bar on left edge — red if track has errors */}
              <div className="absolute left-0 top-0"
                style={{ width: 3, height: TRACK_H - 1, backgroundColor: errorsByTrack.has(track.id) ? '#ef4444' : (track.color || 'transparent') }} />
              <div className="h-full flex items-center cursor-grab active:cursor-grabbing" onPointerDown={(e) => handleTrackDragStart(track.id, e)}>
                <TrackLane track={track} taskCount={taskCount} hasParallelWarning={hasParallel} errorMessages={errorsByTrack.get(track.id)} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Right: Timeline canvas */}
      <div
        ref={contentRef}
        className="flex-1 min-w-0 overflow-auto timeline-grid hide-scrollbar"
        onScroll={syncScroll}
        onContextMenu={handleCanvasContextMenu}
        onMouseDown={handleBackgroundPanMouseDown}
        onClick={(e) => { if (e.target === e.currentTarget) { onSelectTask(null); onSelectTrack(null); setSelEdge(null); } }}
      >
        <div className="relative w-full cursor-grab active:cursor-grabbing" style={{ minWidth: contentW, minHeight: contentH }}>
          {/* Row backgrounds */}
          {visualTracks.map((track, i) => (
            <div
              key={`bg-${track.id}`}
              className={`absolute left-0 right-0 border-b border-tagma-border/40 cursor-grab active:cursor-grabbing ${i % 2 === 0 ? 'track-row-even' : 'track-row-odd'}`}
              style={{ top: i * TRACK_H, height: TRACK_H }}
              onMouseDown={handleBackgroundPanMouseDown}
              onClick={() => { if (!panDidDragRef.current) { onSelectTask(null); onSelectTrack(null); setSelEdge(null); } }}
            />
          ))}

          {/* Task cards */}
          {allTasks.map((ft) => {
            const pos = positionsMap.get(ft.qid);
            if (!pos) return null;
            return (
              <TaskCard
                key={ft.qid}
                task={ft.task}
                trackId={ft.trackId}
                pipelineConfig={config}
                x={pos.x} y={pos.y} w={TASK_W} h={TASK_H}
                isSelected={selectedTaskId === ft.qid}
                isInvalid={invalidTaskIds.has(ft.qid)}
                errorMessages={errorsByTask.get(ft.qid)}
                isDragging={taskDrag?.qid === ft.qid}
                isTrackDragging={trackDrag !== null}
                isEdgeTarget={edgeDrag !== null && edgeDrag.srcQid !== ft.qid && edgeDrag.target === ft.qid}
                onPointerDown={handleTaskPointerDown}
                onHandlePointerDown={handleHandlePointerDown}
                onTargetPointerUp={handleTargetPointerUp}
                onContextMenu={handleTaskContextMenu}
              />
            );
          })}

          {/* SVG edges */}
          <svg className="absolute inset-0 pointer-events-none" width={contentW} height={contentH} style={{ overflow: 'visible' }}>
            <defs>
              <marker id="ah" markerWidth="7" markerHeight="5" refX="7" refY="2.5" orient="auto">
                <polygon points="0 0, 7 2.5, 0 5" fill="#666" fillOpacity="0.7" />
              </marker>
              <marker id="ah-hi" markerWidth="7" markerHeight="5" refX="7" refY="2.5" orient="auto">
                <polygon points="0 0, 7 2.5, 0 5" fill="#d4845a" />
              </marker>
              <marker id="ah-cont" markerWidth="7" markerHeight="5" refX="7" refY="2.5" orient="auto">
                <polygon points="0 0, 7 2.5, 0 5" fill="#a78bfa" fillOpacity="0.8" />
              </marker>
              <marker id="ah-cont-hi" markerWidth="7" markerHeight="5" refX="7" refY="2.5" orient="auto">
                <polygon points="0 0, 7 2.5, 0 5" fill="#c4b5fd" />
              </marker>
            </defs>

            {dagEdges.map((edge) => {
              const sp = positionsMap.get(edge.from);
              const tp = positionsMap.get(edge.to);
              if (!sp || !tp) return null;
              const d = stepPath(sp, tp);
              const ek = edgeKey(edge.from, edge.to);
              const selected = selEdge === ek;
              const hovered = hovEdge === ek;
              const highlighted = selected || hovered;
              const sx = sp.x + TASK_W, sy = sp.y + TASK_H / 2;
              const tx = tp.x, ty = tp.y + TASK_H / 2;
              const midX = (sx + tx) / 2, midY = (sy + ty) / 2;
              const fromTask = taskByQid.get(edge.from);
              const toTask = taskByQid.get(edge.to);
              const isContinue = !!fromTask?.prompt && !fromTask?.command && !!toTask?.prompt && !toTask?.command;

              return (
                <g key={ek}>
                  <path d={d} fill="none" stroke="transparent" strokeWidth={14}
                    className="pointer-events-auto cursor-pointer"
                    onMouseEnter={() => { if (!selEdge) setHovEdge(ek); }}
                    onMouseLeave={() => { if (!selEdge) setHovEdge(null); }}
                    onClick={(e) => { e.stopPropagation(); setSelEdge(selected ? null : ek); setHovEdge(null); }} />
                  <path d={d} fill="none"
                    stroke={highlighted
                      ? (isContinue ? '#c4b5fd' : '#d4845a')
                      : (isContinue ? 'rgba(167, 139, 250, 0.5)' : 'rgba(100, 100, 100, 0.4)')}
                    strokeWidth={highlighted ? 2 : 1}
                    strokeDasharray={isContinue ? '6 3' : undefined}
                    markerEnd={highlighted
                      ? (isContinue ? 'url(#ah-cont-hi)' : 'url(#ah-hi)')
                      : (isContinue ? 'url(#ah-cont)' : 'url(#ah)')}
                    className="transition-[stroke,stroke-width] duration-75" />
                  {selected && (
                    <g className="pointer-events-auto cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelEdge(null);
                        // Remove the dependency
                        const [toTrack, toTask] = edge.to.split('.');
                        // Find the dep ref used in the task
                        const track = config.tracks.find((t) => t.id === toTrack);
                        const task = track?.tasks.find((t) => t.id === toTask);
                        if (task?.depends_on) {
                          // Find which ref resolves to edge.from
                          for (const dep of task.depends_on) {
                            const resolved = dep.includes('.') ? dep : (track!.tasks.some((t) => t.id === dep) ? `${toTrack}.${dep}` : dep);
                            if (resolved === edge.from || `${toTrack}.${dep}` === edge.from) {
                              onRemoveDependency(toTrack, toTask, dep);
                              break;
                            }
                          }
                        }
                      }}>
                      <rect x={midX - 8} y={midY - 8} width={16} height={16} rx={0}
                        fill="#1e1e1e" stroke="#f87171" strokeWidth={1.2} />
                      <line x1={midX - 3} y1={midY - 3} x2={midX + 3} y2={midY + 3} stroke="#f87171" strokeWidth={1.5} />
                      <line x1={midX + 3} y1={midY - 3} x2={midX - 3} y2={midY + 3} stroke="#f87171" strokeWidth={1.5} />
                    </g>
                  )}
                </g>
              );
            })}

            {edgeDrag && (() => {
              const sp = positionsMap.get(edgeDrag.srcQid);
              if (!sp) return null;
              const sx = sp.x + TASK_W, sy = sp.y + TASK_H / 2;
              const tp = edgeDrag.target ? positionsMap.get(edgeDrag.target) : null;
              const ex = tp ? tp.x : edgeDrag.mx;
              const ey = tp ? tp.y + TASK_H / 2 : edgeDrag.my;
              if (tp) {
                const mx2 = (sx + ex) / 2;
                return <path d={`M${sx} ${sy} H${mx2} V${ey} H${ex}`} fill="none" stroke="#d4845a" strokeWidth={1.5} strokeDasharray="5 3" opacity={0.7} />;
              }
              return <line x1={sx} y1={sy} x2={ex} y2={ey} stroke="#d4845a" strokeWidth={1} strokeDasharray="4 4" opacity={0.4} />;
            })()}
          </svg>
        </div>
      </div>

      {/* Inline name input */}
      {inlineAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setInlineAdd(null)}>
          <div className="bg-tagma-surface border border-tagma-border shadow-panel p-3 animate-fade-in w-64" onClick={(e) => e.stopPropagation()}>
            <label className="text-[10px] font-mono text-tagma-muted uppercase tracking-wider mb-1.5 block">
              {inlineAdd.type === 'task' ? 'New Task Name' : inlineAdd.type === 'rename' ? 'Rename Track' : 'New Track Name'}
            </label>
            <input ref={inlineRef} type="text" value={inlineValue}
              onChange={(e) => setInlineValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') commitInlineAdd(); if (e.key === 'Escape') setInlineAdd(null); }}
              placeholder={inlineAdd.type === 'task' ? 'Task name...' : 'Track name...'}
              className="field-input" autoFocus />
            <div className="flex justify-end gap-2 mt-2">
              <button onClick={() => setInlineAdd(null)} className="text-[10px] text-tagma-muted hover:text-tagma-text">Cancel</button>
              <button onClick={commitInlineAdd} className="btn-primary text-[10px]">{inlineAdd.type === 'rename' ? 'Rename' : 'Create'}</button>
            </div>
          </div>
        </div>
      )}

      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctx.items} onClose={closeCtx} />}
    </div>
  );
}

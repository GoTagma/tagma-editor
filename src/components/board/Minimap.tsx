import { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { Map as MapIcon, X } from 'lucide-react';
import { usePipelineStore } from '../../store/pipeline-store';
import { getZoom } from '../../utils/zoom';

// Layout constants must match BoardCanvas.
const TASK_W = 176;
const TASK_H = 52;
const TRACK_H = 64;
const PAD_LEFT = 20;
const SCROLL_ELEMENT_ID = 'board-scroll';

/**
 * Self-contained minimap: reads pipeline config + positions from the store and
 * queries the canvas scroll viewport by id. Can be rendered anywhere in the
 * tree — previously it lived inside BoardCanvas with an absolute bottom-left
 * position (which overlapped tracks). Now it is embedded at the bottom of the
 * right-side config panels.
 */
export function Minimap() {
  const config = usePipelineStore((s) => s.config);
  const positions = usePipelineStore((s) => s.positions);
  const tracks = config?.tracks ?? [];

  const [visible, setVisible] = useState(true);
  const [scrollTick, setScrollTick] = useState(0);
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [wrapW, setWrapW] = useState(248);

  // Minimap footprint — width fills container; height is fixed.
  const MAP_W = wrapW;
  const MAP_H = 128;
  const PAD = 4;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setWrapW(Math.max(1, el.clientWidth));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Use the real canvas scroll extents so task positions, viewport rect, and
  // scroll state always map consistently into minimap coordinates.
  const { contentW, contentH } = useMemo(() => {
    void scrollTick;
    void tracks;
    void positions;
    const el = document.getElementById(SCROLL_ELEMENT_ID) as HTMLDivElement | null;
    if (!el) return { contentW: 1, contentH: 1 };
    return {
      contentW: Math.max(el.scrollWidth, 1),
      contentH: Math.max(el.scrollHeight, 1),
    };
  }, [scrollTick, tracks, positions]);

  // Scale to fit content inside map with padding.
  const { scale, offsetX, offsetY } = useMemo(() => {
    const availW = MAP_W - PAD * 2;
    const availH = MAP_H - PAD * 2;
    const sX = availW / Math.max(contentW, 1);
    const sY = availH / Math.max(contentH, 1);
    const s = Math.min(sX, sY);
    const oX = PAD + (availW - contentW * s) / 2;
    const oY = PAD + (availH - contentH * s) / 2;
    return { scale: s, offsetX: oX, offsetY: oY };
  }, [contentW, contentH]);

  // Subscribe to canvas scroll so the viewport rect stays live.
  useEffect(() => {
    const el = document.getElementById(SCROLL_ELEMENT_ID);
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setScrollTick((n) => (n + 1) & 0xffff);
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    // Also re-tick when window resizes (viewport width changes).
    window.addEventListener('resize', onScroll);
    // Initial tick so the first paint already has the viewport.
    onScroll();
    return () => {
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const viewport = useMemo(() => {
    void scrollTick;
    const el = document.getElementById(SCROLL_ELEMENT_ID) as HTMLDivElement | null;
    if (!el) return null;
    return {
      x: offsetX + el.scrollLeft * scale,
      y: offsetY + el.scrollTop * scale,
      w: el.clientWidth * scale,
      h: el.clientHeight * scale,
    };
  }, [scrollTick, offsetX, offsetY, scale]);

  const panToMapPoint = useCallback((mapX: number, mapY: number) => {
    const el = document.getElementById(SCROLL_ELEMENT_ID) as HTMLDivElement | null;
    if (!el) return;
    const cx = (mapX - offsetX) / scale;
    const cy = (mapY - offsetY) / scale;
    const vw = el.clientWidth;
    const vh = el.clientHeight;
    el.scrollLeft = Math.max(0, cx - vw / 2);
    el.scrollTop = Math.max(0, cy - vh / 2);
  }, [offsetX, offsetY, scale]);

  const handlePointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const z = getZoom();
    const toLocal = (clientX: number, clientY: number) => ({
      x: (clientX - rect.left) / z,
      y: (clientY - rect.top) / z,
    });
    const p0 = toLocal(e.clientX, e.clientY);
    panToMapPoint(p0.x, p0.y);

    const onMove = (ev: PointerEvent) => {
      const p = toLocal(ev.clientX, ev.clientY);
      panToMapPoint(p.x, p.y);
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }, [panToMapPoint]);

  const rects = useMemo(() => {
    const out: { x: number; y: number; w: number; h: number; fill: string }[] = [];
    tracks.forEach((track, i) => {
      const fill = track.color || '#64748b';
      for (const task of track.tasks) {
        const qid = `${track.id}.${task.id}`;
        const pos = positions.get(qid);
        if (!pos) continue;
        out.push({
          x: offsetX + pos.x * scale,
          y: offsetY + (i * TRACK_H + (TRACK_H - TASK_H) / 2) * scale,
          w: Math.max(1, TASK_W * scale),
          h: Math.max(1, TASK_H * scale),
          fill,
        });
      }
    });
    return out;
  }, [tracks, positions, scale, offsetX, offsetY]);

  if (!config || tracks.length === 0) return null;

  if (!visible) {
    return (
      <div className="border-t border-tagma-border px-2 py-1.5 flex items-center justify-between bg-tagma-surface/60">
        <span className="text-[9px] font-mono uppercase tracking-wider text-tagma-muted">minimap</span>
        <button
          type="button"
          onClick={() => setVisible(true)}
          className="flex items-center justify-center w-5 h-5 text-tagma-muted hover:text-tagma-text"
          title="Show minimap"
        >
          <MapIcon size={11} />
        </button>
      </div>
    );
  }

  return (
    <div
      className="border-t border-tagma-border bg-tagma-surface/60"
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="flex items-center justify-between px-2 h-[18px] border-b border-tagma-border/60 bg-black/20">
        <span className="text-[9px] font-mono uppercase tracking-wider text-tagma-muted">minimap</span>
        <button
          type="button"
          className="text-tagma-muted hover:text-tagma-text"
          onClick={() => setVisible(false)}
          title="Hide minimap"
        >
          <X size={10} />
        </button>
      </div>
      <div className="p-1.5">
        <div ref={wrapRef}>
        <svg
          ref={svgRef}
          width={MAP_W}
          height={MAP_H}
          onPointerDown={handlePointerDown}
          style={{ cursor: 'crosshair', display: 'block' }}
        >
          {tracks.map((track, i) => (
            <rect
              key={`mm-row-${track.id}`}
              x={offsetX}
              y={offsetY + i * TRACK_H * scale}
              width={contentW * scale}
              height={TRACK_H * scale}
              fill={i % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'rgba(255,255,255,0.04)'}
            />
          ))}
          {rects.map((r, i) => (
            <rect
              key={`mm-t-${i}`}
              x={r.x}
              y={r.y}
              width={r.w}
              height={r.h}
              fill={r.fill}
              fillOpacity={0.75}
            />
          ))}
          {viewport && (
            <rect
              x={viewport.x}
              y={viewport.y}
              width={Math.max(4, viewport.w)}
              height={Math.max(4, viewport.h)}
              fill="rgba(212, 132, 90, 0.1)"
              stroke="#d4845a"
              strokeWidth={1}
              pointerEvents="none"
            />
          )}
        </svg>
        </div>
      </div>
    </div>
  );
}

import { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDown } from 'lucide-react';

interface MenuAction {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onAction: () => void;
}

interface MenuSep {
  separator: true;
}

type MenuItem = MenuAction | MenuSep;

function isSep(item: MenuItem): item is MenuSep {
  return 'separator' in item;
}

interface MenuDef {
  label: string;
  items: MenuItem[];
}

interface MenuBarProps {
  menus: MenuDef[];
}

export function MenuBar({ menus }: MenuBarProps) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpenIdx(null), []);

  useEffect(() => {
    if (openIdx === null) return;

    const isInside = (target: Node) =>
      barRef.current !== null && barRef.current.contains(target);

    const onMouseDown = (e: MouseEvent) => {
      if (!isInside(e.target as Node)) close();
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!isInside(e.target as Node)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && isInside(e.target)) return;
      close();
    };
    const onWheel = (e: WheelEvent) => {
      if (e.target instanceof Node && isInside(e.target)) return;
      close();
    };
    const onDrag = (e: DragEvent) => {
      if (e.target instanceof Node && isInside(e.target)) return;
      close();
    };

    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('scroll', onScroll, true);
    document.addEventListener('wheel', onWheel, true);
    document.addEventListener('dragstart', onDrag, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);

    return () => {
      document.removeEventListener('mousedown', onMouseDown, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('wheel', onWheel, true);
      document.removeEventListener('dragstart', onDrag, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, [openIdx, close]);

  return (
    <div ref={barRef} className="flex items-center relative z-[100] h-full">
      {menus.map((menu, mi) => (
        <div key={mi} className="relative h-full flex items-center">
          <button
            className={`h-full px-2.5 text-[11px] tracking-wide transition-colors flex items-center gap-1 ${openIdx === mi ? 'bg-tagma-elevated text-tagma-text' : 'text-tagma-muted hover:text-tagma-text hover:bg-tagma-elevated/40'}`}
            onClick={() => setOpenIdx(openIdx === mi ? null : mi)}
            onMouseEnter={() => { if (openIdx !== null) setOpenIdx(mi); }}
          >
            {menu.label}
            <ChevronDown size={8} className="opacity-40" />
          </button>

          {openIdx === mi && (
            <div className="absolute left-0 top-full bg-tagma-surface border border-tagma-border/80 shadow-xl py-1 min-w-[200px] animate-fade-in z-[101] rounded-sm">
              {menu.items.map((item, ii) => {
                if (isSep(item)) {
                  return <div key={`sep-${ii}`} className="my-1 border-t border-tagma-border/30" />;
                }
                return (
                  <button
                    key={ii}
                    disabled={item.disabled}
                    onClick={() => { item.onAction(); close(); }}
                    className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] text-left transition-colors text-tagma-text hover:bg-tagma-accent/10 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <span>{item.label}</span>
                    {item.shortcut && (
                      <span className="text-[9px] text-tagma-muted/60 font-mono ml-6 tracking-wider">{item.shortcut}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

import { useEffect } from 'react';
import { usePipelineStore } from '../store/pipeline-store';

/**
 * Returns true when the event originates from a text-editing surface
 * (input, textarea, or contenteditable). Matches the pattern used in
 * BoardCanvas's Delete/Backspace handler so behavior is consistent across
 * the app.
 */
function isEditableTarget(e: KeyboardEvent): boolean {
  const target = e.target as HTMLElement | null;
  if (!target) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  if (target.isContentEditable) return true;
  return false;
}

export interface ShortcutHandlers {
  onFocusSearch: () => void;
}

/**
 * Global keyboard shortcuts for the editor. Mounted once in App.tsx.
 *
 * Handled here:
 *   Ctrl/Cmd+Z        → undo
 *   Ctrl/Cmd+Shift+Z  → redo
 *   Ctrl/Cmd+Y        → redo
 *   Ctrl/Cmd+C        → copy selected task/track
 *   Ctrl/Cmd+V        → paste clipboard
 *   Ctrl/Cmd+D        → duplicate selection
 *   Ctrl/Cmd+F        → focus search (host owns the UI)
 *   Escape            → clear selection
 *
 * NOT handled here (owned elsewhere, don't duplicate):
 *   Ctrl+S            → App.tsx (save)
 *   Ctrl+O            → App.tsx (import)
 *   Delete/Backspace  → BoardCanvas (delete selection)
 *
 * Ctrl+A (select-all) is currently a no-op: the editor only supports
 * single-selection of a task or a track. TODO: wire up when multi-select
 * lands.
 */
export function useShortcuts(handlers: ShortcutHandlers): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Never steal keystrokes from text-editing surfaces, but Escape is
      // allowed through so inputs can blur without affecting selection.
      const editable = isEditableTarget(e);
      if (editable && e.key !== 'Escape') return;

      const mod = e.ctrlKey || e.metaKey;
      const store = usePipelineStore.getState();

      if (e.key === 'Escape') {
        // Clear selection; don't preventDefault so inputs can still blur.
        store.selectTask(null);
        store.selectTrack(null);
        return;
      }

      if (!mod) return;

      // Undo/redo
      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault();
        store.redo();
        return;
      }

      // Clipboard
      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        store.copySelection();
        return;
      }
      if (e.key === 'v' || e.key === 'V') {
        e.preventDefault();
        store.pasteClipboard();
        return;
      }
      if (e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        store.duplicateSelection();
        return;
      }

      // Search
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        handlers.onFocusSearch();
        return;
      }

      // Select-all: no-op until multi-select is supported.
      if (e.key === 'a' || e.key === 'A') {
        // Intentionally unhandled. Avoid preventDefault so native select-all
        // still works inside inputs when they eventually receive focus.
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handlers]);
}

import { useCallback } from 'react';
import { X, Trash2 } from 'lucide-react';
import type { RawTrackConfig } from '../../api/client';

interface TrackConfigPanelProps {
  track: RawTrackConfig;
  onUpdateTrack: (trackId: string, fields: Record<string, unknown>) => void;
  onDeleteTrack: (trackId: string) => void;
  onClose: () => void;
}

export function TrackConfigPanel({ track, onUpdateTrack, onDeleteTrack, onClose }: TrackConfigPanelProps) {
  const handleNameChange = useCallback((name: string) => {
    onUpdateTrack(track.id, { name });
  }, [track.id, onUpdateTrack]);

  const handleDriverChange = useCallback((driver: string) => {
    onUpdateTrack(track.id, { driver: driver || undefined });
  }, [track.id, onUpdateTrack]);

  const handleColorChange = useCallback((color: string) => {
    onUpdateTrack(track.id, { color: color || undefined });
  }, [track.id, onUpdateTrack]);

  return (
    <div className="w-80 h-full bg-tagma-surface border-l border-tagma-border flex flex-col animate-slide-in-right">
      <div className="panel-header">
        <h2 className="panel-title truncate">{track.name || track.id}</h2>
        <button onClick={onClose} className="p-1 text-tagma-muted hover:text-tagma-text transition-colors">
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {/* ID (readonly) */}
        <div>
          <label className="field-label">Track ID</label>
          <div className="text-[11px] font-mono text-tagma-muted bg-tagma-bg border border-tagma-border px-2.5 py-1.5 truncate" title={track.id}>{track.id}</div>
        </div>

        {/* Name */}
        <div>
          <label className="field-label">Name</label>
          <input type="text" className="field-input" value={track.name ?? ''} onChange={(e) => handleNameChange(e.target.value)} placeholder="Track name..." />
        </div>

        {/* Color */}
        <div>
          <label className="field-label">Color</label>
          <div className="flex items-center gap-2">
            <input type="color" value={track.color || '#d4845a'} onChange={(e) => handleColorChange(e.target.value)}
              className="w-8 h-8 border border-tagma-border bg-tagma-bg cursor-pointer p-0.5" />
            <input type="text" className="field-input flex-1" value={track.color ?? ''} onChange={(e) => handleColorChange(e.target.value)} placeholder="#hex or empty" />
          </div>
        </div>

        {/* Driver */}
        <div>
          <label className="field-label">Driver</label>
          <input type="text" className="field-input" value={track.driver ?? ''} onChange={(e) => handleDriverChange(e.target.value)} placeholder="claude-code (default)" />
        </div>

        {/* Task count (readonly) */}
        <div>
          <label className="field-label">Tasks</label>
          <div className="text-[11px] font-mono text-tagma-muted bg-tagma-bg border border-tagma-border px-2.5 py-1.5">{track.tasks.length} task{track.tasks.length !== 1 ? 's' : ''}</div>
        </div>

        {/* Delete */}
        <div className="pt-4 border-t border-tagma-border">
          <button onClick={() => onDeleteTrack(track.id)} className="btn-danger flex items-center justify-center gap-1.5">
            <Trash2 size={12} />
            Delete Track
          </button>
        </div>
      </div>
    </div>
  );
}

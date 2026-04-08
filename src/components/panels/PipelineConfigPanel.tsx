import { useCallback } from 'react';
import { X } from 'lucide-react';
import type { RawPipelineConfig } from '../../api/client';

interface PipelineConfigPanelProps {
  config: RawPipelineConfig;
  onUpdate: (fields: Record<string, unknown>) => void;
  onClose: () => void;
}

export function PipelineConfigPanel({ config, onUpdate, onClose }: PipelineConfigPanelProps) {
  const handleNameChange = useCallback((name: string) => {
    onUpdate({ name });
  }, [onUpdate]);

  const handleDriverChange = useCallback((driver: string) => {
    onUpdate({ driver: driver || undefined });
  }, [onUpdate]);

  const handleTimeoutChange = useCallback((timeout: string) => {
    onUpdate({ timeout: timeout || undefined });
  }, [onUpdate]);

  return (
    <div className="w-80 h-full bg-tagma-surface border-l border-tagma-border flex flex-col animate-slide-in-right">
      <div className="panel-header">
        <h2 className="panel-title">Pipeline Settings</h2>
        <button onClick={onClose} className="p-1 text-tagma-muted hover:text-tagma-text transition-colors">
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {/* Name */}
        <div>
          <label className="field-label">Name</label>
          <input type="text" className="field-input" value={config.name} onChange={(e) => handleNameChange(e.target.value)} placeholder="Pipeline name..." />
        </div>

        {/* Driver */}
        <div>
          <label className="field-label">Default Driver</label>
          <input type="text" className="field-input" value={config.driver ?? ''} onChange={(e) => handleDriverChange(e.target.value)} placeholder="claude-code (default)" />
        </div>

        {/* Timeout */}
        <div>
          <label className="field-label">Default Timeout</label>
          <input type="text" className="field-input" value={config.timeout ?? ''} onChange={(e) => handleTimeoutChange(e.target.value)} placeholder="e.g. 10m, 60s" />
        </div>

        {/* Summary (readonly) */}
        <div>
          <label className="field-label">Summary</label>
          <div className="text-[11px] font-mono text-tagma-muted bg-tagma-bg border border-tagma-border px-2.5 py-1.5 space-y-0.5">
            <div>{config.tracks.length} track{config.tracks.length !== 1 ? 's' : ''}</div>
            <div>{config.tracks.reduce((sum, t) => sum + t.tasks.length, 0)} task{config.tracks.reduce((sum, t) => sum + t.tasks.length, 0) !== 1 ? 's' : ''}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

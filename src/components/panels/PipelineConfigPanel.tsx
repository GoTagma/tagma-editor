import { useCallback } from 'react';
import { X } from 'lucide-react';
import type { RawPipelineConfig } from '../../api/client';

interface PipelineConfigPanelProps {
  config: RawPipelineConfig;
  yamlPath: string | null;
  workDir: string;
  onUpdate: (fields: Record<string, unknown>) => void;
  onClose: () => void;
}

export function PipelineConfigPanel({ config, yamlPath, workDir, onUpdate, onClose }: PipelineConfigPanelProps) {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-tagma-surface border border-tagma-border shadow-panel w-[420px] max-h-[80vh] flex flex-col animate-fade-in" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <h2 className="panel-title">Pipeline Settings</h2>
          <button onClick={onClose} className="p-1 text-tagma-muted hover:text-tagma-text transition-colors">
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Info (readonly) */}
          <div className="flex gap-4">
            <div className="flex-1 min-w-0">
              <label className="field-label">YAML File</label>
              <div className="text-[11px] font-mono text-tagma-muted bg-tagma-bg border border-tagma-border px-2.5 py-1.5 truncate" title={yamlPath ?? undefined}>
                {yamlPath ?? '(unsaved)'}
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <label className="field-label">Workspace</label>
              <div className="text-[11px] font-mono text-tagma-muted bg-tagma-bg border border-tagma-border px-2.5 py-1.5 truncate" title={workDir}>
                {workDir || '(not set)'}
              </div>
            </div>
          </div>

          <div className="border-t border-tagma-border" />

          {/* Name */}
          <div>
            <label className="field-label">Name</label>
            <input type="text" className="field-input" value={config.name} onChange={(e) => handleNameChange(e.target.value)} placeholder="Pipeline name..." />
          </div>

          {/* Driver & Timeout */}
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="field-label">Default Driver</label>
              <input type="text" className="field-input" value={config.driver ?? ''} onChange={(e) => handleDriverChange(e.target.value)} placeholder="claude-code (default)" />
            </div>
            <div className="flex-1">
              <label className="field-label">Default Timeout</label>
              <input type="text" className="field-input" value={config.timeout ?? ''} onChange={(e) => handleTimeoutChange(e.target.value)} placeholder="e.g. 10m, 60s" />
            </div>
          </div>

          {/* Summary */}
          <div>
            <label className="field-label">Summary</label>
            <div className="text-[11px] font-mono text-tagma-muted bg-tagma-bg border border-tagma-border px-2.5 py-1.5 flex gap-4">
              <span>{config.tracks.length} track{config.tracks.length !== 1 ? 's' : ''}</span>
              <span>{config.tracks.reduce((sum, t) => sum + t.tasks.length, 0)} task{config.tracks.reduce((sum, t) => sum + t.tasks.length, 0) !== 1 ? 's' : ''}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

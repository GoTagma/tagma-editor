import { useState, useCallback } from 'react';
import { X, FolderOpen, Save, FilePlus } from 'lucide-react';
import type { RawPipelineConfig } from '../../api/client';

interface PipelineConfigPanelProps {
  config: RawPipelineConfig;
  yamlPath: string | null;
  workDir: string;
  onUpdate: (fields: Record<string, unknown>) => void;
  onSetWorkDir: (workDir: string) => void;
  onOpenFile: (path: string) => Promise<void>;
  onSaveFile: () => Promise<void>;
  onSaveFileAs: (path: string) => Promise<void>;
  onClose: () => void;
}

export function PipelineConfigPanel({
  config, yamlPath, workDir,
  onUpdate, onSetWorkDir, onOpenFile, onSaveFile, onSaveFileAs, onClose,
}: PipelineConfigPanelProps) {
  const [openPath, setOpenPath] = useState('');
  const [savePath, setSavePath] = useState('');
  const [showOpen, setShowOpen] = useState(false);
  const [showSaveAs, setShowSaveAs] = useState(false);

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
        {/* File section */}
        <div>
          <label className="field-label">YAML File</label>
          <div className="text-[11px] font-mono text-tagma-muted bg-tagma-bg border border-tagma-border px-2.5 py-1.5 truncate" title={yamlPath ?? undefined}>
            {yamlPath ?? '(unsaved)'}
          </div>
          <div className="flex gap-1.5 mt-1.5">
            <button onClick={() => { setShowOpen(!showOpen); setShowSaveAs(false); }} className="btn-ghost flex-1">
              <FolderOpen size={11} /> Open
            </button>
            <button onClick={() => yamlPath ? onSaveFile() : setShowSaveAs(true)} className="btn-ghost flex-1">
              <Save size={11} /> Save
            </button>
            <button onClick={() => { setShowSaveAs(!showSaveAs); setShowOpen(false); }} className="btn-ghost flex-1">
              <FilePlus size={11} /> Save As
            </button>
          </div>
        </div>

        {showOpen && (
          <div className="space-y-1.5">
            <label className="field-label">Open YAML Path</label>
            <input type="text" className="field-input font-mono text-[11px]" value={openPath}
              onChange={(e) => setOpenPath(e.target.value)} placeholder="D:\path\to\pipeline.yaml"
              onKeyDown={(e) => { if (e.key === 'Enter' && openPath.trim()) { onOpenFile(openPath.trim()); setShowOpen(false); setOpenPath(''); } }} />
            <button onClick={() => { if (openPath.trim()) { onOpenFile(openPath.trim()); setShowOpen(false); setOpenPath(''); } }}
              className="btn-primary w-full text-[10px] justify-center">Open File</button>
          </div>
        )}

        {showSaveAs && (
          <div className="space-y-1.5">
            <label className="field-label">Save As Path</label>
            <input type="text" className="field-input font-mono text-[11px]" value={savePath}
              onChange={(e) => setSavePath(e.target.value)} placeholder="D:\path\to\pipeline.yaml"
              onKeyDown={(e) => { if (e.key === 'Enter' && savePath.trim()) { onSaveFileAs(savePath.trim()); setShowSaveAs(false); setSavePath(''); } }} />
            <button onClick={() => { if (savePath.trim()) { onSaveFileAs(savePath.trim()); setShowSaveAs(false); setSavePath(''); } }}
              className="btn-primary w-full text-[10px] justify-center">Save</button>
          </div>
        )}

        <div className="border-t border-tagma-border" />

        {/* Workspace */}
        <div>
          <label className="field-label">Workspace (workDir)</label>
          <input type="text" className="field-input font-mono text-[11px]" value={workDir}
            onChange={(e) => onSetWorkDir(e.target.value)} placeholder="D:\path\to\workspace" />
          <p className="text-[9px] text-tagma-muted mt-1">Tasks execute relative to this directory</p>
        </div>

        <div className="border-t border-tagma-border" />

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

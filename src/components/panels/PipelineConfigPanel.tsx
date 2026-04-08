import { useState, useCallback } from 'react';
import { X, FolderOpen, Save, Folder } from 'lucide-react';
import type { RawPipelineConfig } from '../../api/client';
import { FileExplorer, type FileExplorerMode } from '../FileExplorer';

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

type ExplorerIntent = { mode: FileExplorerMode; purpose: 'open' | 'save' | 'workdir' };

export function PipelineConfigPanel({
  config, yamlPath, workDir,
  onUpdate, onSetWorkDir, onOpenFile, onSaveFile, onSaveFileAs, onClose,
}: PipelineConfigPanelProps) {
  const [explorer, setExplorer] = useState<ExplorerIntent | null>(null);

  const handleNameChange = useCallback((name: string) => {
    onUpdate({ name });
  }, [onUpdate]);

  const handleDriverChange = useCallback((driver: string) => {
    onUpdate({ driver: driver || undefined });
  }, [onUpdate]);

  const handleTimeoutChange = useCallback((timeout: string) => {
    onUpdate({ timeout: timeout || undefined });
  }, [onUpdate]);

  const handleExplorerConfirm = useCallback((path: string) => {
    if (!explorer) return;
    if (explorer.purpose === 'open') onOpenFile(path);
    else if (explorer.purpose === 'save') onSaveFileAs(path);
    else if (explorer.purpose === 'workdir') onSetWorkDir(path);
    setExplorer(null);
  }, [explorer, onOpenFile, onSaveFileAs, onSetWorkDir]);

  return (
    <>
      <div className="w-80 h-full bg-tagma-surface border-l border-tagma-border flex flex-col animate-slide-in-right">
        <div className="panel-header">
          <h2 className="panel-title">Pipeline Settings</h2>
          <button onClick={onClose} className="p-1 text-tagma-muted hover:text-tagma-text transition-colors">
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {/* YAML File */}
          <div>
            <label className="field-label">YAML File</label>
            <div className="text-[11px] font-mono text-tagma-muted bg-tagma-bg border border-tagma-border px-2.5 py-1.5 truncate" title={yamlPath ?? undefined}>
              {yamlPath ?? '(unsaved)'}
            </div>
            <div className="flex gap-1.5 mt-1.5">
              <button onClick={() => setExplorer({ mode: 'open', purpose: 'open' })} className="btn-ghost flex-1">
                <FolderOpen size={11} /> Open
              </button>
              <button onClick={() => yamlPath ? onSaveFile() : setExplorer({ mode: 'save', purpose: 'save' })} className="btn-ghost flex-1">
                <Save size={11} /> Save
              </button>
              <button onClick={() => setExplorer({ mode: 'save', purpose: 'save' })} className="btn-ghost flex-1">
                <Save size={11} /> Save As
              </button>
            </div>
          </div>

          <div className="border-t border-tagma-border" />

          {/* Workspace */}
          <div>
            <label className="field-label">Workspace (workDir)</label>
            <div className="flex items-center gap-1.5">
              <div className="flex-1 text-[11px] font-mono text-tagma-muted bg-tagma-bg border border-tagma-border px-2.5 py-1.5 truncate" title={workDir}>
                {workDir || '(not set)'}
              </div>
              <button onClick={() => setExplorer({ mode: 'directory', purpose: 'workdir' })} className="btn-ghost shrink-0" title="Browse">
                <Folder size={12} />
              </button>
            </div>
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

          {/* Summary */}
          <div>
            <label className="field-label">Summary</label>
            <div className="text-[11px] font-mono text-tagma-muted bg-tagma-bg border border-tagma-border px-2.5 py-1.5 space-y-0.5">
              <div>{config.tracks.length} track{config.tracks.length !== 1 ? 's' : ''}</div>
              <div>{config.tracks.reduce((sum, t) => sum + t.tasks.length, 0)} task{config.tracks.reduce((sum, t) => sum + t.tasks.length, 0) !== 1 ? 's' : ''}</div>
            </div>
          </div>
        </div>
      </div>

      {explorer && (
        <FileExplorer
          mode={explorer.mode}
          title={explorer.purpose === 'open' ? 'Open Pipeline YAML' : explorer.purpose === 'save' ? 'Save Pipeline As' : 'Select Workspace Directory'}
          initialPath={explorer.purpose === 'workdir' ? workDir : (yamlPath ?? workDir) || undefined}
          fileFilter={explorer.purpose !== 'workdir' ? ['.yaml', '.yml'] : undefined}
          onConfirm={handleExplorerConfirm}
          onCancel={() => setExplorer(null)}
        />
      )}
    </>
  );
}

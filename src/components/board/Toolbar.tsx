import { useState, useCallback } from 'react';
import {
  Check, X, Pencil, Save, Download, Upload, Play,
  LayoutGrid, AlertTriangle, Settings,
} from 'lucide-react';

interface ToolbarProps {
  pipelineName: string;
  isDirty: boolean;
  errorCount: number;
  onUpdateName: (name: string) => void;
  onExportYaml: () => void;
  onImportYaml: () => void;
  onRun: () => void;
  onOpenSettings: () => void;
}

export function Toolbar({
  pipelineName, isDirty, errorCount,
  onUpdateName, onExportYaml, onImportYaml, onRun, onOpenSettings,
}: ToolbarProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(pipelineName);

  const handleSaveName = useCallback(() => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== pipelineName) onUpdateName(trimmed);
    setIsEditing(false);
  }, [editName, pipelineName, onUpdateName]);

  const handleCancel = useCallback(() => {
    setEditName(pipelineName);
    setIsEditing(false);
  }, [pipelineName]);

  return (
    <header className="h-10 bg-tagma-surface border-b border-tagma-border flex items-center px-3 gap-2 shrink-0">
      <div className="flex items-center gap-1.5 mr-1">
        <LayoutGrid size={13} className="text-tagma-accent" />
      </div>

      <div className="w-px h-5 bg-tagma-border" />

      {isEditing ? (
        <div className="flex items-center gap-1.5">
          <input
            type="text" value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSaveName(); if (e.key === 'Escape') handleCancel(); }}
            className="text-sm font-medium bg-tagma-bg border border-tagma-accent/40 px-2 py-0.5 text-tagma-text focus:border-tagma-accent w-full max-w-[12rem]"
            autoFocus
          />
          <button onClick={handleSaveName} className="p-0.5 text-tagma-success hover:text-tagma-success/80"><Check size={13} /></button>
          <button onClick={handleCancel} className="p-0.5 text-tagma-muted hover:text-tagma-error"><X size={13} /></button>
        </div>
      ) : (
        <button
          onClick={() => { setEditName(pipelineName); setIsEditing(true); }}
          className="flex items-center gap-1.5 text-sm font-medium text-tagma-text hover:text-white transition-colors group min-w-0"
        >
          <span className="truncate">{pipelineName}</span>
          <Pencil size={10} className="text-tagma-muted opacity-0 group-hover:opacity-100 transition-opacity" />
        </button>
      )}

      <div className="flex items-center gap-1.5 text-[10px] font-mono text-tagma-muted ml-1 shrink-0">
        {isDirty && <span className="text-tagma-warning">modified</span>}
        {errorCount > 0 && (
          <span className="flex items-center gap-1 text-tagma-error">
            <AlertTriangle size={10} />
            {errorCount} {errorCount === 1 ? 'error' : 'errors'}
          </span>
        )}
      </div>

      <div className="flex-1" />

      <button onClick={onImportYaml} className="btn-ghost">
        <Upload size={13} />
        <span className="hidden sm:inline">Import</span>
      </button>

      <button onClick={onExportYaml} className="btn-ghost">
        <Download size={13} />
        <span className="hidden sm:inline">Export</span>
      </button>

      <button onClick={onOpenSettings} className="btn-ghost" title="Pipeline Settings">
        <Settings size={13} />
      </button>

      <div className="w-px h-5 bg-tagma-border" />

      <button onClick={onRun} className="btn-primary group">
        <Play size={12} className="group-hover:scale-110 transition-transform" />
        <span>Run</span>
      </button>
    </header>
  );
}

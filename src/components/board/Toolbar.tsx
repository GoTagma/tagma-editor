import { useState, useCallback, useMemo } from 'react';
import { Check, X, Pencil, Play, LayoutGrid, AlertTriangle } from 'lucide-react';
import { MenuBar } from '../MenuBar';

interface ToolbarProps {
  pipelineName: string;
  yamlPath: string | null;
  isDirty: boolean;
  errorCount: number;
  menus: { label: string; items: any[] }[];
  onUpdateName: (name: string) => void;
  onRun: () => void;
}

export function Toolbar({
  pipelineName, yamlPath, isDirty, errorCount, menus,
  onUpdateName, onRun,
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

  const fileName = yamlPath ? yamlPath.replace(/^.*[\\/]/, '') : null;

  return (
    <header className="h-10 bg-tagma-surface border-b border-tagma-border flex items-center px-1 gap-1 shrink-0">
      {/* Left: Logo + Menus */}
      <div className="flex items-center gap-0.5 mr-1">
        <div className="px-2 flex items-center">
          <LayoutGrid size={13} className="text-tagma-accent" />
        </div>
        <MenuBar menus={menus} />
      </div>

      <div className="w-px h-5 bg-tagma-border" />

      {/* Center: Pipeline name */}
      <div className="flex items-center gap-1.5 min-w-0 px-2">
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

        {fileName && (
          <span className="text-[10px] font-mono text-tagma-muted truncate max-w-[160px]" title={yamlPath!}>
            {fileName}
          </span>
        )}

        <div className="flex items-center gap-1.5 text-[10px] font-mono text-tagma-muted shrink-0">
          {isDirty && <span className="text-tagma-warning">modified</span>}
          {errorCount > 0 && (
            <span className="flex items-center gap-1 text-tagma-error">
              <AlertTriangle size={10} />
              {errorCount} {errorCount === 1 ? 'error' : 'errors'}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1" />

      {/* Right: Run */}
      <button onClick={onRun} className="btn-primary group mr-1">
        <Play size={12} className="group-hover:scale-110 transition-transform" />
        <span>Run</span>
      </button>
    </header>
  );
}

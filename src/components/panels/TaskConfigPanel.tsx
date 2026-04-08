import { useState, useCallback } from 'react';
import { X, Trash2, Terminal, MessageSquare } from 'lucide-react';
import type { RawTaskConfig } from '../../api/client';

interface TaskConfigPanelProps {
  task: RawTaskConfig;
  trackId: string;
  qualifiedId: string;
  dependencies: string[];
  onUpdateTask: (trackId: string, taskId: string, patch: Partial<RawTaskConfig>) => void;
  onDeleteTask: (trackId: string, taskId: string) => void;
  onRemoveDependency: (trackId: string, taskId: string, depRef: string) => void;
  onClose: () => void;
}

export function TaskConfigPanel({
  task, trackId, qualifiedId, dependencies,
  onUpdateTask, onDeleteTask, onRemoveDependency, onClose,
}: TaskConfigPanelProps) {
  const [mode, setMode] = useState<'prompt' | 'command'>(task.command ? 'command' : 'prompt');

  const handleNameChange = useCallback((name: string) => {
    onUpdateTask(trackId, task.id, { name });
  }, [trackId, task.id, onUpdateTask]);

  const handlePromptChange = useCallback((prompt: string) => {
    onUpdateTask(trackId, task.id, { prompt, command: undefined });
  }, [trackId, task.id, onUpdateTask]);

  const handleCommandChange = useCallback((command: string) => {
    onUpdateTask(trackId, task.id, { command, prompt: undefined });
  }, [trackId, task.id, onUpdateTask]);

  const handleDriverChange = useCallback((driver: string) => {
    onUpdateTask(trackId, task.id, { driver: driver || undefined });
  }, [trackId, task.id, onUpdateTask]);

  const handleModelTierChange = useCallback((model_tier: string) => {
    onUpdateTask(trackId, task.id, { model_tier: model_tier || undefined });
  }, [trackId, task.id, onUpdateTask]);

  const handleTimeoutChange = useCallback((timeout: string) => {
    onUpdateTask(trackId, task.id, { timeout: timeout || undefined });
  }, [trackId, task.id, onUpdateTask]);

  const handleOutputChange = useCallback((output: string) => {
    onUpdateTask(trackId, task.id, { output: output || undefined });
  }, [trackId, task.id, onUpdateTask]);

  const switchMode = useCallback((newMode: 'prompt' | 'command') => {
    setMode(newMode);
    if (newMode === 'command') {
      onUpdateTask(trackId, task.id, { command: task.command ?? '', prompt: undefined });
    } else {
      onUpdateTask(trackId, task.id, { prompt: task.prompt ?? '', command: undefined });
    }
  }, [trackId, task, onUpdateTask]);

  return (
    <div className="w-80 h-full bg-tagma-surface border-l border-tagma-border flex flex-col animate-slide-in-right">
      <div className="panel-header">
        <h2 className="panel-title truncate">{task.name || task.id}</h2>
        <button onClick={onClose} className="p-1 text-tagma-muted hover:text-tagma-text transition-colors">
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {/* ID (readonly) */}
        <div>
          <label className="field-label">Task ID</label>
          <div className="text-[11px] font-mono text-tagma-muted bg-tagma-bg border border-tagma-border px-2.5 py-1.5">{qualifiedId}</div>
        </div>

        {/* Name */}
        <div>
          <label className="field-label">Name</label>
          <input type="text" className="field-input" value={task.name ?? ''} onChange={(e) => handleNameChange(e.target.value)} placeholder="Task name..." />
        </div>

        {/* Mode toggle */}
        <div>
          <label className="field-label">Type</label>
          <div className="flex gap-1">
            <button onClick={() => switchMode('prompt')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[11px] border transition-colors ${mode === 'prompt' ? 'border-tagma-accent bg-tagma-accent/10 text-tagma-accent' : 'border-tagma-border text-tagma-muted hover:text-tagma-text'}`}>
              <MessageSquare size={11} /> Prompt
            </button>
            <button onClick={() => switchMode('command')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[11px] border transition-colors ${mode === 'command' ? 'border-tagma-accent bg-tagma-accent/10 text-tagma-accent' : 'border-tagma-border text-tagma-muted hover:text-tagma-text'}`}>
              <Terminal size={11} /> Command
            </button>
          </div>
        </div>

        {/* Prompt / Command */}
        <div>
          <label className="field-label">{mode === 'prompt' ? 'Prompt' : 'Command'}</label>
          <textarea
            className="field-input min-h-[120px] resize-y font-mono text-[11px]"
            value={mode === 'prompt' ? (task.prompt ?? '') : (task.command ?? '')}
            onChange={(e) => mode === 'prompt' ? handlePromptChange(e.target.value) : handleCommandChange(e.target.value)}
            placeholder={mode === 'prompt' ? 'Enter the task prompt...' : 'Enter the shell command...'}
          />
        </div>

        {/* Driver */}
        <div>
          <label className="field-label">Driver</label>
          <input type="text" className="field-input" value={task.driver ?? ''} onChange={(e) => handleDriverChange(e.target.value)} placeholder="claude-code (default)" />
        </div>

        {/* Model Tier */}
        <div>
          <label className="field-label">Model Tier</label>
          <select className="field-input" value={task.model_tier ?? ''} onChange={(e) => handleModelTierChange(e.target.value)}>
            <option value="">medium (default)</option>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </div>

        {/* Timeout */}
        <div>
          <label className="field-label">Timeout</label>
          <input type="text" className="field-input" value={task.timeout ?? ''} onChange={(e) => handleTimeoutChange(e.target.value)} placeholder="e.g. 5m, 30s" />
        </div>

        {/* Output path */}
        <div>
          <label className="field-label">Output Path</label>
          <input type="text" className="field-input font-mono text-[11px]" value={task.output ?? ''} onChange={(e) => handleOutputChange(e.target.value)} placeholder="./tmp/output.md" />
        </div>

        {/* Dependencies */}
        {dependencies.length > 0 && (
          <div>
            <label className="field-label">Dependencies</label>
            <div className="space-y-1">
              {dependencies.map((dep) => (
                <div key={dep} className="flex items-center gap-1.5 bg-tagma-bg border border-tagma-border px-2 py-1">
                  <span className="text-[11px] font-mono text-tagma-text flex-1 truncate">{dep}</span>
                  <button onClick={() => onRemoveDependency(trackId, task.id, dep)} className="text-tagma-muted hover:text-tagma-error transition-colors">
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Permissions */}
        {task.permissions && (
          <div>
            <label className="field-label">Permissions</label>
            <div className="text-[11px] font-mono text-tagma-muted bg-tagma-bg border border-tagma-border px-2.5 py-1.5">
              R:{task.permissions.read ? '✓' : '✗'} W:{task.permissions.write ? '✓' : '✗'} X:{task.permissions.execute ? '✓' : '✗'}
            </div>
          </div>
        )}

        {/* Delete */}
        <div className="pt-4 border-t border-tagma-border">
          <button onClick={() => onDeleteTask(trackId, task.id)} className="btn-danger flex items-center justify-center gap-1.5">
            <Trash2 size={12} />
            Delete Task
          </button>
        </div>
      </div>
    </div>
  );
}

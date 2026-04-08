import { useState, useCallback } from 'react';
import { X, Trash2, Terminal, MessageSquare, ChevronDown, ChevronRight } from 'lucide-react';
import type { RawTaskConfig, TriggerConfig, CompletionConfig } from '../../api/client';
import { useLocalField } from '../../hooks/use-local-field';
import { MiddlewareEditor } from './MiddlewareEditor';

interface TaskConfigPanelProps {
  task: RawTaskConfig;
  trackId: string;
  qualifiedId: string;
  dependencies: string[];
  drivers: string[];
  onUpdateTask: (trackId: string, taskId: string, patch: Partial<RawTaskConfig>) => void;
  onDeleteTask: (trackId: string, taskId: string) => void;
  onRemoveDependency: (trackId: string, taskId: string, depRef: string) => void;
  onClose: () => void;
}

export function TaskConfigPanel({
  task, trackId, qualifiedId, dependencies, drivers,
  onUpdateTask, onDeleteTask, onRemoveDependency, onClose,
}: TaskConfigPanelProps) {
  const [mode, setMode] = useState<'prompt' | 'command'>(task.command ? 'command' : 'prompt');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const commitField = useCallback((patch: Partial<RawTaskConfig>) => {
    onUpdateTask(trackId, task.id, patch);
  }, [trackId, task.id, onUpdateTask]);

  const [name, setName, blurName] = useLocalField(task.name ?? '', (v) => commitField({ name: v }));
  const [prompt, setPrompt, blurPrompt] = useLocalField(task.prompt ?? '', (v) => commitField({ prompt: v, command: undefined }));
  const [command, setCommand, blurCommand] = useLocalField(task.command ?? '', (v) => commitField({ command: v, prompt: undefined }));
  const handleDriverChange = useCallback((value: string) => {
    onUpdateTask(trackId, task.id, { driver: value || undefined });
  }, [trackId, task.id, onUpdateTask]);
  const [timeout, setTimeout_, blurTimeout] = useLocalField(task.timeout ?? '', (v) => commitField({ timeout: v || undefined }));
  const [output, setOutput, blurOutput] = useLocalField(task.output ?? '', (v) => commitField({ output: v || undefined }));
  const [agentProfile, setAgentProfile, blurAgentProfile] = useLocalField(task.agent_profile ?? '', (v) => commitField({ agent_profile: v || undefined }));
  const [cwd, setCwd, blurCwd] = useLocalField(task.cwd ?? '', (v) => commitField({ cwd: v || undefined }));
  const [continueFrom, setContinueFrom, blurContinueFrom] = useLocalField(task.continue_from ?? '', (v) => commitField({ continue_from: v || undefined }));
  const [useTemplate, setUseTemplate, blurUseTemplate] = useLocalField(task.use ?? '', (v) => commitField({ use: v || undefined }));

  const handleModelTierChange = useCallback((model_tier: string) => {
    onUpdateTask(trackId, task.id, { model_tier: model_tier || undefined });
  }, [trackId, task.id, onUpdateTask]);

  const switchMode = useCallback((newMode: 'prompt' | 'command') => {
    setMode(newMode);
    if (newMode === 'command') {
      onUpdateTask(trackId, task.id, { command: task.command ?? '', prompt: undefined });
    } else {
      onUpdateTask(trackId, task.id, { prompt: task.prompt ?? '', command: undefined });
    }
  }, [trackId, task, onUpdateTask]);

  const handlePermToggle = useCallback((key: 'read' | 'write' | 'execute') => {
    const current = task.permissions ?? {};
    const next = { ...current, [key]: !current[key] };
    if (!next.read && !next.write && !next.execute) {
      commitField({ permissions: undefined });
    } else {
      commitField({ permissions: next });
    }
  }, [task.permissions, commitField]);

  const handleTriggerTypeChange = useCallback((type: string) => {
    if (!type) {
      commitField({ trigger: undefined });
    } else {
      commitField({ trigger: { type } as TriggerConfig });
    }
  }, [commitField]);

  const handleTriggerField = useCallback((field: string, value: string) => {
    const current = task.trigger ?? { type: 'manual' };
    const next = { ...current, [field]: value || undefined };
    commitField({ trigger: next });
  }, [task.trigger, commitField]);

  const handleCompletionTypeChange = useCallback((type: string) => {
    if (!type) {
      commitField({ completion: undefined });
    } else {
      commitField({ completion: { type } as CompletionConfig });
    }
  }, [commitField]);

  const handleCompletionField = useCallback((field: string, value: unknown) => {
    const current = task.completion ?? { type: 'exit_code' };
    const next = { ...current, [field]: value };
    commitField({ completion: next });
  }, [task.completion, commitField]);

  return (
    <div className="w-80 h-full bg-tagma-surface border-l border-tagma-border flex flex-col animate-slide-in-right">
      <div className="panel-header">
        <h2 className="panel-title truncate">{task.name || task.id}</h2>
        <button onClick={onClose} className="p-1 text-tagma-muted hover:text-tagma-text transition-colors">
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {/* ID (readonly) * */}
        <div>
          <label className="field-label">Task ID <span className="text-tagma-error">*</span></label>
          <div className="text-[11px] font-mono text-tagma-muted bg-tagma-bg border border-tagma-border px-2.5 py-1.5 truncate" title={qualifiedId}>{qualifiedId}</div>
        </div>

        {/* Name */}
        <div>
          <label className="field-label">Name</label>
          <input type="text" className="field-input" value={name} onChange={(e) => setName(e.target.value)} onBlur={blurName} placeholder="Task name..." />
        </div>

        {/* Mode toggle */}
        <div>
          <label className="field-label">Type <span className="text-[10px] text-tagma-muted font-normal">(prompt/command mutually exclusive)</span></label>
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
            value={mode === 'prompt' ? prompt : command}
            onChange={(e) => mode === 'prompt' ? setPrompt(e.target.value) : setCommand(e.target.value)}
            onBlur={mode === 'prompt' ? blurPrompt : blurCommand}
            placeholder={mode === 'prompt' ? 'Enter the task prompt...' : 'Enter the shell command...'}
          />
        </div>

        {/* AI-specific fields (only for prompt mode) */}
        {mode === 'prompt' && (
          <>
            {/* Driver */}
            <div>
              <label className="field-label">Driver</label>
              <select className="field-input" value={task.driver ?? ''} onChange={(e) => handleDriverChange(e.target.value)}>
                <option value="">(inherited)</option>
                {drivers.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>

            {/* Model Tier */}
            <div>
              <label className="field-label">Model Tier</label>
              <select className="field-input" value={task.model_tier ?? ''} onChange={(e) => handleModelTierChange(e.target.value)}>
                <option value="">inherited</option>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            </div>

            {/* Agent Profile */}
            <div>
              <label className="field-label">Agent Profile</label>
              <textarea className="field-input min-h-[60px] resize-y font-mono text-[11px]" value={agentProfile} onChange={(e) => setAgentProfile(e.target.value)} onBlur={blurAgentProfile}
                placeholder="Named profile or multi-line system prompt..." />
            </div>

            {/* Continue From */}
            <div>
              <label className="field-label">Continue From</label>
              <input type="text" className="field-input font-mono text-[11px]" value={continueFrom} onChange={(e) => setContinueFrom(e.target.value)} onBlur={blurContinueFrom}
                placeholder="taskId or trackId.taskId" />
              <p className="text-[10px] text-tagma-muted mt-1">Session handoff from another task</p>
            </div>

            {/* Permissions */}
            <div>
              <label className="field-label">Permissions</label>
              <div className="flex gap-3">
                {(['read', 'write', 'execute'] as const).map((key) => (
                  <label key={key} className="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" checked={!!task.permissions?.[key]}
                      onChange={() => handlePermToggle(key)}
                      className="accent-tagma-accent" />
                    <span className="text-[11px] text-tagma-text capitalize">{key}</span>
                  </label>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Timeout */}
        <div>
          <label className="field-label">Timeout</label>
          <input type="text" className="field-input" value={timeout} onChange={(e) => setTimeout_(e.target.value)} onBlur={blurTimeout} placeholder="e.g. 5m, 30s" />
        </div>

        {/* Output path */}
        <div>
          <label className="field-label">Output Path</label>
          <input type="text" className="field-input font-mono text-[11px]" value={output} onChange={(e) => setOutput(e.target.value)} onBlur={blurOutput} placeholder="./tmp/output.md" />
        </div>

        {/* CWD */}
        <div>
          <label className="field-label">Working Directory</label>
          <input type="text" className="field-input font-mono text-[11px]" value={cwd} onChange={(e) => setCwd(e.target.value)} onBlur={blurCwd} placeholder="./path (relative, inherited)" />
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

        {/* ── Advanced Section ── */}
        <div className="border-t border-tagma-border pt-2">
          <button onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1 text-[11px] text-tagma-muted hover:text-tagma-text transition-colors w-full">
            {showAdvanced ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            Advanced
          </button>
        </div>

        {showAdvanced && (
          <>
            {/* Trigger */}
            <div>
              <label className="field-label">Trigger</label>
              <select className="field-input" value={task.trigger?.type ?? ''} onChange={(e) => handleTriggerTypeChange(e.target.value)}>
                <option value="">none</option>
                <option value="manual">manual (approval gate)</option>
                <option value="file">file (file watcher)</option>
              </select>
            </div>

            {task.trigger?.type === 'manual' && (
              <div className="pl-3 border-l-2 border-tagma-border space-y-2">
                <TriggerField label="Message" value={task.trigger.message} onChange={(v) => handleTriggerField('message', v)} placeholder="Approval message..." />
                <div>
                  <label className="text-[10px] text-tagma-muted">Options</label>
                  <OptionsField value={task.trigger.options} onChange={(opts) => {
                    const current = task.trigger ?? { type: 'manual' };
                    commitField({ trigger: { ...current, options: opts && opts.length > 0 ? opts : undefined } });
                  }} />
                </div>
                <TriggerField label="Timeout" value={task.trigger.timeout} onChange={(v) => handleTriggerField('timeout', v)} placeholder="e.g. 5m" />
                <div>
                  <label className="text-[10px] text-tagma-muted">Metadata</label>
                  <KeyValueEditor value={task.trigger.metadata ?? {}} onChange={(meta) => {
                    const current = task.trigger ?? { type: 'manual' };
                    commitField({ trigger: { ...current, metadata: Object.keys(meta).length > 0 ? meta : undefined } });
                  }} />
                </div>
              </div>
            )}

            {task.trigger?.type === 'file' && (
              <div className="pl-3 border-l-2 border-tagma-border space-y-2">
                <TriggerField label="Path *" value={task.trigger.path} onChange={(v) => handleTriggerField('path', v)} placeholder="./path/to/watch" />
                <TriggerField label="Timeout" value={task.trigger.timeout} onChange={(v) => handleTriggerField('timeout', v)} placeholder="e.g. 5m" />
              </div>
            )}

            {/* Completion */}
            <div>
              <label className="field-label">Completion Check</label>
              <select className="field-input" value={task.completion?.type ?? ''} onChange={(e) => handleCompletionTypeChange(e.target.value)}>
                <option value="">none</option>
                <option value="exit_code">exit_code</option>
                <option value="file_exists">file_exists</option>
                <option value="output_check">output_check</option>
              </select>
            </div>

            {task.completion?.type === 'exit_code' && (
              <div className="pl-3 border-l-2 border-tagma-border space-y-2">
                <div>
                  <label className="text-[10px] text-tagma-muted">Expected Code</label>
                  <input type="text" className="field-input font-mono text-[11px]"
                    value={task.completion.expect !== undefined ? String(task.completion.expect) : ''}
                    onChange={(e) => {
                      const v = e.target.value.trim();
                      handleCompletionField('expect', v ? (v.includes(',') ? v.split(',').map(Number) : Number(v)) : undefined);
                    }}
                    placeholder="0 (default)" />
                </div>
              </div>
            )}

            {task.completion?.type === 'file_exists' && (
              <div className="pl-3 border-l-2 border-tagma-border space-y-2">
                <TriggerField label="Path *" value={task.completion.path} onChange={(v) => handleCompletionField('path', v)} placeholder="./path/to/check" />
                <div>
                  <label className="text-[10px] text-tagma-muted">Kind</label>
                  <select className="field-input" value={task.completion.kind ?? ''} onChange={(e) => handleCompletionField('kind', e.target.value || undefined)}>
                    <option value="">any (default)</option>
                    <option value="file">file</option>
                    <option value="dir">dir</option>
                    <option value="any">any</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-tagma-muted">Min Size (bytes)</label>
                  <input type="number" className="field-input font-mono text-[11px]"
                    value={task.completion.min_size ?? ''}
                    onChange={(e) => handleCompletionField('min_size', e.target.value ? Number(e.target.value) : undefined)}
                    placeholder="optional" />
                </div>
              </div>
            )}

            {task.completion?.type === 'output_check' && (
              <div className="pl-3 border-l-2 border-tagma-border space-y-2">
                <TriggerField label="Check Command *" value={task.completion.check} onChange={(v) => handleCompletionField('check', v)} placeholder="shell command (exit 0 = pass)" />
                <TriggerField label="Timeout" value={task.completion.timeout} onChange={(v) => handleCompletionField('timeout', v)} placeholder="30s (default)" />
              </div>
            )}

            {/* Use Template */}
            <div>
              <label className="field-label">Template (use)</label>
              <input type="text" className="field-input font-mono text-[11px]" value={useTemplate} onChange={(e) => setUseTemplate(e.target.value)} onBlur={blurUseTemplate}
                placeholder='e.g. @tagma/template-lint' />
              <p className="text-[10px] text-tagma-muted mt-1">Mutually exclusive with prompt/command</p>
            </div>

            {/* Template with parameters */}
            {task.use && (
              <div>
                <label className="field-label">Template Parameters (with)</label>
                <KeyValueEditor value={(task.with ?? {}) as Record<string, unknown>} onChange={(params) => {
                  commitField({ with: Object.keys(params).length > 0 ? params : undefined });
                }} />
              </div>
            )}

            {/* Middlewares */}
            <MiddlewareEditor middlewares={task.middlewares ?? []}
              onChange={(mws) => commitField({ middlewares: mws })} />
          </>
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

/** Reusable small text field for trigger/completion sub-fields */
function TriggerField({ label, value, onChange, placeholder }: {
  label: string;
  value: string | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [val, setVal, blurVal] = useLocalField(value ?? '', onChange);
  return (
    <div>
      <label className="text-[10px] text-tagma-muted">{label}</label>
      <input type="text" className="field-input font-mono text-[11px]" value={val} onChange={(e) => setVal(e.target.value)} onBlur={blurVal} placeholder={placeholder} />
    </div>
  );
}

/** Comma-separated string[] editor for trigger options */
function OptionsField({ value, onChange }: {
  value: string[] | undefined;
  onChange: (opts: string[] | undefined) => void;
}) {
  const [val, setVal, blurVal] = useLocalField(
    (value ?? []).join(', '),
    (v) => onChange(v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined),
  );
  return (
    <div>
      <input type="text" className="field-input font-mono text-[11px]" value={val} onChange={(e) => setVal(e.target.value)} onBlur={blurVal}
        placeholder="approve, reject" />
      <p className="text-[10px] text-tagma-muted mt-0.5">Comma-separated choices</p>
    </div>
  );
}

/** Key-value pair editor for metadata / template with params */
function KeyValueEditor({ value, onChange }: {
  value: Record<string, unknown>;
  onChange: (kv: Record<string, unknown>) => void;
}) {
  const entries = Object.entries(value);

  const handleAdd = () => {
    const key = `key${entries.length + 1}`;
    onChange({ ...value, [key]: '' });
  };

  const handleRemove = (key: string) => {
    const { [key]: _, ...rest } = value;
    onChange(rest);
  };

  const handleKeyChange = (oldKey: string, newKey: string) => {
    if (newKey === oldKey) return;
    const result: Record<string, unknown> = {};
    for (const [k, v] of entries) {
      result[k === oldKey ? newKey : k] = v;
    }
    onChange(result);
  };

  const handleValueChange = (key: string, newValue: string) => {
    onChange({ ...value, [key]: newValue });
  };

  return (
    <div className="space-y-1.5">
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-center gap-1">
          <input type="text" className="field-input font-mono text-[11px] w-[90px]" value={k}
            onChange={(e) => handleKeyChange(k, e.target.value)} placeholder="key" />
          <input type="text" className="field-input font-mono text-[11px] flex-1" value={String(v ?? '')}
            onChange={(e) => handleValueChange(k, e.target.value)} placeholder="value" />
          <button onClick={() => handleRemove(k)} className="text-tagma-muted hover:text-tagma-error transition-colors shrink-0">
            <X size={10} />
          </button>
        </div>
      ))}
      <button onClick={handleAdd} className="text-[10px] text-tagma-accent hover:text-tagma-text transition-colors">
        + Add entry
      </button>
    </div>
  );
}

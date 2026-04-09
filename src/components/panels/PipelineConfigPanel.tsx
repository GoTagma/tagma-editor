import { useCallback, useMemo } from 'react';
import { X } from 'lucide-react';
import type { RawPipelineConfig, HooksConfig, HookCommand } from '../../api/client';
import { useLocalField } from '../../hooks/use-local-field';
import { viewportH } from '../../utils/zoom';

interface PipelineConfigPanelProps {
  config: RawPipelineConfig;
  yamlPath: string | null;
  workDir: string;
  drivers: string[];
  onUpdate: (fields: Record<string, unknown>) => void;
  onClose: () => void;
}

const HOOK_KEYS: (keyof HooksConfig)[] = [
  'pipeline_start', 'task_start', 'task_success',
  'task_failure', 'pipeline_complete', 'pipeline_error',
];

const GATE_HOOKS: ReadonlySet<string> = new Set(['pipeline_start', 'task_start']);

export function PipelineConfigPanel({ config, yamlPath, workDir, drivers, onUpdate, onClose }: PipelineConfigPanelProps) {
  const [name, setName, blurName] = useLocalField(config.name, (v) => onUpdate({ name: v }));
  const [timeout, setTimeout_, blurTimeout] = useLocalField(config.timeout ?? '', (v) => onUpdate({ timeout: v || undefined }));

  const hooks = config.hooks ?? {};

  const commitHook = useCallback((key: keyof HooksConfig, value: HookCommand | undefined) => {
    const next = { ...hooks };
    if (value !== undefined) {
      next[key] = value;
    } else {
      delete next[key];
    }
    onUpdate({ hooks: Object.keys(next).length > 0 ? next : undefined });
  }, [hooks, onUpdate]);

  const maxH = useMemo(() => Math.floor(viewportH() * 0.8), []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-tagma-surface border border-tagma-border shadow-panel w-[480px] flex flex-col animate-fade-in" style={{ maxHeight: maxH }} onClick={(e) => e.stopPropagation()}>
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

          {/* Name * */}
          <div>
            <label className="field-label">Name <span className="text-tagma-error">*</span></label>
            <input type="text" className="field-input" value={name} onChange={(e) => setName(e.target.value)} onBlur={blurName} placeholder="Pipeline name..." />
          </div>

          {/* Driver & Timeout */}
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="field-label">Default Driver</label>
              <select className="field-input" value={config.driver ?? ''} onChange={(e) => onUpdate({ driver: e.target.value || undefined })}>
                <option value="">claude-code (default)</option>
                {drivers.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="field-label">Default Timeout</label>
              <input type="text" className="field-input" value={timeout} onChange={(e) => setTimeout_(e.target.value)} onBlur={blurTimeout} placeholder="e.g. 10m, 60s" />
            </div>
          </div>

          {/* Hooks */}
          <div>
            <label className="field-label">Hooks</label>
            <p className="text-[10px] text-tagma-muted mb-2">Shell commands to run at lifecycle events. One command per line; multiple lines are executed sequentially.</p>
            <div className="space-y-3">
              {HOOK_KEYS.map((key) => (
                <HookField key={key} hookKey={key} value={hooks[key]} isGate={GATE_HOOKS.has(key)} onCommit={commitHook} />
              ))}
            </div>
          </div>

          <div className="border-t border-tagma-border" />

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

function hookToText(value: HookCommand | undefined): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.join('\n');
}

function textToHook(text: string): HookCommand | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return undefined;
  if (lines.length === 1) return lines[0];
  return lines;
}

function HookField({ hookKey, value, isGate, onCommit }: {
  hookKey: keyof HooksConfig;
  value: HookCommand | undefined;
  isGate: boolean;
  onCommit: (key: keyof HooksConfig, value: HookCommand | undefined) => void;
}) {
  const [val, setVal, blurVal] = useLocalField(hookToText(value), (v) => onCommit(hookKey, textToHook(v)));
  const lineCount = val ? val.split('\n').length : 0;

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <label className="text-[10px] font-mono text-tagma-muted">{hookKey}</label>
        {isGate && <span className="text-[9px] px-1 py-px bg-amber-500/10 text-amber-400/70 border border-amber-500/20">gate</span>}
        {lineCount > 1 && <span className="text-[9px] text-tagma-muted">{lineCount} cmds</span>}
      </div>
      <textarea
        className="field-input w-full font-mono text-[11px] resize-y"
        style={{ minHeight: 28, height: lineCount > 1 ? lineCount * 20 + 12 : 28 }}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={blurVal}
        placeholder="shell command(s)..."
        rows={1}
      />
    </div>
  );
}

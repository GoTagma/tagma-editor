import { useCallback } from 'react';
import { X } from 'lucide-react';
import type { RawPipelineConfig, HooksConfig } from '../../api/client';
import { useLocalField } from '../../hooks/use-local-field';

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

export function PipelineConfigPanel({ config, yamlPath, workDir, drivers, onUpdate, onClose }: PipelineConfigPanelProps) {
  const [name, setName, blurName] = useLocalField(config.name, (v) => onUpdate({ name: v }));
  const [timeout, setTimeout_, blurTimeout] = useLocalField(config.timeout ?? '', (v) => onUpdate({ timeout: v || undefined }));
  const [plugins, setPlugins, blurPlugins] = useLocalField(
    (config.plugins ?? []).join(', '),
    (v) => onUpdate({ plugins: v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined }),
  );

  const hooks = config.hooks ?? {};

  const commitHook = useCallback((key: keyof HooksConfig, value: string) => {
    const next = { ...hooks };
    if (value) {
      next[key] = value;
    } else {
      delete next[key];
    }
    onUpdate({ hooks: Object.keys(next).length > 0 ? next : undefined });
  }, [hooks, onUpdate]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-tagma-surface border border-tagma-border shadow-panel w-[480px] max-h-[80vh] flex flex-col animate-fade-in" onClick={(e) => e.stopPropagation()}>
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

          {/* Plugins */}
          <div>
            <label className="field-label">Plugins</label>
            <input type="text" className="field-input font-mono text-[11px]" value={plugins} onChange={(e) => setPlugins(e.target.value)} onBlur={blurPlugins}
              placeholder='e.g. @tagma/driver-codex, @tagma/driver-opencode' />
            <p className="text-[10px] text-tagma-muted mt-1">Comma-separated plugin package names</p>
          </div>

          <div className="border-t border-tagma-border" />

          {/* Hooks */}
          <div>
            <label className="field-label">Hooks</label>
            <p className="text-[10px] text-tagma-muted mb-2">Shell commands to run at lifecycle events</p>
            <div className="space-y-2">
              {HOOK_KEYS.map((key) => (
                <HookField key={key} hookKey={key} value={hooks[key]} onCommit={commitHook} />
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

function HookField({ hookKey, value, onCommit }: {
  hookKey: keyof HooksConfig;
  value: string | string[] | undefined;
  onCommit: (key: keyof HooksConfig, value: string) => void;
}) {
  const strValue = Array.isArray(value) ? value.join(' && ') : (value ?? '');
  const [val, setVal, blurVal] = useLocalField(strValue, (v) => onCommit(hookKey, v));

  return (
    <div className="flex items-center gap-2">
      <label className="text-[10px] font-mono text-tagma-muted w-[120px] shrink-0 text-right">{hookKey}</label>
      <input type="text" className="field-input flex-1 font-mono text-[11px]" value={val} onChange={(e) => setVal(e.target.value)} onBlur={blurVal}
        placeholder="shell command..." />
    </div>
  );
}

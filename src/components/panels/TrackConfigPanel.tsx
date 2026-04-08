import { useCallback } from 'react';
import { X, Trash2 } from 'lucide-react';
import type { RawTrackConfig } from '../../api/client';
import { useLocalField } from '../../hooks/use-local-field';

interface TrackConfigPanelProps {
  track: RawTrackConfig;
  onUpdateTrack: (trackId: string, fields: Record<string, unknown>) => void;
  onDeleteTrack: (trackId: string) => void;
  onClose: () => void;
}

export function TrackConfigPanel({ track, onUpdateTrack, onDeleteTrack, onClose }: TrackConfigPanelProps) {
  const commit = useCallback((fields: Record<string, unknown>) => {
    onUpdateTrack(track.id, fields);
  }, [track.id, onUpdateTrack]);

  const [name, setName, blurName] = useLocalField(track.name ?? '', (v) => commit({ name: v }));
  const [driver, setDriver, blurDriver] = useLocalField(track.driver ?? '', (v) => commit({ driver: v || undefined }));
  const [color, setColor, blurColor] = useLocalField(track.color ?? '', (v) => commit({ color: v || undefined }));
  const [agentProfile, setAgentProfile, blurAgentProfile] = useLocalField(track.agent_profile ?? '', (v) => commit({ agent_profile: v || undefined }));
  const [cwd, setCwd, blurCwd] = useLocalField(track.cwd ?? '', (v) => commit({ cwd: v || undefined }));

  const handleModelTierChange = useCallback((model_tier: string) => {
    commit({ model_tier: model_tier || undefined });
  }, [commit]);

  const handleOnFailureChange = useCallback((on_failure: string) => {
    commit({ on_failure: on_failure || undefined });
  }, [commit]);

  const handlePermToggle = useCallback((key: 'read' | 'write' | 'execute') => {
    const current = track.permissions ?? {};
    const next = { ...current, [key]: !current[key] };
    // If all are falsy, remove permissions entirely
    if (!next.read && !next.write && !next.execute) {
      commit({ permissions: undefined });
    } else {
      commit({ permissions: next });
    }
  }, [track.permissions, commit]);

  return (
    <div className="w-80 h-full bg-tagma-surface border-l border-tagma-border flex flex-col animate-slide-in-right">
      <div className="panel-header">
        <h2 className="panel-title truncate">{track.name || track.id}</h2>
        <button onClick={onClose} className="p-1 text-tagma-muted hover:text-tagma-text transition-colors">
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {/* ID (readonly) * */}
        <div>
          <label className="field-label">Track ID <span className="text-tagma-error">*</span></label>
          <div className="text-[11px] font-mono text-tagma-muted bg-tagma-bg border border-tagma-border px-2.5 py-1.5 truncate" title={track.id}>{track.id}</div>
        </div>

        {/* Name * */}
        <div>
          <label className="field-label">Name <span className="text-tagma-error">*</span></label>
          <input type="text" className="field-input" value={name} onChange={(e) => setName(e.target.value)} onBlur={blurName} placeholder="Track name..." />
        </div>

        {/* Color */}
        <div>
          <label className="field-label">Color</label>
          <div className="flex items-center gap-2">
            <input type="color" value={color || '#d4845a'} onChange={(e) => setColor(e.target.value)} onBlur={blurColor}
              className="w-8 h-8 border border-tagma-border bg-tagma-bg cursor-pointer p-0.5" />
            <input type="text" className="field-input flex-1" value={color} onChange={(e) => setColor(e.target.value)} onBlur={blurColor} placeholder="#hex or empty" />
          </div>
        </div>

        <div className="border-t border-tagma-border" />

        {/* Driver */}
        <div>
          <label className="field-label">Driver</label>
          <input type="text" className="field-input" value={driver} onChange={(e) => setDriver(e.target.value)} onBlur={blurDriver} placeholder="claude-code (inherited)" />
        </div>

        {/* Model Tier */}
        <div>
          <label className="field-label">Model Tier</label>
          <select className="field-input" value={track.model_tier ?? ''} onChange={(e) => handleModelTierChange(e.target.value)}>
            <option value="">inherited</option>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </div>

        {/* Agent Profile */}
        <div>
          <label className="field-label">Agent Profile</label>
          <input type="text" className="field-input" value={agentProfile} onChange={(e) => setAgentProfile(e.target.value)} onBlur={blurAgentProfile} placeholder="e.g. senior" />
        </div>

        {/* CWD */}
        <div>
          <label className="field-label">Working Directory</label>
          <input type="text" className="field-input font-mono text-[11px]" value={cwd} onChange={(e) => setCwd(e.target.value)} onBlur={blurCwd} placeholder="./path (relative, inherited)" />
        </div>

        <div className="border-t border-tagma-border" />

        {/* Permissions */}
        <div>
          <label className="field-label">Permissions</label>
          <div className="flex gap-3">
            {(['read', 'write', 'execute'] as const).map((key) => (
              <label key={key} className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={!!track.permissions?.[key]}
                  onChange={() => handlePermToggle(key)}
                  className="accent-tagma-accent" />
                <span className="text-[11px] text-tagma-text capitalize">{key}</span>
              </label>
            ))}
          </div>
        </div>

        {/* On Failure */}
        <div>
          <label className="field-label">On Failure</label>
          <select className="field-input" value={track.on_failure ?? ''} onChange={(e) => handleOnFailureChange(e.target.value)}>
            <option value="">skip_downstream (default)</option>
            <option value="skip_downstream">skip_downstream</option>
            <option value="stop_all">stop_all</option>
            <option value="ignore">ignore</option>
          </select>
        </div>

        <div className="border-t border-tagma-border" />

        {/* Task count (readonly) */}
        <div>
          <label className="field-label">Tasks <span className="text-tagma-error">*</span></label>
          <div className="text-[11px] font-mono text-tagma-muted bg-tagma-bg border border-tagma-border px-2.5 py-1.5">{track.tasks.length} task{track.tasks.length !== 1 ? 's' : ''}</div>
        </div>

        {/* Middlewares (readonly display) */}
        {track.middlewares && track.middlewares.length > 0 && (
          <div>
            <label className="field-label">Middlewares</label>
            <div className="space-y-1">
              {track.middlewares.map((m, i) => (
                <div key={i} className="text-[11px] font-mono text-tagma-muted bg-tagma-bg border border-tagma-border px-2.5 py-1.5 truncate">
                  {m.type}{m.file ? ` → ${m.file}` : ''}{m.label ? ` (${m.label})` : ''}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Delete */}
        <div className="pt-4 border-t border-tagma-border">
          <button onClick={() => onDeleteTrack(track.id)} className="btn-danger flex items-center justify-center gap-1.5">
            <Trash2 size={12} />
            Delete Track
          </button>
        </div>
      </div>
    </div>
  );
}

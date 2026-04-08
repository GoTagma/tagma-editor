import { useCallback } from 'react';
import { X, Plus } from 'lucide-react';
import type { MiddlewareConfig } from '../../api/client';
import { useLocalField } from '../../hooks/use-local-field';

interface MiddlewareEditorProps {
  middlewares: MiddlewareConfig[];
  onChange: (middlewares: MiddlewareConfig[] | undefined) => void;
}

export function MiddlewareEditor({ middlewares, onChange }: MiddlewareEditorProps) {
  const handleAdd = useCallback(() => {
    onChange([...middlewares, { type: 'static_context', file: '' }]);
  }, [middlewares, onChange]);

  const handleRemove = useCallback((index: number) => {
    const next = middlewares.filter((_, i) => i !== index);
    onChange(next.length > 0 ? next : undefined);
  }, [middlewares, onChange]);

  const handleUpdate = useCallback((index: number, patch: Partial<MiddlewareConfig>) => {
    const next = middlewares.map((m, i) => i === index ? { ...m, ...patch } : m);
    onChange(next);
  }, [middlewares, onChange]);

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="field-label mb-0">Middlewares</label>
        <button onClick={handleAdd} className="flex items-center gap-1 text-[10px] text-tagma-accent hover:text-tagma-text transition-colors">
          <Plus size={10} /> Add
        </button>
      </div>
      {middlewares.length === 0 && (
        <p className="text-[10px] text-tagma-muted">No middlewares. Click Add to create one.</p>
      )}
      <div className="space-y-2">
        {middlewares.map((m, i) => (
          <MiddlewareItem key={i} middleware={m} onUpdate={(patch) => handleUpdate(i, patch)} onRemove={() => handleRemove(i)} />
        ))}
      </div>
    </div>
  );
}

function MiddlewareItem({ middleware, onUpdate, onRemove }: {
  middleware: MiddlewareConfig;
  onUpdate: (patch: Partial<MiddlewareConfig>) => void;
  onRemove: () => void;
}) {
  const [file, setFile, blurFile] = useLocalField(middleware.file ?? '', (v) => onUpdate({ file: v || undefined }));
  const [label, setLabel, blurLabel] = useLocalField(middleware.label ?? '', (v) => onUpdate({ label: v || undefined }));

  return (
    <div className="bg-tagma-bg border border-tagma-border p-2 space-y-1.5 relative">
      <button onClick={onRemove} className="absolute top-1.5 right-1.5 text-tagma-muted hover:text-tagma-error transition-colors">
        <X size={10} />
      </button>
      <div>
        <label className="text-[10px] text-tagma-muted">Type</label>
        <select className="field-input text-[11px]" value={middleware.type} onChange={(e) => onUpdate({ type: e.target.value })}>
          <option value="static_context">static_context</option>
        </select>
      </div>
      {middleware.type === 'static_context' && (
        <>
          <div>
            <label className="text-[10px] text-tagma-muted">File <span className="text-tagma-error">*</span></label>
            <input type="text" className="field-input font-mono text-[11px]" value={file} onChange={(e) => setFile(e.target.value)} onBlur={blurFile} placeholder="./context.md" />
          </div>
          <div>
            <label className="text-[10px] text-tagma-muted">Label</label>
            <input type="text" className="field-input text-[11px]" value={label} onChange={(e) => setLabel(e.target.value)} onBlur={blurLabel} placeholder="Reference: filename" />
          </div>
        </>
      )}
    </div>
  );
}

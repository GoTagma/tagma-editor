import { useState } from 'react';
import { ShieldCheck, X, Check } from 'lucide-react';
import type { ApprovalRequestInfo } from '../../api/client';

interface ApprovalDialogProps {
  request: ApprovalRequestInfo;
  onApprove: (choice?: string) => void;
  onReject: (reason?: string) => void;
}

/**
 * Modal-ish dialog that lets the user respond to an `ApprovalRequest`
 * emitted by a manual trigger. Rendered inside RunView as an overlay
 * when one or more approvals are pending.
 */
export function ApprovalDialog({ request, onApprove, onReject }: ApprovalDialogProps) {
  const [selectedChoice, setSelectedChoice] = useState<string | undefined>(
    request.options?.[0],
  );
  const hasOptions = request.options && request.options.length > 0;

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40">
      <div className="w-[420px] max-w-full bg-tagma-surface border border-tagma-border shadow-xl">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-tagma-border bg-tagma-elevated">
          <ShieldCheck size={14} className="text-tagma-warning" />
          <span className="text-xs font-medium text-tagma-text flex-1">Approval Required</span>
          <span className="text-[10px] font-mono text-tagma-muted">{request.taskId}</span>
        </div>

        <div className="px-4 py-3 space-y-3">
          <div>
            <label className="field-label">Message</label>
            <div className="text-[12px] text-tagma-text whitespace-pre-wrap break-words">
              {request.message || '(no message)'}
            </div>
          </div>

          {hasOptions && (
            <div>
              <label className="field-label">Choose an option</label>
              <div className="flex flex-col gap-1.5">
                {request.options.map((opt) => (
                  <label
                    key={opt}
                    className={`
                      flex items-center gap-2 px-2.5 py-1.5 border cursor-pointer text-[11px]
                      ${selectedChoice === opt
                        ? 'border-tagma-accent bg-tagma-accent/6 text-tagma-text'
                        : 'border-tagma-border text-tagma-muted hover:text-tagma-text'}
                    `}
                  >
                    <input
                      type="radio"
                      name={`approval-${request.id}`}
                      value={opt}
                      checked={selectedChoice === opt}
                      onChange={() => setSelectedChoice(opt)}
                      className="accent-tagma-accent"
                    />
                    <span className="font-mono">{opt}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {request.metadata && Object.keys(request.metadata).length > 0 && (
            <div>
              <label className="field-label">Metadata</label>
              <pre className="text-[10px] font-mono text-tagma-muted bg-tagma-bg border border-tagma-border px-2 py-1.5 overflow-auto max-h-[140px]">
                {JSON.stringify(request.metadata, null, 2)}
              </pre>
            </div>
          )}

          <div className="text-[10px] font-mono text-tagma-muted">
            Timeout: {Math.round(request.timeoutMs / 1000)}s · Created {new Date(request.createdAt).toLocaleTimeString()}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-2.5 border-t border-tagma-border bg-tagma-elevated">
          <button
            type="button"
            onClick={() => onReject()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-tagma-error border border-tagma-error/30 hover:bg-tagma-error/10 transition-colors"
          >
            <X size={11} />
            <span>Reject</span>
          </button>
          <button
            type="button"
            onClick={() => onApprove(selectedChoice)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-tagma-success border border-tagma-success/30 hover:bg-tagma-success/10 transition-colors"
          >
            <Check size={11} />
            <span>Approve</span>
          </button>
        </div>
      </div>
    </div>
  );
}

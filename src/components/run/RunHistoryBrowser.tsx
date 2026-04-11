import { useEffect, useState, useCallback } from 'react';
import { History, RefreshCw, FileText, Loader2 } from 'lucide-react';
import { api, type RunHistoryEntry } from '../../api/client';

interface RunHistoryBrowserProps {
  compact?: boolean;
}

/**
 * Browses `.tagma/logs/run_*` directories under the current workspace.
 * Visible when no active run is running. Clicking a row fetches the
 * pipeline.log and displays it inline.
 */
export function RunHistoryBrowser({ compact = false }: RunHistoryBrowserProps) {
  const [runs, setRuns] = useState<RunHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [logContent, setLogContent] = useState<string>('');
  const [logLoading, setLogLoading] = useState(false);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listRunHistory();
      setRuns(res.runs);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load history');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const loadLog = useCallback(async (runId: string) => {
    setSelectedRunId(runId);
    setLogLoading(true);
    setLogContent('');
    try {
      const res = await api.getRunLog(runId);
      setLogContent(res.content);
    } catch (e: unknown) {
      setLogContent(`Error: ${e instanceof Error ? e.message : 'Failed to load log'}`);
    } finally {
      setLogLoading(false);
    }
  }, []);

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  return (
    <div className={`flex ${compact ? 'flex-col' : 'flex-row'} h-full overflow-hidden`}>
      {/* Run list */}
      <div className={`${compact ? 'h-40' : 'w-64'} shrink-0 border-r border-tagma-border flex flex-col bg-tagma-surface overflow-hidden`}>
        <div className="flex items-center gap-2 px-3 py-2 border-b border-tagma-border shrink-0">
          <History size={12} className="text-tagma-muted" />
          <span className="text-[11px] font-medium text-tagma-text flex-1">Run History</span>
          <button
            type="button"
            onClick={loadHistory}
            className="p-1 text-tagma-muted hover:text-tagma-text transition-colors"
            title="Refresh"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {error && (
            <div className="px-3 py-2 text-[10px] text-tagma-error font-mono">{error}</div>
          )}
          {!loading && !error && runs.length === 0 && (
            <div className="px-3 py-3 text-[10px] text-tagma-muted">
              No past runs found in <span className="font-mono">.tagma/logs/</span>
            </div>
          )}
          {runs.map((run) => (
            <button
              type="button"
              key={run.runId}
              onClick={() => loadLog(run.runId)}
              className={`
                w-full text-left px-3 py-1.5 border-b border-tagma-border/40 hover:bg-tagma-elevated transition-colors
                ${selectedRunId === run.runId ? 'bg-tagma-accent/8 border-l-2 border-l-tagma-accent' : ''}
              `}
            >
              <div className="flex items-center gap-1.5">
                <FileText size={10} className="text-tagma-muted shrink-0" />
                <span className="text-[10px] font-mono text-tagma-text truncate flex-1">{run.runId}</span>
              </div>
              <div className="text-[9px] font-mono text-tagma-muted pl-4 mt-0.5">
                {new Date(run.startedAt).toLocaleString()} · {formatSize(run.sizeBytes)}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Log viewer */}
      <div className="flex-1 flex flex-col overflow-hidden bg-tagma-bg">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-tagma-border shrink-0">
          <FileText size={12} className="text-tagma-muted" />
          <span className="text-[11px] font-mono text-tagma-muted flex-1 truncate">
            {selectedRunId ? `${selectedRunId}/pipeline.log` : 'Select a run to view its log'}
          </span>
          {logLoading && <Loader2 size={11} className="animate-spin text-tagma-muted" />}
        </div>
        <div className="flex-1 overflow-auto">
          {selectedRunId && !logLoading && (
            <pre className="text-[10px] font-mono text-tagma-text whitespace-pre-wrap break-words px-3 py-2">
              {logContent || '(empty)'}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, Check, Download, ExternalLink, Loader2, Package, Search, Store, TrendingUp,
} from 'lucide-react';
import { api } from '../../api/client';
import type {
  MarketplaceEntry,
  MarketplacePackageDetail,
  PluginCategory,
  PluginRegistry,
} from '../../api/client';
import {
  classifyError,
  errorHint,
  extractErrorMessage,
  formatDownloads,
  type ErrorKind,
} from './plugin-errors';

interface MarketplacePanelProps {
  category: 'all' | PluginCategory;
  declaredPlugins: readonly string[];
  onRegistryUpdate: (registry: PluginRegistry) => void;
  onPluginsChange: (plugins: string[]) => void;
}

type InstallState =
  | { type: 'idle' }
  | { type: 'installing'; name: string }
  | { type: 'installed'; name: string; version: string }
  | { type: 'error'; name: string; message: string; kind: ErrorKind };

const SEARCH_DEBOUNCE_MS = 350;
const MARKETPLACE_CONSENT_KEY = 'tagma.marketplace.consentGranted';

function hasConsent(): boolean {
  try { return window.localStorage.getItem(MARKETPLACE_CONSENT_KEY) === '1'; }
  catch { return false; }
}

function grantConsent(): void {
  try { window.localStorage.setItem(MARKETPLACE_CONSENT_KEY, '1'); }
  catch { /* ignore */ }
}

/**
 * Marketplace browser. Queries the server's `/api/marketplace/search` proxy
 * (which in turn hits the npm registry, filters by `keywords:tagma-plugin`,
 * and enriches each result with the SDK-level `tagmaPlugin` manifest + a
 * weekly download count). Install actions flow through the normal
 * `/api/plugins/install` endpoint — the marketplace is purely a discovery
 * surface, not a parallel install path.
 *
 * First-time marketplace installs from an untrusted source prompt the user
 * with a one-time confirmation so a stray click can't silently pull
 * arbitrary code into the workspace. Subsequent installs are direct.
 */
export function MarketplacePanel({
  category,
  declaredPlugins,
  onRegistryUpdate,
  onPluginsChange,
}: MarketplacePanelProps) {
  const [rawQuery, setRawQuery] = useState('');
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<MarketplaceEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [installState, setInstallState] = useState<InstallState>({ type: 'idle' });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<MarketplacePackageDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setQuery(rawQuery.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [rawQuery]);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.searchMarketplace(
        query,
        category === 'all' ? undefined : category,
      );
      setEntries(res.entries);
    } catch (e: unknown) {
      setLoadError(extractErrorMessage(e));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [query, category]);

  useEffect(() => {
    reload();
  }, [reload]);

  const declaredSet = useMemo(() => new Set(declaredPlugins), [declaredPlugins]);

  const handleInstall = useCallback(async (entry: MarketplaceEntry) => {
    if (!hasConsent()) {
      const ok = window.confirm(
        `Install "${entry.name}" from the public npm registry?\n\n` +
        'This will download the package into your workspace and execute its code ' +
        'as part of pipeline runs. Only install plugins you trust.\n\n' +
        'You will not be prompted again for future marketplace installs.'
      );
      if (!ok) return;
      grantConsent();
    }
    setInstallState({ type: 'installing', name: entry.name });
    try {
      const result = await api.installPlugin(entry.name);
      onRegistryUpdate(result.registry);
      if (!declaredPlugins.includes(entry.name)) {
        onPluginsChange([...declaredPlugins, entry.name]);
      }
      setInstallState({
        type: 'installed',
        name: entry.name,
        version: result.plugin.version ?? entry.version,
      });
    } catch (e: unknown) {
      const message = extractErrorMessage(e);
      setInstallState({
        type: 'error',
        name: entry.name,
        message,
        kind: classifyError(e, message),
      });
    }
  }, [declaredPlugins, onRegistryUpdate, onPluginsChange]);

  const handleExpand = useCallback(async (name: string) => {
    if (expanded === name) {
      setExpanded(null);
      setDetail(null);
      return;
    }
    setExpanded(name);
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await api.getMarketplacePackage(name);
      setDetail(res);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, [expanded]);

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-tagma-border bg-tagma-surface/30">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-tagma-muted pointer-events-none" />
          <input
            type="text"
            className="field-input w-full pl-8 text-[11px]"
            value={rawQuery}
            onChange={(e) => setRawQuery(e.target.value)}
            placeholder="Search the plugin marketplace…"
          />
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-tagma-muted px-2">
          <Store size={12} />
          <span>npm · keywords:tagma-plugin</span>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
        {loading ? (
          <div className="h-full flex flex-col items-center justify-center text-tagma-muted gap-2">
            <Loader2 size={24} className="animate-spin opacity-70" />
            <p className="text-[11px]">Searching npm…</p>
          </div>
        ) : loadError ? (
          <div className="h-full flex flex-col items-center justify-center text-tagma-error gap-2">
            <AlertCircle size={24} className="opacity-70" />
            <p className="text-[11px]">{loadError}</p>
            <button
              onClick={reload}
              className="px-2 py-1 text-[10px] bg-tagma-bg border border-tagma-border hover:border-tagma-accent transition-colors"
            >
              Retry
            </button>
          </div>
        ) : entries.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-tagma-muted gap-2">
            <Package size={32} className="opacity-30" />
            <p className="text-[11px]">
              {query ? `No plugins match "${query}"` : 'No plugins found in the marketplace.'}
            </p>
            <p className="text-[10px] text-tagma-muted/70">
              Plugin authors tag packages with <code className="font-mono">keywords: ["tagma-plugin"]</code> in <code className="font-mono">package.json</code>.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(360px,1fr))] gap-2">
            {entries.map((entry) => (
              <MarketplaceCard
                key={entry.name}
                entry={entry}
                installed={declaredSet.has(entry.name)}
                expanded={expanded === entry.name}
                detail={expanded === entry.name ? detail : null}
                detailLoading={expanded === entry.name && detailLoading}
                installState={installState}
                onExpand={() => handleExpand(entry.name)}
                onInstall={() => handleInstall(entry)}
              />
            ))}
          </div>
        )}
      </div>

      {installState.type === 'error' && (
        <div className="shrink-0 mx-4 mb-3 px-3 py-2 bg-tagma-error/10 border border-tagma-error/30 text-[10px]">
          <div className="flex items-start gap-2">
            <AlertCircle size={12} className="text-tagma-error shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-tagma-error font-medium">
                Install failed — <span className="font-mono">{installState.name}</span>
              </div>
              <div className="text-tagma-muted">{errorHint(installState.kind)}</div>
              <pre className="mt-1 px-1.5 py-1 bg-black/40 border border-tagma-error/20 text-tagma-error text-[9px] font-mono whitespace-pre-wrap break-words max-h-32 overflow-y-auto">
                {installState.message}
              </pre>
            </div>
            <button
              onClick={() => setInstallState({ type: 'idle' })}
              className="text-tagma-muted hover:text-tagma-text"
              title="Dismiss"
            >&times;</button>
          </div>
        </div>
      )}
    </div>
  );
}

function MarketplaceCard({
  entry,
  installed,
  expanded,
  detail,
  detailLoading,
  installState,
  onExpand,
  onInstall,
}: {
  entry: MarketplaceEntry;
  installed: boolean;
  expanded: boolean;
  detail: MarketplacePackageDetail | null;
  detailLoading: boolean;
  installState: InstallState;
  onExpand: () => void;
  onInstall: () => void;
}) {
  const isThisInstalling = installState.type === 'installing' && installState.name === entry.name;
  const justInstalled = installState.type === 'installed' && installState.name === entry.name;

  return (
    <div className="flex flex-col bg-tagma-surface/50 border border-tagma-border hover:border-tagma-accent/40 transition-colors">
      <button
        onClick={onExpand}
        className="flex items-start gap-2 p-3 text-left w-full"
      >
        <Package size={14} className="text-tagma-muted shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[12px] font-mono text-tagma-text truncate">{entry.name}</span>
            <span className="text-[10px] text-tagma-muted shrink-0">v{entry.version}</span>
            {entry.weeklyDownloads !== null && (
              <span className="flex items-center gap-0.5 text-[9px] text-tagma-muted shrink-0" title="Weekly downloads">
                <TrendingUp size={9} />
                {formatDownloads(entry.weeklyDownloads)}
              </span>
            )}
          </div>
          {entry.description && (
            <p className="text-[10px] text-tagma-muted mt-0.5 line-clamp-2">{entry.description}</p>
          )}
          <div className="flex items-center gap-1 mt-1.5 flex-wrap">
            <span className="text-[9px] px-1 py-px bg-purple-500/10 text-purple-400/80 border border-purple-500/20">
              {entry.category}
            </span>
            <span className="text-[9px] px-1 py-px bg-tagma-muted/10 text-tagma-muted border border-tagma-muted/20 font-mono">
              {entry.type}
            </span>
            {installed && (
              <span className="text-[9px] px-1 py-px bg-green-500/10 text-green-400/80 border border-green-500/20">
                declared
              </span>
            )}
            {entry.author && (
              <span className="text-[9px] text-tagma-muted truncate">by {entry.author}</span>
            )}
          </div>
        </div>
        <div className="shrink-0">
          {isThisInstalling ? (
            <span className="flex items-center gap-1 text-[10px] text-tagma-muted">
              <Loader2 size={11} className="animate-spin" />
              Installing…
            </span>
          ) : justInstalled ? (
            <span className="flex items-center gap-1 text-[10px] text-green-400">
              <Check size={11} />
              Installed
            </span>
          ) : (
            <span
              role="button"
              onClick={(e) => { e.stopPropagation(); onInstall(); }}
              className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium bg-blue-500/20 text-blue-300 border border-blue-500/30 hover:bg-blue-500/30 transition-colors"
            >
              <Download size={11} />
              {installed ? 'Reinstall' : 'Install'}
            </span>
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-0 border-t border-tagma-border/50 bg-tagma-bg/30">
          {detailLoading ? (
            <div className="flex items-center gap-1.5 py-3 text-[10px] text-tagma-muted">
              <Loader2 size={11} className="animate-spin" />
              Loading details…
            </div>
          ) : detail ? (
            <div className="space-y-2 mt-2">
              {detail.license && (
                <div className="text-[10px] text-tagma-muted">
                  License: <span className="text-tagma-text">{detail.license}</span>
                </div>
              )}
              {detail.date && (
                <div className="text-[10px] text-tagma-muted">
                  Last publish: <span className="text-tagma-text">{new Date(detail.date).toLocaleString()}</span>
                </div>
              )}
              {detail.homepage && (
                <a
                  href={detail.homepage}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300"
                >
                  <ExternalLink size={10} />
                  Homepage
                </a>
              )}
              {detail.repository && (
                <a
                  href={detail.repository.replace(/^git\+/, '').replace(/\.git$/, '')}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300"
                >
                  <ExternalLink size={10} />
                  Repository
                </a>
              )}
              {detail.readme && (
                <details className="mt-2">
                  <summary className="text-[10px] text-tagma-muted cursor-pointer hover:text-tagma-text">
                    README preview
                  </summary>
                  <pre className="mt-1 px-2 py-1.5 bg-black/40 border border-tagma-border text-[9px] text-tagma-muted font-mono whitespace-pre-wrap max-h-64 overflow-y-auto">
                    {detail.readme.slice(0, 4000)}
                    {detail.readme.length > 4000 && '\n\n… (truncated)'}
                  </pre>
                </details>
              )}
            </div>
          ) : (
            <div className="py-2 text-[10px] text-tagma-muted">Details unavailable.</div>
          )}
        </div>
      )}
    </div>
  );
}

import { useMemo, useState } from 'react';
import {
  AlertCircle, Check, Download, Loader2, Package, RefreshCw, RotateCcw, Trash2,
} from 'lucide-react';
import type { PluginCategory, PluginInfo } from '../../api/client';
import { errorHint } from './plugin-errors';
import type { PluginActionState } from './PluginsPage';

interface InstalledPanelProps {
  plugins: readonly PluginInfo[];
  autoLoadErrors: ReadonlyArray<{ name: string; message: string }>;
  declaredSet: ReadonlySet<string>;
  category: 'all' | PluginCategory;
  loading: boolean;
  actionState: PluginActionState;
  onInstall: (name: string) => void;
  onUninstall: (name: string) => void;
  onLoad: (name: string) => void;
  onDismissAction: () => void;
}

/**
 * Stateless card view of the installed plugin list. All data (plugins,
 * auto-load errors, action state) flows in from PluginsPage — this component
 * only renders and forwards button clicks.
 *
 * "Installed" in the workspace is broader than "declared in YAML": a plugin
 * may live in `node_modules` without appearing in `pipeline.plugins[]`, or
 * vice-versa. The panel shows every plugin the server knows about and
 * annotates whether it's installed, loaded into the runtime registry, and
 * declared in YAML.
 */
export function InstalledPanel({
  plugins,
  autoLoadErrors,
  declaredSet,
  category,
  loading,
  actionState,
  onInstall,
  onUninstall,
  onLoad,
  onDismissAction,
}: InstalledPanelProps) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return plugins.filter((p) => {
      if (category !== 'all' && !p.categories.includes(category)) return false;
      if (!q) return true;
      const haystack = `${p.name} ${p.description ?? ''} ${p.categories.join(' ')}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [plugins, search, category]);

  const actionBannerVisible =
    actionState.type === 'error' || actionState.type === 'success';

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-tagma-border bg-tagma-surface/30">
        <input
          type="text"
          className="field-input flex-1 text-[11px]"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search installed plugins…"
        />
      </div>

      {autoLoadErrors.length > 0 && (
        <div className="shrink-0 mx-4 mt-3 px-3 py-2 bg-tagma-error/10 border border-tagma-error/30 text-[10px]">
          <div className="flex items-start gap-2">
            <AlertCircle size={12} className="text-tagma-error shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-tagma-error font-medium mb-1">
                {autoLoadErrors.length} plugin{autoLoadErrors.length === 1 ? '' : 's'} failed to auto-load
              </p>
              <ul className="space-y-0.5">
                {autoLoadErrors.map((err) => (
                  <li key={err.name} className="font-mono text-tagma-muted truncate" title={err.message}>
                    <span className="text-tagma-error/80">{err.name}</span> — {err.message}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
        {loading && plugins.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-tagma-muted gap-2">
            <Loader2 size={24} className="animate-spin opacity-70" />
            <p className="text-[11px]">Loading plugins…</p>
          </div>
        ) : filtered.length > 0 ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-2">
            {filtered.map((p) => (
              <PluginCard
                key={p.name}
                plugin={p}
                declared={declaredSet.has(p.name)}
                actionState={actionState}
                onInstall={onInstall}
                onUninstall={onUninstall}
                onLoad={onLoad}
              />
            ))}
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-tagma-muted gap-2">
            <Package size={32} className="opacity-30" />
            <p className="text-[11px]">
              {search
                ? 'No plugins match your search.'
                : category !== 'all'
                  ? `No ${category} plugins installed.`
                  : 'No plugins installed in this workspace.'}
            </p>
            <p className="text-[10px] text-tagma-muted/70">
              Open the <span className="text-tagma-text">Marketplace</span> tab to discover and install plugins.
            </p>
          </div>
        )}
      </div>

      {actionBannerVisible && (
        <div className="shrink-0 mx-4 mb-3">
          <ActionBanner state={actionState} onDismiss={onDismissAction} />
        </div>
      )}
    </div>
  );
}

function PluginCard({
  plugin,
  declared,
  actionState,
  onInstall,
  onUninstall,
  onLoad,
}: {
  plugin: PluginInfo;
  declared: boolean;
  actionState: PluginActionState;
  onInstall: (name: string) => void;
  onUninstall: (name: string) => void;
  onLoad: (name: string) => void;
}) {
  const isBusy =
    actionState.type === 'loading' && actionState.name === plugin.name;
  const busyAction = isBusy ? actionState.action : null;
  const disabled = actionState.type === 'loading';

  return (
    <div className="flex flex-col gap-1.5 p-3 bg-tagma-surface/50 border border-tagma-border hover:border-tagma-accent/40 transition-colors">
      <div className="flex items-start gap-2">
        <Package size={14} className="text-tagma-muted shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[12px] font-mono text-tagma-text truncate">{plugin.name}</span>
            {plugin.version && (
              <span className="text-[10px] text-tagma-muted shrink-0">v{plugin.version}</span>
            )}
          </div>
          {plugin.description && (
            <p className="text-[10px] text-tagma-muted mt-0.5 line-clamp-2">{plugin.description}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 flex-wrap min-h-[16px]">
        {plugin.installed ? (
          <span className="text-[9px] px-1 py-px bg-green-500/10 text-green-400/80 border border-green-500/20">installed</span>
        ) : (
          <span className="text-[9px] px-1 py-px bg-tagma-error/10 text-tagma-error/80 border border-tagma-error/20">missing</span>
        )}
        {plugin.loaded && (
          <span className="text-[9px] px-1 py-px bg-blue-500/10 text-blue-400/80 border border-blue-500/20">loaded</span>
        )}
        {declared && (
          <span className="text-[9px] px-1 py-px bg-purple-500/10 text-purple-400/80 border border-purple-500/20">declared</span>
        )}
        {plugin.categories.map((cat) => (
          <span key={cat} className="text-[9px] px-1 py-px bg-tagma-muted/10 text-tagma-muted border border-tagma-muted/20">
            {cat}
          </span>
        ))}
      </div>

      <div className="flex items-center justify-end gap-1 mt-1">
        {isBusy ? (
          <span className="flex items-center gap-1 text-[10px] text-tagma-muted">
            <Loader2 size={11} className="animate-spin" />
            {busyAction === 'install' ? 'Installing…'
              : busyAction === 'uninstall' ? 'Uninstalling…'
              : busyAction === 'load' ? 'Loading…'
              : 'Working…'}
          </span>
        ) : (
          <>
            {!plugin.installed && (
              <button
                onClick={() => onInstall(plugin.name)}
                disabled={disabled}
                className="p-1 text-blue-400 hover:text-blue-300 transition-colors disabled:opacity-40"
                title="Install — downloads from npm and records in manifest"
              >
                <Download size={12} />
              </button>
            )}
            {plugin.installed && !plugin.loaded && (
              <button
                onClick={() => onLoad(plugin.name)}
                disabled={disabled}
                className="p-1 text-blue-400 hover:text-blue-300 transition-colors disabled:opacity-40"
                title="Load into registry — runtime only"
              >
                <RefreshCw size={12} />
              </button>
            )}
            {plugin.installed && (
              <button
                onClick={() => onUninstall(plugin.name)}
                disabled={disabled}
                className="p-1 text-tagma-error hover:text-tagma-error/80 transition-colors disabled:opacity-40"
                title="Uninstall"
              >
                <Trash2 size={12} />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ActionBanner({
  state,
  onDismiss,
}: {
  state: PluginActionState;
  onDismiss: () => void;
}) {
  if (state.type !== 'error' && state.type !== 'success') return null;

  const isError = state.type === 'error';
  const Icon = isError ? AlertCircle : Check;
  const colorClass = isError
    ? 'bg-tagma-error/10 border-tagma-error/30 text-tagma-error'
    : 'bg-green-500/10 border-green-500/30 text-green-400';

  return (
    <div className={`px-3 py-2 border text-[10px] ${colorClass}`}>
      <div className="flex items-start gap-2">
        <Icon size={12} className="shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <span className="font-mono truncate">{state.name}</span>
            {isError && (
              <span className="text-tagma-muted">— {capitalize(state.action)} failed</span>
            )}
          </div>
          {isError ? (
            <>
              <div className="mt-0.5 text-tagma-muted">{errorHint(state.kind)}</div>
              <pre className="mt-1 px-1.5 py-1 bg-black/40 border border-tagma-error/20 text-tagma-error text-[9px] font-mono whitespace-pre-wrap break-words max-h-32 overflow-y-auto">
                {state.message}
              </pre>
            </>
          ) : (
            <div className="text-tagma-muted mt-0.5">{state.message}</div>
          )}
        </div>
        <button onClick={onDismiss} className="text-tagma-muted hover:text-tagma-text shrink-0" title="Dismiss">
          <RotateCcw size={10} className="opacity-0 pointer-events-none" aria-hidden />
          &times;
        </button>
      </div>
    </div>
  );
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

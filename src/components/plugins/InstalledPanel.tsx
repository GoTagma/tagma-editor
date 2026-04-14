import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, Check, Download, Loader2, Package, RefreshCw, RotateCcw, Trash2, Info,
} from 'lucide-react';
import { api } from '../../api/client';
import type { PluginCategory, PluginInfo, PluginRegistry } from '../../api/client';
import { classifyError, errorHint, extractErrorMessage, type ErrorKind } from './plugin-errors';

type ActionState =
  | { type: 'idle' }
  | { type: 'loading'; plugin: string; action: string }
  | { type: 'error'; plugin: string; action: string; message: string; kind: ErrorKind }
  | { type: 'success'; plugin: string; message: string };

interface InstalledPanelProps {
  declaredPlugins: readonly string[];
  category: 'all' | PluginCategory;
  onRegistryUpdate: (registry: PluginRegistry) => void;
  onPluginsChange: (plugins: string[]) => void;
}

const SUCCESS_DISMISS_MS = 2000;

/**
 * Workspace-installed plugin management. Lists every plugin that has been
 * declared, installed, or loaded into the current workspace and exposes the
 * same three imperative verbs the old modal did:
 *
 *   Install — writes to pipeline.plugins[] and downloads the tarball
 *   Load    — imports an already-installed package into the runtime registry
 *   Uninstall — removes the package from node_modules and the manifest
 *
 * The underlying server contracts are unchanged; this is just a card-style
 * UI built for a full page instead of a narrow modal column.
 */
export function InstalledPanel({
  declaredPlugins,
  category,
  onRegistryUpdate,
  onPluginsChange,
}: InstalledPanelProps) {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [autoLoadErrors, setAutoLoadErrors] = useState<ReadonlyArray<{ name: string; message: string }>>([]);
  const [actionState, setActionState] = useState<ActionState>({ type: 'idle' });
  const [search, setSearch] = useState('');
  const [inputValue, setInputValue] = useState('');
  const successDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (actionState.type === 'success') {
      if (successDismissTimer.current) clearTimeout(successDismissTimer.current);
      successDismissTimer.current = setTimeout(() => {
        setActionState((s) => (s.type === 'success' ? { type: 'idle' } : s));
      }, SUCCESS_DISMISS_MS);
    }
    return () => {
      if (successDismissTimer.current) {
        clearTimeout(successDismissTimer.current);
        successDismissTimer.current = null;
      }
    };
  }, [actionState]);

  const refresh = useCallback(async () => {
    try {
      const result = await api.listPlugins();
      setPlugins(result.plugins);
      setAutoLoadErrors(result.autoLoadErrors ?? []);
    } catch {
      setPlugins([]);
      setAutoLoadErrors([]);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, declaredPlugins]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return plugins.filter((p) => {
      if (category !== 'all' && !p.categories.includes(category)) return false;
      if (!q) return true;
      const haystack = `${p.name} ${p.description ?? ''} ${p.categories.join(' ')}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [plugins, search, category]);

  const handleInstall = useCallback(async (name: string) => {
    setActionState({ type: 'loading', plugin: name, action: 'Installing' });
    try {
      const result = await api.installPlugin(name);
      onRegistryUpdate(result.registry);
      if (!declaredPlugins.includes(name)) {
        onPluginsChange([...declaredPlugins, name]);
      }
      setActionState({
        type: 'success',
        plugin: name,
        message: result.warning ?? `Installed v${result.plugin.version}`,
      });
      await refresh();
    } catch (e: unknown) {
      const message = extractErrorMessage(e);
      setActionState({ type: 'error', plugin: name, action: 'Install', message, kind: classifyError(e, message) });
    }
  }, [declaredPlugins, onRegistryUpdate, onPluginsChange, refresh]);

  const handleUninstall = useCallback(async (name: string) => {
    setActionState({ type: 'loading', plugin: name, action: 'Uninstalling' });
    try {
      const result = await api.uninstallPlugin(name);
      onRegistryUpdate(result.registry);
      onPluginsChange(declaredPlugins.filter((p) => p !== name));
      setActionState({ type: 'success', plugin: name, message: 'Uninstalled' });
      await refresh();
    } catch (e: unknown) {
      const message = extractErrorMessage(e);
      setActionState({ type: 'error', plugin: name, action: 'Uninstall', message, kind: classifyError(e, message) });
    }
  }, [declaredPlugins, onRegistryUpdate, onPluginsChange, refresh]);

  const handleLoad = useCallback(async (name: string) => {
    setActionState({ type: 'loading', plugin: name, action: 'Loading' });
    try {
      const result = await api.loadPlugin(name);
      onRegistryUpdate(result.registry);
      setActionState({ type: 'success', plugin: name, message: 'Loaded into registry' });
      await refresh();
    } catch (e: unknown) {
      const message = extractErrorMessage(e);
      setActionState({ type: 'error', plugin: name, action: 'Load', message, kind: classifyError(e, message) });
    }
  }, [onRegistryUpdate, refresh]);

  const handleRetry = useCallback(() => {
    if (actionState.type !== 'error') return;
    const { plugin, action } = actionState;
    if (action === 'Install') handleInstall(plugin);
    else if (action === 'Uninstall') handleUninstall(plugin);
    else if (action === 'Load') handleLoad(plugin);
  }, [actionState, handleInstall, handleUninstall, handleLoad]);

  const handleAdd = useCallback(async () => {
    const name = inputValue.trim();
    if (!name) return;
    setInputValue('');
    await handleInstall(name);
  }, [inputValue, handleInstall]);

  const isLoading = actionState.type === 'loading';

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
        <div className="w-px h-5 bg-tagma-border" />
        <input
          type="text"
          className="field-input w-64 font-mono text-[11px]"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
          placeholder="@tagma/driver-codex"
          disabled={isLoading}
        />
        <button
          onClick={handleAdd}
          disabled={isLoading || !inputValue.trim()}
          className="px-2.5 py-1 text-[11px] font-medium bg-blue-500/20 text-blue-300 border border-blue-500/30 hover:bg-blue-500/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
          title="Install from npm"
        >
          {isLoading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
          <span>Install</span>
        </button>
        <button
          onClick={refresh}
          disabled={isLoading}
          className="p-1 text-tagma-muted hover:text-tagma-text transition-colors disabled:opacity-50"
          title="Refresh plugin list"
        >
          <RefreshCw size={13} />
        </button>
      </div>

      <div className="shrink-0 mx-4 mt-3 px-3 py-2 bg-blue-500/5 border border-blue-500/20 text-[10px] text-tagma-muted">
        <div className="flex items-start gap-2">
          <Info size={12} className="text-blue-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p>
              <span className="text-blue-300 font-medium">Install</span> writes the package name to
              <code className="font-mono"> pipeline.plugins[]</code> and downloads it into the workspace — persisted and restored on reload.
            </p>
            <p>
              <span className="text-blue-300 font-medium">Load</span> imports an already-installed package into the runtime registry only. No YAML change; effect lost on server restart.
            </p>
          </div>
        </div>
      </div>

      {autoLoadErrors.length > 0 && (
        <div className="shrink-0 mx-4 mt-2 px-3 py-2 bg-tagma-error/10 border border-tagma-error/30 text-[10px]">
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
        {filtered.length > 0 ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-2">
            {filtered.map((p) => (
              <PluginCard
                key={p.name}
                plugin={p}
                actionState={actionState}
                onInstall={handleInstall}
                onUninstall={handleUninstall}
                onLoad={handleLoad}
                disabled={isLoading}
              />
            ))}
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-tagma-muted gap-2">
            <Package size={32} className="opacity-30" />
            <p className="text-[11px]">
              {search ? 'No plugins match your search' : 'No plugins installed in this workspace.'}
            </p>
          </div>
        )}
      </div>

      {actionState.type !== 'idle' && actionState.type !== 'loading' && (
        <div className="shrink-0 mx-4 mb-3">
          <StatusMessage
            state={actionState}
            onDismiss={() => setActionState({ type: 'idle' })}
            onRetry={handleRetry}
          />
        </div>
      )}
    </div>
  );
}

function PluginCard({
  plugin,
  actionState,
  onInstall,
  onUninstall,
  onLoad,
  disabled,
}: {
  plugin: PluginInfo;
  actionState: ActionState;
  onInstall: (name: string) => void;
  onUninstall: (name: string) => void;
  onLoad: (name: string) => void;
  disabled: boolean;
}) {
  const isThisLoading = actionState.type === 'loading' && actionState.plugin === plugin.name;
  const loadingAction = isThisLoading ? (actionState as { action: string }).action : null;

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
          <span className="text-[9px] px-1 py-px bg-tagma-error/10 text-tagma-error/80 border border-tagma-error/20">not installed</span>
        )}
        {plugin.loaded && (
          <span className="text-[9px] px-1 py-px bg-blue-500/10 text-blue-400/80 border border-blue-500/20">loaded</span>
        )}
        {plugin.categories.map((cat) => (
          <span key={cat} className="text-[9px] px-1 py-px bg-purple-500/10 text-purple-400/80 border border-purple-500/20">
            {cat}
          </span>
        ))}
      </div>

      <div className="flex items-center justify-end gap-1 mt-1">
        {isThisLoading ? (
          <span className="flex items-center gap-1 text-[10px] text-tagma-muted">
            <Loader2 size={11} className="animate-spin" />
            {loadingAction}…
          </span>
        ) : (
          <>
            {!plugin.installed && (
              <button
                onClick={() => onInstall(plugin.name)}
                disabled={disabled}
                className="p-1 text-blue-400 hover:text-blue-300 transition-colors disabled:opacity-40"
                title="Install — writes to YAML and downloads from npm"
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

function StatusMessage({
  state,
  onDismiss,
  onRetry,
}: {
  state: ActionState;
  onDismiss: () => void;
  onRetry: () => void;
}) {
  if (state.type === 'idle' || state.type === 'loading') return null;

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
            <span className="font-mono truncate">{state.plugin}</span>
            {isError && (
              <span className="text-tagma-muted">— {state.action} failed</span>
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
        <button onClick={onDismiss} className="text-tagma-muted hover:text-tagma-text shrink-0" title="Dismiss">&times;</button>
      </div>
      {isError && (
        <div className="flex justify-end mt-1">
          <button
            onClick={onRetry}
            className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] bg-tagma-error/20 border border-tagma-error/30 text-tagma-error hover:bg-tagma-error/30 transition-colors"
            title="Retry"
          >
            <RotateCcw size={10} /> Retry
          </button>
        </div>
      )}
    </div>
  );
}

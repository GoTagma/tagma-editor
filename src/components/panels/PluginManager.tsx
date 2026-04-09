import { useState, useCallback, useEffect, useMemo } from 'react';
import { Download, Trash2, Loader2, Check, AlertCircle, Package, RefreshCw, Search, FolderOpen } from 'lucide-react';
import { api } from '../../api/client';
import type { PluginInfo, PluginRegistry } from '../../api/client';

interface PluginManagerProps {
  /** Plugin names declared in pipeline config */
  declaredPlugins: string[];
  /** Called when registry changes after install/uninstall */
  onRegistryUpdate: (registry: PluginRegistry) => void;
  /** Called to update the pipeline plugins list */
  onPluginsChange: (plugins: string[]) => void;
  /** Called to open file explorer for local plugin import */
  onRequestBrowse?: () => void;
}

type ActionState = { type: 'idle' }
  | { type: 'loading'; plugin: string; action: string }
  | { type: 'error'; plugin: string; message: string }
  | { type: 'success'; plugin: string; message: string };

const ALL_CATEGORY = 'all';
const INSTALLED_FILTER = 'installed';

export function PluginManager({ declaredPlugins, onRegistryUpdate, onPluginsChange, onRequestBrowse }: PluginManagerProps) {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [actionState, setActionState] = useState<ActionState>({ type: 'idle' });
  const [inputValue, setInputValue] = useState('');
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState(ALL_CATEGORY);

  const refresh = useCallback(async () => {
    try {
      const { plugins: list } = await api.listPlugins();
      setPlugins(list);
    } catch {
      setPlugins([]);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, declaredPlugins]);

  // Derive unique categories from all plugins
  const categories = useMemo(() => {
    const cats = new Set<string>();
    for (const p of plugins) {
      for (const c of p.categories) cats.add(c);
    }
    return Array.from(cats).sort();
  }, [plugins]);

  // Filter plugins by search + category
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return plugins.filter((p) => {
      // Category / installed filter
      if (activeFilter === INSTALLED_FILTER) {
        if (!p.installed) return false;
      } else if (activeFilter !== ALL_CATEGORY) {
        if (!p.categories.includes(activeFilter)) return false;
      }
      // Search text
      if (q) {
        const haystack = `${p.name} ${p.description ?? ''} ${p.categories.join(' ')}`.toLowerCase();
        return haystack.includes(q);
      }
      return true;
    });
  }, [plugins, search, activeFilter]);

  const handleInstall = useCallback(async (name: string) => {
    setActionState({ type: 'loading', plugin: name, action: 'Installing' });
    try {
      const result = await api.installPlugin(name);
      onRegistryUpdate(result.registry);

      if (!declaredPlugins.includes(name)) {
        onPluginsChange([...declaredPlugins, name]);
      }

      setActionState({
        type: 'success', plugin: name,
        message: result.warning ?? `Installed v${result.plugin.version}`,
      });
      await refresh();
    } catch (e: any) {
      setActionState({ type: 'error', plugin: name, message: e.message ?? 'Install failed' });
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
    } catch (e: any) {
      setActionState({ type: 'error', plugin: name, message: e.message ?? 'Uninstall failed' });
    }
  }, [declaredPlugins, onRegistryUpdate, onPluginsChange, refresh]);

  const handleLoad = useCallback(async (name: string) => {
    setActionState({ type: 'loading', plugin: name, action: 'Loading' });
    try {
      const result = await api.loadPlugin(name);
      onRegistryUpdate(result.registry);
      setActionState({ type: 'success', plugin: name, message: 'Loaded into registry' });
      await refresh();
    } catch (e: any) {
      setActionState({ type: 'error', plugin: name, message: e.message ?? 'Load failed' });
    }
  }, [onRegistryUpdate, refresh]);

  const handleAdd = useCallback(async () => {
    const name = inputValue.trim();
    if (!name) return;
    setInputValue('');
    await handleInstall(name);
  }, [inputValue, handleInstall]);

  const isLoading = actionState.type === 'loading';

  const filterTabs = [
    { key: ALL_CATEGORY, label: 'All' },
    { key: INSTALLED_FILTER, label: 'Installed' },
    ...categories.map((c) => ({ key: c, label: c })),
  ];

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Search bar */}
      <div className="relative mb-3 shrink-0">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-tagma-muted pointer-events-none" />
        <input
          type="text"
          className="field-input w-full pl-8 font-mono text-[11px]"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search plugins..."
        />
      </div>

      {/* Category filter tabs */}
      {filterTabs.length > 2 && (
        <div className="flex items-center gap-1 mb-3 shrink-0 overflow-x-auto scrollbar-thin">
          {filterTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveFilter(tab.key)}
              className={`px-2 py-0.5 text-[10px] font-medium border whitespace-nowrap transition-colors ${
                activeFilter === tab.key
                  ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                  : 'bg-tagma-bg text-tagma-muted border-tagma-border hover:text-tagma-text'
              }`}
            >
              {tab.label}
            </button>
          ))}
          <button
            onClick={refresh}
            disabled={isLoading}
            className="ml-auto p-1 text-tagma-muted hover:text-tagma-text transition-colors disabled:opacity-50 shrink-0"
            title="Refresh plugin list"
          >
            <RefreshCw size={12} />
          </button>
        </div>
      )}

      {/* Scrollable plugin list */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 mb-3">
        {filtered.length > 0 ? (
          filtered.map((p) => (
            <PluginRow
              key={p.name}
              plugin={p}
              actionState={actionState}
              onInstall={handleInstall}
              onUninstall={handleUninstall}
              onLoad={handleLoad}
              disabled={isLoading}
            />
          ))
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-tagma-muted">
            <Package size={24} className="mb-2 opacity-40" />
            <p className="text-[11px]">
              {search ? 'No plugins match your search' : 'No plugins available'}
            </p>
          </div>
        )}
      </div>

      {/* Add new plugin */}
      <div className="shrink-0 border-t border-tagma-border pt-3">
        <label className="field-label">Install Plugin</label>
        <div className="flex gap-1.5">
          <input
            type="text"
            className="field-input flex-1 font-mono text-[11px]"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
            placeholder="@tagma/driver-codex"
            disabled={isLoading}
          />
          <button
            onClick={handleAdd}
            disabled={isLoading || !inputValue.trim()}
            className="px-2 py-1 text-[10px] font-medium bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="Install from npm"
          >
            <Download size={12} />
          </button>
          {onRequestBrowse && (
            <button
              onClick={onRequestBrowse}
              disabled={isLoading}
              className="px-2 py-1 text-[10px] font-medium bg-orange-500/20 text-orange-400 border border-orange-500/30 hover:bg-orange-500/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="Import from local directory"
            >
              <FolderOpen size={12} />
            </button>
          )}
        </div>
        <p className="text-[10px] text-tagma-muted mt-1">Enter a package name or browse a local plugin directory</p>
      </div>

      {/* Status message */}
      {actionState.type !== 'idle' && actionState.type !== 'loading' && (
        <StatusMessage state={actionState} onDismiss={() => setActionState({ type: 'idle' })} />
      )}
    </div>
  );
}

function PluginRow({ plugin, actionState, onInstall, onUninstall, onLoad, disabled }: {
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
    <div className="flex items-center gap-2 px-2 py-1.5 bg-tagma-bg border border-tagma-border group">
      <Package size={12} className="text-tagma-muted shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
          <span className="text-[11px] font-mono text-tagma-text truncate">{plugin.name}</span>
          {plugin.version && (
            <span className="text-[9px] text-tagma-muted shrink-0">v{plugin.version}</span>
          )}
        </div>
        {plugin.description && (
          <div className="text-[10px] text-tagma-muted truncate mt-0.5">{plugin.description}</div>
        )}
        <div className="flex items-center gap-1.5 mt-0.5 min-w-0 overflow-hidden">
          {plugin.installed ? (
            <span className="text-[9px] px-1 py-px bg-green-500/10 text-green-400/80 border border-green-500/20">installed</span>
          ) : (
            <span className="text-[9px] px-1 py-px bg-red-500/10 text-red-400/80 border border-red-500/20">not installed</span>
          )}
          {plugin.loaded && (
            <span className="text-[9px] px-1 py-px bg-blue-500/10 text-blue-400/80 border border-blue-500/20">loaded</span>
          )}
          {plugin.categories.map((cat) => (
            <span key={cat} className="text-[9px] px-1 py-px bg-purple-500/10 text-purple-400/80 border border-purple-500/20">{cat}</span>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        {isThisLoading ? (
          <span className="flex items-center gap-1 text-[10px] text-tagma-muted">
            <Loader2 size={12} className="animate-spin" />
            {loadingAction}...
          </span>
        ) : (
          <>
            {!plugin.installed && (
              <button
                onClick={() => onInstall(plugin.name)}
                disabled={disabled}
                className="p-1 text-blue-400 hover:text-blue-300 transition-colors disabled:opacity-40"
                title="Install"
              >
                <Download size={12} />
              </button>
            )}
            {plugin.installed && !plugin.loaded && (
              <button
                onClick={() => onLoad(plugin.name)}
                disabled={disabled}
                className="p-1 text-blue-400 hover:text-blue-300 transition-colors disabled:opacity-40"
                title="Load into registry"
              >
                <RefreshCw size={12} />
              </button>
            )}
            {plugin.installed && (
              <button
                onClick={() => onUninstall(plugin.name)}
                disabled={disabled}
                className="p-1 text-red-400 hover:text-red-300 transition-colors disabled:opacity-40"
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

function StatusMessage({ state, onDismiss }: { state: ActionState; onDismiss: () => void }) {
  if (state.type === 'idle' || state.type === 'loading') return null;

  const isError = state.type === 'error';
  const Icon = isError ? AlertCircle : Check;
  const colorClass = isError
    ? 'bg-red-500/10 border-red-500/30 text-red-400'
    : 'bg-green-500/10 border-green-500/30 text-green-400';

  return (
    <div className={`mt-2 px-2 py-1.5 border text-[10px] flex items-start gap-1.5 ${colorClass}`}>
      <Icon size={12} className="shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <span className="font-mono">{state.plugin}</span>
        <span className="text-tagma-muted ml-1">— {state.message}</span>
      </div>
      <button onClick={onDismiss} className="text-tagma-muted hover:text-tagma-text shrink-0">&times;</button>
    </div>
  );
}

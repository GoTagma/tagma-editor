import { useState } from 'react';
import { ArrowLeft, Package, Store, FolderOpen } from 'lucide-react';
import type { PluginCategory, PluginRegistry } from '../../api/client';
import { InstalledPanel } from './InstalledPanel';
import { MarketplacePanel } from './MarketplacePanel';

type Tab = 'installed' | 'marketplace';

type CategoryFilter = 'all' | PluginCategory;

interface PluginsPageProps {
  workDir: string;
  declaredPlugins: readonly string[];
  onBack: () => void;
  onRegistryUpdate: (registry: PluginRegistry) => void;
  onPluginsChange: (plugins: string[]) => void;
  onRequestBrowseLocal: () => void;
}

const CATEGORY_TABS: ReadonlyArray<{ key: CategoryFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'drivers', label: 'Drivers' },
  { key: 'triggers', label: 'Triggers' },
  { key: 'completions', label: 'Completions' },
  { key: 'middlewares', label: 'Middlewares' },
];

/**
 * Top-level Plugins page. Replaces the old "Manage Plugins" modal with a
 * full-screen view that runs parallel to `BoardCanvas` and `RunView`. Hosts
 * two tabs:
 *
 *   - Installed    — existing workspace install/uninstall/load flow
 *   - Marketplace  — npm-backed plugin discovery with live search
 *
 * Category filtering is shared across both tabs: the sidebar on the left
 * narrows by plugin category (SDK-defined: drivers/triggers/completions/
 * middlewares), and each panel applies the filter locally.
 */
export function PluginsPage({
  workDir,
  declaredPlugins,
  onBack,
  onRegistryUpdate,
  onPluginsChange,
  onRequestBrowseLocal,
}: PluginsPageProps) {
  const [tab, setTab] = useState<Tab>('installed');
  const [category, setCategory] = useState<CategoryFilter>('all');

  if (!workDir) {
    return (
      <div className="h-full flex flex-col bg-tagma-bg">
        <PluginsHeader tab={tab} onTab={setTab} onBack={onBack} />
        <div className="flex-1 flex flex-col items-center justify-center text-tagma-muted gap-3">
          <Package size={48} className="opacity-30" />
          <p className="text-sm">Open a workspace to manage plugins.</p>
          <button
            onClick={onBack}
            className="px-3 py-1.5 text-xs bg-tagma-bg border border-tagma-border hover:border-tagma-accent transition-colors"
          >
            Back to Editor
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-tagma-bg">
      <PluginsHeader tab={tab} onTab={setTab} onBack={onBack} />

      <div className="flex-1 min-h-0 flex">
        <aside className="w-44 shrink-0 border-r border-tagma-border bg-tagma-surface/40 py-3 px-2">
          <div className="text-[10px] uppercase tracking-wide text-tagma-muted mb-2 px-2">
            Categories
          </div>
          <nav className="flex flex-col gap-0.5">
            {CATEGORY_TABS.map((c) => (
              <button
                key={c.key}
                onClick={() => setCategory(c.key)}
                className={`text-left px-2 py-1 text-[11px] transition-colors ${
                  category === c.key
                    ? 'bg-blue-500/15 text-blue-300 border-l-2 border-blue-400'
                    : 'text-tagma-muted hover:text-tagma-text hover:bg-tagma-bg border-l-2 border-transparent'
                }`}
              >
                {c.label}
              </button>
            ))}
          </nav>

          {tab === 'installed' && (
            <div className="mt-4 px-2">
              <button
                onClick={onRequestBrowseLocal}
                className="w-full flex items-center gap-1.5 px-2 py-1 text-[10px] bg-orange-500/10 border border-orange-500/25 text-orange-300 hover:bg-orange-500/20 transition-colors"
                title="Import a plugin from a local directory"
              >
                <FolderOpen size={11} />
                <span>Import local…</span>
              </button>
            </div>
          )}
        </aside>

        <section className="flex-1 min-h-0 overflow-hidden">
          {tab === 'installed' ? (
            <InstalledPanel
              declaredPlugins={declaredPlugins}
              category={category}
              onRegistryUpdate={onRegistryUpdate}
              onPluginsChange={onPluginsChange}
            />
          ) : (
            <MarketplacePanel
              category={category}
              declaredPlugins={declaredPlugins}
              onRegistryUpdate={onRegistryUpdate}
              onPluginsChange={onPluginsChange}
            />
          )}
        </section>
      </div>
    </div>
  );
}

function PluginsHeader({
  tab,
  onTab,
  onBack,
}: {
  tab: Tab;
  onTab: (t: Tab) => void;
  onBack: () => void;
}) {
  return (
    <header className="h-11 bg-tagma-surface border-b border-tagma-border flex items-center px-2 gap-2 shrink-0">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-xs text-tagma-muted hover:text-tagma-text transition-colors px-2 py-1"
      >
        <ArrowLeft size={12} />
        <span>Back to Editor</span>
      </button>
      <div className="w-px h-5 bg-tagma-border" />
      <div className="flex items-center gap-1.5 px-2">
        <Package size={13} className="text-tagma-accent" />
        <span className="text-xs font-medium text-tagma-text">Plugins</span>
      </div>
      <div className="w-px h-5 bg-tagma-border" />
      <div className="flex items-center gap-1">
        <TabButton
          active={tab === 'installed'}
          onClick={() => onTab('installed')}
          icon={<Package size={12} />}
          label="Installed"
        />
        <TabButton
          active={tab === 'marketplace'}
          onClick={() => onTab('marketplace')}
          icon={<Store size={12} />}
          label="Marketplace"
        />
      </div>
    </header>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium border transition-colors ${
        active
          ? 'bg-blue-500/15 text-blue-300 border-blue-500/30'
          : 'bg-transparent text-tagma-muted border-transparent hover:text-tagma-text hover:bg-tagma-bg'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

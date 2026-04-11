import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { usePipelineStore } from './store/pipeline-store';
import { BoardCanvas } from './components/board/BoardCanvas';
import { Toolbar } from './components/board/Toolbar';
import { TaskConfigPanel } from './components/panels/TaskConfigPanel';
import { TrackConfigPanel } from './components/panels/TrackConfigPanel';
import { PipelineConfigPanel } from './components/panels/PipelineConfigPanel';
import { PluginManager } from './components/panels/PluginManager';
import { FileExplorer, type FileExplorerMode } from './components/FileExplorer';
import { api } from './api/client';
import { Loader2, AlertCircle, CheckCircle2, X as XIcon } from 'lucide-react';

import { RunView } from './components/run/RunView';
import { useRunStore } from './store/run-store';
import { ErrorToast } from './components/ErrorToast';
import { useShortcuts } from './hooks/use-shortcuts';
import { useAutosave } from './hooks/use-autosave';

type ExplorerIntent = { mode: FileExplorerMode; purpose: 'import' | 'export' | 'workdir' | 'plugin-import' };
type DialogInfo = { type: 'error' | 'success'; title: string; details: string[] };
type ConfirmInfo = {
  title: string;
  details: string[];
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
};

export function App() {
  const {
    config, positions, selectedTaskId, selectedTrackId, validationErrors, dagEdges,
    yamlPath, workDir, isDirty, layoutDirty, loading, registry,
    setPipelineName, updatePipelineFields, addTrack, renameTrack, updateTrackFields, deleteTrack, moveTrackTo,
    addTask, updateTask, deleteTask, transferTaskToTrack,
    addDependency, removeDependency,
    selectTask, selectTrack, setTaskPosition, setRegistry,
    setWorkDir, saveFile, saveFileAs, newPipeline, importFile, exportFile, openFile,
    exportYaml, importYaml, init,
  } = usePipelineStore();

  const { active: runActive, startRun, reset: resetRun } = useRunStore();

  const [showPipelineSettings, setShowPipelineSettings] = useState(false);
  const [showPlugins, setShowPlugins] = useState(false);
  const [explorer, setExplorer] = useState<ExplorerIntent | null>(null);
  const [dialog, setDialog] = useState<DialogInfo | null>(null);
  const [confirmInfo, setConfirmInfo] = useState<ConfirmInfo | null>(null);
  const [workspaceYamls, setWorkspaceYamls] = useState<{ name: string; path: string }[]>([]);
  const [saveAsInput, setSaveAsInput] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchVisible, setSearchVisible] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Pending action to execute after workspace is set
  const afterWorkspaceRef = useRef<'new' | 'import' | 'save' | 'run' | null>(null);

  // Store errors are surfaced via <ErrorToast />, which subscribes directly
  // to `errorMessage` and handles auto-dismiss. No effect needed here.

  useEffect(() => { init(); }, []);

  const refreshWorkspaceYamls = useCallback(async (): Promise<{ name: string; path: string }[]> => {
    if (!workDir) {
      setWorkspaceYamls([]);
      return [];
    }
    try {
      const sep = workDir.includes('\\') ? '\\' : '/';
      const tagmaPath = `${workDir}${sep}.tagma`;
      const result = await api.listDir(tagmaPath);
      const yamls = result.entries
        .filter((e) => e.type === 'file' && /\.ya?ml$/i.test(e.name))
        .map((e) => ({ name: e.name, path: e.path }));
      setWorkspaceYamls(yamls);
      return yamls;
    } catch {
      setWorkspaceYamls([]);
      return [];
    }
  }, [workDir]);

  // Refresh the list of YAML files under {workDir}/.tagma whenever the
  // workspace or current file changes (covers save/new/import side-effects).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const yamls = await refreshWorkspaceYamls();
      if (cancelled) {
        // no-op: cancellation guard for unmounted effect
        void yamls;
      }
    })();
    return () => { cancelled = true; };
  }, [refreshWorkspaceYamls, yamlPath]);

  const handleOpenWorkspaceFile = useCallback(async (path: string) => {
    await openFile(path);
  }, [openFile]);

  const handleDeleteWorkspaceFile = useCallback((path: string) => {
    const name = path.split(/[/\\]/).pop() ?? path;
    setConfirmInfo({
      title: 'Remove YAML',
      details: [
        `Remove "${name}" and its companion .layout.json?`,
        'This cannot be undone.',
      ],
      confirmLabel: 'Remove',
      danger: true,
      onConfirm: async () => {
        const wasActive = yamlPath === path;
        const nextPath = wasActive
          ? workspaceYamls.find((y) => y.path !== path)?.path ?? null
          : null;

        try {
          await api.deleteFile(path);
        } catch (e: any) {
          setDialog({ type: 'error', title: 'Remove Failed', details: [e?.message ?? 'Unknown error'] });
          return;
        }

        if (wasActive) {
          if (nextPath) {
            await openFile(nextPath);
          } else {
            await newPipeline();
          }
        } else {
          await refreshWorkspaceYamls();
        }
      },
    });
  }, [yamlPath, workspaceYamls, openFile, newPipeline, refreshWorkspaceYamls]);

  // Helper: ensure workspace is set before proceeding
  const requireWorkspace = useCallback((then: 'new' | 'import' | 'save' | 'run'): boolean => {
    if (workDir) return true;
    afterWorkspaceRef.current = then;
    setExplorer({ mode: 'directory', purpose: 'workdir' });
    return false;
  }, [workDir]);

  // Save: workspace required, server auto-creates path in .tagma if needed
  const handleSave = useCallback(async () => {
    if (!requireWorkspace('save')) return;
    await saveFile();
  }, [requireWorkspace, saveFile]);

  // Ctrl+S
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave]);

  // Attribute each validation error to its root cause (track or task)
  // If all errors in a track are track-level (no task index), mark the track.
  // Otherwise mark the specific tasks.
  const { errorsByTask, errorsByTrack } = useMemo(() => {
    const byTask = new Map<string, string[]>();  // qid → messages
    const byTrack = new Map<string, string[]>(); // trackId → messages

    for (const err of validationErrors) {
      const trackMatch = err.path.match(/tracks\[(\d+)\]/);
      if (!trackMatch) continue;
      const track = config.tracks[parseInt(trackMatch[1])];
      if (!track) continue;

      const taskMatch = err.path.match(/tasks\[(\d+)\]/);
      if (taskMatch) {
        const task = track.tasks[parseInt(taskMatch[1])];
        if (task) {
          const qid = `${track.id}.${task.id}`;
          const list = byTask.get(qid) ?? [];
          list.push(err.message);
          byTask.set(qid, list);
        }
      } else {
        // Track-level error
        const list = byTrack.get(track.id) ?? [];
        list.push(err.message);
        byTrack.set(track.id, list);
      }
    }

    return { errorsByTask: byTask, errorsByTrack: byTrack };
  }, [validationErrors, config]);

  // Pipeline-level (top-level) errors: anything whose path does not start with "tracks[".
  const pipelineLevelErrors = useMemo(
    () => validationErrors.filter((e) => !/^tracks\[/.test(e.path)).map((e) => e.message),
    [validationErrors],
  );

  // Compat: keep invalidTaskIds as a Set for BoardCanvas
  const invalidTaskIds = useMemo(
    () => new Set(errorsByTask.keys()),
    [errorsByTask],
  );

  const selectedInfo = useMemo(() => {
    if (!selectedTaskId) return null;
    const [trackId, taskId] = selectedTaskId.split('.');
    const track = config.tracks.find((t) => t.id === trackId);
    const task = track?.tasks.find((t) => t.id === taskId);
    if (!track || !task) return null;
    return { track, task, trackId, taskId };
  }, [selectedTaskId, config]);

  const selectedTrack = useMemo(() => {
    if (!selectedTrackId) return null;
    return config.tracks.find((t) => t.id === selectedTrackId) ?? null;
  }, [selectedTrackId, config]);

  const [pendingRun, setPendingRun] = useState(false);

  const handleRun = useCallback(async () => {
    if (!requireWorkspace('run')) return;
    if (validationErrors.length > 0) {
      setDialog({
        type: 'error',
        title: `Cannot run: ${validationErrors.length} validation error(s)`,
        details: validationErrors.map((e) => `[${e.path}] ${e.message}`),
      });
      return;
    }
    if (!yamlPath || isDirty) {
      setPendingRun(true);
      await saveFile();
      return;
    }
    startRun(config);
  }, [requireWorkspace, yamlPath, validationErrors, isDirty, saveFile, config]);

  // After save completes and yamlPath is set, auto-trigger run
  useEffect(() => {
    if (pendingRun && yamlPath) {
      setPendingRun(false);
      handleRun();
    }
  }, [pendingRun, yamlPath, handleRun]);

  const handleExplorerConfirm = useCallback(async (path: string) => {
    if (!explorer) return;
    if (explorer.purpose === 'workdir') {
      await setWorkDir(path);
      const pending = afterWorkspaceRef.current;
      afterWorkspaceRef.current = null;
      if (pending === 'import') {
        setExplorer({ mode: 'open', purpose: 'import' });
        return;
      }
      setExplorer(null);
      if (pending === 'new') {
        await newPipeline();
      } else if (pending === 'save') {
        await saveFile();
      } else if (pending === 'run') {
        setPendingRun(true);
        await saveFile();
      }
    } else if (explorer.purpose === 'import') {
      await importFile(path);
      setExplorer(null);
    } else if (explorer.purpose === 'export') {
      const destPath = await exportFile(path);
      setExplorer(null);
      if (destPath) {
        setDialog({ type: 'success', title: 'Export Successful', details: [`Exported to: ${destPath}`] });
      }
    } else if (explorer.purpose === 'plugin-import') {
      setExplorer(null);
      setShowPlugins(true);
      try {
        const result = await api.importLocalPlugin(path);
        setRegistry(result.registry);
        const name = result.plugin.name;
        if (!config.plugins?.includes(name)) {
          updatePipelineFields({ plugins: [...(config.plugins ?? []), name] });
        }
        setDialog({ type: 'success', title: 'Plugin Imported', details: [
          `${name} v${result.plugin.version ?? '?'}`,
          ...(result.warning ? [result.warning] : []),
        ]});
      } catch (e: any) {
        setDialog({ type: 'error', title: 'Import Failed', details: [e.message ?? 'Unknown error'] });
      }
    }
  }, [explorer, setWorkDir, importFile, exportFile, newPipeline, saveFile, config.plugins, setRegistry, updatePipelineFields]);

  const handleNewPipeline = useCallback(() => {
    if (!requireWorkspace('new')) return;
    newPipeline();
  }, [requireWorkspace, newPipeline]);

  const handleImport = useCallback(() => {
    if (!requireWorkspace('import')) return;
    setExplorer({ mode: 'open', purpose: 'import' });
  }, [requireWorkspace]);

  const handleExport = useCallback(() => {
    if (!yamlPath) return;
    setExplorer({ mode: 'directory', purpose: 'export' });
  }, [yamlPath]);

  // U10: Save As... target file name. Server writes into {workDir}/.tagma/.
  const handleSaveAs = useCallback(() => {
    if (!requireWorkspace('save')) return;
    const currentName = yamlPath ? yamlPath.split(/[/\\]/).pop() ?? '' : 'pipeline.yaml';
    setSaveAsInput(currentName);
  }, [requireWorkspace, yamlPath]);

  const activeYamlName = useMemo(
    () => (yamlPath ? yamlPath.split(/[/\\]/).pop() ?? null : null),
    [yamlPath],
  );

  const menus = useMemo(() => {
    type ActionItem = {
      label: string;
      shortcut?: string;
      disabled?: boolean;
      onAction: () => void;
      onDelete?: () => void;
      deleteTitle?: string;
    };
    const workspaceItems: ActionItem[] = !workDir
      ? [{ label: '(No workspace selected)', disabled: true, onAction: () => {} }]
      : workspaceYamls.length === 0
      ? [{ label: '(No YAML files in .tagma)', disabled: true, onAction: () => {} }]
      : workspaceYamls.map((y) => ({
          label: y.name === activeYamlName ? `● ${y.name}` : `   ${y.name}`,
          onAction: () => handleOpenWorkspaceFile(y.path),
          onDelete: () => handleDeleteWorkspaceFile(y.path),
          deleteTitle: `Remove ${y.name} and its .layout.json`,
        }));

    return [
      {
        label: 'File',
        items: [
          { label: 'New YAML', onAction: handleNewPipeline },
          { separator: true as const },
          { label: 'Import YAML...', shortcut: 'Ctrl+O', onAction: handleImport },
          { label: 'Export YAML...', disabled: !yamlPath, onAction: handleExport },
          { separator: true as const },
          { label: 'Save', shortcut: 'Ctrl+S', onAction: handleSave },
          { label: 'Save As...', onAction: handleSaveAs },
          { separator: true as const },
          { label: 'Open Workspace...', onAction: () => setExplorer({ mode: 'directory', purpose: 'workdir' }) },
        ],
      },
      {
        label: 'Workspace',
        items: workspaceItems,
      },
      {
        label: 'Plugins',
        items: [
          { label: 'Manage Plugins...', onAction: () => setShowPlugins(true) },
        ],
      },
      {
        label: 'Settings',
        items: [
          { label: 'Pipeline Settings', onAction: () => setShowPipelineSettings(true) },
        ],
      },
    ];
  }, [yamlPath, workDir, workspaceYamls, activeYamlName, handleNewPipeline, handleImport, handleExport, handleSave, handleSaveAs, handleOpenWorkspaceFile, handleDeleteWorkspaceFile]);

  // Ctrl+O → Import
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
        e.preventDefault();
        handleImport();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleImport]);

  // U4: periodic localStorage draft autosave while dirty (crash recovery).
  useAutosave();

  // Global undo/redo/copy/paste/duplicate/search/escape shortcuts (U1).
  useShortcuts({
    onFocusSearch: () => {
      setSearchVisible(true);
      // Defer focus until after the input is in the DOM.
      requestAnimationFrame(() => searchInputRef.current?.focus());
    },
  });

  // U3: beforeunload warning when the document has unsaved changes.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!isDirty && !layoutDirty) return;
      e.preventDefault();
      // Legacy browsers require returnValue to be set to a string.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty, layoutDirty]);

  const commitSaveAs = useCallback(async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const withExt = /\.ya?ml$/i.test(trimmed) ? trimmed : `${trimmed}.yaml`;
    // Build the target path inside the workspace's .tagma directory, matching
    // the server's auto-save-location convention.
    const sep = workDir.includes('\\') ? '\\' : '/';
    const target = `${workDir}${sep}.tagma${sep}${withExt}`;
    setSaveAsInput(null);
    try {
      await saveFileAs(target);
      await refreshWorkspaceYamls();
    } catch (e: any) {
      setDialog({ type: 'error', title: 'Save As Failed', details: [e?.message ?? 'Unknown error'] });
    }
  }, [workDir, saveFileAs, refreshWorkspaceYamls]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-tagma-bg">
        <div className="flex items-center gap-2 text-tagma-muted">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-xs font-mono">Loading...</span>
        </div>
      </div>
    );
  }

  // Run mode
  if (runActive) {
    return (
      <>
        <RunView
          config={config}
          dagEdges={dagEdges}
          positions={positions}
          onBack={resetRun}
        />
        <ErrorToast />
        {/* Dialog overlay (shared) */}
        {dialog && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60" onClick={() => setDialog(null)}>
            <div className="bg-tagma-surface border border-tagma-border shadow-panel w-[480px] max-h-[60vh] flex flex-col animate-fade-in"
              onClick={(e) => e.stopPropagation()}>
              <div className="panel-header">
                <div className="flex items-center gap-2 min-w-0">
                  {dialog.type === 'error'
                    ? <AlertCircle size={14} className="text-tagma-error shrink-0" />
                    : <CheckCircle2 size={14} className="text-tagma-success shrink-0" />}
                  <h2 className={`panel-title truncate ${dialog.type === 'error' ? 'text-tagma-error' : 'text-tagma-success'}`}>{dialog.title}</h2>
                </div>
                <button onClick={() => setDialog(null)} className="p-1 text-tagma-muted hover:text-tagma-text">
                  <XIcon size={14} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                {dialog.details.map((detail, i) => (
                  <div key={i} className="flex items-start gap-2.5 px-4 py-2.5 border-b border-tagma-border/30 last:border-b-0">
                    {dialog.type === 'error'
                      ? <AlertCircle size={11} className="text-tagma-error shrink-0 mt-0.5" />
                      : <CheckCircle2 size={11} className="text-tagma-success shrink-0 mt-0.5" />}
                    <div className="text-[11px] text-tagma-text font-mono min-w-0 break-words">{detail}</div>
                  </div>
                ))}
              </div>
              <div className="px-4 py-3 border-t border-tagma-border flex justify-end">
                <button onClick={() => setDialog(null)} className="btn-primary">OK</button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="h-full flex flex-col bg-tagma-bg">
      <div onClick={() => { selectTask(null); selectTrack(null); }}>
        <Toolbar
          pipelineName={config.name} yamlPath={yamlPath} workDir={workDir} isDirty={isDirty} errorCount={validationErrors.length}
          menus={menus} onUpdateName={setPipelineName} onRun={handleRun}
        />

      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 min-w-0 overflow-hidden">
          <BoardCanvas
            config={config} dagEdges={dagEdges} positions={positions}
            selectedTaskId={selectedTaskId} invalidTaskIds={invalidTaskIds}
            errorsByTask={errorsByTask} errorsByTrack={errorsByTrack}
            onSelectTask={selectTask}
            onSelectTrack={selectTrack}
            onAddTask={addTask} onAddTrack={addTrack}
            onDeleteTask={deleteTask} onDeleteTrack={deleteTrack}
            onRenameTrack={renameTrack} onMoveTrackTo={moveTrackTo}
            onAddDependency={addDependency} onRemoveDependency={removeDependency}
            onSetTaskPosition={setTaskPosition} onTransferTask={transferTaskToTrack}
          />
        </div>

        {selectedInfo && (
          <TaskConfigPanel
            key={selectedTaskId}
            task={selectedInfo.task} trackId={selectedInfo.trackId} qualifiedId={selectedTaskId!}
            pipelineConfig={config}
            dependencies={[...(selectedInfo.task.depends_on ?? [])]}
            drivers={registry.drivers}
            errors={errorsByTask.get(selectedTaskId!) ?? []}
            onUpdateTask={updateTask} onDeleteTask={deleteTask}
            onRemoveDependency={removeDependency}
          />
        )}

        {selectedTrack && (
          <TrackConfigPanel
            key={selectedTrackId}
            track={selectedTrack}
            drivers={registry.drivers}
            errors={errorsByTrack.get(selectedTrackId!) ?? []}
            onUpdateTrack={updateTrackFields}
            onDeleteTrack={deleteTrack}
          />
        )}
      </div>

      {/* Pipeline Settings modal */}
      {showPipelineSettings && (
        <PipelineConfigPanel
          config={config}
          drivers={registry.drivers}
          errors={pipelineLevelErrors}
          onUpdate={updatePipelineFields}
          onClose={() => setShowPipelineSettings(false)}
        />
      )}

      {/* Plugins modal */}
      {showPlugins && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowPlugins(false)}>
          <div
            className="bg-tagma-surface border border-tagma-border shadow-panel w-[520px] max-h-[80vh] flex flex-col animate-fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-header">
              <h2 className="panel-title">Plugins</h2>
              <button onClick={() => setShowPlugins(false)} className="p-1 text-tagma-muted hover:text-tagma-text transition-colors">
                <XIcon size={14} />
              </button>
            </div>
            <div className="flex-1 min-h-0 px-5 py-4 flex flex-col">
              <PluginManager
                declaredPlugins={config.plugins ?? []}
                onRegistryUpdate={setRegistry}
                onPluginsChange={(plugins) => updatePipelineFields({ plugins: plugins.length > 0 ? plugins : undefined })}
                onRequestBrowse={() => {
                  setShowPlugins(false);
                  setExplorer({ mode: 'directory', purpose: 'plugin-import' });
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* File Explorer modal */}
      {explorer && (
        <FileExplorer
          mode={explorer.mode}
          title={
            explorer.purpose === 'import' ? 'Import Pipeline YAML'
            : explorer.purpose === 'export' ? 'Export Pipeline — Select Destination'
            : explorer.purpose === 'plugin-import' ? 'Import Local Plugin — Select Directory'
            : 'Select Workspace Directory'
          }
          initialPath={
            explorer.purpose === 'import' ? undefined
            : explorer.purpose === 'export' ? workDir
            : (workDir || undefined)
          }
          fileFilter={explorer.purpose === 'import' ? ['.yaml', '.yml'] : undefined}
          onConfirm={handleExplorerConfirm}
          onCancel={() => {
            const wasPluginImport = explorer?.purpose === 'plugin-import';
            setExplorer(null);
            setPendingRun(false);
            afterWorkspaceRef.current = null;
            if (wasPluginImport) setShowPlugins(true);
          }}
        />
      )}

      {/* Dialog */}
      {dialog && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60" onClick={() => setDialog(null)}>
          <div className="bg-tagma-surface border border-tagma-border shadow-panel w-[480px] max-h-[60vh] flex flex-col animate-fade-in"
            onClick={(e) => e.stopPropagation()}>
            <div className="panel-header">
              <div className="flex items-center gap-2 min-w-0">
                {dialog.type === 'error'
                  ? <AlertCircle size={14} className="text-tagma-error shrink-0" />
                  : <CheckCircle2 size={14} className="text-tagma-success shrink-0" />}
                <h2 className={`panel-title truncate ${dialog.type === 'error' ? 'text-tagma-error' : 'text-tagma-success'}`}>{dialog.title}</h2>
              </div>
              <button onClick={() => setDialog(null)} className="p-1 text-tagma-muted hover:text-tagma-text">
                <XIcon size={14} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {dialog.details.map((detail, i) => (
                <div key={i} className="flex items-start gap-2.5 px-4 py-2.5 border-b border-tagma-border/30 last:border-b-0">
                  {dialog.type === 'error'
                    ? <AlertCircle size={11} className="text-tagma-error shrink-0 mt-0.5" />
                    : <CheckCircle2 size={11} className="text-tagma-success shrink-0 mt-0.5" />}
                  <div className="text-[11px] text-tagma-text font-mono min-w-0 break-words">{detail}</div>
                </div>
              ))}
            </div>
            <div className="px-4 py-3 border-t border-tagma-border flex justify-end">
              <button onClick={() => setDialog(null)} className="btn-primary">OK</button>
            </div>
          </div>
        </div>
      )}

      {/* Save As prompt (U10) */}
      {saveAsInput !== null && (
        <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/60" onClick={() => setSaveAsInput(null)}>
          <div
            className="bg-tagma-surface border border-tagma-border shadow-panel w-[440px] flex flex-col animate-fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-header">
              <h2 className="panel-title">Save As</h2>
              <button onClick={() => setSaveAsInput(null)} className="p-1 text-tagma-muted hover:text-tagma-text">
                <XIcon size={14} />
              </button>
            </div>
            <div className="px-4 py-4 flex flex-col gap-2">
              <label className="text-[10px] font-mono text-tagma-muted uppercase tracking-wider">File name (saved under .tagma/)</label>
              <input
                type="text"
                autoFocus
                value={saveAsInput}
                onChange={(e) => setSaveAsInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitSaveAs(saveAsInput);
                  if (e.key === 'Escape') setSaveAsInput(null);
                }}
                className="text-[11px] font-mono bg-tagma-bg border border-tagma-border focus:border-tagma-accent rounded px-2 py-1 text-tagma-text outline-none"
                placeholder="my-pipeline.yaml"
              />
            </div>
            <div className="px-4 py-3 border-t border-tagma-border flex justify-end gap-2">
              <button
                onClick={() => setSaveAsInput(null)}
                className="px-3 py-1 text-[11px] text-tagma-muted hover:text-tagma-text border border-tagma-border hover:border-tagma-muted/60 transition-colors rounded-sm"
              >
                Cancel
              </button>
              <button onClick={() => commitSaveAs(saveAsInput)} className="btn-primary">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Search overlay (U1 — Ctrl+F) */}
      {searchVisible && (
        <div className="fixed top-14 right-4 z-[150] w-[340px] bg-tagma-surface border border-tagma-border shadow-panel animate-fade-in">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-tagma-border">
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setSearchVisible(false); setSearchQuery(''); }
              }}
              placeholder="Search tasks by name or prompt..."
              className="flex-1 text-[11px] font-mono bg-tagma-bg border border-tagma-border focus:border-tagma-accent rounded px-2 py-1 text-tagma-text outline-none"
            />
            <button
              onClick={() => { setSearchVisible(false); setSearchQuery(''); }}
              className="p-1 text-tagma-muted hover:text-tagma-text"
            >
              <XIcon size={12} />
            </button>
          </div>
          <div className="max-h-[240px] overflow-y-auto">
            {(() => {
              const q = searchQuery.trim().toLowerCase();
              if (!q) {
                return <div className="px-3 py-2 text-[10px] font-mono text-tagma-muted/60">Type to search tasks</div>;
              }
              const matches: { trackId: string; taskId: string; label: string; snippet: string }[] = [];
              for (const t of config.tracks) {
                for (const task of t.tasks) {
                  const name = (task.name ?? '').toLowerCase();
                  const prompt = (task.prompt ?? '').toLowerCase();
                  if (name.includes(q) || prompt.includes(q)) {
                    matches.push({
                      trackId: t.id,
                      taskId: task.id,
                      label: task.name ?? task.id,
                      snippet: (task.prompt ?? '').slice(0, 80),
                    });
                  }
                }
              }
              if (matches.length === 0) {
                return <div className="px-3 py-2 text-[10px] font-mono text-tagma-muted/60">No matches</div>;
              }
              return matches.map((m) => (
                <button
                  key={`${m.trackId}.${m.taskId}`}
                  className="w-full text-left px-3 py-2 border-b border-tagma-border/30 last:border-b-0 hover:bg-tagma-bg/60"
                  onClick={() => {
                    selectTask(`${m.trackId}.${m.taskId}`);
                    setSearchVisible(false);
                  }}
                >
                  <div className="text-[11px] font-mono text-tagma-text truncate">{m.label}</div>
                  {m.snippet && (
                    <div className="text-[10px] font-mono text-tagma-muted/60 truncate">{m.snippet}</div>
                  )}
                </button>
              ));
            })()}
          </div>
        </div>
      )}

      <ErrorToast />

      {/* Confirm dialog */}
      {confirmInfo && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/60" onClick={() => setConfirmInfo(null)}>
          <div
            className="bg-tagma-surface border border-tagma-border shadow-panel w-[440px] max-h-[60vh] flex flex-col animate-fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-header">
              <div className="flex items-center gap-2 min-w-0">
                <AlertCircle size={14} className={`shrink-0 ${confirmInfo.danger ? 'text-tagma-error' : 'text-tagma-accent'}`} />
                <h2 className={`panel-title truncate ${confirmInfo.danger ? 'text-tagma-error' : 'text-tagma-text'}`}>
                  {confirmInfo.title}
                </h2>
              </div>
              <button onClick={() => setConfirmInfo(null)} className="p-1 text-tagma-muted hover:text-tagma-text">
                <XIcon size={14} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {confirmInfo.details.map((detail, i) => (
                <div key={i} className="px-4 py-2.5 border-b border-tagma-border/30 last:border-b-0 text-[11px] text-tagma-text font-mono break-words">
                  {detail}
                </div>
              ))}
            </div>
            <div className="px-4 py-3 border-t border-tagma-border flex justify-end gap-2">
              <button
                onClick={() => setConfirmInfo(null)}
                className="px-3 py-1 text-[11px] text-tagma-muted hover:text-tagma-text border border-tagma-border hover:border-tagma-muted/60 transition-colors rounded-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const info = confirmInfo;
                  setConfirmInfo(null);
                  info.onConfirm();
                }}
                className={confirmInfo.danger ? 'btn-danger' : 'btn-primary'}
              >
                {confirmInfo.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

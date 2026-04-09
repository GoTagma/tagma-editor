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

type ExplorerIntent = { mode: FileExplorerMode; purpose: 'import' | 'export' | 'workdir' | 'plugin-import' };
type DialogInfo = { type: 'error' | 'success'; title: string; details: string[] };

export function App() {
  const {
    config, positions, selectedTaskId, selectedTrackId, validationErrors, dagEdges,
    yamlPath, workDir, isDirty, loading, errorMessage, registry,
    setPipelineName, updatePipelineFields, addTrack, renameTrack, updateTrackFields, deleteTrack, moveTrackTo,
    addTask, updateTask, deleteTask, transferTaskToTrack,
    addDependency, removeDependency,
    selectTask, selectTrack, setTaskPosition, setRegistry,
    setWorkDir, saveFile, newPipeline, importFile, exportFile,
    exportYaml, importYaml, init, clearError,
  } = usePipelineStore();

  const { active: runActive, startRun, reset: resetRun } = useRunStore();

  const [showPipelineSettings, setShowPipelineSettings] = useState(false);
  const [showPlugins, setShowPlugins] = useState(false);
  const [explorer, setExplorer] = useState<ExplorerIntent | null>(null);
  const [dialog, setDialog] = useState<DialogInfo | null>(null);

  // Pending action to execute after workspace is set
  const afterWorkspaceRef = useRef<'new' | 'import' | 'save' | 'run' | null>(null);

  // Show store errors in the dialog
  useEffect(() => {
    if (errorMessage) {
      setDialog({ type: 'error', title: 'Error', details: [errorMessage] });
      clearError();
    }
  }, [errorMessage, clearError]);

  useEffect(() => { init(); }, []);

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

  const menus = useMemo(() => [
    {
      label: 'File',
      items: [
        { label: 'New Pipeline', onAction: handleNewPipeline },
        { separator: true as const },
        { label: 'Import YAML...', shortcut: 'Ctrl+O', onAction: handleImport },
        { label: 'Export YAML...', disabled: !yamlPath, onAction: handleExport },
        { separator: true as const },
        { label: 'Save', shortcut: 'Ctrl+S', onAction: handleSave },
        { separator: true as const },
        { label: 'Open Workspace...', onAction: () => setExplorer({ mode: 'directory', purpose: 'workdir' }) },
      ],
    },
    {
      label: 'Settings',
      items: [
        { label: 'Pipeline Settings', onAction: () => setShowPipelineSettings(true) },
      ],
    },
    {
      label: 'Plugins',
      items: [
        { label: 'Manage Plugins...', onAction: () => setShowPlugins(true) },
      ],
    },
  ], [yamlPath, handleNewPipeline, handleImport, handleExport, handleSave]);

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
            onUpdateTask={updateTask} onDeleteTask={deleteTask}
            onRemoveDependency={removeDependency}
          />
        )}

        {selectedTrack && (
          <TrackConfigPanel
            key={selectedTrackId}
            track={selectedTrack}
            drivers={registry.drivers}
            onUpdateTrack={updateTrackFields}
            onDeleteTrack={deleteTrack}
          />
        )}
      </div>

      {/* Pipeline Settings modal */}
      {showPipelineSettings && (
        <PipelineConfigPanel
          config={config}
          yamlPath={yamlPath}
          workDir={workDir}
          drivers={registry.drivers}
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
    </div>
  );
}

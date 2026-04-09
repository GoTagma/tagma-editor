import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { usePipelineStore } from './store/pipeline-store';
import { BoardCanvas } from './components/board/BoardCanvas';
import { Toolbar } from './components/board/Toolbar';
import { TaskConfigPanel } from './components/panels/TaskConfigPanel';
import { TrackConfigPanel } from './components/panels/TrackConfigPanel';
import { PipelineConfigPanel } from './components/panels/PipelineConfigPanel';
import { FileExplorer, type FileExplorerMode } from './components/FileExplorer';
import { Loader2, AlertCircle, CheckCircle2, X as XIcon } from 'lucide-react';
import { PipelineSummaryBar } from './components/board/PipelineSummaryBar';
import { RunView } from './components/run/RunView';
import { useRunStore } from './store/run-store';

type ExplorerIntent = { mode: FileExplorerMode; purpose: 'open' | 'save' | 'workdir' };
type DialogInfo = { type: 'error' | 'success'; title: string; details: string[] };

export function App() {
  const {
    config, positions, selectedTaskId, selectedTrackId, validationErrors, dagEdges,
    yamlPath, workDir, isDirty, loading, errorMessage, registry,
    setPipelineName, updatePipelineFields, addTrack, renameTrack, updateTrackFields, deleteTrack, moveTrackTo,
    addTask, updateTask, deleteTask, transferTaskToTrack,
    addDependency, removeDependency,
    selectTask, selectTrack, setTaskPosition,
    setWorkDir, openFile, saveFile, saveFileAs,
    exportYaml, importYaml, init, clearError,
  } = usePipelineStore();

  const { active: runActive, startRun, reset: resetRun } = useRunStore();

  const [showPipelineSettings, setShowPipelineSettings] = useState(false);
  const [explorer, setExplorer] = useState<ExplorerIntent | null>(null);
  const [dialog, setDialog] = useState<DialogInfo | null>(null);

  // Show store errors in the dialog
  useEffect(() => {
    if (errorMessage) {
      setDialog({ type: 'error', title: 'Error', details: [errorMessage] });
      clearError();
    }
  }, [errorMessage, clearError]);

  useEffect(() => { init(); }, []);

  // Ctrl+S
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (yamlPath) saveFile();
        else setExplorer({ mode: 'save', purpose: 'save' });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [yamlPath, saveFile]);

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
    if (!workDir) {
      const ok = confirm('Workspace directory is not set. Please configure it before running.\n\nOpen workspace selector now?');
      if (ok) setExplorer({ mode: 'directory', purpose: 'workdir' });
      return;
    }
    if (!yamlPath) {
      setPendingRun(true);
      setExplorer({ mode: 'save', purpose: 'save' });
      return;
    }
    if (validationErrors.length > 0) {
      setDialog({
        type: 'error',
        title: `Cannot run: ${validationErrors.length} validation error(s)`,
        details: validationErrors.map((e) => `[${e.path}] ${e.message}`),
      });
      return;
    }
    if (isDirty) {
      await saveFile();
    }
    // Switch to run mode and start execution
    startRun(config);
  }, [workDir, yamlPath, validationErrors, isDirty, saveFile, config]);

  // After save completes and yamlPath is set, auto-trigger run
  useEffect(() => {
    if (pendingRun && yamlPath) {
      setPendingRun(false);
      handleRun();
    }
  }, [pendingRun, yamlPath, handleRun]);

  const handleExplorerConfirm = useCallback(async (path: string) => {
    if (!explorer) return;
    if (explorer.purpose === 'open') {
      openFile(path);
    } else if (explorer.purpose === 'save') {
      await saveFileAs(path);
      // pendingRun stays true; useEffect above will trigger handleRun once yamlPath updates
    } else if (explorer.purpose === 'workdir') {
      setWorkDir(path);
    }
    setExplorer(null);
  }, [explorer, openFile, saveFileAs, setWorkDir]);

  const menus = useMemo(() => [
    {
      label: 'File',
      items: [
        { label: 'Open YAML...', shortcut: 'Ctrl+O', onAction: () => setExplorer({ mode: 'open', purpose: 'open' }) },
        { label: 'Open Workspace...', onAction: () => setExplorer({ mode: 'directory', purpose: 'workdir' }) },
        { separator: true as const },
        { label: 'Save', shortcut: 'Ctrl+S', onAction: () => yamlPath ? saveFile() : setExplorer({ mode: 'save', purpose: 'save' }) },
        { label: 'Save As...', onAction: () => setExplorer({ mode: 'save', purpose: 'save' }) },
      ],
    },
    {
      label: 'Settings',
      items: [
        { label: 'Pipeline Settings', onAction: () => setShowPipelineSettings(true) },
      ],
    },
  ], [yamlPath, saveFile]);

  // Ctrl+O
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
        e.preventDefault();
        setExplorer({ mode: 'open', purpose: 'open' });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

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

        <PipelineSummaryBar config={config} />
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

      {/* File Explorer modal */}
      {explorer && (
        <FileExplorer
          mode={explorer.mode}
          title={explorer.purpose === 'open' ? 'Open Pipeline YAML' : explorer.purpose === 'save' ? 'Save Pipeline As' : 'Select Workspace Directory'}
          initialPath={explorer.purpose === 'workdir' ? workDir : (yamlPath ?? (workDir || undefined))}
          fileFilter={explorer.purpose !== 'workdir' ? ['.yaml', '.yml'] : undefined}
          onConfirm={handleExplorerConfirm}
          onCancel={() => { setExplorer(null); setPendingRun(false); }}
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

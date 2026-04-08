import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { usePipelineStore } from './store/pipeline-store';
import { BoardCanvas } from './components/board/BoardCanvas';
import { Toolbar } from './components/board/Toolbar';
import { TaskConfigPanel } from './components/panels/TaskConfigPanel';
import { TrackConfigPanel } from './components/panels/TrackConfigPanel';
import { PipelineConfigPanel } from './components/panels/PipelineConfigPanel';
import { FileExplorer, type FileExplorerMode } from './components/FileExplorer';
import { Loader2, AlertCircle, CheckCircle2, X as XIcon } from 'lucide-react';

type ExplorerIntent = { mode: FileExplorerMode; purpose: 'open' | 'save' | 'workdir' };
type DialogInfo = { type: 'error' | 'success'; title: string; details: string[] };

export function App() {
  const {
    config, positions, selectedTaskId, selectedTrackId, validationErrors, dagEdges,
    yamlPath, workDir, isDirty, loading, errorMessage,
    setPipelineName, updatePipelineFields, addTrack, renameTrack, updateTrackFields, deleteTrack, moveTrackTo,
    addTask, updateTask, deleteTask, transferTaskToTrack,
    addDependency, removeDependency,
    selectTask, selectTrack, setTaskPosition,
    setWorkDir, openFile, saveFile, saveFileAs,
    exportYaml, importYaml, init, clearError,
  } = usePipelineStore();

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

  const invalidTaskIds = useMemo(() => {
    const set = new Set<string>();
    for (const err of validationErrors) {
      const trackMatch = err.path.match(/tracks\[(\d+)\]/);
      const taskMatch = err.path.match(/tasks\[(\d+)\]/);
      if (trackMatch && taskMatch) {
        const track = config.tracks[parseInt(trackMatch[1])];
        const task = track?.tasks[parseInt(taskMatch[1])];
        if (track && task) set.add(`${track.id}.${task.id}`);
      }
    }
    return set;
  }, [validationErrors, config]);

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
    const yaml = await exportYaml();
    console.log(yaml);
    setDialog({
      type: 'success',
      title: 'Pipeline is ready to run',
      details: [
        `File: ${yamlPath}`,
        'Run with: tagma run ' + yamlPath,
      ],
    });
  }, [workDir, yamlPath, validationErrors, isDirty, saveFile, exportYaml]);

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

  return (
    <div className="h-full flex flex-col bg-tagma-bg">
      <Toolbar
        pipelineName={config.name} yamlPath={yamlPath} workDir={workDir} isDirty={isDirty} errorCount={validationErrors.length}
        menus={menus} onUpdateName={setPipelineName} onRun={handleRun}
      />

      {validationErrors.length > 0 && (
        <div className="relative group">
          <div className="flex items-center gap-2 px-4 py-1.5 bg-tagma-error/5 border-b border-tagma-error/20 cursor-default">
            <AlertCircle size={12} className="text-tagma-error shrink-0" />
            <span className="text-[10px] text-tagma-error font-mono flex-1 truncate">
              {validationErrors.length} validation {validationErrors.length === 1 ? 'error' : 'errors'}
              {validationErrors.length <= 3 && ': ' + validationErrors.map((e) => e.message).join(' | ')}
            </span>
            {validationErrors.length > 3 && (
              <span className="text-[9px] text-tagma-error/60 font-mono shrink-0">hover to expand</span>
            )}
          </div>
          {validationErrors.length > 1 && (
            <div className="absolute left-0 right-0 top-full z-[80] hidden group-hover:block">
              <div className="mx-4 mt-0.5 bg-tagma-surface border border-tagma-error/20 shadow-panel max-h-[200px] overflow-y-auto">
                {validationErrors.map((err, i) => (
                  <div key={i} className="flex items-start gap-2 px-3 py-1.5 text-[10px] font-mono border-b border-tagma-border/30 last:border-b-0">
                    <AlertCircle size={10} className="text-tagma-error shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <span className="text-tagma-error">{err.message}</span>
                      {err.path && <span className="text-tagma-muted ml-2">{err.path}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 min-w-0 overflow-hidden">
          <BoardCanvas
            config={config} dagEdges={dagEdges} positions={positions}
            selectedTaskId={selectedTaskId} invalidTaskIds={invalidTaskIds}
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
            dependencies={[...(selectedInfo.task.depends_on ?? [])]}
            onUpdateTask={updateTask} onDeleteTask={deleteTask}
            onRemoveDependency={removeDependency} onClose={() => selectTask(null)}
          />
        )}

        {selectedTrack && (
          <TrackConfigPanel
            key={selectedTrackId}
            track={selectedTrack}
            onUpdateTrack={updateTrackFields}
            onDeleteTrack={deleteTrack}
            onClose={() => selectTrack(null)}
          />
        )}
      </div>

      {/* Pipeline Settings modal */}
      {showPipelineSettings && (
        <PipelineConfigPanel
          config={config}
          yamlPath={yamlPath}
          workDir={workDir}
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

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { usePipelineStore } from './store/pipeline-store';
import { MenuBar } from './components/MenuBar';
import { BoardCanvas } from './components/board/BoardCanvas';
import { Toolbar } from './components/board/Toolbar';
import { TaskConfigPanel } from './components/panels/TaskConfigPanel';
import { TrackConfigPanel } from './components/panels/TrackConfigPanel';
import { PipelineConfigPanel } from './components/panels/PipelineConfigPanel';
import { FileExplorer, type FileExplorerMode } from './components/FileExplorer';
import { Loader2 } from 'lucide-react';
import { AlertCircle } from 'lucide-react';

type ExplorerIntent = { mode: FileExplorerMode; purpose: 'open' | 'save' | 'workdir' };

export function App() {
  const {
    config, positions, selectedTaskId, selectedTrackId, validationErrors, dagEdges,
    yamlPath, workDir, isDirty, loading,
    setPipelineName, updatePipelineFields, addTrack, renameTrack, updateTrackFields, deleteTrack, moveTrackTo,
    addTask, updateTask, deleteTask, transferTaskToTrack,
    addDependency, removeDependency,
    selectTask, selectTrack, setTaskPosition,
    setWorkDir, openFile, saveFile, saveFileAs,
    exportYaml, importYaml, init,
  } = usePipelineStore();

  const [showPipelineSettings, setShowPipelineSettings] = useState(false);
  const [explorer, setExplorer] = useState<ExplorerIntent | null>(null);

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

  const handleRun = useCallback(async () => {
    if (validationErrors.length > 0) {
      alert(`Pipeline has ${validationErrors.length} validation error(s):\n\n${validationErrors.map((e) => `• ${e.message}`).join('\n')}`);
      return;
    }
    const yaml = await exportYaml();
    console.log(yaml);
    alert('Pipeline is valid! Export the YAML and run it with the Tagma CLI:\n\ntagma run pipeline.yaml');
  }, [validationErrors, exportYaml]);

  const handleExplorerConfirm = useCallback((path: string) => {
    if (!explorer) return;
    if (explorer.purpose === 'open') openFile(path);
    else if (explorer.purpose === 'save') saveFileAs(path);
    else if (explorer.purpose === 'workdir') setWorkDir(path);
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
      <MenuBar menus={menus} />

      <Toolbar
        pipelineName={config.name} yamlPath={yamlPath} isDirty={isDirty} errorCount={validationErrors.length}
        onUpdateName={setPipelineName} onRun={handleRun}
      />

      {validationErrors.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-tagma-error/5 border-b border-tagma-error/20">
          <AlertCircle size={12} className="text-tagma-error shrink-0" />
          <span className="text-[10px] text-tagma-error font-mono flex-1 truncate">
            {validationErrors.length} validation {validationErrors.length === 1 ? 'error' : 'errors'}
            {validationErrors.length <= 3 && ': ' + validationErrors.map((e) => e.message).join(' | ')}
          </span>
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
          onCancel={() => setExplorer(null)}
        />
      )}
    </div>
  );
}

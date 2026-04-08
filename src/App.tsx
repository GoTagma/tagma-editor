import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { usePipelineStore } from './store/pipeline-store';
import { BoardCanvas } from './components/board/BoardCanvas';
import { Toolbar } from './components/board/Toolbar';
import { TaskConfigPanel } from './components/panels/TaskConfigPanel';
import { AlertCircle, FileCode2, Loader2 } from 'lucide-react';

export function App() {
  const {
    config, positions, selectedTaskId, validationErrors, dagEdges, isDirty, loading,
    setPipelineName, addTrack, renameTrack, deleteTrack, moveTrackTo,
    addTask, updateTask, deleteTask, transferTaskToTrack,
    addDependency, removeDependency,
    selectTask, setTaskPosition,
    exportYaml, importYaml, init,
  } = usePipelineStore();

  const [showYaml, setShowYaml] = useState(false);
  const [yamlText, setYamlText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { init(); }, []);

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

  const handleExportYaml = useCallback(async () => {
    const yaml = await exportYaml();
    setYamlText(yaml);
    setShowYaml(true);
  }, [exportYaml]);

  const handleImportYaml = useCallback(() => { fileInputRef.current?.click(); }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => { importYaml(ev.target?.result as string); };
    reader.readAsText(file);
    e.target.value = '';
  }, [importYaml]);

  const handleDownloadYaml = useCallback(() => {
    const blob = new Blob([yamlText], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${config.name.replace(/\s+/g, '-').toLowerCase()}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [yamlText, config.name]);

  const handleRun = useCallback(async () => {
    if (validationErrors.length > 0) {
      alert(`Pipeline has ${validationErrors.length} validation error(s):\n\n${validationErrors.map((e) => `• ${e.message}`).join('\n')}`);
      return;
    }
    const yaml = await exportYaml();
    console.log(yaml);
    alert('Pipeline is valid! Export the YAML and run it with the Tagma CLI:\n\ntagma run pipeline.yaml');
  }, [validationErrors, exportYaml]);

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
        pipelineName={config.name} isDirty={isDirty} errorCount={validationErrors.length}
        onUpdateName={setPipelineName} onExportYaml={handleExportYaml}
        onImportYaml={handleImportYaml} onRun={handleRun}
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
            onSelectTask={selectTask} onAddTask={addTask} onAddTrack={addTrack}
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
      </div>

      <input ref={fileInputRef} type="file" accept=".yaml,.yml" className="hidden" onChange={handleFileChange} />

      {showYaml && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowYaml(false)}>
          <div className="bg-tagma-surface border border-tagma-border shadow-panel w-[600px] max-h-[80vh] flex flex-col animate-fade-in" onClick={(e) => e.stopPropagation()}>
            <div className="panel-header">
              <div className="flex items-center gap-2">
                <FileCode2 size={14} className="text-tagma-accent" />
                <h2 className="panel-title">Pipeline YAML</h2>
              </div>
              <button onClick={() => setShowYaml(false)} className="p-1 text-tagma-muted hover:text-tagma-text"><span className="text-xs">✕</span></button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <pre className="text-[11px] font-mono text-tagma-text whitespace-pre-wrap">{yamlText}</pre>
            </div>
            <div className="flex items-center gap-2 px-4 py-3 border-t border-tagma-border">
              <button onClick={() => { navigator.clipboard.writeText(yamlText); }} className="btn-ghost">Copy</button>
              <button onClick={handleDownloadYaml} className="btn-primary">Download .yaml</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

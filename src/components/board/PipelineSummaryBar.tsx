import { Cpu, Clock, Plug, Webhook } from 'lucide-react';
import type { RawPipelineConfig } from '../../api/client';

interface PipelineSummaryBarProps {
  config: RawPipelineConfig;
}

export function PipelineSummaryBar({ config }: PipelineSummaryBarProps) {
  const hookCount = config.hooks
    ? Object.values(config.hooks).filter((v) => v !== undefined && v !== null && v !== '').length
    : 0;
  const pluginCount = config.plugins?.length ?? 0;

  const hasAnyInfo = config.driver || config.timeout || pluginCount > 0 || hookCount > 0;
  if (!hasAnyInfo) return null;

  return (
    <div className="flex items-center gap-4 px-4 py-1 bg-tagma-surface/40 border-b border-tagma-border/40 shrink-0">
      {config.driver && (
        <div className="flex items-center gap-1.5">
          <Cpu size={10} className="text-tagma-accent/60" />
          <span className="text-[9px] font-mono text-tagma-accent/70">{config.driver}</span>
        </div>
      )}
      {config.timeout && (
        <div className="flex items-center gap-1.5">
          <Clock size={10} className="text-sky-400/60" />
          <span className="text-[9px] font-mono text-tagma-muted">{config.timeout}</span>
        </div>
      )}
      {pluginCount > 0 && (
        <div className="flex items-center gap-1.5">
          <Plug size={10} className="text-purple-400/60" />
          <span className="text-[9px] font-mono text-tagma-muted truncate max-w-[200px]">
            {config.plugins!.join(', ')}
          </span>
        </div>
      )}
      {hookCount > 0 && (
        <div className="flex items-center gap-1.5">
          <Webhook size={10} className="text-emerald-400/60" />
          <span className="text-[9px] font-mono text-tagma-muted">{hookCount}/6 hooks</span>
        </div>
      )}
      <span className="flex-1" />
      <span className="text-[9px] font-mono text-tagma-muted/40">
        {config.tracks.length} track{config.tracks.length !== 1 ? 's' : ''}
        {' · '}
        {config.tracks.reduce((n, t) => n + t.tasks.length, 0)} task{config.tracks.reduce((n, t) => n + t.tasks.length, 0) !== 1 ? 's' : ''}
      </span>
    </div>
  );
}

import { Cpu, Clock, Plug, Webhook } from 'lucide-react';
import type { RawPipelineConfig } from '../../api/client';

interface PipelineSummaryBarProps {
  config: RawPipelineConfig;
}

/* Uniform icon+label group with fixed 10px icon box */
function InfoChip({ icon, label, color }: { icon: React.ReactNode; label: string; color: string }) {
  return (
    <div className="flex items-center h-[20px] gap-1">
      <span className={`inline-flex items-center justify-center w-[10px] h-[10px] shrink-0 ${color}`}>
        {icon}
      </span>
      <span className="text-[9px] font-mono text-tagma-muted leading-[20px]">{label}</span>
    </div>
  );
}

export function PipelineSummaryBar({ config }: PipelineSummaryBarProps) {
  const hookCount = config.hooks
    ? Object.values(config.hooks).filter((v) => v !== undefined && v !== null && v !== '').length
    : 0;
  const pluginCount = config.plugins?.length ?? 0;

  const hasAnyInfo = config.driver || config.timeout || pluginCount > 0 || hookCount > 0;
  if (!hasAnyInfo) return null;

  const totalTasks = config.tracks.reduce((n, t) => n + t.tasks.length, 0);

  return (
    <div className="flex items-center h-[28px] gap-4 px-4 bg-tagma-surface/40 border-b border-tagma-border/40 shrink-0">
      {config.driver && (
        <InfoChip icon={<Cpu size={10} />} label={config.driver} color="text-tagma-accent/60" />
      )}
      {config.timeout && (
        <InfoChip icon={<Clock size={10} />} label={config.timeout} color="text-sky-400/60" />
      )}
      {pluginCount > 0 && (
        <InfoChip icon={<Plug size={10} />} label={config.plugins!.join(', ')} color="text-purple-400/60" />
      )}
      {hookCount > 0 && (
        <InfoChip icon={<Webhook size={10} />} label={`${hookCount}/6 hooks`} color="text-emerald-400/60" />
      )}
      <span className="flex-1" />
      <span className="text-[9px] font-mono text-tagma-muted/40 leading-[28px]">
        {config.tracks.length} track{config.tracks.length !== 1 ? 's' : ''}
        {' · '}
        {totalTasks} task{totalTasks !== 1 ? 's' : ''}
      </span>
    </div>
  );
}

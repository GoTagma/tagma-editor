import { AlertTriangle, ShieldAlert, SkipForward, Ban } from 'lucide-react';
import type { RawTrackConfig } from '../../api/client';

interface TrackLaneProps {
  track: RawTrackConfig;
  taskCount: number;
  hasParallelWarning: boolean;
}

const TIER_COLORS: Record<string, string> = {
  high: 'text-blue-400',
  medium: 'text-tagma-muted',
  low: 'text-emerald-400',
};

const FAILURE_ICONS: Record<string, { icon: React.ReactNode; label: string }> = {
  skip_downstream: { icon: <SkipForward size={8} />, label: 'Skip downstream on failure' },
  stop_all: { icon: <ShieldAlert size={8} />, label: 'Stop all on failure' },
  ignore: { icon: <Ban size={8} />, label: 'Ignore failures' },
};

export function TrackLane({ track, taskCount, hasParallelWarning }: TrackLaneProps) {
  const perms = track.permissions;
  const failure = track.on_failure ? FAILURE_ICONS[track.on_failure] : null;

  return (
    <div className="h-full w-full flex flex-col justify-center px-3 select-none gap-0.5">
      {/* Row 1: Name + task count */}
      <div className="flex items-center gap-1">
        {track.color && (
          <div className="w-2 h-2 shrink-0" style={{ backgroundColor: track.color }} />
        )}
        <span className="text-[11px] font-semibold text-tagma-text truncate flex-1 tracking-tight">
          {track.name}
        </span>
        {hasParallelWarning && (
          <span title="Tasks without edges run in parallel">
            <AlertTriangle size={9} className="text-tagma-warning shrink-0" />
          </span>
        )}
        <span className="text-[9px] font-mono text-tagma-muted/60">
          {taskCount}
        </span>
      </div>

      {/* Row 2: Driver + Model Tier */}
      <div className="flex items-center gap-1.5">
        {track.driver && (
          <span className="text-[9px] font-mono text-tagma-accent/70 truncate max-w-[80px]">
            {track.driver}
          </span>
        )}
        {track.model_tier && (
          <span className={`text-[8px] font-mono font-bold ${TIER_COLORS[track.model_tier] ?? 'text-tagma-muted'}`}>
            {track.model_tier === 'high' ? 'H' : track.model_tier === 'medium' ? 'M' : track.model_tier === 'low' ? 'L' : track.model_tier}
          </span>
        )}
      </div>

      {/* Row 3: Permissions + on_failure + middleware count */}
      <div className="flex items-center gap-1.5">
        {perms && (
          <span className="flex items-center gap-px">
            <span className={`text-[8px] font-mono font-bold ${perms.read ? 'text-emerald-400' : 'text-tagma-muted/25'}`}>R</span>
            <span className={`text-[8px] font-mono font-bold ${perms.write ? 'text-amber-400' : 'text-tagma-muted/25'}`}>W</span>
            <span className={`text-[8px] font-mono font-bold ${perms.execute ? 'text-red-400' : 'text-tagma-muted/25'}`}>X</span>
          </span>
        )}
        {failure && (
          <span className={`flex items-center gap-0.5 ${track.on_failure === 'stop_all' ? 'text-red-400/70' : 'text-tagma-muted/50'}`} title={failure.label}>
            {failure.icon}
          </span>
        )}
        {track.middlewares && track.middlewares.length > 0 && (
          <span className="text-[8px] font-mono text-purple-400/60" title={`${track.middlewares.length} middleware(s)`}>
            mw:{track.middlewares.length}
          </span>
        )}
        {track.agent_profile && (
          <span className="text-[8px] font-mono text-tagma-muted/50 truncate max-w-[50px]" title={`Profile: ${track.agent_profile}`}>
            {track.agent_profile}
          </span>
        )}
      </div>
    </div>
  );
}

import { AlertTriangle, ShieldAlert, SkipForward, Ban } from 'lucide-react';
import type { RawTrackConfig } from '../../api/client';

interface TrackLaneProps {
  track: RawTrackConfig;
  taskCount: number;
  hasParallelWarning: boolean;
}

const TIER_LABEL: Record<string, string> = { high: 'H', medium: 'M', low: 'L' };
const TIER_COLOR: Record<string, string> = {
  high: 'text-blue-400',
  medium: 'text-tagma-muted',
  low: 'text-emerald-400',
};

const FAILURE_CFG: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  skip_downstream: { icon: <SkipForward size={8} />, color: 'text-tagma-muted/50', label: 'Skip downstream on failure' },
  stop_all: { icon: <ShieldAlert size={8} />, color: 'text-red-400/70', label: 'Stop all on failure' },
  ignore: { icon: <Ban size={8} />, color: 'text-tagma-muted/50', label: 'Ignore failures' },
};

export function TrackLane({ track, taskCount, hasParallelWarning }: TrackLaneProps) {
  const perms = track.permissions;
  const failure = track.on_failure ? FAILURE_CFG[track.on_failure] : null;
  const hasMeta = !!track.driver || !!track.model_tier || !!perms || !!failure
    || (track.middlewares && track.middlewares.length > 0) || !!track.agent_profile;

  return (
    <div className="h-full w-full flex flex-col justify-center px-3 select-none">
      {/* Row 1 (20px): Color dot · Name · Warning · Count */}
      <div className="flex items-center h-[20px] gap-1.5">
        {track.color
          ? <div className="w-[6px] h-[6px] shrink-0" style={{ backgroundColor: track.color }} />
          : <div className="w-[6px] shrink-0" />
        }
        <span className="text-[11px] font-semibold text-tagma-text truncate flex-1 tracking-tight leading-[20px]">
          {track.name}
        </span>
        {hasParallelWarning && (
          <span className="inline-flex items-center justify-center w-[10px] h-[10px] shrink-0" title="Tasks without edges run in parallel">
            <AlertTriangle size={9} className="text-tagma-warning" />
          </span>
        )}
        <span className="text-[9px] font-mono text-tagma-muted/60 w-[14px] text-right shrink-0 leading-[20px]">
          {taskCount}
        </span>
      </div>

      {/* Row 2 (16px): Driver · Tier · Perms · Failure · MW · Profile */}
      {hasMeta && (
        <div className="flex items-center h-[16px] gap-1.5 mt-px">
          {/* Driver */}
          {track.driver && (
            <span className="text-[8px] font-mono text-tagma-accent/70 truncate max-w-[72px] leading-[16px]">
              {track.driver}
            </span>
          )}
          {/* Model tier */}
          {track.model_tier && (
            <span className={`text-[8px] font-mono font-bold leading-[16px] ${TIER_COLOR[track.model_tier] ?? 'text-tagma-muted'}`}>
              {TIER_LABEL[track.model_tier] ?? track.model_tier}
            </span>
          )}
          {/* Separator */}
          {(track.driver || track.model_tier) && (perms || failure) && (
            <span className="text-[6px] text-tagma-muted/25 leading-[16px]">·</span>
          )}
          {/* Permissions */}
          {perms && (
            <span className="flex items-center h-[16px] gap-[2px]">
              <span className={`text-[8px] font-mono font-bold leading-[16px] ${perms.read ? 'text-emerald-400' : 'text-tagma-muted/25'}`}>R</span>
              <span className={`text-[8px] font-mono font-bold leading-[16px] ${perms.write ? 'text-amber-400' : 'text-tagma-muted/25'}`}>W</span>
              <span className={`text-[8px] font-mono font-bold leading-[16px] ${perms.execute ? 'text-red-400' : 'text-tagma-muted/25'}`}>X</span>
            </span>
          )}
          {/* On failure */}
          {failure && (
            <span className={`inline-flex items-center justify-center w-[10px] h-[10px] shrink-0 ${failure.color}`} title={failure.label}>
              {failure.icon}
            </span>
          )}
          {/* Middleware count */}
          {track.middlewares && track.middlewares.length > 0 && (
            <span className="text-[8px] font-mono text-purple-400/60 leading-[16px]" title={`${track.middlewares.length} middleware(s)`}>
              mw:{track.middlewares.length}
            </span>
          )}
          {/* Agent profile */}
          {track.agent_profile && (
            <span className="text-[8px] font-mono text-tagma-muted/40 truncate max-w-[46px] leading-[16px]" title={`Profile: ${track.agent_profile}`}>
              {track.agent_profile}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

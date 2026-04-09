import { AlertTriangle, ShieldAlert, SkipForward, Ban } from 'lucide-react';
import type { RawTrackConfig } from '../../api/client';

interface TrackLaneProps {
  track: RawTrackConfig;
  taskCount: number;
  hasParallelWarning: boolean;
}

const TIER_TEXT: Record<string, string> = { high: 'HIGH', medium: 'MED', low: 'LOW' };
const TIER_CLS: Record<string, string> = {
  high: 'bg-blue-500/10 text-blue-400/80',
  medium: 'bg-tagma-muted/8 text-tagma-muted/70',
  low: 'bg-emerald-500/10 text-emerald-400/80',
};

const FAIL_CFG: Record<string, { icon: React.ReactNode; cls: string; tip: string }> = {
  skip_downstream: { icon: <SkipForward size={8} />, cls: 'text-tagma-muted/40', tip: 'Skip downstream on failure' },
  stop_all: { icon: <ShieldAlert size={8} />, cls: 'text-red-400/60', tip: 'Stop all on failure' },
  ignore: { icon: <Ban size={8} />, cls: 'text-tagma-muted/40', tip: 'Ignore failures' },
};

function Chip({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center h-[14px] px-[4px] rounded-sm text-[7.5px] font-mono leading-[14px] ${className}`}>
      {children}
    </span>
  );
}

export function TrackLane({ track, taskCount, hasParallelWarning }: TrackLaneProps) {
  const perms = track.permissions;
  const fail = track.on_failure ? FAIL_CFG[track.on_failure] : null;
  const hasMeta = !!track.driver || !!track.model_tier || !!perms || !!fail
    || (track.middlewares && track.middlewares.length > 0) || !!track.agent_profile;

  return (
    <div className="h-full w-full flex flex-col justify-center px-3 select-none">
      {/* ─── Row 1 (22px): Color · Name · Badges · Count ─── */}
      <div className="flex items-center h-[22px] gap-[6px]">
        <div className="w-[6px] h-[6px] rounded-full shrink-0"
          style={{ backgroundColor: track.color ?? 'transparent', opacity: track.color ? 1 : 0 }} />

        <span className="text-[11px] font-semibold text-tagma-text truncate flex-1 leading-[22px] tracking-tight">
          {track.name}
        </span>

        {hasParallelWarning && (
          <span className="inline-flex items-center justify-center w-[14px] h-[14px] shrink-0" title="Tasks without edges run in parallel">
            <AlertTriangle size={9} className="text-tagma-warning" />
          </span>
        )}

        <span className="text-[9px] font-mono text-tagma-muted/50 tabular-nums shrink-0 leading-[22px]">
          {taskCount}
        </span>
      </div>

      {/* ─── Row 2 (18px): Driver chip · Tier chip · R W X · Failure · MW · Profile ─── */}
      {hasMeta && (
        <div className="flex items-center h-[18px] gap-[4px]">
          {track.driver && (
            <Chip className="bg-tagma-accent/8 text-tagma-accent/60">{track.driver}</Chip>
          )}
          {track.model_tier && (
            <Chip className={`font-bold ${TIER_CLS[track.model_tier] ?? 'bg-tagma-muted/8 text-tagma-muted/70'}`}>
              {TIER_TEXT[track.model_tier] ?? track.model_tier}
            </Chip>
          )}
          {perms && (
            <span className="flex items-center h-[14px] gap-[1px]">
              {(['read', 'write', 'execute'] as const).map((k) => (
                <span key={k} className={`text-[7px] font-mono font-bold w-[10px] text-center leading-[14px]
                  ${k === 'read' && perms.read ? 'text-emerald-400' : ''}
                  ${k === 'write' && perms.write ? 'text-amber-400' : ''}
                  ${k === 'execute' && perms.execute ? 'text-red-400' : ''}
                  ${!perms[k] ? 'text-tagma-muted/20' : ''}
                `}>
                  {k[0].toUpperCase()}
                </span>
              ))}
            </span>
          )}
          {fail && (
            <span className={`inline-flex items-center justify-center w-[14px] h-[14px] shrink-0 ${fail.cls}`} title={fail.tip}>
              {fail.icon}
            </span>
          )}
          {track.middlewares && track.middlewares.length > 0 && (
            <Chip className="bg-purple-500/8 text-purple-400/50">mw:{track.middlewares.length}</Chip>
          )}
          {track.agent_profile && (
            <span className="text-[7.5px] font-mono text-tagma-muted/35 truncate max-w-[44px] leading-[18px]" title={`Profile: ${track.agent_profile}`}>
              {track.agent_profile}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

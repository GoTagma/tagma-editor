import { AlertTriangle } from 'lucide-react';
import type { RawTrackConfig } from '../../api/client';

interface TrackLaneProps {
  track: RawTrackConfig;
  taskCount: number;
  hasParallelWarning: boolean;
}

export function TrackLane({ track, taskCount, hasParallelWarning }: TrackLaneProps) {
  return (
    <div className="h-full w-full flex flex-col justify-center px-3 select-none">
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
      </div>
      <div className="flex items-center gap-2 mt-0.5">
        {track.driver && (
          <span className="text-[9px] font-mono text-tagma-accent/70 truncate max-w-[90px]">
            {track.driver}
          </span>
        )}
        <span className="text-[9px] font-mono text-tagma-muted/60 ml-auto">
          {taskCount}
        </span>
      </div>
    </div>
  );
}

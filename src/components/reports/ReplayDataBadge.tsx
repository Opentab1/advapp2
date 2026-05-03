/**
 * ReplayDataBadge — small chip surfaced when today's metrics include
 * data reconstructed from NVR replay (i.e. the droplet was down for part
 * of the day and admin filled the gap via the DR Replay queue).
 *
 * Conditional render — caller only mounts this when hasReplayDataToday=true.
 */
import { ShieldAlert } from 'lucide-react';

export function ReplayDataBadge({ minutes }: { minutes: number }) {
  if (minutes <= 0) return null;
  const human = minutes < 60
    ? `${minutes} min`
    : `${(minutes / 60).toFixed(minutes % 60 === 0 ? 0 : 1)} hr`;
  return (
    <div
      title="Some of today's data was reconstructed by replaying NVR footage through the analyzer because live capture was offline. Numbers are real, just produced after the fact."
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[11px] font-medium"
    >
      <ShieldAlert className="w-3 h-3" />
      <span>
        {human} reconstructed from NVR replay
      </span>
    </div>
  );
}

/**
 * Operating-hours helpers — mirrors core/venue_hours.py on the worker.
 *
 * The V2 schema (per-day + timezone) lives in DDB at
 *   VenueConfig.settings.businessHours = {
 *     timezone: "America/New_York",
 *     days: { mon: {open, close, closed}, ..., sun: ... }
 *   }
 *
 * Both the worker and the React UI need to agree on "is the venue open
 * right now" — including the 15-minute warmup before open and the
 * 15-minute cooldown after close that the worker uses to gate inference
 * and DDB pushes. Keep this file in sync with the Python counterpart.
 */

export type V2DaySchedule = { open: string; close: string; closed: boolean };
export type V2BusinessHours = {
  timezone: string;
  days: Record<string, V2DaySchedule>;
};

const DAY_KEYS = ['mon','tue','wed','thu','fri','sat','sun'] as const;

const WARMUP_MIN = 15;
const COOLDOWN_MIN = 15;

function hhmmToMin(s: string): number {
  const [h, m] = (s || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Convert a Date to {weekday 0=mon..6=sun, hour, minute} in the given timezone. */
function partsInTZ(d: Date, timezone: string): { dow: number; min: number } {
  // Intl.DateTimeFormat handles timezone conversion accurately.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  const wd = get('weekday').toLowerCase();          // "mon", "tue"...
  const hour = parseInt(get('hour'), 10) || 0;       // 0-23
  const minute = parseInt(get('minute'), 10) || 0;
  const dow = DAY_KEYS.indexOf(wd as any);
  return {
    dow: dow < 0 ? 0 : dow,
    min: hour * 60 + minute,
  };
}

/** Returns whether the venue is currently open per its schedule. */
export function isVenueOpenNow(
  hours: V2BusinessHours | null | undefined,
  now: Date = new Date(),
  warmupMin = WARMUP_MIN,
  cooldownMin = COOLDOWN_MIN,
): boolean {
  // No schedule saved → default open (matches worker fail-open behavior).
  if (!hours || !hours.days) return true;

  const tz = hours.timezone || 'America/New_York';
  const { dow, min } = partsInTZ(now, tz);
  const todayKey = DAY_KEYS[dow];
  const yestKey  = DAY_KEYS[(dow + 6) % 7];
  const today = hours.days[todayKey];
  const yest  = hours.days[yestKey];

  // 1) Yesterday's overnight tail crossing midnight into today.
  if (yest && !yest.closed) {
    const yOpen  = hhmmToMin(yest.open);
    const yClose = hhmmToMin(yest.close);
    if (yClose <= yOpen) {
      // Overnight schedule. The tail runs from 00:00 until yClose+cooldown.
      if (min < yClose + cooldownMin) return true;
    }
  }

  // 2) Today's window.
  if (!today || today.closed) return false;
  const tOpen  = hhmmToMin(today.open);
  const tClose = hhmmToMin(today.close);
  if (tClose <= tOpen) {
    // Today opens and crosses into tomorrow morning.
    if (min >= tOpen - warmupMin) return true;
    return false;
  }
  return min >= (tOpen - warmupMin) && min < (tClose + cooldownMin);
}

/** "5pm" or "Wednesday 12pm" style label for the next time we're open. */
export function nextOpenLabel(
  hours: V2BusinessHours | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!hours || !hours.days) return null;
  const tz = hours.timezone || 'America/New_York';

  // Walk forward up to 8 days at 5-minute granularity, find the first time
  // isVenueOpenNow flips to true. Return a friendly label.
  let cursor = new Date(now.getTime());
  cursor.setSeconds(0, 0);
  const end = new Date(cursor.getTime() + 8 * 86400 * 1000);
  while (cursor < end) {
    cursor = new Date(cursor.getTime() + 5 * 60 * 1000);
    if (isVenueOpenNow(hours, cursor)) {
      // Format in venue timezone.
      const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        weekday: 'short',
      });
      const todayWeekday = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, weekday: 'short',
      }).format(now);
      const cursorWeekday = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, weekday: 'short',
      }).format(cursor);
      // If the next-open is today, drop the weekday prefix for a cleaner label.
      if (cursorWeekday === todayWeekday) {
        return new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        }).format(cursor).replace(':00', '');
      }
      return fmt.format(cursor).replace(':00', '');
    }
  }
  return null;
}

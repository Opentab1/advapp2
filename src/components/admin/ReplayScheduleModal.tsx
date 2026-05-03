/**
 * ReplayScheduleModal — queue a DR replay job for a chosen camera/day's gaps.
 *
 * Caller passes the `gaps` already filtered to the camera + date the operator
 * clicked. The modal lets them:
 *   - confirm/deselect individual gaps,
 *   - pick when the replay runs (default: tonight 4am venue-local),
 *   - choose output mode (publish to Reports / admin-only),
 *   - submit → POST /ops/replay/jobs.
 *
 * Multiple submitted jobs queue in scheduledFor order on the worker; replays
 * run sequentially since they're memory-heavy.
 */
import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Calendar, Clock, AlertTriangle, PlayCircle, Loader2, ShieldAlert,
  Camera as CameraIcon,
} from 'lucide-react';
import adminService from '../../services/admin.service';
import cameraService, { Camera as CameraType } from '../../services/camera.service';

interface Gap {
  cameraId:    string;
  cameraName:  string;
  startEpoch:  number;
  endEpoch:    number;
  durationSec: number;
  dateIso?:    string;
}

interface Props {
  venueId: string;
  tz:      string;
  /** Pre-selected gaps to fill (gap-mode). Empty/omitted → custom-window mode
   *  where the operator picks cameras + start/end from scratch. */
  gaps?:   Gap[];
  onClose: () => void;
  onCreated: () => void;
}

/** Deterministic 0–179 minute offset from 4am, hashed per-venue.
 *  Spreads NVR upstream load across the off-hours window so 25 droplets
 *  don't all start fetching playback at exactly 04:00:00. */
function staggerOffsetMinutes(venueId: string): number {
  let h = 0;
  for (let i = 0; i < venueId.length; i++) {
    h = ((h << 5) - h + venueId.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 180;          // 0–179 min
}

function nextDefaultRunAt(tz: string, venueId: string): { date: string; time: string } {
  // Default schedule: tonight 04:00 + per-venue stagger, in the venue tz.
  // If we're past the staggered start hour locally, schedule for tomorrow.
  const offsetMin = staggerOffsetMinutes(venueId);
  const startHour = 4 + Math.floor(offsetMin / 60);
  const startMin  = offsetMin % 60;
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value || '0');
  const localNowMin = get('hour') * 60 + get('minute');
  const startTotalMin = startHour * 60 + startMin;
  const baseDate = new Date(Date.now() + (localNowMin >= startTotalMin ? 86400_000 : 0));
  const dateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(baseDate);
  const hh = String(startHour).padStart(2, '0');
  const mm = String(startMin).padStart(2, '0');
  return { date: dateStr, time: `${hh}:${mm}` };
}

function localToEpoch(dateIso: string, timeHm: string, tz: string): number | null {
  // Convert a (YYYY-MM-DD, HH:mm) local-in-tz pair to a Unix epoch in seconds.
  // We compare formatted "what would this UTC be in tz" against the target,
  // adjusting in 1-min steps. Cheap, correct for our minute precision needs.
  const [y, m, d] = dateIso.split('-').map(Number);
  const [hh, mm]  = timeHm.split(':').map(Number);
  if (!y || !m || !d || isNaN(hh) || isNaN(mm)) return null;
  // First approximation: treat input as UTC, then nudge.
  let guess = Date.UTC(y, m - 1, d, hh, mm);
  for (let i = 0; i < 4; i++) {                // converges fast
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const parts = fmt.formatToParts(new Date(guess));
    const obs = {
      y: Number(parts.find(p => p.type === 'year')?.value),
      m: Number(parts.find(p => p.type === 'month')?.value),
      d: Number(parts.find(p => p.type === 'day')?.value),
      h: Number(parts.find(p => p.type === 'hour')?.value),
      n: Number(parts.find(p => p.type === 'minute')?.value),
    };
    const obsMs = Date.UTC(obs.y, obs.m - 1, obs.d, obs.h, obs.n);
    const wantMs = Date.UTC(y, m - 1, d, hh, mm);
    const delta  = wantMs - obsMs;
    if (delta === 0) return Math.floor(guess / 1000);
    guess += delta;
  }
  return Math.floor(guess / 1000);
}

function fmtLocal(epoch: number, tz: string): string {
  return new Date(epoch * 1000).toLocaleString('en-US', {
    timeZone: tz, month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function fmtDuration(sec: number): string {
  if (sec < 60)   return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}min`;
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function ReplayScheduleModal({ venueId, tz, gaps = [], onClose, onCreated }: Props) {
  // Custom-window mode kicks in when caller didn't pre-select any gaps —
  // operator picks cameras + start/end from scratch. Used both for the
  // "I just want to replay last Saturday" workflow and to validate the
  // replay path when no gaps exist.
  const isCustomMode = gaps.length === 0;

  const def = useMemo(() => nextDefaultRunAt(tz, venueId), [tz, venueId]);
  const [date,        setDate]        = useState(def.date);
  const [time,        setTime]        = useState(def.time);
  const [runMode,     setRunMode]     = useState<'scheduled' | 'now'>('scheduled');
  const [outputMode,  setOutputMode]  = useState<'publish' | 'admin_only'>(
    isCustomMode ? 'admin_only' : 'publish',          // safer default for ad-hoc
  );
  const [requestedBy, setRequestedBy] = useState('admin');
  const [selected,    setSelected]    = useState<Set<string>>(
    () => new Set(gaps.map(g => `${g.startEpoch}_${g.endEpoch}`))
  );
  const [submitting,  setSubmitting]  = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  // ── Custom-mode state ──────────────────────────────────────────────────
  // Default: yesterday 19:00–20:00 venue-local (busy hour, NVR retention OK).
  const yesterday = useMemo(() => {
    const d = new Date(Date.now() - 86400_000);
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d);
  }, [tz]);
  const [winDate,    setWinDate]    = useState(yesterday);
  const [winStart,   setWinStart]   = useState('19:00');
  const [winEnd,     setWinEnd]     = useState('20:00');
  const [cameras,    setCameras]    = useState<CameraType[]>([]);
  const [pickedCams, setPickedCams] = useState<Set<string>>(new Set());
  const [loadingCams, setLoadingCams] = useState(false);

  useEffect(() => {
    // Best-effort: pre-fill requestedBy from the logged-in admin if available.
    import('../../services/auth.service')
      .then(m => m.default.getCurrentAuthenticatedUser())
      .then(u => u?.email && setRequestedBy(u.email))
      .catch(() => { /* fall back to 'admin' */ });
  }, []);

  // Fetch the venue's camera list when in custom mode.
  useEffect(() => {
    if (!isCustomMode || !venueId) return;
    let cancelled = false;
    setLoadingCams(true);
    cameraService.listCameras(venueId)
      .then(list => {
        if (cancelled) return;
        const enabled = list.filter(c => c.enabled);
        setCameras(enabled);
        // Default-pick all cameras with at least one mode (active replay candidates).
        setPickedCams(new Set(
          enabled.filter(c => (c.modes ?? []).length > 0).map(c => c.cameraId),
        ));
      })
      .catch(e => !cancelled && setError(`Failed to load cameras: ${(e as Error).message}`))
      .finally(() => !cancelled && setLoadingCams(false));
    return () => { cancelled = true; };
  }, [isCustomMode, venueId]);

  const chosenGaps   = gaps.filter(g => selected.has(`${g.startEpoch}_${g.endEpoch}`));
  const totalSeconds = chosenGaps.reduce((s, g) => s + g.durationSec, 0);

  // Build synthetic gap[] from custom inputs: one entry per picked camera
  // covering [winStart, winEnd] on winDate in venue tz.
  const customGaps = useMemo(() => {
    if (!isCustomMode) return [];
    const startEpoch = localToEpoch(winDate, winStart, tz);
    const endEpoch   = localToEpoch(winDate, winEnd,   tz);
    if (!startEpoch || !endEpoch || endEpoch <= startEpoch) return [];
    const dur = endEpoch - startEpoch;
    return cameras
      .filter(c => pickedCams.has(c.cameraId))
      .map(c => ({
        cameraId:    c.cameraId,
        cameraName:  c.name || c.cameraId,
        startEpoch,
        endEpoch,
        durationSec: dur,
      }));
  }, [isCustomMode, winDate, winStart, winEnd, tz, cameras, pickedCams]);

  const handleSubmit = async () => {
    setError(null);
    const targetGaps = isCustomMode ? customGaps : chosenGaps;
    if (targetGaps.length === 0) {
      setError(isCustomMode
        ? 'Pick at least one camera + a valid time window.'
        : 'Pick at least one gap to fill.');
      return;
    }
    if (isCustomMode) {
      const dur = targetGaps[0].endEpoch - targetGaps[0].startEpoch;
      if (dur < 60)            { setError('Window too short (< 1 min).'); return; }
      if (dur > 24 * 3600)     { setError('Window too long (> 24 hr).');  return; }
    }
    let scheduledFor: number | null = null;
    if (runMode === 'scheduled') {
      const epoch = localToEpoch(date, time, tz);
      if (!epoch) { setError('Invalid scheduled date/time.'); return; }
      if (epoch < Math.floor(Date.now() / 1000) - 60) {
        setError('Scheduled time is in the past — pick a future time or "Run now".');
        return;
      }
      scheduledFor = epoch;
    }
    setSubmitting(true);
    try {
      await adminService.createReplayJob(venueId, {
        gaps: targetGaps.map(g => ({
          cameraId:    g.cameraId,
          cameraName:  g.cameraName,
          startEpoch:  g.startEpoch,
          endEpoch:    g.endEpoch,
          durationSec: g.durationSec,
        })),
        scheduledFor,
        outputMode,
        requestedBy,
        tz,
      });
      onCreated();
    } catch (e) {
      setError((e as Error).message || 'Failed to queue replay');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 overflow-y-auto"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="rounded-2xl bg-zinc-900 border border-white/10 w-full max-w-2xl max-h-[90vh] overflow-y-auto"
          initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between p-5 border-b border-white/10">
            <div className="flex items-center gap-3">
              <ShieldAlert className="w-5 h-5 text-amber-400" />
              <div>
                <h2 className="text-lg font-bold text-white">
                  {isCustomMode ? 'Schedule Replay' : 'Schedule DR Replay'}
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  {isCustomMode
                    ? 'Pick a window + cameras and re-run that footage through this venue\'s worker.'
                    : 'Re-run NVR footage through the worker for the selected gaps.'}
                </p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/5 text-gray-400">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-5 space-y-5">
            {/* ── Source: gap list (gap-mode) OR window+cameras (custom-mode) ── */}
            {isCustomMode ? (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold mb-1 flex items-center gap-1">
                      <Calendar className="w-3 h-3" /> Replay date ({tz})
                    </label>
                    <input type="date" value={winDate}
                      onChange={e => setWinDate(e.target.value)}
                      className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-fuchsia-500/50"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold mb-1 flex items-center gap-1">
                      <Clock className="w-3 h-3" /> Start
                    </label>
                    <input type="time" value={winStart}
                      onChange={e => setWinStart(e.target.value)}
                      className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-fuchsia-500/50"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold mb-1 flex items-center gap-1">
                      <Clock className="w-3 h-3" /> End
                    </label>
                    <input type="time" value={winEnd}
                      onChange={e => setWinEnd(e.target.value)}
                      className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-fuchsia-500/50"
                    />
                  </div>
                </div>
                {customGaps.length > 0 && (
                  <p className="text-[11px] text-gray-500 -mt-3">
                    Window: {fmtLocal(customGaps[0].startEpoch, tz)} → {fmtLocal(customGaps[0].endEpoch, tz)}
                    {' · '}{fmtDuration(customGaps[0].durationSec)} per camera
                    {customGaps.length > 1 && ` · ${customGaps.length} cameras`}
                  </p>
                )}

                <div>
                  <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-2 flex items-center gap-1.5">
                    <CameraIcon className="w-3 h-3" />
                    Cameras ({pickedCams.size}/{cameras.length} selected)
                  </div>
                  {loadingCams ? (
                    <div className="text-sm text-gray-400 py-4 text-center">Loading cameras…</div>
                  ) : cameras.length === 0 ? (
                    <div className="text-sm text-gray-400 py-4 text-center">No enabled cameras for this venue.</div>
                  ) : (
                    <div className="grid grid-cols-2 gap-1.5 max-h-56 overflow-y-auto pr-1">
                      {cameras.map(c => {
                        const checked = pickedCams.has(c.cameraId);
                        const modes = (c.modes ?? []).join(', ') || 'no modes';
                        return (
                          <label key={c.cameraId}
                            className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${
                              checked
                                ? 'border-fuchsia-500/40 bg-fuchsia-500/5'
                                : 'border-white/10 bg-white/[0.02] hover:border-white/20'
                            }`}
                          >
                            <input type="checkbox" checked={checked}
                              onChange={() => setPickedCams(s => {
                                const n = new Set(s);
                                if (n.has(c.cameraId)) n.delete(c.cameraId);
                                else n.add(c.cameraId);
                                return n;
                              })}
                              className="rounded"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm text-white font-medium truncate">{c.name || c.cameraId}</div>
                              <div className="text-[10px] text-gray-500 truncate">{modes}</div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-2">
                  Gaps to fill ({chosenGaps.length}/{gaps.length} selected · {fmtDuration(totalSeconds)} total)
                </div>
                <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                  {gaps.map(g => {
                    const key = `${g.startEpoch}_${g.endEpoch}`;
                    const checked = selected.has(key);
                    return (
                      <label
                        key={key}
                        className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                          checked
                            ? 'border-amber-500/40 bg-amber-500/5'
                            : 'border-white/10 bg-white/[0.02] hover:border-white/20'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setSelected(s => {
                            const n = new Set(s);
                            if (n.has(key)) n.delete(key); else n.add(key);
                            return n;
                          })}
                          className="rounded"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-white font-medium">
                            {g.cameraName} <span className="text-gray-500 font-mono text-[11px]">{g.cameraId}</span>
                          </div>
                          <div className="text-[11px] text-gray-400 mt-0.5">
                            {fmtLocal(g.startEpoch, tz)} → {fmtLocal(g.endEpoch, tz)}
                            <span className="ml-2 text-amber-300/80">{fmtDuration(g.durationSec)}</span>
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Schedule */}
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-2">
                When to run
              </div>
              <div className="flex gap-2 mb-3">
                <button
                  onClick={() => setRunMode('scheduled')}
                  className={`flex-1 px-3 py-2 rounded-lg border text-sm flex items-center justify-center gap-2 ${
                    runMode === 'scheduled'
                      ? 'bg-fuchsia-500/15 border-fuchsia-500/40 text-fuchsia-200'
                      : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/20'
                  }`}
                >
                  <Calendar className="w-4 h-4" /> Schedule
                </button>
                <button
                  onClick={() => setRunMode('now')}
                  className={`flex-1 px-3 py-2 rounded-lg border text-sm flex items-center justify-center gap-2 ${
                    runMode === 'now'
                      ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-200'
                      : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/20'
                  }`}
                >
                  <PlayCircle className="w-4 h-4" /> Run now
                </button>
              </div>

              {runMode === 'scheduled' ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold mb-1 flex items-center gap-1">
                        <Calendar className="w-3 h-3" /> Date ({tz})
                      </label>
                      <input
                        type="date"
                        value={date}
                        onChange={e => setDate(e.target.value)}
                        className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-fuchsia-500/50"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold mb-1 flex items-center gap-1">
                        <Clock className="w-3 h-3" /> Local time
                      </label>
                      <input
                        type="time"
                        value={time}
                        onChange={e => setTime(e.target.value)}
                        className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-fuchsia-500/50"
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-gray-500 mt-2">
                    Default 4am tomorrow — venue closed, full RAM available, no live-coverage hit.
                    Multiple queued replays run one after another.
                  </p>
                </>
              ) : (
                <p className="text-[11px] text-amber-300/80">
                  Replay will start within ~30s. If live cameras are running, they'll
                  contend for CPU/RAM with the replay — prefer scheduling for off-hours
                  unless this is urgent.
                </p>
              )}
            </div>

            {/* Output mode */}
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-2">
                Where to publish results
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setOutputMode('publish')}
                  className={`p-3 rounded-lg border text-left ${
                    outputMode === 'publish'
                      ? 'bg-fuchsia-500/10 border-fuchsia-500/40'
                      : 'bg-white/5 border-white/10 hover:border-white/20'
                  }`}
                >
                  <div className="text-sm text-white font-semibold">Publish to Reports</div>
                  <div className="text-[11px] text-gray-400 mt-0.5">
                    Venue sees the replayed data on their Reports tab, badged "reconstructed".
                  </div>
                </button>
                <button
                  onClick={() => setOutputMode('admin_only')}
                  className={`p-3 rounded-lg border text-left ${
                    outputMode === 'admin_only'
                      ? 'bg-cyan-500/10 border-cyan-500/40'
                      : 'bg-white/5 border-white/10 hover:border-white/20'
                  }`}
                >
                  <div className="text-sm text-white font-semibold">Admin only</div>
                  <div className="text-[11px] text-gray-400 mt-0.5">
                    Results visible only here; venue dashboard untouched.
                  </div>
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-xs">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 p-4 border-t border-white/10 bg-black/20">
            <button
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 rounded-lg text-sm text-gray-300 hover:bg-white/5 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting || (isCustomMode ? customGaps.length === 0 : chosenGaps.length === 0)}
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-fuchsia-600 hover:opacity-90 text-white font-semibold text-sm disabled:opacity-50 flex items-center gap-2"
            >
              {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {submitting ? 'Queuing…' : 'Queue Replay'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

/**
 * ReviewQueue — admin-only low-confidence event review page.
 *
 * When a detector fires below its confidence threshold, the event lands here.
 * Ops reviewers scrub each one, watch a short clip + thumbnail, and approve
 * (count it) or reject (drop it). The authoritative venue totals reflect those
 * decisions; the same decisions feed a learning signal for future retraining.
 *
 * Works against the /admin/review-queue endpoints in admin.service.ts. Until
 * the backend + worker changes land, service calls return empty arrays and
 * this page renders the empty state — safe to ship ahead of the backend.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ShieldCheck, ShieldX, RefreshCw, Filter, Eye, Check, X, Loader2,
  AlertCircle, ClipboardList,
} from 'lucide-react';
import { useAdminVenue } from '../../contexts/AdminVenueContext';
import { VenueSelector } from '../../components/admin/VenueSelector';
import reviewService, {
  LowConfEvent, ReviewStatus, FEATURE_LABEL, CONFIDENCE_THRESHOLDS,
} from '../../services/review.service';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtTs(ts?: number): string {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtConf(c: number): string {
  return (c * 100).toFixed(0) + '%';
}

function confColor(c: number, feature: string): string {
  const t = CONFIDENCE_THRESHOLDS[feature] ?? 0.30;
  if (c >= t)           return 'text-green-400';
  if (c >= t - 0.08)    return 'text-yellow-400';
  return 'text-red-400';
}

// ─── Media preview ───────────────────────────────────────────────────────────

function EventMedia({ event }: { event: LowConfEvent }) {
  const [showClip, setShowClip] = useState(false);
  if (event.clipUrl && showClip) {
    return (
      <div className="relative bg-black/50 rounded overflow-hidden aspect-video">
        <video
          src={event.clipUrl} autoPlay muted loop playsInline controls
          className="w-full h-full object-contain"
        />
        <button
          onClick={() => setShowClip(false)}
          className="absolute top-1.5 right-1.5 bg-black/60 hover:bg-black/80 text-white text-xs px-1.5 py-0.5 rounded"
        >back to still</button>
      </div>
    );
  }
  if (event.snapshotUrl) {
    return (
      <button
        onClick={() => event.clipUrl && setShowClip(true)}
        className="relative block w-full aspect-video bg-black/30 rounded overflow-hidden group"
      >
        <img src={event.snapshotUrl} alt="event snapshot"
             className="w-full h-full object-contain" />
        {event.clipUrl && (
          <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center">
            <Eye className="w-8 h-8 text-white" />
          </div>
        )}
      </button>
    );
  }
  return (
    <div className="w-full aspect-video bg-black/20 rounded flex items-center justify-center text-gray-500 text-xs">
      no snapshot available
    </div>
  );
}

// ─── Event card ──────────────────────────────────────────────────────────────

function EventCard({
  event, onApprove, onReject, busy,
}: {
  event:     LowConfEvent;
  onApprove: (id: string) => void;
  onReject:  (id: string) => void;
  busy:      boolean;
}) {
  const detectedValue = (() => {
    if (!event.detectedValueJson) return '';
    try {
      const v = JSON.parse(event.detectedValueJson);
      if (typeof v === 'string') return v;
      if (v.label) return v.label;
      if (v.bartender) return `by ${v.bartender}`;
      if (v.table_id) return `table ${v.table_id}`;
      return JSON.stringify(v).slice(0, 60);
    } catch { return ''; }
  })();

  return (
    <motion.div
      layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.15 }}
      className="glass-card overflow-hidden flex flex-col"
    >
      <EventMedia event={event} />
      <div className="p-3 flex flex-col gap-2 text-sm">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-semibold text-white">
              {FEATURE_LABEL[event.feature] ?? event.feature}
            </div>
            <div className="text-xs text-gray-400">
              {event.cameraName ?? event.cameraId} · {fmtTs(event.detectedAt)}
            </div>
          </div>
          <div className={`text-xs font-mono ${confColor(event.confidence, event.feature)}`}>
            {fmtConf(event.confidence)}
          </div>
        </div>
        {detectedValue && (
          <div className="text-xs text-gray-300 italic">{detectedValue}</div>
        )}
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => onApprove(event.eventId)} disabled={busy}
            className="flex-1 inline-flex items-center justify-center gap-1 bg-green-600/20 hover:bg-green-600/30 disabled:opacity-40 border border-green-500/30 text-green-300 text-xs font-semibold rounded px-2 py-1.5"
          >
            <Check className="w-3.5 h-3.5" /> Approve
          </button>
          <button
            onClick={() => onReject(event.eventId)} disabled={busy}
            className="flex-1 inline-flex items-center justify-center gap-1 bg-red-600/20 hover:bg-red-600/30 disabled:opacity-40 border border-red-500/30 text-red-300 text-xs font-semibold rounded px-2 py-1.5"
          >
            <X className="w-3.5 h-3.5" /> Reject
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function ReviewQueue() {
  const { selectedVenue } = useAdminVenue();

  const [events,     setEvents]     = useState<LowConfEvent[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [err,        setErr]        = useState<string | null>(null);
  const [busyIds,    setBusyIds]    = useState<Set<string>>(new Set());
  const [featureF,   setFeatureF]   = useState<string>('');
  const [statusF,    setStatusF]    = useState<ReviewStatus>('pending');
  const [bulkMode,   setBulkMode]   = useState(false);
  const [selected,   setSelected]   = useState<Set<string>>(new Set());
  const [lastUpd,    setLastUpd]    = useState<Date | null>(null);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const rows = await reviewService.list({
        venueId: selectedVenue?.venueId,
        feature: featureF || undefined,
        status:  statusF,
        limit:   200,
      });
      setEvents(rows);
      setLastUpd(new Date());
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to load review queue');
    } finally {
      setLoading(false);
    }
  }, [selectedVenue?.venueId, featureF, statusF]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  // Stats summary
  const stats = useMemo(() => {
    const byFeature: Record<string, number> = {};
    for (const e of events) byFeature[e.feature] = (byFeature[e.feature] ?? 0) + 1;
    return { total: events.length, byFeature };
  }, [events]);

  const handleApprove = async (id: string, note?: string) => {
    setBusyIds(s => new Set(s).add(id));
    try {
      await reviewService.approve(id, note);
      setEvents(evs => evs.filter(e => e.eventId !== id));
    } catch (e: any) {
      setErr(`Approve failed: ${e?.message ?? 'unknown'}`);
    } finally {
      setBusyIds(s => { const n = new Set(s); n.delete(id); return n; });
    }
  };
  const handleReject = async (id: string, note?: string) => {
    setBusyIds(s => new Set(s).add(id));
    try {
      await reviewService.reject(id, note);
      setEvents(evs => evs.filter(e => e.eventId !== id));
    } catch (e: any) {
      setErr(`Reject failed: ${e?.message ?? 'unknown'}`);
    } finally {
      setBusyIds(s => { const n = new Set(s); n.delete(id); return n; });
    }
  };
  const handleBulk = async (action: 'approve' | 'rejected') => {
    if (!selected.size) return;
    const ids = Array.from(selected);
    const marker = new Set(ids);
    setBusyIds(marker);
    try {
      await reviewService.bulk(ids, action === 'approve' ? 'approve' : 'reject');
      setEvents(evs => evs.filter(e => !marker.has(e.eventId)));
      setSelected(new Set());
      setBulkMode(false);
    } catch (e: any) {
      setErr(`Bulk action failed: ${e?.message ?? 'unknown'}`);
    } finally {
      setBusyIds(new Set());
    }
  };

  // ── Header ───────────────────────────────────────────────────────────────
  const header = (
    <div className="glass-card p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-cyan-400" />
            Review Queue
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            Low-confidence events waiting for human review. Accepting counts them toward
            the venue total; rejecting drops them. Thresholds per feature:&nbsp;
            {Object.entries(CONFIDENCE_THRESHOLDS).map(([f, t]) => (
              <span key={f} className="inline-block mr-2 font-mono text-xs">
                {FEATURE_LABEL[f] ?? f}=&lt;{(t * 100).toFixed(0)}%
              </span>
            ))}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastUpd && (
            <span className="text-xs text-gray-500">
              {lastUpd.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={fetchEvents} disabled={loading}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-white/5 hover:bg-white/10 text-white text-xs"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <VenueSelector />

        <div className="flex items-center gap-1 border-l border-white/10 pl-3">
          <Filter className="w-4 h-4 text-gray-500" />
          <select
            value={statusF}
            onChange={e => setStatusF(e.target.value as ReviewStatus)}
            className="bg-white/5 border border-white/10 rounded text-white text-sm px-2 py-1.5"
          >
            <option value="pending">Pending ({events.length})</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
          <select
            value={featureF}
            onChange={e => setFeatureF(e.target.value)}
            className="bg-white/5 border border-white/10 rounded text-white text-sm px-2 py-1.5"
          >
            <option value="">All features</option>
            {Object.entries(FEATURE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>

        {statusF === 'pending' && events.length > 0 && (
          <div className="ml-auto flex items-center gap-2">
            {bulkMode ? (
              <>
                <span className="text-xs text-gray-400">
                  {selected.size} selected
                </span>
                <button
                  onClick={() => handleBulk('approve')} disabled={!selected.size}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-green-600/20 hover:bg-green-600/30 text-green-300 text-xs disabled:opacity-40"
                >
                  <ShieldCheck className="w-3.5 h-3.5" /> Approve selected
                </button>
                <button
                  onClick={() => handleBulk('rejected')} disabled={!selected.size}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-red-600/20 hover:bg-red-600/30 text-red-300 text-xs disabled:opacity-40"
                >
                  <ShieldX className="w-3.5 h-3.5" /> Reject selected
                </button>
                <button
                  onClick={() => { setBulkMode(false); setSelected(new Set()); }}
                  className="px-3 py-1.5 rounded bg-white/5 hover:bg-white/10 text-gray-400 text-xs"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => setBulkMode(true)}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-white/5 hover:bg-white/10 text-white text-xs"
              >
                Bulk select
              </button>
            )}
          </div>
        )}
      </div>

      {err && (
        <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded px-3 py-2 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" /> {err}
        </div>
      )}

      <div className="flex items-center gap-4 text-xs text-gray-400">
        <span>Total: {stats.total}</span>
        {Object.entries(stats.byFeature).map(([f, n]) => (
          <span key={f}>{FEATURE_LABEL[f] ?? f}: {n}</span>
        ))}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {header}

      {loading ? (
        <div className="glass-card p-8 flex items-center justify-center text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading events…
        </div>
      ) : events.length === 0 ? (
        <div className="glass-card p-10 text-center">
          <ShieldCheck className="w-12 h-12 text-green-400 mx-auto mb-3" />
          <div className="text-lg font-semibold text-white mb-1">
            Nothing to review
          </div>
          <p className="text-sm text-gray-400 max-w-md mx-auto">
            Either the detector is running clean, or the backend hook isn't deployed yet.
            New low-confidence events will land here automatically for the reviewer on duty.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          <AnimatePresence mode="popLayout">
            {events.map(ev => (
              <div key={ev.eventId} className={bulkMode ? 'relative' : ''}>
                {bulkMode && (
                  <label className="absolute top-2 left-2 z-10 bg-black/60 rounded px-2 py-1 flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox" checked={selected.has(ev.eventId)}
                      onChange={e => {
                        const n = new Set(selected);
                        if (e.target.checked) n.add(ev.eventId); else n.delete(ev.eventId);
                        setSelected(n);
                      }}
                    />
                    <span className="text-xs text-white">select</span>
                  </label>
                )}
                <EventCard
                  event={ev}
                  onApprove={handleApprove}
                  onReject={handleReject}
                  busy={busyIds.has(ev.eventId)}
                />
              </div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

export default ReviewQueue;

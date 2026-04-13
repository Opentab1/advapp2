/**
 * AlertsInbox — VenueScope admin alerts page
 *
 * Fetches from GET /admin/alerts. Allows filtering by type and venue.
 * Reviewed IDs are persisted to localStorage.
 */

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ShieldAlert,
  Camera,
  AlertTriangle,
  Settings,
  RefreshCw,
  CheckCircle,
  Bell,
  BellOff,
  Copy,
  Check,
} from 'lucide-react';
import adminService, { AdminAlert } from '../../services/admin.service';
import { useAdminVenue } from '../../contexts/AdminVenueContext';
import { VenueSelector } from '../../components/admin/VenueSelector';

// ─── Helpers ────────────────────────────────────────────────────────────────────

const REVIEWED_KEY = 'adminReviewedAlerts';

function loadReviewed(): Set<string> {
  try {
    const raw = localStorage.getItem(REVIEWED_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function saveReviewed(ids: Set<string>) {
  try {
    localStorage.setItem(REVIEWED_KEY, JSON.stringify([...ids].slice(-1000)));
  } catch { /* */ }
}

function timeAgo(ts: number): string {
  const secs = Math.floor((Date.now() - ts * 1000) / 1000);
  if (secs < 60)   return 'Just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

type FilterTab = 'all' | 'theft' | 'camera_error' | 'config_missing';

const FILTER_TABS: { id: FilterTab; label: string }[] = [
  { id: 'all',            label: 'All' },
  { id: 'theft',          label: 'Theft' },
  { id: 'camera_error',   label: 'Camera Errors' },
  { id: 'config_missing', label: 'Config Issues' },
];

function severityStyle(severity: AdminAlert['severity']): string {
  switch (severity) {
    case 'high':   return 'border-red-500/40 bg-red-500/8';
    case 'medium': return 'border-orange-500/30 bg-orange-500/8';
    default:       return 'border-yellow-500/30 bg-yellow-500/8';
  }
}

function severityBadge(severity: AdminAlert['severity']) {
  switch (severity) {
    case 'high':   return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-400">High</span>;
    case 'medium': return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-orange-500/20 text-orange-400">Medium</span>;
    default:       return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-500/20 text-yellow-400">Low</span>;
  }
}

function alertIcon(type: AdminAlert['type']) {
  switch (type) {
    case 'theft':          return <ShieldAlert className="w-5 h-5 text-red-400" />;
    case 'camera_error':   return <Camera className="w-5 h-5 text-orange-400" />;
    case 'config_missing': return <Settings className="w-5 h-5 text-yellow-400" />;
    default:               return <AlertTriangle className="w-5 h-5 text-yellow-400" />;
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────────

export function AlertsInbox() {
  const { selectedVenueId, venues } = useAdminVenue();

  const [alerts, setAlerts] = useState<AdminAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterTab, setFilterTab] = useState<FilterTab>('all');
  const [reviewed, setReviewed] = useState<Set<string>>(loadReviewed);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminService.listAlerts(selectedVenueId ?? undefined);
      setAlerts(data);
    } catch (err) {
      console.error('Failed to fetch alerts:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedVenueId]);

  useEffect(() => { fetchAlerts(); }, [fetchAlerts]);

  const filtered = alerts.filter(a => {
    if (filterTab !== 'all' && a.type !== filterTab) return false;
    return true;
  });

  const unreviewed = filtered.filter(a => !reviewed.has(a.id));
  const reviewedItems = filtered.filter(a => reviewed.has(a.id));

  const markAllReviewed = () => {
    const next = new Set(reviewed);
    filtered.forEach(a => next.add(a.id));
    setReviewed(next);
    saveReviewed(next);
  };

  const markReviewed = (id: string) => {
    const next = new Set(reviewed);
    next.add(id);
    setReviewed(next);
    saveReviewed(next);
  };

  const copyJobId = (jobId: string) => {
    navigator.clipboard.writeText(jobId).then(() => {
      setCopiedId(jobId);
      setTimeout(() => setCopiedId(null), 1500);
    });
  };

  const venueName = (venueId: string) =>
    venues.find(v => v.venueId === venueId)?.venueName ?? venueId;

  return (
    <div className="min-h-screen p-4 md:p-6 lg:p-8">
      {/* Header */}
      <motion.div
        className="flex flex-wrap items-center justify-between gap-4 mb-6"
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Bell className="w-8 h-8 text-amber-400" />
            Alerts Inbox
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            {loading ? 'Loading...' : `${alerts.length} alert${alerts.length !== 1 ? 's' : ''} total`}
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <VenueSelector />

          {unreviewed.length > 0 && (
            <button
              onClick={markAllReviewed}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 text-sm hover:bg-green-500/20 transition-colors"
            >
              <CheckCircle className="w-4 h-4" />
              Mark all reviewed
            </button>
          )}

          <button
            onClick={fetchAlerts}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 text-sm transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </motion.div>

      {/* Filter Tabs */}
      <div className="flex gap-1 mb-6 overflow-x-auto pb-1">
        {FILTER_TABS.map(tab => {
          const count = alerts.filter(a => tab.id === 'all' || a.type === tab.id).length;
          return (
            <button
              key={tab.id}
              onClick={() => setFilterTab(tab.id)}
              className={`
                flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all
                ${filterTab === tab.id
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'}
              `}
            >
              {tab.label}
              {count > 0 && (
                <span className={`px-1.5 py-0.5 rounded-full text-xs ${
                  filterTab === tab.id ? 'bg-amber-500/30 text-amber-200' : 'bg-white/10 text-gray-400'
                }`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="w-8 h-8 text-amber-400 animate-spin" />
        </div>
      )}

      {/* Empty State */}
      {!loading && filtered.length === 0 && (
        <motion.div
          className="glass-card p-16 text-center"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
        >
          <BellOff className="w-14 h-14 mx-auto mb-4 text-gray-600" />
          <h3 className="text-xl font-bold text-white mb-2">No alerts</h3>
          <p className="text-gray-400">
            {filterTab === 'all'
              ? 'No alerts found for the selected venue filter.'
              : `No ${FILTER_TABS.find(t => t.id === filterTab)?.label.toLowerCase()} alerts.`}
          </p>
        </motion.div>
      )}

      {/* Unreviewed Alerts */}
      {!loading && unreviewed.length > 0 && (
        <motion.div className="mb-8" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            Unreviewed ({unreviewed.length})
          </h2>
          <div className="space-y-3">
            <AnimatePresence>
              {unreviewed.map(alert => (
                <AlertCard
                  key={alert.id}
                  alert={alert}
                  venueName={venueName(alert.venueId)}
                  onMarkReviewed={() => markReviewed(alert.id)}
                  onCopyJobId={alert.jobId ? () => copyJobId(alert.jobId!) : undefined}
                  copied={copiedId === alert.jobId}
                  isReviewed={false}
                />
              ))}
            </AnimatePresence>
          </div>
        </motion.div>
      )}

      {/* Reviewed Alerts */}
      {!loading && reviewedItems.length > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
            <CheckCircle className="w-4 h-4" />
            Reviewed ({reviewedItems.length})
          </h2>
          <div className="space-y-2 opacity-60">
            {reviewedItems.map(alert => (
              <AlertCard
                key={alert.id}
                alert={alert}
                venueName={venueName(alert.venueId)}
                onMarkReviewed={() => {}}
                copied={false}
                isReviewed={true}
              />
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}

// ─── Alert Card ─────────────────────────────────────────────────────────────────

interface AlertCardProps {
  alert: AdminAlert;
  venueName: string;
  onMarkReviewed: () => void;
  onCopyJobId?: () => void;
  copied: boolean;
  isReviewed: boolean;
}

function AlertCard({ alert, venueName, onMarkReviewed, onCopyJobId, copied, isReviewed }: AlertCardProps) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      className={`rounded-xl border p-4 flex items-start gap-4 ${severityStyle(alert.severity)}`}
    >
      <div className="mt-0.5 flex-shrink-0">{alertIcon(alert.type)}</div>

      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <span className="font-semibold text-white">{alert.title}</span>
          {severityBadge(alert.severity)}
        </div>
        <p className="text-sm text-gray-300 mb-2">{alert.detail}</p>
        <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
          <span>{venueName}</span>
          <span>•</span>
          <span>{timeAgo(alert.timestamp)}</span>
          {alert.jobId && (
            <>
              <span>•</span>
              <span className="font-mono text-gray-600">Job: {alert.jobId.slice(0, 12)}…</span>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {alert.jobId && onCopyJobId && (
          <button
            onClick={onCopyJobId}
            className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
            title="Copy job ID"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        )}
        {!isReviewed && (
          <button
            onClick={onMarkReviewed}
            className="p-1.5 rounded-lg hover:bg-green-500/20 text-gray-400 hover:text-green-400 transition-colors"
            title="Mark as reviewed"
          >
            <CheckCircle className="w-4 h-4" />
          </button>
        )}
      </div>
    </motion.div>
  );
}

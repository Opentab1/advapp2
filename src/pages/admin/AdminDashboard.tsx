/**
 * AdminDashboard — VenueScope admin portal main dashboard
 *
 * Shows real data from REST API:
 *  - Top stats row: Total Venues, Active Cameras, Drinks Today, Theft Alerts Today
 *  - Venue health grid (one card per venue)
 *  - Recent alerts preview
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Building2,
  Camera,
  GlassWater,
  AlertTriangle,
  RefreshCw,
  CheckCircle,
  ChevronRight,
  Activity,
  ShieldAlert,
} from 'lucide-react';
import adminService, { AdminVenue, AdminJob, AdminAlert, AdminStats } from '../../services/admin.service';
import { useAdminVenue } from '../../contexts/AdminVenueContext';

// ─── Skeleton ──────────────────────────────────────────────────────────────────
function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-white/5 ${className}`} />;
}

// ─── Stat Card ─────────────────────────────────────────────────────────────────
interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  color: string;
  loading: boolean;
}

function StatCard({ icon, label, value, sub, color, loading }: StatCardProps) {
  return (
    <motion.div
      className="glass-card p-6 flex flex-col gap-3"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color}`}>
        {icon}
      </div>
      {loading ? (
        <>
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-4 w-24" />
        </>
      ) : (
        <>
          <div className="text-3xl font-bold text-white">{value}</div>
          <div className="text-sm text-gray-400">{label}</div>
          {sub && <div className="text-xs text-gray-500">{sub}</div>}
        </>
      )}
    </motion.div>
  );
}

// ─── Venue Health Card ─────────────────────────────────────────────────────────
function venueStatusColor(venue: AdminVenue, lastJobTs: number | null): string {
  if (venue.status === 'suspended') return 'border-red-500/40 bg-red-500/5';
  if (!lastJobTs) return 'border-yellow-500/30 bg-yellow-500/5';
  const hoursAgo = (Date.now() - lastJobTs * 1000) / 3600000;
  if (hoursAgo < 2) return 'border-green-500/40 bg-green-500/5';
  if (hoursAgo < 8) return 'border-yellow-500/30 bg-yellow-500/5';
  return 'border-red-500/30 bg-red-500/5';
}

function statusDot(venue: AdminVenue, lastJobTs: number | null) {
  if (venue.status === 'suspended') return <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" />;
  if (!lastJobTs) return <span className="w-2.5 h-2.5 rounded-full bg-yellow-400 inline-block" />;
  const hoursAgo = (Date.now() - lastJobTs * 1000) / 3600000;
  if (hoursAgo < 2) return <span className="w-2.5 h-2.5 rounded-full bg-green-400 animate-pulse inline-block" />;
  if (hoursAgo < 8) return <span className="w-2.5 h-2.5 rounded-full bg-yellow-400 inline-block" />;
  return <span className="w-2.5 h-2.5 rounded-full bg-red-400 inline-block" />;
}

function timeAgo(ts: number | null): string {
  if (!ts) return 'Never';
  const secs = Math.floor((Date.now() - ts * 1000) / 1000);
  if (secs < 60) return 'Just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

// ─── Alert Row ─────────────────────────────────────────────────────────────────
function alertSeverityStyle(severity: AdminAlert['severity']) {
  switch (severity) {
    case 'high':   return 'border-red-500/40 bg-red-500/10 text-red-300';
    case 'medium': return 'border-orange-500/30 bg-orange-500/10 text-orange-300';
    default:       return 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300';
  }
}

function alertIcon(type: AdminAlert['type']) {
  switch (type) {
    case 'theft':          return <ShieldAlert className="w-4 h-4" />;
    case 'camera_error':   return <Camera className="w-4 h-4" />;
    case 'config_missing': return <AlertTriangle className="w-4 h-4" />;
    default:               return <AlertTriangle className="w-4 h-4" />;
  }
}

// ─── Main Component ────────────────────────────────────────────────────────────
export function AdminDashboard() {
  const { venues, loadingVenues, setSelectedVenueId } = useAdminVenue();

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [jobs, setJobs] = useState<AdminJob[]>([]);
  const [alerts, setAlerts] = useState<AdminAlert[]>([]);
  const [loadingStats, setLoadingStats] = useState(true);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [loadingAlerts, setLoadingAlerts] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAll = useCallback(async () => {
    setLoadingStats(true);
    setLoadingJobs(true);
    setLoadingAlerts(true);

    const [statsData, jobsData, alertsData] = await Promise.allSettled([
      adminService.getStats(),
      adminService.listJobs(undefined, 100),
      adminService.listAlerts(),
    ]);

    if (statsData.status === 'fulfilled') setStats(statsData.value);
    setLoadingStats(false);

    if (jobsData.status === 'fulfilled') setJobs(jobsData.value);
    setLoadingJobs(false);

    if (alertsData.status === 'fulfilled') setAlerts(alertsData.value);
    setLoadingAlerts(false);
  }, []);

  useEffect(() => {
    fetchAll();
    intervalRef.current = setInterval(fetchAll, 60000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchAll]);

  // Derive today's stats from jobs
  const now = Date.now();
  const dayAgo = now - 86400000;

  const jobsToday = jobs.filter(j => j.createdAt * 1000 > dayAgo);
  const drinksToday = stats?.drinksToday ?? jobsToday.reduce((a, j) => a + (j.totalDrinks || 0), 0);
  const theftToday = stats?.theftAlertsToday ?? alerts.filter(a => a.type === 'theft' && a.timestamp * 1000 > dayAgo).length;
  const activeCameras = stats?.activeCameras ?? 0;
  const totalVenues = stats?.totalVenues ?? venues.length;

  // Map latest job per venue
  const latestJobByVenue: Record<string, AdminJob> = {};
  for (const job of jobs) {
    const existing = latestJobByVenue[job.venueId];
    if (!existing || job.createdAt > existing.createdAt) {
      latestJobByVenue[job.venueId] = job;
    }
  }

  // Today's drinks per venue
  const drinksTodayByVenue: Record<string, number> = {};
  for (const job of jobsToday) {
    drinksTodayByVenue[job.venueId] = (drinksTodayByVenue[job.venueId] || 0) + (job.totalDrinks || 0);
  }

  const recentAlerts = alerts.slice(0, 5);
  const isLoading = loadingVenues && loadingStats;

  return (
    <div className="min-h-screen p-4 md:p-6 lg:p-8">
      {/* Header */}
      <motion.div
        className="flex items-center justify-between mb-8"
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div>
          <h1 className="text-3xl font-bold text-white mb-1">Dashboard</h1>
          <p className="text-gray-400 text-sm">VenueScope operations overview</p>
        </div>
        <button
          onClick={fetchAll}
          disabled={isLoading}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 text-sm transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </motion.div>

      {/* Top Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          icon={<Building2 className="w-5 h-5 text-purple-300" />}
          label="Total Venues"
          value={totalVenues}
          sub={`${stats?.activeVenues ?? venues.filter(v => v.status === 'active').length} active`}
          color="bg-purple-500/20"
          loading={loadingStats}
        />
        <StatCard
          icon={<Camera className="w-5 h-5 text-amber-300" />}
          label="Active Cameras"
          value={activeCameras}
          color="bg-amber-500/20"
          loading={loadingStats}
        />
        <StatCard
          icon={<GlassWater className="w-5 h-5 text-cyan-300" />}
          label="Drinks Today"
          value={drinksToday}
          sub="across all venues"
          color="bg-cyan-500/20"
          loading={loadingStats || loadingJobs}
        />
        <StatCard
          icon={<AlertTriangle className="w-5 h-5 text-red-300" />}
          label="Theft Alerts Today"
          value={theftToday}
          sub={theftToday === 0 ? 'All clear' : 'Needs review'}
          color="bg-red-500/20"
          loading={loadingAlerts}
        />
      </div>

      {/* Venue Health Grid */}
      <motion.div
        className="mb-8"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
      >
        <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <Activity className="w-5 h-5 text-amber-400" />
          Venue Health
        </h2>

        {loadingVenues ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-36" />)}
          </div>
        ) : venues.length === 0 ? (
          <div className="glass-card p-8 text-center text-gray-400">
            <Building2 className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p>No venues found. Create your first venue to get started.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {venues.map(venue => {
              const latestJob = latestJobByVenue[venue.venueId] ?? null;
              const lastJobTs = latestJob?.createdAt ?? null;
              const todayDrinks = drinksTodayByVenue[venue.venueId] ?? 0;
              const borderBg = venueStatusColor(venue, lastJobTs);

              return (
                <motion.button
                  key={venue.venueId}
                  onClick={() => setSelectedVenueId(venue.venueId)}
                  className={`glass-card p-5 border text-left w-full transition-all hover:scale-[1.02] ${borderBg}`}
                  whileTap={{ scale: 0.98 }}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      {statusDot(venue, lastJobTs)}
                      <span className="font-semibold text-white truncate">{venue.venueName || venue.venueId}</span>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      venue.status === 'active'
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-red-500/20 text-red-400'
                    }`}>
                      {venue.status}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <div className="text-xl font-bold text-white">{todayDrinks}</div>
                      <div className="text-xs text-gray-500">Drinks Today</div>
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-white">{timeAgo(lastJobTs)}</div>
                      <div className="text-xs text-gray-500">Last Job</div>
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-white">{venue.deviceCount ?? 0}</div>
                      <div className="text-xs text-gray-500">Cameras</div>
                    </div>
                  </div>
                </motion.button>
              );
            })}
          </div>
        )}
      </motion.div>

      {/* Recent Alerts */}
      <motion.div
        className="glass-card p-6"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-red-400" />
            Recent Alerts
          </h2>
          <button
            className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1"
            onClick={() => { /* Parent will handle tab switch via onTabChange */ }}
          >
            View All <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {loadingAlerts ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-14" />)}
          </div>
        ) : recentAlerts.length === 0 ? (
          <div className="py-10 text-center">
            <CheckCircle className="w-10 h-10 mx-auto mb-3 text-green-400" />
            <p className="text-green-400 font-medium">No recent alerts</p>
            <p className="text-sm text-gray-500 mt-1">All venues are operating normally</p>
          </div>
        ) : (
          <div className="space-y-2">
            {recentAlerts.map(alert => (
              <div
                key={alert.id}
                className={`flex items-start gap-3 p-3 rounded-lg border ${alertSeverityStyle(alert.severity)}`}
              >
                <div className="mt-0.5">{alertIcon(alert.type)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm truncate">{alert.title}</span>
                    <span className="text-xs opacity-60 whitespace-nowrap">
                      {timeAgo(alert.timestamp)}
                    </span>
                  </div>
                  <p className="text-xs opacity-75 mt-0.5 truncate">{alert.detail}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
}

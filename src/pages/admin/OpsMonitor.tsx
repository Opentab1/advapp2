/**
 * OpsMonitor — Live operations monitor across all venues
 *
 * Auto-refreshes every 30 seconds. Combines venue, job, and camera data
 * to show a real-time status table for operations staff.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Activity,
  RefreshCw,
  Camera,
  Clock,
  AlertTriangle,
  ChevronRight,
} from 'lucide-react';
import adminService, { AdminVenue, AdminJob, AdminCamera } from '../../services/admin.service';
import { useAdminVenue } from '../../contexts/AdminVenueContext';
import { VenueSelector } from '../../components/admin/VenueSelector';

// ─── Helpers ────────────────────────────────────────────────────────────────────

function timeAgo(ts: number | null): string {
  if (!ts) return 'Never';
  const secs = Math.floor((Date.now() - ts * 1000) / 1000);
  if (secs < 60) return 'Just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

type VenueHealth = 'green' | 'yellow' | 'red';

function venueHealth(venue: AdminVenue, lastJobTs: number | null): VenueHealth {
  if (venue.status === 'suspended') return 'red';
  if (!lastJobTs) return 'red';
  const hoursAgo = (Date.now() - lastJobTs * 1000) / 3600000;
  if (hoursAgo < 2) return 'green';
  if (hoursAgo < 8) return 'yellow';
  return 'red';
}

function HealthDot({ health }: { health: VenueHealth }) {
  const classes: Record<VenueHealth, string> = {
    green:  'bg-green-400 animate-pulse',
    yellow: 'bg-yellow-400',
    red:    'bg-red-500',
  };
  return <span className={`w-2.5 h-2.5 rounded-full inline-block ${classes[health]}`} />;
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-white/5 ${className}`} />;
}

// ─── Row Data ────────────────────────────────────────────────────────────────────

interface VenueRow {
  venue: AdminVenue;
  drinksToday: number;
  drinksLastHour: number;
  lastDetectionTs: number | null;
  camerasActive: number;
  camerasTotal: number;
  health: VenueHealth;
}

// ─── Main ───────────────────────────────────────────────────────────────────────

export function OpsMonitor() {
  const { venues, loadingVenues, selectedVenueId } = useAdminVenue();

  const [jobs, setJobs] = useState<AdminJob[]>([]);
  const [cameras, setCameras] = useState<AdminCamera[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [loadingCameras, setLoadingCameras] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState(30);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    setLoadingJobs(true);
    setLoadingCameras(true);
    setCountdown(30);

    const [jobsResult, camerasResult] = await Promise.allSettled([
      adminService.listJobs(undefined, 200),
      adminService.listCameras(undefined),
    ]);

    if (jobsResult.status === 'fulfilled') setJobs(jobsResult.value);
    setLoadingJobs(false);

    if (camerasResult.status === 'fulfilled') setCameras(camerasResult.value);
    setLoadingCameras(false);

    setLastUpdated(new Date());
  }, []);

  useEffect(() => {
    fetchData();

    intervalRef.current = setInterval(() => {
      fetchData();
    }, 30000);

    countdownRef.current = setInterval(() => {
      setCountdown(c => (c <= 1 ? 30 : c - 1));
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [fetchData]);

  // Build per-venue row data
  const now = Date.now();
  const dayAgo  = now - 86400000;
  const hourAgo = now - 3600000;

  const displayVenues = selectedVenueId
    ? venues.filter(v => v.venueId === selectedVenueId)
    : venues;

  const rows: VenueRow[] = displayVenues.map(venue => {
    const venueJobs = jobs.filter(j => j.venueId === venue.venueId);
    const jobsToday = venueJobs.filter(j => j.createdAt * 1000 > dayAgo);
    const jobsLastHour = venueJobs.filter(j => j.createdAt * 1000 > hourAgo);
    const latestJob = venueJobs.reduce<AdminJob | null>((best, j) => {
      if (!best || j.createdAt > best.createdAt) return j;
      return best;
    }, null);

    const venueCameras = cameras.filter(c => c.venueId === venue.venueId);
    const activeCameras = venueCameras.filter(c => c.enabled).length;

    return {
      venue,
      drinksToday:    jobsToday.reduce((a, j) => a + (j.totalDrinks || 0), 0),
      drinksLastHour: jobsLastHour.reduce((a, j) => a + (j.totalDrinks || 0), 0),
      lastDetectionTs: latestJob?.createdAt ?? null,
      camerasActive: activeCameras,
      camerasTotal:  venueCameras.length,
      health: venueHealth(venue, latestJob?.createdAt ?? null),
    };
  });

  // Warning: venues not detected in >4h during business hours (after 4pm local)
  const localHour = new Date().getHours();
  const isBusinessHours = localHour >= 16;
  const staleVenues = rows.filter(r => {
    if (!isBusinessHours) return false;
    if (r.venue.status === 'suspended') return false;
    if (!r.lastDetectionTs) return true;
    return (now - r.lastDetectionTs * 1000) > 4 * 3600000;
  });

  const isLoading = loadingVenues || loadingJobs;

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
            <Activity className="w-8 h-8 text-amber-400" />
            Live Operations
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Real-time venue monitoring across all locations
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <VenueSelector />

          {lastUpdated && (
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Clock className="w-3.5 h-3.5" />
              <span>Updated {lastUpdated.toLocaleTimeString()}</span>
              <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                Refresh in {countdown}s
              </span>
            </div>
          )}

          <button
            onClick={fetchData}
            disabled={isLoading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 text-sm transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </motion.div>

      {/* Warning Banner */}
      {staleVenues.length > 0 && (
        <motion.div
          className="mb-6 p-4 rounded-xl border border-orange-500/40 bg-orange-500/10 flex items-start gap-3"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <AlertTriangle className="w-5 h-5 text-orange-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-orange-300 font-semibold text-sm">
              {staleVenues.length} venue{staleVenues.length > 1 ? 's have' : ' has'} not detected activity in {'>'} 4 hours during business hours
            </p>
            <p className="text-orange-400/70 text-xs mt-1">
              Affected: {staleVenues.map(r => r.venue.venueName || r.venue.venueId).join(', ')}
            </p>
          </div>
        </motion.div>
      )}

      {/* Table */}
      <motion.div
        className="glass-card overflow-hidden"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-gray-400 text-xs uppercase tracking-wider">
                <th className="text-left px-5 py-4">Venue</th>
                <th className="text-left px-4 py-4">Status</th>
                <th className="text-right px-4 py-4">Drinks Today</th>
                <th className="text-right px-4 py-4">Last Hour</th>
                <th className="text-left px-4 py-4">Last Detection</th>
                <th className="text-left px-4 py-4">Cameras</th>
                <th className="px-4 py-4" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-4 py-4">
                        <Skeleton className="h-5" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-gray-400">
                    <Activity className="w-8 h-8 mx-auto mb-3 opacity-40" />
                    <p>No venues to display</p>
                  </td>
                </tr>
              ) : (
                rows.map((row, idx) => (
                  <motion.tr
                    key={row.venue.venueId}
                    className="hover:bg-white/3 transition-colors group"
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.04 }}
                  >
                    {/* Venue */}
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <HealthDot health={row.health} />
                        <div>
                          <div className="font-medium text-white">
                            {row.venue.venueName || row.venue.venueId}
                          </div>
                          <div className="text-xs text-gray-500">{row.venue.venueId}</div>
                        </div>
                      </div>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-4">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        row.venue.status === 'active'
                          ? 'bg-green-500/20 text-green-400'
                          : 'bg-red-500/20 text-red-400'
                      }`}>
                        {row.venue.status}
                      </span>
                    </td>

                    {/* Drinks Today */}
                    <td className="px-4 py-4 text-right">
                      <span className="font-semibold text-white">{row.drinksToday}</span>
                    </td>

                    {/* Last Hour */}
                    <td className="px-4 py-4 text-right">
                      <span className={row.drinksLastHour > 0 ? 'text-cyan-400 font-semibold' : 'text-gray-500'}>
                        {row.drinksLastHour}
                      </span>
                    </td>

                    {/* Last Detection */}
                    <td className="px-4 py-4">
                      <span className={
                        row.health === 'green' ? 'text-green-400' :
                        row.health === 'yellow' ? 'text-yellow-400' : 'text-red-400'
                      }>
                        {timeAgo(row.lastDetectionTs)}
                      </span>
                    </td>

                    {/* Cameras */}
                    <td className="px-4 py-4">
                      {loadingCameras ? (
                        <Skeleton className="h-4 w-12" />
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <Camera className="w-3.5 h-3.5 text-gray-500" />
                          <span className={row.camerasActive > 0 ? 'text-white' : 'text-gray-500'}>
                            {row.camerasActive}/{row.camerasTotal}
                          </span>
                        </div>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-4">
                      <button className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300">
                        View Jobs <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </motion.div>

      {/* Summary Footer */}
      {!isLoading && rows.length > 0 && (
        <motion.div
          className="mt-4 flex flex-wrap gap-4 text-xs text-gray-500"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-green-400" />
            Active ({'<'}2h): {rows.filter(r => r.health === 'green').length}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-yellow-400" />
            Idle (2–8h): {rows.filter(r => r.health === 'yellow').length}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-red-400" />
            Stale ({'>'} 8h or suspended): {rows.filter(r => r.health === 'red').length}
          </span>
          <span className="ml-auto">
            {rows.reduce((a, r) => a + r.drinksToday, 0)} total drinks today across all venues
          </span>
        </motion.div>
      )}
    </div>
  );
}

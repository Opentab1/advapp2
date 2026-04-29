/**
 * VenueDetail — single venue dashboard with internal tabs.
 *
 * The One Place for everything we know about a venue. Tabs:
 *   Overview · Cameras · Ops · Accuracy · Jobs
 *
 * Each tab renders the same content the standalone admin page used to
 * show, but scoped to this venue. The sidebar no longer surfaces
 * Cameras / Ops Monitor / Accuracy SLA as standalone items — they live
 * inside the venue page now. Standalone implementations are still
 * reachable via direct routes if anything links there, just not from
 * the sidebar.
 *
 * VenueDetail sets `selectedVenueId` in AdminVenueContext on mount so
 * embedded OpsMonitor + AccuracySLA auto-filter to this venue.
 */

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowLeft, Building2, MapPin, User, Mail, Camera as CameraIcon,
  Activity, Clock, CheckCircle2, XCircle, AlertTriangle, RefreshCw,
  LayoutDashboard, Target, Briefcase,
} from 'lucide-react';
import adminService, {
  AdminVenue, AdminCamera, AdminJob,
} from '../../services/admin.service';
import { DropletPanel } from '../../components/admin/DropletPanel';
import { useAdminVenue } from '../../contexts/AdminVenueContext';
import venueSettingsService from '../../services/venue-settings.service';
import { isVenueOpenNow, nextOpenLabel, type V2BusinessHours }
  from '../../utils/venueHours';
import { VenueCameraSection } from './CamerasManagement';
import { OpsMonitor }   from './OpsMonitor';
import { AccuracySLA }  from './AccuracySLA';

interface VenueDetailProps {
  venue: AdminVenue;
  displayName?: string;
  onBack: () => void;
}

type TabId = 'overview' | 'cameras' | 'ops' | 'accuracy' | 'jobs';

const TABS: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'overview', label: 'Overview',  icon: LayoutDashboard },
  { id: 'cameras',  label: 'Cameras',   icon: CameraIcon      },
  { id: 'ops',      label: 'Ops',       icon: Activity        },
  { id: 'accuracy', label: 'Accuracy',  icon: Target          },
  { id: 'jobs',     label: 'Jobs',      icon: Briefcase       },
];

export function VenueDetail({ venue, displayName, onBack }: VenueDetailProps) {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const { setSelectedVenueId } = useAdminVenue();

  // Pin the admin venue context to this venue while the detail page is open.
  // Embedded OpsMonitor + AccuracySLA read selectedVenueId via useAdminVenue
  // and auto-scope. Restore on unmount so the standalone pages aren't stuck
  // filtered if the user navigates back to one via an old link.
  useEffect(() => {
    setSelectedVenueId(venue.venueId);
    // Don't clear on unmount — users coming back here should keep their
    // last venue selected. Setting null on unmount would break VenueSelector
    // continuity in standalone pages.
  }, [venue.venueId, setSelectedVenueId]);

  // ── Overview-tab data ──────────────────────────────────────────────────
  const [cameras, setCameras] = useState<AdminCamera[]>([]);
  const [jobs, setJobs]       = useState<AdminJob[]>([]);
  const [hours, setHours]     = useState<V2BusinessHours | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const refreshOverview = async () => {
    setLoading(true);
    setError(null);
    try {
      const [cams, recentJobs] = await Promise.all([
        adminService.listCameras(venue.venueId),
        adminService.listJobs(venue.venueId, 10),
      ]);
      setCameras(cams);
      setJobs(recentJobs);
      try {
        const cloud = await venueSettingsService.loadSettingsFromCloud(venue.venueId);
        const bh = cloud?.businessHours as V2BusinessHours | undefined;
        setHours(bh && bh.days ? bh : null);
      } catch { setHours(null); }
    } catch (e: any) {
      setError(e?.message || 'Failed to load venue overview');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refreshOverview(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [venue.venueId]);

  // Computed header signals — same on every tab so the user always knows
  // they're on the right venue.
  const enabledCameras = cameras.filter(c => c.enabled).length;
  const recalNeeded    = cameras.filter(c => c.needsRecalibration).length;
  const venueIsOpen    = isVenueOpenNow(hours ?? null);
  const nextOpen       = !venueIsOpen ? nextOpenLabel(hours ?? null) : null;
  const todayDrinks    = jobs
    .filter(j => isToday(j.createdAt))
    .reduce((s, j) => s + (j.totalDrinks ?? 0), 0);
  const liveJobs       = jobs.filter(j => j.status === 'running' || j.isLive).length;
  const theftFlags     = jobs.filter(j => j.hasTheftFlag).length;

  return (
    <div className="min-h-screen p-4 md:p-6 lg:p-8">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        {/* ── Header ── */}
        <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className="btn-secondary flex items-center gap-2"
              title="Back to venues list"
            >
              <ArrowLeft className="w-4 h-4" /> All Venues
            </button>
            <div>
              <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                <Building2 className="w-7 h-7 text-purple-400" />
                {displayName || venue.venueName}
              </h1>
              <div className="text-sm text-gray-400 mt-1 flex items-center gap-3 flex-wrap">
                <span>ID: <span className="text-purple-400 font-mono">{venue.venueId}</span></span>
                <StatusPill status={venue.status} />
                <span className="text-gray-500">Plan: {venue.plan || 'unknown'}</span>
              </div>
            </div>
          </div>
          {activeTab === 'overview' && (
            <button
              onClick={refreshOverview}
              disabled={loading}
              className="btn-secondary flex items-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          )}
        </div>

        {/* ── Tab nav ── */}
        <div className="flex gap-2 mb-6 flex-wrap border-b border-white/5">
          {TABS.map(t => {
            const Icon = t.icon;
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`flex items-center gap-2 px-4 py-2 -mb-px text-sm font-medium transition-colors border-b-2 ${
                  active
                    ? 'text-purple-300 border-purple-400'
                    : 'text-gray-400 border-transparent hover:text-white hover:border-white/20'
                }`}
              >
                <Icon className="w-4 h-4" />
                {t.label}
              </button>
            );
          })}
        </div>

        {error && activeTab === 'overview' && (
          <div className="mb-6 p-4 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* ── Tab contents ── */}
        {activeTab === 'overview' && (
          <OverviewTab
            venue={venue}
            cameras={cameras}
            jobs={jobs}
            hours={hours}
            stats={{
              enabledCameras, totalCameras: cameras.length, recalNeeded,
              venueIsOpen, nextOpen, todayDrinks, liveJobs, theftFlags,
            }}
          />
        )}

        {activeTab === 'cameras' && (
          <div className="-mx-2">
            <VenueCameraSection venueId={venue.venueId} venueName={venue.venueName} />
          </div>
        )}

        {activeTab === 'ops' && (
          <div className="-m-4 md:-m-6 lg:-m-8">
            {/* Embedded OpsMonitor inherits selectedVenueId from context.
                The `embedded` flag hides its built-in venue selector since
                we already know which venue we're on. */}
            <OpsMonitor embedded />
          </div>
        )}

        {activeTab === 'accuracy' && (
          <div className="-m-4 md:-m-6 lg:-m-8">
            <AccuracySLA embedded />
          </div>
        )}

        {activeTab === 'jobs' && (
          <JobsTab venueId={venue.venueId} />
        )}
      </motion.div>
    </div>
  );
}

// ─── Overview Tab ────────────────────────────────────────────────────────

function OverviewTab({
  venue, cameras, jobs, hours, stats,
}: {
  venue: AdminVenue;
  cameras: AdminCamera[];
  jobs: AdminJob[];
  hours: V2BusinessHours | null;
  stats: {
    enabledCameras: number; totalCameras: number; recalNeeded: number;
    venueIsOpen: boolean; nextOpen: string | null;
    todayDrinks: number; liveJobs: number; theftFlags: number;
  };
}) {
  return (
    <>
      {/* At-a-glance tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <StatTile
          label="Cameras"
          value={`${stats.enabledCameras}/${stats.totalCameras}`}
          sub={stats.recalNeeded > 0 ? `${stats.recalNeeded} need recal` : 'all healthy'}
          tone={stats.recalNeeded > 0 ? 'warn' : 'ok'}
          icon={<CameraIcon className="w-4 h-4" />}
        />
        <StatTile
          label="Status now"
          value={stats.venueIsOpen ? 'Open' : 'Closed'}
          sub={stats.venueIsOpen ? 'worker active' : (stats.nextOpen ? `opens ${stats.nextOpen}` : 'no schedule set')}
          tone={stats.venueIsOpen ? 'ok' : 'muted'}
          icon={<Clock className="w-4 h-4" />}
        />
        <StatTile
          label="Today's drinks"
          value={stats.todayDrinks > 0 ? `${stats.todayDrinks}` : '—'}
          sub={stats.liveJobs > 0 ? `${stats.liveJobs} live job${stats.liveJobs !== 1 ? 's' : ''}` : 'no live jobs'}
          tone="ok"
          icon={<Activity className="w-4 h-4" />}
        />
        <StatTile
          label="Theft flags"
          value={`${stats.theftFlags}`}
          sub={`across ${jobs.length} recent job${jobs.length !== 1 ? 's' : ''}`}
          tone={stats.theftFlags > 0 ? 'warn' : 'ok'}
          icon={<AlertTriangle className="w-4 h-4" />}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: profile / droplet / hours */}
        <div className="lg:col-span-1 space-y-6">
          <Section title="Profile">
            <ProfileRow icon={<User className="w-3.5 h-3.5" />} label="Owner"
              value={venue.ownerName || venue.ownerEmail || '—'} />
            <ProfileRow icon={<Mail className="w-3.5 h-3.5" />} label="Email"
              value={venue.ownerEmail || '—'} />
            <ProfileRow icon={<MapPin className="w-3.5 h-3.5" />} label="Location"
              value={venue.locationName || venue.locationId || '—'} />
            <ProfileRow icon={<Building2 className="w-3.5 h-3.5" />} label="Capacity"
              value={venue.capacity ? `${venue.capacity} guests` : '—'} />
            <ProfileRow icon={<Activity className="w-3.5 h-3.5" />} label="Tier"
              value={venue.venueTier ? prettyTier(venue.venueTier) : '—'} />
          </Section>

          <Section title="Worker Droplet">
            <DropletPanel venueId={venue.venueId} venueName={venue.venueName} />
          </Section>

          <Section title="Business Hours">
            {hours ? <HoursTable hours={hours} /> : (
              <p className="text-sm text-gray-500">
                No schedule saved. The worker defaults to always-on for venues without a schedule.
                Hours are configured by the venue owner in <span className="text-gray-300">Settings → Business Hours</span>.
              </p>
            )}
          </Section>
        </div>

        {/* Right: cameras summary + recent jobs */}
        <div className="lg:col-span-2 space-y-6">
          <Section title={`Cameras (${cameras.length})`}>
            {cameras.length === 0 ? (
              <p className="text-sm text-gray-500">
                No cameras registered yet. Add cameras from the Cameras tab above.
              </p>
            ) : (
              <div className="space-y-2">
                {cameras.map(cam => <CameraRow key={cam.cameraId} cam={cam} />)}
              </div>
            )}
          </Section>

          <Section title="Recent Jobs (last 10)">
            {jobs.length === 0 ? (
              <p className="text-sm text-gray-500">No jobs yet for this venue.</p>
            ) : (
              <div className="space-y-2">
                {jobs.map(job => <JobRow key={job.jobId} job={job} />)}
              </div>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}

// ─── Jobs Tab — paginated full job list ──────────────────────────────────

function JobsTab({ venueId }: { venueId: string }) {
  const [jobs, setJobs] = useState<AdminJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(50);

  const refresh = async () => {
    setLoading(true);
    try {
      const data = await adminService.listJobs(venueId, limit);
      setJobs(data);
    } finally { setLoading(false); }
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [venueId, limit]);

  return (
    <Section
      title={`Jobs (${jobs.length}${jobs.length === limit ? `, capped at ${limit}` : ''})`}
      right={
        <div className="flex items-center gap-2">
          <select
            value={limit}
            onChange={e => setLimit(parseInt(e.target.value, 10))}
            className="text-xs bg-white/5 border border-white/10 rounded px-2 py-1 text-gray-300"
          >
            <option value={25}>Last 25</option>
            <option value={50}>Last 50</option>
            <option value={100}>Last 100</option>
            <option value={250}>Last 250</option>
          </select>
          <button onClick={refresh} disabled={loading} className="btn-secondary text-xs flex items-center gap-1">
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      }>
      {loading && jobs.length === 0 ? (
        <p className="text-sm text-gray-500">Loading jobs…</p>
      ) : jobs.length === 0 ? (
        <p className="text-sm text-gray-500">No jobs for this venue.</p>
      ) : (
        <div className="space-y-2">
          {jobs.map(j => <JobRow key={j.jobId} job={j} />)}
        </div>
      )}
    </Section>
  );
}

// ─── Subcomponents (shared across tabs) ──────────────────────────────────

function Section({ title, right, children }:
  { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400">{title}</h3>
        {right}
      </div>
      {children}
    </div>
  );
}

function StatTile({ label, value, sub, tone, icon }:
  { label: string; value: string; sub?: string;
    tone: 'ok' | 'warn' | 'muted'; icon?: React.ReactNode }) {
  const toneCls = tone === 'warn' ? 'text-amber-300'
                : tone === 'muted' ? 'text-gray-400'
                : 'text-emerald-300';
  return (
    <div className="glass-card p-4">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
        {icon}
        <span>{label}</span>
      </div>
      <div className={`text-2xl font-bold mt-1 ${toneCls}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function ProfileRow({ icon, label, value }:
  { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 text-sm py-1.5 border-b border-white/5 last:border-0">
      <span className="text-gray-500 mt-0.5">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
        <div className="text-gray-200 break-words">{value}</div>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
    active:    { label: 'Active',    cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
                 icon: <CheckCircle2 className="w-3 h-3" /> },
    suspended: { label: 'Suspended', cls: 'bg-red-500/15 text-red-300 border-red-500/30',
                 icon: <XCircle className="w-3 h-3" /> },
    inactive:  { label: 'Inactive',  cls: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
                 icon: <XCircle className="w-3 h-3" /> },
  };
  const b = map[status] || map.inactive;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold border ${b.cls}`}>
      {b.icon}{b.label}
    </span>
  );
}

function CameraRow({ cam }: { cam: AdminCamera }) {
  return (
    <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/5">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <CameraIcon className={`w-4 h-4 flex-shrink-0 ${cam.enabled ? 'text-emerald-400' : 'text-gray-600'}`} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-white truncate">{cam.name}</div>
          <div className="text-[11px] text-gray-500 flex items-center gap-2 flex-wrap">
            <span>{cam.modes || 'no modes'}</span>
            <span>·</span>
            <span>{cam.modelProfile}</span>
            {cam.needsRecalibration && (
              <>
                <span>·</span>
                <span className="text-amber-400 inline-flex items-center gap-0.5">
                  <AlertTriangle className="w-3 h-3" />needs recal
                </span>
              </>
            )}
          </div>
        </div>
      </div>
      <span className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
        cam.enabled
          ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'
          : 'bg-gray-500/10 text-gray-500 border border-gray-500/30'
      }`}>
        {cam.enabled ? 'ENABLED' : 'DISABLED'}
      </span>
    </div>
  );
}

function JobRow({ job }: { job: AdminJob }) {
  const created = new Date(job.createdAt * 1000);
  const tone = job.status === 'completed' ? 'text-emerald-300'
             : job.status === 'failed'    ? 'text-red-300'
             : job.status === 'running' || job.isLive ? 'text-amber-300'
             : 'text-gray-400';
  return (
    <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/5">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <span className={`text-[10px] uppercase tracking-wider font-semibold ${tone} w-16 flex-shrink-0`}>
          {job.isLive ? 'LIVE' : job.status}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm text-white truncate">
            {job.clipLabel || job.analysisMode}
          </div>
          <div className="text-[11px] text-gray-500">
            {created.toLocaleString()} · {job.analysisMode}
            {job.elapsedSec ? ` · ${Math.round(job.elapsedSec)}s` : ''}
          </div>
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        <div className="text-sm font-bold text-white">{job.totalDrinks ?? 0}</div>
        <div className="text-[10px] text-gray-500 uppercase tracking-wider">drinks</div>
        {job.hasTheftFlag && (
          <div className="text-[10px] text-red-400 inline-flex items-center gap-0.5 mt-0.5">
            <AlertTriangle className="w-2.5 h-2.5" />flag
          </div>
        )}
      </div>
    </div>
  );
}

function HoursTable({ hours }: { hours: V2BusinessHours }) {
  const days = [
    { key: 'mon', label: 'Mon' }, { key: 'tue', label: 'Tue' },
    { key: 'wed', label: 'Wed' }, { key: 'thu', label: 'Thu' },
    { key: 'fri', label: 'Fri' }, { key: 'sat', label: 'Sat' },
    { key: 'sun', label: 'Sun' },
  ];
  return (
    <div className="space-y-1.5 text-sm">
      <div className="text-[11px] text-gray-500 mb-2">Timezone: {hours.timezone}</div>
      {days.map(({ key, label }) => {
        const d = hours.days?.[key];
        const closed = !d || d.closed;
        return (
          <div key={key} className="flex items-center justify-between text-gray-300">
            <span className="text-gray-500 w-10">{label}</span>
            <span className="font-mono text-xs">
              {closed ? <span className="text-gray-600">closed</span> : `${d!.open} – ${d!.close}`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function isToday(unixSec: number): boolean {
  if (!unixSec) return false;
  const d = new Date(unixSec * 1000);
  const t = new Date();
  return d.getFullYear() === t.getFullYear()
      && d.getMonth() === t.getMonth()
      && d.getDate() === t.getDate();
}

function prettyTier(t: string): string {
  return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export default VenueDetail;

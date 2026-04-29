/**
 * VenueDetail — single venue dashboard.
 *
 * One screen that shows everything we know about a venue: profile, droplet
 * status, cameras, recent jobs. Reached by clicking a venue's name on the
 * Venues Management list. Replaces the prior pattern of bouncing between
 * the Venues, Cameras, and Ops Monitor tabs to piece this together.
 *
 * Edits (add/edit camera, deep ops) still live in their dedicated pages —
 * this page is the at-a-glance landing surface and links out for those.
 */

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowLeft, Building2, MapPin, User, Mail, Camera as CameraIcon,
  Activity, Clock, CheckCircle2, XCircle, AlertTriangle, RefreshCw,
  ExternalLink,
} from 'lucide-react';
import adminService, {
  AdminVenue, AdminCamera, AdminJob,
} from '../../services/admin.service';
import { DropletPanel } from '../../components/admin/DropletPanel';
import venueSettingsService from '../../services/venue-settings.service';
import { isVenueOpenNow, nextOpenLabel, type V2BusinessHours }
  from '../../utils/venueHours';

interface VenueDetailProps {
  venue: AdminVenue;
  displayName?: string;
  onBack: () => void;
}

export function VenueDetail({ venue, displayName, onBack }: VenueDetailProps) {
  const [cameras, setCameras] = useState<AdminCamera[]>([]);
  const [jobs, setJobs]       = useState<AdminJob[]>([]);
  const [hours, setHours]     = useState<V2BusinessHours | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const [cams, recentJobs] = await Promise.all([
        adminService.listCameras(venue.venueId),
        adminService.listJobs(venue.venueId, 10),
      ]);
      setCameras(cams);
      setJobs(recentJobs);
      // Pull cloud-synced business hours so the same schedule the worker
      // gates on shows up here. Failing closed (null) is fine — just hides
      // the hours card.
      try {
        const cloudHours = await venueSettingsService.loadSettingsFromCloud(venue.venueId);
        const bh = cloudHours?.businessHours as V2BusinessHours | undefined;
        setHours(bh && bh.days ? bh : null);
      } catch {
        setHours(null);
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load venue detail');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [venue.venueId]);

  // ── Quick-glance computed signals ────────────────────────────────────────
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
        <div className="flex items-center justify-between mb-8 gap-4 flex-wrap">
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
          <button
            onClick={refresh}
            disabled={loading}
            className="btn-secondary flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* ── At-a-glance stat tiles ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <StatTile
            label="Cameras"
            value={`${enabledCameras}/${cameras.length}`}
            sub={recalNeeded > 0 ? `${recalNeeded} need recal` : 'all healthy'}
            tone={recalNeeded > 0 ? 'warn' : 'ok'}
            icon={<CameraIcon className="w-4 h-4" />}
          />
          <StatTile
            label="Status now"
            value={venueIsOpen ? 'Open' : 'Closed'}
            sub={venueIsOpen ? 'worker active' : (nextOpen ? `opens ${nextOpen}` : 'no schedule set')}
            tone={venueIsOpen ? 'ok' : 'muted'}
            icon={<Clock className="w-4 h-4" />}
          />
          <StatTile
            label="Today's drinks"
            value={todayDrinks > 0 ? `${todayDrinks}` : '—'}
            sub={liveJobs > 0 ? `${liveJobs} live job${liveJobs !== 1 ? 's' : ''}` : 'no live jobs'}
            tone="ok"
            icon={<Activity className="w-4 h-4" />}
          />
          <StatTile
            label="Theft flags"
            value={`${theftFlags}`}
            sub={`across ${jobs.length} recent job${jobs.length !== 1 ? 's' : ''}`}
            tone={theftFlags > 0 ? 'warn' : 'ok'}
            icon={<AlertTriangle className="w-4 h-4" />}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* ── Left column: profile + droplet + business hours ── */}
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

          {/* ── Right column: cameras + recent jobs ── */}
          <div className="lg:col-span-2 space-y-6">
            <Section title={`Cameras (${cameras.length})`}
              right={<ManageLink label="Manage cameras" hash="cameras" />}>
              {loading && cameras.length === 0 ? (
                <p className="text-sm text-gray-500">Loading cameras…</p>
              ) : cameras.length === 0 ? (
                <p className="text-sm text-gray-500">
                  No cameras registered yet. Add cameras from the
                  <span className="text-gray-300"> Cameras Management</span> page.
                </p>
              ) : (
                <div className="space-y-2">
                  {cameras.map(cam => <CameraRow key={cam.cameraId} cam={cam} />)}
                </div>
              )}
            </Section>

            <Section title="Recent Jobs"
              right={<ManageLink label="Open Ops Monitor" hash="ops" />}>
              {loading && jobs.length === 0 ? (
                <p className="text-sm text-gray-500">Loading jobs…</p>
              ) : jobs.length === 0 ? (
                <p className="text-sm text-gray-500">No jobs yet for this venue.</p>
              ) : (
                <div className="space-y-2">
                  {jobs.map(job => <JobRow key={job.jobId} job={job} />)}
                </div>
              )}
            </Section>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Subcomponents ───────────────────────────────────────────────────────

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

function ManageLink({ label, hash }: { label: string; hash: string }) {
  return (
    <a
      href={`#${hash}`}
      className="text-xs text-purple-400 hover:text-purple-300 inline-flex items-center gap-1"
      title={`Open ${label}`}
    >
      {label} <ExternalLink className="w-3 h-3" />
    </a>
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

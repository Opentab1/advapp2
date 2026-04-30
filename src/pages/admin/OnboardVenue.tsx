/**
 * OnboardVenue — guided flow from "new customer signed" to "data flowing."
 *
 * Step order matters: each step's success unlocks the next. Specifically the
 * droplet has to come BEFORE cameras + pre-flight because the venue's NVR
 * router only allowlists the droplet's IP — probing the cameras from any
 * other source (e.g. an admin Lambda) gives misleading results.
 *
 *   1. Venue basics           creates DDB row + Cognito owner user
 *   2. Worker droplet         provisions $42/mo droplet, waits for active,
 *                             auto-sets camProxyUrl, surfaces IP for the
 *                             venue to add to their NVR allowlist
 *   3. Cameras                registers RTSP / HLS URLs in DDB
 *   4. Business hours         per-day schedule + timezone (gates the worker)
 *   5. Pre-flight             probes each camera FROM the droplet
 *   6. POS connect            placeholder
 *   7. Staff invites          optional Cognito users
 *   8. Done                   summary + links
 *
 * State persists in localStorage keyed by venueId so a refresh mid-wizard
 * doesn't lose progress past whatever's already hit DynamoDB.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Building2, Camera, ShieldCheck, CreditCard, Users, CheckCircle2,
  ArrowLeft, ArrowRight, Loader2, Plus, Trash2, AlertCircle,
  ExternalLink, Copy, Server, Clock, RefreshCw, Sparkles, FlaskConical,
  Wand2,
} from 'lucide-react';
import adminService, { type VenueTier, type AdminCamera } from '../../services/admin.service';
import venueSettingsService from '../../services/venue-settings.service';
import { saveVenueSetting } from '../../services/venueSettings.service';
import { createTestRun, getTestRun, type TestRun, type TestRunStatus,
         type FeatureGrade, FEATURE_LABELS } from '../../services/workerTester.service';

// ─── Step metadata ───────────────────────────────────────────────────────────

type StepId =
  | 'venue' | 'droplet' | 'cameras' | 'hours'
  | 'preflight' | 'autoconfig' | 'backtest'
  | 'pos' | 'staff' | 'done';

const STEPS: Array<{ id: StepId; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'venue',      label: 'Venue basics',     icon: Building2 },
  { id: 'droplet',    label: 'Worker droplet',   icon: Server },
  { id: 'cameras',    label: 'Cameras',          icon: Camera },
  { id: 'hours',      label: 'Business hours',   icon: Clock },
  { id: 'preflight',  label: 'Pre-flight',       icon: ShieldCheck },
  { id: 'autoconfig', label: 'Auto-config',      icon: Sparkles },
  { id: 'backtest',   label: 'Back-test',        icon: FlaskConical },
  { id: 'pos',        label: 'POS connect',      icon: CreditCard },
  { id: 'staff',      label: 'Staff roster',     icon: Users },
  { id: 'done',       label: 'Done',             icon: CheckCircle2 },
];

// Valid worker analysis modes. Free-text in the old wizard let typos through
// silently; checkboxes mean only valid modes can ship.
const VALID_MODES = [
  { id: 'drink_count',    label: 'Drink count'    },
  { id: 'bottle_count',   label: 'Bottle count'   },
  { id: 'people_count',   label: 'People count'   },
  { id: 'table_turns',    label: 'Table turns'    },
  { id: 'table_service',  label: 'Table service'  },
  { id: 'staff_activity', label: 'Staff activity' },
  { id: 'after_hours',    label: 'After hours'    },
] as const;
type ModeId = typeof VALID_MODES[number]['id'];

const COMMON_TIMEZONES = [
  { id: 'America/New_York',    label: 'Eastern (ET)'  },
  { id: 'America/Chicago',     label: 'Central (CT)'  },
  { id: 'America/Denver',      label: 'Mountain (MT)' },
  { id: 'America/Phoenix',     label: 'Arizona (no DST)' },
  { id: 'America/Los_Angeles', label: 'Pacific (PT)'  },
  { id: 'America/Anchorage',   label: 'Alaska (AKT)'  },
  { id: 'Pacific/Honolulu',    label: 'Hawaii (HT)'   },
];

const DEFAULT_HOURS = (): Record<string, { open: string; close: string; closed: boolean }> => ({
  mon: { open: '12:00', close: '02:00', closed: false },
  tue: { open: '12:00', close: '02:00', closed: false },
  wed: { open: '12:00', close: '02:00', closed: false },
  thu: { open: '12:00', close: '02:00', closed: false },
  fri: { open: '12:00', close: '03:00', closed: false },
  sat: { open: '12:00', close: '03:00', closed: false },
  sun: { open: '12:00', close: '02:00', closed: false },
});

// ─── Form state types ────────────────────────────────────────────────────────

interface VenueForm {
  venueName:    string;
  venueId:      string;
  locationName: string;
  ownerEmail:   string;
  ownerName:    string;
  venueTier:    VenueTier;
  capacity:      string;
  slowDayCovers: string;
  busyDayCovers: string;
}

interface CameraForm {
  name:         string;
  rtspUrl:      string;          // RTSP or HLS HTTP — both accepted
  modes:        ModeId[];        // multi-select; was free-text before
  modelProfile: 'fast' | 'balanced' | 'accurate';
  cameraId?:    string;
  preflight?: { ok: boolean; reason: string; width?: number; height?: number; fps?: number };
}

interface StaffForm {
  // Required for everyone — drives the auto-staffing schedule on the
  // consumer side. The wizard writes these into venueSettings.staffing
  // so day-one schedules already have a roster to fill.
  name:  string;
  // Work role (bartender, server, etc.) — picked up by Staffing.tsx
  // ROLE_LABELS / ROLE_COLORS. NOT the Cognito permission role.
  role:  'bartender' | 'server' | 'door' | 'manager' | 'other';
  // Optional. When present, also invites the person as a Cognito user
  // so they can log into the portal. Email-less rows are roster-only.
  email: string;
}

interface DropletState {
  dropletStatus?: string;
  dropletId?:     number;
  dropletIp?:     string;
  dropletRegion?: string;
  dropletSize?:   string;
  provisionedAt?: string;
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 32) || 'venue';
}

/** Accept rtsp://, http://, or https:// — the worker handles both stream types.
 *  The old wizard's hard rtsp:// requirement rejected Blind Goat's working
 *  HLS HTTP URLs, which is the format most NVRs actually serve. */
function isValidStreamUrl(u: string): boolean {
  const s = u.trim().toLowerCase();
  if (!s) return false;
  return s.startsWith('rtsp://') || s.startsWith('http://') || s.startsWith('https://');
}

/** Auto-derive the camera-proxy URL the consumer Live page uses to render
 *  preview thumbnails. Pattern: https://{ip-with-dashes}.sslip.io/cam .
 *  sslip.io is a free wildcard-DNS service that gives any-IP an HTTPS-able
 *  hostname (used for letsencrypt cert issuance against per-droplet IPs). */
function camProxyUrlFor(ip: string): string {
  return `https://${ip.replace(/\./g, '-')}.sslip.io/cam`;
}

// ─── Step header (progress rail) ─────────────────────────────────────────────

function ProgressRail({ currentIdx }: { currentIdx: number }) {
  return (
    <div className="flex items-center gap-0">
      {STEPS.map((step, i) => {
        const Icon = step.icon;
        const done = i < currentIdx;
        const curr = i === currentIdx;
        return (
          <div key={step.id} className="flex items-center flex-1">
            <div className={`flex items-center gap-2 ${curr ? 'text-white' : done ? 'text-cyan-400' : 'text-gray-500'}`}>
              <div className={`
                w-8 h-8 rounded-full flex items-center justify-center border
                ${curr ? 'bg-cyan-500 border-cyan-400 text-white' :
                  done ? 'bg-cyan-600/40 border-cyan-400/50' :
                  'bg-white/5 border-white/10'}
              `}>
                <Icon className="w-4 h-4" />
              </div>
              <span className="text-xs hidden md:inline">{step.label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-px mx-2 ${done ? 'bg-cyan-400/60' : 'bg-white/10'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Persistence ─────────────────────────────────────────────────────────────

interface AutoConfigEntry {
  status:    'idle' | 'running' | 'suggested' | 'applied' | 'failed' | 'skipped';
  suggested: any | null;       // barConfig dict OR list of tableZones
  kind:      'bar' | 'tables' | null;
  reason?:   string;
}

interface PersistedState {
  stepIdx: number;
  venue: VenueForm;
  venueCreated: boolean;
  ownerTempPassword: string | null;
  droplet: DropletState | null;
  cameras: CameraForm[];
  bizDays: Record<string, { open: string; close: string; closed: boolean }>;
  bizTimezone: string;
  autoConfig: Record<string, AutoConfigEntry>;
  backtestDate: string;
  backtestStartTime: string;
  backtestEndTime: string;
  backtestRunId: string | null;
  posProvider: '' | 'square' | 'toast';
  posSkipped: boolean;
  staff: StaffForm[];
  savedAt: number;
}

/** Pick the most recent Saturday (YYYY-MM-DD) — used as the default
 *  back-test date because Saturday's the busiest, broadest test for
 *  most venues. */
function lastSaturdayISO(): string {
  const d = new Date();
  // weekday: Sun=0, Sat=6
  const offset = (d.getDay() + 1) % 7;   // 0 if today is Saturday, else days since last Sat
  d.setDate(d.getDate() - offset);
  return d.toISOString().slice(0, 10);
}

const STORAGE_KEY = 'pulse_onboard_wizard_v2';

function loadPersisted(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedState;
    // Drop persisted state older than 7 days — likely abandoned.
    if (Date.now() - (parsed.savedAt ?? 0) > 7 * 86400 * 1000) return null;
    return parsed;
  } catch { return null; }
}

function savePersisted(s: PersistedState) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...s, savedAt: Date.now() })); }
  catch { /* localStorage may be full or disabled — non-fatal */ }
}

function clearPersisted() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

// ─── Main page ───────────────────────────────────────────────────────────────

export function OnboardVenue() {
  const persisted = useRef(loadPersisted()).current;

  const [stepIdx, setStepIdx] = useState(persisted?.stepIdx ?? 0);
  const [busy,    setBusy]    = useState(false);
  const [err,     setErr]     = useState<string | null>(null);
  const [msg,     setMsg]     = useState<string | null>(null);

  // Step 1 — venue
  const [venue, setVenue] = useState<VenueForm>(persisted?.venue ?? {
    venueName: '', venueId: '', locationName: 'Main', ownerEmail: '', ownerName: '',
    venueTier: 'bar', capacity: '', slowDayCovers: '', busyDayCovers: '',
  });
  const [venueCreated, setVenueCreated] = useState(persisted?.venueCreated ?? false);
  const [ownerTempPassword, setOwnerTempPassword] = useState<string | null>(persisted?.ownerTempPassword ?? null);

  // Step 2 — droplet
  const [droplet, setDroplet] = useState<DropletState | null>(persisted?.droplet ?? null);

  // Step 3 — cameras
  const [cameras, setCameras] = useState<CameraForm[]>(persisted?.cameras ?? [{
    name: 'Bar Cam', rtspUrl: '', modes: ['drink_count', 'bottle_count'], modelProfile: 'balanced',
  }]);
  const [cameraErrors, setCameraErrors] = useState<Record<number, string>>({});

  // Step 4 — hours
  const [bizDays, setBizDays] = useState(persisted?.bizDays ?? DEFAULT_HOURS());
  const [bizTimezone, setBizTimezone] = useState(persisted?.bizTimezone ?? 'America/New_York');

  // Step 5 — preflight runs from droplet; results live on cameras[]

  // Step 6 — auto-config (per camera, keyed by cameraId)
  const [autoConfig, setAutoConfig] = useState<Record<string, AutoConfigEntry>>(persisted?.autoConfig ?? {});

  // Step 7 — back-test
  const [backtestDate, setBacktestDate]           = useState(persisted?.backtestDate ?? lastSaturdayISO());
  const [backtestStartTime, setBacktestStartTime] = useState(persisted?.backtestStartTime ?? '18:00');
  const [backtestEndTime, setBacktestEndTime]     = useState(persisted?.backtestEndTime ?? '23:00');
  const [backtestRunId, setBacktestRunId]         = useState<string | null>(persisted?.backtestRunId ?? null);
  const [backtestRun, setBacktestRun]             = useState<TestRun | null>(null);

  // Step 8 — POS
  const [posProvider, setPosProvider] = useState<'' | 'square' | 'toast'>(persisted?.posProvider ?? '');
  const [posSkipped,  setPosSkipped]  = useState(persisted?.posSkipped ?? false);

  // Step 9 — staff
  const [staff, setStaff] = useState<StaffForm[]>(persisted?.staff ?? []);

  const currentStep = STEPS[stepIdx];

  // venueId auto-derived from name unless overridden
  const computedVenueId = useMemo(
    () => venue.venueId || slugify(venue.venueName),
    [venue.venueId, venue.venueName],
  );

  // ── Persist on every meaningful state change ────────────────────────────
  useEffect(() => {
    savePersisted({
      stepIdx, venue, venueCreated, ownerTempPassword, droplet,
      cameras, bizDays, bizTimezone, autoConfig,
      backtestDate, backtestStartTime, backtestEndTime, backtestRunId,
      posProvider, posSkipped, staff,
      savedAt: Date.now(),
    });
  }, [stepIdx, venue, venueCreated, ownerTempPassword, droplet,
      cameras, bizDays, bizTimezone, autoConfig,
      backtestDate, backtestStartTime, backtestEndTime, backtestRunId,
      posProvider, posSkipped, staff]);

  // ── Back-test polling: while the test run is active, refresh every 5s ──
  useEffect(() => {
    if (currentStep.id !== 'backtest' || !backtestRunId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        const r = await getTestRun(backtestRunId);
        if (cancelled) return;
        setBacktestRun(r);
        if (r.status === 'pending' || r.status === 'running') {
          timer = setTimeout(tick, 5000);
        }
      } catch {
        if (cancelled) return;
        timer = setTimeout(tick, 8000);
      }
    };
    tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [currentStep.id, backtestRunId]);

  // ── Droplet polling: while we're on the droplet step, refresh status
  //    every 8s if it's still booting. ─────────────────────────────────────
  useEffect(() => {
    if (currentStep.id !== 'droplet') return;
    if (!venueCreated) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        const d = await adminService.getDroplet(computedVenueId);
        if (cancelled) return;
        setDroplet(d);
        // Auto-set the camProxyUrl in venue settings the moment the droplet
        // gets an IP. Without this, the consumer Live page shows broken
        // preview thumbnails on day 1.
        if (d.dropletIp && d.dropletStatus === 'active') {
          try { await venueSettingsService.saveCamProxyUrl(computedVenueId, camProxyUrlFor(d.dropletIp)); }
          catch { /* fall through; admin can set this later from Settings */ }
        }
        const next = d.dropletStatus === 'provisioning' ? 8000 : 30000;
        timer = setTimeout(tick, next);
      } catch (e) {
        if (cancelled) return;
        timer = setTimeout(tick, 30000);
      }
    };
    tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [currentStep.id, venueCreated, computedVenueId]);

  // ── Step submit handlers ────────────────────────────────────────────────

  async function submitVenueStep() {
    setErr(null); setMsg(null);
    if (!venue.venueName.trim() || !venue.ownerEmail.trim() || !venue.ownerName.trim()) {
      setErr('Venue name, owner email, and owner name are required.');
      return;
    }
    const capacityN = parseInt(venue.capacity || '0', 10);
    const slowN     = parseInt(venue.slowDayCovers || '0', 10);
    const busyN     = parseInt(venue.busyDayCovers || '0', 10);
    if (capacityN && slowN && busyN && busyN < slowN) {
      setErr('Busy-day covers should be ≥ slow-day covers.');
      return;
    }
    setBusy(true);
    try {
      const res = await adminService.createVenue({
        venueName:    venue.venueName.trim(),
        venueId:      computedVenueId,
        locationName: venue.locationName.trim() || 'Main',
        ownerEmail:   venue.ownerEmail.trim(),
        ownerName:    venue.ownerName.trim(),
        venueTier:    venue.venueTier,
        capacity:      capacityN > 0 ? capacityN : undefined,
        slowDayCovers: slowN     > 0 ? slowN     : undefined,
        busyDayCovers: busyN     > 0 ? busyN     : undefined,
      });
      if (!res.success) { setErr(res.message); return; }
      setVenueCreated(true);
      setOwnerTempPassword(res.tempPassword ?? null);
      setVenue(v => ({ ...v, venueId: computedVenueId }));

      // Mirror the forecast profile to /venue-settings so consumer-facing
      // pages (Staffing schedule, Tonight forecast, Idea tester) can read
      // these without an admin-key. The admin venues row is still source of
      // truth for the operator-facing wizard; this is a read-side cache for
      // the customer side. Fire-and-forget — failure here just means the
      // customer pages will use the generic prior until the operator edits
      // settings, which is the same state existing venues are already in.
      try {
        const existing = (await venueSettingsService.loadSettingsFromCloud(computedVenueId)) || {};
        await venueSettingsService.saveSettingsToCloud(computedVenueId, {
          ...existing,
          ...(capacityN > 0 ? { capacity:      capacityN } : {}),
          ...(slowN     > 0 ? { slowDayCovers: slowN }     : {}),
          ...(busyN     > 0 ? { busyDayCovers: busyN }     : {}),
          venueTier: venue.venueTier,
        });
      } catch { /* non-fatal */ }

      setStepIdx(1);
      setMsg(res.message);
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to create venue');
    } finally { setBusy(false); }
  }

  async function provisionDropletStep() {
    setErr(null); setMsg(null);
    if (!confirm(`Provision a $42/mo CPU-Optimized droplet (2 vCPU / 4 GB) `
      + `for "${venue.venueName}"?\n\n`
      + `Boots from the master snapshot in TOR1 with VS_VENUE_ID=${computedVenueId}. `
      + `Takes 3-5 min.`)) return;
    setBusy(true);
    try {
      const data = await adminService.provisionDroplet(computedVenueId);
      setDroplet({ ...droplet, ...data });
      setMsg('Droplet provisioning started. Polling for active status…');
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to start droplet provisioning');
    } finally { setBusy(false); }
  }

  function validateCameras(): boolean {
    const errs: Record<number, string> = {};
    cameras.forEach((c, i) => {
      if (!c.name.trim())              errs[i] = 'Name required.';
      else if (!c.rtspUrl.trim())      errs[i] = 'Stream URL required.';
      else if (!isValidStreamUrl(c.rtspUrl))
        errs[i] = 'URL must start with rtsp://, http://, or https://';
      else if (!c.modes.length)        errs[i] = 'Pick at least one mode.';
    });
    setCameraErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function submitCamerasStep() {
    setErr(null); setMsg(null);
    if (!validateCameras()) {
      setErr('Fix the camera issues above before continuing.');
      return;
    }
    setBusy(true);
    try {
      const updated: CameraForm[] = [];
      for (const c of cameras) {
        if (c.cameraId) { updated.push(c); continue; }
        const res = await adminService.createCamera({
          venueId:      computedVenueId,
          name:         c.name.trim(),
          rtspUrl:      c.rtspUrl.trim(),
          modes:        c.modes.join(','),
          modelProfile: c.modelProfile,
          enabled:      true,
          // 1800 = 30-min segments, the value live RTSP wants. The old
          // hardcoded 15 made workers re-spawn jobs every 15 seconds for
          // a live stream — 200x more launch overhead than necessary.
          segmentSeconds: 1800,
        });
        if (!res.success) {
          setErr(`Camera "${c.name}": ${res.message}`);
          setCameras(updated.concat(cameras.slice(updated.length)));
          return;
        }
        updated.push({ ...c, cameraId: res.cameraId });
      }
      setCameras(updated);
      setStepIdx(3);
      setMsg(`${updated.length} camera(s) registered`);
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to register cameras');
    } finally { setBusy(false); }
  }

  async function submitHoursStep() {
    setErr(null); setMsg(null);
    setBusy(true);
    try {
      const ok = await venueSettingsService.saveBusinessHours(computedVenueId, {
        timezone: bizTimezone,
        days:     bizDays,
      });
      if (!ok) { setErr('Failed to save business hours'); return; }
      setStepIdx(4);
      setMsg('Hours saved. Worker will gate on/off accordingly.');
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to save business hours');
    } finally { setBusy(false); }
  }

  async function runPreflight() {
    setErr(null); setMsg(null);
    if (!droplet?.dropletIp) {
      setErr('Provision the droplet first — pre-flight probes from there.');
      return;
    }
    setBusy(true);
    try {
      const results = await adminService.probeCameras?.(
        cameras.map(c => ({ name: c.name, rtspUrl: c.rtspUrl })),
      ).catch(() => null);

      setCameras(curr => curr.map((c, i) => {
        const r = results?.[i];
        if (!r) return { ...c, preflight: { ok: false, reason: 'probe endpoint unavailable' } };
        return { ...c, preflight: r };
      }));
      const anyBad = results && results.some((r: any) => !r.ok);
      if (anyBad)        setErr('One or more cameras failed pre-flight. Confirm the droplet IP is on the venue\'s NVR allowlist, then retry.');
      else if (results)  setMsg('All cameras green.');
      else               setMsg('Probe endpoint not deployed yet.');
    } catch (e: any) {
      setErr(e?.message ?? 'Pre-flight failed');
    } finally { setBusy(false); }
  }

  // ─── Auto-config handlers ──────────────────────────────────────────────
  async function runAutoConfigForCamera(cam: CameraForm) {
    if (!cam.cameraId) return;
    const cid = cam.cameraId;
    const wantsBar    = cam.modes.includes('drink_count');
    const wantsTables = cam.modes.includes('table_turns') || cam.modes.includes('table_service');
    if (!wantsBar && !wantsTables) {
      // Camera doesn't need zones (e.g. people_count, after_hours).
      setAutoConfig(s => ({ ...s, [cid]: { status: 'skipped', suggested: null, kind: null,
                                            reason: 'no zone-based modes selected' } }));
      return;
    }
    setAutoConfig(s => ({ ...s, [cid]: { status: 'running', suggested: null, kind: wantsBar ? 'bar' : 'tables' } }));
    try {
      // Existing service methods throw on failure and return the suggested
      // shape directly: barConfig dict for zones, list of tableZones for tables.
      const suggested = wantsBar
        ? await adminService.autoDetectZones(computedVenueId, cid)
        : await adminService.autoDetectTables(computedVenueId, cid);
      if (!suggested || (Array.isArray(suggested) && suggested.length === 0)) {
        setAutoConfig(s => ({ ...s, [cid]: { status: 'failed', suggested: null,
                                              kind: wantsBar ? 'bar' : 'tables',
                                              reason: wantsBar ? 'no bar line detected' : 'no tables detected' } }));
        return;
      }
      setAutoConfig(s => ({ ...s, [cid]: { status: 'suggested', suggested,
                                            kind: wantsBar ? 'bar' : 'tables' } }));
    } catch (e: any) {
      setAutoConfig(s => ({ ...s, [cid]: { status: 'failed', suggested: null,
                                            kind: wantsBar ? 'bar' : 'tables',
                                            reason: e?.message ?? 'detect failed' } }));
    }
  }

  async function applyAutoConfigForCamera(cam: CameraForm) {
    if (!cam.cameraId) return;
    const cid = cam.cameraId;
    const entry = autoConfig[cid];
    if (!entry || entry.status !== 'suggested' || !entry.suggested) return;
    try {
      const fields: Partial<AdminCamera> = entry.kind === 'bar'
        ? { barConfigJson: JSON.stringify(entry.suggested) }
        : { tableZonesJson: JSON.stringify(entry.suggested) };
      const ok = await adminService.updateCamera(cid, computedVenueId, fields);
      if (!ok) {
        setAutoConfig(s => ({ ...s, [cid]: { ...entry, status: 'failed', reason: 'updateCamera returned false' } }));
        return;
      }
      setAutoConfig(s => ({ ...s, [cid]: { ...entry, status: 'applied' } }));
    } catch (e: any) {
      setAutoConfig(s => ({ ...s, [cid]: { ...entry, status: 'failed', reason: e?.message ?? 'updateCamera failed' } }));
    }
  }

  // ─── Back-test handlers ────────────────────────────────────────────────
  async function startBacktest() {
    setErr(null); setMsg(null);
    if (!cameras.some(c => c.cameraId)) {
      setErr('Register at least one camera first.');
      return;
    }
    setBusy(true);
    try {
      const cameraSpecs = cameras.filter(c => c.cameraId).map(c => ({
        cameraId:   c.cameraId!,
        name:       c.name,
        rtspUrl:    c.rtspUrl,
        modes:      c.modes,
        modelProfile: c.modelProfile,
      } as any));
      const res = await createTestRun({
        venueId:         computedVenueId,
        replayDate:      backtestDate,
        replayStartTime: backtestStartTime,
        replayEndTime:   backtestEndTime,
        replayTimezone:  bizTimezone,
        pauseLiveCams:   false,
        cameras:         cameraSpecs,
      });
      setBacktestRunId(res.runId);
      setBacktestRun(null); // polling effect will fill
      setMsg(`Back-test queued (${res.runId.slice(0, 8)}…) — replaying ${backtestDate} ${backtestStartTime}-${backtestEndTime}`);
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to queue back-test');
    } finally { setBusy(false); }
  }

  async function submitStaffStep() {
    setErr(null); setMsg(null);
    const named = staff.filter(s => s.name.trim());
    if (named.length === 0) { setStepIdx(9); return; }
    setBusy(true);
    try {
      // Step A — write the roster to venueSettings.staffing so the
      // consumer's Staffing tab has names to schedule on day one. Color
      // mirrors Staffing.tsx ROLE_COLORS so the calendar renders matching
      // chips immediately.
      const ROLE_COLOR: Record<string, string> = {
        bartender: 'bg-purple-500', server: 'bg-cyan-500',
        door:      'bg-amber-500', manager: 'bg-emerald-500',
        other:     'bg-warm-500',
      };
      const roster = named.map(s => ({
        id:    `cre-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name:  s.name.trim(),
        role:  s.role,
        color: ROLE_COLOR[s.role] ?? 'bg-warm-500',
      }));
      await saveVenueSetting('staffing',
        { staff: roster, shifts: [] }, computedVenueId);

      // Step B — invite anyone with an email as a Cognito user. Cognito
      // role is the portal-permission role (manager → manager, everyone
      // else → staff). Failure to invite isn't fatal — the roster is
      // already saved and the operator can re-invite from the Users tab.
      const toInvite = named.filter(s => s.email.trim());
      let invited = 0;
      const failures: string[] = [];
      for (const s of toInvite) {
        try {
          const res = await adminService.createUser({
            email:     s.email.trim(),
            name:      s.name.trim(),
            venueId:   computedVenueId,
            venueName: venue.venueName.trim(),
            role:      s.role === 'manager' ? 'manager' : 'staff',
          });
          if (res.success) invited++;
          else             failures.push(`${s.email}: ${res.message}`);
        } catch (e: any) {
          failures.push(`${s.email}: ${e?.message ?? 'invite failed'}`);
        }
      }

      setStepIdx(9);
      const parts = [`${roster.length} on roster`];
      if (invited)         parts.push(`${invited} invited`);
      if (failures.length) parts.push(`${failures.length} invite failed (re-try from Users tab)`);
      setMsg(parts.join(' · '));
      if (failures.length) console.warn('[onboard] invite failures:', failures);
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to save roster');
    } finally { setBusy(false); }
  }

  function startNewVenue() {
    clearPersisted();
    window.location.reload();
  }

  // ── Step bodies ─────────────────────────────────────────────────────────

  const body = () => {
    switch (currentStep.id) {

      // ─── 1. Venue basics ───────────────────────────────────────────────
      case 'venue': return (
        <div className="flex flex-col gap-4 max-w-2xl">
          <p className="text-sm text-gray-400">
            Creates the venue record in DynamoDB and a Cognito user for the owner.
            The owner gets a temporary password; they'll be forced to reset it on
            first login.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Venue name" value={venue.venueName}
              onChange={v => setVenue(s => ({ ...s, venueName: v }))}
              placeholder="Blind Goat" />
            <Field label="Venue ID (slug)" value={computedVenueId}
              onChange={v => setVenue(s => ({ ...s, venueId: slugify(v) }))}
              placeholder="auto-derived"
              help="Lowercase alphanumeric. Used as the DDB partition key everywhere." />
            <Field label="Location name" value={venue.locationName}
              onChange={v => setVenue(s => ({ ...s, locationName: v }))}
              placeholder="Main" />
            <Field label="Owner email" value={venue.ownerEmail} type="email"
              onChange={v => setVenue(s => ({ ...s, ownerEmail: v }))}
              placeholder="owner@venue.com" />
            <Field label="Owner name" value={venue.ownerName}
              onChange={v => setVenue(s => ({ ...s, ownerName: v }))}
              placeholder="Jane Doe" />
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-400">Venue tier</label>
              <select
                className="bg-white/5 border border-white/10 rounded text-white text-sm px-2 py-1.5"
                value={venue.venueTier}
                onChange={e => setVenue(s => ({ ...s, venueTier: e.target.value as VenueTier }))}
              >
                <option value="bar">Bar — cocktail / dive / sports / pub (peaks 10-11 PM)</option>
                <option value="restaurant">Restaurant — dinner-led (peaks 7-8 PM)</option>
                <option value="nightclub">Nightclub — late closing (peaks midnight)</option>
                <option value="mixed">Mixed — dinner then bar (two peaks)</option>
              </select>
            </div>
            <Field label="Legal capacity (hard cap)" value={venue.capacity} type="number"
              onChange={v => setVenue(s => ({ ...s, capacity: v }))}
              placeholder="60"
              help="Physical/fire-code max. Forecast never exceeds this." />
            <Field label="Typical slow-night covers" value={venue.slowDayCovers} type="number"
              onChange={v => setVenue(s => ({ ...s, slowDayCovers: v }))}
              placeholder="15" />
            <Field label="Typical busy-night covers" value={venue.busyDayCovers} type="number"
              onChange={v => setVenue(s => ({ ...s, busyDayCovers: v }))}
              placeholder="80" />
          </div>

          {venueCreated && ownerTempPassword && (
            <div className="bg-cyan-500/10 border border-cyan-500/30 rounded p-3 text-sm">
              <div className="text-cyan-300 font-semibold mb-1">✓ Venue + owner user created</div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-gray-400">Temp password:</span>
                <code className="bg-black/40 px-2 py-0.5 rounded">{ownerTempPassword}</code>
                <button onClick={() => navigator.clipboard?.writeText(ownerTempPassword)}
                  className="p-1 hover:bg-white/10 rounded"><Copy className="w-3.5 h-3.5" /></button>
              </div>
              <div className="text-gray-500 text-xs mt-1">
                Send this to {venue.ownerEmail}. They'll reset it on first login.
              </div>
            </div>
          )}
        </div>
      );

      // ─── 2. Droplet ────────────────────────────────────────────────────
      case 'droplet': {
        const status = droplet?.dropletStatus ?? 'none';
        return (
          <div className="flex flex-col gap-4 max-w-2xl">
            <p className="text-sm text-gray-400">
              Each venue runs on its own DigitalOcean droplet. The droplet IP
              is the only outside address the venue's NVR will allowlist —
              that's why we provision before configuring cameras.
            </p>

            {status === 'none' && (
              <div className="bg-white/5 border border-white/10 rounded p-4 flex items-start gap-3">
                <Server className="w-5 h-5 text-cyan-400 mt-0.5" />
                <div className="flex-1">
                  <div className="font-semibold text-white text-sm">No droplet yet</div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    Spins up a $42/mo CPU-Optimized droplet (2 vCPU / 4 GB) in TOR1
                    from the master snapshot. Pre-configured with VS_VENUE_ID=
                    <code className="text-cyan-300">{computedVenueId}</code>.
                  </div>
                  <button onClick={provisionDropletStep} disabled={busy}
                    className="mt-3 inline-flex items-center gap-1 bg-cyan-600 hover:bg-cyan-500 text-white text-sm px-3 py-1.5 rounded disabled:opacity-40">
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Server className="w-3.5 h-3.5" />}
                    Provision droplet
                  </button>
                </div>
              </div>
            )}

            {status === 'provisioning' && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded p-4 flex items-start gap-3">
                <Loader2 className="w-5 h-5 text-amber-300 mt-0.5 animate-spin" />
                <div className="flex-1">
                  <div className="font-semibold text-amber-200 text-sm">Booting droplet…</div>
                  <div className="text-xs text-amber-300/80 mt-0.5">
                    id={droplet?.dropletId}, region={droplet?.dropletRegion ?? '…'}.
                    Auto-refreshing every 8s. Should take 3–5 minutes.
                  </div>
                </div>
              </div>
            )}

            {(status === 'active' || status === 'new') && droplet?.dropletIp && (
              <div className="space-y-3">
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded p-4 flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 mt-0.5" />
                  <div className="flex-1">
                    <div className="font-semibold text-emerald-300 text-sm">Droplet active</div>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-xs text-gray-400">IP:</span>
                      <code className="text-sm font-mono text-white bg-black/40 px-2 py-0.5 rounded">
                        {droplet.dropletIp}
                      </code>
                      <button onClick={() => navigator.clipboard?.writeText(droplet.dropletIp!)}
                        className="text-gray-400 hover:text-white p-1 rounded">
                        <Copy className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {droplet.dropletRegion} · {droplet.dropletSize} · id={droplet.dropletId}
                    </div>
                  </div>
                </div>
                <div className="bg-amber-500/10 border border-amber-500/30 rounded p-3 text-sm text-amber-200">
                  <strong>Action required at the venue:</strong> add{' '}
                  <code className="bg-black/40 px-1 py-0.5 rounded">{droplet.dropletIp}</code>{' '}
                  to the NVR's outbound allowlist (or router port-forward source-IP filter).
                  Without this, no camera streams will reach our worker.
                </div>
              </div>
            )}

            {status !== 'none' && status !== 'provisioning' && status !== 'active' && status !== 'new' && (
              <div className="bg-red-500/10 border border-red-500/30 rounded p-3 text-sm text-red-300">
                Droplet status: <code>{status}</code>. Something went wrong — check Venues page or DigitalOcean console.
              </div>
            )}
          </div>
        );
      }

      // ─── 3. Cameras ────────────────────────────────────────────────────
      case 'cameras': return (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-gray-400">
            Register each camera's stream URL and which detections to run.
            Both <code>rtsp://</code> and <code>http://…/hls/…</code> are accepted —
            most NVRs serve HLS HTTP for the live preview.
          </p>
          {cameras.map((c, i) => (
            <div key={i} className="bg-white/5 border border-white/10 rounded p-3 grid grid-cols-1 md:grid-cols-12 gap-2">
              <Field wrapperClass="md:col-span-3" label={`Camera ${i + 1} name`}
                value={c.name}
                onChange={v => setCameras(a => a.map((x, j) => j === i ? { ...x, name: v } : x))}
                placeholder="Bar Cam" disabled={!!c.cameraId} />
              <Field wrapperClass="md:col-span-7" label="Stream URL" value={c.rtspUrl}
                onChange={v => setCameras(a => a.map((x, j) => j === i ? { ...x, rtspUrl: v } : x))}
                placeholder="rtsp://… or http://…:15007/hls/live/CH1/0/livetop.mp4"
                disabled={!!c.cameraId} />
              <div className="md:col-span-2 flex flex-col gap-1">
                <label className="text-xs text-gray-400">Profile</label>
                <select
                  className="bg-white/5 border border-white/10 rounded text-white text-sm px-2 py-1.5"
                  value={c.modelProfile}
                  onChange={e => setCameras(a => a.map((x, j) =>
                    j === i ? { ...x, modelProfile: e.target.value as any } : x))}
                  disabled={!!c.cameraId}
                >
                  <option>fast</option>
                  <option>balanced</option>
                  <option>accurate</option>
                </select>
              </div>

              <div className="md:col-span-12">
                <label className="text-xs text-gray-400 block mb-1">Modes</label>
                <div className="flex flex-wrap gap-2">
                  {VALID_MODES.map(m => {
                    const checked = c.modes.includes(m.id);
                    return (
                      <label key={m.id} className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded border cursor-pointer ${
                        c.cameraId ? 'opacity-60 cursor-not-allowed' : ''
                      } ${
                        checked
                          ? 'bg-cyan-500/20 border-cyan-400/50 text-cyan-300'
                          : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'
                      }`}>
                        <input
                          type="checkbox"
                          className="hidden"
                          disabled={!!c.cameraId}
                          checked={checked}
                          onChange={e => setCameras(a => a.map((x, j) => {
                            if (j !== i) return x;
                            const next = e.target.checked
                              ? [...x.modes, m.id]
                              : x.modes.filter(mm => mm !== m.id);
                            return { ...x, modes: next };
                          }))}
                        />
                        {m.label}
                      </label>
                    );
                  })}
                </div>
              </div>

              {cameraErrors[i] && (
                <div className="md:col-span-12 text-xs text-red-300 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Camera {i + 1}: {cameraErrors[i]}
                </div>
              )}
              {c.cameraId ? (
                <div className="md:col-span-12 text-xs text-cyan-300">
                  ✓ Registered as <code className="text-xs">{c.cameraId}</code>
                </div>
              ) : cameras.length > 1 && (
                <button
                  onClick={() => setCameras(a => a.filter((_, j) => j !== i))}
                  className="md:col-span-12 ml-auto text-xs text-red-300 hover:text-red-200 flex items-center gap-1">
                  <Trash2 className="w-3.5 h-3.5" /> Remove
                </button>
              )}
            </div>
          ))}
          <button
            onClick={() => setCameras(a => [...a, {
              name: `Camera ${a.length + 1}`, rtspUrl: '',
              modes: ['drink_count'], modelProfile: 'balanced',
            }])}
            className="self-start inline-flex items-center gap-1 bg-white/5 hover:bg-white/10 text-white text-sm px-3 py-1.5 rounded"
          >
            <Plus className="w-3.5 h-3.5" /> Add another camera
          </button>
        </div>
      );

      // ─── 4. Business hours ─────────────────────────────────────────────
      case 'hours': return (
        <div className="flex flex-col gap-4 max-w-2xl">
          <p className="text-sm text-gray-400">
            Worker only runs (and only writes to DDB) during these hours,
            with a 15-minute warmup before open and 15-minute cooldown after close.
            Customer dashboards show "Venue closed" outside this window.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-400">Timezone</label>
              <select
                className="bg-white/5 border border-white/10 rounded text-white text-sm px-2 py-1.5"
                value={bizTimezone}
                onChange={e => setBizTimezone(e.target.value)}
              >
                {COMMON_TIMEZONES.map(tz => (
                  <option key={tz.id} value={tz.id}>{tz.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-2">
            {(['mon','tue','wed','thu','fri','sat','sun'] as const).map(day => {
              const d = bizDays[day];
              return (
                <div key={day} className="flex items-center gap-3 bg-white/5 border border-white/10 rounded px-3 py-2">
                  <span className="text-sm text-gray-300 w-12 uppercase">{day}</span>
                  <label className="inline-flex items-center gap-1 text-xs text-gray-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!d.closed}
                      onChange={e => setBizDays(prev => ({ ...prev, [day]: { ...d, closed: !e.target.checked } }))}
                    />
                    Open
                  </label>
                  <input
                    type="time"
                    value={d.open}
                    onChange={e => setBizDays(prev => ({ ...prev, [day]: { ...d, open: e.target.value } }))}
                    disabled={d.closed}
                    className="bg-black/30 border border-white/10 rounded text-white text-sm px-2 py-1 disabled:opacity-40"
                  />
                  <span className="text-xs text-gray-500">to</span>
                  <input
                    type="time"
                    value={d.close}
                    onChange={e => setBizDays(prev => ({ ...prev, [day]: { ...d, close: e.target.value } }))}
                    disabled={d.closed}
                    className="bg-black/30 border border-white/10 rounded text-white text-sm px-2 py-1 disabled:opacity-40"
                  />
                </div>
              );
            })}
          </div>
          <p className="text-xs text-gray-500">
            Close time after midnight (e.g. <code>02:00</code>) is interpreted as 2 AM the next day.
          </p>
        </div>
      );

      // ─── 5. Pre-flight ─────────────────────────────────────────────────
      case 'preflight': return (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-gray-400">
            We probe each camera's URL <strong>from the droplet</strong>{droplet?.dropletIp ? ` (${droplet.dropletIp})` : ''} —
            same network vantage point the worker uses. If any fail, the
            issue is almost always the NVR allowlist not yet including the
            droplet IP.
          </p>
          <div className="flex gap-2">
            <button onClick={runPreflight} disabled={busy || !droplet?.dropletIp}
              className="inline-flex items-center gap-1 bg-cyan-600 hover:bg-cyan-500 text-white text-sm px-3 py-1.5 rounded disabled:opacity-40">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
              Run pre-flight
            </button>
            {!droplet?.dropletIp && (
              <span className="text-xs text-amber-300 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" /> Droplet must be active first
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {cameras.map((c, i) => (
              <div key={i} className="bg-white/5 border border-white/10 rounded p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold text-white text-sm truncate">{c.name}</div>
                  {c.preflight && (c.preflight.ok ? (
                    <span className="text-green-400 text-xs whitespace-nowrap">
                      ✓ {c.preflight.width}×{c.preflight.height} @ {c.preflight.fps?.toFixed(1)}fps
                    </span>
                  ) : (
                    <span className="text-red-400 text-xs whitespace-nowrap">✗ {c.preflight.reason}</span>
                  ))}
                </div>
                <code className="text-xs text-gray-500 break-all block mt-1">{c.rtspUrl}</code>
              </div>
            ))}
          </div>
        </div>
      );

      // ─── 6. Auto-config ────────────────────────────────────────────────
      case 'autoconfig': return (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-gray-400">
            For each camera, the droplet samples ~25 frames and detects the
            zones it needs based on the selected modes:{' '}
            <strong>drink_count</strong> → bar line + bar zone polygon;{' '}
            <strong>table_turns / table_service</strong> → table polygons.
            Cameras with only people_count / after_hours don't need zones —
            they auto-skip. Review the suggestion, click Apply, or Skip and
            draw zones manually later in the camera editor.
          </p>
          {cameras.filter(c => c.cameraId).length === 0 ? (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded p-3 text-sm text-amber-200">
              Register cameras first — the auto-detect runs against each
              camera's stream URL via the droplet.
            </div>
          ) : (
            <div className="space-y-2">
              {cameras.filter(c => c.cameraId).map(cam => {
                const entry = autoConfig[cam.cameraId!];
                const wantsBar    = cam.modes.includes('drink_count');
                const wantsTables = cam.modes.includes('table_turns') || cam.modes.includes('table_service');
                const needsZones  = wantsBar || wantsTables;
                return (
                  <div key={cam.cameraId} className="bg-white/5 border border-white/10 rounded p-3">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-white">{cam.name}</div>
                        <div className="text-[11px] text-gray-500">
                          {cam.modes.join(', ')} · profile={cam.modelProfile}
                        </div>
                      </div>
                      {!needsZones ? (
                        <span className="text-xs text-gray-500">No zones needed</span>
                      ) : !entry || entry.status === 'idle' ? (
                        <button onClick={() => runAutoConfigForCamera(cam)}
                          disabled={busy}
                          className="inline-flex items-center gap-1 bg-cyan-600 hover:bg-cyan-500 text-white text-xs px-3 py-1.5 rounded">
                          <Wand2 className="w-3.5 h-3.5" />
                          Auto-detect {wantsBar ? 'bar zones' : 'table zones'}
                        </button>
                      ) : entry.status === 'running' ? (
                        <span className="text-xs text-amber-300 inline-flex items-center gap-1">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Sampling frames…
                        </span>
                      ) : entry.status === 'suggested' ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-emerald-300">
                            ✓ {entry.kind === 'bar'
                              ? `${(entry.suggested?.stations?.length ?? 1)} bar zone(s) detected`
                              : `${(entry.suggested?.length ?? 0)} table polygon(s) detected`}
                          </span>
                          <button onClick={() => applyAutoConfigForCamera(cam)}
                            className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs px-2 py-1 rounded">
                            Apply
                          </button>
                          <button onClick={() => runAutoConfigForCamera(cam)}
                            className="text-xs text-gray-400 hover:text-white">
                            Re-run
                          </button>
                        </div>
                      ) : entry.status === 'applied' ? (
                        <span className="text-xs text-emerald-400 inline-flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Applied
                        </span>
                      ) : entry.status === 'failed' ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-red-300">✗ {entry.reason}</span>
                          <button onClick={() => runAutoConfigForCamera(cam)}
                            className="text-xs text-gray-400 hover:text-white">Retry</button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );

      // ─── 7. Back-test ──────────────────────────────────────────────────
      case 'backtest': return (
        <div className="flex flex-col gap-3 max-w-3xl">
          <p className="text-sm text-gray-400">
            Replay a past night's NVR footage through the worker — same
            engine that handles live, just pointed at recorded fragments.
            Returns per-feature accuracy grades. Default is the most recent
            Saturday 6pm-11pm because that's the busiest, broadest test for
            most venues. Skip if you'd rather verify against live traffic.
          </p>

          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-400">Date (NVR retention permitting)</label>
              <input type="date" value={backtestDate}
                onChange={e => setBacktestDate(e.target.value)}
                disabled={!!backtestRunId}
                className="bg-white/5 border border-white/10 rounded text-white text-sm px-2 py-1.5 disabled:opacity-60"
              />
            </div>
            <Field label="Start time" value={backtestStartTime} type="time"
              onChange={setBacktestStartTime} disabled={!!backtestRunId} />
            <Field label="End time" value={backtestEndTime} type="time"
              onChange={setBacktestEndTime} disabled={!!backtestRunId} />
          </div>

          {!backtestRunId && (
            <div className="flex gap-2">
              <button onClick={startBacktest} disabled={busy}
                className="inline-flex items-center gap-1 bg-cyan-600 hover:bg-cyan-500 text-white text-sm px-3 py-1.5 rounded disabled:opacity-40">
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5" />}
                Start back-test
              </button>
            </div>
          )}

          {backtestRunId && (
            <div className="space-y-3">
              <div className="bg-white/5 border border-white/10 rounded p-3 flex items-center gap-3">
                {backtestRun?.status === 'pending' || backtestRun?.status === 'running' ? (
                  <>
                    <Loader2 className="w-4 h-4 text-amber-300 animate-spin" />
                    <div className="text-sm">
                      <div className="text-amber-200">Replay {backtestRun?.status}…</div>
                      <div className="text-xs text-gray-400">
                        Progress: {backtestRun?.progress ?? 0}% · runId={backtestRunId.slice(0, 12)}…
                      </div>
                    </div>
                  </>
                ) : backtestRun?.status === 'complete' ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <div className="text-sm flex-1">
                      <div className="text-emerald-300 font-semibold">
                        Complete — overall grade: {backtestRun.results?.overallGrade ?? '—'}
                      </div>
                      <div className="text-xs text-gray-500">
                        Stability: {backtestRun.results?.stabilityGrade ?? '—'} ·
                        Started {backtestRun.startedAt} · Finished {backtestRun.completedAt}
                      </div>
                    </div>
                  </>
                ) : backtestRun?.status === 'failed' ? (
                  <>
                    <AlertCircle className="w-4 h-4 text-red-400" />
                    <div className="text-sm">
                      <div className="text-red-300">Replay failed</div>
                      <div className="text-xs text-gray-400">{backtestRun.errorMessage ?? 'see Worker Tester for details'}</div>
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-gray-400">Queued · waiting for worker pickup</div>
                )}
              </div>

              {backtestRun?.results?.perFeature && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {Object.entries(backtestRun.results.perFeature).map(([feat, r]) => {
                    const label = (FEATURE_LABELS as any)[feat] ?? feat;
                    const grade = r?.grade as FeatureGrade | undefined;
                    const tone  = grade === 'A' || grade === 'B' ? 'text-emerald-300'
                               : grade === 'C'                    ? 'text-amber-300'
                               : grade === 'D' || grade === 'F'   ? 'text-red-300'
                               : 'text-gray-500';
                    return (
                      <div key={feat} className="bg-white/5 border border-white/10 rounded p-2">
                        <div className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</div>
                        <div className={`text-2xl font-bold ${tone}`}>{grade ?? '—'}</div>
                        {(r as any)?.detected != null && (
                          <div className="text-[10px] text-gray-400">
                            detected {(r as any).detected}
                            {(r as any)?.truth != null && ` / truth ${(r as any).truth}`}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {(backtestRun?.status === 'complete' || backtestRun?.status === 'failed') && (
                <div className="flex gap-2">
                  <button onClick={() => { setBacktestRunId(null); setBacktestRun(null); }}
                    className="text-sm text-gray-400 hover:text-white px-3 py-1.5">
                    Run another window
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      );

      // ─── 8. POS connect ────────────────────────────────────────────────
      case 'pos': return (
        <div className="flex flex-col gap-3 max-w-2xl">
          <p className="text-sm text-gray-400">
            Connect the venue's POS so drink counts reconcile automatically.
            Skipping is fine — owner can hook this up later from Settings → POS.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPosProvider('square')}
              className={`flex-1 p-3 border rounded text-left ${posProvider === 'square' ? 'border-cyan-400 bg-cyan-500/10' : 'border-white/10 bg-white/5'}`}
            >
              <div className="font-semibold text-white">Square</div>
              <div className="text-xs text-gray-400">OAuth (device must be online)</div>
            </button>
            <button
              onClick={() => setPosProvider('toast')}
              className={`flex-1 p-3 border rounded text-left ${posProvider === 'toast' ? 'border-cyan-400 bg-cyan-500/10' : 'border-white/10 bg-white/5'}`}
            >
              <div className="font-semibold text-white">Toast</div>
              <div className="text-xs text-gray-400">API key</div>
            </button>
          </div>
          {posProvider && !posSkipped && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded p-3 text-sm text-yellow-200">
              POS OAuth flow isn't wired into this wizard yet — owner can connect
              from Settings → POS after first login.
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => { setPosSkipped(true); setStepIdx(8); }}
              className="text-sm text-gray-400 hover:text-white px-3 py-1.5"
            >
              Skip for now →
            </button>
          </div>
        </div>
      );

      // ─── 7. Staff roster ───────────────────────────────────────────────
      case 'staff': return (
        <div className="flex flex-col gap-3 max-w-3xl">
          <p className="text-sm text-gray-400">
            Add the team. These names + roles seed the auto-staffing schedule
            on day one — the consumer's Staffing tab fills the month with
            suggested shifts using exactly this roster. Email is optional;
            include it to also invite the person as a portal login.
          </p>
          {staff.map((s, i) => (
            <div key={i} className="bg-white/5 border border-white/10 rounded p-3 grid grid-cols-12 gap-2">
              <Field wrapperClass="col-span-4" label="Name" value={s.name}
                onChange={v => setStaff(a => a.map((x, j) => j === i ? { ...x, name: v } : x))}
                placeholder="Alex Martinez" />
              <div className="col-span-3 flex flex-col gap-1">
                <label className="text-xs text-gray-400">Role</label>
                <select
                  className="bg-white/5 border border-white/10 rounded text-white text-sm px-2 py-1.5"
                  value={s.role}
                  onChange={e => setStaff(a => a.map((x, j) =>
                    j === i ? { ...x, role: e.target.value as any } : x))}
                >
                  <option value="bartender">Bartender</option>
                  <option value="server">Server</option>
                  <option value="door">Door</option>
                  <option value="manager">Manager</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <Field wrapperClass="col-span-4" label="Email (optional — for portal login)"
                value={s.email} type="email"
                onChange={v => setStaff(a => a.map((x, j) => j === i ? { ...x, email: v } : x))}
                placeholder="alex@venue.com" />
              <button
                onClick={() => setStaff(a => a.filter((_, j) => j !== i))}
                className="col-span-1 text-red-300 hover:text-red-200 self-end pb-1.5">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
          <button
            onClick={() => setStaff(a => [...a, { name: '', role: 'bartender', email: '' }])}
            className="self-start inline-flex items-center gap-1 bg-white/5 hover:bg-white/10 text-white text-sm px-3 py-1.5 rounded"
          >
            <Plus className="w-3.5 h-3.5" /> Add team member
          </button>
        </div>
      );

      // ─── 8. Done ───────────────────────────────────────────────────────
      case 'done': return (
        <div className="flex flex-col items-center text-center gap-4 py-6">
          <CheckCircle2 className="w-16 h-16 text-green-400" />
          <div>
            <h3 className="text-2xl font-bold text-white">Venue onboarded</h3>
            <p className="text-sm text-gray-400 mt-1">
              {venue.venueName} ({computedVenueId}) is ready. Worker on droplet
              {droplet?.dropletIp ? ` ${droplet.dropletIp}` : ''} polls DynamoDB
              every 60s — cameras start collecting data on the next cycle, gated
              by the schedule you set.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 max-w-md w-full text-sm">
            <Stat label="Cameras" value={cameras.length} />
            <Stat label="Users"   value={1 + staff.length} />
            <Stat label="Droplet" value={droplet?.dropletIp ?? '—'} small />
          </div>
          <div className="flex gap-2 pt-2">
            <button
              onClick={startNewVenue}
              className="inline-flex items-center gap-1 bg-white/5 hover:bg-white/10 text-white text-sm px-4 py-2 rounded"
            >
              Onboard another venue
            </button>
            <a href="#admin/venues" className="inline-flex items-center gap-1 bg-cyan-600 hover:bg-cyan-500 text-white text-sm px-4 py-2 rounded">
              <ExternalLink className="w-3.5 h-3.5" /> Open venue dashboard
            </a>
          </div>
        </div>
      );
    }
  };

  // ── Footer nav ──────────────────────────────────────────────────────────
  const nextAction = () => {
    switch (currentStep.id) {
      case 'venue':
        return { label: venueCreated ? 'Next' : 'Create venue',
                 fn: venueCreated ? () => setStepIdx(1) : submitVenueStep,
                 disabled: false };
      case 'droplet':
        // Admin can either: (1) provision via the button, or (2) skip past
        // and use a manually-provisioned droplet. Only block Next mid-provision
        // so the polling effect doesn't get torn down. Empty / failed / active /
        // new states all advance.
        return { label: droplet?.dropletStatus === 'active' || droplet?.dropletStatus === 'new'
                          ? 'Next'
                          : 'Skip droplet',
                 fn: () => setStepIdx(2),
                 disabled: droplet?.dropletStatus === 'provisioning' };
      case 'cameras':
        return { label: 'Register + next',
                 fn: submitCamerasStep, disabled: false };
      case 'hours':
        return { label: 'Save + next',
                 fn: submitHoursStep, disabled: false };
      case 'preflight':
        return { label: 'Next',
                 fn: () => setStepIdx(5), disabled: false };
      case 'autoconfig':
        return { label: 'Next',
                 fn: () => setStepIdx(6), disabled: false };
      case 'backtest':
        return { label: 'Next',
                 // Allow advancing without running a back-test (skip path)
                 // OR after a complete run. Pending/running blocks Next so
                 // we don't lose the polling effect when the operator
                 // navigates away mid-run.
                 fn: () => setStepIdx(7),
                 disabled: !!backtestRunId
                           && backtestRun?.status !== 'complete'
                           && backtestRun?.status !== 'failed' };
      case 'pos':
        return { label: posProvider ? 'Next' : 'Skip',
                 fn: () => setStepIdx(8), disabled: false };
      case 'staff':
        return { label: staff.length > 0 ? 'Save roster + finish' : 'Finish',
                 fn: submitStaffStep, disabled: false };
      case 'done':
        return { label: '', fn: () => {}, disabled: true };
    }
  };
  const next = nextAction()!;

  return (
    <div className="flex flex-col gap-4">
      <div className="glass-card p-5">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Building2 className="w-5 h-5 text-cyan-400" />
              Onboard Venue
            </h2>
            <p className="text-sm text-gray-400 mt-1">
              Guided flow from "new customer signed" to "data flowing."
            </p>
          </div>
          <div className="flex items-center gap-3">
            {persisted && persisted.venueCreated && (
              <button onClick={startNewVenue} title="Discard saved progress, start fresh"
                className="text-xs text-gray-500 hover:text-red-300 inline-flex items-center gap-1">
                <RefreshCw className="w-3 h-3" /> Reset wizard
              </button>
            )}
            <div className="text-xs text-gray-500">Step {stepIdx + 1} of {STEPS.length}</div>
          </div>
        </div>
        <ProgressRail currentIdx={stepIdx} />
      </div>

      <div className="glass-card p-5 min-h-[320px]">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <currentStep.icon className="w-5 h-5 text-cyan-400" />
          {currentStep.label}
        </h3>
        <AnimatePresence mode="wait">
          <motion.div key={currentStep.id}
            initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.15 }}
          >
            {body()}
          </motion.div>
        </AnimatePresence>

        {(err || msg) && (
          <div className={`mt-4 text-sm rounded px-3 py-2 border flex items-center gap-2 ${
            err ? 'text-red-300 bg-red-500/10 border-red-500/30'
                : 'text-green-300 bg-green-500/10 border-green-500/30'
          }`}>
            {err ? <AlertCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
            {err || msg}
          </div>
        )}
      </div>

      {currentStep.id !== 'done' && (
        <div className="flex items-center justify-between">
          <button
            onClick={() => setStepIdx(Math.max(0, stepIdx - 1))}
            disabled={stepIdx === 0}
            className="inline-flex items-center gap-1 text-gray-400 hover:text-white disabled:opacity-30 px-3 py-2"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <button
            onClick={next.fn} disabled={busy || next.disabled}
            className="inline-flex items-center gap-1 bg-cyan-600 hover:bg-cyan-500 text-white text-sm px-4 py-2 rounded disabled:opacity-40"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            {next.label} <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Small subcomponents ─────────────────────────────────────────────────────

function Field({
  label, value, onChange, placeholder, type = 'text', help, wrapperClass = '', disabled,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; help?: string; wrapperClass?: string; disabled?: boolean;
}) {
  return (
    <div className={`flex flex-col gap-1 ${wrapperClass}`}>
      <label className="text-xs text-gray-400">{label}</label>
      <input
        type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} disabled={disabled}
        className="bg-white/5 border border-white/10 rounded text-white text-sm px-2 py-1.5
                   disabled:opacity-60 disabled:cursor-not-allowed
                   focus:outline-none focus:border-cyan-400"
      />
      {help && <div className="text-xs text-gray-500">{help}</div>}
    </div>
  );
}

function Stat({ label, value, small }: { label: string; value: string | number; small?: boolean }) {
  return (
    <div className="bg-white/5 border border-white/10 rounded p-3">
      <div className="text-xs text-gray-400">{label}</div>
      <div className={`${small ? 'text-sm' : 'text-2xl'} font-bold text-white truncate`}>{value}</div>
    </div>
  );
}

export default OnboardVenue;

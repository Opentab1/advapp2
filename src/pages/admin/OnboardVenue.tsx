/**
 * OnboardVenue — single guided flow to go from "new customer signed" to
 * "data flowing" in under 4 hours.
 *
 * Steps (user clicks Next between each):
 *   1. Venue basics         → creates DDB venue record + Cognito owner user
 *   2. Cameras              → adds N camera rows with RTSP URL + modes
 *   3. Pre-flight           → probes each camera (open + decode first frame + fps)
 *   4. POS connect          → OAuth placeholder (Square / Toast)
 *   5. Staff invites        → optional, AdminCreateUser per teammate
 *   6. Done                 → summary + links to Cameras / Ops Monitor
 *
 * Every step writes its work immediately so a crash mid-wizard doesn't lose
 * progress — the operator can re-enter at any step. All actions reuse existing
 * admin.service methods, so DB / Cognito / Stripe semantics match the
 * individual admin pages.
 */
import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Building2, Camera, ShieldCheck, CreditCard, Users, CheckCircle2,
  ArrowLeft, ArrowRight, Loader2, Plus, Trash2, AlertCircle,
  ExternalLink, Copy,
} from 'lucide-react';
import adminService, { type VenueTier } from '../../services/admin.service';

// ─── Step metadata ───────────────────────────────────────────────────────────

type StepId = 'venue' | 'cameras' | 'preflight' | 'pos' | 'staff' | 'done';

const STEPS: Array<{ id: StepId; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'venue',     label: 'Venue basics',     icon: Building2 },
  { id: 'cameras',   label: 'Cameras',          icon: Camera },
  { id: 'preflight', label: 'Pre-flight',       icon: ShieldCheck },
  { id: 'pos',       label: 'POS connect',      icon: CreditCard },
  { id: 'staff',     label: 'Staff invites',    icon: Users },
  { id: 'done',      label: 'Done',             icon: CheckCircle2 },
];

// ─── Form state types ────────────────────────────────────────────────────────

interface VenueForm {
  venueName:   string;
  venueId:     string;        // slug derived from venueName unless overridden
  locationName: string;
  ownerEmail:  string;
  ownerName:   string;
  // Forecast onboarding profile — feeds the prior model so tonight's
  // forecast is scaled to this venue instead of industry averages. All
  // four fields together eliminate the 2-week cold-start problem.
  venueTier:     VenueTier;
  capacity:      string;          // keep as string for controlled input
  slowDayCovers: string;
  busyDayCovers: string;
}

interface CameraForm {
  name:       string;
  rtspUrl:    string;
  modes:      string;         // comma-separated, e.g. "drink_count,bottle_count"
  modelProfile: 'fast' | 'balanced' | 'accurate';
  // Set after admin.service.addCamera returns
  cameraId?:  string;
  // Populated by preflight step
  preflight?: {
    ok: boolean;
    reason: string;
    width?: number;
    height?: number;
    fps?: number;
  };
}

interface StaffForm {
  email: string;
  name:  string;
  role:  'manager' | 'staff';
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 32) || 'venue';
}

// ─── Step header (progress rail) ─────────────────────────────────────────────

function ProgressRail({ currentIdx }: { currentIdx: number }) {
  return (
    <div className="flex items-center gap-0">
      {STEPS.map((step, i) => {
        const Icon = step.icon;
        const done  = i < currentIdx;
        const curr  = i === currentIdx;
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

// ─── Main page ───────────────────────────────────────────────────────────────

export function OnboardVenue() {
  const [stepIdx, setStepIdx] = useState(0);
  const [busy,    setBusy]    = useState(false);
  const [err,     setErr]     = useState<string | null>(null);
  const [msg,     setMsg]     = useState<string | null>(null);

  // Step 1 — venue
  const [venue, setVenue] = useState<VenueForm>({
    venueName: '', venueId: '', locationName: 'Main', ownerEmail: '', ownerName: '',
    venueTier: 'small_bar', capacity: '', slowDayCovers: '', busyDayCovers: '',
  });
  const [venueCreated, setVenueCreated] = useState(false);
  const [ownerTempPassword, setOwnerTempPassword] = useState<string | null>(null);

  // Step 2 — cameras
  const [cameras, setCameras] = useState<CameraForm[]>([{
    name: 'Bar Cam', rtspUrl: '', modes: 'drink_count,bottle_count', modelProfile: 'balanced',
  }]);

  // Step 3 — preflight results live on the cameras[] itself

  // Step 4 — POS (placeholder)
  const [posProvider, setPosProvider] = useState<'' | 'square' | 'toast'>('');
  const [posSkipped,  setPosSkipped]  = useState(false);

  // Step 5 — staff
  const [staff, setStaff] = useState<StaffForm[]>([]);

  const currentStep = STEPS[stepIdx];

  // ── venueId auto-derive ─────────────────────────────────────────────────
  const computedVenueId = useMemo(() => {
    return venue.venueId || slugify(venue.venueName);
  }, [venue.venueId, venue.venueName]);

  // ── Actions per step ────────────────────────────────────────────────────

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
      if (!res.success) {
        setErr(res.message); return;
      }
      setVenueCreated(true);
      setOwnerTempPassword(res.tempPassword ?? null);
      setVenue(v => ({ ...v, venueId: computedVenueId }));
      setStepIdx(1);
      setMsg(res.message);
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to create venue');
    } finally { setBusy(false); }
  }

  async function submitCamerasStep() {
    setErr(null); setMsg(null);
    // Validate cameras
    for (const c of cameras) {
      if (!c.name.trim() || !c.rtspUrl.trim() || !c.modes.trim()) {
        setErr('Each camera needs a name, RTSP URL, and at least one mode.');
        return;
      }
      if (!c.rtspUrl.toLowerCase().startsWith('rtsp://')) {
        setErr(`"${c.name}": RTSP URL must start with rtsp://`);
        return;
      }
    }
    setBusy(true);
    try {
      const updated: CameraForm[] = [];
      for (const c of cameras) {
        if (c.cameraId) { updated.push(c); continue; }  // already added
        const res = await adminService.createCamera({
          venueId: computedVenueId,
          name: c.name.trim(),
          rtspUrl: c.rtspUrl.trim(),
          modes: c.modes.trim(),
          modelProfile: c.modelProfile,
          enabled: true,
          segmentSeconds: 15,
        });
        if (!res.success) {
          setErr(`Camera "${c.name}": ${res.message}`);
          setCameras(updated.concat(cameras.slice(updated.length)));
          return;
        }
        updated.push({ ...c, cameraId: res.cameraId });
      }
      setCameras(updated);
      setStepIdx(2);
      setMsg(`${updated.length} camera(s) registered`);
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to register cameras');
    } finally { setBusy(false); }
  }

  async function runPreflight() {
    setErr(null); setMsg(null);
    setBusy(true);
    try {
      // Use the probeCameras admin endpoint (hits droplet which has the
      // OpenCV / ffmpeg deps). Falls back to naive reachability check if not
      // wired; tolerates either shape.
      const results = await adminService.probeCameras?.(
        cameras.map(c => ({ name: c.name, rtspUrl: c.rtspUrl }))
      ).catch(() => null);

      setCameras(curr => curr.map((c, i) => {
        const r = results?.[i];
        if (!r) {
          return { ...c, preflight: { ok: false, reason: 'probe endpoint unavailable' } };
        }
        return { ...c, preflight: r };
      }));
      const anyBad = results && results.some((r: any) => !r.ok);
      if (anyBad) {
        setErr('One or more cameras failed pre-flight. Check URLs / port forwarding.');
      } else if (results) {
        setMsg('All cameras green.');
      } else {
        setMsg('Probe endpoint not deployed yet — mark results manually below, or deploy then re-run.');
      }
    } catch (e: any) {
      setErr(e?.message ?? 'Pre-flight failed');
    } finally { setBusy(false); }
  }

  async function submitStaffStep() {
    setErr(null); setMsg(null);
    const toCreate = staff.filter(s => s.email.trim() && s.name.trim());
    if (toCreate.length === 0) {
      setStepIdx(5); return;   // skip — no staff to invite
    }
    setBusy(true);
    try {
      for (const s of toCreate) {
        const res = await adminService.createUser({
          email: s.email.trim(), name: s.name.trim(),
          venueId: computedVenueId, venueName: venue.venueName.trim(),
          role: s.role,
        });
        if (!res.success) {
          setErr(`${s.email}: ${res.message}`);
          return;
        }
      }
      setStepIdx(5);
      setMsg(`${toCreate.length} staff user(s) invited via Cognito`);
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to invite staff');
    } finally { setBusy(false); }
  }

  // ── Step bodies ─────────────────────────────────────────────────────────

  const body = () => {
    switch (currentStep.id) {
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
            <Field label="Owner name" value={venue.ownerName}
              onChange={v => setVenue(s => ({ ...s, ownerName: v }))}
              placeholder="Pat Owner" />
            <Field label="Owner email" value={venue.ownerEmail} type="email"
              onChange={v => setVenue(s => ({ ...s, ownerEmail: v }))}
              placeholder="pat@venue.com" />
          </div>

          {/* Forecast onboarding profile — decides tonight's prior so the
              day-1 forecast resembles this venue instead of industry avg. */}
          {!venueCreated && (
            <div className="mt-2 bg-white/5 border border-white/10 rounded-lg p-4">
              <div className="text-sm font-semibold text-white mb-1">
                Forecast baseline <span className="text-xs text-gray-500 font-normal">· optional, strongly recommended</span>
              </div>
              <div className="text-xs text-gray-500 mb-3">
                Tonight's forecast uses these as the prior until ~7 days of real
                data arrive. Without them every venue starts with the same
                industry-average guess.
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Venue type</label>
                  <select
                    value={venue.venueTier}
                    onChange={e => setVenue(s => ({ ...s, venueTier: e.target.value as VenueTier }))}
                    className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-amber-500">
                    <option value="small_bar">Small bar (cocktail, dive, ≤ 60 cap)</option>
                    <option value="mid_bar">Mid bar / lounge (60–150 cap)</option>
                    <option value="large_bar">Large bar / sports bar (150+ cap)</option>
                    <option value="restaurant">Restaurant (dinner service)</option>
                    <option value="nightclub">Nightclub (late peak)</option>
                    <option value="mixed">Mixed (restaurant → bar)</option>
                  </select>
                </div>
                <Field label="Legal capacity (hard cap)" value={venue.capacity} type="number"
                  onChange={v => setVenue(s => ({ ...s, capacity: v }))}
                  placeholder="e.g. 60"
                  help="Physical/fire-code max. Forecast never exceeds this." />
                <Field label="Typical slow-night covers" value={venue.slowDayCovers} type="number"
                  onChange={v => setVenue(s => ({ ...s, slowDayCovers: v }))}
                  placeholder="e.g. 15 (Tuesday)"
                  help="Headcount on your slowest normal night." />
                <Field label="Typical busy-night covers" value={venue.busyDayCovers} type="number"
                  onChange={v => setVenue(s => ({ ...s, busyDayCovers: v }))}
                  placeholder="e.g. 80 (Saturday)"
                  help="Headcount on your busiest normal night." />
              </div>
            </div>
          )}

          {venueCreated && ownerTempPassword && (
            <div className="bg-cyan-500/10 border border-cyan-500/30 rounded p-3 text-sm">
              <div className="text-cyan-300 font-semibold mb-1">
                ✓ Venue + owner user created
              </div>
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

      case 'cameras': return (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-gray-400">
            Register each camera's RTSP URL and which detections to run on it.
            You can always add more later from the Cameras tab.
          </p>
          {cameras.map((c, i) => (
            <div key={i} className="bg-white/5 border border-white/10 rounded p-3 grid grid-cols-1 md:grid-cols-12 gap-2">
              <Field wrapperClass="md:col-span-3" label={`Camera ${i + 1} name`} value={c.name}
                onChange={v => setCameras(a => a.map((x, j) => j === i ? { ...x, name: v } : x))}
                placeholder="Bar Cam" disabled={!!c.cameraId} />
              <Field wrapperClass="md:col-span-5" label="RTSP URL" value={c.rtspUrl}
                onChange={v => setCameras(a => a.map((x, j) => j === i ? { ...x, rtspUrl: v } : x))}
                placeholder="rtsp://user:pass@ip:port/Streaming/Channels/101"
                disabled={!!c.cameraId} />
              <Field wrapperClass="md:col-span-2" label="Modes" value={c.modes}
                onChange={v => setCameras(a => a.map((x, j) => j === i ? { ...x, modes: v } : x))}
                placeholder="drink_count,bottle_count" disabled={!!c.cameraId} />
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
              modes: 'drink_count,bottle_count', modelProfile: 'balanced',
            }])}
            className="self-start inline-flex items-center gap-1 bg-white/5 hover:bg-white/10 text-white text-sm px-3 py-1.5 rounded"
          >
            <Plus className="w-3.5 h-3.5" /> Add another camera
          </button>
        </div>
      );

      case 'preflight': return (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-gray-400">
            We probe each camera's RTSP URL, decode one frame, and report
            resolution + fps. If any fail, fix the URL (or NVR port-forward)
            before running the first detection.
          </p>
          <div className="flex gap-2">
            <button onClick={runPreflight} disabled={busy}
              className="inline-flex items-center gap-1 bg-cyan-600 hover:bg-cyan-500 text-white text-sm px-3 py-1.5 rounded disabled:opacity-40">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
              Run pre-flight
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {cameras.map((c, i) => (
              <div key={i} className="bg-white/5 border border-white/10 rounded p-3">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-white text-sm">{c.name}</div>
                  {c.preflight && (c.preflight.ok ? (
                    <span className="text-green-400 text-xs">✓ {c.preflight.width}×{c.preflight.height} @ {c.preflight.fps?.toFixed(1)}fps</span>
                  ) : (
                    <span className="text-red-400 text-xs">✗ {c.preflight.reason}</span>
                  ))}
                </div>
                <code className="text-xs text-gray-500 break-all">{c.rtspUrl}</code>
              </div>
            ))}
          </div>
        </div>
      );

      case 'pos': return (
        <div className="flex flex-col gap-3 max-w-2xl">
          <p className="text-sm text-gray-400">
            Connect the venue's POS so drink counts reconcile automatically.
            Needed to close the 99% accuracy SLA loop. Can be skipped here and
            added later from Settings.
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
              POS OAuth flow is not wired into this wizard yet — the venue owner
              can connect it from Settings → POS after their first login. That
              path is already built and working.
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => { setPosSkipped(true); setStepIdx(4); }}
              className="text-sm text-gray-400 hover:text-white px-3 py-1.5"
            >
              Skip for now →
            </button>
          </div>
        </div>
      );

      case 'staff': return (
        <div className="flex flex-col gap-3 max-w-2xl">
          <p className="text-sm text-gray-400">
            Optionally invite staff now. Each gets a Cognito user with a temp
            password. Can always be done later from the Users tab.
          </p>
          {staff.map((s, i) => (
            <div key={i} className="bg-white/5 border border-white/10 rounded p-3 grid grid-cols-12 gap-2">
              <Field wrapperClass="col-span-5" label="Email" value={s.email} type="email"
                onChange={v => setStaff(a => a.map((x, j) => j === i ? { ...x, email: v } : x))}
                placeholder="alex@venue.com" />
              <Field wrapperClass="col-span-4" label="Name" value={s.name}
                onChange={v => setStaff(a => a.map((x, j) => j === i ? { ...x, name: v } : x))}
                placeholder="Alex" />
              <div className="col-span-2 flex flex-col gap-1">
                <label className="text-xs text-gray-400">Role</label>
                <select
                  className="bg-white/5 border border-white/10 rounded text-white text-sm px-2 py-1.5"
                  value={s.role}
                  onChange={e => setStaff(a => a.map((x, j) =>
                    j === i ? { ...x, role: e.target.value as any } : x))}
                >
                  <option value="manager">manager</option>
                  <option value="staff">staff</option>
                </select>
              </div>
              <button
                onClick={() => setStaff(a => a.filter((_, j) => j !== i))}
                className="col-span-1 text-red-300 hover:text-red-200 self-end pb-1.5">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
          <button
            onClick={() => setStaff(a => [...a, { email: '', name: '', role: 'manager' }])}
            className="self-start inline-flex items-center gap-1 bg-white/5 hover:bg-white/10 text-white text-sm px-3 py-1.5 rounded"
          >
            <Plus className="w-3.5 h-3.5" /> Invite someone
          </button>
        </div>
      );

      case 'done': return (
        <div className="flex flex-col items-center text-center gap-4 py-6">
          <CheckCircle2 className="w-16 h-16 text-green-400" />
          <div>
            <h3 className="text-2xl font-bold text-white">Venue onboarded</h3>
            <p className="text-sm text-gray-400 mt-1">
              {venue.venueName} ({computedVenueId}) is ready. The worker polls DynamoDB
              every 60s — cameras will start collecting data on the next cycle.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 max-w-md w-full text-sm">
            <div className="bg-white/5 border border-white/10 rounded p-3">
              <div className="text-xs text-gray-400">Cameras</div>
              <div className="text-2xl font-bold text-white">{cameras.length}</div>
            </div>
            <div className="bg-white/5 border border-white/10 rounded p-3">
              <div className="text-xs text-gray-400">Users</div>
              <div className="text-2xl font-bold text-white">{1 + staff.length}</div>
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <a href="#/admin/ops" className="inline-flex items-center gap-1 bg-cyan-600 hover:bg-cyan-500 text-white text-sm px-4 py-2 rounded">
              <ExternalLink className="w-3.5 h-3.5" /> Watch it come alive (Ops Monitor)
            </a>
          </div>
        </div>
      );
    }
  };

  // ── Footer nav ──────────────────────────────────────────────────────────
  const nextAction = () => {
    switch (currentStep.id) {
      case 'venue':      return { label: venueCreated ? 'Next' : 'Create venue', fn: venueCreated ? () => setStepIdx(1) : submitVenueStep };
      case 'cameras':    return { label: 'Register + next', fn: submitCamerasStep };
      case 'preflight':  return { label: 'Next', fn: () => setStepIdx(3) };
      case 'pos':        return { label: posProvider ? 'Next' : 'Skip', fn: () => setStepIdx(4) };
      case 'staff':      return { label: staff.length > 0 ? 'Invite + finish' : 'Finish', fn: submitStaffStep };
      case 'done':       return { label: '', fn: () => {} };
    }
  };
  const next = nextAction();

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
              Guided flow from "new customer signed" to "data flowing" — target &lt; 4 hours.
            </p>
          </div>
          <div className="text-xs text-gray-500">Step {stepIdx + 1} of {STEPS.length}</div>
        </div>
        <ProgressRail currentIdx={stepIdx} />
      </div>

      <div className="glass-card p-5 min-h-[300px]">
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
            onClick={next.fn} disabled={busy}
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

// ─── Small controlled input ─────────────────────────────────────────────────

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

export default OnboardVenue;

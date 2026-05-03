/**
 * ConnectionMethodPicker — pick how this venue's NVR connects to VenueScope.
 *
 * Sits at the top of the venue's Cameras tab. Operator picks one of five
 * methods; each method shows a status badge (Production/Coming Soon/Beta) and
 * a step-by-step playbook the operator can read live or copy/paste into a
 * customer-facing email.
 *
 * Selection saves to venue settings (DDB) so:
 *   - The Onboard Venue wizard pre-fills the right method when adding cams
 *   - The worker dispatches by method when handling new cameras
 *   - Sales handoff docs auto-show the right install steps for that venue
 *
 * Method status policy (don't lie to the operator about what works):
 *   - PRODUCTION: backend + tooling fully shipped, used by ≥1 live venue
 *   - BETA:       backend works in tests, not yet customer-validated
 *   - COMING SOON: design locked, dev in flight, ship date estimate visible
 */
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Globe, Cloud, Network, Smartphone, HardDrive,
  CheckCircle2, Clock, Zap, ChevronDown, AlertTriangle,
} from 'lucide-react';
import venueSettingsService, { VenueSettings } from '../../services/venue-settings.service';

type MethodId =
  | 'rtsp_direct'
  | 'cloud_p2p'
  | 'cloudflare_tunnel'
  | 'pulse_relay'
  | 'edge_bridge';

type Status = 'production' | 'beta' | 'coming_soon';

interface MethodSpec {
  id:           MethodId;
  label:        string;
  tagline:      string;
  status:       Status;
  shipDate?:    string;             // populated when status='coming_soon'
  Icon:         typeof Globe;
  customerEffort: string;            // one-liner for the table
  reliability:    string;
  cost:           string;
  fullyRemote:    boolean;
  steps:        Array<{ title: string; body: string }>;
  pros:         string[];
  cons:         string[];
  bestFor:      string;
}

const METHODS: MethodSpec[] = [
  {
    id:    'rtsp_direct',
    label: 'RTSP Direct',
    tagline: 'Customer port-forwards their NVR to a public IP. We pull RTSP/HLS directly.',
    status: 'production',
    Icon:   Globe,
    customerEffort: 'Configure port forwarding on router + allowlist our droplet IP',
    reliability:    '~99% — depends on customer ISP not changing or blocking the port',
    cost:           '$0/mo',
    fullyRemote:    true,
    bestFor:
      'Venues that already have a port-forwarded NVR, or a tech-savvy operator. ' +
      'Fast onboard if their network supports it. Breaks at any CGNAT-residential venue (Comcast/T-Mobile).',
    steps: [
      { title: 'Confirm public IP availability',
        body:  'Check the venue is NOT behind CGNAT. Run whatismyip.com on a venue device — that should match the WAN IP shown on the customer router. If they differ, this method will not work; pick Cloudflare Tunnel or Cloud P2P instead.' },
      { title: 'Set up port forwarding',
        body:  'In the router admin: forward an external port (e.g. 28458) to the NVR LAN IP:RTSP-port (typically 554). Document the external port for our config.' },
      { title: 'Allowlist VenueScope droplet IP',
        body:  'If the router/firewall has IP allowlisting, add our droplet IP for that venue (we provide it after the droplet is provisioned).' },
      { title: 'Enter the public RTSP URL in the camera form',
        body:  'Format: rtsp://venuescope:<password>@<public-ip>:<external-port>/<stream-path>. We\'ll probe each camera and confirm.' },
    ],
    pros: ['Fastest setup if port-forwarding is already configured',
           'No customer-side install',
           'No third party in the data path'],
    cons: ['Breaks at every CGNAT venue (~30-40% of US small businesses)',
           'ISP can disable port forwarding without warning',
           'Public-facing port = real attack surface'],
  },
  {
    id:    'cloud_p2p',
    label: 'Cloud P2P (XMeye/CORTEX IQ relay)',
    tagline: 'Connect through the same relay the customer\'s NVR app already uses. No port forward.',
    status: 'coming_soon',
    shipDate: '~3-5 days (finishing #97)',
    Icon:   Cloud,
    customerEffort: 'NONE — we just need the P2P device ID',
    reliability:    '~99% — depends on the relay being up (xmeye.net is ~10yrs uptime track record)',
    cost:           '$0/mo',
    fullyRemote:    true,
    bestFor:
      'Any venue with a CORTEX IQ, XMeye, IP Pro, EyeCloud, or similar Sofia-chipset NVR. ' +
      'That covers ~70% of cheap multi-channel NVRs. Zero install, zero port forward, zero customer headache.',
    steps: [
      { title: 'Find the P2P ID in the customer\'s NVR app',
        body:  'Open CORTEX IQ (or XMeye / IP Pro / etc.) → System → System Information. Look for "P2P ID" or scan the QR code. Looks like nemr26x9a8fjp36xug.' },
      { title: 'Create a "venuescope" user on the NVR',
        body:  'Account Management → enable a slot (user1-user4) → name venuescope → set a strong password. Permissions: Live + Playback + Remote Login + Log Search. Do NOT grant admin or password-change rights.' },
      { title: 'Enter P2P ID + venuescope credentials in our admin UI',
        body:  'Connection Method: Cloud P2P. P2P ID: <from step 1>. Username: venuescope. Password: <from step 2>. We dial the relay using the SDK; cameras stream within ~30s.' },
      { title: 'Done',
        body:  'No router config, no port forward, no static IP, no customer software install. Customer changes their NVR\'s admin password? Doesn\'t affect us — we use venuescope.' },
    ],
    pros: ['Zero customer install — true remote onboarding',
           'No port forwards, no firewall changes, works behind CGNAT',
           'Same path the customer\'s existing app uses (proven by them being able to view live remotely)',
           'Survives router resets and ISP changes'],
    cons: ['Only works for XMeye/Sofia-family NVRs (~70% of cheap NVRs)',
           'Depends on the relay being up — single point of failure outside our control',
           'Variable bandwidth via relay'],
  },
  {
    id:    'cloudflare_tunnel',
    label: 'Cloudflare Tunnel',
    tagline: 'Customer runs cloudflared on a venue PC; tunnel exposes the NVR via Cloudflare\'s edge.',
    status: 'beta',
    Icon:   Network,
    customerEffort: 'Run cloudflared on any always-on PC (5-min one-time install)',
    reliability:    '~99.9% — Cloudflare\'s edge SLA + customer\'s PC uptime',
    cost:           '$0/mo (Cloudflare free tier)',
    fullyRemote:    false,
    bestFor:
      'Venues whose NVR is NOT XMeye-compatible (Hikvision/Dahua/Verkada/etc.) but who DO have an always-on PC at the venue. ' +
      'Works for any RTSP-capable camera or NVR. The fastest path to onboarding when Cloud P2P isn\'t an option.',
    steps: [
      { title: 'We generate a venue-specific tunnel token',
        body:  'In the admin UI, click "Generate Cloudflare Tunnel" for this venue. We pre-bake the venue\'s NVR LAN IP + port into the token so the customer runs it without typing anything.' },
      { title: 'Customer installs cloudflared on a venue PC',
        body:  'Send them our PDF: Download cloudflared from cloudflare.com (Windows/Mac/Linux installer). Open Terminal/Command Prompt. Paste one command we provide. Done — installer runs as a background service so it survives reboots.' },
      { title: 'Tunnel URL auto-registers with our admin',
        body:  'cloudflared dials Cloudflare → Cloudflare gives a stable URL like fergs.tunnels.venuescope.cloud. Our admin auto-detects when the tunnel is up. Cameras start streaming.' },
      { title: 'Done',
        body:  'Customer\'s PC must stay on (POS server / back-office desktop / spare laptop are all fine). If the PC reboots, cloudflared auto-restarts as a service. If the PC dies, no data flows until they replace it.' },
    ],
    pros: ['Works for ANY NVR brand (not just XMeye)',
           'No port forwarding, no router config, no public IP needed',
           'Cloudflare\'s edge is one of the most reliable networks on the internet',
           '$0/mo for any reasonable usage (free tier handles unlimited tunnels)'],
    cons: ['Requires a customer-side device that stays online',
           'iOS doesn\'t have a stable cloudflared port (Mac/Windows/Linux only)',
           'Cloudflare\'s ToS technically discourages "video streaming as primary use" — paid upgrade ($5/mo) silences this if they push back'],
  },
  {
    id:    'pulse_relay',
    label: 'Pulse App Relay',
    tagline: 'Manager logs into Pulse on a venue device; the app forwards camera streams.',
    status: 'coming_soon',
    shipDate: '~2 weeks',
    Icon:   Smartphone,
    customerEffort: 'Log into Pulse on an existing device that stays at the venue',
    reliability:    '~99% (mobile background networking has limits)',
    cost:           '$0/mo',
    fullyRemote:    true,
    bestFor:
      'Sales demos and free trials where the prospect already has the Pulse app. ' +
      'Also works for venues that won\'t install cloudflared but DO leave a tablet or phone on-site. ' +
      'Best for short windows or low-criticality monitoring.',
    steps: [
      { title: 'Customer installs the Pulse app on a venue device',
        body:  'iOS/Android/Web. Phone, tablet, or browser tab on a back-office laptop all work. Device must stay on venue WiFi.' },
      { title: 'Customer logs in with their VenueScope account',
        body:  'Same credentials they use for the Reports tab. No new account.' },
      { title: 'Enable "Camera Relay Mode" in Pulse settings',
        body:  'A new toggle in Pulse settings (shipping with the next mobile release). Tap → grant permission to keep network active.' },
      { title: 'App pairs with the NVR over LAN',
        body:  'One-time: app discovers the NVR via ONVIF on the venue WiFi, prompts customer to enter the venuescope NVR credentials. From then on, app forwards camera bytes through a WebSocket to our cloud whenever we ask.' },
    ],
    pros: ['No third party in the data path (we own the relay)',
           'Customer experience: "log into the app you already have"',
           'No new install if they already use Pulse'],
    cons: ['Mobile background networking is restrictive — iOS may kill the app',
           'Depends on customer device staying powered + on WiFi',
           'Lower bandwidth than Cloudflare Tunnel for HD video'],
  },
  {
    id:    'edge_bridge',
    label: 'Edge Bridge (VenueScope appliance)',
    tagline: 'We ship a small Pi pre-configured. Customer plugs it in once; we handle everything else.',
    status: 'coming_soon',
    shipDate: '~3 weeks',
    Icon:   HardDrive,
    customerEffort: 'Plug in power + Ethernet (one-time, ~2 minutes)',
    reliability:    '99.95% baseline · 99.99% with optional cellular failover',
    cost:           '$120 one-time hardware · $0/mo recurring (or +$15/mo for cellular)',
    fullyRemote:    true,
    bestFor:
      'High-reliability tier — flagship customers, multi-location chains, anyone whose data we cannot afford to lose. ' +
      'Replaces Eagle Eye Networks / Solink at 1/3 the price by reusing the customer\'s existing cameras.',
    steps: [
      { title: 'Sales orders an Edge Bridge for the venue',
        body:  'We pre-image a Raspberry Pi 5 with a Docker container that runs our nvr_replay infra pointed at the venue\'s LAN cameras. Pi ships with the venue\'s UID baked in.' },
      { title: 'Customer plugs the Pi into power and Ethernet',
        body:  'Any LAN port. Boots in 30 seconds. Pi dials home over outbound HTTPS — no firewall config needed.' },
      { title: 'Admin auto-claims the bridge',
        body:  'Operator opens Edge Bridge tab in admin UI → sees the new bridge online → clicks "Claim for this venue." Bridge auto-discovers cameras on the LAN; operator picks which ones to enable.' },
      { title: 'Optional: 4G cellular failover',
        body:  'If reliability is critical (chains, franchises, casinos), add a $40 USB 4G dongle + $15/mo Mint Mobile. Bridge auto-switches if WiFi drops. Local 4-hour video buffer means no data loss even during full internet outages.' },
    ],
    pros: ['Highest reliability tier — 99.95% baseline, 99.99% with cellular',
           'Local 4-hour buffer means internet outages don\'t cause data gaps',
           'Customer keeps their existing $25/cam IP cameras — no $400/cam upgrade',
           'Defensive moat: customer is hardware-locked into our ecosystem'],
    cons: ['$120 hardware capex per venue',
           'Logistics: shipping, RMA, support',
           'Slowest to deploy — 3 weeks of dev + supply chain'],
  },
];

const STATUS_BADGES: Record<Status, { label: string; cls: string }> = {
  production:  { label: 'PRODUCTION',
                 cls:   'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' },
  beta:        { label: 'BETA · READY',
                 cls:   'bg-cyan-500/15 text-cyan-300 border-cyan-500/40' },
  coming_soon: { label: 'COMING SOON',
                 cls:   'bg-amber-500/15 text-amber-300 border-amber-500/40' },
};

export function ConnectionMethodPicker({ venueId }: { venueId: string }) {
  const [selected, setSelected]   = useState<MethodId>('rtsp_direct');
  const [expanded, setExpanded]   = useState(true);
  const [saving, setSaving]       = useState(false);
  const [savedAt, setSavedAt]     = useState<Date | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [loaded, setLoaded]       = useState(false);

  // Load current method from venue settings on mount
  useEffect(() => {
    if (!venueId) return;
    let cancelled = false;
    venueSettingsService.loadSettingsFromCloud(venueId)
      .then(s => {
        if (cancelled) return;
        if (s?.connectionMethod) setSelected(s.connectionMethod);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    return () => { cancelled = true; };
  }, [venueId]);

  const handleSelect = async (id: MethodId) => {
    setSelected(id);
    if (!venueId) return;
    setSaving(true);
    setError(null);
    try {
      const current = venueSettingsService.getSettings(venueId) || {} as VenueSettings;
      const next: VenueSettings = { ...current, connectionMethod: id };
      const ok = await venueSettingsService.saveSettingsToCloud(venueId, next);
      if (!ok) throw new Error('saveSettings returned false');
      setSavedAt(new Date());
    } catch (e: any) {
      setError(e?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const method = METHODS.find(m => m.id === selected) ?? METHODS[0];
  const Icon = method.Icon;
  const badge = STATUS_BADGES[method.status];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl bg-white/[0.03] border border-white/10 overflow-hidden mb-4"
    >
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-3 px-5 py-4 hover:bg-white/[0.02] transition-colors"
      >
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-fuchsia-500/20 to-purple-500/20 border border-fuchsia-500/30 flex items-center justify-center flex-shrink-0">
          <Zap className="w-4 h-4 text-fuchsia-300" />
        </div>
        <div className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-white">Connection Method</span>
            <span className={`px-2 py-0.5 rounded-full border text-[10px] uppercase tracking-wider font-semibold ${badge.cls}`}>
              {badge.label}
            </span>
            {saving && <span className="text-[11px] text-gray-500">saving…</span>}
            {savedAt && !saving && <span className="text-[11px] text-emerald-400">✓ saved</span>}
          </div>
          <div className="text-[11px] text-gray-400 mt-0.5">
            {method.label} · {method.tagline.split('.')[0]}.
          </div>
        </div>
        <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="border-t border-white/10"
          >
            <div className="p-5 space-y-4">
              {/* Method tiles */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
                {METHODS.map(m => {
                  const M = m.Icon;
                  const isOn = m.id === selected;
                  const b = STATUS_BADGES[m.status];
                  return (
                    <button
                      key={m.id}
                      disabled={!loaded || saving}
                      onClick={() => handleSelect(m.id)}
                      className={`text-left p-3 rounded-xl border transition-colors ${
                        isOn
                          ? 'bg-fuchsia-500/10 border-fuchsia-500/40'
                          : 'bg-white/[0.02] border-white/10 hover:border-white/20'
                      } disabled:opacity-50`}
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <M className={`w-4 h-4 ${isOn ? 'text-fuchsia-300' : 'text-gray-400'}`} />
                        <span className="text-xs font-semibold text-white truncate">{m.label}</span>
                      </div>
                      <div className={`inline-block px-1.5 py-0.5 rounded border text-[9px] uppercase tracking-wider font-semibold ${b.cls}`}>
                        {b.label}
                      </div>
                      {m.shipDate && (
                        <div className="text-[10px] text-amber-300/80 mt-1 flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5" />
                          {m.shipDate}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              {error && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-xs">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {/* Selected method detail */}
              <div className="rounded-xl bg-black/20 border border-white/10 p-4 space-y-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-fuchsia-500/15 border border-fuchsia-500/30 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-5 h-5 text-fuchsia-300" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h3 className="text-base font-bold text-white">{method.label}</h3>
                      <span className={`px-2 py-0.5 rounded-full border text-[10px] uppercase tracking-wider font-semibold ${badge.cls}`}>
                        {badge.label}
                      </span>
                      {method.shipDate && (
                        <span className="text-[11px] text-amber-300/80 flex items-center gap-1">
                          <Clock className="w-3 h-3" /> ships {method.shipDate}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400">{method.tagline}</p>
                  </div>
                </div>

                {/* At-a-glance stats */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                  <Stat label="Customer effort"  value={method.customerEffort} />
                  <Stat label="Reliability"      value={method.reliability} />
                  <Stat label="Cost"             value={method.cost} />
                  <Stat label="Fully remote"     value={method.fullyRemote ? 'Yes' : 'Needs venue device'} />
                </div>

                {/* Best for */}
                <div className="text-xs text-gray-300 leading-relaxed border-l-2 border-fuchsia-500/30 pl-3 italic">
                  {method.bestFor}
                </div>

                {/* Step-by-step */}
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-2">
                    Setup steps
                  </div>
                  <ol className="space-y-2">
                    {method.steps.map((s, i) => (
                      <li key={i} className="flex gap-3">
                        <span className="flex-shrink-0 w-5 h-5 rounded-full bg-fuchsia-500/20 border border-fuchsia-500/40 text-fuchsia-300 text-[10px] font-bold flex items-center justify-center mt-0.5">
                          {i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-semibold text-white">{s.title}</div>
                          <div className="text-[11px] text-gray-400 leading-relaxed mt-0.5">{s.body}</div>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>

                {/* Pros / Cons */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-emerald-400 font-semibold mb-1.5">
                      Pros
                    </div>
                    <ul className="space-y-1">
                      {method.pros.map((p, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-[11px] text-gray-300">
                          <CheckCircle2 className="w-3 h-3 text-emerald-400 mt-0.5 flex-shrink-0" />
                          <span>{p}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold mb-1.5">
                      Tradeoffs
                    </div>
                    <ul className="space-y-1">
                      {method.cons.map((p, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-[11px] text-gray-300">
                          <AlertTriangle className="w-3 h-3 text-amber-400 mt-0.5 flex-shrink-0" />
                          <span>{p}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/[0.02] border border-white/5 p-2">
      <div className="text-[9px] uppercase tracking-wider text-gray-500 font-semibold mb-0.5">
        {label}
      </div>
      <div className="text-[11px] text-white">{value}</div>
    </div>
  );
}

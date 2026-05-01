/**
 * DropletPanel — per-venue worker droplet status + provisioning.
 *
 * Originally inline in VenuesManagement.tsx; extracted so the new
 * VenueDetail page can render the same widget without code duplication.
 *
 * State machine:
 *   none           → "Provision Droplet" button
 *   provisioning   → spinner + "Booting…" (auto-polls every 8s)
 *   active         → IP badge + "Switch droplet" + "Destroy" buttons
 *   failed/unknown → error state with retry
 */

import { useEffect, useState } from 'react';
import { Server, Loader2, Copy, Trash2, ArrowLeftRight } from 'lucide-react';
import adminService from '../../services/admin.service';
import { SwitchDropletModal } from './SwitchDropletModal';

export interface DropletPanelProps {
  venueId: string;
  venueName: string;
}

interface DropletState {
  dropletStatus: string;
  dropletId?: number;
  dropletIp?: string;
  dropletRegion?: string;
  dropletSize?: string;
  provisionedAt?: string;
  // Set by the Lambda when DDB has the droplet wired but the live DO call
  // failed (e.g. DO_API_TOKEN not configured). Surface so the admin knows
  // the IP/region shown is from our cache, not a fresh DO read.
  doApiError?: string;
}

export function DropletPanel({ venueId, venueName }: DropletPanelProps) {
  const [state, setState] = useState<DropletState | null>(null);
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showSwitch, setShowSwitch] = useState(false);

  // Initial fetch + polling while provisioning.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const data = await adminService.getDroplet(venueId);
        if (cancelled) return;
        setState(data);
        setError(null);
        // Poll faster while provisioning, slower when steady.
        const next = data.dropletStatus === 'provisioning' ? 8000 : 60000;
        timer = setTimeout(tick, next);
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
        timer = setTimeout(tick, 30000);
      }
    };
    tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [venueId]);

  const handleProvision = async () => {
    if (!confirm(`Provision a new DigitalOcean droplet for "${venueName}"?\n\n`
      + `This creates a $42/mo CPU-Optimized droplet (2 vCPU / 4 GB) in TOR1 `
      + `from the master snapshot, auto-configured with VS_VENUE_ID=${venueId}. `
      + `Takes ~3-5 min to boot.`)) return;
    setBusy(true);
    setError(null);
    try {
      const data = await adminService.provisionDroplet(venueId);
      setState({ ...state, ...data });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleDestroy = async () => {
    const conf = prompt(`Destroy droplet for "${venueName}"?\n\n`
      + `This permanently deletes the DO droplet. The venue's worker will go `
      + `offline. Type DESTROY to confirm:`);
    if (conf !== 'DESTROY') return;
    setBusy(true);
    setError(null);
    try {
      await adminService.destroyDroplet(venueId);
      setState({ dropletStatus: 'none' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copyIp = async () => {
    if (!state?.dropletIp) return;
    try {
      await navigator.clipboard.writeText(state.dropletIp);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  const status = state?.dropletStatus || 'loading';

  return (
    <div className="mt-3 pt-3 border-t border-white/5">
      <div className="flex items-center gap-2 text-xs text-gray-400 mb-2">
        <Server className="w-3.5 h-3.5" />
        <span className="uppercase tracking-wider font-semibold">Worker Droplet</span>
      </div>
      {status === 'loading' && (
        <div className="text-xs text-gray-500 flex items-center gap-2">
          <Loader2 className="w-3 h-3 animate-spin" /> checking…
        </div>
      )}
      {status === 'none' && (
        <button
          onClick={handleProvision}
          disabled={busy}
          className="btn-primary text-sm flex items-center gap-2 disabled:opacity-60"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Server className="w-4 h-4" />}
          {busy ? 'Provisioning…' : 'Provision Droplet'}
        </button>
      )}
      {status === 'provisioning' && (
        <div className="text-sm text-amber-300 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          Booting droplet {state?.dropletId} in {state?.dropletRegion || '…'}
          <span className="text-xs text-gray-500">(auto-refresh every 8s)</span>
        </div>
      )}
      {(status === 'active' || status === 'new') && state?.dropletIp && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm flex-wrap">
            <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 text-xs font-semibold border border-emerald-500/30">
              ACTIVE
            </span>
            <span className="text-gray-300 font-mono">{state.dropletIp}</span>
            <button
              onClick={copyIp}
              className="text-xs text-gray-500 hover:text-gray-300 inline-flex items-center gap-1"
              title="Copy IP"
            >
              <Copy className="w-3 h-3" /> {copied ? 'copied!' : 'copy'}
            </button>
            <span className="text-xs text-gray-500">
              {state.dropletRegion} · {state.dropletSize} · id={state.dropletId}
            </span>
          </div>
          <div className="text-[11px] text-amber-300/80">
            Add this IP to the venue's NVR allowlist before cameras will stream.
          </div>
          {state?.doApiError && (
            <div className="text-[11px] text-amber-300/80 flex items-start gap-1">
              <span className="font-semibold">cached:</span>
              <span>live DO lookup failed — values shown are from our DDB record.
                {state.doApiError.includes('DO_API_TOKEN') && ' Set DO_API_TOKEN on the Lambda to refresh.'}</span>
            </div>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setShowSwitch(true)}
              disabled={busy}
              className="btn-secondary text-xs flex items-center gap-1 text-amber-300 border-amber-500/30 hover:bg-amber-500/10 disabled:opacity-60"
              title="Move this venue to a different droplet (provision new, resize, or pull from junk pool)"
            >
              <ArrowLeftRight className="w-3 h-3" /> Switch droplet
            </button>
            <button
              onClick={handleDestroy}
              disabled={busy}
              className="btn-secondary text-xs flex items-center gap-1 text-red-400 border-red-500/30 hover:bg-red-500/10 disabled:opacity-60"
            >
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
              Destroy droplet
            </button>
          </div>
        </div>
      )}
      {showSwitch && state?.dropletIp && (
        <SwitchDropletModal
          venueId={venueId}
          venueName={venueName}
          currentDropletId={state.dropletId!}
          currentDropletIp={state.dropletIp}
          onClose={() => setShowSwitch(false)}
          onComplete={() => { setShowSwitch(false); /* parent useEffect re-polls */ }}
        />
      )}
      {status !== 'loading' && status !== 'none' && status !== 'provisioning' && status !== 'active' && status !== 'new' && (
        <div className="text-xs text-red-300/80">
          status: {status}
        </div>
      )}
      {error && (
        <div className="text-[11px] text-red-300/80 mt-2">{error}</div>
      )}
    </div>
  );
}

export default DropletPanel;

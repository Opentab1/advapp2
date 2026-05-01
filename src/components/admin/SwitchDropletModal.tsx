/**
 * SwitchDropletModal — multi-stage UI for migrating a venue between droplets.
 *
 * Stages:
 *   1. Pick mode: provision new / resize in place / pull from junk pool
 *   2. Mode-specific config (size + region picker, droplet picker, etc.)
 *   3. Reachability gate — operator updates venue router NVR allowlist for the
 *      new droplet IP, then clicks "Test reachability". DDB doesn't flip until
 *      this passes (unless it's a resize, which keeps the same IP and skips).
 *   4. Old-droplet disposition: park / move-to-other-venue / destroy.
 *
 * Bar/table zone configs live in DDB (per-camera records), not on the droplet
 * disk, so they survive any switch automatically — no migration logic.
 */

import { useEffect, useState } from 'react';
import { X, Loader2, ArrowRight, CheckCircle2, AlertTriangle } from 'lucide-react';
import adminService from '../../services/admin.service';

type Mode = 'provision' | 'resize' | 'reassign';
type Stage = 'pick' | 'config' | 'reachability' | 'dispose' | 'done';

interface JunkDroplet {
  dropletId:  number;
  ip:         string;
  region:     string;
  sizeSlug:   string;
  monthlyUsd: number | null;
}

interface VenueLite { venueId: string; venueName?: string; }

export interface SwitchDropletModalProps {
  venueId:          string;
  venueName:        string;
  currentDropletId: number;
  currentDropletIp: string;
  onClose:          () => void;
  onComplete:       () => void;
}

const SIZE_OPTIONS = [
  { slug: 's-2vcpu-4gb',   label: '2 vCPU / 4 GB / 80 GB',  monthly: 24 },
  { slug: 's-4vcpu-8gb',   label: '4 vCPU / 8 GB / 160 GB', monthly: 48, recommended: true },
  { slug: 'c-2',           label: 'CPU-Opt 2 vCPU / 4 GB',  monthly: 42 },
  { slug: 'c-4',           label: 'CPU-Opt 4 vCPU / 8 GB',  monthly: 84 },
];
const REGION_OPTIONS = [
  { slug: 'nyc1', label: 'New York 1' },
  { slug: 'nyc3', label: 'New York 3' },
  { slug: 'tor1', label: 'Toronto' },
  { slug: 'sfo3', label: 'San Francisco 3' },
];

export function SwitchDropletModal({
  venueId, venueName, currentDropletId, currentDropletIp,
  onClose, onComplete,
}: SwitchDropletModalProps) {
  const [stage,  setStage]  = useState<Stage>('pick');
  const [mode,   setMode]   = useState<Mode>('provision');
  const [busy,   setBusy]   = useState(false);
  const [err,    setErr]    = useState<string | null>(null);
  const [info,   setInfo]   = useState<string | null>(null);
  const [force,  setForce]  = useState(false);

  // provision config
  const [size,   setSize]   = useState('s-4vcpu-8gb');
  const [region, setRegion] = useState('nyc3');

  // reassign config
  const [junk,   setJunk]   = useState<JunkDroplet[] | null>(null);
  const [pickedJunkId, setPickedJunkId] = useState<number | null>(null);

  // post-switch state
  const [newDropletId, setNewDropletId] = useState<number | null>(null);
  const [newDropletIp, setNewDropletIp] = useState<string>('');
  const [oldDropletId, setOldDropletId] = useState<number | null>(currentDropletId);

  // reachability test
  const [reachOk,    setReachOk]    = useState<boolean | null>(null);
  const [reachMsg,   setReachMsg]   = useState<string>('');
  const [nvrIp,      setNvrIp]      = useState<string>('');
  const [nvrPort,    setNvrPort]    = useState<string>('');

  // disposition
  const [dispose,    setDispose]    = useState<'park' | 'destroy' | 'move' | ''>('');
  const [moveTarget, setMoveTarget] = useState<string>('');
  const [allVenues,  setAllVenues]  = useState<VenueLite[]>([]);

  // Pull junk pool when reassign is picked
  useEffect(() => {
    if (mode !== 'reassign' || stage !== 'config') return;
    let cancelled = false;
    (async () => {
      try {
        const data = await adminService.listDroplets();
        if (cancelled) return;
        setJunk(data.droplets.filter(d => d.role === 'junk').map(d => ({
          dropletId: d.dropletId, ip: d.ip, region: d.region,
          sizeSlug: d.sizeSlug, monthlyUsd: d.monthlyUsd,
        })));
      } catch (e: any) { setErr(e.message || 'Failed to load droplets'); }
    })();
    return () => { cancelled = true; };
  }, [mode, stage]);

  // Pull venue list when 'move to another venue' is the chosen disposition
  useEffect(() => {
    if (dispose !== 'move' || allVenues.length) return;
    (async () => {
      try {
        const list = await adminService.listVenues?.();
        if (Array.isArray(list)) {
          setAllVenues(list
            .filter((v: any) => v.venueId && v.venueId !== venueId)
            .map((v: any) => ({ venueId: v.venueId, venueName: v.venueName })));
        }
      } catch { /* ignore — user can type venueId manually if needed */ }
    })();
  }, [dispose, venueId, allVenues.length]);

  const beginSwitch = async () => {
    setBusy(true); setErr(null); setInfo(null);
    try {
      const args: any = { mode, force };
      if (mode === 'provision') { args.size = size; args.region = region; }
      if (mode === 'resize')    { args.size = size; }
      if (mode === 'reassign')  { args.dropletId = pickedJunkId; }

      const res = await adminService.switchDroplet(venueId, args);
      // Resize keeps the same IP — skip reachability gate, go straight to done.
      if (mode === 'resize') {
        setInfo(res.msg || 'Resize queued.');
        setStage('done');
        return;
      }
      setNewDropletId(res.newDropletId || null);
      setNewDropletIp(res.newDropletIp || '');
      setOldDropletId(res.oldDropletId || currentDropletId);
      setStage('reachability');
    } catch (e: any) {
      const msg = e.message || 'Switch failed';
      // 423 = open hours guard. Surface the force toggle.
      if (msg.includes('business hours')) {
        setErr(msg + ' (toggle "force" below to override)');
      } else { setErr(msg); }
    } finally { setBusy(false); }
  };

  const runReachability = async () => {
    if (!newDropletId) return;
    if (!nvrIp.trim() || !nvrPort.trim()) {
      setErr('Enter NVR IP and port to test');
      return;
    }
    setBusy(true); setErr(null);
    try {
      const r = await adminService.testDropletReachability(newDropletId, {
        ip: nvrIp.trim(), port: nvrPort.trim(), totalChannels: 1,
      });
      setReachOk(r.ok);
      setReachMsg(r.msg);
    } catch (e: any) {
      setReachOk(false);
      setReachMsg(e.message || 'reachability check failed');
    } finally { setBusy(false); }
  };

  const goToDispose = () => {
    if (!oldDropletId || mode === 'resize') {
      // Resize doesn't free up an old droplet
      setStage('done'); onComplete(); return;
    }
    setStage('dispose');
  };

  const executeDisposition = async () => {
    if (!oldDropletId || !dispose) return;
    setBusy(true); setErr(null);
    try {
      if (dispose === 'park') {
        await adminService.parkDroplet(oldDropletId);
      } else if (dispose === 'move') {
        if (!moveTarget) { setErr('pick a target venue'); setBusy(false); return; }
        await adminService.assignDroplet(oldDropletId, moveTarget);
      } else if (dispose === 'destroy') {
        // Destroy uses the venue-scoped endpoint — but we already detached the
        // venue. Easier to call DO directly via the parkDroplet then a manual
        // DO destroy. Simplest for v1: park it, operator can hit destroy in
        // the Droplet Pool UI when ready.
        // NOTE: explicit 'destroy old droplet' API is a TODO; for now we park
        // it so it stops billing-relevant work and the operator deletes from DO.
        await adminService.parkDroplet(oldDropletId);
        setInfo('Old droplet parked. Manual destroy via DO console for now (clean destroy API arrives next iteration).');
      }
      setStage('done');
      onComplete();
    } catch (e: any) {
      setErr(e.message || 'Disposition failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-white/10 rounded-lg w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div>
            <h3 className="text-white font-semibold">Switch droplet — {venueName}</h3>
            <p className="text-xs text-gray-500">
              Current: id={currentDropletId} · {currentDropletIp}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Stage indicator */}
          <div className="flex items-center gap-2 text-xs text-gray-500">
            {(['pick','config','reachability','dispose','done'] as Stage[]).map((s, i, arr) => (
              <span key={s} className="flex items-center gap-2">
                <span className={s === stage ? 'text-white font-semibold' :
                                 (arr.indexOf(stage) > i ? 'text-emerald-400' : '')}>
                  {s}
                </span>
                {i < arr.length - 1 && <ArrowRight className="w-3 h-3" />}
              </span>
            ))}
          </div>

          {err && (
            <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded p-2 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{err}</span>
            </div>
          )}
          {info && (
            <div className="text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded p-2">
              {info}
            </div>
          )}

          {/* Stage 1 — Pick mode */}
          {stage === 'pick' && (
            <div className="space-y-2">
              {([
                ['provision', 'Provision new droplet', 'Spin up a fresh droplet for this venue. Different IP — venue router NVR allowlist must be updated.'],
                ['resize',    'Resize in place',         'Keep same droplet & IP, change DO plan (e.g., upgrade to 4 vCPU / 8 GB). No router work needed.'],
                ['reassign',  'Pull from junk pool',     'Re-bind a parked droplet to this venue. Different IP — router work needed.'],
              ] as Array<[Mode, string, string]>).map(([m, title, desc]) => (
                <button key={m} onClick={() => setMode(m)}
                  className={`w-full text-left p-3 rounded border ${
                    mode === m ? 'border-amber-500 bg-amber-500/10' : 'border-white/10 hover:border-white/30'
                  }`}>
                  <div className="text-white font-medium">{title}</div>
                  <div className="text-xs text-gray-400 mt-1">{desc}</div>
                </button>
              ))}
              <label className="flex items-center gap-2 text-xs text-gray-400 mt-2">
                <input type="checkbox" checked={force} onChange={e => setForce(e.target.checked)} />
                Force during venue open hours (use only if operator is OK with brief downtime)
              </label>
              <button onClick={() => setStage('config')} className="btn-primary w-full mt-2">
                Continue → {mode}
              </button>
            </div>
          )}

          {/* Stage 2 — Config */}
          {stage === 'config' && mode === 'provision' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Size</label>
                <select value={size} onChange={e => setSize(e.target.value)}
                        className="w-full bg-gray-800 border border-white/10 rounded px-2 py-1 text-sm text-white">
                  {SIZE_OPTIONS.map(o => (
                    <option key={o.slug} value={o.slug}>
                      {o.label} — ${o.monthly}/mo{o.recommended ? ' (recommended)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Region</label>
                <select value={region} onChange={e => setRegion(e.target.value)}
                        className="w-full bg-gray-800 border border-white/10 rounded px-2 py-1 text-sm text-white">
                  {REGION_OPTIONS.map(o => <option key={o.slug} value={o.slug}>{o.label}</option>)}
                </select>
              </div>
              <button onClick={beginSwitch} disabled={busy} className="btn-primary w-full">
                {busy ? <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> : null}
                Provision new droplet
              </button>
            </div>
          )}

          {stage === 'config' && mode === 'resize' && (
            <div className="space-y-3">
              <div className="text-xs text-gray-400">
                Resizing keeps the same IP ({currentDropletIp}). Droplet will reboot
                during the resize (~1 min downtime). Worker auto-starts on boot.
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">New size</label>
                <select value={size} onChange={e => setSize(e.target.value)}
                        className="w-full bg-gray-800 border border-white/10 rounded px-2 py-1 text-sm text-white">
                  {SIZE_OPTIONS.map(o => (
                    <option key={o.slug} value={o.slug}>
                      {o.label} — ${o.monthly}/mo
                    </option>
                  ))}
                </select>
              </div>
              <button onClick={beginSwitch} disabled={busy} className="btn-primary w-full">
                {busy ? <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> : null}
                Resize droplet
              </button>
            </div>
          )}

          {stage === 'config' && mode === 'reassign' && (
            <div className="space-y-3">
              {!junk && <div className="text-sm text-gray-400 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading junk pool…
              </div>}
              {junk && junk.length === 0 && (
                <div className="text-sm text-gray-400">
                  No droplets in the junk pool. Park another venue's droplet first to populate the pool.
                </div>
              )}
              {junk && junk.map(d => (
                <button key={d.dropletId} onClick={() => setPickedJunkId(d.dropletId)}
                  className={`w-full text-left p-3 rounded border ${
                    pickedJunkId === d.dropletId ? 'border-amber-500 bg-amber-500/10' : 'border-white/10 hover:border-white/30'
                  }`}>
                  <div className="text-white font-mono text-sm">{d.ip} <span className="text-gray-500">id={d.dropletId}</span></div>
                  <div className="text-xs text-gray-400 mt-1">
                    {d.region} · {d.sizeSlug} · {d.monthlyUsd != null ? `$${d.monthlyUsd}/mo` : 'price ?'}
                  </div>
                </button>
              ))}
              {junk && junk.length > 0 && (
                <button onClick={beginSwitch} disabled={busy || !pickedJunkId} className="btn-primary w-full">
                  {busy ? <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> : null}
                  Reassign selected droplet
                </button>
              )}
            </div>
          )}

          {/* Stage 3 — Reachability gate */}
          {stage === 'reachability' && (
            <div className="space-y-3">
              <div className="text-sm text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded p-3">
                <div className="font-semibold mb-1">⚠️ Action required at venue:</div>
                <div className="text-xs">
                  Add this new droplet IP to the venue router's NVR allowlist
                  (or replace the old one):
                </div>
                <div className="font-mono text-white text-base mt-2">{newDropletIp || '(provisioning…)'}</div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input type="text" placeholder="NVR IP" value={nvrIp}
                       onChange={e => setNvrIp(e.target.value)}
                       className="bg-gray-800 border border-white/10 rounded px-2 py-1 text-sm text-white" />
                <input type="text" placeholder="NVR port" value={nvrPort}
                       onChange={e => setNvrPort(e.target.value)}
                       className="bg-gray-800 border border-white/10 rounded px-2 py-1 text-sm text-white" />
              </div>
              <button onClick={runReachability} disabled={busy || !newDropletIp}
                      className="btn-primary w-full">
                {busy ? <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> : null}
                Test reachability
              </button>
              {reachOk === true && (
                <div className="text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded p-2 flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <div>
                    <div>{reachMsg}</div>
                    <button onClick={goToDispose} className="btn-primary text-xs mt-2">
                      Continue → handle old droplet
                    </button>
                  </div>
                </div>
              )}
              {reachOk === false && (
                <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded p-2">
                  {reachMsg}. Update the venue router allowlist and retry.
                </div>
              )}
              <div className="pt-2 mt-2 border-t border-white/5">
                <button onClick={goToDispose}
                        className="w-full text-xs text-gray-400 hover:text-amber-300 underline underline-offset-2">
                  Skip reachability check and continue →
                </button>
                <div className="text-[10px] text-gray-500 mt-1 text-center">
                  Use only if you know the new droplet will reach cameras (e.g., you'll fix allowlist after).
                </div>
              </div>
            </div>
          )}

          {/* Stage 4 — Old droplet disposition */}
          {stage === 'dispose' && oldDropletId && (
            <div className="space-y-3">
              <div className="text-sm text-gray-300">
                What should happen to the old droplet (id={oldDropletId})?
              </div>
              <div className="space-y-2">
                {([
                  ['park',    'Park in junk pool', 'Stops worker, droplet stays running on DO ($$ continues), ready for re-assignment in seconds.'],
                  ['move',    'Move to another venue', 'Re-bind to a different venue right now.'],
                  ['destroy', 'Destroy', 'Permanently delete from DigitalOcean. Stops billing for it.'],
                ] as Array<['park'|'move'|'destroy', string, string]>).map(([k, t, d]) => (
                  <button key={k} onClick={() => setDispose(k)}
                    className={`w-full text-left p-3 rounded border ${
                      dispose === k ? 'border-amber-500 bg-amber-500/10' : 'border-white/10 hover:border-white/30'
                    }`}>
                    <div className="text-white font-medium">{t}</div>
                    <div className="text-xs text-gray-400 mt-1">{d}</div>
                  </button>
                ))}
              </div>
              {dispose === 'move' && (
                <select value={moveTarget} onChange={e => setMoveTarget(e.target.value)}
                        className="w-full bg-gray-800 border border-white/10 rounded px-2 py-1 text-sm text-white">
                  <option value="">— pick target venue —</option>
                  {allVenues.map(v => (
                    <option key={v.venueId} value={v.venueId}>
                      {v.venueName || v.venueId}
                    </option>
                  ))}
                </select>
              )}
              <button onClick={executeDisposition} disabled={busy || !dispose}
                      className="btn-primary w-full">
                {busy ? <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> : null}
                Apply disposition
              </button>
            </div>
          )}

          {/* Stage 5 — Done */}
          {stage === 'done' && (
            <div className="space-y-3">
              <div className="text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded p-3 flex items-start gap-2">
                <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold">Switch complete</div>
                  <div className="text-xs mt-1">{info || 'Venue is now bound to the new droplet. Camera/zone configs preserved (DDB-resident).'}</div>
                </div>
              </div>
              <button onClick={onClose} className="btn-primary w-full">Close</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default SwitchDropletModal;

/**
 * DropletPool — admin's complete view of every DigitalOcean droplet we own.
 *
 * Each row shows full DO specs (vCPU, RAM, disk, region, $/mo, status),
 * its role in our system (assigned to a venue / parked in junk / orphan),
 * and per-row actions (Park / Assign-to-venue / Destroy). Total monthly
 * cost is summed at the top.
 *
 * "Orphan" = running on DO but no venue references it AND no
 * `venuescope-parked` tag. Indicates either leftover infra (e.g. a probe
 * droplet from debugging) or a deliberately-running snapshot reference.
 * Operator can park orphans into the junk pool or destroy them.
 *
 * This page is the source of truth for droplet ↔ venue assignments. The
 * per-venue Worker Droplet panel reflects the same data, scoped to one
 * venue.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Server, Loader2, RefreshCw, Trash2, ArrowRightLeft, Archive, Cpu,
  HardDrive, MemoryStick, MapPin, DollarSign, Tag, AlertTriangle, CheckCircle2,
} from 'lucide-react';
import adminService from '../../services/admin.service';

interface Droplet {
  dropletId:         number;
  name:              string;
  status:            string;
  sizeSlug:          string;
  monthlyUsd:        number | null;
  region:            string;
  regionName:        string;
  ip:                string;
  tags:              string[];
  role:              'assigned' | 'junk' | 'orphan';
  assignedVenueId:   string | null;
  assignedVenueName: string | null;
  vcpus:             number;
  memoryMb:          number;
  diskGb:            number;
  kernel:            string;
  image:             string;
  backupsEnabled:    boolean;
  monitoring:        boolean;
  createdAt:         string;
}

interface VenueLite { venueId: string; venueName?: string; }

const ROLE_STYLE: Record<Droplet['role'], string> = {
  assigned: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  junk:     'bg-amber-500/15  text-amber-300  border-amber-500/30',
  orphan:   'bg-red-500/15    text-red-300    border-red-500/30',
};
const ROLE_LABEL: Record<Droplet['role'], string> = {
  assigned: 'ASSIGNED',
  junk:     'JUNK POOL',
  orphan:   'ORPHAN',
};
const ROLE_HINT: Record<Droplet['role'], string> = {
  assigned: 'Bound to a venue; serving its worker.',
  junk:     'Parked, worker stopped, ready for re-assignment.',
  orphan:   'Running but unaccounted for — park or destroy to fix.',
};

function fmtBytes(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB`;
  return `${mb} MB`;
}
function fmtAge(iso: string): string {
  if (!iso) return '?';
  const d = (Date.now() - new Date(iso).getTime()) / 86400000;
  if (d < 1) return `${Math.floor(d * 24)}h ago`;
  if (d < 30) return `${Math.floor(d)}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

export default function DropletPool() {
  const [droplets, setDroplets] = useState<Droplet[] | null>(null);
  const [counts,   setCounts]   = useState({ total: 0, assigned: 0, junk: 0, orphan: 0 });
  const [monthly,  setMonthly]  = useState(0);
  const [loading,  setLoading]  = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const [busyId,   setBusyId]   = useState<number | null>(null);
  const [actionMsg, setActionMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [venues,   setVenues]   = useState<VenueLite[]>([]);

  // Filters
  const [roleFilter, setRoleFilter] = useState<'all' | Droplet['role']>('all');

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const data = await adminService.listDroplets();
      setDroplets(data.droplets);
      setCounts(data.counts);
      setMonthly(data.monthlyUsd);
    } catch (e: any) {
      setError(e.message || 'Failed to load droplets');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    // Pre-load venue list for the "assign" action picker
    adminService.listVenues?.().then(vs => {
      if (Array.isArray(vs)) {
        setVenues(vs.map((v: any) => ({ venueId: v.venueId, venueName: v.venueName })));
      }
    }).catch(() => { /* ignore */ });
  }, []);

  const visible = useMemo(() => {
    if (!droplets) return [];
    if (roleFilter === 'all') return droplets;
    return droplets.filter(d => d.role === roleFilter);
  }, [droplets, roleFilter]);

  const handlePark = async (d: Droplet) => {
    if (d.role === 'assigned') {
      const ok = confirm(
        `Park droplet ${d.dropletId} (${d.ip})?\n\n` +
        `This will:\n` +
        `  • Stop the worker on this droplet\n` +
        `  • Detach venue "${d.assignedVenueName || d.assignedVenueId}" from it\n` +
        `  • Move the droplet into the junk pool ($${d.monthlyUsd}/mo continues)\n\n` +
        `The venue will have no worker until you assign a different droplet.\n` +
        `Continue?`);
      if (!ok) return;
    }
    setBusyId(d.dropletId); setActionMsg(null);
    try {
      const r = await adminService.parkDroplet(d.dropletId);
      setActionMsg({ ok: true, text: `Parked ${d.dropletId} (${d.ip})` +
        (r.parkedFromVenue ? ` from venue ${r.parkedFromVenue}` : '') });
      await load(true);
    } catch (e: any) {
      setActionMsg({ ok: false, text: e.message || 'Park failed' });
    } finally { setBusyId(null); }
  };

  const handleAssign = async (d: Droplet) => {
    const venuePick = prompt(
      `Assign droplet ${d.dropletId} (${d.ip}) to which venue?\n\n` +
      `Available venues:\n` +
      venues.map(v => `  • ${v.venueId}${v.venueName ? '  — ' + v.venueName : ''}`).join('\n') +
      `\n\nType the venueId (slug, lowercase):`);
    if (!venuePick) return;
    const target = venuePick.trim().toLowerCase();
    if (!venues.some(v => v.venueId === target)) {
      if (!confirm(`Venue "${target}" not in the loaded list. Assign anyway?`)) return;
    }
    setBusyId(d.dropletId); setActionMsg(null);
    try {
      await adminService.assignDroplet(d.dropletId, target);
      setActionMsg({ ok: true, text: `Assigned ${d.dropletId} to venue ${target}` });
      await load(true);
    } catch (e: any) {
      setActionMsg({ ok: false, text: e.message || 'Assign failed' });
    } finally { setBusyId(null); }
  };

  const handleDestroy = async (d: Droplet) => {
    if (d.role === 'assigned') {
      alert(`Cannot destroy assigned droplet ${d.dropletId}.\n\n` +
            `Use Switch Droplet on the venue page to migrate "${d.assignedVenueName}" first, ` +
            `then destroy from the pool.`);
      return;
    }
    const conf = prompt(
      `Permanently destroy droplet ${d.dropletId} (${d.ip})?\n\n` +
      `Type DESTROY to confirm. This is irreversible.`);
    if (conf !== 'DESTROY') return;
    setBusyId(d.dropletId); setActionMsg(null);
    try {
      const r = await adminService.destroyOrphanDroplet(d.dropletId);
      setActionMsg({ ok: true, text: r.alreadyGone
        ? `Droplet ${d.dropletId} already gone on DO; row removed.`
        : `Destroyed ${d.dropletId} (${d.ip}). Saves $${d.monthlyUsd ?? '?'}/mo.` });
      await load(true);
    } catch (e: any) {
      setActionMsg({ ok: false, text: e.message || 'Destroy failed' });
    } finally { setBusyId(null); }
  };

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 space-y-4 text-gray-200">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-white flex items-center gap-2">
            <Server className="w-6 h-6 text-amber-300" />
            Droplet Pool
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            Every DigitalOcean droplet we own. Monthly cost reflects DO billing
            regardless of whether a droplet is doing useful work.
          </p>
        </div>
        <button onClick={() => { setRefreshing(true); load(true); }}
                disabled={refreshing}
                className="btn-secondary text-sm flex items-center gap-2">
          {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Refresh
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Total" value={String(counts.total)} sub="droplets" />
        <StatCard label="Assigned"  value={String(counts.assigned)} sub="bound to venues"
                  styleClass="text-emerald-300" />
        <StatCard label="Junk pool" value={String(counts.junk)} sub="parked, ready"
                  styleClass="text-amber-300" />
        <StatCard label="Orphan"    value={String(counts.orphan)} sub="needs attention"
                  styleClass={counts.orphan > 0 ? 'text-red-300' : ''} />
        <StatCard label="Monthly cost" value={`$${monthly}`} sub="all droplets"
                  styleClass="text-amber-300 font-mono" />
      </div>

      {/* Filter + action banner */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1 text-xs">
          {(['all','assigned','junk','orphan'] as const).map(f => (
            <button key={f} onClick={() => setRoleFilter(f)}
                    className={`px-2 py-1 rounded border ${
                      roleFilter === f
                        ? 'border-white text-white'
                        : 'border-white/10 text-gray-400 hover:border-white/30'
                    }`}>
              {f}{f !== 'all' && counts[f as 'assigned'|'junk'|'orphan'] !== undefined
                  ? ` (${counts[f as 'assigned'|'junk'|'orphan']})` : ''}
            </button>
          ))}
        </div>
        {actionMsg && (
          <div className={`text-xs flex items-center gap-1 ${
            actionMsg.ok ? 'text-emerald-300' : 'text-red-300'
          }`}>
            {actionMsg.ok ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
            {actionMsg.text}
          </div>
        )}
      </div>

      {error && (
        <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded p-3">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-2 text-gray-400 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading droplet pool…
        </div>
      )}

      {/* Empty state */}
      {!loading && visible.length === 0 && (
        <div className="text-sm text-gray-500 italic p-8 text-center border border-dashed border-white/10 rounded">
          No droplets match this filter.
        </div>
      )}

      {/* Table */}
      {!loading && visible.length > 0 && (
        <div className="overflow-x-auto border border-white/10 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-gray-900/60 text-xs uppercase text-gray-500">
              <tr>
                <th className="text-left p-3">Droplet</th>
                <th className="text-left p-3">Role</th>
                <th className="text-left p-3">Assigned to</th>
                <th className="text-left p-3">Specs</th>
                <th className="text-left p-3">Region</th>
                <th className="text-right p-3">$/mo</th>
                <th className="text-left p-3">DO status</th>
                <th className="text-left p-3">Created</th>
                <th className="text-right p-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {visible.map(d => (
                <tr key={d.dropletId} className="hover:bg-white/5">
                  <td className="p-3 align-top">
                    <div className="font-mono text-white">{d.ip || <span className="text-gray-500">—</span>}</div>
                    <div className="text-xs text-gray-500">{d.name}</div>
                    <div className="text-xs text-gray-600 mt-0.5">id={d.dropletId}</div>
                  </td>
                  <td className="p-3 align-top">
                    <span className={`px-2 py-0.5 rounded text-xs font-semibold border ${ROLE_STYLE[d.role]}`}
                          title={ROLE_HINT[d.role]}>
                      {ROLE_LABEL[d.role]}
                    </span>
                    {d.tags.length > 0 && (
                      <div className="text-[10px] text-gray-600 mt-1 flex items-center gap-1">
                        <Tag className="w-2.5 h-2.5" />
                        {d.tags.join(', ')}
                      </div>
                    )}
                  </td>
                  <td className="p-3 align-top text-xs">
                    {d.assignedVenueId
                      ? <div>
                          <div className="text-white">{d.assignedVenueName || d.assignedVenueId}</div>
                          <div className="text-gray-500 text-[11px] font-mono">{d.assignedVenueId}</div>
                        </div>
                      : <span className="text-gray-600">—</span>}
                  </td>
                  <td className="p-3 align-top">
                    <div className="text-xs text-gray-300 space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <Cpu className="w-3 h-3 text-gray-500" />{d.vcpus} vCPU
                      </div>
                      <div className="flex items-center gap-1.5">
                        <MemoryStick className="w-3 h-3 text-gray-500" />{fmtBytes(d.memoryMb)}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <HardDrive className="w-3 h-3 text-gray-500" />{d.diskGb} GB
                      </div>
                    </div>
                    <div className="text-[10px] text-gray-600 font-mono mt-1">{d.sizeSlug}</div>
                  </td>
                  <td className="p-3 align-top text-xs">
                    <div className="flex items-center gap-1 text-gray-300">
                      <MapPin className="w-3 h-3 text-gray-500" />{d.region}
                    </div>
                    <div className="text-[10px] text-gray-600">{d.regionName}</div>
                  </td>
                  <td className="p-3 align-top text-right font-mono text-amber-300">
                    {d.monthlyUsd != null ? `$${d.monthlyUsd}` : <span className="text-gray-600">?</span>}
                  </td>
                  <td className="p-3 align-top text-xs">
                    <span className={d.status === 'active' ? 'text-emerald-300'
                                    : d.status === 'off' ? 'text-amber-300'
                                    : 'text-red-300'}>
                      {d.status}
                    </span>
                  </td>
                  <td className="p-3 align-top text-xs text-gray-500" title={d.createdAt}>
                    {fmtAge(d.createdAt)}
                  </td>
                  <td className="p-3 align-top text-right">
                    <div className="inline-flex items-center gap-1">
                      {/* Park: only for assigned + orphan (junk is already parked) */}
                      {d.role !== 'junk' && (
                        <button onClick={() => handlePark(d)} disabled={busyId === d.dropletId}
                                className="px-2 py-1 text-xs rounded border border-amber-500/30 text-amber-300 hover:bg-amber-500/10 disabled:opacity-50 inline-flex items-center gap-1"
                                title="Stop worker, move to junk pool">
                          {busyId === d.dropletId ? <Loader2 className="w-3 h-3 animate-spin" /> : <Archive className="w-3 h-3" />}
                          Park
                        </button>
                      )}
                      {/* Assign: only for junk + orphan */}
                      {d.role !== 'assigned' && (
                        <button onClick={() => handleAssign(d)} disabled={busyId === d.dropletId}
                                className="px-2 py-1 text-xs rounded border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50 inline-flex items-center gap-1"
                                title="Bind this droplet to a venue">
                          {busyId === d.dropletId ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowRightLeft className="w-3 h-3" />}
                          Assign
                        </button>
                      )}
                      {/* Destroy: junk + orphan only; assigned must be migrated first */}
                      {d.role !== 'assigned' && (
                        <button onClick={() => handleDestroy(d)} disabled={busyId === d.dropletId}
                                className="px-2 py-1 text-xs rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 disabled:opacity-50 inline-flex items-center gap-1"
                                title={`Permanently delete (saves $${d.monthlyUsd}/mo)`}>
                          {busyId === d.dropletId ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                          Destroy
                        </button>
                      )}
                      {d.role === 'assigned' && (
                        <span className="text-[10px] text-gray-500 italic px-2">
                          migrate via venue page
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-900/40 text-xs">
              <tr>
                <td colSpan={5} className="p-3 text-gray-500">
                  {visible.length} of {counts.total} droplets · ${visible.reduce((s, d) => s + (d.monthlyUsd || 0), 0)}/mo for this view
                </td>
                <td colSpan={4} className="p-3 text-right text-amber-300 font-mono">
                  total fleet: ${monthly}/mo
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Operator hints */}
      <div className="text-xs text-gray-500 space-y-1 pt-2 border-t border-white/5">
        <div><span className="text-emerald-300 font-semibold">ASSIGNED</span> — bound to a venue. Migrate via that venue's "Switch droplet" button before destroying.</div>
        <div><span className="text-amber-300 font-semibold">JUNK POOL</span> — parked. Worker stopped, ready for fast re-assignment via the Assign action.</div>
        <div><span className="text-red-300 font-semibold">ORPHAN</span> — running but not tracked. Either park (move to junk) or destroy.</div>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, styleClass }: {
  label: string; value: string; sub?: string; styleClass?: string;
}) {
  return (
    <div className="bg-gray-900/60 border border-white/10 rounded-lg p-3">
      <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${styleClass || 'text-white'}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

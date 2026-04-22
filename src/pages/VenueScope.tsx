/**
 * VenueScope — CCTV Analytics Dashboard
 *
 * Owner-focused view: tonight's hero numbers → live room cameras →
 * bartender leaderboard → theft alerts → collapsed history.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Hls from 'hls.js';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Video, ShieldCheck, AlertTriangle, RefreshCw,
  Clock, User, BarChart3,
  Camera, Loader2, X, Download,
  ChevronDown, ChevronUp, FileText,
  Activity, Users, Zap, DollarSign, Calendar, TrendingUp,
  CreditCard, Edit2, Crosshair, Trash2, Check,
  ExternalLink, GlassWater, Filter,
} from 'lucide-react';
import authService from '../services/auth.service';
import venueScopeService, { VenueScopeJob, parseModes } from '../services/venuescope.service';
import sportsService from '../services/sports.service';
import { SportsGame } from '../types';
import venueSettingsService from '../services/venue-settings.service';
import { isDemoAccount, generateDemoVenueScopeJobs } from '../utils/demoData';
import cameraService, { Camera as CameraConfig } from '../services/camera.service';
import billingService, { BillingStatus } from '../services/billing.service';
import { PaywallOverlay, BillingBanner } from '../components/billing/PaywallOverlay';
import { pulseStore } from '../stores/pulseStore';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(ts: number): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function fmtDuration(created: number, finished: number): string {
  if (!created || !finished) return '—';
  const secs = Math.round(finished - created);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

function fmtElapsed(secs: number): string {
  if (!secs) return '';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function ConfidenceBadge({ color, label }: { color: string; label: string }) {
  const cls =
    color === 'green' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' :
    color === 'red'   ? 'bg-red-500/20 text-red-400 border-red-500/30' :
                        'bg-amber-500/20 text-amber-400 border-amber-500/30';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${cls}`}>
      <BarChart3 className="w-2.5 h-2.5" />
      {label || 'Unknown'}
    </span>
  );
}

// ── Bar zone config types ─────────────────────────────────────────────────────

interface BarLine {
  p1: [number, number];
  p2: [number, number];
  customer_side: 1 | -1;
}

interface BarStation {
  zone_id: string;
  label: string;
  polygon: [number, number][];       // normalized [0-1] x,y vertices
  bar_line_p1: [number, number];     // normalized start of primary bar line
  bar_line_p2: [number, number];     // normalized end of primary bar line
  customer_side: 1 | -1;            // +1 = below bar line, -1 = above
  extra_bar_lines?: BarLine[];       // additional crossing lines (same zone, different orientation)
}

interface BarConfig {
  stations: BarStation[];
}

function parseBarConfig(json: string | undefined): BarConfig | null {
  if (!json) return null;
  try { return JSON.parse(json) as BarConfig; } catch { return null; }
}

// ── Zone overlay (read-only SVG on live feed) ─────────────────────────────────

function ZoneOverlay({ config }: { config: BarConfig }) {
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
    >
      {config.stations.map((s, i) => (
        <g key={i}>
          {/* Zone polygon */}
          <polygon
            points={s.polygon.map(([x, y]) => `${x},${y}`).join(' ')}
            fill="rgba(0,200,160,0.12)"
            stroke="rgba(0,200,160,0.8)"
            strokeWidth="0.006"
          />
          {/* Primary bar line (orange dashed) */}
          <line
            x1={s.bar_line_p1[0]} y1={s.bar_line_p1[1]}
            x2={s.bar_line_p2[0]} y2={s.bar_line_p2[1]}
            stroke="rgba(255,140,0,0.9)"
            strokeWidth="0.007"
            strokeDasharray="0.025 0.012"
          />
          {/* Extra crossing lines (amber/yellow dashed) */}
          {(s.extra_bar_lines ?? []).map((bl, li) => (
            <line key={li}
              x1={bl.p1[0]} y1={bl.p1[1]}
              x2={bl.p2[0]} y2={bl.p2[1]}
              stroke="rgba(251,191,36,0.9)"
              strokeWidth="0.007"
              strokeDasharray="0.02 0.01"
            />
          ))}
        </g>
      ))}
    </svg>
  );
}

// ── Zone editor modal ─────────────────────────────────────────────────────────

type DragTarget =
  | { kind: 'barHandle';      stationIdx: number; handle: 'p1' | 'p2' }
  | { kind: 'extraBarHandle'; stationIdx: number; lineIdx: number; handle: 'p1' | 'p2' }
  | { kind: 'corner';         stationIdx: number; cornerIdx: number }
  | { kind: 'zone';           stationIdx: number; startPt: [number, number]; startPolygon: [number, number][]; startP1: [number, number]; startP2: [number, number] }
  | null;

function _ptInRect(pt: [number,number], poly: [number,number][]): boolean {
  const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
  return pt[0] >= Math.min(...xs) && pt[0] <= Math.max(...xs) &&
         pt[1] >= Math.min(...ys) && pt[1] <= Math.max(...ys);
}

function ZoneEditorModal({
  camera,
  proxyBase,
  onClose,
}: {
  camera: CameraConfig;
  proxyBase: string;
  onClose: () => void;
}) {
  // Default suggested zone — full bar width, bar line at 44% (overhead fisheye default)
  const suggestedConfig: BarConfig = {
    stations: [{
      zone_id:       'bar',
      label:         'Bar',
      polygon:       [[0.02, 0.06], [0.98, 0.06], [0.98, 0.49], [0.02, 0.49]],
      bar_line_p1:   [0.0, 0.44],
      bar_line_p2:   [1.0, 0.44],
      customer_side: 1,
    }],
  };
  const existing = parseBarConfig(camera.barConfigJson);
  const [config, setConfig]     = useState<BarConfig>(() => existing ?? suggestedConfig);
  // rect draw state: null = idle, [x,y] = anchor corner placed
  const [rectAnchor, setRectAnchor] = useState<[number, number] | null>(null);
  const [cursor, setCursor]         = useState<[number, number] | null>(null);
  const [dragTarget, setDragTarget] = useState<DragTarget>(null);
  const [saving, setSaving]         = useState(false);
  const [saveOk, setSaveOk]         = useState(false);
  // Start in 'done' if we have a zone (existing or suggested), 'draw' only if truly empty
  const [step, setStep]             = useState<'draw' | 'done'>(existing ? 'done' : 'done');
  const svgRef   = useRef<SVGSVGElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const editorHlsRef = useRef<Hls | null>(null);

  const isDrawing = rectAnchor !== null;

  const streamUrl = (() => {
    // Same routing logic as liveStreamUrl: proxy first, direct HTTPS fallback
    if (proxyBase) {
      const ch = channelFromSources(camera.name || '', camera.rtspUrl);
      if (ch) return `${proxyBase.replace(/\/$/, '')}/hls/live/${ch}/0/livetop.mp4`;
    }
    if (camera.rtspUrl?.startsWith('https://')) return camera.rtspUrl;
    return null;
  })();

  useEffect(() => {
    if (!streamUrl || !videoRef.current) return;
    const v = videoRef.current;
    if (editorHlsRef.current) { editorHlsRef.current.destroy(); editorHlsRef.current = null; }
    if (streamUrl.includes('.m3u8') && Hls.isSupported()) {
      const hls = new Hls({ liveSyncDurationCount: 1, lowLatencyMode: true });
      editorHlsRef.current = hls;
      hls.loadSource(streamUrl);
      hls.attachMedia(v);
      hls.on(Hls.Events.MANIFEST_PARSED, () => v.play().catch(() => {}));
    } else {
      // fMP4 direct stream — native video element handles this fine
      v.src = streamUrl;
      v.load();
      v.play().catch(() => {});
    }
    return () => {
      if (editorHlsRef.current) { editorHlsRef.current.destroy(); editorHlsRef.current = null; }
      v.src = '';
    };
  }, [streamUrl]);

  function getRelPt(e: React.MouseEvent<SVGSVGElement>): [number, number] {
    const r = svgRef.current!.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    return [x, y];
  }

  function handleSvgMouseDown(e: React.MouseEvent<SVGSVGElement>) {
    if (dragTarget) return;
    if (e.button !== 0) return;
    const pt = getRelPt(e);
    const HIT = 0.035; // normalized hit radius

    for (let i = 0; i < config.stations.length; i++) {
      const s = config.stations[i];

      // 1. Bar line handles — highest priority (primary + extra)
      if (Math.hypot(pt[0] - s.bar_line_p1[0], pt[1] - s.bar_line_p1[1]) < HIT) {
        setDragTarget({ kind: 'barHandle', stationIdx: i, handle: 'p1' });
        e.preventDefault(); return;
      }
      if (Math.hypot(pt[0] - s.bar_line_p2[0], pt[1] - s.bar_line_p2[1]) < HIT) {
        setDragTarget({ kind: 'barHandle', stationIdx: i, handle: 'p2' });
        e.preventDefault(); return;
      }
      for (let li = 0; li < (s.extra_bar_lines?.length ?? 0); li++) {
        const xl = s.extra_bar_lines![li];
        if (Math.hypot(pt[0] - xl.p1[0], pt[1] - xl.p1[1]) < HIT) {
          setDragTarget({ kind: 'extraBarHandle', stationIdx: i, lineIdx: li, handle: 'p1' });
          e.preventDefault(); return;
        }
        if (Math.hypot(pt[0] - xl.p2[0], pt[1] - xl.p2[1]) < HIT) {
          setDragTarget({ kind: 'extraBarHandle', stationIdx: i, lineIdx: li, handle: 'p2' });
          e.preventDefault(); return;
        }
      }

      // 2. Polygon corner handles
      for (let ci = 0; ci < s.polygon.length; ci++) {
        const [cx, cy] = s.polygon[ci];
        if (Math.hypot(pt[0] - cx, pt[1] - cy) < HIT) {
          setDragTarget({ kind: 'corner', stationIdx: i, cornerIdx: ci });
          e.preventDefault(); return;
        }
      }

      // 3. Polygon body — drag whole zone
      if (_ptInRect(pt, s.polygon)) {
        setDragTarget({
          kind: 'zone', stationIdx: i, startPt: pt,
          startPolygon: s.polygon.map(p => [...p] as [number, number]),
          startP1: [...s.bar_line_p1] as [number, number],
          startP2: [...s.bar_line_p2] as [number, number],
        });
        e.preventDefault(); return;
      }
    }

    // 4. Empty area — start rectangle draw
    setRectAnchor(pt);
    setCursor(pt);
  }

  function handleSvgMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const pt = getRelPt(e);
    setCursor(pt);
    if (!dragTarget) return;

    setConfig(c => ({
      stations: c.stations.map((s, i) => {
        if (i !== dragTarget.stationIdx) return s;

        if (dragTarget.kind === 'barHandle') {
          return { ...s, [dragTarget.handle === 'p1' ? 'bar_line_p1' : 'bar_line_p2']: pt };
        }

        if (dragTarget.kind === 'extraBarHandle') {
          const extras = [...(s.extra_bar_lines ?? [])];
          const xl = { ...extras[dragTarget.lineIdx] };
          if (dragTarget.handle === 'p1') xl.p1 = pt; else xl.p2 = pt;
          extras[dragTarget.lineIdx] = xl;
          return { ...s, extra_bar_lines: extras };
        }

        if (dragTarget.kind === 'corner') {
          const poly = s.polygon.map((p, ci) =>
            ci === dragTarget.cornerIdx ? pt : p
          ) as [number, number][];
          return { ...s, polygon: poly };
        }

        if (dragTarget.kind === 'zone') {
          const dx = pt[0] - dragTarget.startPt[0];
          const dy = pt[1] - dragTarget.startPt[1];
          const clamp = (v: number) => Math.max(0, Math.min(1, v));
          const poly = dragTarget.startPolygon.map(([px, py]) =>
            [clamp(px + dx), clamp(py + dy)] as [number, number]
          );
          return {
            ...s,
            polygon: poly,
            bar_line_p1: [clamp(dragTarget.startP1[0] + dx), clamp(dragTarget.startP1[1] + dy)] as [number, number],
            bar_line_p2: [clamp(dragTarget.startP2[0] + dx), clamp(dragTarget.startP2[1] + dy)] as [number, number],
            extra_bar_lines: (s.extra_bar_lines ?? []).map(xl => ({
              ...xl,
              p1: [clamp(xl.p1[0] + dx), clamp(xl.p1[1] + dy)] as [number, number],
              p2: [clamp(xl.p2[0] + dx), clamp(xl.p2[1] + dy)] as [number, number],
            })),
          };
        }

        return s;
      }),
    }));
  }

  function handleSvgMouseUp(e: React.MouseEvent<SVGSVGElement>) {
    if (dragTarget) { setDragTarget(null); return; }

    if (!rectAnchor) return;
    const pt = getRelPt(e);
    const [ax, ay] = rectAnchor;
    const x1 = Math.min(ax, pt[0]), x2 = Math.max(ax, pt[0]);
    const y1 = Math.min(ay, pt[1]), y2 = Math.max(ay, pt[1]);

    if (x2 - x1 < 0.05 || y2 - y1 < 0.05) { setRectAnchor(null); return; }

    const zoneW = x2 - x1;
    const zoneH = y2 - y1;
    // Bar line runs across the counter edge — horizontal when zone is wider than tall
    // (counter runs left-right), vertical when zone is taller than wide (counter runs top-bottom).
    const newBarP1: [number, number] = zoneW >= zoneH
      ? [x1, (y1 + y2) / 2]   // horizontal: left → right at mid-height
      : [(x1 + x2) / 2, y1];  // vertical: top → bottom at mid-width
    const newBarP2: [number, number] = zoneW >= zoneH
      ? [x2, (y1 + y2) / 2]
      : [(x1 + x2) / 2, y2];
    const newStation: BarStation = {
      zone_id:         `zone_${Date.now()}`,
      label:           `Bar Zone ${config.stations.length + 1}`,
      polygon:         [[x1,y1],[x2,y1],[x2,y2],[x1,y2]],
      bar_line_p1:     newBarP1,
      bar_line_p2:     newBarP2,
      customer_side:   1,
      extra_bar_lines: [],
    };
    setConfig(c => ({ stations: [...c.stations, newStation] }));
    setRectAnchor(null);
    setStep('done');
  }

  function handleSvgLeave() {
    if (!dragTarget) setCursor(null);
  }

  function deleteZone(idx: number) {
    setConfig(c => ({ stations: c.stations.filter((_, i) => i !== idx) }));
    if (config.stations.length <= 1) setStep('draw');
  }

  function addExtraLine(stationIdx: number) {
    setConfig(c => ({
      stations: c.stations.map((s, i) => {
        if (i !== stationIdx) return s;
        // Default new line: offset slightly from primary line so it's visible
        const ldx = s.bar_line_p2[0] - s.bar_line_p1[0];
        const ldy = s.bar_line_p2[1] - s.bar_line_p1[1];
        const llen = Math.hypot(ldx, ldy) || 1;
        const offset = 0.08;
        const newLine: BarLine = {
          p1: [Math.max(0, Math.min(1, s.bar_line_p1[0] + (-ldy/llen) * offset)),
               Math.max(0, Math.min(1, s.bar_line_p1[1] + (ldx/llen) * offset))] as [number,number],
          p2: [Math.max(0, Math.min(1, s.bar_line_p2[0] + (-ldy/llen) * offset)),
               Math.max(0, Math.min(1, s.bar_line_p2[1] + (ldx/llen) * offset))] as [number,number],
          customer_side: s.customer_side === 1 ? -1 : 1,
        };
        return { ...s, extra_bar_lines: [...(s.extra_bar_lines ?? []), newLine] };
      }),
    }));
  }

  function deleteExtraLine(stationIdx: number, lineIdx: number) {
    setConfig(c => ({
      stations: c.stations.map((s, i) => {
        if (i !== stationIdx) return s;
        return { ...s, extra_bar_lines: (s.extra_bar_lines ?? []).filter((_, li) => li !== lineIdx) };
      }),
    }));
  }

  function toggleExtraLineSide(stationIdx: number, lineIdx: number) {
    setConfig(c => ({
      stations: c.stations.map((s, i) => {
        if (i !== stationIdx) return s;
        const extras = [...(s.extra_bar_lines ?? [])];
        extras[lineIdx] = { ...extras[lineIdx], customer_side: extras[lineIdx].customer_side === 1 ? -1 : 1 };
        return { ...s, extra_bar_lines: extras };
      }),
    }));
  }

  function updateLabel(idx: number, label: string) {
    setConfig(c => ({
      stations: c.stations.map((s, i) => i === idx ? { ...s, label } : s),
    }));
  }

  function toggleCustomerSide(idx: number) {
    setConfig(c => ({
      stations: c.stations.map((s, i) =>
        i === idx ? { ...s, customer_side: s.customer_side === 1 ? -1 : 1 } : s
      ),
    }));
  }

  async function save() {
    setSaving(true);
    try {
      await cameraService.updateCamera(camera.venueId, camera.cameraId, {
        barConfigJson: JSON.stringify(config),
      });
      setSaveOk(true);
      setTimeout(onClose, 800);
    } catch (err) {
      console.error(err);
      setSaving(false);
    }
  }

  // Preview rect while dragging
  const previewRect = isDrawing && cursor ? (() => {
    const [ax, ay] = rectAnchor!;
    return {
      x: Math.min(ax, cursor[0]),
      y: Math.min(ay, cursor[1]),
      w: Math.abs(cursor[0] - ax),
      h: Math.abs(cursor[1] - ay),
    };
  })() : null;

  const cursorClass = dragTarget
    ? (dragTarget.kind === 'zone' ? 'cursor-grabbing' : 'cursor-grabbing')
    : isDrawing ? 'cursor-crosshair'
    : (cursor && config.stations.some(s => _ptInRect(cursor, s.polygon)) ? 'cursor-grab' : 'cursor-crosshair');

  return (
    <motion.div
      className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-2"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <motion.div
        className="bg-whoop-panel border border-whoop-divider rounded-2xl w-full max-w-5xl flex flex-col overflow-hidden"
        style={{ height: '95vh', maxHeight: '95vh' }}
        initial={{ scale: 0.97, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.97, opacity: 0 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-whoop-divider flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-teal/10 border border-teal/20 flex items-center justify-center">
              <Crosshair className="w-3.5 h-3.5 text-teal" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Zone Setup — {camera.name}</p>
              <p className="text-[10px] text-text-muted">{existing ? 'Edit your bar zone and bar line' : 'Suggested zone pre-loaded — adjust the bar line, then save'}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-white transition-colors p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* How it works — instruction strip */}
        <div className="flex items-stretch gap-0 border-b border-whoop-divider flex-shrink-0 bg-whoop-bg/60">
          <div className="flex items-start gap-2 px-4 py-2.5 flex-1 border-r border-whoop-divider/50">
            <div className="w-5 h-5 rounded-full bg-teal/20 text-teal text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">1</div>
            <div>
              <p className="text-[11px] font-semibold text-white">Draw Bar Zone</p>
              <p className="text-[10px] text-text-muted leading-snug">Click and drag a box around the bar area on the camera image — this tells the AI where to look for bartenders</p>
            </div>
          </div>
          <div className="flex items-start gap-2 px-4 py-2.5 flex-1 border-r border-whoop-divider/50">
            <div className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">2</div>
            <div>
              <p className="text-[11px] font-semibold text-white">Position the Bar Line <span className="text-amber-400">(orange)</span></p>
              <p className="text-[10px] text-text-muted leading-snug">This line sits along the bar counter edge. Every time a drink is passed over this line to a customer, it counts as a sale</p>
            </div>
          </div>
          <div className="flex items-start gap-2 px-4 py-2.5 flex-1">
            <div className="w-5 h-5 rounded-full bg-purple-500/20 text-purple-400 text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">3</div>
            <div>
              <p className="text-[11px] font-semibold text-white">Set Customer Side</p>
              <p className="text-[10px] text-text-muted leading-snug">Tell the AI which side of the orange line customers stand on — so it knows the direction of every handoff</p>
            </div>
          </div>
        </div>

        {/* Canvas — flex-1 so it fills remaining space; footer is always visible */}
        <div
          className="relative bg-black select-none flex-1 min-h-0 overflow-hidden"
          style={{ minHeight: '280px' }}
        >
          <video
            ref={videoRef}
            className="absolute inset-0 w-full h-full object-cover opacity-70"
            autoPlay muted playsInline
          />
          {!streamUrl && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <p className="text-text-muted text-xs bg-black/40 px-3 py-1.5 rounded-lg">No live feed — drawing on blank canvas</p>
            </div>
          )}

          <svg
            ref={svgRef}
            className={`absolute inset-0 w-full h-full ${cursorClass}`}
            viewBox="0 0 1 1"
            preserveAspectRatio="none"
            onMouseDown={handleSvgMouseDown}
            onMouseMove={handleSvgMouseMove}
            onMouseUp={handleSvgMouseUp}
            onMouseLeave={handleSvgLeave}
          >
            {/* Saved zones — shapes only (no SVG text — labels are HTML overlays below) */}
            {config.stations.map((s, i) => (
              <g key={i}>
                {/* Zone polygon — clickable body for drag-to-move */}
                <polygon
                  points={s.polygon.map(([px, py]) => `${px},${py}`).join(' ')}
                  fill="rgba(0,200,160,0.08)"
                  stroke="rgba(0,200,160,0.65)"
                  strokeWidth="0.003"
                  style={{ cursor: 'grab' }}
                />
                {/* Bar line */}
                <line
                  x1={s.bar_line_p1[0]} y1={s.bar_line_p1[1]}
                  x2={s.bar_line_p2[0]} y2={s.bar_line_p2[1]}
                  stroke="rgba(255,140,0,0.95)"
                  strokeWidth="0.005"
                  strokeDasharray="0.022 0.011"
                />
                {/* Bar line handles */}
                <circle cx={s.bar_line_p1[0]} cy={s.bar_line_p1[1]} r="0.022"
                  fill="rgba(255,140,0,0.25)" stroke="rgba(255,140,0,0.9)" strokeWidth="0.004"
                  style={{ cursor: 'grab' }}
                />
                <circle cx={s.bar_line_p2[0]} cy={s.bar_line_p2[1]} r="0.022"
                  fill="rgba(255,140,0,0.25)" stroke="rgba(255,140,0,0.9)" strokeWidth="0.004"
                  style={{ cursor: 'grab' }}
                />
                {/* Extra bar lines — same style but slightly different orange */}
                {(s.extra_bar_lines ?? []).map((xl, li) => (
                  <g key={`xl-${li}`}>
                    <line
                      x1={xl.p1[0]} y1={xl.p1[1]} x2={xl.p2[0]} y2={xl.p2[1]}
                      stroke="rgba(251,191,36,0.95)"
                      strokeWidth="0.005"
                      strokeDasharray="0.018 0.009"
                    />
                    <circle cx={xl.p1[0]} cy={xl.p1[1]} r="0.022"
                      fill="rgba(251,191,36,0.25)" stroke="rgba(251,191,36,0.9)" strokeWidth="0.004"
                      style={{ cursor: 'grab' }}
                    />
                    <circle cx={xl.p2[0]} cy={xl.p2[1]} r="0.022"
                      fill="rgba(251,191,36,0.25)" stroke="rgba(251,191,36,0.9)" strokeWidth="0.004"
                      style={{ cursor: 'grab' }}
                    />
                  </g>
                ))}

                {/* Corner handles — drag to resize zone */}
                {s.polygon.map(([cx, cy], ci) => (
                  <circle key={ci} cx={cx} cy={cy} r="0.018"
                    fill="rgba(0,200,160,0.3)" stroke="rgba(0,200,160,0.9)" strokeWidth="0.004"
                    style={{ cursor: 'nwse-resize' }}
                  />
                ))}
              </g>
            ))}

            {/* Preview rectangle while dragging */}
            {previewRect && previewRect.w > 0.01 && previewRect.h > 0.01 && (
              <rect
                x={previewRect.x} y={previewRect.y}
                width={previewRect.w} height={previewRect.h}
                fill="rgba(0,200,160,0.12)"
                stroke="rgba(0,200,160,0.8)"
                strokeWidth="0.003"
                strokeDasharray="0.015 0.008"
              />
            )}
          </svg>

          {/* Instruction overlay when no zones yet */}
          {config.stations.length === 0 && !isDrawing && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="bg-black/60 backdrop-blur-sm rounded-2xl px-5 py-4 text-center">
                <Crosshair className="w-6 h-6 text-teal mx-auto mb-2" />
                <p className="text-white text-sm font-semibold">Click and drag to draw a box</p>
                <p className="text-text-muted text-xs mt-1">Draw around your bar area on the camera image above</p>
              </div>
            </div>
          )}

          {/* Drag hint when drawing */}
          {isDrawing && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-black/70 backdrop-blur-sm text-[11px] text-teal pointer-events-none">
              Release to place zone
            </div>
          )}

          {/* HTML overlay labels for zone annotations (avoid SVG text artifacts) */}
          {config.stations.map((s, i) => {
            const xs = s.polygon.map(p => p[0]);
            const ys = s.polygon.map(p => p[1]);
            const pxMin = Math.min(...xs), pxMax = Math.max(...xs);
            const pyMin = Math.min(...ys);
            const barMidX = (s.bar_line_p1[0] + s.bar_line_p2[0]) / 2;
            const barMidY = (s.bar_line_p1[1] + s.bar_line_p2[1]) / 2;

            // Compute perpendicular direction to bar line so labels sit on the correct
            // side regardless of whether the line is horizontal, vertical, or diagonal.
            const ldx = s.bar_line_p2[0] - s.bar_line_p1[0];
            const ldy = s.bar_line_p2[1] - s.bar_line_p1[1];
            const llen = Math.hypot(ldx, ldy) || 1;
            // Unit perpendicular pointing in direction where cross-product = +1 (side = 1)
            const perpX = -ldy / llen;
            const perpY =  ldx / llen;
            // Customer direction: customer_side * perp
            const custX = s.customer_side * perpX;
            const custY = s.customer_side * perpY;
            const gap = 0.058;
            const clamp = (v: number) => Math.max(0.01, Math.min(0.99, v));
            const custLX = clamp(barMidX + custX * gap);
            const custLY = clamp(barMidY + custY * gap);
            const staffLX = clamp(barMidX - custX * gap);
            const staffLY = clamp(barMidY - custY * gap);

            // Pick arrow glyph matching the actual offset direction
            const _arrow = (vx: number, vy: number) =>
              Math.abs(vy) >= Math.abs(vx) ? (vy > 0 ? '↓' : '↑') : (vx > 0 ? '→' : '←');
            const custArrow  = _arrow(custX, custY);
            const staffArrow = _arrow(-custX, -custY);

            return (
              <React.Fragment key={i}>
                {/* Zone name label */}
                <div className="absolute pointer-events-none" style={{ left: `${(pxMin + pxMax) / 2 * 100}%`, top: `${pyMin * 100 + 2}%`, transform: 'translateX(-50%)' }}>
                  <span className="text-[10px] font-semibold text-teal/90 bg-black/40 backdrop-blur-sm px-1.5 py-0.5 rounded">
                    {s.label || 'Bar Zone'}
                  </span>
                </div>

                {/* Staff side label — perpendicular to bar line on staff side */}
                <div className="absolute pointer-events-none" style={{ left: `${staffLX * 100}%`, top: `${staffLY * 100}%`, transform: 'translate(-50%, -50%)' }}>
                  <span className="text-[9px] font-semibold text-amber-300/90 bg-black/50 backdrop-blur-sm px-1.5 py-0.5 rounded whitespace-nowrap">
                    {staffArrow} Staff side
                  </span>
                </div>

                {/* Flip sides button — centred on bar line */}
                <div
                  className="absolute"
                  style={{ left: `${barMidX * 100}%`, top: `${barMidY * 100}%`, transform: 'translate(-50%, -50%)' }}
                >
                  <button
                    onClick={e => { e.stopPropagation(); toggleCustomerSide(i); }}
                    className="flex items-center gap-1 px-2 py-1 rounded-full bg-amber-500/20 border border-amber-500/60 text-amber-300 text-[9px] font-semibold hover:bg-amber-500/40 transition-colors whitespace-nowrap backdrop-blur-sm"
                    title="Flip staff / customer sides"
                  >
                    ⇅ Flip sides
                  </button>
                </div>

                {/* Customer side label — perpendicular to bar line on customer side */}
                <div className="absolute pointer-events-none" style={{ left: `${custLX * 100}%`, top: `${custLY * 100}%`, transform: 'translate(-50%, -50%)' }}>
                  <span className="text-[9px] font-semibold text-purple-300/90 bg-black/50 backdrop-blur-sm px-1.5 py-0.5 rounded whitespace-nowrap">
                    Customer side {custArrow}
                  </span>
                </div>

                {/* Extra bar line labels */}
                {(s.extra_bar_lines ?? []).map((xl, li) => {
                  const xmx = (xl.p1[0] + xl.p2[0]) / 2;
                  const xmy = (xl.p1[1] + xl.p2[1]) / 2;
                  const xdx = xl.p2[0] - xl.p1[0];
                  const xdy = xl.p2[1] - xl.p1[1];
                  const xlen = Math.hypot(xdx, xdy) || 1;
                  const xperpX = -xdy / xlen;
                  const xperpY =  xdx / xlen;
                  const xcx = xl.customer_side * xperpX;
                  const xcy = xl.customer_side * xperpY;
                  const xgap = 0.055;
                  const xclamp = (v: number) => Math.max(0.01, Math.min(0.99, v));
                  const xcLX = xclamp(xmx + xcx * xgap);
                  const xcLY = xclamp(xmy + xcy * xgap);
                  const xcArrow = Math.abs(xcy) >= Math.abs(xcx) ? (xcy > 0 ? '↓' : '↑') : (xcx > 0 ? '→' : '←');
                  return (
                    <React.Fragment key={`xl-label-${li}`}>
                      <div className="absolute pointer-events-none" style={{ left: `${xmx * 100}%`, top: `${xmy * 100}%`, transform: 'translate(-50%, -50%)' }}>
                        <span className="text-[8px] font-semibold text-yellow-300/80 bg-black/50 backdrop-blur-sm px-1.5 py-0.5 rounded whitespace-nowrap">
                          Line {li + 2}
                        </span>
                      </div>
                      <div className="absolute pointer-events-none" style={{ left: `${xcLX * 100}%`, top: `${xcLY * 100}%`, transform: 'translate(-50%, -50%)' }}>
                        <span className="text-[8px] font-semibold text-purple-300/80 bg-black/50 backdrop-blur-sm px-1 py-0.5 rounded whitespace-nowrap">
                          Customer {xcArrow}
                        </span>
                      </div>
                    </React.Fragment>
                  );
                })}
              </React.Fragment>
            );
          })}

          {/* Drag hint after first zone placed */}
          {config.stations.length > 0 && !isDrawing && !dragTarget && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-3 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-sm pointer-events-none whitespace-nowrap">
              <span className="text-[11px] text-teal/80">Drag inside zone to move it</span>
              <span className="text-text-muted/40 text-[10px]">|</span>
              <span className="text-[11px] text-teal/60">● corners to resize</span>
              <span className="text-text-muted/40 text-[10px]">|</span>
              <span className="text-[11px] text-amber-400/80">● orange handles = bar line</span>
            </div>
          )}
        </div>

        {/* Zone list — scrollable */}
        <div className="px-5 pt-3 pb-1 border-t border-whoop-divider flex-shrink-0 space-y-2 overflow-y-auto" style={{ maxHeight: '20vh' }}>
          {config.stations.length === 0 ? (
            <p className="text-[11px] text-text-muted text-center py-1">Drag a box on the camera image to draw your bar zone</p>
          ) : (
            config.stations.map((s, i) => (
              <React.Fragment key={i}>
              <div className="flex items-center gap-2 bg-whoop-bg rounded-xl px-3 py-2.5">
                <div className="w-2 h-2 rounded-full bg-teal/60 flex-shrink-0" />
                <input
                  value={s.label}
                  onChange={e => updateLabel(i, e.target.value)}
                  className="flex-1 bg-transparent text-xs text-white outline-none min-w-0"
                  placeholder="Zone label (e.g. Main Bar)"
                />
                <div className="flex flex-col items-center flex-shrink-0">
                  <p className="text-[9px] text-text-muted mb-0.5">Customers are</p>
                  <button
                    onClick={() => toggleCustomerSide(i)}
                    className="text-[10px] px-2.5 py-1 rounded-lg bg-purple-500/15 text-purple-300 border border-purple-500/25 hover:bg-purple-500/25 transition-colors whitespace-nowrap"
                  >
                    {(() => {
                      const ldx = s.bar_line_p2[0] - s.bar_line_p1[0];
                      const ldy = s.bar_line_p2[1] - s.bar_line_p1[1];
                      const llen = Math.hypot(ldx, ldy) || 1;
                      const perpX = -ldy / llen;
                      const perpY =  ldx / llen;
                      const cx = s.customer_side * perpX;
                      const cy = s.customer_side * perpY;
                      const arrow = Math.abs(cy) >= Math.abs(cx) ? (cy > 0 ? '▼' : '▲') : (cx > 0 ? '▶' : '◀');
                      const dir = Math.abs(cy) >= Math.abs(cx) ? (cy > 0 ? 'below' : 'above') : (cx > 0 ? 'right of' : 'left of');
                      return `${arrow} ${dir} bar line`;
                    })()}
                  </button>
                </div>
                <button
                  onClick={() => addExtraLine(i)}
                  className="text-[10px] px-2 py-1 rounded-lg bg-yellow-500/10 text-yellow-300 border border-yellow-500/20 hover:bg-yellow-500/20 transition-colors whitespace-nowrap flex-shrink-0"
                  title="Add another crossing line to this zone"
                >
                  + Line
                </button>
                <button
                  onClick={() => deleteZone(i)}
                  className="text-text-muted hover:text-red-400 transition-colors flex-shrink-0 ml-1"
                  title="Delete zone"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              {/* Extra bar line controls */}
              {(s.extra_bar_lines ?? []).map((xl, li) => {
                const xdx = xl.p2[0] - xl.p1[0];
                const xdy = xl.p2[1] - xl.p1[1];
                const xlen = Math.hypot(xdx, xdy) || 1;
                const xperpX = -xdy / xlen;
                const xperpY =  xdx / xlen;
                const xcx = xl.customer_side * xperpX;
                const xcy2 = xl.customer_side * xperpY;
                const xarrow = Math.abs(xcy2) >= Math.abs(xcx) ? (xcy2 > 0 ? '▼' : '▲') : (xcx > 0 ? '▶' : '◀');
                const xdir = Math.abs(xcy2) >= Math.abs(xcx) ? (xcy2 > 0 ? 'below' : 'above') : (xcx > 0 ? 'right of' : 'left of');
                return (
                  <div key={li} className="flex items-center gap-2 bg-whoop-bg/50 rounded-lg px-3 py-1.5 ml-4 border border-yellow-500/10">
                    <div className="w-1.5 h-1.5 rounded-full bg-yellow-400/60 flex-shrink-0" />
                    <span className="text-[10px] text-yellow-300/70 flex-1">Crossing line {li + 2}</span>
                    <div className="flex flex-col items-center flex-shrink-0">
                      <p className="text-[8px] text-text-muted mb-0.5">Customers are</p>
                      <button
                        onClick={() => toggleExtraLineSide(i, li)}
                        className="text-[9px] px-2 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20 hover:bg-purple-500/20 transition-colors whitespace-nowrap"
                      >
                        {xarrow} {xdir} line
                      </button>
                    </div>
                    <button
                      onClick={() => deleteExtraLine(i, li)}
                      className="text-text-muted hover:text-red-400 transition-colors flex-shrink-0"
                      title="Delete this crossing line"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
              </React.Fragment>
            ))
          )}
        </div>

        {/* Footer — always visible Save button */}
        <div className="px-5 py-3 border-t border-whoop-divider flex-shrink-0 flex items-center justify-between">
          <p className="text-[10px] text-text-muted">
            {config.stations.length > 0 ? 'Tip: add multiple zones for different bar sections' : ''}
          </p>
          <button
            onClick={save}
            disabled={saving || config.stations.length === 0}
            className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-semibold bg-teal text-black hover:bg-teal/90 disabled:opacity-40 transition-colors"
          >
            {saveOk ? <Check className="w-3 h-3" /> : saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
            {saveOk ? 'Saved!' : 'Save Zones'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Table zone editor modal ───────────────────────────────────────────────────

interface TableZone {
  table_id: string;
  label: string;
  polygon: [number, number][];
}

function parseTableZones(json: string | undefined): TableZone[] {
  if (!json) return [];
  try { return JSON.parse(json) as TableZone[]; } catch { return []; }
}

function TableZoneOverlay({ zones }: { zones: TableZone[] }) {
  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 1 1" preserveAspectRatio="none">
      {zones.map((z, i) => (
        <g key={i}>
          <polygon
            points={z.polygon.map(([x, y]) => `${x},${y}`).join(' ')}
            fill="rgba(168,85,247,0.12)"
            stroke="rgba(168,85,247,0.9)"
            strokeWidth="0.004"
          />
          {/* Label at centroid */}
          {(() => {
            const cx = z.polygon.reduce((s, [px]) => s + px, 0) / z.polygon.length;
            const cy = z.polygon.reduce((s, [, py]) => s + py, 0) / z.polygon.length;
            return (
              <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
                fontSize="0.035" fill="rgba(220,180,255,0.9)"
                style={{ fontWeight: 600, fontFamily: 'sans-serif', userSelect: 'none' }}>
                {z.label}
              </text>
            );
          })()}
        </g>
      ))}
    </svg>
  );
}

type TableDragTarget =
  | { kind: 'corner'; zoneIdx: number; cornerIdx: number }
  | { kind: 'zone';   zoneIdx: number; startPt: [number, number]; startPolygon: [number, number][] }
  | null;

function TableZoneEditorModal({
  camera,
  proxyBase,
  onClose,
}: {
  camera: CameraConfig;
  proxyBase: string;
  onClose: () => void;
}) {
  const existing = parseTableZones(camera.tableZonesJson);
  const [zones, setZones]           = useState<TableZone[]>(existing);
  const [rectAnchor, setRectAnchor] = useState<[number, number] | null>(null);
  const [cursor, setCursor]         = useState<[number, number] | null>(null);
  const [dragTarget, setDragTarget] = useState<TableDragTarget>(null);
  const [saving, setSaving]         = useState(false);
  const [saveOk, setSaveOk]         = useState(false);
  const svgRef   = useRef<SVGSVGElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef   = useRef<Hls | null>(null);

  const streamUrl = (() => {
    if (proxyBase) {
      const ch = channelFromSources(camera.name || '', camera.rtspUrl);
      if (ch) return `${proxyBase.replace(/\/$/, '')}/hls/live/${ch}/0/livetop.mp4`;
    }
    if (camera.rtspUrl?.startsWith('https://')) return camera.rtspUrl;
    return null;
  })();

  useEffect(() => {
    if (!streamUrl || !videoRef.current) return;
    const v = videoRef.current;
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    if (streamUrl.includes('.m3u8') && Hls.isSupported()) {
      const hls = new Hls({ liveSyncDurationCount: 1, lowLatencyMode: true });
      hlsRef.current = hls;
      hls.loadSource(streamUrl);
      hls.attachMedia(v);
      hls.on(Hls.Events.MANIFEST_PARSED, () => v.play().catch(() => {}));
    } else {
      v.src = streamUrl; v.load(); v.play().catch(() => {});
    }
    return () => { if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; } v.src = ''; };
  }, [streamUrl]);

  function getRelPt(e: React.MouseEvent<SVGSVGElement>): [number, number] {
    const r = svgRef.current!.getBoundingClientRect();
    return [
      Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    ];
  }

  function handleMouseDown(e: React.MouseEvent<SVGSVGElement>) {
    if (dragTarget || e.button !== 0) return;
    const pt = getRelPt(e);
    const HIT = 0.035;
    for (let i = 0; i < zones.length; i++) {
      const z = zones[i];
      for (let ci = 0; ci < z.polygon.length; ci++) {
        const [cx, cy] = z.polygon[ci];
        if (Math.hypot(pt[0] - cx, pt[1] - cy) < HIT) {
          setDragTarget({ kind: 'corner', zoneIdx: i, cornerIdx: ci });
          e.preventDefault(); return;
        }
      }
      if (_ptInRect(pt, z.polygon)) {
        setDragTarget({ kind: 'zone', zoneIdx: i, startPt: pt, startPolygon: z.polygon.map(p => [...p] as [number, number]) });
        e.preventDefault(); return;
      }
    }
    setRectAnchor(pt); setCursor(pt);
  }

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const pt = getRelPt(e);
    setCursor(pt);
    if (!dragTarget) return;
    setZones(zs => zs.map((z, i) => {
      if (i !== dragTarget.zoneIdx) return z;
      if (dragTarget.kind === 'corner') {
        return { ...z, polygon: z.polygon.map((p, ci) => ci === dragTarget.cornerIdx ? pt : p) as [number,number][] };
      }
      if (dragTarget.kind === 'zone') {
        const dx = pt[0] - dragTarget.startPt[0], dy = pt[1] - dragTarget.startPt[1];
        const clamp = (v: number) => Math.max(0, Math.min(1, v));
        return { ...z, polygon: dragTarget.startPolygon.map(([px, py]) => [clamp(px+dx), clamp(py+dy)] as [number,number]) };
      }
      return z;
    }));
  }

  function handleMouseUp(e: React.MouseEvent<SVGSVGElement>) {
    if (dragTarget) { setDragTarget(null); return; }
    if (!rectAnchor) return;
    const pt = getRelPt(e);
    const [ax, ay] = rectAnchor;
    const x1 = Math.min(ax, pt[0]), x2 = Math.max(ax, pt[0]);
    const y1 = Math.min(ay, pt[1]), y2 = Math.max(ay, pt[1]);
    if (x2 - x1 < 0.04 || y2 - y1 < 0.04) { setRectAnchor(null); return; }
    const newZone: TableZone = {
      table_id: `t_${Date.now()}`,
      label: `Table ${zones.length + 1}`,
      polygon: [[x1,y1],[x2,y1],[x2,y2],[x1,y2]],
    };
    setZones(zs => [...zs, newZone]);
    setRectAnchor(null);
  }

  const previewRect = rectAnchor && cursor ? (() => {
    const [ax, ay] = rectAnchor;
    return { x: Math.min(ax, cursor[0]), y: Math.min(ay, cursor[1]), w: Math.abs(cursor[0]-ax), h: Math.abs(cursor[1]-ay) };
  })() : null;

  const cursorClass = dragTarget ? 'cursor-grabbing' : rectAnchor ? 'cursor-crosshair'
    : (cursor && zones.some(z => _ptInRect(cursor, z.polygon)) ? 'cursor-grab' : 'cursor-crosshair');

  async function save() {
    setSaving(true);
    try {
      await cameraService.updateCamera(camera.venueId, camera.cameraId, {
        tableZonesJson: JSON.stringify(zones),
      });
      setSaveOk(true);
      setTimeout(onClose, 800);
    } catch (err) {
      console.error(err);
      setSaving(false);
    }
  }

  return (
    <motion.div className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-2"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="bg-whoop-panel border border-whoop-divider rounded-2xl w-full max-w-5xl flex flex-col overflow-hidden"
        style={{ height: '95vh', maxHeight: '95vh' }}
        initial={{ scale: 0.97, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.97, opacity: 0 }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-whoop-divider flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
              <Crosshair className="w-3.5 h-3.5 text-purple-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Table Zones — {camera.name}</p>
              <p className="text-[10px] text-text-muted">Draw a box around each table seating area</p>
            </div>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-white transition-colors p-1"><X className="w-4 h-4" /></button>
        </div>

        {/* Instructions */}
        <div className="flex items-stretch gap-0 border-b border-whoop-divider flex-shrink-0 bg-whoop-bg/60">
          <div className="flex items-start gap-2 px-4 py-2.5 flex-1 border-r border-whoop-divider/50">
            <div className="w-5 h-5 rounded-full bg-purple-500/20 text-purple-400 text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">1</div>
            <div>
              <p className="text-[11px] font-semibold text-white">Draw Table Zones</p>
              <p className="text-[10px] text-text-muted leading-snug">Click and drag a box around each table seating area on the camera image</p>
            </div>
          </div>
          <div className="flex items-start gap-2 px-4 py-2.5 flex-1 border-r border-whoop-divider/50">
            <div className="w-5 h-5 rounded-full bg-purple-500/20 text-purple-400 text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">2</div>
            <div>
              <p className="text-[11px] font-semibold text-white">Name Each Table</p>
              <p className="text-[10px] text-text-muted leading-snug">Give each table a clear name — e.g. "Table 4" or "Booth A" — so reports are easy to read</p>
            </div>
          </div>
          <div className="flex items-start gap-2 px-4 py-2.5 flex-1">
            <div className="w-5 h-5 rounded-full bg-purple-500/20 text-purple-400 text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">3</div>
            <div>
              <p className="text-[11px] font-semibold text-white">Save & Go Live</p>
              <p className="text-[10px] text-text-muted leading-snug">The worker picks up the zone config automatically — no restart needed</p>
            </div>
          </div>
        </div>

        {/* Canvas */}
        <div className="relative bg-black select-none flex-1 min-h-0 overflow-hidden" style={{ minHeight: '280px' }}>
          <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover opacity-70" autoPlay muted playsInline />
          {!streamUrl && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <p className="text-text-muted text-xs bg-black/40 px-3 py-1.5 rounded-lg">No live feed — drawing on blank canvas</p>
            </div>
          )}
          <svg ref={svgRef} className={`absolute inset-0 w-full h-full ${cursorClass}`}
            viewBox="0 0 1 1" preserveAspectRatio="none"
            onMouseDown={handleMouseDown} onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp} onMouseLeave={() => { if (!dragTarget) setCursor(null); }}>
            {zones.map((z, i) => (
              <g key={i}>
                <polygon points={z.polygon.map(([x,y]) => `${x},${y}`).join(' ')}
                  fill="rgba(168,85,247,0.1)" stroke="rgba(168,85,247,0.7)" strokeWidth="0.003" style={{ cursor: 'grab' }} />
                {z.polygon.map(([cx,cy], ci) => (
                  <circle key={ci} cx={cx} cy={cy} r="0.018"
                    fill="rgba(168,85,247,0.3)" stroke="rgba(168,85,247,0.9)" strokeWidth="0.004" style={{ cursor: 'nwse-resize' }} />
                ))}
              </g>
            ))}
            {previewRect && previewRect.w > 0.01 && previewRect.h > 0.01 && (
              <rect x={previewRect.x} y={previewRect.y} width={previewRect.w} height={previewRect.h}
                fill="rgba(168,85,247,0.12)" stroke="rgba(168,85,247,0.8)" strokeWidth="0.003" strokeDasharray="0.015 0.008" />
            )}
          </svg>

          {/* Zone labels */}
          {zones.map((z, i) => {
            const xs = z.polygon.map(p => p[0]), ys = z.polygon.map(p => p[1]);
            const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
            const cy = Math.min(...ys);
            return (
              <div key={i} className="absolute pointer-events-none" style={{ left: `${cx*100}%`, top: `${cy*100+1}%`, transform: 'translateX(-50%)' }}>
                <span className="text-[10px] font-semibold text-purple-300/90 bg-black/40 backdrop-blur-sm px-1.5 py-0.5 rounded">{z.label}</span>
              </div>
            );
          })}

          {zones.length === 0 && !rectAnchor && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="bg-black/60 backdrop-blur-sm rounded-2xl px-5 py-4 text-center">
                <Crosshair className="w-6 h-6 text-purple-400 mx-auto mb-2" />
                <p className="text-white text-sm font-semibold">Click and drag to draw a table zone</p>
                <p className="text-text-muted text-xs mt-1">Draw a box around each table seating area</p>
              </div>
            </div>
          )}
          {rectAnchor && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-black/70 backdrop-blur-sm text-[11px] text-purple-300 pointer-events-none">
              Release to place table zone
            </div>
          )}
          {zones.length > 0 && !rectAnchor && !dragTarget && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-3 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-sm pointer-events-none whitespace-nowrap">
              <span className="text-[11px] text-purple-300/80">Drag inside zone to move it</span>
              <span className="text-text-muted/40 text-[10px]">|</span>
              <span className="text-[11px] text-purple-300/60">● corners to resize</span>
            </div>
          )}
        </div>

        {/* Zone list */}
        <div className="px-5 pt-3 pb-1 border-t border-whoop-divider flex-shrink-0 space-y-2 overflow-y-auto" style={{ maxHeight: '20vh' }}>
          {zones.length === 0 ? (
            <p className="text-[11px] text-text-muted text-center py-1">Drag boxes on the camera image to define your table zones</p>
          ) : (
            zones.map((z, i) => (
              <div key={i} className="flex items-center gap-2 bg-whoop-bg rounded-xl px-3 py-2.5">
                <div className="w-2 h-2 rounded-full bg-purple-400/60 flex-shrink-0" />
                <input value={z.label} onChange={e => setZones(zs => zs.map((t, ti) => ti === i ? { ...t, label: e.target.value } : t))}
                  className="flex-1 bg-transparent text-xs text-white outline-none min-w-0" placeholder="Table name (e.g. Table 4)" />
                <button onClick={() => setZones(zs => zs.filter((_, ti) => ti !== i))}
                  className="text-text-muted hover:text-red-400 transition-colors flex-shrink-0 ml-1">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-whoop-divider flex-shrink-0 flex items-center justify-between">
          <p className="text-[10px] text-text-muted">{zones.length > 0 ? `${zones.length} table${zones.length !== 1 ? 's' : ''} configured — draw more to add` : ''}</p>
          <button onClick={save} disabled={saving || zones.length === 0}
            className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-semibold bg-purple-500 text-white hover:bg-purple-400 disabled:opacity-40 transition-colors">
            {saveOk ? <Check className="w-3 h-3" /> : saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
            {saveOk ? 'Saved!' : 'Save Table Zones'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── CSV export ────────────────────────────────────────────────────────────────

function exportCsv(jobs: VenueScopeJob[]) {
  const headers = [
    'Room', 'Status', 'Mode', 'Bartender',
    'Total Drinks', 'Drinks/Hr', 'Unrung', 'Theft Flag',
    'Entries', 'Peak Occupancy', 'Created',
  ];
  const rows = jobs.map(j => [
    j.roomLabel || j.cameraLabel || '',
    j.status, j.analysisMode || '',
    j.topBartender || '',
    j.totalDrinks ?? 0, j.drinksPerHour?.toFixed(1) ?? '',
    j.unrungDrinks ?? 0, j.hasTheftFlag ? 'YES' : 'no',
    j.totalEntries ?? 0, j.peakOccupancy ?? 0,
    j.createdAt ? new Date(j.createdAt * 1000).toISOString() : '',
  ]);
  const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `venuescope_${new Date().toISOString().slice(0,10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

// ── Bartender aggregation ─────────────────────────────────────────────────────

interface BartenderStat {
  name: string;
  drinks: number;
  perHour: number;
  hasTheft: boolean;
}

function aggregateBartenders(jobs: VenueScopeJob[]): BartenderStat[] {
  const map = new Map<string, BartenderStat>();

  for (const job of jobs) {
    // Try bartenderBreakdown JSON first (most detailed)
    if (job.bartenderBreakdown) {
      try {
        const bd = JSON.parse(job.bartenderBreakdown) as Record<string, { drinks?: number; total_drinks?: number; per_hour?: number; drinks_per_hour?: number }>;
        for (const [name, d] of Object.entries(bd)) {
          if (!name || name === 'Unknown') continue;
          const drinks = d.drinks ?? d.total_drinks ?? 0;
          const perHour = d.per_hour ?? d.drinks_per_hour ?? 0;
          const existing = map.get(name);
          if (!existing) {
            map.set(name, { name, drinks, perHour, hasTheft: job.hasTheftFlag && job.topBartender === name });
          } else {
            existing.drinks += drinks;
            existing.perHour = Math.max(existing.perHour, perHour);
            if (job.hasTheftFlag && job.topBartender === name) existing.hasTheft = true;
          }
        }
        continue;
      } catch { /* fall through to topBartender */ }
    }
    // Fallback: just use topBartender + totalDrinks
    const name = job.topBartender;
    if (name && name !== 'Unknown') {
      const existing = map.get(name);
      if (!existing) {
        map.set(name, { name, drinks: job.totalDrinks ?? 0, perHour: job.drinksPerHour ?? 0, hasTheft: job.hasTheftFlag });
      } else {
        existing.drinks += job.totalDrinks ?? 0;
        existing.perHour = Math.max(existing.perHour, job.drinksPerHour ?? 0);
        if (job.hasTheftFlag) existing.hasTheft = true;
      }
    }
  }

  return Array.from(map.values()).sort((a, b) => b.drinks - a.drinks);
}

// ── Room grouping ─────────────────────────────────────────────────────────────

interface RoomSummary {
  label: string;
  isLive: boolean;
  mode: string;
  // drink_count
  totalDrinks: number;
  drinksPerHour: number;
  topBartender: string;
  hasTheftFlag: boolean;
  unrungDrinks: number;
  // people_count
  currentOccupancy: number;
  peakOccupancy: number;
  totalEntries: number;
  // table_turns
  totalTurns: number;
  avgDwellMin: number;
  avgResponseSec: number;
  // All modes configured on this camera in admin (source of truth for stat blocks to show)
  configuredModes: string[];
  // meta
  elapsedSec: number;
  updatedAt: number;
  cameraAngle: string;
  job: VenueScopeJob | null;
}

/** Strip camera emoji prefix and LIVE/seg suffixes from clipLabel for display */
function friendlyClipLabel(clip: string | undefined): string {
  if (!clip) return '';
  return clip
    .replace(/^📡\s*/, '')           // strip leading 📡
    .replace(/\s*—\s*🔴\s*LIVE\s*$/i, '')  // strip " — 🔴 LIVE"
    .replace(/\s*—\s*seg\s*\d+\s*$/i, '')  // strip " — seg N"
    .trim();
}

function buildRooms(jobs: VenueScopeJob[], enabledPeopleCamNames: Set<string> = new Set()): RoomSummary[] {
  // Group by roomLabel (fall back to cameraLabel → friendly clipLabel → jobId prefix)
  const map = new Map<string, VenueScopeJob[]>();
  for (const job of jobs) {
    const key = job.roomLabel || job.cameraLabel || friendlyClipLabel(job.clipLabel) || job.jobId.slice(0, 12);
    const arr = map.get(key) ?? [];
    arr.push(job);
    map.set(key, arr);
  }

  return Array.from(map.entries()).map(([label, roomJobs]) => {
    // Prefer live jobs, then most recent
    const best = roomJobs.find(j => j.isLive) ?? roomJobs[0];
    const modes = parseModes(best);
    const isDrink      = modes.includes('drink_count');
    const isPeople     = modes.includes('people_count');
    const isTableTurns = modes.includes('table_turns');

    // Aggregate across all done+live jobs for this room
    const totalDrinks   = roomJobs.reduce((s, j) => s + (j.totalDrinks ?? 0), 0);
    const totalEntries  = roomJobs.reduce((s, j) => s + (j.totalEntries ?? 0), 0);
    const peakOccupancy = Math.max(...roomJobs.map(j => j.peakOccupancy ?? 0), 0);
    // For live cameras, peakOccupancy is repurposed as current in-frame count (see aws_sync.py)
    // Prefer entries-exits for true entrance cameras, otherwise use the live in-frame count.
    // For snapshot cameras (done, not isLive), treat as current if completed within 5 minutes.
    // Only count occupancy when there is an ENABLED camera explicitly configured for people_count —
    // prevents stale snapshots from disabled cameras from polluting the occupancy hero stat.
    const camLabel  = (best.cameraLabel || label).toLowerCase();
    const roomLabel = label.toLowerCase();
    const hasPeopleCam = enabledPeopleCamNames.size === 0
      ? isPeople  // no camera list → fall back to job mode
      // Check both cameraLabel (camera_id like "ch2_bar") and room label
      // ("ch2 — bar" from clipLabel) so underscore IDs still match camera names.
      : Array.from(enabledPeopleCamNames).some(n =>
          n.includes(camLabel) || camLabel.includes(n) ||
          n.includes(roomLabel) || roomLabel.includes(n)
        );
    const entriesExits  = Math.max(0, (best.totalEntries ?? 0) - (best.totalExits ?? 0));
    const jobAge = Date.now() / 1000 - (best.finishedAt ?? best.updatedAt ?? best.createdAt ?? 0);
    // Keep snapshot visible for 25 min (20-min interval + 5-min buffer) so
    // occupancy never goes dark between snapshots.
    const isRecentSnapshot = isPeople && hasPeopleCam && !best.isLive && jobAge < 1500 && (best.peakOccupancy ?? 0) > 0;
    const currentOcc    = (best.isLive && hasPeopleCam)
      ? (entriesExits > 0 ? entriesExits : (best.peakOccupancy ?? 0))
      : isRecentSnapshot ? (best.peakOccupancy ?? 0) : 0;

    return {
      label,
      isLive: best.isLive === true || (best.isLive !== false && best.status === 'running' &&
        ((best.updatedAt ?? 0) === 0 || (best.updatedAt ?? 0) > Date.now() / 1000 - 300)),
      mode: isDrink ? 'drink_count' : isTableTurns ? 'table_turns' : isPeople ? 'people_count' : (best.analysisMode ?? 'unknown'),
      totalDrinks,
      drinksPerHour: best.drinksPerHour ?? 0,
      topBartender: best.topBartender ?? '',
      hasTheftFlag: roomJobs.some(j => j.hasTheftFlag),
      unrungDrinks: roomJobs.reduce((s, j) => s + (j.unrungDrinks ?? 0), 0),
      currentOccupancy: currentOcc,
      peakOccupancy,
      totalEntries,
      totalTurns:     best.totalTurns     ?? 0,
      avgDwellMin:    best.avgDwellMin    ?? 0,
      avgResponseSec: best.avgResponseSec ?? 0,
      configuredModes: modes,  // overwritten by allDisplayRooms when camera config is available
      elapsedSec: best.elapsedSec ?? 0,
      updatedAt: best.updatedAt ?? best.createdAt ?? 0,
      cameraAngle: best.cameraAngle ?? '',
      job: best,
    };
  }).sort((a, b) => {
    // Live rooms first, then by most drinks
    if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
    return b.totalDrinks - a.totalDrinks;
  });
}

// ── Theft investigation modal ─────────────────────────────────────────────────

interface LiveTheftEvent {
  type: 'unknown_bottle' | 'over_pour';  // walk_out removed 2026-04-21 per product decision
  ts?: number;
  bottle_class?: string;
  track_id?: number;
  poured_oz?: number;
  expected_oz?: number;
  excess_oz?: number;
}

function TheftModal({ job, avgDrinkPrice, onClose }: { job: VenueScopeJob; avgDrinkPrice: number; onClose: () => void }) {
  const liveEvents: LiveTheftEvent[] = React.useMemo(() => {
    if (!job.liveTheftEvents) return [];
    try {
      // Incoming payload may still carry legacy walk_out events — filter before
      // narrowing the type. Walk-outs were retired 2026-04-21: the 10s-absence
      // heuristic fires too often for normal restocking / cleaning.
      const all = JSON.parse(job.liveTheftEvents) as Array<Record<string, unknown>>;
      return all.filter(e => e?.type !== 'walk_out') as unknown as LiveTheftEvent[];
    } catch { return []; }
  }, [job.liveTheftEvents]);

  const typeLabel = (t: string) => t === 'unknown_bottle' ? 'Unknown bottle' : 'Over-pour';
  const typeColor = (t: string) => t === 'unknown_bottle' ? 'text-amber-400' : 'text-orange-400';

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="bg-whoop-panel border border-red-500/30 rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto"
          initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
          onClick={e => e.stopPropagation()}
        >
          <div className="p-5 border-b border-whoop-divider flex items-start justify-between">
            <div>
              <h2 className="text-white font-bold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400" />
                Theft Investigation
              </h2>
              <p className="text-xs text-text-muted mt-0.5">
                {job.roomLabel || job.clipLabel || job.jobId} · {fmtTime(job.createdAt)}
              </p>
            </div>
            <button onClick={onClose} className="text-text-muted hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { v: job.unrungDrinks ?? 0, l: 'Unrung', c: 'text-red-400' },
                { v: job.totalDrinks ?? 0,  l: 'Total',  c: 'text-white' },
                { v: `${job.totalDrinks ? Math.round(((job.unrungDrinks ?? 0) / job.totalDrinks) * 100) : 0}%`, l: 'Rate', c: 'text-amber-400' },
                { v: `$${((job.unrungDrinks ?? 0) * avgDrinkPrice).toFixed(0)}`, l: 'Est. Loss', c: 'text-red-400' },
              ].map(({ v, l, c }) => (
                <div key={l} className="bg-whoop-bg rounded-xl p-3 text-center">
                  <div className={`text-xl font-bold ${c}`}>{v}</div>
                  <div className="text-[9px] text-text-muted uppercase tracking-wide mt-0.5">{l}</div>
                </div>
              ))}
            </div>

            {/* Shrinkage */}
            {(job.shrinkageOz ?? 0) > 0 && (
              <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl px-3 py-2 flex items-center justify-between">
                <span className="text-xs text-text-muted flex items-center gap-1.5">
                  <GlassWater className="w-3.5 h-3.5 text-orange-400" /> Shrinkage
                </span>
                <span className="text-sm font-semibold text-orange-400">{job.shrinkageOz?.toFixed(1)} oz over expected</span>
              </div>
            )}

            {job.topBartender && (
              <div className="bg-whoop-bg rounded-xl px-3 py-2 flex items-center justify-between">
                <span className="text-xs text-text-muted flex items-center gap-1.5"><User className="w-3.5 h-3.5" /> Flagged bartender</span>
                <span className="text-sm font-semibold text-white">{job.topBartender}</span>
              </div>
            )}

            {/* Live theft event feed */}
            {liveEvents.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-white mb-2 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-400" /> Live Alerts ({liveEvents.length})
                </h3>
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {liveEvents.map((ev, i) => (
                    <div key={i} className="bg-whoop-bg rounded-lg px-3 py-1.5 flex items-center justify-between text-xs">
                      <span className={`font-medium ${typeColor(ev.type)}`}>{typeLabel(ev.type)}</span>
                      <span className="text-text-muted tabular-nums">
                        {ev.ts ? new Date(ev.ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                        {ev.excess_oz ? ` · +${ev.excess_oz.toFixed(1)}oz` : ''}
                        {ev.bottle_class ? ` · ${ev.bottle_class}` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <h3 className="text-xs font-semibold text-white mb-2 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" /> Next Steps
              </h3>
              <ul className="space-y-1.5 text-xs text-text-secondary">
                {[
                  'Review the annotated video clip for the flagged serves',
                  'Cross-reference with POS transaction log for this shift',
                  `Check bartender ${job.topBartender || 'Unknown'}'s total ring count vs detected drinks`,
                  'Compare opening/closing register totals',
                  'Document findings in incident report',
                ].map((step, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="w-4 h-4 rounded-full border border-whoop-divider flex-shrink-0 flex items-center justify-center text-[9px] text-text-muted mt-0.5">{i + 1}</span>
                    {step}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ── Tonight hero numbers ──────────────────────────────────────────────────────

function TonightHero({ jobs, avgDrinkPrice, barOpen = true, peopleRooms = [], isDemo = false }: { jobs: VenueScopeJob[]; avgDrinkPrice: number; barOpen?: boolean; peopleRooms?: RoomSummary[]; isDemo?: boolean }) {
  const totalDrinks    = jobs.reduce((s, j) => s + (j.totalDrinks ?? 0), 0);
  const liveJobs       = jobs.filter(j => j.isLive);

  // Countdown to next people_count snapshot.
  // Cameras fire on per-camera hash-offset schedules — find the soonest nextAt.
  // Per-room estimate: updatedAt + 1200. Falls back to global floor when unknown.
  const OCCUPANCY_INTERVAL = 1200;
  const [nextCountSec, setNextCountSec] = React.useState(0);
  React.useEffect(() => {
    const tick = () => {
      const now = Date.now() / 1000;
      const globalNext = Math.floor(now / OCCUPANCY_INTERVAL) * OCCUPANCY_INTERVAL + OCCUPANCY_INTERVAL;
      // Per-room nextAt from last snapshot time
      const roomNextAts = peopleRooms.map(r => {
        const lastAt = r.updatedAt && r.updatedAt > 0 ? r.updatedAt : 0;
        return lastAt > 0 && lastAt + OCCUPANCY_INTERVAL > now
          ? lastAt + OCCUPANCY_INTERVAL
          : globalNext;
      });
      const soonest = roomNextAts.length > 0 ? Math.min(...roomNextAts) : globalNext;
      setNextCountSec(Math.max(0, Math.round(soonest - now)));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [peopleRooms]);

  const fmtCountdown = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  };

  // Sum exactly what each camera card shows (room.currentOccupancy) — guaranteed consistent.
  // peopleRooms is already deduped and computed by buildRooms with the same logic.
  const _rawOccupancy    = peopleRooms.reduce((s, r) => s + (r.currentOccupancy ?? 0), 0);
  // Demo: simulate 287 guests in-venue at 3.5 hrs into the shift
  const currentOccupancy = isDemo ? 287 : _rawOccupancy;
  const cameraZoneCount  = isDemo ? 1 : peopleRooms.length;
  const occupancyIsEntrance = false;
  const theftCount     = jobs.filter(j => j.hasTheftFlag).length;
  const unrung         = jobs.reduce((s, j) => s + (j.unrungDrinks ?? 0), 0);

  // Drinks/hr: weighted avg across live jobs that have a rate
  const liveJobsWithRate = liveJobs.filter(j => (j.drinksPerHour ?? 0) > 0);
  const pace = liveJobsWithRate.length > 0
    ? liveJobsWithRate.reduce((s, j) => s + (j.drinksPerHour ?? 0), 0) / liveJobsWithRate.length
    : null;

  const stats = [
    {
      icon: <Zap className="w-4 h-4" />,
      value: barOpen ? totalDrinks.toString() : '—',
      label: barOpen ? 'Drinks Today' : 'Bar Closed',
      color: 'text-teal',
      bg: 'bg-teal/10 border-teal/20',
      iconColor: 'text-teal',
    },
    {
      icon: <DollarSign className="w-4 h-4" />,
      value: barOpen ? `$${(totalDrinks * avgDrinkPrice).toLocaleString()}` : '—',
      label: 'Est. Revenue',
      color: 'text-emerald-400',
      bg: 'bg-emerald-500/5 border-emerald-500/20',
      iconColor: 'text-emerald-400',
      sub: `${totalDrinks} drinks × $${avgDrinkPrice}`,
    },
    {
      icon: <Users className="w-4 h-4" />,
      value: currentOccupancy > 0 ? currentOccupancy.toString() : '—',
      label: 'Current Occupancy',
      color: 'text-white',
      bg: 'bg-whoop-panel border-whoop-divider',
      iconColor: 'text-text-muted',
      sub: currentOccupancy > 0
        ? (isDemo ? 'overhead camera · live count' : `${cameraZoneCount} camera zone${cameraZoneCount !== 1 ? 's' : ''}`)
        : liveJobs.length > 0 ? 'cameras live · no activity' : 'no cameras active',
      countdown: (!isDemo && nextCountSec > 0) ? `Next count in ${fmtCountdown(nextCountSec)}` : null,
    },
    theftCount > 0
      ? {
          icon: <AlertTriangle className="w-4 h-4" />,
          value: theftCount.toString(),
          label: `Alert${theftCount !== 1 ? 's' : ''} · $${(unrung * avgDrinkPrice).toFixed(0)} est.`,
          color: 'text-red-400',
          bg: 'bg-red-500/10 border-red-500/30',
          iconColor: 'text-red-400',
        }
      : {
          icon: <ShieldCheck className="w-4 h-4" />,
          value: 'Clean',
          label: 'No Theft Flags',
          color: 'text-emerald-400',
          bg: 'bg-emerald-500/5 border-emerald-500/20',
          iconColor: 'text-emerald-400',
        },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {stats.map(({ icon, value, label, color, bg, iconColor, sub, countdown }: any) => (
        <div key={label} className={`border rounded-2xl p-4 ${bg}`}>
          <div className={`w-7 h-7 rounded-lg bg-black/20 flex items-center justify-center mb-3 ${iconColor}`}>
            {icon}
          </div>
          <div className={`text-3xl font-bold ${color} leading-none`}>{value}</div>
          <div className="text-[10px] text-text-muted uppercase tracking-wide mt-1.5">{label}</div>
          {sub && <div className="text-[10px] text-text-muted mt-0.5">{sub}</div>}
          {countdown && <div className="text-[10px] text-teal/70 mt-1.5 tabular-nums">{countdown}</div>}
        </div>
      ))}
    </div>
  );
}

// ── Live room card ────────────────────────────────────────────────────────────

// ── Camera live view ──────────────────────────────────────────────────────────

/**
 * Extract channel number from a camera name or RTSP URL.
 * Tries rtspUrl first (authoritative), then falls back to label text.
 * Returns lowercase e.g. "ch9" to match NVR path format.
 */
function channelFromSources(label: string, rtspUrl?: string | null): string | null {
  // RTSP URL is most reliable: rtsp://ip/ch9/0 or rtsp://ip:port/Streaming/Channels/901 etc.
  if (rtspUrl) {
    const m = rtspUrl.match(/\/ch(\d+)\//i) ?? rtspUrl.match(/[Cc]hannel[s]?\/(\d+)/);
    if (m) return `ch${m[1]}`;
  }
  // Fall back to label text: "CH9 — Bar" or "Blind Goalie CH9"
  const m = label.match(/CH(\d+)/i);
  return m ? `ch${m[1]}` : null;
}

function liveStreamUrl(label: string, proxyBase: string, rtspUrl?: string | null): string | null {
  // Primary path: route through the HTTPS Caddy proxy on the droplet (sslip.io cert = trusted on
  // all devices, no per-device cert trust required). proxyBase = venue's camProxyUrl setting,
  // e.g. https://137-184-61-178.sslip.io/cam
  if (proxyBase) {
    const ch = channelFromSources(label, rtspUrl);
    if (ch) return `${proxyBase.replace(/\/$/, '')}/hls/live/${ch}/0/livetop.mp4`;
  }
  // Fallback: rtspUrl is already HTTPS (e.g. NVR with a proper CA cert) — use directly.
  if (rtspUrl?.startsWith('https://')) return rtspUrl;
  // No usable proxy and no HTTPS rtspUrl — can't stream (HTTP on HTTPS page = mixed content).
  return null;
}

function CameraLiveView({
  label, proxyBase, rtspUrl, barConfig, tableZones, onConfigureZones, cameraModes,
}: {
  label: string;
  proxyBase: string;
  rtspUrl?: string | null;
  barConfig?: BarConfig | null;
  tableZones?: TableZone[] | null;
  onConfigureZones?: () => void;
  cameraModes?: string[];
}) {
  const videoRef      = React.useRef<HTMLVideoElement>(null);
  const hlsRef        = React.useRef<Hls | null>(null);
  const timerRef      = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const watchdogRef   = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectRef  = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTimeRef   = React.useRef<number>(-1);
  const stallCountRef = React.useRef<number>(0);
  const [state, setState]   = React.useState<'loading' | 'playing' | 'reconnecting' | 'error' | 'mixed_content'>('loading');
  const [errorMsg, setErrorMsg] = React.useState('Stream unavailable');
  const [retryKey, setRetryKey] = React.useState(0);
  // Stop retrying after N consecutive failures so the tile doesn't loop forever
  // when the NVR/proxy is genuinely down. Reset on successful `playing` event.
  const retryCountRef = React.useRef<number>(0);
  const MAX_RETRIES   = 3;
  const url = liveStreamUrl(label, proxyBase, rtspUrl);

  // Detect if this is an HTTPS-upgraded HTTP stream — failure likely means untrusted self-signed cert.


  React.useEffect(() => {
    if (!url || !videoRef.current) return;

    setState('loading');
    setErrorMsg('Stream unavailable');

    // Detect plain mixed-content (HTTP stream on HTTPS page, no upgrade applied)
    const isHttps = window.location.protocol === 'https:';
    if (isHttps && url.startsWith('http://')) {
      setState('mixed_content');
      return;
    }

    const v = videoRef.current;

    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }

    // 12-second timeout → auto-reconnect (up to MAX_RETRIES times)
    timerRef.current = setTimeout(() => {
      setState(prev => {
        if (prev !== 'loading') return prev;
        retryCountRef.current += 1;
        if (retryCountRef.current >= MAX_RETRIES) {
          setErrorMsg('Stream unreachable — check NVR / proxy');
          return 'error';
        }
        if (reconnectRef.current) clearTimeout(reconnectRef.current);
        reconnectRef.current = setTimeout(() => {
          setState('loading');
          setRetryKey(k => k + 1);
        }, 8_000);
        return 'reconnecting';
      });
    }, 12_000);

    lastTimeRef.current   = -1;
    stallCountRef.current = 0;

    const stopWatchdog = () => {
      if (watchdogRef.current) { clearInterval(watchdogRef.current); watchdogRef.current = null; }
    };

    const cleanup = () => {
      if (timerRef.current)    { clearTimeout(timerRef.current);    timerRef.current    = null; }
      if (reconnectRef.current){ clearTimeout(reconnectRef.current); reconnectRef.current = null; }
      stopWatchdog();
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
      v.src = '';
    };

    const handleError = () => {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      retryCountRef.current += 1;
      if (retryCountRef.current >= MAX_RETRIES) {
        setErrorMsg('Stream unreachable — check NVR / proxy');
        setState('error');
        return;
      }
      // Auto-reconnect — show "Reconnecting" and retry after 8s
      setState('reconnecting');
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      reconnectRef.current = setTimeout(() => {
        setState('loading');
        setRetryKey(k => k + 1);
      }, 8_000);
    };

    // Silent reconnect — reload src without showing error UI
    const silentReconnect = () => {
      stopWatchdog();
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
      lastTimeRef.current   = -1;
      stallCountRef.current = 0;
      if (url.includes('.m3u8') && Hls.isSupported()) {
        const hls = new Hls({ liveSyncDurationCount: 1, lowLatencyMode: true, enableWorker: true });
        hlsRef.current = hls;
        hls.loadSource(url);
        hls.attachMedia(v);
        hls.on(Hls.Events.MANIFEST_PARSED, () => v.play().catch(() => {}));
        hls.on(Hls.Events.ERROR, (_evt, data) => { if (data.fatal) handleError(); });
      } else {
        v.src = '';
        v.load();
        v.src = url;
        v.load();
        v.play().catch(() => {});
      }
      startWatchdog();
    };

    // Watchdog: fires every 5s. If currentTime hasn't advanced for 2 consecutive
    // ticks (10s) while the video is supposed to be playing → silent reconnect.
    const startWatchdog = () => {
      stopWatchdog();
      watchdogRef.current = setInterval(() => {
        const vid = videoRef.current;
        if (!vid || vid.paused || vid.ended) return;
        const t = vid.currentTime;
        if (t === lastTimeRef.current) {
          stallCountRef.current += 1;
          if (stallCountRef.current >= 2) {
            stallCountRef.current = 0;
            silentReconnect();
          }
        } else {
          lastTimeRef.current   = t;
          stallCountRef.current = 0;
        }
      }, 5_000);
    };

    if (url.includes('.m3u8') && Hls.isSupported()) {
      const hls = new Hls({ liveSyncDurationCount: 1, lowLatencyMode: true, enableWorker: true });
      hlsRef.current = hls;
      hls.loadSource(url);
      hls.attachMedia(v);
      hls.on(Hls.Events.MANIFEST_PARSED, () => v.play().catch(() => {}));
      hls.on(Hls.Events.ERROR, (_evt, data) => { if (data.fatal) handleError(); });
    } else {
      v.src = url;
      v.load();
      v.play().catch(() => {});
    }

    // Start watchdog once video begins playing
    const onPlaying = () => startWatchdog();
    v.addEventListener('playing', onPlaying);

    return () => {
      v.removeEventListener('playing', onPlaying);
      cleanup();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, retryKey]);

  if (!url) return null;

  return (
    <div className="relative w-full overflow-hidden rounded-xl bg-black aspect-video">
      {state === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80">
          <Loader2 className="w-5 h-5 text-teal animate-spin" />
          <span className="text-[10px] text-text-muted">Connecting to camera…</span>
        </div>
      )}

      {/* Reconnecting (any error — auto-retries every 8s) */}
      {state === 'reconnecting' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-[10px] text-amber-300 font-medium">Reconnecting…</span>
          </div>
        </div>
      )}

      {/* Generic unrecoverable error (mixed content, too many retries, etc.) */}
      {state === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center bg-black/80">
          <Camera className="w-5 h-5 text-text-muted" />
          <span className="text-[10px] text-text-muted">{errorMsg}</span>
          <button
            type="button"
            className="mt-1 text-[10px] px-2 py-0.5 rounded border border-teal/30 text-teal hover:bg-teal/10"
            onClick={() => {
              retryCountRef.current = 0;
              setState('loading');
              setRetryKey(k => k + 1);
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Mixed content (HTTP on HTTPS page, no upgrade) */}
      {state === 'mixed_content' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-4 text-center">
          <Camera className="w-5 h-5 text-yellow-400" />
          <span className="text-[10px] text-text-muted">Set proxy URL to HTTPS to load stream</span>
          {proxyBase && <span className="text-[9px] text-text-muted/50 break-all">{proxyBase}</span>}
        </div>
      )}
      <video
        ref={videoRef}
        className={`w-full h-full object-cover transition-opacity duration-300 ${state === 'playing' ? 'opacity-100' : 'opacity-0'}`}
        autoPlay muted playsInline
        onCanPlay={() => {
          if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
          retryCountRef.current = 0;  // stream recovered — allow fresh retry budget
          setState('playing');
        }}
        onError={() => {
          if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
          handleError();
        }}
      />
      {/* Zone overlays — show whenever feed is playing */}
      {barConfig && state === 'playing' && <ZoneOverlay config={barConfig} />}
      {tableZones && tableZones.length > 0 && state === 'playing' && <TableZoneOverlay zones={tableZones} />}
      {/* No-config hint — only for drink_count cameras (other modes don't use bar zones) */}
      {!barConfig && state === 'playing' && onConfigureZones && (!cameraModes || cameraModes.includes('drink_count')) && (
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          <div className="px-2 py-1 rounded bg-black/50 text-[9px] text-amber-400/80">
            No bar zones configured
          </div>
        </div>
      )}
      {state === 'playing' && (
        <div className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-sm">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-400" />
          </span>
          <span className="text-[9px] font-semibold text-white/90 uppercase tracking-wide">Live</span>
        </div>
      )}
      {/* Configure zones button */}
      {onConfigureZones && (
        <button
          onClick={e => { e.stopPropagation(); onConfigureZones(); }}
          className="absolute bottom-2 right-2 flex items-center gap-1 px-2 py-1 rounded-lg bg-black/60 backdrop-blur-sm text-[9px] text-white/60 hover:text-white transition-colors"
        >
          <Edit2 className="w-2.5 h-2.5" />
          {cameraModes?.includes('table_turns') && !cameraModes?.includes('drink_count')
            ? (tableZones && tableZones.length > 0 ? `${tableZones.length} Table${tableZones.length !== 1 ? 's' : ''} ✓` : 'Set Up Tables')
            : (barConfig ? 'Edit Zones' : 'Configure Zones')}
        </button>
      )}
    </div>
  );
}

// ── Demo camera image sets per mode ──────────────────────────────────────────
const _DEMO_IMGS_BAR = [
  "https://images.unsplash.com/photo-1575444758702-4a6b9222336e?w=800&q=80",
  "https://images.unsplash.com/photo-1566633806327-68e152aaf26d?w=800&q=80",
  "https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=800&q=80",
  "https://images.unsplash.com/photo-1470337458703-46ad1756a187?w=800&q=80",
  "https://images.unsplash.com/photo-1519671482749-fd09be7ccebf?w=800&q=80",
  "https://images.unsplash.com/photo-1541643600914-78b084683702?w=800&q=80",
];
const _DEMO_IMGS_ENTRANCE = [
  "https://images.unsplash.com/photo-1429962714451-bb934ecdc4ec?w=800&q=80",
  "https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=800&q=80",
  "https://images.unsplash.com/photo-1504680177321-2e6a879aac86?w=800&q=80",
  "https://images.unsplash.com/photo-1531058020387-3be344556be6?w=800&q=80",
];
const _DEMO_IMGS_DINING = [
  "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800&q=80",
  "https://images.unsplash.com/photo-1552566626-52f8b828add9?w=800&q=80",
  "https://images.unsplash.com/photo-1544148103-0773bf10d330?w=800&q=80",
  "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=800&q=80",
];

// Bartender detection boxes — bar camera only
const _DEMO_BAR_DETS: Array<Array<{ name: string; top: string; left: string; w: string; h: string; conf: number }>> = [
  [{ name: 'Marcus', top: '32%', left: '22%', w: '18%', h: '38%', conf: 0.94 }, { name: 'Priya', top: '40%', left: '58%', w: '16%', h: '34%', conf: 0.91 }],
  [{ name: 'Marcus', top: '28%', left: '48%', w: '20%', h: '42%', conf: 0.96 }, { name: 'Priya', top: '36%', left: '18%', w: '17%', h: '36%', conf: 0.88 }],
  [{ name: 'Priya',  top: '34%', left: '30%', w: '18%', h: '40%', conf: 0.92 }, { name: 'Marcus', top: '30%', left: '62%', w: '19%', h: '38%', conf: 0.95 }],
  [{ name: 'Marcus', top: '26%', left: '35%', w: '22%', h: '44%', conf: 0.93 }],
  [{ name: 'Priya',  top: '38%', left: '25%', w: '17%', h: '36%', conf: 0.90 }, { name: 'Marcus', top: '32%', left: '55%', w: '20%', h: '40%', conf: 0.97 }],
  [{ name: 'Marcus', top: '30%', left: '40%', w: '21%', h: '42%', conf: 0.95 }, { name: 'Priya', top: '36%', left: '68%', w: '16%', h: '34%', conf: 0.89 }],
];
// Person silhouette boxes for entrance camera
const _DEMO_ENTRANCE_DETS = [
  [{ id: '#14', top: '30%', left: '18%', w: '12%', h: '42%' }, { id: '#15', top: '35%', left: '55%', w: '11%', h: '38%' }, { id: '#16', top: '28%', left: '72%', w: '13%', h: '44%' }],
  [{ id: '#17', top: '32%', left: '30%', w: '12%', h: '40%' }, { id: '#18', top: '38%', left: '62%', w: '11%', h: '36%' }],
  [{ id: '#19', top: '28%', left: '22%', w: '13%', h: '44%' }, { id: '#20', top: '34%', left: '48%', w: '12%', h: '40%' }, { id: '#21', top: '30%', left: '70%', w: '11%', h: '38%' }],
  [{ id: '#22', top: '36%', left: '35%', w: '12%', h: '38%' }],
];
// Table zones for dining camera — fixed layout
const _DINING_TABLES = [
  { id: 'T1', top: '20%', left: '8%',  w: '18%', h: '24%', occupied: true  },
  { id: 'T2', top: '20%', left: '32%', w: '18%', h: '24%', occupied: true  },
  { id: 'T3', top: '20%', left: '56%', w: '18%', h: '24%', occupied: false },
  { id: 'T4', top: '20%', left: '76%', w: '18%', h: '24%', occupied: true  },
  { id: 'T5', top: '60%', left: '8%',  w: '18%', h: '24%', occupied: true  },
  { id: 'T6', top: '60%', left: '32%', w: '18%', h: '24%', occupied: false },
  { id: 'T7', top: '60%', left: '56%', w: '18%', h: '24%', occupied: true  },
  { id: 'T8', top: '60%', left: '76%', w: '18%', h: '24%', occupied: true  },
];

interface _DemoEvent { ts: string; name: string; event: string; conf: number }

function DemoCameraFeed({ mode = 'drink_count', jobId = '' }: { mode?: string; jobId?: string }) {
  const isEntrance  = mode === 'people_count';
  const isDining    = mode === 'table_turns';
  const isBackBar   = jobId === 'demo-live-backbar';

  const imgs = isEntrance ? _DEMO_IMGS_ENTRANCE : isDining ? _DEMO_IMGS_DINING : _DEMO_IMGS_BAR;

  const [idx, setIdx]           = React.useState(0);
  const [drinkCount, setDrinkCount] = React.useState(() => {
    const h = new Date().getHours();
    const hoursIn = Math.min(8, Math.max(0, h >= 18 ? h - 18 : h < 4 ? h + 6 : 0));
    return isEntrance ? Math.round(hoursIn * 242) : isBackBar
      ? Math.round(hoursIn * 4.2)
      : Math.max(8, Math.round(hoursIn * 11.2) + Math.floor(Math.random() * 6));
  });
  const [entryCount, setEntryCount] = React.useState(() => {
    const h = new Date().getHours();
    const hoursIn = Math.min(8, Math.max(0, h >= 18 ? h - 18 : h < 4 ? h + 6 : 0));
    return Math.round(hoursIn * 242);
  });
  const [turns, setTurns]       = React.useState(18);
  const [events, setEvents]     = React.useState<_DemoEvent[]>([]);
  const [tableOcc, setTableOcc] = React.useState(_DINING_TABLES.map(t => t.occupied));

  React.useEffect(() => {
    const id = setInterval(() => setIdx(i => (i + 1) % imgs.length), 7000);
    return () => clearInterval(id);
  }, [imgs.length]);

  // Live increment logic per mode
  React.useEffect(() => {
    const id = setInterval(() => {
      const now = new Date();
      const ts  = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
      if (isEntrance) {
        const n = Math.floor(Math.random() * 3) + 1;
        setEntryCount(c => c + n);
        setEvents(prev => [{ ts, name: `${n} person${n > 1 ? 's' : ''}`, event: 'entered', conf: 0.96 }, ...prev].slice(0, 6));
      } else if (isDining) {
        // Occasionally flip a table
        if (Math.random() > 0.7) {
          setTurns(t => t + 1);
          const tIdx = Math.floor(Math.random() * _DINING_TABLES.length);
          setTableOcc(prev => { const next = [...prev]; next[tIdx] = !next[tIdx]; return next; });
          const tbl = _DINING_TABLES[tIdx];
          const dwell = 75 + Math.floor(Math.random() * 40);
          setEvents(prev => [{ ts, name: tbl.id, event: `cleared · ${dwell}m dwell`, conf: 0.92 }, ...prev].slice(0, 6));
        }
      } else {
        const names  = isBackBar ? ['Priya', 'Priya', 'Priya'] : ['Marcus', 'Priya', 'Marcus', 'Priya', 'Marcus'];
        const name   = names[Math.floor(Math.random() * names.length)];
        const conf   = parseFloat((0.85 + Math.random() * 0.12).toFixed(2));
        setDrinkCount(c => c + 1);
        setEvents(prev => [{ ts, name, event: 'drink served', conf }, ...prev].slice(0, 6));
      }
    }, 9000);
    return () => clearInterval(id);
  }, [isEntrance, isDining, isBackBar]);

  const barDets    = _DEMO_BAR_DETS[idx % _DEMO_BAR_DETS.length] ?? [];
  const entDets    = _DEMO_ENTRANCE_DETS[idx % _DEMO_ENTRANCE_DETS.length] ?? [];
  const camLabel   = isEntrance ? 'CAM-02 · entrance wide' : isDining ? 'CAM-03 · overhead fisheye' : isBackBar ? 'CAM-04 · back bar' : 'CAM-01 · overhead fisheye';
  const counterLabel = isEntrance ? `${entryCount} entries` : isDining ? `${turns} turns` : `${drinkCount} drinks`;
  const counterColor = isEntrance ? 'bg-amber-500/90' : isDining ? 'bg-purple-500/90' : 'bg-teal/90';
  const logBorderColor = isEntrance ? 'border-amber-500/20' : isDining ? 'border-purple-500/20' : 'border-teal/20';
  const logNameColor   = isEntrance ? 'text-amber-400' : isDining ? 'text-purple-400' : 'text-teal';

  return (
    <div className="mt-1 space-y-2">
      <div className="relative rounded-xl overflow-hidden bg-black" style={{ aspectRatio: '16/9' }}>
        <img key={idx} src={imgs[idx]} alt="camera" className="w-full h-full object-cover opacity-85"
          style={{ transition: 'opacity 0.8s' }} />

        {/* Bar/BackBar: bartender detection boxes */}
        {!isEntrance && !isDining && barDets.map((d, i) => (
          <div key={i} className="absolute border-2 border-teal/80 rounded-sm" style={{ top: d.top, left: d.left, width: d.w, height: d.h }}>
            <div className="absolute -top-5 left-0 px-1 py-0.5 rounded text-[8px] font-bold text-black bg-teal/90 whitespace-nowrap">
              {isBackBar && d.name === 'Marcus' ? 'Priya' : d.name} · {(d.conf * 100).toFixed(0)}%
            </div>
          </div>
        ))}

        {/* Entrance: person bounding boxes */}
        {isEntrance && entDets.map((d, i) => (
          <div key={i} className="absolute border-2 border-amber-400/70 rounded-sm" style={{ top: d.top, left: d.left, width: d.w, height: d.h }}>
            <div className="absolute -top-5 left-0 px-1 py-0.5 rounded text-[8px] font-bold text-black bg-amber-400/90 whitespace-nowrap">
              {d.id}
            </div>
          </div>
        ))}

        {/* Dining: table zone overlays */}
        {isDining && _DINING_TABLES.map((t, i) => (
          <div key={t.id} className={`absolute rounded border-2 flex items-center justify-center ${
            tableOcc[i] ? 'border-green-400/70 bg-green-400/10' : 'border-warm-600/50 bg-black/20'
          }`} style={{ top: t.top, left: t.left, width: t.w, height: t.h }}>
            <span className={`text-[8px] font-bold ${tableOcc[i] ? 'text-green-300' : 'text-warm-600'}`}>{t.id}</span>
          </div>
        ))}

        {/* LIVE badge */}
        <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-md bg-red-600/90 backdrop-blur-sm">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
          </span>
          <span className="text-[10px] font-bold text-white tracking-wider uppercase">Live</span>
        </div>

        {/* Mode counter badge */}
        <div className={`absolute top-2 right-2 flex items-center gap-1.5 px-2 py-1 rounded-md ${counterColor} backdrop-blur-sm`}>
          <span className="text-[10px] font-bold text-black">{counterLabel}</span>
        </div>

        {/* Camera label */}
        <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-black/60 backdrop-blur-sm text-[9px] text-white/70 font-mono">
          {camLabel}
        </div>
      </div>

      {/* Detection event log */}
      {events.length > 0 && (
        <div className={`bg-black/40 border ${logBorderColor} rounded-xl p-2 max-h-24 overflow-hidden`}>
          <p className="text-[9px] text-warm-600 uppercase tracking-wider mb-1">Detection log</p>
          <div className="space-y-0.5">
            {events.map((ev, i) => (
              <div key={i} className="flex items-center gap-2 text-[9px] font-mono" style={{ opacity: 1 - i * 0.15 }}>
                <span className="text-warm-600">{ev.ts}</span>
                <span className={`font-semibold ${logNameColor}`}>{ev.name}</span>
                <span className="text-warm-400">{ev.event}</span>
                <span className="text-warm-600 ml-auto">{(ev.conf * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RoomCard({ room, camProxyUrl, camera, onInvestigate, onConfigureZones, onConfigureTableZones }: {
  room: RoomSummary;
  camProxyUrl: string;
  camera?: CameraConfig | null;
  onInvestigate: (job: VenueScopeJob) => void;
  onConfigureZones?: (camera: CameraConfig) => void;
  onConfigureTableZones?: (camera: CameraConfig) => void;
}) {
  // configuredModes is stamped on the room during allDisplayRooms from the camera admin config —
  // it's the definitive list of what this camera does, independent of which modes appeared in
  // the most recent job (people_count is throttled to every 20 min so most jobs won't list it).
  const activeModes  = room.configuredModes.length ? room.configuredModes : [room.mode];
  const isDrink      = activeModes.includes('drink_count');
  const isPeople     = activeModes.includes('people_count');
  const isTableTurns = activeModes.includes('table_turns');
  const barConfig   = camera ? parseBarConfig(camera.barConfigJson) : null;
  const tableZones  = camera ? parseTableZones(camera.tableZonesJson) : null;
  // Show feed when camProxyUrl is configured OR camera has a direct HTTPS rtspUrl OR demo live job
  const isDemoJob = (room.job?.jobId ?? '').startsWith('demo-live');
  const hasFeed  = !!camProxyUrl || !!camera?.rtspUrl?.startsWith('https://') || isDemoJob;
  const [feedOpen, setFeedOpen] = React.useState(isDrink || isTableTurns || isDemoJob);
  const [secondsLeft, setSecondsLeft] = React.useState(0);

  React.useEffect(() => {
    if (!isPeople) return;
    // Each camera fires on its own hash-offset schedule.
    // Best estimate: last snapshot updatedAt + 1200s. Falls back to global floor if unknown.
    const OCCUPANCY_INTERVAL = 1200;
    const tick = () => {
      const now = Date.now() / 1000;
      const lastAt = room.updatedAt && room.updatedAt > 0 ? room.updatedAt : 0;
      const nextAt = lastAt > 0 && lastAt + OCCUPANCY_INTERVAL > now
        ? lastAt + OCCUPANCY_INTERVAL
        : Math.floor(now / OCCUPANCY_INTERVAL) * OCCUPANCY_INTERVAL + OCCUPANCY_INTERVAL;
      setSecondsLeft(Math.max(0, Math.round(nextAt - now)));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [isPeople, room.updatedAt]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-whoop-panel border rounded-2xl p-4 space-y-3 ${
        room.hasTheftFlag ? 'border-red-500/40' : room.isLive ? 'border-teal/30' : 'border-whoop-divider'
      }`}
    >
      {/* Room header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
            room.isLive ? 'bg-teal/15' : 'bg-whoop-bg'
          }`}>
            <Camera className={`w-3.5 h-3.5 ${room.isLive ? 'text-teal' : 'text-text-muted'}`} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white truncate">{room.label || 'Camera'}</p>
            <p className="text-[10px] text-text-muted capitalize">
              {activeModes.map(m => m.replace(/_/g, ' ')).join(' · ')}
              {room.cameraAngle && (
                <span className="ml-1.5 inline-flex items-center gap-0.5 opacity-60">
                  · {room.cameraAngle}
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {room.isLive ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-teal/20 text-teal border border-teal/30">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-teal" />
              </span>
              Live
            </span>
          ) : (room.job?.jobId ?? '').startsWith('~') ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              Reconnecting
            </span>
          ) : (
            <span className="text-[10px] text-text-muted">{fmtTime(room.updatedAt)}</span>
          )}
          {/* Feed toggle — show when proxy or direct rtspUrl available */}
          {hasFeed && (
            <button
              onClick={() => setFeedOpen(o => !o)}
              className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] text-text-muted hover:text-white hover:bg-whoop-bg transition-colors"
            >
              <Camera className="w-3 h-3" />
              {feedOpen ? 'Hide' : 'Feed'}
              <ChevronDown className={`w-3 h-3 transition-transform ${feedOpen ? 'rotate-180' : ''}`} />
            </button>
          )}
        </div>
      </div>

      {/* Collapsible live camera feed */}
      <AnimatePresence>
        {hasFeed && feedOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            {isDemoJob ? (
              <DemoCameraFeed mode={room.mode} jobId={room.job?.jobId ?? ''} />
            ) : (
              <CameraLiveView
                label={room.label}
                proxyBase={camProxyUrl}
                rtspUrl={camera?.rtspUrl}
                barConfig={barConfig}
                tableZones={tableZones}
                onConfigureZones={
                  isTableTurns && !isDrink
                    ? (camera && onConfigureTableZones ? () => onConfigureTableZones(camera) : undefined)
                    : (camera && onConfigureZones ? () => onConfigureZones(camera) : undefined)
                }
                cameraModes={activeModes}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Primary metrics */}
      {isDrink && (
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-whoop-bg rounded-xl p-2.5 text-center">
            <div className="text-xl font-bold text-teal">{room.totalDrinks}</div>
            <div className="text-[9px] text-text-muted uppercase tracking-wide mt-0.5">Drinks</div>
          </div>
          <div className="bg-whoop-bg rounded-xl p-2.5 text-center">
            <div className="text-xl font-bold text-white">
              {room.drinksPerHour > 0 ? room.drinksPerHour.toFixed(1) : '—'}
            </div>
            <div className="text-[9px] text-text-muted uppercase tracking-wide mt-0.5">Per Hour</div>
          </div>
          <div className="bg-whoop-bg rounded-xl p-2.5 text-center">
            <div className={`text-xl font-bold ${room.unrungDrinks > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
              {room.unrungDrinks}
            </div>
            <div className="text-[9px] text-text-muted uppercase tracking-wide mt-0.5">Unrung</div>
          </div>
        </div>
      )}

      {isPeople && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-whoop-bg rounded-xl p-2.5 text-center">
              <div className={`text-xl font-bold ${room.currentOccupancy > 0 ? 'text-teal' : 'text-text-muted'}`}>
                {/* Show "—" only when the camera has never reported a snapshot
                    yet (elapsedSec === 0); otherwise show the real value,
                    including 0. A closed bar measuring 0 is true information. */}
                {room.elapsedSec > 0 ? room.currentOccupancy : '—'}
              </div>
              <div className="text-[9px] text-text-muted uppercase tracking-wide mt-0.5">In Room</div>
            </div>
            <div className="bg-whoop-bg rounded-xl p-2.5 text-center">
              <div className={`text-xl font-bold ${room.peakOccupancy > 0 ? 'text-white' : 'text-text-muted'}`}>
                {room.elapsedSec > 0 ? room.peakOccupancy : '—'}
              </div>
              <div className="text-[9px] text-text-muted uppercase tracking-wide mt-0.5">Peak</div>
            </div>
          </div>
          {isPeople && (
            <div className="text-center text-[10px] text-text-muted">
              {secondsLeft > 0
                ? `Next count in ${Math.floor(secondsLeft / 60)}m ${String(secondsLeft % 60).padStart(2, '0')}s`
                : <span className="text-teal animate-pulse">Counting now…</span>
              }
            </div>
          )}
        </div>
      )}

      {isTableTurns && (() => {
        // Parse per-table detail for dwell breakdown
        let tableRows: { label: string; turns: number; dwellMin: number }[] = [];
        try {
          const detail = room.job?.tableDetail ? JSON.parse(room.job.tableDetail) : null;
          if (detail) {
            tableRows = Object.entries(detail as Record<string, { label?: string; turn_count?: number; avg_dwell_min?: number }>)
              .map(([id, d]) => ({ label: d.label ?? id, turns: d.turn_count ?? 0, dwellMin: d.avg_dwell_min ?? 0 }))
              .filter(r => r.turns > 0)
              .sort((a, b) => b.dwellMin - a.dwellMin);
          }
        } catch { /* ignore */ }

        // Parse live occupancy for real-time "currently seated" indicators
        type LiveOccRow = { label: string; occupied: boolean };
        let liveOccRows: LiveOccRow[] = [];
        try {
          const lto = room.job?.liveTableOccupancy ? JSON.parse(room.job.liveTableOccupancy) : null;
          if (lto) {
            liveOccRows = Object.entries(lto as Record<string, { label?: string; currently_occupied?: boolean }>)
              .map(([id, d]) => ({ label: d.label ?? id, occupied: d.currently_occupied ?? false }));
          }
        } catch { /* ignore */ }
        const occupiedCount = liveOccRows.filter(r => r.occupied).length;

        return (
          <div className="space-y-2">
            {/* Live occupancy banner — only shown when zones are detected */}
            {room.isLive && liveOccRows.length > 0 && (
              <div className={`rounded-xl px-3 py-2 flex items-center gap-2 text-[11px] font-medium ${occupiedCount > 0 ? 'bg-green-900/40 text-green-300' : 'bg-whoop-bg text-text-muted'}`}>
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${occupiedCount > 0 ? 'bg-green-400 animate-pulse' : 'bg-gray-600'}`} />
                {occupiedCount > 0
                  ? `${occupiedCount} of ${liveOccRows.length} table${liveOccRows.length !== 1 ? 's' : ''} occupied`
                  : `${liveOccRows.length} table${liveOccRows.length !== 1 ? 's' : ''} — all clear`}
              </div>
            )}
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-whoop-bg rounded-xl p-3 text-center">
                <div className="text-xl font-bold text-white">
                  {room.totalTurns > 0 ? room.totalTurns : '—'}
                </div>
                <div className="text-[10px] text-text-muted mt-0.5 uppercase tracking-wide">Turns</div>
              </div>
              <div className="bg-whoop-bg rounded-xl p-3 text-center">
                <div className="text-xl font-bold text-white">
                  {room.avgDwellMin > 0 ? `${Math.round(room.avgDwellMin)}m` : '—'}
                </div>
                <div className="text-[10px] text-text-muted mt-0.5 uppercase tracking-wide">Avg Dwell</div>
              </div>
              <div className="bg-whoop-bg rounded-xl p-3 text-center">
                <div className="text-xl font-bold text-white">
                  {room.avgResponseSec > 0 ? `${Math.round(room.avgResponseSec)}s` : '—'}
                </div>
                <div className="text-[10px] text-text-muted mt-0.5 uppercase tracking-wide">Response</div>
              </div>
            </div>
            {tableRows.length > 0 && (
              <div className="bg-whoop-bg rounded-xl px-3 py-2 space-y-1.5">
                {tableRows.map(row => (
                  <div key={row.label} className="flex items-center justify-between text-[10px]">
                    <span className="text-text-muted truncate">{row.label}</span>
                    <div className="flex items-center gap-3 flex-shrink-0 ml-2">
                      <span className="text-white">{row.turns} turn{row.turns !== 1 ? 's' : ''}</span>
                      <span className="text-purple-400">{row.dwellMin > 0 ? `${Math.round(row.dwellMin)}m dwell` : '—'}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {!isDrink && !isPeople && !isTableTurns && (
        <div className="bg-whoop-bg rounded-xl p-3 text-center">
          <div className="text-xs text-text-muted capitalize">{room.mode.replace(/_/g, ' ')}</div>
          {room.elapsedSec > 0 && (
            <div className="text-[10px] text-text-muted mt-0.5">{fmtElapsed(room.elapsedSec)} elapsed</div>
          )}
        </div>
      )}

      {/* Live theft / shrinkage row */}
      {room.job && (() => {
        const job = room.job;
        let evCount = 0;
        try { evCount = job.liveTheftEvents ? JSON.parse(job.liveTheftEvents).length : 0; } catch { evCount = 0; }
        const shrink = job.shrinkageOz ?? 0;
        if (evCount === 0 && shrink === 0) return null;
        return (
          <div className="flex items-center gap-2 flex-wrap">
            {evCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/15 text-red-400 border border-red-500/25">
                <AlertTriangle className="w-2.5 h-2.5" />
                {evCount} theft event{evCount !== 1 ? 's' : ''} detected
              </span>
            )}
            {shrink > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-orange-500/15 text-orange-400 border border-orange-500/25">
                <GlassWater className="w-2.5 h-2.5" />
                {shrink.toFixed(1)} oz shrinkage
              </span>
            )}
          </div>
        );
      })()}

      {/* Footer row */}
      <div className="flex items-center justify-between text-[10px] text-text-muted">
        {isDrink && room.topBartender ? (
          <span className="flex items-center gap-1">
            <User className="w-3 h-3" />
            {room.topBartender}
          </span>
        ) : room.elapsedSec > 0 ? (
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {fmtElapsed(room.elapsedSec)}
          </span>
        ) : <span />}

        {room.hasTheftFlag && room.job ? (
          <button
            onClick={() => onInvestigate(room.job!)}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors"
          >
            <AlertTriangle className="w-2.5 h-2.5" />
            Review
          </button>
        ) : (
          <span className="inline-flex items-center gap-1 text-emerald-400">
            <ShieldCheck className="w-3 h-3" />
            Clean
          </span>
        )}
      </div>

      {/* Zone breakdown — drinks per bar zone */}
      {isDrink && <ZoneBreakdownSection job={room.job} />}

      {/* Drink log — expandable, drink_count cameras only */}
      {isDrink && <DrinkLogSection job={room.job} />}

      {/* Table visits by staff */}
      <TableVisitsSection job={room.job} />
    </motion.div>
  );
}

// ── Bartender leaderboard ─────────────────────────────────────────────────────

function BartenderBoard({ bartenders }: { bartenders: BartenderStat[] }) {
  const max = bartenders.length > 0 ? (bartenders[0].drinks || 1) : 1;

  return (
    <div className="bg-whoop-panel border border-whoop-divider rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <Activity className="w-4 h-4 text-teal" />
          Behind the Bar
        </h2>
        <span className="text-[10px] text-text-muted bg-whoop-bg border border-whoop-divider px-2 py-0.5 rounded-full">
          {bartenders.length} bartender{bartenders.length !== 1 ? 's' : ''}
        </span>
      </div>
      {bartenders.length === 0 ? (
        <p className="text-xs text-text-muted text-center py-4">Bartender activity will appear once the shift begins.</p>
      ) : (
      <div className="space-y-3">
        {bartenders.map((b, i) => (
          <div key={b.name} className="flex items-center gap-3">
            <span className="text-[10px] text-text-muted w-4 text-right flex-shrink-0">{i + 1}</span>
            <div className="w-7 h-7 rounded-full bg-whoop-bg border border-whoop-divider flex items-center justify-center flex-shrink-0">
              <User className="w-3.5 h-3.5 text-text-muted" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-white truncate">{b.name}</span>
                <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                  <span className="text-xs font-bold text-teal">{b.drinks}</span>
                  <span className="text-[10px] text-text-muted">drinks</span>
                  {b.perHour > 0 && (
                    <span className="text-[10px] text-text-muted ml-1">{b.perHour.toFixed(1)}/hr</span>
                  )}
                  {b.hasTheft && (
                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-red-500/20 text-red-400 border border-red-500/30">
                      <AlertTriangle className="w-2 h-2" />
                      Alert
                    </span>
                  )}
                </div>
              </div>
              <div className="w-full bg-whoop-bg rounded-full h-1">
                <div
                  className={`h-1 rounded-full transition-all duration-700 ${b.hasTheft ? 'bg-red-400' : 'bg-teal'}`}
                  style={{ width: `${(b.drinks / max) * 100}%` }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
      )}
    </div>
  );
}

// ── Theft alert panel ─────────────────────────────────────────────────────────

function TheftAlerts({ jobs, avgDrinkPrice, onInvestigate }: {
  jobs: VenueScopeJob[];
  avgDrinkPrice: number;
  onInvestigate: (job: VenueScopeJob) => void;
}) {
  const flagged = jobs.filter(j => j.hasTheftFlag);
  if (flagged.length === 0) return null;
  const totalLoss = flagged.reduce((s, j) => s + (j.unrungDrinks ?? 0) * avgDrinkPrice, 0);

  return (
    <div className="bg-red-500/5 border border-red-500/30 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-400" />
          Theft Alerts
        </h2>
        <span className="text-xs text-red-400 font-semibold">
          ~${totalLoss.toFixed(0)} est. loss
        </span>
      </div>
      <div className="space-y-2">
        {flagged.map(job => (
          <div key={job.jobId} className="bg-whoop-bg border border-red-500/20 rounded-xl px-3 py-2.5 flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-white truncate">
                {job.roomLabel || job.clipLabel || job.cameraLabel || 'Camera'}
              </p>
              <p className="text-[10px] text-text-muted mt-0.5">
                {job.unrungDrinks ?? 0} unrung · {fmtTime(job.createdAt)}
                {job.topBartender ? ` · ${job.topBartender}` : ''}
              </p>
            </div>
            <button
              onClick={() => onInvestigate(job)}
              className="flex items-center gap-1 px-2 sm:px-3 py-1.5 rounded-xl text-xs font-semibold bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors flex-shrink-0"
            >
              Investigate
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── History accordion ─────────────────────────────────────────────────────────

function Row({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) {
  return (
    <div className="flex justify-between text-text-muted">
      <span>{label}</span>
      <span className={color ?? 'text-text-secondary'}>{value}</span>
    </div>
  );
}

function HistoryAccordion({ jobs, onInvestigate, onExport, initialOpen = false }: {
  jobs: VenueScopeJob[];
  onInvestigate: (job: VenueScopeJob) => void;
  onExport: () => void;
  initialOpen?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);

  if (jobs.length === 0) return null;

  return (
    <div className="bg-whoop-panel border border-whoop-divider rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm text-text-secondary hover:text-white transition-colors"
      >
        <span className="flex items-center gap-2">
          <Clock className="w-3.5 h-3.5" />
          Job History ({jobs.length})
        </span>
        <div className="flex items-center gap-3">
          <button
            onClick={e => { e.stopPropagation(); onExport(); }}
            className="text-[10px] text-text-muted hover:text-teal transition-colors flex items-center gap-1"
          >
            <Download className="w-3 h-3" />
            CSV
          </button>
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            className="overflow-hidden"
          >
            <div className="border-t border-whoop-divider divide-y divide-whoop-divider">
              {jobs.map(job => (
                <HistoryRow key={job.jobId} job={job} onInvestigate={onInvestigate} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function HistoryRow({ job, onInvestigate }: {
  job: VenueScopeJob;
  onInvestigate: (j: VenueScopeJob) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const modes = parseModes(job);
  const isLive = job.isLive || job.status === 'running';

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <Camera className={`w-3.5 h-3.5 flex-shrink-0 ${isLive ? 'text-teal' : 'text-text-muted'}`} />
          <div className="min-w-0">
            <p className="text-sm text-white truncate">
              {job.roomLabel || job.cameraLabel || job.clipLabel || job.jobId.slice(-8)}
            </p>
            <p className="text-[10px] text-text-muted">{fmtTime(job.createdAt)}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {isLive ? (
            <span className="text-[10px] text-teal flex items-center gap-1">
              <Loader2 className="w-2.5 h-2.5 animate-spin" />
              Live
            </span>
          ) : (
            <>
              {(job.totalDrinks ?? 0) > 0 && (
                <span className="text-xs font-semibold text-teal">{job.totalDrinks} drinks</span>
              )}
              {(job.totalEntries ?? 0) > 0 && (
                <span className="text-xs text-text-secondary">{job.totalEntries} in</span>
              )}
            </>
          )}
          {job.hasTheftFlag && (
            <button onClick={() => onInvestigate(job)} className="text-red-400 hover:text-red-300 transition-colors">
              <AlertTriangle className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => setExpanded(e => !e)}
            className="text-text-muted hover:text-white transition-colors"
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-3 pt-3 border-t border-whoop-divider space-y-1.5 text-[10px] pl-6">
              {modes.includes('drink_count') && (
                <>
                  <Row label="Total drinks"  value={job.totalDrinks ?? 0} />
                  <Row label="Drinks / hr"   value={job.drinksPerHour?.toFixed(1) ?? '—'} />
                  <Row label="Unrung"        value={job.unrungDrinks ?? 0} color={(job.unrungDrinks ?? 0) > 0 ? 'text-amber-400' : undefined} />
                  {job.topBartender && <Row label="Bartender"   value={job.topBartender} />}
                </>
              )}
              {modes.includes('people_count') && (
                <>
                  <Row label="Entries"       value={job.totalEntries ?? 0} />
                  <Row label="Peak occupancy" value={job.peakOccupancy ?? 0} />
                </>
              )}
              <Row label="Duration" value={fmtDuration(job.createdAt, job.finishedAt)} />
              <ConfidenceBadge color={job.confidenceColor} label={job.confidenceLabel} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Tonight section (sports + day context) ────────────────────────────────────

function TonightSection() {
  const [games, setGames] = useState<SportsGame[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    sportsService.getTodaysGames()
      .then(g => { setGames(g); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const liveGames = games.filter(g => g.status === 'live');
  const upcomingGames = games.filter(g => g.status === 'scheduled');
  const displayGames = [...liveGames, ...upcomingGames].slice(0, 6);

  const dayName = new Date().toLocaleDateString(undefined, { weekday: 'long' });
  const isWeekend = [0, 5, 6].includes(new Date().getDay());

  if (loading) return null;

  return (
    <div className="bg-whoop-panel border border-whoop-divider rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <Calendar className="w-4 h-4 text-text-muted" />
          Tonight
        </h2>
        <span className="text-[10px] text-text-muted">
          {isWeekend ? '🟢 Peak night' : '🟡 Weeknight'} · {dayName}
        </span>
      </div>

      {displayGames.length === 0 ? (
        <p className="text-xs text-text-muted">No major games scheduled today.</p>
      ) : (
        <div className="space-y-2">
          {displayGames.map(game => (
            <div key={game.id} className={`flex items-center justify-between px-3 py-2 rounded-xl text-xs ${
              game.status === 'live'
                ? 'bg-red-500/10 border border-red-500/20'
                : 'bg-whoop-bg border border-whoop-divider'
            }`}>
              <div className="flex items-center gap-2 min-w-0">
                {game.status === 'live' && (
                  <span className="relative flex h-1.5 w-1.5 flex-shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-400" />
                  </span>
                )}
                <span className="text-[10px] text-text-muted font-medium flex-shrink-0">{game.sport}</span>
                <span className="text-white font-medium truncate">
                  {game.awayTeam} @ {game.homeTeam}
                </span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                {game.status === 'live' ? (
                  <span className="text-red-400 font-bold">
                    {game.awayScore} – {game.homeScore}
                    {game.network && <span className="text-text-muted font-normal ml-1">· {game.network}</span>}
                  </span>
                ) : (
                  <span className="text-text-muted">
                    {new Date(game.startTime).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                    {game.network && ` · ${game.network}`}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Drink pace chart ──────────────────────────────────────────────────────────

function PaceChart({ jobs }: { jobs: VenueScopeJob[] }) {
  // Bucket drink events into 15-min windows over last 60 min.
  // For live camera jobs: parse per-drink timestamps from bartenderBreakdown.
  // For completed snapshot jobs: use job createdAt as the event time.
  const now = Date.now() / 1000;

  const drinkWallTimes: number[] = [];
  for (const j of jobs) {
    const created = j.createdAt ?? 0;
    if (j.isLive && j.bartenderBreakdown) {
      try {
        const bd = JSON.parse(j.bartenderBreakdown) as Record<string, { timestamps?: number[] }>;
        for (const d of Object.values(bd)) {
          for (const tSec of d.timestamps ?? []) {
            const wall = created + tSec;
            if (wall >= now - 3600) drinkWallTimes.push(wall);
          }
        }
      } catch { /* no-op */ }
    } else if (!j.isLive && j.status === 'done') {
      const count = j.totalDrinks ?? 0;
      if (count > 0 && created >= now - 3600) {
        for (let k = 0; k < count; k++) drinkWallTimes.push(created);
      }
    }
  }

  const buckets = [45, 30, 15, 0].map(minsAgo => {
    const bucketStart = now - (minsAgo + 15) * 60;
    const bucketEnd   = now - minsAgo * 60;
    const label = minsAgo === 0 ? 'Now' : `-${minsAgo + 15}m`;
    const drinks = drinkWallTimes.filter(t => t >= bucketStart && t < bucketEnd).length;
    return { label, drinks };
  });

  const maxDrinks = Math.max(...buckets.map(b => b.drinks), 1);
  const hasData = buckets.some(b => b.drinks > 0);

  return (
    <div className="bg-whoop-panel border border-whoop-divider rounded-2xl p-4">
      <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-4">
        <TrendingUp className="w-4 h-4 text-teal" />
        Drink Pace — Last Hour
      </h2>
      {!hasData ? (
        <p className="text-xs text-text-muted text-center py-4">Drink pace will populate once the shift starts.</p>
      ) : (
      <div className="flex items-end gap-2 h-16">
        {buckets.map(({ label, drinks }) => (
          <div key={label} className="flex-1 flex flex-col items-center gap-1">
            <span className="text-[10px] text-text-muted font-medium">{drinks > 0 ? drinks : ''}</span>
            <div className="w-full rounded-t-md bg-teal/20 flex items-end overflow-hidden" style={{ height: '44px' }}>
              <div
                className="w-full bg-teal rounded-t-md transition-all duration-700"
                style={{ height: `${(drinks / maxDrinks) * 44}px` }}
              />
            </div>
            <span className="text-[9px] text-text-muted">{label}</span>
          </div>
        ))}
      </div>
      )}
    </div>
  );
}

// ── POS Reconciliation Panel ──────────────────────────────────────────────────

function POSReconciliationPanel({ jobs }: { jobs: VenueScopeJob[] }) {
  // Only show when at least one job has POS variance data
  const posJobs = jobs.filter(j => j.posVariancePct != null);
  if (posJobs.length === 0) return null;

  // Aggregate across all POS-enabled jobs
  const cameraCount  = posJobs.reduce((s, j) => s + (j.posCameraCount ?? 0), 0);
  const posCount     = posJobs.reduce((s, j) => s + (j.posItemCount ?? 0), 0);
  const varianceDrks = posJobs.reduce((s, j) => s + (j.posVarianceDrinks ?? 0), 0);
  const lostRevenue  = posJobs.reduce((s, j) => s + (j.posLostRevenue ?? 0), 0);
  const avgVariance  = posJobs.reduce((s, j) => s + (j.posVariancePct ?? 0), 0) / posJobs.length;
  const provider     = posJobs[0].posProvider ?? 'POS';

  const varianceLevel =
    avgVariance < 5  ? 'green' :
    avgVariance < 15 ? 'amber' : 'red';

  const colors = {
    green: {
      border: 'border-emerald-500/30',
      bg:     'bg-emerald-500/5',
      badge:  'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
      value:  'text-emerald-400',
      alert:  null,
    },
    amber: {
      border: 'border-amber-500/30',
      bg:     'bg-amber-500/5',
      badge:  'bg-amber-500/20 text-amber-400 border-amber-500/30',
      value:  'text-amber-400',
      alert:  `${avgVariance.toFixed(0)}% variance detected — review recent shifts.`,
    },
    red: {
      border: 'border-red-500/30',
      bg:     'bg-red-500/5',
      badge:  'bg-red-500/20 text-red-400 border-red-500/30',
      value:  'text-red-400',
      alert:  `Tonight's bar showing > ${avgVariance.toFixed(0)}% variance — review immediately.`,
    },
  }[varianceLevel];

  return (
    <div className={`border rounded-2xl p-4 ${colors.border} ${colors.bg}`}>
      {/* Header row */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <CreditCard className="w-4 h-4 text-text-muted" />
          POS Reconciliation
        </h2>
        <span className={`inline-flex items-center gap-1 text-[11px] font-semibold border rounded-full px-2.5 py-0.5 ${colors.badge}`}>
          {provider} Connected
        </span>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        <div className="bg-whoop-bg rounded-xl p-3 text-center">
          <div className="text-xl font-bold text-white">{cameraCount}</div>
          <div className="text-[9px] text-text-muted uppercase tracking-wide mt-0.5">Camera Counted</div>
        </div>
        <div className="bg-whoop-bg rounded-xl p-3 text-center">
          <div className="text-xl font-bold text-text-secondary">{posCount}</div>
          <div className="text-[9px] text-text-muted uppercase tracking-wide mt-0.5">POS Sales</div>
        </div>
        <div className="bg-whoop-bg rounded-xl p-3 text-center">
          <div className={`text-xl font-bold ${colors.value}`}>
            {varianceDrks > 0 ? `+${varianceDrks}` : varianceDrks} ({avgVariance.toFixed(1)}%)
          </div>
          <div className="text-[9px] text-text-muted uppercase tracking-wide mt-0.5">Variance</div>
        </div>
        <div className="bg-whoop-bg rounded-xl p-3 text-center">
          <div className={`text-xl font-bold ${varianceLevel !== 'green' ? 'text-red-400' : 'text-emerald-400'}`}>
            {lostRevenue > 0 ? `$${lostRevenue.toFixed(0)}` : '$0'}
          </div>
          <div className="text-[9px] text-text-muted uppercase tracking-wide mt-0.5">Est. Lost</div>
        </div>
      </div>

      {/* Alert message */}
      {colors.alert && (
        <div className={`flex items-start gap-2 px-3 py-2 rounded-xl border text-xs font-medium ${colors.badge}`}>
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          {colors.alert}
        </div>
      )}
    </div>
  );
}

// ── Table visits by staff ─────────────────────────────────────────────────────

function TableVisitsSection({ job }: { job: VenueScopeJob | null }) {
  if (!job?.tableVisitsByStaff) return null;
  let data: Record<string, Record<string, number>>;
  try {
    data = JSON.parse(job.tableVisitsByStaff) as Record<string, Record<string, number>>;
  } catch {
    return null;
  }

  const tables = Object.entries(data).sort(([a], [b]) => a.localeCompare(b));
  if (tables.length === 0) return null;

  return (
    <div className="mt-3 pt-3 border-t border-whoop-divider/60">
      <p className="text-[10px] text-text-muted uppercase tracking-wide mb-2">Table Visits</p>
      <div className="space-y-1">
        {tables.map(([tableId, staffMap]) => {
          const staffList = Object.entries(staffMap)
            .sort(([, a], [, b]) => b - a)
            .map(([name, count]) => `${name} (${count})`)
            .join(', ');
          return (
            <div key={tableId} className="flex items-start gap-2 text-[11px]">
              <span className="text-text-muted flex-shrink-0 w-12">Table {tableId}:</span>
              <span className="text-warm-300">{staffList}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Drink log ─────────────────────────────────────────────────────────────────

interface DrinkEntry {
  wallTime: number; // epoch seconds
  bartender: string;
  score: number;    // 0.0–1.0 confidence
  snapshotKey?: string; // S3 key for frame snapshot
  tSec?: number;    // video-relative timestamp for snapshot lookup
}

interface ReviewEntry {
  wallTime: number;
  score: number;
  stationId: string;
  snapshotKey?: string;
  tSec?: number;
}

// ── Snapshot modal ────────────────────────────────────────────────────────────

function SnapshotThumb({ snapshotKey, onClick }: { snapshotKey: string; onClick: () => void }) {
  const s3Base = (import.meta.env.VITE_S3_SUMMARY_BASE_URL || '').replace(/\/$/, '');
  const url = snapshotKey.startsWith('https://')
    ? snapshotKey
    : s3Base ? `${s3Base}/${snapshotKey}` : null;
  if (!url) return <Camera className="w-3 h-3 text-teal/70" />;
  return (
    <img
      src={url}
      alt="serve"
      onClick={e => { e.stopPropagation(); onClick(); }}
      className="h-7 w-10 object-cover rounded cursor-pointer border border-whoop-divider/40 hover:border-teal/60 hover:scale-105 transition-all flex-shrink-0"
      onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
    />
  );
}

function SnapshotModal({ snapshotKey, wallTime, onClose }: {
  snapshotKey: string;
  wallTime: number;
  onClose: () => void;
}) {
  // snapshotKey may be a full presigned URL (new worker) or a raw S3 key (legacy).
  // Presigned URLs start with "https://"; raw keys need s3Base prepended.
  const s3Base = (import.meta.env.VITE_S3_SUMMARY_BASE_URL || '').replace(/\/$/, '');
  const url = snapshotKey.startsWith('https://')
    ? snapshotKey
    : s3Base ? `${s3Base}/${snapshotKey}` : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.92, opacity: 0 }}
        className="relative max-w-lg w-full mx-4 bg-whoop-surface rounded-2xl overflow-hidden border border-whoop-divider shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-whoop-divider">
          <div>
            <p className="text-sm font-semibold text-white">Serve Detection</p>
            <p className="text-[11px] text-text-muted font-mono">
              {new Date(wallTime * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
            </p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="bg-black flex items-center justify-center min-h-[200px]">
          {url ? (
            <img
              src={url}
              alt="Serve detection frame"
              className="w-full object-contain max-h-[60vh]"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          ) : (
            <p className="text-text-muted text-sm p-8 text-center">
              Snapshot not available — configure VITE_S3_SUMMARY_BASE_URL
            </p>
          )}
        </div>
      </motion.div>
    </div>
  );
}

// ── Zone breakdown ─────────────────────────────────────────────────────────────

interface ZoneData {
  drinks: number;
  label: string;
  events?: Array<{ t_sec: number; score: number; x: number; y: number }>;
}

function ZoneBreakdownSection({ job }: { job: VenueScopeJob | null }) {
  if (!(job as any)?.zoneBreakdown) return null;

  let zones: Record<string, ZoneData> = {};
  try {
    zones = JSON.parse((job as any).zoneBreakdown) as Record<string, ZoneData>;
  } catch { return null; }

  const entries = Object.entries(zones).sort((a, b) => b[1].drinks - a[1].drinks);
  if (entries.length === 0) return null;

  const total = entries.reduce((s, [, z]) => s + z.drinks, 0);
  const max   = entries[0][1].drinks;

  return (
    <div className="mt-3 pt-3 border-t border-whoop-divider/60">
      <div className="text-[10px] text-text-muted uppercase tracking-wide font-semibold mb-2 flex items-center gap-1.5">
        <span>⬛</span> Zone Output
      </div>
      <div className="space-y-2">
        {entries.map(([zoneId, z]) => {
          const pct    = max > 0 ? (z.drinks / max) * 100 : 0;
          const share  = total > 0 ? Math.round((z.drinks / total) * 100) : 0;
          const label  = z.label !== zoneId ? z.label : zoneId.replace(/_/g, ' ');
          return (
            <div key={zoneId}>
              <div className="flex items-center justify-between text-[11px] mb-0.5">
                <span className="text-white font-medium capitalize">{label}</span>
                <div className="flex items-center gap-2 text-[10px]">
                  <span className="text-text-muted">{share}%</span>
                  <span className="text-teal font-bold tabular-nums">{z.drinks}</span>
                </div>
              </div>
              <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-teal rounded-full transition-all duration-700"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 text-[9px] text-text-muted text-right">{total} total · positions stored for re-zoning</div>
    </div>
  );
}

// ── Serve score badge (drink log confidence %) ────────────────────────────────

function ServeScoreBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color = pct >= 70 ? 'text-emerald-400' : pct >= 40 ? 'text-yellow-400' : 'text-orange-400';
  return <span className={`font-mono tabular-nums text-[10px] ${color}`}>{pct}%</span>;
}

function DrinkLogSection({ job }: { job: VenueScopeJob | null }) {
  const [open, setOpen] = useState(false);
  const [showLowConf, setShowLowConf] = useState(false);
  const [activeSnap, setActiveSnap] = useState<{ key: string; wallTime: number } | null>(null);

  if (!job?.bartenderBreakdown) return null;

  let entries: DrinkEntry[] = [];
  let reviewEntries: ReviewEntry[] = [];

  // Parse serve snapshot keys: {t_sec_str -> s3_key}
  const snapshots: Record<string, string> = {};
  try {
    if ((job as any).serveSnapshots) {
      Object.assign(snapshots, JSON.parse((job as any).serveSnapshots));
    }
  } catch { /* no-op */ }

  // Lookup helper — find closest snapshot key within tolerance of a given t_sec
  // Demo jobs use integer keys spaced ~420s apart, so use 400s tolerance for them
  const isDemo = (job?.jobId ?? '').startsWith('demo-');
  const findSnap = (tSec: number): string | undefined => {
    const keys = Object.keys(snapshots);
    if (!keys.length) return undefined;
    let best: string | undefined;
    let bestDiff = Infinity;
    const tolerance = isDemo ? 400 : 1.0;
    for (const k of keys) {
      const diff = Math.abs(parseFloat(k) - tSec);
      if (diff < bestDiff && diff < tolerance) { bestDiff = diff; best = snapshots[k]; }
    }
    return best;
  };

  try {
    const bd = JSON.parse(job.bartenderBreakdown) as Record<string, {
      drinks?: number; per_hour?: number; timestamps?: number[]; drink_scores?: number[];
    }>;
    for (const [name, d] of Object.entries(bd)) {
      const ts = d.timestamps ?? [];
      const scores = d.drink_scores ?? [];
      for (let i = 0; i < ts.length; i++) {
        const tSec = ts[i];
        entries.push({
          wallTime: (job.createdAt ?? 0) + tSec,
          bartender: name,
          score: scores[i] ?? 0,
          tSec,
          snapshotKey: findSnap(tSec),
        });
      }
    }
  } catch { /* no-op */ }

  try {
    if ((job as any).reviewEvents) {
      const revs = JSON.parse((job as any).reviewEvents) as Array<{
        t_sec: number; score: number; station_id: string;
      }>;
      for (const r of revs) {
        reviewEntries.push({
          wallTime: (job.createdAt ?? 0) + r.t_sec,
          score: r.score,
          stationId: r.station_id,
          tSec: r.t_sec,
          snapshotKey: findSnap(r.t_sec),
        });
      }
    }
  } catch { /* no-op */ }

  if (entries.length === 0 && reviewEntries.length === 0) return null;

  // Most recent first
  entries = entries.sort((a, b) => b.wallTime - a.wallTime);
  reviewEntries = reviewEntries.sort((a, b) => b.wallTime - a.wallTime);

  return (
    <div className="mt-3 pt-3 border-t border-whoop-divider/60">
      <AnimatePresence>
        {activeSnap && (
          <SnapshotModal
            snapshotKey={activeSnap.key}
            wallTime={activeSnap.wallTime}
            onClose={() => setActiveSnap(null)}
          />
        )}
      </AnimatePresence>

      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between text-[10px] text-text-muted hover:text-white transition-colors"
      >
        <span className="flex items-center gap-1.5 uppercase tracking-wide font-semibold">
          <Activity className="w-3 h-3" />
          Drink Log ({entries.length})
        </span>
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-2 space-y-1 max-h-48 overflow-y-auto pr-1">
              {entries.map((e, i) => (
                <div
                  key={i}
                  className="flex items-center gap-1.5 text-[11px] py-1 border-b border-whoop-divider/30 last:border-0"
                >
                  {e.snapshotKey && (
                    <SnapshotThumb
                      snapshotKey={e.snapshotKey}
                      onClick={() => setActiveSnap({ key: e.snapshotKey!, wallTime: e.wallTime })}
                    />
                  )}
                  <span className="text-teal font-mono tabular-nums flex-shrink-0">
                    {new Date(e.wallTime * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
                  </span>
                  <span className="text-text-muted truncate min-w-0 ml-1">{e.bartender}</span>
                  <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
                    {e.score > 0 && <ServeScoreBadge score={e.score} />}
                    {!e.snapshotKey && <span className="text-emerald-400">✓</span>}
                  </div>
                </div>
              ))}
            </div>

            {/* Low confidence section */}
            {reviewEntries.length > 0 && (
              <div className="mt-2 pt-2 border-t border-whoop-divider/40">
                <button
                  onClick={() => setShowLowConf(o => !o)}
                  className="w-full flex items-center justify-between text-[10px] text-yellow-500/80 hover:text-yellow-400 transition-colors"
                >
                  <span className="flex items-center gap-1 uppercase tracking-wide font-semibold">
                    <span>⚠</span> Low Confidence ({reviewEntries.length})
                  </span>
                  {showLowConf ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
                <AnimatePresence>
                  {showLowConf && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <p className="text-[9px] text-text-muted mt-1 mb-1.5 italic">
                        Below confidence threshold — not counted. Review to confirm or dismiss.
                      </p>
                      <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                        {reviewEntries.map((e, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-1.5 text-[11px] py-1 border-b border-whoop-divider/20 last:border-0"
                          >
                            {e.snapshotKey && (
                              <SnapshotThumb
                                snapshotKey={e.snapshotKey}
                                onClick={() => setActiveSnap({ key: e.snapshotKey!, wallTime: e.wallTime })}
                              />
                            )}
                            <span className="text-text-muted font-mono tabular-nums flex-shrink-0">
                              {new Date(e.wallTime * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
                            </span>
                            <span className="text-text-muted/60 truncate min-w-0 ml-1 text-[10px]">{e.stationId || 'bar'}</span>
                            <div className="ml-auto flex items-center gap-1 flex-shrink-0">
                              <ServeScoreBadge score={e.score} />
                              {!e.snapshotKey && <span className="text-yellow-500/60 text-[10px]">?</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Detection event log ───────────────────────────────────────────────────────

type EventKind = 'drink' | 'theft';

interface DetectionEvent {
  wallTime: number;
  kind: EventKind;
  camera: string;
  channel: string | null;
  bartender?: string;
  jobId: string;
}

function buildDetectionEvents(jobs: VenueScopeJob[]): DetectionEvent[] {
  const events: DetectionEvent[] = [];
  for (const job of jobs) {
    const camera = job.roomLabel || job.cameraLabel || friendlyClipLabel(job.clipLabel) || '';
    const channel = channelFromSources(camera, null);

    if (job.bartenderBreakdown) {
      try {
        const bd = JSON.parse(job.bartenderBreakdown) as Record<string, { timestamps?: number[] }>;
        for (const [bartender, d] of Object.entries(bd)) {
          for (const t of d.timestamps ?? []) {
            events.push({
              wallTime: (job.createdAt ?? 0) + t,
              kind: 'drink',
              camera,
              channel,
              bartender: bartender !== 'Unknown' ? bartender : undefined,
              jobId: job.jobId,
            });
          }
        }
      } catch { /* no-op */ }
    }

    if (job.hasTheftFlag && job.createdAt) {
      events.push({
        wallTime: job.createdAt,
        kind: 'theft',
        camera,
        channel,
        bartender: job.topBartender || undefined,
        jobId: job.jobId,
      });
    }
  }
  return events.sort((a, b) => b.wallTime - a.wallTime);
}

function buildNvrUrl(template: string, channel: string | null, wallTime: number): string {
  const dt = new Date(wallTime * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const starttime = `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}T${pad(dt.getHours())}${pad(dt.getMinutes())}${pad(dt.getSeconds())}`;
  return template
    .replace('{channel}', channel ?? 'ch1')
    .replace('{starttime}', starttime);
}

function DetectionEventsPanel({
  jobs,
  nvrUrlTemplate,
  onSaveNvrUrl,
  businessHours,
}: {
  jobs: VenueScopeJob[];
  nvrUrlTemplate: string;
  onSaveNvrUrl: (url: string) => void;
  businessHours?: ReturnType<typeof venueSettingsService.getBusinessHours>;
}) {
  const [filter, setFilter] = useState<'all' | 'drink' | 'theft'>('all');
  const [editingUrl, setEditingUrl] = useState(false);
  const [urlDraft, setUrlDraft] = useState(nvrUrlTemplate);
  const [open, setOpen] = useState(false);

  // Returns true if a wallTime (epoch sec) falls within the venue's business hours.
  // Excludes after-hours detections (e.g. 4 AM cleaning staff after 2 AM close).
  const isWithinBizHours = useCallback((wallTime: number): boolean => {
    if (!businessHours) return true; // no hours configured = show everything
    const DAY_KEYS = ['sun','mon','tue','wed','thu','fri','sat'];
    const dt = new Date(wallTime * 1000);
    let openStr: string | undefined;
    let closeStr: string | undefined;
    if (businessHours.days) {
      const day = businessHours.days[DAY_KEYS[dt.getDay()]];
      if (day?.closed) return false;
      openStr  = day?.open;
      closeStr = day?.close;
    }
    openStr  = openStr  ?? businessHours.open;
    closeStr = closeStr ?? businessHours.close;
    if (!openStr || !closeStr) return true;
    const [oH, oM] = openStr.split(':').map(Number);
    const [cH, cM] = closeStr.split(':').map(Number);
    const openMin  = oH * 60 + oM;
    const closeMin = cH * 60 + cM;
    const wallMin  = dt.getHours() * 60 + dt.getMinutes();
    // Past-midnight close (e.g. open 17:00 close 02:00):
    // in-hours = after open OR before close
    if (closeMin <= openMin) return wallMin >= openMin || wallMin < closeMin;
    return wallMin >= openMin && wallMin < closeMin;
  }, [businessHours]);

  const allEvents = useMemo(() => {
    const evs = buildDetectionEvents(jobs);
    // Filter drinks to only those that occurred during business hours.
    // Theft events always show regardless of time.
    return evs.filter(e => e.kind === 'theft' || isWithinBizHours(e.wallTime));
  }, [jobs, isWithinBizHours]);
  const filtered  = useMemo(() => filter === 'all' ? allEvents : allEvents.filter(e => e.kind === filter), [allEvents, filter]);

  const drinkCount = allEvents.filter(e => e.kind === 'drink').length;
  const theftCount = allEvents.filter(e => e.kind === 'theft').length;

  if (allEvents.length === 0) return (
    <div className="bg-whoop-panel border border-whoop-divider rounded-2xl px-4 py-3 flex items-center gap-2">
      <GlassWater className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
      <span className="text-sm text-text-muted">Detection Log</span>
      <span className="text-[10px] text-text-muted bg-whoop-bg border border-whoop-divider px-1.5 py-0.5 rounded-full ml-1">0 drinks</span>
      <span className="text-xs text-text-muted ml-auto">Detections will appear once the shift starts.</span>
    </div>
  );

  return (
    <div className="bg-whoop-panel border border-whoop-divider rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm text-text-secondary hover:text-white transition-colors"
      >
        <span className="flex items-center gap-2">
          <GlassWater className="w-3.5 h-3.5 text-teal" />
          Detection Log
          <span className="text-[10px] text-teal bg-teal/10 border border-teal/20 px-1.5 py-0.5 rounded-full">
            {drinkCount} drink{drinkCount !== 1 ? 's' : ''}
          </span>
          {theftCount > 0 && (
            <span className="text-[10px] text-red-400 bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 rounded-full">
              {theftCount} theft
            </span>
          )}
        </span>
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            className="overflow-hidden"
          >
            <div className="border-t border-whoop-divider">
              {/* Filter + NVR URL bar */}
              <div className="px-4 py-2.5 flex flex-wrap items-center gap-2 border-b border-whoop-divider/60">
                <div className="flex items-center gap-1">
                  <Filter className="w-3 h-3 text-text-muted" />
                  {(['all', 'drink', 'theft'] as const).map(f => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold transition-colors ${
                        filter === f
                          ? f === 'theft'
                            ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                            : 'bg-teal/20 text-teal border border-teal/30'
                          : 'text-text-muted hover:text-white border border-transparent'
                      }`}
                    >
                      {f === 'all' ? `All (${allEvents.length})` : f === 'drink' ? `Drinks (${drinkCount})` : `Theft (${theftCount})`}
                    </button>
                  ))}
                </div>

                <div className="ml-auto flex items-center gap-1.5">
                  {!editingUrl ? (
                    <button
                      onClick={() => { setUrlDraft(nvrUrlTemplate); setEditingUrl(true); }}
                      className="text-[10px] text-text-muted hover:text-teal transition-colors flex items-center gap-1"
                    >
                      <ExternalLink className="w-2.5 h-2.5" />
                      {nvrUrlTemplate ? 'NVR URL ✓' : 'Set NVR URL'}
                    </button>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={urlDraft}
                        onChange={e => setUrlDraft(e.target.value)}
                        placeholder="http://nvr/playback/{channel}/{starttime}"
                        className="text-[10px] bg-whoop-bg border border-whoop-divider rounded px-2 py-1 text-white w-64 focus:outline-none focus:border-teal/50"
                        autoFocus
                      />
                      <button
                        onClick={() => { onSaveNvrUrl(urlDraft.trim()); setEditingUrl(false); }}
                        className="text-[10px] text-teal hover:text-teal/80 font-semibold"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingUrl(false)}
                        className="text-[10px] text-text-muted hover:text-white"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Event rows */}
              <div className="divide-y divide-whoop-divider/40 max-h-96 overflow-y-auto">
                {filtered.length === 0 ? (
                  <p className="text-[11px] text-text-muted px-4 py-6 text-center">No events match filter</p>
                ) : (
                  filtered.slice(0, 200).map((evt, i) => {
                    const timeStr = new Date(evt.wallTime * 1000).toLocaleString(undefined, {
                      month: 'short', day: 'numeric',
                      hour: 'numeric', minute: '2-digit', second: '2-digit',
                    });
                    const nvrHref = nvrUrlTemplate
                      ? buildNvrUrl(nvrUrlTemplate, evt.channel, evt.wallTime)
                      : null;

                    return (
                      <div key={`${evt.jobId}-${evt.wallTime}-${i}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-whoop-bg/50 transition-colors">
                        {evt.kind === 'theft' ? (
                          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center">
                            <AlertTriangle className="w-2.5 h-2.5 text-red-400" />
                          </span>
                        ) : (
                          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-teal/15 flex items-center justify-center">
                            <GlassWater className="w-2.5 h-2.5 text-teal" />
                          </span>
                        )}
                        <span className="text-[11px] font-mono text-text-muted flex-shrink-0 w-36 tabular-nums">{timeStr}</span>
                        <span className="text-[11px] text-text-secondary truncate flex-1 min-w-0">{evt.camera || '—'}</span>
                        {evt.bartender && (
                          <span className="text-[11px] text-text-muted truncate max-w-[80px] flex-shrink-0 hidden sm:block">{evt.bartender}</span>
                        )}
                        {nvrHref ? (
                          <a
                            href={nvrHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-shrink-0 flex items-center gap-1 text-[10px] font-semibold text-teal hover:text-teal/80 transition-colors px-2 py-1 rounded-lg bg-teal/10 border border-teal/20 hover:bg-teal/15"
                          >
                            Watch <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        ) : (
                          <span className="flex-shrink-0 text-[9px] text-text-muted/40 hidden sm:block">set NVR URL →</span>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ venueId }: { venueId: string }) {
  return (
    <div className="flex items-center justify-center min-h-[60vh] px-4">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-sm w-full text-center"
      >
        <div className="w-14 h-14 rounded-2xl bg-teal/10 border border-teal/20 flex items-center justify-center mx-auto mb-4">
          <Video className="w-7 h-7 text-teal" />
        </div>
        <h2 className="text-white font-semibold mb-2">No results yet</h2>
        <p className="text-sm text-text-secondary">
          Results will appear here automatically once your cameras start processing.
        </p>
        {venueId && (
          <p className="text-[10px] text-text-muted mt-3 font-mono opacity-60">
            querying: {venueId}
          </p>
        )}
      </motion.div>
    </div>
  );
}

// ── Shift Scoreboard ──────────────────────────────────────────────────────────

function ShiftScoreboard({ jobs }: { jobs: VenueScopeJob[] }) {
  const latestJob = jobs[0];
  if (!latestJob) return null;

  const latestDow = latestJob.createdAt ? new Date(latestJob.createdAt * 1000).getDay() : -1;
  const compareJob = jobs.slice(1).find(j => {
    if (!j.createdAt || !latestJob.createdAt) return false;
    const ageDays = (latestJob.createdAt - j.createdAt) / 86400;
    return ageDays >= 6 && new Date(j.createdAt * 1000).getDay() === latestDow;
  });

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayLabel = latestDow >= 0 ? dayNames[latestDow] : 'last week';

  const pctDiff = (compareJob && (compareJob.totalDrinks ?? 0) > 0 && (latestJob.totalDrinks ?? 0) > 0)
    ? Math.round(((latestJob.totalDrinks! - compareJob.totalDrinks!) / compareJob.totalDrinks!) * 100)
    : null;

  return (
    <div className="bg-whoop-panel border border-whoop-divider rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp className="w-4 h-4 text-teal" />
        <h2 className="text-sm font-semibold text-white">Shift Scoreboard</h2>
        {compareJob && (
          <span className="text-[10px] text-warm-500 ml-auto">vs last {dayLabel}</span>
        )}
      </div>

      <div className={`grid ${compareJob ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'} gap-4`}>
        {/* Current / Tonight */}
        <div className="space-y-2">
          <p className="text-[10px] text-teal uppercase tracking-wider font-semibold">Tonight</p>
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-warm-500">Drinks</span>
              <div className="flex items-center gap-1.5">
                <span className="text-white font-bold">{latestJob.totalDrinks ?? 0}</span>
                {pctDiff !== null && (
                  <span className={`flex items-center gap-0.5 text-[10px] font-semibold ${pctDiff >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {pctDiff >= 0
                      ? <TrendingUp className="w-2.5 h-2.5" />
                      : <TrendingUp className="w-2.5 h-2.5 rotate-180" />}
                    {pctDiff >= 0 ? '+' : ''}{pctDiff}%
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-warm-500">Per Hour</span>
              <span className="text-white font-semibold">
                {latestJob.drinksPerHour != null ? latestJob.drinksPerHour.toFixed(0) : '—'}
              </span>
            </div>
            {latestJob.topBartender && (
              <div className="flex items-center justify-between">
                <span className="text-warm-500">Top</span>
                <span className="text-white font-semibold truncate max-w-[100px]">{latestJob.topBartender}</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-warm-500">Theft</span>
              {latestJob.hasTheftFlag
                ? <span className="text-red-400 font-semibold text-[10px]">{latestJob.unrungDrinks ?? 0} unrung</span>
                : <span className="text-emerald-400 font-semibold text-[10px]">✓ Clean</span>
              }
            </div>
          </div>
        </div>

        {/* Compare column */}
        {compareJob && (
          <div className="space-y-2 pl-4 border-l border-whoop-divider">
            <p className="text-[10px] text-warm-500 uppercase tracking-wider font-semibold">Last {dayLabel}</p>
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-warm-500">Drinks</span>
                <span className="text-warm-300 font-semibold">{compareJob.totalDrinks ?? 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-warm-500">Per Hour</span>
                <span className="text-warm-300 font-semibold">
                  {compareJob.drinksPerHour != null ? compareJob.drinksPerHour.toFixed(0) : '—'}
                </span>
              </div>
              {compareJob.topBartender && (
                <div className="flex items-center justify-between">
                  <span className="text-warm-500">Top</span>
                  <span className="text-warm-300 font-semibold truncate max-w-[100px]">{compareJob.topBartender}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-warm-500">Theft</span>
                {compareJob.hasTheftFlag
                  ? <span className="text-red-400/70 font-semibold text-[10px]">{compareJob.unrungDrinks ?? 0} unrung</span>
                  : <span className="text-emerald-400/70 font-semibold text-[10px]">✓ Clean</span>
                }
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 10_000;

export function VenueScope() {
  const venueId = authService.getStoredUser()?.venueId || '';
  const [jobs, setJobs]               = useState<VenueScopeJob[]>([]);
  const [loading, setLoading]         = useState(true);
  const [avgDrinkPrice, setAvgDrinkPrice] = useState(() => venueSettingsService.getAvgDrinkPrice(venueId));
  const [camProxyUrl, setCamProxyUrl] = useState(() => venueSettingsService.getCamProxyUrl(venueId) ?? '');
  const [nvrPlaybackUrl, setNvrPlaybackUrl] = useState(() => venueSettingsService.getNvrPlaybackUrl(venueId) ?? '');
  const [businessHours, setBusinessHours] = useState(() => venueSettingsService.getBusinessHours(venueId));
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [newToast, setNewToast]       = useState<string | null>(null);
  const [investigating, setInvestigating] = useState<VenueScopeJob | null>(null);
  const [nextPollIn, setNextPollIn]   = useState(POLL_INTERVAL_MS / 1000);
  const [cameras, setCameras]         = useState<CameraConfig[]>([]);
  // Track whether the initial cameras fetch has completed. Without this,
  // `allDisplayRooms` can't tell "still fetching" (keep showing existing
  // tiles) from "fetch finished, 0 cameras" (hide everything). We only hide
  // ghosts in the second case.
  const [camerasLoaded, setCamerasLoaded] = useState(false);
  const [configuringCamera, setConfiguringCamera] = useState<CameraConfig | null>(null);
  const [configuringTableZonesCamera, setConfiguringTableZonesCamera] = useState<CameraConfig | null>(null);
  const [billingStatus, setBillingStatus] = useState<BillingStatus | null>(null);
  const [billingBannerDismissed, setBillingBannerDismissed] = useState(false);
  const knownIds    = useRef<Set<string>>(new Set());
  const pollTimer   = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const isDemo = isDemoAccount(venueId);

  const load = useCallback(async (silent = false) => {
    if (!venueId) return;
    if (!silent) setLoading(true);
    const data = isDemo
      ? generateDemoVenueScopeJobs()
      : await venueScopeService.listJobs(venueId, 100);

    // Toast for new completed jobs
    if (knownIds.current.size > 0) {
      const incoming = data.filter(j => !knownIds.current.has(j.jobId) && j.status === 'done');
      if (incoming.length > 0) {
        const label = incoming[0].roomLabel || incoming[0].clipLabel || incoming[0].jobId.slice(0, 8);
        setNewToast(incoming.length === 1 ? `New result: ${label}` : `${incoming.length} new results`);
        setTimeout(() => setNewToast(null), 5000);
      }
    }
    data.forEach(j => knownIds.current.add(j.jobId));

    setJobs(data);
    setLastRefresh(new Date());
    if (!silent) setLoading(false);

    // Update header connection status so it shows data age instead of "LOADING"
    const latestTs = data.reduce((max, j) => Math.max(max, j.updatedAt ?? j.finishedAt ?? j.createdAt ?? 0), 0);
    const ageSeconds = latestTs > 0 ? Math.round(Date.now() / 1000 - latestTs) : 0;
    pulseStore.setConnectionStatus({
      isConnected: data.length > 0,
      lastUpdated: new Date(),
      dataAgeSeconds: ageSeconds,
    });
  }, [venueId, isDemo]);

  useEffect(() => {
    if (!venueId) return;
    venueSettingsService.loadSettingsFromCloud(venueId).then(s => {
      if (s?.avgDrinkPrice) setAvgDrinkPrice(s.avgDrinkPrice);
      if (s?.camProxyUrl) setCamProxyUrl(s.camProxyUrl);
      if (s?.nvrPlaybackUrl) setNvrPlaybackUrl(s.nvrPlaybackUrl);
      if (s?.businessHours) setBusinessHours(s.businessHours);
    });
  }, [venueId]);

  // Load camera configs (for zone overlay + editor)
  useEffect(() => {
    if (!venueId || isDemo) return;
    cameraService.listCameras(venueId).then(c => { setCameras(c); setCamerasLoaded(true); }).catch(() => {});
  }, [venueId, isDemo]);

  useEffect(() => { load(); }, [load]);

  // Demo: simulate a new job after 20s
  useEffect(() => {
    if (!isDemo) return;
    const t = setTimeout(() => {
      setNewToast('New result: Main Bar — Today');
      setTimeout(() => setNewToast(null), 5000);
    }, 20_000);
    return () => clearTimeout(t);
  }, [isDemo]);

  // Auto-poll — refresh jobs AND camera configs (picks up auto-detected barConfigJson)
  useEffect(() => {
    pollTimer.current = setInterval(() => {
      if (document.visibilityState === 'visible') {
        load(true);
        setNextPollIn(POLL_INTERVAL_MS / 1000);
        if (!isDemo) cameraService.listCameras(venueId).then(c => { setCameras(c); setCamerasLoaded(true); }).catch(() => {});
      }
    }, POLL_INTERVAL_MS);
    countdownTimer.current = setInterval(() => {
      if (document.visibilityState === 'visible') setNextPollIn(n => n <= 1 ? POLL_INTERVAL_MS / 1000 : n - 1);
    }, 1000);
    const onVis = () => { if (document.visibilityState === 'visible') { load(true); setNextPollIn(POLL_INTERVAL_MS / 1000); } };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      if (pollTimer.current)    clearInterval(pollTimer.current);
      if (countdownTimer.current) clearInterval(countdownTimer.current);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [load]);

  // Load billing status on mount and refresh every 5 minutes
  useEffect(() => {
    if (!venueId) return;
    billingService.getStatus(venueId).then(setBillingStatus);
    const interval = setInterval(() => {
      billingService.getStatus(venueId).then(setBillingStatus);
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [venueId]);

  // Business hours — read from localStorage (set in Settings > Venue)
  // Derive open/close minutes for a given Date from the V2 per-day or legacy format.
  const bizWindowForDate = useCallback((date: Date): { openMin: number; closeMin: number } | null => {
    if (!businessHours) return null;
    const DAY_KEYS = ['sun','mon','tue','wed','thu','fri','sat'];
    let openStr: string | undefined;
    let closeStr: string | undefined;
    if (businessHours.days) {
      const day = businessHours.days[DAY_KEYS[date.getDay()]];
      if (day?.closed) return null; // explicitly closed today
      openStr  = day?.open;
      closeStr = day?.close;
    }
    openStr  = openStr  ?? businessHours.open;
    closeStr = closeStr ?? businessHours.close;
    if (!openStr || !closeStr) return null;
    const [oH, oM] = openStr.split(':').map(Number);
    const [cH, cM] = closeStr.split(':').map(Number);
    return { openMin: oH * 60 + oM, closeMin: cH * 60 + cM };
  }, [businessHours]);

  // Is the bar open right now?
  const barIsOpen = useMemo(() => {
    if (isDemo) return true; // demo bar is always open
    const win = bizWindowForDate(new Date());
    if (!win) return true; // no hours configured = always show
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    // Handles past-midnight close (e.g. open 17:00 close 02:00)
    if (win.closeMin <= win.openMin) return nowMin >= win.openMin || nowMin < win.closeMin;
    return nowMin >= win.openMin && nowMin < win.closeMin;
  }, [isDemo, bizWindowForDate]);

  // Unix seconds at which the current service window opened.
  // Logic: only slide back to yesterday if we are still WITHIN yesterday's service window
  // (i.e. before yesterday's close time). Once the bar has closed for the night, we are in
  // the "gap" between close and next open — return today's open (possibly future) so that
  // tonightJobs is empty and the UI correctly shows the bar as closed / no activity.
  const todayStart = useMemo(() => {
    // Demo: bar is always open — always show the last 8 hours so live job is always in view
    if (isDemo) return Math.floor(Date.now() / 1000) - 8 * 3600;

    const now = new Date();
    const nowSec = now.getTime() / 1000;
    const DAY_KEYS = ['sun','mon','tue','wed','thu','fri','sat'];

    const getOpenTs = (d: Date): number => {
      let openStr: string | undefined;
      if (businessHours?.days) openStr = businessHours.days[DAY_KEYS[d.getDay()]]?.open;
      openStr = openStr ?? businessHours?.open ?? '12:00';
      const [h, m] = openStr.split(':').map(Number);
      const ts = new Date(d); ts.setHours(h, m, 0, 0);
      return ts.getTime() / 1000;
    };

    const getCloseTs = (d: Date): number | null => {
      let closeStr: string | undefined;
      if (businessHours?.days) closeStr = businessHours.days[DAY_KEYS[d.getDay()]]?.close;
      closeStr = closeStr ?? businessHours?.close;
      if (!closeStr) return null;
      const [h, m] = closeStr.split(':').map(Number);
      const ts = new Date(d); ts.setHours(h, m, 0, 0);
      // Past-midnight close (e.g. bar opens Mon 17:00, closes Tue 02:00):
      // the close timestamp should be on the NEXT calendar day.
      if (ts.getTime() / 1000 <= getOpenTs(d)) ts.setDate(ts.getDate() + 1);
      return ts.getTime() / 1000;
    };

    const todayOpenTs = getOpenTs(now);
    if (nowSec >= todayOpenTs) return todayOpenTs; // bar has already opened today

    // Before today's open — check if we are still in yesterday's service window.
    const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayOpenTs  = getOpenTs(yesterday);
    const yesterdayCloseTs = getCloseTs(yesterday);
    if (yesterdayCloseTs && nowSec >= yesterdayOpenTs && nowSec < yesterdayCloseTs) {
      // Still inside last night's window (e.g. 1 AM before a 2 AM close) — use yesterday's open.
      return yesterdayOpenTs;
    }

    // Bar is closed (between yesterday's close and today's open). Return today's open so
    // tonightJobs is empty and cards show the bar as inactive.
    return todayOpenTs;
  }, [businessHours]);

  // Guard against null/undefined entries that AppSync occasionally returns
  const safeJobs    = useMemo(() => jobs.filter((j): j is VenueScopeJob => j != null && typeof j === 'object'), [jobs]);
  // isLive=true → live. isLive=false → not live (stale records).
  // Fallback: status=running + updated within last 5 min (AppSync may omit isLive field).
  const fiveMinAgo = Date.now() / 1000 - 300;
  const isJobLive = (j: VenueScopeJob) =>
    j.isLive === true ||
    (j.isLive !== false && j.status === 'running' &&
      ((j.updatedAt ?? 0) === 0 || (j.updatedAt ?? 0) > fiveMinAgo));
  // tonightJobs: jobs used for STATS (drinks, revenue, bartenders, detection log).
  // Live cameras accumulate totalDrinks across segments indefinitely (worker runs continuously).
  // When a live job's createdAt predates today's opening, zero out its cumulative counters so
  // "Drinks Today" starts fresh — drinksPerHour is computed from current-segment timestamps
  // only (t_sec >= 0) and remains accurate. The worker also resets these at midnight (aws_sync
  // day-boundary logic), so this is belt-and-suspenders for the first push after opening.
  const tonightJobs = useMemo(() => safeJobs
    .filter(j => (j.createdAt ?? 0) >= todayStart || (isJobLive(j) && barIsOpen))
    .map(j => {
      if (isJobLive(j) && (j.createdAt ?? 0) < todayStart) {
        return { ...j, totalDrinks: 0, unrungDrinks: 0, hasTheftFlag: false, bartenderBreakdown: undefined };
      }
      return j;
    })
  , [safeJobs, todayStart, barIsOpen]);
  const olderJobs   = useMemo(() => safeJobs.filter(j => (j.createdAt ?? 0) < todayStart && !isJobLive(j)), [safeJobs, todayStart]);

  // cameraJobs: always includes live cameras regardless of open/closed status,
  // so the camera grid and RTSP feeds remain visible around the clock.
  const cameraJobs = useMemo(() => safeJobs.filter(j =>
    (j.createdAt ?? 0) >= todayStart || isJobLive(j)
  ), [safeJobs, todayStart]);

  // For the camera grid: only jobs with a real camera label, not failed ones.
  // Allow ~ prefix jobs when they are genuinely live (worker marks live cameras with ~ prefix).
  const gridJobs = useMemo(() => cameraJobs.filter(j =>
    j.status !== 'failed' &&
    (!j.jobId.startsWith('~') || j.isLive === true) &&
    (j.clipLabel || j.cameraLabel || j.roomLabel)  // must have a displayable name
  ), [cameraJobs]);
  // Build set of enabled camera names that have people_count configured.
  // buildRooms uses this to avoid showing occupancy from disabled/non-people cameras.
  const enabledPeopleCamNames = useMemo(() =>
    new Set(
      cameras
        .filter(c => c.enabled !== false && c.modes?.includes('people_count'))
        .map(c => c.name.toLowerCase())
    ),
  [cameras]);
  const allRooms    = useMemo(() => { try { return buildRooms(gridJobs, enabledPeopleCamNames); } catch(e) { console.error('[VenueScope] buildRooms error:', e); return []; } }, [gridJobs, enabledPeopleCamNames]);
  // Show ALL rooms in the camera grid (live + done snapshots). Snapshot cameras are
  // almost always "done" between their 20-min polling intervals — hiding done rooms
  // means the grid would appear empty most of the time.
  // Filter out rooms whose camera is explicitly disabled in DynamoDB
  const liveRooms = useMemo(() => {
    if (!cameras.length) return allRooms;
    return allRooms.filter(room => {
      const label = room.label.toLowerCase();
      let cam = cameras.find(c =>
        label.includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(label)
      );
      if (!cam) {
        const roomCh = channelFromSources(room.label, null);
        if (roomCh) cam = cameras.find(c => channelFromSources(c.name, c.rtspUrl) === roomCh) ?? undefined;
      }
      return !cam || cam.enabled !== false;
    });
  }, [allRooms, cameras]);
  const doneRooms   = useMemo(() => [] as RoomSummary[], []);

  // Match a room label to its camera config record (for zone overlay + editor).
  // Strategy: substring match first, then fall back to channel-number match.
  // e.g. room "CH9 — Behind Bar" matches camera "Blind Goat — CH9" via CH9 extraction.
  const cameraForRoom = useCallback((room: RoomSummary): CameraConfig | null => {
    if (!cameras.length) return null;
    const label = room.label.toLowerCase();
    // 1. Direct substring match
    const direct = cameras.find(c =>
      label.includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(label)
    );
    if (direct) return direct;
    // 2. Channel-number match (handles "CH9 — Behind Bar" vs "Blind Goat — CH9")
    const roomCh = channelFromSources(room.label, null);
    if (roomCh) {
      const byCh = cameras.find(c => channelFromSources(c.name, c.rtspUrl) === roomCh);
      if (byCh) return byCh;
    }
    return null;
  }, [cameras]);
  // Permanent fix: camera grid is driven by DynamoDB camera configs, not jobs.
  // For each enabled camera, ensure a room card exists. If a job room already
  // covers it (via label or channel-number match), use that. Otherwise create a
  // stub room showing the live feed and zeroed counters. This means the grid
  // always shows configured cameras even when no job (or only ghost jobs) exist.
  const allDisplayRooms = useMemo(() => {
    // The admin portal's camera registry is the single source of truth for
    // which cameras this venue has. When a camera is deleted there, we must
    // stop displaying its tile — even if historical jobs / stable DDB records
    // still carry that camera's data. `camerasLoaded` tracks whether the
    // initial fetch completed so we don't briefly render "no cameras" on
    // first mount before the network round-trip finishes.
    if (!camerasLoaded) return liveRooms;  // still fetching — keep old view
    if (!cameras.length) return [];        // fetch succeeded, 0 cameras → hide all

    const enabledCams = cameras.filter(c => c.enabled !== false);
    const result: RoomSummary[] = [];
    const coveredCamIds = new Set<string>();

    // First pass: include only job-based rooms that match an enabled camera.
    // Rooms whose camera has been deleted from the admin portal are dropped
    // so ghost tiles disappear immediately on delete. If the admin-portal
    // camera config specifies a mode that differs from the job's analysisMode,
    // the camera config wins — it reflects the owner's intent.
    for (const room of liveRooms) {
      const cam = enabledCams.find(c => {
        const label = room.label.toLowerCase();
        const cn = c.name.toLowerCase();
        if (label.includes(cn) || cn.includes(label)) return true;
        const ch = channelFromSources(c.name, c.rtspUrl);
        return ch ? channelFromSources(room.label, null) === ch : false;
      });
      if (!cam) continue;  // camera deleted/disabled — drop the ghost tile
      if (coveredCamIds.has(cam.cameraId)) continue;  // duplicate job for same camera
      coveredCamIds.add(cam.cameraId);
      const camModes: string[] = Array.isArray(cam.modes) && cam.modes.length ? cam.modes : [];
      const camMode = camModes.includes('drink_count') ? 'drink_count'
                    : camModes.includes('table_turns') ? 'table_turns'
                    : camModes.includes('people_count') ? 'people_count'
                    : null;
      // Stamp camera-configured modes (source of truth for which stat blocks to show)
      // and override primary mode if camera config differs from job
      const overrides: Partial<RoomSummary> = { configuredModes: camModes.length ? camModes : room.configuredModes };
      if (camMode && camMode !== room.mode) overrides.mode = camMode;
      result.push({ ...room, ...overrides });
    }

    // Second pass: add stub rooms for enabled cameras with no job room
    for (const cam of enabledCams) {
      if (coveredCamIds.has(cam.cameraId)) continue;
      const modesRaw: string[] = Array.isArray(cam.modes) && cam.modes.length ? cam.modes : ['drink_count'];
      const mode = modesRaw.includes('drink_count')  ? 'drink_count'
                 : modesRaw.includes('table_turns')  ? 'table_turns'
                 : modesRaw.includes('people_count') ? 'people_count'
                 : modesRaw[0] ?? 'drink_count';
      result.push({
        label: cam.name,
        isLive: false,
        mode,
        configuredModes: modesRaw,
        totalDrinks: 0, drinksPerHour: 0, topBartender: '', hasTheftFlag: false,
        unrungDrinks: 0, currentOccupancy: 0, peakOccupancy: 0, totalEntries: 0,
        totalTurns: 0, avgDwellMin: 0, avgResponseSec: 0,
        elapsedSec: 0, updatedAt: 0, cameraAngle: '',
        job: null,
      });
    }

    // Sort: live first, then by total drinks
    return result.sort((a, b) => {
      if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
      return b.totalDrinks - a.totalDrinks;
    });
  }, [cameras, liveRooms]);

  const bartenders  = useMemo(() => { try { return aggregateBartenders(tonightJobs); } catch(e) { console.error('[VenueScope] aggregateBartenders error:', e); return []; } }, [tonightJobs]);
  // History = all older jobs (today's rooms are shown in the camera grid above)
  const historyJobs = useMemo(() => [...olderJobs], [olderJobs]);

  // Publish computed occupancy + Little's Law dwell to shared store so Live page can use it.
  useEffect(() => {
    const nowSec = Date.now() / 1000;
    // Source from allDisplayRooms (admin-registry-filtered) rather than
    // allRooms, so deleted cameras don't keep contributing to occupancy.
    const peopleRooms = allDisplayRooms.filter(r => r.mode === 'people_count');
    const multiModeRooms = allDisplayRooms.filter(
      r => r.mode !== 'people_count' && r.configuredModes.includes('people_count')
    );
    const allPeopleRooms = [...peopleRooms, ...multiModeRooms];

    const multiModeOcc = multiModeRooms.reduce((s, r) => s + (r.currentOccupancy ?? 0), 0);
    const current = peopleRooms.reduce((s, r) => s + (r.currentOccupancy ?? 0), 0) + multiModeOcc;
    const peak = Math.max(...allPeopleRooms.map(r => r.peakOccupancy ?? 0), 0);

    // Little's Law: avg_dwell = avg_occupancy / arrival_rate
    // Aggregate entries and elapsed across all people_count rooms
    let dwellTimeMin: number | null = null;
    let totalEntries = 0;
    let totalElapsedSec = 0;
    for (const room of allPeopleRooms) {
      const job = room.job;
      if (!job) continue;
      totalEntries += job.totalEntries ?? 0;
      const elapsed = job.elapsedSec ?? Math.max(0, nowSec - (job.createdAt ?? nowSec));
      totalElapsedSec += elapsed;
    }
    if (totalEntries >= 5 && totalElapsedSec >= 300) {
      const avgOcc = current || peak * 0.6;
      const arrivalRate = totalEntries / totalElapsedSec; // per second
      const dwellSec = avgOcc / arrivalRate;
      const dwellMin = dwellSec / 60;
      if (dwellMin >= 2 && dwellMin <= 360) {
        dwellTimeMin = Math.round(dwellMin);
      }
    }

    if (current > 0 || peak > 0 || dwellTimeMin != null) {
      pulseStore.setVenueOccupancy(current, peak, dwellTimeMin);
    }
  }, [allRooms, allDisplayRooms]);

  return (
    <div className="space-y-6">
      {/* Billing paywall — full block when access lapsed */}
      {billingStatus && !billingStatus.hasAccess && (
        <PaywallOverlay venueId={venueId} status={billingStatus} />
      )}

      {/* Billing banner — soft warning during trial end or past due grace period */}
      {billingStatus && billingStatus.hasAccess && !billingBannerDismissed && (
        (billingStatus.subscriptionStatus === 'past_due' ||
         (billingStatus.subscriptionStatus === 'trial' && billingStatus.trialDaysLeft <= 3)) && (
          <BillingBanner
            venueId={venueId}
            status={billingStatus}
            onDismiss={() => setBillingBannerDismissed(true)}
          />
        )
      )}

      {/* Theft investigation modal */}
      {investigating && (
        <TheftModal job={investigating} avgDrinkPrice={avgDrinkPrice} onClose={() => setInvestigating(null)} />
      )}

      {/* Zone editor modal */}
      <AnimatePresence>
        {configuringCamera && (
          <ZoneEditorModal
            camera={configuringCamera}
            proxyBase={camProxyUrl}
            onClose={() => {
              // Refresh camera list so overlay shows updated zones
              cameraService.listCameras(venueId).then(c => { setCameras(c); setCamerasLoaded(true); }).catch(() => {});
              setConfiguringCamera(null);
            }}
          />
        )}
      </AnimatePresence>

      {/* Table zone editor modal */}
      <AnimatePresence>
        {configuringTableZonesCamera && (
          <TableZoneEditorModal
            camera={configuringTableZonesCamera}
            proxyBase={camProxyUrl}
            onClose={() => {
              cameraService.listCameras(venueId).then(c => { setCameras(c); setCamerasLoaded(true); }).catch(() => {});
              setConfiguringTableZonesCamera(null);
            }}
          />
        )}
      </AnimatePresence>

      {/* New-job toast */}
      <AnimatePresence>
        {newToast && (
          <motion.div
            initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 bg-teal text-black text-sm font-semibold rounded-2xl shadow-lg flex items-center gap-2"
          >
            <div className="w-2 h-2 rounded-full bg-black/30 animate-ping" />
            {newToast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-teal/10 border border-teal/20 flex items-center justify-center">
            <Video className="w-4.5 h-4.5 text-teal" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">VenueScope</h1>
            <p className="text-xs text-text-muted">Live CCTV analytics</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-1.5 text-[10px] text-text-muted">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal opacity-60" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-teal" />
            </span>
            {lastRefresh
              ? `Updated ${lastRefresh.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
              : 'Syncing…'}
            {' '}· {nextPollIn}s
          </div>
          <motion.button
            onClick={() => load()}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-whoop-panel border border-whoop-divider text-sm text-text-secondary rounded-xl hover:border-teal/40 transition-colors disabled:opacity-50"
            whileTap={{ scale: 0.97 }}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </motion.button>
        </div>
      </div>

      {/* Body */}
      {loading && jobs.length === 0 ? (
        <div className="flex items-center justify-center min-h-[40vh]">
          <RefreshCw className="w-6 h-6 text-text-muted animate-spin" />
        </div>
      ) : jobs.length === 0 ? (
        <EmptyState venueId={venueId} />
      ) : (
        <>
          {/* ── Theft alert top banner (last 7 days) ── */}
          {(() => {
            const sevenDaysAgo = Date.now() / 1000 - 7 * 86400;
            const recentFlaggedJobs = safeJobs.filter(j => j.hasTheftFlag && (j.createdAt ?? 0) >= sevenDaysAgo);
            const totalUnrungRecent = recentFlaggedJobs.reduce((s, j) => s + (j.unrungDrinks ?? 0), 0);
            if (recentFlaggedJobs.length === 0) return null;
            return (
              <div className="bg-red-500/15 border border-red-500/40 rounded-xl p-4 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-red-400">
                    Theft Alert — {totalUnrungRecent} unrung drink{totalUnrungRecent !== 1 ? 's' : ''} detected
                  </p>
                  <p className="text-xs text-warm-300 mt-0.5">
                    {recentFlaggedJobs.length} shift{recentFlaggedJobs.length > 1 ? 's' : ''} flagged in the last 7 days.{' '}
                    Review the shift history below.
                  </p>
                </div>
              </div>
            );
          })()}

          {/* Warning: no drink_count cameras configured — can't detect drinks */}
          {!isDemo && cameras.length > 0 && allDisplayRooms.length > 0
            && allDisplayRooms.every(r => r.mode !== 'drink_count')
            && tonightJobs.every(j => (j.totalDrinks ?? 0) === 0) && (
            <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
              <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-300">No bar cameras set to Drink Count mode</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  All active cameras are running in People Count mode — drinks can't be detected.
                  Go to <strong className="text-gray-300">Admin Portal → Cameras</strong>, select your bar camera(s),
                  and change the mode to <strong className="text-gray-300">Drink Count</strong>.
                </p>
              </div>
            </div>
          )}

          {/* 1. Today's hero numbers — always shown; handles empty/closed state internally */}
          <TonightHero jobs={tonightJobs} avgDrinkPrice={avgDrinkPrice} barOpen={barIsOpen} peopleRooms={allDisplayRooms.filter(r => r.mode === 'people_count')} isDemo={isDemo} />

          {/* POS Reconciliation */}
          <POSReconciliationPanel jobs={tonightJobs} />

          {/* Behind the Bar — bartender performance */}
          <BartenderBoard bartenders={bartenders} />

          {/* Drink pace chart */}
          <PaceChart jobs={tonightJobs} />

          {/* 2. Camera grid — driven by DynamoDB camera configs (permanent fix).
                allDisplayRooms = job-based rooms + stub rooms for cameras with no job data */}
          {allDisplayRooms.length > 0 && (() => {
            const barCams       = allDisplayRooms.filter(r => r.mode === 'drink_count');
            const tableTurnsCams = allDisplayRooms.filter(r => r.mode === 'table_turns');
            const peopleCams    = allDisplayRooms.filter(r => r.mode === 'people_count');
            const otherCams     = allDisplayRooms.filter(r => !['drink_count', 'table_turns', 'people_count'].includes(r.mode));
            return (
              <div className="space-y-5">
                {barCams.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-xs font-semibold text-teal uppercase tracking-wider">Bar Cameras — Drink Count</span>
                      <span className="text-[10px] text-teal bg-teal/10 border border-teal/20 px-1.5 py-0.5 rounded-full">
                        {barCams.filter(r => r.isLive).length} live
                      </span>
                      <div className="h-px flex-1 bg-teal/20" />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                      {barCams.map(room => (
                        <RoomCard key={room.label} room={room} camProxyUrl={camProxyUrl} camera={cameraForRoom(room)} onInvestigate={setInvestigating} onConfigureZones={setConfiguringCamera} onConfigureTableZones={setConfiguringTableZonesCamera} />
                      ))}
                    </div>
                  </div>
                )}
                {tableTurnsCams.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-xs font-semibold text-purple-400 uppercase tracking-wider">Floor Cameras — Table Turns</span>
                      <span className="text-[10px] text-purple-400 bg-purple-500/10 border border-purple-500/20 px-1.5 py-0.5 rounded-full">
                        {tableTurnsCams.filter(r => r.isLive).length} live
                      </span>
                      <div className="h-px flex-1 bg-purple-500/20" />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                      {tableTurnsCams.map(room => (
                        <RoomCard key={room.label} room={room} camProxyUrl={camProxyUrl} camera={cameraForRoom(room)} onInvestigate={setInvestigating} onConfigureZones={setConfiguringCamera} onConfigureTableZones={setConfiguringTableZonesCamera} />
                      ))}
                    </div>
                  </div>
                )}
                {peopleCams.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-xs font-semibold text-warm-400 uppercase tracking-wider">Floor Cameras — People Count</span>
                      <span className="text-[10px] text-warm-400 bg-warm-700/40 border border-warm-700 px-1.5 py-0.5 rounded-full">
                        {peopleCams.filter(r => r.isLive).length} live
                      </span>
                      <div className="h-px flex-1 bg-warm-700/40" />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                      {peopleCams.map(room => (
                        <RoomCard key={room.label} room={room} camProxyUrl={camProxyUrl} camera={cameraForRoom(room)} onInvestigate={setInvestigating} onConfigureZones={setConfiguringCamera} onConfigureTableZones={setConfiguringTableZonesCamera} />
                      ))}
                    </div>
                  </div>
                )}
                {otherCams.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">Other Cameras</span>
                      <div className="h-px flex-1 bg-whoop-divider" />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                      {otherCams.map(room => (
                        <RoomCard key={room.label} room={room} camProxyUrl={camProxyUrl} camera={cameraForRoom(room)} onInvestigate={setInvestigating} onConfigureZones={setConfiguringCamera} onConfigureTableZones={setConfiguringTableZonesCamera} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* 4. Theft alerts */}
          {tonightJobs.some(j => j.hasTheftFlag) && (
            <TheftAlerts
              jobs={tonightJobs.filter(j => j.hasTheftFlag)}
              avgDrinkPrice={avgDrinkPrice}
              onInvestigate={setInvestigating}
            />
          )}

          {/* 5. Detection event log — all drinks + theft flags with NVR links */}
          <DetectionEventsPanel
            jobs={tonightJobs}
            nvrUrlTemplate={nvrPlaybackUrl}
            businessHours={businessHours ?? undefined}
            onSaveNvrUrl={url => {
              setNvrPlaybackUrl(url);
              venueSettingsService.saveSettingsToCloud(venueId, {
                ...venueSettingsService.getSettings(venueId),
                nvrPlaybackUrl: url,
              });
            }}
          />

          {/* 6. Shift history — older completed jobs */}
          {historyJobs.length > 0 && (
            <HistoryAccordion
              jobs={historyJobs}
              onInvestigate={setInvestigating}
              onExport={() => exportCsv(safeJobs)}
              initialOpen={isDemo}
            />
          )}

        </>
      )}
    </div>
  );
}

export default VenueScope;

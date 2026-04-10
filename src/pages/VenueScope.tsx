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
} from 'lucide-react';
import authService from '../services/auth.service';
import venueScopeService, { VenueScopeJob, parseModes } from '../services/venuescope.service';
import sportsService from '../services/sports.service';
import { SportsGame } from '../types';
import venueSettingsService from '../services/venue-settings.service';
import { isDemoAccount, generateDemoVenueScopeJobs } from '../utils/demoData';
import cameraService, { Camera as CameraConfig } from '../services/camera.service';

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

interface BarStation {
  zone_id: string;
  label: string;
  polygon: [number, number][];       // normalized [0-1] x,y vertices
  bar_line_p1: [number, number];     // normalized start of bar line
  bar_line_p2: [number, number];     // normalized end of bar line
  customer_side: 1 | -1;            // +1 = below bar line, -1 = above
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
            fill="rgba(0,200,160,0.07)"
            stroke="rgba(0,200,160,0.55)"
            strokeWidth="0.004"
          />
          {/* Bar line (orange dashed) */}
          <line
            x1={s.bar_line_p1[0]} y1={s.bar_line_p1[1]}
            x2={s.bar_line_p2[0]} y2={s.bar_line_p2[1]}
            stroke="rgba(255,140,0,0.85)"
            strokeWidth="0.004"
            strokeDasharray="0.025 0.012"
          />
        </g>
      ))}
    </svg>
  );
}

// ── Zone editor modal ─────────────────────────────────────────────────────────

// Drag state for bar line handle dragging
type DragTarget = { stationIdx: number; handle: 'p1' | 'p2' } | null;

function ZoneEditorModal({
  camera,
  proxyBase,
  onClose,
}: {
  camera: CameraConfig;
  proxyBase: string;
  onClose: () => void;
}) {
  const [config, setConfig]     = useState<BarConfig>(() => parseBarConfig(camera.barConfigJson) ?? { stations: [] });
  // rect draw state: null = idle, [x,y] = anchor corner placed
  const [rectAnchor, setRectAnchor] = useState<[number, number] | null>(null);
  const [cursor, setCursor]         = useState<[number, number] | null>(null);
  const [dragTarget, setDragTarget] = useState<DragTarget>(null);
  const [saving, setSaving]         = useState(false);
  const [saveOk, setSaveOk]         = useState(false);
  const [step, setStep]             = useState<'draw' | 'done'>('draw');
  const svgRef   = useRef<SVGSVGElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const editorHlsRef = useRef<Hls | null>(null);

  const isDrawing = rectAnchor !== null;

  const streamUrl = (() => {
    if (!proxyBase) return null;
    const ch = channelFromSources(camera.name || '', camera.rtspUrl);
    if (!ch) return null;
    return `${proxyBase.replace(/\/$/, '')}/hls/live/${ch}/0/livetop.mp4`;
  })();

  useEffect(() => {
    if (!streamUrl || !videoRef.current) return;
    const v = videoRef.current;
    if (editorHlsRef.current) { editorHlsRef.current.destroy(); editorHlsRef.current = null; }
    if (Hls.isSupported()) {
      const hls = new Hls({ liveSyncDurationCount: 1, lowLatencyMode: true });
      editorHlsRef.current = hls;
      hls.loadSource(streamUrl);
      hls.attachMedia(v);
      hls.on(Hls.Events.MANIFEST_PARSED, () => v.play().catch(() => {}));
    } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = streamUrl;
      v.load();
    }
    return () => { if (editorHlsRef.current) { editorHlsRef.current.destroy(); editorHlsRef.current = null; } };
  }, [streamUrl]);

  function getRelPt(e: React.MouseEvent<SVGSVGElement>): [number, number] {
    const r = svgRef.current!.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    return [x, y];
  }

  function handleSvgMouseDown(e: React.MouseEvent<SVGSVGElement>) {
    if (dragTarget) return; // already dragging a handle
    if (e.button !== 0) return;
    const pt = getRelPt(e);

    // Check if clicking near a bar line handle (drag to reposition)
    for (let i = 0; i < config.stations.length; i++) {
      const s = config.stations[i];
      if (Math.hypot(pt[0] - s.bar_line_p1[0], pt[1] - s.bar_line_p1[1]) < 0.03) {
        setDragTarget({ stationIdx: i, handle: 'p1' });
        e.preventDefault();
        return;
      }
      if (Math.hypot(pt[0] - s.bar_line_p2[0], pt[1] - s.bar_line_p2[1]) < 0.03) {
        setDragTarget({ stationIdx: i, handle: 'p2' });
        e.preventDefault();
        return;
      }
    }

    // Start rectangle draw
    setRectAnchor(pt);
    setCursor(pt);
  }

  function handleSvgMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const pt = getRelPt(e);
    setCursor(pt);

    if (dragTarget) {
      setConfig(c => ({
        stations: c.stations.map((s, i) =>
          i === dragTarget.stationIdx
            ? { ...s, [dragTarget.handle === 'p1' ? 'bar_line_p1' : 'bar_line_p2']: pt }
            : s
        ),
      }));
    }
  }

  function handleSvgMouseUp(e: React.MouseEvent<SVGSVGElement>) {
    if (dragTarget) {
      setDragTarget(null);
      return;
    }

    if (!rectAnchor) return;
    const pt = getRelPt(e);
    const [ax, ay] = rectAnchor;
    const x1 = Math.min(ax, pt[0]), x2 = Math.max(ax, pt[0]);
    const y1 = Math.min(ay, pt[1]), y2 = Math.max(ay, pt[1]);

    // Require a minimum size
    if (x2 - x1 < 0.05 || y2 - y1 < 0.05) {
      setRectAnchor(null);
      return;
    }

    const midY = (y1 + y2) / 2;
    const newStation: BarStation = {
      zone_id:       `zone_${Date.now()}`,
      label:         `Bar Zone ${config.stations.length + 1}`,
      polygon:       [[x1,y1],[x2,y1],[x2,y2],[x1,y2]],
      bar_line_p1:   [x1, midY],
      bar_line_p2:   [x2, midY],
      customer_side: 1,
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

  const cursorClass = dragTarget ? 'cursor-grabbing' : isDrawing ? 'cursor-crosshair' : 'cursor-crosshair';

  return (
    <motion.div
      className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-2"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <motion.div
        className="bg-whoop-panel border border-whoop-divider rounded-2xl w-full max-w-5xl flex flex-col overflow-hidden"
        style={{ maxHeight: '95vh' }}
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
              <p className="text-[10px] text-text-muted">Mark your bar area so the AI knows where to watch for drink service</p>
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

        {/* Canvas */}
        <div
          className="relative bg-black select-none"
          style={{ aspectRatio: '16/9', maxHeight: 'calc(95vh - 230px)' }}
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
            {/* Saved zones */}
            {config.stations.map((s, i) => {
              const [x1,y1] = s.polygon[0], [x2,,y2] = [s.polygon[1][0], 0, s.polygon[2][1]];
              const midX = (s.bar_line_p1[0] + s.bar_line_p2[0]) / 2;
              const custY = s.customer_side === 1
                ? s.bar_line_p2[1] + 0.055
                : s.bar_line_p1[1] - 0.045;
              return (
                <g key={i}>
                  {/* Zone rectangle fill */}
                  <polygon
                    points={s.polygon.map(([px, py]) => `${px},${py}`).join(' ')}
                    fill="rgba(0,200,160,0.08)"
                    stroke="rgba(0,200,160,0.6)"
                    strokeWidth="0.003"
                  />
                  {/* Zone label */}
                  <text
                    x={(x1 + x2) / 2} y={y1 + 0.04}
                    fontSize="0.038" fill="rgba(255,255,255,0.9)" textAnchor="middle"
                    style={{ pointerEvents: 'none', fontWeight: 600 }}
                  >{s.label}</text>

                  {/* Bar line */}
                  <line
                    x1={s.bar_line_p1[0]} y1={s.bar_line_p1[1]}
                    x2={s.bar_line_p2[0]} y2={s.bar_line_p2[1]}
                    stroke="rgba(255,140,0,0.95)"
                    strokeWidth="0.005"
                    strokeDasharray="0.022 0.011"
                  />
                  {/* Bar line label */}
                  <text
                    x={midX} y={s.bar_line_p1[1] - 0.02}
                    fontSize="0.028" fill="rgba(255,160,40,0.85)" textAnchor="middle"
                    style={{ pointerEvents: 'none' }}
                  >← bar counter edge →</text>

                  {/* Draggable handles on bar line endpoints */}
                  <circle cx={s.bar_line_p1[0]} cy={s.bar_line_p1[1]} r="0.022"
                    fill="rgba(255,140,0,0.25)" stroke="rgba(255,140,0,0.9)" strokeWidth="0.004"
                    style={{ cursor: 'grab' }}
                  />
                  <circle cx={s.bar_line_p2[0]} cy={s.bar_line_p2[1]} r="0.022"
                    fill="rgba(255,140,0,0.25)" stroke="rgba(255,140,0,0.9)" strokeWidth="0.004"
                    style={{ cursor: 'grab' }}
                  />

                  {/* Customer side arrow */}
                  <text
                    x={midX} y={custY}
                    fontSize="0.032" fill="rgba(200,160,255,0.85)" textAnchor="middle"
                    style={{ pointerEvents: 'none' }}
                  >{s.customer_side === 1 ? '▼ customers' : '▲ customers'}</text>
                </g>
              );
            })}

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

          {/* Bar line drag hint after first zone placed */}
          {config.stations.length > 0 && !isDrawing && !dragTarget && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-sm text-[11px] text-amber-400/80 pointer-events-none whitespace-nowrap">
              Drag the orange ● handles to reposition the bar line
            </div>
          )}
        </div>

        {/* Zone list + controls */}
        <div className="px-5 py-3 border-t border-whoop-divider flex-shrink-0 space-y-2 overflow-y-auto" style={{ maxHeight: '28vh' }}>
          {config.stations.length === 0 ? (
            <p className="text-[11px] text-text-muted text-center py-1">No zones yet — drag a box on the camera image above</p>
          ) : (
            <>
              {config.stations.map((s, i) => (
                <div key={i} className="flex items-center gap-2 bg-whoop-bg rounded-xl px-3 py-2.5">
                  <div className="w-2 h-2 rounded-full bg-teal/60 flex-shrink-0" />
                  <input
                    value={s.label}
                    onChange={e => updateLabel(i, e.target.value)}
                    className="flex-1 bg-transparent text-xs text-white outline-none min-w-0"
                    placeholder="Zone label (e.g. Main Bar)"
                  />
                  {/* Customer side toggle */}
                  <div className="flex flex-col items-center flex-shrink-0">
                    <p className="text-[9px] text-text-muted mb-0.5">Customers are</p>
                    <button
                      onClick={() => toggleCustomerSide(i)}
                      className="text-[10px] px-2.5 py-1 rounded-lg bg-purple-500/15 text-purple-300 border border-purple-500/25 hover:bg-purple-500/25 transition-colors whitespace-nowrap"
                    >
                      {s.customer_side === 1 ? '▼ below bar line' : '▲ above bar line'}
                    </button>
                  </div>
                  <button
                    onClick={() => deleteZone(i)}
                    className="text-text-muted hover:text-red-400 transition-colors flex-shrink-0 ml-1"
                    title="Delete zone"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              <div className="flex items-center gap-2 pt-1">
                <p className="text-[10px] text-text-muted flex-1">
                  Tip: you can add multiple zones for different bar sections
                </p>
                <button
                  onClick={save}
                  disabled={saving || config.stations.length === 0}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-semibold bg-teal text-black hover:bg-teal/90 disabled:opacity-40 transition-colors"
                >
                  {saveOk ? <Check className="w-3 h-3" /> : saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                  {saveOk ? 'Saved!' : 'Save Zones'}
                </button>
              </div>
            </>
          )}
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
  // meta
  elapsedSec: number;
  updatedAt: number;
  cameraAngle: string;
  job: VenueScopeJob;
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

function buildRooms(jobs: VenueScopeJob[]): RoomSummary[] {
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
    const isDrink  = modes.includes('drink_count');
    const isPeople = modes.includes('people_count');

    // Aggregate across all done+live jobs for this room
    const totalDrinks   = roomJobs.reduce((s, j) => s + (j.totalDrinks ?? 0), 0);
    const totalEntries  = roomJobs.reduce((s, j) => s + (j.totalEntries ?? 0), 0);
    const peakOccupancy = Math.max(...roomJobs.map(j => j.peakOccupancy ?? 0), 0);
    // For live cameras, peakOccupancy is repurposed as current in-frame count (see aws_sync.py)
    // Prefer entries-exits for true entrance cameras, otherwise use the live in-frame count.
    // For snapshot cameras (done, not isLive), treat as current if completed within 25 minutes.
    const entriesExits  = Math.max(0, (best.totalEntries ?? 0) - (best.totalExits ?? 0));
    const jobAge = Date.now() / 1000 - (best.finishedAt ?? best.updatedAt ?? best.createdAt ?? 0);
    const isRecentSnapshot = isPeople && !best.isLive && jobAge < 1500 && (best.peakOccupancy ?? 0) > 0;
    const currentOcc    = best.isLive
      ? (entriesExits > 0 ? entriesExits : (best.peakOccupancy ?? 0))
      : isRecentSnapshot ? (best.peakOccupancy ?? 0) : 0;

    return {
      label,
      isLive: best.isLive === true || (best.isLive !== false && best.status === 'running' &&
        ((best.updatedAt ?? 0) === 0 || (best.updatedAt ?? 0) > Date.now() / 1000 - 300)),
      mode: isDrink ? 'drink_count' : isPeople ? 'people_count' : (best.analysisMode ?? 'unknown'),
      totalDrinks,
      drinksPerHour: best.drinksPerHour ?? 0,
      topBartender: best.topBartender ?? '',
      hasTheftFlag: roomJobs.some(j => j.hasTheftFlag),
      unrungDrinks: roomJobs.reduce((s, j) => s + (j.unrungDrinks ?? 0), 0),
      currentOccupancy: currentOcc,
      peakOccupancy,
      totalEntries,
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

function TheftModal({ job, avgDrinkPrice, onClose }: { job: VenueScopeJob; avgDrinkPrice: number; onClose: () => void }) {
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
            {job.topBartender && (
              <div className="bg-whoop-bg rounded-xl px-3 py-2 flex items-center justify-between">
                <span className="text-xs text-text-muted flex items-center gap-1.5"><User className="w-3.5 h-3.5" /> Flagged bartender</span>
                <span className="text-sm font-semibold text-white">{job.topBartender}</span>
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

function TonightHero({ jobs, avgDrinkPrice, barOpen = true }: { jobs: VenueScopeJob[]; avgDrinkPrice: number; barOpen?: boolean }) {
  const totalDrinks    = jobs.reduce((s, j) => s + (j.totalDrinks ?? 0), 0);
  const liveJobs       = jobs.filter(j => j.isLive);
  const nowSec         = Date.now() / 1000;

  // Include live jobs AND recent snapshot jobs (done within 25 min) for people_count
  const peopleRecent = jobs.filter(j =>
    j.analysisMode === 'people_count' && (
      j.isLive ||
      (nowSec - (j.finishedAt ?? j.updatedAt ?? j.createdAt ?? 0)) < 1500
    )
  );

  // For each distinct camera zone, keep the most recent job.
  // Then SUM across zones — cameras cover non-overlapping areas of the venue.
  const camLatest = new Map<string, VenueScopeJob>();
  for (const j of peopleRecent) {
    const key = j.cameraLabel || friendlyClipLabel(j.clipLabel) || j.roomLabel || j.jobId.slice(0, 12);
    const existing = camLatest.get(key);
    const jTime = j.updatedAt ?? j.finishedAt ?? j.createdAt ?? 0;
    const eTime = existing ? (existing.updatedAt ?? existing.finishedAt ?? existing.createdAt ?? 0) : -1;
    if (!existing || jTime > eTime) camLatest.set(key, j);
  }
  const currentOccupancy = camLatest.size > 0
    ? Array.from(camLatest.values()).reduce((s, j) => s + (j.peakOccupancy ?? 0), 0)
    : 0;
  const cameraZoneCount = camLatest.size;
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
        ? `${cameraZoneCount} camera zone${cameraZoneCount !== 1 ? 's' : ''}`
        : liveJobs.length > 0 ? 'cameras live · no activity' : 'no cameras active',
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
      {stats.map(({ icon, value, label, color, bg, iconColor, sub }) => (
        <div key={label} className={`border rounded-2xl p-4 ${bg}`}>
          <div className={`w-7 h-7 rounded-lg bg-black/20 flex items-center justify-center mb-3 ${iconColor}`}>
            {icon}
          </div>
          <div className={`text-3xl font-bold ${color} leading-none`}>{value}</div>
          <div className="text-[10px] text-text-muted uppercase tracking-wide mt-1.5">{label}</div>
          {sub && <div className="text-[10px] text-text-muted mt-0.5">{sub}</div>}
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
  const ch = channelFromSources(label, rtspUrl);
  if (!ch || !proxyBase) return null;
  const base = proxyBase.replace(/\/$/, '');
  return `${base}/hls/live/${ch}/0/livetop.mp4`;
}

function CameraLiveView({
  label, proxyBase, rtspUrl, barConfig, onConfigureZones,
}: {
  label: string;
  proxyBase: string;
  rtspUrl?: string | null;
  barConfig?: BarConfig | null;
  onConfigureZones?: () => void;
}) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const hlsRef   = React.useRef<Hls | null>(null);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [state, setState] = React.useState<'loading' | 'playing' | 'error' | 'mixed_content'>('loading');
  const [errorMsg, setErrorMsg] = React.useState('Stream unavailable');
  const url = liveStreamUrl(label, proxyBase, rtspUrl);

  React.useEffect(() => {
    if (!url || !videoRef.current) return;

    // Detect mixed-content before attempting load — saves 10s timeout
    const isHttps = window.location.protocol === 'https:';
    if (isHttps && url.startsWith('http://')) {
      setState('mixed_content');
      return;
    }

    const v = videoRef.current;

    // Destroy any previous HLS instance before creating a new one
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }

    // 10-second timeout — if nothing plays, show error
    timerRef.current = setTimeout(() => {
      setState(prev => prev === 'loading' ? 'error' : prev);
      setErrorMsg('Stream timed out — check proxy URL');
    }, 10_000);

    const cleanup = () => {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
      v.src = '';
    };

    if (url.includes('.m3u8') && Hls.isSupported()) {
      // HLS manifest → hls.js
      const hls = new Hls({ liveSyncDurationCount: 1, lowLatencyMode: true, enableWorker: true });
      hlsRef.current = hls;
      hls.loadSource(url);
      hls.attachMedia(v);
      hls.on(Hls.Events.MANIFEST_PARSED, () => v.play().catch(() => {}));
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data.fatal) { setErrorMsg('Stream error — check camera/proxy'); setState('error'); }
      });
    } else {
      // fMP4 direct stream (livetop.mp4) — native video element handles this fine
      v.src = url;
      v.load();
      v.play().catch(() => {});
    }

    return cleanup;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  if (!url) return null;

  const errorDisplay = state === 'mixed_content'
    ? { icon: <Camera className="w-5 h-5 text-yellow-400" />, msg: 'Set proxy URL to HTTPS to load stream', sub: proxyBase }
    : { icon: <Camera className="w-5 h-5 text-text-muted" />, msg: errorMsg, sub: '' };

  return (
    <div className="relative w-full overflow-hidden rounded-xl bg-black aspect-video">
      {state === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80">
          <Loader2 className="w-5 h-5 text-teal animate-spin" />
          <span className="text-[10px] text-text-muted">Connecting to camera…</span>
        </div>
      )}
      {(state === 'error' || state === 'mixed_content') && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-4 text-center">
          {errorDisplay.icon}
          <span className="text-[10px] text-text-muted">{errorDisplay.msg}</span>
          {errorDisplay.sub && <span className="text-[9px] text-text-muted/50 break-all">{errorDisplay.sub}</span>}
        </div>
      )}
      <video
        ref={videoRef}
        className={`w-full h-full object-cover transition-opacity duration-300 ${state === 'playing' ? 'opacity-100' : 'opacity-0'}`}
        autoPlay muted playsInline
        onCanPlay={() => { if (timerRef.current) clearTimeout(timerRef.current); setState('playing'); }}
        onError={() => { setErrorMsg('Stream unavailable'); setState('error'); }}
      />
      {/* Zone overlay */}
      {barConfig && state === 'playing' && <ZoneOverlay config={barConfig} />}
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
          {barConfig ? 'Edit Zones' : 'Configure Zones'}
        </button>
      )}
    </div>
  );
}

function RoomCard({ room, camProxyUrl, camera, onInvestigate, onConfigureZones }: {
  room: RoomSummary;
  camProxyUrl: string;
  camera?: CameraConfig | null;
  onInvestigate: (job: VenueScopeJob) => void;
  onConfigureZones?: (camera: CameraConfig) => void;
}) {
  const isDrink  = room.mode === 'drink_count';
  const isPeople = room.mode === 'people_count';
  const barConfig = camera ? parseBarConfig(camera.barConfigJson) : null;
  const [feedOpen, setFeedOpen] = React.useState(isDrink);

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
              {room.mode.replace(/_/g, ' ')}
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
          {/* Feed toggle — only show when proxy is configured */}
          {camProxyUrl && (
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
        {camProxyUrl && feedOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <CameraLiveView
              label={room.label}
              proxyBase={camProxyUrl}
              rtspUrl={camera?.rtspUrl}
              barConfig={barConfig}
              onConfigureZones={camera && onConfigureZones ? () => onConfigureZones(camera) : undefined}
            />
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
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-whoop-bg rounded-xl p-2.5 text-center">
            <div className={`text-xl font-bold ${room.currentOccupancy > 0 ? 'text-teal' : 'text-text-muted'}`}>
              {room.currentOccupancy > 0 ? room.currentOccupancy : '—'}
            </div>
            <div className="text-[9px] text-text-muted uppercase tracking-wide mt-0.5">
              In Room
            </div>
          </div>
          <div className="bg-whoop-bg rounded-xl p-2.5 text-center">
            <div className={`text-xl font-bold ${room.peakOccupancy > 0 ? 'text-white' : 'text-text-muted'}`}>
              {room.peakOccupancy > 0 ? room.peakOccupancy : '—'}
            </div>
            <div className="text-[9px] text-text-muted uppercase tracking-wide mt-0.5">Peak</div>
          </div>
        </div>
      )}

      {!isDrink && !isPeople && (
        <div className="bg-whoop-bg rounded-xl p-3 text-center">
          <div className="text-xs text-text-muted capitalize">{room.mode.replace(/_/g, ' ')}</div>
          {room.elapsedSec > 0 && (
            <div className="text-[10px] text-text-muted mt-0.5">{fmtElapsed(room.elapsedSec)} elapsed</div>
          )}
        </div>
      )}

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

        {room.hasTheftFlag ? (
          <button
            onClick={() => onInvestigate(room.job)}
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

      {/* Drink log — expandable, drink_count cameras only */}
      {isDrink && <DrinkLogSection job={room.job} />}

      {/* Table visits by staff */}
      <TableVisitsSection job={room.job} />
    </motion.div>
  );
}

// ── Bartender leaderboard ─────────────────────────────────────────────────────

function BartenderBoard({ bartenders }: { bartenders: BartenderStat[] }) {
  if (bartenders.length === 0) return null;
  const max = bartenders[0].drinks || 1;

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

function HistoryAccordion({ jobs, onInvestigate, onExport }: {
  jobs: VenueScopeJob[];
  onInvestigate: (job: VenueScopeJob) => void;
  onExport: () => void;
}) {
  const [open, setOpen] = useState(false);

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
  // Bucket completed drink_count jobs into 15-min windows over last 60 min
  const now = Date.now() / 1000;
  const buckets = [45, 30, 15, 0].map(minsAgo => {
    const bucketStart = now - (minsAgo + 15) * 60;
    const bucketEnd   = now - minsAgo * 60;
    const label = minsAgo === 0 ? 'Now' : `-${minsAgo + 15}m`;
    const drinks = jobs
      .filter(j => !j.isLive && j.status === 'done')
      .filter(j => (j.createdAt ?? 0) >= bucketStart && (j.createdAt ?? 0) < bucketEnd)
      .reduce((s, j) => s + (j.totalDrinks ?? 0), 0);
    return { label, drinks };
  });

  const maxDrinks = Math.max(...buckets.map(b => b.drinks), 1);
  const hasData = buckets.some(b => b.drinks > 0);

  if (!hasData) return null;

  return (
    <div className="bg-whoop-panel border border-whoop-divider rounded-2xl p-4">
      <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-4">
        <TrendingUp className="w-4 h-4 text-teal" />
        Drink Pace — Last Hour
      </h2>
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

function TableVisitsSection({ job }: { job: VenueScopeJob }) {
  if (!job.tableVisitsByStaff) return null;
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
}

function DrinkLogSection({ job }: { job: VenueScopeJob }) {
  const [open, setOpen] = useState(false);

  if (!job.bartenderBreakdown) return null;

  let entries: DrinkEntry[] = [];
  try {
    const bd = JSON.parse(job.bartenderBreakdown) as Record<string, { drinks?: number; per_hour?: number; timestamps?: number[] }>;
    for (const [name, d] of Object.entries(bd)) {
      for (const t of d.timestamps ?? []) {
        entries.push({ wallTime: (job.createdAt ?? 0) + t, bartender: name });
      }
    }
  } catch { /* no-op */ }

  if (entries.length === 0) return null;

  // Most recent first
  entries = entries.sort((a, b) => b.wallTime - a.wallTime);

  return (
    <div className="mt-3 pt-3 border-t border-whoop-divider/60">
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
                <div key={i} className="flex items-center justify-between text-[11px] py-1 border-b border-whoop-divider/30 last:border-0">
                  <span className="text-teal font-mono tabular-nums">
                    {new Date(e.wallTime * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
                  </span>
                  <span className="text-text-muted truncate max-w-[100px] ml-2">{e.bartender}</span>
                  <span className="ml-auto text-emerald-400 flex-shrink-0">✓</span>
                </div>
              ))}
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
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [newToast, setNewToast]       = useState<string | null>(null);
  const [investigating, setInvestigating] = useState<VenueScopeJob | null>(null);
  const [nextPollIn, setNextPollIn]   = useState(POLL_INTERVAL_MS / 1000);
  const [cameras, setCameras]         = useState<CameraConfig[]>([]);
  const [configuringCamera, setConfiguringCamera] = useState<CameraConfig | null>(null);
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
  }, [venueId, isDemo]);

  useEffect(() => {
    if (!venueId) return;
    venueSettingsService.loadSettingsFromCloud(venueId).then(s => {
      if (s?.avgDrinkPrice) setAvgDrinkPrice(s.avgDrinkPrice);
      if (s?.camProxyUrl) setCamProxyUrl(s.camProxyUrl);
    });
  }, [venueId]);

  // Load camera configs (for zone overlay + editor)
  useEffect(() => {
    if (!venueId || isDemo) return;
    cameraService.listCameras(venueId).then(setCameras).catch(() => {});
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

  // Auto-poll
  useEffect(() => {
    pollTimer.current = setInterval(() => {
      if (document.visibilityState === 'visible') { load(true); setNextPollIn(POLL_INTERVAL_MS / 1000); }
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

  // "Tonight" = after midnight local time (bar shifts that started today)
  const todayStart  = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d.getTime() / 1000; }, []);

  // Business hours — read from localStorage (set in Settings > Venue)
  const barIsOpen = useMemo(() => {
    try {
      const saved = localStorage.getItem('pulse_biz_hours');
      if (!saved) return true; // no hours set = always show
      const { open, close } = JSON.parse(saved) as { open: string; close: string };
      const now = new Date();
      const [oH, oM] = open.split(':').map(Number);
      const [cH, cM] = close.split(':').map(Number);
      const nowMin = now.getHours() * 60 + now.getMinutes();
      const openMin = oH * 60 + oM;
      const closeMin = cH * 60 + cM;
      if (closeMin <= openMin) return nowMin >= openMin || nowMin < closeMin;
      return nowMin >= openMin && nowMin < closeMin;
    } catch { return true; }
  }, []);
  // Guard against null/undefined entries that AppSync occasionally returns
  const safeJobs    = useMemo(() => jobs.filter((j): j is VenueScopeJob => j != null && typeof j === 'object'), [jobs]);
  // isLive=true → live. isLive=false → not live (stale records).
  // Fallback: status=running + updated within last 5 min (AppSync may omit isLive field).
  const fiveMinAgo = Date.now() / 1000 - 300;
  const isJobLive = (j: VenueScopeJob) =>
    j.isLive === true ||
    // updatedAt not set (AppSync may omit it) → trust status=running
    // updatedAt set → must be within last 5 min to avoid stale records
    (j.isLive !== false && j.status === 'running' &&
      ((j.updatedAt ?? 0) === 0 || (j.updatedAt ?? 0) > fiveMinAgo));
  const tonightJobs = useMemo(() => safeJobs.filter(j =>
    (j.createdAt ?? 0) >= todayStart || isJobLive(j)
  ), [safeJobs, todayStart]);
  const olderJobs   = useMemo(() => safeJobs.filter(j => (j.createdAt ?? 0) < todayStart && !isJobLive(j)), [safeJobs, todayStart]);

  // For the camera grid: only jobs with a real camera label, not failed/ghost ones
  const gridJobs = useMemo(() => tonightJobs.filter(j =>
    j.status !== 'failed' &&
    !j.jobId.startsWith('~') &&
    (j.clipLabel || j.cameraLabel || j.roomLabel)  // must have a displayable name
  ), [tonightJobs]);
  const allRooms    = useMemo(() => { try { return buildRooms(gridJobs); } catch(e) { console.error('[VenueScope] buildRooms error:', e); return []; } }, [gridJobs]);
  // Show ALL rooms in the camera grid (live + done snapshots). Snapshot cameras are
  // almost always "done" between their 20-min polling intervals — hiding done rooms
  // means the grid would appear empty most of the time.
  const liveRooms   = allRooms;
  const doneRooms   = useMemo(() => [] as RoomSummary[], []);

  // Match a room label to its camera config record (for zone overlay + editor)
  const cameraForRoom = useCallback((room: RoomSummary): CameraConfig | null => {
    if (!cameras.length) return null;
    const label = room.label.toLowerCase();
    return cameras.find(c =>
      label.includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(label)
    ) ?? null;
  }, [cameras]);
  const bartenders  = useMemo(() => { try { return aggregateBartenders(tonightJobs); } catch(e) { console.error('[VenueScope] aggregateBartenders error:', e); return []; } }, [tonightJobs]);
  // History = all older jobs (today's rooms are shown in the camera grid above)
  const historyJobs = useMemo(() => [...olderJobs], [olderJobs]);

  return (
    <div className="space-y-6">
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
              cameraService.listCameras(venueId).then(setCameras).catch(() => {});
              setConfiguringCamera(null);
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

          {/* 1. Today's hero numbers */}
          {tonightJobs.length > 0 && (
            <TonightHero jobs={tonightJobs} avgDrinkPrice={avgDrinkPrice} barOpen={barIsOpen} />
          )}

          {/* POS Reconciliation */}
          <POSReconciliationPanel jobs={tonightJobs} />

          {/* Behind the Bar — bartender performance */}
          {bartenders.length > 0 && (
            <BartenderBoard bartenders={bartenders} />
          )}

          {/* Drink pace chart */}
          <PaceChart jobs={tonightJobs} />

          {/* 2. Live cameras — split by mode */}
          {liveRooms.length > 0 && (() => {
            const barCams    = liveRooms.filter(r => r.mode === 'drink_count');
            const peopleCams = liveRooms.filter(r => r.mode === 'people_count');
            const otherCams  = liveRooms.filter(r => r.mode !== 'drink_count' && r.mode !== 'people_count');
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
                        <RoomCard key={room.label} room={room} camProxyUrl={camProxyUrl} camera={cameraForRoom(room)} onInvestigate={setInvestigating} onConfigureZones={setConfiguringCamera} />
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
                        <RoomCard key={room.label} room={room} camProxyUrl={camProxyUrl} camera={cameraForRoom(room)} onInvestigate={setInvestigating} onConfigureZones={setConfiguringCamera} />
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
                        <RoomCard key={room.label} room={room} camProxyUrl={camProxyUrl} camera={cameraForRoom(room)} onInvestigate={setInvestigating} onConfigureZones={setConfiguringCamera} />
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

        </>
      )}
    </div>
  );
}

export default VenueScope;

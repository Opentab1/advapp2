/**
 * CamerasManagement — Admin page for managing VenueScope cameras
 *
 * Cameras are stored in DynamoDB (VenueScopeCameras table, PK=venueId SK=cameraId).
 * The worker on the droplet reads this table every 60s to pick up changes.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Camera,
  Plus,
  Trash2,
  Edit2,
  CheckCircle,
  XCircle,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Save,
  X,
  Eye,
  EyeOff,
  Wifi,
  WifiOff,
  Search,
  Radio,
  Network,
  Copy,
  Check,
  RotateCcw,
} from 'lucide-react';
import adminService, { AdminCamera, adminFetch } from '../../services/admin.service';
import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';

type CameraMode = 'drink_count' | 'bottle_count' | 'people_count' | 'table_turns' | 'staff_activity' | 'after_hours';

const MODE_LABELS: Record<CameraMode, string> = {
  drink_count:    'Drink Count',
  bottle_count:   'Bottle Count',
  people_count:   'People Count',
  table_turns:    'Table Turns',
  staff_activity: 'Staff Activity',
  after_hours:    'After Hours',
};

const ALL_MODES: CameraMode[] = [
  'drink_count', 'bottle_count', 'people_count', 'table_turns', 'staff_activity', 'after_hours',
];

// Direct DDB client for reading live status records
const _ddbRegion = import.meta.env.VITE_AWS_REGION || 'us-east-2';
const _ddbKeyId  = import.meta.env.VITE_AWS_ACCESS_KEY_ID;
const _ddbSecret = import.meta.env.VITE_AWS_SECRET_ACCESS_KEY;
const _directDDB: DynamoDBClient | null = (_ddbKeyId && _ddbSecret)
  ? new DynamoDBClient({
      region: _ddbRegion,
      credentials: { accessKeyId: _ddbKeyId, secretAccessKey: _ddbSecret },
    })
  : null;

// ── Parse IP and port from a stream URL ──────────────────────────────────────
function parseNvrConn(url: string): { ip: string; port: string } {
  try {
    const m = url.match(/https?:\/\/([\d.]+):(\d+)/);
    if (m) return { ip: m[1], port: m[2] };
    const m2 = url.match(/rtsp:\/\/[^@]*@([\d.]+):(\d+)/);
    if (m2) return { ip: m2[1], port: m2[2] };
  } catch { /* ignore */ }
  return { ip: '', port: '' };
}

// ── Camera status from stable DDB records (~cameraId) ───────────────────────
type CameraStatus = 'online' | 'offline' | 'unknown';

interface StatusRecord {
  status: CameraStatus;
  updatedAt: number;
  totalDrinks?: number;
  analysisMode?: string;
  elapsedSec?: number;
}

async function fetchCameraStatuses(venueId: string): Promise<Map<string, StatusRecord>> {
  const map = new Map<string, StatusRecord>();
  if (!_directDDB) return map;
  try {
    const r = await _directDDB.send(new QueryCommand({
      TableName: 'VenueScopeJobs',
      KeyConditionExpression: 'venueId = :v AND begins_with(jobId, :t)',
      ExpressionAttributeValues: { ':v': { S: venueId }, ':t': { S: '~' } },
    } as any));
    const now = Date.now() / 1000;
    for (const item of r.Items ?? []) {
      const jobId = (item.jobId as any)?.S ?? '';
      const cameraId = jobId.replace(/^~/, '');
      const updatedAt = Number((item.updatedAt as any)?.N ?? 0);
      const isLive = (item.isLive as any)?.BOOL === true;
      const age = now - updatedAt;
      // Online = isLive + updated within last 3 minutes
      const status: CameraStatus = (isLive && age < 180) ? 'online' : 'offline';
      map.set(cameraId, {
        status,
        updatedAt,
        totalDrinks: Number((item.totalDrinks as any)?.N ?? 0) || undefined,
        analysisMode: (item.analysisMode as any)?.S,
        elapsedSec: Number((item.elapsedSec as any)?.N ?? 0) || undefined,
      });
    }
  } catch (e) {
    console.warn('[cameras] status fetch failed:', e);
  }
  return map;
}

// ── Copy-to-clipboard button ─────────────────────────────────────────────────
function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button onClick={copy} className="text-gray-600 hover:text-gray-300 transition-colors ml-1">
      {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

// ── Status dot ───────────────────────────────────────────────────────────────
function StatusDot({ status, updatedAt }: { status: CameraStatus; updatedAt?: number }) {
  const age = updatedAt ? Math.round((Date.now() / 1000 - updatedAt) / 60) : null;
  if (status === 'online') return (
    <span className="flex items-center gap-1 text-xs text-green-400">
      <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
      Live
    </span>
  );
  if (status === 'offline') return (
    <span className="flex items-center gap-1 text-xs text-red-400">
      <WifiOff className="w-3 h-3" />
      Offline{age !== null ? ` (${age}m ago)` : ''}
    </span>
  );
  return (
    <span className="flex items-center gap-1 text-xs text-gray-500">
      <span className="w-2 h-2 rounded-full bg-gray-500" />
      Unknown
    </span>
  );
}

// ─── Cortex IQ Discovery Modal ────────────────────────────────────────────────

function DiscoverModal({
  venueId,
  venueName,
  onClose,
  onSaved,
}: {
  venueId: string;
  venueName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [ip, setIp] = useState('');
  const [port, setPort] = useState('');
  const [totalChannels, setTotalChannels] = useState('16');
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState<{ channel: number; url: string; online: boolean }[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [namePrefix, setNamePrefix] = useState(venueName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const discover = async () => {
    if (!ip.trim() || !port.trim()) { setError('Enter IP and port'); return; }
    setDiscovering(true);
    setError('');
    setDiscovered([]);
    setSelected(new Set());
    try {
      const data = await adminFetch('/admin/probe-cameras', {
        method: 'POST',
        body: JSON.stringify({ ip: ip.trim(), port: port.trim(), totalChannels: parseInt(totalChannels) }),
      });
      setDiscovered(data.channels ?? []);
      const onlineNums = new Set<number>((data.channels ?? []).filter((c: any) => c.online).map((c: any) => c.channel));
      setSelected(onlineNums);
    } catch (e: any) {
      setError(e.message ?? 'Discovery failed');
    } finally {
      setDiscovering(false);
    }
  };

  const toggleChannel = (ch: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(ch) ? next.delete(ch) : next.add(ch);
      return next;
    });
  };

  const addSelected = async () => {
    if (selected.size === 0) { setError('Select at least one channel'); return; }
    setSaving(true);
    setError('');
    let added = 0;
    for (const ch of Array.from(selected).sort((a, b) => a - b)) {
      const chData = discovered.find(d => d.channel === ch);
      if (!chData) continue;
      try {
        await adminService.createCamera({
          venueId,
          name: `${namePrefix} — CH${ch}`,
          rtspUrl: chData.url,
          modes: 'drink_count',
          enabled: true,
          modelProfile: 'balanced',
          segmentSeconds: 0,
        });
        added++;
      } catch (e: any) {
        if (!e.message?.includes('already exists')) console.error(e);
      }
    }
    setSaving(false);
    setDone(true);
    setTimeout(() => { onSaved(); onClose(); }, 1200);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
        className="glass-card p-6 w-full max-w-xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            <Radio className="w-5 h-5 text-purple-400" />
            Discover Cortex IQ Cameras
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        {done ? (
          <div className="text-center py-8">
            <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-3" />
            <p className="text-white font-semibold">Cameras added successfully!</p>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-gray-400">
              Find the IP and port in <strong className="text-gray-300">Cortex IQ app → NVR Settings → Network → UPnP Port Mapping</strong>
            </p>

            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-1">
                <label className="block text-xs text-gray-400 mb-1">Public IP</label>
                <input type="text" value={ip} onChange={e => setIp(e.target.value.trim())}
                  placeholder="108.191.x.x"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500/50 text-sm font-mono" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">HTTP Port</label>
                <input type="text" value={port} onChange={e => setPort(e.target.value.trim())}
                  placeholder="58024"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500/50 text-sm font-mono" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Channels</label>
                <select value={totalChannels} onChange={e => setTotalChannels(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50 text-sm">
                  <option value="8">8 ch</option>
                  <option value="16">16 ch</option>
                  <option value="32">32 ch</option>
                </select>
              </div>
            </div>

            <button onClick={discover} disabled={discovering} className="w-full btn-primary flex items-center justify-center gap-2">
              {discovering
                ? <><RefreshCw className="w-4 h-4 animate-spin" /> Scanning {totalChannels} channels...</>
                : <><Search className="w-4 h-4" /> Discover Cameras</>
              }
            </button>

            {discovered.length > 0 && (
              <>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Camera Name Prefix</label>
                  <input type="text" value={namePrefix} onChange={e => setNamePrefix(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50 text-sm" />
                  <p className="text-xs text-gray-500 mt-1">Cameras will be named "{namePrefix} — CH1", etc.</p>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-400">
                      {discovered.filter(d => d.online).length} online — {selected.size} selected
                    </span>
                    <div className="flex gap-2 text-xs">
                      <button onClick={() => setSelected(new Set(discovered.filter(d => d.online).map(d => d.channel)))}
                        className="text-purple-400 hover:text-purple-300">Select online</button>
                      <span className="text-gray-600">|</span>
                      <button onClick={() => setSelected(new Set())} className="text-gray-400 hover:text-white">Clear</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {discovered.map(ch => (
                      <button key={ch.channel} onClick={() => toggleChannel(ch.channel)}
                        className={`p-3 rounded-lg border text-sm font-medium transition-all ${
                          selected.has(ch.channel)
                            ? 'bg-purple-500/20 border-purple-500/40 text-purple-300'
                            : ch.online
                            ? 'bg-green-500/10 border-green-500/20 text-green-400 hover:bg-green-500/20'
                            : 'bg-white/3 border-white/5 text-gray-600'
                        }`}
                      >
                        <div>CH{ch.channel}</div>
                        <div className={`text-xs mt-0.5 ${ch.online ? 'text-green-500' : 'text-gray-600'}`}>
                          {ch.online ? '● live' : '○ off'}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <button onClick={addSelected} disabled={saving || selected.size === 0}
                  className="w-full btn-primary flex items-center justify-center gap-2">
                  {saving
                    ? <><RefreshCw className="w-4 h-4 animate-spin" /> Adding cameras...</>
                    : <><Plus className="w-4 h-4" /> Add {selected.size} Camera{selected.size !== 1 ? 's' : ''}</>
                  }
                </button>
              </>
            )}

            {error && (
              <div className="flex items-center gap-2 text-red-400 text-sm">
                <AlertTriangle className="w-4 h-4" />{error}
              </div>
            )}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}


// ─── Add/Edit Camera Modal ────────────────────────────────────────────────────

function CameraModal({
  venueId, camera, onClose, onSaved,
}: {
  venueId: string;
  camera?: AdminCamera;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!camera;
  const [name, setName] = useState(camera?.name ?? '');
  const [rtspUrl, setRtspUrl] = useState(camera?.rtspUrl ?? '');
  const cameraModes: CameraMode[] = camera?.modes
    ? (camera.modes.split(',').filter(Boolean) as CameraMode[])
    : ['drink_count'];
  const [modes, setModes] = useState<CameraMode[]>(cameraModes);
  const [modelProfile, setModelProfile] = useState<'fast' | 'balanced' | 'accurate'>(
    camera?.modelProfile as 'fast' | 'balanced' | 'accurate' ?? 'balanced'
  );
  const [segmentSeconds, setSegmentSeconds] = useState(camera?.segmentSeconds ?? 0);
  const [segmentInterval, setSegmentInterval] = useState(camera?.segmentInterval ?? 0);
  const [notes, setNotes] = useState(camera?.notes ?? '');
  const [showRtsp, setShowRtsp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Bar line quick editor — only shown when editing a drink_count camera with barConfigJson
  const [barLineY, setBarLineY] = useState<number | null>(() => {
    if (!camera?.barConfigJson) return null;
    try {
      const cfg = JSON.parse(camera.barConfigJson);
      const y = cfg?.stations?.[0]?.bar_line_p1?.[1];
      return typeof y === 'number' ? y : null;
    } catch { return null; }
  });

  const [urlMode, setUrlMode] = useState<'builder' | 'manual'>(camera?.rtspUrl ? 'manual' : 'builder');
  const [nvrIp, setNvrIp] = useState('');
  const [nvrPort, setNvrPort] = useState('');
  const [nvrChannel, setNvrChannel] = useState('');
  const [streamQuality, setStreamQuality] = useState<'0' | '1'>('0');

  // Pre-fill builder from existing URL when editing
  useEffect(() => {
    if (camera?.rtspUrl) {
      const { ip, port } = parseNvrConn(camera.rtspUrl);
      if (ip) setNvrIp(ip);
      if (port) setNvrPort(port);
      const chMatch = camera.rtspUrl.match(/\/CH(\d+)\//i);
      if (chMatch) setNvrChannel(chMatch[1]);
    }
  }, [camera]);

  const builtUrl = nvrIp && nvrPort && nvrChannel
    ? `http://${nvrIp}:${nvrPort}/hls/live/CH${nvrChannel}/${streamQuality}/livetop.mp4`
    : '';

  const effectiveUrl = urlMode === 'builder' ? builtUrl : rtspUrl;

  const toggleMode = (mode: CameraMode) => {
    setModes(prev => prev.includes(mode) ? prev.filter(m => m !== mode) : [...prev, mode]);
  };

  const handleSave = async () => {
    if (!name.trim()) { setError('Camera name is required'); return; }
    if (!effectiveUrl.trim()) { setError(urlMode === 'builder' ? 'Enter IP, port and channel' : 'Stream URL is required'); return; }
    if (modes.length === 0) { setError('Select at least one mode'); return; }

    setSaving(true);
    setError('');
    try {
      if (isEdit && camera) {
        // Build updated barConfigJson if bar line was adjusted
        let barConfigJson: string | undefined;
        if (barLineY !== null && camera.barConfigJson) {
          try {
            const cfg = JSON.parse(camera.barConfigJson);
            if (cfg?.stations?.[0]) {
              const x1 = cfg.stations[0].bar_line_p1?.[0] ?? 0.0;
              const x2 = cfg.stations[0].bar_line_p2?.[0] ?? 1.0;
              cfg.stations[0].bar_line_p1 = [x1, barLineY];
              cfg.stations[0].bar_line_p2 = [x2, barLineY];
              barConfigJson = JSON.stringify(cfg);
            }
          } catch { /* malformed JSON — skip */ }
        }

        const ok = await adminService.updateCamera(camera.cameraId, venueId, {
          name: name.trim(),
          rtspUrl: effectiveUrl.trim(),
          modes: modes.join(','),
          modelProfile,
          segmentSeconds,
          segmentInterval: segmentSeconds > 0 ? segmentInterval : 0,
          notes: notes.trim() || '',
          ...(barConfigJson !== undefined ? { barConfigJson } : {}),
        });
        if (!ok) throw new Error('Update failed');
      } else {
        const res = await adminService.createCamera({
          venueId,
          name: name.trim(),
          rtspUrl: effectiveUrl.trim(),
          modes: modes.join(','),
          enabled: true,
          modelProfile,
          segmentSeconds,
          segmentInterval: segmentSeconds > 0 ? segmentInterval : 0,
          notes: notes.trim() || '',
        });
        if (!res.success) throw new Error(res.message);
      }
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e.message ?? 'Failed to save camera');
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
        className="glass-card p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            <Camera className="w-5 h-5 text-purple-400" />
            {isEdit ? 'Edit Camera' : 'Add Camera'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Camera Name *</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g., Bar Camera CH7"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm text-gray-400">Stream URL *</label>
              <div className="flex rounded-lg overflow-hidden border border-white/10 text-xs">
                <button type="button" onClick={() => setUrlMode('builder')}
                  className={`px-3 py-1.5 transition-colors ${urlMode === 'builder' ? 'bg-purple-500/30 text-purple-300' : 'bg-white/5 text-gray-400 hover:text-white'}`}>
                  🏗 Cortex IQ Builder
                </button>
                <button type="button" onClick={() => setUrlMode('manual')}
                  className={`px-3 py-1.5 transition-colors ${urlMode === 'manual' ? 'bg-purple-500/30 text-purple-300' : 'bg-white/5 text-gray-400 hover:text-white'}`}>
                  Manual
                </button>
              </div>
            </div>

            {urlMode === 'builder' ? (
              <div className="space-y-3 p-4 bg-purple-500/5 border border-purple-500/20 rounded-lg">
                <p className="text-xs text-purple-300">
                  Find in Cortex IQ app → NVR Settings → Network → UPnP/Port Mapping
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Public IP</label>
                    <input type="text" value={nvrIp} onChange={e => setNvrIp(e.target.value.trim())}
                      placeholder="108.191.193.107"
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500/50 text-sm font-mono" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">HTTP Port</label>
                    <input type="text" value={nvrPort} onChange={e => setNvrPort(e.target.value.trim())}
                      placeholder="58024"
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500/50 text-sm font-mono" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Channel Number</label>
                    <input type="number" value={nvrChannel} onChange={e => setNvrChannel(e.target.value.trim())}
                      placeholder="7" min="1" max="32"
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500/50 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Quality</label>
                    <select value={streamQuality} onChange={e => setStreamQuality(e.target.value as '0' | '1')}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50 text-sm">
                      <option value="0">Main (1080p HD)</option>
                      <option value="1">Sub (lower res)</option>
                    </select>
                  </div>
                </div>
                {builtUrl && (
                  <div className="mt-2 p-2 bg-green-500/10 border border-green-500/20 rounded text-xs font-mono text-green-300 break-all">
                    ✓ {builtUrl}
                  </div>
                )}
              </div>
            ) : (
              <div className="relative">
                <input type={showRtsp ? 'text' : 'password'} value={rtspUrl}
                  onChange={e => setRtspUrl(e.target.value)}
                  placeholder="rtsp://user:pass@ip:port/stream  or  http://ip:port/hls/..."
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 pr-12 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 font-mono text-sm" />
                <button type="button" onClick={() => setShowRtsp(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white">
                  {showRtsp ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">Analysis Modes *</label>
            <div className="grid grid-cols-2 gap-2">
              {ALL_MODES.map(mode => (
                <button key={mode} type="button" onClick={() => toggleMode(mode)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium text-left transition-all ${
                    modes.includes(mode)
                      ? 'bg-purple-500/20 text-purple-400 border border-purple-500/40'
                      : 'bg-white/5 text-gray-400 border border-white/10 hover:text-white'
                  }`}>
                  {MODE_LABELS[mode]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Model Profile</label>
            <select value={modelProfile} onChange={e => setModelProfile(e.target.value as 'fast' | 'balanced' | 'accurate')}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50">
              <option value="fast">Fast (lower accuracy, less CPU)</option>
              <option value="balanced">Balanced (recommended)</option>
              <option value="accurate">Accurate (more CPU)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Recording Mode</label>
            <select value={segmentSeconds}
              onChange={e => { setSegmentSeconds(Number(e.target.value)); setSegmentInterval(0); }}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50">
              <option value={0}>Continuous (Live — always running)</option>
              <option value={30}>Segments — 30 sec clips</option>
              <option value={300}>Segments — 5 min clips</option>
              <option value={900}>Segments — 15 min clips</option>
              <option value={1800}>Segments — 30 min clips</option>
              <option value={3600}>Segments — 1 hour clips</option>
            </select>
          </div>

          {segmentSeconds > 0 && (
            <div>
              <label className="block text-sm text-gray-400 mb-1">Run Every</label>
              <select value={segmentInterval} onChange={e => setSegmentInterval(Number(e.target.value))}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50">
                <option value={0}>Back-to-back</option>
                <option value={300}>Every 5 minutes</option>
                <option value={600}>Every 10 minutes</option>
                <option value={1200}>Every 20 minutes</option>
                <option value={1800}>Every 30 minutes</option>
                <option value={3600}>Every 1 hour</option>
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm text-gray-400 mb-1">Notes (optional)</label>
            <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="e.g., Overhead fisheye, main bar"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50" />
          </div>

          {/* Bar line quick editor — only when editing a calibrated drink_count camera */}
          {isEdit && barLineY !== null && modes.includes('drink_count') && (
            <div className="p-4 bg-amber-500/5 border border-amber-500/20 rounded-lg space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm text-amber-300 font-medium">Bar Line Position</label>
                <span className="text-xs font-mono text-amber-400">{(barLineY * 100).toFixed(1)}% from top</span>
              </div>
              <input
                type="range"
                min={0.10} max={0.90} step={0.005}
                value={barLineY}
                onChange={e => setBarLineY(parseFloat(e.target.value))}
                className="w-full accent-amber-500"
              />
              <div className="flex justify-between text-xs text-gray-500">
                <span>Top (10%)</span>
                <span className="text-gray-400">Drag to move bar line ↑↓</span>
                <span>Bottom (90%)</span>
              </div>
              <p className="text-xs text-gray-500">
                Move up if customer detections are being counted as bartender. Move down if bartender is missed.
                Worker picks up the new value within 60 seconds.
              </p>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-red-400 text-sm">
              <AlertTriangle className="w-4 h-4" />{error}
            </div>
          )}
        </div>

        <div className="flex gap-3 mt-6 pt-4 border-t border-white/10">
          <button onClick={onClose} className="flex-1 btn-secondary">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 btn-primary flex items-center justify-center gap-2">
            {saving
              ? <><RefreshCw className="w-4 h-4 animate-spin" /> Saving...</>
              : <><Save className="w-4 h-4" /> {isEdit ? 'Save Changes' : 'Add Camera'}</>
            }
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Venue Camera Section ─────────────────────────────────────────────────────

function VenueCameraSection({ venueId, venueName }: { venueId: string; venueName: string }) {
  const [expanded, setExpanded] = useState(false);
  const [cameras, setCameras] = useState<AdminCamera[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [showDiscover, setShowDiscover] = useState(false);
  const [editCamera, setEditCamera] = useState<AdminCamera | null>(null);
  const [error, setError] = useState('');
  const [statuses, setStatuses] = useState<Map<string, StatusRecord>>(new Map());
  const [showConnPanel, setShowConnPanel] = useState(false);
  const [newIp, setNewIp] = useState('');
  const [newPort, setNewPort] = useState('');
  const [connUpdating, setConnUpdating] = useState(false);
  const [restartingCams, setRestartingCams] = useState<Set<string>>(new Set());
  const statusTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const cams = await adminService.listCameras(venueId);
      setCameras(cams);
    } catch (e: any) {
      setError(e.message ?? 'Failed to load cameras');
    } finally {
      setLoading(false);
    }
  }, [venueId]);

  const loadStatuses = useCallback(async () => {
    const s = await fetchCameraStatuses(venueId);
    setStatuses(s);
  }, [venueId]);

  useEffect(() => {
    if (!expanded) return;
    load();
    loadStatuses();
    statusTimer.current = setInterval(loadStatuses, 60_000);
    return () => { if (statusTimer.current) clearInterval(statusTimer.current); };
  }, [expanded, load, loadStatuses]);

  // Pre-fill the connection panel from first camera URL
  useEffect(() => {
    if (cameras.length > 0 && cameras[0].rtspUrl) {
      const { ip, port } = parseNvrConn(cameras[0].rtspUrl);
      if (ip) setNewIp(ip);
      if (port) setNewPort(port);
    }
  }, [cameras]);

  const handleToggle = async (cam: AdminCamera) => {
    try {
      await adminService.updateCamera(cam.cameraId, venueId, { enabled: !cam.enabled });
      setCameras(prev => prev.map(c => c.cameraId === cam.cameraId ? { ...c, enabled: !c.enabled } : c));
    } catch (e: any) {
      alert(`Failed to toggle camera: ${e.message}`);
    }
  };

  // Bulk update all cameras' IP and/or port
  const handleConnUpdate = async () => {
    const ip = newIp.trim();
    const port = newPort.trim();
    if (!ip && !port) return;
    setConnUpdating(true);
    try {
      // Update each camera URL
      await Promise.all(cameras.map(async cam => {
        const current = cam.rtspUrl;
        let updated = current;
        if (ip) updated = updated.replace(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/, ip);
        if (port) updated = updated.replace(/:(\d{4,5})\//, `:${port}/`);
        if (updated !== current) {
          await adminService.updateCamera(cam.cameraId, venueId, { rtspUrl: updated });
        }
      }));
      await load();
      setShowConnPanel(false);
    } catch (e: any) {
      alert(`Failed to update connection: ${e.message}`);
    } finally {
      setConnUpdating(false);
    }
  };

  const handleDelete = async (cam: AdminCamera) => {
    if (!confirm(`Delete "${cam.name}"? The worker will stop processing this camera within 60 seconds.`)) return;
    try {
      await adminService.deleteCamera(cam.cameraId, venueId);
      setCameras(prev => prev.filter(c => c.cameraId !== cam.cameraId));
    } catch (e: any) {
      alert(`Failed to delete camera: ${e.message}`);
    }
  };

  const handleRestart = async (cam: AdminCamera) => {
    if (restartingCams.has(cam.cameraId)) return;
    setRestartingCams(prev => new Set(prev).add(cam.cameraId));
    try {
      await adminService.restartCamera(cam.cameraId, venueId);
      // Reload statuses after restart
      setTimeout(loadStatuses, 5000);
    } catch (e: any) {
      alert(`Failed to restart camera: ${e.message}`);
    } finally {
      setRestartingCams(prev => { const s = new Set(prev); s.delete(cam.cameraId); return s; });
    }
  };

  // Derive shared NVR connection info from first camera
  const firstConn = cameras.length > 0 ? parseNvrConn(cameras[0].rtspUrl) : null;
  const onlineCount = Array.from(statuses.values()).filter(s => s.status === 'online').length;
  const offlineCount = cameras.filter(c => c.enabled).length - onlineCount;

  return (
    <div className="glass-card overflow-hidden">
      <button
        className="w-full flex items-center justify-between p-5 hover:bg-white/5 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-center gap-3">
          {expanded ? <ChevronDown className="w-5 h-5 text-gray-400" /> : <ChevronRight className="w-5 h-5 text-gray-400" />}
          <div className="text-left">
            <div className="text-white font-semibold">{venueName}</div>
            <div className="text-xs text-gray-400 font-mono">{venueId}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {cameras.length > 0 && (
            <span className="text-xs px-2 py-1 rounded bg-purple-500/20 text-purple-400 border border-purple-500/30">
              {cameras.length} cameras
            </span>
          )}
          {expanded && onlineCount > 0 && (
            <span className="text-xs px-2 py-1 rounded bg-green-500/20 text-green-400 border border-green-500/30">
              {onlineCount} live
            </span>
          )}
          {expanded && offlineCount > 0 && (
            <span className="text-xs px-2 py-1 rounded bg-red-500/20 text-red-400 border border-red-500/30">
              {offlineCount} offline
            </span>
          )}
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="border-t border-white/10"
          >
            <div className="p-4 space-y-3">

              {/* NVR Connection Summary */}
              {firstConn && firstConn.ip && (
                <div className="flex items-center justify-between p-3 rounded-lg bg-blue-500/5 border border-blue-500/20">
                  <div className="flex items-center gap-3">
                    <Network className="w-4 h-4 text-blue-400 flex-shrink-0" />
                    <div>
                      <div className="text-xs text-gray-400 mb-0.5">NVR Connection</div>
                      <div className="flex items-center gap-1">
                        <span className="text-sm font-mono text-white">{firstConn.ip}</span>
                        <span className="text-gray-500">:</span>
                        <span className="text-sm font-mono text-amber-300">{firstConn.port}</span>
                        <CopyBtn text={`${firstConn.ip}:${firstConn.port}`} />
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowConnPanel(v => !v)}
                    className="text-xs px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 transition-colors"
                  >
                    Change IP / Port
                  </button>
                </div>
              )}

              {/* Connection Update Panel */}
              <AnimatePresence>
                {showConnPanel && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="p-4 rounded-lg bg-amber-500/8 border border-amber-500/30 space-y-3"
                  >
                    <p className="text-xs text-amber-300">
                      Updates the IP and/or port across all {cameras.length} cameras for this venue. Use when the router port forwarding changes.
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Public IP</label>
                        <input
                          type="text"
                          value={newIp}
                          onChange={e => setNewIp(e.target.value.trim())}
                          placeholder="108.191.193.107"
                          className="w-full bg-black/30 border border-white/20 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Port</label>
                        <input
                          type="text"
                          value={newPort}
                          onChange={e => setNewPort(e.target.value.trim())}
                          placeholder="58024"
                          className="w-full bg-black/30 border border-white/20 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={handleConnUpdate}
                        disabled={connUpdating || (!newIp && !newPort)}
                        className="flex-1 px-4 py-2 rounded-lg bg-amber-500 text-black text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        {connUpdating
                          ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Updating...</>
                          : `Update All ${cameras.length} Cameras`
                        }
                      </button>
                      <button onClick={() => setShowConnPanel(false)} className="px-3 py-2 rounded-lg hover:bg-white/10 text-gray-400">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {loading && (
                <div className="flex items-center gap-2 text-gray-400 py-2">
                  <RefreshCw className="w-4 h-4 animate-spin" />Loading cameras...
                </div>
              )}

              {error && (
                <div className="flex flex-col gap-1 text-red-400 text-sm py-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" /><span>{error}</span>
                  </div>
                </div>
              )}

              {!loading && !error && cameras.length === 0 && (
                <p className="text-gray-400 text-sm py-2">No cameras configured. Add one below.</p>
              )}

              {cameras.map(cam => {
                const conn = parseNvrConn(cam.rtspUrl);
                const rec = statuses.get(cam.cameraId);
                const camStatus: CameraStatus = !cam.enabled ? 'unknown' : (rec?.status ?? 'unknown');

                return (
                  <div
                    key={cam.cameraId}
                    className={`p-4 rounded-lg border transition-all ${
                      !cam.enabled
                        ? 'bg-white/2 border-white/5 opacity-60'
                        : camStatus === 'online'
                        ? 'bg-white/5 border-green-500/20'
                        : camStatus === 'offline'
                        ? 'bg-white/5 border-red-500/20'
                        : 'bg-white/5 border-white/10'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        {/* Name + status */}
                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                          <Wifi className={`w-4 h-4 flex-shrink-0 ${cam.enabled ? 'text-green-400' : 'text-gray-600'}`} />
                          <span className="text-white font-medium">{cam.name}</span>
                          <span className={`text-xs px-1.5 py-0.5 rounded ${cam.enabled ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-500'}`}>
                            {cam.enabled ? 'enabled' : 'disabled'}
                          </span>
                          {cam.enabled && <StatusDot status={camStatus} updatedAt={rec?.updatedAt} />}
                        </div>

                        {/* Modes */}
                        <div className="flex flex-wrap gap-1 mb-2">
                          {(cam.modes || 'drink_count').split(',').filter(Boolean).map(m => (
                            <span key={m} className="text-xs px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">
                              {MODE_LABELS[m as CameraMode] ?? m}
                            </span>
                          ))}
                        </div>

                        {/* IP:Port display */}
                        {conn.ip && (
                          <div className="flex items-center gap-2 text-xs mb-1">
                            <span className="text-gray-500">NVR:</span>
                            <span className="font-mono text-gray-300">{conn.ip}</span>
                            <span className="text-gray-600">:</span>
                            <span className="font-mono text-amber-400 font-semibold">{conn.port}</span>
                            <CopyBtn text={`${conn.ip}:${conn.port}`} />
                          </div>
                        )}

                        {/* Live stats if online */}
                        {camStatus === 'online' && rec && (
                          <div className="text-xs text-gray-500">
                            {rec.totalDrinks != null && rec.totalDrinks > 0 && (
                              <span className="mr-3">{rec.totalDrinks} drinks today</span>
                            )}
                            {rec.elapsedSec != null && rec.elapsedSec > 0 && (
                              <span>{Math.round(rec.elapsedSec / 60)}m running</span>
                            )}
                          </div>
                        )}

                        {/* Offline hint */}
                        {cam.enabled && camStatus === 'offline' && (
                          <div className="flex items-center gap-1.5 text-xs text-red-400 mt-1">
                            <AlertTriangle className="w-3 h-3" />
                            Not connecting — check IP/port or NVR power
                          </div>
                        )}

                        {cam.notes && <div className="text-xs text-gray-500 mt-1">{cam.notes}</div>}
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button
                          onClick={() => handleToggle(cam)}
                          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                            cam.enabled
                              ? 'bg-green-500/20 text-green-400 border-green-500/30 hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/30'
                              : 'bg-gray-500/20 text-gray-400 border-gray-500/30 hover:bg-green-500/20 hover:text-green-400 hover:border-green-500/30'
                          }`}
                        >
                          {cam.enabled ? <><CheckCircle className="w-3.5 h-3.5" /> ON</> : <><XCircle className="w-3.5 h-3.5" /> OFF</>}
                        </button>
                        {cam.enabled && (
                          <button
                            onClick={() => handleRestart(cam)}
                            disabled={restartingCams.has(cam.cameraId)}
                            title="Restart camera (disable → 3s → enable)"
                            className="p-1.5 rounded-lg hover:bg-cyan-500/10 text-gray-400 hover:text-cyan-400 transition-colors disabled:opacity-40"
                          >
                            <RotateCcw className={`w-4 h-4 ${restartingCams.has(cam.cameraId) ? 'animate-spin' : ''}`} />
                          </button>
                        )}
                        <button onClick={() => setEditCamera(cam)}
                          className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors">
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDelete(cam)}
                          className="p-1.5 rounded-lg hover:bg-red-500/10 text-gray-400 hover:text-red-400 transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Action buttons */}
              <div className="flex gap-2 mt-2">
                <button onClick={() => setShowDiscover(true)}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-lg border border-dashed border-green-500/30 text-green-400 hover:bg-green-500/10 transition-colors text-sm font-medium">
                  <Radio className="w-4 h-4" />Discover Cameras (Cortex IQ)
                </button>
                <button onClick={() => setShowAdd(true)}
                  className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-dashed border-purple-500/30 text-purple-400 hover:bg-purple-500/10 transition-colors text-sm font-medium">
                  <Plus className="w-4 h-4" />Manual
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showDiscover && (
          <DiscoverModal venueId={venueId} venueName={venueName}
            onClose={() => setShowDiscover(false)} onSaved={load} />
        )}
        {showAdd && (
          <CameraModal venueId={venueId} onClose={() => setShowAdd(false)} onSaved={load} />
        )}
        {editCamera && (
          <CameraModal venueId={venueId} camera={editCamera}
            onClose={() => setEditCamera(null)} onSaved={load} />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function CamerasManagement() {
  const [venues, setVenues] = useState<{ venueId: string; venueName: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dupWarningDismissed, setDupWarningDismissed] = useState(false);

  const loadVenues = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const list = await adminService.listVenues();
      // Deduplicate by venueId (primary key) — shows each venue exactly once
      const seen = new Set<string>();
      const deduped = list
        .map(v => ({ venueId: v.venueId, venueName: v.venueName }))
        .filter(v => { if (seen.has(v.venueId)) return false; seen.add(v.venueId); return true; });
      setVenues(deduped);
    } catch (e: any) {
      setError(e.message ?? 'Failed to load venues');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadVenues(); }, [loadVenues]);

  // Detect venues with duplicate display names (different venueId, same venueName)
  const dupNames = (() => {
    const nameCount: Record<string, string[]> = {};
    venues.forEach(v => { (nameCount[v.venueName] ??= []).push(v.venueId); });
    return Object.entries(nameCount).filter(([, ids]) => ids.length > 1);
  })();

  return (
    <div className="min-h-screen p-4 md:p-6 lg:p-8">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold gradient-text mb-2">📷 Camera Management</h1>
            <p className="text-gray-400">
              Manage cameras and NVR connection settings. Live/offline status updates every 60s.
            </p>
          </div>
          <button onClick={loadVenues} disabled={loading} className="btn-secondary flex items-center gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />Refresh
          </button>
        </div>

        <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg mb-6 text-sm text-blue-300">
          <strong>How it works:</strong> Camera changes take effect on the worker within 60 seconds.
          If cameras go offline, check the NVR IP and port — the router may have changed the port forwarding rule.
          Use <strong>Change IP / Port</strong> to update all cameras at once.
        </div>

        {/* Duplicate venue name warning */}
        {dupNames.length > 0 && !dupWarningDismissed && (
          <div className="p-4 bg-yellow-500/10 border border-yellow-500/40 rounded-lg mb-6 text-sm text-yellow-300 flex gap-3">
            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold mb-1">Duplicate venue names detected</p>
              {dupNames.map(([name, ids]) => (
                <p key={name} className="text-yellow-400/80">
                  <strong>"{name}"</strong> exists {ids.length}× with IDs: {ids.join(', ')} —
                  delete the ghost entry in the Venues tab (keep the one with more cameras).
                </p>
              ))}
            </div>
            <button onClick={() => setDupWarningDismissed(true)} className="text-yellow-500 hover:text-yellow-300 text-xs mt-0.5 flex-shrink-0">Dismiss</button>
          </div>
        )}

        {error && (
          <div className="glass-card p-5 mb-6 border-red-500/30 flex items-center gap-3 text-red-400">
            <AlertTriangle className="w-5 h-5 flex-shrink-0" /><div>{error}</div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12 text-gray-400 gap-2">
            <RefreshCw className="w-6 h-6 animate-spin" />Loading venues...
          </div>
        ) : venues.length === 0 ? (
          <div className="glass-card p-12 text-center">
            <Camera className="w-16 h-16 mx-auto mb-4 text-gray-600" />
            <h3 className="text-xl font-bold text-white mb-2">No Venues Found</h3>
            <p className="text-gray-400">Create a venue first in the Venues tab, then come back to add cameras.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {venues.map(v => (
              <VenueCameraSection key={v.venueId} venueId={v.venueId} venueName={v.venueName} />
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
}

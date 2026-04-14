/**
 * CamerasManagement — Admin page for managing VenueScope cameras
 *
 * Cameras are stored in DynamoDB (VenueScopeCameras table, PK=venueId SK=cameraId).
 * The worker on the droplet reads this table every 60s to pick up changes.
 */

import { useState, useEffect, useCallback } from 'react';
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
  Search,
  Radio,
  Network,
} from 'lucide-react';
import adminService, { AdminCamera, adminFetch } from '../../services/admin.service';

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
      // Auto-select online channels
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
        // Skip duplicates silently
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
                  placeholder="37834"
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

            <button
              onClick={discover}
              disabled={discovering}
              className="w-full btn-primary flex items-center justify-center gap-2"
            >
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
                  <p className="text-xs text-gray-500 mt-1">Cameras will be named "{namePrefix} — CH1", "{namePrefix} — CH2", etc.</p>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-400">
                      {discovered.filter(d => d.online).length} channels online — {selected.size} selected
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
                      <button
                        key={ch.channel}
                        onClick={() => toggleChannel(ch.channel)}
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

                <button
                  onClick={addSelected}
                  disabled={saving || selected.size === 0}
                  className="w-full btn-primary flex items-center justify-center gap-2"
                >
                  {saving
                    ? <><RefreshCw className="w-4 h-4 animate-spin" /> Adding cameras...</>
                    : <><Plus className="w-4 h-4" /> Add {selected.size} Camera{selected.size !== 1 ? 's' : ''} to {venueName}</>
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
  venueId,
  camera,
  onClose,
  onSaved,
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
  const [modelProfile, setModelProfile] = useState<'fast' | 'balanced' | 'accurate'>(camera?.modelProfile as 'fast' | 'balanced' | 'accurate' ?? 'balanced');
  const [segmentSeconds, setSegmentSeconds] = useState(camera?.segmentSeconds ?? 0);
  const [segmentInterval, setSegmentInterval] = useState(camera?.segmentInterval ?? 0);
  const [notes, setNotes] = useState(camera?.notes ?? '');
  const [showRtsp, setShowRtsp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // URL Builder state
  const [urlMode, setUrlMode] = useState<'builder' | 'manual'>(camera?.rtspUrl ? 'manual' : 'builder');
  const [nvrIp, setNvrIp] = useState('');
  const [nvrPort, setNvrPort] = useState('');
  const [nvrChannel, setNvrChannel] = useState('');
  const [streamQuality, setStreamQuality] = useState<'0' | '1'>('0');

  const builtUrl = nvrIp && nvrPort && nvrChannel
    ? `http://${nvrIp}:${nvrPort}/hls/live/CH${nvrChannel}/${streamQuality}/livetop.mp4`
    : '';

  const effectiveUrl = urlMode === 'builder' ? builtUrl : rtspUrl;

  const toggleMode = (mode: CameraMode) => {
    setModes(prev =>
      prev.includes(mode) ? prev.filter(m => m !== mode) : [...prev, mode]
    );
  };

  const handleSave = async () => {
    if (!name.trim()) { setError('Camera name is required'); return; }
    if (!effectiveUrl.trim()) { setError(urlMode === 'builder' ? 'Enter IP, port and channel' : 'Stream URL is required'); return; }
    if (modes.length === 0) { setError('Select at least one mode'); return; }

    setSaving(true);
    setError('');
    try {
      if (isEdit && camera) {
        const ok = await adminService.updateCamera(camera.cameraId, venueId, {
          name: name.trim(),
          rtspUrl: effectiveUrl.trim(),
          modes: modes.join(','),
          modelProfile,
          segmentSeconds,
          segmentInterval: segmentSeconds > 0 ? segmentInterval : 0,
          notes: notes.trim() || '',
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
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="glass-card p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            <Camera className="w-5 h-5 text-purple-400" />
            {isEdit ? 'Edit Camera' : 'Add Camera'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Camera Name *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g., Bar Camera CH7"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
            />
          </div>

          {/* Stream URL */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm text-gray-400">Stream URL *</label>
              <div className="flex rounded-lg overflow-hidden border border-white/10 text-xs">
                <button
                  type="button"
                  onClick={() => setUrlMode('builder')}
                  className={`px-3 py-1.5 transition-colors ${urlMode === 'builder' ? 'bg-purple-500/30 text-purple-300' : 'bg-white/5 text-gray-400 hover:text-white'}`}
                >
                  🏗 Cortex IQ Builder
                </button>
                <button
                  type="button"
                  onClick={() => setUrlMode('manual')}
                  className={`px-3 py-1.5 transition-colors ${urlMode === 'manual' ? 'bg-purple-500/30 text-purple-300' : 'bg-white/5 text-gray-400 hover:text-white'}`}
                >
                  Manual
                </button>
              </div>
            </div>

            {urlMode === 'builder' ? (
              <div className="space-y-3 p-4 bg-purple-500/5 border border-purple-500/20 rounded-lg">
                <p className="text-xs text-purple-300">
                  Find these in Cortex IQ app → NVR Settings → Network → UPnP/Port Mapping
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Public IP</label>
                    <input
                      type="text"
                      value={nvrIp}
                      onChange={e => setNvrIp(e.target.value.trim())}
                      placeholder="e.g. 108.191.193.107"
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500/50 text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">HTTP Port (UPnP)</label>
                    <input
                      type="text"
                      value={nvrPort}
                      onChange={e => setNvrPort(e.target.value.trim())}
                      placeholder="e.g. 37834"
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500/50 text-sm font-mono"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Channel Number</label>
                    <input
                      type="number"
                      value={nvrChannel}
                      onChange={e => setNvrChannel(e.target.value.trim())}
                      placeholder="e.g. 7"
                      min="1"
                      max="32"
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500/50 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Quality</label>
                    <select
                      value={streamQuality}
                      onChange={e => setStreamQuality(e.target.value as '0' | '1')}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50 text-sm"
                    >
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
                <input
                  type={showRtsp ? 'text' : 'password'}
                  value={rtspUrl}
                  onChange={e => setRtspUrl(e.target.value)}
                  placeholder="rtsp://user:pass@ip:port/stream  or  http://ip:port/hls/..."
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 pr-12 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 font-mono text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowRtsp(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                >
                  {showRtsp ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            )}
          </div>

          {/* Analysis Modes */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">Analysis Modes *</label>
            <div className="grid grid-cols-2 gap-2">
              {ALL_MODES.map(mode => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => toggleMode(mode)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium text-left transition-all ${
                    modes.includes(mode)
                      ? 'bg-purple-500/20 text-purple-400 border border-purple-500/40'
                      : 'bg-white/5 text-gray-400 border border-white/10 hover:text-white'
                  }`}
                >
                  {MODE_LABELS[mode]}
                </button>
              ))}
            </div>
          </div>

          {/* Model Profile */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Model Profile</label>
            <select
              value={modelProfile}
              onChange={e => setModelProfile(e.target.value as 'fast' | 'balanced' | 'accurate')}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50"
            >
              <option value="fast">Fast (lower accuracy, less CPU)</option>
              <option value="balanced">Balanced (recommended)</option>
              <option value="accurate">Accurate (more CPU)</option>
            </select>
          </div>

          {/* Segment / Continuous */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Recording Mode</label>
            <select
              value={segmentSeconds}
              onChange={e => { setSegmentSeconds(Number(e.target.value)); setSegmentInterval(0); }}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50"
            >
              <option value={0}>Continuous (Live — always running)</option>
              <option value={30}>Segments — 30 sec clips</option>
              <option value={300}>Segments — 5 min clips</option>
              <option value={900}>Segments — 15 min clips</option>
              <option value={1800}>Segments — 30 min clips</option>
              <option value={3600}>Segments — 1 hour clips</option>
            </select>
          </div>

          {/* Interval — only shown for segment mode */}
          {segmentSeconds > 0 && (
            <div>
              <label className="block text-sm text-gray-400 mb-1">
                Run Every
                <span className="ml-1 text-xs text-gray-500">(how often to capture a new clip)</span>
              </label>
              <select
                value={segmentInterval}
                onChange={e => setSegmentInterval(Number(e.target.value))}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50"
              >
                <option value={0}>Back-to-back (immediately after each clip)</option>
                <option value={300}>Every 5 minutes</option>
                <option value={600}>Every 10 minutes</option>
                <option value={1200}>Every 20 minutes</option>
                <option value={1800}>Every 30 minutes</option>
                <option value={3600}>Every 1 hour</option>
              </select>
              {segmentInterval > 0 && segmentInterval > segmentSeconds && (
                <p className="text-xs text-purple-300 mt-1">
                  {segmentSeconds}s clip · {segmentInterval / 60} min between runs
                </p>
              )}
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Notes (optional)</label>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="e.g., Overhead fisheye, main bar"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-red-400 text-sm">
              <AlertTriangle className="w-4 h-4" />
              {error}
            </div>
          )}
        </div>

        <div className="flex gap-3 mt-6 pt-4 border-t border-white/10">
          <button onClick={onClose} className="flex-1 btn-secondary">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 btn-primary flex items-center justify-center gap-2"
          >
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

// ─── Venue Camera Row ─────────────────────────────────────────────────────────

function VenueCameraSection({
  venueId,
  venueName,
}: {
  venueId: string;
  venueName: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [cameras, setCameras] = useState<AdminCamera[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [showDiscover, setShowDiscover] = useState(false);
  const [editCamera, setEditCamera] = useState<AdminCamera | null>(null);
  const [error, setError] = useState('');
  const [showPortUpdate, setShowPortUpdate] = useState(false);
  const [newPort, setNewPort] = useState('');
  const [portUpdating, setPortUpdating] = useState(false);

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

  useEffect(() => {
    if (expanded) load();
  }, [expanded, load]);

  const handleToggle = async (cam: AdminCamera) => {
    try {
      await adminService.updateCamera(cam.cameraId, venueId, { enabled: !cam.enabled });
      setCameras(prev => prev.map(c =>
        c.cameraId === cam.cameraId ? { ...c, enabled: !c.enabled } : c
      ));
    } catch (e: any) {
      alert(`Failed to toggle camera: ${e.message}`);
    }
  };

  const handlePortUpdate = async () => {
    const port = newPort.trim();
    if (!port || isNaN(Number(port))) return;
    setPortUpdating(true);
    try {
      await adminFetch('/admin/cameras/bulk-update-port', {
        method: 'POST',
        body: JSON.stringify({ venueId, newPort: port }),
      });
      await load();
      setShowPortUpdate(false);
      setNewPort('');
    } catch (e: any) {
      alert(`Failed to update port: ${e.message}`);
    } finally {
      setPortUpdating(false);
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

  return (
    <div className="glass-card overflow-hidden">
      {/* Header row — click to expand */}
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
        <div className="flex items-center gap-3">
          {cameras.length > 0 && (
            <span className="text-xs px-2 py-1 rounded bg-purple-500/20 text-purple-400 border border-purple-500/30">
              {cameras.length} camera{cameras.length !== 1 ? 's' : ''}
            </span>
          )}
          <span className={`text-xs px-2 py-1 rounded ${
            cameras.filter(c => c.enabled).length > 0
              ? 'bg-green-500/20 text-green-400 border border-green-500/30'
              : 'bg-gray-500/20 text-gray-400 border border-gray-500/30'
          }`}>
            {cameras.filter(c => c.enabled).length} active
          </span>
        </div>
      </button>

      {/* Camera list */}
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
              {loading && (
                <div className="flex items-center gap-2 text-gray-400 py-2">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Loading cameras...
                </div>
              )}

              {error && (
                <div className="flex items-center gap-2 text-red-400 text-sm py-2">
                  <AlertTriangle className="w-4 h-4" />
                  {error}
                  {error.includes('credentials') && (
                    <span className="text-gray-500"> — set VITE_AWS_ACCESS_KEY_ID in Amplify env vars</span>
                  )}
                </div>
              )}

              {!loading && !error && cameras.length === 0 && (
                <p className="text-gray-400 text-sm py-2">No cameras configured. Add one below.</p>
              )}

              {cameras.map(cam => (
                <div
                  key={cam.cameraId}
                  className={`flex items-center justify-between p-4 rounded-lg border transition-all ${
                    cam.enabled
                      ? 'bg-white/5 border-white/10'
                      : 'bg-white/2 border-white/5 opacity-60'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Wifi className={`w-4 h-4 flex-shrink-0 ${cam.enabled ? 'text-green-400' : 'text-gray-600'}`} />
                      <span className="text-white font-medium truncate">{cam.name}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${cam.enabled ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-500'}`}>
                        {cam.enabled ? 'enabled' : 'disabled'}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1 mb-1">
                      {(cam.modes || 'drink_count').split(',').filter(Boolean).map(m => (
                        <span key={m} className="text-xs px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">
                          {MODE_LABELS[m as CameraMode] ?? m}
                        </span>
                      ))}
                    </div>
                    <div className="text-xs text-gray-500 font-mono truncate">
                      {cam.rtspUrl.replace(/:[^:@]*@/, ':***@')}
                    </div>
                    {cam.notes && (
                      <div className="text-xs text-gray-500 mt-0.5">{cam.notes}</div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                    <button
                      onClick={() => handleToggle(cam)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                        cam.enabled
                          ? 'bg-green-500/20 text-green-400 border-green-500/30 hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/30'
                          : 'bg-gray-500/20 text-gray-400 border-gray-500/30 hover:bg-green-500/20 hover:text-green-400 hover:border-green-500/30'
                      }`}
                    >
                      {cam.enabled ? <><CheckCircle className="w-3.5 h-3.5" /> ON</> : <><XCircle className="w-3.5 h-3.5" /> OFF</>}
                    </button>
                    <button
                      onClick={() => setEditCamera(cam)}
                      className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(cam)}
                      className="p-2 rounded-lg hover:bg-red-500/10 text-gray-400 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}

              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => setShowDiscover(true)}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-lg border border-dashed border-green-500/30 text-green-400 hover:bg-green-500/10 transition-colors text-sm font-medium"
                >
                  <Radio className="w-4 h-4" />
                  Discover Cameras (Cortex IQ)
                </button>
                <button
                  onClick={() => setShowAdd(true)}
                  className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-dashed border-purple-500/30 text-purple-400 hover:bg-purple-500/10 transition-colors text-sm font-medium"
                >
                  <Plus className="w-4 h-4" />
                  Manual
                </button>
                <button
                  onClick={() => setShowPortUpdate(v => !v)}
                  className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-dashed border-amber-500/30 text-amber-400 hover:bg-amber-500/10 transition-colors text-sm font-medium"
                >
                  <Network className="w-4 h-4" />
                  NVR Port
                </button>
              </div>

              {/* NVR Port Update inline panel */}
              {showPortUpdate && (
                <div className="mt-3 p-4 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center gap-3 flex-wrap">
                  <Network className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  <span className="text-sm text-amber-300">Update NVR port for all cameras:</span>
                  <input
                    type="number"
                    placeholder="New port (e.g. 39150)"
                    value={newPort}
                    onChange={e => setNewPort(e.target.value)}
                    className="flex-1 min-w-32 px-3 py-1.5 rounded-lg bg-black/30 border border-white/20 text-white text-sm"
                  />
                  <button
                    onClick={handlePortUpdate}
                    disabled={portUpdating || !newPort}
                    className="px-4 py-1.5 rounded-lg bg-amber-500 text-black text-sm font-semibold disabled:opacity-50"
                  >
                    {portUpdating ? 'Updating...' : `Update All ${cameras.length} Cameras`}
                  </button>
                  <button onClick={() => setShowPortUpdate(false)} className="text-gray-500 hover:text-white">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modals */}
      <AnimatePresence>
        {showDiscover && (
          <DiscoverModal
            venueId={venueId}
            venueName={venueName}
            onClose={() => setShowDiscover(false)}
            onSaved={load}
          />
        )}
        {showAdd && (
          <CameraModal
            venueId={venueId}
            onClose={() => setShowAdd(false)}
            onSaved={load}
          />
        )}
        {editCamera && (
          <CameraModal
            venueId={venueId}
            camera={editCamera}
            onClose={() => setEditCamera(null)}
            onSaved={load}
          />
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

  const loadVenues = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const list = await adminService.listVenues();
      setVenues(list.map(v => ({ venueId: v.venueId, venueName: v.venueName })));
    } catch (e: any) {
      setError(e.message ?? 'Failed to load venues');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadVenues(); }, [loadVenues]);

  return (
    <div className="min-h-screen p-4 md:p-6 lg:p-8">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold gradient-text mb-2">📷 Camera Management</h1>
            <p className="text-gray-400">
              Add and manage RTSP cameras for each venue. Changes take effect on the worker within 60 seconds.
            </p>
          </div>
          <button
            onClick={loadVenues}
            disabled={loading}
            className="btn-secondary flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Info box */}
        <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg mb-6 text-sm text-blue-300">
          <strong>How it works:</strong> Cameras are stored in DynamoDB. The worker on the droplet polls this table every 60 seconds and automatically starts or stops processing cameras. Enable/disable without deleting to pause a camera.
        </div>

        {error && (
          <div className="glass-card p-5 mb-6 border-red-500/30 flex items-center gap-3 text-red-400">
            <AlertTriangle className="w-5 h-5 flex-shrink-0" />
            <div>
              <div>{error}</div>
              {error.includes('VITE_ADMIN_API_URL') && (
                <div className="text-xs text-gray-400 mt-1">
                  Set VITE_ADMIN_API_URL in Amplify environment variables to your admin Lambda URL.
                </div>
              )}
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12 text-gray-400 gap-2">
            <RefreshCw className="w-6 h-6 animate-spin" />
            Loading venues...
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

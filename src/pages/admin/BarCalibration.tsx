/**
 * BarCalibration — Admin tool to auto-calibrate bar line position per camera.
 *
 * Select venue → select specific camera → upload clip → enter drink count.
 * Config is saved to DDB barConfigJson for that camera and takes effect
 * on the next live segment automatically.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload,
  Play,
  CheckCircle,
  XCircle,
  Clock,
  Sliders,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Info,
  Camera,
} from 'lucide-react';
import { useAdminVenue } from '../../contexts/AdminVenueContext';
import adminService, { AdminCamera } from '../../services/admin.service';

const CALIBRATION_URL = (import.meta.env.VITE_CALIBRATION_URL ?? '').replace(/\/$/, '');

interface CalibResult {
  y_position:    number;
  customer_side: number;
  detected:      number;
  actual:        number;
  error:         number;
  accuracy_pct:  number;
}

interface CalibJob {
  status:   'running' | 'done' | 'failed';
  progress: number;
  message:  string;
  result: {
    venue_id:        string;
    camera_id:       string;
    actual_count:    number;
    video_seconds:   number;
    best:            CalibResult | null;
    results:         CalibResult[];
    bar_config_path: string | null;
  } | null;
  error: string | null;
}

export function BarCalibration() {
  const { venues, selectedVenueId, setSelectedVenueId, loadingVenues } = useAdminVenue();

  const [venueId,      setVenueId]      = useState<string>(selectedVenueId ?? '');
  const [cameras,      setCameras]      = useState<AdminCamera[]>([]);
  const [loadingCams,  setLoadingCams]  = useState(false);
  const [cameraId,     setCameraId]     = useState<string>('');
  const [videoFile,    setVideoFile]    = useState<File | null>(null);
  const [actualCount,  setActualCount]  = useState<string>('');
  const [jobId,        setJobId]        = useState<string | null>(null);
  const [job,          setJob]          = useState<CalibJob | null>(null);
  const [uploading,    setUploading]    = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [showAllRows,  setShowAllRows]  = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Sync venue with context
  useEffect(() => {
    if (selectedVenueId && !venueId) setVenueId(selectedVenueId);
  }, [selectedVenueId]);

  // Load cameras when venue changes
  useEffect(() => {
    if (!venueId) { setCameras([]); setCameraId(''); return; }
    setLoadingCams(true);
    setCameraId('');
    adminService.listCameras(venueId)
      .then(cams => {
        const drinkCams = cams.filter(c => c.modes.includes('drink_count') && c.enabled);
        setCameras(drinkCams);
        if (drinkCams.length === 1) setCameraId(drinkCams[0].cameraId);
      })
      .catch(() => setCameras([]))
      .finally(() => setLoadingCams(false));
  }, [venueId]);

  // Poll job status
  useEffect(() => {
    if (!jobId) return;
    const poll = async () => {
      try {
        const res = await fetch(`${CALIBRATION_URL}/calibrate/status?job_id=${jobId}`);
        if (!res.ok) return;
        const data: CalibJob = await res.json();
        setJob(data);
        if (data.status === 'done' || data.status === 'failed') {
          clearInterval(pollRef.current!);
          pollRef.current = null;
        }
      } catch { /* keep polling */ }
    };
    pollRef.current = setInterval(poll, 3000);
    poll();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [jobId]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setVideoFile(e.target.files?.[0] ?? null);
    setError(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0] ?? null;
    if (f && f.type.startsWith('video/')) { setVideoFile(f); setError(null); }
  }, []);

  const handleVenueChange = (id: string) => {
    setVenueId(id);
    setSelectedVenueId(id);
    setJob(null);
    setJobId(null);
    setError(null);
  };

  const handleRun = async () => {
    setError(null);
    if (!venueId)      { setError('Select a venue.'); return; }
    if (!cameraId)     { setError('Select a camera.'); return; }
    if (!videoFile)    { setError('Upload a video clip.'); return; }
    if (!actualCount || parseInt(actualCount) < 1) {
      setError('Enter the actual number of drinks served.');
      return;
    }
    if (!CALIBRATION_URL) {
      setError('VITE_CALIBRATION_URL is not configured.');
      return;
    }

    const form = new FormData();
    form.append('venue_id',     venueId);
    form.append('camera_id',    cameraId);
    form.append('actual_count', actualCount);
    form.append('video',        videoFile);

    setUploading(true);
    setJob(null);
    setJobId(null);
    setShowAllRows(false);

    try {
      const res  = await fetch(`${CALIBRATION_URL}/calibrate`, { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Upload failed');
      setJobId(data.job_id);
      setJob({ status: 'running', progress: 0, message: 'Queued…', result: null, error: null });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const isRunning = job?.status === 'running' || uploading;
  const isDone    = job?.status === 'done';
  const isFailed  = job?.status === 'failed';
  const best      = job?.result?.best;
  const rows      = job?.result?.results ?? [];
  const selectedCamera = cameras.find(c => c.cameraId === cameraId);

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">

      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Sliders className="w-5 h-5 text-amber-400" />
          Bar Line Auto-Calibration
        </h2>
        <p className="text-gray-400 text-sm mt-1">
          Select a venue + bar camera, upload a clip with a known drink count.
          Config is written directly to that camera and takes effect on the next live segment.
        </p>
      </div>

      {/* Info */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-blue-500/10 border border-blue-500/25">
        <Info className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-blue-300 space-y-1">
          <p>Runs on the venue droplet — takes <strong>3–8 minutes</strong> depending on clip length.</p>
          <p>Only the first 5 minutes of the clip are processed. Use a <strong>raw NVR export</strong>, not a screen recording.</p>
        </div>
      </div>

      {/* Form */}
      <div className="glass-card rounded-xl p-5 space-y-4">

        {/* Venue */}
        <div>
          <label className="block text-xs text-gray-400 mb-1.5 font-medium">Venue</label>
          <select
            value={venueId}
            onChange={e => handleVenueChange(e.target.value)}
            disabled={loadingVenues || isRunning}
            className="w-full bg-black/40 border border-white/15 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/60 disabled:opacity-50"
          >
            <option value="">— Select venue —</option>
            {venues.map(v => (
              <option key={v.venueId} value={v.venueId}>{v.name ?? v.venueId}</option>
            ))}
          </select>
        </div>

        {/* Camera */}
        <div>
          <label className="block text-xs text-gray-400 mb-1.5 font-medium">
            Bar Camera <span className="text-gray-600">(drink_count cameras only)</span>
          </label>
          {loadingCams ? (
            <p className="text-xs text-gray-500 py-2">Loading cameras…</p>
          ) : !venueId ? (
            <p className="text-xs text-gray-600 py-2">Select a venue first</p>
          ) : cameras.length === 0 ? (
            <p className="text-xs text-amber-400 py-2">No drink_count cameras found for this venue</p>
          ) : (
            <div className="grid gap-2">
              {cameras.map(cam => (
                <button
                  key={cam.cameraId}
                  onClick={() => setCameraId(cam.cameraId)}
                  disabled={isRunning}
                  className={`
                    flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-all text-sm
                    ${cameraId === cam.cameraId
                      ? 'border-amber-500/60 bg-amber-500/10 text-white'
                      : 'border-white/10 bg-black/20 text-gray-300 hover:border-white/25'}
                  `}
                >
                  <Camera className="w-4 h-4 flex-shrink-0 text-gray-400" />
                  <div className="min-w-0">
                    <p className="font-medium truncate">{cam.name}</p>
                    <p className="text-xs text-gray-500 truncate">{cam.cameraId}</p>
                  </div>
                  {cam.barConfigJson && (
                    <span className="ml-auto text-xs text-green-400 flex-shrink-0">has config</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Video upload */}
        <div>
          <label className="block text-xs text-gray-400 mb-1.5 font-medium">
            Video clip — raw NVR export (mp4 / avi / mov)
          </label>
          <div
            onDragOver={e => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            className={`
              border-2 border-dashed rounded-xl px-4 py-8 text-center cursor-pointer transition-colors
              ${videoFile
                ? 'border-amber-500/50 bg-amber-500/5'
                : 'border-white/15 bg-black/20 hover:border-white/30'}
            `}
          >
            <input ref={fileRef} type="file" accept="video/*" className="hidden"
                   onChange={handleFileChange} disabled={isRunning} />
            {videoFile ? (
              <div className="flex flex-col items-center gap-1">
                <CheckCircle className="w-6 h-6 text-amber-400" />
                <p className="text-sm text-white font-medium">{videoFile.name}</p>
                <p className="text-xs text-gray-400">{(videoFile.size / 1024 / 1024).toFixed(1)} MB</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 text-gray-400">
                <Upload className="w-6 h-6" />
                <p className="text-sm">Drag & drop or click to select video</p>
              </div>
            )}
          </div>
        </div>

        {/* Drink count */}
        <div>
          <label className="block text-xs text-gray-400 mb-1.5 font-medium">
            Actual drinks served in clip (from POS or manual count)
          </label>
          <input
            type="number" min="1" max="999"
            value={actualCount}
            onChange={e => setActualCount(e.target.value)}
            placeholder="e.g. 24"
            disabled={isRunning}
            className="w-40 bg-black/40 border border-white/15 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/60 disabled:opacity-50"
          />
        </div>

        {error && (
          <div className="flex items-center gap-2 text-red-400 text-sm">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        <motion.button
          onClick={handleRun}
          disabled={isRunning || !cameraId}
          whileHover={{ scale: (isRunning || !cameraId) ? 1 : 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-black font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Play className="w-4 h-4" />
          {uploading ? 'Uploading…' : isRunning ? 'Running…' : 'Run Calibration'}
        </motion.button>
      </div>

      {/* Progress + Results */}
      <AnimatePresence>
        {job && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card rounded-xl p-5 space-y-3"
          >
            <div className="flex items-center gap-2">
              {isRunning && <Clock className="w-4 h-4 text-amber-400 animate-pulse" />}
              {isDone    && <CheckCircle className="w-4 h-4 text-green-400" />}
              {isFailed  && <XCircle className="w-4 h-4 text-red-400" />}
              <span className={`text-sm font-medium ${isDone ? 'text-green-400' : isFailed ? 'text-red-400' : 'text-amber-300'}`}>
                {isFailed ? (job.error ?? 'Calibration failed') : job.message}
              </span>
            </div>

            {!isFailed && (
              <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full"
                  animate={{ width: `${job.progress}%` }}
                  transition={{ duration: 0.5 }}
                />
              </div>
            )}

            {isDone && best && (
              <div className="space-y-4 pt-2">
                {/* Best result */}
                <div className="p-4 rounded-xl bg-green-500/10 border border-green-500/25">
                  <p className="text-xs text-green-400 font-medium mb-2 uppercase tracking-wide">
                    Best config — saved to {selectedCamera?.name ?? cameraId}
                  </p>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <p className="text-2xl font-bold text-white">{best.accuracy_pct}%</p>
                      <p className="text-xs text-gray-400">Accuracy</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-white">{best.y_position.toFixed(2)}</p>
                      <p className="text-xs text-gray-400">Bar line Y</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-white">{best.customer_side === 1 ? 'Below' : 'Above'}</p>
                      <p className="text-xs text-gray-400">Customer side</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-4 mt-3 text-xs text-gray-400">
                    <span>Detected: <strong className="text-white">{best.detected}</strong></span>
                    <span>Actual: <strong className="text-white">{best.actual}</strong></span>
                    <span>Error: <strong className="text-white">{best.error}</strong> drinks</span>
                    {job.result?.video_seconds && (
                      <span>Clip: <strong className="text-white">{Math.round(job.result.video_seconds / 60)}min</strong></span>
                    )}
                  </div>
                </div>

                <button
                  onClick={() => setShowAllRows(v => !v)}
                  className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors"
                >
                  {showAllRows ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  {showAllRows ? 'Hide' : 'Show'} all {rows.length} configurations tested
                </button>

                <AnimatePresence>
                  {showAllRows && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-gray-500 border-b border-white/10">
                            <th className="text-left py-1.5 pr-3">Bar line Y</th>
                            <th className="text-left py-1.5 pr-3">Customer side</th>
                            <th className="text-right py-1.5 pr-3">Detected</th>
                            <th className="text-right py-1.5 pr-3">Error</th>
                            <th className="text-right py-1.5">Accuracy</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r, i) => (
                            <tr key={i} className={`border-b border-white/5 ${i === 0 ? 'text-green-400' : 'text-gray-300'}`}>
                              <td className="py-1.5 pr-3 font-mono">{r.y_position.toFixed(2)}</td>
                              <td className="py-1.5 pr-3">{r.customer_side === 1 ? 'Below (+1)' : 'Above (−1)'}</td>
                              <td className="py-1.5 pr-3 text-right">{r.detected}</td>
                              <td className="py-1.5 pr-3 text-right">{r.error > 0 ? `+${r.error}` : r.error}</td>
                              <td className="py-1.5 text-right font-semibold">
                                <AccuracyBadge pct={r.accuracy_pct} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </motion.div>
                  )}
                </AnimatePresence>

                {job.result?.bar_config_path && (
                  <p className="text-xs text-gray-500">
                    Disk backup: <code className="text-amber-400">{job.result.bar_config_path}</code>
                  </p>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {!CALIBRATION_URL && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/25">
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-amber-300 space-y-1">
            <p className="font-semibold">VITE_CALIBRATION_URL not set</p>
            <code className="block bg-black/40 px-2 py-1 rounded text-amber-400 mt-1">
              VITE_CALIBRATION_URL=https://137-184-61-178.sslip.io
            </code>
          </div>
        </div>
      )}
    </div>
  );
}

function AccuracyBadge({ pct }: { pct: number }) {
  const color = pct >= 90 ? 'text-green-400' : pct >= 75 ? 'text-amber-400' : 'text-red-400';
  return <span className={color}>{pct.toFixed(1)}%</span>;
}

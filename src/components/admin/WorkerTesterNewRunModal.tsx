import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Calendar, Clock, Camera, ListChecks, Target, AlertTriangle } from 'lucide-react';
import cameraService, { Camera as CameraType } from '../../services/camera.service';
import {
  createTestRun,
  CameraTestSpec,
  WorkerFeature,
  FEATURE_LABELS,
  GROUND_TRUTH_LABELS,
} from '../../services/workerTester.service';

const ALL_FEATURES: WorkerFeature[] = [
  'drink_count',
  'bottle_count',
  'people_count',
  'table_turns',
  'table_service',
  'staff_activity',
];

interface Props {
  open: boolean;
  venueId: string;
  createdBy: string;
  onClose: () => void;
  onCreated: (runId: string) => void;
}

interface PerCamState {
  cameraId:   string;
  cameraName: string;
  selected:   boolean;
  features:   Set<WorkerFeature>;
  groundTruth: Record<string, string>; // string for input control; cast to int on submit
}

export function WorkerTesterNewRunModal({ open, venueId, createdBy, onClose, onCreated }: Props) {
  // Defaults: yesterday, 7-8 PM in venue local time
  const yesterday = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  }, []);

  const [date,  setDate]  = useState(yesterday);
  const [start, setStart] = useState('19:00');
  const [end,   setEnd]   = useState('20:00');
  const [tz,    setTz]    = useState('America/New_York');
  const [pauseLive, setPauseLive] = useState(true);

  const [cams, setCams] = useState<CameraType[]>([]);
  const [perCam, setPerCam] = useState<Record<string, PerCamState>>({});
  const [loadingCams, setLoadingCams] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !venueId) return;
    let cancelled = false;
    setLoadingCams(true);
    cameraService.listCameras(venueId)
      .then(list => {
        if (cancelled) return;
        setCams(list);
        // Initialize per-cam state with sensible default features by mode hints
        const init: Record<string, PerCamState> = {};
        list.forEach(c => {
          const modes = (c.modes ?? []).map(m => String(m).toLowerCase()).join(',');
          const guess = new Set<WorkerFeature>();
          if (modes.includes('drink'))   guess.add('drink_count');
          if (modes.includes('bottle'))  guess.add('bottle_count');
          if (modes.includes('people'))  guess.add('people_count');
          if (modes.includes('turn'))    guess.add('table_turns');
          if (modes.includes('service')) guess.add('table_service');
          init[c.cameraId] = {
            cameraId:   c.cameraId,
            cameraName: c.name || c.cameraId,
            selected:   false,
            features:   guess,
            groundTruth: {},
          };
        });
        setPerCam(init);
      })
      .catch(e => !cancelled && setError(`Failed to load cameras: ${(e as Error).message}`))
      .finally(() => !cancelled && setLoadingCams(false));
    return () => { cancelled = true; };
  }, [open, venueId]);

  const toggleCam = (cameraId: string) => {
    setPerCam(s => ({
      ...s,
      [cameraId]: { ...s[cameraId], selected: !s[cameraId].selected },
    }));
  };

  const toggleFeature = (cameraId: string, feature: WorkerFeature) => {
    setPerCam(s => {
      const cur = s[cameraId];
      const nf = new Set(cur.features);
      if (nf.has(feature)) nf.delete(feature); else nf.add(feature);
      return { ...s, [cameraId]: { ...cur, features: nf } };
    });
  };

  const setGT = (cameraId: string, feature: WorkerFeature, val: string) => {
    setPerCam(s => ({
      ...s,
      [cameraId]: {
        ...s[cameraId],
        groundTruth: { ...s[cameraId].groundTruth, [feature]: val },
      },
    }));
  };

  const selectedCount = Object.values(perCam).filter(c => c.selected).length;

  const validate = (): string | null => {
    if (!date) return 'Pick a replay date.';
    if (!start || !end) return 'Pick start and end times.';
    if (start >= end) return 'End time must be after start time.';
    if (selectedCount === 0) return 'Select at least one camera.';
    for (const c of Object.values(perCam)) {
      if (!c.selected) continue;
      if (c.features.size === 0) return `${c.cameraName}: pick at least one feature.`;
    }
    return null;
  };

  const handleSubmit = async () => {
    const v = validate();
    if (v) { setError(v); return; }
    setError(null);
    setSubmitting(true);
    try {
      const cameras: CameraTestSpec[] = Object.values(perCam)
        .filter(c => c.selected)
        .map(c => ({
          cameraId:   c.cameraId,
          cameraName: c.cameraName,
          features:   [...c.features],
          groundTruth: Object.fromEntries(
            Object.entries(c.groundTruth)
              .filter(([_, v]) => v !== '' && !Number.isNaN(Number(v)))
              .map(([k, v]) => [k, Number(v)])
          ),
        }));
      const res = await createTestRun({
        venueId,
        createdBy,
        replayDate:      date,
        replayStartTime: start,
        replayEndTime:   end,
        replayTimezone:  tz,
        pauseLiveCams:   pauseLive,
        cameras,
      });
      onCreated(res.runId);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 overflow-y-auto"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="rounded-2xl bg-zinc-900 border border-white/10 w-full max-w-3xl max-h-[90vh] overflow-y-auto"
            initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-white/10">
              <div>
                <h2 className="text-lg font-bold text-white">New Worker Test Run</h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  Replays the selected NVR window through the live worker pipeline
                </p>
              </div>
              <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/5 text-gray-400">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-5">
              {/* Window */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field icon={<Calendar className="w-4 h-4" />} label="Replay Date">
                  <input
                    type="date"
                    value={date}
                    onChange={e => setDate(e.target.value)}
                    className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-fuchsia-500/50"
                  />
                </Field>
                <Field icon={<Clock className="w-4 h-4" />} label="Timezone">
                  <select
                    value={tz}
                    onChange={e => setTz(e.target.value)}
                    className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-fuchsia-500/50"
                  >
                    <option value="America/New_York">America/New_York (EDT/EST)</option>
                    <option value="America/Chicago">America/Chicago (CDT/CST)</option>
                    <option value="America/Denver">America/Denver (MDT/MST)</option>
                    <option value="America/Los_Angeles">America/Los_Angeles (PDT/PST)</option>
                    <option value="UTC">UTC</option>
                  </select>
                </Field>
                <Field icon={<Clock className="w-4 h-4" />} label="Start Time">
                  <input
                    type="time"
                    value={start}
                    onChange={e => setStart(e.target.value)}
                    className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-fuchsia-500/50"
                  />
                </Field>
                <Field icon={<Clock className="w-4 h-4" />} label="End Time">
                  <input
                    type="time"
                    value={end}
                    onChange={e => setEnd(e.target.value)}
                    className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-fuchsia-500/50"
                  />
                </Field>
              </div>

              <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={pauseLive}
                  onChange={e => setPauseLive(e.target.checked)}
                  className="rounded"
                />
                Pause live monitoring on selected cameras during the replay (recommended)
              </label>

              {/* Cameras */}
              <div>
                <div className="flex items-center gap-2 text-xs text-gray-300 uppercase tracking-wider font-semibold mb-2">
                  <Camera className="w-3.5 h-3.5" /> Cameras ({selectedCount} selected)
                </div>
                {loadingCams ? (
                  <div className="text-sm text-gray-400 py-4 text-center">Loading cameras…</div>
                ) : cams.length === 0 ? (
                  <div className="text-sm text-gray-400 py-4 text-center">No cameras for this venue.</div>
                ) : (
                  <div className="space-y-2">
                    {cams.map(c => {
                      const ps = perCam[c.cameraId];
                      if (!ps) return null;
                      return (
                        <div
                          key={c.cameraId}
                          className={`rounded-lg border p-3 transition-colors ${
                            ps.selected
                              ? 'border-fuchsia-500/40 bg-fuchsia-500/5'
                              : 'border-white/10 bg-white/[0.02] hover:border-white/20'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <input
                              type="checkbox"
                              checked={ps.selected}
                              onChange={() => toggleCam(c.cameraId)}
                              className="mt-1 rounded"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm text-white font-semibold">{c.name || c.cameraId}</div>
                              <div className="text-[11px] text-gray-500">
                                {(c.modes && c.modes.length) ? c.modes.join(', ') : 'no live modes'}
                              </div>

                              {ps.selected && (
                                <div className="mt-3 space-y-3">
                                  {/* Features */}
                                  <div>
                                    <div className="flex items-center gap-1 text-[10px] text-gray-400 uppercase tracking-wider font-semibold mb-1.5">
                                      <ListChecks className="w-3 h-3" /> Features
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                      {ALL_FEATURES.map(f => (
                                        <button
                                          key={f}
                                          onClick={() => toggleFeature(c.cameraId, f)}
                                          className={`px-2 py-1 rounded text-[10px] font-medium border transition-colors ${
                                            ps.features.has(f)
                                              ? 'bg-fuchsia-500/20 border-fuchsia-500/40 text-fuchsia-200'
                                              : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/20'
                                          }`}
                                        >
                                          {FEATURE_LABELS[f]}
                                        </button>
                                      ))}
                                    </div>
                                  </div>

                                  {/* Ground truth */}
                                  {ps.features.size > 0 && (
                                    <div>
                                      <div className="flex items-center gap-1 text-[10px] text-gray-400 uppercase tracking-wider font-semibold mb-1.5">
                                        <Target className="w-3 h-3" /> Ground Truth (optional)
                                      </div>
                                      <div className="grid grid-cols-2 gap-1.5">
                                        {[...ps.features].map(f => (
                                          <div key={f} className="flex items-center gap-2">
                                            <span className="text-[10px] text-gray-400 w-32 flex-shrink-0">
                                              {GROUND_TRUTH_LABELS[f] || f}
                                            </span>
                                            <input
                                              type="number"
                                              inputMode="numeric"
                                              value={ps.groundTruth[f] ?? ''}
                                              onChange={e => setGT(c.cameraId, f, e.target.value)}
                                              placeholder="—"
                                              className="flex-1 bg-zinc-800 border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-fuchsia-500/50"
                                            />
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {error && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-xs">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 p-4 border-t border-white/10 bg-black/20">
              <button
                onClick={onClose}
                disabled={submitting}
                className="px-4 py-2 rounded-lg text-sm text-gray-300 hover:bg-white/5 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting || selectedCount === 0}
                className="px-4 py-2 rounded-lg bg-gradient-to-r from-fuchsia-500 to-purple-600 hover:opacity-90 text-white font-semibold text-sm disabled:opacity-50"
              >
                {submitting ? 'Creating…' : 'Create Run'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Field({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[10px] text-gray-400 uppercase tracking-wider font-semibold mb-1">
        {icon} {label}
      </div>
      {children}
    </div>
  );
}

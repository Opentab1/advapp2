/**
 * PosReceipts — admin-only POS upload + accuracy reconciliation.
 *
 * "95% accurate" is unverifiable without ground truth. This page is where
 * an admin uploads a venue's POS receipts (CSV export of per-shift drink/
 * bottle totals) and immediately gets per-shift A-F accuracy grades
 * comparing the POS-rung totals against the worker's detected counts.
 *
 * Workflow:
 *   1. Customer exports per-shift totals from their POS system as CSV.
 *      Columns: shift_start_iso, shift_end_iso, drink_count[, bottle_count].
 *   2. Admin pastes the CSV (or uploads the file) and clicks Upload.
 *   3. Click "Compute Accuracy" → backend aggregates worker counts from
 *      VenueScopeJobs over each shift window, compares to POS, returns
 *      per-shift error% + grades + diagnostic notes.
 *
 * Future: schedule reconciliation as a nightly cron + post results to
 * the existing AccuracySLA dashboard.
 */
import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Receipt, Upload, RefreshCw, Trash2, Download,
  Loader2, Target,
} from 'lucide-react';
import { useAdminVenue } from '../../contexts/AdminVenueContext';
import { VenueSelector } from '../../components/admin/VenueSelector';
import {
  uploadPosReceiptsCsv, listPosReceipts, deletePosReceipt, getAccuracy,
  POS_CSV_TEMPLATE, GRADE_COLORS,
  PosShiftReceipt, AccuracyResult, ShiftAccuracyResult,
} from '../../services/pos.service';

function fmtIsoLocal(iso: string): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-US', {
      month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  } catch { return iso; }
}

function GradePill({ grade }: { grade: string }) {
  const cls = (GRADE_COLORS as Record<string, string>)[grade] ?? 'text-gray-400';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border border-white/10 bg-white/5 ${cls}`}>
      {grade}
    </span>
  );
}

export function PosReceipts() {
  const { selectedVenueId } = useAdminVenue();
  const venueId = selectedVenueId;

  const [csvText, setCsvText] = useState<string>(POS_CSV_TEMPLATE);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);

  const [receipts, setReceipts] = useState<PosShiftReceipt[]>([]);
  const [loadingReceipts, setLoadingReceipts] = useState(false);

  const [accuracy, setAccuracy] = useState<AccuracyResult | null>(null);
  const [computing, setComputing] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const fetchReceipts = useCallback(async () => {
    if (!venueId) return;
    setLoadingReceipts(true);
    setError(null);
    try {
      const data = await listPosReceipts(venueId);
      setReceipts(data.receipts || []);
      if (data.note) setError(data.note);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingReceipts(false);
    }
  }, [venueId]);

  useEffect(() => { fetchReceipts(); }, [fetchReceipts]);

  const handleUpload = async () => {
    if (!venueId) return;
    setUploading(true);
    setUploadMsg(null);
    setError(null);
    try {
      const r = await uploadPosReceiptsCsv(venueId, csvText, 'admin');
      setUploadMsg(
        `Uploaded ${r.written} receipt${r.written === 1 ? '' : 's'}` +
        (r.skipped ? ` (${r.skipped} skipped)` : '')
      );
      if (r.errors?.length) {
        setError(`Skipped rows: ${r.errors.map(e => e.reason).join('; ')}`);
      }
      await fetchReceipts();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const handleFile = async (file: File) => {
    const text = await file.text();
    setCsvText(text);
  };

  const handleDelete = async (shiftStartIso: string) => {
    if (!venueId) return;
    if (!confirm(`Delete POS receipt for shift starting ${fmtIsoLocal(shiftStartIso)}?`)) return;
    try {
      await deletePosReceipt(venueId, shiftStartIso);
      await fetchReceipts();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleComputeAccuracy = async () => {
    if (!venueId) return;
    setComputing(true);
    setError(null);
    try {
      const r = await getAccuracy(venueId);
      setAccuracy(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setComputing(false);
    }
  };

  const downloadTemplate = () => {
    const blob = new Blob([POS_CSV_TEMPLATE], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pos-receipts-template.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-fuchsia-500/15 border border-fuchsia-500/30">
            <Receipt className="w-6 h-6 text-fuchsia-300" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">POS Receipts</h1>
            <p className="text-sm text-gray-400">
              Upload POS export → reconcile against worker counts → A-F accuracy grades
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <VenueSelector />
        </div>
      </div>

      {error && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300"
        >
          {error}
        </motion.div>
      )}

      {/* Upload card */}
      <div className="glass-card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Upload className="w-4 h-4" /> Upload CSV
          </h2>
          <button
            onClick={downloadTemplate}
            className="btn-secondary text-xs flex items-center gap-1"
            title="Download an empty CSV template"
          >
            <Download className="w-3 h-3" /> Template
          </button>
        </div>
        <textarea
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
          rows={6}
          className="w-full font-mono text-xs p-3 rounded-lg bg-black/40 border border-white/10"
          placeholder="Paste CSV here..."
        />
        <div className="flex items-center gap-3">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            className="text-xs"
          />
          <button
            onClick={handleUpload}
            disabled={uploading || !venueId || !csvText.trim()}
            className="btn-primary text-sm flex items-center gap-2 disabled:opacity-50"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
          {uploadMsg && (
            <span className="text-xs text-emerald-300">{uploadMsg}</span>
          )}
        </div>
      </div>

      {/* Stored receipts */}
      <div className="glass-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Receipt className="w-4 h-4" /> Stored Receipts
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchReceipts}
              disabled={loadingReceipts}
              className="btn-secondary text-xs flex items-center gap-1"
            >
              <RefreshCw className={`w-3 h-3 ${loadingReceipts ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              onClick={handleComputeAccuracy}
              disabled={computing || receipts.length === 0}
              className="btn-primary text-xs flex items-center gap-1 disabled:opacity-50"
            >
              {computing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Target className="w-3 h-3" />}
              {computing ? 'Computing…' : 'Compute Accuracy'}
            </button>
          </div>
        </div>

        {receipts.length === 0 && !loadingReceipts && (
          <div className="text-sm text-gray-500 py-6 text-center">
            No POS receipts yet. Upload above to get started.
          </div>
        )}

        {receipts.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-400 border-b border-white/10">
                <tr>
                  <th className="text-left py-2 pr-4">Shift Start</th>
                  <th className="text-left py-2 pr-4">Shift End</th>
                  <th className="text-right py-2 pr-4">Drinks (POS)</th>
                  <th className="text-right py-2 pr-4">Bottles (POS)</th>
                  <th className="text-left py-2 pr-4">Uploaded</th>
                  <th className="text-right py-2"></th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((r) => (
                  <tr key={r.shiftStartIso} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="py-2 pr-4 font-mono text-xs">{fmtIsoLocal(r.shiftStartIso)}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{fmtIsoLocal(r.shiftEndIso)}</td>
                    <td className="py-2 pr-4 text-right font-mono">{r.posDrinkCount}</td>
                    <td className="py-2 pr-4 text-right font-mono text-gray-400">
                      {r.posBottleCount ?? '—'}
                    </td>
                    <td className="py-2 pr-4 text-xs text-gray-500">
                      {r.uploadedAt ? fmtIsoLocal(r.uploadedAt) : '—'}
                    </td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() => handleDelete(r.shiftStartIso)}
                        className="text-gray-500 hover:text-red-400 transition-colors"
                        title="Delete this receipt"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Accuracy results */}
      {accuracy && (
        <motion.div
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          className="glass-card p-5 space-y-3"
        >
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Target className="w-4 h-4" /> Reconciliation Results
          </h2>

          {/* Overall summary */}
          <div className="flex items-center gap-4 p-3 rounded-lg bg-white/[0.03] border border-white/10">
            <div className="flex flex-col items-center justify-center w-16 h-16 rounded-xl bg-white/5 border border-white/10">
              <span className={`text-3xl font-black ${(GRADE_COLORS as any)[accuracy.overall.drinkGrade] ?? 'text-gray-500'}`}>
                {accuracy.overall.drinkGrade}
              </span>
            </div>
            <div className="flex-1">
              <div className="text-sm text-gray-400">Overall drink accuracy across {accuracy.overall.shiftsCompared} shift{accuracy.overall.shiftsCompared === 1 ? '' : 's'}</div>
              <div className="text-lg font-semibold">
                {accuracy.overall.detectedDrinks} detected / {accuracy.overall.expectedDrinks} expected
              </div>
              <div className="text-xs text-gray-500">
                Error: {(accuracy.overall.drinkErrorPct * 100).toFixed(1)}%
              </div>
            </div>
          </div>

          {/* Per-shift breakdown */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-400 border-b border-white/10">
                <tr>
                  <th className="text-left py-2 pr-4">Shift</th>
                  <th className="text-right py-2 pr-4">Detected</th>
                  <th className="text-right py-2 pr-4">Expected</th>
                  <th className="text-right py-2 pr-4">Error %</th>
                  <th className="text-center py-2 pr-4">Grade</th>
                  <th className="text-left py-2">Notes</th>
                </tr>
              </thead>
              <tbody>
                {accuracy.shifts.map((s: ShiftAccuracyResult) => (
                  <tr key={s.shiftStartIso} className="border-b border-white/5">
                    <td className="py-2 pr-4 font-mono text-xs">{fmtIsoLocal(s.shiftStartIso)}</td>
                    <td className="py-2 pr-4 text-right font-mono">{s.detectedDrinks}</td>
                    <td className="py-2 pr-4 text-right font-mono">{s.expectedDrinks}</td>
                    <td className="py-2 pr-4 text-right font-mono">
                      {s.expectedDrinks > 0 ? `${(s.drinkErrorPct * 100).toFixed(1)}%` : '—'}
                    </td>
                    <td className="py-2 pr-4 text-center">
                      <GradePill grade={s.drinkGrade} />
                    </td>
                    <td className="py-2 text-xs text-amber-300/80 max-w-md">
                      {s.notes.join(' · ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="text-[11px] text-gray-500">
            Worker counts aggregated from {accuracy.shifts.reduce((a, b) => a + b.jobsAggregated, 0)} VenueScopeJob records.
          </div>
        </motion.div>
      )}
    </div>
  );
}

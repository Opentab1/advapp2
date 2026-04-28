/**
 * POS Receipts + Accuracy Reconciliation service.
 *
 * Frontend wrapper around the admin Lambda's POS endpoints. Used by the
 * Accuracy SLA / POS Receipts admin pages to upload customer POS exports
 * and read back per-shift reconciliation results.
 *
 * The actual reconciliation math lives in the Lambda — this is a thin REST
 * client. Customer-facing dashboard does NOT see any of this; results are
 * admin-only ground-truth grading.
 */

import { adminFetch } from './admin.service';

export interface PosShiftReceipt {
  venueId:         string;
  shiftStartIso:   string;
  shiftEndIso:     string;
  posDrinkCount:   number;
  posBottleCount?: number | null;
  uploadedAt?:     string;
  uploadedBy?:     string;
  source?:         'csv' | 'manual' | 'pos-api';
}

export type AccuracyGrade = 'A' | 'B' | 'C' | 'D' | 'F' | 'n/a';

export interface ShiftAccuracyResult {
  shiftStartIso:    string;
  shiftEndIso:      string;
  detectedDrinks:   number;
  expectedDrinks:   number;
  drinkErrorPct:    number;        // 0.0 – 1.0
  drinkGrade:       AccuracyGrade;
  detectedBottles?: number;
  expectedBottles?: number;
  bottleErrorPct?:  number;
  bottleGrade?:     AccuracyGrade;
  jobsAggregated:   number;
  notes:            string[];
}

export interface AccuracyOverall {
  shiftsCompared: number;
  detectedDrinks: number;
  expectedDrinks: number;
  drinkErrorPct:  number;
  drinkGrade:     AccuracyGrade;
}

export interface AccuracyResult {
  venueId: string;
  from:    string | null;
  to:      string | null;
  shifts:  ShiftAccuracyResult[];
  overall: AccuracyOverall;
}

export interface UploadResult {
  venueId:  string;
  written:  number;
  skipped:  number;
  receipts: Array<{ shiftStartIso: string; drinks: number }>;
  errors:   Array<{ row: any; reason: string }>;
}

// ─── API calls ──────────────────────────────────────────────────────────

export async function uploadPosReceiptsCsv(
  venueId: string,
  csvText: string,
  uploadedBy?: string,
): Promise<UploadResult> {
  return adminFetch(
    `/admin/venues/${encodeURIComponent(venueId)}/pos-receipts`,
    {
      method:  'POST',
      body:    JSON.stringify({ csv: csvText, uploadedBy }),
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

export async function listPosReceipts(
  venueId: string,
  limit: number = 500,
): Promise<{ venueId: string; count: number; receipts: PosShiftReceipt[]; note?: string }> {
  return adminFetch(
    `/admin/venues/${encodeURIComponent(venueId)}/pos-receipts?limit=${limit}`,
  );
}

export async function deletePosReceipt(
  venueId: string,
  shiftStartIso: string,
): Promise<{ venueId: string; shiftStartIso: string; deleted: boolean }> {
  return adminFetch(
    `/admin/venues/${encodeURIComponent(venueId)}/pos-receipts/${encodeURIComponent(shiftStartIso)}`,
    { method: 'DELETE' },
  );
}

export async function getAccuracy(
  venueId: string,
  fromIso?: string,
  toIso?: string,
): Promise<AccuracyResult> {
  const qs = new URLSearchParams();
  if (fromIso) qs.set('from', fromIso);
  if (toIso)   qs.set('to',   toIso);
  const tail = qs.toString() ? `?${qs}` : '';
  return adminFetch(
    `/admin/venues/${encodeURIComponent(venueId)}/accuracy${tail}`,
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────

export const POS_CSV_TEMPLATE =
  `# POS Receipts — one row per shift. Required: shift_start_iso,
# shift_end_iso, drink_count. Optional: bottle_count.
# Times are ISO-8601 with timezone offset.
shift_start_iso,shift_end_iso,drink_count,bottle_count
2026-04-26T19:30:00-04:00,2026-04-26T20:00:00-04:00,38,12
2026-04-26T20:00:00-04:00,2026-04-26T20:30:00-04:00,42,15
`;

export const GRADE_COLORS: Record<AccuracyGrade, string> = {
  A:     'text-emerald-400',
  B:     'text-lime-400',
  C:     'text-amber-400',
  D:     'text-orange-400',
  F:     'text-red-400',
  'n/a': 'text-gray-500',
};

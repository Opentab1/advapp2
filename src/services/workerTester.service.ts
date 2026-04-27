/**
 * Worker Tester Service — admin-only NVR replay runs.
 *
 * Wraps the /admin/test-runs Lambda endpoints. Results live in
 * VenueScopeTestRuns (a separate DDB table) and never appear on the
 * customer-facing dashboard.
 */

import { adminFetch } from './admin.service';

export type WorkerFeature =
  | 'drink_count'
  | 'bottle_count'
  | 'table_turns'
  | 'table_service'
  | 'people_count'
  | 'staff_activity';

export type TestRunStatus = 'pending' | 'running' | 'complete' | 'failed';
export type FeatureGrade  = 'A' | 'B' | 'C' | 'D' | 'F';

export interface CameraTestSpec {
  cameraId:   string;
  cameraName: string;
  features:   WorkerFeature[];
  /** Map of feature → expected count/value. Missing keys = no GT comparison. */
  groundTruth: Record<string, number>;
}

export interface PerFeatureResult {
  detected:    number;
  expected:    number | null;
  errorPct:    number | null;   // |detected - expected| / expected
  grade:       FeatureGrade | null;
  notes?:      string[];
}

export interface TestRunResults {
  perFeature:     Record<string, PerFeatureResult>; // keyed by feature name
  overallGrade:   FeatureGrade | null;
  stabilityGrade: 'stable' | 'unstable' | null;
  notes:          string[];
}

export interface WorkerHealth {
  peakCpu?:        number;     // %
  peakRss?:        number;     // bytes
  droppedFrames?:  number;
  errorCount?:     number;
  restarts?:       number;
  completedJobs?:  number;
  totalJobs?:      number;
}

export interface TestRun {
  runId:           string;
  venueId:         string;
  createdAt:       string;
  createdBy:       string;
  replayDate:      string;          // YYYY-MM-DD
  replayStartTime: string;          // HH:MM 24-hr
  replayEndTime:   string;          // HH:MM 24-hr
  replayTimezone:  string;          // IANA, e.g. America/New_York
  pauseLiveCams:   boolean;
  cameras:         CameraTestSpec[];
  status:          TestRunStatus;
  progress:        number;          // 0-100
  startedAt?:      string;
  completedAt?:    string;
  errorMessage?:   string;
  /** Free-form payload from the engine. Per-camera mix of feature counts
   *  (drink_count, people_count, …) plus underscored diagnostic fields
   *  (`_processed_frames`, `_avg_conf`, …) and `_events` — a list of per-serve
   *  detail records the admin UI uses to render the verification gallery. */
  liveCounts:      Record<string, Record<string, any>>;
  results:         TestRunResults | null;
  workerHealth:    WorkerHealth   | null;
}

export interface CreateTestRunInput {
  venueId:         string;
  createdBy?:      string;
  replayDate:      string;          // YYYY-MM-DD
  replayStartTime: string;          // HH:MM
  replayEndTime:   string;          // HH:MM
  replayTimezone?: string;
  pauseLiveCams?:  boolean;
  cameras:         CameraTestSpec[];
}

// ============ API ============

export async function listTestRuns(venueId?: string): Promise<TestRun[]> {
  const qs = venueId ? `?venueId=${encodeURIComponent(venueId)}` : '';
  const res = await adminFetch(`/admin/test-runs${qs}`);
  return (res.runs ?? []) as TestRun[];
}

export async function getTestRun(runId: string): Promise<TestRun> {
  return adminFetch(`/admin/test-runs/${encodeURIComponent(runId)}`);
}

export async function createTestRun(input: CreateTestRunInput): Promise<{ runId: string; status: TestRunStatus; createdAt: string }> {
  return adminFetch('/admin/test-runs', {
    method: 'POST',
    body:   JSON.stringify(input),
  });
}

export async function deleteTestRun(runId: string): Promise<void> {
  await adminFetch(`/admin/test-runs/${encodeURIComponent(runId)}`, { method: 'DELETE' });
}

/** Mint a 1-hour presigned URL for a serve-snapshot S3 key. */
export async function getSnapshotUrl(key: string): Promise<string> {
  const r = await adminFetch(`/admin/snapshot-url?key=${encodeURIComponent(key)}`);
  return r.url;
}

export interface ServeEvent {
  t:        number;
  score:    number;
  station:  string;
  track:    number;
  reason:   string;
  snapshot?: string | null;
  clip?:     string | null;
}

// ============ Helpers ============

/**
 * Calculate an A-F grade from an error percentage.
 * A ≤ 5%, B ≤ 15%, C ≤ 25%, D ≤ 50%, F > 50%.
 */
export function gradeFromErrorPct(errorPct: number): FeatureGrade {
  if (errorPct <= 0.05) return 'A';
  if (errorPct <= 0.15) return 'B';
  if (errorPct <= 0.25) return 'C';
  if (errorPct <= 0.50) return 'D';
  return 'F';
}

/** Worst grade across an array (used for overall = worst per-feature). */
export function worstGrade(grades: FeatureGrade[]): FeatureGrade | null {
  if (!grades.length) return null;
  const order: FeatureGrade[] = ['A', 'B', 'C', 'D', 'F'];
  return grades.reduce((acc, g) =>
    order.indexOf(g) > order.indexOf(acc) ? g : acc,
    grades[0]
  );
}

export const FEATURE_LABELS: Record<WorkerFeature, string> = {
  drink_count:    'Drink Count',
  bottle_count:   'Bottle Count',
  table_turns:    'Table Turns',
  table_service:  'Table Service',
  people_count:   'People Count',
  staff_activity: 'Staff Activity',
};

export const GROUND_TRUTH_LABELS: Record<string, string> = {
  drink_count:   'Drinks served',
  bottle_count:  'Bottles opened',
  table_turns:   'Table turns',
  table_service: 'Avg response (s)',
  people_count:  'Peak concurrent',
  staff_activity:'Active minutes',
};

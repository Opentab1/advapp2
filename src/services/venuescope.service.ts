/**
 * venuescope.service.ts
 *
 * Reads VenueScope job results from DynamoDB via AppSync.
 * Full summary JSON is fetched from S3 on demand for the detail view.
 */
import { generateClient } from '@aws-amplify/api';

const client = generateClient();

export interface VenueScopeJob {
  venueId: string;
  jobId: string;
  clipLabel: string;
  analysisMode: string;
  /** JSON string: ["drink_count","people_count"] */
  activeModes?: string;
  totalDrinks: number;
  drinksPerHour: number;
  topBartender: string;
  confidenceScore: number;
  confidenceLabel: string;
  confidenceColor: 'green' | 'yellow' | 'red';
  hasTheftFlag: boolean;
  unrungDrinks: number;
  cameraLabel: string;
  createdAt: number;
  finishedAt: number;
  status: string;
  s3ClipKey?: string;
  summaryS3Key?: string;
  // In-progress
  progressPct?: number;
  statusMsg?: string;
  updatedAt?: number;
  // Camera
  cameraAngle?: string;
  reviewCount?: number;
  // Bottle count
  bottleCount?: number;
  peakBottleCount?: number;
  pourCount?: number;
  totalPouredOz?: number;
  overPours?: number;
  walkOutAlerts?: number;
  unknownBottleAlerts?: number;
  parLowEvents?: number;
  // People count
  totalEntries?: number;
  totalExits?: number;
  peakOccupancy?: number;
  // Table turns
  totalTurns?: number;
  avgResponseSec?: number;
  avgDwellMin?: number;
  // Staff activity
  uniqueStaff?: number;
  peakHeadcount?: number;
  avgIdlePct?: number;
  // Live camera stream fields (pushed every ~30s from continuous RTSP streams)
  isLive?: boolean;
  roomLabel?: string;
  bartenderBreakdown?: string; // JSON: { [name]: { drinks, per_hour } }
  elapsedSec?: number;
  // POS reconciliation
  posProvider?: string;
  posRevenue?: number;
  posItemCount?: number;
  posCameraCount?: number;
  posVariancePct?: number;
  posVarianceDrinks?: number;
  posLostRevenue?: number;
  tableVisitsByStaff?: string; // JSON: {tableId: {staffId: visitCount}}
}

/** Parsed activeModes helper */
export function parseModes(job: VenueScopeJob): string[] {
  try {
    if (job.activeModes) return JSON.parse(job.activeModes);
  } catch { /* fall through */ }
  return [job.analysisMode ?? 'drink_count'];
}

interface JobConnection {
  items: VenueScopeJob[];
  nextToken?: string;
}

const LIST_JOBS_QUERY = `
  query ListVenueScopeJobs($venueId: ID!, $limit: Int, $nextToken: String) {
    listVenueScopeJobs(venueId: $venueId, limit: $limit, nextToken: $nextToken) {
      items {
        venueId jobId clipLabel analysisMode activeModes
        totalDrinks drinksPerHour topBartender
        confidenceScore confidenceLabel confidenceColor
        hasTheftFlag unrungDrinks cameraLabel
        createdAt finishedAt status s3ClipKey summaryS3Key
        progressPct statusMsg updatedAt cameraAngle reviewCount
        bottleCount peakBottleCount pourCount totalPouredOz
        overPours walkOutAlerts unknownBottleAlerts parLowEvents
        totalEntries totalExits peakOccupancy
        totalTurns avgResponseSec avgDwellMin
        uniqueStaff peakHeadcount avgIdlePct
        isLive roomLabel bartenderBreakdown elapsedSec
        posProvider posRevenue posItemCount posCameraCount posVariancePct posVarianceDrinks posLostRevenue tableVisitsByStaff
      }
      nextToken
    }
  }
`;

const venueScopeService = {
  /**
   * Fetch jobs for a venue.
   * Live cameras use stable DynamoDB IDs (live + md5 slug) so there is exactly
   * one record per camera — no accumulation. A single fetch of 500 items is
   * always sufficient to capture all live cameras + recent history.
   */
  async listJobs(venueId: string, limit = 50): Promise<VenueScopeJob[]> {
    try {
      const result = await client.graphql({
        query: LIST_JOBS_QUERY,
        variables: { venueId, limit: 500 },
        authMode: 'userPool',
      }) as { data: { listVenueScopeJobs: JobConnection } };
      const items = result?.data?.listVenueScopeJobs?.items ?? [];

      // Deduplicate live jobs by cameraLabel — keep only the most recent per camera
      const liveDeduped = Array.from(
        items
          .filter(j => j.isLive)
          .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
          .reduce((map, j) => {
            const key = j.cameraLabel || j.jobId;
            if (!map.has(key)) map.set(key, j);
            return map;
          }, new Map<string, VenueScopeJob>())
          .values()
      );
      const nonLive = items.filter(j => !j.isLive)
        .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
        .slice(0, Math.max(limit, 50));

      return [...liveDeduped, ...nonLive].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    } catch (err) {
      console.warn('[venuescope] listJobs failed:', err);
      return [];
    }
  },

  async getLatestJob(venueId: string): Promise<VenueScopeJob | null> {
    const jobs = await venueScopeService.listJobs(venueId, 1);
    return jobs[0] ?? null;
  },

  /**
   * Fetch the full summary JSON from S3 for a given job.
   * Requires the S3 bucket to have a CORS policy allowing the app's origin.
   * The Mac uploads to: s3://{bucket}/venuescope/{venueId}/{jobId}/summary.json
   *
   * Usage: set VITE_S3_SUMMARY_BASE_URL=https://{bucket}.s3.{region}.amazonaws.com
   * Objects must be readable (presigned URL or public bucket policy scoped to /venuescope/).
   */
  async getFullSummary(job: VenueScopeJob): Promise<Record<string, unknown> | null> {
    const baseUrl = import.meta.env.VITE_S3_SUMMARY_BASE_URL;
    if (!baseUrl || !job.summaryS3Key) return null;
    try {
      const url = `${baseUrl.replace(/\/$/, '')}/${job.summaryS3Key}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn('[venuescope] getFullSummary failed:', err);
      return null;
    }
  },
};

export default venueScopeService;

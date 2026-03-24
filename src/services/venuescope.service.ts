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
        venueId jobId clipLabel analysisMode
        totalDrinks drinksPerHour topBartender
        confidenceScore confidenceLabel confidenceColor
        hasTheftFlag unrungDrinks cameraLabel
        createdAt finishedAt status s3ClipKey
      }
      nextToken
    }
  }
`;

const venueScopeService = {
  async listJobs(venueId: string, limit = 50): Promise<VenueScopeJob[]> {
    try {
      const result = await client.graphql({
        query: LIST_JOBS_QUERY,
        variables: { venueId, limit },
        authMode: 'userPool',
      }) as { data: { listVenueScopeJobs: JobConnection } };
      const items = result?.data?.listVenueScopeJobs?.items ?? [];
      return [...items].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    } catch (err: any) {
      console.error('[venuescope] listJobs failed:', JSON.stringify(err, null, 2));
      console.error('[venuescope] errors array:', err?.errors);
      console.error('[venuescope] message:', err?.message);
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

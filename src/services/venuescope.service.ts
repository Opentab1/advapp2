/**
 * venuescope.service.ts
 *
 * Reads VenueScope job results from DynamoDB via AppSync.
 * The Mac running VenueScope writes to DynamoDB after each job via aws_sync.py.
 * No local server required — data lives in AWS.
 */
import { generateClient } from '@aws-amplify/api';

const client = generateClient();

export interface VenueScopeJob {
  venueId: string;
  jobId: string;
  clipLabel: string;
  analysisMode: string;
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
}

interface JobConnection {
  items: VenueScopeJob[];
  nextToken?: string;
}

const LIST_JOBS_QUERY = `
  query ListVenueScopeJobs($venueId: ID!, $limit: Int, $nextToken: String) {
    listVenueScopeJobs(venueId: $venueId, limit: $limit, nextToken: $nextToken) {
      items {
        venueId
        jobId
        clipLabel
        analysisMode
        totalDrinks
        drinksPerHour
        topBartender
        confidenceScore
        confidenceLabel
        confidenceColor
        hasTheftFlag
        unrungDrinks
        cameraLabel
        createdAt
        finishedAt
        status
        s3ClipKey
      }
      nextToken
    }
  }
`;

const venueScopeService = {
  async listJobs(venueId: string, limit = 20): Promise<VenueScopeJob[]> {
    try {
      const result = await client.graphql({
        query: LIST_JOBS_QUERY,
        variables: { venueId, limit },
        authMode: 'userPool',
      }) as { data: { listVenueScopeJobs: JobConnection } };
      const items = result?.data?.listVenueScopeJobs?.items ?? [];
      // Sort newest first
      return [...items].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    } catch (err) {
      console.warn('[venuescope] listJobs failed:', err);
      return [];
    }
  },

  async getLatestJob(venueId: string): Promise<VenueScopeJob | null> {
    const jobs = await venueScopeService.listJobs(venueId, 1);
    return jobs[0] ?? null;
  },
};

export default venueScopeService;

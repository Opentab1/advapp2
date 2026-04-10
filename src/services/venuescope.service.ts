/**
 * venuescope.service.ts
 *
 * Reads VenueScope job results from DynamoDB via AppSync (primary)
 * or direct DynamoDB SDK (fallback when AppSync is unavailable).
 * Full summary JSON is fetched from S3 on demand for the detail view.
 */
import { generateClient } from '@aws-amplify/api';
import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';

const client = generateClient();

// Direct DynamoDB client — used as fallback when AppSync is unavailable
const _ddbRegion = import.meta.env.VITE_AWS_REGION || 'us-east-2';
const _ddbKeyId  = import.meta.env.VITE_AWS_ACCESS_KEY_ID;
const _ddbSecret = import.meta.env.VITE_AWS_SECRET_ACCESS_KEY;
const _directDDB: DynamoDBClient | null = (_ddbKeyId && _ddbSecret)
  ? new DynamoDBClient({
      region: _ddbRegion,
      credentials: { accessKeyId: _ddbKeyId, secretAccessKey: _ddbSecret },
    })
  : null;

function _ddbVal(attr: Record<string, unknown> | undefined): unknown {
  if (!attr) return undefined;
  return (attr as Record<string, unknown>).S ?? (attr as Record<string, unknown>).N ?? (attr as Record<string, unknown>).BOOL;
}

function _itemToJob(item: Record<string, Record<string, unknown>>): VenueScopeJob {
  const n = (k: string) => { const v = _ddbVal(item[k]); return v !== undefined ? Number(v) : undefined; };
  const s = (k: string) => { const v = _ddbVal(item[k]); return v !== undefined ? String(v) : undefined; };
  const b = (k: string) => _ddbVal(item[k]) as boolean | undefined;
  return {
    venueId:         s('venueId') ?? '',
    jobId:           s('jobId') ?? '',
    clipLabel:       s('clipLabel') ?? '',
    analysisMode:    s('analysisMode') ?? 'drink_count',
    activeModes:     s('activeModes'),
    totalDrinks:     n('totalDrinks') ?? 0,
    drinksPerHour:   n('drinksPerHour') ?? 0,
    topBartender:    s('topBartender') ?? '',
    confidenceScore: n('confidenceScore') ?? 0,
    confidenceLabel: s('confidenceLabel') ?? '',
    confidenceColor: (s('confidenceColor') ?? 'yellow') as 'green'|'yellow'|'red',
    hasTheftFlag:    b('hasTheftFlag') ?? false,
    unrungDrinks:    n('unrungDrinks') ?? 0,
    cameraLabel:     s('cameraLabel') ?? '',
    createdAt:       n('createdAt') ?? 0,
    finishedAt:      n('finishedAt') ?? 0,
    status:          s('status') ?? '',
    s3ClipKey:       s('s3ClipKey'),
    summaryS3Key:    s('summaryS3Key'),
    progressPct:     n('progressPct'),
    statusMsg:       s('statusMsg'),
    updatedAt:       n('updatedAt'),
    cameraAngle:     s('cameraAngle'),
    reviewCount:     n('reviewCount'),
    bottleCount:     n('bottleCount'),
    peakBottleCount: n('peakBottleCount'),
    pourCount:       n('pourCount'),
    totalPouredOz:   n('totalPouredOz'),
    overPours:       n('overPours'),
    walkOutAlerts:   n('walkOutAlerts'),
    unknownBottleAlerts: n('unknownBottleAlerts'),
    parLowEvents:    n('parLowEvents'),
    totalEntries:    n('totalEntries'),
    totalExits:      n('totalExits'),
    peakOccupancy:   n('peakOccupancy'),
    totalTurns:      n('totalTurns'),
    avgResponseSec:  n('avgResponseSec'),
    avgDwellMin:     n('avgDwellMin'),
    uniqueStaff:     n('uniqueStaff'),
    peakHeadcount:   n('peakHeadcount'),
    avgIdlePct:      n('avgIdlePct'),
    isLive:          b('isLive'),
    roomLabel:       s('roomLabel'),
    bartenderBreakdown: s('bartenderBreakdown') ?? s('bartenderSummary'),
    elapsedSec:      n('elapsedSec'),
    currentHeadcount: n('currentHeadcount'),
    peopleIn:        n('peopleIn'),
    peopleOut:       n('peopleOut'),
  } as VenueScopeJob;
}

/**
 * Sort key format (aws_sync.py): !{9999999999 - int(createdAt):010d}_{jobId}
 * Ascending DDB scan → newest items (smaller inverted ts) first.
 * We compute sort key bounds to query ONLY items in the desired epoch range.
 */
function _sortKey(epochSec: number): string {
  const inv = 9999999999 - Math.floor(epochSec);
  return `!${String(inv).padStart(10, '0')}`;
}

async function _listJobsDirect(
  venueId: string,
  startEpoch?: number, // inclusive lower bound (epoch sec)
  endEpoch?: number,   // exclusive upper bound (epoch sec)
): Promise<VenueScopeJob[]> {
  if (!_directDDB) return [];
  try {
    // Sort key bounds: newer ts → smaller inverted value → lower sort key
    // For range [startEpoch, endEpoch): query sort keys BETWEEN skEnd and skStart
    const exprVals: Record<string, unknown> = { ':v': { S: venueId } };
    let keyExpr = 'venueId = :v';
    if (startEpoch !== undefined && endEpoch !== undefined) {
      const skLow  = _sortKey(endEpoch);    // inverted: most recent items (endEpoch)
      const skHigh = _sortKey(startEpoch) + '_\uffff'; // inverted: oldest items (startEpoch)
      keyExpr += ' AND jobId BETWEEN :skLow AND :skHigh';
      exprVals[':skLow']  = { S: skLow };
      exprVals[':skHigh'] = { S: skHigh };
    }

    // Paginate until we have enough items or run out
    const MAX_ITEMS = 3000;
    const allItems: VenueScopeJob[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
      const cmd: Record<string, unknown> = {
        TableName: 'VenueScopeJobs',
        KeyConditionExpression: keyExpr,
        ExpressionAttributeValues: exprVals,
        Limit: 500,
      };
      if (lastKey) cmd.ExclusiveStartKey = lastKey;
      const r = await _directDDB.send(new QueryCommand(cmd as any));
      allItems.push(...(r.Items ?? []).map(item => _itemToJob(item as Record<string, Record<string, unknown>>)));
      lastKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey && allItems.length < MAX_ITEMS);

    return allItems;
  } catch (err) {
    console.warn('[venuescope] direct DynamoDB fallback failed:', err);
    return [];
  }
}

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
  currentHeadcount?: number;
  peopleIn?: number;
  peopleOut?: number;
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
  async listJobs(
    venueId: string,
    limit = 50,
    startEpoch?: number,
    endEpoch?: number,
  ): Promise<VenueScopeJob[]> {
    const isGhost = (j: VenueScopeJob) => j.jobId.startsWith('~');
    const isLive  = (j: VenueScopeJob) => !isGhost(j) && (j.isLive === true || j.status === 'running');

    const dedupeAndSort = (items: VenueScopeJob[]) => {
      const ts = (j: VenueScopeJob) => j.finishedAt || j.updatedAt || j.createdAt || 0;
      const live = items.filter(j => isLive(j));
      const liveDeduped = Array.from(
        live
          .sort((a, b) => ts(b) - ts(a))
          .reduce((map, j) => {
            const key = j.cameraLabel || j.clipLabel || j.jobId;
            if (!map.has(key)) map.set(key, j);
            return map;
          }, new Map<string, VenueScopeJob>())
          .values()
      );
      const nonLive = items.filter(j => !isLive(j) && !isGhost(j))
        .sort((a, b) => ts(b) - ts(a))
        .slice(0, Math.max(limit, 50));
      return [...liveDeduped, ...nonLive].sort((a, b) => ts(b) - ts(a));
    };

    // Direct DynamoDB is primary — passes date range for efficient sort key queries.
    if (_directDDB) {
      const items = await _listJobsDirect(venueId, startEpoch, endEpoch);
      if (items.length > 0) return dedupeAndSort(items);
    }
    // AppSync fallback (when direct DDB credentials not configured)
    try {
      const result = await client.graphql({
        query: LIST_JOBS_QUERY,
        variables: { venueId, limit: 500 },
        authMode: 'userPool',
      }) as { data: { listVenueScopeJobs: JobConnection } };
      const connection = result?.data?.listVenueScopeJobs;
      if (!connection) throw new Error('AppSync resolver returned null — resolver not attached');
      return dedupeAndSort(connection.items ?? []);
    } catch (err) {
      console.warn('[venuescope] AppSync listJobs failed:', err);
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

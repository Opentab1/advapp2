/**
 * camera.service.ts
 *
 * CRUD for VenueScopeCameras DynamoDB table.
 * Uses the same direct DDB credentials as venuescope.service.ts.
 *
 * Table schema (create in DynamoDB console):
 *   Table name : VenueScopeCameras
 *   Partition key : venueId  (String)
 *   Sort key      : cameraId (String)
 *   Billing mode  : On-demand (Pay per request)
 */

import {
  DynamoDBClient,
  QueryCommand,
  PutItemCommand,
  UpdateItemCommand,
  DeleteItemCommand,
} from '@aws-sdk/client-dynamodb';

const _region  = import.meta.env.VITE_AWS_REGION || 'us-east-2';
const _keyId   = import.meta.env.VITE_AWS_ACCESS_KEY_ID;
const _secret  = import.meta.env.VITE_AWS_SECRET_ACCESS_KEY;

const _ddb: DynamoDBClient | null = (_keyId && _secret)
  ? new DynamoDBClient({
      region: _region,
      credentials: { accessKeyId: _keyId, secretAccessKey: _secret },
    })
  : null;

const TABLE = 'VenueScopeCameras';

export type CameraMode =
  | 'drink_count'
  | 'bottle_count'
  | 'people_count'
  | 'table_turns'
  | 'table_service'
  | 'staff_activity'
  | 'after_hours';

export interface Camera {
  venueId: string;
  cameraId: string;
  name: string;
  rtspUrl: string;
  modes: CameraMode[];
  enabled: boolean;
  modelProfile: 'fast' | 'balanced' | 'accurate';
  segmentSeconds: number; // 0 = continuous live
  segmentInterval?: number; // seconds between clips (defaults to segmentSeconds)
  createdAt: number;
  notes?: string;
  barConfigJson?: string; // JSON: {stations: [{zone_id, label, polygon, bar_line_p1, bar_line_p2, customer_side}]}
  tableZonesJson?: string; // JSON array: [{table_id, label, polygon: [[x,y],...]}]
  nextOccupancyAt?: number; // Unix epoch seconds — when the worker will next run people_count
}

function _itemToCamera(item: Record<string, Record<string, unknown>>): Camera {
  const s = (k: string) => (item[k] as any)?.S ?? '';
  const n = (k: string) => Number((item[k] as any)?.N ?? 0);
  const b = (k: string) => (item[k] as any)?.BOOL ?? true;
  const modes = s('modes')
    .split(',')
    .map(m => m.trim())
    .filter(Boolean) as CameraMode[];
  const rawInterval = (item['segmentInterval'] as any)?.N || (item['segmentInterval'] as any)?.S;
  return {
    venueId:         s('venueId'),
    cameraId:        s('cameraId'),
    name:            s('name'),
    rtspUrl:         s('rtspUrl'),
    modes:           modes.length ? modes : ['drink_count'],
    enabled:         b('enabled'),
    modelProfile:    (s('modelProfile') || 'balanced') as Camera['modelProfile'],
    segmentSeconds:  n('segmentSeconds'),
    segmentInterval: rawInterval ? Number(rawInterval) : undefined,
    createdAt:       n('createdAt'),
    notes:           s('notes') || undefined,
    barConfigJson:   s('barConfigJson') || undefined,
    tableZonesJson:  s('tableZonesJson') || undefined,
    nextOccupancyAt: n('nextOccupancyAt') || undefined,
  };
}

function _cameraToItem(cam: Camera): Record<string, unknown> {
  const item: Record<string, unknown> = {
    venueId:        { S: cam.venueId },
    cameraId:       { S: cam.cameraId },
    name:           { S: cam.name },
    rtspUrl:        { S: cam.rtspUrl },
    modes:          { S: cam.modes.join(',') },
    enabled:        { BOOL: cam.enabled },
    modelProfile:   { S: cam.modelProfile },
    segmentSeconds: { N: String(cam.segmentSeconds) },
    createdAt:      { N: String(cam.createdAt) },
  };
  if (cam.notes) item.notes = { S: cam.notes };
  if (cam.segmentInterval) item.segmentInterval = { N: String(cam.segmentInterval) };
  return item;
}

function _requireDDB(): DynamoDBClient {
  if (!_ddb) throw new Error('AWS credentials not configured (VITE_AWS_ACCESS_KEY_ID / VITE_AWS_SECRET_ACCESS_KEY)');
  return _ddb;
}

function _randomId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

const cameraService = {

  async listCameras(venueId: string): Promise<Camera[]> {
    const ddb = _requireDDB();
    const result = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'venueId = :v',
      ExpressionAttributeValues: { ':v': { S: venueId } },
    }));
    return (result.Items ?? [])
      .map(item => _itemToCamera(item as Record<string, Record<string, unknown>>))
      .sort((a, b) => a.createdAt - b.createdAt);
  },

  async addCamera(
    venueId: string,
    input: Omit<Camera, 'venueId' | 'cameraId' | 'createdAt'>
  ): Promise<Camera> {
    const ddb = _requireDDB();
    const cam: Camera = {
      ...input,
      venueId,
      cameraId: _randomId(),
      createdAt: Math.floor(Date.now() / 1000),
    };
    await ddb.send(new PutItemCommand({
      TableName: TABLE,
      Item: _cameraToItem(cam) as any,
    }));
    return cam;
  },

  async updateCamera(
    venueId: string,
    cameraId: string,
    updates: Partial<Pick<Camera, 'name' | 'rtspUrl' | 'modes' | 'enabled' | 'modelProfile' | 'segmentSeconds' | 'segmentInterval' | 'notes' | 'barConfigJson' | 'tableZonesJson'>>
  ): Promise<void> {
    const ddb = _requireDDB();

    const expParts: string[] = [];
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};

    if (updates.name !== undefined) {
      expParts.push('#n = :n'); names['#n'] = 'name'; values[':n'] = { S: updates.name };
    }
    if (updates.rtspUrl !== undefined) {
      expParts.push('rtspUrl = :u'); values[':u'] = { S: updates.rtspUrl };
    }
    if (updates.modes !== undefined) {
      expParts.push('modes = :m'); values[':m'] = { S: updates.modes.join(',') };
    }
    if (updates.enabled !== undefined) {
      expParts.push('enabled = :e'); values[':e'] = { BOOL: updates.enabled };
    }
    if (updates.modelProfile !== undefined) {
      expParts.push('modelProfile = :p'); values[':p'] = { S: updates.modelProfile };
    }
    if (updates.segmentSeconds !== undefined) {
      expParts.push('segmentSeconds = :s'); values[':s'] = { N: String(updates.segmentSeconds) };
    }
    if (updates.segmentInterval !== undefined && updates.segmentInterval > 0) {
      expParts.push('segmentInterval = :si'); values[':si'] = { N: String(updates.segmentInterval) };
    }
    if (updates.notes !== undefined) {
      expParts.push('notes = :notes'); values[':notes'] = { S: updates.notes };
    }
    if (updates.barConfigJson !== undefined) {
      expParts.push('barConfigJson = :bcj'); values[':bcj'] = { S: updates.barConfigJson };
    }
    if (updates.tableZonesJson !== undefined) {
      expParts.push('tableZonesJson = :tzj'); values[':tzj'] = { S: updates.tableZonesJson };
    }

    if (expParts.length === 0) return;

    let updateExpr = `SET ${expParts.join(', ')}`;
    // Clear interval when explicitly set to 0 (use default = segmentSeconds)
    if (updates.segmentInterval === 0) updateExpr += ' REMOVE segmentInterval';

    await ddb.send(new UpdateItemCommand({
      TableName: TABLE,
      Key: { venueId: { S: venueId }, cameraId: { S: cameraId } },
      UpdateExpression: updateExpr,
      ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
      ExpressionAttributeValues: Object.keys(values).length ? values as any : undefined,
    }));
  },

  async deleteCamera(venueId: string, cameraId: string): Promise<void> {
    const ddb = _requireDDB();
    await ddb.send(new DeleteItemCommand({
      TableName: TABLE,
      Key: { venueId: { S: venueId }, cameraId: { S: cameraId } },
    }));
  },

  async toggleCamera(venueId: string, cameraId: string, enabled: boolean): Promise<void> {
    return cameraService.updateCamera(venueId, cameraId, { enabled });
  },
};

export default cameraService;

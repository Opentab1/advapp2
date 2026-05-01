/**
 * VenueScope Admin API Lambda — v2
 *
 * All admin operations in one Lambda behind API Gateway (HTTP API).
 *
 * Environment variables required on the Lambda:
 *   USER_POOL_ID  — Cognito User Pool ID (e.g. us-east-2_sMY1wYEF9)
 *   REGION        — AWS region (e.g. us-east-2)
 *
 * IAM role needs:
 *   cognito-idp: AdminCreateUser, AdminUpdateUserAttributes, ListUsers,
 *                AdminSetUserPassword, AdminDisableUser, AdminEnableUser
 *   dynamodb: PutItem, GetItem, Scan, Query, UpdateItem, DeleteItem
 *             on VenueScopeVenues, VenueScopeCameras, VenueScopeJobs
 *
 * Routes:
 *   GET    /admin/venues
 *   POST   /admin/venues
 *   PATCH  /admin/venues/:venueId/status
 *   GET    /admin/users
 *   POST   /admin/users
 *   POST   /admin/users/:email/disable
 *   POST   /admin/users/:email/enable
 *   POST   /admin/users/:email/reset-password
 *   GET    /admin/cameras               (query param: venueId)
 *   PATCH  /admin/cameras/:cameraId     (body: {venueId, ...fields})
 *   DELETE /admin/cameras/:cameraId     (query param: venueId)
 *   GET    /admin/jobs                  (query param: venueId, limit)
 *   GET    /admin/stats
 *   GET    /admin/alerts                (query param: venueId, limit)
 *   POST   /admin/probe-cameras
 *   GET    /billing/status              (query param: venueId)
 *   POST   /billing/create-checkout     (body: {venueId, successUrl, cancelUrl})
 *   POST   /billing/portal              (body: {venueId, returnUrl})
 *   POST   /billing/webhook             (Stripe webhook — raw body, Stripe-Signature header)
 */

import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminUpdateUserAttributesCommand,
  ListUsersCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminSetUserPasswordCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import {
  DynamoDBClient,
  PutItemCommand,
  ScanCommand,
  QueryCommand,
  UpdateItemCommand,
  DeleteItemCommand,
  GetItemCommand,
} from '@aws-sdk/client-dynamodb';
import { SESClient, SendEmailCommand, VerifyEmailIdentityCommand, GetIdentityVerificationAttributesCommand } from '@aws-sdk/client-ses';
import { EventBridgeClient, PutRuleCommand, PutTargetsCommand, DeleteRuleCommand, RemoveTargetsCommand, ListRulesCommand } from '@aws-sdk/client-eventbridge';
import { LambdaClient, AddPermissionCommand, RemovePermissionCommand } from '@aws-sdk/client-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHmac, timingSafeEqual } from 'crypto';

const REGION       = process.env.REGION || 'us-east-2';
const USER_POOL_ID = process.env.USER_POOL_ID;

const VENUES_TABLE  = 'VenueScopeVenues';
const CAMERAS_TABLE = 'VenueScopeCameras';
const JOBS_TABLE    = 'VenueScopeJobs';
const BILLING_TABLE = 'VenueScopeBilling';
// Review queue — populated by worker when a detection fires below its
// confidence threshold. Schema: PK=venueId, SK=eventId. A reviewer approves
// or rejects each, updating the authoritative drink/bottle/visit count.
const REVIEW_TABLE  = 'VenueScopeLowConfEvents';
// Worker Tester — admin-only replay runs against historical NVR footage.
// Created by an admin via /admin/test-runs, written to by the worker as it
// processes the replay job. Schema lives in the docstring of the handlers
// below. NEVER surfaced on the customer dashboard.
const TEST_RUNS_TABLE = 'VenueScopeTestRuns';
// POS receipts — ground truth uploaded per-shift by venue operators.
// PK: venueId (S), SK: shiftStartIso (S). Used by GET /admin/venues/{id}/accuracy
// to grade the worker's drink/bottle counts against the POS-rung totals.
const POS_TABLE = 'VenueScopePosReceipts';
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY ?? '';
const STRIPE_PRICE  = process.env.STRIPE_PRICE_ID   ?? '';
const STRIPE_WH_SEC = process.env.STRIPE_WEBHOOK_SECRET ?? '';
const TRIAL_DAYS    = 14;

const cognito      = new CognitoIdentityProviderClient({ region: REGION });
const ddb          = new DynamoDBClient({ region: REGION });
const ses          = new SESClient({ region: REGION });
const eventsClient = new EventBridgeClient({ region: REGION });
const lambdaClient = new LambdaClient({ region: REGION });
const s3           = new S3Client({ region: REGION });
const SNAPSHOTS_BUCKET = process.env.SNAPSHOTS_BUCKET || 'venuescope-media';
const FROM_EMAIL   = process.env.SES_FROM_EMAIL || 'reports@advizia.online';
const PORTAL_URL   = process.env.PORTAL_URL     || 'https://advizia.online/admin';

const EMAIL_SETTINGS_KEY   = '_email_settings_';
const EMAIL_LOG_KEY        = '_email_log_';
const EMAIL_SCHEDULE_RULE  = 'VenueScopeEmailReports';
const EMAIL_SCHEDULE_EXPR  = 'cron(0 11 * * ? *)';  // 6 AM ET daily

// Set at handler invocation — used for EventBridge → Lambda permission grant
let _lambdaArn = '';

const cors = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Admin-Key',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
};

const ok  = (body)       => ({ statusCode: 200, headers: cors, body: JSON.stringify(body) });
const err = (status, msg) => ({ statusCode: status, headers: cors, body: JSON.stringify({ error: msg }) });

const s = (v) => v?.S ?? '';
const n = (v) => parseFloat(v?.N ?? '0');
const b = (v) => v?.BOOL ?? false;

// ─── DynamoDB helpers ──────────────────────────────────────────────────────────

function venueFromItem(item) {
  const emailConfigRaw = item.emailConfigJson?.S;
  return {
    venueId:      s(item.venueId),
    venueName:    s(item.venueName),
    status:       s(item.status) || 'active',
    createdAt:    s(item.createdAt),
    ownerEmail:   s(item.ownerEmail),
    ownerName:    s(item.ownerName),
    locationName: s(item.locationName) || 'Main',
    locationId:   s(item.locationId)   || 'main',
    plan:         s(item.plan)         || 'standard',
    userCount:    parseInt(item.userCount?.N ?? '1'),
    deviceCount:  parseInt(item.deviceCount?.N ?? '0'),
    emailConfig:  emailConfigRaw ? JSON.parse(emailConfigRaw) : null,
    // Forecast onboarding profile — feeds prior model until Prophet trains
    capacity:       item.capacity?.N        ? parseInt(item.capacity.N)      : null,
    venueTier:      s(item.venueTier)       || null,
    slowDayCovers:  item.slowDayCovers?.N   ? parseInt(item.slowDayCovers.N) : null,
    busyDayCovers:  item.busyDayCovers?.N   ? parseInt(item.busyDayCovers.N) : null,
  };
}

function cameraFromItem(item) {
  return {
    cameraId:        s(item.cameraId),
    venueId:         s(item.venueId),
    name:            s(item.name),
    rtspUrl:         s(item.rtspUrl),
    modes:           s(item.modes),
    modelProfile:    s(item.modelProfile) || 'balanced',
    enabled:         b(item.enabled),
    segmentSeconds:  n(item.segmentSeconds),
    segmentInterval: n(item.segmentInterval),
    createdAt:       s(item.createdAt),
    notes:           s(item.notes),
    barConfigJson:   s(item.barConfigJson),
    tableZonesJson:  s(item.tableZonesJson),
    blobsPerPerson:  n(item.blobsPerPerson),
    // Layer 2 health flags written by the worker — drive the
    // "Zones may be misaligned" badge and accuracy panel in the admin UI.
    needsRecalibration: item.needsRecalibration?.BOOL === true,
    recalCheckedAt:     n(item.recalCheckedAt),
    recalElapsedSec:    n(item.recalElapsedSec),
    recalTotalDrinks:   n(item.recalTotalDrinks),
    posVariancePct:     n(item.posVariancePct),
  };
}

function jobFromItem(item) {
  return {
    venueId:         s(item.venueId),
    jobId:           s(item.jobId),
    clipLabel:       s(item.clipLabel),
    analysisMode:    s(item.analysisMode),
    status:          s(item.status),
    totalDrinks:     parseInt(item.totalDrinks?.N ?? '0'),
    drinksPerHour:   n(item.drinksPerHour),
    hasTheftFlag:    b(item.hasTheftFlag),
    unrungDrinks:    parseInt(item.unrungDrinks?.N ?? '0'),
    confidenceScore: parseInt(item.confidenceScore?.N ?? '0'),
    confidenceLabel: s(item.confidenceLabel),
    createdAt:       n(item.createdAt),
    finishedAt:      n(item.finishedAt),
    elapsedSec:      n(item.elapsedSec),
    isLive:          b(item.isLive),
    bartenderBreakdown: s(item.bartenderBreakdown),
    cameraLabel:     s(item.cameraLabel),
  };
}

// ─── Venues ───────────────────────────────────────────────────────────────────

async function listVenues() {
  const result = await ddb.send(new ScanCommand({ TableName: VENUES_TABLE }));
  const items  = (result.Items ?? [])
    .filter(item => !s(item.venueId).startsWith('_'))  // exclude internal records (_system_settings_, etc.)
    .map(venueFromItem);
  items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return ok({ items });
}

async function createVenue(body) {
  const { venueName, venueId, locationName = 'Main', locationId = 'main',
          ownerEmail, ownerName, tempPassword,
          capacity, venueTier, slowDayCovers, busyDayCovers } = body;
  if (!venueName || !venueId || !ownerEmail || !ownerName || !tempPassword)
    return err(400, 'Missing: venueName, venueId, ownerEmail, ownerName, tempPassword');
  if (!USER_POOL_ID) return err(500, 'USER_POOL_ID env var not set');

  // Prevent duplicate venue names — scan existing venues for a name collision
  {
    const existing = await ddb.send(new ScanCommand({
      TableName: VENUES_TABLE,
      FilterExpression: 'venueName = :n',
      ExpressionAttributeValues: { ':n': { S: venueName } },
    }));
    if ((existing.Items ?? []).length > 0) {
      const dup = existing.Items[0];
      return err(409, `A venue named "${venueName}" already exists (id: ${dup.venueId?.S}). Use a unique name or edit the existing venue.`);
    }
  }

  await cognito.send(new AdminCreateUserCommand({
    UserPoolId: USER_POOL_ID,
    Username: ownerEmail,
    TemporaryPassword: tempPassword,
    UserAttributes: [
      { Name: 'email',            Value: ownerEmail },
      { Name: 'name',             Value: ownerName },
      { Name: 'custom:venueId',   Value: venueId },
      { Name: 'custom:venueName', Value: venueName },
      { Name: 'custom:role',      Value: 'owner' },
      { Name: 'email_verified',   Value: 'true' },
    ],
    DesiredDeliveryMediums: ['EMAIL'],
  }));

  const venueItem = {
    venueId:      { S: venueId },
    venueName:    { S: venueName },
    locationName: { S: locationName },
    locationId:   { S: locationId },
    ownerEmail:   { S: ownerEmail },
    ownerName:    { S: ownerName },
    status:       { S: 'active' },
    createdAt:    { S: new Date().toISOString() },
    plan:         { S: 'standard' },
    userCount:    { N: '1' },
    deviceCount:  { N: '0' },
  };
  // Forecast onboarding profile — optional at venue creation, but strongly
  // recommended so tonight's prior isn't a generic industry average.
  if (Number.isInteger(capacity) && capacity > 0)
    venueItem.capacity = { N: String(capacity) };
  if (venueTier && typeof venueTier === 'string')
    venueItem.venueTier = { S: venueTier };
  if (Number.isInteger(slowDayCovers) && slowDayCovers > 0)
    venueItem.slowDayCovers = { N: String(slowDayCovers) };
  if (Number.isInteger(busyDayCovers) && busyDayCovers > 0)
    venueItem.busyDayCovers = { N: String(busyDayCovers) };

  await ddb.send(new PutItemCommand({
    TableName: VENUES_TABLE,
    Item: venueItem,
    ConditionExpression: 'attribute_not_exists(venueId)',
  }));

  return ok({ success: true, venueId, ownerEmail });
}

async function updateVenueStatus(venueId, status) {
  await ddb.send(new UpdateItemCommand({
    TableName: VENUES_TABLE,
    Key: { venueId: { S: venueId } },
    UpdateExpression: 'SET #s = :s',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':s': { S: status } },
  }));
  return ok({ success: true });
}

async function updateVenueProfile(venueId, body) {
  if (!venueId || venueId.startsWith('_')) return err(400, 'invalid venueId');
  const { capacity, venueTier, slowDayCovers, busyDayCovers } = body;
  const setFragments = [];
  const values = {};
  const names = {};
  // capacity is a DynamoDB reserved word — must go through ExpressionAttributeNames.
  if (Number.isInteger(capacity) && capacity > 0) {
    setFragments.push('#cap = :cap');
    names['#cap'] = 'capacity';
    values[':cap'] = { N: String(capacity) };
  }
  if (venueTier && typeof venueTier === 'string') {
    setFragments.push('venueTier = :tier');
    values[':tier'] = { S: venueTier };
  }
  if (Number.isInteger(slowDayCovers) && slowDayCovers > 0) {
    setFragments.push('slowDayCovers = :slow');
    values[':slow'] = { N: String(slowDayCovers) };
  }
  if (Number.isInteger(busyDayCovers) && busyDayCovers > 0) {
    setFragments.push('busyDayCovers = :busy');
    values[':busy'] = { N: String(busyDayCovers) };
  }
  if (setFragments.length === 0)
    return err(400, 'no profile fields provided');
  try {
    await ddb.send(new UpdateItemCommand({
      TableName: VENUES_TABLE,
      Key: { venueId: { S: venueId } },
      UpdateExpression: 'SET ' + setFragments.join(', '),
      ExpressionAttributeValues: values,
      ...(Object.keys(names).length ? { ExpressionAttributeNames: names } : {}),
    }));
    return ok({ ok: true });
  } catch (e) {
    return err(500, e.message);
  }
}

// ─── Users ────────────────────────────────────────────────────────────────────

async function listUsers() {
  if (!USER_POOL_ID) return err(500, 'USER_POOL_ID env var not set');
  const users = [];
  let token;
  do {
    const result = await cognito.send(new ListUsersCommand({
      UserPoolId: USER_POOL_ID, Limit: 60, PaginationToken: token,
    }));
    for (const u of result.Users ?? []) {
      const attr = (name) => u.Attributes?.find(a => a.Name === name)?.Value ?? '';
      users.push({
        userId:        u.Username ?? '',
        email:         attr('email'),
        name:          attr('name'),
        venueId:       attr('custom:venueId'),
        venueName:     attr('custom:venueName'),
        role:          attr('custom:role') || 'staff',
        status:        u.Enabled ? 'active' : 'disabled',
        createdAt:     u.UserCreateDate?.toISOString() ?? '',
        lastLoginAt:   u.UserLastModifiedDate?.toISOString(),
        emailVerified: attr('email_verified') === 'true',
      });
    }
    token = result.PaginationToken;
  } while (token);
  return ok({ items: users });
}

async function createUser(body) {
  const { email, name, venueId, venueName, role = 'staff', tempPassword } = body;
  if (!email || !name || !venueId || !tempPassword)
    return err(400, 'Missing: email, name, venueId, tempPassword');
  if (!USER_POOL_ID) return err(500, 'USER_POOL_ID env var not set');

  await cognito.send(new AdminCreateUserCommand({
    UserPoolId: USER_POOL_ID,
    Username: email,
    TemporaryPassword: tempPassword,
    UserAttributes: [
      { Name: 'email',            Value: email },
      { Name: 'name',             Value: name },
      { Name: 'custom:venueId',   Value: venueId },
      { Name: 'custom:venueName', Value: venueName ?? '' },
      { Name: 'custom:role',      Value: role },
      { Name: 'email_verified',   Value: 'true' },
    ],
    DesiredDeliveryMediums: ['EMAIL'],
  }));
  return ok({ success: true });
}

async function disableUser(email) {
  if (!USER_POOL_ID) return err(500, 'USER_POOL_ID env var not set');
  await cognito.send(new AdminDisableUserCommand({ UserPoolId: USER_POOL_ID, Username: email }));
  return ok({ success: true });
}

async function enableUser(email) {
  if (!USER_POOL_ID) return err(500, 'USER_POOL_ID env var not set');
  await cognito.send(new AdminEnableUserCommand({ UserPoolId: USER_POOL_ID, Username: email }));
  return ok({ success: true });
}

async function resetUserPassword(email, body) {
  if (!USER_POOL_ID) return err(500, 'USER_POOL_ID env var not set');
  const rand = Math.random().toString(36).slice(2, 10);
  const num  = Math.floor(Math.random() * 900) + 100;
  const temp = body?.tempPassword || `Reset${num}${rand}!`;
  await cognito.send(new AdminSetUserPasswordCommand({
    UserPoolId: USER_POOL_ID, Username: email,
    Password: temp, Permanent: false,
  }));
  return ok({ success: true, tempPassword: temp });
}

// ─── Cameras ──────────────────────────────────────────────────────────────────

async function createCamera(body) {
  // modes defaults to empty — operator picks features per camera after
  // creation so we don't run YOLO on cameras that don't have a bar in frame.
  const { venueId, name, rtspUrl, modes = '', modelProfile = 'balanced',
          segmentSeconds = 0, segmentInterval = 0, notes = '', enabled = true } = body;
  if (!venueId || !name || !rtspUrl)
    return err(400, 'Missing: venueId, name, rtspUrl');

  const cameraId = `cam_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await ddb.send(new PutItemCommand({
    TableName: CAMERAS_TABLE,
    Item: {
      venueId:         { S: venueId },
      cameraId:        { S: cameraId },
      name:            { S: name },
      rtspUrl:         { S: rtspUrl },
      modes:           { S: Array.isArray(modes) ? modes.join(',') : modes },
      modelProfile:    { S: modelProfile },
      enabled:         { BOOL: Boolean(enabled) },
      segmentSeconds:  { N: String(segmentSeconds) },
      segmentInterval: { N: String(segmentInterval) },
      notes:           { S: notes },
      createdAt:       { S: new Date().toISOString() },
    },
  }));
  return ok({ success: true, cameraId });
}

async function listCameras(venueId) {
  let result;
  if (venueId) {
    result = await ddb.send(new QueryCommand({
      TableName: CAMERAS_TABLE,
      KeyConditionExpression: 'venueId = :v',
      ExpressionAttributeValues: { ':v': { S: venueId } },
    }));
  } else {
    result = await ddb.send(new ScanCommand({ TableName: CAMERAS_TABLE }));
  }
  const items = (result.Items ?? []).map(cameraFromItem);
  return ok({ items });
}

async function updateCamera(cameraId, body) {
  const { venueId, ...fields } = body;
  if (!venueId) return err(400, 'venueId required in body');

  const updates = [];
  const names   = {};
  const values  = {};

  const setField = (attr, val, type = 'S') => {
    updates.push(`#${attr} = :${attr}`);
    names[`#${attr}`]  = attr;
    values[`:${attr}`] = type === 'N' ? { N: String(val) }
                       : type === 'BOOL' ? { BOOL: Boolean(val) }
                       : { S: String(val) };
  };

  if (fields.name          !== undefined) setField('name', fields.name);
  if (fields.rtspUrl        !== undefined) setField('rtspUrl', fields.rtspUrl);
  if (fields.modes          !== undefined) setField('modes', fields.modes);
  if (fields.modelProfile   !== undefined) setField('modelProfile', fields.modelProfile);
  if (fields.notes          !== undefined) setField('notes', fields.notes);
  if (fields.barConfigJson  !== undefined) setField('barConfigJson', fields.barConfigJson);
  if (fields.tableZonesJson !== undefined) setField('tableZonesJson', fields.tableZonesJson);
  if (fields.enabled        !== undefined) setField('enabled', fields.enabled, 'BOOL');
  if (fields.segmentSeconds !== undefined) setField('segmentSeconds', fields.segmentSeconds, 'N');
  if (fields.segmentInterval!== undefined) setField('segmentInterval', fields.segmentInterval, 'N');

  if (!updates.length) return ok({ success: true });

  await ddb.send(new UpdateItemCommand({
    TableName: CAMERAS_TABLE,
    Key: { venueId: { S: venueId }, cameraId: { S: cameraId } },
    UpdateExpression: `SET ${updates.join(', ')}`,
    ExpressionAttributeNames:  names,
    ExpressionAttributeValues: values,
  }));
  return ok({ success: true });
}

async function bulkUpdateNvrPort(body) {
  const { venueId, oldPort, newPort } = body;
  if (!venueId || !newPort) return err(400, 'venueId and newPort required');

  // Fetch all cameras for this venue
  const resp = await ddb.send(new QueryCommand({
    TableName: CAMERAS_TABLE,
    KeyConditionExpression: 'venueId = :v',
    ExpressionAttributeValues: { ':v': { S: venueId } },
  }));
  const items = resp.Items || [];
  if (!items.length) return ok({ success: true, updated: 0 });

  let updated = 0;
  for (const item of items) {
    const url = item.rtspUrl?.S || '';
    const newUrl = oldPort
      ? url.replace(`:${oldPort}/`, `:${newPort}/`)
      : url.replace(/:\d+\//, `:${newPort}/`);
    if (newUrl === url) continue;
    await ddb.send(new UpdateItemCommand({
      TableName: CAMERAS_TABLE,
      Key: { venueId: { S: venueId }, cameraId: item.cameraId },
      UpdateExpression: 'SET rtspUrl = :u',
      ExpressionAttributeValues: { ':u': { S: newUrl } },
    }));
    updated++;
  }
  return ok({ success: true, updated });
}

async function deleteCamera(cameraId, venueId) {
  if (!venueId) return err(400, 'venueId required');
  await ddb.send(new DeleteItemCommand({
    TableName: CAMERAS_TABLE,
    Key: { venueId: { S: venueId }, cameraId: { S: cameraId } },
  }));
  return ok({ success: true });
}

// ─── Jobs ─────────────────────────────────────────────────────────────────────

async function listJobs(venueId, limit = 50) {
  if (!venueId) {
    // Scan all — admin only, expensive but needed for ops dashboard
    const result = await ddb.send(new ScanCommand({
      TableName: JOBS_TABLE,
      Limit: Math.min(parseInt(limit), 200),
    }));
    const items = (result.Items ?? []).map(jobFromItem);
    items.sort((a, b) => b.createdAt - a.createdAt);
    return ok({ items });
  }
  const result = await ddb.send(new QueryCommand({
    TableName: JOBS_TABLE,
    KeyConditionExpression: 'venueId = :v',
    ExpressionAttributeValues: { ':v': { S: venueId } },
    ScanIndexForward: false,
    Limit: Math.min(parseInt(limit), 200),
  }));
  return ok({ items: (result.Items ?? []).map(jobFromItem) });
}

// ─── Stats ────────────────────────────────────────────────────────────────────

async function getStats() {
  const [venuesResult, camerasResult, jobsResult] = await Promise.all([
    ddb.send(new ScanCommand({ TableName: VENUES_TABLE, Select: 'ALL_ATTRIBUTES' })),
    ddb.send(new ScanCommand({ TableName: CAMERAS_TABLE, Select: 'COUNT' })),
    ddb.send(new ScanCommand({
      TableName: JOBS_TABLE,
      FilterExpression: 'createdAt > :cutoff',
      ExpressionAttributeValues: { ':cutoff': { N: String(Date.now() / 1000 - 86400) } },
      ProjectionExpression: 'totalDrinks, hasTheftFlag, venueId, #st',
      ExpressionAttributeNames: { '#st': 'status' },
    })),
  ]);

  const venues       = (venuesResult.Items ?? []).map(venueFromItem);
  const activeVenues = venues.filter(v => v.status === 'active').length;
  const totalCameras = camerasResult.Count ?? 0;

  let totalDrinksToday = 0;
  let theftFlagsToday  = 0;
  const activeVenueSet = new Set();
  for (const item of jobsResult.Items ?? []) {
    totalDrinksToday += parseInt(item.totalDrinks?.N ?? '0');
    if (b(item.hasTheftFlag)) theftFlagsToday++;
    if (s(item.status) === 'running' || s(item.status) === 'done')
      activeVenueSet.add(s(item.venueId));
  }

  return ok({
    totalVenues:      venues.length,
    activeVenues,
    activeCameras:    totalCameras,
    drinksToday:      totalDrinksToday,
    theftAlertsToday: theftFlagsToday,
    liveVenues:       activeVenueSet.size,
    totalUsers:       0,
    activeUsers:      0,
    totalDevices:     totalCameras,
    onlineDevices:    0,
    offlineDevices:   0,
  });
}

// ─── Alerts ───────────────────────────────────────────────────────────────────

async function listAlerts(venueId, limit = 50) {
  // Get recent jobs with theft flags or zero-drink warnings
  const lim = Math.min(parseInt(limit), 200);
  let result;
  if (venueId) {
    result = await ddb.send(new QueryCommand({
      TableName: JOBS_TABLE,
      KeyConditionExpression: 'venueId = :v',
      ExpressionAttributeValues: { ':v': { S: venueId } },
      ScanIndexForward: false,
      Limit: lim * 3,
    }));
  } else {
    const cutoff   = Date.now() / 1000 - 30 * 86400;
    const allItems = [];
    let lastKey;
    do {
      const page = await ddb.send(new ScanCommand({
        TableName: JOBS_TABLE,
        FilterExpression: 'createdAt > :cutoff',
        ExpressionAttributeValues: { ':cutoff': { N: String(cutoff) } },
        ExclusiveStartKey: lastKey,
      }));
      allItems.push(...(page.Items ?? []));
      lastKey = page.LastEvaluatedKey;
    } while (lastKey && allItems.length < 1000);
    result = { Items: allItems };
  }

  const alerts = [];
  const now    = Date.now() / 1000;

  for (const item of result.Items ?? []) {
    const job = jobFromItem(item);

    if (job.hasTheftFlag && job.unrungDrinks > 0) {
      alerts.push({
        id:        `theft-${job.jobId}`,
        type:      'theft',
        severity:  'high',
        venueId:   job.venueId,
        title:     `Theft Alert — ${job.unrungDrinks} unrung drinks`,
        detail:    `${job.clipLabel} — ${job.unrungDrinks} drinks served without POS entry`,
        timestamp: job.finishedAt || job.createdAt,
        jobId:     job.jobId,
      });
    }

    if (job.status === 'failed') {
      alerts.push({
        id:        `fail-${job.jobId}`,
        type:      'camera_error',
        severity:  'medium',
        venueId:   job.venueId,
        title:     'Camera Job Failed',
        detail:    `${job.clipLabel} failed to process`,
        timestamp: job.createdAt,
        jobId:     job.jobId,
      });
    }
  }

  alerts.sort((a, b) => b.timestamp - a.timestamp);
  return ok({ items: alerts.slice(0, lim) });
}

// ─── Camera Discovery ─────────────────────────────────────────────────────────

async function probeCameras({ venueId, ip, port, totalChannels = 16 }) {
  if (!venueId)     return err(400, 'venueId is required — Find Cameras must run from the venue\'s own droplet so probes are sourced from the dedicated worker IP, not a shared Lambda pool');
  if (!ip || !port) return err(400, 'ip and port are required');
  const channels = Math.min(Math.max(parseInt(totalChannels) || 16, 1), 32);

  // Build the candidate camera list locally (cheap), then forward to the
  // venue's droplet for the actual HEAD probes. Bounded at 4-at-a-time on
  // the droplet side (see webhook_server.py /ops/probe-cameras) — that's
  // the IDS-safe burst we agreed on. The droplet returns the same shape
  // (`channels: [{channel, url, online}]`) the DiscoverModal already renders.
  const cameras = Array.from({ length: channels }, (_, i) => {
    const ch = i + 1;
    return {
      name:    `CH${ch}`,
      rtspUrl: `http://${ip}:${port}/hls/live/CH${ch}/0/livetop.mp4`,
    };
  });
  const upstream = await _forwardToDroplet(
    venueId,
    '/ops/probe-cameras',
    'POST',
    { cameras, throttle: 4 },
  );
  // _forwardToDroplet returns a Lambda response shape already; we want to
  // re-shape the droplet's per-camera result back into {channel, url, online}
  // for the DiscoverModal. If the droplet returned an error, surface it.
  if (upstream.statusCode !== 200) return upstream;
  let parsed;
  try { parsed = JSON.parse(upstream.body); } catch { parsed = {}; }
  const dropletResults = parsed.results || parsed.cameras || [];
  // Map back to channel-numbered shape the modal expects.
  const channelsOut = dropletResults.map((r, idx) => ({
    channel: idx + 1,
    url:     cameras[idx].rtspUrl,
    online:  !!r.ok,
  }));
  channelsOut.sort((a, b) => a.channel - b.channel);
  return ok({ channels: channelsOut, sourceDroplet: parsed.sourceDroplet || true });
}

// ─── Review queue (low-confidence event approval) ────────────────────────────
//
// Worker writes events into VenueScopeLowConfEvents when a drink / bottle /
// visit fires below its confidence threshold. Admin reviewers accept or reject.
// The authoritative per-venue totals incorporate the approved count.
//
// Schema:
//   PK   venueId     (String)
//   SK   eventId     (String, UUID)
//   Attrs:
//     jobId, cameraId, cameraName, feature, confidence (N), detectedAt (N),
//     detectedValueJson, snapshotUrl, clipUrl,
//     status ("pending" | "approved" | "rejected"),
//     reviewedBy, reviewedAt (N), reviewerNote
//   GSI status-detectedAt-index (partition=status, sort=detectedAt DESC)
//     — enables listing by status without a full scan
//
// Create the table with AWS CLI:
//   aws dynamodb create-table \
//     --table-name VenueScopeLowConfEvents \
//     --attribute-definitions \
//       AttributeName=venueId,AttributeType=S \
//       AttributeName=eventId,AttributeType=S \
//       AttributeName=status,AttributeType=S \
//       AttributeName=detectedAt,AttributeType=N \
//     --key-schema \
//       AttributeName=venueId,KeyType=HASH \
//       AttributeName=eventId,KeyType=RANGE \
//     --global-secondary-indexes \
//       "IndexName=status-detectedAt-index,KeySchema=[{AttributeName=status,KeyType=HASH},{AttributeName=detectedAt,KeyType=RANGE}],Projection={ProjectionType=ALL},BillingMode=PAY_PER_REQUEST" \
//     --billing-mode PAY_PER_REQUEST \
//     --region us-east-2

function _parseReviewItem(item) {
  const S = (a) => a?.S ?? undefined;
  const N = (a) => a?.N !== undefined ? Number(a.N) : undefined;
  return {
    eventId:          S(item.eventId),
    venueId:          S(item.venueId),
    jobId:            S(item.jobId),
    cameraId:         S(item.cameraId),
    cameraName:       S(item.cameraName),
    feature:          S(item.feature),
    confidence:       N(item.confidence) ?? 0,
    detectedAt:       N(item.detectedAt) ?? 0,
    detectedValueJson: S(item.detectedValueJson),
    snapshotUrl:      S(item.snapshotUrl),
    clipUrl:          S(item.clipUrl),
    status:           S(item.status) ?? 'pending',
    reviewedBy:       S(item.reviewedBy),
    reviewedAt:       N(item.reviewedAt),
    reviewerNote:     S(item.reviewerNote),
  };
}

async function listReviewQueue(qs) {
  const venueId = qs.venueId;
  const feature = qs.feature;
  const status  = qs.status ?? 'pending';
  const limit   = Math.min(parseInt(qs.limit || '200') || 200, 500);
  const fromTs  = qs.fromTs ? Number(qs.fromTs) : undefined;
  const toTs    = qs.toTs   ? Number(qs.toTs)   : undefined;

  try {
    let raw;
    if (venueId) {
      // Partition-scoped query on PK, filter client-side (small partitions expected)
      raw = await ddb.send(new QueryCommand({
        TableName: REVIEW_TABLE,
        KeyConditionExpression: 'venueId = :v',
        ExpressionAttributeValues: { ':v': { S: venueId } },
      }));
    } else {
      // Cross-venue → use the GSI by status
      raw = await ddb.send(new QueryCommand({
        TableName: REVIEW_TABLE,
        IndexName: 'status-detectedAt-index',
        KeyConditionExpression: '#s = :s',
        ExpressionAttributeNames:  { '#s': 'status' },
        ExpressionAttributeValues: { ':s': { S: status } },
        ScanIndexForward: false,  // newest first
        Limit: limit,
      }));
    }
    const rows = (raw.Items ?? []).map(_parseReviewItem)
      .filter(r => !feature || r.feature === feature)
      .filter(r => !status  || r.status  === status)
      .filter(r => fromTs === undefined || r.detectedAt >= fromTs)
      .filter(r => toTs   === undefined || r.detectedAt <= toTs)
      .sort((a, b) => b.detectedAt - a.detectedAt)
      .slice(0, limit);
    return ok({ events: rows, count: rows.length });
  } catch (e) {
    if (e.name === 'ResourceNotFoundException') {
      // Table hasn't been created yet → return empty queue
      return ok({ events: [], count: 0,
                  note: 'VenueScopeLowConfEvents table not yet created' });
    }
    throw e;
  }
}

async function reviewQueueStats(qs) {
  const venueId = qs.venueId;
  const fromTs  = qs.fromTs ? Number(qs.fromTs) : 0;
  const toTs    = qs.toTs   ? Number(qs.toTs)   : Math.floor(Date.now() / 1000);
  try {
    const raw = venueId
      ? await ddb.send(new QueryCommand({
          TableName: REVIEW_TABLE,
          KeyConditionExpression: 'venueId = :v',
          ExpressionAttributeValues: { ':v': { S: venueId } },
        }))
      : await ddb.send(new ScanCommand({ TableName: REVIEW_TABLE }));
    let pending = 0, approved = 0, rejected = 0;
    for (const it of (raw.Items ?? [])) {
      const r = _parseReviewItem(it);
      if (r.detectedAt < fromTs || r.detectedAt > toTs) continue;
      if      (r.status === 'pending')  pending++;
      else if (r.status === 'approved') approved++;
      else if (r.status === 'rejected') rejected++;
    }
    const judged = approved + rejected;
    return ok({
      pending, approved, rejected,
      approvalRate: judged > 0 ? approved / judged : 0,
    });
  } catch (e) {
    if (e.name === 'ResourceNotFoundException') {
      return ok({ pending: 0, approved: 0, rejected: 0, approvalRate: 0 });
    }
    throw e;
  }
}

async function reviewEvent(eventId, decision, body) {
  if (decision !== 'approved' && decision !== 'rejected') {
    return err(400, 'decision must be approved or rejected');
  }
  if (!body?.venueId) return err(400, 'venueId is required in body');
  const note      = (body.note ?? '').slice(0, 500);
  const reviewer  = (body.reviewedBy ?? 'admin').slice(0, 120);
  const ts        = Math.floor(Date.now() / 1000);
  try {
    const res = await ddb.send(new UpdateItemCommand({
      TableName: REVIEW_TABLE,
      Key: {
        venueId: { S: body.venueId },
        eventId: { S: eventId },
      },
      UpdateExpression:
        'SET #s = :s, reviewedBy = :r, reviewedAt = :t, reviewerNote = :n',
      ExpressionAttributeNames:  { '#s': 'status' },
      ExpressionAttributeValues: {
        ':s': { S: decision },
        ':r': { S: reviewer },
        ':t': { N: String(ts) },
        ':n': { S: note },
      },
      ConditionExpression: 'attribute_exists(eventId)',
      ReturnValues: 'ALL_NEW',
    }));
    return ok(_parseReviewItem(res.Attributes ?? {}));
  } catch (e) {
    if (e.name === 'ConditionalCheckFailedException') return err(404, 'Event not found');
    if (e.name === 'ResourceNotFoundException')       return err(503, 'Review table not yet created');
    throw e;
  }
}

async function reviewBulk(body) {
  const ids     = Array.isArray(body?.eventIds) ? body.eventIds.slice(0, 100) : [];
  const action  = body?.action === 'approve' ? 'approved'
                : body?.action === 'reject'  ? 'rejected' : null;
  const venueId = body?.venueId;
  if (!ids.length || !action || !venueId) {
    return err(400, 'eventIds[], action, venueId are required');
  }
  let updated = 0;
  for (const id of ids) {
    try {
      await reviewEvent(id, action, { venueId, note: body.note, reviewedBy: body.reviewedBy });
      updated++;
    } catch { /* swallow per-item failure, continue */ }
  }
  return ok({ updated });
}


// ─── Billing helpers ──────────────────────────────────────────────────────────

async function stripePost(path, params) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? `Stripe ${res.status}`);
  return data;
}

async function stripeGet(path) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? `Stripe ${res.status}`);
  return data;
}

function verifyStripeSignature(rawBody, sigHeader, secret) {
  const parts = Object.fromEntries(sigHeader.split(',').map(p => p.split('=')));
  const ts = parts.t; const sig = parts.v1;
  if (!ts || !sig) throw new Error('Missing signature parts');
  const expected = createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const bBuf = Buffer.from(sig.padEnd(expected.length, '0'), 'hex');
  if (a.length !== bBuf.length || !timingSafeEqual(a, bBuf)) throw new Error('Signature mismatch');
  if (Math.abs(Date.now() / 1000 - parseInt(ts)) > 300) throw new Error('Webhook too old');
  return JSON.parse(rawBody);
}

function billingFromItem(item) {
  if (!item) return null;
  return {
    venueId:              s(item.venueId),
    subscriptionStatus:   s(item.subscriptionStatus) || 'trial',
    stripeCustomerId:     s(item.stripeCustomerId),
    stripeSubscriptionId: s(item.stripeSubscriptionId),
    trialEndsAt:          n(item.trialEndsAt),
    currentPeriodEnd:     n(item.currentPeriodEnd),
    gracePeriodEnd:       n(item.gracePeriodEnd),
    planId:               s(item.planId),
    cancelAtPeriodEnd:    b(item.cancelAtPeriodEnd),
  };
}

async function getBillingRecord(venueId) {
  const r = await ddb.send(new GetItemCommand({ TableName: BILLING_TABLE, Key: { venueId: { S: venueId } } }));
  return billingFromItem(r.Item ?? null);
}

async function upsertBillingFields(venueId, fields) {
  const updates = []; const names = {}; const values = {};
  const setS = (k, v) => { if (v == null) return; updates.push(`#${k}=:${k}`); names[`#${k}`]=k; values[`:${k}`]={S:String(v)}; };
  const setN = (k, v) => { if (v == null) return; updates.push(`#${k}=:${k}`); names[`#${k}`]=k; values[`:${k}`]={N:String(v)}; };
  const setBl = (k, v) => { if (v == null) return; updates.push(`#${k}=:${k}`); names[`#${k}`]=k; values[`:${k}`]={BOOL:Boolean(v)}; };
  setS('subscriptionStatus',   fields.subscriptionStatus);
  setS('stripeCustomerId',     fields.stripeCustomerId);
  setS('stripeSubscriptionId', fields.stripeSubscriptionId);
  setN('trialEndsAt',          fields.trialEndsAt);
  setN('currentPeriodEnd',     fields.currentPeriodEnd);
  setN('gracePeriodEnd',       fields.gracePeriodEnd);
  setS('planId',               fields.planId);
  setBl('cancelAtPeriodEnd',   fields.cancelAtPeriodEnd);
  setN('lastSyncedAt',         Date.now() / 1000);
  if (!updates.length) return;
  await ddb.send(new UpdateItemCommand({
    TableName: BILLING_TABLE,
    Key: { venueId: { S: venueId } },
    UpdateExpression: `SET ${updates.join(',')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }));
}

async function getBillingStatus(venueId) {
  if (!venueId) return err(400, 'venueId required');
  const now = Date.now() / 1000;
  let billing = await getBillingRecord(venueId);

  if (!billing) {
    const trialEndsAt = now + TRIAL_DAYS * 86400;
    try {
      await ddb.send(new PutItemCommand({
        TableName: BILLING_TABLE,
        Item: { venueId: { S: venueId }, subscriptionStatus: { S: 'trial' }, trialEndsAt: { N: String(trialEndsAt) }, lastSyncedAt: { N: String(now) } },
        ConditionExpression: 'attribute_not_exists(venueId)',
      }));
    } catch (_) { /* already exists — race condition ok */ }
    billing = await getBillingRecord(venueId);
    billing = billing ?? { venueId, subscriptionStatus: 'trial', trialEndsAt, currentPeriodEnd: 0, gracePeriodEnd: 0, stripeCustomerId: '', stripeSubscriptionId: '', planId: '', cancelAtPeriodEnd: false };
  }

  if (billing.subscriptionStatus === 'trial' && now > billing.trialEndsAt) {
    await upsertBillingFields(venueId, { subscriptionStatus: 'trial_expired' });
    billing.subscriptionStatus = 'trial_expired';
  }

  const hasAccess =
    billing.subscriptionStatus === 'active' ||
    (billing.subscriptionStatus === 'trial' && now < billing.trialEndsAt) ||
    (billing.subscriptionStatus === 'past_due' && (billing.gracePeriodEnd ?? 0) > now);

  const trialDaysLeft = billing.subscriptionStatus === 'trial'
    ? Math.max(0, Math.ceil((billing.trialEndsAt - now) / 86400)) : 0;
  const graceDaysLeft = billing.subscriptionStatus === 'past_due' && (billing.gracePeriodEnd ?? 0) > now
    ? Math.max(0, Math.ceil(((billing.gracePeriodEnd ?? 0) - now) / 86400)) : 0;

  return ok({ ...billing, hasAccess, trialDaysLeft, graceDaysLeft });
}

async function extendTrial(body) {
  const { venueId, days } = body;
  if (!venueId) return err(400, 'venueId required');
  const d = parseInt(days ?? 14, 10);
  if (isNaN(d) || d < 1 || d > 365) return err(400, 'days must be 1–365');

  let billing = await getBillingRecord(venueId);
  const now = Date.now() / 1000;

  if (!billing) {
    // Auto-provision trial record first
    const trialEndsAt = now + d * 86400;
    await ddb.send(new PutItemCommand({
      TableName: BILLING_TABLE,
      Item: { venueId: { S: venueId }, subscriptionStatus: { S: 'trial' }, trialEndsAt: { N: String(trialEndsAt) }, lastSyncedAt: { N: String(now) } },
    }));
    return ok({ venueId, trialEndsAt, trialDaysLeft: d, extended: true });
  }

  // Extend from current expiry (or now if already expired)
  const base = Math.max(billing.trialEndsAt ?? now, now);
  const newTrialEndsAt = base + d * 86400;
  await upsertBillingFields(venueId, {
    trialEndsAt: newTrialEndsAt,
    subscriptionStatus: 'trial', // reactivate if trial_expired
  });

  const trialDaysLeft = Math.ceil((newTrialEndsAt - now) / 86400);
  return ok({ venueId, trialEndsAt: newTrialEndsAt, trialDaysLeft, extended: true });
}

async function createCheckoutSession(body) {
  const { venueId, successUrl, cancelUrl } = body;
  if (!venueId || !successUrl || !cancelUrl) return err(400, 'venueId, successUrl, cancelUrl required');
  if (!STRIPE_SECRET) return err(500, 'STRIPE_SECRET_KEY not configured on Lambda');
  if (!STRIPE_PRICE)  return err(500, 'STRIPE_PRICE_ID not configured on Lambda');

  const venueResult = await ddb.send(new GetItemCommand({ TableName: VENUES_TABLE, Key: { venueId: { S: venueId } } }));
  const ownerEmail  = venueResult.Item?.ownerEmail?.S ?? '';

  let billing = await getBillingRecord(venueId);
  let customerId = billing?.stripeCustomerId;
  if (!customerId) {
    const customer = await stripePost('/customers', { email: ownerEmail, 'metadata[venueId]': venueId });
    customerId = customer.id;
    await upsertBillingFields(venueId, { stripeCustomerId: customerId });
  }

  const session = await stripePost('/checkout/sessions', {
    mode: 'subscription',
    customer: customerId,
    'line_items[0][price]': STRIPE_PRICE,
    'line_items[0][quantity]': '1',
    success_url: successUrl,
    cancel_url: cancelUrl,
    'metadata[venueId]': venueId,
    'subscription_data[metadata][venueId]': venueId,
  });

  return ok({ url: session.url });
}

async function createPortalSession(body) {
  const { venueId, returnUrl } = body;
  if (!venueId || !returnUrl) return err(400, 'venueId, returnUrl required');
  if (!STRIPE_SECRET) return err(500, 'STRIPE_SECRET_KEY not configured on Lambda');

  const billing = await getBillingRecord(venueId);
  if (!billing?.stripeCustomerId) return err(404, 'No Stripe customer — subscribe first');

  const session = await stripePost('/billing_portal/sessions', {
    customer: billing.stripeCustomerId,
    return_url: returnUrl,
  });
  return ok({ url: session.url });
}

async function handleStripeWebhook(rawBody, sigHeader) {
  if (!STRIPE_WH_SEC) return err(500, 'STRIPE_WEBHOOK_SECRET not configured');
  let event;
  try { event = verifyStripeSignature(rawBody, sigHeader, STRIPE_WH_SEC); }
  catch (e) { return err(400, `Webhook verification failed: ${e.message}`); }

  const obj      = event.data?.object ?? {};
  const venueId  = obj.metadata?.venueId
    ?? obj.subscription_details?.metadata?.venueId
    ?? obj.lines?.data?.[0]?.metadata?.venueId;

  console.log(`Stripe event: ${event.type}, venueId: ${venueId ?? 'unknown'}`);
  if (!venueId) return ok({ received: true, skipped: 'no venueId in metadata' });

  const now = Date.now() / 1000;

  if (event.type === 'checkout.session.completed') {
    const subId = obj.subscription;
    if (subId) {
      const sub = await stripeGet(`/subscriptions/${subId}`);
      await upsertBillingFields(venueId, {
        stripeCustomerId: obj.customer, stripeSubscriptionId: subId,
        subscriptionStatus: 'active',
        currentPeriodEnd: sub.current_period_end,
        gracePeriodEnd: sub.current_period_end + 7 * 86400,
        planId: sub.items?.data?.[0]?.price?.nickname ?? 'pro',
        cancelAtPeriodEnd: sub.cancel_at_period_end,
      });
    }
  } else if (event.type === 'invoice.paid') {
    const periodEnd = obj.lines?.data?.[0]?.period?.end ?? (now + 30 * 86400);
    await upsertBillingFields(venueId, {
      subscriptionStatus: 'active', stripeCustomerId: obj.customer,
      currentPeriodEnd: periodEnd, gracePeriodEnd: periodEnd + 7 * 86400,
    });
  } else if (event.type === 'invoice.payment_failed') {
    const periodEnd = obj.lines?.data?.[0]?.period?.end ?? now;
    await upsertBillingFields(venueId, { subscriptionStatus: 'past_due', gracePeriodEnd: periodEnd + 7 * 86400 });
  } else if (event.type === 'customer.subscription.updated') {
    await upsertBillingFields(venueId, {
      subscriptionStatus: obj.status,
      currentPeriodEnd: obj.current_period_end,
      gracePeriodEnd: obj.current_period_end + 7 * 86400,
      cancelAtPeriodEnd: obj.cancel_at_period_end,
    });
  } else if (event.type === 'customer.subscription.deleted') {
    await upsertBillingFields(venueId, { subscriptionStatus: 'cancelled' });
  }

  return ok({ received: true });
}

// ─── Venue Delete ─────────────────────────────────────────────────────────────

async function deleteVenue(venueId) {
  if (!venueId) return err(400, 'venueId required');
  // Safety: never delete internal records
  if (venueId.startsWith('_')) return err(400, 'Cannot delete internal records');
  await ddb.send(new DeleteItemCommand({
    TableName: VENUES_TABLE,
    Key: { venueId: { S: venueId } },
  }));
  return ok({ success: true });
}

// ─── Cancel Job ───────────────────────────────────────────────────────────────

async function cancelJob(body) {
  const { venueId, jobId } = body;
  if (!venueId || !jobId) return err(400, 'venueId and jobId required');
  await ddb.send(new UpdateItemCommand({
    TableName: JOBS_TABLE,
    Key: { venueId: { S: venueId }, jobId: { S: jobId } },
    UpdateExpression: 'SET #s = :s, isLive = :f',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':s': { S: 'cancelled' }, ':f': { BOOL: false } },
  }));
  return ok({ success: true });
}

// ─── Generic venue settings (cross-device user-authored data) ─────────────────
//
// Feature-owned blobs live on the venue record as `settings_<key>Json` strings.
// This keeps per-venue operator data (staff roster, shifts, wage rates, report
// schedule, calibration thresholds, …) in one DDB row and crosses devices by
// default. Consumers call GET /admin/venues/:id/settings/:key and POST back.
//
// Allowed keys are explicit so a typo in the client can't shove arbitrary data
// into the venue record. Values must be JSON-serializable.

const VENUE_SETTING_KEYS = new Set([
  'staffing',        // { staff: [...], shifts: [...] }
  'hourlyRates',     // { bartender: 18, server: 15, ... }
  'reportSchedule',  // { enabled, dayOfWeek, hour, recipient }
  'calibration',     // venue-calibration.service payload
  'achievements',    // { records, streak, weeklyGoal }
]);

async function getVenueSetting(venueId, key) {
  if (!venueId || venueId.startsWith('_')) return err(400, 'invalid venueId');
  if (!VENUE_SETTING_KEYS.has(key)) return err(400, `unknown setting key: ${key}`);
  try {
    const r = await ddb.send(new GetItemCommand({
      TableName: VENUES_TABLE,
      Key: { venueId: { S: venueId } },
      ProjectionExpression: '#f',
      ExpressionAttributeNames: { '#f': `settings_${key}Json` },
    }));
    const raw = r.Item?.[`settings_${key}Json`]?.S;
    return ok({ value: raw ? JSON.parse(raw) : null });
  } catch (e) {
    return err(500, e.message);
  }
}

async function putVenueSetting(venueId, key, body) {
  if (!venueId || venueId.startsWith('_')) return err(400, 'invalid venueId');
  if (!VENUE_SETTING_KEYS.has(key)) return err(400, `unknown setting key: ${key}`);
  const value = body?.value;
  if (value === undefined) return err(400, 'body.value required');
  try {
    await ddb.send(new UpdateItemCommand({
      TableName: VENUES_TABLE,
      Key: { venueId: { S: venueId } },
      UpdateExpression: 'SET #f = :v, settingsUpdatedAt = :u',
      ExpressionAttributeNames: { '#f': `settings_${key}Json` },
      ExpressionAttributeValues: {
        ':v': { S: JSON.stringify(value) },
        ':u': { S: new Date().toISOString() },
      },
    }));
    return ok({ ok: true });
  } catch (e) {
    return err(500, e.message);
  }
}

// ─── System-scope settings (admin-authored, cross-venue) ─────────────────────
//
// For data that belongs to the platform rather than a single venue: the sales
// CRM pipeline, the admin audit log, etc. Stored on VenueScopeVenues under a
// reserved `_system_<key>_` venueId so it lives in the same row type as a
// venue — one PK namespace, no second table.
//
// Only super-admins should hit these routes. The Lambda authorizer already
// gates /admin/* paths to Cognito admins.

const SYSTEM_SETTING_KEYS = new Set([
  'crmLeads',   // Sales pipeline for multi-rep teams
  'auditLog',   // Cross-device admin action history (capped client-side at 500)
]);

async function getSystemSetting(key) {
  if (!SYSTEM_SETTING_KEYS.has(key)) return err(400, `unknown system key: ${key}`);
  try {
    const r = await ddb.send(new GetItemCommand({
      TableName: VENUES_TABLE,
      Key: { venueId: { S: `_system_${key}_` } },
    }));
    const raw = r.Item?.valueJson?.S;
    return ok({ value: raw ? JSON.parse(raw) : null });
  } catch (e) {
    return err(500, e.message);
  }
}

async function putSystemSetting(key, body) {
  if (!SYSTEM_SETTING_KEYS.has(key)) return err(400, `unknown system key: ${key}`);
  const value = body?.value;
  if (value === undefined) return err(400, 'body.value required');
  try {
    await ddb.send(new PutItemCommand({
      TableName: VENUES_TABLE,
      Item: {
        venueId:   { S: `_system_${key}_` },
        valueJson: { S: JSON.stringify(value) },
        updatedAt: { S: new Date().toISOString() },
      },
    }));
    return ok({ ok: true });
  } catch (e) {
    return err(500, e.message);
  }
}

// ─── Alert Reviews (stored in VenueScopeVenues with venueId="_alert_reviews_") ─

const REVIEWS_KEY = '_alert_reviews_';

async function getReviewedAlerts() {
  try {
    const r = await ddb.send(new GetItemCommand({
      TableName: VENUES_TABLE,
      Key: { venueId: { S: REVIEWS_KEY } },
    }));
    const raw = r.Item?.reviewedJson?.S;
    return ok({ ids: raw ? JSON.parse(raw) : [] });
  } catch (e) {
    return err(500, e.message);
  }
}

async function saveReviewedAlerts(body) {
  const { ids } = body;
  if (!Array.isArray(ids)) return err(400, 'ids array required');
  try {
    await ddb.send(new PutItemCommand({
      TableName: VENUES_TABLE,
      Item: {
        venueId:      { S: REVIEWS_KEY },
        reviewedJson: { S: JSON.stringify(ids.slice(-500)) },
        updatedAt:    { S: new Date().toISOString() },
      },
    }));
    return ok({ ok: true });
  } catch (e) {
    return err(500, e.message);
  }
}

// ─── Admin Settings (stored in VenueScopeVenues with venueId="_system_settings_") ──

const SETTINGS_KEY = '_system_settings_';

async function getAdminSettings() {
  try {
    const r = await ddb.send(new GetItemCommand({
      TableName: VENUES_TABLE,
      Key: { venueId: { S: SETTINGS_KEY } },
    }));
    const raw = r.Item?.settingsJson?.S;
    const settings = raw ? JSON.parse(raw) : {};
    return ok({ settings });
  } catch (e) {
    return err(500, e.message);
  }
}

async function saveAdminSettings(body) {
  const { settings } = body;
  if (!settings || typeof settings !== 'object') return err(400, 'settings object required');
  try {
    await ddb.send(new PutItemCommand({
      TableName: VENUES_TABLE,
      Item: {
        venueId:      { S: SETTINGS_KEY },
        settingsJson: { S: JSON.stringify(settings) },
        updatedAt:    { S: new Date().toISOString() },
      },
    }));
    return ok({ ok: true });
  } catch (e) {
    return err(500, e.message);
  }
}

// ─── Email Reporting ──────────────────────────────────────────────────────────

async function saveVenueEmailConfig(venueId, config) {
  if (!venueId || venueId.startsWith('_')) return err(400, 'invalid venueId');
  const { enabled, frequency, recipients, reportType } = config;
  if (!Array.isArray(recipients)) return err(400, 'recipients must be an array');
  try {
    await ddb.send(new UpdateItemCommand({
      TableName: VENUES_TABLE,
      Key: { venueId: { S: venueId } },
      UpdateExpression: 'SET emailConfigJson = :c',
      ExpressionAttributeValues: { ':c': { S: JSON.stringify({ enabled, frequency, recipients, reportType }) } },
    }));
    return ok({ ok: true });
  } catch (e) {
    return err(500, e.message);
  }
}

function buildReportHtml({ venueName, periodLabel, totalDrinks, drinksPerHour, theftCount, theftItems, stationBreakdown, isTest, template = {} }) {
  const tmpl = {
    introText:            template.introText            ?? '',
    showStationBreakdown: template.showStationBreakdown ?? true,
    showTheftAlerts:      template.showTheftAlerts      ?? true,
    showCTA:              template.showCTA              ?? true,
    ctaText:              template.ctaText              ?? 'View Full Report →',
    footerText:           template.footerText           ?? '',
  };

  const theftColor = theftCount > 0 ? '#f87171' : '#34d399';

  const stationRows = Object.entries(stationBreakdown)
    .sort(([, a], [, b]) => b.drinks - a.drinks)
    .map(([name, d]) => `
      <tr>
        <td style="padding:10px 12px;color:#ccc;font-size:14px;border-bottom:1px solid #1a1a1a">${name}</td>
        <td style="padding:10px 12px;color:#f59e0b;font-size:14px;font-weight:700;border-bottom:1px solid #1a1a1a">${d.drinks}</td>
        <td style="padding:10px 12px;color:#888;font-size:13px;border-bottom:1px solid #1a1a1a">${d.perHour.toFixed(1)}/hr</td>
      </tr>`)
    .join('') || '<tr><td colspan="3" style="padding:16px 12px;color:#555;font-size:13px;text-align:center">No station data for this period</td></tr>';

  const theftSection = tmpl.showTheftAlerts && theftCount > 0 ? `
    <div style="background:#1a0a0a;border:1px solid #7f1d1d;border-radius:12px;padding:20px;margin-bottom:24px">
      <h3 style="color:#f87171;margin:0 0 12px;font-size:16px">⚠️ ${theftCount} Theft Alert${theftCount !== 1 ? 's' : ''} Detected</h3>
      ${theftItems.map(j => `<div style="color:#fca5a5;font-size:13px;margin-bottom:8px">• ${j.clipLabel || 'Job'}: ${j.unrungDrinks} unrung drink${j.unrungDrinks !== 1 ? 's' : ''}</div>`).join('')}
    </div>` : '';

  const testBanner = isTest ? `
    <div style="background:#1a1200;border:1px solid #854d0e;border-radius:8px;padding:12px 16px;margin-bottom:24px;text-align:center">
      <span style="color:#fbbf24;font-size:13px;font-weight:600">TEST EMAIL — This is a preview of your report format</span>
    </div>` : '';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:600px;margin:0 auto;background:#0a0a0a">

  <div style="background:linear-gradient(135deg,#f59e0b,#ea580c);padding:32px;text-align:center">
    <div style="display:inline-block;background:rgba(0,0,0,0.2);border-radius:10px;padding:8px 16px;margin-bottom:12px">
      <span style="color:#000;font-weight:800;font-size:18px;letter-spacing:-0.5px">VS</span>
      <span style="color:rgba(0,0,0,0.7);font-weight:600;font-size:18px;margin-left:6px">VenueScope</span>
    </div>
    <h1 style="color:#000;margin:0;font-size:22px;font-weight:800">${periodLabel}</h1>
    <p style="color:rgba(0,0,0,0.65);margin:6px 0 0;font-size:15px">${venueName}</p>
  </div>

  <div style="padding:32px">
    ${testBanner}
    ${tmpl.introText ? `<p style="color:#aaa;font-size:14px;text-align:center;margin:0 0 24px">${tmpl.introText}</p>` : ''}

    <div style="display:flex;gap:12px;margin-bottom:24px">
      <div style="flex:1;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;padding:20px;text-align:center">
        <div style="font-size:36px;font-weight:800;color:#f59e0b">${totalDrinks}</div>
        <div style="font-size:11px;color:#666;margin-top:4px;text-transform:uppercase;letter-spacing:0.5px">Drinks Served</div>
      </div>
      <div style="flex:1;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;padding:20px;text-align:center">
        <div style="font-size:36px;font-weight:800;color:#f59e0b">${drinksPerHour.toFixed(1)}</div>
        <div style="font-size:11px;color:#666;margin-top:4px;text-transform:uppercase;letter-spacing:0.5px">Per Hour Avg</div>
      </div>
      <div style="flex:1;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;padding:20px;text-align:center">
        <div style="font-size:36px;font-weight:800;color:${theftColor}">${theftCount}</div>
        <div style="font-size:11px;color:#666;margin-top:4px;text-transform:uppercase;letter-spacing:0.5px">Theft Alerts</div>
      </div>
    </div>

    ${theftSection}

    ${tmpl.showStationBreakdown ? `
    <p style="color:#666;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px">Station Breakdown</p>
    <table style="width:100%;border-collapse:collapse;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;overflow:hidden">
      <tr>
        <th style="text-align:left;color:#555;font-size:11px;text-transform:uppercase;padding:10px 12px;border-bottom:1px solid #222;font-weight:600">Station</th>
        <th style="text-align:left;color:#555;font-size:11px;text-transform:uppercase;padding:10px 12px;border-bottom:1px solid #222;font-weight:600">Drinks</th>
        <th style="text-align:left;color:#555;font-size:11px;text-transform:uppercase;padding:10px 12px;border-bottom:1px solid #222;font-weight:600">Rate</th>
      </tr>
      ${stationRows}
    </table>` : ''}

    ${tmpl.showCTA ? `
    <div style="text-align:center;margin:32px 0">
      <a href="${PORTAL_URL}" style="background:linear-gradient(135deg,#f59e0b,#ea580c);color:#000;text-decoration:none;font-weight:700;padding:14px 32px;border-radius:8px;font-size:15px;display:inline-block">
        ${tmpl.ctaText}
      </a>
    </div>` : ''}
  </div>

  <div style="border-top:1px solid #1a1a1a;padding:20px 32px;text-align:center;color:#444;font-size:12px">
    VenueScope by Advizia &middot; Automated reports for ${venueName}<br>
    ${tmpl.footerText ? `<span style="color:#555">${tmpl.footerText}</span><br>` : ''}
    <a href="${PORTAL_URL}" style="color:#f59e0b">Manage report settings</a>
  </div>
</div>
</body></html>`;
}

// Read email settings + template from DDB once (used by _sendReport + previewEmail)
async function _readEmailSettings() {
  try {
    const r = await ddb.send(new GetItemCommand({ TableName: VENUES_TABLE, Key: { venueId: { S: EMAIL_SETTINGS_KEY } } }));
    return r.Item?.settingsJson?.S ? JSON.parse(r.Item.settingsJson.S) : {};
  } catch { return {}; }
}

// Append an entry to the send log in DDB
async function _appendEmailLog(entry) {
  try {
    const r = await ddb.send(new GetItemCommand({ TableName: VENUES_TABLE, Key: { venueId: { S: EMAIL_LOG_KEY } } }));
    const entries = r.Item?.logJson?.S ? JSON.parse(r.Item.logJson.S) : [];
    entries.unshift(entry);
    await ddb.send(new PutItemCommand({
      TableName: VENUES_TABLE,
      Item: {
        venueId:   { S: EMAIL_LOG_KEY },
        logJson:   { S: JSON.stringify(entries.slice(0, 500)) },
        updatedAt: { S: new Date().toISOString() },
      },
    }));
  } catch { /* never fail a send because of log error */ }
}

// Build report data for a venue (shared by _sendReport and previewEmail)
async function _buildReportData(venueId, periodDays) {
  const cutoffSec = Date.now() / 1000 - periodDays * 86400;
  const jobsRes = await ddb.send(new QueryCommand({
    TableName: JOBS_TABLE,
    KeyConditionExpression: 'venueId = :v',
    ExpressionAttributeValues: { ':v': { S: venueId } },
    ScanIndexForward: false,
    Limit: 200,
  }));
  const jobs = (jobsRes.Items ?? [])
    .map(jobFromItem)
    .filter(j => j.status === 'done' && j.createdAt >= cutoffSec);

  const totalDrinks   = jobs.reduce((s, j) => s + (j.totalDrinks ?? 0), 0);
  const ratedJobs     = jobs.filter(j => (j.drinksPerHour ?? 0) > 0);
  const drinksPerHour = ratedJobs.length
    ? ratedJobs.reduce((s, j) => s + j.drinksPerHour, 0) / ratedJobs.length : 0;
  const theftJobs     = jobs.filter(j => j.hasTheftFlag);

  const stationBreakdown = {};
  for (const job of jobs) {
    if (!job.bartenderBreakdown) continue;
    try {
      const bd = JSON.parse(job.bartenderBreakdown);
      for (const [name, d] of Object.entries(bd)) {
        if (!stationBreakdown[name]) stationBreakdown[name] = { drinks: 0, perHour: 0, _count: 0 };
        stationBreakdown[name].drinks += d.drinks || 0;
        if ((d.per_hour ?? d.perHour ?? 0) > 0) {
          stationBreakdown[name].perHour += (d.per_hour ?? d.perHour ?? 0);
          stationBreakdown[name]._count++;
        }
      }
    } catch { /* skip */ }
  }
  for (const st of Object.values(stationBreakdown)) {
    st.perHour = st._count > 0 ? st.perHour / st._count : 0;
    delete st._count;
  }

  return { jobs, totalDrinks, drinksPerHour, theftJobs, stationBreakdown };
}

async function _sendReport(venueId, periodDays, isTest = false) {
  // Get venue + email config
  const venueRes = await ddb.send(new GetItemCommand({ TableName: VENUES_TABLE, Key: { venueId: { S: venueId } } }));
  if (!venueRes.Item) throw new Error('venue not found');
  const venue = venueFromItem(venueRes.Item);
  if (!venue.emailConfig) throw new Error('no email config saved for this venue');
  if (!venue.emailConfig.recipients?.length) throw new Error('no recipients configured');

  const { totalDrinks, drinksPerHour, theftJobs, stationBreakdown } = await _buildReportData(venueId, periodDays);

  // Read settings (FROM email + template)
  const emailSettings = await _readEmailSettings();
  const fromEmail     = emailSettings.fromEmail || FROM_EMAIL;
  const templateKey   = periodDays === 1 ? 'daily' : 'weekly';
  const template      = emailSettings.templates?.[templateKey] ?? emailSettings.template ?? {};

  const periodLabel = isTest
    ? `Test Report (Last ${periodDays} Days)`
    : periodDays === 1 ? 'Daily Report — Yesterday'
    : periodDays === 7 ? 'Weekly Report — Last 7 Days'
    : `Report — Last ${periodDays} Days`;

  const html = buildReportHtml({
    venueName: venue.venueName, periodLabel, totalDrinks, drinksPerHour,
    theftCount: theftJobs.length, theftItems: theftJobs.slice(0, 5),
    stationBreakdown, isTest, template,
  });

  const subject = isTest
    ? `[TEST] VenueScope Report — ${venue.venueName}`
    : periodDays === 1
      ? `VenueScope Daily Report — ${venue.venueName}`
      : `VenueScope Weekly Report — ${venue.venueName}`;

  await ses.send(new SendEmailCommand({
    Source: fromEmail,
    Destination: { ToAddresses: venue.emailConfig.recipients },
    Message: {
      Subject: { Data: subject, Charset: 'UTF-8' },
      Body: {
        Html: { Data: html, Charset: 'UTF-8' },
        Text: { Data: `${subject}\n\nDrinks: ${totalDrinks} | Per hour: ${drinksPerHour.toFixed(1)} | Theft alerts: ${theftJobs.length}\n\n${PORTAL_URL}`, Charset: 'UTF-8' },
      },
    },
  }));

  const sentAt = new Date().toISOString();

  // Update lastSentAt + write send log (skip for test)
  if (!isTest) {
    const updated = { ...venue.emailConfig, lastSentAt: sentAt };
    await ddb.send(new UpdateItemCommand({
      TableName: VENUES_TABLE,
      Key: { venueId: { S: venueId } },
      UpdateExpression: 'SET emailConfigJson = :c',
      ExpressionAttributeValues: { ':c': { S: JSON.stringify(updated) } },
    }));
    await _appendEmailLog({
      venueId,
      venueName: venue.venueName,
      type: periodDays === 1 ? 'Daily' : periodDays === 7 ? 'Weekly' : `${periodDays}d`,
      recipients: venue.emailConfig.recipients,
      subject,
      sentAt,
      totalDrinks,
      theftAlerts: theftJobs.length,
      status: 'sent',
    });
  }

  return { sent: venue.emailConfig.recipients.length, subject, totalDrinks, theftAlerts: theftJobs.length };
}

async function getEmailLog(venueId) {
  try {
    const r = await ddb.send(new GetItemCommand({ TableName: VENUES_TABLE, Key: { venueId: { S: EMAIL_LOG_KEY } } }));
    const entries = r.Item?.logJson?.S ? JSON.parse(r.Item.logJson.S) : [];
    const filtered = venueId ? entries.filter(e => e.venueId === venueId) : entries;
    return ok({ entries: filtered.slice(0, 100) });
  } catch (e) {
    return err(500, e.message);
  }
}

async function getEmailTemplate() {
  try {
    const s = await _readEmailSettings();
    return ok({ templates: s.templates ?? { daily: {}, weekly: {} } });
  } catch (e) {
    return err(500, e.message);
  }
}

async function saveEmailTemplate(body) {
  const { type, template } = body;
  if (!type || !template || typeof template !== 'object') return err(400, 'type and template required');
  if (!['daily', 'weekly'].includes(type)) return err(400, 'type must be daily or weekly');
  try {
    const existing = await _readEmailSettings();
    const templates = existing.templates ?? { daily: {}, weekly: {} };
    templates[type] = template;
    await ddb.send(new PutItemCommand({
      TableName: VENUES_TABLE,
      Item: {
        venueId:      { S: EMAIL_SETTINGS_KEY },
        settingsJson: { S: JSON.stringify({ ...existing, templates }) },
        updatedAt:    { S: new Date().toISOString() },
      },
    }));
    return ok({ ok: true });
  } catch (e) {
    return err(500, e.message);
  }
}

async function previewEmail(body) {
  const { venueId, periodDays = 7 } = body;
  if (!venueId) return err(400, 'venueId required');
  try {
    const venueRes = await ddb.send(new GetItemCommand({ TableName: VENUES_TABLE, Key: { venueId: { S: venueId } } }));
    const venue = venueRes.Item ? venueFromItem(venueRes.Item) : { venueName: venueId };

    const { totalDrinks, drinksPerHour, theftJobs, stationBreakdown } = await _buildReportData(venueId, periodDays);
    const emailSettings = await _readEmailSettings();
    const templateKey   = periodDays === 1 ? 'daily' : 'weekly';
    const template      = emailSettings.templates?.[templateKey] ?? {};

    const periodLabel = periodDays === 1 ? 'Daily Report — Yesterday' : 'Weekly Report — Last 7 Days';
    const html = buildReportHtml({
      venueName: venue.venueName, periodLabel, totalDrinks, drinksPerHour,
      theftCount: theftJobs.length, theftItems: theftJobs.slice(0, 5),
      stationBreakdown, isTest: true, template,
    });
    return ok({ html });
  } catch (e) {
    return err(500, e.message);
  }
}

async function sendReportNow(body) {
  const { venueId, periodDays = 1 } = body;
  if (!venueId) return err(400, 'venueId required');
  try {
    const result = await _sendReport(venueId, periodDays, false);
    return ok(result);
  } catch (e) {
    return err(500, e.message);
  }
}

async function sendTestReport(body) {
  const { venueId } = body;
  if (!venueId) return err(400, 'venueId required');
  try {
    const result = await _sendReport(venueId, 7, true);
    return ok(result);
  } catch (e) {
    return err(500, e.message);
  }
}

async function runScheduledReports() {
  const now        = new Date();
  const dayOfWeek  = now.getUTCDay();  // 0=Sun, 1=Mon
  const dayOfMonth = now.getUTCDate();
  const errors     = [];
  let   sent       = 0;

  const result = await ddb.send(new ScanCommand({ TableName: VENUES_TABLE }));
  for (const item of result.Items ?? []) {
    if (s(item.venueId).startsWith('_')) continue;
    const configRaw = item.emailConfigJson?.S;
    if (!configRaw) continue;
    let config;
    try { config = JSON.parse(configRaw); } catch { continue; }
    if (!config.enabled || !config.recipients?.length) continue;

    const venueId = s(item.venueId);
    let   days    = 0;
    if      (config.frequency === 'daily')                   days = 1;
    else if (config.frequency === 'weekly'  && dayOfWeek  === 1) days = 7;
    else if (config.frequency === 'monthly' && dayOfMonth === 1) days = 30;
    if (!days) continue;

    try {
      await _sendReport(venueId, days, false);
      sent++;
    } catch (e) {
      errors.push(`${venueId}: ${e.message}`);
    }
  }

  return { statusCode: 200, body: JSON.stringify({ sent, errors }) };
}

// ─── Email Global Settings + SES + EventBridge ────────────────────────────────

async function getEmailGlobalSettings() {
  // Read stored settings
  let settings = {};
  try {
    const r = await ddb.send(new GetItemCommand({ TableName: VENUES_TABLE, Key: { venueId: { S: EMAIL_SETTINGS_KEY } } }));
    if (r.Item?.settingsJson?.S) settings = JSON.parse(r.Item.settingsJson.S);
  } catch { /* use defaults */ }

  const fromEmail = settings.fromEmail || FROM_EMAIL;

  // Check SES verification status
  let senderVerified = false;
  let senderStatus   = 'NotStarted';
  try {
    const sesRes = await ses.send(new GetIdentityVerificationAttributesCommand({ Identities: [fromEmail] }));
    const attr   = sesRes.VerificationAttributes?.[fromEmail];
    senderStatus   = attr?.VerificationStatus ?? 'NotStarted';
    senderVerified = senderStatus === 'Success';
  } catch { /* SES check failed — IAM may not have ses:GetIdentityVerificationAttributes yet */ }

  // Check EventBridge rule status + parse schedule details
  let scheduleEnabled    = false;
  let scheduleExpression = EMAIL_SCHEDULE_EXPR;
  let scheduleHourET     = 6;
  let scheduleDayOfWeek  = null; // null = daily, 0-6 = day of week (0=Sun)
  try {
    const rulesRes = await eventsClient.send(new ListRulesCommand({ NamePrefix: EMAIL_SCHEDULE_RULE }));
    const rule     = (rulesRes.Rules ?? []).find(r => r.Name === EMAIL_SCHEDULE_RULE);
    scheduleEnabled    = rule?.State === 'ENABLED';
    if (rule?.ScheduleExpression) {
      scheduleExpression = rule.ScheduleExpression;
      // Parse cron(MIN HOUR DOM MONTH DOW YEAR)
      const m = scheduleExpression.match(/cron\((\d+)\s+(\d+)\s+(\S+)\s+\S+\s+(\S+)/);
      if (m) {
        const utcHour = parseInt(m[2]);
        scheduleHourET    = (utcHour + 19) % 24; // UTC→ET (UTC-5)
        const dowStr      = m[4];
        scheduleDayOfWeek = dowStr === '?' ? null : parseInt(dowStr) - 1; // EB 1=Sun→0, 2=Mon→1
      }
    }
  } catch { /* EventBridge check failed — IAM may not have events:ListRules yet */ }

  return ok({ fromEmail, senderVerified, senderStatus, scheduleEnabled, scheduleExpression, scheduleHourET, scheduleDayOfWeek });
}

async function saveEmailGlobalSettings(body) {
  const { fromEmail } = body;
  if (!fromEmail || !fromEmail.includes('@')) return err(400, 'valid fromEmail required');
  try {
    let existing = {};
    try {
      const r = await ddb.send(new GetItemCommand({ TableName: VENUES_TABLE, Key: { venueId: { S: EMAIL_SETTINGS_KEY } } }));
      if (r.Item?.settingsJson?.S) existing = JSON.parse(r.Item.settingsJson.S);
    } catch { /* ignore */ }
    await ddb.send(new PutItemCommand({
      TableName: VENUES_TABLE,
      Item: {
        venueId:      { S: EMAIL_SETTINGS_KEY },
        settingsJson: { S: JSON.stringify({ ...existing, fromEmail }) },
        updatedAt:    { S: new Date().toISOString() },
      },
    }));
    return ok({ ok: true });
  } catch (e) {
    return err(500, e.message);
  }
}

async function verifySenderEmail(body) {
  const { email } = body;
  if (!email || !email.includes('@')) return err(400, 'valid email required');
  try {
    await ses.send(new VerifyEmailIdentityCommand({ EmailAddress: email }));
    return ok({ ok: true, message: `Verification email sent to ${email} — click the link in your inbox to complete.` });
  } catch (e) {
    return err(500, e.message);
  }
}

async function checkSenderStatus(email) {
  if (!email) return err(400, 'email query param required');
  try {
    const res  = await ses.send(new GetIdentityVerificationAttributesCommand({ Identities: [email] }));
    const attr = res.VerificationAttributes?.[email];
    const status   = attr?.VerificationStatus ?? 'NotStarted';
    return ok({ email, status, verified: status === 'Success' });
  } catch (e) {
    return err(500, e.message);
  }
}

function buildCronExpr(hourET, dayOfWeek) {
  const utcHour = (hourET + 5) % 24;
  if (dayOfWeek !== null && dayOfWeek !== undefined) {
    const ebDay = dayOfWeek + 1; // JS 0=Sun→EB 1=SUN, JS 1=Mon→EB 2=MON
    return `cron(0 ${utcHour} ? * ${ebDay} *)`;
  }
  return `cron(0 ${utcHour} * * ? *)`;
}

async function enableAutoSchedule(body) {
  const { hourET = 6, dayOfWeek = null } = body;
  const scheduleExpression = buildCronExpr(hourET, dayOfWeek);
  if (!_lambdaArn) return err(500, 'Lambda ARN unavailable — try again');
  try {
    await eventsClient.send(new PutRuleCommand({
      Name:               EMAIL_SCHEDULE_RULE,
      ScheduleExpression: scheduleExpression,
      State:              'ENABLED',
      Description:        'VenueScope automated email reports',
    }));
    await eventsClient.send(new PutTargetsCommand({
      Rule:    EMAIL_SCHEDULE_RULE,
      Targets: [{ Id: 'VenueScopeLambdaTarget', Arn: _lambdaArn }],
    }));
    // Grant EventBridge permission to invoke this Lambda
    const accountId = _lambdaArn.split(':')[4];
    const sourceArn = `arn:aws:events:${REGION}:${accountId}:rule/${EMAIL_SCHEDULE_RULE}`;
    try {
      await lambdaClient.send(new AddPermissionCommand({
        FunctionName: _lambdaArn,
        StatementId:  'VenueScopeEventBridgeEmailReports',
        Action:       'lambda:InvokeFunction',
        Principal:    'events.amazonaws.com',
        SourceArn:    sourceArn,
      }));
    } catch (e) {
      if (!e.message?.includes('already exists')) throw e;
    }
    return ok({ ok: true, scheduleExpression });
  } catch (e) {
    return err(500, `Schedule failed: ${e.message}`);
  }
}

async function disableAutoSchedule() {
  try {
    try { await eventsClient.send(new RemoveTargetsCommand({ Rule: EMAIL_SCHEDULE_RULE, Ids: ['VenueScopeLambdaTarget'] })); } catch { /* ok */ }
    try { await eventsClient.send(new DeleteRuleCommand({ Name: EMAIL_SCHEDULE_RULE })); } catch { /* ok */ }
    try {
      await lambdaClient.send(new RemovePermissionCommand({
        FunctionName: _lambdaArn || process.env.AWS_LAMBDA_FUNCTION_NAME,
        StatementId:  'VenueScopeEventBridgeEmailReports',
      }));
    } catch { /* ok */ }
    return ok({ ok: true });
  } catch (e) {
    return err(500, e.message);
  }
}

// ─── Worker Tester (admin-only NVR replay) ────────────────────────────────────
//
// Item shape in VenueScopeTestRuns:
//   runId            (PK, string, UUID)
//   venueId          (string)
//   createdAt        (ISO8601 string)
//   createdBy        (string, email)
//   replayDate       (string, "YYYY-MM-DD")
//   replayStartTime  (string, "HH:MM" 24-hr venue-local)
//   replayEndTime    (string, "HH:MM")
//   replayTimezone   (string, IANA, e.g. "America/New_York")
//   pauseLiveCams    (bool, pause production camera_loop jobs during this run)
//   cameras          (JSON list: [{cameraId, cameraName, features:[...], groundTruth:{...}}])
//   status           ("pending" | "running" | "complete" | "failed")
//   progress         (number, 0-100)
//   startedAt        (ISO string)
//   completedAt      (ISO string)
//   errorMessage     (string)
//   liveCounts       (JSON map, updated by worker each cycle)
//   results          (JSON map, set on completion: { perFeature, overallGrade, stabilityGrade, notes })
//   workerHealth     (JSON map: { peakCpu, peakRss, droppedFrames, errorCount, restarts })

function _parseTestRunItem(item) {
  if (!item) return null;
  const parseJson = (raw) => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } };
  return {
    runId:           s(item.runId),
    venueId:         s(item.venueId),
    createdAt:       s(item.createdAt),
    createdBy:       s(item.createdBy),
    replayDate:      s(item.replayDate),
    replayStartTime: s(item.replayStartTime),
    replayEndTime:   s(item.replayEndTime),
    replayTimezone:  s(item.replayTimezone) || 'America/New_York',
    pauseLiveCams:   b(item.pauseLiveCams),
    cameras:         parseJson(s(item.camerasJson))     || [],
    status:          s(item.status) || 'pending',
    progress:        n(item.progress),
    startedAt:       s(item.startedAt),
    completedAt:     s(item.completedAt),
    errorMessage:    s(item.errorMessage),
    liveCounts:      parseJson(s(item.liveCountsJson))  || {},
    results:         parseJson(s(item.resultsJson))     || null,
    workerHealth:    parseJson(s(item.workerHealthJson))|| null,
  };
}

async function listTestRuns(qs) {
  const venueId = qs.venueId;
  const limit   = Math.min(Number(qs.limit) || 50, 200);
  try {
    const raw = venueId
      ? await ddb.send(new ScanCommand({
          TableName: TEST_RUNS_TABLE,
          FilterExpression: 'venueId = :v',
          ExpressionAttributeValues: { ':v': { S: venueId } },
        }))
      : await ddb.send(new ScanCommand({ TableName: TEST_RUNS_TABLE }));
    const items = (raw.Items ?? []).map(_parseTestRunItem).filter(Boolean);
    items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return ok({ runs: items.slice(0, limit), count: items.length });
  } catch (e) {
    if (e.name === 'ResourceNotFoundException') {
      return ok({ runs: [], count: 0, note: 'VenueScopeTestRuns table not yet created' });
    }
    throw e;
  }
}

async function getTestRun(runId) {
  if (!runId) return err(400, 'runId required');
  try {
    const r = await ddb.send(new GetItemCommand({
      TableName: TEST_RUNS_TABLE,
      Key: { runId: { S: runId } },
    }));
    if (!r.Item) return err(404, 'Test run not found');
    return ok(_parseTestRunItem(r.Item));
  } catch (e) {
    if (e.name === 'ResourceNotFoundException') return err(503, 'Test runs table not yet created');
    throw e;
  }
}

async function createTestRun(body) {
  if (!body?.venueId)          return err(400, 'venueId is required');
  if (!body?.replayDate)       return err(400, 'replayDate is required (YYYY-MM-DD)');
  if (!body?.replayStartTime)  return err(400, 'replayStartTime is required (HH:MM)');
  if (!body?.replayEndTime)    return err(400, 'replayEndTime is required (HH:MM)');
  if (!Array.isArray(body?.cameras) || !body.cameras.length) {
    return err(400, 'cameras must be a non-empty array');
  }
  // Lightweight UUID v4 — Lambda runtime has no built-in randomUUID guarantee
  // for older Node versions. crypto.randomUUID() is available on Node 14.17+.
  const { randomUUID } = await import('crypto');
  const runId     = randomUUID();
  const createdAt = new Date().toISOString();
  const createdBy = (body.createdBy ?? 'admin').slice(0, 200);
  try {
    await ddb.send(new PutItemCommand({
      TableName: TEST_RUNS_TABLE,
      Item: {
        runId:           { S: runId },
        venueId:         { S: String(body.venueId) },
        createdAt:       { S: createdAt },
        createdBy:       { S: createdBy },
        replayDate:      { S: String(body.replayDate) },
        replayStartTime: { S: String(body.replayStartTime) },
        replayEndTime:   { S: String(body.replayEndTime) },
        replayTimezone:  { S: String(body.replayTimezone || 'America/New_York') },
        pauseLiveCams:   { BOOL: !!body.pauseLiveCams },
        camerasJson:     { S: JSON.stringify(body.cameras) },
        status:          { S: 'pending' },
        progress:        { N: '0' },
      },
    }));
    return ok({ runId, status: 'pending', createdAt });
  } catch (e) {
    if (e.name === 'ResourceNotFoundException') return err(503, 'Test runs table not yet created — run setup');
    throw e;
  }
}

async function updateTestRunStatus(runId, body) {
  if (!runId) return err(400, 'runId required');
  const sets = [];
  const names  = {};
  const values = {};
  if (typeof body?.status === 'string') {
    sets.push('#st = :st');
    names['#st']  = 'status';
    values[':st'] = { S: body.status };
  }
  if (typeof body?.progress === 'number') {
    sets.push('progress = :p');
    values[':p'] = { N: String(body.progress) };
  }
  if (typeof body?.startedAt === 'string') {
    sets.push('startedAt = :sa');
    values[':sa'] = { S: body.startedAt };
  }
  if (typeof body?.completedAt === 'string') {
    sets.push('completedAt = :ca');
    values[':ca'] = { S: body.completedAt };
  }
  if (typeof body?.errorMessage === 'string') {
    sets.push('errorMessage = :em');
    values[':em'] = { S: body.errorMessage.slice(0, 2000) };
  }
  if (!sets.length) return err(400, 'no fields to update');
  try {
    const res = await ddb.send(new UpdateItemCommand({
      TableName: TEST_RUNS_TABLE,
      Key: { runId: { S: runId } },
      UpdateExpression: 'SET ' + sets.join(', '),
      ExpressionAttributeNames:  Object.keys(names).length ? names : undefined,
      ExpressionAttributeValues: values,
      ConditionExpression: 'attribute_exists(runId)',
      ReturnValues: 'ALL_NEW',
    }));
    return ok(_parseTestRunItem(res.Attributes ?? {}));
  } catch (e) {
    if (e.name === 'ConditionalCheckFailedException') return err(404, 'Test run not found');
    if (e.name === 'ResourceNotFoundException')       return err(503, 'Test runs table not yet created');
    throw e;
  }
}

async function appendTestRunResults(runId, body) {
  if (!runId) return err(400, 'runId required');
  const sets   = [];
  const values = {};
  if (body?.liveCounts && typeof body.liveCounts === 'object') {
    sets.push('liveCountsJson = :lc');
    values[':lc'] = { S: JSON.stringify(body.liveCounts).slice(0, 380000) };
  }
  if (body?.results && typeof body.results === 'object') {
    sets.push('resultsJson = :r');
    values[':r'] = { S: JSON.stringify(body.results).slice(0, 380000) };
  }
  if (body?.workerHealth && typeof body.workerHealth === 'object') {
    sets.push('workerHealthJson = :wh');
    values[':wh'] = { S: JSON.stringify(body.workerHealth).slice(0, 380000) };
  }
  if (!sets.length) return err(400, 'one of liveCounts | results | workerHealth required');
  try {
    const res = await ddb.send(new UpdateItemCommand({
      TableName: TEST_RUNS_TABLE,
      Key: { runId: { S: runId } },
      UpdateExpression: 'SET ' + sets.join(', '),
      ExpressionAttributeValues: values,
      ConditionExpression: 'attribute_exists(runId)',
      ReturnValues: 'ALL_NEW',
    }));
    return ok(_parseTestRunItem(res.Attributes ?? {}));
  } catch (e) {
    if (e.name === 'ConditionalCheckFailedException') return err(404, 'Test run not found');
    if (e.name === 'ResourceNotFoundException')       return err(503, 'Test runs table not yet created');
    throw e;
  }
}

async function getSnapshotUrl(qs) {
  const key = qs?.key;
  if (!key) return err(400, 'key parameter required');
  // Sanity guard — only mint URLs for keys in our snapshots namespace
  if (key.includes('..') || key.startsWith('/')) {
    return err(400, 'invalid key');
  }
  try {
    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: SNAPSHOTS_BUCKET, Key: key }),
      { expiresIn: 3600 },  // 1 hr
    );
    return ok({ url });
  } catch (e) {
    return err(500, `presign failed: ${e.message}`);
  }
}


async function deleteTestRun(runId) {
  if (!runId) return err(400, 'runId required');
  try {
    await ddb.send(new DeleteItemCommand({
      TableName: TEST_RUNS_TABLE,
      Key: { runId: { S: runId } },
    }));
    return ok({ runId, deleted: true });
  } catch (e) {
    if (e.name === 'ResourceNotFoundException') return ok({ runId, deleted: true });
    throw e;
  }
}

// ─── POS receipts + accuracy reconciliation ─────────────────────────────────
//
// "95% accurate" is unverifiable without ground truth. This is the ground
// truth: per-shift POS-rung totals uploaded by the venue operator, compared
// against the worker's detected counts to produce A-F accuracy grades the
// admin Accuracy SLA dashboard reads.
//
// DDB schema (VenueScopePosReceipts):
//   PK: venueId (S)        e.g. "theblindgoat"
//   SK: shiftStartIso (S)  e.g. "2026-04-26T19:30:00-04:00"
//   attrs: shiftEndIso (S), posDrinkCount (N), posBottleCount (N),
//          uploadedAt (S), uploadedBy (S), source (S)  // csv|manual|pos-api
//
// Worker count aggregation (read-side):
//   Query VenueScopeJobs by venueId where finished_at falls in the window,
//   sum each job's drink_count + bottle_count from summary_json.
//
// Routes:
//   POST   /admin/venues/{id}/pos-receipts        ← CSV body, multi-row
//   GET    /admin/venues/{id}/pos-receipts        ← list (?limit=50)
//   DELETE /admin/venues/{id}/pos-receipts/{iso}  ← remove a single shift
//   GET    /admin/venues/{id}/accuracy?from=&to=  ← reconciliation results

const POS_CSV_REQUIRED = ['shift_start_iso', 'shift_end_iso', 'drink_count'];

function _parseCsv(csvText) {
  // Tiny CSV parser. Handles quoted fields, commas in quotes, CRLF lines.
  // Returns { headers: [...], rows: [{col: val, ...}] }.
  const lines = csvText.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let headers = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const cells = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQ = false;
        else cur += ch;
      } else {
        if (ch === '"') inQ = true;
        else if (ch === ',') { cells.push(cur); cur = ''; }
        else cur += ch;
      }
    }
    cells.push(cur);
    if (!headers) {
      headers = cells.map(h => h.trim().toLowerCase());
    } else {
      const row = {};
      headers.forEach((h, i) => { row[h] = (cells[i] ?? '').trim(); });
      out.push(row);
    }
  }
  return { headers: headers ?? [], rows: out };
}

function _gradeFromErrorPct(err) {
  if (err <= 0.05) return 'A';
  if (err <= 0.15) return 'B';
  if (err <= 0.25) return 'C';
  if (err <= 0.50) return 'D';
  return 'F';
}

async function uploadPosReceipts(venueId, body, headers = {}) {
  if (!venueId) return err(400, 'venueId required');
  // Body is either:
  //   - raw CSV text (when Content-Type: text/csv)
  //   - JSON { csv: "..." } from the admin UI
  //   - JSON { receipts: [{shift_start_iso, ...}] } for direct manual entry
  let csvText = null;
  let receipts = null;
  if (typeof body === 'string') {
    csvText = body;
  } else if (body && typeof body === 'object') {
    if (typeof body.csv === 'string') csvText = body.csv;
    else if (Array.isArray(body.receipts)) receipts = body.receipts;
  }
  if (!csvText && !receipts) {
    return err(400, 'send a CSV body (Content-Type: text/csv) or '
                  + '{csv: "..."} JSON or {receipts: [...]} JSON');
  }

  let parsed = [];
  if (csvText) {
    const { headers: hdrs, rows } = _parseCsv(csvText);
    const missing = POS_CSV_REQUIRED.filter(c => !hdrs.includes(c));
    if (missing.length) {
      return err(400, `CSV missing required columns: ${missing.join(', ')} `
                    + `(found: ${hdrs.join(', ')})`);
    }
    parsed = rows;
  } else {
    parsed = receipts.map(r => ({
      shift_start_iso: String(r.shift_start_iso || r.shiftStartIso || ''),
      shift_end_iso:   String(r.shift_end_iso   || r.shiftEndIso   || ''),
      drink_count:     String(r.drink_count     ?? r.drinkCount     ?? ''),
      bottle_count:    String(r.bottle_count    ?? r.bottleCount    ?? ''),
    }));
  }

  // Validate + write each row
  const uploadedAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const uploadedBy = String(body?.uploadedBy || 'admin');
  const written = [];
  const skipped = [];
  for (const r of parsed) {
    const startIso = (r.shift_start_iso || '').trim();
    const endIso   = (r.shift_end_iso   || '').trim();
    const drinkN   = Number(r.drink_count);
    if (!startIso || !endIso || !Number.isFinite(drinkN) || drinkN < 0) {
      skipped.push({ row: r, reason: 'invalid required fields' });
      continue;
    }
    const item = {
      venueId:        { S: venueId },
      shiftStartIso:  { S: startIso },
      shiftEndIso:    { S: endIso },
      posDrinkCount:  { N: String(Math.floor(drinkN)) },
      uploadedAt:     { S: uploadedAt },
      uploadedBy:     { S: uploadedBy },
      source:         { S: 'csv' },
    };
    const bottleStr = (r.bottle_count || '').trim();
    if (bottleStr && bottleStr.toLowerCase() !== 'none' && bottleStr.toLowerCase() !== 'null') {
      const b = Number(bottleStr);
      if (Number.isFinite(b) && b >= 0) item.posBottleCount = { N: String(Math.floor(b)) };
    }
    try {
      await ddb.send(new PutItemCommand({ TableName: POS_TABLE, Item: item }));
      written.push({ shiftStartIso: startIso, drinks: drinkN });
    } catch (e) {
      if (e.name === 'ResourceNotFoundException') {
        return err(503, `${POS_TABLE} table doesn't exist yet. Create with: `
          + `aws dynamodb create-table --table-name ${POS_TABLE} `
          + `--attribute-definitions AttributeName=venueId,AttributeType=S `
          + `AttributeName=shiftStartIso,AttributeType=S `
          + `--key-schema AttributeName=venueId,KeyType=HASH `
          + `AttributeName=shiftStartIso,KeyType=RANGE `
          + `--billing-mode PAY_PER_REQUEST --region us-east-2`);
      }
      skipped.push({ row: r, reason: `${e.name}: ${e.message}` });
    }
  }
  return ok({
    venueId,
    written: written.length,
    skipped: skipped.length,
    receipts: written,
    errors:   skipped,
  });
}

async function listPosReceipts(venueId, qs = {}) {
  if (!venueId) return err(400, 'venueId required');
  const limit = Math.min(parseInt(qs.limit || '500', 10), 1000);
  try {
    const res = await ddb.send(new QueryCommand({
      TableName: POS_TABLE,
      KeyConditionExpression: 'venueId = :v',
      ExpressionAttributeValues: { ':v': { S: venueId } },
      ScanIndexForward: false,  // most recent shifts first
      Limit: limit,
    }));
    const items = (res.Items ?? []).map(it => ({
      venueId:         it.venueId?.S,
      shiftStartIso:   it.shiftStartIso?.S,
      shiftEndIso:     it.shiftEndIso?.S,
      posDrinkCount:   Number(it.posDrinkCount?.N || 0),
      posBottleCount:  it.posBottleCount?.N ? Number(it.posBottleCount.N) : null,
      uploadedAt:      it.uploadedAt?.S,
      uploadedBy:      it.uploadedBy?.S,
      source:          it.source?.S,
    }));
    return ok({ venueId, count: items.length, receipts: items });
  } catch (e) {
    if (e.name === 'ResourceNotFoundException')
      return ok({ venueId, count: 0, receipts: [], note: `${POS_TABLE} not yet created` });
    throw e;
  }
}

async function deletePosReceipt(venueId, shiftStartIso) {
  if (!venueId || !shiftStartIso) return err(400, 'venueId + shiftStartIso required');
  try {
    await ddb.send(new DeleteItemCommand({
      TableName: POS_TABLE,
      Key: { venueId: { S: venueId }, shiftStartIso: { S: shiftStartIso } },
    }));
    return ok({ venueId, shiftStartIso, deleted: true });
  } catch (e) {
    if (e.name === 'ResourceNotFoundException')
      return ok({ venueId, shiftStartIso, deleted: true });
    throw e;
  }
}

async function _aggregateWorkerCounts(venueId, fromIso, toIso) {
  // Sum drink_count + bottle_count from VenueScopeJobs whose finished_at
  // falls in the window. The worker pushes per-segment job records with
  // summary_json containing the counts; we sum across all cameras for the
  // venue and the window.
  //
  // Note: VenueScopeJobs schema uses createdAt and finishedAt (ISO strings).
  // We filter by createdAt within the window (start of segment).
  const fromMs = new Date(fromIso).getTime();
  const toMs   = new Date(toIso).getTime();
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs))
    throw new Error(`Invalid window: from=${fromIso} to=${toIso}`);

  let drinks  = 0;
  let bottles = 0;
  let jobs    = 0;
  let lastEvaluatedKey = undefined;

  do {
    const res = await ddb.send(new ScanCommand({
      TableName: JOBS_TABLE,
      FilterExpression: 'venueId = :v AND createdAt BETWEEN :a AND :b',
      ExpressionAttributeValues: {
        ':v': { S: venueId },
        ':a': { S: fromIso },
        ':b': { S: toIso },
      },
      ExclusiveStartKey: lastEvaluatedKey,
    }));
    for (const item of (res.Items ?? [])) {
      jobs++;
      const sjStr = item.summary_json?.S;
      if (!sjStr) continue;
      try {
        const sj = JSON.parse(sjStr);
        const d = Number(sj.drink_count ?? sj.today_drinks ?? 0);
        const b = Number(sj.bottle_count ?? 0);
        if (Number.isFinite(d)) drinks  += Math.max(0, d);
        if (Number.isFinite(b)) bottles += Math.max(0, b);
      } catch { /* corrupt summary_json — skip */ }
    }
    lastEvaluatedKey = res.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return { drinks, bottles, jobs };
}

async function getAccuracy(venueId, qs = {}) {
  if (!venueId) return err(400, 'venueId required');
  const fromIso = qs.from || qs.shiftStartIso;
  const toIso   = qs.to   || qs.shiftEndIso;

  // Pull all POS receipts for this venue (or filter by window if from/to given)
  let receipts = [];
  try {
    const res = await ddb.send(new QueryCommand({
      TableName: POS_TABLE,
      KeyConditionExpression: 'venueId = :v',
      ExpressionAttributeValues: { ':v': { S: venueId } },
      ScanIndexForward: false,
      Limit: 1000,
    }));
    receipts = (res.Items ?? []).map(it => ({
      shiftStartIso: it.shiftStartIso?.S,
      shiftEndIso:   it.shiftEndIso?.S,
      drinks:        Number(it.posDrinkCount?.N || 0),
      bottles:       it.posBottleCount?.N ? Number(it.posBottleCount.N) : null,
    }));
  } catch (e) {
    if (e.name !== 'ResourceNotFoundException') throw e;
  }

  // Optional window filter
  if (fromIso) receipts = receipts.filter(r => r.shiftStartIso >= fromIso);
  if (toIso)   receipts = receipts.filter(r => r.shiftEndIso   <= toIso);

  // Reconcile each shift against worker counts
  const results = [];
  for (const r of receipts) {
    const wc = await _aggregateWorkerCounts(venueId, r.shiftStartIso, r.shiftEndIso);
    const expected = Math.max(0, r.drinks);
    const errPct = expected > 0 ? Math.abs(wc.drinks - expected) / expected : 0;
    const grade  = expected > 0 ? _gradeFromErrorPct(errPct) : 'n/a';
    const notes  = [];
    if (expected === 0 && wc.drinks > 0) {
      notes.push(`FALSE_POSITIVES: POS shows 0 drinks but worker detected ${wc.drinks}`);
    } else if (expected > 0 && wc.drinks < expected * 0.7) {
      notes.push(`UNDER_COUNT: detected ${wc.drinks} of ${expected} (-${Math.round((1 - wc.drinks/expected) * 100)}%)`);
    } else if (expected > 0 && wc.drinks > expected * 1.3) {
      notes.push(`OVER_COUNT: detected ${wc.drinks} of ${expected} (+${Math.round((wc.drinks/expected - 1) * 100)}%)`);
    }

    const rec = {
      shiftStartIso:    r.shiftStartIso,
      shiftEndIso:      r.shiftEndIso,
      detectedDrinks:   wc.drinks,
      expectedDrinks:   expected,
      drinkErrorPct:    Math.round(errPct * 1000) / 1000,
      drinkGrade:       grade,
      jobsAggregated:   wc.jobs,
      notes,
    };
    if (r.bottles !== null && r.bottles !== undefined) {
      const expB  = Math.max(0, r.bottles);
      const errB  = expB > 0 ? Math.abs(wc.bottles - expB) / expB : 0;
      rec.detectedBottles = wc.bottles;
      rec.expectedBottles = expB;
      rec.bottleErrorPct  = Math.round(errB * 1000) / 1000;
      rec.bottleGrade     = expB > 0 ? _gradeFromErrorPct(errB) : 'n/a';
    }
    results.push(rec);
  }

  // Roll up
  let totalExpected = 0, totalDetected = 0;
  for (const r of results) {
    totalExpected += r.expectedDrinks;
    totalDetected += r.detectedDrinks;
  }
  const overallErr   = totalExpected > 0
    ? Math.abs(totalDetected - totalExpected) / totalExpected : 0;
  const overallGrade = totalExpected > 0 ? _gradeFromErrorPct(overallErr) : 'n/a';

  return ok({
    venueId,
    from:           fromIso || null,
    to:             toIso   || null,
    shifts:         results,
    overall: {
      shiftsCompared: results.length,
      detectedDrinks: totalDetected,
      expectedDrinks: totalExpected,
      drinkErrorPct:  Math.round(overallErr * 1000) / 1000,
      drinkGrade:     overallGrade,
    },
  });
}

// ─── Per-venue droplet provisioning (DigitalOcean) ────────────────────────────
//
// Self-service automation for the per-venue droplet model. When the admin
// clicks "Provision Droplet" in the venue settings UI, this Lambda calls
// the DO API to clone a new droplet from the master snapshot, injects
// `VS_VENUE_ID=<venueId>` via cloud-init user-data, and stores the droplet
// metadata on the venue's DDB record. Total wall time: ~3-5 min.
//
// Required env vars (set in Lambda console):
//   DO_API_TOKEN          DigitalOcean Personal Access Token, full access scope
//   DO_SNAPSHOT_ID        DO snapshot ID to clone from (e.g. 226490598).
//                         Take a fresh snapshot any time the worker code or
//                         dependencies change materially.
//   DO_DEFAULT_REGION     Default region for new venue droplets (e.g. tor1)
//   DO_DEFAULT_SIZE       Default plan slug (e.g. c-2 for CPU-Optimized 2/4)
//   DO_DEFAULT_SSH_KEY_ID Numeric ID of the operator SSH key to attach
//
// DDB schema additions on VenueScopeVenues records:
//   dropletId       (N)  DO droplet numeric ID
//   dropletStatus   (S)  provisioning | active | failed | none
//   dropletIp       (S)  public IPv4 (filled in once the droplet is up)
//   dropletRegion   (S)  e.g. tor1
//   provisionedAt   (S)  ISO timestamp

const DO_API_BASE = 'https://api.digitalocean.com/v2';

async function _doApi(path, opts = {}) {
  const token = process.env.DO_API_TOKEN;
  if (!token) {
    const e = new Error('DO_API_TOKEN env var not set on Lambda — '
      + 'generate a token at https://cloud.digitalocean.com/account/api/tokens '
      + 'and add it to this Lambda\'s environment variables.');
    e._userVisible = true;
    throw e;
  }
  const res = await fetch(`${DO_API_BASE}${path}`, {
    ...opts,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    const msg = json.message || json.id || `DO API ${res.status}`;
    const e = new Error(`DO API: ${msg}`);
    e._status = res.status;
    e._body   = json;
    throw e;
  }
  return json;
}

function _userDataForVenue(venueId) {
  // cloud-init user-data: runs once on first boot. Sets VS_VENUE_ID in the
  // worker's .env, restarts the worker, and the venue-affinity filter (in
  // worker_daemon.py) automatically scopes all DDB queries to this venue.
  // Also rewrites the Caddyfile site hostname from the master snapshot's
  // baked-in `<old-ip>.sslip.io` to this droplet's own
  // `<new-ip-with-dashes>.sslip.io` so the per-venue ops-proxy in the admin
  // Lambda can reach `https://<this-ip>-with-dashes.sslip.io/ops/...` and
  // hit the right Caddy site block. Without this, every new droplet would
  // share the master's hostname and Caddy would fail TLS handshake on the
  // mismatched IP.
  return `#!/bin/bash
set -e
ENV_FILE=/opt/venuescope/venuescope/.env
VENUE_ID=${JSON.stringify(venueId)}
if grep -q '^VS_VENUE_ID=' "$ENV_FILE" 2>/dev/null; then
  sed -i "s/^VS_VENUE_ID=.*/VS_VENUE_ID=$VENUE_ID/" "$ENV_FILE"
else
  echo "VS_VENUE_ID=$VENUE_ID" >> "$ENV_FILE"
fi
# Rewrite Caddyfile to this droplet's own sslip.io hostname so the admin
# Lambda's per-venue ops proxy can reach it on a valid TLS cert.
PUB_IP=$(curl -s --max-time 5 http://169.254.169.254/metadata/v1/interfaces/public/0/ipv4/address || true)
if [ -n "$PUB_IP" ] && [ -f /etc/caddy/Caddyfile ]; then
  NEW_HOST=$(echo "$PUB_IP" | tr '.' '-').sslip.io
  # Replace the FIRST <something>.sslip.io occurrence (the site label on
  # line 1) with this droplet's own hostname. Other sslip.io references
  # inside reverse_proxy stanzas stay untouched.
  sed -i "0,/[0-9-]\\+\\.sslip\\.io/{s|[0-9-]\\+\\.sslip\\.io|$NEW_HOST|}" /etc/caddy/Caddyfile
  systemctl reload caddy 2>/dev/null || systemctl restart caddy 2>/dev/null || true
fi
# Re-enable the worker (snapshot may have been taken with worker disabled)
systemctl enable venuescope-worker venuescope-worker-nightly-restart.timer venuescope-worker-3am-restart.timer 2>/dev/null || true
systemctl start venuescope-worker-nightly-restart.timer venuescope-worker-3am-restart.timer 2>/dev/null || true
# Tester orchestrator: only the dedicated tester host runs it; new per-venue
# production droplets should not have it active.
systemctl stop    venuescope-test-runner 2>/dev/null || true
systemctl disable venuescope-test-runner 2>/dev/null || true
# Restart worker with the new VS_VENUE_ID picked up
systemctl restart venuescope-worker || true
`;
}

async function provisionDroplet(venueId, body = {}) {
  if (!venueId) return err(400, 'venueId required');

  // Read current venue record so we can refuse re-provisioning over an
  // existing live droplet (protects against accidental double-spend).
  const ven = await ddb.send(new GetItemCommand({
    TableName: VENUES_TABLE,
    Key: { venueId: { S: venueId } },
  }));
  if (!ven.Item) return err(404, `venue ${venueId} not found`);
  const existingStatus = ven.Item?.dropletStatus?.S;
  if (existingStatus === 'provisioning' || existingStatus === 'active') {
    return err(409, `venue ${venueId} already has a droplet `
      + `(status=${existingStatus}, id=${ven.Item?.dropletId?.N}). `
      + `Destroy it first via DELETE /admin/venues/${venueId}/droplet, `
      + `or use force=true to override.`);
  }

  const snapshotId = String(body.snapshotId || process.env.DO_SNAPSHOT_ID || '');
  const region     = String(body.region   || process.env.DO_DEFAULT_REGION || 'tor1');
  const size       = String(body.size     || process.env.DO_DEFAULT_SIZE   || 'c-2');
  const sshKeyId   = body.sshKeyId        || process.env.DO_DEFAULT_SSH_KEY_ID;
  if (!snapshotId)   return err(500, 'DO_SNAPSHOT_ID env var not set');
  if (!sshKeyId)     return err(500, 'DO_DEFAULT_SSH_KEY_ID env var not set');

  const name = `worker-${venueId}`;
  const userData = _userDataForVenue(venueId);

  let created;
  try {
    created = await _doApi('/droplets', {
      method: 'POST',
      body: JSON.stringify({
        name,
        region,
        size,
        image: Number(snapshotId),
        ssh_keys: [Number(sshKeyId)],
        backups: false,
        ipv6: false,
        monitoring: true,
        tags: [`venue:${venueId}`, 'role:production-worker', 'managed-by:lambda'],
        user_data: userData,
      }),
    });
  } catch (e) {
    return err(e._status || 500, e.message || 'DO provision failed');
  }

  const droplet = created.droplet || {};
  const provisionedAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

  // Stamp venue record with droplet metadata. IP fills in later once the
  // droplet is fully booted (poll via GET /admin/venues/{id}/droplet).
  await ddb.send(new UpdateItemCommand({
    TableName: VENUES_TABLE,
    Key: { venueId: { S: venueId } },
    UpdateExpression: 'SET dropletId = :id, dropletStatus = :st, '
                    + 'dropletRegion = :rg, dropletSize = :sz, '
                    + 'provisionedAt = :ts',
    ExpressionAttributeValues: {
      ':id': { N: String(droplet.id) },
      ':st': { S: 'provisioning' },
      ':rg': { S: region },
      ':sz': { S: size },
      ':ts': { S: provisionedAt },
    },
  }));

  return ok({
    venueId,
    dropletId:     droplet.id,
    dropletStatus: 'provisioning',
    dropletRegion: region,
    dropletSize:   size,
    name:          droplet.name,
    provisionedAt,
    note: 'Droplet is booting. Poll GET /admin/venues/{id}/droplet for status + IP.',
  });
}

async function getDroplet(venueId) {
  if (!venueId) return err(400, 'venueId required');
  const ven = await ddb.send(new GetItemCommand({
    TableName: VENUES_TABLE,
    Key: { venueId: { S: venueId } },
  }));
  if (!ven.Item) return err(404, `venue ${venueId} not found`);
  const it = ven.Item;
  const dropletId = Number(it?.dropletId?.N || 0);
  if (!dropletId) {
    return ok({ venueId, dropletStatus: 'none' });
  }
  // DDB-cached values become the fallback when the DO API isn't reachable —
  // either because DO_API_TOKEN isn't set yet or DO is having an outage. The
  // admin UI still shows the wired droplet's id/IP/region/size from our own
  // record so operators aren't blocked on a missing env var.
  const cached = {
    venueId,
    dropletId,
    dropletStatus: it?.dropletStatus?.S || 'unknown',
    dropletIp:     it?.dropletIp?.S     || '',
    dropletRegion: it?.dropletRegion?.S || '',
    dropletSize:   it?.dropletSize?.S   || '',
    provisionedAt: it?.provisionedAt?.S || '',
  };

  // Try to fetch live state from DO. If we don't have a token or DO returns
  // an error, fall back to the cached row instead of 500-ing the UI.
  let live;
  try {
    live = await _doApi(`/droplets/${dropletId}`);
  } catch (e) {
    return ok({
      ...cached,
      doApiError: e.message || 'DO lookup failed',
    });
  }
  const d = live.droplet || {};
  const v4 = (d.networks?.v4 || []).find(n => n.type === 'public')?.ip_address || '';
  const status = d.status === 'active' ? 'active' : (d.status || 'unknown');

  // Update DDB if IP just landed
  if (v4 && (it?.dropletIp?.S || '') !== v4) {
    await ddb.send(new UpdateItemCommand({
      TableName: VENUES_TABLE,
      Key: { venueId: { S: venueId } },
      UpdateExpression: 'SET dropletIp = :ip, dropletStatus = :st',
      ExpressionAttributeValues: {
        ':ip': { S: v4 },
        ':st': { S: status },
      },
    }));
  }

  return ok({
    venueId,
    dropletId,
    dropletStatus: status,
    dropletIp:     v4 || cached.dropletIp,
    dropletRegion: it?.dropletRegion?.S || '',
    dropletSize:   it?.dropletSize?.S   || '',
    provisionedAt: it?.provisionedAt?.S || '',
    name:          d.name,
  });
}

// ─── Per-venue droplet ops proxy ─────────────────────────────────────────────
//
// Historical: every /ops/* call (probe-cameras, restart-worker, deploy,
// cam-proxy, auto-detect-zones, …) hit a single shared droplet URL stored in
// VITE_CALIBRATION_URL. That doesn't scale: one venue's IDS-flagged IP would
// taint every other venue's calls, and per-venue worker actions all came from
// the same egress pool.
//
// New routing: every /ops/* call goes through THIS Lambda first. The Lambda
// reads the venue's dropletIp from VenueScopeVenues, refuses if the droplet
// isn't `active`, then forwards to that venue's own droplet at
// `https://<ip-with-dashes>.sslip.io<path>` (Caddy on each droplet auto-issues
// a Let's Encrypt cert for its sslip.io hostname). Result: each venue's
// network operations are sourced from its own droplet, IDS bans contained.

async function _venueDropletInfo(venueId) {
  // Reads droplet status + IP straight from DDB (no DO API call).
  // We use the cached row because routing decisions need to be fast and
  // tolerant of DO outages — once dropletIp is stamped on first boot, it
  // doesn't change unless the droplet is destroyed/recreated.
  const ven = await ddb.send(new GetItemCommand({
    TableName: VENUES_TABLE,
    Key: { venueId: { S: venueId } },
  }));
  if (!ven.Item) return { found: false };
  return {
    found:  true,
    status: ven.Item?.dropletStatus?.S || 'none',
    ip:     ven.Item?.dropletIp?.S     || '',
  };
}

function _dropletOpsUrl(dropletIp, path) {
  // Caddy on each droplet listens on the sslip.io hostname matching its IP
  // (e.g. 137.184.61.178 → 137-184-61-178.sslip.io). Auto-issued TLS cert.
  // Falls through to the existing /ops/*, /webhook, /forecast/* etc. routes.
  const host = dropletIp.replaceAll('.', '-') + '.sslip.io';
  const p    = path.startsWith('/') ? path : '/' + path;
  return `https://${host}${p}`;
}

async function _forwardToDroplet(venueId, path, method = 'GET', body = undefined) {
  if (!venueId)      return err(400, 'venueId required for ops routing');
  if (!path)         return err(400, 'path required');
  const opsSecret = process.env.OPS_SECRET || '';
  if (!opsSecret) return err(500, 'OPS_SECRET env var not set on Lambda — '
    + 'ops-proxy cannot authenticate to droplets without it.');

  const info = await _venueDropletInfo(venueId);
  if (!info.found) return err(404, `venue ${venueId} not found`);
  if (info.status !== 'active') {
    return err(409, `venue ${venueId} droplet is ${info.status || 'none'}; `
      + `provision droplet first before any /ops/* call`);
  }
  if (!info.ip) {
    return err(409, `venue ${venueId} has no dropletIp on file (cache miss); `
      + `wait for provisioning to complete or call GET /admin/venues/${venueId}/droplet to refresh`);
  }

  const url = _dropletOpsUrl(info.ip, path);
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Ops-Secret': opsSecret,
      },
      body: body && method !== 'GET' ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    return err(502, `droplet ${info.ip} unreachable: ${e.message || e.name}`);
  }
  clearTimeout(timer);
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  return { statusCode: res.status, headers: cors, body: JSON.stringify(data) };
}

async function opsProxy(body) {
  // Generic forwarder: caller picks the path + method + body and we hand it
  // off to the venue's droplet untouched. Used by the frontend `opsFetch`
  // helper to route every /ops/* call per-venue without needing a separate
  // Lambda route per endpoint.
  const { venueId, path, method = 'GET', body: subBody } = (body || {});
  return _forwardToDroplet(venueId, path, method, subBody);
}

// ─── Switch-Droplet feature ──────────────────────────────────────────────────
//
// Lets the admin migrate a venue between droplets without losing camera or
// zone configs (which live in DDB on per-camera records, droplet-agnostic).
// Three modes: (a) provision-new, (b) resize-in-place (same IP), (c) pull
// from junk pool. Reachability gate prevents flipping DDB until the operator
// has updated the venue router's NVR allowlist for the new IP.
//
// Junk pool model: a droplet is "in junk" if its DO tag set includes
// `venuescope-parked`. We use DO tags as the source of truth so we don't
// need a separate DDB table. Listing the pool = filter DO droplets by tag.

const PARKED_TAG = 'venuescope-parked';

async function _doListAllDroplets() {
  // DO API caps responses at 200 droplets per page; we paginate to be safe.
  // For our scale (1 droplet per venue + a small junk pool), 1 page is plenty.
  const all = [];
  let page = 1;
  while (page <= 5) {                                  // hard cap = 1000
    const r = await _doApi(`/droplets?per_page=200&page=${page}`);
    const items = r.droplets || [];
    all.push(...items);
    if (items.length < 200) break;
    page += 1;
  }
  return all;
}

async function _venuesByDropletId() {
  // Map dropletId → venue record so we can flag which droplets are assigned.
  const r = await ddb.send(new ScanCommand({
    TableName:                 VENUES_TABLE,
    ProjectionExpression:      'venueId, venueName, dropletId, dropletStatus',
  }));
  const byId = new Map();
  for (const it of r.Items || []) {
    const did = Number(it?.dropletId?.N || 0);
    if (did) byId.set(did, {
      venueId:       s(it.venueId),
      venueName:     s(it.venueName),
      dropletStatus: s(it.dropletStatus),
    });
  }
  return byId;
}

async function listDroplets() {
  // GET /admin/droplets — returns every DO droplet we own, labelled with the
  // venue it's assigned to (or "junk" if parked, "orphan" if no venue points
  // at it and it lacks the parked tag — that's a state we treat as a soft
  // warning so the operator can park or destroy it cleanly).
  let droplets;
  try {
    droplets = await _doListAllDroplets();
  } catch (e) {
    return err(502, `DO API: ${e.message}`);
  }
  const byId = await _venuesByDropletId();
  const rows = droplets.map(d => {
    const v4    = (d.networks?.v4 || []).find(n => n.type === 'public')?.ip_address || '';
    const tags  = d.tags || [];
    const venue = byId.get(d.id);
    let role;
    if (venue)                       role = 'assigned';
    else if (tags.includes(PARKED_TAG)) role = 'junk';
    else                              role = 'orphan';
    // Approximate $/mo from the size slug — DO doesn't include price on the
    // droplet object itself, so we map common slugs. Anything unknown
    // displays as "?" in the UI; the admin can still see the slug.
    const sizePrice = {
      's-1vcpu-1gb':   6,   's-2vcpu-2gb':   18,
      's-2vcpu-4gb':   24,  's-4vcpu-8gb':   48,
      's-4vcpu-8gb-amd': 56, 's-8vcpu-16gb': 96,
      'c-2':           42,  'c-4':           84,
      'g-2vcpu-8gb':   63,  'gd-2vcpu-8gb':  78,
    };
    return {
      dropletId:     d.id,
      name:          d.name,
      status:        d.status,
      sizeSlug:      d.size_slug,
      monthlyUsd:    sizePrice[d.size_slug] ?? null,
      region:        d.region?.slug || '',
      regionName:    d.region?.name || '',
      ip:            v4,
      tags,
      role,                     // 'assigned' | 'junk' | 'orphan'
      assignedVenueId:   venue?.venueId   || null,
      assignedVenueName: venue?.venueName || null,
      // Full specs from DO so the admin Droplet Pool page can show it all
      // without further API calls. memory is MB, disk is GB.
      vcpus:         d.vcpus    || 0,
      memoryMb:      d.memory   || 0,
      diskGb:        d.disk     || 0,
      kernel:        d.kernel?.name || '',
      image:         d.image?.distribution
                       ? `${d.image.distribution} ${d.image.name || ''}`.trim()
                       : (d.image?.slug || ''),
      backupsEnabled: !!d.backup_ids?.length,
      monitoring:    !!d.features?.includes('monitoring'),
      createdAt:     d.created_at,
    };
  });
  // Newest first — fits the admin's mental model when scanning the pool.
  rows.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const totalMonthly = rows
    .filter(r => r.monthlyUsd != null)
    .reduce((s, r) => s + r.monthlyUsd, 0);
  return ok({
    droplets:     rows,
    counts: {
      total:    rows.length,
      assigned: rows.filter(r => r.role === 'assigned').length,
      junk:     rows.filter(r => r.role === 'junk').length,
      orphan:   rows.filter(r => r.role === 'orphan').length,
    },
    monthlyUsd:   totalMonthly,
  });
}

function _isVenueOpenNow(venueItem) {
  // Read business hours JSON off the venue record. Falls back to "closed"
  // when the field is missing — i.e. switch is allowed by default since
  // there's no shift to interrupt. The business hours JSON shape is the
  // same one Staffing.tsx + Forecast.tsx read.
  const hours = venueItem?.businessHoursJson?.S
              ? JSON.parse(venueItem.businessHoursJson.S) : null;
  if (!hours) return false;
  const tz = venueItem?.timezone?.S || 'America/New_York';
  const now = new Date();
  const local = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  const day   = ['sun','mon','tue','wed','thu','fri','sat'][local.getDay()];
  const span  = hours[day];
  if (!span || span.closed) return false;
  // span.open / span.close are HH:MM strings; close < open means "next-day"
  // (e.g. open 21:00, close 02:00). Handle that wrap.
  const cur = local.getHours()*60 + local.getMinutes();
  const [oh, om] = (span.open  || '00:00').split(':').map(Number);
  const [ch, cm] = (span.close || '00:00').split(':').map(Number);
  const o = oh*60 + om, c = ch*60 + cm;
  return c >= o ? (cur >= o && cur < c) : (cur >= o || cur < c);
}

async function parkDroplet(dropletId) {
  // POST /admin/droplets/{id}/park — moves a droplet to the junk pool:
  //   1. Stop+disable the worker (via /ops/park)
  //   2. Tag it with venuescope-parked in DO
  //   3. Clear venue.dropletId/dropletIp on whichever venue currently
  //      points at it (so the venue is in a 'no droplet' state).
  if (!dropletId) return err(400, 'dropletId required');
  const opsSecret = process.env.OPS_SECRET || '';
  if (!opsSecret) return err(500, 'OPS_SECRET not set on Lambda');

  let droplet;
  try { droplet = (await _doApi(`/droplets/${dropletId}`)).droplet; }
  catch (e) { return err(502, `DO API: ${e.message}`); }
  const ip = (droplet.networks?.v4 || []).find(n => n.type === 'public')?.ip_address;
  if (!ip) return err(409, 'droplet has no public IP yet');

  // Stop the worker on the droplet (ignore failure — droplet might be off).
  try {
    await fetch(_dropletOpsUrl(ip, '/ops/park'), {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-Ops-Secret': opsSecret },
      body:    '{}',
    });
  } catch (e) {
    // Non-fatal: tag it parked anyway so it shows up in junk pool. Operator
    // can manually re-park later if the droplet was offline.
    console.warn(`park: worker stop failed for ${ip}: ${e.message}`);
  }

  // Tag in DO
  try {
    await _doApi('/tags', { method: 'POST', body: JSON.stringify({ name: PARKED_TAG }) });
  } catch (e) { /* tag may already exist; ignore */ }
  try {
    await _doApi(`/tags/${PARKED_TAG}/resources`, {
      method: 'POST',
      body:   JSON.stringify({
        resources: [{ resource_id: String(dropletId), resource_type: 'droplet' }],
      }),
    });
  } catch (e) {
    return err(502, `DO tag failed: ${e.message}`);
  }

  // Clear venue → droplet pointer if any venue currently references this droplet.
  const byId = await _venuesByDropletId();
  const owner = byId.get(Number(dropletId));
  if (owner?.venueId) {
    await ddb.send(new UpdateItemCommand({
      TableName:        VENUES_TABLE,
      Key:              { venueId: { S: owner.venueId } },
      UpdateExpression: 'REMOVE dropletId, dropletIp, dropletRegion, dropletSize, provisionedAt SET dropletStatus = :st',
      ExpressionAttributeValues: { ':st': { S: 'none' } },
    }));
  }

  return ok({ ok: true, dropletId, ip, parkedFromVenue: owner?.venueId || null });
}

async function assignDroplet(dropletId, body) {
  // POST /admin/droplets/{id}/assign — pulls a droplet out of the junk pool
  // and binds it to a venue. Calls the droplet's /ops/set-venue endpoint to
  // update VS_VENUE_ID + restart worker; updates the venue's DDB record;
  // removes the venuescope-parked tag.
  const venueId = body?.venueId;
  if (!dropletId) return err(400, 'dropletId required');
  if (!venueId)   return err(400, 'venueId required in body');
  const opsSecret = process.env.OPS_SECRET || '';
  if (!opsSecret) return err(500, 'OPS_SECRET not set on Lambda');

  // Verify venue exists + is not already pointing at a different droplet.
  const ven = await ddb.send(new GetItemCommand({
    TableName: VENUES_TABLE, Key: { venueId: { S: venueId } },
  }));
  if (!ven.Item) return err(404, `venue ${venueId} not found`);
  const existingDid = Number(ven.Item?.dropletId?.N || 0);
  if (existingDid && existingDid !== Number(dropletId)) {
    return err(409, `venue ${venueId} already has droplet ${existingDid}; `
      + `use POST /admin/venues/${venueId}/switch-droplet to migrate`);
  }

  // Look up droplet IP from DO
  let droplet;
  try { droplet = (await _doApi(`/droplets/${dropletId}`)).droplet; }
  catch (e) { return err(502, `DO API: ${e.message}`); }
  const ip = (droplet.networks?.v4 || []).find(n => n.type === 'public')?.ip_address;
  if (!ip) return err(409, 'droplet has no public IP');

  // Tell the droplet to re-bind
  let setRes;
  try {
    setRes = await fetch(_dropletOpsUrl(ip, '/ops/set-venue'), {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-Ops-Secret': opsSecret },
      body:    JSON.stringify({ venueId }),
    });
  } catch (e) {
    return err(502, `droplet ${ip} unreachable for set-venue: ${e.message}`);
  }
  if (!setRes.ok) {
    const txt = await setRes.text();
    return err(502, `droplet rejected set-venue: ${setRes.status} ${txt}`);
  }

  // Untag from junk pool
  try {
    await _doApi(`/tags/${PARKED_TAG}/resources`, {
      method: 'DELETE',
      body:   JSON.stringify({
        resources: [{ resource_id: String(dropletId), resource_type: 'droplet' }],
      }),
    });
  } catch (e) { /* tag may not have existed; non-fatal */ }

  // Stamp the venue with the new droplet
  await ddb.send(new UpdateItemCommand({
    TableName:        VENUES_TABLE,
    Key:              { venueId: { S: venueId } },
    UpdateExpression: 'SET dropletId = :id, dropletIp = :ip, dropletStatus = :st, '
                    + 'dropletRegion = :rg, dropletSize = :sz, provisionedAt = :pa',
    ExpressionAttributeValues: {
      ':id': { N: String(dropletId) },
      ':ip': { S: ip },
      ':st': { S: 'active' },
      ':rg': { S: droplet.region?.slug || '' },
      ':sz': { S: droplet.size_slug    || '' },
      ':pa': { S: new Date().toISOString() },
    },
  }));

  return ok({ ok: true, venueId, dropletId, ip,
              msg: 'droplet assigned to venue; worker re-bound + restarted' });
}

async function testDropletReachability(dropletId, body) {
  // POST /admin/droplets/{id}/test-reachability — calls the droplet's
  // /ops/probe-cameras with a single channel from the venue's NVR. Used by
  // the Switch Droplet flow as a green-light gate before flipping DDB.
  const { ip, port, totalChannels = 1 } = body || {};
  if (!dropletId)  return err(400, 'dropletId required');
  if (!ip || !port) return err(400, 'NVR ip + port required in body');
  const opsSecret = process.env.OPS_SECRET || '';
  if (!opsSecret) return err(500, 'OPS_SECRET not set on Lambda');

  let droplet;
  try { droplet = (await _doApi(`/droplets/${dropletId}`)).droplet; }
  catch (e) { return err(502, `DO API: ${e.message}`); }
  const dropIp = (droplet.networks?.v4 || []).find(n => n.type === 'public')?.ip_address;
  if (!dropIp) return err(409, 'droplet has no public IP');

  const channels = Math.min(Math.max(parseInt(totalChannels) || 1, 1), 4);
  const cameras = Array.from({ length: channels }, (_, i) => ({
    name:    `CH${i + 1}`,
    rtspUrl: `http://${ip}:${port}/hls/live/CH${i + 1}/0/livetop.mp4`,
  }));
  let res;
  try {
    res = await fetch(_dropletOpsUrl(dropIp, '/ops/probe-cameras'), {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-Ops-Secret': opsSecret },
      body:    JSON.stringify({ cameras }),
    });
  } catch (e) {
    return err(502, `droplet ${dropIp} unreachable: ${e.message}`);
  }
  const txt = await res.text();
  let data; try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
  if (!res.ok) return err(502, `droplet probe failed: ${res.status} ${txt}`);
  const results = data.results || [];
  const anyOk   = results.some(r => r.ok);
  return ok({
    ok:           anyOk,
    sourceDropletIp: dropIp,
    targetNvr:    `${ip}:${port}`,
    channels:     results,
    msg: anyOk
      ? 'reachable — at least one channel responded; safe to flip DDB'
      : 'NOT reachable — add new droplet IP to venue router NVR allowlist, then retry',
  });
}

async function switchDroplet(venueId, body) {
  // POST /admin/venues/{id}/switch-droplet — orchestrates the migration.
  // Modes:
  //   (a) {mode:"provision", size, region}        → spin up new droplet
  //   (b) {mode:"resize",    size}                → resize current in place
  //   (c) {mode:"reassign",  dropletId}           → pull from junk pool
  // The reachability gate is a SEPARATE call (test-reachability), so this
  // route is the "begin migration" trigger and the actual flip happens after
  // the operator confirms reachability via that call. We update DDB as part
  // of the switch since reachability has already been verified by the caller.
  if (!venueId) return err(400, 'venueId required');
  const mode = (body?.mode || '').toLowerCase();
  if (!['provision','resize','reassign'].includes(mode)) {
    return err(400, "mode must be one of: 'provision', 'resize', 'reassign'");
  }

  // Open-hours guard
  const ven = await ddb.send(new GetItemCommand({
    TableName: VENUES_TABLE, Key: { venueId: { S: venueId } },
  }));
  if (!ven.Item) return err(404, `venue ${venueId} not found`);
  if (_isVenueOpenNow(ven.Item) && !body?.force) {
    return err(423, 'venue is in business hours; pass {"force":true} to override');
  }

  if (mode === 'provision') {
    // Just delegate to existing provisionDroplet — but it normally refuses if
    // there's an existing droplet, so we have to detach the venue first.
    // The OLD droplet's fate is decided by a follow-up call (park / move / destroy).
    const oldDropletId = Number(ven.Item?.dropletId?.N || 0);
    const oldIp        = ven.Item?.dropletIp?.S || '';
    await ddb.send(new UpdateItemCommand({
      TableName:        VENUES_TABLE,
      Key:              { venueId: { S: venueId } },
      UpdateExpression: 'REMOVE dropletId, dropletIp, dropletRegion, dropletSize, provisionedAt SET dropletStatus = :st',
      ExpressionAttributeValues: { ':st': { S: 'none' } },
    }));
    const provisioned = await provisionDroplet(venueId, body);
    if (provisioned.statusCode !== 200) {
      // Restore old assignment so we don't leave the venue in a half-detached
      // state if provisioning fails.
      if (oldDropletId) {
        await ddb.send(new UpdateItemCommand({
          TableName:        VENUES_TABLE,
          Key:              { venueId: { S: venueId } },
          UpdateExpression: 'SET dropletId = :id, dropletIp = :ip, dropletStatus = :st',
          ExpressionAttributeValues: {
            ':id': { N: String(oldDropletId) }, ':ip': { S: oldIp }, ':st': { S: 'active' },
          },
        }));
      }
      return provisioned;
    }
    const data = JSON.parse(provisioned.body);
    return ok({
      ok:                true,
      mode:              'provision',
      newDropletId:      data.dropletId,
      oldDropletId:      oldDropletId || null,
      oldDropletIp:      oldIp || null,
      msg:               'new droplet provisioning; once status=active, call test-reachability before relying on it. Use POST /admin/droplets/{oldId}/park or DELETE to dispose of the old droplet.',
    });
  }

  if (mode === 'resize') {
    // DO API: power-off + resize + power-on. IP is preserved.
    const dropletId = Number(ven.Item?.dropletId?.N || 0);
    if (!dropletId) return err(409, 'venue has no current droplet to resize');
    const newSize = body?.size;
    if (!newSize) return err(400, "size required (e.g. 's-4vcpu-8gb')");
    try {
      await _doApi(`/droplets/${dropletId}/actions`, {
        method: 'POST',
        body:   JSON.stringify({ type: 'power_off' }),
      });
      // We don't poll here — DO actions are async. Frontend should poll
      // GET /admin/venues/{id}/droplet for status until 'off', then call
      // this route again. To keep the API simple we kick off the resize
      // optimistically and let DO queue actions.
      await _doApi(`/droplets/${dropletId}/actions`, {
        method: 'POST',
        body:   JSON.stringify({ type: 'resize', disk: false, size: newSize }),
      });
      await _doApi(`/droplets/${dropletId}/actions`, {
        method: 'POST',
        body:   JSON.stringify({ type: 'power_on' }),
      });
      // Stamp the new size on the venue
      await ddb.send(new UpdateItemCommand({
        TableName:        VENUES_TABLE,
        Key:              { venueId: { S: venueId } },
        UpdateExpression: 'SET dropletSize = :sz',
        ExpressionAttributeValues: { ':sz': { S: newSize } },
      }));
      return ok({ ok: true, mode: 'resize', dropletId, newSize,
                  msg: 'resize queued (power-off + resize + power-on). Same IP. Worker auto-starts on boot.' });
    } catch (e) {
      return err(502, `DO resize failed: ${e.message}`);
    }
  }

  if (mode === 'reassign') {
    const newDropletId = body?.dropletId;
    if (!newDropletId) return err(400, 'dropletId required for reassign mode');
    // Detach venue from old droplet, then assign new.
    const oldDropletId = Number(ven.Item?.dropletId?.N || 0);
    const oldIp        = ven.Item?.dropletIp?.S || '';
    if (oldDropletId) {
      await ddb.send(new UpdateItemCommand({
        TableName:        VENUES_TABLE,
        Key:              { venueId: { S: venueId } },
        UpdateExpression: 'REMOVE dropletId, dropletIp, dropletRegion, dropletSize, provisionedAt SET dropletStatus = :st',
        ExpressionAttributeValues: { ':st': { S: 'none' } },
      }));
    }
    const assigned = await assignDroplet(newDropletId, { venueId });
    if (assigned.statusCode !== 200) {
      // Best-effort restore the old assignment
      if (oldDropletId) {
        await ddb.send(new UpdateItemCommand({
          TableName:        VENUES_TABLE,
          Key:              { venueId: { S: venueId } },
          UpdateExpression: 'SET dropletId = :id, dropletIp = :ip, dropletStatus = :st',
          ExpressionAttributeValues: {
            ':id': { N: String(oldDropletId) }, ':ip': { S: oldIp }, ':st': { S: 'active' },
          },
        }));
      }
      return assigned;
    }
    const data = JSON.parse(assigned.body);
    return ok({
      ok:           true,
      mode:         'reassign',
      newDropletId: data.dropletId,
      newDropletIp: data.ip,
      oldDropletId: oldDropletId || null,
      oldDropletIp: oldIp || null,
      msg:          'venue reassigned; old droplet awaits disposition. Use park/destroy/reassign.',
    });
  }

  return err(500, 'unreachable');
}

async function destroyOrphanDroplet(dropletId) {
  // DELETE /admin/droplets/{id} — for orphan / junk droplets only. Refuses
  // to destroy a droplet currently assigned to a venue (you must use
  // /switch-droplet for that flow so the venue's worker is reassigned
  // first; otherwise the venue would be left in a broken state).
  if (!dropletId) return err(400, 'dropletId required');

  // Verify it's not assigned to a venue
  const byId = await _venuesByDropletId();
  const owner = byId.get(Number(dropletId));
  if (owner?.venueId) {
    return err(409, `droplet ${dropletId} is assigned to venue ${owner.venueId} `
      + `(${owner.venueName}); use POST /admin/venues/${owner.venueId}/switch-droplet `
      + `to migrate the venue off this droplet first`);
  }

  // Best-effort look up IP for audit log before deletion
  let ip = '';
  try {
    const d = (await _doApi(`/droplets/${dropletId}`)).droplet;
    ip = (d.networks?.v4 || []).find(n => n.type === 'public')?.ip_address || '';
  } catch { /* droplet may already be gone — proceed to attempt delete */ }

  try {
    await _doApi(`/droplets/${dropletId}`, { method: 'DELETE' });
  } catch (e) {
    if (e._status === 404) {
      return ok({ ok: true, dropletId, alreadyGone: true,
                  msg: 'droplet not found on DO (already destroyed)' });
    }
    return err(502, `DO API destroy failed: ${e.message}`);
  }
  return ok({ ok: true, dropletId, ip,
              msg: 'droplet destroyed; DO billing for it stops at next hour boundary' });
}

async function destroyDroplet(venueId) {
  if (!venueId) return err(400, 'venueId required');
  const ven = await ddb.send(new GetItemCommand({
    TableName: VENUES_TABLE,
    Key: { venueId: { S: venueId } },
  }));
  if (!ven.Item) return err(404, `venue ${venueId} not found`);
  const dropletId = Number(ven.Item?.dropletId?.N || 0);
  if (dropletId) {
    try {
      await _doApi(`/droplets/${dropletId}`, { method: 'DELETE' });
    } catch (e) {
      // 404 means it was already gone — proceed to clear DDB
      if (e._status !== 404) {
        return err(e._status || 500, e.message || 'DO destroy failed');
      }
    }
  }
  await ddb.send(new UpdateItemCommand({
    TableName: VENUES_TABLE,
    Key: { venueId: { S: venueId } },
    UpdateExpression: 'REMOVE dropletId, dropletIp, dropletRegion, '
                    + 'dropletSize, provisionedAt SET dropletStatus = :st',
    ExpressionAttributeValues: { ':st': { S: 'none' } },
  }));
  return ok({ venueId, dropletId, dropletStatus: 'destroyed' });
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const handler = async (event, context) => {
  // Capture Lambda ARN for EventBridge permission grants
  if (context?.invokedFunctionArn) _lambdaArn = context.invokedFunctionArn;

  // EventBridge scheduled trigger (daily/weekly auto-send)
  if (event.source === 'aws.events' || event['detail-type'] === 'Scheduled Event') {
    return runScheduledReports();
  }

  const method  = event.requestContext?.http?.method ?? event.httpMethod ?? 'GET';
  const rawPath = event.requestContext?.http?.path   ?? event.path       ?? '/';
  const qs      = event.queryStringParameters ?? {};
  const body    = event.body ? JSON.parse(event.body) : {};

  if (method === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };

  // ─── Shared-secret auth ────────────────────────────────────────────────
  // Stop-gap: without this, every /admin/* route was world-callable, which
  // leaked PII (owner emails) and allowed unauthenticated venue + Cognito
  // user creation. Real fix is a Cognito JWT authorizer at the API Gateway
  // level — that's the next session's work. For now: header-based shared
  // secret. Frontend reads VITE_ADMIN_KEY from Amplify env, sends it as
  // `x-admin-key` on every adminFetch call. Lambda compares against
  // ADMIN_KEY in its env. Mismatch → 401.
  //
  // Caveat: the secret ships inside the client JS bundle, so anyone who
  // scrapes the bundle can extract it. Closing that hole takes a real JWT
  // authorizer. This still cuts off random scanners and unsophisticated
  // attackers — most of the immediate threat.
  if (rawPath !== '/health') {
    const expected   = process.env.ADMIN_KEY;
    const presented  = event.headers?.['x-admin-key']
                    ?? event.headers?.['X-Admin-Key']
                    ?? event.headers?.['X-ADMIN-KEY']
                    ?? '';
    if (!expected) {
      // Lambda misconfigured — don't pretend things are fine. Operator
      // needs to set ADMIN_KEY in the Lambda env via the deploy script.
      console.warn('[admin-api] ADMIN_KEY env var not set — auth is OFF. SET IT.');
    } else if (presented !== expected) {
      return { statusCode: 401, headers: cors,
               body: JSON.stringify({ error: 'unauthorized' }) };
    }
  }

  try {
    // Venues
    if (method === 'GET'   && rawPath === '/admin/venues')             return listVenues();
    if (method === 'POST'  && rawPath === '/admin/venues')             return createVenue(body);
    const statusMatch = rawPath.match(/^\/admin\/venues\/([^/]+)\/status$/);
    if (method === 'PATCH'  && statusMatch)                            return updateVenueStatus(statusMatch[1], body.status);
    const profileMatch = rawPath.match(/^\/admin\/venues\/([^/]+)\/profile$/);
    if (method === 'PATCH'  && profileMatch)                           return updateVenueProfile(decodeURIComponent(profileMatch[1]), body);
    const settingMatch = rawPath.match(/^\/admin\/venues\/([^/]+)\/settings\/([^/]+)$/);
    if (method === 'GET'    && settingMatch)                           return getVenueSetting(decodeURIComponent(settingMatch[1]), settingMatch[2]);
    if (method === 'POST'   && settingMatch)                           return putVenueSetting(decodeURIComponent(settingMatch[1]), settingMatch[2], body);
    const sysSettingMatch = rawPath.match(/^\/admin\/system\/settings\/([^/]+)$/);
    if (method === 'GET'    && sysSettingMatch)                        return getSystemSetting(sysSettingMatch[1]);
    if (method === 'POST'   && sysSettingMatch)                        return putSystemSetting(sysSettingMatch[1], body);
    const emailConfigMatch = rawPath.match(/^\/admin\/venues\/([^/]+)\/email-config$/);
    if (method === 'POST'   && emailConfigMatch)                       return saveVenueEmailConfig(decodeURIComponent(emailConfigMatch[1]), body);
    const deleteVenueMatch = rawPath.match(/^\/admin\/venues\/([^/]+)$/);
    if (method === 'DELETE' && deleteVenueMatch)                       return deleteVenue(deleteVenueMatch[1]);

    // POS receipts + accuracy reconciliation (Phase 3.2)
    const posUploadMatch = rawPath.match(/^\/admin\/venues\/([^/]+)\/pos-receipts$/);
    const posDeleteMatch = rawPath.match(/^\/admin\/venues\/([^/]+)\/pos-receipts\/(.+)$/);
    const accuracyMatch  = rawPath.match(/^\/admin\/venues\/([^/]+)\/accuracy$/);
    if (method === 'POST'   && posUploadMatch) {
      // Accept raw CSV in body OR JSON {csv|receipts: ...}
      const ct = (event.headers?.['content-type'] || event.headers?.['Content-Type'] || '').toLowerCase();
      const bodyToPass = ct.includes('text/csv') ? (event.body || '') : body;
      return uploadPosReceipts(decodeURIComponent(posUploadMatch[1]), bodyToPass, event.headers || {});
    }
    if (method === 'GET'    && posUploadMatch)  return listPosReceipts(decodeURIComponent(posUploadMatch[1]), qs);
    if (method === 'DELETE' && posDeleteMatch)  return deletePosReceipt(decodeURIComponent(posDeleteMatch[1]), decodeURIComponent(posDeleteMatch[2]));
    if (method === 'GET'    && accuracyMatch)   return getAccuracy(decodeURIComponent(accuracyMatch[1]), qs);

    // Per-venue droplet provisioning (Step 7 — auto-onboarding for new venues)
    const dropletMatch = rawPath.match(/^\/admin\/venues\/([^/]+)\/droplet$/);
    const provisionMatch = rawPath.match(/^\/admin\/venues\/([^/]+)\/provision-droplet$/);
    if (method === 'POST'   && provisionMatch)                         return provisionDroplet(decodeURIComponent(provisionMatch[1]), body);
    if (method === 'GET'    && dropletMatch)                           return getDroplet(decodeURIComponent(dropletMatch[1]));
    if (method === 'DELETE' && dropletMatch)                           return destroyDroplet(decodeURIComponent(dropletMatch[1]));

    // Email reports + global settings
    if (method === 'GET'   && rawPath === '/admin/email/settings')          return getEmailGlobalSettings();
    if (method === 'POST'  && rawPath === '/admin/email/settings')          return saveEmailGlobalSettings(body);
    if (method === 'POST'  && rawPath === '/admin/email/verify-sender')     return verifySenderEmail(body);
    if (method === 'GET'   && rawPath === '/admin/email/sender-status')     return checkSenderStatus(qs.email);
    if (method === 'POST'  && rawPath === '/admin/email/schedule/enable')   return enableAutoSchedule(body);
    if (method === 'POST'  && rawPath === '/admin/email/schedule/disable')  return disableAutoSchedule();
    if (method === 'POST'  && rawPath === '/admin/email/send-now')          return sendReportNow(body);
    if (method === 'POST'  && rawPath === '/admin/email/send-test')         return sendTestReport(body);
    if (method === 'GET'   && rawPath === '/admin/email/log')               return getEmailLog(qs.venueId);
    if (method === 'GET'   && rawPath === '/admin/email/template')          return getEmailTemplate();
    if (method === 'POST'  && rawPath === '/admin/email/template')          return saveEmailTemplate(body);
    if (method === 'POST'  && rawPath === '/admin/email/preview')           return previewEmail(body);

    // Users
    if (method === 'GET'   && rawPath === '/admin/users')              return listUsers();
    if (method === 'POST'  && rawPath === '/admin/users')              return createUser(body);
    const disableMatch  = rawPath.match(/^\/admin\/users\/([^/]+)\/disable$/);
    const enableMatch   = rawPath.match(/^\/admin\/users\/([^/]+)\/enable$/);
    const resetMatch    = rawPath.match(/^\/admin\/users\/([^/]+)\/reset-password$/);
    if (method === 'POST'  && disableMatch)                            return disableUser(decodeURIComponent(disableMatch[1]));
    if (method === 'POST'  && enableMatch)                             return enableUser(decodeURIComponent(enableMatch[1]));
    if (method === 'POST'  && resetMatch)                              return resetUserPassword(decodeURIComponent(resetMatch[1]), body);

    // Cameras
    if (method === 'GET'   && rawPath === '/admin/cameras')            return listCameras(qs.venueId);
    if (method === 'POST'  && rawPath === '/admin/cameras')            return createCamera(body);
    if (method === 'POST'  && rawPath === '/admin/cameras/bulk-update-port') return bulkUpdateNvrPort(body);
    const cameraMatch = rawPath.match(/^\/admin\/cameras\/([^/]+)$/);
    if (method === 'PATCH' && cameraMatch)                             return updateCamera(cameraMatch[1], body);
    if (method === 'DELETE'&& cameraMatch)                             return deleteCamera(cameraMatch[1], qs.venueId);

    // Jobs
    if (method === 'GET'   && rawPath === '/admin/jobs')               return listJobs(qs.venueId, qs.limit);
    if (method === 'POST'  && rawPath === '/admin/jobs/cancel')        return cancelJob(body);

    // Stats
    if (method === 'GET'   && rawPath === '/admin/stats')              return getStats();

    // Alerts
    if (method === 'GET'   && rawPath === '/admin/alerts')             return listAlerts(qs.venueId, qs.limit);
    if (method === 'GET'   && rawPath === '/admin/alerts/reviewed')    return getReviewedAlerts();
    if (method === 'POST'  && rawPath === '/admin/alerts/reviewed')    return saveReviewedAlerts(body);

    // Camera probing (NVR discovery) — forwards to venue's own droplet
    if (method === 'POST'  && rawPath === '/admin/probe-cameras')      return probeCameras(body);
    // Generic per-venue ops proxy (every /ops/* call goes through here so
    // each venue's droplet runs its own worker actions; see _forwardToDroplet)
    if (method === 'POST'  && rawPath === '/admin/ops-proxy')          return opsProxy(body);

    // Switch-Droplet feature: list pool, swap modes, park/assign/test
    if (method === 'GET'   && rawPath === '/admin/droplets')           return listDroplets();
    const switchMatch  = rawPath.match(/^\/admin\/venues\/([^/]+)\/switch-droplet$/);
    const parkMatch    = rawPath.match(/^\/admin\/droplets\/([0-9]+)\/park$/);
    const assignMatch  = rawPath.match(/^\/admin\/droplets\/([0-9]+)\/assign$/);
    const reachMatch   = rawPath.match(/^\/admin\/droplets\/([0-9]+)\/test-reachability$/);
    if (method === 'POST' && switchMatch) return switchDroplet(decodeURIComponent(switchMatch[1]), body);
    if (method === 'POST' && parkMatch)   return parkDroplet(parkMatch[1]);
    if (method === 'POST' && assignMatch) return assignDroplet(assignMatch[1], body);
    if (method === 'POST' && reachMatch)  return testDropletReachability(reachMatch[1], body);
    const destroyDropletMatch = rawPath.match(/^\/admin\/droplets\/([0-9]+)$/);
    if (method === 'DELETE' && destroyDropletMatch) return destroyOrphanDroplet(destroyDropletMatch[1]);

    // Review queue — low-confidence events needing human approval
    if (method === 'GET'   && rawPath === '/admin/review-queue')               return listReviewQueue(qs);
    if (method === 'GET'   && rawPath === '/admin/review-queue/stats')         return reviewQueueStats(qs);
    const reviewApprove = rawPath.match(/^\/admin\/review-queue\/([^/]+)\/approve$/);
    const reviewReject  = rawPath.match(/^\/admin\/review-queue\/([^/]+)\/reject$/);
    if (method === 'POST'  && reviewApprove)                                   return reviewEvent(decodeURIComponent(reviewApprove[1]), 'approved', body);
    if (method === 'POST'  && reviewReject)                                    return reviewEvent(decodeURIComponent(reviewReject[1]), 'rejected', body);
    if (method === 'POST'  && rawPath === '/admin/review-queue/bulk')          return reviewBulk(body);

    // Worker Tester — admin-only NVR replay runs
    if (method === 'GET'    && rawPath === '/admin/test-runs')         return listTestRuns(qs);
    if (method === 'POST'   && rawPath === '/admin/test-runs')         return createTestRun(body);
    const testRunMatch        = rawPath.match(/^\/admin\/test-runs\/([^/]+)$/);
    const testRunStatusMatch  = rawPath.match(/^\/admin\/test-runs\/([^/]+)\/status$/);
    const testRunResultsMatch = rawPath.match(/^\/admin\/test-runs\/([^/]+)\/results$/);
    if (method === 'GET'    && testRunMatch)                           return getTestRun(decodeURIComponent(testRunMatch[1]));
    if (method === 'PATCH'  && testRunStatusMatch)                     return updateTestRunStatus(decodeURIComponent(testRunStatusMatch[1]), body);
    if (method === 'POST'   && testRunResultsMatch)                    return appendTestRunResults(decodeURIComponent(testRunResultsMatch[1]), body);
    if (method === 'DELETE' && testRunMatch)                           return deleteTestRun(decodeURIComponent(testRunMatch[1]));
    if (method === 'GET'    && rawPath === '/admin/snapshot-url')      return getSnapshotUrl(qs);

    // Admin Settings
    if (method === 'GET'   && rawPath === '/admin/settings')           return getAdminSettings();
    if (method === 'POST'  && rawPath === '/admin/settings')           return saveAdminSettings(body);

    // Billing
    if (method === 'GET'  && rawPath === '/billing/status')               return getBillingStatus(qs.venueId);
    if (method === 'POST' && rawPath === '/billing/create-checkout')       return createCheckoutSession(body);
    if (method === 'POST' && rawPath === '/billing/portal')                return createPortalSession(body);
    if (method === 'POST' && rawPath === '/admin/billing/extend-trial')    return extendTrial(body);
    if (method === 'POST' && rawPath === '/billing/webhook') {
      const rawBody = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString('utf8') : (event.body ?? '');
      const sig = event.headers?.['stripe-signature'] ?? event.headers?.['Stripe-Signature'] ?? '';
      return handleStripeWebhook(rawBody, sig);
    }

    return err(404, `No route: ${method} ${rawPath}`);
  } catch (e) {
    console.error('Admin API error:', e.name, e.message);
    if (e.name === 'UsernameExistsException'  || e.__type === 'UsernameExistsException')  return err(409, 'User with that email already exists.');
    if (e.name === 'ConditionalCheckFailedException')                                      return err(409, 'Venue ID already exists.');
    if (e.name === 'UserNotFoundException'    || e.__type === 'UserNotFoundException')    return err(404, 'User not found.');
    if (e.name === 'NotAuthorizedException'   || e.__type === 'NotAuthorizedException')   return err(403, 'Not authorized.');
    if (e.name === 'InvalidPasswordException' || e.__type === 'InvalidPasswordException') return err(400, e.message ?? 'Invalid password.');
    return err(500, e.message ?? 'Internal error');
  }
};

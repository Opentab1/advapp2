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
import { createHmac, timingSafeEqual } from 'crypto';

const REGION       = process.env.REGION || 'us-east-2';
const USER_POOL_ID = process.env.USER_POOL_ID;

const VENUES_TABLE  = 'VenueScopeVenues';
const CAMERAS_TABLE = 'VenueScopeCameras';
const JOBS_TABLE    = 'VenueScopeJobs';
const BILLING_TABLE = 'VenueScopeBilling';
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY ?? '';
const STRIPE_PRICE  = process.env.STRIPE_PRICE_ID   ?? '';
const STRIPE_WH_SEC = process.env.STRIPE_WEBHOOK_SECRET ?? '';
const TRIAL_DAYS    = 14;

const cognito = new CognitoIdentityProviderClient({ region: REGION });
const ddb     = new DynamoDBClient({ region: REGION });

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
  };
}

function cameraFromItem(item) {
  return {
    cameraId:        s(item.cameraId),
    venueId:         s(item.venueId),
    name:            s(item.name),
    rtspUrl:         s(item.rtspUrl),
    modes:           s(item.modes) || 'drink_count',
    modelProfile:    s(item.modelProfile) || 'balanced',
    enabled:         b(item.enabled),
    segmentSeconds:  n(item.segmentSeconds),
    segmentInterval: n(item.segmentInterval),
    createdAt:       s(item.createdAt),
    notes:           s(item.notes),
    barConfigJson:   s(item.barConfigJson),
    blobsPerPerson:  n(item.blobsPerPerson),
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
  const items  = (result.Items ?? []).map(venueFromItem);
  items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return ok({ items });
}

async function createVenue(body) {
  const { venueName, venueId, locationName = 'Main', locationId = 'main',
          ownerEmail, ownerName, tempPassword } = body;
  if (!venueName || !venueId || !ownerEmail || !ownerName || !tempPassword)
    return err(400, 'Missing: venueName, venueId, ownerEmail, ownerName, tempPassword');
  if (!USER_POOL_ID) return err(500, 'USER_POOL_ID env var not set');

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

  await ddb.send(new PutItemCommand({
    TableName: VENUES_TABLE,
    Item: {
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
    },
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
  const { venueId, name, rtspUrl, modes = 'drink_count', modelProfile = 'balanced',
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
    result = await ddb.send(new ScanCommand({
      TableName: JOBS_TABLE,
      FilterExpression: 'createdAt > :cutoff',
      ExpressionAttributeValues: { ':cutoff': { N: String(Date.now() / 1000 - 30 * 86400) } },
    }));
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

async function probeCameras({ ip, port, totalChannels = 16 }) {
  if (!ip || !port) return err(400, 'ip and port are required');
  const channels = Math.min(Math.max(parseInt(totalChannels) || 16, 1), 32);
  const results  = [];
  await Promise.all(
    Array.from({ length: channels }, (_, i) => i + 1).map(async (ch) => {
      const url  = `http://${ip}:${port}/hls/live/CH${ch}/0/livetop.mp4`;
      try {
        const ctrl  = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 4000);
        const res   = await fetch(url, { method: 'HEAD', signal: ctrl.signal });
        clearTimeout(timer);
        results.push({ channel: ch, url, online: res.ok || res.status === 206 || res.status === 302 });
      } catch {
        results.push({ channel: ch, url, online: false });
      }
    })
  );
  results.sort((a, b) => a.channel - b.channel);
  return ok({ channels: results });
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

// ─── Router ───────────────────────────────────────────────────────────────────

export const handler = async (event) => {
  const method  = event.requestContext?.http?.method ?? event.httpMethod ?? 'GET';
  const rawPath = event.requestContext?.http?.path   ?? event.path       ?? '/';
  const qs      = event.queryStringParameters ?? {};
  const body    = event.body ? JSON.parse(event.body) : {};

  if (method === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };

  try {
    // Venues
    if (method === 'GET'   && rawPath === '/admin/venues')             return listVenues();
    if (method === 'POST'  && rawPath === '/admin/venues')             return createVenue(body);
    const statusMatch = rawPath.match(/^\/admin\/venues\/([^/]+)\/status$/);
    if (method === 'PATCH' && statusMatch)                             return updateVenueStatus(statusMatch[1], body.status);

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

    // Stats
    if (method === 'GET'   && rawPath === '/admin/stats')              return getStats();

    // Alerts
    if (method === 'GET'   && rawPath === '/admin/alerts')             return listAlerts(qs.venueId, qs.limit);

    // Camera probing (NVR discovery)
    if (method === 'POST'  && rawPath === '/admin/probe-cameras')      return probeCameras(body);

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

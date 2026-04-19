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

const cognito      = new CognitoIdentityProviderClient({ region: REGION });
const ddb          = new DynamoDBClient({ region: REGION });
const ses          = new SESClient({ region: REGION });
const eventsClient = new EventBridgeClient({ region: REGION });
const lambdaClient = new LambdaClient({ region: REGION });
const FROM_EMAIL   = process.env.SES_FROM_EMAIL || 'reports@advizia.online';
const PORTAL_URL   = process.env.PORTAL_URL     || 'https://advizia.online/admin';

const EMAIL_SETTINGS_KEY   = '_email_settings_';
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
  const items  = (result.Items ?? [])
    .filter(item => !s(item.venueId).startsWith('_'))  // exclude internal records (_system_settings_, etc.)
    .map(venueFromItem);
  items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return ok({ items });
}

async function createVenue(body) {
  const { venueName, venueId, locationName = 'Main', locationId = 'main',
          ownerEmail, ownerName, tempPassword } = body;
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

function buildReportHtml({ venueName, periodLabel, totalDrinks, drinksPerHour, theftCount, theftItems, stationBreakdown, isTest }) {
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

  const theftSection = theftCount > 0 ? `
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

    <p style="color:#666;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px">Station Breakdown</p>
    <table style="width:100%;border-collapse:collapse;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;overflow:hidden">
      <tr>
        <th style="text-align:left;color:#555;font-size:11px;text-transform:uppercase;padding:10px 12px;border-bottom:1px solid #222;font-weight:600">Station</th>
        <th style="text-align:left;color:#555;font-size:11px;text-transform:uppercase;padding:10px 12px;border-bottom:1px solid #222;font-weight:600">Drinks</th>
        <th style="text-align:left;color:#555;font-size:11px;text-transform:uppercase;padding:10px 12px;border-bottom:1px solid #222;font-weight:600">Rate</th>
      </tr>
      ${stationRows}
    </table>

    <div style="text-align:center;margin:32px 0">
      <a href="${PORTAL_URL}" style="background:linear-gradient(135deg,#f59e0b,#ea580c);color:#000;text-decoration:none;font-weight:700;padding:14px 32px;border-radius:8px;font-size:15px;display:inline-block">
        View Full Report →
      </a>
    </div>
  </div>

  <div style="border-top:1px solid #1a1a1a;padding:20px 32px;text-align:center;color:#444;font-size:12px">
    VenueScope by Advizia &middot; Automated reports for ${venueName}<br>
    <a href="${PORTAL_URL}" style="color:#f59e0b">Manage report settings</a>
  </div>
</div>
</body></html>`;
}

async function _sendReport(venueId, periodDays, isTest = false) {
  // Get venue + email config
  const venueRes = await ddb.send(new GetItemCommand({
    TableName: VENUES_TABLE,
    Key: { venueId: { S: venueId } },
  }));
  if (!venueRes.Item) throw new Error('venue not found');
  const venue = venueFromItem(venueRes.Item);
  if (!venue.emailConfig) throw new Error('no email config saved for this venue');
  if (!venue.emailConfig.recipients?.length) throw new Error('no recipients configured');

  // Fetch recent jobs for this venue
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
    ? ratedJobs.reduce((s, j) => s + j.drinksPerHour, 0) / ratedJobs.length
    : 0;
  const theftJobs = jobs.filter(j => j.hasTheftFlag);

  // Aggregate station breakdown across all jobs
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
    } catch { /* malformed breakdown, skip */ }
  }
  for (const st of Object.values(stationBreakdown)) {
    st.perHour = st._count > 0 ? st.perHour / st._count : 0;
    delete st._count;
  }

  const periodLabel = isTest
    ? `Test Report (Last ${periodDays} Days)`
    : periodDays === 1
      ? 'Daily Report — Yesterday'
      : periodDays === 7
        ? 'Weekly Report — Last 7 Days'
        : `Report — Last ${periodDays} Days`;

  const html = buildReportHtml({
    venueName: venue.venueName,
    periodLabel,
    totalDrinks,
    drinksPerHour,
    theftCount: theftJobs.length,
    theftItems: theftJobs.slice(0, 5),
    stationBreakdown,
    isTest,
  });

  const subject = isTest
    ? `[TEST] VenueScope Report — ${venue.venueName}`
    : periodDays === 1
      ? `VenueScope Daily Report — ${venue.venueName}`
      : `VenueScope Weekly Report — ${venue.venueName}`;

  // Read FROM email from DDB settings (falls back to env var)
  let fromEmail = FROM_EMAIL;
  try {
    const settingsRes = await ddb.send(new GetItemCommand({ TableName: VENUES_TABLE, Key: { venueId: { S: EMAIL_SETTINGS_KEY } } }));
    const raw = settingsRes.Item?.settingsJson?.S;
    if (raw) { const st = JSON.parse(raw); if (st.fromEmail) fromEmail = st.fromEmail; }
  } catch { /* use default */ }

  await ses.send(new SendEmailCommand({
    Source: fromEmail,
    Destination: { ToAddresses: venue.emailConfig.recipients },
    Message: {
      Subject: { Data: subject, Charset: 'UTF-8' },
      Body: {
        Html: { Data: html, Charset: 'UTF-8' },
        Text: {
          Data: `${subject}\n\nDrinks served: ${totalDrinks}\nDrinks/hr avg: ${drinksPerHour.toFixed(1)}\nTheft alerts: ${theftJobs.length}\n\nView full report: ${PORTAL_URL}`,
          Charset: 'UTF-8',
        },
      },
    },
  }));

  // Update lastSentAt (skip for test sends)
  if (!isTest) {
    const updated = { ...venue.emailConfig, lastSentAt: new Date().toISOString() };
    await ddb.send(new UpdateItemCommand({
      TableName: VENUES_TABLE,
      Key: { venueId: { S: venueId } },
      UpdateExpression: 'SET emailConfigJson = :c',
      ExpressionAttributeValues: { ':c': { S: JSON.stringify(updated) } },
    }));
  }

  return { sent: venue.emailConfig.recipients.length, subject, totalDrinks, theftAlerts: theftJobs.length };
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

  // Check EventBridge rule status
  let scheduleEnabled    = false;
  let scheduleExpression = EMAIL_SCHEDULE_EXPR;
  try {
    const rulesRes = await eventsClient.send(new ListRulesCommand({ NamePrefix: EMAIL_SCHEDULE_RULE }));
    const rule     = (rulesRes.Rules ?? []).find(r => r.Name === EMAIL_SCHEDULE_RULE);
    scheduleEnabled    = rule?.State === 'ENABLED';
    if (rule?.ScheduleExpression) scheduleExpression = rule.ScheduleExpression;
  } catch { /* EventBridge check failed — IAM may not have events:ListRules yet */ }

  return ok({ fromEmail, senderVerified, senderStatus, scheduleEnabled, scheduleExpression });
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

async function enableAutoSchedule(body) {
  const { scheduleExpression = EMAIL_SCHEDULE_EXPR } = body;
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

  try {
    // Venues
    if (method === 'GET'   && rawPath === '/admin/venues')             return listVenues();
    if (method === 'POST'  && rawPath === '/admin/venues')             return createVenue(body);
    const statusMatch = rawPath.match(/^\/admin\/venues\/([^/]+)\/status$/);
    if (method === 'PATCH'  && statusMatch)                            return updateVenueStatus(statusMatch[1], body.status);
    const emailConfigMatch = rawPath.match(/^\/admin\/venues\/([^/]+)\/email-config$/);
    if (method === 'POST'   && emailConfigMatch)                       return saveVenueEmailConfig(decodeURIComponent(emailConfigMatch[1]), body);
    const deleteVenueMatch = rawPath.match(/^\/admin\/venues\/([^/]+)$/);
    if (method === 'DELETE' && deleteVenueMatch)                       return deleteVenue(deleteVenueMatch[1]);

    // Email reports + global settings
    if (method === 'GET'   && rawPath === '/admin/email/settings')          return getEmailGlobalSettings();
    if (method === 'POST'  && rawPath === '/admin/email/settings')          return saveEmailGlobalSettings(body);
    if (method === 'POST'  && rawPath === '/admin/email/verify-sender')     return verifySenderEmail(body);
    if (method === 'GET'   && rawPath === '/admin/email/sender-status')     return checkSenderStatus(qs.email);
    if (method === 'POST'  && rawPath === '/admin/email/schedule/enable')   return enableAutoSchedule(body);
    if (method === 'POST'  && rawPath === '/admin/email/schedule/disable')  return disableAutoSchedule();
    if (method === 'POST'  && rawPath === '/admin/email/send-now')          return sendReportNow(body);
    if (method === 'POST'  && rawPath === '/admin/email/send-test')         return sendTestReport(body);

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

    // Camera probing (NVR discovery)
    if (method === 'POST'  && rawPath === '/admin/probe-cameras')      return probeCameras(body);

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

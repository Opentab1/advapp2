/**
 * VenueScope Admin API Lambda
 *
 * Deploy this as a Lambda function (Node.js 20.x) behind API Gateway (HTTP API).
 * Set these environment variables on the Lambda:
 *   USER_POOL_ID  — Cognito User Pool ID (e.g. us-east-2_XXXXXXX)
 *   REGION        — AWS region (e.g. us-east-2)
 *
 * The IAM role attached to this Lambda needs:
 *   - cognito-idp:AdminCreateUser
 *   - cognito-idp:AdminUpdateUserAttributes
 *   - cognito-idp:ListUsers
 *   - cognito-idp:AdminSetUserPassword
 *   - cognito-idp:AdminDisableUser
 *   - cognito-idp:AdminEnableUser
 *   - dynamodb:PutItem / GetItem / Scan / UpdateItem / DeleteItem
 *     on arn:aws:dynamodb:*:*:table/VenueScopeVenues
 *     and arn:aws:dynamodb:*:*:table/VenueScopeCameras
 *
 * API Gateway routes:
 *   GET    /admin/venues
 *   POST   /admin/venues
 *   GET    /admin/users
 *   POST   /admin/users
 *
 * Set VITE_ADMIN_API_URL in Amplify environment variables to the API Gateway invoke URL.
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
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';

const REGION = process.env.REGION || 'us-east-2';
const USER_POOL_ID = process.env.USER_POOL_ID;
const VENUES_TABLE = 'VenueScopeVenues';

const cognito = new CognitoIdentityProviderClient({ region: REGION });
const ddb = new DynamoDBClient({ region: REGION });

const cors = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Admin-Key',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
};

const ok = (body) => ({ statusCode: 200, headers: cors, body: JSON.stringify(body) });
const err = (status, msg) => ({ statusCode: status, headers: cors, body: JSON.stringify({ error: msg }) });

// ─── DynamoDB helpers ─────────────────────────────────────────────────────────

function ddbItemToVenue(item) {
  return {
    venueId:      item.venueId?.S ?? '',
    venueName:    item.venueName?.S ?? '',
    status:       item.status?.S ?? 'active',
    createdAt:    item.createdAt?.S ?? '',
    ownerEmail:   item.ownerEmail?.S ?? '',
    ownerName:    item.ownerName?.S ?? '',
    locationName: item.locationName?.S ?? 'Main',
    locationId:   item.locationId?.S ?? 'main',
    plan:         item.plan?.S ?? 'standard',
    userCount:    parseInt(item.userCount?.N ?? '1'),
    deviceCount:  parseInt(item.deviceCount?.N ?? '0'),
  };
}

// ─── Route handlers ───────────────────────────────────────────────────────────

async function listVenues() {
  const result = await ddb.send(new ScanCommand({ TableName: VENUES_TABLE }));
  const items = (result.Items ?? []).map(ddbItemToVenue);
  items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return ok({ items });
}

async function createVenue(body) {
  const {
    venueName, venueId, locationName = 'Main', locationId = 'main',
    ownerEmail, ownerName, tempPassword,
  } = body;

  if (!venueName || !venueId || !ownerEmail || !ownerName || !tempPassword) {
    return err(400, 'Missing required fields: venueName, venueId, ownerEmail, ownerName, tempPassword');
  }
  if (!USER_POOL_ID) return err(500, 'USER_POOL_ID environment variable not set');

  // 1. Create Cognito user
  await cognito.send(new AdminCreateUserCommand({
    UserPoolId: USER_POOL_ID,
    Username: ownerEmail,
    TemporaryPassword: tempPassword,
    UserAttributes: [
      { Name: 'email',              Value: ownerEmail },
      { Name: 'name',               Value: ownerName },
      { Name: 'custom:venueId',     Value: venueId },
      { Name: 'custom:venueName',   Value: venueName },
      { Name: 'custom:role',        Value: 'owner' },
      { Name: 'email_verified',     Value: 'true' },
    ],
    DesiredDeliveryMediums: ['EMAIL'],
  }));

  // 2. Write venue record to DynamoDB
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

async function listUsers() {
  if (!USER_POOL_ID) return err(500, 'USER_POOL_ID environment variable not set');

  const users = [];
  let paginationToken;

  do {
    const result = await cognito.send(new ListUsersCommand({
      UserPoolId: USER_POOL_ID,
      Limit: 60,
      PaginationToken: paginationToken,
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

    paginationToken = result.PaginationToken;
  } while (paginationToken);

  return ok({ items: users });
}

async function createUser(body) {
  const { email, name, venueId, venueName, role = 'staff', tempPassword } = body;
  if (!email || !name || !venueId || !tempPassword) {
    return err(400, 'Missing required fields: email, name, venueId, tempPassword');
  }
  if (!USER_POOL_ID) return err(500, 'USER_POOL_ID environment variable not set');

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

// ─── Camera Discovery ─────────────────────────────────────────────────────────

async function probeCameras({ ip, port, totalChannels = 16 }) {
  if (!ip || !port) return err(400, 'ip and port are required');

  const channels = Math.min(Math.max(parseInt(totalChannels) || 16, 1), 32);
  const results = [];

  // Probe each channel in parallel — HEAD request to HLS URL, 4s timeout
  await Promise.all(
    Array.from({ length: channels }, (_, i) => i + 1).map(async (ch) => {
      const url = `http://${ip}:${port}/hls/live/CH${ch}/0/livetop.mp4`;
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 4000);
        const res = await fetch(url, { method: 'HEAD', signal: ctrl.signal });
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


// ─── Router ───────────────────────────────────────────────────────────────────

export const handler = async (event) => {
  const method = event.requestContext?.http?.method ?? event.httpMethod ?? 'GET';
  const rawPath = event.requestContext?.http?.path ?? event.path ?? '/';

  if (method === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };

  try {
    // GET /admin/venues
    if (method === 'GET' && rawPath === '/admin/venues') {
      return await listVenues();
    }

    // POST /admin/venues
    if (method === 'POST' && rawPath === '/admin/venues') {
      return await createVenue(JSON.parse(event.body ?? '{}'));
    }

    // PATCH /admin/venues/{venueId}/status
    const statusMatch = rawPath.match(/^\/admin\/venues\/([^/]+)\/status$/);
    if (method === 'PATCH' && statusMatch) {
      const body = JSON.parse(event.body ?? '{}');
      return await updateVenueStatus(statusMatch[1], body.status);
    }

    // GET /admin/users
    if (method === 'GET' && rawPath === '/admin/users') {
      return await listUsers();
    }

    // POST /admin/users
    if (method === 'POST' && rawPath === '/admin/users') {
      return await createUser(JSON.parse(event.body ?? '{}'));
    }

    // POST /admin/probe-cameras
    if (method === 'POST' && rawPath === '/admin/probe-cameras') {
      return await probeCameras(JSON.parse(event.body ?? '{}'));
    }

    return err(404, `No route: ${method} ${rawPath}`);
  } catch (e) {
    console.error('Admin API error:', e);
    // Surface Cognito "user already exists" nicely
    if (e.name === 'UsernameExistsException') {
      return err(409, 'A user with that email already exists in Cognito.');
    }
    if (e.name === 'ConditionalCheckFailedException') {
      return err(409, 'A venue with that ID already exists.');
    }
    return err(500, e.message ?? 'Internal error');
  }
};

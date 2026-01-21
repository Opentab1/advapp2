/**
 * Venue Settings Lambda
 * 
 * Handles GET/PUT for venue settings (address, capacity, etc.)
 * Stores data in VenueConfig table under 'settings' attribute
 * 
 * API Gateway Routes:
 *   GET  /venue-settings           - Get all venue settings
 *   GET  /venue-settings/{venueId} - Get single venue's settings
 *   PUT  /venue-settings/{venueId} - Update venue settings
 * 
 * Deploy to: AWS Lambda
 * Runtime: Node.js 18.x
 * 
 * Required IAM Permissions:
 *   - dynamodb:GetItem on VenueConfig table
 *   - dynamodb:PutItem on VenueConfig table
 *   - dynamodb:UpdateItem on VenueConfig table
 *   - dynamodb:Scan on VenueConfig table (for GET all)
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { 
  DynamoDBDocumentClient, 
  GetCommand, 
  PutCommand, 
  UpdateCommand,
  ScanCommand 
} = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: 'us-east-2' });
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.VENUE_CONFIG_TABLE || 'VenueConfig';

// CORS headers for all responses
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  console.log('Event:', JSON.stringify(event, null, 2));
  
  const method = event.httpMethod || event.requestContext?.http?.method;
  const venueId = event.pathParameters?.venueId;
  
  // Handle CORS preflight
  if (method === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }
  
  try {
    // GET /venue-settings - Get all venue settings
    if (method === 'GET' && !venueId) {
      return await getAllVenueSettings();
    }
    
    // GET /venue-settings/{venueId} - Get single venue settings
    if (method === 'GET' && venueId) {
      return await getVenueSettings(venueId);
    }
    
    // PUT /venue-settings/{venueId} - Update venue settings
    if (method === 'PUT' && venueId) {
      const body = JSON.parse(event.body || '{}');
      return await updateVenueSettings(venueId, body);
    }
    
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Invalid request' })
    };
    
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: 'Internal server error',
        message: error.message 
      })
    };
  }
};

/**
 * Get all venue settings
 */
async function getAllVenueSettings() {
  const result = await docClient.send(new ScanCommand({
    TableName: TABLE_NAME,
    ProjectionExpression: 'venueId, venueName, settings'
  }));
  
  const settings = {};
  for (const item of result.Items || []) {
    if (item.settings) {
      settings[item.venueId] = {
        venueName: item.venueName,
        ...item.settings
      };
    }
  }
  
  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify(settings)
  };
}

/**
 * Get settings for a single venue
 */
async function getVenueSettings(venueId) {
  const result = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { 
      venueId: venueId,
      locationId: 'mainfloor'  // Default location
    },
    ProjectionExpression: 'venueId, venueName, settings'
  }));
  
  if (!result.Item) {
    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Venue not found' })
    };
  }
  
  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify(result.Item.settings || {})
  };
}

/**
 * Update settings for a venue
 */
async function updateVenueSettings(venueId, settings) {
  // Add timestamp
  const updatedSettings = {
    ...settings,
    lastUpdated: new Date().toISOString()
  };
  
  // Update the settings attribute in VenueConfig
  await docClient.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { 
      venueId: venueId,
      locationId: 'mainfloor'
    },
    UpdateExpression: 'SET settings = :settings',
    ExpressionAttributeValues: {
      ':settings': updatedSettings
    }
  }));
  
  console.log(`✅ Venue settings updated for: ${venueId}`);
  
  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({ 
      success: true, 
      message: 'Settings updated',
      settings: updatedSettings
    })
  };
}

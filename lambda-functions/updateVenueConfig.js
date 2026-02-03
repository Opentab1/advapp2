/**
 * updateVenueConfig - Lambda to save NFC/Twilio settings for a venue
 * 
 * Called by admin portal when saving NFC Lead Capture settings
 * Stores twilioPhoneNumber, welcomeMessage, returnMessage in VenueConfig
 * 
 * API Gateway Route:
 *   PUT /venue/{venueId}/config
 * 
 * Required IAM Permissions:
 *   - dynamodb:UpdateItem on VenueConfig table
 *   - dynamodb:GetItem on VenueConfig table
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: 'us-east-2' });
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.VENUE_CONFIG_TABLE || 'VenueConfig';

// CORS headers
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
  
  if (!venueId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'venueId is required' })
    };
  }
  
  try {
    // GET - Fetch current config
    if (method === 'GET') {
      const result = await docClient.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { venueId, locationId: 'main' }
      }));
      
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify(result.Item || {})
      };
    }
    
    // PUT - Update config
    if (method === 'PUT') {
      const body = JSON.parse(event.body || '{}');
      
      const { twilioPhoneNumber, welcomeMessage, returnMessage, venueName } = body;
      
      // Build update expression dynamically
      const updates = [];
      const exprValues = {};
      const exprNames = {};
      
      if (twilioPhoneNumber !== undefined) {
        updates.push('#phone = :phone');
        exprValues[':phone'] = twilioPhoneNumber;
        exprNames['#phone'] = 'twilioPhoneNumber';
      }
      
      if (welcomeMessage !== undefined) {
        updates.push('welcomeMessage = :welcome');
        exprValues[':welcome'] = welcomeMessage;
      }
      
      if (returnMessage !== undefined) {
        updates.push('returnMessage = :return');
        exprValues[':return'] = returnMessage;
      }
      
      if (venueName !== undefined) {
        updates.push('venueName = :name');
        exprValues[':name'] = venueName;
      }
      
      // Always update timestamp
      updates.push('updatedAt = :updatedAt');
      exprValues[':updatedAt'] = new Date().toISOString();
      
      if (updates.length === 1) {
        // Only timestamp, nothing else to update
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({ success: true, message: 'No changes to save' })
        };
      }
      
      await docClient.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { venueId, locationId: 'main' },
        UpdateExpression: 'SET ' + updates.join(', '),
        ExpressionAttributeValues: exprValues,
        ...(Object.keys(exprNames).length > 0 && { ExpressionAttributeNames: exprNames })
      }));
      
      console.log(`✅ Venue config updated for: ${venueId}`);
      
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ 
          success: true, 
          message: 'Config updated',
          venueId
        })
      };
    }
    
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' })
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

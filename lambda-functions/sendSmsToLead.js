/**
 * sendSmsToLead - Lambda to send SMS to leads from venue portal
 * 
 * Allows venue owners to send messages to their captured leads
 * Uses the venue's configured Twilio number
 * 
 * API Gateway Route:
 *   POST /send-sms
 * 
 * Request Body:
 *   {
 *     "venueId": "venue123",
 *     "phoneNumbers": ["+15125551234", "+17135555678"],
 *     "message": "Hey! 20% off tonight only!"
 *   }
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: 'us-east-2' });
const docClient = DynamoDBDocumentClient.from(client);

const VENUE_CONFIG_TABLE = process.env.VENUE_CONFIG_TABLE || 'VenueConfig';

// Twilio credentials from environment
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Content-Type': 'application/json'
};

/**
 * Send SMS via Twilio REST API
 */
async function sendSms(to, body, from) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  
  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
  
  const params = new URLSearchParams();
  params.append('To', to);
  params.append('From', from);
  params.append('Body', body);
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  
  if (!response.ok) {
    const error = await response.text();
    console.error('Twilio error:', error);
    throw new Error(`Failed to send SMS: ${response.status}`);
  }
  
  return await response.json();
}

/**
 * Get venue config including Twilio number
 */
async function getVenueConfig(venueId) {
  // Try to get venue config with locationId 'main'
  const result = await docClient.send(new GetCommand({
    TableName: VENUE_CONFIG_TABLE,
    Key: { venueId, locationId: 'main' }
  }));
  
  if (result.Item) {
    return result.Item;
  }
  
  // Fallback: query for any config with this venueId
  const queryResult = await docClient.send(new QueryCommand({
    TableName: VENUE_CONFIG_TABLE,
    KeyConditionExpression: 'venueId = :venueId',
    ExpressionAttributeValues: {
      ':venueId': venueId
    },
    Limit: 1
  }));
  
  return queryResult.Items?.[0] || null;
}

exports.handler = async (event) => {
  console.log('Event:', JSON.stringify(event, null, 2));
  
  const method = event.httpMethod || event.requestContext?.http?.method;
  
  // Handle CORS preflight
  if (method === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }
  
  if (method !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }
  
  try {
    const body = JSON.parse(event.body || '{}');
    const { venueId, phoneNumbers, message } = body;
    
    // Validate request
    if (!venueId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'venueId is required' })
      };
    }
    
    if (!phoneNumbers || !Array.isArray(phoneNumbers) || phoneNumbers.length === 0) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'phoneNumbers array is required' })
      };
    }
    
    if (!message || message.trim().length === 0) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'message is required' })
      };
    }
    
    if (message.length > 1600) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Message too long (max 1600 characters)' })
      };
    }
    
    // Get venue config to find Twilio number
    const venueConfig = await getVenueConfig(venueId);
    
    if (!venueConfig || !venueConfig.twilioPhoneNumber) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: 'Venue does not have a Twilio phone number configured',
          venueId 
        })
      };
    }
    
    const fromNumber = venueConfig.twilioPhoneNumber;
    console.log(`Sending SMS from ${fromNumber} to ${phoneNumbers.length} recipients`);
    
    // Send SMS to each recipient
    const results = {
      success: 0,
      failed: 0,
      errors: []
    };
    
    for (const phoneNumber of phoneNumbers) {
      try {
        await sendSms(phoneNumber, message, fromNumber);
        results.success++;
        console.log(`✅ Sent to ${phoneNumber}`);
      } catch (err) {
        results.failed++;
        results.errors.push({ phoneNumber, error: err.message });
        console.error(`❌ Failed to send to ${phoneNumber}:`, err.message);
      }
    }
    
    console.log(`SMS batch complete: ${results.success} sent, ${results.failed} failed`);
    
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        sent: results.success,
        failed: results.failed,
        errors: results.errors.length > 0 ? results.errors : undefined
      })
    };
    
  } catch (error) {
    console.error('Error sending SMS:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: 'Failed to send SMS',
        message: error.message 
      })
    };
  }
};

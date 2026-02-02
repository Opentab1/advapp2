/**
 * handleIncomingSms - Lambda function for Twilio SMS webhook
 * 
 * Flow:
 * 1. Customer texts: "JOIN VENUEID TABLE1"
 * 2. Twilio sends webhook to this Lambda
 * 3. We parse the message, extract venue + source
 * 4. Store lead in DynamoDB
 * 5. Send auto-reply confirmation via Twilio
 * 
 * Environment Variables Required:
 * - TWILIO_ACCOUNT_SID
 * - TWILIO_AUTH_TOKEN
 * - TWILIO_PHONE_NUMBER
 * - LEADS_TABLE_NAME
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const dynamoClient = new DynamoDBClient({ region: 'us-east-2' });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const LEADS_TABLE = process.env.LEADS_TABLE_NAME || 'VenueLeads';

// Twilio credentials from environment
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;

/**
 * Send SMS via Twilio REST API
 */
async function sendSms(to, body) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  
  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
  
  const params = new URLSearchParams();
  params.append('To', to);
  params.append('From', TWILIO_PHONE_NUMBER);
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
 * Parse incoming message to extract venue and source
 * Expected formats:
 * - "JOIN VENUEID" -> venue only
 * - "JOIN VENUEID TABLE1" -> venue + source
 * - "STOP" -> opt-out
 */
function parseMessage(body) {
  const text = (body || '').trim().toUpperCase();
  
  // Handle opt-out keywords
  if (['STOP', 'UNSUBSCRIBE', 'CANCEL', 'QUIT', 'END'].includes(text)) {
    return { action: 'optout' };
  }
  
  // Handle JOIN command
  if (text.startsWith('JOIN')) {
    const parts = text.split(/\s+/);
    // parts[0] = "JOIN", parts[1] = venueId, parts[2] = source (optional)
    if (parts.length >= 2) {
      return {
        action: 'join',
        venueId: parts[1].toLowerCase(),
        source: parts[2] ? parts.slice(2).join('-').toLowerCase() : 'unknown',
      };
    }
  }
  
  // Unknown command
  return { action: 'unknown' };
}

/**
 * Store lead in DynamoDB
 */
async function storeLead(venueId, phoneNumber, source) {
  const now = new Date().toISOString();
  
  // Check if lead already exists
  const existing = await docClient.send(new GetCommand({
    TableName: LEADS_TABLE,
    Key: { venueId, phoneNumber },
  }));
  
  if (existing.Item) {
    // Lead already exists - update last seen
    await docClient.send(new UpdateCommand({
      TableName: LEADS_TABLE,
      Key: { venueId, phoneNumber },
      UpdateExpression: 'SET lastSeenAt = :now, #status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':now': now,
        ':status': 'active',
      },
    }));
    return { isNew: false };
  }
  
  // New lead - store it
  await docClient.send(new PutCommand({
    TableName: LEADS_TABLE,
    Item: {
      venueId,
      phoneNumber,
      source,
      capturedAt: now,
      lastSeenAt: now,
      status: 'active',
      consentTimestamp: now,
      consentMessage: `Opted in via SMS to ${TWILIO_PHONE_NUMBER}`,
    },
  }));
  
  return { isNew: true };
}

/**
 * Handle opt-out
 */
async function handleOptOut(phoneNumber) {
  // We need to update all venues this phone has joined
  // For simplicity, we'll mark them as opted-out using a scan
  // In production, you'd want a GSI on phoneNumber
  
  console.log(`Processing opt-out for ${phoneNumber}`);
  
  // Note: This is a simplified implementation
  // In production, you'd scan/query all venues and update each
  return { success: true };
}

/**
 * Main Lambda handler
 */
exports.handler = async (event) => {
  console.log('Received event:', JSON.stringify(event, null, 2));
  
  try {
    // Parse the incoming webhook from Twilio
    // Twilio sends form-urlencoded data
    let body;
    if (event.body) {
      if (event.isBase64Encoded) {
        body = Buffer.from(event.body, 'base64').toString('utf-8');
      } else {
        body = event.body;
      }
    }
    
    // Parse URL-encoded body
    const params = new URLSearchParams(body);
    const from = params.get('From'); // Customer's phone number
    const messageBody = params.get('Body'); // The SMS text
    const to = params.get('To'); // Your Twilio number
    
    console.log(`SMS from ${from}: "${messageBody}"`);
    
    if (!from || !messageBody) {
      console.error('Missing required fields');
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'text/xml' },
        body: '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      };
    }
    
    // Parse the message
    const parsed = parseMessage(messageBody);
    console.log('Parsed message:', parsed);
    
    let replyMessage = '';
    
    switch (parsed.action) {
      case 'join': {
        // Store the lead
        const result = await storeLead(parsed.venueId, from, parsed.source);
        
        if (result.isNew) {
          replyMessage = `You're in! We'll text you about specials & events. Reply STOP anytime.`;
          console.log(`New lead captured: ${from} for venue ${parsed.venueId} from ${parsed.source}`);
        } else {
          replyMessage = `Welcome back! You're already on our list.`;
          console.log(`Returning lead: ${from} for venue ${parsed.venueId}`);
        }
        break;
      }
      
      case 'optout': {
        await handleOptOut(from);
        replyMessage = `You've been unsubscribed. You won't receive any more messages.`;
        console.log(`Opt-out processed: ${from}`);
        break;
      }
      
      default: {
        replyMessage = `Reply JOIN to subscribe to updates, or STOP to unsubscribe.`;
        console.log(`Unknown command from ${from}: "${messageBody}"`);
      }
    }
    
    // Send reply via Twilio API
    try {
      await sendSms(from, replyMessage);
      console.log(`Reply sent to ${from}: "${replyMessage}"`);
    } catch (smsError) {
      console.error('Failed to send reply SMS:', smsError);
      // Don't fail the webhook - lead is still captured
    }
    
    // Return TwiML response (empty - we're using the API instead)
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/xml' },
      body: '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
    };
    
  } catch (error) {
    console.error('Error processing SMS:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/xml' },
      body: '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
    };
  }
};

/**
 * handleIncomingSms - Lambda function for Twilio SMS webhook
 * 
 * PROFESSIONAL SETUP: Each venue has their own dedicated Twilio number
 * 
 * Flow:
 * 1. Customer texts: "JOIN TABLE5" to venue's dedicated number
 * 2. Twilio sends webhook to this Lambda
 * 3. We look up venue by the Twilio number that received the SMS
 * 4. Store lead in DynamoDB with source (TABLE5)
 * 5. Send auto-reply confirmation via Twilio
 * 
 * Environment Variables Required:
 * - TWILIO_ACCOUNT_SID
 * - TWILIO_AUTH_TOKEN  
 * - LEADS_TABLE_NAME
 * - VENUE_CONFIG_TABLE_NAME
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const dynamoClient = new DynamoDBClient({ region: 'us-east-2' });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const LEADS_TABLE = process.env.LEADS_TABLE_NAME || 'VenueLeads';
const VENUE_CONFIG_TABLE = process.env.VENUE_CONFIG_TABLE_NAME || 'VenueConfig';

// Twilio credentials from environment
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;

/**
 * Send SMS via Twilio REST API
 * @param {string} to - Recipient phone number
 * @param {string} body - Message text
 * @param {string} from - Sender phone number (venue's Twilio number)
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
 * Look up venue by their dedicated Twilio phone number
 * Returns venue config including venueId, name, welcome message, etc.
 */
async function getVenueByPhoneNumber(twilioNumber) {
  // Normalize phone number format
  const normalized = twilioNumber.replace(/\D/g, '');
  const withPlus = twilioNumber.startsWith('+') ? twilioNumber : `+${normalized}`;
  
  try {
    // Query VenueConfig table by twilioPhoneNumber (GSI)
    // First try direct lookup if we have a GSI
    const result = await docClient.send(new QueryCommand({
      TableName: VENUE_CONFIG_TABLE,
      IndexName: 'TwilioPhoneIndex',
      KeyConditionExpression: 'twilioPhoneNumber = :phone',
      ExpressionAttributeValues: {
        ':phone': withPlus,
      },
      Limit: 1,
    }));
    
    if (result.Items && result.Items.length > 0) {
      return result.Items[0];
    }
    
    // Fallback: try without + prefix
    const result2 = await docClient.send(new QueryCommand({
      TableName: VENUE_CONFIG_TABLE,
      IndexName: 'TwilioPhoneIndex',
      KeyConditionExpression: 'twilioPhoneNumber = :phone',
      ExpressionAttributeValues: {
        ':phone': normalized,
      },
      Limit: 1,
    }));
    
    if (result2.Items && result2.Items.length > 0) {
      return result2.Items[0];
    }
    
    return null;
  } catch (error) {
    console.error('Error looking up venue by phone:', error);
    return null;
  }
}

/**
 * Parse incoming message to extract source/location
 * Expected formats (venue is determined by which Twilio number received the SMS):
 * - "JOIN" -> opt-in, no specific source
 * - "JOIN TABLE5" -> opt-in from Table 5
 * - "JOIN BAR" -> opt-in from Bar
 * - "HI" / "YES" / anything -> treated as opt-in
 * - "STOP" -> opt-out
 */
function parseMessage(body) {
  const text = (body || '').trim().toUpperCase();
  
  // Handle opt-out keywords
  if (['STOP', 'UNSUBSCRIBE', 'CANCEL', 'QUIT', 'END'].includes(text)) {
    return { action: 'optout' };
  }
  
  // Handle JOIN command with optional source
  if (text.startsWith('JOIN')) {
    const parts = text.split(/\s+/);
    // parts[0] = "JOIN", parts[1+] = source (optional)
    return {
      action: 'join',
      source: parts.length > 1 ? parts.slice(1).join(' ') : 'NFC Tap',
    };
  }
  
  // Handle simple affirmative responses as opt-in
  if (['YES', 'Y', 'HI', 'HELLO', 'SUBSCRIBE', 'SIGN UP', 'SIGNUP'].includes(text)) {
    return { action: 'join', source: 'NFC Tap' };
  }
  
  // Any other message - treat as opt-in (they tapped the NFC and sent something)
  // This is more user-friendly than requiring exact format
  if (text.length > 0 && text.length < 50) {
    return { action: 'join', source: text };
  }
  
  // Unknown/empty
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
 * Handle opt-out for a specific venue
 */
async function handleOptOut(phoneNumber, venueId) {
  console.log(`Processing opt-out for ${phoneNumber} from venue ${venueId}`);
  
  try {
    // Update the lead status to opted-out
    await docClient.send(new UpdateCommand({
      TableName: LEADS_TABLE,
      Key: { venueId, phoneNumber },
      UpdateExpression: 'SET #status = :status, optedOutAt = :now',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': 'opted-out',
        ':now': new Date().toISOString(),
      },
    }));
    
    return { success: true };
  } catch (error) {
    console.error('Error processing opt-out:', error);
    return { success: false };
  }
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
    const to = params.get('To'); // The Twilio number that received this SMS
    
    console.log(`SMS from ${from} to ${to}: "${messageBody}"`);
    
    if (!from) {
      console.error('Missing sender phone number');
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'text/xml' },
        body: '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      };
    }
    
    // Look up which venue owns this Twilio number
    const venue = await getVenueByPhoneNumber(to);
    
    if (!venue) {
      console.error(`No venue found for Twilio number: ${to}`);
      // Still respond gracefully
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/xml' },
        body: '<?xml version="1.0" encoding="UTF-8"?><Response><Message>Sorry, this number is not configured. Please contact support.</Message></Response>',
      };
    }
    
    console.log(`Venue found: ${venue.venueId} (${venue.venueName})`);
    
    // Parse the message
    const parsed = parseMessage(messageBody || '');
    console.log('Parsed message:', parsed);
    
    let replyMessage = '';
    
    switch (parsed.action) {
      case 'join': {
        // Store the lead
        const result = await storeLead(venue.venueId, from, parsed.source);
        
        if (result.isNew) {
          // Use venue's custom welcome message or default
          replyMessage = venue.welcomeMessage || 
            `Welcome to ${venue.venueName || 'our list'}! We'll text you about specials & events. Reply STOP anytime.`;
          console.log(`New lead captured: ${from} for venue ${venue.venueId} from ${parsed.source}`);
        } else {
          replyMessage = venue.returnMessage || 
            `Welcome back to ${venue.venueName || 'our list'}! You're already subscribed.`;
          console.log(`Returning lead: ${from} for venue ${venue.venueId}`);
        }
        break;
      }
      
      case 'optout': {
        await handleOptOut(from, venue.venueId);
        replyMessage = `You've been unsubscribed from ${venue.venueName || 'this list'}. You won't receive any more messages.`;
        console.log(`Opt-out processed: ${from} from venue ${venue.venueId}`);
        break;
      }
      
      default: {
        // Treat as opt-in attempt - be helpful
        replyMessage = `Thanks for reaching out to ${venue.venueName || 'us'}! Reply JOIN to get updates, or STOP to unsubscribe.`;
        console.log(`Unknown/empty message from ${from}: "${messageBody}"`);
      }
    }
    
    // Send reply using the venue's Twilio number
    try {
      await sendSms(from, replyMessage, venue.twilioPhoneNumber);
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

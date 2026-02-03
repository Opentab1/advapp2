/**
 * getVenuesWithNFC - Lambda to fetch all venues with NFC/Twilio configured
 * 
 * Returns list of venues that have twilioPhoneNumber set, along with lead counts
 * 
 * API Gateway Route:
 *   GET /venues-with-nfc
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: 'us-east-2' });
const docClient = DynamoDBDocumentClient.from(client);

const VENUE_CONFIG_TABLE = process.env.VENUE_CONFIG_TABLE || 'VenueConfig';
const LEADS_TABLE = process.env.LEADS_TABLE || 'VenueLeads';

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Content-Type': 'application/json'
};

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
  
  try {
    // Scan VenueConfig for venues with twilioPhoneNumber
    const configResult = await docClient.send(new ScanCommand({
      TableName: VENUE_CONFIG_TABLE,
      FilterExpression: 'attribute_exists(twilioPhoneNumber) AND twilioPhoneNumber <> :empty',
      ExpressionAttributeValues: {
        ':empty': ''
      }
    }));
    
    const venues = [];
    let totalLeads = 0;
    let leadsToday = 0;
    let leadsThisWeek = 0;
    
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    
    // For each venue with NFC, get lead counts
    for (const item of configResult.Items || []) {
      if (!item.twilioPhoneNumber) continue;
      
      // Query leads for this venue
      let venueLeads = 0;
      let venueTodayLeads = 0;
      
      try {
        const leadsResult = await docClient.send(new QueryCommand({
          TableName: LEADS_TABLE,
          KeyConditionExpression: 'venueId = :venueId',
          ExpressionAttributeValues: {
            ':venueId': item.venueId
          },
          Select: 'COUNT'
        }));
        
        venueLeads = leadsResult.Count || 0;
        totalLeads += venueLeads;
        
        // Count today's leads
        const todayResult = await docClient.send(new QueryCommand({
          TableName: LEADS_TABLE,
          KeyConditionExpression: 'venueId = :venueId',
          FilterExpression: 'capturedAt >= :today',
          ExpressionAttributeValues: {
            ':venueId': item.venueId,
            ':today': todayStart
          },
          Select: 'COUNT'
        }));
        
        venueTodayLeads = todayResult.Count || 0;
        leadsToday += venueTodayLeads;
        
        // Count this week's leads
        const weekResult = await docClient.send(new QueryCommand({
          TableName: LEADS_TABLE,
          KeyConditionExpression: 'venueId = :venueId',
          FilterExpression: 'capturedAt >= :week',
          ExpressionAttributeValues: {
            ':venueId': item.venueId,
            ':week': weekStart
          },
          Select: 'COUNT'
        }));
        
        leadsThisWeek += weekResult.Count || 0;
        
      } catch (err) {
        console.error(`Failed to get leads for venue ${item.venueId}:`, err);
      }
      
      venues.push({
        venueId: item.venueId,
        name: item.venueName || item.venueId,
        phone: item.twilioPhoneNumber,
        leads: venueLeads,
        leadsToday: venueTodayLeads,
        lastLead: null // Could query for most recent lead if needed
      });
    }
    
    // Sort by lead count descending
    venues.sort((a, b) => b.leads - a.leads);
    
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        venues,
        totalLeads,
        leadsToday,
        leadsThisWeek,
        venueCount: venues.length
      })
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

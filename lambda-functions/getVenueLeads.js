/**
 * getVenueLeads - Lambda function to fetch leads for a venue
 * 
 * Used by the frontend to display leads in the dashboard
 * 
 * Query params:
 * - venueId (required): The venue to fetch leads for
 * - limit (optional): Max number of leads to return (default 100)
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const dynamoClient = new DynamoDBClient({ region: 'us-east-2' });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const LEADS_TABLE = process.env.LEADS_TABLE_NAME || 'VenueLeads';

exports.handler = async (event) => {
  console.log('Received event:', JSON.stringify(event, null, 2));
  
  // CORS headers
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
  };
  
  // Handle preflight
  if (event.requestContext?.http?.method === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  
  try {
    const venueId = event.queryStringParameters?.venueId;
    const limit = parseInt(event.queryStringParameters?.limit || '100', 10);
    
    if (!venueId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'venueId is required' }),
      };
    }
    
    // Query leads for this venue
    const result = await docClient.send(new QueryCommand({
      TableName: LEADS_TABLE,
      KeyConditionExpression: 'venueId = :venueId',
      ExpressionAttributeValues: {
        ':venueId': venueId,
      },
      Limit: limit,
      ScanIndexForward: false, // Most recent first (by phone number, not ideal but works)
    }));
    
    const leads = result.Items || [];
    
    // Calculate stats
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    
    const activeLeads = leads.filter(l => l.status === 'active');
    const thisWeek = activeLeads.filter(l => new Date(l.capturedAt) >= oneWeekAgo);
    const lastWeek = activeLeads.filter(l => {
      const date = new Date(l.capturedAt);
      return date >= twoWeeksAgo && date < oneWeekAgo;
    });
    
    // Group by source
    const bySource: Record<string, number> = {};
    activeLeads.forEach(l => {
      const source = l.source || 'unknown';
      bySource[source] = (bySource[source] || 0) + 1;
    });
    
    const sourceStats = Object.entries(bySource)
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count);
    
    // Mask phone numbers for privacy
    const maskedLeads = leads.map(l => ({
      id: Buffer.from(l.phoneNumber).toString('base64').slice(0, 8),
      phone: l.phoneNumber.replace(/(\+1)(\d{3})(\d{3})(\d{4})/, '$1-***-***-$4'),
      capturedAt: l.capturedAt,
      source: l.source,
      status: l.status,
    }));
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        venueId,
        total: activeLeads.length,
        thisWeek: thisWeek.length,
        lastWeek: lastWeek.length,
        bySource: sourceStats,
        leads: maskedLeads,
      }),
    };
    
  } catch (error) {
    console.error('Error fetching leads:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to fetch leads' }),
    };
  }
};

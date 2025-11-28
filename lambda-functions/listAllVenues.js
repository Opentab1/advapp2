/**
 * Lambda Function: listAllVenues
 * 
 * Purpose: Get all venues from VenueConfig table
 * - Scans VenueConfig table
 * - Groups by venueId to get unique venues
 * - Returns venue list with metadata
 * 
 * Output: { venues: [ {venueId, venueName, locations, createdDate, status} ] }
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-2' });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

export const handler = async (event) => {
  console.log('Listing all venues...');
  
  try {
    // Scan VenueConfig table to get all venue configurations
    const scanResult = await docClient.send(new ScanCommand({
      TableName: 'VenueConfig'
    }));
    
    const items = scanResult.Items || [];
    console.log(`Found ${items.length} venue config items`);
    
    // Group by venueId to get unique venues
    const venueMap = new Map();
    
    items.forEach(item => {
      const venueId = item.venueId;
      
      if (!venueMap.has(venueId)) {
        venueMap.set(venueId, {
          venueId: venueId,
          venueName: item.venueName || venueId,
          locations: [],
          createdDate: item.createdAt || 'Unknown',
          status: item.status || 'active'
        });
      }
      
      // Add location to venue
      venueMap.get(venueId).locations.push({
        locationId: item.locationId,
        displayName: item.displayName || item.locationName
      });
    });
    
    // Convert map to array
    const venues = Array.from(venueMap.values()).map(venue => ({
      id: venue.venueId,
      venueId: venue.venueId,
      name: venue.venueName,
      locations: venue.locations.length,
      createdDate: new Date(venue.createdDate).toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      }),
      status: venue.status,
      users: 1, // Placeholder
      devices: venue.locations.length, // One device per location typically
      plan: 'Active',
      lastData: 'Unknown'
    }));
    
    console.log(`Returning ${venues.length} unique venues`);
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        venues: venues,
        totalVenues: venues.length
      })
    };
    
  } catch (error) {
    console.error('Error listing venues:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        message: 'Failed to list venues',
        error: error.message
      })
    };
  }
};

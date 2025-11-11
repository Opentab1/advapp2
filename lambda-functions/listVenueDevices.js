/**
 * Lambda Function: listVenueDevices
 * 
 * Purpose: List all IoT devices for a specific venue
 * Used by Admin Portal to display device status
 * 
 * Input: { venueId }
 * Output: { devices: [...] }
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { IoTClient, DescribeThingCommand } = require('@aws-sdk/client-iot');

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-2' }));
const iotClient = new IoTClient({ region: process.env.AWS_REGION || 'us-east-2' });

const VENUE_TABLE = 'VenueConfig';

exports.handler = async (event) => {
  console.log('Received event:', JSON.stringify(event, null, 2));

  try {
    const { venueId } = event;

    // Validate input
    if (!venueId) {
      throw new Error('venueId is required');
    }

    // Get venue config with devices list
    const getCommand = new GetCommand({
      TableName: VENUE_TABLE,
      Key: { venueId: venueId }
    });

    const result = await dynamoClient.send(getCommand);

    if (!result.Item) {
      return {
        statusCode: 404,
        body: {
          success: false,
          message: 'Venue not found'
        }
      };
    }

    const devices = result.Item.devices || [];

    // Enrich device data with IoT Thing status
    const enrichedDevices = await Promise.all(
      devices.map(async (device) => {
        try {
          const describeCommand = new DescribeThingCommand({
            thingName: device.deviceId
          });
          
          const thingDetails = await iotClient.send(describeCommand);
          
          return {
            ...device,
            thingDetails: {
              version: thingDetails.version,
              defaultClientId: thingDetails.defaultClientId,
              attributes: thingDetails.attributes
            }
          };
        } catch (error) {
          console.error(`Error fetching details for ${device.deviceId}:`, error);
          return {
            ...device,
            thingDetails: null,
            error: 'Could not fetch IoT Thing details'
          };
        }
      })
    );

    return {
      statusCode: 200,
      body: {
        success: true,
        venueId: venueId,
        deviceCount: enrichedDevices.length,
        devices: enrichedDevices
      }
    };

  } catch (error) {
    console.error('Error listing devices:', error);

    return {
      statusCode: 500,
      body: {
        success: false,
        message: 'Failed to list devices',
        error: error.message
      }
    };
  }
};

/**
 * Lambda Function: archiveDevice
 * 
 * Purpose: Archive/deactivate an IoT device
 * - Deactivates certificate (device can no longer connect)
 * - Marks device as 'archived' in DynamoDB
 * - Does NOT delete Thing or certificate (preserves historical data)
 * 
 * Input: { venueId, deviceId }
 * Output: { success: true, message: '...' }
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { IoTClient, UpdateCertificateCommand, ListThingPrincipalsCommand } = require('@aws-sdk/client-iot');

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-2' }));
const iotClient = new IoTClient({ region: process.env.AWS_REGION || 'us-east-2' });

const VENUE_TABLE = 'VenueConfig';

exports.handler = async (event) => {
  console.log('Received event:', JSON.stringify(event, null, 2));

  try {
    const { venueId, deviceId } = event;

    // Validate input
    if (!venueId || !deviceId) {
      throw new Error('venueId and deviceId are required');
    }

    console.log(`Archiving device: ${deviceId} for venue: ${venueId}`);

    // Step 1: Get venue to find the device
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
    const deviceIndex = devices.findIndex(d => d.deviceId === deviceId);

    if (deviceIndex === -1) {
      return {
        statusCode: 404,
        body: {
          success: false,
          message: 'Device not found in venue'
        }
      };
    }

    const device = devices[deviceIndex];

    // Step 2: Get certificate ARN for the Thing
    const listPrincipalsCommand = new ListThingPrincipalsCommand({
      thingName: deviceId
    });

    const principalsResponse = await iotClient.send(listPrincipalsCommand);
    const certificateArn = principalsResponse.principals?.[0];

    if (!certificateArn) {
      console.warn(`No certificate found for device ${deviceId}`);
    } else {
      // Step 3: Deactivate certificate (device can no longer connect)
      const certificateId = certificateArn.split('/')[1]; // Extract ID from ARN

      const updateCertCommand = new UpdateCertificateCommand({
        certificateId: certificateId,
        newStatus: 'INACTIVE'
      });

      await iotClient.send(updateCertCommand);
      console.log('Certificate deactivated');
    }

    // Step 4: Update device status in DynamoDB
    const updateCommand = new UpdateCommand({
      TableName: VENUE_TABLE,
      Key: { venueId: venueId },
      UpdateExpression: `SET devices[${deviceIndex}].#status = :archived, devices[${deviceIndex}].archivedAt = :timestamp`,
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':archived': 'archived',
        ':timestamp': new Date().toISOString()
      },
      ReturnValues: 'ALL_NEW'
    });

    await dynamoClient.send(updateCommand);
    console.log('Device marked as archived in DynamoDB');

    return {
      statusCode: 200,
      body: {
        success: true,
        message: `Device ${deviceId} archived successfully`,
        device: {
          deviceId: deviceId,
          status: 'archived',
          archivedAt: new Date().toISOString()
        }
      }
    };

  } catch (error) {
    console.error('Error archiving device:', error);

    return {
      statusCode: 500,
      body: {
        success: false,
        message: 'Failed to archive device',
        error: error.message
      }
    };
  }
};

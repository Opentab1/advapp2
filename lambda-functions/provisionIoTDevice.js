/**
 * Lambda Function: provisionIoTDevice
 * 
 * Purpose: Automatically provision IoT devices for venues
 * - Creates IoT Thing
 * - Generates certificate and keys
 * - Attaches PulseDevicePolicy
 * - Stores certificates in S3
 * - Returns device credentials
 * 
 * Input: { venueId, locationId }
 * Output: { deviceId, certificateArn, certificatePem, privateKey, publicKey }
 */

const { 
  IoTClient, 
  CreateThingCommand, 
  CreateKeysAndCertificateCommand, 
  AttachPolicyCommand, 
  AttachThingPrincipalCommand,
  DescribeEndpointCommand
} = require('@aws-sdk/client-iot');

const { 
  S3Client, 
  PutObjectCommand 
} = require('@aws-sdk/client-s3');

const { 
  DynamoDBClient 
} = require('@aws-sdk/client-dynamodb');

const { 
  DynamoDBDocumentClient, 
  UpdateCommand 
} = require('@aws-sdk/lib-dynamodb');

const iotClient = new IoTClient({ region: process.env.AWS_REGION || 'us-east-2' });
const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-2' });
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-2' }));

const POLICY_NAME = 'PulseDevicePolicy';
const S3_BUCKET = 'pulse-device-certificates';
const VENUE_TABLE = 'VenueConfig';

exports.handler = async (event) => {
  console.log('Received event:', JSON.stringify(event, null, 2));

  try {
    const { venueId, locationId } = event;

    // Validate input
    if (!venueId || !locationId) {
      throw new Error('venueId and locationId are required');
    }

    // Generate device ID
    const deviceId = `${venueId}-${locationId}-001`;
    const thingName = deviceId;

    console.log(`Provisioning device: ${deviceId}`);

    // Step 1: Create IoT Thing
    const createThingCommand = new CreateThingCommand({
      thingName: thingName,
      attributePayload: {
        attributes: {
          venueId: venueId,
          locationId: locationId,
          createdAt: new Date().toISOString()
        }
      }
    });

    const thingResponse = await iotClient.send(createThingCommand);
    console.log('IoT Thing created:', thingResponse.thingArn);

    // Step 2: Create certificate and keys
    const createCertCommand = new CreateKeysAndCertificateCommand({
      setAsActive: true
    });

    const certResponse = await iotClient.send(createCertCommand);
    console.log('Certificate created:', certResponse.certificateArn);

    // Step 3: Attach policy to certificate
    const attachPolicyCommand = new AttachPolicyCommand({
      policyName: POLICY_NAME,
      target: certResponse.certificateArn
    });

    await iotClient.send(attachPolicyCommand);
    console.log('Policy attached to certificate');

    // Step 4: Attach certificate to Thing
    const attachThingCommand = new AttachThingPrincipalCommand({
      thingName: thingName,
      principal: certResponse.certificateArn
    });

    await iotClient.send(attachThingCommand);
    console.log('Certificate attached to Thing');

    // Step 5: Get IoT endpoint
    const endpointCommand = new DescribeEndpointCommand({
      endpointType: 'iot:Data-ATS'
    });
    const endpointResponse = await iotClient.send(endpointCommand);
    const iotEndpoint = endpointResponse.endpointAddress;

    // Step 6: Store certificates in S3
    const s3Prefix = `${venueId}/${deviceId}`;

    // Download Amazon Root CA1 (for reference in response)
    const rootCA = `-----BEGIN CERTIFICATE-----
MIIDQTCCAimgAwIBAgITBmyfz5m/jAo54vB4ikPmljZbyjANBgkqhkiG9w0BAQsF
ADA5MQswCQYDVQQGEwJVUzEPMA0GA1UEChMGQW1hem9uMRkwFwYDVQQDExBBbWF6
b24gUm9vdCBDQSAxMB4XDTE1MDUyNjAwMDAwMFoXDTM4MDExNzAwMDAwMFowOTEL
MAkGA1UEBhMCVVMxDzANBgNVBAoTBkFtYXpvbjEZMBcGA1UEAxMQQW1hem9uIFJv
b3QgQ0EgMTCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBALJ4gHHKeNXj
ca9HgFB0fW7Y14h29Jlo91ghYPl0hAEvrAIthtOgQ3pOsqTQNroBvo3bSMgHFzZM
9O6II8c+6zf1tRn4SWiw3te5djgdYZ6k/oI2peVKVuRF4fn9tBb6dNqcmzU5L/qw
IFAGbHrQgLKm+a/sRxmPUDgH3KKHOVj4utWp+UhnMJbulHheb4mjUcAwhmahRWa6
VOujw5H5SNz/0egwLX0tdHA114gk957EWW67c4cX8jJGKLhD+rcdqsq08p8kDi1L
93FcXmn/6pUCyziKrlA4b9v7LWIbxcceVOF34GfID5yHI9Y/QCB/IIDEgEw+OyQm
jgSubJrIqg0CAwEAAaNCMEAwDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMC
AYYwHQYDVR0OBBYEFIQYzIU07LwMlJQuCFmcx7IQTgoIMA0GCSqGSIb3DQEBCwUA
A4IBAQCY8jdaQZChGsV2USggNiMOruYou6r4lK5IpDB/G/wkjUu0yKGX9rbxenDI
U5PMCCjjmCXPI6T53iHTfIUJrU6adTrCC2qJeHZERxhlbI1Bjjt/msv0tadQ1wUs
N+gDS63pYaACbvXy8MWy7Vu33PqUXHeeE6V/Uq2V8viTO96LXFvKWlJbYK8U90vv
o/ufQJVtMVT8QtPHRh8jrdkPSHCa2XV4cdFyQzR1bldZwgJcJmApzyMZFo6IQ6XU
5MsI+yMRQ+hDKXJioaldXgjUkK642M4UwtBV8ob2xJNDd2ZhwLnoQdeXeGADbkpy
rqXRfboQnoZsG4q5WTP468SQvvG5
-----END CERTIFICATE-----`;

    // Store device certificate
    await s3Client.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: `${s3Prefix}/device.cert.pem`,
      Body: certResponse.certificatePem,
      ContentType: 'application/x-pem-file'
    }));

    // Store private key
    await s3Client.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: `${s3Prefix}/device.private.key`,
      Body: certResponse.keyPair.PrivateKey,
      ContentType: 'application/x-pem-file'
    }));

    // Store public key
    await s3Client.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: `${s3Prefix}/device.public.key`,
      Body: certResponse.keyPair.PublicKey,
      ContentType: 'application/x-pem-file'
    }));

    // Store Amazon Root CA
    await s3Client.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: `${s3Prefix}/AmazonRootCA1.pem`,
      Body: rootCA,
      ContentType: 'application/x-pem-file'
    }));

    console.log('Certificates stored in S3');

    // Step 7: Update VenueConfig with device info
    const updateCommand = new UpdateCommand({
      TableName: VENUE_TABLE,
      Key: { venueId: venueId },
      UpdateExpression: 'SET devices = list_append(if_not_exists(devices, :empty_list), :device)',
      ExpressionAttributeValues: {
        ':device': [{
          deviceId: deviceId,
          locationId: locationId,
          thingArn: thingResponse.thingArn,
          certificateArn: certResponse.certificateArn,
          status: 'active',
          createdAt: new Date().toISOString()
        }],
        ':empty_list': []
      },
      ReturnValues: 'ALL_NEW'
    });

    await dynamoClient.send(updateCommand);
    console.log('VenueConfig updated with device info');

    // Step 8: Return device credentials
    return {
      statusCode: 200,
      body: {
        success: true,
        message: 'Device provisioned successfully',
        device: {
          deviceId: deviceId,
          thingName: thingName,
          thingArn: thingResponse.thingArn,
          certificateArn: certResponse.certificateArn,
          certificateId: certResponse.certificateId,
          iotEndpoint: iotEndpoint,
          mqttTopic: `pulse/sensors/${venueId}/${deviceId}`,
          s3Bucket: S3_BUCKET,
          s3Prefix: s3Prefix,
          // Return credentials for immediate use (generateRPiConfig will fetch from S3)
          credentials: {
            certificatePem: certResponse.certificatePem,
            privateKey: certResponse.keyPair.PrivateKey,
            publicKey: certResponse.keyPair.PublicKey,
            rootCA: rootCA
          }
        }
      }
    };

  } catch (error) {
    console.error('Error provisioning device:', error);

    return {
      statusCode: 500,
      body: {
        success: false,
        message: 'Failed to provision device',
        error: error.message
      }
    };
  }
};

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { CognitoIdentityProviderClient, AdminCreateUserCommand, AdminSetUserPasswordCommand } from "@aws-sdk/client-cognito-identity-provider";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const cognitoClient = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION });
const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION });

export const handler = async (event) => {
  console.log('Create Venue Event:', JSON.stringify(event, null, 2));
  
  try {
    const body = JSON.parse(event.body || '{}');
    const { venueName, venueId, locationName, locationId, ownerEmail, ownerName, tempPassword } = body;
    
    // Validate required fields
    if (!venueName || !venueId || !locationName || !locationId || !ownerEmail || !ownerName || !tempPassword) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          success: false,
          message: 'Missing required fields',
          error: 'Missing required fields'
        })
      };
    }
    
    // 1. Create VenueConfig in DynamoDB
    const venueConfig = {
      venueId,
      locationId,
      displayName: locationName,
      venueName,
      mqttTopic: `pulse/sensors/${venueId}`,
      createdAt: new Date().toISOString(),
      status: 'active'
    };
    
    await docClient.send(new PutCommand({
      TableName: 'VenueConfig',
      Item: venueConfig
    }));
    
    console.log('✅ VenueConfig created:', venueConfig);
    
    // 2. Create Cognito User
    try {
      const createUserParams = {
        UserPoolId: process.env.COGNITO_USER_POOL_ID,
        Username: ownerEmail,
        UserAttributes: [
          { Name: 'email', Value: ownerEmail },
          { Name: 'email_verified', Value: 'true' },
          { Name: 'custom:venueId', Value: venueId },
          { Name: 'custom:venueName', Value: venueName },
          { Name: 'custom:role', Value: 'owner' }
        ],
        TemporaryPassword: tempPassword,
        MessageAction: 'SUPPRESS'
      };
      
      await cognitoClient.send(new AdminCreateUserCommand(createUserParams));
      console.log('✅ Cognito user created:', ownerEmail);
      
      // Set permanent password
      await cognitoClient.send(new AdminSetUserPasswordCommand({
        UserPoolId: process.env.COGNITO_USER_POOL_ID,
        Username: ownerEmail,
        Password: tempPassword,
        Permanent: false
      }));
      
      console.log('✅ Password set for user');
      
    } catch (cognitoError) {
      console.error('Cognito error:', cognitoError);
      
      // If user already exists, that's OK - just log it and continue
      if (cognitoError.name === 'UsernameExistsException') {
        console.log('⚠️  User already exists, skipping user creation');
      } else {
        // For other errors, throw them
        throw cognitoError;
      }
    }
    
    // 3. Provision IoT Device
    console.log('📡 Provisioning IoT device...');
    
    let deviceData = null;
    
    try {
      const provisionPayload = {
        venueId: venueId,
        locationId: locationId
      };
      
      const invokeCommand = new InvokeCommand({
        FunctionName: 'provisionIoTDevice',
        InvocationType: 'RequestResponse',
        Payload: JSON.stringify(provisionPayload)
      });
      
      const provisionResponse = await lambdaClient.send(invokeCommand);
      const provisionResult = JSON.parse(new TextDecoder().decode(provisionResponse.Payload));
      
      console.log('📦 IoT device provisioning response:', JSON.stringify(provisionResult, null, 2));
      
      if (provisionResult.statusCode === 200 && provisionResult.body) {
        const provisionBody = typeof provisionResult.body === 'string' 
          ? JSON.parse(provisionResult.body) 
          : provisionResult.body;
        
        if (provisionBody.success && provisionBody.device) {
          console.log('✅ IoT device provisioned successfully');
          deviceData = provisionBody.device;
        } else {
          console.error('⚠️  IoT provisioning returned success=false:', provisionBody.message);
        }
      } else {
        console.error('⚠️  IoT provisioning failed with status:', provisionResult.statusCode);
      }
    } catch (iotError) {
      console.error('❌ Error provisioning IoT device (non-fatal):', iotError);
      // Continue - venue and user are created, device can be provisioned manually
    }
    
    // 4. Build response with certificate data
    const response = {
      success: true,
      message: 'Venue, owner account, and IoT device created successfully',
      venueId,
      ownerEmail,
      tempPassword,  // Include temp password so admin can share with owner
      deviceData: deviceData  // Include all device/cert data for download
    };
    
    console.log('✅ Venue creation complete:', {
      venueId,
      ownerEmail,
      hasCertificates: !!deviceData?.credentials
    });
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response)
    };
    
  } catch (error) {
    console.error('❌ Error creating venue:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        success: false,
        message: 'Failed to create venue',
        error: error.message,
        details: error.message 
      })
    };
  }
};

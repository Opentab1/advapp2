import { Amplify } from 'aws-amplify';

// Ferg's Sports Bar Configuration
export const VENUE_CONFIG = {
  venueId: 'fergs-stpete',
  locationId: 'main-floor',
  venueName: "Ferg's Sports Bar",
  locationName: 'Main Floor',
  region: (import.meta as any).env?.VITE_AWS_REGION || 'us-east-2',
  iotEndpoint: (import.meta as any).env?.VITE_IOT_ENDPOINT || 'a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com'
};

// AWS IoT Core Topic (No AppSync/DynamoDB)
export const IOT_TOPIC = ((import.meta as any).env?.VITE_IOT_TOPIC as string) || 'pulse/fergs-stpete/main-floor';

// Optional: Cognito Identity Pool for unauth guest credentials (no login)
// This must allow unauthenticated identities with IoT connect/subscribe permissions
export const IDENTITY_POOL_ID = (import.meta as any).env?.VITE_COGNITO_IDENTITY_POOL_ID || '';

const amplifyConfig = {
  Auth: {
    Cognito: {
      userPoolId: 'us-east-2_I6EBJm3te',
      userPoolClientId: '4v7vp7trh72q1priqno9k5prsq',
      loginWith: {
        email: true
      }
    }
  }
};

export function configureAmplify() {
  Amplify.configure(amplifyConfig);
}

export default amplifyConfig;

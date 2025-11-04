import { Amplify } from 'aws-amplify';

// AWS Configuration (region-specific, not venue-specific)
export const AWS_CONFIG = {
  region: 'us-east-2',
  // Default IoT endpoint for the region (can be overridden by VenueConfig)
  defaultIotEndpoint: 'a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com'
};

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

import { Amplify } from 'aws-amplify';

// Ferg's Sports Bar Configuration
export const VENUE_CONFIG = {
  venueId: 'fergs-stpete',
  locationId: 'main-floor',
  venueName: "Ferg's Sports Bar",
  locationName: 'Main Floor',
  region: 'us-east-2',
  iotEndpoint: 'a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com'
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

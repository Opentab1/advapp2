import { Amplify } from 'aws-amplify';

type GraphQLAuthMode = 'apiKey' | 'iam' | 'userPool' | 'oidc' | 'lambda';

const region = import.meta.env.VITE_AWS_REGION || 'us-east-2';
const defaultIotEndpoint = import.meta.env.VITE_IOT_ENDPOINT || 'a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com';

const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID || 'us-east-2_I6EBJm3te';
const userPoolClientId = import.meta.env.VITE_COGNITO_CLIENT_ID || '4v7vp7trh72q1priqno9k5prsq';
const identityPoolId = import.meta.env.VITE_COGNITO_IDENTITY_POOL_ID;

const graphQLEndpoint = import.meta.env.VITE_APPSYNC_GRAPHQL_ENDPOINT;
const graphQLAuthModeEnv = (import.meta.env.VITE_APPSYNC_AUTH_MODE || '').toLowerCase();
const graphQLApiKey = import.meta.env.VITE_APPSYNC_API_KEY;

const resolveAuthMode = (): GraphQLAuthMode => {
  switch (graphQLAuthModeEnv) {
    case 'iam':
      return 'iam';
    case 'apikey':
    case 'api-key':
      return 'apiKey';
    case 'lambda':
      return 'lambda';
    case 'oidc':
      return 'oidc';
    case 'userpool':
    case 'cognito':
    default:
      return 'userPool';
  }
};

const amplifyConfig: Record<string, any> = {
  Auth: {
    Cognito: {
      userPoolId,
      userPoolClientId,
      ...(identityPoolId ? { identityPoolId } : {}),
      loginWith: {
        email: true
      }
    }
  }
};

if (graphQLEndpoint) {
  const defaultAuthMode = resolveAuthMode();
  amplifyConfig.API = {
    GraphQL: {
      endpoint: graphQLEndpoint,
      region,
      defaultAuthMode,
      ...(defaultAuthMode === 'apiKey' && graphQLApiKey ? { apiKey: graphQLApiKey } : {})
    }
  };
} else {
  if (import.meta.env.DEV) {
    console.warn('[Amplify] GraphQL endpoint not configured. Location lookups will fail.');
  }
}

// AWS Configuration (region-specific, not venue-specific)
export const AWS_CONFIG = {
  region,
  // Default IoT endpoint for the region (can be overridden by VenueConfig)
  defaultIotEndpoint
};

export function configureAmplify() {
  Amplify.configure(amplifyConfig);
}

export default amplifyConfig;

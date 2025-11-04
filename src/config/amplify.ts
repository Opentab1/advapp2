import { Amplify } from 'aws-amplify';

const DEFAULT_REGION = 'us-east-2';
const DEFAULT_USER_POOL_ID = 'us-east-2_I6EBJm3te';
const DEFAULT_USER_POOL_CLIENT_ID = '4v7vp7trh72q1priqno9k5prsq';
const DEFAULT_IOT_ENDPOINT = 'a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com';

function extractRegionFromEndpoint(endpoint?: string): string | undefined {
  if (!endpoint) return undefined;

  try {
    const url = new URL(endpoint);
    const host = url.host;
    const match = host.match(/appsync(?:-realtime)?-api\.([a-z0-9-]+)\.amazonaws\.com/i);
    if (match?.[1]) {
      return match[1];
    }
  } catch (error) {
    console.warn('Unable to parse AppSync endpoint for region detection:', error);
  }

  return undefined;
}

const {
  VITE_AWS_REGION,
  VITE_GRAPHQL_ENDPOINT,
  VITE_COGNITO_USER_POOL_ID,
  VITE_COGNITO_CLIENT_ID,
  VITE_IOT_ENDPOINT,
  VITE_SENSOR_DATA_TABLE,
  VITE_VENUE_CONFIG_TABLE,
  VITE_OCCUPANCY_METRICS_TABLE
} = import.meta.env;

const endpointRegion = extractRegionFromEndpoint(VITE_GRAPHQL_ENDPOINT);
const resolvedRegion = (VITE_AWS_REGION?.trim() || endpointRegion || DEFAULT_REGION).trim();
const userPoolId = (VITE_COGNITO_USER_POOL_ID?.trim() || DEFAULT_USER_POOL_ID).trim();
const userPoolClientId = (VITE_COGNITO_CLIENT_ID?.trim() || DEFAULT_USER_POOL_CLIENT_ID).trim();
const iotEndpoint = (VITE_IOT_ENDPOINT?.trim() || DEFAULT_IOT_ENDPOINT).trim();

if (!VITE_COGNITO_USER_POOL_ID || !VITE_COGNITO_CLIENT_ID) {
  console.warn('Using default Cognito configuration. Set VITE_COGNITO_USER_POOL_ID and VITE_COGNITO_CLIENT_ID in your environment to override.');
}

if (!VITE_AWS_REGION && !endpointRegion) {
  console.warn('AWS region not provided. Falling back to default region:', DEFAULT_REGION);
}

if (!VITE_GRAPHQL_ENDPOINT) {
  console.warn('GraphQL endpoint not configured. Set VITE_GRAPHQL_ENDPOINT to enable DynamoDB/AppSync access.');
}

// AWS Configuration (region-specific, not venue-specific)
export const AWS_CONFIG = {
  region: resolvedRegion,
  // Default IoT endpoint for the region (can be overridden by VenueConfig)
  defaultIotEndpoint: iotEndpoint,
  // DynamoDB table names
  sensorDataTable: VITE_SENSOR_DATA_TABLE || 'SensorData',
  venueConfigTable: VITE_VENUE_CONFIG_TABLE || 'VenueConfig',
  occupancyMetricsTable: VITE_OCCUPANCY_METRICS_TABLE || 'OccupancyMetrics'
};

const amplifyConfig = {
  Auth: {
    Cognito: {
      userPoolId,
      userPoolClientId,
      loginWith: {
        email: true
      }
    }
  },
  API: {
    GraphQL: {
      endpoint: VITE_GRAPHQL_ENDPOINT || '',
      region: resolvedRegion,
      defaultAuthMode: 'userPool'
    }
  }
};

export function configureAmplify() {
  Amplify.configure(amplifyConfig);
}

export default amplifyConfig;

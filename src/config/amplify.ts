import { Amplify } from 'aws-amplify';

// AWS Configuration (region-specific, not venue-specific)
export const AWS_CONFIG = {
  region: 'us-east-2',
  // Default IoT endpoint for the region (can be overridden by VenueConfig)
  defaultIotEndpoint: 'a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com',
  // DynamoDB table names
  sensorDataTable: import.meta.env.VITE_SENSOR_DATA_TABLE || 'SensorData',
  venueConfigTable: import.meta.env.VITE_VENUE_CONFIG_TABLE || 'VenueConfig',
  occupancyMetricsTable: import.meta.env.VITE_OCCUPANCY_METRICS_TABLE || 'OccupancyMetrics'
};

const amplifyConfig = {
  Auth: {
    Cognito: {
      userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID || 'us-east-2_sMY1wYEF9',
      userPoolClientId: import.meta.env.VITE_COGNITO_CLIENT_ID || '4v7vp7trh72q1priqno9k5prsq',
      loginWith: {
        email: true
      }
    }
  },
  API: {
    GraphQL: {
      endpoint: import.meta.env.VITE_GRAPHQL_ENDPOINT || '',
      region: 'us-east-2',
      defaultAuthMode: 'userPool' as const
    }
  },
  PubSub: {
    region: 'us-east-2',
    endpoint: `wss://${AWS_CONFIG.defaultIotEndpoint}/mqtt`
  }
};

export function configureAmplify() {
  // Validate GraphQL endpoint configuration before initializing
  const endpoint = import.meta.env.VITE_GRAPHQL_ENDPOINT;
  if (!endpoint || endpoint.trim() === '' || endpoint.includes('your-appsync-api')) {
    console.error('❌ CONFIGURATION ERROR: VITE_GRAPHQL_ENDPOINT is not configured properly in .env file');
    console.error('   Please create a .env file based on .env.example and set your AppSync GraphQL endpoint');
    console.error('   Example: VITE_GRAPHQL_ENDPOINT=https://xxxxx.appsync-api.us-east-2.amazonaws.com/graphql');
  }
  
  Amplify.configure(amplifyConfig);
  
  console.log('✅ Amplify configured successfully');
  console.log('   User Pool ID:', import.meta.env.VITE_COGNITO_USER_POOL_ID || 'NOT SET');
  console.log('   GraphQL Endpoint:', endpoint ? endpoint.substring(0, 40) + '...' : 'NOT SET');
  console.log('   IoT MQTT Endpoint:', AWS_CONFIG.defaultIotEndpoint);
}

export default amplifyConfig;

import { generateClient } from '@aws-amplify/api';
import { fetchAuthSession } from '@aws-amplify/auth';
import type { SensorData, TimeRange, HistoricalData, OccupancyMetrics } from '../types';

// GraphQL queries for DynamoDB
const getSensorData = /* GraphQL */ `
  query GetSensorData($venueId: ID!, $timestamp: String!) {
    getSensorData(venueId: $venueId, timestamp: $timestamp) {
      venueId
      timestamp
      decibels
      light
      indoorTemp
      outdoorTemp
      humidity
      currentSong
      albumArt
      artist
      occupancy {
        current
        entries
        exits
        capacity
      }
    }
  }
`;

const listSensorData = /* GraphQL */ `
  query ListSensorData($venueId: ID!, $startTime: String!, $endTime: String!, $limit: Int) {
    listSensorData(venueId: $venueId, startTime: $startTime, endTime: $endTime, limit: $limit) {
      items {
        venueId
        timestamp
        decibels
        light
        indoorTemp
        outdoorTemp
        humidity
        currentSong
        albumArt
        artist
        occupancy {
          current
          entries
          exits
          capacity
        }
      }
      nextToken
    }
  }
`;

const getOccupancyMetricsQuery = /* GraphQL */ `
  query GetOccupancyMetrics($venueId: ID!) {
    getOccupancyMetrics(venueId: $venueId) {
      current
      todayEntries
      todayExits
      peakOccupancy
      peakTime
      sevenDayAvg
      fourteenDayAvg
      thirtyDayAvg
    }
  }
`;

class DynamoDBService {

  private getClient() {
    return generateClient();
  }

  /**
   * Check if GraphQL endpoint is configured
   */
  private checkGraphQLEndpoint(): void {
    const endpoint = import.meta.env.VITE_GRAPHQL_ENDPOINT;
    if (!endpoint || endpoint.trim() === '' || endpoint.includes('your-appsync-api')) {
      throw new Error(
        'GraphQL endpoint not configured. Please set VITE_GRAPHQL_ENDPOINT in your .env file. ' +
        'See DYNAMODB_SETUP.md for instructions on how to set up your AppSync API endpoint.'
      );
    }
  }

  /**
   * Extract error message from various error types
   */
  private extractErrorMessage(error: any): string {
    if (error?.message) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    if (error?.error?.message) {
      return error.error.message;
    }
    if (error?.errors && Array.isArray(error.errors) && error.errors.length > 0) {
      return error.errors.map((e: any) => e.message || e).join(', ');
    }
    // Check for GraphQL errors
    if (error?.data?.errors) {
      return error.data.errors.map((e: any) => e.message || e).join(', ');
    }
    // Check for network errors
    if (error?.name === 'NetworkError' || error?.code === 'NETWORK_ERROR') {
      return 'Network error: Unable to connect to GraphQL endpoint. Check your VITE_GRAPHQL_ENDPOINT configuration.';
    }
    return error?.toString() || 'Unknown error occurred';
  }

  /**
   * Check if error is already wrapped to avoid double-wrapping
   */
  private isAlreadyWrapped(errorMessage: string, prefix: string): boolean {
    return errorMessage.startsWith(prefix) || errorMessage.includes('Failed to fetch');
  }

  /**
   * Get the most recent sensor data for a venue
   */
  async getLiveSensorData(venueId: string): Promise<SensorData> {
    console.log('🔍 Fetching live sensor data from DynamoDB for venue:', venueId);
    
    try {
      // Check if GraphQL endpoint is configured
      this.checkGraphQLEndpoint();

      // Verify authentication
      const session = await fetchAuthSession();
      console.log('🔐 Auth session details:', {
        hasTokens: !!session.tokens,
        hasIdToken: !!session.tokens?.idToken,
        hasAccessToken: !!session.tokens?.accessToken,
        tokenType: session.tokens?.idToken?.payload ? 'JWT' : 'none',
        venueId: session.tokens?.idToken?.payload?.['custom:venueId']
      });
      
      if (!session.tokens) {
        throw new Error('Not authenticated. Please log in again.');
      }

      const client = this.getClient();
      const endpoint = import.meta.env.VITE_GRAPHQL_ENDPOINT;
      console.log('📡 GraphQL Request Details:', {
        endpoint: endpoint ? endpoint.substring(0, 50) + '...' : 'NOT SET',
        query: 'listSensorData',
        venueId,
        authMode: 'userPool'
      });

      // Query DynamoDB for the most recent data
      // Since we don't have the exact timestamp, we'll query for recent data
      const endTime = new Date().toISOString();
      const startTime = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // Last 5 minutes
      
      const response = await client.graphql({
        query: listSensorData,
        variables: { 
          venueId, 
          startTime,
          endTime,
          limit: 1 // Get only the most recent
        },
        authMode: 'userPool'
      }) as any;

      // Check for GraphQL errors in response
      if (response?.errors && response.errors.length > 0) {
        console.error('❌ GraphQL Response Errors:', {
          errors: response.errors,
          fullResponse: JSON.stringify(response, null, 2)
        });
        const errorMessages = response.errors.map((e: any) => e.message || e).join(', ');
        throw new Error(`GraphQL error: ${errorMessages}`);
      }

      const items = response?.data?.listSensorData?.items || [];
      
      if (items.length === 0) {
        throw new Error(`No sensor data found for venue: ${venueId}. Please ensure your IoT devices are publishing data to DynamoDB.`);
      }

      const latestData = items[0];
      console.log('✅ Live sensor data retrieved from DynamoDB');
      
      return this.transformDynamoDBData(latestData);
    } catch (error: any) {
      console.error('❌ Failed to fetch live sensor data from DynamoDB');
      console.error('🔍 Full Error Object:', {
        name: error?.name,
        message: error?.message,
        code: error?.code,
        statusCode: error?.statusCode,
        errorType: error?.errorType,
        errorInfo: error?.errorInfo,
        underlyingError: error?.underlyingError,
        errors: error?.errors,
        data: error?.data,
        stack: error?.stack,
        fullError: JSON.stringify(error, Object.getOwnPropertyNames(error), 2)
      });
      
      // Log network-level details if available
      if (error?.name === 'NetworkError' || error?.code === 'NETWORK_ERROR') {
        console.error('🌐 Network Error Details:', {
          endpoint: import.meta.env.VITE_GRAPHQL_ENDPOINT,
          message: error.message
        });
      }
      
      const errorMessage = this.extractErrorMessage(error);
      // Avoid double-wrapping error messages
      if (this.isAlreadyWrapped(errorMessage, 'Failed to fetch live data')) {
        throw error; // Re-throw original error if already wrapped
      }
      throw new Error(`Failed to fetch live data from DynamoDB: ${errorMessage}`);
    }
  }

  /**
   * Get historical sensor data for a venue within a time range
   */
  async getHistoricalSensorData(venueId: string, range: TimeRange): Promise<HistoricalData> {
    console.log('🔍 Fetching historical sensor data from DynamoDB for venue:', venueId, 'range:', range);
    
    try {
      // Check if GraphQL endpoint is configured
      this.checkGraphQLEndpoint();

      // Verify authentication
      const session = await fetchAuthSession();
      if (!session.tokens) {
        throw new Error('Not authenticated. Please log in again.');
      }

      const { startTime, endTime } = this.getTimeRangeValues(range);
      const client = this.getClient();

      const response = await client.graphql({
        query: listSensorData,
        variables: { 
          venueId, 
          startTime,
          endTime,
          limit: 1000 // Adjust based on your needs
        },
        authMode: 'userPool'
      }) as any;

      // Check for GraphQL errors in response
      if (response?.errors && response.errors.length > 0) {
        console.error('❌ GraphQL Response Errors:', {
          errors: response.errors,
          fullResponse: JSON.stringify(response, null, 2)
        });
        const errorMessages = response.errors.map((e: any) => e.message || e).join(', ');
        throw new Error(`GraphQL error: ${errorMessages}`);
      }

      const items = response?.data?.listSensorData?.items || [];
      
      if (items.length === 0) {
        throw new Error(`No historical data found for venue: ${venueId} in the specified time range.`);
      }

      console.log(`✅ Retrieved ${items.length} historical data points from DynamoDB`);
      
      const transformedData = items.map((item: any) => this.transformDynamoDBData(item));
      
      return {
        data: transformedData,
        venueId,
        range
      };
    } catch (error: any) {
      console.error('❌ Failed to fetch historical sensor data from DynamoDB');
      console.error('🔍 Full Error Object:', {
        name: error?.name,
        message: error?.message,
        code: error?.code,
        statusCode: error?.statusCode,
        errorType: error?.errorType,
        errors: error?.errors,
        data: error?.data,
        fullError: JSON.stringify(error, Object.getOwnPropertyNames(error), 2)
      });
      const errorMessage = this.extractErrorMessage(error);
      // Avoid double-wrapping error messages
      if (this.isAlreadyWrapped(errorMessage, 'Failed to fetch historical data')) {
        throw error; // Re-throw original error if already wrapped
      }
      throw new Error(`Failed to fetch historical data from DynamoDB: ${errorMessage}`);
    }
  }

  /**
   * Get occupancy metrics for a venue
   */
  async getOccupancyMetrics(venueId: string): Promise<OccupancyMetrics> {
    console.log('🔍 Fetching occupancy metrics from DynamoDB for venue:', venueId);
    
    try {
      // Check if GraphQL endpoint is configured
      this.checkGraphQLEndpoint();

      // Verify authentication
      const session = await fetchAuthSession();
      if (!session.tokens) {
        throw new Error('Not authenticated. Please log in again.');
      }

      const client = this.getClient();

      const response = await client.graphql({
        query: getOccupancyMetricsQuery,
        variables: { venueId },
        authMode: 'userPool'
      }) as any;

      // Check for GraphQL errors in response
      if (response?.errors && response.errors.length > 0) {
        console.error('❌ GraphQL Response Errors:', {
          errors: response.errors,
          fullResponse: JSON.stringify(response, null, 2)
        });
        // Log detailed error information
        response.errors.forEach((error: any, index: number) => {
          console.error(`Error ${index + 1}:`, {
            message: error.message,
            errorType: error.errorType,
            errorInfo: error.errorInfo,
            data: error.data,
            path: error.path,
            locations: error.locations,
            extensions: error.extensions,
            fullError: JSON.stringify(error, Object.getOwnPropertyNames(error), 2)
          });
        });
        const errorMessages = response.errors.map((e: any) => e.message || e).join(', ');
        throw new Error(`GraphQL error: ${errorMessages}`);
      }

      const metrics = response?.data?.getOccupancyMetrics;
      
      if (!metrics) {
        throw new Error(`No occupancy metrics found for venue: ${venueId}`);
      }

      console.log('✅ Occupancy metrics retrieved from DynamoDB');
      
      return metrics;
    } catch (error: any) {
      console.error('❌ Failed to fetch occupancy metrics from DynamoDB');
      console.error('🔍 Full Error Object:', {
        name: error?.name,
        message: error?.message,
        code: error?.code,
        statusCode: error?.statusCode,
        errorType: error?.errorType,
        errors: error?.errors,
        data: error?.data,
        fullError: JSON.stringify(error, Object.getOwnPropertyNames(error), 2)
      });
      const errorMessage = this.extractErrorMessage(error);
      // Avoid double-wrapping error messages
      if (this.isAlreadyWrapped(errorMessage, 'Failed to fetch occupancy metrics')) {
        throw error; // Re-throw original error if already wrapped
      }
      throw new Error(`Failed to fetch occupancy metrics from DynamoDB: ${errorMessage}`);
    }
  }

  /**
   * Transform DynamoDB item to SensorData format
   */
  private transformDynamoDBData(item: any): SensorData {
    return {
      timestamp: item.timestamp || new Date().toISOString(),
      decibels: item.decibels || 0,
      light: item.light || 0,
      indoorTemp: item.indoorTemp || 0,
      outdoorTemp: item.outdoorTemp || 0,
      humidity: item.humidity || 0,
      currentSong: item.currentSong,
      albumArt: item.albumArt,
      artist: item.artist,
      occupancy: item.occupancy ? {
        current: item.occupancy.current || 0,
        entries: item.occupancy.entries || 0,
        exits: item.occupancy.exits || 0,
        capacity: item.occupancy.capacity
      } : undefined
    };
  }

  /**
   * Calculate start and end times for a given time range
   */
  private getTimeRangeValues(range: TimeRange): { startTime: string; endTime: string } {
    const endTime = new Date().toISOString();
    let startTime: string;

    switch (range) {
      case 'live':
        startTime = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // Last 5 minutes
        break;
      case '6h':
        startTime = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
        break;
      case '24h':
        startTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        break;
      case '7d':
        startTime = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        break;
      case '30d':
        startTime = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        break;
      case '90d':
        startTime = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
        break;
      default:
        startTime = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    }

    return { startTime, endTime };
  }
}

export default new DynamoDBService();

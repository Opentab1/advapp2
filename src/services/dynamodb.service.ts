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
  private client = generateClient();

  /**
   * Extract error message from various error formats
   */
  private extractErrorMessage(error: any): string {
    // Check if GraphQL endpoint is configured
    const graphqlEndpoint = import.meta.env.VITE_GRAPHQL_ENDPOINT;
    if (!graphqlEndpoint || graphqlEndpoint === '' || graphqlEndpoint.includes('your-appsync-api')) {
      return 'GraphQL API endpoint not configured. Please set VITE_GRAPHQL_ENDPOINT in your .env file. See DYNAMODB_SETUP.md for instructions.';
    }

    // Handle GraphQL errors (array format)
    if (error.errors && Array.isArray(error.errors) && error.errors.length > 0) {
      const firstError = error.errors[0];
      return firstError.message || firstError.errorInfo || JSON.stringify(firstError);
    }

    // Handle network errors
    if (error.message) {
      if (error.message.includes('NetworkError') || error.message.includes('fetch')) {
        return `Network error: Unable to reach GraphQL endpoint. Check that ${graphqlEndpoint} is correct and accessible.`;
      }
      return error.message;
    }

    // Handle error objects with different structures
    if (error.errorInfo) {
      return error.errorInfo;
    }

    if (error.error) {
      return typeof error.error === 'string' ? error.error : error.error.message || JSON.stringify(error.error);
    }

    // Last resort: stringify the error
    return typeof error === 'string' ? error : JSON.stringify(error) || 'Unknown error occurred';
  }

  /**
   * Get the most recent sensor data for a venue
   */
  async getLiveSensorData(venueId: string): Promise<SensorData> {
    console.log('🔍 Fetching live sensor data from DynamoDB for venue:', venueId);
    
    try {
      // Check GraphQL endpoint configuration
      const graphqlEndpoint = import.meta.env.VITE_GRAPHQL_ENDPOINT;
      if (!graphqlEndpoint || graphqlEndpoint === '' || graphqlEndpoint.includes('your-appsync-api')) {
        throw new Error('GraphQL API endpoint not configured. Please set VITE_GRAPHQL_ENDPOINT in your .env file.');
      }

      // Verify authentication
      const session = await fetchAuthSession();
      if (!session.tokens) {
        throw new Error('Not authenticated. Please log in again.');
      }

      // Query DynamoDB for the most recent data
      // Since we don't have the exact timestamp, we'll query for recent data
      const endTime = new Date().toISOString();
      const startTime = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // Last 5 minutes
      
      const response = await this.client.graphql({
        query: listSensorData,
        variables: { 
          venueId, 
          startTime,
          endTime,
          limit: 1 // Get only the most recent
        }
      }) as any;

      // Check for GraphQL errors in response
      if (response.errors && Array.isArray(response.errors) && response.errors.length > 0) {
        const errorMsg = this.extractErrorMessage({ errors: response.errors });
        throw new Error(errorMsg);
      }

      const items = response?.data?.listSensorData?.items || [];
      
      if (items.length === 0) {
        throw new Error(`No sensor data found for venue: ${venueId}. Please ensure your IoT devices are publishing data to DynamoDB.`);
      }

      const latestData = items[0];
      console.log('✅ Live sensor data retrieved from DynamoDB');
      
      return this.transformDynamoDBData(latestData);
    } catch (error: any) {
      console.error('❌ Failed to fetch live sensor data from DynamoDB:', error);
      const errorMessage = this.extractErrorMessage(error);
      throw new Error(`Failed to fetch live data from DynamoDB: ${errorMessage}`);
    }
  }

  /**
   * Get historical sensor data for a venue within a time range
   */
  async getHistoricalSensorData(venueId: string, range: TimeRange): Promise<HistoricalData> {
    console.log('🔍 Fetching historical sensor data from DynamoDB for venue:', venueId, 'range:', range);
    
    try {
      // Check GraphQL endpoint configuration
      const graphqlEndpoint = import.meta.env.VITE_GRAPHQL_ENDPOINT;
      if (!graphqlEndpoint || graphqlEndpoint === '' || graphqlEndpoint.includes('your-appsync-api')) {
        throw new Error('GraphQL API endpoint not configured. Please set VITE_GRAPHQL_ENDPOINT in your .env file.');
      }

      // Verify authentication
      const session = await fetchAuthSession();
      if (!session.tokens) {
        throw new Error('Not authenticated. Please log in again.');
      }

      const { startTime, endTime } = this.getTimeRangeValues(range);
      
      const response = await this.client.graphql({
        query: listSensorData,
        variables: { 
          venueId, 
          startTime,
          endTime,
          limit: 1000 // Adjust based on your needs
        }
      }) as any;

      // Check for GraphQL errors in response
      if (response.errors && Array.isArray(response.errors) && response.errors.length > 0) {
        const errorMsg = this.extractErrorMessage({ errors: response.errors });
        throw new Error(errorMsg);
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
      console.error('❌ Failed to fetch historical sensor data from DynamoDB:', error);
      const errorMessage = this.extractErrorMessage(error);
      throw new Error(`Failed to fetch historical data from DynamoDB: ${errorMessage}`);
    }
  }

  /**
   * Get occupancy metrics for a venue
   */
  async getOccupancyMetrics(venueId: string): Promise<OccupancyMetrics> {
    console.log('🔍 Fetching occupancy metrics from DynamoDB for venue:', venueId);
    
    try {
      // Check GraphQL endpoint configuration
      const graphqlEndpoint = import.meta.env.VITE_GRAPHQL_ENDPOINT;
      if (!graphqlEndpoint || graphqlEndpoint === '' || graphqlEndpoint.includes('your-appsync-api')) {
        throw new Error('GraphQL API endpoint not configured. Please set VITE_GRAPHQL_ENDPOINT in your .env file.');
      }

      // Verify authentication
      const session = await fetchAuthSession();
      if (!session.tokens) {
        throw new Error('Not authenticated. Please log in again.');
      }

      const response = await this.client.graphql({
        query: getOccupancyMetricsQuery,
        variables: { venueId }
      }) as any;

      // Check for GraphQL errors in response
      if (response.errors && Array.isArray(response.errors) && response.errors.length > 0) {
        const errorMsg = this.extractErrorMessage({ errors: response.errors });
        throw new Error(errorMsg);
      }

      const metrics = response?.data?.getOccupancyMetrics;
      
      if (!metrics) {
        throw new Error(`No occupancy metrics found for venue: ${venueId}`);
      }

      console.log('✅ Occupancy metrics retrieved from DynamoDB');
      
      return metrics;
    } catch (error: any) {
      console.error('❌ Failed to fetch occupancy metrics from DynamoDB:', error);
      const errorMessage = this.extractErrorMessage(error);
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

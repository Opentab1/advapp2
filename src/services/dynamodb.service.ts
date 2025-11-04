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
   * Get the most recent sensor data for a venue
   */
  async getLiveSensorData(venueId: string): Promise<SensorData> {
    console.log('🔍 Fetching live sensor data from DynamoDB for venue:', venueId);
    
    try {
      // Verify authentication
      const session = await fetchAuthSession();
      if (!session.tokens) {
        throw new Error('Not authenticated');
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

      const items = response?.data?.listSensorData?.items || [];
      
      if (items.length === 0) {
        throw new Error(`No sensor data found for venue: ${venueId}. Please ensure your IoT devices are publishing data to DynamoDB.`);
      }

      const latestData = items[0];
      console.log('✅ Live sensor data retrieved from DynamoDB');
      
      return this.transformDynamoDBData(latestData);
    } catch (error: any) {
      console.error('❌ Failed to fetch live sensor data from DynamoDB:', error);
      throw new Error(`Failed to fetch live data from DynamoDB: ${error.message}`);
    }
  }

  /**
   * Get historical sensor data for a venue within a time range
   */
  async getHistoricalSensorData(venueId: string, range: TimeRange): Promise<HistoricalData> {
    console.log('🔍 Fetching historical sensor data from DynamoDB for venue:', venueId, 'range:', range);
    
    try {
      // Verify authentication
      const session = await fetchAuthSession();
      if (!session.tokens) {
        throw new Error('Not authenticated');
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
      throw new Error(`Failed to fetch historical data from DynamoDB: ${error.message}`);
    }
  }

  /**
   * Get occupancy metrics for a venue
   */
  async getOccupancyMetrics(venueId: string): Promise<OccupancyMetrics> {
    console.log('🔍 Fetching occupancy metrics from DynamoDB for venue:', venueId);
    
    try {
      // Verify authentication
      const session = await fetchAuthSession();
      if (!session.tokens) {
        throw new Error('Not authenticated');
      }

      const response = await this.client.graphql({
        query: getOccupancyMetricsQuery,
        variables: { venueId }
      }) as any;

      const metrics = response?.data?.getOccupancyMetrics;
      
      if (!metrics) {
        throw new Error(`No occupancy metrics found for venue: ${venueId}`);
      }

      console.log('✅ Occupancy metrics retrieved from DynamoDB');
      
      return metrics;
    } catch (error: any) {
      console.error('❌ Failed to fetch occupancy metrics from DynamoDB:', error);
      throw new Error(`Failed to fetch occupancy metrics from DynamoDB: ${error.message}`);
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

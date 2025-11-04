import type { SensorData, TimeRange, HistoricalData, OccupancyMetrics } from '../types';
import { generateClient } from '@aws-amplify/api';
import { getCurrentUser, fetchAuthSession } from '@aws-amplify/auth';

// GraphQL queries for DynamoDB
const getLatestSensorData = /* GraphQL */ `
  query GetLatestSensorData($venueId: ID!) {
    getLatestSensorData(venueId: $venueId) {
      timestamp
      venueId
      sound_level
      light_level
      indoor_temperature
      outdoor_temperature
      humidity
      current_song
      album_art
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

const listSensorDataByVenue = /* GraphQL */ `
  query ListSensorDataByVenue($venueId: ID!, $startTime: String!, $endTime: String!) {
    listSensorDataByVenue(venueId: $venueId, startTime: $startTime, endTime: $endTime) {
      items {
        timestamp
        venueId
        sound_level
        light_level
        indoor_temperature
        outdoor_temperature
        humidity
        current_song
        album_art
        artist
        occupancy {
          current
          entries
          exits
          capacity
        }
      }
    }
  }
`;

const getOccupancyMetricsQuery = /* GraphQL */ `
  query GetOccupancyMetrics($venueId: ID!) {
    getOccupancyMetrics(venueId: $venueId) {
      current
      todayEntries
      todayExits
      todayTotal
      sevenDayAvg
      fourteenDayAvg
      thirtyDayAvg
      peakOccupancy
      peakTime
    }
  }
`;

class ApiService {
  private async getVenueId(): Promise<string> {
    try {
      await getCurrentUser();
      const session = await fetchAuthSession();
      const payload = session.tokens?.idToken?.payload;
      const venueId = payload?.['custom:venueId'] as string;
      
      if (!venueId) {
        throw new Error('User does not have custom:venueId attribute. Please contact administrator.');
      }
      
      return venueId;
    } catch (error: any) {
      console.error('Failed to get venueId from Cognito:', error);
      throw new Error('User must be logged in with custom:venueId attribute');
    }
  }

  private getRangeDays(range: TimeRange): number {
    const rangeMap: Record<TimeRange, number> = {
      'live': 0,
      '6h': 0.25,
      '24h': 1,
      '7d': 7,
      '30d': 30,
      '90d': 90
    };
    return rangeMap[range];
  }

  private transformDynamoDBData(item: any): SensorData {
    return {
      timestamp: item.timestamp || new Date().toISOString(),
      decibels: item.sound_level || item.decibels || 0,
      light: item.light_level || item.light || 0,
      indoorTemp: item.indoor_temperature || item.indoorTemp || 0,
      outdoorTemp: item.outdoor_temperature || item.outdoorTemp || 0,
      humidity: item.humidity || 0,
      currentSong: item.current_song || item.currentSong,
      albumArt: item.album_art || item.albumArt,
      artist: item.artist,
      occupancy: item.occupancy ? {
        current: item.occupancy.current || 0,
        entries: item.occupancy.entries || 0,
        exits: item.occupancy.exits || 0,
        capacity: item.occupancy.capacity
      } : undefined
    };
  }

  async getHistoricalData(venueId: string, range: TimeRange): Promise<HistoricalData> {
    const days = this.getRangeDays(range);
    
    console.log(`🔍 Fetching historical data from DynamoDB for venueId: ${venueId}, range: ${range} (${days} days)`);
    
    try {
      // Calculate time range
      const endTime = new Date().toISOString();
      const startTime = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

      // Query DynamoDB via GraphQL
      const client = generateClient();
      const response = await client.graphql({
        query: listSensorDataByVenue,
        variables: {
          venueId,
          startTime,
          endTime
        }
      }) as any;

      const items = response?.data?.listSensorDataByVenue?.items || [];
      
      console.log(`✅ Retrieved ${items.length} historical records from DynamoDB`);
      
      // Transform DynamoDB data to SensorData format
      const sensorData = items.map((item: any) => this.transformDynamoDBData(item));
      
      // Sort by timestamp (oldest first)
      sensorData.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      
      return {
        data: sensorData,
        venueId,
        range
      };
    } catch (error: any) {
      console.error('❌ Historical data DynamoDB query failed:', error);
      throw new Error(`Failed to fetch historical data from DynamoDB: ${error.message}`);
    }
  }

  async getLiveData(venueId: string): Promise<SensorData> {
    console.log(`🔍 Fetching live data from DynamoDB for venueId: ${venueId}`);
    
    try {
      // Query DynamoDB for the latest sensor data
      const client = generateClient();
      const response = await client.graphql({
        query: getLatestSensorData,
        variables: { venueId }
      }) as any;

      const item = response?.data?.getLatestSensorData;
      
      if (!item) {
        throw new Error(`No sensor data found in DynamoDB for venueId: ${venueId}`);
      }

      console.log('✅ Live data received from DynamoDB');
      return this.transformDynamoDBData(item);
    } catch (error: any) {
      console.error('❌ Live data DynamoDB query failed:', error);
      throw new Error(`Failed to fetch live data from DynamoDB: ${error.message}`);
    }
  }

  exportToCSV(data: SensorData[], includeComfort: boolean = true): void {
    const headers = includeComfort 
      ? ['Timestamp', 'Decibels', 'Light', 'Indoor Temp', 'Outdoor Temp', 'Humidity', 'Comfort Score', 'Comfort Status', 'Song', 'Artist']
      : ['Timestamp', 'Decibels', 'Light', 'Indoor Temp', 'Outdoor Temp', 'Humidity', 'Song', 'Artist'];
    
    const rows = data.map(d => {
      const comfort = includeComfort ? this.calculateComfort(d) : null;
      const baseRow = [
        d.timestamp,
        d.decibels.toFixed(1),
        d.light.toFixed(1),
        d.indoorTemp.toFixed(1),
        d.outdoorTemp.toFixed(1),
        d.humidity.toFixed(1)
      ];
      
      if (includeComfort && comfort) {
        baseRow.push(comfort.score.toString(), comfort.status);
      }
      
      baseRow.push(d.currentSong || '', d.artist || '');
      return baseRow;
    });

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    this.downloadFile(csvContent, `fergs-sports-bar-data-${new Date().toISOString()}.csv`, 'text/csv');
  }

  exportToJSON(data: SensorData[]): void {
    const jsonContent = JSON.stringify(data, null, 2);
    this.downloadFile(jsonContent, `fergs-sports-bar-data-${new Date().toISOString()}.json`, 'application/json');
  }

  private downloadFile(content: string, filename: string, mimeType: string): void {
    const blob = new Blob([content], { type: `${mimeType};charset=utf-8;` });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  private calculateComfort(data: SensorData): { score: number; status: string } {
    // Quick comfort calculation for export
    const tempScore = this.scoreInRange(data.indoorTemp, 68, 74);
    const humidityScore = this.scoreInRange(data.humidity, 40, 60);
    const soundScore = this.scoreInRange(data.decibels, 65, 80);
    const lightScore = this.scoreInRange(data.light, 200, 500);
    
    const overall = (tempScore * 0.35 + humidityScore * 0.30 + soundScore * 0.20 + lightScore * 0.15);
    
    let status = 'poor';
    if (overall >= 80) status = 'excellent';
    else if (overall >= 65) status = 'good';
    else if (overall >= 50) status = 'fair';
    
    return { score: Math.round(overall), status };
  }

  private scoreInRange(value: number, min: number, max: number): number {
    if (value >= min && value <= max) return 100;
    const distance = value < min ? min - value : value - max;
    return Math.max(0, 100 - distance * 10);
  }

  async getOccupancyMetrics(venueId: string): Promise<OccupancyMetrics> {
    console.log(`🔍 Fetching occupancy metrics from DynamoDB for venueId: ${venueId}`);
    
    try {
      // Query DynamoDB for occupancy metrics
      const client = generateClient();
      const response = await client.graphql({
        query: getOccupancyMetricsQuery,
        variables: { venueId }
      }) as any;

      const metrics = response?.data?.getOccupancyMetrics;
      
      if (!metrics) {
        throw new Error(`No occupancy metrics found in DynamoDB for venueId: ${venueId}`);
      }

      console.log('✅ Occupancy metrics received from DynamoDB');
      return metrics;
    } catch (error: any) {
      console.error('❌ Occupancy metrics DynamoDB query failed:', error);
      throw new Error(`Failed to fetch occupancy metrics from DynamoDB: ${error.message}`);
    }
  }
}

export default new ApiService();

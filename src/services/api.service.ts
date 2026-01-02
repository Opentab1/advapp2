import type { SensorData, TimeRange, HistoricalData, OccupancyMetrics } from '../types';
import dynamoDBService from './dynamodb.service';
import { generateClient } from 'aws-amplify/api';

class ApiService {
  async getHistoricalData(venueId: string, range: TimeRange | string): Promise<HistoricalData> {
    console.log('🔍 Fetching historical data from DynamoDB for venue:', venueId, 'range:', range);
    
    try {
      // Fetch directly from DynamoDB using the user's venueId
      const historicalData = await dynamoDBService.getHistoricalSensorData(venueId, range);
      console.log('✅ Historical data received from DynamoDB');
      return historicalData;
    } catch (error: any) {
      console.error('❌ Historical data DynamoDB fetch failed:', error);
      // Avoid double-wrapping error messages
      const errorMessage = error?.message || error?.toString() || 'Unknown error';
      if (errorMessage.startsWith('Failed to fetch historical data from DynamoDB') || 
          errorMessage.startsWith('Failed to fetch')) {
        throw error; // Re-throw original error if already wrapped
      }
      throw new Error(`Failed to fetch historical data from DynamoDB: ${errorMessage}`);
    }
  }

  async getLiveData(venueId: string): Promise<SensorData> {
    console.log('🔍 Fetching live data from DynamoDB for venue:', venueId);
    
    try {
      // Fetch directly from DynamoDB using the user's venueId
      const liveData = await dynamoDBService.getLiveSensorData(venueId);
      console.log('✅ Live data received from DynamoDB');
      return liveData;
    } catch (error: any) {
      console.error('❌ Live data DynamoDB fetch failed:', error);
      // Avoid double-wrapping error messages
      const errorMessage = error?.message || error?.toString() || 'Unknown error';
      if (errorMessage.startsWith('Failed to fetch live data from DynamoDB') || 
          errorMessage.startsWith('Failed to fetch')) {
        throw error; // Re-throw original error if already wrapped
      }
      throw new Error(`Failed to fetch live data from DynamoDB: ${errorMessage}`);
    }
  }

  exportToCSV(data: SensorData[], includeComfort: boolean = true, venueName?: string): void {
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

    const venuePrefix = venueName ? venueName.toLowerCase().replace(/\s+/g, '-') : 'sensor';
    this.downloadFile(csvContent, `${venuePrefix}-data-${new Date().toISOString()}.csv`, 'text/csv');
  }

  exportToJSON(data: SensorData[], venueName?: string): void {
    const jsonContent = JSON.stringify(data, null, 2);
    const venuePrefix = venueName ? venueName.toLowerCase().replace(/\s+/g, '-') : 'sensor';
    this.downloadFile(jsonContent, `${venuePrefix}-data-${new Date().toISOString()}.json`, 'application/json');
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
    console.log('🔍 Fetching occupancy metrics for venue:', venueId);
    
    // Helper to calculate bar day entries/exits from historical sensor data
    const calculateBarDayEntriesExits = async (): Promise<{entries: number; exits: number; current: number}> => {
      try {
        const historicalData = await dynamoDBService.getHistoricalSensorData(venueId, '24h');
        if (historicalData?.data && historicalData.data.length > 0) {
          const { calculateBarDayOccupancy } = await import('../utils/barDay');
          const result = calculateBarDayOccupancy(historicalData.data);
          console.log('📊 Bar day calculation result:', result);
          return result;
        }
      } catch (err) {
        console.warn('⚠️ Bar day calculation failed:', err);
      }
      return { entries: 0, exits: 0, current: 0 };
    };
    
    try {
      // Try the dedicated occupancy metrics resolver
      const metrics = await dynamoDBService.getOccupancyMetrics(venueId);
      console.log('📊 Backend occupancy metrics:', {
        current: metrics.current,
        todayEntries: metrics.todayEntries,
        todayExits: metrics.todayExits,
        peakOccupancy: metrics.peakOccupancy
      });
      
      // Check if entries/exits look like cumulative values (very high numbers)
      // The backend might be returning raw sensor cumulative values
      const CUMULATIVE_THRESHOLD = 5000; // If >5000 entries in a day, probably cumulative
      
      if (metrics.todayEntries > CUMULATIVE_THRESHOLD || metrics.todayExits > CUMULATIVE_THRESHOLD) {
        console.warn('⚠️ Backend entries/exits appear cumulative, using bar day calculation');
        const barDay = await calculateBarDayEntriesExits();
        
        return {
          ...metrics,
          // Use bar day calculated values for entries/exits
          todayEntries: barDay.entries,
          todayExits: barDay.exits,
          todayTotal: barDay.entries,
          // Use backend's current if reasonable, otherwise use calculated
          current: metrics.current <= 1000 ? metrics.current : barDay.current
        };
      }
      
      // Backend values look reasonable, use them
      return metrics;
    } catch (error: any) {
      console.warn('⚠️ Dedicated occupancy resolver failed:', error.message);
      
      // Fallback: Get current from live sensor data, entries/exits from bar day calc
      try {
        const [liveData, barDay] = await Promise.all([
          dynamoDBService.getLiveSensorData(venueId).catch(() => null),
          calculateBarDayEntriesExits()
        ]);
        
        const current = liveData?.occupancy?.current || barDay.current;
        
        console.log('📊 Fallback occupancy:', { 
          current, 
          entries: barDay.entries, 
          exits: barDay.exits,
          source: liveData?.occupancy ? 'live + barDay' : 'barDay only'
        });
        
        return {
          current,
          todayEntries: barDay.entries,
          todayExits: barDay.exits,
          todayTotal: barDay.entries,
          sevenDayAvg: 0,
          fourteenDayAvg: 0,
          thirtyDayAvg: 0,
          peakOccupancy: current,
          peakTime: undefined,
          avgDwellTimeMinutes: null
        };
      } catch (fallbackError) {
        console.error('❌ All occupancy methods failed:', fallbackError);
      }
      
      // Return zeros if everything fails (better than throwing)
      return {
        current: 0,
        todayEntries: 0,
        todayExits: 0,
        todayTotal: 0,
        sevenDayAvg: 0,
        fourteenDayAvg: 0,
        thirtyDayAvg: 0,
        peakOccupancy: 0,
        peakTime: undefined,
        avgDwellTimeMinutes: null
      };
    }
  }

  async createVenue(venueData: {
    venueName: string;
    venueId: string;
    locationName: string;
    locationId: string;
    ownerEmail: string;
    ownerName: string;
    tempPassword: string;
  }): Promise<any> {
    console.log('🔍 Creating venue via AppSync:', venueData.venueName);
    console.log('📦 Venue data:', JSON.stringify(venueData, null, 2));
    
    try {
      console.log('🔧 Generating GraphQL client...');
      const client = generateClient();
      console.log('✅ Client generated');
      
      const mutation = `
        mutation CreateVenue(
          $venueName: String!
          $venueId: String!
          $locationName: String!
          $locationId: String!
          $ownerEmail: String!
          $ownerName: String!
          $tempPassword: String!
        ) {
          createVenue(
            venueName: $venueName
            venueId: $venueId
            locationName: $locationName
            locationId: $locationId
            ownerEmail: $ownerEmail
            ownerName: $ownerName
            tempPassword: $tempPassword
          ) {
            success
            message
            venueId
            ownerEmail
          }
        }
      `;

      console.log('📡 Sending GraphQL mutation...');
      const result = await client.graphql({
        query: mutation,
        variables: venueData
      });

      console.log('✅ Venue created successfully:', result);
      return (result as { data: { createVenue: any } }).data.createVenue;
    } catch (error: any) {
      console.error('❌ Create venue failed:', error);
      console.error('❌ Error type:', typeof error);
      console.error('❌ Error keys:', Object.keys(error));
      console.error('❌ Error message:', error.message);
      console.error('❌ Error errors:', error.errors);
      console.error('❌ Full error JSON:', JSON.stringify(error, null, 2));
      
      // Extract meaningful error message
      let errorMessage = 'Unknown error';
      if (error.errors && error.errors.length > 0) {
        errorMessage = error.errors[0].message;
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      throw new Error(`Failed to create venue: ${errorMessage}`);
    }
  }
}

export default new ApiService();

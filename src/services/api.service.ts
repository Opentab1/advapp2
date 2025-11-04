import type { SensorData, TimeRange, HistoricalData, OccupancyMetrics } from '../types';
import authService from './auth.service';
import dynamoDBService from './dynamodb.service';

class ApiService {
  private getHeaders(): HeadersInit {
    const token = authService.getStoredToken();
    const user = authService.getStoredUser();
    return {
      'Content-Type': 'application/json',
      ...(token && { 'Authorization': `Bearer ${token}` }),
      ...(user?.venueId && { 'X-Venue-ID': user.venueId })
    };
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

  async getHistoricalData(venueId: string, range: TimeRange): Promise<HistoricalData> {
    console.log('🔍 Fetching historical data from DynamoDB for venue:', venueId, 'range:', range);
    
    try {
      // Fetch directly from DynamoDB using the user's venueId
      const historicalData = await dynamoDBService.getHistoricalSensorData(venueId, range);
      console.log('✅ Historical data received from DynamoDB');
      return historicalData;
    } catch (error: any) {
      console.error('❌ Historical data DynamoDB fetch failed:', error);
      throw new Error(`Failed to fetch historical data from DynamoDB: ${error.message}`);
    }
  }

  private transformApiData(apiData: any): SensorData[] {
    // Transform API response to SensorData array
    if (Array.isArray(apiData)) {
      return apiData.map((item: any) => ({
        timestamp: item.timestamp || new Date().toISOString(),
        decibels: item.decibels || item.sound_level || 0,
        light: item.light || item.light_level || 0,
        indoorTemp: item.indoorTemp || item.indoor_temperature || 0,
        outdoorTemp: item.outdoorTemp || item.outdoor_temperature || 0,
        humidity: item.humidity || 0,
        currentSong: item.currentSong || item.current_song,
        albumArt: item.albumArt || item.album_art
      }));
    }
    
    return [];
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
    console.log('🔍 Fetching occupancy metrics from DynamoDB for venue:', venueId);
    
    try {
      // Fetch directly from DynamoDB using the user's venueId
      const metrics = await dynamoDBService.getOccupancyMetrics(venueId);
      console.log('✅ Occupancy metrics received from DynamoDB');
      return metrics;
    } catch (error: any) {
      console.error('❌ Occupancy metrics DynamoDB fetch failed:', error);
      throw new Error(`Failed to fetch occupancy metrics from DynamoDB: ${error.message}`);
    }
  }
}

export default new ApiService();

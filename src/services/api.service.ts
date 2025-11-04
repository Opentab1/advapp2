import type { SensorData, TimeRange, HistoricalData, OccupancyMetrics } from '../types';
import authService from './auth.service';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://api.advizia.ai';

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
    try {
      const days = this.getRangeDays(range);
      const url = `${API_BASE_URL}/history/${venueId}?days=${days}`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: this.getHeaders()
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error('Authentication failed. Please log in again.');
        }
        throw new Error(`Failed to fetch historical data: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      // Transform API response to our data structure
      return {
        data: this.transformApiData(data),
        venueId,
        range
      };
    } catch (error: any) {
      console.error('API fetch error:', error);
      
      // Only use mock data if user is NOT authenticated (demo mode)
      if (!authService.isAuthenticated()) {
        console.warn('⚠️ User not authenticated, using mock data for demo');
        return this.getMockData(venueId, range);
      }
      
      // When authenticated, throw the error instead of silently falling back
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Failed to fetch historical data from API');
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
    try {
      const url = `${API_BASE_URL}/live/${venueId}`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: this.getHeaders()
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error('Authentication failed. Please log in again.');
        }
        throw new Error(`Failed to fetch live data: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return this.transformApiData([data])[0];
    } catch (error: any) {
      console.error('Live data fetch error:', error);
      
      // Only use mock data if user is NOT authenticated (demo mode)
      if (!authService.isAuthenticated()) {
        console.warn('⚠️ User not authenticated, using mock data for demo');
        return this.getMockLiveData();
      }
      
      // When authenticated, throw the error instead of silently falling back
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Failed to fetch live data from API');
    }
  }

  // Mock data for demo/development
  private getMockLiveData(): SensorData {
    const now = new Date();
    const hour = now.getHours();
    // Simulate realistic occupancy based on time of day
    const baseOccupancy = this.getBaseOccupancyForHour(hour);
    
    return {
      timestamp: now.toISOString(),
      decibels: 65 + Math.random() * 20,
      light: 300 + Math.random() * 200,
      indoorTemp: 72 + Math.random() * 4,
      outdoorTemp: 68 + Math.random() * 8,
      humidity: 40 + Math.random() * 20,
      currentSong: 'Neon Dreams - Synthwave',
      albumArt: 'https://picsum.photos/seed/album/200',
      occupancy: {
        current: Math.floor(baseOccupancy + (Math.random() - 0.5) * 10),
        entries: Math.floor((Math.random() * 5) + 2),
        exits: Math.floor((Math.random() * 5) + 1),
        capacity: 150
      }
    };
  }

  private getBaseOccupancyForHour(hour: number): number {
    // Simulate sports bar occupancy patterns
    if (hour >= 0 && hour < 6) return 5; // Late night/early morning
    if (hour >= 6 && hour < 11) return 10; // Morning
    if (hour >= 11 && hour < 14) return 45; // Lunch rush
    if (hour >= 14 && hour < 17) return 30; // Afternoon
    if (hour >= 17 && hour < 22) return 80; // Evening peak
    return 25; // Late evening
  }

  private getMockData(venueId: string, range: TimeRange): HistoricalData {
    const days = this.getRangeDays(range);
    const hours = range === 'live' || range === '6h' ? 6 : days * 24;
    const pointsCount = range === 'live' ? 20 : Math.min(hours, 200);
    
    const data: SensorData[] = [];
    const now = new Date();
    
    for (let i = pointsCount; i >= 0; i--) {
      const timestamp = new Date(now.getTime() - i * (hours / pointsCount) * 60 * 60 * 1000);
      const hour = timestamp.getHours();
      const baseOccupancy = this.getBaseOccupancyForHour(hour);
      
      data.push({
        timestamp: timestamp.toISOString(),
        decibels: 60 + Math.random() * 30 + Math.sin(i / 10) * 10,
        light: 250 + Math.random() * 300 + Math.cos(i / 8) * 100,
        indoorTemp: 70 + Math.random() * 8 + Math.sin(i / 15) * 3,
        outdoorTemp: 65 + Math.random() * 15 + Math.cos(i / 12) * 5,
        humidity: 35 + Math.random() * 30,
        currentSong: i === 0 ? 'Neon Dreams - Synthwave' : undefined,
        albumArt: i === 0 ? 'https://picsum.photos/seed/album/200' : undefined,
        occupancy: {
          current: Math.floor(baseOccupancy + (Math.random() - 0.5) * 15),
          entries: Math.floor((Math.random() * 8) + 3),
          exits: Math.floor((Math.random() * 8) + 2),
          capacity: 150
        }
      });
    }
    
    return { data, venueId, range };
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
    try {
      const url = `${API_BASE_URL}/occupancy/${venueId}/metrics`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: this.getHeaders()
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error('Authentication failed. Please log in again.');
        }
        throw new Error(`Failed to fetch occupancy metrics: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error: any) {
      console.error('Occupancy metrics fetch error:', error);
      
      // Only use mock data if user is NOT authenticated (demo mode)
      if (!authService.isAuthenticated()) {
        console.warn('⚠️ User not authenticated, using mock data for demo');
        return this.getMockOccupancyMetrics();
      }
      
      // When authenticated, throw the error instead of silently falling back
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Failed to fetch occupancy metrics from API');
    }
  }

  private getMockOccupancyMetrics(): OccupancyMetrics {
    const now = new Date();
    const hour = now.getHours();
    const currentOccupancy = this.getBaseOccupancyForHour(hour);
    
    // Calculate today's totals (cumulative entries/exits throughout the day)
    const todayEntries = Math.floor(350 + Math.random() * 100);
    const todayExits = Math.floor(todayEntries - currentOccupancy + (Math.random() - 0.5) * 20);
    
    return {
      current: Math.floor(currentOccupancy + (Math.random() - 0.5) * 10),
      todayEntries,
      todayExits,
      todayTotal: todayEntries,
      sevenDayAvg: Math.floor(420 + Math.random() * 80),
      fourteenDayAvg: Math.floor(405 + Math.random() * 70),
      thirtyDayAvg: Math.floor(390 + Math.random() * 60),
      peakOccupancy: Math.floor(120 + Math.random() * 30),
      peakTime: '19:30'
    };
  }
}

export default new ApiService();

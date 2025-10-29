import type { SensorData, TimeRange, HistoricalData } from '../types';
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
        throw new Error(`API error: ${response.status} ${response.statusText}`);
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
      
      // Return mock data for demo purposes
      return this.getMockData(venueId, range);
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
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();
      return this.transformApiData([data])[0];
    } catch (error) {
      console.error('Live data fetch error:', error);
      // Return mock live data
      return this.getMockLiveData();
    }
  }

  // Mock data for demo/development
  private getMockLiveData(): SensorData {
    const now = new Date();
    return {
      timestamp: now.toISOString(),
      decibels: 65 + Math.random() * 20,
      light: 300 + Math.random() * 200,
      indoorTemp: 72 + Math.random() * 4,
      outdoorTemp: 68 + Math.random() * 8,
      humidity: 40 + Math.random() * 20,
      currentSong: 'Neon Dreams - Synthwave',
      albumArt: 'https://picsum.photos/seed/album/200'
    };
  }

  private getMockData(venueId: string, range: TimeRange): HistoricalData {
    const days = this.getRangeDays(range);
    const hours = range === 'live' || range === '6h' ? 6 : days * 24;
    const pointsCount = range === 'live' ? 20 : Math.min(hours, 200);
    
    const data: SensorData[] = [];
    const now = new Date();
    
    for (let i = pointsCount; i >= 0; i--) {
      const timestamp = new Date(now.getTime() - i * (hours / pointsCount) * 60 * 60 * 1000);
      
      data.push({
        timestamp: timestamp.toISOString(),
        decibels: 60 + Math.random() * 30 + Math.sin(i / 10) * 10,
        light: 250 + Math.random() * 300 + Math.cos(i / 8) * 100,
        indoorTemp: 70 + Math.random() * 8 + Math.sin(i / 15) * 3,
        outdoorTemp: 65 + Math.random() * 15 + Math.cos(i / 12) * 5,
        humidity: 35 + Math.random() * 30,
        currentSong: i === 0 ? 'Neon Dreams - Synthwave' : undefined,
        albumArt: i === 0 ? 'https://picsum.photos/seed/album/200' : undefined
      });
    }
    
    return { data, venueId, range };
  }

  exportToCSV(data: SensorData[]): void {
    const headers = ['Timestamp', 'Decibels', 'Light', 'Indoor Temp', 'Outdoor Temp', 'Humidity', 'Song'];
    const rows = data.map(d => [
      d.timestamp,
      d.decibels.toFixed(1),
      d.light.toFixed(1),
      d.indoorTemp.toFixed(1),
      d.outdoorTemp.toFixed(1),
      d.humidity.toFixed(1),
      d.currentSong || ''
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', `pulse-data-${new Date().toISOString()}.csv`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

export default new ApiService();

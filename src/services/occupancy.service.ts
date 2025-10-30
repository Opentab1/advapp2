import authService from './auth.service';
import type { OccupancyLive, OccupancyAggregate, OccupancyPeriod, OccupancyMetrics } from '../types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://api.advizia.ai';

class OccupancyService {
  private getHeaders(): HeadersInit {
    const token = authService.getStoredToken();
    const user = authService.getStoredUser();
    return {
      'Content-Type': 'application/json',
      ...(token && { 'Authorization': `Bearer ${token}` }),
      ...(user?.venueId && { 'X-Venue-ID': user.venueId })
    };
  }

  async getLiveOccupancy(venueId: string): Promise<OccupancyLive> {
    try {
      const url = `${API_BASE_URL}/occupancy/live/${venueId}`;
      const response = await fetch(url, { method: 'GET', headers: this.getHeaders() });
      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }
      const data = await response.json();
      return this.transformLiveResponse(data);
    } catch (error) {
      console.warn('Live occupancy fetch failed, using mock.', error);
      return this.getMockLiveOccupancy();
    }
  }

  async getOccupancyAggregates(
    venueId: string,
    periods: OccupancyPeriod[] = ['1d', '7d', '14d']
  ): Promise<OccupancyAggregate[]> {
    try {
      const periodsParam = periods.join(',');
      const url = `${API_BASE_URL}/occupancy/aggregates/${venueId}?periods=${encodeURIComponent(periodsParam)}`;
      const response = await fetch(url, { method: 'GET', headers: this.getHeaders() });
      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }
      const data = await response.json();
      return this.transformAggregateResponse(data, periods);
    } catch (error) {
      console.warn('Occupancy aggregates fetch failed, using mock.', error);
      return this.getMockAggregates(periods);
    }
  }

  async getAll(venueId: string): Promise<OccupancyMetrics> {
    const [live, aggregates] = await Promise.all([
      this.getLiveOccupancy(venueId),
      this.getOccupancyAggregates(venueId)
    ]);
    return { live, aggregates };
  }

  private transformLiveResponse(apiData: any): OccupancyLive {
    return {
      timestamp: apiData.timestamp || new Date().toISOString(),
      current: Number(apiData.current) || 0,
      entriesToday: Number(apiData.entriesToday ?? apiData.entries_today ?? apiData.entries) || 0,
      exitsToday: Number(apiData.exitsToday ?? apiData.exits_today ?? apiData.exits) || 0
    };
  }

  private transformAggregateResponse(apiData: any, expected: OccupancyPeriod[]): OccupancyAggregate[] {
    if (Array.isArray(apiData)) {
      return apiData.map((item: any) => ({
        period: (item.period as OccupancyPeriod) || '1d',
        entries: Number(item.entries) || 0,
        exits: Number(item.exits) || 0,
        totalOccupancy: Number(item.totalOccupancy ?? item.net ?? (Number(item.entries) || 0) - (Number(item.exits) || 0))
      }));
    }

    // Handle object keyed by period
    const results: OccupancyAggregate[] = [];
    expected.forEach((p) => {
      const item = apiData[p] || {};
      const entries = Number(item.entries) || 0;
      const exits = Number(item.exits) || 0;
      const totalOccupancy = Number(item.totalOccupancy ?? item.net ?? (entries - exits));
      results.push({ period: p, entries, exits, totalOccupancy });
    });
    return results;
  }

  private getMockLiveOccupancy(): OccupancyLive {
    const hour = new Date().getHours();
    const busyFactor = hour >= 17 && hour <= 22 ? 1.6 : hour >= 12 && hour <= 14 ? 1.2 : 0.8;
    const entriesToday = Math.round(120 * busyFactor + Math.random() * 40);
    const exitsToday = Math.round(entriesToday * (0.6 + Math.random() * 0.2));
    const current = Math.max(0, entriesToday - exitsToday + Math.round(Math.random() * 20));
    return {
      timestamp: new Date().toISOString(),
      current,
      entriesToday,
      exitsToday
    };
  }

  private getMockAggregates(periods: OccupancyPeriod[]): OccupancyAggregate[] {
    return periods.map((p) => {
      const base = p === '1d' ? 200 : p === '7d' ? 1400 : 2800;
      const entries = Math.round(base * (0.9 + Math.random() * 0.3));
      const exits = Math.round(entries * (0.85 + Math.random() * 0.1));
      return {
        period: p,
        entries,
        exits,
        totalOccupancy: Math.max(0, entries - exits)
      };
    });
  }
}

export default new OccupancyService();

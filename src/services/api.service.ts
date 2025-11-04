import { generateClient } from '@aws-amplify/api';
import type { SensorData, TimeRange, HistoricalData, OccupancyMetrics } from '../types';

const sensorDataByVenueQuery = /* GraphQL */ `
  query SensorDataByVenue(
    $venueId: ID!
    $timestamp: ModelStringKeyConditionInput
    $limit: Int
    $nextToken: String
    $sortDirection: ModelSortDirection
  ) {
    sensorDataByVenue(
      venueId: $venueId
      timestamp: $timestamp
      limit: $limit
      nextToken: $nextToken
      sortDirection: $sortDirection
    ) {
      items {
        venueId
        locationId
        timestamp
        decibels
        soundLevel
        sound_level
        light
        lightLevel
        light_level
        indoorTemp
        indoorTemperature
        indoor_temperature
        outdoorTemp
        outdoorTemperature
        outdoor_temperature
        humidity
        sensors
        currentSong
        song
        spotify
        albumArt
        album_art
        artist
        occupancy
      }
      nextToken
    }
  }
`;

class ApiService {
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

  private getRangeLimit(range: TimeRange): number {
    const limits: Record<TimeRange, number> = {
      'live': 1,
      '6h': 500,
      '24h': 1500,
      '7d': 5000,
      '30d': 8000,
      '90d': 12000
    };
    return limits[range];
  }

  private calculateStartTimestamp(days: number): string | null {
    if (!days || days <= 0) {
      return null;
    }
    const date = new Date();
    date.setTime(date.getTime() - days * 24 * 60 * 60 * 1000);
    return date.toISOString();
  }

  private coerceNumber(...values: Array<number | string | null | undefined>): number {
    for (const value of values) {
      if (value === null || value === undefined) continue;
      const parsed = typeof value === 'string' ? parseFloat(value) : Number(value);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
    return 0;
  }

  private transformDynamoItem(item: any): SensorData {
    const sensors = item?.sensors || {};
    const timestamp = item?.timestamp || sensors?.timestamp || new Date().toISOString();

    const decibels = this.coerceNumber(
      item?.decibels,
      item?.soundLevel,
      item?.sound_level,
      sensors?.sound_level,
      sensors?.decibels
    );

    const light = this.coerceNumber(
      item?.light,
      item?.lightLevel,
      item?.light_level,
      sensors?.light_level
    );

    const indoorTemp = this.coerceNumber(
      item?.indoorTemp,
      item?.indoorTemperature,
      item?.indoor_temperature,
      sensors?.indoor_temperature
    );

    const outdoorTemp = this.coerceNumber(
      item?.outdoorTemp,
      item?.outdoorTemperature,
      item?.outdoor_temperature,
      sensors?.outdoor_temperature
    );

    const humidity = this.coerceNumber(
      item?.humidity,
      sensors?.humidity
    );

    const spotify = item?.spotify || sensors?.spotify || {};
    const occupancy = item?.occupancy || sensors?.occupancy;

    return {
      timestamp,
      decibels,
      light,
      indoorTemp,
      outdoorTemp,
      humidity,
      currentSong: item?.currentSong || spotify?.current_song || item?.song || sensors?.current_song,
      albumArt: item?.albumArt || spotify?.album_art || sensors?.album_art,
      artist: item?.artist || spotify?.artist || sensors?.artist,
      occupancy: occupancy ? {
        current: this.coerceNumber(occupancy.current, occupancy.count),
        entries: this.coerceNumber(occupancy.entries),
        exits: this.coerceNumber(occupancy.exits),
        capacity: occupancy.capacity !== undefined && occupancy.capacity !== null
          ? this.coerceNumber(occupancy.capacity)
          : undefined
      } : undefined
    };
  }

  private async fetchSensorData(
    venueId: string,
    {
      startTime,
      limit,
      sortDirection = 'DESC',
      maxItems
    }: {
      startTime?: string | null;
      limit?: number;
      sortDirection?: 'ASC' | 'DESC';
      maxItems?: number;
    }
  ): Promise<any[]> {
    const client = generateClient();
    const collected: any[] = [];
    const pageLimit = Math.min(limit ?? 200, 200);
    const target = maxItems ?? limit ?? 200;
    const timestampCondition = startTime ? { ge: startTime } : undefined;

    let nextToken: string | null | undefined = undefined;
    let shouldContinue = true;

    console.log(
      '🔍 Querying DynamoDB sensor data via GraphQL',
      {
        venueId,
        startTime,
        sortDirection,
        target
      }
    );

    while (shouldContinue && collected.length < target) {
      const remaining = target - collected.length;
      const response = await client.graphql({
        query: sensorDataByVenueQuery,
        variables: {
          venueId,
          timestamp: timestampCondition,
          limit: Math.min(pageLimit, remaining),
          nextToken,
          sortDirection
        },
        authMode: 'userPool'
      }) as any;

      const items = response?.data?.sensorDataByVenue?.items || [];
      nextToken = response?.data?.sensorDataByVenue?.nextToken ?? null;

      if (items.length === 0) {
        shouldContinue = false;
        break;
      }

      collected.push(...items);

      if (!nextToken) {
        shouldContinue = false;
      }

      if (startTime) {
        const oldest = items[items.length - 1];
        if (oldest?.timestamp && new Date(oldest.timestamp).getTime() <= new Date(startTime).getTime()) {
          shouldContinue = false;
        }
      }
    }

    return collected;
  }

  async getHistoricalData(venueId: string, range: TimeRange): Promise<HistoricalData> {
    const days = this.getRangeDays(range);
    const startTime = this.calculateStartTimestamp(days);
    const limit = this.getRangeLimit(range);

    try {
      const rawItems = await this.fetchSensorData(venueId, {
        startTime,
        sortDirection: 'DESC',
        maxItems: limit
      });

      const filtered = rawItems
        .map(item => this.transformDynamoItem(item))
        .filter(item => {
          if (!startTime) return true;
          return new Date(item.timestamp).getTime() >= new Date(startTime).getTime();
        })
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      if (filtered.length === 0) {
        throw new Error(`No sensor records found in DynamoDB for venue ${venueId}`);
      }

      console.log(`✅ Loaded ${filtered.length} historical records from DynamoDB for venue:`, venueId);

      return {
        data: filtered,
        venueId,
        range
      };
    } catch (error: any) {
      console.error('❌ DynamoDB historical data query failed:', error);
      throw new Error(`Failed to load historical data from DynamoDB: ${error.message}`);
    }
  }

  async getLiveData(venueId: string): Promise<SensorData> {
    try {
      const items = await this.fetchSensorData(venueId, {
        limit: 1,
        maxItems: 1,
        sortDirection: 'DESC'
      });

      if (!items.length) {
        throw new Error(`No live sensor records found in DynamoDB for venue ${venueId}`);
      }

      const sensorData = this.transformDynamoItem(items[0]);
      console.log('✅ Live sensor record loaded from DynamoDB for venue:', venueId);
      return sensorData;
    } catch (error: any) {
      console.error('❌ DynamoDB live data query failed:', error);
      throw new Error(`Failed to load live data from DynamoDB: ${error.message}`);
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
    try {
      const history = await this.getHistoricalData(venueId, '7d');
      const metrics = this.calculateOccupancyMetrics(history.data);
      console.log('✅ Occupancy metrics calculated from DynamoDB data');
      return metrics;
    } catch (error: any) {
      console.error('❌ Occupancy metrics calculation failed:', error);
      throw new Error(`Failed to calculate occupancy metrics from DynamoDB: ${error.message}`);
    }
  }

  private calculateOccupancyMetrics(data: SensorData[]): OccupancyMetrics {
    const withOccupancy = data.filter((item) => item.occupancy);
    if (withOccupancy.length === 0) {
      throw new Error('No occupancy readings available');
    }

    const sorted = [...withOccupancy].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    const latest = sorted[sorted.length - 1];
    const peak = sorted.reduce(
      (acc, item) => {
        const value = item.occupancy?.current ?? 0;
        if (value > acc.value) {
          return { value, timestamp: item.timestamp };
        }
        return acc;
      },
      { value: 0, timestamp: undefined as string | undefined }
    );

    const grouped = this.groupByDay(sorted);
    const orderedKeys = Object.keys(grouped).sort();
    const dailyStats = orderedKeys.map((key) => ({
      key,
      ...this.extractDailyOccupancyStats(grouped[key])
    }));

    const todayKey = this.formatDateKey(new Date());
    const today = dailyStats.find((stat) => stat.key === todayKey) || { entries: 0, exits: 0, peak: 0 };

    const avg = (values: number[], window: number) => {
      const slice = values.slice(-window);
      if (slice.length === 0) return 0;
      return Math.round(slice.reduce((sum, value) => sum + value, 0) / slice.length);
    };

    const entriesSeries = dailyStats.map((stat) => stat.entries);

    return {
      current: latest.occupancy?.current ?? 0,
      todayEntries: Math.round(today.entries),
      todayExits: Math.round(today.exits),
      todayTotal: Math.max(Math.round(today.entries - today.exits), 0),
      sevenDayAvg: avg(entriesSeries, 7),
      fourteenDayAvg: avg(entriesSeries, 14),
      thirtyDayAvg: avg(entriesSeries, 30),
      peakOccupancy: Math.round(peak.value),
      peakTime: peak.timestamp
    };
  }

  private groupByDay(data: SensorData[]): Record<string, SensorData[]> {
    return data.reduce((acc, item) => {
      const key = this.formatDateKey(new Date(item.timestamp));
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(item);
      return acc;
    }, {} as Record<string, SensorData[]>);
  }

  private extractDailyOccupancyStats(items: SensorData[]) {
    const sorted = [...items].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    const last = sorted[sorted.length - 1];
    const entries = last?.occupancy?.entries ?? 0;
    const exits = last?.occupancy?.exits ?? 0;
    const peak = sorted.reduce((max, item) => {
      const value = item.occupancy?.current ?? 0;
      return value > max ? value : max;
    }, 0);

    return {
      entries,
      exits,
      peak
    };
  }

  private formatDateKey(date: Date): string {
    const year = date.getUTCFullYear();
    const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
    const day = `${date.getUTCDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}

export default new ApiService();

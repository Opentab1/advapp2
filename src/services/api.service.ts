import type { SensorData, TimeRange, HistoricalData, OccupancyMetrics } from '../types';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { fetchAuthSession } from '@aws-amplify/auth';
import { AWS_CONFIG } from '../config/amplify';

// DynamoDB table name for sensor data (can be overridden via env var)
const SENSOR_DATA_TABLE = import.meta.env.VITE_DYNAMODB_TABLE_NAME || 'RPiSensorData';

class ApiService {
  private dynamoClient: DynamoDBDocumentClient | null = null;

  private async getDynamoClient(): Promise<DynamoDBDocumentClient> {
    if (this.dynamoClient) {
      return this.dynamoClient;
    }

    try {
      // Get AWS credentials from Cognito session
      const session = await fetchAuthSession();
      
      // Amplify v6 provides credentials in different formats
      // Try to get credentials from the session
      let credentials: any = null;
      
      if (session.credentials) {
        credentials = {
          accessKeyId: session.credentials.accessKeyId,
          secretAccessKey: session.credentials.secretAccessKey,
          sessionToken: session.credentials.sessionToken
        };
      } else if ((session as any).awsCredential) {
        // Alternative credential location
        const awsCred = (session as any).awsCredential;
        credentials = {
          accessKeyId: awsCred.accessKeyId,
          secretAccessKey: awsCred.secretAccessKey,
          sessionToken: awsCred.sessionToken
        };
      }

      if (!credentials || !credentials.accessKeyId) {
        throw new Error('No AWS credentials available. Please log in.');
      }

      // Create DynamoDB client with credentials
      const client = new DynamoDBClient({
        region: AWS_CONFIG.region,
        credentials: credentials
      });

      this.dynamoClient = DynamoDBDocumentClient.from(client);
      return this.dynamoClient;
    } catch (error: any) {
      console.error('Failed to create DynamoDB client:', error);
      throw new Error(`Failed to initialize DynamoDB client: ${error.message}`);
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

  private transformDynamoItem(item: any): SensorData {
    // Transform DynamoDB item to SensorData format
    // Handle both snake_case and camelCase field names
    return {
      timestamp: item.timestamp || item.Timestamp || new Date().toISOString(),
      decibels: item.decibels ?? item.sound_level ?? item.soundLevel ?? item.Decibels ?? 0,
      light: item.light ?? item.light_level ?? item.lightLevel ?? item.Light ?? 0,
      indoorTemp: item.indoorTemp ?? item.indoor_temperature ?? item.indoorTemperature ?? item.IndoorTemp ?? 0,
      outdoorTemp: item.outdoorTemp ?? item.outdoor_temperature ?? item.outdoorTemperature ?? item.OutdoorTemp ?? 0,
      humidity: item.humidity ?? item.Humidity ?? 0,
      currentSong: item.currentSong ?? item.current_song ?? item.currentSong ?? item.CurrentSong,
      albumArt: item.albumArt ?? item.album_art ?? item.albumArt ?? item.AlbumArt,
      artist: item.artist ?? item.Artist,
      occupancy: item.occupancy ? {
        current: item.occupancy.current ?? item.occupancy.Current ?? 0,
        entries: item.occupancy.entries ?? item.occupancy.Entries ?? 0,
        exits: item.occupancy.exits ?? item.occupancy.Exits ?? 0,
        capacity: item.occupancy.capacity ?? item.occupancy.Capacity
      } : undefined
    };
  }

  async getHistoricalData(venueId: string, range: TimeRange): Promise<HistoricalData> {
    const days = this.getRangeDays(range);
    
    console.log(`🔍 Fetching historical data from DynamoDB for venue: ${venueId}, range: ${range} (${days} days)`);
    
    try {
      const client = await this.getDynamoClient();
      
      // Calculate timestamp threshold
      const now = new Date();
      const threshold = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      const thresholdISO = threshold.toISOString();

      // Query DynamoDB for records with this venueId within the time range
      // Assuming venueId is either a partition key or indexed via GSI
      // Try querying by venueId first (if it's a partition key or GSI)
      let items: any[] = [];

      try {
        // Try query if venueId is partition key or GSI
        // Try common GSI patterns
        const possibleIndexes = [
          'venueId-timestamp-index',
          'venueId-timestampIndex',
          'venueId-index',
          'venueIdIndex'
        ];

        let querySucceeded = false;
        for (const indexName of possibleIndexes) {
          try {
            const queryCommand = new QueryCommand({
              TableName: SENSOR_DATA_TABLE,
              IndexName: indexName,
              KeyConditionExpression: 'venueId = :venueId AND #ts >= :threshold',
              ExpressionAttributeNames: {
                '#ts': 'timestamp'
              },
              ExpressionAttributeValues: {
                ':venueId': venueId,
                ':threshold': thresholdISO
              },
              ScanIndexForward: false // Most recent first
            });

            const response = await client.send(queryCommand);
            items = response.Items || [];
            querySucceeded = true;
            break;
          } catch (indexError: any) {
            // Try next index
            continue;
          }
        }

        if (!querySucceeded) {
          throw new Error('No suitable GSI found');
        }
      } catch (queryError: any) {
        // If query fails (e.g., no GSI), try scan with filter
        console.warn('Query failed, trying scan:', queryError.message);
        
        const scanCommand = new ScanCommand({
          TableName: SENSOR_DATA_TABLE,
          FilterExpression: 'venueId = :venueId AND #ts >= :threshold',
          ExpressionAttributeNames: {
            '#ts': 'timestamp'
          },
          ExpressionAttributeValues: {
            ':venueId': venueId,
            ':threshold': thresholdISO
          }
        });

        const response = await client.send(scanCommand);
        items = response.Items || [];
      }

      if (items.length === 0) {
        console.warn(`⚠️ No sensor data found for venue ${venueId} in the last ${days} days`);
      }

      // Transform and sort by timestamp
      const sensorData = items
        .map(item => this.transformDynamoItem(item))
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      console.log(`✅ Retrieved ${sensorData.length} historical records from DynamoDB`);
      
      return {
        data: sensorData,
        venueId,
        range
      };
    } catch (error: any) {
      console.error('❌ Failed to fetch historical data from DynamoDB:', error);
      throw new Error(`Failed to fetch historical data from DynamoDB: ${error.message}`);
    }
  }

  async getLiveData(venueId: string): Promise<SensorData> {
    console.log(`🔍 Fetching live data from DynamoDB for venue: ${venueId}`);
    
    try {
      const client = await this.getDynamoClient();
      
      let items: any[] = [];

      try {
        // Try query for most recent record
        // Try common GSI patterns
        const possibleIndexes = [
          'venueId-timestamp-index',
          'venueId-timestampIndex',
          'venueId-index',
          'venueIdIndex'
        ];

        let querySucceeded = false;
        for (const indexName of possibleIndexes) {
          try {
            const queryCommand = new QueryCommand({
              TableName: SENSOR_DATA_TABLE,
              IndexName: indexName,
              KeyConditionExpression: 'venueId = :venueId',
              ExpressionAttributeValues: {
                ':venueId': venueId
              },
              ScanIndexForward: false, // Most recent first
              Limit: 1 // Only get the latest record
            });

            const response = await client.send(queryCommand);
            items = response.Items || [];
            querySucceeded = true;
            break;
          } catch (indexError: any) {
            // Try next index
            continue;
          }
        }

        if (!querySucceeded) {
          throw new Error('No suitable GSI found');
        }
      } catch (queryError: any) {
        // If query fails, try scan with filter
        console.warn('Query failed, trying scan:', queryError.message);
        
        const scanCommand = new ScanCommand({
          TableName: SENSOR_DATA_TABLE,
          FilterExpression: 'venueId = :venueId',
          ExpressionAttributeValues: {
            ':venueId': venueId
          },
          Limit: 100 // Get recent records and sort client-side
        });

        const response = await client.send(scanCommand);
        items = response.Items || [];
        
        // Sort by timestamp descending and take the most recent
        items = items
          .sort((a, b) => {
            const tsA = a.timestamp || a.Timestamp || '';
            const tsB = b.timestamp || b.Timestamp || '';
            return tsB.localeCompare(tsA);
          })
          .slice(0, 1);
      }

      if (items.length === 0) {
        throw new Error(`No sensor data found for venue: ${venueId}`);
      }

      const sensorData = this.transformDynamoItem(items[0]);
      console.log('✅ Live data retrieved from DynamoDB');
      
      return sensorData;
    } catch (error: any) {
      console.error('❌ Failed to fetch live data from DynamoDB:', error);
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
    console.log(`🔍 Fetching occupancy metrics from DynamoDB for venue: ${venueId}`);
    
    try {
      // For now, occupancy metrics can be calculated from recent sensor data
      // This is a placeholder - you may need to query a separate Occupancy table
      const client = await this.getDynamoClient();
      
      // Get recent records (last 30 days) to calculate metrics
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      
      let items: any[] = [];
      
      try {
        // Try common GSI patterns
        const possibleIndexes = [
          'venueId-timestamp-index',
          'venueId-timestampIndex',
          'venueId-index',
          'venueIdIndex'
        ];

        let querySucceeded = false;
        for (const indexName of possibleIndexes) {
          try {
            const queryCommand = new QueryCommand({
              TableName: SENSOR_DATA_TABLE,
              IndexName: indexName,
              KeyConditionExpression: 'venueId = :venueId AND #ts >= :threshold',
              ExpressionAttributeNames: {
                '#ts': 'timestamp'
              },
              ExpressionAttributeValues: {
                ':venueId': venueId,
                ':threshold': thirtyDaysAgo
              }
            });

            const response = await client.send(queryCommand);
            items = response.Items || [];
            querySucceeded = true;
            break;
          } catch (indexError: any) {
            // Try next index
            continue;
          }
        }

        if (!querySucceeded) {
          throw new Error('No suitable GSI found');
        }
      } catch (queryError: any) {
        // Fallback to scan
        console.warn('Query failed, trying scan:', queryError.message);
        const scanCommand = new ScanCommand({
          TableName: SENSOR_DATA_TABLE,
          FilterExpression: 'venueId = :venueId AND #ts >= :threshold',
          ExpressionAttributeNames: {
            '#ts': 'timestamp'
          },
          ExpressionAttributeValues: {
            ':venueId': venueId,
            ':threshold': thirtyDaysAgo
          }
        });

        const response = await client.send(scanCommand);
        items = response.Items || [];
      }

      // Calculate metrics from occupancy data in sensor records
      const today = new Date().toDateString();
      let currentOccupancy = 0;
      let todayEntries = 0;
      let todayExits = 0;
      let peakOccupancy = 0;
      let peakTime: string | undefined;
      const dailyOccupancy: { [key: string]: number[] } = {};

      items.forEach(item => {
        const occ = item.occupancy || item.Occupancy;
        if (occ) {
          const itemDate = new Date(item.timestamp || item.Timestamp).toDateString();
          const current = occ.current ?? occ.Current ?? 0;
          
          if (itemDate === today) {
            currentOccupancy = Math.max(currentOccupancy, current);
            todayEntries += occ.entries ?? occ.Entries ?? 0;
            todayExits += occ.exits ?? occ.Exits ?? 0;
            
            if (current > peakOccupancy) {
              peakOccupancy = current;
              peakTime = new Date(item.timestamp || item.Timestamp).toLocaleTimeString();
            }
          }
          
          // Track daily averages
          if (!dailyOccupancy[itemDate]) {
            dailyOccupancy[itemDate] = [];
          }
          dailyOccupancy[itemDate].push(current);
        }
      });

      // Calculate 7, 14, 30 day averages
      const recentDays = Object.keys(dailyOccupancy)
        .sort()
        .slice(-30)
        .map(date => {
          const values = dailyOccupancy[date];
          return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
        });

      const sevenDayAvg = recentDays.slice(-7).length > 0
        ? Math.round(recentDays.slice(-7).reduce((a, b) => a + b, 0) / recentDays.slice(-7).length)
        : 0;
      const fourteenDayAvg = recentDays.slice(-14).length > 0
        ? Math.round(recentDays.slice(-14).reduce((a, b) => a + b, 0) / recentDays.slice(-14).length)
        : 0;
      const thirtyDayAvg = recentDays.length > 0
        ? Math.round(recentDays.reduce((a, b) => a + b, 0) / recentDays.length)
        : 0;

      const metrics: OccupancyMetrics = {
        current: currentOccupancy,
        todayEntries,
        todayExits,
        todayTotal: todayEntries + todayExits,
        sevenDayAvg,
        fourteenDayAvg,
        thirtyDayAvg,
        peakOccupancy,
        peakTime
      };

      console.log('✅ Occupancy metrics calculated from DynamoDB');
      return metrics;
    } catch (error: any) {
      console.error('❌ Failed to fetch occupancy metrics from DynamoDB:', error);
      // Return default metrics instead of throwing - occupancy is optional
      return {
        current: 0,
        todayEntries: 0,
        todayExits: 0,
        todayTotal: 0,
        sevenDayAvg: 0,
        fourteenDayAvg: 0,
        thirtyDayAvg: 0,
        peakOccupancy: 0
      };
    }
  }
}

export default new ApiService();

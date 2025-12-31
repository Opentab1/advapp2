import { generateClient } from '@aws-amplify/api';
import { fetchAuthSession } from '@aws-amplify/auth';
import type { SensorData, TimeRange, HistoricalData, OccupancyMetrics } from '../types';
import { isDemoAccount, generateDemoLiveData, generateDemoHistoricalData, generateDemoOccupancyMetrics } from '../utils/demoData';
import { calculateCurrentHourDwellTime } from '../utils/dwellTime';

// ============================================
// CACHING LAYER - Option C: Aggressive Caching
// ============================================
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  fetchedAt: Date;
}

class HistoricalDataCache {
  private cache = new Map<string, CacheEntry<HistoricalData>>();
  
  // Cache TTL by range - longer ranges can be cached longer
  private getTTL(range: string): number {
    switch (range) {
      case 'live': return 30 * 1000;      // 30 seconds
      case '6h': return 2 * 60 * 1000;    // 2 minutes
      case '24h': return 5 * 60 * 1000;   // 5 minutes
      case '7d': return 10 * 60 * 1000;   // 10 minutes
      case '14d': return 10 * 60 * 1000;  // 10 minutes
      case '30d': return 15 * 60 * 1000;  // 15 minutes
      case '90d': return 30 * 60 * 1000;  // 30 minutes
      default: return 5 * 60 * 1000;      // 5 minutes default
    }
  }
  
  private getCacheKey(venueId: string, range: string): string {
    return `${venueId}:${range}`;
  }
  
  get(venueId: string, range: string): HistoricalData | null {
    const key = this.getCacheKey(venueId, range);
    const entry = this.cache.get(key);
    
    if (!entry) return null;
    
    const ttl = this.getTTL(range);
    const age = Date.now() - entry.timestamp;
    
    if (age > ttl) {
      console.log(`📦 [${range}] Cache expired (age: ${Math.round(age/1000)}s, ttl: ${Math.round(ttl/1000)}s)`);
      this.cache.delete(key);
      return null;
    }
    
    console.log(`📦 [${range}] Cache HIT - using cached data (${entry.data.data?.length || 0} items, age: ${Math.round(age/1000)}s)`);
    return entry.data;
  }
  
  set(venueId: string, range: string, data: HistoricalData): void {
    const key = this.getCacheKey(venueId, range);
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      fetchedAt: new Date()
    });
    console.log(`📦 [${range}] Cache SET - stored ${data.data?.length || 0} items`);
  }
  
  // Clear cache for a specific venue (useful after data updates)
  clearVenue(venueId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(venueId + ':')) {
        this.cache.delete(key);
      }
    }
  }
  
  // Clear all cache
  clearAll(): void {
    this.cache.clear();
  }
}

// Global cache instance
const historicalCache = new HistoricalDataCache();

// ============================================
// BACKGROUND PRELOAD - Option B: Progressive Loading
// ============================================
// Track ongoing preloads to avoid duplicate requests
const preloadPromises = new Map<string, Promise<void>>();

async function preloadHistoricalData(venueId: string): Promise<void> {
  const preloadKey = venueId;
  
  // Don't start if already preloading
  if (preloadPromises.has(preloadKey)) {
    console.log('📦 Preload already in progress for venue:', venueId);
    return preloadPromises.get(preloadKey);
  }
  
  console.log('📦 Starting background preload for venue:', venueId);
  
  const preloadPromise = (async () => {
    const rangesToPreload = ['7d', '14d']; // Preload these ranges for comparisons
    
    for (const range of rangesToPreload) {
      // Check if already cached
      if (historicalCache.get(venueId, range)) {
        console.log(`📦 [${range}] Already cached, skipping preload`);
        continue;
      }
      
      try {
        console.log(`📦 [${range}] Preloading in background...`);
        // Import dynamically to avoid circular dependency
        const dynamoDBService = (await import('./dynamodb.service')).default;
        await dynamoDBService.getHistoricalSensorData(venueId, range);
        console.log(`📦 [${range}] Preload complete`);
      } catch (error) {
        console.warn(`📦 [${range}] Preload failed:`, error);
        // Don't throw - preload failures shouldn't break the app
      }
      
      // Small delay between preloads to not overwhelm the API
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    preloadPromises.delete(preloadKey);
  })();
  
  preloadPromises.set(preloadKey, preloadPromise);
  return preloadPromise;
}

// Export for use in Dashboard
export { preloadHistoricalData, historicalCache };

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
  query ListSensorData($venueId: ID!, $startTime: String!, $endTime: String!, $limit: Int, $nextToken: String) {
    listSensorData(venueId: $venueId, startTime: $startTime, endTime: $endTime, limit: $limit, nextToken: $nextToken) {
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

  private getClient() {
    return generateClient();
  }

  /**
   * Check if GraphQL endpoint is configured
   */
  private checkGraphQLEndpoint(): void {
    const endpoint = import.meta.env.VITE_GRAPHQL_ENDPOINT;
    if (!endpoint || endpoint.trim() === '' || endpoint.includes('your-appsync-api')) {
      throw new Error(
        'GraphQL endpoint not configured. Please set VITE_GRAPHQL_ENDPOINT in your .env file. ' +
        'See DYNAMODB_SETUP.md for instructions on how to set up your AppSync API endpoint.'
      );
    }
  }

  /**
   * Extract error message from various error types
   */
  private extractErrorMessage(error: any): string {
    if (error?.message) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    if (error?.error?.message) {
      return error.error.message;
    }
    if (error?.errors && Array.isArray(error.errors) && error.errors.length > 0) {
      return error.errors.map((e: any) => e.message || e).join(', ');
    }
    // Check for GraphQL errors
    if (error?.data?.errors) {
      return error.data.errors.map((e: any) => e.message || e).join(', ');
    }
    // Check for network errors
    if (error?.name === 'NetworkError' || error?.code === 'NETWORK_ERROR') {
      return 'Network error: Unable to connect to GraphQL endpoint. Check your VITE_GRAPHQL_ENDPOINT configuration.';
    }
    return error?.toString() || 'Unknown error occurred';
  }

  /**
   * Check if error is already wrapped to avoid double-wrapping
   */
  private isAlreadyWrapped(errorMessage: string, prefix: string): boolean {
    return errorMessage.startsWith(prefix) || errorMessage.includes('Failed to fetch');
  }

  /**
   * Get the most recent sensor data for a venue
   */
  async getLiveSensorData(venueId: string): Promise<SensorData> {
    console.log('🔍 Fetching live sensor data from DynamoDB for venue:', venueId);
    
    // ✨ DEMO MODE: Return fake data for demo account only
    if (isDemoAccount(venueId)) {
      console.log('🎭 Demo mode detected - returning generated live data');
      await new Promise(resolve => setTimeout(resolve, 300)); // Simulate network delay
      return generateDemoLiveData();
    }
    
    try {
      // Check if GraphQL endpoint is configured
      this.checkGraphQLEndpoint();

      // Verify authentication
      const session = await fetchAuthSession();
      console.log('🔐 Auth session details:', {
        hasTokens: !!session.tokens,
        hasIdToken: !!session.tokens?.idToken,
        hasAccessToken: !!session.tokens?.accessToken,
        tokenType: session.tokens?.idToken?.payload ? 'JWT' : 'none',
        venueId: session.tokens?.idToken?.payload?.['custom:venueId']
      });
      
      if (!session.tokens) {
        throw new Error('Not authenticated. Please log in again.');
      }

      const client = this.getClient();
      const endpoint = import.meta.env.VITE_GRAPHQL_ENDPOINT;
      console.log('📡 GraphQL Request Details:', {
        endpoint: endpoint ? endpoint.substring(0, 50) + '...' : 'NOT SET',
        query: 'listSensorData',
        venueId,
        authMode: 'userPool'
      });

      // Query DynamoDB for the most recent data
      // Since we don't have the exact timestamp, we'll query for recent data
      const endTime = new Date().toISOString();
      const startTime = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // Last 5 minutes
      
      const response = await client.graphql({
        query: listSensorData,
        variables: { 
          venueId, 
          startTime,
          endTime,
          limit: 1 // Get only the most recent
        },
        authMode: 'userPool'
      }) as any;

      // Check for GraphQL errors in response
      if (response?.errors && response.errors.length > 0) {
        console.error('❌ GraphQL Response Errors:', {
          errors: response.errors,
          fullResponse: JSON.stringify(response, null, 2)
        });
        const errorMessages = response.errors.map((e: any) => e.message || e).join(', ');
        throw new Error(`GraphQL error: ${errorMessages}`);
      }

      const items = response?.data?.listSensorData?.items || [];
      
      if (items.length === 0) {
        throw new Error(`No sensor data found for venue: ${venueId}. Please ensure your IoT devices are publishing data to DynamoDB.`);
      }

      const latestData = items[0];
      console.log('✅ Live sensor data retrieved from DynamoDB');
      
      return this.transformDynamoDBData(latestData);
    } catch (error: any) {
      console.error('❌ Failed to fetch live sensor data from DynamoDB');
      console.error('🔍 Full Error Object:', {
        name: error?.name,
        message: error?.message,
        code: error?.code,
        statusCode: error?.statusCode,
        errorType: error?.errorType,
        errorInfo: error?.errorInfo,
        underlyingError: error?.underlyingError,
        errors: error?.errors,
        data: error?.data,
        stack: error?.stack,
        fullError: JSON.stringify(error, Object.getOwnPropertyNames(error), 2)
      });
      
      // Log network-level details if available
      if (error?.name === 'NetworkError' || error?.code === 'NETWORK_ERROR') {
        console.error('🌐 Network Error Details:', {
          endpoint: import.meta.env.VITE_GRAPHQL_ENDPOINT,
          message: error.message
        });
      }
      
      const errorMessage = this.extractErrorMessage(error);
      // Avoid double-wrapping error messages
      if (this.isAlreadyWrapped(errorMessage, 'Failed to fetch live data')) {
        throw error; // Re-throw original error if already wrapped
      }
      throw new Error(`Failed to fetch live data from DynamoDB: ${errorMessage}`);
    }
  }

  /**
   * Get historical sensor data for a venue within a time range
   */
  async getHistoricalSensorData(venueId: string, range: TimeRange | string): Promise<HistoricalData> {
    console.log('🔍 Fetching historical sensor data from DynamoDB for venue:', venueId, 'range:', range);
    
    // ✨ DEMO MODE: Return fake data for demo account only
    if (isDemoAccount(venueId)) {
      console.log('🎭 Demo mode detected - returning generated historical data');
      await new Promise(resolve => setTimeout(resolve, 500)); // Simulate network delay
      return generateDemoHistoricalData(venueId, range as TimeRange);
    }
    
    // ============================================
    // CACHE CHECK - Option C: Return cached data if available
    // ============================================
    const cachedData = historicalCache.get(venueId, range as string);
    if (cachedData) {
      return cachedData;
    }
    
    try {
      // Check if GraphQL endpoint is configured
      this.checkGraphQLEndpoint();

      // Verify authentication
      const session = await fetchAuthSession();
      if (!session.tokens) {
        throw new Error('Not authenticated. Please log in again.');
      }

      const { startTime, endTime } = this.getTimeRangeValues(range);
      const client = this.getClient();

      // Calculate appropriate limit based on time range
      // For occupancy aggregation, we need enough data points to capture each bar day
      // Minimum: at least 1 reading per hour for accurate calculations
      // NO ARBITRARY LIMITS - fetch ALL data within the time range
      // The time range (startTime, endTime) already limits the query
      // Pagination continues until nextToken is null (no more data)
      const pageSize = 1000; // DynamoDB/AppSync max per request
      const maxPages = 500; // Safety cap: 500 pages = 500,000 items max (prevents infinite loops)
      
      console.log(`📊 [${range}] Starting fetch: time range ${startTime} to ${endTime}, no item limit`);

      // Paginate through ALL results in the time range
      let allItems: any[] = [];
      let nextToken: string | null = null;
      let pageCount = 0;

      do {
        pageCount++;
        const response = await client.graphql({
          query: listSensorData,
          variables: { 
            venueId, 
            startTime,
            endTime,
            limit: pageSize,
            nextToken: nextToken
          },
          authMode: 'userPool'
        }) as any;

        // Check for GraphQL errors in response
        if (response?.errors && response.errors.length > 0) {
          console.error('❌ GraphQL Response Errors:', {
            errors: response.errors,
            fullResponse: JSON.stringify(response, null, 2)
          });
          const errorMessages = response.errors.map((e: any) => e.message || e).join(', ');
          throw new Error(`GraphQL error: ${errorMessages}`);
        }

        const pageItems = response?.data?.listSensorData?.items || [];
        allItems = allItems.concat(pageItems);
        nextToken = response?.data?.listSensorData?.nextToken || null;
        
        // Log every 5 pages to reduce noise, or on last page
        if (pageCount % 5 === 0 || !nextToken) {
          console.log(`📊 [${range}] Page ${pageCount}: fetched ${allItems.length} total items, hasMore: ${!!nextToken}`);
        }
        
        // Safety check - prevent truly infinite loops
        if (pageCount >= maxPages) {
          console.warn(`⚠️ [${range}] Hit max pages safety limit (${maxPages}). Stopping pagination.`);
          break;
        }
      } while (nextToken);

      const items = allItems;
      console.log(`📊 [${range}] Pagination complete: ${pageCount} pages, ${items.length} total items`);
      
      // Log date range of fetched data
      if (items.length > 0) {
        const oldestItem = items[items.length - 1];
        const newestItem = items[0];
        console.log(`📊 [${range}] Data spans: ${oldestItem?.timestamp} to ${newestItem?.timestamp}`);
      }
      
      // If no data in requested range, try to find ANY historical data
      if (items.length === 0) {
        console.warn(`⚠️ No data found in requested range (${range}), searching for any historical data...`);
        
        // Try to get any data from the last 365 days
        const expandedEndTime = new Date().toISOString();
        const expandedStartTime = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
        
        const expandedResponse = await client.graphql({
          query: listSensorData,
          variables: { 
            venueId, 
            startTime: expandedStartTime,
            endTime: expandedEndTime,
            limit: 1000 // Just get a sample to confirm data exists
          },
          authMode: 'userPool'
        }) as any;
        
        const expandedItems = expandedResponse?.data?.listSensorData?.items || [];
        
        if (expandedItems.length === 0) {
          // Truly no data exists - return empty array with helpful message
          console.warn(`⚠️ No historical data exists in DynamoDB for venue: ${venueId}`);
          console.warn(`   This usually means:`);
          console.warn(`   1. IoT device has never published data, or`);
          console.warn(`   2. Data was never stored in DynamoDB, or`);
          console.warn(`   3. VenueId mismatch between device and user account`);
          
          return {
            data: [],
            venueId,
            range,
            message: 'No sensor data has been collected yet. Please ensure your IoT device is configured and publishing data.'
          };
        }
        
        // Found historical data outside requested range
        console.log(`✅ Found ${expandedItems.length} historical data points (outside requested ${range} range)`);
        console.log(`   → Oldest: ${expandedItems[expandedItems.length - 1]?.timestamp || 'N/A'}`);
        console.log(`   → Newest: ${expandedItems[0]?.timestamp || 'N/A'}`);
        
        const transformedData = expandedItems.map((item: any) => this.transformDynamoDBData(item));
        
        return {
          data: transformedData,
          venueId,
          range,
          message: `No recent data available. Showing ${expandedItems.length} historical data points. Device may be offline.`
        };
      }

      console.log(`✅ Retrieved ${items.length} historical data points from DynamoDB`);
      
      const transformedData = items.map((item: any) => this.transformDynamoDBData(item));
      
      const result: HistoricalData = {
        data: transformedData,
        venueId,
        range
      };
      
      // ============================================
      // CACHE STORE - Option C: Cache for future requests
      // ============================================
      historicalCache.set(venueId, range as string, result);
      
      return result;
    } catch (error: any) {
      console.error('❌ Failed to fetch historical sensor data from DynamoDB');
      console.error('🔍 Full Error Object:', {
        name: error?.name,
        message: error?.message,
        code: error?.code,
        statusCode: error?.statusCode,
        errorType: error?.errorType,
        errors: error?.errors,
        data: error?.data,
        fullError: JSON.stringify(error, Object.getOwnPropertyNames(error), 2)
      });
      const errorMessage = this.extractErrorMessage(error);
      // Avoid double-wrapping error messages
      if (this.isAlreadyWrapped(errorMessage, 'Failed to fetch historical data')) {
        throw error; // Re-throw original error if already wrapped
      }
      throw new Error(`Failed to fetch historical data from DynamoDB: ${errorMessage}`);
    }
  }

  /**
   * Get sensor data for a specific date range (used for chunked fetching like song history)
   * Returns raw sensor data between absolute start and end times
   */
  async getSensorDataByDateRange(venueId: string, startTime: Date, endTime: Date, limit: number = 10000): Promise<SensorData[]> {
    console.log(`🔍 Fetching sensor data for date range: ${startTime.toISOString()} to ${endTime.toISOString()}`);
    
    // Demo mode check
    if (isDemoAccount(venueId)) {
      console.log('🎭 Demo mode - skipping date range query');
      return [];
    }
    
    try {
      this.checkGraphQLEndpoint();
      
      const session = await fetchAuthSession();
      if (!session.tokens) {
        throw new Error('Not authenticated. Please log in again.');
      }

      const client = this.getClient();
      
      const response = await client.graphql({
        query: listSensorData,
        variables: { 
          venueId, 
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          limit
        },
        authMode: 'userPool'
      }) as any;

      if (response?.errors && response.errors.length > 0) {
        console.error('❌ GraphQL errors:', response.errors);
        throw new Error(`GraphQL error: ${response.errors.map((e: any) => e.message).join(', ')}`);
      }

      const items = response?.data?.listSensorData?.items || [];
      console.log(`✅ Retrieved ${items.length} items for date range`);
      
      return items.map((item: any) => this.transformDynamoDBData(item));
    } catch (error: any) {
      console.error('❌ Error fetching sensor data by date range:', error);
      throw error;
    }
  }

  /**
   * Get occupancy metrics for a venue
   */
  async getOccupancyMetrics(venueId: string): Promise<OccupancyMetrics> {
    console.log('🔍 Fetching occupancy metrics from DynamoDB for venue:', venueId);
    
    // ✨ DEMO MODE: Return fake data for demo account only
    if (isDemoAccount(venueId)) {
      console.log('🎭 Demo mode detected - returning generated occupancy metrics');
      await new Promise(resolve => setTimeout(resolve, 300)); // Simulate network delay
      return generateDemoOccupancyMetrics();
    }
    
    try {
      // Check if GraphQL endpoint is configured
      this.checkGraphQLEndpoint();

      // Verify authentication
      const session = await fetchAuthSession();
      if (!session.tokens) {
        throw new Error('Not authenticated. Please log in again.');
      }

      const client = this.getClient();

      const response = await client.graphql({
        query: getOccupancyMetricsQuery,
        variables: { venueId },
        authMode: 'userPool'
      }) as any;

      // Check for GraphQL errors in response
      if (response?.errors && response.errors.length > 0) {
        console.error('❌ GraphQL Response Errors:', {
          errors: response.errors,
          fullResponse: JSON.stringify(response, null, 2)
        });
        // Log detailed error information
        response.errors.forEach((error: any, index: number) => {
          console.error(`Error ${index + 1}:`, {
            message: error.message,
            errorType: error.errorType,
            errorInfo: error.errorInfo,
            data: error.data,
            path: error.path,
            locations: error.locations,
            extensions: error.extensions,
            fullError: JSON.stringify(error, Object.getOwnPropertyNames(error), 2)
          });
        });
        const errorMessages = response.errors.map((e: any) => e.message || e).join(', ');
        throw new Error(`GraphQL error: ${errorMessages}`);
      }

      const metrics = response?.data?.getOccupancyMetrics;
      
      if (!metrics) {
        throw new Error(`No occupancy metrics found for venue: ${venueId}`);
      }

      // Calculate dwell time based on current occupancy and today's entries
      const avgDwellTimeMinutes = calculateCurrentHourDwellTime(
        metrics.current || 0,
        metrics.todayEntries || 0
      );

      console.log('✅ Occupancy metrics retrieved from DynamoDB');
      console.log(`📊 Calculated dwell time: ${avgDwellTimeMinutes ? avgDwellTimeMinutes + ' minutes' : 'N/A'}`);
      
      return {
        ...metrics,
        avgDwellTimeMinutes
      };
    } catch (error: any) {
      console.error('❌ Failed to fetch occupancy metrics from DynamoDB');
      console.error('🔍 Full Error Object:', {
        name: error?.name,
        message: error?.message,
        code: error?.code,
        statusCode: error?.statusCode,
        errorType: error?.errorType,
        errors: error?.errors,
        data: error?.data,
        fullError: JSON.stringify(error, Object.getOwnPropertyNames(error), 2)
      });
      const errorMessage = this.extractErrorMessage(error);
      // Avoid double-wrapping error messages
      if (this.isAlreadyWrapped(errorMessage, 'Failed to fetch occupancy metrics')) {
        throw error; // Re-throw original error if already wrapped
      }
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
  private getTimeRangeValues(range: TimeRange | string): { startTime: string; endTime: string } {
    const endTime = new Date().toISOString();
    let startTime: string;

    // Handle custom day ranges (e.g., "45d", "365d")
    if (typeof range === 'string' && range.endsWith('d') && !['7d', '30d', '90d'].includes(range)) {
      const days = parseInt(range.replace('d', ''));
      if (!isNaN(days) && days > 0) {
        startTime = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        return { startTime, endTime };
      }
    }

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
      case '1d':
        startTime = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
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

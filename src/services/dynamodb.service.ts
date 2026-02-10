import { generateClient } from '@aws-amplify/api';
import { fetchAuthSession } from '@aws-amplify/auth';
import type { SensorData, TimeRange, HistoricalData, OccupancyMetrics } from '../types';
import { isDemoAccount, generateDemoLiveData, generateDemoHistoricalData, generateDemoOccupancyMetrics, generateDemoDateRangeData } from '../utils/demoData';
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
  
  // Clear cache for a specific venue and range
  clearRange(venueId: string, range: string): void {
    const key = this.getCacheKey(venueId, range);
    this.cache.delete(key);
    console.log(`📦 [${range}] Cache CLEARED for venue ${venueId}`);
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

// Query for pre-aggregated hourly data (FAST - for charts)
const listHourlySensorData = /* GraphQL */ `
  query ListHourlySensorData($venueId: ID!, $startTime: String!, $endTime: String!, $limit: Int) {
    listHourlySensorData(venueId: $venueId, startTime: $startTime, endTime: $endTime, limit: $limit) {
      items {
        venueId
        timestamp
        avgDecibels
        avgLight
        avgIndoorTemp
        avgOutdoorTemp
        avgHumidity
        maxOccupancy
        totalEntries
        totalExits
        topSong
        topArtist
        dataPointCount
      }
      nextToken
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
    // CACHE CHECK - Return cached data if available
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

      // ============================================
      // 24H: FETCH ALL RAW DATA FOR 100% ACCURACY
      // ============================================
      if (range === '24h') {
        return await this.fetch24hFullAccuracy(venueId);
      }

      const { startTime, endTime } = this.getTimeRangeValues(range);
      const client = this.getClient();
      const startTimeMs = new Date(startTime).getTime();
      const endTimeMs = new Date(endTime).getTime();

      // ============================================
      // OTHER RANGES: CHUNKED FETCHING WITH AGGREGATION
      // ============================================
      const chunkConfig: Record<string, { chunks: number; itemsPerChunk: number }> = {
        '7d':  { chunks: 7, itemsPerChunk: 500 },     // 1 chunk per day
        '14d': { chunks: 14, itemsPerChunk: 500 },    // 1 chunk per day
        '30d': { chunks: 30, itemsPerChunk: 300 },    // 1 chunk per day
        '90d': { chunks: 45, itemsPerChunk: 200 },    // 2 days per chunk
      };
      const config = chunkConfig[range as string] || { chunks: 7, itemsPerChunk: 500 };
      const { chunks, itemsPerChunk } = config;
      
      const totalRangeMs = endTimeMs - startTimeMs;
      const chunkDurationMs = totalRangeMs / chunks;
      
      console.log(`📊 [${range}] Fetching in ${chunks} chunks, ~${itemsPerChunk} items each`);

      let allItems: any[] = [];
      
      // Fetch each chunk in parallel for speed
      const chunkPromises = [];
      for (let i = 0; i < chunks; i++) {
        const chunkStart = new Date(startTimeMs + (i * chunkDurationMs)).toISOString();
        const chunkEnd = new Date(startTimeMs + ((i + 1) * chunkDurationMs)).toISOString();
        
        chunkPromises.push(
          client.graphql({
            query: listSensorData,
            variables: { 
              venueId, 
              startTime: chunkStart,
              endTime: chunkEnd,
              limit: itemsPerChunk
            },
            authMode: 'userPool'
          }).then((response: any) => {
            if (response?.errors?.length > 0) {
              console.warn(`⚠️ Chunk ${i} errors:`, response.errors);
              return [];
            }
            return response?.data?.listSensorData?.items || [];
          }).catch((err: any) => {
            console.warn(`⚠️ Chunk ${i} failed:`, err.message);
            return [];
          })
        );
      }
      
      // Wait for all chunks
      const chunkResults = await Promise.all(chunkPromises);
      
      // Combine results and deduplicate by timestamp
      const seenTimestamps = new Set<string>();
      for (let i = 0; i < chunkResults.length; i++) {
        const items = chunkResults[i];
        for (const item of items) {
          if (!seenTimestamps.has(item.timestamp)) {
            seenTimestamps.add(item.timestamp);
            allItems.push(item);
          }
        }
      }
      
      console.log(`📊 [${range}] Total fetched: ${allItems.length} unique items from ${chunks} chunks`);

      const items = allItems;
      
      // Sort items by timestamp (oldest first for chronological chart display)
      items.sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      
      if (items.length > 0) {
        const oldestItem = items[0];
        const newestItem = items[items.length - 1];
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
            range: range as TimeRange,
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
          range: range as TimeRange,
          message: `No recent data available. Showing ${expandedItems.length} historical data points. Device may be offline.`
        };
      }

      console.log(`✅ Retrieved ${items.length} historical data points from DynamoDB`);
      
      // Transform data
      const transformedData: SensorData[] = items.map((item: any) => this.transformDynamoDBData(item));
      
      // ============================================
      // PROPER TIME-BASED AGGREGATION (NOT DOWNSAMPLING)
      // ============================================
      // Instead of skipping data points, we aggregate into time buckets
      // This preserves accuracy while reducing chart points
      
      const aggregatedData = this.aggregateByTimeBucket(transformedData, range as string);
      console.log(`📊 [${range}] Aggregated: ${transformedData.length} → ${aggregatedData.length} time buckets`);
      
      const result: HistoricalData = {
        data: aggregatedData,
        venueId,
        range: range as TimeRange
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
   * Now properly handles pagination to get ALL data, not just the first page
   */
  async getSensorDataByDateRange(venueId: string, startTime: Date, endTime: Date, limit: number = 10000): Promise<SensorData[]> {
    console.log(`🔍 Fetching sensor data for date range: ${startTime.toISOString()} to ${endTime.toISOString()}`);
    
    // Demo mode check
    if (isDemoAccount(venueId)) {
      console.log('🎭 Demo mode - generating date range data for dwell time');
      return generateDemoDateRangeData(startTime, endTime);
    }
    
    try {
      this.checkGraphQLEndpoint();
      
      const session = await fetchAuthSession();
      if (!session.tokens) {
        throw new Error('Not authenticated. Please log in again.');
      }

      const client = this.getClient();
      
      // Use pagination to fetch ALL data, not just the first page
      let allItems: any[] = [];
      let nextToken: string | null = null;
      let pageCount = 0;
      const maxPages = 50; // Safety limit to prevent infinite loops
      const pageSize = Math.min(limit, 1000); // Use reasonable page size
      
      do {
        pageCount++;
        
        const response = await client.graphql({
          query: listSensorData,
          variables: { 
            venueId, 
            startTime: startTime.toISOString(),
            endTime: endTime.toISOString(),
            limit: pageSize,
            nextToken: nextToken
          },
          authMode: 'userPool'
        }) as any;

        if (response?.errors && response.errors.length > 0) {
          console.error('❌ GraphQL errors:', response.errors);
          throw new Error(`GraphQL error: ${response.errors.map((e: any) => e.message).join(', ')}`);
        }

        const items = response?.data?.listSensorData?.items || [];
        allItems = allItems.concat(items);
        nextToken = response?.data?.listSensorData?.nextToken || null;
        
        console.log(`   Page ${pageCount}: ${items.length} items (total: ${allItems.length})`);
        
      } while (nextToken && pageCount < maxPages);
      
      if (nextToken && pageCount >= maxPages) {
        console.warn(`⚠️ Reached max page limit (${maxPages}), some data may be missing`);
      }
      
      console.log(`✅ Retrieved ${allItems.length} total items for date range (${pageCount} pages)`);
      
      return allItems.map((item: any) => this.transformDynamoDBData(item));
    } catch (error: any) {
      // Log detailed error info for debugging
      console.error('❌ Error fetching sensor data by date range:', {
        message: error?.message || 'Unknown error',
        name: error?.name,
        code: error?.code,
        errors: error?.errors,
        // GraphQL-specific error details
        graphQLErrors: error?.errors?.map((e: any) => ({
          message: e.message,
          errorType: e.errorType,
          path: e.path
        }))
      });
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
   * Fetch pre-aggregated hourly data (FAST)
   * Falls back to raw data calculation if hourly table not available
   */
  async getHourlySensorData(venueId: string, range: TimeRange | string): Promise<HistoricalData> {
    console.log('📊 Fetching pre-aggregated hourly data for:', venueId, range);
    
    // Demo mode
    if (isDemoAccount(venueId)) {
      return generateDemoHistoricalData(venueId, range as TimeRange);
    }
    
    // Check cache
    const cacheKey = `hourly_${range}`;
    const cachedData = historicalCache.get(venueId, cacheKey);
    if (cachedData) {
      return cachedData;
    }
    
    try {
      this.checkGraphQLEndpoint();
      
      const session = await fetchAuthSession();
      if (!session.tokens) {
        throw new Error('Not authenticated');
      }
      
      const { startTime, endTime } = this.getTimeRangeValues(range);
      const client = this.getClient();
      
      console.log(`📊 [Hourly] Querying: ${startTime} to ${endTime}`);
      
      const response = await client.graphql({
        query: listHourlySensorData,
        variables: {
          venueId,
          startTime,
          endTime,
          limit: 2500 // More than enough for 90 days
        },
        authMode: 'userPool'
      }) as any;
      
      if (response?.errors?.length > 0) {
        console.error('❌ Hourly query GraphQL errors:', JSON.stringify(response.errors, null, 2));
        throw new Error(`Hourly data query failed: ${response.errors[0]?.message || 'Unknown GraphQL error'}`);
      }
      
      console.log('📊 [Hourly] Response received:', response?.data?.listHourlySensorData ? 'has data' : 'NO DATA');
      const items = response?.data?.listHourlySensorData?.items || [];
      
      if (items.length === 0) {
        console.log('⚠️ No hourly data found, falling back to raw data...');
        return this.getHistoricalSensorData(venueId, range);
      }
      
      console.log(`📊 [Hourly] Retrieved ${items.length} hourly aggregates`);
      
      // Transform hourly data to SensorData format for charts
      const transformedData: SensorData[] = items
        .sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
        .map((item: any) => ({
          timestamp: item.timestamp,
          decibels: item.avgDecibels || 0,
          light: item.avgLight || 0,
          indoorTemp: item.avgIndoorTemp || 0,
          outdoorTemp: item.avgOutdoorTemp || 0,
          humidity: item.avgHumidity || 0,
          currentSong: item.topSong,
          artist: item.topArtist,
          occupancy: {
            current: item.maxOccupancy || 0,
            entries: item.totalEntries || 0,
            exits: item.totalExits || 0,
          },
          _hourlyAggregate: true,
          _dataPointCount: item.dataPointCount
        }));
      
      const result: HistoricalData = {
        data: transformedData,
        venueId,
        range: range as TimeRange
      };
      
      // Cache the result
      historicalCache.set(venueId, cacheKey, result);
      
      return result;
      
    } catch (error: any) {
      // Stringify the full error to see all details
      console.error('❌ Hourly data fetch failed - Full details:');
      console.error('  Message:', error?.message || 'none');
      console.error('  Name:', error?.name || 'none');
      console.error('  Errors array:', JSON.stringify(error?.errors, null, 2));
      console.error('  Full error stringified:', JSON.stringify(error, Object.getOwnPropertyNames(error || {}), 2));
      console.warn('⚠️ Falling back to raw data aggregation...');
      // Fallback to raw data aggregation
      return this.getHistoricalSensorData(venueId, range);
    }
  }

  /**
   * Fetch ALL 24h data and calculate TRUE hourly averages
   * This ensures 100% accuracy - every single data point contributes to the average
   */
  private async fetch24hFullAccuracy(venueId: string): Promise<HistoricalData> {
    const client = this.getClient();
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000);
    
    console.log('📊 [24h] Fetching ALL raw data for 100% accuracy...');
    console.log(`📊 [24h] Time range: ${startTime.toISOString()} to ${endTime.toISOString()}`);
    
    // Fetch ALL data using pagination
    let allItems: any[] = [];
    let nextToken: string | null = null;
    let fetchCount = 0;
    const maxFetches = 50; // Safety limit
    
    do {
      fetchCount++;
      console.log(`📊 [24h] Fetch #${fetchCount}${nextToken ? ' (continuing...)' : ''}`);
      
      const response = await client.graphql({
        query: listSensorData,
        variables: { 
          venueId, 
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          limit: 1000, // Max per request
          nextToken: nextToken
        },
        authMode: 'userPool'
      }) as any;
      
      if (response?.errors?.length > 0) {
        console.warn('⚠️ GraphQL errors:', response.errors);
        break;
      }
      
      const items = response?.data?.listSensorData?.items || [];
      allItems = allItems.concat(items);
      nextToken = response?.data?.listSensorData?.nextToken || null;
      
      console.log(`📊 [24h] Fetched ${items.length} items, total so far: ${allItems.length}`);
      
    } while (nextToken && fetchCount < maxFetches);
    
    console.log(`📊 [24h] TOTAL RAW DATA POINTS: ${allItems.length}`);
    
    if (allItems.length === 0) {
      return {
        data: [],
        venueId,
        range: '24h' as TimeRange,
        message: 'No data found for the last 24 hours'
      };
    }
    
    // ============================================
    // CALCULATE TRUE HOURLY AVERAGES
    // Every single data point contributes to these averages
    // ============================================
    
    // Group by hour
    const hourlyBuckets = new Map<number, any[]>();
    
    for (const item of allItems) {
      const timestamp = new Date(item.timestamp);
      // Create bucket key: start of the hour
      const hourKey = new Date(timestamp);
      hourKey.setMinutes(0, 0, 0);
      const bucketKey = hourKey.getTime();
      
      if (!hourlyBuckets.has(bucketKey)) {
        hourlyBuckets.set(bucketKey, []);
      }
      hourlyBuckets.get(bucketKey)!.push(item);
    }
    
    console.log(`📊 [24h] Grouped into ${hourlyBuckets.size} hourly buckets`);
    
    // Calculate TRUE averages for each hour
    const aggregatedData: SensorData[] = [];
    
    const sortedBucketKeys = Array.from(hourlyBuckets.keys()).sort((a, b) => a - b);
    
    for (const bucketKey of sortedBucketKeys) {
      const bucketData = hourlyBuckets.get(bucketKey)!;
      const bucketTime = new Date(bucketKey);
      
      // Sum all values
      let sumDecibels = 0, countDecibels = 0;
      let sumLight = 0, countLight = 0;
      let sumIndoorTemp = 0, countIndoorTemp = 0;
      let sumOutdoorTemp = 0, countOutdoorTemp = 0;
      let sumHumidity = 0, countHumidity = 0;
      let maxOccupancy = 0;
      let maxEntries = 0;
      let maxExits = 0;
      let latestSong: string | undefined;
      let latestArtist: string | undefined;
      let latestAlbumArt: string | undefined;
      
      for (const item of bucketData) {
        // Decibels - only count valid readings
        if (item.decibels !== undefined && item.decibels !== null && item.decibels > 0) {
          sumDecibels += item.decibels;
          countDecibels++;
        }
        // Light
        if (item.light !== undefined && item.light !== null && item.light >= 0) {
          sumLight += item.light;
          countLight++;
        }
        // Indoor temp
        if (item.indoorTemp !== undefined && item.indoorTemp !== null && item.indoorTemp > 0) {
          sumIndoorTemp += item.indoorTemp;
          countIndoorTemp++;
        }
        // Outdoor temp
        if (item.outdoorTemp !== undefined && item.outdoorTemp !== null) {
          sumOutdoorTemp += item.outdoorTemp;
          countOutdoorTemp++;
        }
        // Humidity
        if (item.humidity !== undefined && item.humidity !== null && item.humidity >= 0) {
          sumHumidity += item.humidity;
          countHumidity++;
        }
        // Occupancy - take max for the hour
        if (item.occupancy) {
          if (item.occupancy.current !== undefined && item.occupancy.current > maxOccupancy) {
            maxOccupancy = item.occupancy.current;
          }
          if (item.occupancy.entries !== undefined && item.occupancy.entries > maxEntries) {
            maxEntries = item.occupancy.entries;
          }
          if (item.occupancy.exits !== undefined && item.occupancy.exits > maxExits) {
            maxExits = item.occupancy.exits;
          }
        }
        // Song - keep latest
        if (item.currentSong) {
          latestSong = item.currentSong;
          latestArtist = item.artist;
          latestAlbumArt = item.albumArt;
        }
      }
      
      // Calculate TRUE averages
      const avgDecibels = countDecibels > 0 ? Math.round((sumDecibels / countDecibels) * 10) / 10 : 0;
      const avgLight = countLight > 0 ? Math.round(sumLight / countLight) : 0;
      const avgIndoorTemp = countIndoorTemp > 0 ? Math.round((sumIndoorTemp / countIndoorTemp) * 10) / 10 : 0;
      const avgOutdoorTemp = countOutdoorTemp > 0 ? Math.round((sumOutdoorTemp / countOutdoorTemp) * 10) / 10 : 0;
      const avgHumidity = countHumidity > 0 ? Math.round(sumHumidity / countHumidity) : 0;
      
      // Log details for verification
      console.log(`📊 Hour ${bucketTime.toLocaleTimeString('en-US', { hour: 'numeric' })}: ` +
        `${bucketData.length} points → ` +
        `dB: ${avgDecibels} (from ${countDecibels}), ` +
        `occ: ${maxOccupancy}`
      );
      
      aggregatedData.push({
        timestamp: new Date(bucketKey + 30 * 60 * 1000).toISOString(), // Use middle of hour
        decibels: avgDecibels,
        light: avgLight,
        indoorTemp: avgIndoorTemp,
        outdoorTemp: avgOutdoorTemp,
        humidity: avgHumidity,
        currentSong: latestSong,
        artist: latestArtist,
        albumArt: latestAlbumArt,
        occupancy: {
          current: maxOccupancy,
          entries: maxEntries,
          exits: maxExits,
        }
      });
    }
    
    console.log(`📊 [24h] Final output: ${aggregatedData.length} hourly data points (TRUE averages from ${allItems.length} raw readings)`);
    
    const result: HistoricalData = {
      data: aggregatedData,
      venueId,
      range: '24h' as TimeRange
    };
    
    // Cache the result
    historicalCache.set(venueId, '24h', result);
    
    return result;
  }

  /**
   * Aggregate data into time buckets for accurate chart display
   * Instead of downsampling (which loses data), we calculate proper averages
   */
  private aggregateByTimeBucket(data: SensorData[], range: string): SensorData[] {
    if (data.length === 0) return [];
    
    // Determine bucket size based on range
    // Goal: ~100-200 data points for smooth charts with accurate representation
    const bucketConfig: Record<string, number> = {
      '24h': 15 * 60 * 1000,        // 15-minute buckets = 96 points
      '7d':  60 * 60 * 1000,         // 1-hour buckets = 168 points
      '14d': 2 * 60 * 60 * 1000,     // 2-hour buckets = 168 points
      '30d': 4 * 60 * 60 * 1000,     // 4-hour buckets = 180 points
      '90d': 24 * 60 * 60 * 1000,    // 24-hour (daily) buckets = 90 points
    };
    
    const bucketSize = bucketConfig[range] || 60 * 60 * 1000; // Default 1 hour
    
    // Group data into buckets
    const buckets = new Map<number, SensorData[]>();
    
    for (const item of data) {
      const timestamp = new Date(item.timestamp).getTime();
      const bucketKey = Math.floor(timestamp / bucketSize) * bucketSize;
      
      if (!buckets.has(bucketKey)) {
        buckets.set(bucketKey, []);
      }
      buckets.get(bucketKey)!.push(item);
    }
    
    // Calculate aggregates for each bucket
    const aggregated: SensorData[] = [];
    
    // Sort bucket keys chronologically
    const sortedBucketKeys = Array.from(buckets.keys()).sort((a, b) => a - b);
    
    for (const bucketKey of sortedBucketKeys) {
      const bucketData = buckets.get(bucketKey)!;
      
      // Calculate averages
      let sumDecibels = 0, countDecibels = 0;
      let sumLight = 0, countLight = 0;
      let sumIndoorTemp = 0, countIndoorTemp = 0;
      let sumOutdoorTemp = 0, countOutdoorTemp = 0;
      let sumHumidity = 0, countHumidity = 0;
      let maxOccupancy = 0;
      let maxEntries = 0;
      let maxExits = 0;
      let latestSong: string | undefined;
      let latestArtist: string | undefined;
      let latestAlbumArt: string | undefined;
      
      for (const item of bucketData) {
        if (item.decibels !== undefined && item.decibels !== null && item.decibels > 0) {
          sumDecibels += item.decibels;
          countDecibels++;
        }
        if (item.light !== undefined && item.light !== null) {
          sumLight += item.light;
          countLight++;
        }
        if (item.indoorTemp !== undefined && item.indoorTemp !== null && item.indoorTemp > 0) {
          sumIndoorTemp += item.indoorTemp;
          countIndoorTemp++;
        }
        if (item.outdoorTemp !== undefined && item.outdoorTemp !== null) {
          sumOutdoorTemp += item.outdoorTemp;
          countOutdoorTemp++;
        }
        if (item.humidity !== undefined && item.humidity !== null) {
          sumHumidity += item.humidity;
          countHumidity++;
        }
        if (item.occupancy) {
          if (item.occupancy.current > maxOccupancy) {
            maxOccupancy = item.occupancy.current;
          }
          if (item.occupancy.entries && item.occupancy.entries > maxEntries) {
            maxEntries = item.occupancy.entries;
          }
          if (item.occupancy.exits && item.occupancy.exits > maxExits) {
            maxExits = item.occupancy.exits;
          }
        }
        // Keep the latest song info
        if (item.currentSong) {
          latestSong = item.currentSong;
          latestArtist = item.artist;
          latestAlbumArt = item.albumArt;
        }
      }
      
      // Use the bucket's midpoint as the timestamp for better representation
      const bucketMidpoint = new Date(bucketKey + bucketSize / 2);
      
      aggregated.push({
        timestamp: bucketMidpoint.toISOString(),
        decibels: countDecibels > 0 ? Math.round((sumDecibels / countDecibels) * 10) / 10 : 0,
        light: countLight > 0 ? Math.round(sumLight / countLight) : 0,
        indoorTemp: countIndoorTemp > 0 ? Math.round((sumIndoorTemp / countIndoorTemp) * 10) / 10 : 0,
        outdoorTemp: countOutdoorTemp > 0 ? Math.round((sumOutdoorTemp / countOutdoorTemp) * 10) / 10 : 0,
        humidity: countHumidity > 0 ? Math.round(sumHumidity / countHumidity) : 0,
        currentSong: latestSong,
        artist: latestArtist,
        albumArt: latestAlbumArt,
        occupancy: {
          current: maxOccupancy,
          entries: maxEntries,
          exits: maxExits,
        },
        // Store metadata about the aggregation for debugging
        _aggregation: {
          dataPoints: bucketData.length,
          bucketStart: new Date(bucketKey).toISOString(),
          bucketEnd: new Date(bucketKey + bucketSize).toISOString(),
        }
      } as SensorData);
    }
    
    console.log(`📊 Aggregation complete: ${data.length} raw → ${aggregated.length} buckets (${bucketSize / 60000} min each)`);
    
    return aggregated;
  }

  /**
   * Transform DynamoDB item to SensorData format
   * Handles both formats:
   * - Old/flat format: { decibels, light, currentSong, artist, ... }
   * - New/nested format (Pi Zero 2W): { sensors: { sound_level, light_level, ... }, spotify: { current_song, artist, ... }, ... }
   */
  private transformDynamoDBData(item: any): SensorData {
    // Handle nested sensors object (Pi Zero 2W format)
    const sensors = item.sensors || {};
    const spotify = item.spotify || {};
    
    // Get sound level - try nested first, then flat
    const decibels = sensors.sound_level ?? item.decibels ?? 0;
    
    // Get light level - try nested first, then flat
    const light = sensors.light_level ?? item.light ?? 0;
    
    // Get temperature - try nested first, then flat
    const indoorTemp = sensors.indoor_temperature ?? item.indoorTemp ?? 0;
    const outdoorTemp = sensors.outdoor_temperature ?? item.outdoorTemp ?? 0;
    
    // Get humidity - try nested first, then flat
    const humidity = sensors.humidity ?? item.humidity ?? 0;
    
    // Get music info - try nested spotify first, then flat
    const currentSong = spotify.current_song ?? item.currentSong ?? null;
    const artist = spotify.artist ?? item.artist ?? null;
    const albumArt = spotify.album_art ?? item.albumArt ?? null;
    
    return {
      timestamp: item.timestamp || new Date().toISOString(),
      decibels,
      light,
      indoorTemp,
      outdoorTemp,
      humidity,
      currentSong,
      albumArt,
      artist,
      occupancy: item.occupancy ? {
        current: item.occupancy.current || 0,
        entries: item.occupancy.entries || 0,
        exits: item.occupancy.exits || 0,
        capacity: item.occupancy.capacity,
        // BLE device breakdown (Pi Zero 2W)
        total_devices: item.occupancy.total_devices,
        device_breakdown: item.occupancy.device_breakdown,
        // BLE dwell time tracking (Pi Zero 2W)
        avg_stay_minutes: item.occupancy.avg_stay_minutes,
        longest_current_minutes: item.occupancy.longest_current_minutes,
        total_visits_tracked: item.occupancy.total_visits_tracked
      } : undefined
    };
  }

  /**
   * Get the most recent 3am boundary (bar day start)
   * If it's currently before 3am, returns yesterday's 3am
   * If it's currently after 3am, returns today's 3am
   */
  private getMostRecent3am(): Date {
    const now = new Date();
    const today3am = new Date(now);
    today3am.setHours(3, 0, 0, 0);
    
    // If we haven't reached 3am yet today, use yesterday's 3am
    if (now < today3am) {
      today3am.setDate(today3am.getDate() - 1);
    }
    
    return today3am;
  }

  /**
   * Calculate start and end times for a given time range
   * 
   * Bar day aligned ranges (7d, 14d, 30d, 24h/1d):
   * - End time: Most recent 3am OR now (whichever gives complete data)
   * - Start time: X bar days before end time at 3am
   * 
   * Real-time ranges (live, 6h):
   * - Use actual current time for freshness
   */
  private getTimeRangeValues(range: TimeRange | string): { startTime: string; endTime: string } {
    const now = new Date();
    const mostRecent3am = this.getMostRecent3am();
    
    let startTime: string;
    let endTime: string;

    // Handle custom day ranges (e.g., "45d", "365d")
    if (typeof range === 'string' && range.endsWith('d') && !['7d', '14d', '30d', '90d', '24h', '1d'].includes(range)) {
      const days = parseInt(range.replace('d', ''));
      if (!isNaN(days) && days > 0) {
        // Align to 3am boundaries
        const start3am = new Date(mostRecent3am);
        start3am.setDate(start3am.getDate() - days);
        return { 
          startTime: start3am.toISOString(), 
          endTime: now.toISOString() // Use now for most recent data
        };
      }
    }

    switch (range) {
      case 'live':
        // Real-time: last 5 minutes from now
        startTime = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        endTime = now.toISOString();
        break;
        
      case '6h':
        // Real-time: last 6 hours from now
        startTime = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
        endTime = now.toISOString();
        break;
        
      case '24h':
      case '1d': {
        // Last complete bar day: previous 3am to most recent 3am
        const previousBarDay = new Date(mostRecent3am);
        previousBarDay.setDate(previousBarDay.getDate() - 1);
        startTime = previousBarDay.toISOString();
        endTime = now.toISOString(); // Include today's partial data too
        break;
      }
        
      case '7d': {
        // Last 7 bar days: 7 days ago at 3am to now
        const start7d = new Date(mostRecent3am);
        start7d.setDate(start7d.getDate() - 7);
        startTime = start7d.toISOString();
        endTime = now.toISOString();
        break;
      }
        
      case '14d': {
        // Last 14 bar days: 14 days ago at 3am to now
        const start14d = new Date(mostRecent3am);
        start14d.setDate(start14d.getDate() - 14);
        startTime = start14d.toISOString();
        endTime = now.toISOString();
        break;
      }
        
      case '30d': {
        // Last 30 bar days: 30 days ago at 3am to now
        const start30d = new Date(mostRecent3am);
        start30d.setDate(start30d.getDate() - 30);
        startTime = start30d.toISOString();
        endTime = now.toISOString();
        break;
      }
        
      case '90d': {
        // Last 90 bar days: 90 days ago at 3am to now
        const start90d = new Date(mostRecent3am);
        start90d.setDate(start90d.getDate() - 90);
        startTime = start90d.toISOString();
        endTime = now.toISOString();
        break;
      }
        
      default:
        startTime = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        endTime = now.toISOString();
    }

    return { startTime, endTime };
  }
}

export default new DynamoDBService();

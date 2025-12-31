/**
 * Historical Data Cache Service
 * 
 * Uses localStorage to cache historical data that doesn't change.
 * Past days' data is cached indefinitely because yesterday's numbers are final.
 * 
 * IMPORTANT: Current/live data is NEVER cached - only historical.
 */

import type { SensorData, HistoricalData, TimeRange } from '../types';

// Cache key prefix
const CACHE_PREFIX = 'pulse_historical_';
const CACHE_INDEX_KEY = 'pulse_cache_index';

// Maximum cache size (in bytes, ~5MB to stay safe within localStorage limits)
const MAX_CACHE_SIZE = 5 * 1024 * 1024;

interface CachedHistoricalData {
  data: SensorData[];
  venueId: string;
  range: string;
  cachedAt: string;       // ISO timestamp
  oldestDataPoint: string; // ISO timestamp of oldest data point
  newestDataPoint: string; // ISO timestamp of newest data point
  dataPointCount: number;
}

interface CacheIndex {
  entries: {
    key: string;
    venueId: string;
    range: string;
    cachedAt: string;
    size: number; // Approximate size in bytes
  }[];
  totalSize: number;
}

class HistoricalCacheService {
  
  /**
   * Get cached historical data for a venue and range
   * Returns null if not cached or if cache is stale
   */
  getCachedData(venueId: string, range: TimeRange | string): HistoricalData | null {
    // NEVER cache live data
    if (range === 'live') {
      return null;
    }
    
    const key = this.getCacheKey(venueId, range);
    
    try {
      const cached = localStorage.getItem(key);
      if (!cached) {
        return null;
      }
      
      const parsed: CachedHistoricalData = JSON.parse(cached);
      
      // Check if cache is still valid
      if (!this.isCacheValid(parsed, range)) {
        console.log(`📦 [${range}] Cache expired, removing`);
        this.removeCacheEntry(key);
        return null;
      }
      
      console.log(`📦 [${range}] localStorage cache HIT - ${parsed.dataPointCount} points`);
      
      return {
        data: parsed.data,
        venueId: parsed.venueId,
        range: range as TimeRange,
      };
    } catch (error) {
      console.warn(`📦 [${range}] Cache read error:`, error);
      this.removeCacheEntry(key);
      return null;
    }
  }
  
  /**
   * Cache historical data
   * Only caches if data contains past (immutable) days
   */
  cacheData(venueId: string, range: TimeRange | string, data: HistoricalData): void {
    // NEVER cache live data
    if (range === 'live') {
      return;
    }
    
    // Don't cache empty data
    if (!data.data || data.data.length === 0) {
      return;
    }
    
    const key = this.getCacheKey(venueId, range);
    
    try {
      // Find date range of data
      const timestamps = data.data.map(d => new Date(d.timestamp).getTime());
      const oldest = new Date(Math.min(...timestamps)).toISOString();
      const newest = new Date(Math.max(...timestamps)).toISOString();
      
      const cacheEntry: CachedHistoricalData = {
        data: data.data,
        venueId,
        range,
        cachedAt: new Date().toISOString(),
        oldestDataPoint: oldest,
        newestDataPoint: newest,
        dataPointCount: data.data.length,
      };
      
      const serialized = JSON.stringify(cacheEntry);
      const size = serialized.length;
      
      // Check if we need to make room
      this.ensureCacheSpace(size);
      
      localStorage.setItem(key, serialized);
      this.updateCacheIndex(key, venueId, range, size);
      
      console.log(`📦 [${range}] localStorage cache SET - ${data.data.length} points, ${Math.round(size/1024)}KB`);
    } catch (error) {
      console.warn(`📦 [${range}] Cache write error:`, error);
      // If localStorage is full, try to clear old entries
      this.clearOldestEntries(1);
    }
  }
  
  /**
   * Check if we have ANY cached data for a range that can be shown immediately
   * This is for the "show cached, fetch fresh" pattern
   */
  hasCachedData(venueId: string, range: TimeRange | string): boolean {
    if (range === 'live') return false;
    
    const key = this.getCacheKey(venueId, range);
    return localStorage.getItem(key) !== null;
  }
  
  /**
   * Get cached data points that are definitely in the past (immutable)
   * For ranges like 90d, returns days that are complete and won't change
   */
  getImmutableCachedData(venueId: string, range: TimeRange | string): SensorData[] {
    const cached = this.getCachedData(venueId, range);
    if (!cached || !cached.data) return [];
    
    // Filter to only include data points from completed days (before today)
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    
    return cached.data.filter(d => {
      const pointDate = new Date(d.timestamp);
      return pointDate < todayStart;
    });
  }
  
  /**
   * Clear all cache for a venue
   */
  clearVenueCache(venueId: string): void {
    const index = this.getCacheIndex();
    const keysToRemove = index.entries
      .filter(e => e.venueId === venueId)
      .map(e => e.key);
    
    keysToRemove.forEach(key => this.removeCacheEntry(key));
    console.log(`📦 Cleared ${keysToRemove.length} cache entries for venue ${venueId}`);
  }
  
  /**
   * Clear all historical cache
   */
  clearAllCache(): void {
    const index = this.getCacheIndex();
    index.entries.forEach(e => {
      try {
        localStorage.removeItem(e.key);
      } catch {}
    });
    localStorage.removeItem(CACHE_INDEX_KEY);
    console.log('📦 Cleared all historical cache');
  }
  
  /**
   * Get cache statistics
   */
  getCacheStats(): { entries: number; totalSize: number; byRange: Record<string, number> } {
    const index = this.getCacheIndex();
    const byRange: Record<string, number> = {};
    
    index.entries.forEach(e => {
      byRange[e.range] = (byRange[e.range] || 0) + e.size;
    });
    
    return {
      entries: index.entries.length,
      totalSize: index.totalSize,
      byRange,
    };
  }
  
  // ============ Private Methods ============
  
  private getCacheKey(venueId: string, range: string): string {
    return `${CACHE_PREFIX}${venueId}_${range}`;
  }
  
  private getCacheIndex(): CacheIndex {
    try {
      const stored = localStorage.getItem(CACHE_INDEX_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch {}
    return { entries: [], totalSize: 0 };
  }
  
  private saveCacheIndex(index: CacheIndex): void {
    try {
      localStorage.setItem(CACHE_INDEX_KEY, JSON.stringify(index));
    } catch (error) {
      console.warn('Failed to save cache index:', error);
    }
  }
  
  private updateCacheIndex(key: string, venueId: string, range: string, size: number): void {
    const index = this.getCacheIndex();
    
    // Remove existing entry for this key if present
    const existingIdx = index.entries.findIndex(e => e.key === key);
    if (existingIdx !== -1) {
      index.totalSize -= index.entries[existingIdx].size;
      index.entries.splice(existingIdx, 1);
    }
    
    // Add new entry
    index.entries.push({
      key,
      venueId,
      range,
      cachedAt: new Date().toISOString(),
      size,
    });
    index.totalSize += size;
    
    this.saveCacheIndex(index);
  }
  
  private removeCacheEntry(key: string): void {
    try {
      localStorage.removeItem(key);
      
      const index = this.getCacheIndex();
      const idx = index.entries.findIndex(e => e.key === key);
      if (idx !== -1) {
        index.totalSize -= index.entries[idx].size;
        index.entries.splice(idx, 1);
        this.saveCacheIndex(index);
      }
    } catch {}
  }
  
  private ensureCacheSpace(neededSize: number): void {
    const index = this.getCacheIndex();
    
    while (index.totalSize + neededSize > MAX_CACHE_SIZE && index.entries.length > 0) {
      this.clearOldestEntries(1);
    }
  }
  
  private clearOldestEntries(count: number): void {
    const index = this.getCacheIndex();
    
    // Sort by cachedAt ascending (oldest first)
    const sorted = [...index.entries].sort((a, b) => 
      new Date(a.cachedAt).getTime() - new Date(b.cachedAt).getTime()
    );
    
    for (let i = 0; i < Math.min(count, sorted.length); i++) {
      this.removeCacheEntry(sorted[i].key);
    }
  }
  
  private isCacheValid(cached: CachedHistoricalData, range: string): boolean {
    const cachedAt = new Date(cached.cachedAt);
    const now = new Date();
    const ageMs = now.getTime() - cachedAt.getTime();
    const ageHours = ageMs / (1000 * 60 * 60);
    
    // For past data (7d, 30d, 90d), cache is valid for longer
    // because past days don't change - only today's data needs refreshing
    switch (range) {
      case '6h':
        // 6h view needs fresh data for "today" portion
        // Cache valid for 10 minutes
        return ageHours < 0.17;
        
      case '24h':
        // 24h needs fresh data for rolling window
        // Cache valid for 30 minutes
        return ageHours < 0.5;
        
      case '7d':
      case '14d':
        // Week views - past days are stable
        // Cache valid for 2 hours (only today's portion changes)
        return ageHours < 2;
        
      case '30d':
        // Month view - cache valid for 4 hours
        return ageHours < 4;
        
      case '90d':
        // 90 day view - cache valid for 8 hours
        // Past 89 days don't change, only today
        return ageHours < 8;
        
      default:
        // Default: 1 hour
        return ageHours < 1;
    }
  }
}

export const historicalCacheService = new HistoricalCacheService();
export default historicalCacheService;

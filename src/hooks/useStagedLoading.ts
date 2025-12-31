/**
 * Staged Loading Hook
 * 
 * Loads data in priority order:
 * 1. HERO (immediate): Current sensor reading for Pulse Score
 * 2. TODAY (fast): Today's stats, occupancy
 * 3. CONTEXT (background): Comparisons, weather
 * 4. HISTORY (on-demand): Charts, 30d, 90d data
 * 
 * Current/live data is NEVER cached - always fresh.
 * Historical data uses localStorage cache for past days.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { SensorData, OccupancyMetrics, TimeRange, HistoricalData } from '../types';
import apiService from '../services/api.service';
import historicalCacheService from '../services/historical-cache.service';
import weatherService, { WeatherData } from '../services/weather.service';
import venueSettingsService from '../services/venue-settings.service';

// Loading stages
export type LoadingStage = 'hero' | 'today' | 'context' | 'history';

export interface StagedLoadingState {
  // Stage 1: Hero (Pulse Score) - NEVER CACHED
  heroData: SensorData | null;
  heroLoading: boolean;
  heroError: string | null;
  
  // Stage 2: Today's data - NEVER CACHED
  todayOccupancy: OccupancyMetrics | null;
  todayLoading: boolean;
  todayError: string | null;
  
  // Stage 3: Context (comparisons, weather) - Weather can be cached
  weatherData: WeatherData | null;
  contextLoading: boolean;
  
  // Stage 4: Historical (on-demand) - Uses localStorage cache
  historicalData: HistoricalData | null;
  historicalLoading: boolean;
  historicalError: string | null;
  historicalFromCache: boolean; // True if showing cached data while fetching fresh
  
  // Overall
  currentStage: LoadingStage;
  isFullyLoaded: boolean;
}

interface UseStagedLoadingOptions {
  venueId: string;
  enabled?: boolean;
  pollingInterval?: number; // ms, for live data refresh
}

export function useStagedLoading({
  venueId,
  enabled = true,
  pollingInterval = 15000, // 15 seconds default
}: UseStagedLoadingOptions) {
  
  // State
  const [state, setState] = useState<StagedLoadingState>({
    heroData: null,
    heroLoading: true,
    heroError: null,
    
    todayOccupancy: null,
    todayLoading: true,
    todayError: null,
    
    weatherData: null,
    contextLoading: true,
    
    historicalData: null,
    historicalLoading: false,
    historicalError: null,
    historicalFromCache: false,
    
    currentStage: 'hero',
    isFullyLoaded: false,
  });
  
  // Track the selected time range for historical data
  const [selectedRange, setSelectedRange] = useState<TimeRange>('live');
  
  // Refs to prevent duplicate fetches
  const fetchingRef = useRef<Set<string>>(new Set());
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  
  // ============ Stage 1: Hero Data (Current Sensor Reading) ============
  const fetchHeroData = useCallback(async () => {
    if (!venueId || fetchingRef.current.has('hero')) return;
    
    fetchingRef.current.add('hero');
    
    try {
      console.log('⚡ [Stage 1] Fetching hero data (current sensor reading)...');
      const startTime = performance.now();
      
      const liveData = await apiService.getLiveData(venueId);
      
      const elapsed = Math.round(performance.now() - startTime);
      console.log(`✅ [Stage 1] Hero data loaded in ${elapsed}ms`);
      
      setState(prev => ({
        ...prev,
        heroData: liveData,
        heroLoading: false,
        heroError: null,
        currentStage: prev.currentStage === 'hero' ? 'today' : prev.currentStage,
      }));
    } catch (error: any) {
      console.error('❌ [Stage 1] Hero data failed:', error);
      setState(prev => ({
        ...prev,
        heroLoading: false,
        heroError: error.message || 'Failed to load current data',
      }));
    } finally {
      fetchingRef.current.delete('hero');
    }
  }, [venueId]);
  
  // ============ Stage 2: Today's Occupancy ============
  const fetchTodayData = useCallback(async () => {
    if (!venueId || fetchingRef.current.has('today')) return;
    
    fetchingRef.current.add('today');
    
    try {
      console.log('⚡ [Stage 2] Fetching today\'s occupancy...');
      const startTime = performance.now();
      
      const occupancy = await apiService.getOccupancyMetrics(venueId);
      
      const elapsed = Math.round(performance.now() - startTime);
      console.log(`✅ [Stage 2] Today's data loaded in ${elapsed}ms`);
      
      setState(prev => ({
        ...prev,
        todayOccupancy: occupancy,
        todayLoading: false,
        todayError: null,
        currentStage: prev.currentStage === 'today' ? 'context' : prev.currentStage,
      }));
    } catch (error: any) {
      console.error('❌ [Stage 2] Today data failed:', error);
      setState(prev => ({
        ...prev,
        todayLoading: false,
        todayError: error.message || 'Failed to load today\'s data',
      }));
    } finally {
      fetchingRef.current.delete('today');
    }
  }, [venueId]);
  
  // ============ Stage 3: Context (Weather) ============
  const fetchContextData = useCallback(async () => {
    if (!venueId || fetchingRef.current.has('context')) return;
    
    fetchingRef.current.add('context');
    
    try {
      console.log('⚡ [Stage 3] Fetching context data (weather)...');
      
      // Get venue address for weather
      const address = venueSettingsService.getFormattedAddress(venueId);
      
      if (address && address !== 'No address provided' && address.trim() !== '') {
        const weather = await weatherService.getWeatherByAddress(address);
        
        setState(prev => ({
          ...prev,
          weatherData: weather,
          contextLoading: false,
          currentStage: 'history',
          isFullyLoaded: true,
        }));
        
        console.log('✅ [Stage 3] Context data loaded');
      } else {
        setState(prev => ({
          ...prev,
          contextLoading: false,
          currentStage: 'history',
          isFullyLoaded: true,
        }));
      }
    } catch (error: any) {
      console.warn('⚠️ [Stage 3] Context data failed (non-critical):', error);
      setState(prev => ({
        ...prev,
        contextLoading: false,
        currentStage: 'history',
        isFullyLoaded: true,
      }));
    } finally {
      fetchingRef.current.delete('context');
    }
  }, [venueId]);
  
  // ============ Stage 4: Historical Data (On-Demand with Cache) ============
  const fetchHistoricalData = useCallback(async (range: TimeRange) => {
    if (!venueId || range === 'live') return;
    
    const fetchKey = `history_${range}`;
    if (fetchingRef.current.has(fetchKey)) return;
    
    fetchingRef.current.add(fetchKey);
    
    try {
      console.log(`⚡ [Stage 4] Fetching historical data for ${range}...`);
      const startTime = performance.now();
      
      // Check localStorage cache first
      const cachedData = historicalCacheService.getCachedData(venueId, range);
      
      if (cachedData) {
        // Show cached data immediately
        setState(prev => ({
          ...prev,
          historicalData: cachedData,
          historicalFromCache: true,
          historicalLoading: true, // Still loading fresh data
          historicalError: null,
        }));
        console.log(`📦 [Stage 4] Showing cached ${range} data, fetching fresh in background...`);
      } else {
        setState(prev => ({
          ...prev,
          historicalLoading: true,
          historicalFromCache: false,
          historicalError: null,
        }));
      }
      
      // Fetch fresh data
      const freshData = await apiService.getHistoricalData(venueId, range);
      
      // Cache for future use (only past days)
      historicalCacheService.cacheData(venueId, range, freshData);
      
      const elapsed = Math.round(performance.now() - startTime);
      console.log(`✅ [Stage 4] Historical ${range} loaded in ${elapsed}ms (${freshData.data?.length || 0} points)`);
      
      setState(prev => ({
        ...prev,
        historicalData: freshData,
        historicalLoading: false,
        historicalFromCache: false,
        historicalError: null,
      }));
    } catch (error: any) {
      console.error(`❌ [Stage 4] Historical ${range} failed:`, error);
      setState(prev => ({
        ...prev,
        historicalLoading: false,
        historicalError: error.message || 'Failed to load historical data',
        // Keep cached data if available
        historicalFromCache: prev.historicalFromCache,
      }));
    } finally {
      fetchingRef.current.delete(fetchKey);
    }
  }, [venueId]);
  
  // ============ Public Methods ============
  
  /**
   * Refresh current (hero) data - always fetches fresh
   */
  const refreshHero = useCallback(() => {
    fetchHeroData();
  }, [fetchHeroData]);
  
  /**
   * Load historical data for a specific range
   */
  const loadHistoricalRange = useCallback((range: TimeRange) => {
    setSelectedRange(range);
    if (range !== 'live') {
      fetchHistoricalData(range);
    }
  }, [fetchHistoricalData]);
  
  /**
   * Clear all cached data
   */
  const clearCache = useCallback(() => {
    historicalCacheService.clearVenueCache(venueId);
  }, [venueId]);
  
  // ============ Effects ============
  
  // Initial load - staged
  useEffect(() => {
    if (!enabled || !venueId) return;
    
    console.log('🚀 Starting staged loading for venue:', venueId);
    
    // Stage 1: Hero (immediate)
    fetchHeroData();
    
    // Stage 2: Today (after a tiny delay to let hero render)
    const todayTimeout = setTimeout(() => {
      fetchTodayData();
    }, 50);
    
    // Stage 3: Context (after hero and today are likely done)
    const contextTimeout = setTimeout(() => {
      fetchContextData();
    }, 300);
    
    return () => {
      clearTimeout(todayTimeout);
      clearTimeout(contextTimeout);
    };
  }, [enabled, venueId, fetchHeroData, fetchTodayData, fetchContextData]);
  
  // Polling for live data (hero only)
  useEffect(() => {
    if (!enabled || !venueId || selectedRange !== 'live') return;
    
    // Set up polling
    pollingRef.current = setInterval(() => {
      fetchHeroData();
    }, pollingInterval);
    
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [enabled, venueId, selectedRange, pollingInterval, fetchHeroData]);
  
  return {
    // State
    ...state,
    selectedRange,
    
    // Methods
    refreshHero,
    loadHistoricalRange,
    clearCache,
    
    // Computed
    hasHeroData: state.heroData !== null,
    hasTodayData: state.todayOccupancy !== null,
    hasHistoricalData: state.historicalData !== null,
  };
}

export default useStagedLoading;

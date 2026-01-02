/**
 * usePulseData - Consolidated data hook for Pulse dashboard
 * 
 * Single hook that fetches and manages:
 * - Live sensor data (sound, light)
 * - Occupancy metrics
 * - Google Reviews
 * - Weather data
 * - Historical data for comparisons
 * 
 * Calculates:
 * - Pulse Score
 * - Dwell time
 * - All supporting metrics
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { calculatePulseScore, getDwellTimeScore, formatDwellTime, getReputationScore } from '../utils/scoring';
import { POLLING_INTERVALS, DATA_FRESHNESS } from '../utils/constants';
import apiService from '../services/api.service';
import authService from '../services/auth.service';
import googleReviewsService, { GoogleReviewsData } from '../services/google-reviews.service';
import venueSettingsService from '../services/venue-settings.service';
import weatherService, { WeatherData } from '../services/weather.service';
import type { SensorData, OccupancyMetrics } from '../types';

// ============ TYPES ============

export interface PulseData {
  // Loading states
  loading: boolean;
  error: string | null;
  
  // Connection status
  isConnected: boolean;
  lastUpdated: Date | null;
  dataAgeSeconds: number;
  
  // Core Pulse Score
  pulseScore: number | null;
  pulseStatus: 'optimal' | 'good' | 'poor';
  pulseStatusLabel: string;
  pulseColor: string;
  
  // Factor scores
  soundScore: number;
  lightScore: number;
  
  // Current sensor values
  currentDecibels: number | null;
  currentLight: number | null;
  
  // Occupancy
  currentOccupancy: number;
  todayEntries: number;
  todayExits: number;
  peakOccupancy: number;
  peakTime: string | null;
  
  // Dwell time
  dwellTimeMinutes: number | null;
  dwellTimeFormatted: string;
  dwellScore: number;
  
  // Reviews
  reviews: GoogleReviewsData | null;
  reputationScore: number;
  
  // Weather
  weather: WeatherData | null;
  
  // Raw data (for charts/details)
  sensorData: SensorData | null;
  occupancyMetrics: OccupancyMetrics | null;
  
  // Actions
  refresh: () => Promise<void>;
}

interface UsePulseDataOptions {
  enabled?: boolean;
  pollingInterval?: number;
}

// ============ HOOK ============

export function usePulseData(options: UsePulseDataOptions = {}): PulseData {
  const { enabled = true, pollingInterval = POLLING_INTERVALS.live } = options;
  
  // Get user info
  const user = authService.getStoredUser();
  const venueId = user?.venueId || '';
  const venueName = user?.venueName || '';
  
  // State
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  
  // Data states
  const [sensorData, setSensorData] = useState<SensorData | null>(null);
  const [occupancyMetrics, setOccupancyMetrics] = useState<OccupancyMetrics | null>(null);
  const [reviews, setReviews] = useState<GoogleReviewsData | null>(null);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  
  // ============ DATA FETCHING ============
  
  const fetchLiveData = useCallback(async () => {
    if (!venueId) return;
    
    try {
      const data = await apiService.getLiveData(venueId);
      if (data) {
        setSensorData(data);
        setLastUpdated(new Date());
        setError(null);
      }
    } catch (err: any) {
      console.error('Failed to fetch live sensor data:', err);
      setError(err.message || 'Failed to fetch sensor data');
    }
  }, [venueId]);
  
  const fetchOccupancy = useCallback(async () => {
    if (!venueId) return;
    
    try {
      // Calculate occupancy from the same sensor data used for everything else
      // Get 24h of historical data to calculate bar day (3am-3am) entries/exits
      const historicalData = await apiService.getHistoricalData(venueId, '24h');
      
      if (historicalData?.data && historicalData.data.length > 0) {
        // Import bar day calculation utility
        const { calculateBarDayOccupancy } = await import('../utils/barDay');
        
        // Filter items that have occupancy data
        const itemsWithOccupancy = historicalData.data.filter(d => d.occupancy);
        console.log(`📊 Occupancy calc: ${historicalData.data.length} items, ${itemsWithOccupancy.length} have occupancy`);
        
        // DEBUG: Log what the occupancy data actually looks like
        if (itemsWithOccupancy.length > 0) {
          const sample = itemsWithOccupancy[0];
          console.log('📊 Sample occupancy data structure:', {
            timestamp: sample.timestamp,
            occupancy: sample.occupancy,
            hasEntries: 'entries' in (sample.occupancy || {}),
            hasExits: 'exits' in (sample.occupancy || {}),
            hasCurrent: 'current' in (sample.occupancy || {})
          });
          
          // Log first and last to see if entries/exits are changing
          const first = itemsWithOccupancy[0];
          const last = itemsWithOccupancy[itemsWithOccupancy.length - 1];
          console.log('📊 First reading:', first.timestamp, first.occupancy);
          console.log('📊 Last reading:', last.timestamp, last.occupancy);
        }
        
        if (itemsWithOccupancy.length > 0) {
          // Calculate bar day entries/exits (difference since 3am)
          const barDay = calculateBarDayOccupancy(historicalData.data);
          console.log('📊 Bar day result:', barDay);
          
          // Get the most recent occupancy reading for current count
          const sorted = [...itemsWithOccupancy].sort((a, b) => 
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
          );
          const latestOccupancy = sorted[0].occupancy;
          
          // Find peak occupancy from today's data
          let peakOccupancy = barDay.current;
          let peakTime: string | undefined;
          
          itemsWithOccupancy.forEach(item => {
            const current = item.occupancy?.current || 0;
            if (current > peakOccupancy) {
              peakOccupancy = current;
              peakTime = new Date(item.timestamp).toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit'
              });
            }
          });
          
          setOccupancyMetrics({
            current: latestOccupancy?.current || barDay.current,
            todayEntries: barDay.entries,
            todayExits: barDay.exits,
            todayTotal: barDay.entries,
            sevenDayAvg: 0,
            fourteenDayAvg: 0,
            thirtyDayAvg: 0,
            peakOccupancy,
            peakTime,
            avgDwellTimeMinutes: null
          });
          
          console.log('✅ Occupancy calculated from sensor data:', {
            current: latestOccupancy?.current || barDay.current,
            todayEntries: barDay.entries,
            todayExits: barDay.exits
          });
        } else {
          console.warn('⚠️ No sensor data has occupancy field - is the IoT device sending entries/exits?');
        }
      }
    } catch (err: any) {
      console.error('Failed to calculate occupancy from sensor data:', err);
    }
  }, [venueId]);
  
  const fetchReviews = useCallback(async () => {
    if (!venueId || !venueName) return;
    
    try {
      const address = venueSettingsService.getFormattedAddress(venueId) || '';
      const data = await googleReviewsService.getReviews(venueName, address, venueId);
      if (data) {
        setReviews(data);
      }
    } catch (err) {
      console.error('Failed to fetch reviews:', err);
    }
  }, [venueId, venueName]);
  
  const fetchWeather = useCallback(async () => {
    if (!venueId) return;
    
    try {
      const address = venueSettingsService.getFormattedAddress(venueId);
      if (address && address !== 'No address provided') {
        const data = await weatherService.getWeatherByAddress(address);
        if (data) {
          setWeather(data);
        }
      }
    } catch (err) {
      console.error('Failed to fetch weather:', err);
    }
  }, [venueId]);
  
  // ============ REFRESH ALL ============
  
  const refresh = useCallback(async () => {
    setLoading(true);
    await Promise.all([
      fetchLiveData(),
      fetchOccupancy(),
    ]);
    setLoading(false);
  }, [fetchLiveData, fetchOccupancy]);
  
  // ============ INITIAL LOAD ============
  
  useEffect(() => {
    if (!enabled || !venueId) {
      setLoading(false);
      return;
    }
    
    const loadAllData = async () => {
      setLoading(true);
      
      // Fetch in parallel
      await Promise.all([
        fetchLiveData(),
        fetchOccupancy(),
        fetchReviews(),
        fetchWeather(),
      ]);
      
      setLoading(false);
    };
    
    loadAllData();
  }, [enabled, venueId, fetchLiveData, fetchOccupancy, fetchReviews, fetchWeather]);
  
  // ============ POLLING ============
  
  useEffect(() => {
    if (!enabled || !venueId) return;
    
    // Poll live data
    const liveInterval = setInterval(fetchLiveData, pollingInterval);
    
    // Poll occupancy less frequently
    const occupancyInterval = setInterval(fetchOccupancy, POLLING_INTERVALS.occupancy);
    
    return () => {
      clearInterval(liveInterval);
      clearInterval(occupancyInterval);
    };
  }, [enabled, venueId, pollingInterval, fetchLiveData, fetchOccupancy]);
  
  // ============ COMPUTED VALUES ============
  
  const pulseScoreResult = useMemo(() => {
    return calculatePulseScore(sensorData?.decibels, sensorData?.light);
  }, [sensorData?.decibels, sensorData?.light]);
  
  const dwellTimeMinutes = occupancyMetrics?.avgDwellTimeMinutes ?? null;
  const dwellScore = getDwellTimeScore(dwellTimeMinutes);
  const dwellTimeFormatted = formatDwellTime(dwellTimeMinutes);
  
  const reputationScore = getReputationScore(reviews?.rating ?? null);
  
  // Data freshness
  const dataAgeSeconds = useMemo(() => {
    if (!lastUpdated) return Infinity;
    return Math.floor((Date.now() - lastUpdated.getTime()) / 1000);
  }, [lastUpdated]);
  
  const isConnected = dataAgeSeconds < DATA_FRESHNESS.disconnected;
  
  // ============ OCCUPANCY FALLBACK ============
  // If the dedicated occupancy resolver fails, fall back to sensor data occupancy
  const effectiveOccupancy = useMemo(() => {
    // Prefer dedicated occupancy metrics if available (these are properly calculated)
    if (occupancyMetrics) {
      return {
        current: occupancyMetrics.current ?? 0,
        todayEntries: occupancyMetrics.todayEntries ?? 0,
        todayExits: occupancyMetrics.todayExits ?? 0,
        peakOccupancy: occupancyMetrics.peakOccupancy ?? 0,
        peakTime: occupancyMetrics.peakTime ?? null,
      };
    }
    
    // Fall back to sensor data occupancy for CURRENT only
    // DO NOT use sensorData.occupancy.entries/exits as they are CUMULATIVE totals
    // not today's values (they could be 35000+ from months of operation)
    if (sensorData?.occupancy) {
      return {
        current: sensorData.occupancy.current ?? 0,
        todayEntries: 0, // Don't show cumulative as "today"
        todayExits: 0,   // Don't show cumulative as "today"
        peakOccupancy: sensorData.occupancy.current ?? 0,
        peakTime: null,
      };
    }
    
    // No occupancy data available
    return {
      current: 0,
      todayEntries: 0,
      todayExits: 0,
      peakOccupancy: 0,
      peakTime: null,
    };
  }, [occupancyMetrics, sensorData?.occupancy]);
  
  // ============ RETURN ============
  
  return {
    // Loading states
    loading,
    error,
    
    // Connection status
    isConnected,
    lastUpdated,
    dataAgeSeconds,
    
    // Core Pulse Score
    pulseScore: sensorData ? pulseScoreResult.score : null,
    pulseStatus: pulseScoreResult.status,
    pulseStatusLabel: pulseScoreResult.statusLabel,
    pulseColor: pulseScoreResult.color,
    
    // Factor scores
    soundScore: pulseScoreResult.factors.sound.score,
    lightScore: pulseScoreResult.factors.light.score,
    
    // Current sensor values
    currentDecibels: sensorData?.decibels ?? null,
    currentLight: sensorData?.light ?? null,
    
    // Occupancy - use effective occupancy which falls back to sensor data
    currentOccupancy: effectiveOccupancy.current,
    todayEntries: effectiveOccupancy.todayEntries,
    todayExits: effectiveOccupancy.todayExits,
    peakOccupancy: effectiveOccupancy.peakOccupancy,
    peakTime: effectiveOccupancy.peakTime,
    
    // Dwell time
    dwellTimeMinutes,
    dwellTimeFormatted,
    dwellScore,
    
    // Reviews
    reviews,
    reputationScore,
    
    // Weather
    weather,
    
    // Raw data
    sensorData,
    occupancyMetrics,
    
    // Actions
    refresh,
  };
}

export default usePulseData;

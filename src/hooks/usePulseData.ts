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
  const [occupancyMetrics, _setOccupancyMetrics] = useState<OccupancyMetrics | null>(null);
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
      // Get the 3am baseline from DynamoDB (just a 1-hour window, not 24h)
      const BAR_DAY_HOUR = 3;
      const now = new Date();
      const currentHour = now.getHours();
      
      // Calculate when the current bar day started (3am today or yesterday)
      const barDayStart = new Date(now);
      barDayStart.setHours(BAR_DAY_HOUR, 0, 0, 0);
      if (currentHour < BAR_DAY_HOUR) {
        barDayStart.setDate(barDayStart.getDate() - 1);
      }
      
      // Fetch just 1 hour of data starting from 3am (to get the baseline)
      const barDayEnd = new Date(barDayStart);
      barDayEnd.setHours(barDayStart.getHours() + 1);
      
      console.log('🔢 Fetching 3am baseline data:', {
        barDayStart: barDayStart.toISOString(),
        barDayEnd: barDayEnd.toISOString()
      });
      
      // Use the dynamodb service directly for a targeted time range query
      const dynamoDBService = (await import('../services/dynamodb.service')).default;
      const baselineData = await dynamoDBService.getSensorDataByDateRange(
        venueId,
        barDayStart,
        barDayEnd,
        100 // Just need a few records from 3am-4am
      );
      
      console.log('🔢 Got baseline data:', baselineData?.length || 0, 'items');
      
      if (baselineData && baselineData.length > 0) {
        // Find the first reading with occupancy data
        const baselineWithOccupancy = baselineData.filter(d => d.occupancy);
        
        if (baselineWithOccupancy.length > 0) {
          // Sort by timestamp ascending (oldest first)
          baselineWithOccupancy.sort((a, b) => 
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          );
          
          const baseline = baselineWithOccupancy[0].occupancy!;
          console.log('🔢 Found 3am baseline:', {
            timestamp: baselineWithOccupancy[0].timestamp,
            entries: baseline.entries,
            exits: baseline.exits
          });
          
          // Store in localStorage for the effectiveOccupancy calculation
          const barDayKey = `occupancy_baseline_${venueId}_${barDayStart.toDateString()}`;
          localStorage.setItem(barDayKey, JSON.stringify({
            entries: baseline.entries,
            exits: baseline.exits,
            fetchedAt: new Date().toISOString()
          }));
          
          console.log('✅ Saved 3am baseline to localStorage');
        } else {
          console.warn('⚠️ No occupancy data found in 3am-4am window');
        }
      } else {
        console.warn('⚠️ No sensor data found in 3am-4am window');
      }
    } catch (err: any) {
      console.error('❌ Failed to fetch 3am baseline:', err?.message);
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
  
  // ============ OCCUPANCY CALCULATION ============
  // Calculate occupancy from sensor data using localStorage baseline for bar day
  const effectiveOccupancy = useMemo(() => {
    // If we have calculated bar day metrics from historical data, use those
    if (occupancyMetrics && occupancyMetrics.todayEntries > 0) {
      console.log('📊 Using calculated occupancy metrics:', occupancyMetrics);
      return {
        current: occupancyMetrics.current ?? 0,
        todayEntries: occupancyMetrics.todayEntries ?? 0,
        todayExits: occupancyMetrics.todayExits ?? 0,
        peakOccupancy: occupancyMetrics.peakOccupancy ?? 0,
        peakTime: occupancyMetrics.peakTime ?? null,
      };
    }
    
    // Calculate from live sensor data using localStorage baseline
    if (sensorData?.occupancy) {
      const entries = sensorData.occupancy.entries ?? 0;
      const exits = sensorData.occupancy.exits ?? 0;
      const current = Math.max(0, entries - exits);
      
      // Bar day logic: A bar "day" runs from 3am to 3am
      // We store the baseline (entries/exits at 3am) in localStorage
      const BAR_DAY_HOUR = 3;
      const now = new Date();
      const currentHour = now.getHours();
      
      // Calculate when the current bar day started
      const barDayStart = new Date(now);
      barDayStart.setHours(BAR_DAY_HOUR, 0, 0, 0);
      if (currentHour < BAR_DAY_HOUR) {
        // It's before 3am, so bar day started yesterday at 3am
        barDayStart.setDate(barDayStart.getDate() - 1);
      }
      
      const barDayKey = `occupancy_baseline_${venueId}_${barDayStart.toDateString()}`;
      let baseline = { entries: 0, exits: 0 };
      
      try {
        const stored = localStorage.getItem(barDayKey);
        if (stored) {
          baseline = JSON.parse(stored);
          console.log('📊 Using stored baseline:', baseline, 'from', barDayStart.toDateString());
        } else {
          // No baseline for today - this is the first reading since 3am
          // Save current values as the baseline
          baseline = { entries, exits };
          localStorage.setItem(barDayKey, JSON.stringify(baseline));
          console.log('📊 NEW baseline saved:', baseline, 'for', barDayStart.toDateString());
          
          // Clean up old baselines (keep only last 7 days)
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key?.startsWith('occupancy_baseline_') && key !== barDayKey) {
              const keyDate = key.split('_').slice(-3).join('_'); // Extract date part
              const keyDateObj = new Date(keyDate);
              const daysDiff = (now.getTime() - keyDateObj.getTime()) / (1000 * 60 * 60 * 24);
              if (daysDiff > 7) {
                localStorage.removeItem(key);
              }
            }
          }
        }
      } catch (e) {
        console.warn('Failed to read/write occupancy baseline:', e);
      }
      
      // Calculate today's entries/exits as difference from baseline
      const todayEntries = Math.max(0, entries - baseline.entries);
      const todayExits = Math.max(0, exits - baseline.exits);
      
      console.log('📊 Bar day occupancy:', {
        baseline,
        currentCumulative: { entries, exits },
        today: { entries: todayEntries, exits: todayExits },
        current
      });
      
      return {
        current,
        todayEntries,
        todayExits,
        peakOccupancy: current,
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
  }, [occupancyMetrics, sensorData?.occupancy, venueId]);
  
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

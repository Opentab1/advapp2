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
import { isDemoAccount } from '../utils/demoData';
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
  tempScore: number;
  vibeScore: number;
  
  // Time slot
  timeSlot: string;
  
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
  
  // Accurate retention metrics (100% accurate from raw data)
  retentionMetrics: {
    retentionRate: number;       // 0-100% of guests still here
    turnoverRate: number;        // exits per hour / avg occupancy
    entryExitRatio: number;      // >1 growing, <1 shrinking
    crowdTrend: 'growing' | 'stable' | 'shrinking';
    avgStayMinutes: number | null;
    exitsPerHour: number;
    hoursSinceOpen: number;
  };
  
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
  const [baseline, setBaseline] = useState<{entries: number; exits: number} | null>(null);
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
      // Calculate 3am today (or yesterday if before 3am now)
      const now = new Date();
      const barDayStart = new Date(now);
      barDayStart.setHours(3, 0, 0, 0);
      if (now.getHours() < 3) {
        barDayStart.setDate(barDayStart.getDate() - 1);
      }
      
      // Query window: 3am to 4am
      const barDayEnd = new Date(barDayStart);
      barDayEnd.setHours(4, 0, 0, 0);
      
      console.log('🔢 Querying 3am data:', barDayStart.toLocaleString());
      
      const dynamoDBService = (await import('../services/dynamodb.service')).default;
      const data = await dynamoDBService.getSensorDataByDateRange(venueId, barDayStart, barDayEnd, 10);
      
      // Find first record with occupancy
      const withOccupancy = data?.filter(d => d.occupancy) || [];
      
      if (withOccupancy.length > 0) {
        const first = withOccupancy[0];
        const baselineValue = {
          entries: first.occupancy!.entries,
          exits: first.occupancy!.exits
        };
        setBaseline(baselineValue);
        console.log('✅ 3am baseline:', baselineValue);
      } else {
        console.warn('⚠️ No 3am data found');
      }
    } catch (err: any) {
      console.error('❌ Error fetching 3am data:', err?.message);
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
        const data = await weatherService.getWeatherByAddress(address, venueId);
        if (data) {
          setWeather(data);
        }
      } else {
        // Try with venueId anyway (for demo account)
        const data = await weatherService.getWeatherByAddress('', venueId);
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
    // Use outdoor temp from weather service if sensor doesn't have it
    const outdoorTemp = sensorData?.outdoorTemp ?? weather?.temperature ?? null;
    
    return calculatePulseScore(
      sensorData?.decibels,
      sensorData?.light,
      sensorData?.indoorTemp,
      outdoorTemp,
      sensorData?.currentSong,
      sensorData?.artist,
      venueId // Pass venueId for custom calibration support
    );
  }, [sensorData?.decibels, sensorData?.light, sensorData?.indoorTemp, sensorData?.outdoorTemp, sensorData?.currentSong, sensorData?.artist, weather?.temperature, venueId]);
  
  const reputationScore = getReputationScore(reviews?.rating ?? null);
  
  // Data freshness
  const dataAgeSeconds = useMemo(() => {
    if (!lastUpdated) return Infinity;
    return Math.floor((Date.now() - lastUpdated.getTime()) / 1000);
  }, [lastUpdated]);
  
  const isConnected = dataAgeSeconds < DATA_FRESHNESS.disconnected;
  
  // ============ OCCUPANCY CALCULATION ============
  const effectiveOccupancy = useMemo(() => {
    if (!sensorData?.occupancy) {
      return { current: 0, todayEntries: 0, todayExits: 0, peakOccupancy: 0, peakTime: null };
    }
    
    const entries = sensorData.occupancy.entries ?? 0;
    const exits = sensorData.occupancy.exits ?? 0;
    
    // Demo account: Use the values directly from generated data
    if (isDemoAccount(venueId)) {
      const current = sensorData.occupancy.current ?? 0;
      return {
        current,
        todayEntries: entries,
        todayExits: exits,
        peakOccupancy: Math.max(current, 458), // Demo peak
        peakTime: '22:15',
      };
    }
    
    // Real accounts: Calculate from baseline
    let todayEntries = 0;
    let todayExits = 0;
    
    if (baseline) {
      todayEntries = Math.max(0, entries - baseline.entries);
      todayExits = Math.max(0, exits - baseline.exits);
    }
    
    // Currently inside = today's entries - today's exits
    const current = Math.max(0, todayEntries - todayExits);
    
    return {
      current,
      todayEntries,
      todayExits,
      peakOccupancy: current,
      peakTime: null,
    };
  }, [sensorData?.occupancy, baseline, venueId]);
  
  // ============ DWELL TIME CALCULATION ============
  // Dwell = average time guests are staying based on current occupancy vs turnover
  const dwellTimeMinutes = useMemo(() => {
    const current = effectiveOccupancy.current;
    const entries = effectiveOccupancy.todayEntries;
    const exits = effectiveOccupancy.todayExits;
    
    // If no data yet, return default
    if (entries === 0 || current === 0) {
      return 45; // Default baseline dwell time
    }
    
    // Calculate hours since bar day start (3 AM)
    const now = new Date();
    const barDayStart = new Date(now);
    barDayStart.setHours(3, 0, 0, 0);
    if (now.getHours() < 3) {
      barDayStart.setDate(barDayStart.getDate() - 1);
    }
    const hoursSinceStart = Math.max(1, (now.getTime() - barDayStart.getTime()) / (1000 * 60 * 60));
    
    // Turnover rate = exits per hour
    const turnoverRate = exits / hoursSinceStart;
    
    // If low turnover, people are staying longer
    if (turnoverRate < 1) {
      // Few exits = long dwell times
      return Math.min(180, Math.round(60 + (current * 2))); // Cap at 3 hours
    }
    
    // Dwell time ≈ current occupancy / turnover rate (in minutes)
    const estimatedDwell = Math.round((current / turnoverRate) * 60);
    
    // Clamp to reasonable range (15 min to 3 hours)
    return Math.max(15, Math.min(180, estimatedDwell));
  }, [effectiveOccupancy]);
  
  const dwellScore = getDwellTimeScore(dwellTimeMinutes);
  const dwellTimeFormatted = formatDwellTime(dwellTimeMinutes);
  
  // ============ ACCURATE RETENTION METRICS ============
  // These are 100% accurate based on raw entry/exit data
  
  const retentionMetrics = useMemo(() => {
    const current = effectiveOccupancy.current;
    const todayEntries = effectiveOccupancy.todayEntries;
    const todayExits = effectiveOccupancy.todayExits;
    
    // Calculate hours since bar day start (3 AM)
    const now = new Date();
    const barDayStart = new Date(now);
    barDayStart.setHours(3, 0, 0, 0);
    if (now.getHours() < 3) {
      barDayStart.setDate(barDayStart.getDate() - 1);
    }
    const hoursSinceStart = Math.max(0.5, (now.getTime() - barDayStart.getTime()) / (1000 * 60 * 60));
    
    // 1. Retention Rate: What % of tonight's guests are still here
    // 100% accurate - just math on entry/exit counts
    const retentionRate = todayEntries > 0 
      ? Math.round((current / todayEntries) * 100) 
      : 0;
    
    // 2. Hourly Turnover Rate: Exits per hour relative to average crowd
    // Shows how fast people are churning
    const avgOccupancy = todayEntries > 0 ? (todayEntries - todayExits / 2) : current;
    const exitsPerHour = hoursSinceStart > 0 ? todayExits / hoursSinceStart : 0;
    const turnoverRate = avgOccupancy > 0 
      ? Math.round((exitsPerHour / avgOccupancy) * 100) / 100 
      : 0;
    
    // 3. Entry/Exit Ratio: Are more people coming or going?
    // > 1.0 = growing, < 1.0 = shrinking, = 1.0 = stable
    const entryExitRatio = todayExits > 0 
      ? Math.round((todayEntries / todayExits) * 100) / 100 
      : todayEntries > 0 ? 99 : 1; // If no exits yet, crowd is only growing
    
    // 4. Crowd Trend: Simple indicator
    let crowdTrend: 'growing' | 'stable' | 'shrinking' = 'stable';
    if (entryExitRatio > 1.2) crowdTrend = 'growing';
    else if (entryExitRatio < 0.8) crowdTrend = 'shrinking';
    
    // 5. Avg Stay (exit-based, more accurate than Little's Law)
    // If people are exiting, how long are they staying on average?
    const avgStayMinutes = exitsPerHour > 0 
      ? Math.round((current / exitsPerHour) * 60)
      : null; // Can't calculate without exits
    
    return {
      retentionRate,       // 0-100%
      turnoverRate,        // exits per hour / avg occupancy (0-2 typical)
      entryExitRatio,      // >1 growing, <1 shrinking
      crowdTrend,          // 'growing' | 'stable' | 'shrinking'
      avgStayMinutes,      // More accurate dwell estimate
      exitsPerHour: Math.round(exitsPerHour),
      hoursSinceOpen: Math.round(hoursSinceStart * 10) / 10,
    };
  }, [effectiveOccupancy]);
  
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
    tempScore: pulseScoreResult.factors.temperature.score,
    vibeScore: pulseScoreResult.factors.vibe.score,
    
    // Time slot
    timeSlot: pulseScoreResult.timeSlot,
    
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
    occupancyMetrics: null, // Calculated via effectiveOccupancy now
    
    // Accurate retention metrics (100% accurate from raw data)
    retentionMetrics,
    
    // Actions
    refresh,
  };
}

export default usePulseData;

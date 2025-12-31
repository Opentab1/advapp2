/**
 * usePulseScore - Centralized hook for Pulse Score data and calculations
 * 
 * This is the SINGLE SOURCE OF TRUTH for:
 * - Pulse Score (sound + light weighted)
 * - Dwell Time
 * - Reputation (Google Reviews)
 * - Occupancy metrics
 * 
 * All components that need pulse data should use this hook.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import authService from '../services/auth.service';
import apiService from '../services/api.service';
import googleReviewsService, { GoogleReviewsData } from '../services/google-reviews.service';
import venueSettingsService from '../services/venue-settings.service';
import { calculateRecentDwellTime, getDwellTimeCategory, formatDwellTime } from '../utils/dwellTime';
import type { SensorData, OccupancyMetrics } from '../types';

// ============ TYPES ============

export interface PulseScoreData {
  // Main Pulse Score
  pulseScore: number | null;
  pulseStatus: 'Optimal' | 'Good' | 'Adjust' | 'No Data';
  pulseColor: string;
  
  // Factor scores (0-100)
  soundScore: number;
  lightScore: number;
  
  // Raw sensor values
  currentDecibels: number | null;
  currentLight: number | null;
  
  // Dwell Time
  dwellTime: number | null; // in minutes
  dwellTimeFormatted: string;
  dwellCategory: string;
  dwellScore: number; // 0-100 for ring display
  
  // Reputation
  reviews: GoogleReviewsData | null;
  reputationScore: number; // 0-100 for ring display
  
  // Occupancy
  occupancy: OccupancyMetrics | null;
  currentOccupancy: number;
  occupancyScore: number; // 0-100 for ring display
  weeklyAvgOccupancy: number;
  peakOccupancy: number;
}

export interface UsePulseScoreOptions {
  /** Enable/disable the hook */
  enabled?: boolean;
  /** Polling interval for live data (ms) */
  pollingInterval?: number;
  /** Custom venue ID (defaults to auth user's venue) */
  venueId?: string;
}

export interface UsePulseScoreReturn extends PulseScoreData {
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  hasData: boolean;
  
  // Data freshness tracking
  lastUpdated: number | null; // timestamp of last successful data fetch
  dataAgeSeconds: number; // how old the data is in seconds
  isStale: boolean; // true if data is older than 2 minutes
  isDisconnected: boolean; // true if data is older than 5 minutes
  sensorStatus: 'connected' | 'delayed' | 'disconnected' | 'unknown';
}

// ============ CONSTANTS ============

const OPTIMAL_RANGES = {
  sound: { min: 70, max: 82 },
  light: { min: 50, max: 350 },
};

const WEIGHTS = {
  sound: 0.60,
  light: 0.40,
};

// Estimated venue capacity (should come from venue settings in future)
const DEFAULT_CAPACITY = 150;

// ============ HELPER FUNCTIONS ============

function calculateFactorScore(value: number | undefined | null, range: { min: number; max: number }): number {
  if (value === undefined || value === null) return 0;
  if (value >= range.min && value <= range.max) return 100;
  
  const rangeSize = range.max - range.min;
  const tolerance = rangeSize * 0.5;
  
  if (value < range.min) {
    return Math.max(0, Math.round(100 - ((range.min - value) / tolerance) * 100));
  } else {
    return Math.max(0, Math.round(100 - ((value - range.max) / tolerance) * 100));
  }
}

function getPulseStatus(score: number | null): 'Optimal' | 'Good' | 'Adjust' | 'No Data' {
  if (score === null) return 'No Data';
  if (score >= 85) return 'Optimal';
  if (score >= 60) return 'Good';
  return 'Adjust';
}

function getPulseColor(score: number | null): string {
  if (score === null) return '#9CA3AF';
  if (score >= 85) return '#22C55E';
  if (score >= 60) return '#F59E0B';
  return '#EF4444';
}

/**
 * Calculate occupancy metrics from sensor data as fallback
 * when the dedicated occupancy resolver doesn't return data
 */
function calculateOccupancyFromSensorData(sensorData: SensorData[]): OccupancyMetrics | null {
  if (!sensorData || sensorData.length === 0) return null;

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  // Filter today's data
  const todayData = sensorData.filter(d => new Date(d.timestamp) >= todayStart);
  
  // Get current occupancy from most recent data point
  const latestData = sensorData[0]; // Assuming sorted newest first
  const current = latestData?.occupancy?.current ?? 0;
  
  // Calculate today's entries/exits from sensor data
  // The sensor data includes cumulative entries/exits for the day
  let todayEntries = 0;
  let todayExits = 0;
  let peakOccupancy = 0;
  let peakTime = '';
  
  if (todayData.length > 0) {
    // Find max entries/exits values (they're cumulative)
    todayData.forEach(d => {
      if (d.occupancy?.entries && d.occupancy.entries > todayEntries) {
        todayEntries = d.occupancy.entries;
      }
      if (d.occupancy?.exits && d.occupancy.exits > todayExits) {
        todayExits = d.occupancy.exits;
      }
      if (d.occupancy?.current && d.occupancy.current > peakOccupancy) {
        peakOccupancy = d.occupancy.current;
        peakTime = new Date(d.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
    });
  }
  
  // Calculate 7-day average from all data
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const weekData = sensorData.filter(d => new Date(d.timestamp) >= sevenDaysAgo);
  
  // Group by day and get max occupancy per day
  const dailyMaxOccupancy: { [key: string]: number } = {};
  weekData.forEach(d => {
    const dateKey = new Date(d.timestamp).toDateString();
    const occ = d.occupancy?.current ?? 0;
    if (!dailyMaxOccupancy[dateKey] || occ > dailyMaxOccupancy[dateKey]) {
      dailyMaxOccupancy[dateKey] = occ;
    }
  });
  
  const dailyValues = Object.values(dailyMaxOccupancy);
  const sevenDayAvg = dailyValues.length > 0 
    ? Math.round(dailyValues.reduce((a, b) => a + b, 0) / dailyValues.length)
    : 0;

  return {
    current,
    todayEntries,
    todayExits,
    todayTotal: todayEntries, // Use entries as total
    sevenDayAvg,
    fourteenDayAvg: sevenDayAvg, // Same as 7-day for now
    thirtyDayAvg: sevenDayAvg, // Same as 7-day for now
    peakOccupancy,
    peakTime,
    avgDwellTimeMinutes: null, // Will be calculated elsewhere
  };
}

// ============ MAIN HOOK ============

export function usePulseScore(options: UsePulseScoreOptions = {}): UsePulseScoreReturn {
  const {
    enabled = true,
    pollingInterval = 30000, // 30 seconds default
    venueId: customVenueId,
  } = options;

  const user = authService.getStoredUser();
  const venueId = customVenueId || user?.venueId || '';
  const venueName = user?.venueName || '';

  // State
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sensorData, setSensorData] = useState<SensorData | null>(null);
  const [historicalData, setHistoricalData] = useState<SensorData[]>([]);
  const [occupancy, setOccupancy] = useState<OccupancyMetrics | null>(null);
  const [reviews, setReviews] = useState<GoogleReviewsData | null>(null);
  
  // Data freshness tracking
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [dataAgeSeconds, setDataAgeSeconds] = useState(0);

  // Refs to prevent duplicate fetches
  const fetchingRef = useRef(false);
  const mountedRef = useRef(true);

  // Load all data
  const loadData = useCallback(async () => {
    if (!venueId || !enabled || fetchingRef.current) return;
    
    fetchingRef.current = true;
    
    try {
      const venueAddress = venueSettingsService.getFormattedAddress(venueId) || '';
      
      // Fetch all data in parallel
      const [liveResult, historicalResult, occupancyResult, reviewsResult] = await Promise.allSettled([
        apiService.getLiveData(venueId),
        apiService.getHistoricalData(venueId, '7d'),
        apiService.getOccupancyMetrics(venueId),
        googleReviewsService.getReviews(venueName, venueAddress, venueId),
      ]);

      if (!mountedRef.current) return;

      // Process live sensor data
      if (liveResult.status === 'fulfilled') {
        setSensorData(liveResult.value);
        setLastUpdated(Date.now()); // Track when we got fresh data
      }

      // Process historical data (for dwell time calculation)
      if (historicalResult.status === 'fulfilled' && historicalResult.value?.data) {
        setHistoricalData(historicalResult.value.data);
      }

      // Process occupancy - use API result, or calculate from sensor data
      if (occupancyResult.status === 'fulfilled' && occupancyResult.value) {
        setOccupancy(occupancyResult.value);
      } else if (historicalResult.status === 'fulfilled' && historicalResult.value?.data) {
        // Fallback: Calculate occupancy metrics from sensor data
        const sensorOccupancy = calculateOccupancyFromSensorData(historicalResult.value.data);
        if (sensorOccupancy) {
          setOccupancy(sensorOccupancy);
        }
      }

      // Process reviews
      if (reviewsResult.status === 'fulfilled' && reviewsResult.value) {
        setReviews(reviewsResult.value);
      }

      setError(null);
    } catch (err: any) {
      if (mountedRef.current) {
        setError(err.message || 'Failed to load pulse data');
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
      fetchingRef.current = false;
    }
  }, [venueId, venueName, enabled]);

  // Initial load
  useEffect(() => {
    mountedRef.current = true;
    loadData();
    
    return () => {
      mountedRef.current = false;
    };
  }, [loadData]);

  // Polling for live updates
  useEffect(() => {
    if (!enabled || !venueId || pollingInterval <= 0) return;

    const interval = setInterval(() => {
      // Only refresh live data, not historical
      apiService.getLiveData(venueId).then(data => {
        if (mountedRef.current) {
          setSensorData(data);
          setLastUpdated(Date.now()); // Update freshness timestamp
        }
      }).catch(() => {
        // Silent fail for polling - but DON'T update lastUpdated
        // This means dataAge will keep increasing if fetches fail
      });
    }, pollingInterval);

    return () => clearInterval(interval);
  }, [enabled, venueId, pollingInterval]);

  // Track data age (updates every second for smooth countdown)
  useEffect(() => {
    if (!lastUpdated) return;

    const updateAge = () => {
      if (mountedRef.current && lastUpdated) {
        setDataAgeSeconds(Math.floor((Date.now() - lastUpdated) / 1000));
      }
    };

    updateAge(); // Immediate update
    const interval = setInterval(updateAge, 1000);

    return () => clearInterval(interval);
  }, [lastUpdated]);

  // ============ CALCULATE ALL SCORES ============

  // Pulse Score
  const soundScore = calculateFactorScore(sensorData?.decibels, OPTIMAL_RANGES.sound);
  const lightScore = calculateFactorScore(sensorData?.light, OPTIMAL_RANGES.light);
  const hasSensorData = sensorData && (sensorData.decibels !== undefined || sensorData.light !== undefined);
  const pulseScore = hasSensorData 
    ? Math.round((soundScore * WEIGHTS.sound) + (lightScore * WEIGHTS.light))
    : null;
  const pulseStatus = getPulseStatus(pulseScore);
  const pulseColor = getPulseColor(pulseScore);

  // Dwell Time
  const dwellTime = calculateRecentDwellTime(historicalData);
  const dwellTimeFormatted = formatDwellTime(dwellTime);
  const dwellCategory = getDwellTimeCategory(dwellTime);
  // Score: 60 min = 100%, scale linearly
  const dwellScore = dwellTime !== null ? Math.min(100, Math.max(0, (dwellTime / 60) * 100)) : 0;

  // Reputation
  const reputationScore = reviews ? (reviews.rating / 5) * 100 : 0;

  // Occupancy
  const currentOccupancy = occupancy?.current ?? 0;
  const weeklyAvgOccupancy = occupancy?.sevenDayAvg ?? 0;
  const peakOccupancy = occupancy?.peakOccupancy ?? 0;
  // Score based on current vs estimated capacity
  const estimatedCapacity = peakOccupancy > 0 ? Math.max(peakOccupancy * 1.2, DEFAULT_CAPACITY) : DEFAULT_CAPACITY;
  const occupancyScore = Math.min(100, (currentOccupancy / estimatedCapacity) * 100);

  // Data freshness derived values
  const STALE_THRESHOLD = 120; // 2 minutes
  const DISCONNECTED_THRESHOLD = 300; // 5 minutes
  const isStale = dataAgeSeconds >= STALE_THRESHOLD;
  const isDisconnected = dataAgeSeconds >= DISCONNECTED_THRESHOLD;
  const sensorStatus: 'connected' | 'delayed' | 'disconnected' | 'unknown' = 
    !lastUpdated ? 'unknown' :
    isDisconnected ? 'disconnected' :
    isStale ? 'delayed' :
    'connected';

  return {
    // Loading state
    loading,
    error,
    hasData: hasSensorData || false,
    refresh: loadData,

    // Pulse Score
    pulseScore,
    pulseStatus,
    pulseColor,
    soundScore,
    lightScore,
    currentDecibels: sensorData?.decibels ?? null,
    currentLight: sensorData?.light ?? null,

    // Dwell Time
    dwellTime,
    dwellTimeFormatted,
    dwellCategory,
    dwellScore,

    // Reputation
    reviews,
    reputationScore,

    // Occupancy
    occupancy,
    currentOccupancy,
    occupancyScore,
    weeklyAvgOccupancy,
    peakOccupancy,

    // Data freshness
    lastUpdated,
    dataAgeSeconds,
    isStale,
    isDisconnected,
    sensorStatus,
  };
}

export default usePulseScore;

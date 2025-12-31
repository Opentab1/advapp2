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
      }

      // Process historical data (for dwell time calculation)
      if (historicalResult.status === 'fulfilled' && historicalResult.value?.data) {
        setHistoricalData(historicalResult.value.data);
      }

      // Process occupancy
      if (occupancyResult.status === 'fulfilled') {
        setOccupancy(occupancyResult.value);
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
        }
      }).catch(() => {
        // Silent fail for polling
      });
    }, pollingInterval);

    return () => clearInterval(interval);
  }, [enabled, venueId, pollingInterval]);

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
  };
}

export default usePulseScore;

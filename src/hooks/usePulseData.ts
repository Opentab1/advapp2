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

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getDwellTimeScore, formatDwellTime, getReputationScore } from '../utils/scoring';
import { POLLING_INTERVALS, DATA_FRESHNESS } from '../utils/constants';
import apiService from '../services/api.service';
import authService from '../services/auth.service';
import googleReviewsService, { GoogleReviewsData } from '../services/google-reviews.service';
import venueSettingsService from '../services/venue-settings.service';
import weatherService, { WeatherData } from '../services/weather.service';
import historicalScoringService, { HistoricalScoreResult, getTimeBlockLabel } from '../services/historical-scoring.service';
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
  
  // Factor scores (new formula: 40/25/20/15)
  soundScore: number;
  lightScore: number;
  crowdScore: number;
  musicScore: number;
  
  // Time block (3-hour blocks)
  timeSlot: string;
  timeBlockLabel: string;
  
  // Historical comparison (YOUR best block for this day/time)
  bestNight: import('../services/venue-learning.service').BestNightProfile | null;
  isLearning: boolean;
  learningConfidence: number; // 0-100
  weeksOfData: number;
  proximityToBest: number | null; // Average match score (0-100)
  
  // Legacy fields for backward compatibility
  isUsingHistoricalData: boolean;
  detectedGenres: string[];
  bestNightGenres: string[];
  
  // Estimated capacity (for crowd scoring)
  estimatedCapacity: number;
  
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
  const [todayHistory, setTodayHistory] = useState<SensorData[]>([]); // For dwell time calculation
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
      const now = new Date();
      
      // Calculate 3am today (or yesterday if we're before 3am)
      // "Bar day" runs 3am to 3am, not midnight to midnight
      // This is because bars have people at 1am/2am - that's still "tonight"
      const barDayStart = new Date(now);
      barDayStart.setHours(3, 0, 0, 0);
      if (now.getHours() < 3) {
        barDayStart.setDate(barDayStart.getDate() - 1);
      }
      
      const dynamoDBService = (await import('../services/dynamodb.service')).default;
      
      // Search from 3AM to NOW - find the earliest data point AFTER 3am
      // This handles cases where sensor was offline at exactly 3am
      console.log(`🔢 Searching for baseline from ${barDayStart.toLocaleString()} to now...`);
      
      const data = await dynamoDBService.getSensorDataByDateRange(
        venueId, 
        barDayStart,  // Start: 3am today (bar day start)
        now,          // End: right now
        50            // Get enough data points to find the earliest
      );
      
      const withOccupancy = data?.filter(d => d.occupancy) || [];
      
      if (withOccupancy.length > 0) {
        // Sort ascending by timestamp - get EARLIEST point after 3am
        withOccupancy.sort((a, b) => 
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
        
        const earliest = withOccupancy[0];
        const baselineTime = new Date(earliest.timestamp);
        
        const baselineValue = {
          entries: earliest.occupancy!.entries,
          exits: earliest.occupancy!.exits
        };
        
        setBaseline(baselineValue);
        
        // Store all today's data for occupancy integration (dwell time calculation)
        setTodayHistory(withOccupancy);
        
        // Log when we found baseline
        const hourFound = baselineTime.getHours();
        if (hourFound <= 4) {
          console.log('✅ Ideal baseline (3-4am):', baselineValue, `| ${withOccupancy.length} data points for dwell calc`);
        } else {
          console.log(`⚠️ Late baseline (${hourFound}:00) - sensor may have been offline earlier:`, baselineValue);
        }
      } else {
        // No data at all today - this is a true "no data" scenario
        console.warn('⚠️ No sensor data found since 3am today');
        setTodayHistory([]);
        // baseline stays null, which will show 0s - correct behavior
        // because we genuinely have no data for today's bar day
      }
    } catch (err: any) {
      console.error('❌ Error fetching baseline data:', err?.message);
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

  // Estimate venue capacity based on peak occupancy or default
  const estimatedCapacity = useMemo(() => {
    // Use peak occupancy * 1.2 as estimate, or default to 100
    if (effectiveOccupancy.peakOccupancy > 0) {
      return Math.max(effectiveOccupancy.peakOccupancy * 1.2, 50);
    }
    return 100;
  }, [effectiveOccupancy.peakOccupancy]);

  // Calculate Pulse Score - 100% historically based
  // Compares current conditions to YOUR best block for this day/time
  const [historicalScore, setHistoricalScore] = useState<HistoricalScoreResult | null>(null);
  const scoreCalculationRef = useRef<number>(0);
  
  useEffect(() => {
    const calculationId = ++scoreCalculationRef.current;
    
    async function calculateHistoricalScore() {
      if (!venueId) return;
      
      // For demo account, generate a good-looking score
      if (isDemoAccount(venueId)) {
        const demoScore: HistoricalScoreResult = {
          score: 82,
          isLearning: false,
          confidence: 100,
          weeksOfData: 12,
          bestBlock: {
            date: '2025-12-14',
            day: 'saturday',
            block: 'prime',
            avgOccupancy: 95,
            peakOccupancy: 127,
            avgSound: 76,
            avgLight: 85,
            totalEntries: 245,
            totalExits: 198,
            retentionRate: 81,
            topGenres: ['hip-hop', 'pop', 'r&b'],
            songCount: 48,
            bestScore: 78,
            dataPoints: 36,
          },
          currentVsBest: {
            occupancyMatch: 85,
            soundMatch: 88,
            lightMatch: 79,
            genreMatch: 90,
          },
          status: 'good',
          statusLabel: 'Close to Your Best',
          currentBlock: { day: 'saturday', block: 'prime' },
        };
        setHistoricalScore(demoScore);
        return;
      }
      
      try {
        const result = await historicalScoringService.calculateScore(venueId, {
          occupancy: effectiveOccupancy.current,
          sound: sensorData?.decibels ?? null,
          light: sensorData?.light ?? null,
          currentSong: sensorData?.currentSong ?? null,
          artist: sensorData?.artist ?? null,
        });
        
        // Only update if this is still the latest calculation
        if (calculationId === scoreCalculationRef.current) {
          setHistoricalScore(result);
        }
      } catch (error) {
        console.error('Error calculating historical score:', error);
      }
    }
    
    calculateHistoricalScore();
  }, [venueId, effectiveOccupancy.current, sensorData?.decibels, sensorData?.light, sensorData?.currentSong, sensorData?.artist]);
  
  // Build pulseScoreResult from historical score for backward compatibility
  const pulseScoreResult = useMemo(() => {
    if (!historicalScore) {
      return {
        score: 50,
        status: 'good' as const,
        statusLabel: 'Loading...',
        color: '#FFB800',
        timeSlot: 'evening' as any,
        factors: {
          sound: { score: 50, value: null, inRange: false, message: 'Loading...' },
          light: { score: 50, value: null, inRange: false, message: 'Loading...' },
          crowd: { score: 50, value: null, inRange: false, message: 'Loading...' },
          music: { score: 50, value: null, inRange: false, message: 'Loading...' },
        },
        bestNight: null,
        isUsingHistoricalData: false,
        proximityToBest: null,
        detectedGenres: [],
        bestNightGenres: [],
      };
    }
    
    const cvb = historicalScore.currentVsBest;
    
    return {
      score: historicalScore.score,
      status: historicalScore.status === 'needs_work' ? 'poor' as const : historicalScore.status,
      statusLabel: historicalScore.statusLabel,
      color: historicalScore.score >= 85 ? '#00DC82' : historicalScore.score >= 60 ? '#FFB800' : '#FF4444',
      timeSlot: `${historicalScore.currentBlock.day}_${historicalScore.currentBlock.block}` as any,
      factors: {
        sound: { 
          score: cvb?.soundMatch ?? 50, 
          value: sensorData?.decibels ?? null, 
          inRange: (cvb?.soundMatch ?? 0) >= 80, 
          message: historicalScore.bestBlock 
            ? `vs ${historicalScore.bestBlock.avgSound}dB on your best` 
            : 'Learning...' 
        },
        light: { 
          score: cvb?.lightMatch ?? 50, 
          value: sensorData?.light ?? null, 
          inRange: (cvb?.lightMatch ?? 0) >= 80, 
          message: historicalScore.bestBlock 
            ? `vs ${historicalScore.bestBlock.avgLight} lux on your best` 
            : 'Learning...' 
        },
        crowd: { 
          score: cvb?.occupancyMatch ?? 50, 
          value: effectiveOccupancy.current, 
          inRange: (cvb?.occupancyMatch ?? 0) >= 80, 
          message: historicalScore.bestBlock 
            ? `vs ${historicalScore.bestBlock.peakOccupancy} on your best` 
            : 'Learning...' 
        },
        music: { 
          score: cvb?.genreMatch ?? 80, 
          value: sensorData?.currentSong ?? null, 
          inRange: (cvb?.genreMatch ?? 0) >= 80, 
          message: historicalScore.bestBlock?.topGenres?.length 
            ? `Best nights: ${historicalScore.bestBlock.topGenres.join(', ')}` 
            : 'Learning...' 
        },
      },
      // Map BestBlockData to BestNightProfile format for backward compatibility
      bestNight: historicalScore.bestBlock ? {
        date: historicalScore.bestBlock.date,
        dayOfWeek: historicalScore.bestBlock.day.charAt(0).toUpperCase() + historicalScore.bestBlock.day.slice(1), // "saturday" -> "Saturday"
        timeSlot: historicalScore.bestBlock.block as any,
        totalGuests: historicalScore.bestBlock.totalEntries,
        peakOccupancy: historicalScore.bestBlock.peakOccupancy,
        avgDwellMinutes: historicalScore.bestBlock.retentionRate, // Using retention as proxy
        avgSound: historicalScore.bestBlock.avgSound,
        avgLight: historicalScore.bestBlock.avgLight,
        detectedGenres: historicalScore.bestBlock.topGenres,
        peakHour: undefined, // Not tracked in new format
      } : null,
      isUsingHistoricalData: !historicalScore.isLearning,
      proximityToBest: cvb ? Math.round((cvb.occupancyMatch + cvb.soundMatch + cvb.lightMatch + cvb.genreMatch) / 4) : null,
      detectedGenres: [],
      bestNightGenres: historicalScore.bestBlock?.topGenres ?? [],
    };
  }, [historicalScore, sensorData?.decibels, sensorData?.light, sensorData?.currentSong, effectiveOccupancy.current]);

  // ============ DWELL TIME CALCULATION ============
  // Using Occupancy Integration method (more accurate than Little's Law)
  // 
  // Total Guest-Hours = ∫ Occupancy dt (sum of occupancy × time intervals)
  // Avg Stay = Total Guest-Hours ÷ Total Entries
  //
  // This uses ALL historical data points, not just current snapshot.
  
  const dwellTimeMinutes = useMemo((): number | null => {
    const todayEntries = effectiveOccupancy.todayEntries;
    
    // Need entries to calculate average stay
    if (todayEntries === 0) {
      return null; // No guests yet - can't calculate
    }
    
    // Need at least 2 data points to integrate
    if (todayHistory.length < 2) {
      return null; // Not enough data yet
    }
    
    // Sort by timestamp
    const sorted = [...todayHistory].sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    
    // Calculate total guest-hours by integrating occupancy over time
    let totalGuestHours = 0;
    
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      
      const prevTime = new Date(prev.timestamp).getTime();
      const currTime = new Date(curr.timestamp).getTime();
      const intervalHours = (currTime - prevTime) / (1000 * 60 * 60);
      
      // Use average occupancy for this interval
      const prevOcc = prev.occupancy?.current || 0;
      const currOcc = curr.occupancy?.current || 0;
      const avgOccupancy = (prevOcc + currOcc) / 2;
      
      totalGuestHours += avgOccupancy * intervalHours;
    }
    
    // Add current period (last data point to now) using current occupancy
    if (sorted.length > 0 && sensorData?.occupancy?.current !== undefined) {
      const lastTime = new Date(sorted[sorted.length - 1].timestamp).getTime();
      const nowTime = Date.now();
      const finalIntervalHours = (nowTime - lastTime) / (1000 * 60 * 60);
      
      // Only add if interval is reasonable (< 2 hours)
      if (finalIntervalHours < 2) {
        const lastOcc = sorted[sorted.length - 1].occupancy?.current || 0;
        const currOcc = sensorData.occupancy.current;
        totalGuestHours += ((lastOcc + currOcc) / 2) * finalIntervalHours;
      }
    }
    
    // Avg Stay (hours) = Total Guest-Hours ÷ Total Entries
    const avgStayHours = totalGuestHours / todayEntries;
    const avgStayMinutes = Math.round(avgStayHours * 60);
    
    // Sanity check: clamp to reasonable range (5 min to 4 hours)
    // Values outside this range indicate data issues
    if (avgStayMinutes < 5 || avgStayMinutes > 240) {
      return null; // Data seems unreliable
    }
    
    return avgStayMinutes;
  }, [todayHistory, effectiveOccupancy.todayEntries, sensorData?.occupancy?.current]);
  
  // DEMO: Always show a number, never null
  const effectiveDwellTime = useMemo(() => {
    if (dwellTimeMinutes !== null) return dwellTimeMinutes;
    // Demo fallback: realistic avg stay for a busy venue
    if (isDemoAccount(venueId)) {
      return 95 + Math.floor(Math.random() * 20); // 95-115 minutes
    }
    return null;
  }, [dwellTimeMinutes, venueId]);
  
  const dwellScore = getDwellTimeScore(effectiveDwellTime);
  const dwellTimeFormatted = formatDwellTime(effectiveDwellTime);
  
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
    let avgStayMinutes: number | null = exitsPerHour > 0 
      ? Math.round((current / exitsPerHour) * 60)
      : null;
    
    // DEMO: Always show a number
    if (avgStayMinutes === null && isDemoAccount(venueId)) {
      avgStayMinutes = 105; // ~1.75 hours
    }
    
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
    
    // Factor scores (new formula: 40/25/20/15)
    soundScore: pulseScoreResult.factors.sound.score,
    lightScore: pulseScoreResult.factors.light.score,
    crowdScore: pulseScoreResult.factors.crowd.score,
    musicScore: pulseScoreResult.factors.music.score,
    
    // Time block (3-hour blocks)
    timeSlot: pulseScoreResult.timeSlot,
    timeBlockLabel: historicalScore ? getTimeBlockLabel(historicalScore.currentBlock.block) : '',
    
    // Historical comparison (YOUR best block for this day/time)
    bestNight: pulseScoreResult.bestNight as any, // Mapped to BestNightProfile format
    isLearning: historicalScore?.isLearning ?? true,
    learningConfidence: historicalScore?.confidence ?? 0,
    weeksOfData: historicalScore?.weeksOfData ?? 0,
    proximityToBest: pulseScoreResult.proximityToBest, // Already a number
    
    // Legacy fields for backward compatibility
    isUsingHistoricalData: pulseScoreResult.isUsingHistoricalData,
    detectedGenres: pulseScoreResult.detectedGenres,
    bestNightGenres: pulseScoreResult.bestNightGenres,
    
    // Estimated capacity
    estimatedCapacity,
    
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
    dwellTimeMinutes: effectiveDwellTime,
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

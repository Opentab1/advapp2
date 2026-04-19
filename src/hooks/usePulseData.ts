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
import { getDwellTimeScore, formatDwellTime, getReputationScore, calculatePulseScore, getCurrentTimeSlot } from '../utils/scoring';
import venueLearningService from '../services/venue-learning.service';
import { POLLING_INTERVALS, DATA_FRESHNESS } from '../utils/constants';
import apiService from '../services/api.service';
import authService from '../services/auth.service';
import googleReviewsService, { GoogleReviewsData } from '../services/google-reviews.service';
import venueSettingsService from '../services/venue-settings.service';
import weatherService, { WeatherData } from '../services/weather.service';

// Track which venue IDs have had settings initialized (keyed by venueId so logout/login
// with a different venue triggers re-initialization)
const venueSettingsInitialized = new Set<string>();
// Historical scoring will be re-implemented properly
// import { HistoricalScoreResult, getTimeBlockLabel } from '../services/historical-scoring.service';
import { isDemoAccount } from '../utils/demoData';
import venueScopeService, { VenueScopeJob, parseModes } from '../services/venuescope.service';
import { getBarDayStart } from '../utils/barDay';
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
  
  // VenueScope bar metrics (polled every 30s)
  totalDrinks: number | null;
  drinksPerHour: number | null;
  hasVenueScopeData: boolean;
  activityScore: number | null;
  retentionScore: number | null;
  hasTheftFlag: boolean;

  // Current sensor values
  currentDecibels: number | null;
  currentLight: number | null;
  
  // Occupancy
  currentOccupancy: number;
  todayEntries: number;
  todayExits: number;
  peakOccupancy: number;
  peakTime: string | null;
  isBLEEstimated: boolean; // True if entries/exits are estimated from BLE occupancy changes
  
  // BLE device breakdown (Pi Zero 2W)
  totalDevices: number | null;
  deviceBreakdown: import('../types').DeviceBreakdown | null;
  
  // BLE dwell time tracking (Pi Zero 2W)
  bleDwellTime: number | null;           // avg_stay_minutes from device
  longestVisitorMinutes: number | null;  // longest_current_minutes
  totalVisitsTracked: number | null;     // total_visits_tracked
  
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
    retentionRate: number | null; // 0-100% of guests still here; null when no entries yet today
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
  
  // VenueScope job data
  const [vsJobs, setVsJobs] = useState<VenueScopeJob[]>([]);

  // BLE device tracking (for Pi Zero 2W that doesn't have entry/exit sensors)
  // We estimate entries/exits based on changes in occupancy.current
  const prevOccupancyCurrent = useRef<number | null>(null);
  const [estimatedEntries, setEstimatedEntries] = useState(0);
  const [estimatedExits, setEstimatedExits] = useState(0);
  const [isBLEDevice, setIsBLEDevice] = useState(false);
  
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
      // No sensor present (VenueScope-only account) — suppress error, page still
      // renders with VenueScope data via the separate fetchVenueScopeData path.
      console.warn('[usePulseData] No sensor data (expected for VenueScope-only accounts):', err?.message);
    }
  }, [venueId]);
  
  const fetchOccupancy = useCallback(async () => {
    if (!venueId) return;
    
    try {
      const now = new Date();
      
      const barDayStart = getBarDayStart();
      
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
  
  const fetchVenueScopeData = useCallback(async () => {
    if (!venueId) return;
    // Demo account: inject demo jobs so rings and stats populate correctly
    if (isDemoAccount(venueId)) {
      const { generateDemoVenueScopeJobs } = await import('../utils/demoData');
      const demoJobs = generateDemoVenueScopeJobs();
      setVsJobs(demoJobs.filter(j =>
        j.status === 'done' || j.isLive === true || j.status === 'running'
      ));
      setLastUpdated(new Date());
      return;
    }
    try {
      const jobs = await venueScopeService.listJobs(venueId, 20);
      // Include done, running, and live-stream jobs (stable '~' IDs always included)
      setVsJobs(jobs.filter(j =>
        j.status === 'done' || j.isLive === true || j.status === 'running' ||
        (j.jobId ?? '').startsWith('~')
      ));
      setLastUpdated(new Date());
    } catch (err) {
      console.warn('[usePulseData] VenueScope fetch failed:', err);
    }
  }, [venueId]);

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
      
      // Initialize venue settings from cloud FIRST (so weather has address)
      if (!venueSettingsInitialized.has(venueId)) {
        try {
          await venueSettingsService.initializeForVenue(venueId);
          venueSettingsInitialized.add(venueId);
          console.log('✅ Venue settings initialized from cloud');
        } catch (error) {
          console.warn('⚠️ Could not initialize venue settings from cloud:', error);
        }
      }
      
      // Fetch in parallel
      await Promise.all([
        fetchLiveData(),
        fetchOccupancy(),
        fetchReviews(),
        fetchWeather(),
        fetchVenueScopeData(),
      ]);
      
      setLoading(false);
    };
    
    loadAllData();
  }, [enabled, venueId, fetchLiveData, fetchOccupancy, fetchReviews, fetchWeather, fetchVenueScopeData]);
  
// ============ POLLING ============

  useEffect(() => {
    if (!enabled || !venueId) return;
    
    // Poll live data
    const liveInterval = setInterval(fetchLiveData, pollingInterval);

    // Poll occupancy less frequently
    const occupancyInterval = setInterval(fetchOccupancy, POLLING_INTERVALS.occupancy);

    // Poll VenueScope jobs every 10s (matches VenueScope tab)
    const vsInterval = setInterval(fetchVenueScopeData, 10_000);

    return () => {
      clearInterval(liveInterval);
      clearInterval(occupancyInterval);
      clearInterval(vsInterval);
    };
  }, [enabled, venueId, pollingInterval, fetchLiveData, fetchOccupancy]);
  
  // ============ BLE DEVICE DETECTION & ESTIMATED ENTRIES/EXITS ============
  // For Pi Zero 2W devices that use BLE for occupancy (no entry/exit sensors)
  // We estimate entries/exits based on changes in occupancy.current
  
  useEffect(() => {
    if (!sensorData?.occupancy) return;
    
    const currentOcc = sensorData.occupancy.current ?? 0;
    const deviceEntries = sensorData.occupancy.entries ?? 0;
    const deviceExits = sensorData.occupancy.exits ?? 0;
    
    // Detect if this is a BLE-only device (entries and exits are always 0)
    // A real camera-based device would have entries/exits increasing over time
    // For BLE devices, they're always 0 but current changes
    const seemsLikeBLEDevice = (deviceEntries === 0 && deviceExits === 0 && currentOcc > 0);
    setIsBLEDevice(seemsLikeBLEDevice);
    
    if (seemsLikeBLEDevice && prevOccupancyCurrent.current !== null) {
      const diff = currentOcc - prevOccupancyCurrent.current;
      
      if (diff > 0) {
        // Occupancy went up - estimate entries
        setEstimatedEntries(prev => prev + diff);
        console.log(`📈 BLE: Estimated +${diff} entries (${currentOcc} from ${prevOccupancyCurrent.current})`);
      } else if (diff < 0) {
        // Occupancy went down - estimate exits
        setEstimatedExits(prev => prev + Math.abs(diff));
        console.log(`📉 BLE: Estimated +${Math.abs(diff)} exits (${currentOcc} from ${prevOccupancyCurrent.current})`);
      }
    }
    
    // Update previous value for next comparison
    prevOccupancyCurrent.current = currentOcc;
  }, [sensorData?.occupancy?.current, sensorData?.occupancy?.entries, sensorData?.occupancy?.exits]);
  
  // Reset estimated entries/exits at bar day boundary (3 AM)
  useEffect(() => {
    const checkDayReset = () => {
      const now = new Date();
      // Reset at 3 AM
      if (now.getHours() === 3 && now.getMinutes() < 5) {
        console.log('🔄 Resetting BLE estimated entries/exits for new bar day');
        setEstimatedEntries(0);
        setEstimatedExits(0);
        prevOccupancyCurrent.current = null;
      }
    };
    
    // Check every 5 minutes
    const interval = setInterval(checkDayReset, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);
  
// ============ COMPUTED VALUES ============

  const reputationScore = getReputationScore(reviews?.rating ?? null);
  
  // Data freshness
  const dataAgeSeconds = useMemo(() => {
    if (!lastUpdated) return Infinity;
    return Math.floor((Date.now() - lastUpdated.getTime()) / 1000);
  }, [lastUpdated]);
  
  const isConnected = dataAgeSeconds < DATA_FRESHNESS.disconnected;
  
  // ============ VENUESCOPE COMPUTED VALUES ============
  const vsTodayJobs = useMemo(() => {
    const todayTs = getBarDayStart().getTime() / 1000;
    // Always include stable live-camera records regardless of createdAt
    return vsJobs.filter(j =>
      (j.createdAt ?? 0) >= todayTs || j.isLive || (j.jobId ?? '').startsWith('~')
    );
  }, [vsJobs]);

  const vsTotalDrinks = useMemo(() =>
    vsTodayJobs.length > 0 ? vsTodayJobs.reduce((s, j) => s + (j.totalDrinks ?? 0), 0) : null,
    [vsTodayJobs]
  );

  const vsDrinksPerHour = useMemo(() => {
    // Only drink_count cameras have meaningful drinksPerHour — never use people_count cameras
    const drinkLive = vsTodayJobs.find(j => j.isLive && j.analysisMode === 'drink_count');
    if (drinkLive?.drinksPerHour != null) return drinkLive.drinksPerHour;
    // Fall back to any drink_count job with a rate (today)
    const anyDrink = vsTodayJobs.find(j => j.analysisMode === 'drink_count' && (j.drinksPerHour ?? 0) > 0);
    return anyDrink?.drinksPerHour ?? null;
  }, [vsTodayJobs]);

  const vsHasTheftFlag = useMemo(() =>
    vsJobs.some(j => j.hasTheftFlag),
    [vsJobs]
  );

  // Browser push notification when a new theft flag appears
  const prevTheftJobIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    const flagged = vsJobs.filter(j => j.hasTheftFlag);
    const newFlags = flagged.filter(j => !prevTheftJobIds.current.has(j.jobId));
    flagged.forEach(j => prevTheftJobIds.current.add(j.jobId));

    if (newFlags.length === 0) return;

    const fire = () => {
      newFlags.forEach(j => {
        const unrung = j.unrungDrinks ?? 0;
        const body = unrung > 0
          ? `${unrung} unrung drink${unrung !== 1 ? 's' : ''} detected — ${j.clipLabel || j.jobId.slice(0, 8)}`
          : `Theft flag on ${j.clipLabel || j.jobId.slice(0, 8)}`;
        new Notification('VenueScope Theft Alert', { body, icon: '/favicon.ico' });
      });
    };

    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      fire();
    } else if (Notification.permission === 'default') {
      Notification.requestPermission().then(p => { if (p === 'granted') fire(); });
    }
  }, [vsJobs]);

  const vsOccupancy = useMemo(() => {
    if (vsTodayJobs.length === 0) return null;
    // Only people_count cameras carry meaningful occupancy data.
    // Include live jobs AND recent snapshots (done within 25 min) — snapshot cameras
    // complete as 'done' (isLive=false) but their reading is still current.
    const nowSec = Date.now() / 1000;
    // Include jobs where any active mode is people_count (not just analysisMode)
    const peoplJobs = vsTodayJobs.filter(j =>
      j.analysisMode === 'people_count' || parseModes(j).includes('people_count')
    );
    // Include live jobs and recently-finished jobs (< 45 min ago)
    const peopleRecent = peoplJobs.filter(j =>
      j.isLive || (nowSec - (j.finishedAt ?? j.updatedAt ?? j.createdAt ?? 0)) < 2700
    );
    // Sum across cameras (each covers a different zone — same as VenueScope TonightHero).
    // currentHeadcount (live push every ~30s) > entries-exits > peakOccupancy fallback.
    const liveCurrent = peopleRecent.reduce((sum, j) => {
      const headcount = j.currentHeadcount || 0;
      if (headcount > 0) return sum + headcount;
      const ee = Math.max(0, (j.totalEntries ?? 0) - (j.totalExits ?? 0));
      return sum + (ee || j.peakOccupancy || 0);
    }, 0);
    const peakOccupancy = Math.max(...peoplJobs.map(j => j.peakOccupancy ?? 0), 0);
    return {
      todayEntries:  peoplJobs.reduce((s, j) => s + (j.totalEntries ?? 0), 0),
      todayExits:    peoplJobs.reduce((s, j) => s + (j.totalExits   ?? 0), 0),
      peakOccupancy,
      // If no live reading available, fall back to today's peak so ring isn't zero
      current: liveCurrent || peakOccupancy,
    };
  }, [vsTodayJobs]);

  // ============ OCCUPANCY CALCULATION ============
  const effectiveOccupancy = useMemo(() => {
    // VenueScope camera data always takes precedence for current occupancy —
    // cameras are updated every 15s and are more reliable than BLE/sensor estimates.
    if (vsOccupancy && (vsOccupancy.current > 0 || vsOccupancy.peakOccupancy > 0)) {
      return {
        // Use live current; fall back to today's peak when no recent live reading
        current:       vsOccupancy.current || vsOccupancy.peakOccupancy,
        todayEntries:  vsOccupancy.todayEntries,
        todayExits:    vsOccupancy.todayExits,
        peakOccupancy: vsOccupancy.peakOccupancy,
        peakTime:      null,
        isBLEEstimated: false,
      };
    }
    if (!sensorData?.occupancy) {
      // Fall back to VenueScope people-count data when no sensor is present
      if (vsOccupancy) {
        return {
          current:       vsOccupancy.current,
          todayEntries:  vsOccupancy.todayEntries,
          todayExits:    vsOccupancy.todayExits,
          peakOccupancy: vsOccupancy.peakOccupancy,
          peakTime:      null,
          isBLEEstimated: false,
        };
      }
      return { current: 0, todayEntries: 0, todayExits: 0, peakOccupancy: 0, peakTime: null, isBLEEstimated: false };
    }
    
    const entries = sensorData.occupancy.entries ?? 0;
    const exits = sensorData.occupancy.exits ?? 0;
    const current = sensorData.occupancy.current ?? 0;
    
    // Demo account: Use the values directly from generated data
    if (isDemoAccount(venueId)) {
      return {
        current,
        todayEntries: entries,
        todayExits: exits,
        peakOccupancy: Math.max(current, 458), // Demo peak
        peakTime: '22:15',
        isBLEEstimated: false,
      };
    }
    
    // BLE device (Pi Zero 2W): Use estimated entries/exits from occupancy changes
    // The device reports current occupancy but entries/exits are always 0
    if (isBLEDevice) {
      return {
        current, // Use the BLE-reported current occupancy directly
        todayEntries: estimatedEntries,
        todayExits: estimatedExits,
        peakOccupancy: current, // Will be tracked via history if needed
        peakTime: null,
        isBLEEstimated: true, // Flag so UI can show "~" for estimated
      };
    }
    
    // Camera-based device: Calculate from baseline
    let todayEntries = 0;
    let todayExits = 0;
    
    if (baseline) {
      todayEntries = Math.max(0, entries - baseline.entries);
      todayExits = Math.max(0, exits - baseline.exits);
    }
    
    // Currently inside = today's entries - today's exits
    const calculatedCurrent = Math.max(0, todayEntries - todayExits);
    
    return {
      current: calculatedCurrent,
      todayEntries,
      todayExits,
      peakOccupancy: calculatedCurrent,
      peakTime: null,
      isBLEEstimated: false,
    };
}, [sensorData?.occupancy, baseline, venueId, isBLEDevice, estimatedEntries, estimatedExits]);

  // Estimate venue capacity based on peak occupancy or default
  const estimatedCapacity = useMemo(() => {
    // Use peak occupancy * 1.2 as estimate, or default to 100
    if (effectiveOccupancy.peakOccupancy > 0) {
      return Math.max(effectiveOccupancy.peakOccupancy * 1.2, 50);
    }
    return 100;
  }, [effectiveOccupancy.peakOccupancy]);

  // Track learning data availability to trigger score recalculation
  const [learningVersion, setLearningVersion] = useState(0);
  
  // Check for learning data periodically and trigger recalc when it becomes available
  useEffect(() => {
    if (!venueId) return;
    
    // Check if learning data exists
    const learning = venueLearningService.getLearning(venueId);
    const timeSlot = getCurrentTimeSlot();
    const bestNight = learning?.bestNights?.[timeSlot];
    
    if (bestNight) {
      console.log(`🏆 Historical data available for ${timeSlot}:`, bestNight.date);
      setLearningVersion(v => v + 1);
    }
    
    // Also check after a delay (in case learning is still loading)
    const timer = setTimeout(() => {
      const updatedLearning = venueLearningService.getLearning(venueId);
      const updatedBestNight = updatedLearning?.bestNights?.[timeSlot];
      if (updatedBestNight && !bestNight) {
        console.log(`🏆 Historical data NOW available for ${timeSlot}:`, updatedBestNight.date);
        setLearningVersion(v => v + 1);
      }
    }, 3000); // Check again after 3 seconds
    
    return () => clearTimeout(timer);
  }, [venueId, sensorData]); // Re-check when venueId or sensor data changes
  
  // Calculate Pulse Score - uses the original working scoring function
  // Now includes learningVersion as dependency to recalculate when historical data loads
  const pulseScoreResult = useMemo(() => {
    // Log what data is available
    const learning = venueLearningService.getLearning(venueId);
    const timeSlot = getCurrentTimeSlot();
    const bestNight = learning?.bestNights?.[timeSlot];
    
    if (bestNight) {
      console.log(`📊 Scoring with YOUR best ${timeSlot}: Sound ${bestNight.avgSound}dB, Light ${bestNight.avgLight} lux`);
    } else {
      console.log(`📊 No historical data for ${timeSlot} yet - using defaults`);
    }
    
    // VenueScope activity score: drinks/hr → 0-100 (40/hr = 100%)
    const vsActivityScore = vsDrinksPerHour != null
      ? Math.min(100, Math.round((vsDrinksPerHour / 40) * 100))
      : null;
    // VenueScope retention score: % of tonight's entries still inside
    const vsRetentionScore = effectiveOccupancy.todayEntries > 0
      ? Math.min(100, Math.round((effectiveOccupancy.current / effectiveOccupancy.todayEntries) * 100))
      : null;

    return calculatePulseScore(
      sensorData?.decibels,
      sensorData?.light,
      null, // indoorTemp - removed
      null, // outdoorTemp - removed
      sensorData?.currentSong,
      sensorData?.artist,
      venueId,
      undefined, // timestamp
      effectiveOccupancy.current, // currentOccupancy for crowd scoring
      estimatedCapacity, // for crowd scoring
      vsActivityScore,
      vsRetentionScore
    );
  }, [sensorData?.decibels, sensorData?.light, sensorData?.currentSong, sensorData?.artist, venueId, effectiveOccupancy.current, estimatedCapacity, learningVersion, vsDrinksPerHour, effectiveOccupancy.todayEntries]);
  

  // ============ DWELL TIME CALCULATION ============
  // Using FIFO (First In, First Out) method
  // 
  // For each exit, match it to the earliest unmatched entry.
  // Dwell time = exit timestamp - entry timestamp
  //
  // This gives intuitive, per-cohort dwell times.
  
  const dwellTimeMinutes = useMemo((): number | null => {
    // Need at least 2 data points
    if (todayHistory.length < 2) {
      return null;
    }
    
    // Sort by timestamp
    const sorted = [...todayHistory].sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    
    // Build entry and exit events from the cumulative counters
    // Each data point has cumulative entries/exits - we need to find the deltas
    interface TimeEvent {
      timestamp: number;
      entries: number;  // New entries in this interval
      exits: number;    // New exits in this interval
    }
    
    const events: TimeEvent[] = [];
    
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      
      const prevEntries = prev.occupancy?.entries ?? 0;
      const currEntries = curr.occupancy?.entries ?? 0;
      const prevExits = prev.occupancy?.exits ?? 0;
      const currExits = curr.occupancy?.exits ?? 0;
      
      const newEntries = Math.max(0, currEntries - prevEntries);
      const newExits = Math.max(0, currExits - prevExits);
      
      if (newEntries > 0 || newExits > 0) {
        events.push({
          timestamp: new Date(curr.timestamp).getTime(),
          entries: newEntries,
          exits: newExits,
        });
      }
    }
    
    if (events.length === 0) {
      return null;
    }
    
    // FIFO matching: Build a queue of entry timestamps
    // Each entry adds N timestamps to the queue
    // Each exit removes the oldest N timestamps and calculates dwell
    const entryQueue: number[] = [];
    let totalDwellMinutes = 0;
    let matchedExits = 0;
    
    for (const event of events) {
      // Add entries to the queue
      for (let i = 0; i < event.entries; i++) {
        entryQueue.push(event.timestamp);
      }
      
      // Match exits to oldest entries (FIFO)
      for (let i = 0; i < event.exits && entryQueue.length > 0; i++) {
        const entryTime = entryQueue.shift()!; // Remove oldest
        const dwellMs = event.timestamp - entryTime;
        const dwellMins = dwellMs / (1000 * 60);
        
        // Only count reasonable dwell times (1 min to 6 hours)
        if (dwellMins >= 1 && dwellMins <= 360) {
          totalDwellMinutes += dwellMins;
          matchedExits++;
        }
      }
    }
    
    // Calculate average
    if (matchedExits === 0) {
      return null;
    }
    
    const avgDwell = Math.round(totalDwellMinutes / matchedExits);
    
    // Sanity check — allow 1 min (fast bar) to 8 hrs (sports bar/late night)
    if (avgDwell < 1 || avgDwell > 480) {
      return null;
    }
    
    console.log(`⏱️ FIFO Dwell: ${matchedExits} exits matched, avg ${avgDwell} min`);
    return avgDwell;
  }, [todayHistory]);
  
  // Use BLE dwell time if available, otherwise use FIFO calculation
  const effectiveDwellTime = useMemo(() => {
    // Priority 1: BLE device reports avg_stay_minutes directly (Pi Zero 2W)
    const bleDwellTime = sensorData?.occupancy?.avg_stay_minutes;
    if (bleDwellTime !== undefined && bleDwellTime > 0) {
      return Math.round(bleDwellTime);
    }
    
    // Priority 2: FIFO calculation from entries/exits (camera devices)
    if (dwellTimeMinutes !== null) return dwellTimeMinutes;
    
    // Priority 3: Demo fallback
    if (isDemoAccount(venueId)) {
      return 95 + Math.floor(Math.random() * 20); // 95-115 minutes
    }
    
    return null;
  }, [sensorData?.occupancy?.avg_stay_minutes, dwellTimeMinutes, venueId]);
  
  const dwellScore = getDwellTimeScore(effectiveDwellTime);
  const dwellTimeFormatted = formatDwellTime(effectiveDwellTime);
  
  // ============ ACCURATE RETENTION METRICS ============
  // These are 100% accurate based on raw entry/exit data
  
  const retentionMetrics = useMemo(() => {
    const current = effectiveOccupancy.current;
    const todayEntries = effectiveOccupancy.todayEntries;
    const todayExits = effectiveOccupancy.todayExits;
    
    // Calculate hours since bar day start (3 AM)
    const hoursSinceStart = Math.max(0.5, (Date.now() - getBarDayStart().getTime()) / (1000 * 60 * 60));
    
    // 1. Retention Rate: What % of tonight's guests are still here
    // 100% accurate - just math on entry/exit counts
    const retentionRate = todayEntries > 0
      ? Math.round((current / todayEntries) * 100)
      : null;
    
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
    
    // Core Pulse Score — show when we have sensor OR VenueScope data
    pulseScore: (sensorData || vsTodayJobs.length > 0) ? pulseScoreResult.score : null,
    pulseStatus: pulseScoreResult.status,
    pulseStatusLabel: pulseScoreResult.statusLabel,
    pulseColor: pulseScoreResult.color,
    
    // Factor scores (new formula: 40/25/20/15)
    soundScore: pulseScoreResult.factors.sound.score,
    lightScore: pulseScoreResult.factors.light.score,
    crowdScore: pulseScoreResult.factors.crowd.score,
    musicScore: pulseScoreResult.factors.music.score,
    
    // Time slot
    timeSlot: pulseScoreResult.timeSlot,
    timeBlockLabel: pulseScoreResult.timeSlot.charAt(0).toUpperCase() + pulseScoreResult.timeSlot.slice(1),
    
    // Historical comparison - now properly populated from learning service
    bestNight: pulseScoreResult.bestNight,
    isLearning: !pulseScoreResult.isUsingHistoricalData, // Not learning if we have historical data
    learningConfidence: pulseScoreResult.bestNight?.confidence ?? 0,
    weeksOfData: venueLearningService.getLearning(venueId)?.weeksOfData ?? 0,
    proximityToBest: pulseScoreResult.proximityToBest,
    
    // Legacy fields for backward compatibility
    isUsingHistoricalData: pulseScoreResult.isUsingHistoricalData,
    detectedGenres: pulseScoreResult.detectedGenres,
    bestNightGenres: pulseScoreResult.bestNightGenres,
    
    // Estimated capacity
    estimatedCapacity,
    
    // VenueScope bar metrics
    totalDrinks: vsTotalDrinks,
    drinksPerHour: vsDrinksPerHour,
    hasVenueScopeData: vsJobs.length > 0,
    activityScore: pulseScoreResult.factors.activity?.score ?? null,
    retentionScore: pulseScoreResult.factors.retention?.score ?? null,
    hasTheftFlag: vsHasTheftFlag,

    // Current sensor values
    currentDecibels: sensorData?.decibels ?? null,
    currentLight: sensorData?.light ?? null,
    
    // Occupancy - use effective occupancy which falls back to sensor data
    currentOccupancy: effectiveOccupancy.current,
    todayEntries: effectiveOccupancy.todayEntries,
    todayExits: effectiveOccupancy.todayExits,
    peakOccupancy: effectiveOccupancy.peakOccupancy,
    peakTime: effectiveOccupancy.peakTime,
    isBLEEstimated: effectiveOccupancy.isBLEEstimated,
    
    // BLE device breakdown
    totalDevices: sensorData?.occupancy?.total_devices ?? null,
    deviceBreakdown: sensorData?.occupancy?.device_breakdown ?? null,
    
    // BLE dwell time tracking
    bleDwellTime: sensorData?.occupancy?.avg_stay_minutes ?? null,
    longestVisitorMinutes: sensorData?.occupancy?.longest_current_minutes ?? null,
    totalVisitsTracked: sensorData?.occupancy?.total_visits_tracked ?? null,
    
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

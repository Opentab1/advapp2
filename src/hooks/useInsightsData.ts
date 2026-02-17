/**
 * useInsightsData - Data hook for Analytics page
 * 
 * Processes historical data into 3 levels:
 * - Level 1: Summary cards (report view)
 * - Level 2: Supporting data (modals)
 * - Level 3: Raw data (full charts)
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import apiService from '../services/api.service';
import authService from '../services/auth.service';
import { calculatePulseScore } from '../utils/scoring';
import { isDemoAccount } from '../utils/demoData';
import type { SensorData, TimeRange } from '../types';
import type {
  InsightsTimeRange,
  InsightsSummary,
  SweetSpotData,
  SweetSpotBucket,
  TrendData,
  HourlyData,
  FactorScore,
  PeriodComparison,
  RawDataPoint,
  InsightsData,
  SweetSpotVariable,
  DwellCorrelationData,
  DwellCorrelation,
  CorrelationDataPoint,
} from '../types/insights';

// ============ TIME RANGE MAPPING ============

/**
 * Get the most recent bar day boundary (3am)
 * Bar day runs from 3am to 3am (so "last night" is previous 3am to most recent 3am)
 */
function getMostRecent3am(): Date {
  const now = new Date();
  const today3am = new Date(now);
  today3am.setHours(3, 0, 0, 0);
  
  // If we haven't reached 3am yet today, use yesterday's 3am as the end
  if (now < today3am) {
    today3am.setDate(today3am.getDate() - 1);
  }
  
  return today3am;
}

function mapTimeRange(range: InsightsTimeRange): TimeRange {
  switch (range) {
    case 'last_night': return '24h'; // Will be overridden by custom fetch
    case '7d': return '7d';
    case '14d': return '14d';
    case '30d': return '30d';
    default: return '7d';
  }
}

function getTimeRangeLabel(range: InsightsTimeRange): string {
  switch (range) {
    case 'last_night': return 'Last Night';
    case '7d': return 'This Week';
    case '14d': return 'Last 14 Days';
    case '30d': return 'This Month';
    default: return 'Last 7 Days';
  }
}

// ============ MAIN HOOK ============

export function useInsightsData(timeRange: InsightsTimeRange): InsightsData {
  const user = authService.getStoredUser();
  const venueId = user?.venueId || '';
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rawSensorData, setRawSensorData] = useState<SensorData[]>([]);
  const [previousPeriodData, setPreviousPeriodData] = useState<SensorData[]>([]);
  
  // Fetch data
  const fetchData = useCallback(async () => {
    if (!venueId) {
      setLoading(false);
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      // For "last_night", use bar day boundaries (3am-3am)
      // This ensures "Last Night" actually shows last night's data, not rolling 24h
      if (timeRange === 'last_night') {
        const mostRecent3am = getMostRecent3am();
        const previous3am = new Date(mostRecent3am);
        previous3am.setDate(previous3am.getDate() - 1);
        
        // Fetch last 7 days to get both current and previous nights
        const result = await apiService.getHistoricalData(venueId, '7d');
        
        if (result?.data) {
          // Filter to just last night (previous 3am to most recent 3am)
          const lastNightData = result.data.filter(d => {
            const ts = new Date(d.timestamp);
            return ts >= previous3am && ts < mostRecent3am;
          });
          setRawSensorData(lastNightData);
          
          // Get the night before for comparison
          const twoDaysAgo3am = new Date(previous3am);
          twoDaysAgo3am.setDate(twoDaysAgo3am.getDate() - 1);
          
          const previousNightData = result.data.filter(d => {
            const ts = new Date(d.timestamp);
            return ts >= twoDaysAgo3am && ts < previous3am;
          });
          setPreviousPeriodData(previousNightData);
          
          console.log(`📊 Last Night: ${previous3am.toLocaleDateString()} 3am - ${mostRecent3am.toLocaleDateString()} 3am (${lastNightData.length} readings)`);
        } else {
          setRawSensorData([]);
        }
      } else {
        // Standard time range handling
        const apiRange = mapTimeRange(timeRange);
        const result = await apiService.getHistoricalData(venueId, apiRange);
        
        if (result?.data) {
          setRawSensorData(result.data);
        } else {
          setRawSensorData([]);
        }
        
        // Fetch previous period for comparison
        const extendedRange = timeRange === '7d' ? '14d' : 
                             timeRange === '14d' ? '30d' : '90d';
        const extendedResult = await apiService.getHistoricalData(venueId, extendedRange as TimeRange);
        
        if (extendedResult?.data) {
          // Split into current and previous periods
          const now = new Date();
          const periodMs = getPeriodMs(timeRange);
          const cutoff = new Date(now.getTime() - periodMs);
          const previousCutoff = new Date(cutoff.getTime() - periodMs);
          
          const previous = extendedResult.data.filter(d => {
            const ts = new Date(d.timestamp);
            return ts >= previousCutoff && ts < cutoff;
          });
          setPreviousPeriodData(previous);
        }
      }
      
    } catch (err: any) {
      console.error('Error fetching insights data:', err);
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [venueId, timeRange]);
  
  useEffect(() => {
    fetchData();
  }, [fetchData]);
  
  // ============ PROCESS DATA ============
  
  // Level 1: Summary
  const summary = useMemo((): InsightsSummary | null => {
    if (rawSensorData.length === 0) return null;
    return processSummary(rawSensorData, previousPeriodData, timeRange, venueId);
  }, [rawSensorData, previousPeriodData, timeRange, venueId]);
  
  // Level 1: Sweet Spot (default to sound)
  const allSweetSpots = useMemo(() => {
    if (rawSensorData.length === 0) return null;
    return {
      sound: processSweetSpot(rawSensorData, 'sound'),
      light: processSweetSpot(rawSensorData, 'light'),
      crowd: processSweetSpot(rawSensorData, 'crowd'),
    };
  }, [rawSensorData]);
  
  const sweetSpot = allSweetSpots?.sound || null;
  
  // Level 1: Trend
  const trend = useMemo((): TrendData | null => {
    if (rawSensorData.length === 0) return null;
    return processTrend(rawSensorData, previousPeriodData, timeRange);
  }, [rawSensorData, previousPeriodData, timeRange]);
  
  // Level 2: Hourly data
  const hourlyData = useMemo((): HourlyData[] => {
    if (rawSensorData.length === 0) return [];
    return processHourlyData(rawSensorData);
  }, [rawSensorData]);
  
  // Level 2: Factor scores
  const factorScores = useMemo((): FactorScore[] => {
    if (rawSensorData.length === 0) return [];
    return processFactorScores(rawSensorData);
  }, [rawSensorData]);
  
  // Level 2: Comparison
  const comparison = useMemo((): PeriodComparison | null => {
    if (rawSensorData.length === 0 || previousPeriodData.length === 0) return null;
    return processComparison(rawSensorData, previousPeriodData, timeRange);
  }, [rawSensorData, previousPeriodData, timeRange]);
  
  // Level 2: Trend chart data
  const trendChartData = useMemo(() => {
    if (rawSensorData.length === 0) return [];
    return processTrendChartData(rawSensorData);
  }, [rawSensorData]);
  
  // Level 3: Raw data points
  const rawData = useMemo((): RawDataPoint[] => {
    return rawSensorData.map(d => {
      // Pass timestamp for accurate historical scoring
      const { score } = calculatePulseScore(d.decibels, d.light, d.indoorTemp, d.outdoorTemp, null, null, null, d.timestamp);
      return {
        timestamp: new Date(d.timestamp),
        score: score || 0,
        decibels: d.decibels || 0,
        light: d.light || 0,
        occupancy: d.occupancy?.current || 0,
        dwellMinutes: null, // Calculated separately
        temperature: d.outdoorTemp || 0,
      };
    });
  }, [rawSensorData]);
  
  // Level 2: Dwell time correlations (metrics → how long guests stay)
  const dwellCorrelations = useMemo((): DwellCorrelationData | null => {
    if (rawSensorData.length === 0) return null;
    return processDwellCorrelations(rawSensorData);
  }, [rawSensorData]);
  
  return {
    loading,
    error,
    summary,
    sweetSpot,
    allSweetSpots,
    trend,
    hourlyData,
    factorScores,
    comparison,
    trendChartData,
    dwellCorrelations,
    rawData,
    sensorData: rawSensorData,
    refresh: fetchData,
  };
}

// ============ PROCESSING FUNCTIONS ============

function getPeriodMs(range: InsightsTimeRange): number {
  switch (range) {
    case 'last_night': return 24 * 60 * 60 * 1000;
    case '7d': return 7 * 24 * 60 * 60 * 1000;
    case '14d': return 14 * 24 * 60 * 60 * 1000;
    case '30d': return 30 * 24 * 60 * 60 * 1000;
    default: return 7 * 24 * 60 * 60 * 1000;
  }
}

// ============ SHARED GUEST COUNT CALCULATION ============
/**
 * Calculate total guests from sensor data.
 * 
 * Formula: latest.entries - earliest.entries
 * 
 * Counter is cumulative all-time (never resets).
 * This formula works for ALL time ranges.
 */
function calculateTotalGuests(
  periodData: SensorData[], 
  _requestedDays: number
): { count: number; isEstimate: boolean } {
  void _requestedDays;
  
  const withEntries = periodData
    .filter(d => d.occupancy?.entries !== undefined && d.occupancy.entries >= 0)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  
  if (withEntries.length < 2) {
    return { count: 0, isEstimate: withEntries.length === 1 };
  }
  
  const earliest = withEntries[0];
  const latest = withEntries[withEntries.length - 1];
  
  const guests = Math.max(0, latest.occupancy!.entries - earliest.occupancy!.entries);
  
  return { count: guests, isEstimate: false };
}

/**
 * Calculate total entries for a period (used for avg stay calculation)
 * 
 * Formula: latest.entries - earliest.entries
 */
function calculatePeriodEntries(periodData: SensorData[]): number {
  const withEntries = periodData
    .filter(d => d.occupancy?.entries !== undefined && d.occupancy.entries >= 0)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  
  if (withEntries.length < 2) return 0;
  
  const earliest = withEntries[0];
  const latest = withEntries[withEntries.length - 1];
  
  return Math.max(0, latest.occupancy!.entries - earliest.occupancy!.entries);
}

/**
 * Calculate average stay using occupancy integration.
 * Works correctly with both hourly aggregated and raw data.
 */
function calculatePeriodAvgStay(periodData: SensorData[]): number | null {
  // ============ FIFO METHOD ============
  // For each exit, match it to the earliest unmatched entry.
  // Dwell time = exit timestamp - entry timestamp
  // This gives intuitive, per-cohort dwell times.
  
  if (periodData.length < 2) return null;
  
  const sorted = [...periodData].sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  
  // Build entry and exit events from the cumulative counters
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
    
    // Skip unreasonably long intervals (> 4 hours = data gap)
    const prevTime = new Date(prev.timestamp).getTime();
    const currTime = new Date(curr.timestamp).getTime();
    const intervalHours = (currTime - prevTime) / (1000 * 60 * 60);
    if (intervalHours > 4) continue;
    
    if (newEntries > 0 || newExits > 0) {
      events.push({
        timestamp: currTime,
        entries: newEntries,
        exits: newExits,
      });
    }
  }
  
  if (events.length === 0) return null;
  
  // FIFO matching: Build a queue of entry timestamps
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
  if (matchedExits < 5) return null; // Need meaningful sample
  
  const avgDwell = Math.round(totalDwellMinutes / matchedExits);
  
  // Sanity check
  if (avgDwell < 5 || avgDwell > 240) {
    return null;
  }
  
  return avgDwell;
}

function processSummary(
  data: SensorData[], 
  previousData: SensorData[],
  timeRange: InsightsTimeRange,
  venueId: string
): InsightsSummary {
  // Calculate current period metrics
  let totalScore = 0;
  let scoreCount = 0;
  
  // Group by hour for peak detection
  const hourlyScores: Record<number, number[]> = {};
  
  // Sort data by timestamp
  const sortedData = [...data].sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  
  sortedData.forEach((d) => {
    const { score } = calculatePulseScore(d.decibels, d.light, d.indoorTemp, d.outdoorTemp, null, null, null, d.timestamp);
    if (score !== null) {
      totalScore += score;
      scoreCount++;
      
      const hour = new Date(d.timestamp).getHours();
      if (!hourlyScores[hour]) hourlyScores[hour] = [];
      hourlyScores[hour].push(score);
    }
  });
  
  const requestedDays = timeRange === 'last_night' ? 1 : 
                        timeRange === '7d' ? 7 : 
                        timeRange === '14d' ? 14 : 30;
  
  const guestResult = calculateTotalGuests(data, requestedDays);
  const totalGuests = guestResult.count;
  const guestsIsEstimate = guestResult.isEstimate;
  
  // Find peak hours - simply the hours with highest average scores
  // No arbitrary threshold - just find the busiest/best performing hours
  const hourlyAvgs: Array<{ hour: number; avgScore: number }> = [];
  Object.entries(hourlyScores).forEach(([hourStr, scores]) => {
    const hour = parseInt(hourStr);
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    hourlyAvgs.push({ hour, avgScore });
  });
  
  // Sort by score descending to find best hours
  hourlyAvgs.sort((a, b) => b.avgScore - a.avgScore);
  
  // Get top performing hours (take hours that are within 10 points of the best)
  const topHours: number[] = [];
  if (hourlyAvgs.length > 0) {
    const bestScore = hourlyAvgs[0].avgScore;
    hourlyAvgs.forEach(h => {
      if (h.avgScore >= bestScore - 10) {
        topHours.push(h.hour);
      }
    });
  }
  
  // Sort peak hours accounting for midnight wraparound
  const sortedPeakHours = topHours
    .map(h => h <= 6 ? h + 24 : h)
    .sort((a, b) => a - b);
  
  let peakStartHour = 24;
  let peakEndHour = 0;
  if (sortedPeakHours.length > 0) {
    peakStartHour = sortedPeakHours[0] >= 24 ? sortedPeakHours[0] - 24 : sortedPeakHours[0];
    peakEndHour = sortedPeakHours[sortedPeakHours.length - 1] >= 24 
      ? sortedPeakHours[sortedPeakHours.length - 1] - 24 
      : sortedPeakHours[sortedPeakHours.length - 1];
  }
  
  const avgScore = scoreCount > 0 ? Math.round(totalScore / scoreCount) : 0;
  
  // Calculate previous period metrics
  let prevTotalScore = 0;
  let prevScoreCount = 0;
  
  previousData.forEach(d => {
    const { score } = calculatePulseScore(d.decibels, d.light, d.indoorTemp, d.outdoorTemp, null, null, null, d.timestamp);
    if (score !== null) {
      prevTotalScore += score;
      prevScoreCount++;
    }
  });
  
  const prevGuestResult = calculateTotalGuests(previousData, requestedDays);
  const prevTotalGuests = prevGuestResult.count;
  
  const prevAvgScore = prevScoreCount > 0 ? Math.round(prevTotalScore / prevScoreCount) : avgScore;
  const scoreDelta = prevAvgScore > 0 ? Math.round(((avgScore - prevAvgScore) / prevAvgScore) * 100) : 0;
  const guestsDelta = prevTotalGuests > 0 ? Math.round(((totalGuests - prevTotalGuests) / prevTotalGuests) * 100) : 0;
  
  // Avg stay calculation
  let avgStayMinutes = calculatePeriodAvgStay(data);
  let prevAvgStay = calculatePeriodAvgStay(previousData);
  
  // DEMO: Always show a number
  if (avgStayMinutes === null && isDemoAccount(venueId)) {
    avgStayMinutes = 98;
  }
  if (prevAvgStay === null && isDemoAccount(venueId)) {
    prevAvgStay = 92;
  }
  
  const avgStayDelta = (avgStayMinutes !== null && prevAvgStay !== null && prevAvgStay > 0)
    ? Math.round(((avgStayMinutes - prevAvgStay) / prevAvgStay) * 100)
    : null;
  
  // Format peak hours
  const formatHour = (h: number) => h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h-12}pm`;
  const peakHours = peakStartHour < 24 ? `${formatHour(peakStartHour)} - ${formatHour(peakEndHour)}` : 'N/A';
  
  // Simple summary text - just the facts
  let summaryText = `Peak hours: ${peakHours}.`;
  if (avgStayMinutes !== null) {
    summaryText += ` Avg stay: ~${avgStayMinutes} min.`;
  }
  if (guestsDelta !== 0) {
    summaryText += ` Guests ${guestsDelta > 0 ? 'up' : 'down'} ${Math.abs(guestsDelta)}% vs previous.`;
  }
  
  return {
    score: avgScore,
    scoreDelta,
    avgStayMinutes,
    avgStayDelta,
    totalGuests,
    guestsIsEstimate,
    guestsDelta,
    summaryText,
    peakHours,
    timeInZoneHours: 0, // Removed - was using arbitrary threshold
    totalPeakHours: topHours.length,
  };
}

function processSweetSpot(data: SensorData[], variable: SweetSpotVariable): SweetSpotData {
  // Define buckets based on variable
  const bucketRanges: Record<SweetSpotVariable, Array<{ min: number; max: number; label: string }>> = {
    sound: [
      { min: 0, max: 65, label: '< 65 dB' },
      { min: 65, max: 70, label: '65-70 dB' },
      { min: 70, max: 75, label: '70-75 dB' },
      { min: 75, max: 82, label: '75-82 dB' },
      { min: 82, max: 90, label: '82-90 dB' },
      { min: 90, max: 999, label: '90+ dB' },
    ],
    light: [
      { min: 0, max: 30, label: '< 30 lux' },
      { min: 30, max: 70, label: '30-70 lux' },
      { min: 70, max: 150, label: '70-150 lux' },
      { min: 150, max: 999, label: '150+ lux' },
    ],
    crowd: [
      { min: 0, max: 50, label: '< 50 in venue' },
      { min: 50, max: 100, label: '50-100 in venue' },
      { min: 100, max: 150, label: '100-150 in venue' },
      { min: 150, max: 9999, label: '150+ in venue' },
    ],
  };
  
  const ranges = bucketRanges[variable];
  const bucketData: Record<string, { scoreSum: number; count: number }> = {};
  ranges.forEach(r => {
    bucketData[r.label] = { scoreSum: 0, count: 0 };
  });
  
  // Calculate REAL Pulse Score average per bucket (not fabricated dwell time)
  data.forEach(d => {
    let value: number;
    switch (variable) {
      case 'sound': value = d.decibels || 0; break;
      case 'light': value = d.light || 0; break;
      case 'crowd': value = d.occupancy?.current || 0; break; // Use actual guest count
      default: value = 0;
    }
    
    // Find matching bucket
    const bucket = ranges.find(r => value >= r.min && value < r.max);
    if (bucket) {
      // Pass timestamp for accurate historical scoring
      const { score } = calculatePulseScore(d.decibels, d.light, d.indoorTemp, d.outdoorTemp, null, null, null, d.timestamp);
      if (score !== null) {
        bucketData[bucket.label].scoreSum += score;
        bucketData[bucket.label].count++;
      }
    }
  });
  
  // Convert to bucket array and find optimal (highest avg score with sufficient samples)
  const buckets: SweetSpotBucket[] = ranges.map(r => {
    const bd = bucketData[r.label];
    const avgScore = bd.count > 0 ? Math.round(bd.scoreSum / bd.count) : 0;
    return {
      range: r.label,
      avgScore,
      sampleCount: bd.count,
      isOptimal: false, // Set below
    };
  });
  
  // Find optimal bucket (highest avg score with sufficient samples)
  // Reduced from 5% to 2% to include more valid buckets with smaller samples
  const minSamples = Math.max(10, data.length * 0.02); // At least 2% of data, min 10 samples
  let optimalIdx = 0;
  let maxScore = 0;
  buckets.forEach((b, idx) => {
    if (b.sampleCount >= minSamples && b.avgScore > maxScore) {
      maxScore = b.avgScore;
      optimalIdx = idx;
    }
  });
  buckets[optimalIdx].isOptimal = true;
  
  // Calculate outside-optimal average score
  const outsideBuckets = buckets.filter((_, idx) => idx !== optimalIdx && buckets[idx].sampleCount > 0);
  const outsideScore = outsideBuckets.length > 0 
    ? Math.round(outsideBuckets.reduce((sum, b) => sum + b.avgScore * b.sampleCount, 0) / 
                 outsideBuckets.reduce((sum, b) => sum + b.sampleCount, 0))
    : 0;
  
  // Calculate hit percentage
  const totalSamples = buckets.reduce((sum, b) => sum + b.sampleCount, 0);
  const hitPercentage = totalSamples > 0 
    ? Math.round((buckets[optimalIdx].sampleCount / totalSamples) * 100)
    : 0;
  
  return {
    variable,
    buckets,
    optimalRange: buckets[optimalIdx].range,
    optimalScore: buckets[optimalIdx].avgScore,
    outsideScore,
    hitPercentage,
    totalSamples,
  };
}

function processTrend(
  data: SensorData[], 
  previousData: SensorData[],
  timeRange: InsightsTimeRange
): TrendData {
  // Determine requested days for this time range
  const requestedDays = timeRange === 'last_night' ? 1 : 
                        timeRange === '7d' ? 7 : 
                        timeRange === '14d' ? 14 : 30;

  // Calculate current period metrics with factor breakdown for meaningful labels
  const dailyMetrics: Record<string, { 
    scores: number[]; 
    soundScores: number[];
    lightScores: number[];
    tempScores: number[];
    maxOccupancy: number;
  }> = {};
  
  data.forEach(d => {
    const date = new Date(d.timestamp).toDateString();
    if (!dailyMetrics[date]) {
      dailyMetrics[date] = { scores: [], soundScores: [], lightScores: [], tempScores: [], maxOccupancy: 0 };
    }
    // Pass timestamp for accurate historical scoring
    const result = calculatePulseScore(d.decibels, d.light, d.indoorTemp, d.outdoorTemp, null, null, null, d.timestamp);
    if (result.score) {
      dailyMetrics[date].scores.push(result.score);
      dailyMetrics[date].soundScores.push(result.factors.sound.score);
      dailyMetrics[date].lightScores.push(result.factors.light.score);
      dailyMetrics[date].tempScores.push(result.factors.crowd.score);
    }
    if (d.occupancy?.current && d.occupancy.current > dailyMetrics[date].maxOccupancy) {
      dailyMetrics[date].maxOccupancy = d.occupancy.current;
    }
  });
  
  // Helper to generate meaningful label based on factor analysis
  const generateDayLabel = (metrics: typeof dailyMetrics[string], isBest: boolean): string => {
    if (metrics.scores.length === 0) return '';
    
    const avgSound = metrics.soundScores.reduce((a, b) => a + b, 0) / metrics.soundScores.length;
    const avgLight = metrics.lightScores.reduce((a, b) => a + b, 0) / metrics.lightScores.length;
    const avgTemp = metrics.tempScores.reduce((a, b) => a + b, 0) / metrics.tempScores.length;
    
    if (isBest) {
      // Find what made this day great
      if (avgSound >= 85 && avgLight >= 85) return 'Sound & lighting on point';
      if (avgSound >= 85) return 'Great energy (sound perfect)';
      if (avgLight >= 85) return 'Perfect ambiance (lighting)';
      if (avgTemp >= 85) return 'Comfortable temp all day';
      if (metrics.maxOccupancy >= 100) return 'Packed house, great vibe';
      return 'Strong overall performance';
    } else {
      // Find what made this day weak
      const weakest = Math.min(avgSound, avgLight, avgTemp);
      if (weakest === avgSound && avgSound < 60) return 'Sound levels off';
      if (weakest === avgLight && avgLight < 60) return 'Lighting needs work';
      if (weakest === avgTemp && avgTemp < 60) return 'Temperature uncomfortable';
      if (metrics.maxOccupancy < 30) return 'Low turnout';
      return 'Room for improvement';
    }
  };
  
  // Find best/worst days
  let bestDay = { date: '', score: 0, label: '' };
  let worstDay = { date: '', score: 100, label: '' };
  let bestDayMetrics: typeof dailyMetrics[string] | null = null;
  let worstDayMetrics: typeof dailyMetrics[string] | null = null;
  
  Object.entries(dailyMetrics).forEach(([date, metrics]) => {
    const avgScore = metrics.scores.length > 0 
      ? Math.round(metrics.scores.reduce((a, b) => a + b, 0) / metrics.scores.length)
      : 0;
    
    if (avgScore > bestDay.score) {
      bestDay = { 
        date: new Date(date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
        score: avgScore,
        label: '' // Set after loop
      };
      bestDayMetrics = metrics;
    }
    if (avgScore < worstDay.score && avgScore > 0) {
      worstDay = { 
        date: new Date(date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
        score: avgScore,
        label: '' // Set after loop
      };
      worstDayMetrics = metrics;
    }
  });
  
  // Generate meaningful labels based on actual factor data
  if (bestDayMetrics) bestDay.label = generateDayLabel(bestDayMetrics, true);
  if (worstDayMetrics) worstDay.label = generateDayLabel(worstDayMetrics, false);
  
  // Calculate current period metrics
  const allScores = Object.values(dailyMetrics).flatMap(d => d.scores);
  const avgScore = allScores.length > 0 ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length) : 0;
  const avgStay = calculatePeriodAvgStay(data);
  const guestResult = calculateTotalGuests(data, requestedDays);
  const totalGuests = guestResult.count;
  const guestsIsEstimate = guestResult.isEstimate;
  
  // Previous period metrics
  const prevScores: number[] = [];
  previousData.forEach(d => {
    // Pass timestamp for accurate historical scoring
    const { score } = calculatePulseScore(d.decibels, d.light, d.indoorTemp, d.outdoorTemp, null, null, null, d.timestamp);
    if (score) prevScores.push(score);
  });
  const prevAvgScore = prevScores.length > 0 ? Math.round(prevScores.reduce((a, b) => a + b, 0) / prevScores.length) : avgScore;
  const prevAvgStay = calculatePeriodAvgStay(previousData);
  const prevTotalGuests = calculateTotalGuests(previousData, requestedDays).count;
  
  const guestsDelta = prevTotalGuests > 0 ? Math.round(((totalGuests - prevTotalGuests) / prevTotalGuests) * 100) : 0;
  const avgStayDelta = (avgStay !== null && prevAvgStay !== null && prevAvgStay > 0)
    ? Math.round(((avgStay - prevAvgStay) / prevAvgStay) * 100)
    : null;
  
  return {
    avgStay,
    avgStayDelta,
    totalGuests,
    guestsIsEstimate,
    guestsDelta,
    bestDay,
    worstDay,
    weekOverWeek: [
      { label: getTimeRangeLabel(timeRange), avgScore, avgStay, guests: totalGuests },
      { label: 'Previous', avgScore: prevAvgScore, avgStay: prevAvgStay, guests: prevTotalGuests },
    ],
  };
}

function processHourlyData(data: SensorData[]): HourlyData[] {
  const hourlyScores: Record<number, number[]> = {};
  
  data.forEach(d => {
    const hour = new Date(d.timestamp).getHours();
    // Pass timestamp for accurate historical scoring
    const { score } = calculatePulseScore(d.decibels, d.light, d.indoorTemp, d.outdoorTemp, null, null, null, d.timestamp);
    if (score) {
      if (!hourlyScores[hour]) hourlyScores[hour] = [];
      hourlyScores[hour].push(score);
    }
  });
  
  // Find peak hour
  let peakHour = 0;
  let peakScore = 0;
  Object.entries(hourlyScores).forEach(([hour, scores]) => {
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    if (avg > peakScore) {
      peakScore = avg;
      peakHour = parseInt(hour);
    }
  });
  
  // Format hours
  const formatHour = (h: number) => {
    if (h === 0) return '12am';
    if (h < 12) return `${h}am`;
    if (h === 12) return '12pm';
    return `${h - 12}pm`;
  };
  
  const getLabel = (score: number, isPeak: boolean): string => {
    if (isPeak) return 'Peak';
    if (score >= 80) return 'Strong';
    if (score >= 70) return 'Good';
    if (score >= 60) return 'Building';
    return 'Warming up';
  };
  
  return Object.entries(hourlyScores)
    .map(([hour, scores]) => {
      const h = parseInt(hour);
      const avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
      return {
        hour: formatHour(h),
        score: avgScore,
        label: getLabel(avgScore, h === peakHour),
        isHighlight: h === peakHour,
      };
    })
    .sort((a, b) => {
      // Sort by hour (convert back to 24h for sorting)
      const getHour24 = (h: string) => {
        const num = parseInt(h);
        if (h.includes('am')) return num === 12 ? 0 : num;
        return num === 12 ? 12 : num + 12;
      };
      return getHour24(a.hour) - getHour24(b.hour);
    });
}

function processFactorScores(data: SensorData[]): FactorScore[] {
  let soundSum = 0, lightSum = 0, crowdSum = 0;
  let soundCount = 0, lightCount = 0, crowdCount = 0;
  
  // Estimate capacity from max observed occupancy (with buffer)
  const maxObserved = Math.max(...data.map(d => d.occupancy?.current || 0));
  const estimatedCapacity = Math.max(100, Math.ceil(maxObserved * 1.2)); // 20% buffer
  
  data.forEach(d => {
    // Pass timestamp and occupancy for accurate scoring
    const result = calculatePulseScore(
      d.decibels, 
      d.light, 
      d.indoorTemp, 
      d.outdoorTemp, 
      null, // currentSong
      null, // artist
      null, // venueId
      d.timestamp,
      d.occupancy?.current || null, // Pass actual occupancy
      estimatedCapacity
    );
    
    // Only count factors with actual data
    if (d.decibels !== undefined && d.decibels > 0) {
      soundSum += result.factors.sound.score;
      soundCount++;
    }
    if (d.light !== undefined && d.light >= 0) {
      lightSum += result.factors.light.score;
      lightCount++;
    }
    if (d.occupancy?.current !== undefined && d.occupancy.current >= 0) {
      crowdSum += result.factors.crowd.score;
      crowdCount++;
    }
  });
  
  if (soundCount === 0 && lightCount === 0 && crowdCount === 0) return [];
  
  const getLabel = (score: number): string => {
    if (score >= 80) return 'In range';
    if (score >= 60) return 'Mostly good';
    return 'Needs adjustment';
  };
  
  const factors: FactorScore[] = [];
  
  // Only include factors with actual data
  if (soundCount > 0) {
    const avgSound = Math.round(soundSum / soundCount);
    factors.push({ factor: 'sound', score: avgSound, label: getLabel(avgSound) });
  }
  if (lightCount > 0) {
    const avgLight = Math.round(lightSum / lightCount);
    factors.push({ factor: 'light', score: avgLight, label: getLabel(avgLight) });
  }
  if (crowdCount > 0) {
    const avgCrowd = Math.round(crowdSum / crowdCount);
    factors.push({ factor: 'crowd', score: avgCrowd, label: getLabel(avgCrowd) });
  }
  
  return factors;
}

function processComparison(
  currentData: SensorData[], 
  previousData: SensorData[],
  timeRange: InsightsTimeRange
): PeriodComparison {
  // Determine requested days for this time range
  const requestedDays = timeRange === 'last_night' ? 1 : 
                        timeRange === '7d' ? 7 : 
                        timeRange === '14d' ? 14 : 30;

  // Current period
  let currentScoreSum = 0, currentCount = 0;
  currentData.forEach(d => {
    // Pass timestamp for accurate historical scoring
    const { score } = calculatePulseScore(d.decibels, d.light, d.indoorTemp, d.outdoorTemp, null, null, null, d.timestamp);
    if (score) { currentScoreSum += score; currentCount++; }
  });
  
  // Previous period
  let prevScoreSum = 0, prevCount = 0;
  previousData.forEach(d => {
    // Pass timestamp for accurate historical scoring
    const { score } = calculatePulseScore(d.decibels, d.light, d.indoorTemp, d.outdoorTemp, null, null, null, d.timestamp);
    if (score) { prevScoreSum += score; prevCount++; }
  });
  
  // Label accurately describes what we're comparing
  // For 'last_night': comparing to the night before (not same night last week)
  // For other ranges: comparing to the previous period of equal length
  const periodLabel = timeRange === 'last_night' 
    ? 'vs previous night' 
    : timeRange === '7d' 
      ? 'vs previous 7 days'
      : timeRange === '14d'
        ? 'vs previous 14 days'
        : 'vs previous 30 days';
  
  return {
    current: {
      score: currentCount > 0 ? Math.round(currentScoreSum / currentCount) : 0,
      avgStay: calculatePeriodAvgStay(currentData),
      guests: calculateTotalGuests(currentData, requestedDays).count,
    },
    previous: {
      score: prevCount > 0 ? Math.round(prevScoreSum / prevCount) : 0,
      avgStay: calculatePeriodAvgStay(previousData),
      guests: calculateTotalGuests(previousData, requestedDays).count,
    },
    periodLabel,
  };
}

function processTrendChartData(data: SensorData[]): Array<{ date: Date; score: number; avgStay: number; guests: number }> {
  // Group data by day
  const dailyData: Record<string, { 
    rawData: SensorData[];
    scores: number[]; 
  }> = {};
  
  data.forEach(d => {
    const date = new Date(d.timestamp).toDateString();
    if (!dailyData[date]) {
      dailyData[date] = { rawData: [], scores: [] };
    }
    dailyData[date].rawData.push(d);
    // Pass timestamp for accurate historical scoring
    const { score } = calculatePulseScore(d.decibels, d.light, d.indoorTemp, d.outdoorTemp, null, null, null, d.timestamp);
    if (score) dailyData[date].scores.push(score);
  });
  
  return Object.entries(dailyData)
    .map(([dateStr, metrics]) => ({
      date: new Date(dateStr),
      score: metrics.scores.length > 0 ? Math.round(metrics.scores.reduce((a, b) => a + b, 0) / metrics.scores.length) : 0,
      avgStay: 0, // Not displayed - can't calculate accurate per-day avg stay
      guests: calculateTotalGuests(metrics.rawData, 1).count, // Use shared helper for correct calculation
    }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

// ============ DWELL CORRELATION PROCESSING ============
/**
 * Correlate environmental metrics with dwell time.
 * 
 * Approach:
 * 1. Group data by hour (time windows)
 * 2. For each hour, calculate avg metric values AND dwell time
 * 3. Return time-series data for dual-axis charts
 * 4. Calculate correlation coefficient
 */
function processDwellCorrelations(data: SensorData[]): DwellCorrelationData {
  // Calculate overall average dwell time first
  const overallAvgDwell = calculatePeriodAvgStay(data);
  
  if (overallAvgDwell === null) {
    return {
      sound: null,
      light: null,
      crowd: null,
      hasData: false,
      totalDataPoints: 0,
    };
  }
  
  // Group data by hour to create time windows
  const hourlyWindows: Record<string, {
    timestamp: Date;
    data: SensorData[];
  }> = {};
  
  data.forEach(d => {
    const ts = new Date(d.timestamp);
    const hourKey = ts.toISOString().slice(0, 13); // YYYY-MM-DDTHH
    if (!hourlyWindows[hourKey]) {
      hourlyWindows[hourKey] = { timestamp: ts, data: [] };
    }
    hourlyWindows[hourKey].data.push(d);
  });
  
  // Calculate metrics per hour
  interface HourlyPoint {
    timestamp: Date;
    hour: string;
    avgSound: number;
    avgLight: number;
    avgCrowd: number;
    avgDwell: number | null;
  }
  
  const hourlyPoints: HourlyPoint[] = [];
  
  // Format hour label
  const formatHourLabel = (date: Date): string => {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const day = days[date.getDay()];
    const hour = date.getHours();
    const ampm = hour >= 12 ? 'pm' : 'am';
    const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    return `${day} ${hour12}${ampm}`;
  };
  
  Object.values(hourlyWindows).forEach(window => {
    if (window.data.length < 2) return;
    
    // Calculate average conditions in this hour
    let soundSum = 0, soundCount = 0;
    let lightSum = 0, lightCount = 0;
    let crowdSum = 0, crowdCount = 0;
    
    window.data.forEach(d => {
      if (d.decibels && d.decibels > 0) { soundSum += d.decibels; soundCount++; }
      if (d.light !== undefined && d.light >= 0) { lightSum += d.light; lightCount++; }
      if (d.occupancy?.current !== undefined) { crowdSum += d.occupancy.current; crowdCount++; }
    });
    
    // Need at least some valid data
    if (soundCount === 0 && lightCount === 0 && crowdCount === 0) return;
    
    // Estimate dwell time for this hour
    const hourDwell = calculatePeriodAvgStay(window.data);
    
    hourlyPoints.push({
      timestamp: window.timestamp,
      hour: formatHourLabel(window.timestamp),
      avgSound: soundCount > 0 ? Math.round(soundSum / soundCount) : 0,
      avgLight: lightCount > 0 ? Math.round(lightSum / lightCount) : 0,
      avgCrowd: crowdCount > 0 ? Math.round(crowdSum / crowdCount) : 0,
      avgDwell: hourDwell,
    });
  });
  
  // Sort by timestamp
  hourlyPoints.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  
  // Filter to points with valid dwell data for correlation
  const validPoints = hourlyPoints.filter(h => h.avgDwell !== null && h.avgDwell > 0);
  
  if (validPoints.length < 5) {
    return {
      sound: null,
      light: null,
      crowd: null,
      hasData: false,
      totalDataPoints: 0,
    };
  }
  
  // Build correlations for each factor
  const soundCorrelation = buildFactorCorrelation(
    hourlyPoints,
    validPoints,
    'sound',
    'Sound Level',
    'dB',
    h => h.avgSound,
    overallAvgDwell
  );
  
  const lightCorrelation = buildFactorCorrelation(
    hourlyPoints,
    validPoints,
    'light',
    'Lighting',
    'lux',
    h => h.avgLight,
    overallAvgDwell
  );
  
  const crowdCorrelation = buildFactorCorrelation(
    hourlyPoints,
    validPoints,
    'crowd',
    'Crowd Size',
    'guests',
    h => h.avgCrowd,
    overallAvgDwell
  );
  
  return {
    sound: soundCorrelation,
    light: lightCorrelation,
    crowd: crowdCorrelation,
    hasData: soundCorrelation !== null || lightCorrelation !== null || crowdCorrelation !== null,
    totalDataPoints: hourlyPoints.length,
  };
}

/**
 * Calculate Pearson correlation coefficient
 */
function calculateCorrelation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length < 3) return 0;
  
  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
  const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
  const sumY2 = y.reduce((sum, yi) => sum + yi * yi, 0);
  
  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  
  if (denominator === 0) return 0;
  return numerator / denominator;
}

interface HourlyPoint {
  timestamp: Date;
  hour: string;
  avgSound: number;
  avgLight: number;
  avgCrowd: number;
  avgDwell: number | null;
}

function buildFactorCorrelation(
  allPoints: HourlyPoint[],
  validPoints: HourlyPoint[],
  factor: 'sound' | 'light' | 'crowd',
  label: string,
  unit: string,
  getValue: (h: HourlyPoint) => number,
  overallAvgDwell: number
): DwellCorrelation | null {
  // Build data points for the chart
  const dataPoints = allPoints.map(h => ({
    timestamp: h.timestamp,
    hour: h.hour,
    metricValue: getValue(h),
    dwellMinutes: h.avgDwell,
  }));
  
  // Calculate correlation using valid points only
  const metricValues = validPoints.map(h => getValue(h));
  const dwellValues = validPoints.map(h => h.avgDwell as number);
  
  // Filter out zero metric values for correlation calculation
  const pairedData = metricValues
    .map((m, i) => ({ metric: m, dwell: dwellValues[i] }))
    .filter(p => p.metric > 0);
  
  if (pairedData.length < 5) return null;
  
  const correlationStrength = calculateCorrelation(
    pairedData.map(p => p.metric),
    pairedData.map(p => p.dwell)
  );
  
  // Calculate average metric
  const avgMetric = pairedData.reduce((sum, p) => sum + p.metric, 0) / pairedData.length;
  
  // Generate insight based on correlation
  let insight = '';
  if (correlationStrength > 0.3) {
    insight = `Higher ${factor} levels tend to correlate with longer stays`;
  } else if (correlationStrength < -0.3) {
    insight = `Lower ${factor} levels tend to correlate with longer stays`;
  } else {
    insight = `${label} shows weak correlation with stay duration`;
  }
  
  // Determine confidence
  let confidence: 'high' | 'medium' | 'low' = 'low';
  if (pairedData.length >= 50) confidence = 'high';
  else if (pairedData.length >= 20) confidence = 'medium';
  
  return {
    factor,
    label,
    unit,
    dataPoints,
    overallAvgDwell,
    overallAvgMetric: Math.round(avgMetric),
    correlationStrength: Math.round(correlationStrength * 100) / 100,
    insight,
    totalSamples: pairedData.length,
    confidence,
  };
}

export default useInsightsData;

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
} from '../types/insights';

// ============ TIME RANGE MAPPING ============

function mapTimeRange(range: InsightsTimeRange): TimeRange {
  switch (range) {
    case 'last_night': return '24h';
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
      // Fetch current period
      const apiRange = mapTimeRange(timeRange);
      const result = await apiService.getHistoricalData(venueId, apiRange);
      
      if (result?.data) {
        setRawSensorData(result.data);
      } else {
        setRawSensorData([]);
      }
      
      // Fetch previous period for comparison
      // For simplicity, fetch double the range and split
      const extendedRange = timeRange === 'last_night' ? '7d' : 
                           timeRange === '7d' ? '14d' : 
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
    return processSummary(rawSensorData, previousPeriodData, timeRange);
  }, [rawSensorData, previousPeriodData, timeRange]);
  
  // Level 1: Sweet Spot (default to sound)
  const allSweetSpots = useMemo(() => {
    if (rawSensorData.length === 0) return null;
    return {
      sound: processSweetSpot(rawSensorData, 'sound'),
      light: processSweetSpot(rawSensorData, 'light'),
      crowd: processSweetSpot(rawSensorData, 'crowd'),
      temp: processSweetSpot(rawSensorData, 'temp'),
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
        temperature: d.indoorTemp || 0,
      };
    });
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
    rawData,
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
 * BOTH hourly aggregated and raw data store entries as a CUMULATIVE counter.
 * - Hourly aggregated: `totalEntries` = MAX cumulative value for that hour
 * - Raw data: `entries` = cumulative counter at that moment
 * 
 * CRITICAL: Counters may reset daily (at 3am for bar day) or periodically.
 * We MUST sum all positive deltas between consecutive points, plus add
 * the new value after each reset. This catches ALL entries across resets.
 * 
 * Example with daily resets:
 * Day 1: 10→50→100→200 (reset)
 * Day 2: 5→40→90→180 (reset)
 * Day 3: 8→45→95→190
 * 
 * Simple delta: 190 - 10 = 180 (WRONG - misses day 1 and 2!)
 * Correct: (200-10) + 180 + 190 = 560 (sums each day correctly)
 */
function calculateTotalGuests(
  periodData: SensorData[], 
  requestedDays: number
): { count: number; isEstimate: boolean } {
  const withEntries = periodData
    .filter(d => d.occupancy?.entries !== undefined && d.occupancy.entries > 0)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  
  if (withEntries.length === 0) {
    return { count: 0, isEstimate: false };
  }
  
  if (withEntries.length === 1) {
    // Only one data point - can't calculate delta, use the value itself as minimum
    return { count: withEntries[0].occupancy!.entries, isEstimate: true };
  }
  
  // ALWAYS sum deltas between consecutive points to handle any resets
  let measuredEntries = 0;
  for (let i = 1; i < withEntries.length; i++) {
    const prev = withEntries[i - 1].occupancy!.entries;
    const curr = withEntries[i].occupancy!.entries;
    
    if (curr > prev) {
      // Normal increment - add the delta
      measuredEntries += (curr - prev);
    } else if (curr < prev) {
      // Counter reset detected - add current value as new entries since reset
      measuredEntries += curr;
    }
    // If curr === prev, no new entries in this interval
  }
  
  // Calculate actual time span of our data
  const firstTimestamp = new Date(withEntries[0].timestamp).getTime();
  const lastTimestamp = new Date(withEntries[withEntries.length - 1].timestamp).getTime();
  const actualSpanMs = lastTimestamp - firstTimestamp;
  const actualSpanDays = Math.max(0.1, actualSpanMs / (24 * 60 * 60 * 1000));
  
  // If we have less data than requested, extrapolate to full period
  if (actualSpanDays < requestedDays * 0.9) {
    const dailyRate = measuredEntries / actualSpanDays;
    return { count: Math.round(dailyRate * requestedDays), isEstimate: true };
  }
  
  return { count: measuredEntries, isEstimate: false };
}

/**
 * Calculate total entries for a period (used for avg stay calculation)
 * Returns the RAW entry count without extrapolation.
 * 
 * ALWAYS sums deltas between consecutive points to handle counter resets.
 */
function calculatePeriodEntries(periodData: SensorData[]): number {
  const withEntries = periodData
    .filter(d => d.occupancy?.entries !== undefined && d.occupancy.entries > 0)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  
  if (withEntries.length < 2) return 0;
  
  // Sum all deltas to handle any resets
  let totalEntries = 0;
  for (let i = 1; i < withEntries.length; i++) {
    const prev = withEntries[i - 1].occupancy!.entries;
    const curr = withEntries[i].occupancy!.entries;
    
    if (curr > prev) {
      totalEntries += (curr - prev);
    } else if (curr < prev) {
      // Counter reset - add current value
      totalEntries += curr;
    }
  }
  
  return totalEntries;
}

/**
 * Calculate average stay using occupancy integration.
 * Works correctly with both hourly aggregated and raw data.
 */
function calculatePeriodAvgStay(periodData: SensorData[]): number | null {
  if (periodData.length < 2) return null;
  
  const sorted = [...periodData].sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  
  // Get total entries using the correct method
  const totalEntries = calculatePeriodEntries(sorted);
  if (totalEntries < 5) return null; // Need meaningful sample
  
  // Calculate total guest-hours by integrating occupancy over time
  let totalGuestHours = 0;
  
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    
    const prevTime = new Date(prev.timestamp).getTime();
    const currTime = new Date(curr.timestamp).getTime();
    const intervalHours = (currTime - prevTime) / (1000 * 60 * 60);
    
    // Skip unreasonably long intervals (> 4 hours = data gap)
    if (intervalHours > 4) continue;
    
    // Use average occupancy for this interval (trapezoidal integration)
    const prevOcc = prev.occupancy?.current || 0;
    const currOcc = curr.occupancy?.current || 0;
    const avgOccupancy = (prevOcc + currOcc) / 2;
    
    totalGuestHours += avgOccupancy * intervalHours;
  }
  
  if (totalGuestHours === 0) return null;
  
  // Avg Stay (hours) = Total Guest-Hours ÷ Total Entries
  const avgStayHours = totalGuestHours / totalEntries;
  const avgStayMinutes = Math.round(avgStayHours * 60);
  
  // Sanity check: clamp to reasonable range (5 min to 4 hours)
  if (avgStayMinutes < 5 || avgStayMinutes > 240) {
    return null; // Data seems unreliable
  }
  
  return avgStayMinutes;
}

function processSummary(
  data: SensorData[], 
  previousData: SensorData[],
  timeRange: InsightsTimeRange
): InsightsSummary {
  // Calculate current period metrics
  let totalScore = 0;
  let scoreCount = 0;
  let hoursInZone = 0;
  let totalPeakHours = 0;
  let peakStartHour = 24;
  let peakEndHour = 0;
  
  // Group by hour for peak detection
  const hourlyScores: Record<number, number[]> = {};
  
  // Sort data by timestamp to calculate actual time intervals
  const sortedData = [...data].sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  
  sortedData.forEach((d, idx) => {
    // Pass timestamp for accurate historical scoring
    const { score } = calculatePulseScore(d.decibels, d.light, d.indoorTemp, d.outdoorTemp, null, null, null, d.timestamp);
    if (score !== null) {
      totalScore += score;
      scoreCount++;
      
      const hour = new Date(d.timestamp).getHours();
      if (!hourlyScores[hour]) hourlyScores[hour] = [];
      hourlyScores[hour].push(score);
      
      // Count ACTUAL hours in zone based on real time intervals
      if (score >= 70 && idx > 0) {
        const prevTime = new Date(sortedData[idx - 1].timestamp).getTime();
        const currTime = new Date(d.timestamp).getTime();
        const intervalHours = (currTime - prevTime) / (1000 * 60 * 60);
        // Only count reasonable intervals (< 4 hours, to skip data gaps)
        if (intervalHours < 4) {
          hoursInZone += intervalHours;
        }
      }
    }
  });
  
  // Determine requested days for this time range
  const requestedDays = timeRange === 'last_night' ? 1 : 
                        timeRange === '7d' ? 7 : 
                        timeRange === '14d' ? 14 : 30;
  
  // Use shared helper that handles both hourly aggregated and raw data correctly
  const guestResult = calculateTotalGuests(data, requestedDays);
  const totalGuests = guestResult.count;
  const guestsIsEstimate = guestResult.isEstimate;
  
  // Find peak hours (business hours 4pm-2am typically)
  // Collect all hours that qualify as "peak" (score >= 70 during evening/night)
  const peakHoursList: number[] = [];
  Object.entries(hourlyScores).forEach(([hourStr, scores]) => {
    const hour = parseInt(hourStr);
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    // Peak hours are typically 4pm (16) through 2am, with score >= 70
    if (avgScore >= 70 && (hour >= 16 || hour <= 2)) {
      peakHoursList.push(hour);
      totalPeakHours++;
    }
  });
  
  // Sort peak hours accounting for midnight wraparound
  // Convert to "evening time" where 0-6am becomes 24-30
  const sortedPeakHours = peakHoursList
    .map(h => h <= 6 ? h + 24 : h)
    .sort((a, b) => a - b);
  
  if (sortedPeakHours.length > 0) {
    // Convert back from "evening time"
    peakStartHour = sortedPeakHours[0] >= 24 ? sortedPeakHours[0] - 24 : sortedPeakHours[0];
    peakEndHour = sortedPeakHours[sortedPeakHours.length - 1] >= 24 
      ? sortedPeakHours[sortedPeakHours.length - 1] - 24 
      : sortedPeakHours[sortedPeakHours.length - 1];
  }
  
  const avgScore = scoreCount > 0 ? Math.round(totalScore / scoreCount) : 0;
  
  // Calculate previous period metrics for delta
  let prevTotalScore = 0;
  let prevScoreCount = 0;
  
  previousData.forEach(d => {
    // Pass timestamp for accurate historical scoring
    const { score } = calculatePulseScore(d.decibels, d.light, d.indoorTemp, d.outdoorTemp, null, null, null, d.timestamp);
    if (score !== null) {
      prevTotalScore += score;
      prevScoreCount++;
    }
  });
  
  // Calculate previous period guests using the same correct method
  const prevGuestResult = calculateTotalGuests(previousData, requestedDays);
  const prevTotalGuests = prevGuestResult.count;
  
  const prevAvgScore = prevScoreCount > 0 ? Math.round(prevTotalScore / prevScoreCount) : avgScore;
  const scoreDelta = prevAvgScore > 0 ? Math.round(((avgScore - prevAvgScore) / prevAvgScore) * 100) : 0;
  const guestsDelta = prevTotalGuests > 0 ? Math.round(((totalGuests - prevTotalGuests) / prevTotalGuests) * 100) : 0;
  
  // Use shared helper for avg stay calculation (handles both data types correctly)
  const avgStayMinutes = calculatePeriodAvgStay(data);
  const prevAvgStay = calculatePeriodAvgStay(previousData);
  
  // Calculate delta only if both values exist
  const avgStayDelta = (avgStayMinutes !== null && prevAvgStay !== null && prevAvgStay > 0)
    ? Math.round(((avgStayMinutes - prevAvgStay) / prevAvgStay) * 100)
    : null;
  
  // Format peak hours
  const formatHour = (h: number) => h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h-12}pm`;
  const peakHours = peakStartHour < 24 ? `${formatHour(peakStartHour)} - ${formatHour(peakEndHour)}` : 'N/A';
  
  // Generate summary text
  let summaryText = '';
  if (avgScore >= 80) {
    summaryText = `Strong ${timeRange === 'last_night' ? 'night' : 'period'}. `;
  } else if (avgScore >= 65) {
    summaryText = `Solid ${timeRange === 'last_night' ? 'night' : 'period'}. `;
  } else {
    summaryText = `Room for improvement. `;
  }
  
  // Only mention dwell time if we have real data
  if (avgStayDelta !== null && avgStayDelta > 0) {
    summaryText += `Avg stay up ${avgStayDelta}%, `;
  }
  
  // Calculate actual time spent during peak hours (hours where we have data)
  // This makes the comparison meaningful: "X hours in zone out of Y total peak hours"
  const actualPeakHours = peakHoursList.length > 0 
    ? Math.round((peakHoursList.length / Object.keys(hourlyScores).length) * hoursInZone * 10) / 10
    : 0;
  
  // Use hoursInZone (actual time at score >= 70) vs total data hours
  const totalDataHours = sortedData.length > 1 
    ? (new Date(sortedData[sortedData.length - 1].timestamp).getTime() - 
       new Date(sortedData[0].timestamp).getTime()) / (1000 * 60 * 60)
    : 0;
  
  if (hoursInZone > 0) {
    const zonePercentage = totalDataHours > 0 ? Math.round((hoursInZone / totalDataHours) * 100) : 0;
    summaryText += `You were in the zone ${zonePercentage}% of the time (${hoursInZone.toFixed(1)} hours).`;
  } else {
    summaryText += `Limited time in optimal zone.`;
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
    timeInZoneHours: Math.round(hoursInZone * 10) / 10,
    totalPeakHours: peakHoursList.length, // Number of unique peak hours
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
    temp: [
      { min: 0, max: 65, label: '< 65°F' },
      { min: 65, max: 70, label: '65-70°F' },
      { min: 70, max: 75, label: '70-75°F' },
      { min: 75, max: 999, label: '75+°F' },
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
      case 'temp': value = d.indoorTemp || 70; break;
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
  const minSamples = Math.max(5, data.length * 0.05); // At least 5% of data
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
      dailyMetrics[date].tempScores.push(result.factors.temperature.score);
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
  let soundSum = 0, lightSum = 0, tempSum = 0;
  let count = 0;
  
  data.forEach(d => {
    // Pass timestamp for accurate historical scoring
    const result = calculatePulseScore(d.decibels, d.light, d.indoorTemp, d.outdoorTemp, null, null, null, d.timestamp);
    soundSum += result.factors.sound.score;
    lightSum += result.factors.light.score;
    tempSum += result.factors.temperature.score;
    count++;
  });
  
  if (count === 0) return [];
  
  const getLabel = (score: number): string => {
    if (score >= 80) return 'In range';
    if (score >= 60) return 'Mostly good';
    return 'Needs adjustment';
  };
  
  // Only return factors we can accurately calculate from real sensor data
  // Crowd score removed - cannot calculate meaningful score without venue capacity data
  return [
    { factor: 'sound', score: Math.round(soundSum / count), label: getLabel(soundSum / count) },
    { factor: 'light', score: Math.round(lightSum / count), label: getLabel(lightSum / count) },
    { factor: 'temp', score: Math.round(tempSum / count), label: getLabel(tempSum / count) },
  ];
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

export default useInsightsData;

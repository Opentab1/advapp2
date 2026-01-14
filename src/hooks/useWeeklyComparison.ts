/**
 * useWeeklyComparison - Fetches and compares this week vs last week
 * 
 * Calculates:
 * - Average Pulse Score
 * - Total visitors
 * - Peak occupancy
 * - Average dwell time
 * - Best/worst hours
 * - Daily scores
 */

import { useState, useEffect, useCallback } from 'react';
import apiService from '../services/api.service';
import { calculatePulseScore } from '../utils/scoring';
import type { SensorData } from '../types';
import type { WeekData } from '../components/history/WeeklyComparison';

interface UseWeeklyComparisonReturn {
  thisWeek: WeekData | null;
  lastWeek: WeekData | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useWeeklyComparison(venueId: string): UseWeeklyComparisonReturn {
  const [thisWeek, setThisWeek] = useState<WeekData | null>(null);
  const [lastWeek, setLastWeek] = useState<WeekData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const fetchData = useCallback(async () => {
    if (!venueId) {
      setLoading(false);
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      // Fetch 14 days of data to compare two weeks
      const result = await apiService.getHistoricalData(venueId, '14d');
      
      if (!result?.data || result.data.length === 0) {
        setThisWeek(null);
        setLastWeek(null);
        setLoading(false);
        return;
      }
      
      // Get week boundaries
      const now = new Date();
      const startOfThisWeek = getStartOfWeek(now);
      const startOfLastWeek = new Date(startOfThisWeek);
      startOfLastWeek.setDate(startOfLastWeek.getDate() - 7);
      
      // Split data by week
      const thisWeekData = result.data.filter(d => {
        const date = new Date(d.timestamp);
        return date >= startOfThisWeek;
      });
      
      const lastWeekData = result.data.filter(d => {
        const date = new Date(d.timestamp);
        return date >= startOfLastWeek && date < startOfThisWeek;
      });
      
      // Calculate stats for each week
      setThisWeek(calculateWeekStats(thisWeekData));
      setLastWeek(lastWeekData.length > 0 ? calculateWeekStats(lastWeekData) : null);
      
    } catch (err: any) {
      console.error('Failed to fetch weekly comparison:', err);
      setError(err.message || 'Failed to load weekly data');
    } finally {
      setLoading(false);
    }
  }, [venueId]);
  
  useEffect(() => {
    fetchData();
  }, [fetchData]);
  
  return {
    thisWeek,
    lastWeek,
    loading,
    error,
    refresh: fetchData,
  };
}

// ============ HELPERS ============

function getStartOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sunday
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

function calculateWeekStats(data: SensorData[]): WeekData {
  if (data.length === 0) {
    return {
      avgPulseScore: 0,
      totalVisitors: 0,
      peakOccupancy: 0,
      avgDwellMinutes: 0,
      bestHour: null,
      worstHour: null,
      dailyScores: [],
    };
  }
  
  // Calculate Pulse Scores for each data point - pass timestamp for accurate historical scoring
  const scoredData = data.map(d => ({
    ...d,
    pulseScore: calculatePulseScore(d.decibels, d.light, d.indoorTemp, d.outdoorTemp, null, null, null, d.timestamp).score,
  }));
  
  // Average Pulse Score
  const avgPulseScore = scoredData.reduce((sum, d) => sum + d.pulseScore, 0) / scoredData.length;
  
  // Total visitors - handles both hourly aggregated and raw cumulative data
  const isHourlyAggregated = data.length > 0 && data[0]._hourlyAggregate === true;
  
  let totalVisitors = 0;
  
  if (isHourlyAggregated) {
    // HOURLY AGGREGATED: entries = count per period, SUM them all
    totalVisitors = data.reduce((sum, d) => sum + (d.occupancy?.entries || 0), 0);
  } else {
    // RAW DATA: entries = cumulative counter, take max per day (end of day value - start of day value would be better, but this is approximate)
    const dailyEntries = new Map<string, { first: number; last: number; firstTs: number; lastTs: number }>();
    
    const sortedData = [...data].sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    
    sortedData.forEach(d => {
      const date = new Date(d.timestamp).toDateString();
      const entries = d.occupancy?.entries || 0;
      const ts = new Date(d.timestamp).getTime();
      
      const existing = dailyEntries.get(date);
      if (!existing) {
        dailyEntries.set(date, { first: entries, last: entries, firstTs: ts, lastTs: ts });
      } else {
        if (ts < existing.firstTs) {
          existing.first = entries;
          existing.firstTs = ts;
        }
        if (ts > existing.lastTs) {
          existing.last = entries;
          existing.lastTs = ts;
        }
      }
    });
    
    // Sum the deltas (actual visitors per day)
    dailyEntries.forEach(({ first, last }) => {
      const delta = last - first;
      if (delta > 0) {
        totalVisitors += delta;
      }
    });
  }
  
  // Peak occupancy
  const peakOccupancy = Math.max(...data.map(d => d.occupancy?.current || 0));
  
  // Average dwell time (rough estimate: if we have entries and exits)
  let avgDwellMinutes = 45; // Default
  const totalEntriesSum = data.reduce((sum, d) => sum + (d.occupancy?.entries || 0), 0);
  const totalExitsSum = data.reduce((sum, d) => sum + (d.occupancy?.exits || 0), 0);
  if (totalEntriesSum > 0 && totalExitsSum > 0) {
    // Little's Law approximation
    const avgOccupancy = data.reduce((sum, d) => sum + (d.occupancy?.current || 0), 0) / data.length;
    const avgArrivalRate = totalEntriesSum / (data.length * 15); // per minute (assuming 15min intervals)
    if (avgArrivalRate > 0) {
      avgDwellMinutes = avgOccupancy / avgArrivalRate;
      avgDwellMinutes = Math.min(120, Math.max(10, avgDwellMinutes)); // Clamp to reasonable range
    }
  }
  
  // Best/worst hours
  const hourlyScores = new Map<number, number[]>();
  scoredData.forEach(d => {
    const hour = new Date(d.timestamp).getHours();
    const scores = hourlyScores.get(hour) || [];
    scores.push(d.pulseScore);
    hourlyScores.set(hour, scores);
  });
  
  let bestHour: { hour: number; score: number } | null = null;
  let worstHour: { hour: number; score: number } | null = null;
  
  hourlyScores.forEach((scores, hour) => {
    const avg = scores.reduce((sum, s) => sum + s, 0) / scores.length;
    if (!bestHour || avg > bestHour.score) {
      bestHour = { hour, score: Math.round(avg) };
    }
    if (!worstHour || avg < worstHour.score) {
      worstHour = { hour, score: Math.round(avg) };
    }
  });
  
  // Daily scores (Sun-Sat)
  const dailyScoreMap = new Map<number, number[]>();
  scoredData.forEach(d => {
    const dayOfWeek = new Date(d.timestamp).getDay();
    const scores = dailyScoreMap.get(dayOfWeek) || [];
    scores.push(d.pulseScore);
    dailyScoreMap.set(dayOfWeek, scores);
  });
  
  const dailyScores: number[] = [];
  for (let i = 0; i < 7; i++) {
    const scores = dailyScoreMap.get(i) || [];
    const avg = scores.length > 0 
      ? scores.reduce((sum, s) => sum + s, 0) / scores.length 
      : 0;
    dailyScores.push(Math.round(avg));
  }
  
  return {
    avgPulseScore: Math.round(avgPulseScore),
    totalVisitors,
    peakOccupancy,
    avgDwellMinutes: Math.round(avgDwellMinutes),
    bestHour,
    worstHour,
    dailyScores,
  };
}

export default useWeeklyComparison;

/**
 * usePeriodComparison - Fetches and compares current period vs previous period
 * 
 * Adapts based on time range:
 * - 24h: Today vs Yesterday (hourly breakdown)
 * - 7d: This Week vs Last Week (daily breakdown)
 * - 30d: This Month vs Last Month (weekly breakdown)
 * - 90d: This Quarter vs Last Quarter (monthly breakdown)
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import apiService from '../services/api.service';
import { calculatePulseScore } from '../utils/scoring';
import type { SensorData, TimeRange } from '../types';

// ============ TYPES ============

export interface PeriodData {
  avgPulseScore: number;
  totalVisitors: number;
  peakOccupancy: number;
  avgDwellMinutes: number;
  bestPeriod: { label: string; score: number } | null;
  worstPeriod: { label: string; score: number } | null;
  periodScores: { label: string; score: number; isCurrent?: boolean }[];
}

export interface PeriodConfig {
  currentLabel: string;
  previousLabel: string;
  periodType: 'hour' | 'day' | 'week' | 'month';
  fetchRange: string;
}

interface UsePeriodComparisonReturn {
  currentPeriod: PeriodData | null;
  previousPeriod: PeriodData | null;
  config: PeriodConfig;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

// ============ CONFIG ============

const PERIOD_CONFIGS: Record<TimeRange, PeriodConfig> = {
  '24h': {
    currentLabel: 'Today',
    previousLabel: 'Yesterday',
    periodType: 'hour',
    fetchRange: '48h', // Need 48h to compare today vs yesterday
  },
  '7d': {
    currentLabel: 'This Week',
    previousLabel: 'Last Week',
    periodType: 'day',
    fetchRange: '14d',
  },
  '30d': {
    currentLabel: 'This Month',
    previousLabel: 'Last Month',
    periodType: 'week',
    fetchRange: '60d',
  },
  '90d': {
    currentLabel: 'This Quarter',
    previousLabel: 'Last Quarter',
    periodType: 'month',
    fetchRange: '180d',
  },
};

// ============ HOOK ============

export function usePeriodComparison(venueId: string, timeRange: TimeRange): UsePeriodComparisonReturn {
  const [currentPeriod, setCurrentPeriod] = useState<PeriodData | null>(null);
  const [previousPeriod, setPreviousPeriod] = useState<PeriodData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const config = useMemo(() => PERIOD_CONFIGS[timeRange], [timeRange]);
  
  const fetchData = useCallback(async () => {
    if (!venueId) {
      setLoading(false);
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      const result = await apiService.getHistoricalData(venueId, config.fetchRange);
      
      if (!result?.data || result.data.length === 0) {
        setCurrentPeriod(null);
        setPreviousPeriod(null);
        setLoading(false);
        return;
      }
      
      // Split data into current and previous periods
      const { currentData, previousData } = splitDataByPeriod(result.data, timeRange);
      
      // Calculate stats for each period
      setCurrentPeriod(calculatePeriodStats(currentData, timeRange, true));
      setPreviousPeriod(previousData.length > 0 ? calculatePeriodStats(previousData, timeRange, false) : null);
      
    } catch (err: any) {
      console.error('Failed to fetch period comparison:', err);
      setError(err.message || 'Failed to load comparison data');
    } finally {
      setLoading(false);
    }
  }, [venueId, config.fetchRange, timeRange]);
  
  useEffect(() => {
    fetchData();
  }, [fetchData]);
  
  return {
    currentPeriod,
    previousPeriod,
    config,
    loading,
    error,
    refresh: fetchData,
  };
}

// ============ PERIOD SPLITTING ============

function splitDataByPeriod(data: SensorData[], timeRange: TimeRange): {
  currentData: SensorData[];
  previousData: SensorData[];
} {
  const now = new Date();
  
  switch (timeRange) {
    case '24h': {
      // Today vs Yesterday (using 3am bar day start)
      const todayStart = new Date(now);
      todayStart.setHours(3, 0, 0, 0);
      if (now.getHours() < 3) {
        todayStart.setDate(todayStart.getDate() - 1);
      }
      const yesterdayStart = new Date(todayStart);
      yesterdayStart.setDate(yesterdayStart.getDate() - 1);
      
      return {
        currentData: data.filter(d => new Date(d.timestamp) >= todayStart),
        previousData: data.filter(d => {
          const date = new Date(d.timestamp);
          return date >= yesterdayStart && date < todayStart;
        }),
      };
    }
    
    case '7d': {
      // This week vs last week
      const startOfThisWeek = getStartOfWeek(now);
      const startOfLastWeek = new Date(startOfThisWeek);
      startOfLastWeek.setDate(startOfLastWeek.getDate() - 7);
      
      return {
        currentData: data.filter(d => new Date(d.timestamp) >= startOfThisWeek),
        previousData: data.filter(d => {
          const date = new Date(d.timestamp);
          return date >= startOfLastWeek && date < startOfThisWeek;
        }),
      };
    }
    
    case '30d': {
      // This month vs last month
      const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      
      return {
        currentData: data.filter(d => new Date(d.timestamp) >= startOfThisMonth),
        previousData: data.filter(d => {
          const date = new Date(d.timestamp);
          return date >= startOfLastMonth && date < startOfThisMonth;
        }),
      };
    }
    
    case '90d': {
      // This quarter vs last quarter
      const currentQuarter = Math.floor(now.getMonth() / 3);
      const startOfThisQuarter = new Date(now.getFullYear(), currentQuarter * 3, 1);
      const startOfLastQuarter = new Date(now.getFullYear(), (currentQuarter - 1) * 3, 1);
      
      return {
        currentData: data.filter(d => new Date(d.timestamp) >= startOfThisQuarter),
        previousData: data.filter(d => {
          const date = new Date(d.timestamp);
          return date >= startOfLastQuarter && date < startOfThisQuarter;
        }),
      };
    }
    
    default:
      return { currentData: data, previousData: [] };
  }
}

// ============ STATS CALCULATION ============

function calculatePeriodStats(data: SensorData[], timeRange: TimeRange, isCurrent: boolean): PeriodData {
  if (data.length === 0) {
    return {
      avgPulseScore: 0,
      totalVisitors: 0,
      peakOccupancy: 0,
      avgDwellMinutes: 0,
      bestPeriod: null,
      worstPeriod: null,
      periodScores: [],
    };
  }
  
  // Calculate Pulse Scores - pass timestamp for accurate historical scoring
  const scoredData = data.map(d => ({
    ...d,
    pulseScore: calculatePulseScore(d.decibels, d.light, d.indoorTemp, d.outdoorTemp, null, null, null, d.timestamp).score,
  }));
  
  // Average Pulse Score
  const avgPulseScore = scoredData.reduce((sum, d) => sum + d.pulseScore, 0) / scoredData.length;
  
  // Total visitors calculation
  // Handles both raw data (cumulative) and hourly data (per-hour totals)
  const sortedData = [...data].sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  
  const withEntries = sortedData.filter(d => d.occupancy?.entries !== undefined && d.occupancy.entries >= 0);
  
  let totalVisitors = 0;
  if (withEntries.length > 0) {
    const isHourlyData = (withEntries[0] as any)._hourlyAggregate === true;
    
    if (isHourlyData) {
      // HOURLY DATA: Sum all entries
      totalVisitors = withEntries.reduce((sum, d) => sum + (d.occupancy?.entries || 0), 0);
    } else if (withEntries.length >= 2) {
      // RAW DATA: latest - earliest
      const earliest = withEntries[0];
      const latest = withEntries[withEntries.length - 1];
      totalVisitors = Math.max(0, latest.occupancy!.entries - earliest.occupancy!.entries);
    }
  }
  
  // Peak occupancy
  const peakOccupancy = Math.max(...data.map(d => d.occupancy?.current || 0), 0);
  
  // Average dwell (estimate)
  const avgDwellMinutes = estimateDwellTime(data);
  
  // Period breakdown scores
  const periodScores = calculatePeriodBreakdown(scoredData, timeRange, isCurrent);
  
  // Best/worst periods
  const sortedPeriods = [...periodScores].filter(p => p.score > 0).sort((a, b) => b.score - a.score);
  const bestPeriod = sortedPeriods[0] || null;
  const worstPeriod = sortedPeriods[sortedPeriods.length - 1] || null;
  
  return {
    avgPulseScore: Math.round(avgPulseScore),
    totalVisitors,
    peakOccupancy,
    avgDwellMinutes: Math.round(avgDwellMinutes),
    bestPeriod,
    worstPeriod: worstPeriod !== bestPeriod ? worstPeriod : null,
    periodScores,
  };
}

function getEntryKey(timestamp: string, timeRange: TimeRange): string {
  const date = new Date(timestamp);
  switch (timeRange) {
    case '24h':
      return date.getHours().toString();
    case '7d':
      return date.toDateString();
    case '30d':
      return `week-${Math.floor(date.getDate() / 7)}`;
    case '90d':
      return `${date.getFullYear()}-${date.getMonth()}`;
    default:
      return date.toDateString();
  }
}

function calculatePeriodBreakdown(
  data: Array<SensorData & { pulseScore: number }>,
  timeRange: TimeRange,
  isCurrent: boolean
): Array<{ label: string; score: number; isCurrent?: boolean }> {
  const now = new Date();
  
  switch (timeRange) {
    case '24h': {
      // Hourly breakdown (24 hours)
      const hourlyScores = new Map<number, number[]>();
      data.forEach(d => {
        const hour = new Date(d.timestamp).getHours();
        const scores = hourlyScores.get(hour) || [];
        scores.push(d.pulseScore);
        hourlyScores.set(hour, scores);
      });
      
      const result: Array<{ label: string; score: number; isCurrent?: boolean }> = [];
      for (let h = 0; h < 24; h++) {
        const scores = hourlyScores.get(h) || [];
        const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
        result.push({
          label: formatHour(h),
          score: Math.round(avg),
          isCurrent: isCurrent && h === now.getHours(),
        });
      }
      return result;
    }
    
    case '7d': {
      // Daily breakdown (Sun-Sat)
      const dailyScores = new Map<number, number[]>();
      data.forEach(d => {
        const day = new Date(d.timestamp).getDay();
        const scores = dailyScores.get(day) || [];
        scores.push(d.pulseScore);
        dailyScores.set(day, scores);
      });
      
      const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      return dayLabels.map((label, i) => {
        const scores = dailyScores.get(i) || [];
        const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
        return {
          label,
          score: Math.round(avg),
          isCurrent: isCurrent && i === now.getDay(),
        };
      });
    }
    
    case '30d': {
      // Weekly breakdown (4-5 weeks)
      const weeklyScores = new Map<number, number[]>();
      data.forEach(d => {
        const date = new Date(d.timestamp);
        const weekOfMonth = Math.floor((date.getDate() - 1) / 7);
        const scores = weeklyScores.get(weekOfMonth) || [];
        scores.push(d.pulseScore);
        weeklyScores.set(weekOfMonth, scores);
      });
      
      const result: Array<{ label: string; score: number; isCurrent?: boolean }> = [];
      const currentWeek = Math.floor((now.getDate() - 1) / 7);
      for (let w = 0; w < 5; w++) {
        const scores = weeklyScores.get(w) || [];
        const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
        result.push({
          label: `Week ${w + 1}`,
          score: Math.round(avg),
          isCurrent: isCurrent && w === currentWeek,
        });
      }
      return result.filter(w => w.score > 0 || w.isCurrent);
    }
    
    case '90d': {
      // Monthly breakdown (3 months)
      const monthlyScores = new Map<number, number[]>();
      data.forEach(d => {
        const month = new Date(d.timestamp).getMonth();
        const scores = monthlyScores.get(month) || [];
        scores.push(d.pulseScore);
        monthlyScores.set(month, scores);
      });
      
      const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const currentQuarter = Math.floor(now.getMonth() / 3);
      const quarterMonths = [currentQuarter * 3, currentQuarter * 3 + 1, currentQuarter * 3 + 2];
      
      return quarterMonths.map(m => {
        const scores = monthlyScores.get(m) || [];
        const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
        return {
          label: monthLabels[m],
          score: Math.round(avg),
          isCurrent: isCurrent && m === now.getMonth(),
        };
      });
    }
    
    default:
      return [];
  }
}

// ============ HELPERS ============

function getStartOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatHour(hour: number): string {
  if (hour === 0) return '12a';
  if (hour === 12) return '12p';
  if (hour < 12) return `${hour}a`;
  return `${hour - 12}p`;
}

function estimateDwellTime(data: SensorData[]): number {
  let avgDwellMinutes = 45;
  const totalEntries = data.reduce((sum, d) => sum + (d.occupancy?.entries || 0), 0);
  const totalExits = data.reduce((sum, d) => sum + (d.occupancy?.exits || 0), 0);
  
  if (totalEntries > 0 && totalExits > 0 && data.length > 0) {
    const avgOccupancy = data.reduce((sum, d) => sum + (d.occupancy?.current || 0), 0) / data.length;
    const avgArrivalRate = totalEntries / (data.length * 15);
    if (avgArrivalRate > 0) {
      avgDwellMinutes = avgOccupancy / avgArrivalRate;
      avgDwellMinutes = Math.min(120, Math.max(10, avgDwellMinutes));
    }
  }
  
  return avgDwellMinutes;
}

export default usePeriodComparison;

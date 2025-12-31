/**
 * useROITracking - Tracks and calculates ROI metrics over time
 * 
 * Addresses the "Prove ROI" problem:
 * - Shows improvement since using Pulse
 * - Calculates dwell time, score, and visitor trends
 * - Compares periods (this week vs last, this month vs last)
 * - Estimates revenue impact
 * 
 * For real venues: Fetches from DynamoDB
 * For demo accounts: Uses mock data
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import authService from '../services/auth.service';
import apiService from '../services/api.service';
import { isDemoAccount } from '../utils/demoData';
import type { SensorData } from '../types';

// ============ TYPES ============

export interface PeriodMetrics {
  startDate: Date;
  endDate: Date;
  avgPulseScore: number;
  avgDwellTime: number; // minutes
  totalVisitors: number;
  totalShifts: number;
  optimalTimePercent: number; // % of time with Pulse 85+
  peakNight: {
    date: Date;
    pulseScore: number;
    visitors: number;
  } | null;
}

export interface ROIComparison {
  // Raw changes
  pulseScoreChange: number;
  dwellTimeChange: number; // minutes
  visitorChange: number;
  optimalTimeChange: number; // percentage points
  
  // Percentage changes
  pulseScoreChangePercent: number;
  dwellTimeChangePercent: number;
  visitorChangePercent: number;
  
  // Trend direction
  trend: 'improving' | 'stable' | 'declining';
  
  // Human-readable summary
  summary: string;
}

export interface ROIInsight {
  id: string;
  type: 'win' | 'opportunity' | 'milestone';
  icon: string;
  title: string;
  description: string;
  metric?: string;
  date?: Date;
}

export interface ROIData {
  // Time since using Pulse
  daysSinceStart: number;
  firstRecordedDate: Date | null;
  
  // Current period (this week/month)
  currentWeek: PeriodMetrics | null;
  currentMonth: PeriodMetrics | null;
  
  // Previous period for comparison
  previousWeek: PeriodMetrics | null;
  previousMonth: PeriodMetrics | null;
  
  // All-time stats
  allTime: {
    avgPulseScore: number;
    avgDwellTime: number;
    totalVisitors: number;
    totalShifts: number;
    bestNight: PeriodMetrics['peakNight'];
    worstNight: PeriodMetrics['peakNight'];
  } | null;
  
  // Comparisons
  weekOverWeek: ROIComparison | null;
  monthOverMonth: ROIComparison | null;
  
  // Insights and wins
  insights: ROIInsight[];
  
  // Estimated revenue impact
  estimatedRevenueImpact: {
    dwellTimeRevenue: number; // $ from longer stays
    visitorRevenue: number; // $ from more visitors
    total: number;
    assumptions: string;
  } | null;
  
  // Loading state
  loading: boolean;
  error: string | null;
}

export interface UseROITrackingOptions {
  avgSpendPerMinute?: number; // $ spent per minute of dwell time
  avgSpendPerVisitor?: number; // $ per visitor
}

// ============ CONSTANTS ============

const DEFAULT_SPEND_PER_MINUTE = 0.50; // $0.50 per minute of dwell
const DEFAULT_SPEND_PER_VISITOR = 25; // $25 per visitor

// Optimal ranges for Pulse Score calculation
const OPTIMAL_SOUND = { min: 70, max: 82 };
const OPTIMAL_LIGHT = { min: 50, max: 350 };

// ============ HELPER FUNCTIONS ============

function calculatePulseScore(decibels: number | undefined, light: number | undefined): number {
  const scoreFactor = (value: number | undefined, range: { min: number; max: number }): number => {
    if (!value) return 0;
    if (value >= range.min && value <= range.max) return 100;
    const rangeSize = range.max - range.min;
    const tolerance = rangeSize * 0.5;
    if (value < range.min) {
      return Math.max(0, Math.round(100 - ((range.min - value) / tolerance) * 100));
    }
    return Math.max(0, Math.round(100 - ((value - range.max) / tolerance) * 100));
  };
  
  const soundScore = scoreFactor(decibels, OPTIMAL_SOUND);
  const lightScore = scoreFactor(light, OPTIMAL_LIGHT);
  
  return Math.round(soundScore * 0.6 + lightScore * 0.4);
}

interface DailyRecord {
  date: string;
  avgPulseScore: number;
  avgDwellTime: number;
  visitors: number;
  optimalMinutes: number;
  totalMinutes: number;
}

function aggregateByDay(sensorData: SensorData[]): DailyRecord[] {
  const dailyMap = new Map<string, SensorData[]>();
  
  // Group by date
  sensorData.forEach(item => {
    const dateKey = new Date(item.timestamp).toISOString().split('T')[0];
    if (!dailyMap.has(dateKey)) {
      dailyMap.set(dateKey, []);
    }
    dailyMap.get(dateKey)!.push(item);
  });
  
  const records: DailyRecord[] = [];
  
  dailyMap.forEach((items, date) => {
    if (items.length === 0) return;
    
    // Calculate Pulse scores for each reading
    const pulseScores = items
      .map(i => calculatePulseScore(i.decibels, i.light))
      .filter(s => s > 0);
    
    const avgPulseScore = pulseScores.length > 0
      ? Math.round(pulseScores.reduce((a, b) => a + b, 0) / pulseScores.length)
      : 0;
    
    // Get peak visitors for the day
    const peakVisitors = items.reduce((max, i) => {
      const current = i.occupancy?.current || 0;
      return current > max ? current : max;
    }, 0);
    
    // Estimate dwell time (minutes between readings with occupancy)
    // This is a rough estimate - actual dwell needs entry/exit tracking
    const avgDwellTime = peakVisitors > 0 ? Math.min(90, 30 + peakVisitors / 3) : 0;
    
    // Calculate optimal time (readings with Pulse >= 85)
    const optimalReadings = pulseScores.filter(s => s >= 85).length;
    const optimalMinutes = Math.round((optimalReadings / pulseScores.length) * items.length * 5); // Assume 5 min per reading
    const totalMinutes = items.length * 5;
    
    records.push({
      date,
      avgPulseScore,
      avgDwellTime,
      visitors: peakVisitors,
      optimalMinutes,
      totalMinutes,
    });
  });
  
  return records.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

// Generate mock data for demo accounts
function generateMockHistoricalData(): DailyRecord[] {
  const records: DailyRecord[] = [];
  const today = new Date();
  
  for (let i = 60; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    
    const dayOfWeek = date.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6;
    
    // Simulate improvement over time
    const improvementFactor = 1 + (60 - i) * 0.003;
    
    const basePulse = isWeekend ? 78 : 70;
    const baseDwell = isWeekend ? 45 : 35;
    const baseVisitors = isWeekend ? 120 : 65;
    
    records.push({
      date: date.toISOString().split('T')[0],
      avgPulseScore: Math.min(100, Math.round((basePulse + Math.random() * 15) * improvementFactor)),
      avgDwellTime: Math.round((baseDwell + Math.random() * 20) * improvementFactor),
      visitors: Math.round((baseVisitors + Math.random() * 40) * improvementFactor),
      optimalMinutes: Math.round((isWeekend ? 180 : 120) * improvementFactor * (0.5 + Math.random() * 0.3)),
      totalMinutes: isWeekend ? 360 : 300,
    });
  }
  
  return records;
}

// ============ MAIN HOOK ============

export function useROITracking(options: UseROITrackingOptions = {}): ROIData & { refresh: () => void } {
  const {
    avgSpendPerMinute = DEFAULT_SPEND_PER_MINUTE,
    avgSpendPerVisitor = DEFAULT_SPEND_PER_VISITOR,
  } = options;

  const [historicalData, setHistoricalData] = useState<DailyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const user = authService.getStoredUser();
  const venueId = user?.venueId || '';

  // Load historical data
  const loadData = useCallback(async () => {
    if (!venueId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // For demo accounts, use mock data
      if (isDemoAccount(venueId)) {
        await new Promise(r => setTimeout(r, 300)); // Simulate network delay
        const data = generateMockHistoricalData();
        setHistoricalData(data);
        setLoading(false);
        return;
      }

      // For real accounts, fetch from DynamoDB
      // Try to get 60 days of data
      const result = await apiService.getHistoricalData(venueId, '90d');
      const sensorData = result?.data || [];
      
      if (sensorData.length === 0) {
        setHistoricalData([]);
        setLoading(false);
        return;
      }

      // Aggregate sensor data by day
      const dailyRecords = aggregateByDay(sensorData);
      setHistoricalData(dailyRecords);

    } catch (err: any) {
      console.error('Failed to load ROI data:', err);
      setError(err.message || 'Failed to load data');
      setHistoricalData([]);
    } finally {
      setLoading(false);
    }
  }, [venueId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Calculate all metrics
  const roiData = useMemo((): Omit<ROIData, 'refresh'> => {
    if (historicalData.length === 0) {
      return {
        daysSinceStart: 0,
        firstRecordedDate: null,
        currentWeek: null,
        currentMonth: null,
        previousWeek: null,
        previousMonth: null,
        allTime: null,
        weekOverWeek: null,
        monthOverMonth: null,
        insights: [],
        estimatedRevenueImpact: null,
        loading,
        error,
      };
    }

    const today = new Date();
    const sortedData = [...historicalData].sort((a, b) => 
      new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    const firstDate = new Date(sortedData[0].date);
    const daysSinceStart = Math.floor((today.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24));

    // Helper to get records in a date range
    const getRecordsInRange = (start: Date, end: Date): DailyRecord[] => {
      return sortedData.filter(r => {
        const d = new Date(r.date);
        return d >= start && d <= end;
      });
    };

    // Helper to calculate period metrics
    const calculatePeriodMetrics = (records: DailyRecord[]): PeriodMetrics | null => {
      if (records.length === 0) return null;

      const avgPulseScore = Math.round(
        records.reduce((sum, r) => sum + r.avgPulseScore, 0) / records.length
      );
      const avgDwellTime = Math.round(
        records.reduce((sum, r) => sum + r.avgDwellTime, 0) / records.length
      );
      const totalVisitors = records.reduce((sum, r) => sum + r.visitors, 0);
      const totalOptimalMinutes = records.reduce((sum, r) => sum + r.optimalMinutes, 0);
      const totalMinutes = records.reduce((sum, r) => sum + r.totalMinutes, 0);
      const optimalTimePercent = totalMinutes > 0 
        ? Math.round((totalOptimalMinutes / totalMinutes) * 100) 
        : 0;

      // Find peak night
      const peakRecord = records.reduce((best, r) => 
        r.avgPulseScore > (best?.avgPulseScore ?? 0) ? r : best
      , records[0]);

      return {
        startDate: new Date(records[0].date),
        endDate: new Date(records[records.length - 1].date),
        avgPulseScore,
        avgDwellTime,
        totalVisitors,
        totalShifts: records.length,
        optimalTimePercent,
        peakNight: peakRecord ? {
          date: new Date(peakRecord.date),
          pulseScore: peakRecord.avgPulseScore,
          visitors: peakRecord.visitors,
        } : null,
      };
    };

    // Calculate week ranges
    const thisWeekStart = new Date(today);
    thisWeekStart.setDate(today.getDate() - today.getDay());
    thisWeekStart.setHours(0, 0, 0, 0);

    const lastWeekStart = new Date(thisWeekStart);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);
    const lastWeekEnd = new Date(thisWeekStart);
    lastWeekEnd.setDate(lastWeekEnd.getDate() - 1);

    // Calculate month ranges
    const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);

    // Get period metrics
    const currentWeek = calculatePeriodMetrics(getRecordsInRange(thisWeekStart, today));
    const previousWeek = calculatePeriodMetrics(getRecordsInRange(lastWeekStart, lastWeekEnd));
    const currentMonth = calculatePeriodMetrics(getRecordsInRange(thisMonthStart, today));
    const previousMonth = calculatePeriodMetrics(getRecordsInRange(lastMonthStart, lastMonthEnd));

    // Calculate all-time stats
    const allTimeMetrics = calculatePeriodMetrics(sortedData);
    const worstRecord = sortedData.reduce((worst, r) => 
      r.avgPulseScore < (worst?.avgPulseScore ?? 100) ? r : worst
    , sortedData[0]);

    const allTime = allTimeMetrics ? {
      avgPulseScore: allTimeMetrics.avgPulseScore,
      avgDwellTime: allTimeMetrics.avgDwellTime,
      totalVisitors: allTimeMetrics.totalVisitors,
      totalShifts: allTimeMetrics.totalShifts,
      bestNight: allTimeMetrics.peakNight,
      worstNight: worstRecord ? {
        date: new Date(worstRecord.date),
        pulseScore: worstRecord.avgPulseScore,
        visitors: worstRecord.visitors,
      } : null,
    } : null;

    // Calculate comparisons
    const weekOverWeek = calculateComparison(currentWeek, previousWeek);
    const monthOverMonth = calculateComparison(currentMonth, previousMonth);

    // Generate insights
    const insights = generateInsights(
      currentWeek, previousWeek, 
      currentMonth, previousMonth, 
      allTime, daysSinceStart
    );

    // Calculate revenue impact
    const estimatedRevenueImpact = calculateRevenueImpact(
      currentMonth, previousMonth,
      avgSpendPerMinute, avgSpendPerVisitor
    );

    return {
      daysSinceStart,
      firstRecordedDate: firstDate,
      currentWeek,
      currentMonth,
      previousWeek,
      previousMonth,
      allTime,
      weekOverWeek,
      monthOverMonth,
      insights,
      estimatedRevenueImpact,
      loading,
      error,
    };
  }, [historicalData, avgSpendPerMinute, avgSpendPerVisitor, loading, error]);

  return {
    ...roiData,
    refresh: loadData,
  };
}

// ============ COMPARISON HELPER ============

function calculateComparison(
  current: PeriodMetrics | null, 
  previous: PeriodMetrics | null
): ROIComparison | null {
  if (!current || !previous) return null;

  const pulseScoreChange = current.avgPulseScore - previous.avgPulseScore;
  const dwellTimeChange = current.avgDwellTime - previous.avgDwellTime;
  const visitorChange = current.totalVisitors - previous.totalVisitors;
  const optimalTimeChange = current.optimalTimePercent - previous.optimalTimePercent;

  const pulseScoreChangePercent = previous.avgPulseScore > 0 
    ? Math.round((pulseScoreChange / previous.avgPulseScore) * 100) 
    : 0;
  const dwellTimeChangePercent = previous.avgDwellTime > 0 
    ? Math.round((dwellTimeChange / previous.avgDwellTime) * 100) 
    : 0;
  const visitorChangePercent = previous.totalVisitors > 0 
    ? Math.round((visitorChange / previous.totalVisitors) * 100) 
    : 0;

  // Determine trend
  const positiveIndicators = [
    pulseScoreChange > 2,
    dwellTimeChange > 2,
    visitorChangePercent > 5,
  ].filter(Boolean).length;

  const negativeIndicators = [
    pulseScoreChange < -2,
    dwellTimeChange < -2,
    visitorChangePercent < -5,
  ].filter(Boolean).length;

  let trend: ROIComparison['trend'];
  if (positiveIndicators >= 2) trend = 'improving';
  else if (negativeIndicators >= 2) trend = 'declining';
  else trend = 'stable';

  // Generate summary
  let summary = '';
  if (trend === 'improving') {
    if (dwellTimeChangePercent > 0) {
      summary = `Guests are staying ${dwellTimeChangePercent}% longer on average.`;
    } else if (pulseScoreChange > 0) {
      summary = `Your Pulse Score improved by ${pulseScoreChange} points.`;
    } else {
      summary = 'Overall metrics are trending up!';
    }
  } else if (trend === 'declining') {
    summary = 'Some metrics dipped. Check the breakdown for details.';
  } else {
    summary = 'Metrics are holding steady.';
  }

  return {
    pulseScoreChange,
    dwellTimeChange,
    visitorChange,
    optimalTimeChange,
    pulseScoreChangePercent,
    dwellTimeChangePercent,
    visitorChangePercent,
    trend,
    summary,
  };
}

// ============ INSIGHTS GENERATOR ============

function generateInsights(
  currentWeek: PeriodMetrics | null,
  previousWeek: PeriodMetrics | null,
  currentMonth: PeriodMetrics | null,
  previousMonth: PeriodMetrics | null,
  allTime: ROIData['allTime'],
  daysSinceStart: number
): ROIInsight[] {
  const insights: ROIInsight[] = [];

  // Milestone: Days using Pulse
  if (daysSinceStart >= 30 && daysSinceStart < 31) {
    insights.push({
      id: 'milestone-30-days',
      type: 'milestone',
      icon: '🎉',
      title: '30 Days with Pulse!',
      description: 'You\'ve been optimizing your venue for a full month.',
    });
  }

  // Win: Pulse Score improvement
  if (currentWeek && previousWeek && currentWeek.avgPulseScore > previousWeek.avgPulseScore + 5) {
    insights.push({
      id: 'pulse-improvement',
      type: 'win',
      icon: '📈',
      title: 'Pulse Score Surge',
      description: `Up ${currentWeek.avgPulseScore - previousWeek.avgPulseScore} points from last week!`,
      metric: `${previousWeek.avgPulseScore} → ${currentWeek.avgPulseScore}`,
    });
  }

  // Win: Dwell time improvement
  if (currentMonth && previousMonth && currentMonth.avgDwellTime > previousMonth.avgDwellTime) {
    const increase = currentMonth.avgDwellTime - previousMonth.avgDwellTime;
    const percentIncrease = Math.round((increase / previousMonth.avgDwellTime) * 100);
    if (percentIncrease >= 10) {
      insights.push({
        id: 'dwell-improvement',
        type: 'win',
        icon: '⏱️',
        title: 'Guests Staying Longer',
        description: `Average visit duration up ${percentIncrease}% this month.`,
        metric: `+${increase} min/visit`,
      });
    }
  }

  // Win: Best night ever
  if (allTime?.bestNight && currentWeek?.peakNight) {
    const bestDate = new Date(allTime.bestNight.date);
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    
    if (bestDate >= weekAgo) {
      insights.push({
        id: 'best-night',
        type: 'win',
        icon: '🏆',
        title: 'Best Night Yet!',
        description: `${bestDate.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })} was your highest-scoring night.`,
        metric: `Pulse ${allTime.bestNight.pulseScore}`,
        date: bestDate,
      });
    }
  }

  // Win: Optimal time improvement
  if (currentWeek && previousWeek && currentWeek.optimalTimePercent > previousWeek.optimalTimePercent + 10) {
    insights.push({
      id: 'optimal-time',
      type: 'win',
      icon: '🎯',
      title: 'More Time in the Zone',
      description: `${currentWeek.optimalTimePercent}% of hours at optimal Pulse (up from ${previousWeek.optimalTimePercent}%).`,
    });
  }

  // Opportunity: Low optimal time
  if (currentWeek && currentWeek.optimalTimePercent < 40) {
    insights.push({
      id: 'opportunity-optimal',
      type: 'opportunity',
      icon: '💡',
      title: 'Room for Improvement',
      description: `Only ${currentWeek.optimalTimePercent}% of time at optimal Pulse. Focus on sound and lighting adjustments.`,
    });
  }

  // Win: Visitor increase
  if (currentMonth && previousMonth && currentMonth.totalVisitors > previousMonth.totalVisitors * 1.1) {
    const increase = currentMonth.totalVisitors - previousMonth.totalVisitors;
    insights.push({
      id: 'visitor-increase',
      type: 'win',
      icon: '👥',
      title: 'More Guests',
      description: `${increase.toLocaleString()} more visitors this month vs last.`,
      metric: `+${Math.round((increase / previousMonth.totalVisitors) * 100)}%`,
    });
  }

  // If no data yet, show getting started insight
  if (insights.length === 0 && daysSinceStart < 7) {
    insights.push({
      id: 'getting-started',
      type: 'milestone',
      icon: '🚀',
      title: 'Just Getting Started',
      description: 'Keep collecting data! After a week, we\'ll show you trends and insights.',
    });
  }

  return insights.slice(0, 5); // Limit to top 5 insights
}

// ============ REVENUE IMPACT CALCULATOR ============

function calculateRevenueImpact(
  currentMonth: PeriodMetrics | null,
  previousMonth: PeriodMetrics | null,
  avgSpendPerMinute: number,
  avgSpendPerVisitor: number
): ROIData['estimatedRevenueImpact'] {
  if (!currentMonth || !previousMonth) return null;

  // Revenue from longer dwell time
  const dwellTimeIncrease = currentMonth.avgDwellTime - previousMonth.avgDwellTime;
  const dwellTimeRevenue = dwellTimeIncrease > 0 
    ? Math.round(dwellTimeIncrease * currentMonth.totalVisitors * avgSpendPerMinute)
    : 0;

  // Revenue from more visitors
  const visitorIncrease = currentMonth.totalVisitors - previousMonth.totalVisitors;
  const visitorRevenue = visitorIncrease > 0 
    ? Math.round(visitorIncrease * avgSpendPerVisitor)
    : 0;

  const total = dwellTimeRevenue + visitorRevenue;

  return {
    dwellTimeRevenue,
    visitorRevenue,
    total,
    assumptions: `Based on $${avgSpendPerMinute}/min dwell and $${avgSpendPerVisitor}/visitor avg.`,
  };
}

export default useROITracking;

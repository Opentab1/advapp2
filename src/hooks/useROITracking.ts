/**
 * useROITracking - Tracks and calculates ROI metrics over time
 * 
 * Addresses the "Prove ROI" problem:
 * - Shows improvement since using Pulse
 * - Calculates dwell time, score, and visitor trends
 * - Compares periods (this week vs last, this month vs last)
 * - Estimates revenue impact
 */

import { useState, useEffect, useMemo, useCallback } from 'react';

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
}

export interface UseROITrackingOptions {
  avgSpendPerMinute?: number; // $ spent per minute of dwell time
  avgSpendPerVisitor?: number; // $ per visitor
}

// ============ CONSTANTS ============

// const STORAGE_KEY = 'pulse_roi_history'; // Reserved for future API integration
const DEFAULT_SPEND_PER_MINUTE = 0.50; // $0.50 per minute of dwell
const DEFAULT_SPEND_PER_VISITOR = 25; // $25 per visitor

// ============ MOCK DATA GENERATOR ============
// In production, this would come from API/DynamoDB

function generateMockHistoricalData(): DailyRecord[] {
  const records: DailyRecord[] = [];
  const today = new Date();
  
  // Generate 60 days of mock data
  for (let i = 60; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    
    const dayOfWeek = date.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6;
    
    // Simulate improvement over time (newer = better)
    const improvementFactor = 1 + (60 - i) * 0.003; // 0.3% improvement per day
    
    // Base metrics with some randomness
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

interface DailyRecord {
  date: string;
  avgPulseScore: number;
  avgDwellTime: number;
  visitors: number;
  optimalMinutes: number;
  totalMinutes: number;
}

// ============ MAIN HOOK ============

export function useROITracking(options: UseROITrackingOptions = {}): ROIData & { refresh: () => void } {
  const {
    avgSpendPerMinute = DEFAULT_SPEND_PER_MINUTE,
    avgSpendPerVisitor = DEFAULT_SPEND_PER_VISITOR,
  } = options;

  const [historicalData, setHistoricalData] = useState<DailyRecord[]>([]);
  const [, setLoading] = useState(true);

  // Load historical data
  const loadData = useCallback(() => {
    setLoading(true);
    try {
      // In production, this would be an API call
      // For now, use mock data
      const data = generateMockHistoricalData();
      setHistoricalData(data);
    } catch (e) {
      console.error('Failed to load ROI data:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Calculate all metrics
  const roiData = useMemo((): ROIData => {
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
    };
  }, [historicalData, avgSpendPerMinute, avgSpendPerVisitor]);

  return {
    ...roiData,
    refresh: loadData,
  };
}

// ============ HELPER FUNCTIONS ============

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

  return insights.slice(0, 5); // Limit to top 5 insights
}

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

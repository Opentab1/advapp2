/**
 * useHistoricalComparison - Fetches real historical data for comparisons
 * 
 * For real venues: Fetches from DynamoDB
 * For demo accounts: Uses mock data
 */

import { useState, useEffect, useCallback } from 'react';
import authService from '../services/auth.service';
import apiService from '../services/api.service';
import { isDemoAccount } from '../utils/demoData';
import type { SensorData } from '../types';

// ============ TYPES ============

export interface HistoricalComparisonData {
  // Last week same day
  lastWeekPulseAvg: number | null;
  lastWeekVisitors: number | null;
  lastWeekPeakHour: number | null;
  
  // Historical bests (for this day of week)
  bestPulseScore: number | null;
  bestPulseDate: string | null;
  bestVisitors: number | null;
  bestVisitorsDate: string | null;
  
  // 4-week averages for this day
  avgPulseScore: number | null;
  avgVisitors: number | null;
}

export interface UseHistoricalComparisonReturn {
  data: HistoricalComparisonData | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

// ============ HELPER FUNCTIONS ============

function calculatePulseScore(decibels: number | undefined, light: number | undefined): number {
  const OPTIMAL_SOUND = { min: 70, max: 82 };
  const OPTIMAL_LIGHT = { min: 50, max: 350 };
  
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

function getDateFromDaysAgo(daysAgo: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(0, 0, 0, 0);
  return date;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function generateMockData(dayOfWeek: number): HistoricalComparisonData {
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6;
  const basePulse = isWeekend ? 78 : 68;
  const baseVisitors = isWeekend ? 145 : 85;
  
  return {
    lastWeekPulseAvg: basePulse + Math.floor(Math.random() * 10 - 5),
    lastWeekVisitors: baseVisitors + Math.floor(Math.random() * 30 - 15),
    lastWeekPeakHour: isWeekend ? 22 : 21,
    bestPulseScore: basePulse + 15,
    bestPulseDate: 'Dec 14',
    bestVisitors: baseVisitors + 40,
    bestVisitorsDate: 'Dec 21',
    avgPulseScore: basePulse,
    avgVisitors: baseVisitors,
  };
}

// ============ MAIN HOOK ============

export function useHistoricalComparison(): UseHistoricalComparisonReturn {
  const [data, setData] = useState<HistoricalComparisonData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const user = authService.getStoredUser();
  const venueId = user?.venueId || '';
  const dayOfWeek = new Date().getDay();

  const loadData = useCallback(async () => {
    if (!venueId) {
      setLoading(false);
      return;
    }

    // For demo accounts, use mock data
    if (isDemoAccount(venueId)) {
      await new Promise(r => setTimeout(r, 300)); // Simulate network delay
      setData(generateMockData(dayOfWeek));
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Fetch 14 days of historical data
      const historicalResult = await apiService.getHistoricalData(venueId, '14d');
      const allData = historicalResult?.data || [];

      if (allData.length === 0) {
        // No data available - use null values
        setData({
          lastWeekPulseAvg: null,
          lastWeekVisitors: null,
          lastWeekPeakHour: null,
          bestPulseScore: null,
          bestPulseDate: null,
          bestVisitors: null,
          bestVisitorsDate: null,
          avgPulseScore: null,
          avgVisitors: null,
        });
        setLoading(false);
        return;
      }

      // Group data by day
      const dataByDay = new Map<string, SensorData[]>();
      allData.forEach(item => {
        const date = new Date(item.timestamp).toDateString();
        if (!dataByDay.has(date)) {
          dataByDay.set(date, []);
        }
        dataByDay.get(date)!.push(item);
      });

      // Get last week same day
      const lastWeekDate = getDateFromDaysAgo(7);
      const lastWeekKey = lastWeekDate.toDateString();
      const lastWeekData = dataByDay.get(lastWeekKey) || [];

      // Calculate last week metrics
      let lastWeekPulseAvg: number | null = null;
      let lastWeekVisitors: number | null = null;
      let lastWeekPeakHour: number | null = null;

      if (lastWeekData.length > 0) {
        // Calculate average pulse score
        const pulseScores = lastWeekData.map(d => calculatePulseScore(d.decibels, d.light)).filter(s => s > 0);
        lastWeekPulseAvg = pulseScores.length > 0 
          ? Math.round(pulseScores.reduce((a, b) => a + b, 0) / pulseScores.length) 
          : null;

        // Get visitors from occupancy data
        const maxOccupancy = lastWeekData.reduce((max, d) => {
          const current = d.occupancy?.current || 0;
          return current > max ? current : max;
        }, 0);
        lastWeekVisitors = maxOccupancy > 0 ? maxOccupancy : null;

        // Find peak hour
        const hourlyOccupancy: { [hour: number]: number[] } = {};
        lastWeekData.forEach(d => {
          if (d.occupancy?.current) {
            const hour = new Date(d.timestamp).getHours();
            if (!hourlyOccupancy[hour]) hourlyOccupancy[hour] = [];
            hourlyOccupancy[hour].push(d.occupancy.current);
          }
        });
        
        let peakHour = 21;
        let peakAvg = 0;
        Object.entries(hourlyOccupancy).forEach(([hour, values]) => {
          const avg = values.reduce((a, b) => a + b, 0) / values.length;
          if (avg > peakAvg) {
            peakAvg = avg;
            peakHour = parseInt(hour);
          }
        });
        lastWeekPeakHour = peakHour;
      }

      // Find bests for same day of week across weeks
      let bestPulseScore: number | null = null;
      let bestPulseDate: string | null = null;
      let bestVisitors: number | null = null;
      let bestVisitorsDate: string | null = null;
      let totalPulse = 0;
      let pulseCount = 0;
      let totalVisitors = 0;
      let visitorCount = 0;

      // Look at same day of week for past 4 weeks
      for (let weeksBack = 0; weeksBack <= 3; weeksBack++) {
        const checkDate = getDateFromDaysAgo(weeksBack * 7);
        const checkKey = checkDate.toDateString();
        const dayData = dataByDay.get(checkKey) || [];

        if (dayData.length > 0) {
          // Calculate pulse score for this day
          const pulseScores = dayData.map(d => calculatePulseScore(d.decibels, d.light)).filter(s => s > 0);
          if (pulseScores.length > 0) {
            const dayAvgPulse = Math.round(pulseScores.reduce((a, b) => a + b, 0) / pulseScores.length);
            totalPulse += dayAvgPulse;
            pulseCount++;
            
            if (bestPulseScore === null || dayAvgPulse > bestPulseScore) {
              bestPulseScore = dayAvgPulse;
              bestPulseDate = formatDate(checkDate);
            }
          }

          // Get max visitors for this day
          const maxOccupancy = dayData.reduce((max, d) => {
            const current = d.occupancy?.current || 0;
            return current > max ? current : max;
          }, 0);
          
          if (maxOccupancy > 0) {
            totalVisitors += maxOccupancy;
            visitorCount++;
            
            if (bestVisitors === null || maxOccupancy > bestVisitors) {
              bestVisitors = maxOccupancy;
              bestVisitorsDate = formatDate(checkDate);
            }
          }
        }
      }

      // Calculate averages
      const avgPulseScore = pulseCount > 0 ? Math.round(totalPulse / pulseCount) : null;
      const avgVisitors = visitorCount > 0 ? Math.round(totalVisitors / visitorCount) : null;

      setData({
        lastWeekPulseAvg,
        lastWeekVisitors,
        lastWeekPeakHour,
        bestPulseScore,
        bestPulseDate,
        bestVisitors,
        bestVisitorsDate,
        avgPulseScore,
        avgVisitors,
      });

    } catch (err: any) {
      console.error('Failed to load historical comparison data:', err);
      setError(err.message || 'Failed to load historical data');
      // Still set null data so UI can render gracefully
      setData({
        lastWeekPulseAvg: null,
        lastWeekVisitors: null,
        lastWeekPeakHour: null,
        bestPulseScore: null,
        bestPulseDate: null,
        bestVisitors: null,
        bestVisitorsDate: null,
        avgPulseScore: null,
        avgVisitors: null,
      });
    } finally {
      setLoading(false);
    }
  }, [venueId, dayOfWeek]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return {
    data,
    loading,
    error,
    refresh: loadData,
  };
}

export default useHistoricalComparison;

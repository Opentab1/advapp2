/**
 * History - Analytics and trends page
 * 
 * Shows historical data:
 * - Time range selector
 * - Trend charts (Pulse Score, Occupancy, Sound)
 * - Weekly summary stats
 * - Export functionality
 */

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { BarChart2, Download, RefreshCw } from 'lucide-react';
import { DataChart } from '../components/DataChart';
import { CardSkeleton } from '../components/common/LoadingState';
import { WeeklyComparison } from '../components/history/WeeklyComparison';
import { useWeeklyComparison } from '../hooks/useWeeklyComparison';
import apiService from '../services/api.service';
import authService from '../services/auth.service';
import type { TimeRange, SensorData, HistoricalData } from '../types';

// ============ TIME RANGES ============

const TIME_RANGES: { value: TimeRange; label: string }[] = [
  { value: '24h', label: '24h' },
  { value: '7d', label: '7 Days' },
  { value: '30d', label: '30 Days' },
  { value: '90d', label: '90 Days' },
];

// ============ MAIN COMPONENT ============

export function History() {
  const user = authService.getStoredUser();
  const venueId = user?.venueId || '';
  const venueName = user?.venueName || 'Venue';
  
  const [timeRange, setTimeRange] = useState<TimeRange>('7d');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<HistoricalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Weekly comparison data
  const weeklyComparison = useWeeklyComparison(venueId);
  
  // Fetch data
  const fetchData = useCallback(async () => {
    if (!venueId) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const result = await apiService.getHistoricalData(venueId, timeRange);
      setData(result);
    } catch (err: any) {
      setError(err.message || 'Failed to load historical data');
    } finally {
      setLoading(false);
    }
  }, [venueId, timeRange]);
  
  useEffect(() => {
    fetchData();
  }, [fetchData]);
  
  // Export handler
  const handleExport = () => {
    if (data?.data && data.data.length > 0) {
      apiService.exportToCSV(data.data, true, venueName);
    }
  };
  
  // Calculate summary stats
  const summary = data?.data ? calculateSummary(data.data) : null;
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        className="flex items-center justify-between"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center gap-2">
          <BarChart2 className="w-6 h-6 text-primary" />
          <h1 className="text-xl font-bold text-warm-800 dark:text-warm-100">History</h1>
        </div>
        <div className="flex items-center gap-2">
          <motion.button
            onClick={handleExport}
            disabled={!data?.data?.length}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            whileTap={{ scale: 0.95 }}
          >
            <Download className="w-4 h-4" />
            Export
          </motion.button>
          <motion.button
            onClick={fetchData}
            disabled={loading}
            className="p-2 rounded-xl bg-warm-100 dark:bg-warm-800 hover:bg-warm-200 dark:hover:bg-warm-700 transition-colors"
            whileTap={{ scale: 0.95 }}
          >
            <RefreshCw className={`w-5 h-5 text-warm-600 dark:text-warm-400 ${loading ? 'animate-spin' : ''}`} />
          </motion.button>
        </div>
      </motion.div>
      
      {/* Time Range Selector */}
      <motion.div
        className="flex gap-2"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
      >
        {TIME_RANGES.map((range) => (
          <button
            key={range.value}
            onClick={() => setTimeRange(range.value)}
            className={`
              px-4 py-2 rounded-xl text-sm font-medium transition-colors
              ${timeRange === range.value
                ? 'bg-primary text-white'
                : 'bg-warm-100 dark:bg-warm-800 text-warm-600 dark:text-warm-300 hover:bg-warm-200 dark:hover:bg-warm-700'
              }
            `}
          >
            {range.label}
          </button>
        ))}
      </motion.div>
      
      {/* Weekly Comparison (show when 7d selected) */}
      {timeRange === '7d' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
        >
          <WeeklyComparison
            thisWeek={weeklyComparison.thisWeek}
            lastWeek={weeklyComparison.lastWeek}
            loading={weeklyComparison.loading}
          />
        </motion.div>
      )}
      
      {/* Error State */}
      {error && (
        <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400">
          <p className="font-medium">Error loading data</p>
          <p className="text-sm mt-1">{error}</p>
        </div>
      )}
      
      {/* Loading State */}
      {loading && !data && (
        <div className="space-y-4">
          <CardSkeleton height="h-64" />
          <CardSkeleton height="h-64" />
        </div>
      )}
      
      {/* Charts */}
      {data?.data && data.data.length > 0 && (
        <motion.div
          className="space-y-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
        >
          {/* Occupancy Chart */}
          <div className="bg-white dark:bg-warm-800 rounded-2xl border border-warm-200 dark:border-warm-700 p-4 transition-colors">
            <h3 className="text-base font-semibold text-warm-800 dark:text-warm-100 mb-4">Occupancy</h3>
            <DataChart
              data={data.data}
              metric="occupancy"
              title=""
              color="#22C55E"
            />
          </div>
          
          {/* Sound Chart */}
          <div className="bg-white dark:bg-warm-800 rounded-2xl border border-warm-200 dark:border-warm-700 p-4 transition-colors">
            <h3 className="text-base font-semibold text-warm-800 dark:text-warm-100 mb-4">Sound Level</h3>
            <DataChart
              data={data.data}
              metric="decibels"
              title=""
              color="#0077B6"
            />
          </div>
          
          {/* Light Chart */}
          <div className="bg-white dark:bg-warm-800 rounded-2xl border border-warm-200 dark:border-warm-700 p-4 transition-colors">
            <h3 className="text-base font-semibold text-warm-800 dark:text-warm-100 mb-4">Light Level</h3>
            <DataChart
              data={data.data}
              metric="light"
              title=""
              color="#F59E0B"
            />
          </div>
        </motion.div>
      )}
      
      {/* Summary Stats */}
      {summary && (
        <motion.div
          className="bg-white dark:bg-warm-800 rounded-2xl border border-warm-200 dark:border-warm-700 p-4 transition-colors"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          <h3 className="text-base font-semibold text-warm-800 dark:text-warm-100 mb-4">
            {timeRange === '24h' ? 'Today' : timeRange === '7d' ? 'This Week' : 'Period'} Summary
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <SummaryCard label="Total Visitors" value={summary.totalVisitors.toLocaleString()} />
            <SummaryCard label="Peak Occupancy" value={summary.peakOccupancy.toString()} />
            <SummaryCard label="Avg Sound" value={`${summary.avgSound.toFixed(0)} dB`} />
            <SummaryCard label="Data Points" value={summary.dataPoints.toLocaleString()} />
          </div>
        </motion.div>
      )}
      
      {/* No Data State */}
      {!loading && (!data?.data || data.data.length === 0) && !error && (
        <div className="text-center py-12">
          <BarChart2 className="w-12 h-12 text-warm-300 dark:text-warm-600 mx-auto mb-3" />
          <p className="text-warm-600 dark:text-warm-300 font-medium">No data for this period</p>
          <p className="text-sm text-warm-500 dark:text-warm-400 mt-1">
            Try selecting a different time range.
          </p>
        </div>
      )}
    </div>
  );
}

// ============ SUMMARY CALCULATION ============

interface Summary {
  totalVisitors: number;
  peakOccupancy: number;
  avgSound: number;
  dataPoints: number;
}

function calculateSummary(data: SensorData[]): Summary {
  let totalVisitors = 0;
  let peakOccupancy = 0;
  let totalSound = 0;
  let soundCount = 0;
  
  // Group by day to get max entries per day
  const dailyEntries = new Map<string, number>();
  
  data.forEach((item) => {
    const date = new Date(item.timestamp).toDateString();
    
    // Track max entries per day
    if (item.occupancy?.entries) {
      const current = dailyEntries.get(date) || 0;
      dailyEntries.set(date, Math.max(current, item.occupancy.entries));
    }
    
    // Track peak occupancy
    if (item.occupancy?.current && item.occupancy.current > peakOccupancy) {
      peakOccupancy = item.occupancy.current;
    }
    
    // Track sound average
    if (item.decibels) {
      totalSound += item.decibels;
      soundCount++;
    }
  });
  
  // Sum daily entries
  dailyEntries.forEach((entries) => {
    totalVisitors += entries;
  });
  
  return {
    totalVisitors,
    peakOccupancy,
    avgSound: soundCount > 0 ? totalSound / soundCount : 0,
    dataPoints: data.length,
  };
}

// ============ SUMMARY CARD ============

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 rounded-xl bg-warm-50 dark:bg-warm-700/50 transition-colors">
      <p className="text-xs text-warm-500 dark:text-warm-400 mb-1">{label}</p>
      <p className="text-lg font-bold text-warm-800 dark:text-warm-100">{value}</p>
    </div>
  );
}

export default History;

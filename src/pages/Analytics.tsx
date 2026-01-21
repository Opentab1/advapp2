/**
 * Analytics Page - Results Report
 * 
 * This is where bar owners come to see RESULTS.
 * Not abstract scores - real numbers with context.
 * 
 * Structure:
 * 1. Period Summary - Total guests, avg stay, peak hours
 * 2. Daily Breakdown - Table with each day's performance
 * 3. Hourly Heatmap - Visual of busy hours
 * 4. Guest Trend - Line chart over time
 * 5. Environment Summary - Sound, light, crowd conditions
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, Download, Calendar } from 'lucide-react';
import {
  PeriodSummary,
  DailyBreakdown,
  HourlyHeatmap,
  EnvironmentalSummary,
  GuestsTrend,
  TimeRangePicker,
  RawDataView,
} from '../components/analytics';
import { PullToRefresh } from '../components/common/PullToRefresh';
import { ErrorState } from '../components/common/LoadingState';
import { useInsightsData } from '../hooks/useInsightsData';
import { useDisplayName } from '../hooks/useDisplayName';
import apiService from '../services/api.service';
import authService from '../services/auth.service';
import { haptic } from '../utils/haptics';
import type { InsightsTimeRange, MetricType } from '../types/insights';

export function Analytics() {
  const user = authService.getStoredUser();
  const { displayName } = useDisplayName();
  const venueName = displayName || user?.venueName || 'Venue';
  
  const [timeRange, setTimeRange] = useState<InsightsTimeRange>('7d');
  const [showRawData, setShowRawData] = useState(false);
  const [rawDataMetric, setRawDataMetric] = useState<MetricType>('score');
  
  const insights = useInsightsData(timeRange);
  
  // Get raw sensor data for the detailed components
  const rawSensorData = insights.rawData.map(d => ({
    timestamp: d.timestamp.toISOString(),
    decibels: d.decibels,
    light: d.light,
    indoorTemp: d.temperature,
    outdoorTemp: d.temperature,
    occupancy: {
      current: d.occupancy,
      entries: 0, // Not available in RawDataPoint
      exits: 0,
    },
  }));
  
  const handleRefresh = async () => {
    haptic('medium');
    await insights.refresh();
  };
  
  const handleExportCSV = () => {
    haptic('medium');
    if (insights.rawData.length > 0) {
      const exportData = insights.rawData.map(d => ({
        timestamp: d.timestamp.toISOString(),
        score: d.score,
        decibels: d.decibels,
        light: d.light,
        temperature: d.temperature,
        occupancy: d.occupancy,
      }));
      apiService.exportToCSV(exportData as any, true, venueName);
    }
  };
  
  if (insights.error && !insights.summary) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-white">Results</h1>
          <TimeRangePicker value={timeRange} onChange={setTimeRange} loading={insights.loading} />
        </div>
        <ErrorState 
          title="Couldn't load data" 
          message={insights.error} 
          onRetry={handleRefresh} 
        />
      </div>
    );
  }
  
  return (
    <>
      <PullToRefresh onRefresh={handleRefresh} disabled={insights.loading}>
        <div className="space-y-6 pb-24">
          
          {/* Header */}
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-white">Results</h1>
            
            <div className="flex items-center gap-2">
              {/* Refresh */}
              <motion.button
                onClick={handleRefresh}
                disabled={insights.loading}
                className="p-2 rounded-lg bg-warm-800 border border-warm-700 text-warm-400 hover:text-white transition-colors"
                whileTap={{ scale: 0.95 }}
                title="Refresh"
              >
                <RefreshCw className={`w-4 h-4 ${insights.loading ? 'animate-spin' : ''}`} />
              </motion.button>
              
              {/* Export */}
              <motion.button
                onClick={handleExportCSV}
                disabled={insights.loading || insights.rawData.length === 0}
                className="p-2 rounded-lg bg-warm-800 border border-warm-700 text-warm-400 hover:text-white transition-colors disabled:opacity-50"
                whileTap={{ scale: 0.95 }}
                title="Export CSV"
              >
                <Download className="w-4 h-4" />
              </motion.button>
              
              {/* Raw Data */}
              <motion.button
                onClick={() => { haptic('light'); setShowRawData(true); }}
                disabled={insights.loading}
                className="p-2 rounded-lg bg-warm-800 border border-warm-700 text-warm-400 hover:text-white transition-colors"
                whileTap={{ scale: 0.95 }}
                title="View Raw Data"
              >
                <Calendar className="w-4 h-4" />
              </motion.button>
            </div>
          </div>
          
          {/* Time Range Picker */}
          <TimeRangePicker 
            value={timeRange} 
            onChange={setTimeRange} 
            loading={insights.loading} 
          />
          
          {/* Period Summary - THE NUMBERS */}
          <PeriodSummary 
            summary={insights.summary}
            trend={insights.trend}
            timeRange={timeRange}
            loading={insights.loading}
          />
          
          {/* Guest Trend Chart */}
          <GuestsTrend 
            data={rawSensorData as any}
            loading={insights.loading}
          />
          
          {/* Daily Breakdown Table */}
          <DailyBreakdown 
            data={rawSensorData as any}
            loading={insights.loading}
          />
          
          {/* Hourly Heatmap */}
          <HourlyHeatmap 
            data={rawSensorData as any}
            loading={insights.loading}
          />
          
          {/* Environmental Summary */}
          <EnvironmentalSummary 
            data={rawSensorData as any}
            loading={insights.loading}
          />
          
        </div>
      </PullToRefresh>
      
      {/* Raw Data View Modal */}
      {showRawData && (
        <RawDataView 
          isOpen 
          onClose={() => setShowRawData(false)} 
          data={insights.rawData} 
          timeRange={timeRange} 
          onTimeRangeChange={setTimeRange} 
          initialMetric={rawDataMetric} 
          onExport={handleExportCSV} 
        />
      )}
    </>
  );
}

export default Analytics;

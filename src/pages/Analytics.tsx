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
import { RefreshCw, Download, Calendar, Clock, Music, Volume2, Users, TrendingUp, TrendingDown } from 'lucide-react';
import {
  PeriodSummary,
  DailyBreakdown,
  RawMetrics,
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
import { isDemoAccount } from '../utils/demoData';
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
          
          {/* Historical Retention Analysis - Demo Only */}
          {isDemoAccount(user?.venueId || '') && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-warm-800/50 rounded-xl p-5 border border-warm-700"
            >
              <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <Clock className="w-5 h-5 text-primary" />
                Guest Retention Analysis
              </h2>
              
              {/* Time Period Selector */}
              <div className="flex gap-2 mb-5 overflow-x-auto pb-2">
                {['Last Saturday 8PM', 'Last Friday 10PM', 'Last Saturday 11PM', 'Last Sunday 6PM'].map((period, idx) => (
                  <button
                    key={period}
                    className={`px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-all ${
                      idx === 0 
                        ? 'bg-primary text-white' 
                        : 'bg-warm-700 text-warm-300 hover:bg-warm-600'
                    }`}
                  >
                    {period}
                  </button>
                ))}
              </div>
              
              {/* Retention Stats Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
                <div className="bg-warm-700/50 rounded-lg p-4 text-center">
                  <div className="text-3xl font-bold text-primary">78%</div>
                  <div className="text-xs text-warm-400 mt-1">Retention Rate</div>
                  <div className="flex items-center justify-center gap-1 mt-2 text-green-400 text-xs">
                    <TrendingUp className="w-3 h-3" />
                    <span>+5% vs avg</span>
                  </div>
                </div>
                <div className="bg-warm-700/50 rounded-lg p-4 text-center">
                  <div className="text-3xl font-bold text-white">342</div>
                  <div className="text-xs text-warm-400 mt-1">Total Guests</div>
                  <div className="flex items-center justify-center gap-1 mt-2 text-green-400 text-xs">
                    <TrendingUp className="w-3 h-3" />
                    <span>+12% vs week prior</span>
                  </div>
                </div>
                <div className="bg-warm-700/50 rounded-lg p-4 text-center">
                  <div className="text-3xl font-bold text-white">94</div>
                  <div className="text-xs text-warm-400 mt-1">Avg Stay (min)</div>
                  <div className="flex items-center justify-center gap-1 mt-2 text-warm-400 text-xs">
                    <span>Target: 90 min</span>
                  </div>
                </div>
                <div className="bg-warm-700/50 rounded-lg p-4 text-center">
                  <div className="text-3xl font-bold text-white">$58</div>
                  <div className="text-xs text-warm-400 mt-1">Avg Spend/Guest</div>
                  <div className="flex items-center justify-center gap-1 mt-2 text-green-400 text-xs">
                    <TrendingUp className="w-3 h-3" />
                    <span>+$4 vs avg</span>
                  </div>
                </div>
              </div>
              
              {/* Sound & Music Section */}
              <div className="border-t border-warm-600 pt-4 mt-4">
                <h3 className="text-sm font-semibold text-warm-300 mb-3 flex items-center gap-2">
                  <Volume2 className="w-4 h-4" />
                  Sound Profile That Night
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-warm-700/30 rounded-lg p-3">
                    <div className="text-xl font-bold text-white">76 dB</div>
                    <div className="text-xs text-warm-400">Avg Sound Level</div>
                    <div className="text-[10px] text-warm-500 mt-1">Optimal range: 70-80 dB</div>
                  </div>
                  <div className="bg-warm-700/30 rounded-lg p-3">
                    <div className="text-xl font-bold text-white">85 dB</div>
                    <div className="text-xs text-warm-400">Peak at 11:30 PM</div>
                    <div className="text-[10px] text-warm-500 mt-1">During DJ set</div>
                  </div>
                </div>
              </div>
              
              {/* Top Songs Section */}
              <div className="border-t border-warm-600 pt-4 mt-4">
                <h3 className="text-sm font-semibold text-warm-300 mb-3 flex items-center gap-2">
                  <Music className="w-4 h-4" />
                  Top Songs That Night
                </h3>
                <div className="space-y-2">
                  {[
                    { song: 'Ms. Jackson', artist: 'Outkast', plays: 3, peakCrowd: true },
                    { song: 'Blinding Lights', artist: 'The Weeknd', plays: 2, peakCrowd: false },
                    { song: 'Levitating', artist: 'Dua Lipa', plays: 2, peakCrowd: true },
                    { song: 'Uptown Funk', artist: 'Bruno Mars', plays: 2, peakCrowd: false },
                    { song: 'Don\'t Start Now', artist: 'Dua Lipa', plays: 1, peakCrowd: true },
                  ].map((track, idx) => (
                    <div key={idx} className="flex items-center justify-between bg-warm-700/30 rounded-lg px-3 py-2">
                      <div className="flex items-center gap-3">
                        <span className="text-warm-500 text-sm w-5">{idx + 1}</span>
                        <div>
                          <div className="text-sm text-white">{track.song}</div>
                          <div className="text-xs text-warm-400">{track.artist}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {track.peakCrowd && (
                          <span className="text-[10px] bg-green-500/20 text-green-400 px-2 py-0.5 rounded">Peak Crowd</span>
                        )}
                        <span className="text-xs text-warm-400">{track.plays}x</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              
              {/* Insight */}
              <div className="bg-primary/10 border border-primary/20 rounded-lg p-4 mt-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                    <TrendingUp className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-white">Key Insight</div>
                    <div className="text-xs text-warm-300 mt-1">
                      When Outkast and Dua Lipa played during peak hours, guest retention increased by 23%. 
                      Consider scheduling similar high-energy tracks between 10-11 PM on Saturdays.
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
          
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
          
          {/* Raw Metrics - entries, exits, dB, lux, score, top songs */}
          <RawMetrics 
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

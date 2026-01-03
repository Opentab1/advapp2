/**
 * SmartHeader - Context-aware page header
 * 
 * Replaces basic header with:
 * - Time-based greeting
 * - Today's type (Friday Night, etc.)
 * - Peak countdown
 * - Weather snippet
 */

import { motion } from 'framer-motion';
import { Zap, RefreshCw, FileText, Clock, CloudSun, TrendingUp } from 'lucide-react';
import type { DailyBriefing, PeakPrediction } from '../../services/intelligence.service';
import { haptic } from '../../utils/haptics';

interface SmartHeaderProps {
  briefing: DailyBriefing | null;
  peakPrediction: PeakPrediction | null;
  weather?: { temperature: number; icon: string } | null;
  loading: boolean;
  onRefresh: () => void;
  onReportTap: () => void;
}

export function SmartHeader({
  briefing,
  peakPrediction,
  weather,
  loading,
  onRefresh,
  onReportTap,
}: SmartHeaderProps) {
  const now = new Date();
  const currentHour = now.getHours();
  
  // Calculate hours until peak
  const hoursUntilPeak = peakPrediction 
    ? (peakPrediction.predictedPeakHour - currentHour + 24) % 24
    : null;
  const isPeakNow = hoursUntilPeak === 0;
  const isPeakSoon = hoursUntilPeak !== null && hoursUntilPeak > 0 && hoursUntilPeak <= 2;
  
  // Fallback greeting if no briefing
  const greeting = briefing?.greeting || getDefaultGreeting(currentHour);
  const todayType = briefing?.todayType || getDayType();
  
  return (
    <motion.div
      className="space-y-3"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Top row: Title + Actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="w-6 h-6 text-primary" />
          <h1 className="text-xl font-bold text-warm-100">Pulse</h1>
        </div>
        <div className="flex items-center gap-2">
          <motion.button
            onClick={() => { haptic('light'); onReportTap(); }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary/20 text-primary text-sm font-medium hover:bg-primary/30 transition-colors"
            whileTap={{ scale: 0.95 }}
          >
            <FileText className="w-4 h-4" />
            <span className="hidden sm:inline">Report</span>
          </motion.button>
          <motion.button
            onClick={() => { haptic('light'); onRefresh(); }}
            disabled={loading}
            className="p-2 rounded-xl bg-warm-800 hover:bg-warm-700 transition-colors"
            whileTap={{ scale: 0.95 }}
          >
            <RefreshCw className={`w-5 h-5 text-warm-400 ${loading ? 'animate-spin' : ''}`} />
          </motion.button>
        </div>
      </div>
      
      {/* Context row: Greeting + Peak + Weather */}
      <div className="flex items-center justify-between p-3 rounded-xl bg-warm-800/50 border border-warm-700/50">
        {/* Greeting */}
        <div className="flex-1">
          <p className="text-sm text-warm-400">{greeting}</p>
          <p className="text-base font-semibold text-warm-100">{todayType}</p>
        </div>
        
        {/* Peak countdown */}
        {peakPrediction && (
          <div className="flex items-center gap-4">
            {isPeakNow ? (
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-500/20 border border-red-500/30">
                <TrendingUp className="w-4 h-4 text-red-400" />
                <span className="text-sm font-medium text-red-400">Peak NOW</span>
              </div>
            ) : isPeakSoon ? (
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/30">
                <Clock className="w-4 h-4 text-amber-400" />
                <span className="text-sm font-medium text-amber-400">
                  Peak in {hoursUntilPeak}h
                </span>
              </div>
            ) : hoursUntilPeak !== null && hoursUntilPeak < 6 ? (
              <div className="text-right">
                <p className="text-[10px] text-warm-500 uppercase">Peak</p>
                <p className="text-sm font-medium text-warm-200">
                  {formatHour(peakPrediction.predictedPeakHour)}
                </p>
              </div>
            ) : null}
            
            {/* Weather */}
            {weather && (
              <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-warm-700/50">
                <span className="text-base">{weather.icon}</span>
                <span className="text-sm font-medium text-warm-200">
                  {Math.round(weather.temperature)}°
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ============ HELPERS ============

function getDefaultGreeting(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function getDayType(): string {
  const day = new Date().getDay();
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  
  if (day === 5) return 'Friday Night';
  if (day === 6) return 'Saturday Night';
  if (day === 0) return 'Sunday Funday';
  return `${dayNames[day]} Evening`;
}

function formatHour(hour: number): string {
  if (hour === 0) return '12am';
  if (hour === 12) return '12pm';
  if (hour < 12) return `${hour}am`;
  return `${hour - 12}pm`;
}

export default SmartHeader;

/**
 * SmartHeader - Context-aware page header
 * 
 * Replaces basic header with:
 * - Time-based greeting
 * - Today's type (Friday Night, etc.)
 * - Peak countdown
 * - Weather snippet
 * 
 * Action buttons moved to FloatingActions (FAB)
 */

import { motion } from 'framer-motion';
import { Zap, Clock, TrendingUp } from 'lucide-react';
import type { DailyBriefing, PeakPrediction } from '../../services/intelligence.service';

interface SmartHeaderProps {
  briefing: DailyBriefing | null;
  peakPrediction: PeakPrediction | null;
  weather?: { temperature: number; icon: string } | null;
}

export function SmartHeader({
  briefing,
  peakPrediction,
  weather,
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
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Combined header: Title + Greeting + Context */}
      <div className="flex items-center justify-between p-3 rounded-xl bg-warm-800/50 border border-warm-700/50">
        {/* Left: Logo + Greeting */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
            <Zap className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="text-xs text-warm-400">{greeting}</p>
            <p className="text-base font-semibold text-warm-100">{todayType}</p>
          </div>
        </div>
        
        {/* Right: Peak + Weather */}
        <div className="flex items-center gap-3">
          {/* Peak countdown */}
          {peakPrediction && (
            <>
              {isPeakNow ? (
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-500/20 border border-red-500/30">
                  <TrendingUp className="w-4 h-4 text-red-400" />
                  <span className="text-xs font-medium text-red-400">Peak NOW</span>
                </div>
              ) : isPeakSoon ? (
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/30">
                  <Clock className="w-4 h-4 text-amber-400" />
                  <span className="text-xs font-medium text-amber-400">
                    {hoursUntilPeak}h to peak
                  </span>
                </div>
              ) : hoursUntilPeak !== null && hoursUntilPeak < 8 ? (
                <div className="text-right hidden sm:block">
                  <p className="text-[10px] text-warm-500">Peak</p>
                  <p className="text-xs font-medium text-warm-200">
                    {formatHour(peakPrediction.predictedPeakHour)}
                  </p>
                </div>
              ) : null}
            </>
          )}
          
          {/* Weather */}
          {weather && (
            <div className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-warm-700/50">
              <span className="text-sm">{weather.icon}</span>
              <span className="text-xs font-medium text-warm-200">
                {Math.round(weather.temperature)}°
              </span>
            </div>
          )}
        </div>
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

/**
 * DailyBriefing - Morning/evening summary card
 * 
 * Shows:
 * - Personalized greeting
 * - Today's type (Friday Night, etc.)
 * - Peak prediction
 * - Key insights
 * - Weather impact
 */

import { motion } from 'framer-motion';
import { Sunrise, Clock, TrendingUp, CloudSun, Sparkles, ChevronRight } from 'lucide-react';
import type { DailyBriefing as DailyBriefingType } from '../../services/intelligence.service';
import { haptic } from '../../utils/haptics';

interface DailyBriefingProps {
  briefing: DailyBriefingType;
  onTap?: () => void;
  compact?: boolean;
}

export function DailyBriefing({ briefing, onTap, compact = false }: DailyBriefingProps) {
  const handleTap = () => {
    if (onTap) {
      haptic('light');
      onTap();
    }
  };
  
  if (compact) {
    return (
      <motion.div
        className="bg-gradient-to-br from-primary/20 to-primary/5 rounded-2xl border border-primary/30 p-4 cursor-pointer"
        onClick={handleTap}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        whileTap={{ scale: 0.98 }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold text-warm-100">{briefing.todayType}</p>
              <p className="text-xs text-warm-400">
                Peak expected ~{formatHour(briefing.expectedPeak.predictedPeakHour)}
              </p>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-warm-400" />
        </div>
      </motion.div>
    );
  }
  
  return (
    <motion.div
      className="bg-warm-800 rounded-2xl border border-warm-700 overflow-hidden"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Header */}
      <div className="bg-gradient-to-r from-primary/20 to-transparent p-4 border-b border-warm-700">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center">
            <Sunrise className="w-6 h-6 text-primary" />
          </div>
          <div>
            <p className="text-lg font-bold text-warm-100">{briefing.greeting}</p>
            <p className="text-sm text-primary font-medium">{briefing.todayType}</p>
          </div>
        </div>
      </div>
      
      {/* Content */}
      <div className="p-4 space-y-4">
        {/* Peak Prediction */}
        <div className="flex items-center gap-3 p-3 rounded-xl bg-warm-700/50">
          <Clock className="w-5 h-5 text-amber-400" />
          <div className="flex-1">
            <p className="text-sm font-medium text-warm-100">
              Peak expected at {formatHour(briefing.expectedPeak.predictedPeakHour)}
            </p>
            <p className="text-xs text-warm-400">
              ~{briefing.expectedPeak.predictedPeakOccupancy} guests
              {briefing.expectedPeak.confidence >= 70 && ' • High confidence'}
            </p>
          </div>
          {briefing.expectedPeak.comparisonToLastWeek && (
            <span className={`text-xs font-medium px-2 py-1 rounded-full ${
              briefing.expectedPeak.comparisonToLastWeek.difference.startsWith('+')
                ? 'bg-green-900/30 text-green-400'
                : 'bg-red-900/30 text-red-400'
            }`}>
              {briefing.expectedPeak.comparisonToLastWeek.difference}
            </span>
          )}
        </div>
        
        {/* Key Insights */}
        {briefing.keyInsights.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-warm-400 uppercase tracking-wide">
              Key Insights
            </p>
            {briefing.keyInsights.slice(0, 3).map((insight, i) => (
              <motion.div
                key={i}
                className="flex items-start gap-2 text-sm text-warm-300"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.1 }}
              >
                <TrendingUp className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                <span>{insight}</span>
              </motion.div>
            ))}
          </div>
        )}
        
        {/* Weather Impact */}
        {briefing.weatherImpact && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-blue-900/20 border border-blue-900/30">
            <CloudSun className="w-5 h-5 text-blue-400 flex-shrink-0" />
            <p className="text-sm text-blue-300">{briefing.weatherImpact}</p>
          </div>
        )}
        
        {/* Suggested Focus */}
        <div className="pt-2 border-t border-warm-700">
          <p className="text-xs text-warm-500">Today's Focus</p>
          <p className="text-sm font-medium text-primary">{briefing.suggestedFocus}</p>
        </div>
      </div>
    </motion.div>
  );
}

function formatHour(hour: number): string {
  if (hour === 0) return '12am';
  if (hour === 12) return '12pm';
  if (hour < 12) return `${hour}am`;
  return `${hour - 12}pm`;
}

export default DailyBriefing;

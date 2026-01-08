/**
 * DailyContext - The "Header" content moved into the page flow
 * 
 * Shows:
 * - Date (e.g. "Thursday 8th Jan") - Now on the LEFT
 * - Weather (Icon + Temp) - Now on the RIGHT
 * - Peak Prediction (Text only) - Next to weather
 */

import { motion } from 'framer-motion';
import { TrendingUp } from 'lucide-react';

interface DailyContextProps {
  weather?: { temperature: number; icon: string } | null;
  peakPrediction?: {
    hour: string;
    expectedOccupancy: number;
    minutesUntil: number;
  };
}

export function DailyContext({ weather, peakPrediction }: DailyContextProps) {
  // Format: "Thursday 8th Jan"
  const getDateString = () => {
    const now = new Date();
    const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
    const day = now.getDate();
    const month = now.toLocaleDateString('en-US', { month: 'short' });
    
    // Add ordinal suffix
    const suffix = (d: number) => {
      if (d > 3 && d < 21) return 'th';
      switch (d % 10) {
        case 1:  return "st";
        case 2:  return "nd";
        case 3:  return "rd";
        default: return "th";
      }
    };

    return `${weekday} ${day}${suffix(day)} ${month}`;
  };

  return (
    <motion.div 
      className="mb-6 flex items-center justify-between"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Left: Date */}
      <h2 className="text-xl font-medium text-warm-200">
        {getDateString()}
      </h2>

      {/* Right: Context (Weather + Peak) */}
      <div className="flex items-center gap-3">
        {/* Peak Info */}
        {peakPrediction && peakPrediction.minutesUntil > 0 && peakPrediction.minutesUntil < 180 && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-900/20 border border-amber-500/20">
            <TrendingUp className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-xs font-medium text-amber-400">Peak in {Math.ceil(peakPrediction.minutesUntil / 60)}h</span>
          </div>
        )}

        {/* Weather */}
        {weather && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-warm-800/50 border border-warm-700/50">
            <span className="text-base leading-none">{weather.icon}</span>
            <span className="text-xs font-medium text-warm-200">{Math.round(weather.temperature)}°</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default DailyContext;

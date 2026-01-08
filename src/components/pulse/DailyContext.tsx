/**
 * DailyContext - The "Header" content moved into the page flow
 * 
 * Shows:
 * - Weather (Icon + Temp)
 * - Peak Prediction (Text only)
 * 
 * Removed Greeting/Date since that is now in the main Header.
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
  // If no weather/peak info, don't render anything to save space
  if (!weather && !peakPrediction) return null;

  return (
    <motion.div 
      className="mb-6 flex items-center justify-end gap-3"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Weather */}
      {weather && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-warm-800/50 border border-warm-700/50">
          <span className="text-base leading-none">{weather.icon}</span>
          <span className="text-xs font-medium text-warm-200">{Math.round(weather.temperature)}°</span>
        </div>
      )}
      
      {/* Peak Info */}
      {peakPrediction && peakPrediction.minutesUntil > 0 && peakPrediction.minutesUntil < 180 && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-900/20 border border-amber-500/20">
          <TrendingUp className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-xs font-medium text-amber-400">Peak in {Math.ceil(peakPrediction.minutesUntil / 60)}h</span>
        </div>
      )}
    </motion.div>
  );
}

export default DailyContext;

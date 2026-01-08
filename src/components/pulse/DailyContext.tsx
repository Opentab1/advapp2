/**
 * DailyContext - The "Header" content moved into the page flow
 * 
 * Shows:
 * - Greeting ("Good Evening")
 * - Date ("Friday, Jan 8")
 * - Weather (Icon + Temp)
 * - Peak Prediction (Text only)
 * 
 * Designed to be clean text, sitting just above the main content.
 */

import { motion } from 'framer-motion';
import { Cloud, TrendingUp } from 'lucide-react';

interface DailyContextProps {
  weather?: { temperature: number; icon: string } | null;
  peakPrediction?: {
    hour: string;
    expectedOccupancy: number;
    minutesUntil: number;
  };
}

export function DailyContext({ weather, peakPrediction }: DailyContextProps) {
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const getDate = () => {
    return new Date().toLocaleDateString('en-US', { 
      weekday: 'long', 
      month: 'short', 
      day: 'numeric' 
    });
  };

  return (
    <motion.div 
      className="mb-6 flex items-end justify-between"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div>
        <h2 className="text-xl font-bold text-warm-100 leading-tight">
          {getGreeting()}
        </h2>
        <p className="text-sm font-medium text-warm-400 mt-0.5">
          {getDate()}
        </p>
      </div>

      <div className="flex flex-col items-end gap-1">
        {/* Weather */}
        {weather && (
          <div className="flex items-center gap-1.5 text-warm-300">
            <span className="text-base">{weather.icon}</span>
            <span className="text-sm font-medium">{Math.round(weather.temperature)}°</span>
          </div>
        )}
        
        {/* Peak Info (Subtle) */}
        {peakPrediction && peakPrediction.minutesUntil > 0 && peakPrediction.minutesUntil < 180 && (
          <div className="flex items-center gap-1.5 text-xs font-medium text-amber-400/90">
            <TrendingUp className="w-3 h-3" />
            <span>Peak in {Math.ceil(peakPrediction.minutesUntil / 60)}h</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default DailyContext;

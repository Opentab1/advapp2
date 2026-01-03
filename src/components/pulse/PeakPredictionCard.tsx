/**
 * PeakPredictionCard - Predict tonight's peak hour
 * 
 * Shows:
 * - Predicted peak time
 * - Expected occupancy
 * - Comparison to last week
 * - Confidence level
 */

import { motion } from 'framer-motion';
import { TrendingUp, Clock, Users, BarChart2, ChevronUp, ChevronDown } from 'lucide-react';
import type { PeakPrediction } from '../../services/intelligence.service';

interface PeakPredictionCardProps {
  prediction: PeakPrediction;
  currentHour?: number;
}

export function PeakPredictionCard({ prediction, currentHour }: PeakPredictionCardProps) {
  const now = currentHour ?? new Date().getHours();
  const hoursUntilPeak = (prediction.predictedPeakHour - now + 24) % 24;
  const isPeakNow = hoursUntilPeak === 0;
  const isPeakSoon = hoursUntilPeak > 0 && hoursUntilPeak <= 2;
  const isPeakPassed = prediction.predictedPeakHour < now;
  
  const comparison = prediction.comparisonToLastWeek;
  const isUp = comparison?.difference.startsWith('+');
  
  return (
    <motion.div
      className="bg-warm-800 rounded-2xl border border-warm-700 overflow-hidden"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-warm-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart2 className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold text-warm-100">Peak Prediction</h3>
        </div>
        <div className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full ${
          prediction.confidence >= 80 ? 'bg-green-900/30 text-green-400' :
          prediction.confidence >= 60 ? 'bg-amber-900/30 text-amber-400' :
          'bg-warm-700 text-warm-400'
        }`}>
          <span>{prediction.confidence}% confidence</span>
        </div>
      </div>
      
      {/* Main content */}
      <div className="p-4">
        <div className="flex items-center gap-4">
          {/* Peak time */}
          <div className="flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-warm-100">
                {formatHour(prediction.predictedPeakHour)}
              </span>
              {isPeakNow && (
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 animate-pulse">
                  NOW
                </span>
              )}
              {isPeakSoon && (
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400">
                  in {hoursUntilPeak}h
                </span>
              )}
              {isPeakPassed && !isPeakNow && (
                <span className="text-xs text-warm-500">passed</span>
              )}
            </div>
            <p className="text-sm text-warm-400 mt-1">Expected peak time</p>
          </div>
          
          {/* Expected crowd */}
          <div className="text-right">
            <div className="flex items-center justify-end gap-1">
              <Users className="w-4 h-4 text-warm-400" />
              <span className="text-2xl font-bold text-warm-100">
                {prediction.predictedPeakOccupancy}
              </span>
            </div>
            <p className="text-sm text-warm-400">guests</p>
          </div>
        </div>
        
        {/* Comparison to last week */}
        {comparison && (
          <div className={`mt-4 p-3 rounded-xl flex items-center justify-between ${
            isUp ? 'bg-green-900/20 border border-green-800/30' : 'bg-red-900/20 border border-red-800/30'
          }`}>
            <div className="flex items-center gap-2">
              {isUp ? (
                <ChevronUp className="w-4 h-4 text-green-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-red-400" />
              )}
              <span className={`text-sm font-medium ${isUp ? 'text-green-400' : 'text-red-400'}`}>
                {comparison.difference}
              </span>
            </div>
            <span className="text-xs text-warm-400">
              Last week peaked at {comparison.lastWeekPeak}
            </span>
          </div>
        )}
        
        {/* Time until peak */}
        {!isPeakPassed && !isPeakNow && (
          <div className="mt-4 flex items-center gap-2 text-sm text-warm-400">
            <Clock className="w-4 h-4" />
            <span>{hoursUntilPeak} {hoursUntilPeak === 1 ? 'hour' : 'hours'} until peak</span>
          </div>
        )}
        
        {/* Basis */}
        <p className="text-[10px] text-warm-500 mt-3">{prediction.basedOn}</p>
      </div>
      
      {/* Prep reminder */}
      {isPeakSoon && (
        <div className="px-4 py-3 bg-primary/10 border-t border-primary/20">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            <p className="text-sm text-primary font-medium">
              Peak approaching — prep now!
            </p>
          </div>
        </div>
      )}
    </motion.div>
  );
}

function formatHour(hour: number): string {
  if (hour === 0) return '12am';
  if (hour === 12) return '12pm';
  if (hour < 12) return `${hour}am`;
  return `${hour - 12}pm`;
}

export default PeakPredictionCard;

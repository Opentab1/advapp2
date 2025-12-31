/**
 * HistoricalComparison - Shows comparison to same day last week
 * 
 * Addresses "How does tonight compare?" problem:
 * - Compares to same day of week last week
 * - Shows visitors, pulse score, peak time comparisons
 * - Highlights personal bests
 * - Provides context for current performance
 */

import { motion } from 'framer-motion';
import { 
  Calendar,
  TrendingUp,
  TrendingDown,
  Minus,
  Users,
  Zap,
  Trophy,
} from 'lucide-react';

// ============ TYPES ============

interface HistoricalData {
  // Last week same day
  lastWeekPulseAvg: number | null;
  lastWeekVisitors: number | null;
  lastWeekPeakHour: number | null;
  
  // Historical bests (for this day of week)
  bestPulseScore: number | null;
  bestPulseDate: string | null;
  bestVisitors: number | null;
  bestVisitorsDate: string | null;
  
  // Averages for this day of week (last 4 weeks)
  avgPulseScore: number | null;
  avgVisitors: number | null;
}

interface HistoricalComparisonProps {
  currentPulseScore: number | null;
  currentVisitors: number;
  historicalData: HistoricalData | null;
  dayName: string;
}

interface ComparisonCardProps {
  icon: typeof Zap;
  label: string;
  current: number | null;
  comparison: number | null;
  comparisonLabel: string;
  unit?: string;
  higherIsBetter?: boolean;
}

interface DayComparisonBannerProps {
  dayName: string;
  currentPulse: number | null;
  lastWeekPulse: number | null;
  currentVisitors: number;
  lastWeekVisitors: number | null;
}

// ============ MAIN COMPARISON COMPONENT ============

export function HistoricalComparison({
  currentPulseScore,
  currentVisitors,
  historicalData,
  dayName,
}: HistoricalComparisonProps) {
  if (!historicalData) return null;

  const isNewBest = historicalData.bestPulseScore !== null && 
    currentPulseScore !== null && 
    currentPulseScore > historicalData.bestPulseScore;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-4 rounded-xl bg-white border border-warm-200"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-warm-800">vs Last {dayName}</span>
        </div>
        {isNewBest && (
          <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-100 border border-yellow-200">
            <Trophy className="w-3 h-3 text-yellow-600" />
            <span className="text-xs font-bold text-yellow-700">New Best!</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <ComparisonCard
          icon={Zap}
          label="Pulse Score"
          current={currentPulseScore}
          comparison={historicalData.lastWeekPulseAvg}
          comparisonLabel="Last week"
          higherIsBetter={true}
        />
        <ComparisonCard
          icon={Users}
          label="Visitors"
          current={currentVisitors}
          comparison={historicalData.lastWeekVisitors}
          comparisonLabel="Last week"
          higherIsBetter={true}
        />
      </div>

      {/* Average comparison */}
      {historicalData.avgPulseScore !== null && (
        <div className="mt-3 pt-3 border-t border-warm-100">
          <div className="flex items-center justify-between text-xs">
            <span className="text-warm-500">Your {dayName} average (4 wks)</span>
            <div className="flex items-center gap-2">
              <span className="font-medium text-warm-700">
                Pulse {historicalData.avgPulseScore}
              </span>
              {currentPulseScore !== null && (
                <ComparisonBadge 
                  current={currentPulseScore} 
                  comparison={historicalData.avgPulseScore} 
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Best record */}
      {historicalData.bestPulseScore !== null && historicalData.bestPulseDate && !isNewBest && (
        <div className="mt-2 flex items-center justify-between text-xs">
          <span className="text-warm-500">Best {dayName}</span>
          <span className="text-warm-600">
            {historicalData.bestPulseScore} on {historicalData.bestPulseDate}
          </span>
        </div>
      )}
    </motion.div>
  );
}

// ============ COMPARISON CARD ============

function ComparisonCard({
  icon: Icon,
  label,
  current,
  comparison,
  comparisonLabel,
  unit = '',
  higherIsBetter = true,
}: ComparisonCardProps) {
  const diff = current !== null && comparison !== null ? current - comparison : null;
  const isPositive = diff !== null && (higherIsBetter ? diff > 0 : diff < 0);
  const isNegative = diff !== null && (higherIsBetter ? diff < 0 : diff > 0);

  return (
    <div className="p-3 rounded-xl bg-warm-50">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4 text-warm-500" />
        <span className="text-xs text-warm-500">{label}</span>
      </div>
      
      <div className="flex items-end justify-between">
        <div>
          <p className="text-xl font-bold text-warm-800">
            {current !== null ? `${current}${unit}` : '--'}
          </p>
          <p className="text-xs text-warm-400">
            {comparison !== null ? `${comparisonLabel}: ${comparison}${unit}` : 'No data'}
          </p>
        </div>
        
        {diff !== null && diff !== 0 && (
          <div className={`flex items-center gap-0.5 text-sm font-bold ${
            isPositive ? 'text-green-600' : isNegative ? 'text-red-500' : 'text-warm-500'
          }`}>
            {isPositive ? (
              <TrendingUp className="w-4 h-4" />
            ) : isNegative ? (
              <TrendingDown className="w-4 h-4" />
            ) : (
              <Minus className="w-4 h-4" />
            )}
            {diff > 0 ? '+' : ''}{diff}{unit}
          </div>
        )}
      </div>
    </div>
  );
}

// ============ COMPARISON BADGE ============

function ComparisonBadge({ current, comparison }: { current: number; comparison: number }) {
  const diff = current - comparison;
  if (Math.abs(diff) < 1) return null;

  const isPositive = diff > 0;

  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium ${
      isPositive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
    }`}>
      {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {isPositive ? '+' : ''}{Math.round(diff)}
    </span>
  );
}

// ============ DAY COMPARISON BANNER (Compact) ============

export function DayComparisonBanner({
  dayName,
  currentPulse,
  lastWeekPulse,
  currentVisitors,
  lastWeekVisitors,
}: DayComparisonBannerProps) {
  const pulseDiff = currentPulse !== null && lastWeekPulse !== null 
    ? currentPulse - lastWeekPulse 
    : null;
  const visitorsDiff = lastWeekVisitors !== null 
    ? currentVisitors - lastWeekVisitors 
    : null;

  if (lastWeekPulse === null && lastWeekVisitors === null) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-4 px-4 py-2 rounded-xl bg-primary/5 border border-primary/10"
    >
      <div className="flex items-center gap-1.5">
        <Calendar className="w-4 h-4 text-primary" />
        <span className="text-sm text-warm-600">vs last {dayName}:</span>
      </div>
      
      <div className="flex items-center gap-4">
        {pulseDiff !== null && (
          <div className={`flex items-center gap-1 text-sm font-medium ${
            pulseDiff > 0 ? 'text-green-600' : pulseDiff < 0 ? 'text-red-500' : 'text-warm-500'
          }`}>
            <Zap className="w-3.5 h-3.5" />
            Pulse {pulseDiff > 0 ? '+' : ''}{pulseDiff}
          </div>
        )}
        
        {visitorsDiff !== null && (
          <div className={`flex items-center gap-1 text-sm font-medium ${
            visitorsDiff > 0 ? 'text-green-600' : visitorsDiff < 0 ? 'text-red-500' : 'text-warm-500'
          }`}>
            <Users className="w-3.5 h-3.5" />
            {visitorsDiff > 0 ? '+' : ''}{visitorsDiff} visitors
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ============ MOCK DATA GENERATOR (for demo) ============

export function generateMockHistoricalData(dayOfWeek: number): HistoricalData {
  // Generate realistic mock data based on day of week
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6;
  
  const basePulse = isWeekend ? 78 : 68;
  const baseVisitors = isWeekend ? 145 : 85;
  
  return {
    lastWeekPulseAvg: basePulse + Math.floor(Math.random() * 10 - 5),
    lastWeekVisitors: baseVisitors + Math.floor(Math.random() * 30 - 15),
    lastWeekPeakHour: isWeekend ? 22 : 21,
    bestPulseScore: basePulse + 15,
    bestPulseDate: 'Dec 14',
    bestVisitors: baseVisitors + 40,
    bestVisitorsDate: 'Dec 21',
    avgPulseScore: basePulse,
    avgVisitors: baseVisitors,
  };
}

export default HistoricalComparison;

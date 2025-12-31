/**
 * ShiftSummary - End-of-shift report component
 * 
 * Addresses "Shift Summary" problem:
 * - Shows comprehensive shift statistics
 * - Grades the shift performance
 * - Highlights wins and areas for improvement
 * - Compares to previous shifts
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Clock,
  Users,
  Zap,
  TrendingUp,
  TrendingDown,
  Trophy,
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Target,
  Volume2,
  Sun
} from 'lucide-react';
import type { ShiftSummary as ShiftSummaryType, ShiftStats } from '../hooks/useShiftTracking';

// ============ TYPES ============

interface ShiftSummaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  summary: ShiftSummaryType | null;
}

interface ShiftSummaryCardProps {
  summary: ShiftSummaryType;
  onViewDetails?: () => void;
  compact?: boolean;
}

interface ActiveShiftBannerProps {
  shiftStartTime: number | null;
  currentStats: ShiftStats | null;
  onEndShift: () => void;
}

// ============ SHIFT SUMMARY MODAL ============

export function ShiftSummaryModal({ isOpen, onClose, summary }: ShiftSummaryModalProps) {
  const [showDetails, setShowDetails] = useState(false);

  if (!isOpen || !summary) return null;

  const { stats, grade, gradeMessage, highlights, improvements, comparison } = summary;

  const getGradeColor = () => {
    switch (grade) {
      case 'A': return { bg: 'bg-green-500', text: 'text-green-600', light: 'bg-green-50' };
      case 'B': return { bg: 'bg-blue-500', text: 'text-blue-600', light: 'bg-blue-50' };
      case 'C': return { bg: 'bg-amber-500', text: 'text-amber-600', light: 'bg-amber-50' };
      case 'D': return { bg: 'bg-orange-500', text: 'text-orange-600', light: 'bg-orange-50' };
      default: return { bg: 'bg-red-500', text: 'text-red-600', light: 'bg-red-50' };
    }
  };

  const gradeColor = getGradeColor();
  const shiftDuration = formatDuration(stats.duration);
  const startTimeStr = new Date(stats.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const endTimeStr = stats.endTime 
    ? new Date(stats.endTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : 'Now';

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-warm-900/50 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header with grade */}
          <div className={`relative ${gradeColor.light} px-6 pt-8 pb-6`}>
            <button
              onClick={onClose}
              className="absolute top-4 right-4 p-2 hover:bg-white/50 rounded-xl transition-colors"
            >
              <X className="w-5 h-5 text-warm-400" />
            </button>

            <div className="flex items-center gap-4">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', delay: 0.2 }}
                className={`w-20 h-20 ${gradeColor.bg} rounded-2xl flex items-center justify-center shadow-lg`}
              >
                <span className="text-4xl font-bold text-white">{grade}</span>
              </motion.div>
              <div>
                <h2 className="text-xl font-bold text-warm-800">Shift Complete!</h2>
                <p className={`text-sm ${gradeColor.text} font-medium`}>{gradeMessage}</p>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="p-6 overflow-y-auto max-h-[50vh]">
            {/* Time info */}
            <div className="flex items-center justify-between mb-6 text-sm text-warm-500">
              <div className="flex items-center gap-1">
                <Clock className="w-4 h-4" />
                <span>{startTimeStr} - {endTimeStr}</span>
              </div>
              <span className="font-medium text-warm-700">{shiftDuration}</span>
            </div>

            {/* Key metrics */}
            <div className="grid grid-cols-3 gap-3 mb-6">
              <MetricBox
                icon={Zap}
                value={stats.avgPulseScore}
                label="Avg Pulse"
                color="text-primary"
              />
              <MetricBox
                icon={Users}
                value={stats.totalVisitors}
                label="Visitors"
                color="text-green-600"
              />
              <MetricBox
                icon={Target}
                value={`${Math.round((stats.timeInOptimal / stats.duration) * 100)}%`}
                label="Optimal"
                color="text-amber-600"
              />
            </div>

            {/* Comparison */}
            {(comparison.vsPreviousShift !== null || comparison.vsAverage !== null) && (
              <div className="p-4 rounded-xl bg-warm-50 mb-6">
                <p className="text-sm font-medium text-warm-700 mb-2">Compared to:</p>
                <div className="grid grid-cols-2 gap-4">
                  {comparison.vsPreviousShift !== null && (
                    <ComparisonItem
                      label="Last shift"
                      value={comparison.vsPreviousShift}
                    />
                  )}
                  {comparison.vsAverage !== null && (
                    <ComparisonItem
                      label="Your average"
                      value={comparison.vsAverage}
                    />
                  )}
                </div>
              </div>
            )}

            {/* Highlights */}
            {highlights.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-warm-800 mb-2 flex items-center gap-2">
                  <Trophy className="w-4 h-4 text-yellow-500" />
                  Highlights
                </h3>
                <ul className="space-y-2">
                  {highlights.map((h, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-warm-600">
                      <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                      {h}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Improvements */}
            {improvements.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-warm-800 mb-2 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                  Areas to Improve
                </h3>
                <ul className="space-y-2">
                  {improvements.map((imp, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-warm-600">
                      <span className="w-4 h-4 flex items-center justify-center text-amber-500">•</span>
                      {imp}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Detailed stats toggle */}
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="w-full flex items-center justify-center gap-2 py-2 text-sm text-warm-500 hover:text-warm-700 transition-colors"
            >
              {showDetails ? 'Hide' : 'Show'} detailed stats
              {showDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {/* Detailed stats */}
            <AnimatePresence>
              {showDetails && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="pt-4 space-y-3">
                    <DetailRow icon={Zap} label="Pulse range" value={`${stats.minPulseScore} - ${stats.maxPulseScore}`} />
                    <DetailRow icon={Users} label="Peak crowd" value={`${stats.peakOccupancy} at ${stats.peakOccupancyTime ? new Date(stats.peakOccupancyTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '--'}`} />
                    <DetailRow icon={Volume2} label="Avg sound" value={stats.avgDecibels ? `${stats.avgDecibels} dB` : '--'} />
                    <DetailRow icon={Sun} label="Avg light" value={stats.avgLight ? `${stats.avgLight} lux` : '--'} />
                    <DetailRow icon={Clock} label="Time optimal" value={`${stats.timeInOptimal} min`} />
                    <DetailRow icon={Clock} label="Time needs work" value={`${stats.timeInNeedsWork} min`} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Footer */}
          <div className="p-6 border-t border-warm-200">
            <motion.button
              onClick={onClose}
              className="w-full py-3 rounded-xl bg-primary text-white font-semibold hover:bg-primary-600 transition-colors"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              Done
            </motion.button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ============ ACTIVE SHIFT BANNER ============

export function ActiveShiftBanner({ shiftStartTime, currentStats, onEndShift }: ActiveShiftBannerProps) {
  if (!shiftStartTime) return null;

  const duration = Math.round((Date.now() - shiftStartTime) / 60000);
  const formattedDuration = formatDuration(duration);

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-4 p-4 rounded-xl bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/20"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse" />
            <div className="absolute inset-0 w-3 h-3 bg-green-500 rounded-full animate-ping" />
          </div>
          <div>
            <p className="text-sm font-medium text-warm-800">Shift Active</p>
            <p className="text-xs text-warm-500">{formattedDuration}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {currentStats && (
            <div className="text-right">
              <p className="text-lg font-bold text-primary">{currentStats.avgPulseScore}</p>
              <p className="text-xs text-warm-500">Avg Pulse</p>
            </div>
          )}
          
          <motion.button
            onClick={onEndShift}
            className="px-4 py-2 rounded-lg bg-warm-800 text-white text-sm font-medium hover:bg-warm-900 transition-colors"
            whileTap={{ scale: 0.95 }}
          >
            End Shift
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}

// ============ SHIFT SUMMARY CARD (Compact) ============

export function ShiftSummaryCard({ summary, onViewDetails }: ShiftSummaryCardProps) {
  const { stats, grade } = summary;
  
  const getGradeColor = () => {
    switch (grade) {
      case 'A': return 'bg-green-500';
      case 'B': return 'bg-blue-500';
      case 'C': return 'bg-amber-500';
      case 'D': return 'bg-orange-500';
      default: return 'bg-red-500';
    }
  };

  const date = new Date(stats.startTime).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

  return (
    <motion.div
      className="p-4 rounded-xl bg-white border border-warm-200 cursor-pointer hover:border-primary/30 transition-colors"
      onClick={onViewDetails}
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
    >
      <div className="flex items-center gap-3">
        <div className={`w-12 h-12 ${getGradeColor()} rounded-xl flex items-center justify-center`}>
          <span className="text-xl font-bold text-white">{grade}</span>
        </div>
        <div className="flex-1">
          <p className="font-medium text-warm-800">{date}</p>
          <div className="flex items-center gap-3 text-sm text-warm-500">
            <span>{formatDuration(stats.duration)}</span>
            <span>•</span>
            <span>Pulse {stats.avgPulseScore}</span>
            <span>•</span>
            <span>{stats.totalVisitors} visitors</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ============ HELPER COMPONENTS ============

function MetricBox({ icon: Icon, value, label, color }: {
  icon: typeof Zap;
  value: number | string;
  label: string;
  color: string;
}) {
  return (
    <div className="p-3 rounded-xl bg-warm-50 text-center">
      <Icon className={`w-5 h-5 ${color} mx-auto mb-1`} />
      <p className="text-xl font-bold text-warm-800">{value}</p>
      <p className="text-xs text-warm-500">{label}</p>
    </div>
  );
}

function ComparisonItem({ label, value }: { label: string; value: number }) {
  const isPositive = value > 0;
  const isNegative = value < 0;

  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-warm-500">{label}</span>
      <span className={`text-sm font-bold flex items-center gap-1 ${
        isPositive ? 'text-green-600' : isNegative ? 'text-red-500' : 'text-warm-500'
      }`}>
        {isPositive ? <TrendingUp className="w-3 h-3" /> : isNegative ? <TrendingDown className="w-3 h-3" /> : null}
        {value > 0 ? '+' : ''}{value}
      </span>
    </div>
  );
}

function DetailRow({ icon: Icon, label, value }: {
  icon: typeof Zap;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-warm-100 last:border-0">
      <div className="flex items-center gap-2 text-sm text-warm-500">
        <Icon className="w-4 h-4" />
        {label}
      </div>
      <span className="text-sm font-medium text-warm-700">{value}</span>
    </div>
  );
}

// ============ HELPERS ============

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

export default ShiftSummaryModal;

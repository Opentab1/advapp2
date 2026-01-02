/**
 * CrowdBreakdownModal - Deep dive into occupancy data
 * 
 * Shows:
 * - Current vs capacity
 * - Traffic flow (entries/exits)
 * - Peak times
 * - Patterns and insights
 * - WHY the numbers are what they are
 */

import { motion } from 'framer-motion';
import { Modal } from '../common/Modal';
import { Users, UserPlus, UserMinus, TrendingUp, Clock, ArrowRight, Info } from 'lucide-react';
import { AnimatedNumber } from '../common/AnimatedNumber';

interface CrowdBreakdownModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentOccupancy: number;
  todayEntries: number;
  todayExits: number;
  peakOccupancy: number;
  peakTime: string | null;
}

export function CrowdBreakdownModal({
  isOpen,
  onClose,
  currentOccupancy,
  todayEntries,
  todayExits,
  peakOccupancy,
  peakTime,
}: CrowdBreakdownModalProps) {
  // Calculate metrics
  const turnover = todayEntries > 0 ? ((todayExits / todayEntries) * 100) : 0;
  const retentionRate = 100 - turnover;
  const estimatedCapacity = Math.max(peakOccupancy * 1.2, 50);
  const capacityUsage = Math.min(100, Math.round((currentOccupancy / estimatedCapacity) * 100));
  
  // Determine status
  const getStatus = () => {
    if (currentOccupancy === 0) return { label: 'Empty', color: 'text-warm-500', bg: 'bg-warm-100 dark:bg-warm-700' };
    if (capacityUsage < 30) return { label: 'Quiet', color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/20' };
    if (capacityUsage < 60) return { label: 'Moderate', color: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-900/20' };
    if (capacityUsage < 85) return { label: 'Busy', color: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-900/20' };
    return { label: 'Packed', color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-900/20' };
  };
  
  const status = getStatus();
  
  // Generate insight
  const insight = getInsight(currentOccupancy, todayEntries, todayExits, peakOccupancy);
  
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Crowd Details">
      <div className="space-y-6">
        {/* Current Occupancy Hero */}
        <div className="text-center py-6 bg-warm-50 dark:bg-warm-700/50 rounded-2xl -mx-2">
          <div className="flex items-center justify-center gap-3 mb-2">
            <Users className="w-8 h-8 text-primary" />
            <AnimatedNumber
              value={currentOccupancy}
              className="text-6xl font-bold text-warm-800 dark:text-warm-100"
            />
          </div>
          <p className="text-sm text-warm-500 dark:text-warm-400 mb-2">people in venue right now</p>
          <span className={`inline-block px-4 py-1.5 rounded-full text-sm font-semibold ${status.bg} ${status.color}`}>
            {status.label}
          </span>
        </div>
        
        {/* Capacity Gauge */}
        <div className="bg-white dark:bg-warm-800 rounded-xl border border-warm-200 dark:border-warm-700 p-4">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-warm-600 dark:text-warm-300">Capacity Usage</span>
            <span className="font-semibold text-warm-800 dark:text-warm-100">{capacityUsage}%</span>
          </div>
          <div className="h-3 bg-warm-200 dark:bg-warm-600 rounded-full overflow-hidden">
            <motion.div
              className={`h-full rounded-full ${
                capacityUsage < 60 ? 'bg-green-500' : capacityUsage < 85 ? 'bg-amber-500' : 'bg-red-500'
              }`}
              initial={{ width: 0 }}
              animate={{ width: `${capacityUsage}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
          <div className="flex justify-between text-xs text-warm-400 dark:text-warm-500 mt-1">
            <span>0</span>
            <span>~{Math.round(estimatedCapacity)} est. capacity</span>
          </div>
        </div>
        
        {/* Traffic Flow */}
        <div>
          <h4 className="text-xs font-semibold text-warm-500 dark:text-warm-400 uppercase tracking-wide mb-3">
            Today's Traffic
          </h4>
          <div className="grid grid-cols-3 gap-3">
            <TrafficCard
              icon={UserPlus}
              iconColor="text-green-500"
              label="Entries"
              value={todayEntries}
              subtext="walked in"
            />
            <TrafficCard
              icon={UserMinus}
              iconColor="text-red-500"
              label="Exits"
              value={todayExits}
              subtext="walked out"
            />
            <TrafficCard
              icon={Users}
              iconColor="text-primary"
              label="Net"
              value={todayEntries - todayExits}
              subtext={todayEntries - todayExits >= 0 ? 'gained' : 'lost'}
              highlight={todayEntries - todayExits !== 0}
            />
          </div>
        </div>
        
        {/* Peak Info */}
        <div className="bg-primary/5 dark:bg-primary/10 rounded-xl p-4 border border-primary/10 dark:border-primary/20">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 dark:bg-primary/20 flex items-center justify-center flex-shrink-0">
              <TrendingUp className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h5 className="text-sm font-semibold text-warm-800 dark:text-warm-100 mb-1">Peak Today</h5>
              <p className="text-2xl font-bold text-primary">{peakOccupancy} people</p>
              {peakTime && (
                <p className="text-xs text-warm-500 dark:text-warm-400 mt-1 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  at {peakTime}
                </p>
              )}
            </div>
          </div>
        </div>
        
        {/* Insight */}
        {insight && (
          <div className="bg-warm-50 dark:bg-warm-700/50 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <Info className="w-4 h-4 text-warm-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm text-warm-700 dark:text-warm-200">{insight.message}</p>
                {insight.tip && (
                  <p className="text-xs text-warm-500 dark:text-warm-400 mt-1">
                    💡 {insight.tip}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
        
        {/* Data info */}
        <p className="text-xs text-warm-400 dark:text-warm-500 text-center">
          Traffic resets at 3am daily • Based on entry/exit sensor data
        </p>
      </div>
    </Modal>
  );
}

// ============ TRAFFIC CARD ============

interface TrafficCardProps {
  icon: typeof Users;
  iconColor: string;
  label: string;
  value: number;
  subtext: string;
  highlight?: boolean;
}

function TrafficCard({ icon: Icon, iconColor, label, value, subtext, highlight }: TrafficCardProps) {
  return (
    <div className={`p-3 rounded-xl ${
      highlight 
        ? 'bg-primary/5 dark:bg-primary/10 border border-primary/10' 
        : 'bg-warm-50 dark:bg-warm-700/50'
    } text-center transition-colors`}>
      <Icon className={`w-5 h-5 ${iconColor} mx-auto mb-1`} />
      <AnimatedNumber
        value={value}
        className={`text-xl font-bold ${highlight ? 'text-primary' : 'text-warm-800 dark:text-warm-100'}`}
        formatFn={(v) => (v >= 0 ? v.toString() : v.toString())}
      />
      <p className="text-xs text-warm-500 dark:text-warm-400">{subtext}</p>
    </div>
  );
}

// ============ INSIGHT GENERATOR ============

function getInsight(current: number, entries: number, exits: number, peak: number): { message: string; tip?: string } | null {
  const hour = new Date().getHours();
  const isPeakHours = hour >= 19 && hour <= 23;
  
  if (current === 0 && entries === 0) {
    return {
      message: 'No foot traffic recorded yet today.',
      tip: 'Check if your entry sensor is working correctly.'
    };
  }
  
  if (entries > 0 && exits === entries) {
    return {
      message: 'Everyone who came in has left. Net zero traffic.',
      tip: 'Consider what might encourage guests to stay longer.'
    };
  }
  
  if (current === peak && peak > 10) {
    return {
      message: "You're at today's peak right now! 🎉",
      tip: 'Great time to upsell premium drinks.'
    };
  }
  
  if (isPeakHours && current < peak * 0.5 && peak > 10) {
    return {
      message: `Traffic is ${Math.round((1 - current/peak) * 100)}% below your earlier peak.`,
      tip: 'Consider a late-night promo to bring in more guests.'
    };
  }
  
  if (entries > 50 && (exits / entries) > 0.8) {
    return {
      message: `High turnover today — 80%+ of entries have already left.`,
      tip: 'This could indicate short visits. Consider ways to extend dwell time.'
    };
  }
  
  return null;
}

export default CrowdBreakdownModal;

/**
 * RevenueHero - The "Money Moment"
 * 
 * Shows the estimated revenue impact in dollars instead of abstract scores.
 * This is what bar owners actually care about.
 */

import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, Sparkles } from 'lucide-react';
import { calculateRevenueImpact, getRevenueInsight, formatCurrency } from '../../utils/revenue';

interface RevenueHeroProps {
  currentOccupancy: number;
  dwellTimeMinutes: number;
  pulseScore: number;
  todayEntries: number;
  todayExits: number;
  onTap?: () => void;
}

export function RevenueHero({
  currentOccupancy,
  dwellTimeMinutes,
  pulseScore,
  todayEntries,
  todayExits,
  onTap,
}: RevenueHeroProps) {
  const impact = calculateRevenueImpact(
    currentOccupancy,
    dwellTimeMinutes,
    pulseScore,
    todayEntries,
    todayExits
  );
  
  const insight = getRevenueInsight(dwellTimeMinutes, pulseScore, currentOccupancy);
  
  // Determine the gradient based on performance
  const getGradient = () => {
    if (impact.tonightImpact > 500) return 'from-emerald-500/20 to-green-600/10';
    if (impact.tonightImpact > 200) return 'from-cyan-500/20 to-blue-600/10';
    if (impact.tonightImpact > 0) return 'from-amber-500/20 to-orange-600/10';
    return 'from-warm-700/50 to-warm-800/50';
  };
  
  const getTextColor = () => {
    if (impact.tonightImpact > 500) return 'text-emerald-400';
    if (impact.tonightImpact > 200) return 'text-cyan-400';
    if (impact.tonightImpact > 0) return 'text-amber-400';
    return 'text-warm-300';
  };
  
  const showOpportunity = impact.missedOpportunity > 50;
  
  return (
    <motion.div
      className={`glass-card p-6 relative overflow-hidden cursor-pointer`}
      onClick={onTap}
      whileTap={{ scale: 0.98 }}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Background gradient */}
      <div className={`absolute inset-0 bg-gradient-to-br ${getGradient()} opacity-50`} />
      
      {/* Content */}
      <div className="relative z-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-warm-400 text-sm font-medium">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span>Tonight's Revenue Impact</span>
          </div>
          {impact.confidence > 0.5 && (
            <div className="flex items-center gap-1 text-xs text-warm-500">
              <span>{Math.round(impact.confidence * 100)}% confidence</span>
            </div>
          )}
        </div>
        
        {/* Main Number */}
        <div className="text-center my-6">
          <motion.div
            className="flex items-center justify-center gap-2"
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 15 }}
          >
            <span className="text-2xl text-warm-400">+</span>
            <span className={`text-5xl sm:text-6xl font-bold tracking-tight ${getTextColor()}`}>
              {impact.tonightImpactFormatted}
            </span>
          </motion.div>
          
          <motion.p
            className="text-warm-400 mt-2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
          >
            {insight.headline}
          </motion.p>
        </div>
        
        {/* Insight Card */}
        <motion.div
          className={`p-3 rounded-xl ${
            insight.type === 'positive' 
              ? 'bg-emerald-500/10 border border-emerald-500/20' 
              : insight.type === 'negative'
                ? 'bg-red-500/10 border border-red-500/20'
                : 'bg-warm-700/50 border border-warm-600'
          }`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <p className={`text-sm ${
            insight.type === 'positive' 
              ? 'text-emerald-300' 
              : insight.type === 'negative' 
                ? 'text-red-300' 
                : 'text-warm-300'
          }`}>
            {insight.subtext}
          </p>
        </motion.div>
        
        {/* Missed Opportunity Warning */}
        <AnimatePresence>
          {showOpportunity && (
            <motion.div
              className="mt-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center gap-3"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0" />
              <div>
                <p className="text-amber-300 text-sm font-medium">
                  ~{formatCurrency(impact.missedOpportunity)} left on the table
                </p>
                <p className="text-amber-400/70 text-xs">
                  {impact.missedOpportunityReason}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        
        {/* Bottom Stats */}
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-warm-700">
          <div className="flex items-center gap-4">
            {/* Dwell contribution */}
            <div className="text-center">
              <div className="text-xs text-warm-500 mb-0.5">From Dwell</div>
              <div className="text-sm font-semibold text-warm-200">
                +{formatCurrency(impact.dwellImpact)}
              </div>
            </div>
            
            {/* Condition bonus */}
            {impact.conditionBonus > 0 && (
              <div className="text-center">
                <div className="text-xs text-warm-500 mb-0.5">Vibe Bonus</div>
                <div className="text-sm font-semibold text-emerald-400">
                  +{formatCurrency(impact.conditionBonus)}
                </div>
              </div>
            )}
          </div>
          
          {/* Pulse Score (supporting) */}
          <div className="text-center">
            <div className="text-xs text-warm-500 mb-0.5">Pulse</div>
            <div className={`text-lg font-bold ${
              pulseScore >= 80 ? 'text-emerald-400' :
              pulseScore >= 60 ? 'text-cyan-400' :
              pulseScore >= 40 ? 'text-amber-400' :
              'text-red-400'
            }`}>
              {pulseScore}
            </div>
          </div>
        </div>
      </div>
      
      {/* Tap indicator */}
      <div className="absolute bottom-2 right-4 text-xs text-warm-600">
        tap for details
      </div>
    </motion.div>
  );
}

export default RevenueHero;

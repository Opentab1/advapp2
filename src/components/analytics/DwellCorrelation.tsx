/**
 * DwellCorrelation - Shows how metrics impact guest dwell time
 * 
 * "What Keeps Guests Longer?"
 * - Correlation cards: "Guests stay 18% longer when sound is 75-82 dB"
 * - Simple bar charts for each factor
 * - Statistical confidence indicator
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Clock, 
  Volume2, 
  Sun, 
  Users, 
  ChevronDown,
  ChevronUp,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  CheckCircle,
  Info,
} from 'lucide-react';
import { haptic } from '../../utils/haptics';
import type { DwellCorrelationData, DwellCorrelation as DwellCorrelationType } from '../../types/insights';

interface DwellCorrelationProps {
  data: DwellCorrelationData | null;
  loading: boolean;
}

const factorIcons = {
  sound: Volume2,
  light: Sun,
  crowd: Users,
};

const factorColors = {
  sound: 'text-blue-400',
  light: 'text-yellow-400',
  crowd: 'text-purple-400',
};

function CorrelationCard({ 
  correlation, 
  expanded, 
  onToggle 
}: { 
  correlation: DwellCorrelationType;
  expanded: boolean;
  onToggle: () => void;
}) {
  const Icon = factorIcons[correlation.factor];
  const color = factorColors[correlation.factor];
  const isPositive = correlation.percentImprovement > 0;
  
  return (
    <motion.div
      className="bg-whoop-panel border border-whoop-divider rounded-xl overflow-hidden"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Header - Always visible */}
      <button
        onClick={() => { haptic('light'); onToggle(); }}
        className="w-full p-4 flex items-start gap-3 text-left hover:bg-warm-800/50 transition-colors"
      >
        <div className={`w-10 h-10 rounded-full bg-warm-700 flex items-center justify-center ${color}`}>
          <Icon className="w-5 h-5" />
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="text-xs text-warm-400 uppercase tracking-wide mb-0.5">
            {correlation.label}
          </div>
          <div className="text-white font-semibold">
            Guests stay{' '}
            <span className={isPositive ? 'text-recovery-high' : 'text-recovery-low'}>
              {isPositive ? '+' : ''}{correlation.percentImprovement}%
            </span>
            {' '}longer
          </div>
          <div className="text-sm text-warm-300 mt-0.5">
            when {correlation.factor} is <span className="text-white">{correlation.optimalRange}</span>
          </div>
        </div>
        
        <div className="flex-shrink-0 mt-1">
          {expanded ? (
            <ChevronUp className="w-5 h-5 text-warm-500" />
          ) : (
            <ChevronDown className="w-5 h-5 text-warm-500" />
          )}
        </div>
      </button>
      
      {/* Expanded chart */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-0 border-t border-whoop-divider">
              {/* Bar chart */}
              <div className="space-y-2 mt-3">
                {correlation.buckets.map((bucket, idx) => {
                  const maxDwell = Math.max(...correlation.buckets.map(b => b.avgDwellMinutes));
                  const barWidth = maxDwell > 0 ? (bucket.avgDwellMinutes / maxDwell) * 100 : 0;
                  
                  return (
                    <div key={idx} className="flex items-center gap-2">
                      <div className="w-24 text-xs text-warm-400 text-right flex-shrink-0">
                        {bucket.range}
                      </div>
                      <div className="flex-1 h-6 bg-warm-800 rounded overflow-hidden relative">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${barWidth}%` }}
                          transition={{ duration: 0.5, delay: idx * 0.05 }}
                          className={`h-full rounded ${
                            bucket.isOptimal 
                              ? 'bg-gradient-to-r from-recovery-high/80 to-recovery-high' 
                              : 'bg-warm-600'
                          }`}
                        />
                        <div className="absolute inset-0 flex items-center px-2">
                          <span className={`text-xs font-medium ${
                            barWidth > 40 ? 'text-white' : 'text-warm-300'
                          }`}>
                            {bucket.avgDwellMinutes}m
                            {bucket.isOptimal && (
                              <span className="ml-1 text-recovery-high">★</span>
                            )}
                          </span>
                        </div>
                      </div>
                      <div className="w-16 text-xs text-right flex-shrink-0">
                        {bucket.percentDiff !== 0 && (
                          <span className={bucket.percentDiff > 0 ? 'text-recovery-high' : 'text-recovery-low'}>
                            {bucket.percentDiff > 0 ? '+' : ''}{bucket.percentDiff}%
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              
              {/* Stats footer */}
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-warm-700">
                <div className="flex items-center gap-1 text-xs text-warm-400">
                  <Clock className="w-3 h-3" />
                  <span>Avg: {correlation.overallAvgDwell}m overall</span>
                </div>
                <div className="flex items-center gap-1 text-xs">
                  {correlation.confidence === 'high' && (
                    <>
                      <CheckCircle className="w-3 h-3 text-recovery-high" />
                      <span className="text-recovery-high">High confidence</span>
                    </>
                  )}
                  {correlation.confidence === 'medium' && (
                    <>
                      <Info className="w-3 h-3 text-recovery-medium" />
                      <span className="text-recovery-medium">Medium confidence</span>
                    </>
                  )}
                  {correlation.confidence === 'low' && (
                    <>
                      <AlertCircle className="w-3 h-3 text-warm-500" />
                      <span className="text-warm-500">Low confidence</span>
                    </>
                  )}
                </div>
              </div>
              
              <div className="text-xs text-warm-500 mt-2">
                Based on {correlation.totalSamples.toLocaleString()} guest visits
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function DwellCorrelation({ data, loading }: DwellCorrelationProps) {
  const [expandedFactor, setExpandedFactor] = useState<string | null>(null);
  
  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-warm-500" />
          <h2 className="text-sm font-semibold text-warm-400 uppercase tracking-whoop">
            What Keeps Guests Longer?
          </h2>
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-warm-800 rounded-xl p-4 animate-pulse">
              <div className="flex gap-3">
                <div className="w-10 h-10 bg-warm-700 rounded-full" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-warm-700 rounded w-20" />
                  <div className="h-5 bg-warm-700 rounded w-48" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  
  if (!data || !data.hasData) {
    return (
      <div className="bg-whoop-panel border border-whoop-divider rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Clock className="w-5 h-5 text-warm-500" />
          <h2 className="text-sm font-semibold text-warm-400 uppercase tracking-whoop">
            What Keeps Guests Longer?
          </h2>
        </div>
        <p className="text-sm text-warm-400">
          Not enough data yet. We need more guest visits to calculate meaningful correlations.
        </p>
      </div>
    );
  }
  
  const correlations = [data.sound, data.light, data.crowd].filter(Boolean) as DwellCorrelationType[];
  
  // Sort by impact (highest improvement first)
  correlations.sort((a, b) => Math.abs(b.percentImprovement) - Math.abs(a.percentImprovement));
  
  return (
    <div className="space-y-4">
      {/* Section Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-primary" />
          <h2 className="text-sm font-semibold text-warm-400 uppercase tracking-whoop">
            What Keeps Guests Longer?
          </h2>
        </div>
        <div className="text-xs text-warm-500">
          {data.totalGuestVisits.toLocaleString()} visits analyzed
        </div>
      </div>
      
      {/* Correlation Cards */}
      <div className="space-y-3">
        {correlations.map((correlation) => (
          <CorrelationCard
            key={correlation.factor}
            correlation={correlation}
            expanded={expandedFactor === correlation.factor}
            onToggle={() => {
              setExpandedFactor(
                expandedFactor === correlation.factor ? null : correlation.factor
              );
            }}
          />
        ))}
      </div>
      
      {/* Disclaimer */}
      <div className="flex items-start gap-2 p-3 bg-warm-800/50 rounded-lg border border-warm-700">
        <Info className="w-4 h-4 text-warm-500 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-warm-500">
          Correlation data shows patterns, not causation. Other factors like day of week, 
          events, or seasonality may also influence guest behavior.
        </p>
      </div>
    </div>
  );
}

export default DwellCorrelation;

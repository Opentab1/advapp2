/**
 * PredictionsCard - Tabbed card for What-If scenarios and Peak Predictions
 * 
 * Combines:
 * - What-If Scenarios (impact predictions)
 * - Peak Predictions (tonight's forecast)
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Lightbulb, BarChart2, TrendingUp, Clock, Users,
  ChevronUp, ChevronDown
} from 'lucide-react';
import type { WhatIfScenario, PeakPrediction } from '../../services/intelligence.service';
import { haptic } from '../../utils/haptics';

interface PredictionsCardProps {
  scenarios: WhatIfScenario[];
  peakPrediction: PeakPrediction | null;
}

type Tab = 'whatif' | 'peak';

export function PredictionsCard({ scenarios, peakPrediction }: PredictionsCardProps) {
  const [activeTab, setActiveTab] = useState<Tab>(scenarios.length > 0 ? 'whatif' : 'peak');
  
  // Don't render if no data
  if (scenarios.length === 0 && !peakPrediction) return null;
  
  const tabs = [
    { id: 'whatif' as Tab, label: 'What If', icon: Lightbulb, show: scenarios.length > 0 },
    { id: 'peak' as Tab, label: 'Peak', icon: BarChart2, show: !!peakPrediction },
  ].filter(t => t.show);
  
  // Only one tab? Don't show tabs at all
  const showTabs = tabs.length > 1;
  
  return (
    <motion.div
      className="bg-warm-800 rounded-2xl border border-warm-700 overflow-hidden"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Tabs */}
      {showTabs && (
        <div className="flex border-b border-warm-700">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  haptic('light');
                  setActiveTab(tab.id);
                }}
                className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors ${
                  isActive 
                    ? 'text-primary border-b-2 border-primary bg-primary/5' 
                    : 'text-warm-400 hover:text-warm-200'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      )}
      
      {/* Content */}
      <AnimatePresence mode="wait">
        {activeTab === 'whatif' && scenarios.length > 0 && (
          <motion.div
            key="whatif"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            transition={{ duration: 0.15 }}
            className="p-4 space-y-3"
          >
            {!showTabs && (
              <div className="flex items-center gap-2 mb-3">
                <Lightbulb className="w-4 h-4 text-purple-400" />
                <h3 className="text-sm font-semibold text-warm-100">What If...</h3>
              </div>
            )}
            {scenarios.slice(0, 3).map((scenario, i) => (
              <WhatIfItem key={scenario.id} scenario={scenario} index={i} />
            ))}
          </motion.div>
        )}
        
        {activeTab === 'peak' && peakPrediction && (
          <motion.div
            key="peak"
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            transition={{ duration: 0.15 }}
            className="p-4"
          >
            {!showTabs && (
              <div className="flex items-center gap-2 mb-3">
                <BarChart2 className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold text-warm-100">Peak Prediction</h3>
              </div>
            )}
            <PeakContent prediction={peakPrediction} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ============ WHAT-IF ITEM ============

function WhatIfItem({ scenario, index }: { scenario: WhatIfScenario; index: number }) {
  const isPositive = scenario.predictedImpact.pulseScore > 0;
  
  return (
    <motion.div
      className="flex items-start gap-3 p-3 rounded-xl bg-warm-700/30 border border-warm-700/50"
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
    >
      <div className="flex-1">
        <p className="text-sm font-medium text-warm-100">{scenario.action}</p>
        <p className="text-xs text-warm-400 mt-0.5">{scenario.predictedImpact.description}</p>
        
        <div className="flex items-center gap-3 mt-2">
          <div className={`flex items-center gap-1 text-xs font-medium ${
            isPositive ? 'text-green-400' : 'text-red-400'
          }`}>
            <TrendingUp className={`w-3 h-3 ${!isPositive ? 'rotate-180' : ''}`} />
            <span>{isPositive ? '+' : ''}{scenario.predictedImpact.pulseScore} Pulse</span>
          </div>
          {scenario.predictedImpact.dwellTime > 0 && (
            <div className="flex items-center gap-1 text-xs text-warm-500">
              <Clock className="w-3 h-3" />
              <span>+{scenario.predictedImpact.dwellTime}m</span>
            </div>
          )}
        </div>
      </div>
      
      <div className="text-right">
        <span className={`text-lg font-bold ${isPositive ? 'text-green-400' : 'text-warm-400'}`}>
          {isPositive ? '+' : ''}{scenario.predictedImpact.pulseScore}
        </span>
      </div>
    </motion.div>
  );
}

// ============ PEAK CONTENT ============

function PeakContent({ prediction }: { prediction: PeakPrediction }) {
  const now = new Date().getHours();
  const hoursUntilPeak = (prediction.predictedPeakHour - now + 24) % 24;
  const isPeakNow = hoursUntilPeak === 0;
  const isPeakSoon = hoursUntilPeak > 0 && hoursUntilPeak <= 2;
  const isPeakPassed = prediction.predictedPeakHour < now;
  
  const comparison = prediction.comparisonToLastWeek;
  const isUp = comparison?.difference.startsWith('+');
  
  return (
    <div className="space-y-4">
      {/* Main prediction */}
      <div className="flex items-center justify-between">
        <div>
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
          </div>
          <p className="text-sm text-warm-400">Expected peak time</p>
        </div>
        
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
      
      {/* Comparison */}
      {comparison && (
        <div className={`p-3 rounded-xl flex items-center justify-between ${
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
            Last week: {comparison.lastWeekPeak}
          </span>
        </div>
      )}
      
      {/* Confidence + prep reminder */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-warm-500">{prediction.confidence}% confidence</span>
        {isPeakSoon && (
          <span className="text-primary font-medium">Prep now!</span>
        )}
        {isPeakPassed && !isPeakNow && (
          <span className="text-warm-500">Peak passed</span>
        )}
      </div>
    </div>
  );
}

function formatHour(hour: number): string {
  if (hour === 0) return '12am';
  if (hour === 12) return '12pm';
  if (hour < 12) return `${hour}am`;
  return `${hour - 12}pm`;
}

export default PredictionsCard;

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ChevronDown, 
  ChevronUp, 
  Volume2, 
  Sun, 
  Thermometer, 
  Droplets,
  Scale,
  Calculator,
  Brain,
  TrendingUp,
  Clock,
  CheckCircle,
  AlertCircle
} from 'lucide-react';
import type { PulseScoreResult, SensorData } from '../types';

interface PulseScoreDropdownProps {
  score: number | null;
  pulseScoreResult?: PulseScoreResult | null;
  sensorData?: SensorData | null;
  compact?: boolean; // For use in reports where less space is available
}

export function PulseScoreDropdown({ 
  score, 
  pulseScoreResult, 
  sensorData,
  compact = false 
}: PulseScoreDropdownProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Use pulse score result if available, otherwise fall back to basic score
  const displayScore = pulseScoreResult?.score ?? score;
  const hasDetailedBreakdown = pulseScoreResult !== null && pulseScoreResult !== undefined;

  // Get score color
  const getScoreColor = (s: number) => {
    if (s >= 85) return { bg: 'from-green-500 to-emerald-600', text: 'text-green-400', border: 'border-green-500/30' };
    if (s >= 70) return { bg: 'from-yellow-500 to-orange-500', text: 'text-yellow-400', border: 'border-yellow-500/30' };
    return { bg: 'from-red-500 to-rose-600', text: 'text-red-400', border: 'border-red-500/30' };
  };

  const getFactorIcon = (factor: string) => {
    switch (factor) {
      case 'sound': return Volume2;
      case 'light': return Sun;
      case 'temperature': return Thermometer;
      case 'humidity': return Droplets;
      default: return AlertCircle;
    }
  };

  const getFactorLabel = (factor: string) => {
    switch (factor) {
      case 'sound': return 'Sound Level';
      case 'light': return 'Lighting';
      case 'temperature': return 'Temperature';
      case 'humidity': return 'Humidity';
      default: return factor;
    }
  };

  const getFactorUnit = (factor: string) => {
    switch (factor) {
      case 'sound': return 'dB';
      case 'light': return 'lux';
      case 'temperature': return '°F';
      case 'humidity': return '%';
      default: return '';
    }
  };

  const getCurrentValue = (factor: string): number | null => {
    if (!sensorData) return null;
    switch (factor) {
      case 'sound': return sensorData.decibels;
      case 'light': return sensorData.light;
      case 'temperature': return sensorData.indoorTemp;
      case 'humidity': return sensorData.humidity;
      default: return null;
    }
  };

  const getScoreIndicator = (score: number) => {
    if (score >= 85) return { icon: '✓', color: 'text-green-400', bg: 'bg-green-500/20' };
    if (score >= 70) return { icon: '⚠', color: 'text-yellow-400', bg: 'bg-yellow-500/20' };
    return { icon: '✗', color: 'text-red-400', bg: 'bg-red-500/20' };
  };

  // No score available - still learning
  if (displayScore === null || displayScore === undefined) {
    const isLearning = pulseScoreResult?.status === 'learning';
    return (
      <div className={`glass-card ${compact ? 'p-4' : 'p-6'} border border-purple-500/30 bg-purple-500/5`}>
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-purple-500/30 to-pink-500/30 flex items-center justify-center animate-pulse">
            <Brain className="w-7 h-7 text-purple-400" />
          </div>
          <div className="flex-1">
            <div className="text-lg font-bold text-white flex items-center gap-2">
              🎯 PULSE SCORE
              <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400">
                Learning
              </span>
            </div>
            <div className="text-sm text-gray-400">
              {isLearning 
                ? 'Collecting venue data to learn your optimal conditions...'
                : 'Waiting for sensor data...'}
            </div>
            <div className="mt-2 h-1.5 bg-gray-700 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full animate-pulse" style={{ width: '30%' }} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  const colors = getScoreColor(displayScore);

  return (
    <motion.div
      className={`glass-card ${compact ? 'p-4' : 'p-6'} border ${colors.border}`}
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Collapsed Header - Always Visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between gap-4 group"
      >
        <div className="flex items-center gap-4">
          {/* Score Circle */}
          <div className={`relative w-14 h-14 rounded-full bg-gradient-to-br ${colors.bg} p-0.5 flex-shrink-0`}>
            <div className="w-full h-full rounded-full bg-gray-900 flex items-center justify-center">
              <span className="text-xl font-bold text-white">{displayScore}</span>
            </div>
          </div>

          <div className="text-left">
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-white">🎯 PULSE SCORE</span>
              {pulseScoreResult && (
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  pulseScoreResult.status === 'optimized' ? 'bg-green-500/20 text-green-400' :
                  pulseScoreResult.status === 'refining' ? 'bg-blue-500/20 text-blue-400' :
                  'bg-yellow-500/20 text-yellow-400'
                }`}>
                  {pulseScoreResult.status === 'optimized' ? 'Optimized' :
                   pulseScoreResult.status === 'refining' ? 'Refining' : 'Learning'}
                </span>
              )}
            </div>
            <p className="text-sm text-gray-400">
              {displayScore >= 85 ? 'Excellent atmosphere' :
               displayScore >= 70 ? 'Good with room to improve' :
               'Needs attention'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-gray-400 group-hover:text-cyan transition-colors">
          <span className="text-sm">{isExpanded ? 'Hide' : 'View'} Details</span>
          {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </div>
      </button>

      {/* Expanded Content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden"
          >
            <div className="pt-6 mt-6 border-t border-white/10 space-y-6">
              
              {/* Factor Scores Section */}
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <TrendingUp className="w-4 h-4 text-cyan" />
                  <h4 className="text-sm font-semibold text-white uppercase tracking-wide">Factor Scores</h4>
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {['sound', 'light', 'temperature', 'humidity'].map((factor) => {
                    const Icon = getFactorIcon(factor);
                    const factorScore = pulseScoreResult?.breakdown?.factorScores?.[factor as keyof typeof pulseScoreResult.breakdown.factorScores] ?? null;
                    const currentValue = getCurrentValue(factor);
                    const optimalRange = pulseScoreResult?.breakdown?.optimalRanges?.[factor as keyof typeof pulseScoreResult.breakdown.optimalRanges];
                    const indicator = factorScore !== null ? getScoreIndicator(factorScore) : null;

                    return (
                      <div 
                        key={factor}
                        className="p-3 rounded-lg bg-white/5 border border-white/10"
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <div className={`p-1.5 rounded ${indicator?.bg || 'bg-gray-500/20'}`}>
                              <Icon className={`w-4 h-4 ${indicator?.color || 'text-gray-400'}`} />
                            </div>
                            <span className="text-sm font-medium text-white">{getFactorLabel(factor)}</span>
                          </div>
                          {factorScore !== null && (
                            <div className="flex items-center gap-1">
                              <span className={`text-lg font-bold ${indicator?.color}`}>{factorScore}%</span>
                              <span className={indicator?.color}>{indicator?.icon}</span>
                            </div>
                          )}
                        </div>
                        
                        <div className="text-xs text-gray-400 space-y-1">
                          {currentValue !== null && (
                            <div className="flex justify-between">
                              <span>Current:</span>
                              <span className="text-white font-medium">
                                {typeof currentValue === 'number' ? currentValue.toFixed(1) : currentValue} {getFactorUnit(factor)}
                              </span>
                            </div>
                          )}
                          {optimalRange && (
                            <div className="flex justify-between">
                              <span>Optimal:</span>
                              <span className="text-cyan">
                                {optimalRange.min}-{optimalRange.max} {getFactorUnit(factor)}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Mini progress bar */}
                        {factorScore !== null && (
                          <div className="mt-2 h-1 bg-gray-700 rounded-full overflow-hidden">
                            <div 
                              className={`h-full rounded-full ${
                                factorScore >= 85 ? 'bg-green-500' :
                                factorScore >= 70 ? 'bg-yellow-500' : 'bg-red-500'
                              }`}
                              style={{ width: `${factorScore}%` }}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Weight Distribution Section */}
              {hasDetailedBreakdown && pulseScoreResult?.breakdown?.optimalRanges && (
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <Scale className="w-4 h-4 text-purple-400" />
                    <h4 className="text-sm font-semibold text-white uppercase tracking-wide">Weight Distribution</h4>
                  </div>
                  <p className="text-xs text-gray-500 mb-3">How much each factor affects your score (learned from your venue)</p>
                  
                  <div className="space-y-2">
                    {[
                      { factor: 'sound', label: 'Sound', weight: 0.38, color: 'bg-cyan' },
                      { factor: 'light', label: 'Light', weight: 0.26, color: 'bg-yellow-400' },
                      { factor: 'temperature', label: 'Temp', weight: 0.22, color: 'bg-red-400' },
                      { factor: 'humidity', label: 'Humidity', weight: 0.14, color: 'bg-blue-400' }
                    ].map(({ factor, label, weight, color }) => (
                      <div key={factor} className="flex items-center gap-3">
                        <span className="text-xs text-gray-400 w-16">{label}</span>
                        <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
                          <motion.div 
                            className={`h-full ${color} rounded-full`}
                            initial={{ width: 0 }}
                            animate={{ width: `${weight * 100}%` }}
                            transition={{ duration: 0.5, delay: 0.2 }}
                          />
                        </div>
                        <span className="text-xs text-white font-medium w-10 text-right">{Math.round(weight * 100)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Score Calculation Section */}
              {hasDetailedBreakdown && pulseScoreResult.breakdown.learnedScore !== null && (
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <Calculator className="w-4 h-4 text-green-400" />
                    <h4 className="text-sm font-semibold text-white uppercase tracking-wide">Score Calculation</h4>
                  </div>
                  
                  <div className="p-4 rounded-lg bg-gray-800/50 border border-white/10">
                    {/* Formula Display */}
                    <div className="mb-4 p-3 rounded-lg bg-gradient-to-r from-cyan/10 to-purple-500/10 border border-cyan/20">
                      <p className="text-xs text-gray-400 mb-2">Formula:</p>
                      <div className="font-mono text-sm text-white text-center">
                        <span className="text-cyan">Pulse Score</span>
                        <span className="text-gray-400"> = </span>
                        <span className="text-gray-300">(</span>
                        <span className="text-cyan">S</span>
                        <span className="text-gray-400">×</span>
                        <span className="text-purple-400">.30</span>
                        <span className="text-gray-300">) + (</span>
                        <span className="text-red-400">T</span>
                        <span className="text-gray-400">×</span>
                        <span className="text-purple-400">.30</span>
                        <span className="text-gray-300">) + (</span>
                        <span className="text-yellow-400">L</span>
                        <span className="text-gray-400">×</span>
                        <span className="text-purple-400">.20</span>
                        <span className="text-gray-300">) + (</span>
                        <span className="text-blue-400">H</span>
                        <span className="text-gray-400">×</span>
                        <span className="text-purple-400">.20</span>
                        <span className="text-gray-300">)</span>
                      </div>
                      <div className="flex justify-center gap-4 mt-2 text-xs text-gray-500">
                        <span><span className="text-cyan">S</span>=Sound</span>
                        <span><span className="text-red-400">T</span>=Temp</span>
                        <span><span className="text-yellow-400">L</span>=Light</span>
                        <span><span className="text-blue-400">H</span>=Humidity</span>
                      </div>
                    </div>

                    {/* Actual Calculation */}
                    {pulseScoreResult.breakdown.factorScores && (
                      <div className="space-y-2 font-mono text-sm">
                        <p className="text-xs text-gray-500 mb-2">Your current calculation:</p>
                        
                        <div className="grid grid-cols-2 gap-2">
                          <div className="p-2 rounded bg-white/5">
                            <div className="text-xs text-gray-500">Sound</div>
                            <div className="text-white">
                              <span className="text-cyan">{pulseScoreResult.breakdown.factorScores.sound}</span>
                              <span className="text-gray-500"> × .30 = </span>
                              <span className="text-white font-medium">{(pulseScoreResult.breakdown.factorScores.sound * 0.30).toFixed(1)}</span>
                            </div>
                          </div>
                          <div className="p-2 rounded bg-white/5">
                            <div className="text-xs text-gray-500">Temperature</div>
                            <div className="text-white">
                              <span className="text-red-400">{pulseScoreResult.breakdown.factorScores.temperature}</span>
                              <span className="text-gray-500"> × .30 = </span>
                              <span className="text-white font-medium">{(pulseScoreResult.breakdown.factorScores.temperature * 0.30).toFixed(1)}</span>
                            </div>
                          </div>
                          <div className="p-2 rounded bg-white/5">
                            <div className="text-xs text-gray-500">Light</div>
                            <div className="text-white">
                              <span className="text-yellow-400">{pulseScoreResult.breakdown.factorScores.light}</span>
                              <span className="text-gray-500"> × .20 = </span>
                              <span className="text-white font-medium">{(pulseScoreResult.breakdown.factorScores.light * 0.20).toFixed(1)}</span>
                            </div>
                          </div>
                          <div className="p-2 rounded bg-white/5">
                            <div className="text-xs text-gray-500">Humidity</div>
                            <div className="text-white">
                              <span className="text-blue-400">{pulseScoreResult.breakdown.factorScores.humidity}</span>
                              <span className="text-gray-500"> × .20 = </span>
                              <span className="text-white font-medium">{(pulseScoreResult.breakdown.factorScores.humidity * 0.20).toFixed(1)}</span>
                            </div>
                          </div>
                        </div>
                        
                        {/* Sum line */}
                        <div className="border-t border-white/10 pt-3 mt-3">
                          <div className="flex items-center justify-between">
                            <div className="text-gray-400 text-xs">
                              {(pulseScoreResult.breakdown.factorScores.sound * 0.30).toFixed(1)} + {(pulseScoreResult.breakdown.factorScores.temperature * 0.30).toFixed(1)} + {(pulseScoreResult.breakdown.factorScores.light * 0.20).toFixed(1)} + {(pulseScoreResult.breakdown.factorScores.humidity * 0.20).toFixed(1)}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-gray-400">=</span>
                              <span className={`text-2xl font-bold ${colors.text}`}>{displayScore}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Learning Status Section */}
              {hasDetailedBreakdown && (
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <Brain className="w-4 h-4 text-pink-400" />
                    <h4 className="text-sm font-semibold text-white uppercase tracking-wide">Learning Status</h4>
                  </div>
                  
                  <div className="p-4 rounded-lg bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/20">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        {pulseScoreResult.status === 'optimized' ? (
                          <CheckCircle className="w-5 h-5 text-green-400" />
                        ) : pulseScoreResult.status === 'refining' ? (
                          <TrendingUp className="w-5 h-5 text-blue-400" />
                        ) : (
                          <Clock className="w-5 h-5 text-yellow-400 animate-pulse" />
                        )}
                        <span className="text-white font-medium capitalize">{pulseScoreResult.status}</span>
                      </div>
                      <span className="text-lg font-bold text-purple-400">
                        {Math.round(pulseScoreResult.confidence * 100)}% confidence
                      </span>
                    </div>
                    
                    {/* Confidence progress bar */}
                    <div className="h-2 bg-gray-700 rounded-full overflow-hidden mb-2">
                      <motion.div 
                        className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full"
                        initial={{ width: 0 }}
                        animate={{ width: `${pulseScoreResult.confidence * 100}%` }}
                        transition={{ duration: 0.8 }}
                      />
                    </div>
                    
                    <p className="text-xs text-gray-400">
                      {pulseScoreResult.status === 'learning' && 'Collecting data to understand your venue\'s optimal conditions...'}
                      {pulseScoreResult.status === 'refining' && 'Refining optimal ranges based on your venue\'s performance data...'}
                      {pulseScoreResult.status === 'optimized' && 'Score is fully optimized for your specific venue!'}
                    </p>
                    
                    <div className="mt-3 pt-3 border-t border-purple-500/20 text-xs text-center">
                      <span className="text-purple-400 font-medium">100% Venue-Specific</span>
                      <span className="text-gray-500 ml-2">— No generic industry baseline</span>
                    </div>
                  </div>
                </div>
              )}

              {/* No detailed breakdown available */}
              {!hasDetailedBreakdown && (
                <div className="text-center py-4">
                  <AlertCircle className="w-8 h-8 text-gray-500 mx-auto mb-2" />
                  <p className="text-sm text-gray-400">Detailed breakdown not available</p>
                  <p className="text-xs text-gray-500">Score is calculated from current sensor readings</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

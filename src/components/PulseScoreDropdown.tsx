import { useState, useEffect } from 'react';
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
  AlertCircle,
  Music
} from 'lucide-react';
import type { PulseScoreResult, SensorData } from '../types';
import songLogService from '../services/song-log.service';

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
  const [topGenre, setTopGenre] = useState<{ genre: string; avgDwellTime: number } | null>(null);

  const [currentGenre, setCurrentGenre] = useState<string | null>(null);
  const [genreScore, setGenreScore] = useState<number>(50); // Default 50 if unknown

  // Fetch top genre by dwell time and calculate genre score
  useEffect(() => {
    const fetchTopGenre = async () => {
      try {
        const genreStats = await songLogService.getGenreStats(10, '30d');
        if (genreStats && genreStats.length > 0) {
          // Sort by avgDwellTime to find the genre with longest dwell time
          const sorted = [...genreStats].sort((a, b) => b.avgDwellTime - a.avgDwellTime);
          const optimalGenre = sorted[0].genre;
          const maxDwell = sorted[0].avgDwellTime;
          
          setTopGenre({
            genre: optimalGenre,
            avgDwellTime: maxDwell
          });

          // Get current playing song's genre from sensor data
          const currentSongGenre = sensorData?.currentSong 
            ? songLogService.detectGenre(sensorData.currentSong, sensorData.artist || '')
            : null;
          
          setCurrentGenre(currentSongGenre);

          // Calculate genre score based on how well current genre matches optimal
          if (currentSongGenre) {
            if (currentSongGenre === optimalGenre) {
              setGenreScore(100); // Perfect match
            } else {
              // Find the current genre's dwell time and score proportionally
              const currentGenreStats = genreStats.find(g => g.genre === currentSongGenre);
              if (currentGenreStats && maxDwell > 0) {
                const score = Math.round((currentGenreStats.avgDwellTime / maxDwell) * 100);
                setGenreScore(Math.max(20, Math.min(100, score))); // Clamp between 20-100
              } else {
                setGenreScore(50); // Unknown genre gets 50
              }
            }
          } else {
            setGenreScore(50); // No current song
          }
        }
      } catch (error) {
        console.error('Error fetching genre stats:', error);
      }
    };
    fetchTopGenre();
  }, [sensorData?.currentSong, sensorData?.artist]);

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
      case 'genre': return Music;
      default: return AlertCircle;
    }
  };

  const getFactorLabel = (factor: string) => {
    switch (factor) {
      case 'sound': return 'Sound Level';
      case 'light': return 'Lighting';
      case 'temperature': return 'Outdoor Temp';
      case 'humidity': return 'Humidity';
      case 'genre': return 'Music Genre';
      default: return factor;
    }
  };

  const getFactorUnit = (factor: string) => {
    switch (factor) {
      case 'sound': return 'dB';
      case 'light': return 'lux';
      case 'temperature': return '°F';
      case 'humidity': return '%';
      case 'genre': return '';
      default: return '';
    }
  };

  const getCurrentValue = (factor: string): number | string | null => {
    if (!sensorData) return null;
    switch (factor) {
      case 'sound': return sensorData.decibels;
      case 'light': return sensorData.light;
      case 'temperature': return sensorData.outdoorTemp;
      case 'humidity': return sensorData.humidity;
      case 'genre': return currentGenre || 'None';
      default: return null;
    }
  };

  const getScoreIndicator = (score: number) => {
    if (score >= 85) return { icon: '✓', color: 'text-green-400', bg: 'bg-green-500/20' };
    if (score >= 70) return { icon: '⚠', color: 'text-yellow-400', bg: 'bg-yellow-500/20' };
    return { icon: '✗', color: 'text-red-400', bg: 'bg-red-500/20' };
  };

  // Default optimal ranges (used as fallback)
  const defaultRanges = {
    sound: { min: 70, max: 85 },
    temperature: { min: 68, max: 76 },
    light: { min: 200, max: 500 },
    humidity: { min: 40, max: 60 }
  };

  // Helper to calculate factor score
  const calculateFactorScore = (current: number, optimal: { min: number; max: number }): number => {
    if (!current || !optimal) return 50; // Default if missing
    if (current >= optimal.min && current <= optimal.max) return 100;
    const range = optimal.max - optimal.min;
    const tolerance = Math.max(range * 0.5, 10); // More forgiving tolerance
    if (current < optimal.min) {
      const deviation = optimal.min - current;
      return Math.max(0, Math.round(100 - (deviation / tolerance) * 100));
    }
    const deviation = current - optimal.max;
    return Math.max(0, Math.round(100 - (deviation / tolerance) * 100));
  };

  // Get factor scores - always calculate when we have sensor data
  const getFactorScores = () => {
    // If we have factor scores from the result, add genre to them
    if (pulseScoreResult?.breakdown?.factorScores) {
      return {
        ...pulseScoreResult.breakdown.factorScores,
        genre: genreScore
      };
    }
    
    // If we have sensor data, calculate factor scores
    if (sensorData) {
      // Use optimal ranges from result, or fall back to defaults
      const ranges = pulseScoreResult?.breakdown?.optimalRanges || defaultRanges;
      return {
        sound: calculateFactorScore(sensorData.decibels, ranges.sound),
        temperature: calculateFactorScore(sensorData.outdoorTemp, ranges.temperature),
        light: calculateFactorScore(sensorData.light, ranges.light),
        humidity: calculateFactorScore(sensorData.humidity, ranges.humidity),
        genre: genreScore
      };
    }
    
    // If we have a score but no sensor data, estimate from the score
    if (displayScore !== null && displayScore !== undefined) {
      // Estimate all factors are roughly equal to the overall score
      return {
        sound: displayScore,
        temperature: displayScore,
        light: displayScore,
        humidity: displayScore,
        genre: genreScore
      };
    }
    
    return null;
  };

  const factorScores = getFactorScores();

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
                  {['sound', 'light', 'temperature', 'humidity', 'genre'].map((factor) => {
                    const Icon = getFactorIcon(factor);
                    const factorScore = factorScores?.[factor as keyof typeof factorScores] ?? null;
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

              {/* Optimal Genre Info */}
              {topGenre && (
                <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/20">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Music className="w-4 h-4 text-purple-400" />
                      <span className="text-sm text-gray-300">
                        <span className="text-purple-400 font-semibold">{topGenre.genre}</span> = longest dwell ({topGenre.avgDwellTime}m avg)
                      </span>
                    </div>
                    {currentGenre && currentGenre === topGenre.genre && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400">
                        ✓ Playing now
                      </span>
                    )}
                    {currentGenre && currentGenre !== topGenre.genre && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400">
                        Now: {currentGenre}
                      </span>
                    )}
                  </div>
                </div>
              )}

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
                      { factor: 'sound', label: 'Sound', weight: 0.25, color: 'bg-cyan' },
                      { factor: 'temperature', label: 'Outdoor Temp', weight: 0.20, color: 'bg-red-400' },
                      { factor: 'light', label: 'Light', weight: 0.15, color: 'bg-yellow-400' },
                      { factor: 'humidity', label: 'Humidity', weight: 0.15, color: 'bg-blue-400' },
                      { factor: 'genre', label: 'Music Genre', weight: 0.25, color: 'bg-purple-400' }
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

              {/* Score Calculation Section - Always show when expanded */}
              {hasDetailedBreakdown && (
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <Calculator className="w-4 h-4 text-green-400" />
                    <h4 className="text-sm font-semibold text-white uppercase tracking-wide">Score Calculation</h4>
                  </div>
                  
                  <div className="p-4 rounded-lg bg-gray-800/50 border border-white/10">
                    {/* How It Works Blurb */}
                    <div className="mb-4 p-3 rounded-lg bg-white/5 border border-white/10">
                      <p className="text-sm text-gray-300 leading-relaxed">
                        <span className="text-cyan font-semibold">How it works:</span> Your Pulse Score is <span className="text-purple-400">100% based on dwell time</span>. We analyze your venue's historical data to find the exact environmental conditions (Sound, Temperature, Light, Humidity) that made guests stay the longest. These become your <span className="text-green-400">optimal ranges</span>. The closer your current conditions match those peak dwell-time conditions, the higher your score. <span className="text-yellow-400">Higher Pulse = Longer guest stays.</span>
                      </p>
                    </div>

                    {/* Live Formula Display */}
                    <div className="mb-4 p-3 rounded-lg bg-gradient-to-r from-cyan/10 to-purple-500/10 border border-cyan/20">
                      <p className="text-xs text-gray-400 mb-2">Live Formula (updates in real-time):</p>
                      {factorScores ? (
                        <>
                          <div className="font-mono text-sm text-white text-center overflow-x-auto">
                            <div className="inline-block min-w-max">
                              <span className="text-gray-400">Pulse = (</span>
                              <span className="text-cyan font-bold">{factorScores.sound}</span>
                              <span className="text-gray-400">×.25) + (</span>
                              <span className="text-red-400 font-bold">{factorScores.temperature}</span>
                              <span className="text-gray-400">×.20) + (</span>
                              <span className="text-yellow-400 font-bold">{factorScores.light}</span>
                              <span className="text-gray-400">×.15) + (</span>
                              <span className="text-blue-400 font-bold">{factorScores.humidity}</span>
                              <span className="text-gray-400">×.15) + (</span>
                              <span className="text-purple-400 font-bold">{factorScores.genre}</span>
                              <span className="text-gray-400">×.25)</span>
                            </div>
                          </div>
                          <div className="flex flex-wrap justify-center gap-3 mt-2 text-xs text-gray-500">
                            <span><span className="text-cyan">{factorScores.sound}</span> Sound</span>
                            <span><span className="text-red-400">{factorScores.temperature}</span> Temp</span>
                            <span><span className="text-yellow-400">{factorScores.light}</span> Light</span>
                            <span><span className="text-blue-400">{factorScores.humidity}</span> Humidity</span>
                            <span><span className="text-purple-400">{factorScores.genre}</span> Genre</span>
                          </div>
                        </>
                      ) : (
                        <div className="font-mono text-sm text-white text-center">
                          <span className="text-gray-400">Pulse = (</span>
                          <span className="text-cyan">Sound</span>
                          <span className="text-gray-400">×.25) + (</span>
                          <span className="text-red-400">Temp</span>
                          <span className="text-gray-400">×.20) + (</span>
                          <span className="text-yellow-400">Light</span>
                          <span className="text-gray-400">×.15) + (</span>
                          <span className="text-blue-400">Humidity</span>
                          <span className="text-gray-400">×.15) + (</span>
                          <span className="text-purple-400">Genre</span>
                          <span className="text-gray-400">×.25)</span>
                        </div>
                      )}
                    </div>

                    {/* Step by Step Calculation */}
                    <div className="space-y-2 font-mono text-sm">
                      <p className="text-xs text-gray-500 mb-2">Step-by-step breakdown:</p>
                      
                      {factorScores ? (
                        <>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="p-2 rounded bg-white/5">
                              <div className="text-xs text-gray-500 flex items-center gap-1">
                                <Volume2 className="w-3 h-3" /> Sound Score
                              </div>
                              <div className="text-white">
                                <span className="text-cyan">{factorScores.sound}</span>
                                <span className="text-gray-500"> × 0.25 = </span>
                                <span className="text-white font-medium">{(factorScores.sound * 0.25).toFixed(1)}</span>
                              </div>
                            </div>
                            <div className="p-2 rounded bg-white/5">
                              <div className="text-xs text-gray-500 flex items-center gap-1">
                                <Thermometer className="w-3 h-3" /> Outdoor Temp
                              </div>
                              <div className="text-white">
                                <span className="text-red-400">{factorScores.temperature}</span>
                                <span className="text-gray-500"> × 0.20 = </span>
                                <span className="text-white font-medium">{(factorScores.temperature * 0.20).toFixed(1)}</span>
                              </div>
                            </div>
                            <div className="p-2 rounded bg-white/5">
                              <div className="text-xs text-gray-500 flex items-center gap-1">
                                <Sun className="w-3 h-3" /> Light Score
                              </div>
                              <div className="text-white">
                                <span className="text-yellow-400">{factorScores.light}</span>
                                <span className="text-gray-500"> × 0.15 = </span>
                                <span className="text-white font-medium">{(factorScores.light * 0.15).toFixed(1)}</span>
                              </div>
                            </div>
                            <div className="p-2 rounded bg-white/5">
                              <div className="text-xs text-gray-500 flex items-center gap-1">
                                <Droplets className="w-3 h-3" /> Humidity Score
                              </div>
                              <div className="text-white">
                                <span className="text-blue-400">{factorScores.humidity}</span>
                                <span className="text-gray-500"> × 0.15 = </span>
                                <span className="text-white font-medium">{(factorScores.humidity * 0.15).toFixed(1)}</span>
                              </div>
                            </div>
                            <div className="p-2 rounded bg-white/5 col-span-2">
                              <div className="text-xs text-gray-500 flex items-center gap-1">
                                <Music className="w-3 h-3" /> Genre Score
                                {currentGenre && <span className="text-purple-400 ml-1">({currentGenre})</span>}
                                {topGenre && <span className="text-gray-600 ml-1">• Best: {topGenre.genre}</span>}
                              </div>
                              <div className="text-white">
                                <span className="text-purple-400">{factorScores.genre}</span>
                                <span className="text-gray-500"> × 0.25 = </span>
                                <span className="text-white font-medium">{(factorScores.genre * 0.25).toFixed(1)}</span>
                              </div>
                            </div>
                          </div>
                          
                          {/* Sum line */}
                          <div className="border-t border-white/10 pt-3 mt-3">
                            <div className="flex items-center justify-between">
                              <div className="text-gray-400 text-xs">
                                {(factorScores.sound * 0.25).toFixed(1)} + {(factorScores.temperature * 0.20).toFixed(1)} + {(factorScores.light * 0.15).toFixed(1)} + {(factorScores.humidity * 0.15).toFixed(1)} + {(factorScores.genre * 0.25).toFixed(1)}
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-gray-400">=</span>
                                <span className={`text-2xl font-bold ${colors.text}`}>
                                  {Math.round(
                                    (factorScores.sound * 0.25) + 
                                    (factorScores.temperature * 0.20) + 
                                    (factorScores.light * 0.15) + 
                                    (factorScores.humidity * 0.15) + 
                                    (factorScores.genre * 0.25)
                                  )}
                                </span>
                              </div>
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="text-center py-4 text-gray-500">
                          <p className="text-sm">Awaiting sensor data...</p>
                        </div>
                      )}
                    </div>
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

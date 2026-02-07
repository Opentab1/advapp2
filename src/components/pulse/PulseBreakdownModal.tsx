/**
 * PulseBreakdownModal - Deep dive into Pulse Score
 * 
 * Shows:
 * - Overall score with clear status
 * - YOUR BEST NIGHT comparison (when available)
 * - Factor breakdown: Sound (40%), Light (25%), Crowd (20%), Music (15%)
 * - Context-aware based on time/day
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Modal } from '../common/Modal';
import { Volume2, Sun, Info, Target, AlertTriangle, CheckCircle2, Clock, ChevronRight, Trophy, Users, Timer, TrendingUp, Music } from 'lucide-react';
import { FACTOR_WEIGHTS, SCORE_THRESHOLDS, TIME_SLOT_RANGES, OPTIMAL_CROWD, type TimeSlot } from '../../utils/constants';
import { AnimatedNumber } from '../common/AnimatedNumber';
import { getCurrentTimeSlot } from '../../utils/scoring';
import { FactorDeepDiveModal, type FactorType } from './FactorDeepDiveModal';
import type { BestNightProfile } from '../../services/venue-learning.service';

interface PulseBreakdownModalProps {
  isOpen: boolean;
  onClose: () => void;
  pulseScore: number | null;
  pulseStatusLabel: string;
  soundScore: number;
  lightScore: number;
  crowdScore: number;
  musicScore: number;
  currentDecibels: number | null;
  currentLight: number | null;
  currentOccupancy?: number | null;
  estimatedCapacity?: number;
  currentSong?: string | null;
  detectedGenres?: string[];
  timeSlot?: string;
  // Best Night comparison data
  bestNight?: BestNightProfile | null;
  isUsingHistoricalData?: boolean;
  proximityToBest?: number | null;
}

export function PulseBreakdownModal({
  isOpen,
  onClose,
  pulseScore,
  pulseStatusLabel,
  soundScore,
  lightScore,
  crowdScore,
  musicScore,
  currentDecibels,
  currentLight,
  currentOccupancy,
  estimatedCapacity = 100,
  currentSong,
  detectedGenres = [],
  timeSlot: timeSlotProp,
  bestNight,
  isUsingHistoricalData,
  proximityToBest,
}: PulseBreakdownModalProps) {
  const [selectedFactor, setSelectedFactor] = useState<FactorType | null>(null);
  
  const timeSlot = (timeSlotProp as TimeSlot) || getCurrentTimeSlot();
  const ranges = TIME_SLOT_RANGES[timeSlot];
  const crowdRange = OPTIMAL_CROWD[timeSlot];
  
  const formatBestNightDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  
  const slotLabels: Record<TimeSlot, string> = {
    weekday_happy_hour: 'Happy Hour',
    weekday_night: 'Weeknight',
    friday_early: 'Friday Evening',
    friday_peak: 'Friday Night',
    saturday_early: 'Saturday Evening',
    saturday_peak: 'Saturday Night',
    sunday_funday: 'Sunday Funday',
    daytime: 'Daytime',
  };
  
  const getStatusStyle = (score: number | null) => {
    if (score === null) return 'bg-warm-700 text-warm-300';
    if (score >= SCORE_THRESHOLDS.optimal) return 'bg-green-900/30 text-green-400';
    if (score >= SCORE_THRESHOLDS.good) return 'bg-amber-900/30 text-amber-400';
    return 'bg-red-900/30 text-red-400';
  };
  
  const getStatusIcon = (score: number | null) => {
    if (score === null) return null;
    if (score >= SCORE_THRESHOLDS.optimal) return CheckCircle2;
    if (score >= SCORE_THRESHOLDS.good) return Target;
    return AlertTriangle;
  };
  
  const StatusIcon = getStatusIcon(pulseScore);
  
  // Generate insights
  const soundInsight = getSoundInsight(currentDecibels, soundScore, ranges.sound);
  const lightInsight = getLightInsight(currentLight, lightScore, ranges.light);
  const crowdInsight = getCrowdInsight(currentOccupancy, estimatedCapacity, crowdScore, crowdRange);
  const musicInsight = getMusicInsight(musicScore, detectedGenres, bestNight?.detectedGenres || []);
  
  const occupancyPercent = currentOccupancy && estimatedCapacity > 0 
    ? Math.round((currentOccupancy / estimatedCapacity) * 100) 
    : null;
  
  return (
    <>
    <Modal isOpen={isOpen} onClose={onClose} title="Pulse Score">
      <div className="space-y-6">
        {/* Main Score Hero */}
        <div className="text-center py-6 bg-warm-700/50 rounded-2xl -mx-2">
          <div className="flex items-center justify-center gap-3 mb-2">
            {StatusIcon && (
              <StatusIcon className={`w-8 h-8 ${
                pulseScore !== null && pulseScore >= SCORE_THRESHOLDS.optimal ? 'text-green-500' :
                pulseScore !== null && pulseScore >= SCORE_THRESHOLDS.good ? 'text-amber-500' : 'text-red-500'
              }`} />
            )}
            <AnimatedNumber
              value={pulseScore}
              className="text-6xl font-bold text-warm-100"
            />
          </div>
          <p className={`inline-block px-4 py-1.5 rounded-full text-sm font-semibold ${getStatusStyle(pulseScore)}`}>
            {pulseStatusLabel}
          </p>
          
          <p className="text-xs text-warm-500 mt-2">
            <Clock className="w-3 h-3 inline mr-1" />
            Optimized for {slotLabels[timeSlot]}
          </p>
          
          <p className="text-sm text-warm-400 mt-2 px-4">
            {isUsingHistoricalData && bestNight
              ? pulseScore !== null && pulseScore >= SCORE_THRESHOLDS.optimal
                ? `You're matching your best ${bestNight.dayOfWeek}!`
                : `Get closer to your best ${bestNight.dayOfWeek}'s formula`
              : pulseScore !== null && pulseScore >= SCORE_THRESHOLDS.optimal
              ? 'Your venue atmosphere is ideal for guests right now.'
              : pulseScore !== null && pulseScore >= SCORE_THRESHOLDS.good
              ? 'Good conditions. Small tweaks could make it perfect.'
              : 'Some adjustments needed for optimal guest experience.'}
          </p>
          
          {isUsingHistoricalData && proximityToBest !== null && (
            <div className="mt-3">
              <p className="text-xs text-warm-500 mb-1">Match to your best: {proximityToBest}%</p>
              <div className="w-40 mx-auto h-1.5 bg-warm-600 rounded-full overflow-hidden">
                <motion.div
                  className="h-full rounded-full bg-primary"
                  initial={{ width: 0 }}
                  animate={{ width: `${proximityToBest}%` }}
                  transition={{ duration: 0.5 }}
                />
              </div>
            </div>
          )}
        </div>
        
        {/* YOUR BEST NIGHT SECTION */}
        {bestNight && (
          <div className="bg-gradient-to-br from-amber-900/20 to-yellow-900/10 rounded-2xl border border-amber-800/30 p-4 -mx-2">
            <div className="flex items-center gap-2 mb-4">
              <Trophy className="w-5 h-5 text-amber-400" />
              <h4 className="text-sm font-bold text-amber-300 uppercase tracking-wide">
                Your Best {bestNight.dayOfWeek}
              </h4>
              <span className="text-xs text-amber-500 ml-auto">
                {formatBestNightDate(bestNight.date)}
              </span>
            </div>
            
            {/* Best Night Stats */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-warm-800/50 rounded-lg p-3 text-center">
                <Users className="w-4 h-4 text-amber-400 mx-auto mb-1" />
                <p className="text-lg font-bold text-warm-100">{bestNight.totalGuests}</p>
                <p className="text-[10px] text-warm-400 uppercase">Total Guests</p>
              </div>
              <div className="bg-warm-800/50 rounded-lg p-3 text-center">
                <Timer className="w-4 h-4 text-amber-400 mx-auto mb-1" />
                <p className="text-lg font-bold text-warm-100">{bestNight.avgDwellMinutes}m</p>
                <p className="text-[10px] text-warm-400 uppercase">Avg Stay</p>
              </div>
            </div>
            
            {/* Conditions Comparison */}
            <div className="space-y-2">
              <p className="text-xs text-warm-400 font-medium mb-2">That night's conditions:</p>
              
              {/* Sound */}
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <Volume2 className="w-4 h-4 text-warm-500" />
                  <span className="text-warm-300">Sound</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-amber-400 font-semibold">{bestNight.avgSound}dB</span>
                  {currentDecibels !== null && (
                    <span className={`text-xs ${
                      Math.abs(currentDecibels - bestNight.avgSound) <= 3 ? 'text-green-400' : 'text-warm-500'
                    }`}>
                      (You: {currentDecibels.toFixed(0)}dB)
                    </span>
                  )}
                </div>
              </div>
              
              {/* Light */}
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <Sun className="w-4 h-4 text-warm-500" />
                  <span className="text-warm-300">Light</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-amber-400 font-semibold">{bestNight.avgLight} lux</span>
                  {currentLight !== null && (
                    <span className={`text-xs ${
                      Math.abs(currentLight - bestNight.avgLight) <= 30 ? 'text-green-400' : 'text-warm-500'
                    }`}>
                      (You: {currentLight.toFixed(0)} lux)
                    </span>
                  )}
                </div>
              </div>
              
              {/* Music/Genres */}
              {bestNight.detectedGenres && bestNight.detectedGenres.length > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <Music className="w-4 h-4 text-warm-500" />
                    <span className="text-warm-300">Music</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-amber-400 font-semibold">
                      {bestNight.detectedGenres.slice(0, 2).join(', ')}
                    </span>
                  </div>
                </div>
              )}
              
              {/* Peak Hour */}
              {bestNight.peakHour !== undefined && (
                <div className="flex items-center justify-between text-sm mt-2 pt-2 border-t border-warm-700/50">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-warm-500" />
                    <span className="text-warm-300">Peak Hour</span>
                  </div>
                  <span className="text-amber-400 font-semibold">
                    {bestNight.peakHour > 12 ? `${bestNight.peakHour - 12}pm` : bestNight.peakHour === 12 ? '12pm' : `${bestNight.peakHour}am`}
                    {bestNight.peakOccupancy > 0 && ` (${bestNight.peakOccupancy} people)`}
                  </span>
                </div>
              )}
            </div>
            
            {/* Recommendation */}
            {proximityToBest != null && proximityToBest < 80 && (
              <div className="mt-4 p-3 bg-warm-800/50 rounded-lg">
                <p className="text-xs text-warm-300">
                  💡 <span className="font-medium">To recreate this night:</span>{' '}
                  {currentDecibels !== null && Math.abs(currentDecibels - bestNight.avgSound) > 3 && (
                    <>Adjust sound to ~{bestNight.avgSound}dB. </>
                  )}
                  {currentLight !== null && Math.abs(currentLight - bestNight.avgLight) > 30 && (
                    <>Set lighting to ~{bestNight.avgLight} lux. </>
                  )}
                  {bestNight.detectedGenres && bestNight.detectedGenres.length > 0 && (
                    <>Play {bestNight.detectedGenres[0]}. </>
                  )}
                </p>
              </div>
            )}
          </div>
        )}
        
        {/* Score Breakdown */}
        <div>
          <h4 className="text-xs font-semibold text-warm-400 uppercase tracking-wide mb-3">
            Score Breakdown
          </h4>
          
          <p className="text-xs text-warm-500 mb-3">Tap any factor for deeper insights →</p>
          
          <div className="space-y-3">
            {/* Sound Factor - 40% (hide if no sound data) */}
            {currentDecibels !== null && currentDecibels !== 0 && (
              <FactorCard
                icon={Volume2}
                label="Sound"
                weight={Math.round(FACTOR_WEIGHTS.sound * 100)}
                score={soundScore}
                currentValue={`${currentDecibels.toFixed(0)} dB`}
                optimalRange={`${ranges.sound.min}-${ranges.sound.max} dB`}
                insight={soundInsight}
                onTap={() => setSelectedFactor('sound')}
                bestNightValue={bestNight ? `${bestNight.avgSound} dB` : undefined}
                isUsingHistoricalData={isUsingHistoricalData}
              />
            )}
            
            {/* Light Factor - 25% (hide if no light sensor, e.g., Pi Zero 2W) */}
            {currentLight !== null && currentLight > 0 && (
              <FactorCard
                icon={Sun}
                label="Light"
                weight={Math.round(FACTOR_WEIGHTS.light * 100)}
                score={lightScore}
                currentValue={`${currentLight.toFixed(0)} lux`}
                optimalRange={`${ranges.light.min}-${ranges.light.max} lux`}
                insight={lightInsight}
                onTap={() => setSelectedFactor('light')}
                bestNightValue={bestNight ? `${bestNight.avgLight} lux` : undefined}
                isUsingHistoricalData={isUsingHistoricalData}
              />
            )}
            
            {/* Crowd Factor - 20% */}
            <FactorCard
              icon={Users}
              label="Crowd"
              weight={Math.round(FACTOR_WEIGHTS.crowd * 100)}
              score={crowdScore}
              currentValue={occupancyPercent !== null ? `${occupancyPercent}% full` : '--'}
              optimalRange={`${crowdRange.min}-${crowdRange.max}%`}
              insight={crowdInsight}
              onTap={() => setSelectedFactor('vibe')}
            />
            
            {/* Music Factor - 15% */}
            <FactorCard
              icon={Music}
              label="Music"
              weight={Math.round(FACTOR_WEIGHTS.music * 100)}
              score={musicScore}
              currentValue={detectedGenres.length > 0 ? detectedGenres[0] : (currentSong || '--')}
              optimalRange={bestNight?.detectedGenres?.join(', ') || ranges.genres.slice(0, 2).join(', ')}
              insight={musicInsight}
              bestNightValue={bestNight?.detectedGenres?.slice(0, 2).join(', ')}
              isUsingHistoricalData={isUsingHistoricalData && (bestNight?.detectedGenres?.length ?? 0) > 0}
            />
          </div>
        </div>
        
        {/* How it's calculated */}
        <div className="bg-warm-700/50 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Info className="w-4 h-4 text-warm-400" />
            <h4 className="text-xs font-semibold text-warm-400 uppercase tracking-wide">
              How It's Calculated
            </h4>
          </div>
          
          <div className="space-y-1.5 text-sm">
            {currentDecibels !== null && currentDecibels !== 0 && (
              <div className="flex justify-between text-warm-300">
                <span>Sound × {Math.round(FACTOR_WEIGHTS.sound * 100)}%</span>
                <span className="font-medium text-warm-100">{(soundScore * FACTOR_WEIGHTS.sound).toFixed(0)}</span>
              </div>
            )}
            {currentLight !== null && currentLight > 0 && (
              <div className="flex justify-between text-warm-300">
                <span>Light × {Math.round(FACTOR_WEIGHTS.light * 100)}%</span>
                <span className="font-medium text-warm-100">{(lightScore * FACTOR_WEIGHTS.light).toFixed(0)}</span>
              </div>
            )}
            <div className="flex justify-between text-warm-300">
              <span>Crowd × {Math.round(FACTOR_WEIGHTS.crowd * 100)}%</span>
              <span className="font-medium text-warm-100">{(crowdScore * FACTOR_WEIGHTS.crowd).toFixed(0)}</span>
            </div>
            <div className="flex justify-between text-warm-300">
              <span>Music × {Math.round(FACTOR_WEIGHTS.music * 100)}%</span>
              <span className="font-medium text-warm-100">{(musicScore * FACTOR_WEIGHTS.music).toFixed(0)}</span>
            </div>
            <div className="flex justify-between pt-2 border-t border-warm-600 font-semibold text-warm-100">
              <span>Pulse Score</span>
              <span>{pulseScore ?? '--'}</span>
            </div>
          </div>
        </div>
        
        {/* Score thresholds reference */}
        <div className="flex justify-center gap-4 text-xs text-warm-400">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
            <span>85+ Optimal</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
            <span>60-84 Good</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
            <span>&lt;60 Adjust</span>
          </div>
        </div>
      </div>
    </Modal>
    
    {/* Factor Deep Dive Modal */}
    <FactorDeepDiveModal
      isOpen={selectedFactor !== null}
      onClose={() => setSelectedFactor(null)}
      factor={selectedFactor || 'sound'}
      currentValue={
        selectedFactor === 'sound' ? currentDecibels :
        selectedFactor === 'light' ? currentLight :
        null
      }
      score={
        selectedFactor === 'sound' ? soundScore :
        selectedFactor === 'light' ? lightScore :
        crowdScore
      }
      timeSlot={timeSlot}
    />
    </>
  );
}

// ============ FACTOR CARD ============

interface FactorCardProps {
  icon: typeof Volume2;
  label: string;
  weight: number;
  score: number;
  currentValue: string;
  optimalRange: string;
  insight: { status: 'optimal' | 'warning' | 'critical'; message: string; action?: string };
  onTap?: () => void;
  bestNightValue?: string;
  isUsingHistoricalData?: boolean;
}

function FactorCard({ icon: Icon, label, weight, score, currentValue, optimalRange, insight, onTap, bestNightValue, isUsingHistoricalData }: FactorCardProps) {
  const statusColors = {
    optimal: 'bg-green-500',
    warning: 'bg-amber-500',
    critical: 'bg-red-500',
  };
  
  const statusBg = {
    optimal: 'bg-green-900/20 border-green-900/30 hover:bg-green-900/30',
    warning: 'bg-amber-900/20 border-amber-900/30 hover:bg-amber-900/30',
    critical: 'bg-red-900/20 border-red-900/30 hover:bg-red-900/30',
  };
  
  const textColors = {
    optimal: 'text-green-400',
    warning: 'text-amber-400',
    critical: 'text-red-400',
  };
  
  return (
    <button 
      onClick={onTap}
      className={`w-full text-left rounded-xl border p-4 ${statusBg[insight.status]} transition-all active:scale-[0.98] cursor-pointer`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-warm-700/50 flex items-center justify-center">
            <Icon className="w-4.5 h-4.5 text-warm-300" />
          </div>
          <div>
            <h5 className="text-sm font-semibold text-warm-100">{label}</h5>
            <span className="text-xs text-warm-400">{weight}% of score</span>
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-warm-100">{score}</p>
          <p className="text-xs text-warm-400">/ 100</p>
        </div>
      </div>
      
      <div className="h-2 bg-warm-600 rounded-full overflow-hidden mb-3">
        <motion.div
          className={`h-full rounded-full ${statusColors[insight.status]}`}
          initial={{ width: 0 }}
          animate={{ width: `${score}%` }}
          transition={{ duration: 0.5, delay: 0.1 }}
        />
      </div>
      
      <div className="flex justify-between text-xs mb-3">
        <div>
          <span className="text-warm-400">Current: </span>
          <span className="font-medium text-warm-200">{currentValue}</span>
        </div>
        <div>
          {isUsingHistoricalData && bestNightValue ? (
            <>
              <span className="text-amber-400">Your Best: </span>
              <span className="font-medium text-amber-300">{bestNightValue}</span>
            </>
          ) : (
            <>
              <span className="text-warm-400">Optimal: </span>
              <span className="font-medium text-warm-200">{optimalRange}</span>
            </>
          )}
        </div>
      </div>
      
      <div className="flex items-start justify-between">
        <div className={`text-sm ${textColors[insight.status]} flex-1`}>
          <p className="font-medium">{insight.message}</p>
          {insight.action && (
            <p className="text-xs mt-1 opacity-80">→ {insight.action}</p>
          )}
        </div>
        <ChevronRight className="w-4 h-4 text-warm-500 mt-0.5 flex-shrink-0" />
      </div>
    </button>
  );
}

// ============ INSIGHT GENERATORS ============

type InsightResult = { status: 'optimal' | 'warning' | 'critical'; message: string; action?: string };

function getSoundInsight(db: number | null, score: number, range: { min: number; max: number }): InsightResult {
  if (db === null) {
    return { status: 'warning', message: 'No sound data', action: 'Check sensor' };
  }
  if (score >= 85) return { status: 'optimal', message: 'Perfect energy level' };
  if (db > range.max) {
    return { status: db - range.max > 10 ? 'critical' : 'warning', message: 'Too loud', action: 'Lower music' };
  }
  if (db < range.min) {
    return { status: 'warning', message: 'Too quiet', action: 'Add more energy' };
  }
  return { status: 'optimal', message: 'Sound is good' };
}

function getLightInsight(lux: number | null, score: number, range: { min: number; max: number }): InsightResult {
  if (lux === null) {
    return { status: 'warning', message: 'No light data', action: 'Check sensor' };
  }
  if (score >= 85) return { status: 'optimal', message: 'Perfect ambiance' };
  if (lux > range.max) return { status: 'warning', message: 'Too bright', action: 'Dim the lights' };
  if (lux < range.min) return { status: 'warning', message: 'Too dark', action: 'Brighten up' };
  return { status: 'optimal', message: 'Lighting is good' };
}

function getCrowdInsight(
  occupancy: number | null | undefined, 
  capacity: number, 
  score: number,
  range: { min: number; max: number }
): InsightResult {
  if (occupancy === null || occupancy === undefined) {
    return { status: 'warning', message: 'No crowd data' };
  }
  const percent = Math.round((occupancy / capacity) * 100);
  if (score >= 85) return { status: 'optimal', message: `Perfect crowd level (${percent}%)` };
  if (percent < range.min) return { status: 'warning', message: `Quiet (${percent}%)`, action: 'Building up' };
  if (percent > range.max) return { status: 'warning', message: `Very busy (${percent}%)` };
  return { status: 'optimal', message: `Good crowd (${percent}%)` };
}

function getMusicInsight(score: number, detectedGenres: string[], bestNightGenres: string[]): InsightResult {
  if (detectedGenres.length === 0) {
    return { status: 'warning', message: 'No music detected', action: 'Playing music?' };
  }
  if (score >= 90) {
    return { status: 'optimal', message: `${detectedGenres[0]} - perfect match!` };
  }
  if (score >= 70) {
    return { status: 'optimal', message: `Playing ${detectedGenres[0]}` };
  }
  if (bestNightGenres.length > 0) {
    return { status: 'warning', message: `Different from your best`, action: `Try ${bestNightGenres[0]}` };
  }
  return { status: 'optimal', message: `Playing ${detectedGenres[0]}` };
}

export default PulseBreakdownModal;

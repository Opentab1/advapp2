/**
 * FactorDeepDiveModal - WHOOP-style Level 3 deep dive for Pulse Score factors
 * 
 * Shows detailed analysis for each factor:
 * - Sound: dB trends, optimal ranges, impact on guest behavior
 * - Light: Lux levels, time-appropriate ambiance
 * - Comfort: Temperature analysis, crowd heat impact
 * - Music: Genre fit, what's working
 * - Vibe: Overall alignment, what's dragging score down
 */

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Modal } from '../common/Modal';
import { 
  Volume2, Sun, Thermometer, Music, Sparkles,
  TrendingUp, Target, Clock,
  CheckCircle, AlertTriangle, Lightbulb
} from 'lucide-react';
import { AreaChart, HorizontalBar } from '../common/MiniChart';
import { TIME_SLOT_RANGES, FACTOR_WEIGHTS, type TimeSlot } from '../../utils/constants';
import { getCurrentTimeSlot } from '../../utils/scoring';

// ============ TYPES ============

export type FactorType = 'sound' | 'light' | 'comfort' | 'music' | 'vibe';

interface FactorDeepDiveModalProps {
  isOpen: boolean;
  onClose: () => void;
  factor: FactorType;
  // Current values
  currentValue: number | null;
  score: number;
  // Context
  timeSlot?: TimeSlot;
  // Optional historical data for charts
  recentValues?: number[];
  // Additional context
  currentSong?: string | null;
  artist?: string | null;
  outdoorTemp?: number | null;
}

// ============ FACTOR CONFIG ============

const FACTOR_CONFIG: Record<FactorType, {
  title: string;
  icon: typeof Volume2;
  unit: string;
  color: string;
  gradient: string;
}> = {
  sound: {
    title: 'Sound Level',
    icon: Volume2,
    unit: 'dB',
    color: '#0093E7',
    gradient: 'from-blue-500/20 to-blue-900/10',
  },
  light: {
    title: 'Lighting',
    icon: Sun,
    unit: 'lux',
    color: '#FFDE00',
    gradient: 'from-yellow-500/20 to-yellow-900/10',
  },
  comfort: {
    title: 'Comfort',
    icon: Thermometer,
    unit: '°F',
    color: '#FF6B6B',
    gradient: 'from-red-500/20 to-red-900/10',
  },
  music: {
    title: 'Music Fit',
    icon: Music,
    unit: '',
    color: '#A855F7',
    gradient: 'from-purple-500/20 to-purple-900/10',
  },
  vibe: {
    title: 'Vibe Match',
    icon: Sparkles,
    unit: '',
    color: '#00F19F',
    gradient: 'from-primary/20 to-primary/10',
  },
};

// ============ MAIN COMPONENT ============

export function FactorDeepDiveModal({
  isOpen,
  onClose,
  factor,
  currentValue,
  score,
  timeSlot: providedTimeSlot,
  recentValues,
  currentSong,
  artist,
  outdoorTemp,
}: FactorDeepDiveModalProps) {
  const config = FACTOR_CONFIG[factor];
  const Icon = config.icon;
  const timeSlot = providedTimeSlot || getCurrentTimeSlot();
  const ranges = TIME_SLOT_RANGES[timeSlot];
  
  // Get optimal range for this factor
  const optimalRange = useMemo(() => {
    switch (factor) {
      case 'sound':
        return ranges.sound;
      case 'light':
        return ranges.light;
      case 'comfort':
        return { min: 68, max: outdoorTemp && outdoorTemp > 80 ? 72 : 74 };
      default:
        return { min: 0, max: 100 };
    }
  }, [factor, ranges, outdoorTemp]);
  
  // Determine status
  const status = useMemo(() => {
    if (score >= 85) return { label: 'Optimal', color: 'text-green-400', bg: 'bg-green-900/30', icon: CheckCircle };
    if (score >= 60) return { label: 'Good', color: 'text-amber-400', bg: 'bg-amber-900/30', icon: Target };
    return { label: 'Needs Attention', color: 'text-red-400', bg: 'bg-red-900/30', icon: AlertTriangle };
  }, [score]);
  
  // Generate chart data
  const chartData = useMemo(() => {
    if (!recentValues || recentValues.length === 0) {
      // Generate mock trend data based on current value
      return generateMockTrendData(currentValue, factor, timeSlot);
    }
    
    const now = new Date();
    return recentValues.map((value, i) => {
      const hoursAgo = recentValues.length - 1 - i;
      const hour = (now.getHours() - hoursAgo + 24) % 24;
      return {
        label: formatHour(hour),
        value,
        isCurrent: i === recentValues.length - 1,
      };
    });
  }, [recentValues, currentValue, factor, timeSlot]);
  
  // Get factor-specific content
  const content = useMemo(() => {
    return getFactorContent(factor, currentValue, score, optimalRange, timeSlot, currentSong, artist);
  }, [factor, currentValue, score, optimalRange, timeSlot, currentSong, artist]);
  
  const StatusIcon = status.icon;
  
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={config.title}>
      <div className="space-y-5">
        
        {/* ============ HERO ============ */}
        <div className={`text-center py-5 bg-gradient-to-b ${config.gradient} rounded-2xl -mx-2`}>
          <div className="flex items-center justify-center gap-3 mb-2">
            <Icon className="w-7 h-7" style={{ color: config.color }} />
            <span className="text-4xl font-bold text-warm-100">
              {currentValue !== null ? currentValue.toFixed(0) : '--'}
              <span className="text-lg text-warm-400 ml-1">{config.unit}</span>
            </span>
          </div>
          
          {/* Score pill */}
          <div className="flex items-center justify-center gap-2 mb-2">
            <span className="text-sm text-warm-400">Score:</span>
            <span className="text-2xl font-bold" style={{ color: config.color }}>{score}</span>
            <span className="text-sm text-warm-500">/ 100</span>
          </div>
          
          {/* Status badge */}
          <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full ${status.bg}`}>
            <StatusIcon className={`w-3.5 h-3.5 ${status.color}`} />
            <span className={`text-xs font-semibold ${status.color}`}>{status.label}</span>
          </div>
          
          {/* Weight info */}
          <p className="text-xs text-warm-500 mt-2">
            {Math.round(FACTOR_WEIGHTS[factor === 'comfort' ? 'temperature' : factor === 'music' ? 'vibe' : factor as keyof typeof FACTOR_WEIGHTS] * 100)}% of your Pulse Score
          </p>
        </div>
        
        {/* ============ OPTIMAL RANGE ============ */}
        {(factor === 'sound' || factor === 'light' || factor === 'comfort') && (
          <div className="bg-warm-800/50 rounded-xl p-4 border border-warm-700/50">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-warm-300">Current vs Optimal</span>
              <span className="text-xs text-warm-500">
                for {getTimeSlotLabel(timeSlot)}
              </span>
            </div>
            
            <div className="relative h-8 bg-warm-700 rounded-full overflow-hidden">
              {/* Optimal zone */}
              <div
                className="absolute h-full opacity-30"
                style={{
                  left: `${(optimalRange.min / (optimalRange.max * 1.5)) * 100}%`,
                  width: `${((optimalRange.max - optimalRange.min) / (optimalRange.max * 1.5)) * 100}%`,
                  backgroundColor: config.color,
                }}
              />
              
              {/* Current value marker */}
              {currentValue !== null && (
                <motion.div
                  className="absolute top-0 h-full w-1 rounded-full"
                  style={{ backgroundColor: config.color }}
                  initial={{ left: '0%' }}
                  animate={{ 
                    left: `${Math.min(100, (currentValue / (optimalRange.max * 1.5)) * 100)}%` 
                  }}
                  transition={{ duration: 0.5 }}
                />
              )}
            </div>
            
            <div className="flex justify-between mt-2 text-xs">
              <span className="text-warm-500">0{config.unit}</span>
              <span className="text-warm-400">
                Optimal: {optimalRange.min}-{optimalRange.max}{config.unit}
              </span>
              <span className="text-warm-500">{Math.round(optimalRange.max * 1.5)}{config.unit}</span>
            </div>
          </div>
        )}
        
        {/* ============ TREND CHART ============ */}
        <div className="bg-warm-800/50 rounded-xl p-4 border border-warm-700/50">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4" style={{ color: config.color }} />
              <span className="text-sm font-medium text-warm-200">Tonight's Trend</span>
            </div>
            <span className="text-xs text-warm-500">Last few hours</span>
          </div>
          
          <AreaChart
            data={chartData}
            height={120}
            color={config.color}
            showLabels={true}
            animationDelay={0.1}
          />
        </div>
        
        {/* ============ INSIGHTS ============ */}
        <div className="bg-warm-800/50 rounded-xl p-4 border border-warm-700/50">
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-medium text-warm-200">Insights</span>
          </div>
          
          <div className="space-y-2">
            {content.insights.map((insight, i) => (
              <InsightRow key={i} icon={insight.icon} text={insight.text} type={insight.type} />
            ))}
          </div>
        </div>
        
        {/* ============ RECOMMENDATION ============ */}
        {content.recommendation && (
          <div 
            className="rounded-xl p-4 border"
            style={{ 
              backgroundColor: `${config.color}15`,
              borderColor: `${config.color}30`
            }}
          >
            <div className="flex items-start gap-3">
              <Target className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: config.color }} />
              <div>
                <p className="text-sm font-medium text-warm-100 mb-1">Recommendation</p>
                <p className="text-sm text-warm-300">{content.recommendation}</p>
              </div>
            </div>
          </div>
        )}
        
        {/* ============ FACTOR-SPECIFIC EXTRA ============ */}
        {content.extra}
        
        {/* ============ HISTORICAL COMPARISON ============ */}
        <div className="bg-warm-800/50 rounded-xl p-4 border border-warm-700/50">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-4 h-4 text-warm-400" />
            <span className="text-sm font-medium text-warm-200">Your Typical {config.title}</span>
          </div>
          
          <div className="space-y-2">
            <HorizontalBar 
              label="Weekday avg" 
              value={getTypicalValue(factor, 'weekday')} 
              maxValue={optimalRange.max * 1.2} 
              color="#6b7280"
              suffix={config.unit}
            />
            <HorizontalBar 
              label="Friday avg" 
              value={getTypicalValue(factor, 'friday')} 
              maxValue={optimalRange.max * 1.2} 
              color="#f59e0b"
              suffix={config.unit}
            />
            <HorizontalBar 
              label="Saturday avg" 
              value={getTypicalValue(factor, 'saturday')} 
              maxValue={optimalRange.max * 1.2} 
              color={config.color}
              suffix={config.unit}
            />
          </div>
        </div>
        
        {/* Footer */}
        <p className="text-xs text-warm-600 text-center">
          Updates in real-time • Historical data helps personalize insights
        </p>
      </div>
    </Modal>
  );
}

// ============ INSIGHT ROW ============

interface InsightRowProps {
  icon: string;
  text: string;
  type?: 'positive' | 'neutral' | 'warning';
}

function InsightRow({ icon, text, type = 'neutral' }: InsightRowProps) {
  const colors = {
    positive: 'text-green-400',
    neutral: 'text-warm-300',
    warning: 'text-amber-400',
  };
  
  return (
    <div className="flex items-start gap-2">
      <span className="text-sm">{icon}</span>
      <span className={`text-sm ${colors[type]}`}>{text}</span>
    </div>
  );
}

// ============ CONTENT GENERATORS ============

interface FactorContent {
  insights: Array<{ icon: string; text: string; type?: 'positive' | 'neutral' | 'warning' }>;
  recommendation: string | null;
  extra?: React.ReactNode;
}

function getFactorContent(
  factor: FactorType,
  value: number | null,
  score: number,
  optimalRange: { min: number; max: number },
  timeSlot: TimeSlot,
  currentSong?: string | null,
  artist?: string | null
): FactorContent {
  switch (factor) {
    case 'sound':
      return getSoundContent(value, score, optimalRange, timeSlot);
    case 'light':
      return getLightContent(value, score, optimalRange, timeSlot);
    case 'comfort':
      return getComfortContent(value, score, optimalRange);
    case 'music':
      return getMusicContent(score, timeSlot, currentSong, artist);
    case 'vibe':
      return getVibeContent(score, timeSlot);
    default:
      return { insights: [], recommendation: null };
  }
}

function getSoundContent(
  db: number | null, 
  score: number, 
  range: { min: number; max: number },
  _timeSlot: TimeSlot
): FactorContent {
  const insights: FactorContent['insights'] = [];
  let recommendation: string | null = null;
  
  if (db === null) {
    insights.push({ icon: '⚠️', text: 'No sound data available', type: 'warning' });
    recommendation = 'Check if your sound sensor is working correctly.';
  } else if (score >= 85) {
    insights.push({ icon: '✅', text: 'Perfect energy level for this time', type: 'positive' });
    insights.push({ icon: '📊', text: 'Guests typically stay 15% longer at this level', type: 'positive' });
    insights.push({ icon: '💡', text: 'Your best nights average similar dB levels', type: 'neutral' });
  } else if (db > range.max) {
    insights.push({ icon: '📢', text: `Currently ${Math.round(db - range.max)}dB above optimal`, type: 'warning' });
    insights.push({ icon: '🚶', text: 'Louder environments can lead to faster exits', type: 'warning' });
    insights.push({ icon: '💬', text: 'Guests may struggle to have conversations', type: 'neutral' });
    recommendation = `Try lowering music by ${Math.round(db - range.max)}dB for better guest comfort.`;
  } else if (db < range.min) {
    insights.push({ icon: '🔇', text: `Currently ${Math.round(range.min - db)}dB below optimal`, type: 'warning' });
    insights.push({ icon: '😴', text: 'Energy might feel too low for the time', type: 'neutral' });
    recommendation = `Boost the energy! Try increasing volume by ${Math.round(range.min - db)}dB.`;
  } else {
    insights.push({ icon: '👍', text: 'Sound level is in a good range', type: 'positive' });
    insights.push({ icon: '🎯', text: 'Close to optimal - minor tweaks could perfect it', type: 'neutral' });
  }
  
  return { insights, recommendation };
}

function getLightContent(
  lux: number | null,
  score: number,
  range: { min: number; max: number },
  timeSlot: TimeSlot
): FactorContent {
  const insights: FactorContent['insights'] = [];
  let recommendation: string | null = null;
  
  const isEvening = timeSlot.includes('night') || timeSlot.includes('peak');
  
  if (lux === null) {
    insights.push({ icon: '⚠️', text: 'No light data available', type: 'warning' });
  } else if (score >= 85) {
    insights.push({ icon: '✨', text: 'Perfect ambiance for the moment', type: 'positive' });
    insights.push({ icon: '📸', text: 'Great lighting for guest photos', type: 'positive' });
  } else if (lux > range.max) {
    insights.push({ icon: '💡', text: 'Brighter than optimal for this time', type: 'warning' });
    if (isEvening) {
      insights.push({ icon: '🌙', text: 'Dimmer lighting creates better evening vibe', type: 'neutral' });
      recommendation = 'Dim the lights to create a more intimate evening atmosphere.';
    }
  } else if (lux < range.min) {
    insights.push({ icon: '🔦', text: 'Darker than optimal', type: 'warning' });
    insights.push({ icon: '👀', text: 'Guests may struggle to read menus', type: 'neutral' });
    recommendation = 'Consider adding some accent lighting or turning up ambient lights slightly.';
  }
  
  return { insights, recommendation };
}

function getComfortContent(
  temp: number | null,
  score: number,
  range: { min: number; max: number }
): FactorContent {
  const insights: FactorContent['insights'] = [];
  let recommendation: string | null = null;
  
  if (temp === null) {
    insights.push({ icon: '⚠️', text: 'No temperature data available', type: 'warning' });
  } else if (score >= 80) {
    insights.push({ icon: '🌡️', text: 'Temperature is comfortable', type: 'positive' });
    insights.push({ icon: '😌', text: 'Guests can relax without being too hot or cold', type: 'positive' });
  } else if (temp > range.max) {
    insights.push({ icon: '🥵', text: `${Math.round(temp - range.max)}°F warmer than ideal`, type: 'warning' });
    insights.push({ icon: '👥', text: 'Crowds generate heat - busier = warmer', type: 'neutral' });
    recommendation = `Lower AC by a few degrees. Current crowd is adding body heat.`;
  } else if (temp < range.min) {
    insights.push({ icon: '🥶', text: `${Math.round(range.min - temp)}°F cooler than ideal`, type: 'warning' });
    recommendation = 'Guests might feel chilly. Consider raising the temperature slightly.';
  }
  
  return { insights, recommendation };
}

function getMusicContent(
  score: number,
  timeSlot: TimeSlot,
  currentSong?: string | null,
  _artist?: string | null
): FactorContent {
  const insights: FactorContent['insights'] = [];
  let recommendation: string | null = null;
  const ranges = TIME_SLOT_RANGES[timeSlot];
  
  if (!currentSong) {
    insights.push({ icon: '🔇', text: 'No music detected', type: 'warning' });
    recommendation = `For ${getTimeSlotLabel(timeSlot)}, try ${ranges.genres.slice(0, 2).join(' or ')}.`;
  } else if (score >= 80) {
    insights.push({ icon: '🎵', text: `"${currentSong}" fits the vibe perfectly`, type: 'positive' });
    insights.push({ icon: '🎯', text: `Great choice for ${getTimeSlotLabel(timeSlot)}`, type: 'positive' });
  } else if (score >= 50) {
    insights.push({ icon: '🎵', text: `"${currentSong}" is okay for now`, type: 'neutral' });
    insights.push({ icon: '💡', text: `${ranges.genres[0]} tends to work better at this time`, type: 'neutral' });
  } else {
    insights.push({ icon: '🎵', text: `"${currentSong}" might not match the moment`, type: 'warning' });
    recommendation = `Try switching to ${ranges.genres.slice(0, 2).join(' or ')} for better vibe alignment.`;
  }
  
  // Extra: genre suggestions
  const extra = (
    <div className="bg-warm-800/50 rounded-xl p-4 border border-warm-700/50">
      <div className="flex items-center gap-2 mb-3">
        <Music className="w-4 h-4 text-purple-400" />
        <span className="text-sm font-medium text-warm-200">Best Genres for {getTimeSlotLabel(timeSlot)}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {ranges.genres.map((genre, i) => (
          <span 
            key={genre}
            className={`px-3 py-1 rounded-full text-xs ${
              i === 0 ? 'bg-purple-900/50 text-purple-300' : 'bg-warm-700 text-warm-300'
            }`}
          >
            {genre}
          </span>
        ))}
      </div>
    </div>
  );
  
  return { insights, recommendation, extra };
}

function getVibeContent(score: number, timeSlot: TimeSlot): FactorContent {
  const insights: FactorContent['insights'] = [];
  let recommendation: string | null = null;
  
  if (score >= 80) {
    insights.push({ icon: '✨', text: 'All factors are well-aligned', type: 'positive' });
    insights.push({ icon: '🎯', text: `Nailing the ${getTimeSlotLabel(timeSlot)} vibe`, type: 'positive' });
    insights.push({ icon: '💯', text: 'This is what a great venue feels like', type: 'positive' });
  } else if (score >= 60) {
    insights.push({ icon: '👍', text: 'Vibe is good but not perfect', type: 'neutral' });
    insights.push({ icon: '🔧', text: 'One or two factors might need attention', type: 'neutral' });
    recommendation = 'Check your lowest-scoring factor and make a small adjustment.';
  } else {
    insights.push({ icon: '⚠️', text: 'Multiple factors are out of sync', type: 'warning' });
    insights.push({ icon: '🎯', text: 'The atmosphere doesn\'t quite match the time', type: 'warning' });
    recommendation = 'Review each factor and prioritize fixing the lowest scores first.';
  }
  
  return { insights, recommendation };
}

// ============ HELPERS ============

function formatHour(hour: number): string {
  const h = hour % 24;
  if (h === 0) return '12a';
  if (h === 12) return '12p';
  if (h < 12) return `${h}a`;
  return `${h - 12}p`;
}

function getTimeSlotLabel(timeSlot: TimeSlot): string {
  const labels: Record<TimeSlot, string> = {
    weekday_happy_hour: 'Happy Hour',
    weekday_night: 'Weeknight',
    friday_early: 'Friday Evening',
    friday_peak: 'Friday Night',
    saturday_early: 'Saturday Evening',
    saturday_peak: 'Saturday Night',
    sunday_funday: 'Sunday Funday',
    daytime: 'Daytime',
  };
  return labels[timeSlot];
}

function generateMockTrendData(
  currentValue: number | null,
  factor: FactorType,
  _timeSlot: TimeSlot
): Array<{ label: string; value: number; isCurrent?: boolean }> {
  const now = new Date();
  const currentHour = now.getHours();
  const data: Array<{ label: string; value: number; isCurrent?: boolean }> = [];
  
  const baseValue = currentValue || 70;
  const variance = factor === 'sound' ? 8 : factor === 'light' ? 50 : 5;
  
  for (let i = 5; i >= 0; i--) {
    const hour = (currentHour - i + 24) % 24;
    const randomOffset = (Math.random() - 0.5) * variance;
    const timeOffset = (5 - i) * (variance / 10); // Gradual increase toward current
    
    data.push({
      label: formatHour(hour),
      value: Math.max(0, Math.round(baseValue + randomOffset + timeOffset - variance/2)),
      isCurrent: i === 0,
    });
  }
  
  return data;
}

function getTypicalValue(factor: FactorType, dayType: 'weekday' | 'friday' | 'saturday'): number {
  const bases: Record<FactorType, Record<string, number>> = {
    sound: { weekday: 68, friday: 76, saturday: 79 },
    light: { weekday: 350, friday: 280, saturday: 250 },
    comfort: { weekday: 70, friday: 71, saturday: 72 },
    music: { weekday: 70, friday: 82, saturday: 88 },
    vibe: { weekday: 72, friday: 80, saturday: 85 },
  };
  
  return bases[factor][dayType];
}

export default FactorDeepDiveModal;

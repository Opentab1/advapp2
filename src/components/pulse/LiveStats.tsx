/**
 * LiveStats - Eagle's eye view of current venue state
 * 
 * Compact row showing real-time metrics at a glance:
 * - Sound level (dB) with visualizer
 * - Light level (lux)
 * - Crowd count
 * - Now playing song with album art
 * 
 * Color-coded: green = optimal, amber = okay, red = needs attention
 * Dark mode supported.
 * 
 * Tappable to open detailed stats modal.
 */

import { motion } from 'framer-motion';
import { Volume2, Sun, Users, Music, ChevronRight } from 'lucide-react';
import { OPTIMAL_RANGES } from '../../utils/constants';
import { SoundVisualizer } from '../common/SoundVisualizer';
import { AnimatedNumber } from '../common/AnimatedNumber';
import { haptic } from '../../utils/haptics';

interface LiveStatsProps {
  decibels: number | null;
  light: number | null;
  occupancy: number;
  currentSong?: string | null;
  artist?: string | null;
  albumArt?: string | null;
  lastUpdated: Date | null;
  onTap?: () => void;
}

export function LiveStats({
  decibels,
  light,
  occupancy,
  currentSong,
  artist,
  albumArt,
  lastUpdated,
  onTap,
}: LiveStatsProps) {
  // Calculate freshness
  const secondsAgo = lastUpdated 
    ? Math.floor((Date.now() - lastUpdated.getTime()) / 1000) 
    : null;
  const isFresh = secondsAgo !== null && secondsAgo < 60;
  
  // Normalize sound level for visualizer (0-100)
  const normalizedSound = decibels !== null 
    ? Math.min(100, Math.max(0, ((decibels - 40) / 50) * 100))
    : null;
  
  const handleTap = () => {
    if (onTap) {
      haptic('light');
      onTap();
    }
  };
  
  return (
    <motion.div
      className={`bg-warm-800 rounded-2xl border border-warm-700 p-4 transition-colors ${onTap ? 'cursor-pointer hover:shadow-card-hover active:scale-[0.99]' : ''}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={handleTap}
      whileTap={onTap ? { scale: 0.98 } : undefined}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-warm-100">Owner's Live View</h3>
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${isFresh ? 'bg-green-500 animate-pulse' : 'bg-amber-500'}`} />
          <span className="text-xs text-warm-400">
            {isFresh ? 'Live' : secondsAgo ? `${secondsAgo}s ago` : 'No data'}
          </span>
          {onTap && <ChevronRight className="w-4 h-4 text-warm-400 ml-1" />}
        </div>
      </div>
      
      {/* Stats Grid */}
      <div className="grid grid-cols-3 gap-3">
        {/* Sound with visualizer */}
        <StatChip
          icon={Volume2}
          label="Sound"
          value={decibels}
          unit="dB"
          status={getDecibelStatus(decibels)}
          extra={<SoundVisualizer level={normalizedSound} height={16} barCount={4} />}
        />
        
        {/* Light */}
        <StatChip
          icon={Sun}
          label="Light"
          value={light}
          unit="lux"
          status={getLightStatus(light)}
        />
        
        {/* Crowd */}
        <StatChip
          icon={Users}
          label="Crowd"
          value={occupancy}
          unit="people"
          status="neutral"
        />
      </div>
      
      {/* Now Playing */}
      {currentSong && (
        <motion.div
          className="mt-3 pt-3 border-t border-warm-700 flex items-center gap-3"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
        >
          {/* Album Art or Music Icon */}
          {albumArt ? (
            <motion.img 
              src={albumArt} 
              alt="Album art"
              className="w-12 h-12 rounded-lg object-cover flex-shrink-0 shadow-md"
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 300 }}
            />
          ) : (
            <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center flex-shrink-0">
              <Music className="w-5 h-5 text-primary" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-warm-100 truncate">{currentSong}</p>
            {artist && (
              <p className="text-xs text-warm-400 truncate">{artist}</p>
            )}
          </div>
          {/* Animated equalizer bars */}
          <div className="flex items-end gap-0.5 h-5">
            {[12, 20, 8, 16, 10].map((height, i) => (
              <motion.span 
                key={i}
                className="w-1 bg-primary rounded-full"
                animate={{ 
                  height: [height * 0.4, height, height * 0.6, height * 0.9],
                }}
                transition={{
                  duration: 0.6,
                  repeat: Infinity,
                  repeatType: 'reverse',
                  delay: i * 0.1,
                  ease: 'easeInOut',
                }}
              />
            ))}
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}

// ============ STAT CHIP ============

type Status = 'optimal' | 'warning' | 'critical' | 'neutral';

interface StatChipProps {
  icon: typeof Volume2;
  label: string;
  value: number | null;
  unit: string;
  status: Status;
  extra?: React.ReactNode;
}

const STATUS_STYLES: Record<Status, { bg: string; text: string; icon: string }> = {
  optimal: { bg: 'bg-green-900/30', text: 'text-green-400', icon: 'text-green-500' },
  warning: { bg: 'bg-amber-900/30', text: 'text-amber-400', icon: 'text-amber-500' },
  critical: { bg: 'bg-red-900/30', text: 'text-red-400', icon: 'text-red-500' },
  neutral: { bg: 'bg-warm-700/50', text: 'text-warm-200', icon: 'text-warm-400' },
};

function StatChip({ icon: Icon, label, value, unit, status, extra }: StatChipProps) {
  const style = STATUS_STYLES[status];
  
  return (
    <div className={`p-2.5 rounded-xl ${style.bg} transition-colors`}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <Icon className={`w-3.5 h-3.5 ${style.icon}`} />
          <span className="text-[10px] text-warm-400 uppercase tracking-wide">{label}</span>
        </div>
        {extra}
      </div>
      <div className="flex items-baseline gap-1">
        <AnimatedNumber 
          value={value} 
          className={`text-lg font-bold ${style.text}`}
          formatFn={(v) => v.toFixed(0)}
        />
        <span className="text-xs text-warm-500">{unit}</span>
      </div>
    </div>
  );
}

// ============ STATUS HELPERS ============

function getDecibelStatus(db: number | null): Status {
  if (db === null) return 'neutral';
  if (db >= OPTIMAL_RANGES.sound.min && db <= OPTIMAL_RANGES.sound.max) return 'optimal';
  if (db > OPTIMAL_RANGES.sound.max + 10 || db < OPTIMAL_RANGES.sound.min - 20) return 'critical';
  return 'warning';
}

function getLightStatus(lux: number | null): Status {
  if (lux === null) return 'neutral';
  if (lux >= OPTIMAL_RANGES.light.min && lux <= OPTIMAL_RANGES.light.max) return 'optimal';
  const hour = new Date().getHours();
  if (hour >= 18 && lux > OPTIMAL_RANGES.light.max) return 'warning';
  return 'optimal';
}


export default LiveStats;

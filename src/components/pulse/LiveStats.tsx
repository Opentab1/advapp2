/**
 * LiveStats - Eagle's eye view of current venue state
 * 
 * Compact row showing real-time metrics at a glance:
 * - Sound level (dB)
 * - Light level (lux)
 * - Crowd count
 * - Now playing song
 * 
 * Color-coded: green = optimal, amber = okay, red = needs attention
 */

import { motion } from 'framer-motion';
import { Volume2, Sun, Users, Music, Thermometer } from 'lucide-react';
import { OPTIMAL_RANGES } from '../../utils/constants';

interface LiveStatsProps {
  decibels: number | null;
  light: number | null;
  occupancy: number;
  temperature?: number | null;
  currentSong?: string | null;
  artist?: string | null;
  lastUpdated: Date | null;
}

export function LiveStats({
  decibels,
  light,
  occupancy,
  temperature,
  currentSong,
  artist,
  lastUpdated,
}: LiveStatsProps) {
  // Calculate freshness
  const secondsAgo = lastUpdated 
    ? Math.floor((Date.now() - lastUpdated.getTime()) / 1000) 
    : null;
  const isFresh = secondsAgo !== null && secondsAgo < 60;
  
  return (
    <motion.div
      className="bg-white rounded-2xl border border-warm-200 p-4"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-warm-800">Live Stats</h3>
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${isFresh ? 'bg-green-500 animate-pulse' : 'bg-amber-500'}`} />
          <span className="text-xs text-warm-500">
            {isFresh ? 'Live' : secondsAgo ? `${secondsAgo}s ago` : 'No data'}
          </span>
        </div>
      </div>
      
      {/* Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Sound */}
        <StatChip
          icon={Volume2}
          label="Sound"
          value={decibels !== null ? `${decibels.toFixed(0)}` : '--'}
          unit="dB"
          status={getDecibelStatus(decibels)}
        />
        
        {/* Light */}
        <StatChip
          icon={Sun}
          label="Light"
          value={light !== null ? `${light.toFixed(0)}` : '--'}
          unit="lux"
          status={getLightStatus(light)}
        />
        
        {/* Crowd */}
        <StatChip
          icon={Users}
          label="Crowd"
          value={String(occupancy)}
          unit="people"
          status="neutral"
        />
        
        {/* Temperature (if available) */}
        {temperature !== undefined && temperature !== null ? (
          <StatChip
            icon={Thermometer}
            label="Temp"
            value={`${temperature.toFixed(0)}`}
            unit="°F"
            status={getTemperatureStatus(temperature)}
          />
        ) : (
          /* Now Playing placeholder if no temp */
          <div className="col-span-1" />
        )}
      </div>
      
      {/* Now Playing */}
      {currentSong && (
        <motion.div
          className="mt-3 pt-3 border-t border-warm-100 flex items-center gap-3"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
        >
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Music className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-warm-800 truncate">{currentSong}</p>
            {artist && (
              <p className="text-xs text-warm-500 truncate">{artist}</p>
            )}
          </div>
          <div className="flex items-center gap-1">
            <span className="w-1 h-3 bg-primary rounded-full animate-pulse" />
            <span className="w-1 h-4 bg-primary rounded-full animate-pulse" style={{ animationDelay: '0.2s' }} />
            <span className="w-1 h-2 bg-primary rounded-full animate-pulse" style={{ animationDelay: '0.4s' }} />
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
  value: string;
  unit: string;
  status: Status;
}

const STATUS_STYLES: Record<Status, { bg: string; text: string; icon: string }> = {
  optimal: { bg: 'bg-green-50', text: 'text-green-700', icon: 'text-green-500' },
  warning: { bg: 'bg-amber-50', text: 'text-amber-700', icon: 'text-amber-500' },
  critical: { bg: 'bg-red-50', text: 'text-red-700', icon: 'text-red-500' },
  neutral: { bg: 'bg-warm-50', text: 'text-warm-700', icon: 'text-warm-500' },
};

function StatChip({ icon: Icon, label, value, unit, status }: StatChipProps) {
  const style = STATUS_STYLES[status];
  
  return (
    <div className={`p-2.5 rounded-xl ${style.bg}`}>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={`w-3.5 h-3.5 ${style.icon}`} />
        <span className="text-[10px] text-warm-500 uppercase tracking-wide">{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className={`text-lg font-bold ${style.text}`}>{value}</span>
        <span className="text-xs text-warm-400">{unit}</span>
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
  // Evening hours need dimmer light
  const hour = new Date().getHours();
  if (hour >= 18 && lux > OPTIMAL_RANGES.light.max) return 'warning';
  return 'optimal';
}

function getTemperatureStatus(temp: number | null): Status {
  if (temp === null) return 'neutral';
  if (temp >= OPTIMAL_RANGES.temperature.min && temp <= OPTIMAL_RANGES.temperature.max) return 'optimal';
  if (temp > OPTIMAL_RANGES.temperature.max + 5 || temp < OPTIMAL_RANGES.temperature.min - 5) return 'critical';
  return 'warning';
}

export default LiveStats;

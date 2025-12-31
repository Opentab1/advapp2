/**
 * Live Metrics Panel
 * 
 * Compact side panel showing current metrics:
 * - Sound Level
 * - Light Level
 * - Outdoor Weather
 * - Occupancy stats
 * - Now Playing
 */

import { motion } from 'framer-motion';
import { 
  Volume2, 
  Sun, 
  CloudSun, 
  Users, 
  UserPlus, 
  UserMinus, 
  Clock 
} from 'lucide-react';
import type { SensorData, OccupancyMetrics } from '../types';
import type { WeatherData } from '../services/weather.service';
import { formatDwellTime } from '../utils/dwellTime';
import { formatValueNoZero, formatValueAllowZero, formatOccupancy } from '../utils/dataDisplay';

interface LiveMetricsPanelProps {
  sensorData: SensorData | null;
  occupancy: OccupancyMetrics | { entries: number; exits: number; current: number } | null;
  weatherData: WeatherData | null;
  loading?: boolean;
  onWeatherClick?: () => void;
}

export function LiveMetricsPanel({
  sensorData,
  occupancy,
  weatherData,
  loading = false,
  onWeatherClick,
}: LiveMetricsPanelProps) {
  
  // Get occupancy values with fallback
  const entries = occupancy 
    ? ('todayEntries' in occupancy ? occupancy.todayEntries : occupancy.entries) 
    : null;
  const exits = occupancy 
    ? ('todayExits' in occupancy ? occupancy.todayExits : occupancy.exits) 
    : null;
  const current = occupancy?.current ?? null;
  const dwellTime = occupancy && 'avgDwellTimeMinutes' in occupancy 
    ? occupancy.avgDwellTimeMinutes 
    : null;
  
  if (loading && !sensorData) {
    return (
      <div className="glass-card p-4 space-y-3 animate-pulse">
        <div className="h-6 bg-warm-200 rounded w-1/2"></div>
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="h-14 bg-warm-100 rounded-xl"></div>
        ))}
      </div>
    );
  }
  
  return (
    <motion.div
      className="glass-card p-4 space-y-3"
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
    >
      <h3 className="text-lg font-semibold text-warm-800 mb-4">Live Metrics</h3>
      
      {/* Sound Level */}
      <MetricRow
        icon={Volume2}
        iconBg="bg-primary/10"
        iconColor="text-primary"
        label="Sound Level"
        value={formatValueNoZero(sensorData?.decibels)}
        unit="dB"
      />

      {/* Light Level */}
      <MetricRow
        icon={Sun}
        iconBg="bg-yellow-500/10"
        iconColor="text-yellow-500"
        label="Light Level"
        value={formatValueAllowZero(sensorData?.light)}
        unit="lux"
      />

      {/* Outdoor Temp/Weather */}
      <MetricRow
        icon={CloudSun}
        iconBg="bg-sky-500/10"
        iconColor="text-sky-500"
        label="Outdoor"
        value={weatherData ? `${weatherData.temperature}°` : '--'}
        unit={weatherData ? weatherData.icon : 'Set address'}
        onClick={!weatherData ? onWeatherClick : undefined}
        clickable={!weatherData}
      />

      {/* Divider */}
      <div className="border-t border-warm-200 my-2"></div>

      {/* Entries Today */}
      <MetricRow
        icon={UserPlus}
        iconBg="bg-green-500/10"
        iconColor="text-green-500"
        label="Entries Today"
        value={formatOccupancy(entries)}
        unit="people"
      />

      {/* Exits Today */}
      <MetricRow
        icon={UserMinus}
        iconBg="bg-red-500/10"
        iconColor="text-red-500"
        label="Exits Today"
        value={formatOccupancy(exits)}
        unit="people"
      />

      {/* Current Occupancy */}
      <MetricRow
        icon={Users}
        iconBg="bg-purple-500/10"
        iconColor="text-purple-500"
        label="Current Occupancy"
        value={formatOccupancy(current)}
        unit="people"
      />

      {/* Avg Dwell Time */}
      <MetricRow
        icon={Clock}
        iconBg="bg-pink-500/10"
        iconColor="text-pink-500"
        label="Avg Dwell Time"
        value={dwellTime !== null ? formatDwellTime(dwellTime) : '--'}
        unit="per visit"
      />

      {/* Now Playing - compact */}
      {sensorData?.currentSong && (
        <>
          <div className="border-t border-warm-200 my-2"></div>
          <div className="p-3 bg-warm-50 rounded-xl">
            <div className="flex items-center gap-3">
              {sensorData.albumArt && (
                <img 
                  src={sensorData.albumArt} 
                  alt="Album art"
                  className="w-10 h-10 rounded-lg object-cover"
                />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-warm-800 truncate">
                  {sensorData.currentSong}
                </div>
                <div className="text-xs text-warm-500 truncate">
                  {sensorData.artist || 'Unknown Artist'}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </motion.div>
  );
}

// Metric Row Component
function MetricRow({ 
  icon: Icon, 
  iconBg, 
  iconColor, 
  label, 
  value, 
  unit,
  onClick,
  clickable = false,
}: {
  icon: typeof Volume2;
  iconBg: string;
  iconColor: string;
  label: string;
  value: string;
  unit: string;
  onClick?: () => void;
  clickable?: boolean;
}) {
  const content = (
    <div className="flex items-center justify-between p-3 bg-warm-50 rounded-xl">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg ${iconBg} flex items-center justify-center`}>
          <Icon className={`w-5 h-5 ${iconColor}`} />
        </div>
        <span className="text-sm text-warm-600">{label}</span>
      </div>
      <div className="text-right">
        <div className="text-xl font-bold text-warm-800">{value}</div>
        <div className="text-xs text-warm-500">{unit}</div>
      </div>
    </div>
  );
  
  if (clickable && onClick) {
    return (
      <button
        onClick={onClick}
        className="w-full hover:bg-warm-100 rounded-xl transition-colors"
      >
        {content}
      </button>
    );
  }
  
  return content;
}

export default LiveMetricsPanel;

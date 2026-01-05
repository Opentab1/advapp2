/**
 * TodaysOutlook - External factors affecting tonight
 * 
 * Shows:
 * - Weather conditions
 * - Major holidays
 * - Sports games
 */

import { motion } from 'framer-motion';
import { 
  Calendar, CloudSun, Trophy, 
  Sun, Cloud, CloudRain, Snowflake, Wind
} from 'lucide-react';
import type { SportsGame } from '../../types';

interface TodaysOutlookProps {
  weather?: {
    temperature: number;
    icon: string;
    conditions?: string;
  } | null;
  todayGames?: SportsGame[];
  holidays?: Array<{
    name: string;
    type: 'major' | 'minor';
  }>;
}

// Common holidays that affect bar traffic
const MAJOR_HOLIDAYS = [
  { date: '01-01', name: "New Year's Day", type: 'major' as const },
  { date: '02-14', name: "Valentine's Day", type: 'minor' as const },
  { date: '03-17', name: "St. Patrick's Day", type: 'major' as const },
  { date: '05-05', name: "Cinco de Mayo", type: 'major' as const },
  { date: '07-04', name: "Independence Day", type: 'major' as const },
  { date: '10-31', name: "Halloween", type: 'major' as const },
  { date: '11-28', name: "Thanksgiving", type: 'major' as const },
  { date: '12-24', name: "Christmas Eve", type: 'major' as const },
  { date: '12-25', name: "Christmas Day", type: 'minor' as const },
  { date: '12-31', name: "New Year's Eve", type: 'major' as const },
];

function getTodaysHolidays(): Array<{ name: string; type: 'major' | 'minor' }> {
  const today = new Date();
  const monthDay = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return MAJOR_HOLIDAYS.filter(h => h.date === monthDay);
}

function getWeatherIcon(iconCode: string) {
  // Map weather icon codes to Lucide icons
  if (iconCode.includes('01')) return Sun; // Clear
  if (iconCode.includes('02') || iconCode.includes('03')) return CloudSun; // Partly cloudy
  if (iconCode.includes('04')) return Cloud; // Cloudy
  if (iconCode.includes('09') || iconCode.includes('10')) return CloudRain; // Rain
  if (iconCode.includes('13')) return Snowflake; // Snow
  if (iconCode.includes('50')) return Wind; // Mist/fog
  return CloudSun; // Default
}

export function TodaysOutlook({
  weather,
  todayGames = [],
  holidays: providedHolidays,
}: TodaysOutlookProps) {
  const holidays = providedHolidays || getTodaysHolidays();
  
  // Don't render if nothing to show
  const hasWeather = weather && weather.temperature;
  const hasHolidays = holidays.length > 0;
  const hasGames = todayGames.length > 0;
  
  if (!hasWeather && !hasHolidays && !hasGames) {
    return null;
  }
  
  const WeatherIcon = weather ? getWeatherIcon(weather.icon) : CloudSun;
  
  return (
    <motion.div
      className="glass-card p-4"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Header */}
      <div className="mb-4">
        <h3 className="font-semibold text-white">Today's Outlook</h3>
        <p className="text-xs text-text-secondary mt-0.5">External factors affecting tonight</p>
      </div>
      
      <div className="space-y-3">
        {/* Weather */}
        {hasWeather && (
          <div className="flex items-center gap-3 p-3 rounded-xl bg-whoop-panel-secondary border border-whoop-divider">
            <div className="w-10 h-10 rounded-full bg-strain/20 flex items-center justify-center flex-shrink-0">
              <WeatherIcon className="w-5 h-5 text-strain" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium text-white">
                {Math.round(weather!.temperature)}°F
                {weather!.conditions && ` • ${weather!.conditions}`}
              </div>
              <div className="text-xs text-text-muted">
                {weather!.temperature >= 70 
                  ? 'Great patio weather' 
                  : weather!.temperature >= 50 
                    ? 'Comfortable evening'
                    : 'Cold night - expect more indoor traffic'}
              </div>
            </div>
          </div>
        )}
        
        {/* Holidays */}
        {hasHolidays && holidays.map((holiday, idx) => (
          <motion.div
            key={holiday.name}
            className={`flex items-center gap-3 p-3 rounded-xl border ${
              holiday.type === 'major'
                ? 'bg-recovery-medium/10 border-recovery-medium/30'
                : 'bg-whoop-panel-secondary border-whoop-divider'
            }`}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 * idx }}
          >
            <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
              holiday.type === 'major' ? 'bg-recovery-medium/20' : 'bg-warm-700'
            }`}>
              <Calendar className={`w-5 h-5 ${
                holiday.type === 'major' ? 'text-recovery-medium' : 'text-warm-400'
              }`} />
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium text-white">{holiday.name}</div>
              <div className="text-xs text-text-muted">
                {holiday.type === 'major' 
                  ? '🔥 Expect higher traffic tonight'
                  : 'May see increased activity'}
              </div>
            </div>
            {holiday.type === 'major' && (
              <span className="px-2 py-1 text-xs font-medium bg-recovery-medium/20 text-recovery-medium rounded-full">
                Big Night
              </span>
            )}
          </motion.div>
        ))}
        
        {/* Sports Games */}
        {hasGames && todayGames.slice(0, 3).map((game, idx) => (
          <motion.div
            key={game.id}
            className="flex items-center gap-3 p-3 rounded-xl bg-whoop-panel-secondary border border-whoop-divider"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 * (idx + (hasHolidays ? holidays.length : 0)) }}
          >
            <div className="w-10 h-10 rounded-full bg-teal/20 flex items-center justify-center flex-shrink-0">
              <Trophy className="w-5 h-5 text-teal" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-white truncate">
                {game.homeTeam} vs {game.awayTeam}
              </div>
              <div className="text-xs text-text-muted">
                {game.sport} • {new Date(game.startTime).toLocaleTimeString('en-US', {
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </div>
            </div>
            {game.status === 'live' && (
              <span className="px-2 py-1 text-xs font-medium bg-recovery-low/20 text-recovery-low rounded-full animate-pulse">
                Live
              </span>
            )}
          </motion.div>
        ))}
        
        {/* More games indicator */}
        {todayGames.length > 3 && (
          <div className="text-center text-xs text-text-muted py-1">
            +{todayGames.length - 3} more games today
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default TodaysOutlook;

/**
 * ContextBar - Tonight's factors
 * 
 * Compact bar showing external factors:
 * - Sports games
 * - Holidays
 * - Weather (optional)
 */

import { motion } from 'framer-motion';
import { Trophy, Calendar, CloudSun, TrendingUp } from 'lucide-react';
import type { SportsGame } from '../../types';

interface ContextBarProps {
  games: SportsGame[];
  nextHoliday: { name: string; daysUntil: number } | null;
  weather?: { temp: number; icon: string } | null;
}

export function ContextBar({ games, nextHoliday, weather }: ContextBarProps) {
  const items: ContextItem[] = [];
  
  // Add games
  if (games.length > 0) {
    items.push({
      icon: Trophy,
      iconColor: 'text-yellow-500',
      text: `${games.length} game${games.length > 1 ? 's' : ''} today`,
      badge: '+Traffic',
      badgeColor: 'text-green-600 bg-green-50',
    });
  }
  
  // Add holiday
  if (nextHoliday && nextHoliday.daysUntil <= 7) {
    const daysText = nextHoliday.daysUntil === 0 
      ? 'Today!' 
      : nextHoliday.daysUntil === 1 
        ? 'Tomorrow' 
        : `In ${nextHoliday.daysUntil} days`;
    items.push({
      icon: Calendar,
      iconColor: 'text-purple-500',
      text: `${nextHoliday.name} — ${daysText}`,
    });
  }
  
  // Add weather if available
  if (weather) {
    items.push({
      icon: CloudSun,
      iconColor: 'text-sky-500',
      text: `${weather.temp}°F ${weather.icon}`,
    });
  }
  
  // Nothing to show
  if (items.length === 0) {
    return null;
  }
  
  return (
    <motion.div
      className="space-y-2"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <h4 className="text-sm font-medium text-warm-500">Tonight</h4>
      <div className="flex flex-wrap gap-2">
        {items.map((item, index) => (
          <ContextChip key={index} item={item} />
        ))}
      </div>
    </motion.div>
  );
}

// ============ TYPES ============

interface ContextItem {
  icon: typeof Trophy;
  iconColor: string;
  text: string;
  badge?: string;
  badgeColor?: string;
}

// ============ CONTEXT CHIP ============

function ContextChip({ item }: { item: ContextItem }) {
  const Icon = item.icon;
  
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-warm-200">
      <Icon className={`w-4 h-4 ${item.iconColor}`} />
      <span className="text-sm text-warm-700">{item.text}</span>
      {item.badge && (
        <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${item.badgeColor}`}>
          <TrendingUp className="w-3 h-3 inline mr-0.5" />
          {item.badge}
        </span>
      )}
    </div>
  );
}

export default ContextBar;

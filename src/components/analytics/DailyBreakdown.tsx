/**
 * DailyBreakdown - Table showing each day's performance
 * 
 * Columns: Day | Guests | Avg Stay | Peak Hour | Sound | Crowd
 * Best day highlighted green, worst day highlighted red
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown, ChevronUp, Star, AlertCircle } from 'lucide-react';
import { haptic } from '../../utils/haptics';
import type { SensorData } from '../../types';

interface DailyBreakdownProps {
  data: SensorData[];
  loading: boolean;
}

interface DayStats {
  date: string;
  dayName: string;
  guests: number;
  avgStay: number | null;
  peakHour: string;
  avgSound: number;
  avgLight: number;
  maxCrowd: number;
  score: number;
  isBest: boolean;
  isWorst: boolean;
}

function processDailyData(data: SensorData[]): DayStats[] {
  if (data.length === 0) return [];

  // Group by date
  const byDate: Record<string, SensorData[]> = {};
  data.forEach(d => {
    const date = new Date(d.timestamp).toDateString();
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(d);
  });

  const days: DayStats[] = [];
  
  Object.entries(byDate).forEach(([dateStr, readings]) => {
    const date = new Date(dateStr);
    const dayName = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    
    // Sort readings by time
    const sorted = [...readings].sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    
    // Calculate guests (entries delta)
    const firstEntry = sorted[0]?.occupancy?.entries ?? 0;
    const lastEntry = sorted[sorted.length - 1]?.occupancy?.entries ?? 0;
    const guests = Math.max(0, lastEntry - firstEntry);
    
    // Calculate averages
    let soundSum = 0, soundCount = 0;
    let lightSum = 0, lightCount = 0;
    let maxCrowd = 0;
    const hourlyGuests: Record<number, number> = {};
    
    sorted.forEach(r => {
      if (r.decibels && r.decibels > 0) { soundSum += r.decibels; soundCount++; }
      if (r.light !== undefined && r.light >= 0) { lightSum += r.light; lightCount++; }
      if (r.occupancy?.current && r.occupancy.current > maxCrowd) {
        maxCrowd = r.occupancy.current;
      }
      
      // Track guests per hour
      const hour = new Date(r.timestamp).getHours();
      if (r.occupancy?.current) {
        if (!hourlyGuests[hour] || r.occupancy.current > hourlyGuests[hour]) {
          hourlyGuests[hour] = r.occupancy.current;
        }
      }
    });
    
    // Find peak hour
    let peakHour = 0;
    let peakCount = 0;
    Object.entries(hourlyGuests).forEach(([hour, count]) => {
      if (count > peakCount) {
        peakCount = count;
        peakHour = parseInt(hour);
      }
    });
    
    const formatHour = (h: number) => {
      if (h === 0) return '12am';
      if (h < 12) return `${h}am`;
      if (h === 12) return '12pm';
      return `${h - 12}pm`;
    };
    
    // Simple score based on guests and conditions
    const score = guests > 0 ? Math.min(100, Math.round((guests / 10) + (maxCrowd / 2))) : 0;
    
    days.push({
      date: dateStr,
      dayName,
      guests,
      avgStay: null, // Would need more complex calculation
      peakHour: peakHour > 0 ? formatHour(peakHour) : '—',
      avgSound: soundCount > 0 ? Math.round(soundSum / soundCount) : 0,
      avgLight: lightCount > 0 ? Math.round(lightSum / lightCount) : 0,
      maxCrowd,
      score,
      isBest: false,
      isWorst: false,
    });
  });
  
  // Sort by date descending (most recent first)
  days.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  
  // Mark best and worst
  if (days.length >= 2) {
    const withGuests = days.filter(d => d.guests > 0);
    if (withGuests.length >= 2) {
      const best = withGuests.reduce((a, b) => a.guests > b.guests ? a : b);
      const worst = withGuests.reduce((a, b) => a.guests < b.guests ? a : b);
      best.isBest = true;
      worst.isWorst = true;
    }
  }
  
  return days;
}

export function DailyBreakdown({ data, loading }: DailyBreakdownProps) {
  const [expanded, setExpanded] = useState(true);
  const days = processDailyData(data);
  
  if (loading) {
    return (
      <div className="bg-whoop-panel border border-whoop-divider rounded-xl overflow-hidden">
        <div className="p-4 border-b border-whoop-divider">
          <div className="h-5 bg-warm-700 rounded w-32 animate-pulse" />
        </div>
        <div className="p-4 space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-12 bg-warm-800 rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }
  
  if (days.length === 0) {
    return (
      <div className="bg-whoop-panel border border-whoop-divider rounded-xl p-6 text-center">
        <p className="text-warm-400">No daily data available</p>
      </div>
    );
  }

  return (
    <motion.div
      className="bg-whoop-panel border border-whoop-divider rounded-xl overflow-hidden"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Header */}
      <button
        onClick={() => { haptic('light'); setExpanded(!expanded); }}
        className="w-full p-4 flex items-center justify-between border-b border-whoop-divider hover:bg-warm-800/50 transition-colors"
      >
        <h3 className="text-sm font-semibold text-warm-200 uppercase tracking-whoop">
          Daily Breakdown
        </h3>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-warm-500" />
        ) : (
          <ChevronDown className="w-4 h-4 text-warm-500" />
        )}
      </button>
      
      {/* Table */}
      {expanded && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-whoop-divider bg-warm-800/30">
                <th className="text-left text-warm-400 font-medium p-3">Day</th>
                <th className="text-right text-warm-400 font-medium p-3">Guests</th>
                <th className="text-right text-warm-400 font-medium p-3 hidden sm:table-cell">Peak Hour</th>
                <th className="text-right text-warm-400 font-medium p-3 hidden md:table-cell">Sound</th>
                <th className="text-right text-warm-400 font-medium p-3 hidden md:table-cell">Max Crowd</th>
              </tr>
            </thead>
            <tbody>
              {days.map((day, idx) => (
                <tr
                  key={day.date}
                  className={`border-b border-whoop-divider last:border-b-0 ${
                    day.isBest ? 'bg-recovery-high/5' : day.isWorst ? 'bg-recovery-low/5' : ''
                  }`}
                >
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      {day.isBest && <Star className="w-3 h-3 text-recovery-high" />}
                      {day.isWorst && <AlertCircle className="w-3 h-3 text-recovery-low" />}
                      <span className={`${day.isBest ? 'text-recovery-high font-medium' : day.isWorst ? 'text-recovery-low' : 'text-white'}`}>
                        {day.dayName}
                      </span>
                    </div>
                  </td>
                  <td className={`p-3 text-right font-semibold ${day.isBest ? 'text-recovery-high' : 'text-white'}`}>
                    {day.guests.toLocaleString()}
                  </td>
                  <td className="p-3 text-right text-warm-300 hidden sm:table-cell">
                    {day.peakHour}
                  </td>
                  <td className="p-3 text-right text-warm-300 hidden md:table-cell">
                    {day.avgSound > 0 ? `${day.avgSound} dB` : '—'}
                  </td>
                  <td className="p-3 text-right text-warm-300 hidden md:table-cell">
                    {day.maxCrowd > 0 ? day.maxCrowd : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </motion.div>
  );
}

export default DailyBreakdown;

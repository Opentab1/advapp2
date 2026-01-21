/**
 * GuestsTrend - Simple line chart showing guests over time
 * 
 * X-axis: Days
 * Y-axis: Guest count
 * Clear up/down trend indicator
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp } from 'lucide-react';
import { haptic } from '../../utils/haptics';
import type { SensorData } from '../../types';

interface GuestsTrendProps {
  data: SensorData[];
  loading: boolean;
}

interface DayPoint {
  date: string;
  dayLabel: string;
  guests: number;
}

function processTrendData(data: SensorData[]): { points: DayPoint[]; avg: number; trend: number } {
  if (data.length === 0) return { points: [], avg: 0, trend: 0 };

  // Group by date
  const byDate: Record<string, SensorData[]> = {};
  data.forEach(d => {
    const date = new Date(d.timestamp).toDateString();
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(d);
  });

  const points: DayPoint[] = [];
  
  Object.entries(byDate).forEach(([dateStr, readings]) => {
    const date = new Date(dateStr);
    const dayLabel = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    
    // Sort readings by time
    const sorted = [...readings].sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    
    // Calculate guests (entries delta)
    const firstEntry = sorted[0]?.occupancy?.entries ?? 0;
    const lastEntry = sorted[sorted.length - 1]?.occupancy?.entries ?? 0;
    const guests = Math.max(0, lastEntry - firstEntry);
    
    points.push({
      date: dateStr,
      dayLabel,
      guests,
    });
  });
  
  // Sort by date
  points.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  
  // Calculate average
  const total = points.reduce((sum, p) => sum + p.guests, 0);
  const avg = points.length > 0 ? Math.round(total / points.length) : 0;
  
  // Calculate trend (compare first half to second half)
  let trend = 0;
  if (points.length >= 4) {
    const mid = Math.floor(points.length / 2);
    const firstHalf = points.slice(0, mid).reduce((sum, p) => sum + p.guests, 0) / mid;
    const secondHalf = points.slice(mid).reduce((sum, p) => sum + p.guests, 0) / (points.length - mid);
    if (firstHalf > 0) {
      trend = Math.round(((secondHalf - firstHalf) / firstHalf) * 100);
    }
  }
  
  return { points, avg, trend };
}

export function GuestsTrend({ data, loading }: GuestsTrendProps) {
  const [expanded, setExpanded] = useState(true);
  const { points, avg, trend } = processTrendData(data);
  
  if (loading) {
    return (
      <div className="bg-whoop-panel border border-whoop-divider rounded-xl overflow-hidden">
        <div className="p-4 border-b border-whoop-divider">
          <div className="h-5 bg-warm-700 rounded w-32 animate-pulse" />
        </div>
        <div className="p-4">
          <div className="h-48 bg-warm-800 rounded animate-pulse" />
        </div>
      </div>
    );
  }
  
  if (points.length < 2) {
    return (
      <div className="bg-whoop-panel border border-whoop-divider rounded-xl p-6 text-center">
        <p className="text-warm-400">Need more days of data for trend chart</p>
      </div>
    );
  }

  const TrendIcon = trend > 5 ? TrendingUp : trend < -5 ? TrendingDown : Minus;
  const trendColor = trend > 5 ? 'text-recovery-high' : trend < -5 ? 'text-recovery-low' : 'text-warm-400';

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
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-warm-200 uppercase tracking-whoop">
            Guest Trend
          </h3>
          <div className={`flex items-center gap-1 text-sm ${trendColor}`}>
            <TrendIcon className="w-4 h-4" />
            {trend !== 0 && <span>{trend > 0 ? '+' : ''}{trend}%</span>}
          </div>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-warm-500" />
        ) : (
          <ChevronDown className="w-4 h-4 text-warm-500" />
        )}
      </button>
      
      {/* Chart */}
      {expanded && (
        <div className="p-4">
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.5} />
                
                <XAxis 
                  dataKey="dayLabel" 
                  tick={{ fill: '#9ca3af', fontSize: 10 }}
                  tickLine={{ stroke: '#4b5563' }}
                  axisLine={{ stroke: '#4b5563' }}
                  interval="preserveStartEnd"
                />
                
                <YAxis 
                  tick={{ fill: '#9ca3af', fontSize: 11 }}
                  tickLine={{ stroke: '#4b5563' }}
                  axisLine={{ stroke: '#4b5563' }}
                  width={40}
                />
                
                {/* Average reference line */}
                <ReferenceLine 
                  y={avg} 
                  stroke="#14b8a6" 
                  strokeDasharray="5 5" 
                  strokeOpacity={0.5}
                  label={{ 
                    value: `Avg: ${avg}`, 
                    position: 'right', 
                    fill: '#14b8a6', 
                    fontSize: 10 
                  }}
                />
                
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: '#1f2937', 
                    border: '1px solid #374151',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                  labelStyle={{ color: '#9ca3af' }}
                  formatter={(value: number) => [`${value.toLocaleString()} guests`, 'Guests']}
                />
                
                <Line 
                  type="monotone" 
                  dataKey="guests" 
                  stroke="#14b8a6"
                  strokeWidth={2}
                  dot={{ fill: '#14b8a6', r: 3 }}
                  activeDot={{ r: 5, fill: '#14b8a6' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          
          {/* Summary */}
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-warm-700 text-sm">
            <span className="text-warm-400">
              Average: <span className="text-white font-medium">{avg.toLocaleString()} guests/day</span>
            </span>
            <span className="text-warm-400">
              {points.length} days shown
            </span>
          </div>
        </div>
      )}
    </motion.div>
  );
}

export default GuestsTrend;

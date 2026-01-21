/**
 * HourlyHeatmap - Visual grid showing busy hours
 * 
 * Rows: Days of week
 * Columns: Hours (6pm - 3am for bars)
 * Color intensity = guest count / activity level
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { haptic } from '../../utils/haptics';
import type { SensorData } from '../../types';

interface HourlyHeatmapProps {
  data: SensorData[];
  loading: boolean;
}

// Bar hours: 6pm to 3am
const HOURS = [18, 19, 20, 21, 22, 23, 0, 1, 2, 3];
const HOUR_LABELS = ['6p', '7p', '8p', '9p', '10p', '11p', '12a', '1a', '2a', '3a'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface HeatmapCell {
  day: number;
  hour: number;
  value: number; // 0-100 normalized
  count: number; // actual guest count
}

function processHeatmapData(data: SensorData[]): HeatmapCell[] {
  if (data.length === 0) return [];

  // Grid: [day][hour] = { sum, count }
  const grid: Record<number, Record<number, { sum: number; count: number }>> = {};
  
  // Initialize grid
  for (let day = 0; day < 7; day++) {
    grid[day] = {};
    HOURS.forEach(hour => {
      grid[day][hour] = { sum: 0, count: 0 };
    });
  }
  
  // Fill grid with occupancy data
  data.forEach(d => {
    if (!d.occupancy?.current) return;
    
    const ts = new Date(d.timestamp);
    const day = ts.getDay();
    const hour = ts.getHours();
    
    // Only count bar hours
    if (HOURS.includes(hour)) {
      grid[day][hour].sum += d.occupancy.current;
      grid[day][hour].count++;
    }
  });
  
  // Calculate averages and normalize
  const cells: HeatmapCell[] = [];
  let maxAvg = 0;
  
  // First pass: find max
  for (let day = 0; day < 7; day++) {
    HOURS.forEach(hour => {
      const cell = grid[day][hour];
      if (cell.count > 0) {
        const avg = cell.sum / cell.count;
        if (avg > maxAvg) maxAvg = avg;
      }
    });
  }
  
  // Second pass: normalize
  for (let day = 0; day < 7; day++) {
    HOURS.forEach(hour => {
      const cell = grid[day][hour];
      const avg = cell.count > 0 ? cell.sum / cell.count : 0;
      cells.push({
        day,
        hour,
        value: maxAvg > 0 ? Math.round((avg / maxAvg) * 100) : 0,
        count: Math.round(avg),
      });
    });
  }
  
  return cells;
}

function getCellColor(value: number): string {
  if (value === 0) return 'bg-warm-800';
  if (value < 20) return 'bg-primary/10';
  if (value < 40) return 'bg-primary/25';
  if (value < 60) return 'bg-primary/40';
  if (value < 80) return 'bg-primary/60';
  return 'bg-primary/80';
}

export function HourlyHeatmap({ data, loading }: HourlyHeatmapProps) {
  const [expanded, setExpanded] = useState(true);
  const cells = processHeatmapData(data);
  
  if (loading) {
    return (
      <div className="bg-whoop-panel border border-whoop-divider rounded-xl overflow-hidden">
        <div className="p-4 border-b border-whoop-divider">
          <div className="h-5 bg-warm-700 rounded w-40 animate-pulse" />
        </div>
        <div className="p-4">
          <div className="h-48 bg-warm-800 rounded animate-pulse" />
        </div>
      </div>
    );
  }
  
  if (cells.length === 0 || cells.every(c => c.value === 0)) {
    return (
      <div className="bg-whoop-panel border border-whoop-divider rounded-xl p-6 text-center">
        <p className="text-warm-400">Not enough hourly data for heatmap</p>
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
          Busy Hours Heatmap
        </h3>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-warm-500" />
        ) : (
          <ChevronDown className="w-4 h-4 text-warm-500" />
        )}
      </button>
      
      {/* Heatmap Grid */}
      {expanded && (
        <div className="p-4 overflow-x-auto">
          <div className="min-w-[400px]">
            {/* Hour labels */}
            <div className="flex mb-1">
              <div className="w-10 flex-shrink-0" />
              {HOUR_LABELS.map((label, idx) => (
                <div key={idx} className="flex-1 text-center text-xs text-warm-500">
                  {label}
                </div>
              ))}
            </div>
            
            {/* Grid rows */}
            {DAYS.map((day, dayIdx) => (
              <div key={day} className="flex mb-1">
                <div className="w-10 flex-shrink-0 text-xs text-warm-400 flex items-center">
                  {day}
                </div>
                {HOURS.map((hour, hourIdx) => {
                  const cell = cells.find(c => c.day === dayIdx && c.hour === hour);
                  const value = cell?.value ?? 0;
                  const count = cell?.count ?? 0;
                  
                  return (
                    <div
                      key={hour}
                      className={`flex-1 aspect-square mx-0.5 rounded-sm ${getCellColor(value)} transition-colors relative group cursor-default`}
                      title={`${day} ${HOUR_LABELS[hourIdx]}: ${count} avg guests`}
                    >
                      {/* Tooltip on hover */}
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-warm-900 border border-warm-700 rounded text-xs text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none">
                        {count} guests
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
            
            {/* Legend */}
            <div className="flex items-center justify-end gap-2 mt-4 text-xs text-warm-500">
              <span>Quiet</span>
              <div className="flex gap-0.5">
                {[10, 30, 50, 70, 90].map(v => (
                  <div key={v} className={`w-4 h-4 rounded-sm ${getCellColor(v)}`} />
                ))}
              </div>
              <span>Busy</span>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}

export default HourlyHeatmap;

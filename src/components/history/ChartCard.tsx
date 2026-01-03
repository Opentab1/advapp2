/**
 * ChartCard - Collapsible chart container
 * 
 * Features:
 * - Collapsible with animation
 * - Color-coded header
 * - Metric icon
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Volume2, Sun, Users, TrendingUp } from 'lucide-react';
import { DataChart } from '../DataChart';
import { haptic } from '../../utils/haptics';
import type { SensorData, TimeRange } from '../../types';

type MetricType = 'occupancy' | 'decibels' | 'light' | 'pulse';

interface ChartCardProps {
  data: SensorData[];
  metric: MetricType;
  timeRange: TimeRange;
  fetchId: number;
  defaultCollapsed?: boolean;
}

const METRIC_CONFIG: Record<MetricType, {
  title: string;
  color: string;
  bgColor: string;
  borderColor: string;
  icon: React.ElementType;
}> = {
  occupancy: {
    title: 'Occupancy',
    color: '#22C55E',
    bgColor: 'bg-green-500/10',
    borderColor: 'border-green-500/30',
    icon: Users,
  },
  decibels: {
    title: 'Sound Level',
    color: '#0077B6',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/30',
    icon: Volume2,
  },
  light: {
    title: 'Light Level',
    color: '#F59E0B',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/30',
    icon: Sun,
  },
  pulse: {
    title: 'Pulse Score',
    color: '#8B5CF6',
    bgColor: 'bg-purple-500/10',
    borderColor: 'border-purple-500/30',
    icon: TrendingUp,
  },
};

export function ChartCard({
  data,
  metric,
  timeRange,
  fetchId,
  defaultCollapsed = false,
}: ChartCardProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const config = METRIC_CONFIG[metric];
  const Icon = config.icon;
  
  // Calculate quick stat for collapsed view
  const quickStat = getQuickStat(data, metric);
  
  return (
    <motion.div
      className={`bg-warm-800 rounded-2xl border ${collapsed ? 'border-warm-700' : config.borderColor} overflow-hidden transition-colors`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Header (always visible) */}
      <button
        onClick={() => {
          haptic('light');
          setCollapsed(!collapsed);
        }}
        className={`w-full flex items-center justify-between p-4 ${collapsed ? '' : config.bgColor} transition-colors`}
      >
        <div className="flex items-center gap-3">
          <Icon className="w-5 h-5" style={{ color: config.color }} />
          <span className="text-base font-semibold text-warm-100">{config.title}</span>
        </div>
        <div className="flex items-center gap-3">
          {collapsed && quickStat && (
            <span className="text-sm font-medium" style={{ color: config.color }}>
              {quickStat}
            </span>
          )}
          <motion.div
            animate={{ rotate: collapsed ? 0 : 180 }}
            transition={{ duration: 0.2 }}
          >
            <ChevronDown className="w-5 h-5 text-warm-400" />
          </motion.div>
        </div>
      </button>
      
      {/* Chart (collapsible) */}
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="p-4 pt-0">
              <DataChart
                key={`${metric}-${timeRange}-${fetchId}`}
                data={data}
                metric={metric}
                title=""
                color={config.color}
                timeRange={timeRange}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function getQuickStat(data: SensorData[], metric: MetricType): string | null {
  if (data.length === 0) return null;
  
  const values = data
    .map(d => {
      switch (metric) {
        case 'occupancy': return d.occupancy?.current || 0;
        case 'decibels': return d.decibels || 0;
        case 'light': return d.light || 0;
        default: return 0;
      }
    })
    .filter(v => v > 0);
  
  if (values.length === 0) return null;
  
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const max = Math.max(...values);
  
  switch (metric) {
    case 'occupancy':
      return `Peak: ${max}`;
    case 'decibels':
      return `Avg: ${avg.toFixed(0)} dB`;
    case 'light':
      return `Avg: ${avg.toFixed(0)} lux`;
    default:
      return null;
  }
}

export default ChartCard;

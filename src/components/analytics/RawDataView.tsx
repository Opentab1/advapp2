/**
 * RawDataView - Level 3 raw data view
 * 
 * Full-screen view with:
 * - Metric selector
 * - Interactive chart
 * - Quick stats
 * - Data table
 * - Export
 */

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { 
  X, Download, Zap, Volume2, Sun, Users 
} from 'lucide-react';
import { haptic } from '../../utils/haptics';
import { AreaChart } from '../common/MiniChart';
import type { RawDataPoint, InsightsTimeRange } from '../../types/insights';

interface RawDataViewProps {
  isOpen: boolean;
  onClose: () => void;
  data: RawDataPoint[];
  timeRange: InsightsTimeRange;
  onTimeRangeChange: (range: InsightsTimeRange) => void;
  initialMetric?: DisplayableMetric;
  onExport: () => void;
}

// Only include metrics we can accurately display from real sensor data
// Dwell removed - cannot calculate per-point dwell time (it's an aggregate metric)
// Temp removed - not part of Pulse Score calculation
type DisplayableMetric = 'score' | 'sound' | 'light' | 'crowd';

const METRIC_CONFIG: Record<DisplayableMetric, { 
  icon: typeof Volume2; 
  label: string; 
  color: string;
  unit: string;
  getValue: (d: RawDataPoint) => number;
}> = {
  score: { 
    icon: Zap, 
    label: 'Score', 
    color: '#00F19F',
    unit: '',
    getValue: (d) => d.score,
  },
  sound: { 
    icon: Volume2, 
    label: 'Sound', 
    color: '#0093E7',
    unit: 'dB',
    getValue: (d) => d.decibels,
  },
  light: { 
    icon: Sun, 
    label: 'Light', 
    color: '#FFDE00',
    unit: 'lux',
    getValue: (d) => d.light,
  },
  crowd: { 
    icon: Users, 
    label: 'Guests', 
    color: '#00F19F',
    unit: '',
    getValue: (d) => d.occupancy,
  },
};

const TIME_RANGES: Array<{ value: InsightsTimeRange; label: string }> = [
  { value: 'last_night', label: 'Last Night' },
  { value: '7d', label: '7 Days' },
  { value: '14d', label: '14 Days' },
  { value: '30d', label: '30 Days' },
];

export function RawDataView({
  isOpen,
  onClose,
  data,
  timeRange,
  onTimeRangeChange,
  initialMetric = 'score',
  onExport,
}: RawDataViewProps) {
  const [activeMetric, setActiveMetric] = useState<DisplayableMetric>(initialMetric === 'dwell' ? 'score' : (initialMetric as DisplayableMetric) || 'score');
  
  if (!isOpen) return null;

  const config = METRIC_CONFIG[activeMetric];

  // Calculate stats
  const stats = useMemo(() => {
    if (data.length === 0) {
      return { avg: 0, min: { value: 0, timestamp: '' }, max: { value: 0, timestamp: '' } };
    }
    
    const values = data.map(d => ({
      value: config.getValue(d),
      timestamp: d.timestamp,
    }));
    
    const sum = values.reduce((acc, v) => acc + v.value, 0);
    const avg = sum / values.length;
    
    const sorted = [...values].sort((a, b) => a.value - b.value);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    
    return {
      avg: Math.round(avg * 10) / 10,
      min: {
        value: min.value,
        timestamp: min.timestamp.toLocaleString('en-US', { 
          month: 'short', 
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit'
        }),
      },
      max: {
        value: max.value,
        timestamp: max.timestamp.toLocaleString('en-US', { 
          month: 'short', 
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit'
        }),
      },
    };
  }, [data, activeMetric, config]);

  // Prepare chart data
  const chartData = useMemo(() => {
    return data.map(d => ({
      label: d.timestamp.toLocaleString('en-US', { month: 'short', day: 'numeric' }),
      value: config.getValue(d),
    }));
  }, [data, config]);

  // Date range
  const dateRange = useMemo(() => {
    if (data.length === 0) return { start: '', end: '' };
    const sorted = [...data].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    return {
      start: sorted[0].timestamp.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      end: sorted[sorted.length - 1].timestamp.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    };
  }, [data]);

  const handleClose = () => {
    haptic('light');
    onClose();
  };

  const handleMetricChange = (metric: DisplayableMetric) => {
    haptic('selection');
    setActiveMetric(metric);
  };

  const handleExport = () => {
    haptic('medium');
    onExport();
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 bg-whoop-bg"
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 25, stiffness: 200 }}
    >
      {/* Header */}
      <div className="sticky top-0 bg-whoop-panel border-b border-whoop-divider px-4 py-3 flex items-center justify-between z-10">
        <button onClick={handleClose} className="p-2 -ml-2 text-warm-400 hover:text-white">
          <X className="w-5 h-5" />
        </button>
        <h2 className="text-lg font-semibold text-white">Raw Data</h2>
        <select
          value={timeRange}
          onChange={(e) => onTimeRangeChange(e.target.value as InsightsTimeRange)}
          className="bg-whoop-panel border border-whoop-divider rounded-lg px-3 py-1.5 text-sm text-white"
        >
          {TIME_RANGES.map((range) => (
            <option key={range.value} value={range.value}>{range.label}</option>
          ))}
        </select>
      </div>

      {/* Content */}
      <div className="overflow-y-auto h-[calc(100vh-56px)] p-4 space-y-6 pb-20">
        {/* Metric Selector */}
        <div className="flex flex-wrap gap-2">
          {(Object.keys(METRIC_CONFIG) as DisplayableMetric[]).map((metric) => {
            const cfg = METRIC_CONFIG[metric];
            const Icon = cfg.icon;
            const isActive = activeMetric === metric;
            
            return (
              <button
                key={metric}
                onClick={() => handleMetricChange(metric)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-all ${
                  isActive 
                    ? 'bg-teal/20 border border-teal/30 text-teal' 
                    : 'bg-warm-800 border border-transparent text-warm-400 hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span className="text-sm font-medium">{cfg.label}</span>
              </button>
            );
          })}
        </div>

        {/* Chart */}
        <div className="bg-whoop-panel border border-whoop-divider rounded-2xl p-4">
          <div className="h-64">
            {chartData.length > 0 ? (
              <AreaChart 
                data={chartData} 
                height={256}
                color={config.color}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-warm-500 text-sm">
                No data available for this period
              </div>
            )}
          </div>
        </div>

        {/* Data Info */}
        <div className="flex items-center justify-between text-sm text-warm-400">
          <span>{data.length.toLocaleString()} data points</span>
          <span>{dateRange.start} — {dateRange.end}</span>
        </div>

        {/* Quick Stats */}
        <div className="bg-whoop-panel border border-whoop-divider rounded-2xl p-4">
          <h3 className="text-sm font-semibold text-warm-200 uppercase tracking-whoop mb-4">
            Quick Stats
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-warm-400">Average</span>
              <span className="text-white font-medium">{stats.avg}{config.unit}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-warm-400">Minimum</span>
              <div className="text-right">
                <span className="text-white font-medium">{stats.min.value}{config.unit}</span>
                <span className="text-xs text-warm-500 ml-2">({stats.min.timestamp})</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-warm-400">Maximum</span>
              <div className="text-right">
                <span className="text-white font-medium">{stats.max.value}{config.unit}</span>
                <span className="text-xs text-warm-500 ml-2">({stats.max.timestamp})</span>
              </div>
            </div>
          </div>
        </div>

        {/* Export Button */}
        <button
          onClick={handleExport}
          className="w-full flex items-center justify-center gap-2 py-4 bg-teal/20 border border-teal/30 rounded-xl text-teal font-medium hover:bg-teal/30 transition-colors"
        >
          <Download className="w-5 h-5" />
          Download CSV
        </button>

        {/* Data Table Preview */}
        <div className="bg-whoop-panel border border-whoop-divider rounded-2xl overflow-hidden">
          <h3 className="text-sm font-semibold text-warm-200 uppercase tracking-whoop p-4 border-b border-whoop-divider">
            Data Table
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-whoop-divider">
                  <th className="text-left text-xs text-warm-500 font-medium p-3">Time</th>
                  <th className="text-right text-xs text-warm-500 font-medium p-3">{config.label}</th>
                </tr>
              </thead>
              <tbody>
                {data.slice(0, 20).map((point, idx) => (
                  <tr key={idx} className="border-b border-whoop-divider last:border-0">
                    <td className="text-sm text-warm-300 p-3">
                      {point.timestamp.toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="text-right text-sm font-medium text-white p-3">
                      {config.getValue(point)}{config.unit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.length > 20 && (
            <div className="p-3 text-center text-xs text-warm-500 border-t border-whoop-divider">
              Showing first 20 of {data.length.toLocaleString()} entries
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export default RawDataView;

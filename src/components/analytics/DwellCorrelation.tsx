/**
 * DwellCorrelation - Dual-axis charts showing metric vs dwell time
 * 
 * Shows time-series with two lines overlaid:
 * - Metric value (sound/light/crowd) on left Y-axis
 * - Average stay duration on right Y-axis
 * 
 * This lets bar owners visually see the correlation.
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
  Legend,
  ReferenceLine,
} from 'recharts';
import { 
  Volume2, 
  Sun, 
  Users, 
  Clock,
  TrendingUp,
  TrendingDown,
  Minus,
  Info,
} from 'lucide-react';
import { haptic } from '../../utils/haptics';
import type { DwellCorrelationData, DwellCorrelation as DwellCorrelationType } from '../../types/insights';

interface DwellCorrelationProps {
  data: DwellCorrelationData | null;
  loading: boolean;
}

const factorConfig = {
  sound: { 
    icon: Volume2, 
    color: '#3b82f6', // blue
    label: 'Sound Level',
    unit: 'dB',
  },
  light: { 
    icon: Sun, 
    color: '#eab308', // yellow
    label: 'Lighting',
    unit: 'lux',
  },
  crowd: { 
    icon: Users, 
    color: '#a855f7', // purple
    label: 'Crowd Size',
    unit: 'guests',
  },
};

const dwellColor = '#14b8a6'; // teal for dwell time

function CorrelationChart({ correlation }: { correlation: DwellCorrelationType }) {
  const config = factorConfig[correlation.factor];
  
  // Prepare chart data - only include points with valid dwell time
  const chartData = correlation.dataPoints
    .filter(d => d.dwellMinutes !== null)
    .map(d => ({
      hour: d.hour,
      metric: d.metricValue,
      dwell: d.dwellMinutes,
    }));
  
  if (chartData.length < 3) {
    return (
      <div className="h-48 flex items-center justify-center text-warm-500 text-sm">
        Not enough data points for this chart
      </div>
    );
  }
  
  // Calculate Y-axis domains
  const metricValues = chartData.map(d => d.metric).filter(v => v > 0);
  const dwellValues = chartData.map(d => d.dwell).filter(v => v !== null) as number[];
  
  const metricMin = Math.floor(Math.min(...metricValues) * 0.9);
  const metricMax = Math.ceil(Math.max(...metricValues) * 1.1);
  const dwellMin = Math.floor(Math.min(...dwellValues) * 0.8);
  const dwellMax = Math.ceil(Math.max(...dwellValues) * 1.2);
  
  // Correlation indicator
  const CorrelationIcon = correlation.correlationStrength > 0.2 ? TrendingUp : 
                          correlation.correlationStrength < -0.2 ? TrendingDown : Minus;
  const correlationColor = correlation.correlationStrength > 0.2 ? 'text-recovery-high' : 
                           correlation.correlationStrength < -0.2 ? 'text-recovery-low' : 'text-warm-400';
  
  return (
    <div className="space-y-3">
      {/* Chart Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <config.icon className="w-5 h-5" style={{ color: config.color }} />
          <span className="text-white font-medium">{config.label}</span>
          <span className="text-warm-500 text-sm">vs Stay Duration</span>
        </div>
        <div className={`flex items-center gap-1 text-sm ${correlationColor}`}>
          <CorrelationIcon className="w-4 h-4" />
          <span>r = {correlation.correlationStrength.toFixed(2)}</span>
        </div>
      </div>
      
      {/* Dual-axis Chart */}
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.5} />
            
            <XAxis 
              dataKey="hour" 
              tick={{ fill: '#9ca3af', fontSize: 10 }}
              tickLine={{ stroke: '#4b5563' }}
              axisLine={{ stroke: '#4b5563' }}
              interval="preserveStartEnd"
            />
            
            {/* Left Y-axis: Metric */}
            <YAxis 
              yAxisId="metric"
              orientation="left"
              domain={[metricMin, metricMax]}
              tick={{ fill: config.color, fontSize: 11 }}
              tickLine={{ stroke: config.color }}
              axisLine={{ stroke: config.color }}
              label={{ 
                value: config.unit, 
                angle: -90, 
                position: 'insideLeft',
                fill: config.color,
                fontSize: 11,
              }}
            />
            
            {/* Right Y-axis: Dwell time */}
            <YAxis 
              yAxisId="dwell"
              orientation="right"
              domain={[dwellMin, dwellMax]}
              tick={{ fill: dwellColor, fontSize: 11 }}
              tickLine={{ stroke: dwellColor }}
              axisLine={{ stroke: dwellColor }}
              label={{ 
                value: 'min', 
                angle: 90, 
                position: 'insideRight',
                fill: dwellColor,
                fontSize: 11,
              }}
            />
            
            {/* Reference line for average dwell */}
            <ReferenceLine 
              yAxisId="dwell" 
              y={correlation.overallAvgDwell} 
              stroke={dwellColor} 
              strokeDasharray="5 5" 
              strokeOpacity={0.5}
            />
            
            <Tooltip 
              contentStyle={{ 
                backgroundColor: '#1f2937', 
                border: '1px solid #374151',
                borderRadius: '8px',
                fontSize: '12px',
              }}
              labelStyle={{ color: '#9ca3af' }}
              formatter={(value: number, name: string) => {
                if (name === 'metric') return [`${value} ${config.unit}`, config.label];
                if (name === 'dwell') return [`${value} min`, 'Avg Stay'];
                return [value, name];
              }}
            />
            
            <Legend 
              wrapperStyle={{ fontSize: '11px' }}
              formatter={(value) => {
                if (value === 'metric') return <span style={{ color: config.color }}>{config.label}</span>;
                if (value === 'dwell') return <span style={{ color: dwellColor }}>Avg Stay</span>;
                return value;
              }}
            />
            
            {/* Metric line */}
            <Line 
              yAxisId="metric"
              type="monotone" 
              dataKey="metric" 
              stroke={config.color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: config.color }}
            />
            
            {/* Dwell time line */}
            <Line 
              yAxisId="dwell"
              type="monotone" 
              dataKey="dwell" 
              stroke={dwellColor}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: dwellColor }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      
      {/* Insight */}
      <div className="flex items-start gap-2 p-2 bg-warm-800/50 rounded-lg">
        <Info className="w-4 h-4 text-warm-500 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-warm-400">
          {correlation.insight}
          <span className="text-warm-500 ml-1">
            ({correlation.totalSamples} data points, {correlation.confidence} confidence)
          </span>
        </p>
      </div>
    </div>
  );
}

export function DwellCorrelation({ data, loading }: DwellCorrelationProps) {
  const [activeTab, setActiveTab] = useState<'sound' | 'light' | 'crowd'>('sound');
  
  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-warm-500" />
          <h2 className="text-sm font-semibold text-warm-400 uppercase tracking-whoop">
            Metric vs Guest Stay
          </h2>
        </div>
        <div className="bg-warm-800 rounded-xl p-4 h-72 animate-pulse">
          <div className="h-full bg-warm-700 rounded" />
        </div>
      </div>
    );
  }
  
  if (!data || !data.hasData) {
    return (
      <div className="bg-whoop-panel border border-whoop-divider rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Clock className="w-5 h-5 text-warm-500" />
          <h2 className="text-sm font-semibold text-warm-400 uppercase tracking-whoop">
            Metric vs Guest Stay
          </h2>
        </div>
        <p className="text-sm text-warm-400">
          Not enough data yet. We need more guest traffic to calculate correlations.
        </p>
      </div>
    );
  }
  
  const correlations = {
    sound: data.sound,
    light: data.light,
    crowd: data.crowd,
  };
  
  const activeCorrelation = correlations[activeTab];
  
  // Get available tabs (only show tabs with data)
  const availableTabs = (['sound', 'light', 'crowd'] as const).filter(
    tab => correlations[tab] !== null
  );
  
  if (availableTabs.length === 0) {
    return null;
  }
  
  // Ensure active tab has data
  if (!correlations[activeTab] && availableTabs.length > 0) {
    setActiveTab(availableTabs[0]);
  }
  
  return (
    <motion.div 
      className="bg-whoop-panel border border-whoop-divider rounded-xl p-4 space-y-4"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Section Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-primary" />
          <h2 className="text-sm font-semibold text-warm-400 uppercase tracking-whoop">
            Metric vs Guest Stay
          </h2>
        </div>
        <div className="text-xs text-warm-500">
          {data.totalDataPoints} hours analyzed
        </div>
      </div>
      
      {/* Tab Selector */}
      <div className="flex gap-1 p-1 bg-warm-800/50 rounded-lg">
        {availableTabs.map((tab) => {
          const config = factorConfig[tab];
          const Icon = config.icon;
          const isActive = activeTab === tab;
          
          return (
            <button
              key={tab}
              onClick={() => { haptic('selection'); setActiveTab(tab); }}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md transition-all ${
                isActive
                  ? 'bg-primary text-white'
                  : 'text-warm-400 hover:text-white'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{config.label}</span>
              <span className="sm:hidden">{tab.charAt(0).toUpperCase() + tab.slice(1)}</span>
            </button>
          );
        })}
      </div>
      
      {/* Active Chart */}
      {activeCorrelation && (
        <CorrelationChart correlation={activeCorrelation} />
      )}
    </motion.div>
  );
}

export default DwellCorrelation;

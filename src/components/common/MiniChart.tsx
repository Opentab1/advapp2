/**
 * MiniChart - Lightweight chart components for deep dive modals
 * 
 * Includes:
 * - AreaChart: Smooth area chart with gradient fill
 * - BarChart: Simple bar chart for distributions
 * - SparkLine: Tiny inline trend indicator
 * 
 * No external dependencies - pure SVG
 */

import { motion } from 'framer-motion';

// ============ TYPES ============

export interface DataPoint {
  label: string;
  value: number;
  isCurrent?: boolean;
  isPrediction?: boolean;
}

interface ChartProps {
  data: DataPoint[];
  height?: number;
  color?: string;
  showLabels?: boolean;
  showValues?: boolean;
  animationDelay?: number;
}

// ============ AREA CHART ============

export function AreaChart({
  data,
  height = 120,
  color = '#00F19F',
  showLabels = true,
  showValues = false,
  animationDelay = 0,
}: ChartProps) {
  if (data.length === 0) return null;
  
  const padding = { top: 10, right: 10, bottom: showLabels ? 24 : 10, left: 10 };
  const chartWidth = 100; // Percentage-based
  const chartHeight = height - padding.top - padding.bottom;
  
  const maxValue = Math.max(...data.map(d => d.value), 1);
  const minValue = 0;
  const range = maxValue - minValue;
  
  // Generate path points
  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * 100;
    const y = chartHeight - ((d.value - minValue) / range) * chartHeight + padding.top;
    return { x, y, ...d };
  });
  
  // Create smooth curve path
  const linePath = points.reduce((path, point, i) => {
    if (i === 0) return `M ${point.x} ${point.y}`;
    
    // Simple curve
    const prev = points[i - 1];
    const cpX = (prev.x + point.x) / 2;
    return `${path} C ${cpX} ${prev.y}, ${cpX} ${point.y}, ${point.x} ${point.y}`;
  }, '');
  
  // Create area path (line + bottom)
  const areaPath = `${linePath} L 100 ${chartHeight + padding.top} L 0 ${chartHeight + padding.top} Z`;
  
  // Find current point for marker
  const currentPoint = points.find(p => p.isCurrent);
  const predictionStartIndex = points.findIndex(p => p.isPrediction);
  
  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
      >
        <defs>
          <linearGradient id={`gradient-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0.05" />
          </linearGradient>
          
          {/* Prediction pattern */}
          <pattern id="prediction-pattern" patternUnits="userSpaceOnUse" width="4" height="4">
            <path d="M-1,1 l2,-2 M0,4 l4,-4 M3,5 l2,-2" stroke={color} strokeWidth="0.5" strokeOpacity="0.3" />
          </pattern>
        </defs>
        
        {/* Grid lines */}
        <g className="text-warm-700">
          {[0.25, 0.5, 0.75].map((ratio) => (
            <line
              key={ratio}
              x1="0"
              y1={padding.top + chartHeight * (1 - ratio)}
              x2="100"
              y2={padding.top + chartHeight * (1 - ratio)}
              stroke="currentColor"
              strokeWidth="0.3"
              strokeDasharray="2,2"
            />
          ))}
        </g>
        
        {/* Area fill */}
        <motion.path
          d={areaPath}
          fill={`url(#gradient-${color.replace('#', '')})`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: animationDelay }}
        />
        
        {/* Prediction area (dashed) */}
        {predictionStartIndex > 0 && (
          <motion.path
            d={`M ${points[predictionStartIndex].x} ${points[predictionStartIndex].y} ${
              points.slice(predictionStartIndex).reduce((path, point, i) => {
                if (i === 0) return path;
                const prev = points[predictionStartIndex + i - 1];
                const cpX = (prev.x + point.x) / 2;
                return `${path} C ${cpX} ${prev.y}, ${cpX} ${point.y}, ${point.x} ${point.y}`;
              }, '')
            } L 100 ${chartHeight + padding.top} L ${points[predictionStartIndex].x} ${chartHeight + padding.top} Z`}
            fill="url(#prediction-pattern)"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: animationDelay + 0.2 }}
          />
        )}
        
        {/* Line */}
        <motion.path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.8, delay: animationDelay }}
        />
        
        {/* Prediction line (dashed) */}
        {predictionStartIndex > 0 && (
          <motion.path
            d={points.slice(predictionStartIndex).reduce((path, point, i) => {
              if (i === 0) return `M ${point.x} ${point.y}`;
              const prev = points[predictionStartIndex + i - 1];
              const cpX = (prev.x + point.x) / 2;
              return `${path} C ${cpX} ${prev.y}, ${cpX} ${point.y}, ${point.x} ${point.y}`;
            }, '')}
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="4,3"
            vectorEffect="non-scaling-stroke"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.6 }}
            transition={{ duration: 0.5, delay: animationDelay + 0.3 }}
          />
        )}
        
        {/* Current point marker */}
        {currentPoint && (
          <motion.g
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, delay: animationDelay + 0.5 }}
          >
            <circle
              cx={currentPoint.x}
              cy={currentPoint.y}
              r="4"
              fill={color}
              stroke="#1a1a1a"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={currentPoint.x}
              cy={currentPoint.y}
              r="8"
              fill={color}
              fillOpacity="0.3"
              vectorEffect="non-scaling-stroke"
            />
          </motion.g>
        )}
        
        {/* Value labels on points */}
        {showValues && points.filter((_, i) => i % Math.ceil(points.length / 6) === 0 || points[i].isCurrent).map((point, i) => (
          <text
            key={i}
            x={point.x}
            y={point.y - 8}
            textAnchor="middle"
            className="text-[8px] fill-warm-300"
            vectorEffect="non-scaling-stroke"
          >
            {point.value}
          </text>
        ))}
      </svg>
      
      {/* X-axis labels */}
      {showLabels && (
        <div className="flex justify-between px-1 -mt-1">
          {data.filter((_, i) => i % Math.ceil(data.length / 6) === 0 || i === data.length - 1).map((d, i) => (
            <span
              key={i}
              className={`text-[10px] ${d.isCurrent ? 'text-primary font-semibold' : 'text-warm-500'}`}
            >
              {d.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ============ BAR CHART ============

export function BarChart({
  data,
  height = 100,
  color = '#00F19F',
  showLabels = true,
  animationDelay = 0,
}: ChartProps) {
  if (data.length === 0) return null;
  
  const maxValue = Math.max(...data.map(d => d.value), 1);
  const barWidth = 100 / data.length;
  const barGap = barWidth * 0.2;
  
  return (
    <div className="w-full">
      <div className="flex items-end justify-between gap-1" style={{ height }}>
        {data.map((d, i) => {
          const barHeight = (d.value / maxValue) * 100;
          return (
            <div key={i} className="flex-1 flex flex-col items-center">
              <motion.div
                className="w-full rounded-t-sm"
                style={{
                  backgroundColor: d.isCurrent ? color : `${color}66`,
                  minHeight: 4,
                }}
                initial={{ height: 0 }}
                animate={{ height: `${barHeight}%` }}
                transition={{ duration: 0.4, delay: animationDelay + i * 0.05 }}
              />
            </div>
          );
        })}
      </div>
      
      {showLabels && (
        <div className="flex justify-between mt-1">
          {data.map((d, i) => (
            <span
              key={i}
              className={`text-[10px] flex-1 text-center ${
                d.isCurrent ? 'text-primary font-semibold' : 'text-warm-500'
              }`}
            >
              {d.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ============ HORIZONTAL BAR CHART ============

interface HorizontalBarProps {
  label: string;
  value: number;
  maxValue: number;
  color?: string;
  suffix?: string;
}

export function HorizontalBar({ label, value, maxValue, color = '#00F19F', suffix = '' }: HorizontalBarProps) {
  const percentage = (value / maxValue) * 100;
  
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-warm-300">{label}</span>
        <span className="text-warm-100 font-medium">{value}{suffix}</span>
      </div>
      <div className="h-2 bg-warm-700 rounded-full overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: color }}
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.5 }}
        />
      </div>
    </div>
  );
}

// ============ SPARKLINE ============

interface SparkLineProps {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}

export function SparkLine({ data, color = '#00F19F', width = 60, height = 20 }: SparkLineProps) {
  if (data.length < 2) return null;
  
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(' ');
  
  return (
    <svg width={width} height={height} className="inline-block">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ============ STAT COMPARISON ============

interface StatComparisonProps {
  label: string;
  current: number;
  previous: number;
  format?: (v: number) => string;
}

export function StatComparison({ label, current, previous, format = (v) => v.toString() }: StatComparisonProps) {
  const diff = current - previous;
  const percentChange = previous > 0 ? Math.round((diff / previous) * 100) : 0;
  const isPositive = diff >= 0;
  
  return (
    <div className="flex items-center justify-between py-2 border-b border-warm-700/50 last:border-0">
      <span className="text-sm text-warm-300">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-warm-100">{format(current)}</span>
        {previous > 0 && (
          <span className={`text-xs px-1.5 py-0.5 rounded ${
            isPositive ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'
          }`}>
            {isPositive ? '↑' : '↓'} {Math.abs(percentChange)}%
          </span>
        )}
      </div>
    </div>
  );
}

// ============ LEGACY MINICHART (backward compatibility) ============

interface LegacyMiniChartProps {
  data: number[];
  color?: string;
  threshold?: number;
  thresholdLabel?: string;
  height?: number;
}

export function MiniChart({ 
  data, 
  color = '#00F19F', 
  threshold, 
  thresholdLabel,
  height = 60 
}: LegacyMiniChartProps) {
  if (!data || data.length < 2) return null;
  
  const max = Math.max(...data, threshold || 0);
  const min = Math.min(...data);
  const range = max - min || 1;
  const width = 100;
  
  // Generate path
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 10) - 5;
    return { x, y };
  });
  
  const linePath = points.reduce((path, point, i) => {
    if (i === 0) return `M ${point.x} ${point.y}`;
    const prev = points[i - 1];
    const cpX = (prev.x + point.x) / 2;
    return `${path} C ${cpX} ${prev.y}, ${cpX} ${point.y}, ${point.x} ${point.y}`;
  }, '');
  
  const areaPath = `${linePath} L ${width} ${height} L 0 ${height} Z`;
  
  // Threshold line position
  const thresholdY = threshold ? height - ((threshold - min) / range) * (height - 10) - 5 : null;
  
  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
      >
        <defs>
          <linearGradient id={`mini-gradient-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0.05" />
          </linearGradient>
        </defs>
        
        {/* Area fill */}
        <path
          d={areaPath}
          fill={`url(#mini-gradient-${color.replace('#', '')})`}
        />
        
        {/* Line */}
        <path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        
        {/* Threshold line */}
        {thresholdY !== null && (
          <line
            x1="0"
            y1={thresholdY}
            x2={width}
            y2={thresholdY}
            stroke={color}
            strokeWidth="1"
            strokeDasharray="4,2"
            strokeOpacity="0.5"
            vectorEffect="non-scaling-stroke"
          />
        )}
        
        {/* Current point */}
        <circle
          cx={points[points.length - 1].x}
          cy={points[points.length - 1].y}
          r="3"
          fill={color}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      
      {thresholdLabel && (
        <div className="flex justify-end mt-1">
          <span className="text-xs text-warm-400">{thresholdLabel}</span>
        </div>
      )}
    </div>
  );
}

export default { AreaChart, BarChart, HorizontalBar, SparkLine, StatComparison, MiniChart };

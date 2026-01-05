/**
 * MiniChart - Compact sparkline chart
 * 
 * Used in action detail modals to show recent trends.
 * Simple SVG-based, no heavy chart library needed.
 */

import { useMemo } from 'react';

interface MiniChartProps {
  /** Array of numeric values */
  data: number[];
  /** Height in pixels */
  height?: number;
  /** Color of the line */
  color?: string;
  /** Optional: show horizontal threshold line */
  threshold?: number;
  /** Threshold line color */
  thresholdColor?: string;
  /** Label for the threshold */
  thresholdLabel?: string;
}

export function MiniChart({
  data,
  height = 60,
  color = '#0093E7',
  threshold,
  thresholdColor = '#E7E5E4',
  thresholdLabel,
}: MiniChartProps) {
  const width = 280; // Fixed width, container will scale
  const padding = 4;
  
  const { path, thresholdY, minVal, maxVal } = useMemo(() => {
    if (data.length === 0) {
      return { path: '', thresholdY: null, minVal: 0, maxVal: 100 };
    }
    
    const minVal = Math.min(...data);
    const maxVal = Math.max(...data);
    const range = maxVal - minVal || 1; // Avoid division by zero
    
    // Add some padding to the range
    const paddedMin = minVal - range * 0.1;
    const paddedMax = maxVal + range * 0.1;
    const paddedRange = paddedMax - paddedMin;
    
    // Calculate points
    const points = data.map((value, index) => {
      const x = padding + (index / (data.length - 1)) * (width - padding * 2);
      const y = height - padding - ((value - paddedMin) / paddedRange) * (height - padding * 2);
      return `${x},${y}`;
    });
    
    const path = `M ${points.join(' L ')}`;
    
    // Calculate threshold Y position
    let thresholdY = null;
    if (threshold !== undefined) {
      thresholdY = height - padding - ((threshold - paddedMin) / paddedRange) * (height - padding * 2);
    }
    
    return { path, thresholdY, minVal, maxVal };
  }, [data, height, threshold]);
  
  if (data.length < 2) {
    return (
      <div 
        className="flex items-center justify-center bg-warm-50 rounded-lg text-warm-400 text-sm"
        style={{ height }}
      >
        Not enough data
      </div>
    );
  }
  
  return (
    <div className="relative">
      <svg 
        width="100%" 
        height={height} 
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="rounded-lg bg-warm-50"
      >
        {/* Threshold line */}
        {thresholdY !== null && (
          <line
            x1={padding}
            y1={thresholdY}
            x2={width - padding}
            y2={thresholdY}
            stroke={thresholdColor}
            strokeWidth={1}
            strokeDasharray="4,4"
          />
        )}
        
        {/* Data line */}
        <path
          d={path}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        
        {/* End point dot */}
        {data.length > 0 && (
          <circle
            cx={width - padding}
            cy={height - padding - ((data[data.length - 1] - (minVal - (maxVal - minVal) * 0.1)) / ((maxVal - minVal) * 1.2 || 1)) * (height - padding * 2)}
            r={4}
            fill={color}
          />
        )}
      </svg>
      
      {/* Threshold label */}
      {thresholdLabel && thresholdY !== null && (
        <div 
          className="absolute right-2 text-[10px] text-warm-400 font-medium"
          style={{ top: thresholdY - 14 }}
        >
          {thresholdLabel}
        </div>
      )}
    </div>
  );
}

export default MiniChart;

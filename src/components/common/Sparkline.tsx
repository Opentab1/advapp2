/**
 * Sparkline - Tiny inline trend chart
 * 
 * Shows recent history in a compact format.
 */

import { useMemo } from 'react';
import { motion } from 'framer-motion';

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  showDot?: boolean;
}

export function Sparkline({
  data,
  width = 80,
  height = 24,
  color = '#0077B6',
  showDot = true,
}: SparklineProps) {
  const path = useMemo(() => {
    if (data.length < 2) return '';
    
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const padding = 2;
    
    const points = data.map((value, index) => {
      const x = padding + (index / (data.length - 1)) * (width - padding * 2);
      const y = height - padding - ((value - min) / range) * (height - padding * 2);
      return { x, y };
    });
    
    // Create smooth curve
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const cpx = (prev.x + curr.x) / 2;
      d += ` Q ${prev.x} ${prev.y} ${cpx} ${(prev.y + curr.y) / 2}`;
    }
    d += ` L ${points[points.length - 1].x} ${points[points.length - 1].y}`;
    
    return { d, lastPoint: points[points.length - 1] };
  }, [data, width, height]);
  
  if (data.length < 2) {
    return (
      <div 
        className="flex items-center justify-center text-warm-400 text-xs"
        style={{ width, height }}
      >
        —
      </div>
    );
  }
  
  return (
    <svg width={width} height={height} className="overflow-visible">
      {/* Line */}
      <motion.path
        d={path.d}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
      />
      
      {/* End dot */}
      {showDot && path.lastPoint && (
        <motion.circle
          cx={path.lastPoint.x}
          cy={path.lastPoint.y}
          r={3}
          fill={color}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.6 }}
        />
      )}
    </svg>
  );
}

export default Sparkline;

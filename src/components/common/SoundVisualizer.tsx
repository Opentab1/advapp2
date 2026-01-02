/**
 * SoundVisualizer - Real-time audio level animation
 * 
 * Shows animated bars representing sound level.
 */

import { motion } from 'framer-motion';
import { useMemo } from 'react';

interface SoundVisualizerProps {
  level: number | null; // 0-100 normalized
  barCount?: number;
  color?: string;
  height?: number;
}

export function SoundVisualizer({
  level,
  barCount = 5,
  color = '#0077B6',
  height = 20,
}: SoundVisualizerProps) {
  const bars = useMemo(() => {
    return Array.from({ length: barCount }, (_, i) => {
      // Create varied heights based on position and level
      const baseHeight = level !== null ? (level / 100) * height : 0.2 * height;
      const variance = Math.sin((i / barCount) * Math.PI) * 0.5 + 0.5;
      return {
        id: i,
        height: baseHeight * variance,
        delay: i * 0.1,
      };
    });
  }, [level, barCount, height]);
  
  if (level === null) {
    return (
      <div className="flex items-end gap-0.5" style={{ height }}>
        {bars.map((bar) => (
          <div
            key={bar.id}
            className="w-1 bg-warm-300 rounded-full"
            style={{ height: 4 }}
          />
        ))}
      </div>
    );
  }
  
  return (
    <div className="flex items-end gap-0.5" style={{ height }}>
      {bars.map((bar) => (
        <motion.div
          key={bar.id}
          className="w-1 rounded-full"
          style={{ backgroundColor: color }}
          animate={{
            height: [bar.height * 0.5, bar.height, bar.height * 0.7, bar.height],
          }}
          transition={{
            duration: 0.5,
            repeat: Infinity,
            repeatType: 'reverse',
            delay: bar.delay,
            ease: 'easeInOut',
          }}
        />
      ))}
    </div>
  );
}

export default SoundVisualizer;

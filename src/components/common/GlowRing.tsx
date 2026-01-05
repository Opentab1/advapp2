/**
 * GlowRing - Ring with animated glow effect based on status
 * 
 * Glows green when optimal, amber when good, red when poor.
 * Matte black theme.
 */

import { motion } from 'framer-motion';
import { SCORE_THRESHOLDS } from '../../utils/constants';

interface GlowRingProps {
  score: number | null;
  size?: number;
  strokeWidth?: number;
  children?: React.ReactNode;
}

export function GlowRing({
  score,
  size = 160,
  strokeWidth = 12,
  children,
}: GlowRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = score !== null
    ? circumference - (score / 100) * circumference
    : circumference;
  
  // Determine color based on score
  const getColor = () => {
    if (score === null) return { main: '#9CA3AF', glow: 'transparent' };
    if (score >= SCORE_THRESHOLDS.optimal) return { main: '#22C55E', glow: 'rgba(34, 197, 94, 0.4)' };
    if (score >= SCORE_THRESHOLDS.good) return { main: '#F59E0B', glow: 'rgba(245, 158, 11, 0.4)' };
    return { main: '#EF4444', glow: 'rgba(239, 68, 68, 0.4)' };
  };
  
  const colors = getColor();
  const isOptimal = score !== null && score >= SCORE_THRESHOLDS.optimal;
  
  return (
    <div className="relative" style={{ width: size, height: size }}>
      {/* Glow effect */}
      <motion.div
        className="absolute inset-0 rounded-full"
        style={{
          boxShadow: `0 0 ${isOptimal ? 30 : 20}px ${colors.glow}, 0 0 ${isOptimal ? 60 : 40}px ${colors.glow}`,
        }}
        animate={{
          opacity: score !== null ? [0.5, 1, 0.5] : 0,
          scale: score !== null ? [1, 1.02, 1] : 1,
        }}
        transition={{
          duration: 2,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />
      
      {/* SVG Ring */}
      <svg
        className="absolute inset-0 -rotate-90"
        width={size}
        height={size}
      >
        {/* Background ring */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#262626"
          strokeWidth={strokeWidth}
        />
        
        {/* Progress ring */}
        {score !== null && (
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={colors.main}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 1, ease: 'easeOut' }}
            style={{
              filter: `drop-shadow(0 0 6px ${colors.glow})`,
            }}
          />
        )}
      </svg>
      
      {/* Center content */}
      <div className="absolute inset-0 flex items-center justify-center">
        {children}
      </div>
    </div>
  );
}

export default GlowRing;

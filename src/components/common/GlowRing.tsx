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
  
  // Determine color based on score - WHOOP Recovery palette
  const getColor = () => {
    if (score === null) return { main: '#6C7684', glow: 'transparent' };
    if (score >= SCORE_THRESHOLDS.optimal) return { main: '#16EC06', glow: 'rgba(22, 236, 6, 0.4)' };
    if (score >= SCORE_THRESHOLDS.good) return { main: '#FFDE00', glow: 'rgba(255, 222, 0, 0.4)' };
    return { main: '#FF0026', glow: 'rgba(255, 0, 38, 0.4)' };
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
          stroke="#1C222B"
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

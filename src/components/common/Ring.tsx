/**
 * Ring - Animated circular progress ring with glow effects
 * 
 * Core visual component for Pulse Score and supporting metrics.
 * Features WHOOP-style glow based on score status.
 */

import { motion } from 'framer-motion';
import { SCORE_THRESHOLDS } from '../../utils/constants';
import { AnimatedNumber } from './AnimatedNumber';
import { haptic } from '../../utils/haptics';

export type RingSize = 'hero' | 'large' | 'medium' | 'small';

interface RingProps {
  /** Score from 0-100 (null shows '--') */
  score: number | null;
  /** Label below the ring */
  label: string;
  /** Value to display in center (e.g., "78", "4.2★", "42m"). Defaults to score. */
  value?: string;
  /** Optional subtitle in center (e.g., "Optimal") */
  subtitle?: string;
  /** Ring color (hex) */
  color: string;
  /** Size variant */
  size?: RingSize;
  /** Click handler for drill-down */
  onClick?: () => void;
  /** Show "tap for details" hint */
  showHint?: boolean;
  /** Enable glow effect */
  glow?: boolean;
}

const SIZE_CONFIG: Record<RingSize, {
  ringSize: number;
  strokeWidth: number;
  scoreClass: string;
  subtitleClass: string;
  labelClass: string;
  padding: string;
}> = {
  hero: {
    ringSize: 160,
    strokeWidth: 12,
    scoreClass: 'text-5xl font-bold',
    subtitleClass: 'text-sm font-medium',
    labelClass: 'text-base font-semibold',
    padding: 'p-5',
  },
  large: {
    ringSize: 140,
    strokeWidth: 10,
    scoreClass: 'text-4xl font-bold',
    subtitleClass: 'text-xs font-medium',
    labelClass: 'text-sm font-semibold',
    padding: 'p-4',
  },
  medium: {
    ringSize: 100,
    strokeWidth: 8,
    scoreClass: 'text-2xl font-bold',
    subtitleClass: 'text-xs',
    labelClass: 'text-xs font-medium',
    padding: 'p-3',
  },
  small: {
    ringSize: 80,
    strokeWidth: 6,
    scoreClass: 'text-lg font-bold',
    subtitleClass: 'text-[10px]',
    labelClass: 'text-[10px] font-medium',
    padding: 'p-2',
  },
};

// Get glow color based on score
function getGlowColor(score: number | null): { color: string; opacity: number } {
  if (score === null) return { color: 'transparent', opacity: 0 };
  if (score >= SCORE_THRESHOLDS.optimal) return { color: 'rgba(34, 197, 94, 0.4)', opacity: 1 };
  if (score >= SCORE_THRESHOLDS.good) return { color: 'rgba(245, 158, 11, 0.35)', opacity: 0.8 };
  return { color: 'rgba(239, 68, 68, 0.3)', opacity: 0.7 };
}

export function Ring({
  score,
  label,
  value,
  subtitle,
  color,
  size = 'medium',
  onClick,
  showHint = false,
  glow = true,
}: RingProps) {
  const config = SIZE_CONFIG[size];
  const { ringSize, strokeWidth, scoreClass, subtitleClass, labelClass, padding } = config;

  const radius = (ringSize - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = score !== null 
    ? circumference - (score / 100) * circumference 
    : circumference;

  // Display value: use provided value, or score, or '--'
  const displayValue = value ?? (score !== null ? String(score) : '--');
  const isNumeric = !value && score !== null;
  
  const glowConfig = getGlowColor(score);
  const isOptimal = score !== null && score >= SCORE_THRESHOLDS.optimal;
  
  const handleClick = () => {
    if (onClick) {
      haptic('light');
      onClick();
    }
  };

  const content = (
    <div
      className={`
        flex flex-col items-center gap-2 ${padding} rounded-2xl 
        bg-white dark:bg-warm-800 border border-warm-200 dark:border-warm-700 shadow-card
        ${onClick ? 'hover:shadow-card-hover cursor-pointer' : ''} 
        transition-all duration-200
      `}
    >
      <div className="relative" style={{ width: ringSize, height: ringSize }}>
        {/* Glow effect */}
        {glow && score !== null && (
          <motion.div
            className="absolute inset-0 rounded-full"
            style={{
              boxShadow: `0 0 ${isOptimal ? 25 : 15}px ${glowConfig.color}, 0 0 ${isOptimal ? 50 : 30}px ${glowConfig.color}`,
            }}
            animate={{
              opacity: [glowConfig.opacity * 0.5, glowConfig.opacity, glowConfig.opacity * 0.5],
              scale: [1, 1.02, 1],
            }}
            transition={{
              duration: 2.5,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
        )}
        
        {/* Background ring */}
        <svg className="absolute inset-0 -rotate-90" width={ringSize} height={ringSize}>
          <circle
            cx={ringSize / 2}
            cy={ringSize / 2}
            r={radius}
            fill="none"
            stroke="#E7E5E4"
            strokeWidth={strokeWidth}
            className="dark:stroke-warm-700"
          />
          {/* Animated progress ring */}
          {score !== null && (
            <motion.circle
              cx={ringSize / 2}
              cy={ringSize / 2}
              r={radius}
              fill="none"
              stroke={color}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeDasharray={circumference}
              initial={{ strokeDashoffset: circumference }}
              animate={{ strokeDashoffset: offset }}
              transition={{ duration: 1, ease: 'easeOut' }}
              style={{
                filter: glow ? `drop-shadow(0 0 4px ${glowConfig.color})` : undefined,
              }}
            />
          )}
        </svg>

        {/* Center content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {isNumeric ? (
            <AnimatedNumber 
              value={score} 
              className={`${scoreClass} text-warm-800 dark:text-warm-100`}
            />
          ) : (
            <span className={`${scoreClass} text-warm-800 dark:text-warm-100`}>{displayValue}</span>
          )}
          {subtitle && (
            <span className={`${subtitleClass} text-warm-500 dark:text-warm-400`}>{subtitle}</span>
          )}
        </div>
      </div>

      {/* Label */}
      <div className="text-center">
        <span className={`${labelClass} text-warm-700 dark:text-warm-300`}>{label}</span>
        {showHint && (
          <p className="text-[10px] text-primary mt-0.5">tap for details</p>
        )}
      </div>
    </div>
  );

  if (onClick) {
    return (
      <motion.button
        onClick={handleClick}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
      >
        {content}
      </motion.button>
    );
  }

  return content;
}

export default Ring;

/**
 * Ring - Animated circular progress ring
 * 
 * Core visual component for Pulse Score and supporting metrics.
 * Reused across all ring displays.
 */

import { motion } from 'framer-motion';

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

export function Ring({
  score,
  label,
  value,
  subtitle,
  color,
  size = 'medium',
  onClick,
  showHint = false,
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

  const content = (
    <div
      className={`
        flex flex-col items-center gap-2 ${padding} rounded-2xl 
        bg-white border border-warm-200 shadow-card
        ${onClick ? 'hover:shadow-card-hover cursor-pointer' : ''} 
        transition-shadow
      `}
    >
      <div className="relative" style={{ width: ringSize, height: ringSize }}>
        {/* Background ring */}
        <svg className="absolute inset-0 -rotate-90" width={ringSize} height={ringSize}>
          <circle
            cx={ringSize / 2}
            cy={ringSize / 2}
            r={radius}
            fill="none"
            stroke="#E7E5E4"
            strokeWidth={strokeWidth}
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
            />
          )}
        </svg>

        {/* Center content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`${scoreClass} text-warm-800`}>{displayValue}</span>
          {subtitle && (
            <span className={`${subtitleClass} text-warm-500`}>{subtitle}</span>
          )}
        </div>
      </div>

      {/* Label */}
      <div className="text-center">
        <span className={`${labelClass} text-warm-700`}>{label}</span>
        {showHint && (
          <p className="text-[10px] text-primary mt-0.5">tap for details</p>
        )}
      </div>
    </div>
  );

  if (onClick) {
    return (
      <motion.button
        onClick={onClick}
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

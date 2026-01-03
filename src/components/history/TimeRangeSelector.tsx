/**
 * TimeRangeSelector - Modern pill-style time range picker
 * 
 * Features:
 * - Animated selection indicator
 * - Disabled state during loading
 * - Haptic feedback
 */

import { motion } from 'framer-motion';
import { haptic } from '../../utils/haptics';
import type { TimeRange } from '../../types';

interface TimeRangeSelectorProps {
  value: TimeRange;
  onChange: (range: TimeRange) => void;
  disabled?: boolean;
}

const RANGES: { value: TimeRange; label: string; shortLabel: string }[] = [
  { value: '24h', label: '24 Hours', shortLabel: '24h' },
  { value: '7d', label: '7 Days', shortLabel: '7d' },
  { value: '30d', label: '30 Days', shortLabel: '30d' },
  { value: '90d', label: '90 Days', shortLabel: '90d' },
];

export function TimeRangeSelector({ value, onChange, disabled = false }: TimeRangeSelectorProps) {
  return (
    <div className="relative bg-warm-800 rounded-xl p-1 flex">
      {/* Animated background indicator */}
      <motion.div
        className="absolute top-1 bottom-1 bg-primary rounded-lg"
        initial={false}
        animate={{
          left: `calc(${RANGES.findIndex(r => r.value === value) * 25}% + 4px)`,
          width: 'calc(25% - 8px)',
        }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      />
      
      {/* Buttons */}
      {RANGES.map((range) => {
        const isActive = value === range.value;
        return (
          <button
            key={range.value}
            disabled={disabled}
            onClick={() => {
              if (range.value !== value) {
                haptic('selection');
                onChange(range.value);
              }
            }}
            className={`
              relative flex-1 py-2.5 text-sm font-medium text-center rounded-lg z-10
              transition-colors duration-150
              ${disabled ? 'cursor-wait opacity-60' : 'cursor-pointer'}
              ${isActive ? 'text-white' : 'text-warm-400 hover:text-warm-200'}
            `}
          >
            {/* Show short label on mobile, full on desktop */}
            <span className="sm:hidden">{range.shortLabel}</span>
            <span className="hidden sm:inline">{range.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export default TimeRangeSelector;

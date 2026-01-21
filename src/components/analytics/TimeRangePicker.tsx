/**
 * TimeRangePicker - Simple, minimal time range selector
 */

import { motion } from 'framer-motion';
import { haptic } from '../../utils/haptics';
import type { InsightsTimeRange } from '../../types/insights';

interface TimeRangePickerProps {
  value: InsightsTimeRange;
  onChange: (range: InsightsTimeRange) => void;
  loading?: boolean;
}

const options: Array<{ value: InsightsTimeRange; label: string }> = [
  { value: 'last_night', label: 'Last Night' },
  { value: '7d', label: '7 Days' },
  { value: '14d', label: '14 Days' },
  { value: '30d', label: '30 Days' },
];

export function TimeRangePicker({ value, onChange, loading }: TimeRangePickerProps) {
  const handleChange = (newValue: InsightsTimeRange) => {
    haptic('selection');
    onChange(newValue);
  };

  return (
    <div className="flex gap-1 p-1 bg-warm-800/50 rounded-lg border border-warm-700">
      {options.map((option) => (
        <motion.button
          key={option.value}
          onClick={() => handleChange(option.value)}
          disabled={loading}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
            value === option.value
              ? 'bg-primary text-white'
              : 'text-warm-400 hover:text-white'
          } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
          whileTap={{ scale: 0.95 }}
        >
          {option.label}
        </motion.button>
      ))}
    </div>
  );
}

export default TimeRangePicker;

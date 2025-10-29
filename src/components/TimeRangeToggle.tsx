import { motion } from 'framer-motion';
import type { TimeRange } from '../types';

interface TimeRangeToggleProps {
  selected: TimeRange;
  onChange: (range: TimeRange) => void;
}

const ranges: { value: TimeRange; label: string }[] = [
  { value: 'live', label: 'Live' },
  { value: '6h', label: '6H' },
  { value: '24h', label: '24H' },
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: '90d', label: '90D' }
];

export function TimeRangeToggle({ selected, onChange }: TimeRangeToggleProps) {
  return (
    <div className="flex gap-2 flex-wrap">
      {ranges.map((range) => (
        <motion.button
          key={range.value}
          onClick={() => onChange(range.value)}
          className={`
            px-4 py-2 rounded-lg font-medium text-sm transition-all relative overflow-hidden
            ${selected === range.value
              ? 'text-navy bg-cyan'
              : 'text-gray-300 bg-white/5 hover:bg-white/10'
            }
          `}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          {selected === range.value && (
            <motion.div
              className="absolute inset-0 bg-cyan"
              layoutId="activeRange"
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            />
          )}
          <span className="relative z-10">{range.label}</span>
        </motion.button>
      ))}
    </div>
  );
}

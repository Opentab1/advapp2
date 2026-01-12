/**
 * InsightsHeader - Time range selector for Analytics page
 * 
 * Mobile: Dropdown
 * Desktop: Segmented control
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Calendar, ChevronDown, RefreshCw } from 'lucide-react';
import { haptic } from '../../utils/haptics';
import type { InsightsTimeRange } from '../../types/insights';

interface InsightsHeaderProps {
  timeRange: InsightsTimeRange;
  onTimeRangeChange: (range: InsightsTimeRange) => void;
  loading: boolean;
  onRefresh: () => void;
}

const TIME_RANGES: Array<{ value: InsightsTimeRange; label: string }> = [
  { value: 'last_night', label: 'Last Night' },
  { value: '7d', label: '7 Days' },
  { value: '14d', label: '14 Days' },
  { value: '30d', label: '30 Days' },
];

export function InsightsHeader({ 
  timeRange, 
  onTimeRangeChange, 
  loading, 
  onRefresh 
}: InsightsHeaderProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  
  const currentLabel = TIME_RANGES.find(r => r.value === timeRange)?.label || 'Last Night';

  const handleSelect = (range: InsightsTimeRange) => {
    haptic('selection');
    onTimeRangeChange(range);
    setShowDropdown(false);
  };

  const handleRefresh = () => {
    haptic('medium');
    onRefresh();
  };

  return (
    <div className="flex items-center justify-between mb-6">
      {/* Title */}
      <h1 className="text-2xl font-bold text-white">Analytics</h1>

      <div className="flex items-center gap-3">
        {/* Mobile: Dropdown */}
        <div className="relative lg:hidden">
          <button
            onClick={() => {
              haptic('light');
              setShowDropdown(!showDropdown);
            }}
            className="flex items-center gap-2 px-3 py-2 bg-whoop-panel border border-whoop-divider rounded-lg"
          >
            <Calendar className="w-4 h-4 text-warm-400" />
            <span className="text-sm font-medium text-white">{currentLabel}</span>
            <ChevronDown className={`w-4 h-4 text-warm-400 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
          </button>

          <AnimatePresence>
            {showDropdown && (
              <>
                {/* Backdrop */}
                <div 
                  className="fixed inset-0 z-40" 
                  onClick={() => setShowDropdown(false)} 
                />
                
                {/* Dropdown */}
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="absolute right-0 top-full mt-2 w-40 bg-whoop-panel border border-whoop-divider rounded-xl shadow-xl z-50 overflow-hidden"
                >
                  {TIME_RANGES.map((range) => (
                    <button
                      key={range.value}
                      onClick={() => handleSelect(range.value)}
                      className={`w-full text-left px-4 py-3 text-sm transition-colors ${
                        timeRange === range.value 
                          ? 'text-teal bg-teal/10 font-medium' 
                          : 'text-warm-200 hover:bg-warm-800'
                      }`}
                    >
                      {range.label}
                    </button>
                  ))}
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>

        {/* Desktop: Segmented control */}
        <div className="hidden lg:flex items-center bg-whoop-panel border border-whoop-divider rounded-lg p-1">
          {TIME_RANGES.map((range) => (
            <button
              key={range.value}
              onClick={() => handleSelect(range.value)}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
                timeRange === range.value
                  ? 'bg-teal/20 text-teal border border-teal/30'
                  : 'text-warm-400 hover:text-white'
              }`}
            >
              {range.label}
            </button>
          ))}
        </div>

        {/* Refresh button */}
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="p-2 text-warm-400 hover:text-white transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
    </div>
  );
}

export default InsightsHeader;

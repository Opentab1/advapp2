/**
 * CollapsibleSection - Wrapper for sections that can be collapsed
 * 
 * Features:
 * - Smooth expand/collapse animation
 * - Optional header with toggle button
 * - Remembers state via parent hook
 */

import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { haptic } from '../../utils/haptics';

interface CollapsibleSectionProps {
  id: string;
  title?: string;
  icon?: React.ReactNode;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  showHeader?: boolean;
  className?: string;
}

export function CollapsibleSection({
  id,
  title,
  icon,
  collapsed,
  onToggle,
  children,
  showHeader = true,
  className = '',
}: CollapsibleSectionProps) {
  const handleToggle = () => {
    haptic('light');
    onToggle();
  };
  
  return (
    <div className={className}>
      {/* Header (optional) */}
      {showHeader && title && (
        <button
          onClick={handleToggle}
          className="w-full flex items-center justify-between py-2 px-1 text-left group"
        >
          <div className="flex items-center gap-2">
            {icon && <span className="text-warm-400">{icon}</span>}
            <span className="text-sm font-medium text-warm-300 group-hover:text-warm-100 transition-colors">
              {title}
            </span>
          </div>
          <motion.div
            animate={{ rotate: collapsed ? 0 : 180 }}
            transition={{ duration: 0.2 }}
            className="text-warm-500 group-hover:text-warm-300 transition-colors"
          >
            <ChevronDown className="w-4 h-4" />
          </motion.div>
        </button>
      )}
      
      {/* Content */}
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            key={`section-${id}`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Collapsed indicator (when no header) */}
      {!showHeader && collapsed && (
        <motion.button
          onClick={handleToggle}
          className="w-full py-2 flex items-center justify-center gap-2 text-xs text-warm-500 hover:text-warm-300 transition-colors"
          whileTap={{ scale: 0.98 }}
        >
          <ChevronDown className="w-3 h-3" />
          <span>Show {title || 'section'}</span>
        </motion.button>
      )}
    </div>
  );
}

// Minimal version - just the collapse button, no wrapper
export function CollapseButton({
  collapsed,
  onToggle,
  label,
}: {
  collapsed: boolean;
  onToggle: () => void;
  label?: string;
}) {
  return (
    <button
      onClick={() => { haptic('light'); onToggle(); }}
      className="flex items-center gap-1 text-xs text-warm-500 hover:text-warm-300 transition-colors"
    >
      {collapsed ? (
        <>
          <ChevronDown className="w-3 h-3" />
          <span>Show{label ? ` ${label}` : ''}</span>
        </>
      ) : (
        <>
          <ChevronUp className="w-3 h-3" />
          <span>Hide{label ? ` ${label}` : ''}</span>
        </>
      )}
    </button>
  );
}

export default CollapsibleSection;

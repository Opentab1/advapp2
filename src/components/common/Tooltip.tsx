/**
 * Tooltip Component
 * 
 * Simple tooltip that appears on hover/tap for explaining metrics.
 * Mobile-friendly: shows on tap, hides on tap outside.
 */

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { HelpCircle } from 'lucide-react';

interface TooltipProps {
  content: string;
  children?: React.ReactNode;
  showIcon?: boolean;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

export function Tooltip({ 
  content, 
  children, 
  showIcon = true,
  position = 'top' 
}: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout>();

  // Handle click outside to close
  useEffect(() => {
    if (!isVisible) return;
    
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (tooltipRef.current && !tooltipRef.current.contains(event.target as Node)) {
        setIsVisible(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isVisible]);

  // Auto-hide after 5 seconds
  useEffect(() => {
    if (isVisible) {
      timeoutRef.current = setTimeout(() => setIsVisible(false), 5000);
    }
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [isVisible]);

  const handleToggle = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    setIsVisible(!isVisible);
  };

  const positionClasses = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  };

  return (
    <span 
      ref={tooltipRef}
      className="relative inline-flex items-center"
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
      onClick={handleToggle}
    >
      {children}
      {showIcon && (
        <HelpCircle className="w-3.5 h-3.5 text-warm-500 hover:text-warm-300 cursor-help ml-1" />
      )}
      
      <AnimatePresence>
        {isVisible && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className={`absolute z-50 ${positionClasses[position]}`}
          >
            <div className="bg-warm-800 border border-warm-600 rounded-lg px-3 py-2 shadow-xl max-w-xs">
              <p className="text-xs text-warm-200 leading-relaxed whitespace-normal">
                {content}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </span>
  );
}

export default Tooltip;

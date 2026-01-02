/**
 * PullToRefresh - Native-feeling pull to refresh gesture
 */

import { ReactNode, useState, useRef } from 'react';
import { motion, useMotionValue, useTransform, PanInfo } from 'framer-motion';
import { RefreshCw } from 'lucide-react';

interface PullToRefreshProps {
  children: ReactNode;
  onRefresh: () => Promise<void>;
  disabled?: boolean;
}

export function PullToRefresh({ children, onRefresh, disabled }: PullToRefreshProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const y = useMotionValue(0);
  
  const rotation = useTransform(y, [0, 80], [0, 360]);
  const opacity = useTransform(y, [0, 40, 80], [0, 0.5, 1]);
  const scale = useTransform(y, [0, 80], [0.5, 1]);
  
  const handleDragEnd = async (_: any, info: PanInfo) => {
    if (disabled || isRefreshing) return;
    
    if (info.offset.y > 80) {
      setIsRefreshing(true);
      
      // Haptic feedback if available
      if ('vibrate' in navigator) {
        navigator.vibrate(10);
      }
      
      try {
        await onRefresh();
      } finally {
        setIsRefreshing(false);
      }
    }
  };
  
  return (
    <div ref={containerRef} className="relative overflow-hidden">
      {/* Pull indicator */}
      <motion.div
        className="absolute left-1/2 -translate-x-1/2 top-0 z-10"
        style={{ opacity, scale, y: useTransform(y, [0, 80], [-40, 20]) }}
      >
        <motion.div
          className={`w-10 h-10 rounded-full flex items-center justify-center ${
            isRefreshing ? 'bg-primary' : 'bg-warm-200'
          }`}
          style={{ rotate: isRefreshing ? undefined : rotation }}
          animate={isRefreshing ? { rotate: 360 } : undefined}
          transition={isRefreshing ? { duration: 1, repeat: Infinity, ease: 'linear' } : undefined}
        >
          <RefreshCw className={`w-5 h-5 ${isRefreshing ? 'text-white' : 'text-warm-500'}`} />
        </motion.div>
      </motion.div>
      
      {/* Content */}
      <motion.div
        drag={disabled || isRefreshing ? false : 'y'}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0.5, bottom: 0 }}
        onDragEnd={handleDragEnd}
        style={{ y }}
        className="touch-pan-y"
      >
        {children}
      </motion.div>
    </div>
  );
}

export default PullToRefresh;

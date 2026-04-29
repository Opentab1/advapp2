/**
 * PullToRefresh - Native-feeling pull to refresh gesture
 *
 * Only engages drag when the parent scroll container is at the very top.
 * Otherwise framer-motion's drag handler hijacks vertical touch on mobile
 * and the user can't scroll the page at all (the bug that hid content on
 * Live + Staffing Schedule on phone-width viewports).
 */

import { ReactNode, useState, useRef, useEffect } from 'react';
import { motion, useMotionValue, useTransform, PanInfo } from 'framer-motion';
import { RefreshCw } from 'lucide-react';

interface PullToRefreshProps {
  children: ReactNode;
  onRefresh: () => Promise<void>;
  disabled?: boolean;
}

function findScrollParent(el: HTMLElement | null): HTMLElement | Window {
  let p: HTMLElement | null = el?.parentElement ?? null;
  while (p) {
    const oy = getComputedStyle(p).overflowY;
    if (oy === 'auto' || oy === 'scroll') return p;
    p = p.parentElement;
  }
  return window;
}

export function PullToRefresh({ children, onRefresh, disabled }: PullToRefreshProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [atTop, setAtTop] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const y = useMotionValue(0);

  // Track whether the parent scroll container is at the top. Drag is only
  // enabled when atTop is true, so mid-page touch gestures fall through to
  // native scroll instead of being captured by framer-motion.
  useEffect(() => {
    const parent = findScrollParent(containerRef.current);
    const readTop = () => {
      const top = parent === window
        ? window.scrollY
        : (parent as HTMLElement).scrollTop;
      setAtTop(top <= 0);
    };
    parent.addEventListener('scroll', readTop, { passive: true });
    readTop();
    return () => parent.removeEventListener('scroll', readTop as EventListener);
  }, []);

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

  const dragEnabled = !disabled && !isRefreshing && atTop;

  return (
    <div ref={containerRef} className="relative">
      {/* Pull indicator */}
      <motion.div
        className="absolute left-1/2 -translate-x-1/2 top-0 z-10 pointer-events-none"
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

      {/* Content. Drag y-axis only enabled when at top of scroll. dragElastic
          is asymmetric: 0.4 going down (visible pull) and 0 going up (so the
          gesture stays at y=0 when the user is just trying to scroll up). */}
      <motion.div
        drag={dragEnabled ? 'y' : false}
        dragDirectionLock
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.4 }}
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

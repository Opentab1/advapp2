/**
 * PullToRefresh - Native pull-to-refresh implementation.
 *
 * Why hand-rolled instead of framer-motion drag:
 *   The drag prop on motion.div captures touch gestures unconditionally,
 *   which on mobile prevents native scroll on every page that wraps in
 *   PullToRefresh. With native touch events we can call preventDefault
 *   ONLY when we're actively pulling down from the top — every other
 *   gesture flows through to the browser's scroll handler.
 *
 * onTouchMove is attached as a non-passive listener so preventDefault
 * actually works. React's synthetic onTouchMove is passive by default.
 */

import { ReactNode, useState, useRef, useEffect } from 'react';
import { motion, useMotionValue, useTransform } from 'framer-motion';
import { RefreshCw } from 'lucide-react';

interface PullToRefreshProps {
  children: ReactNode;
  onRefresh: () => Promise<void>;
  disabled?: boolean;
}

const TRIGGER_PX = 80;
const RESISTANCE = 0.45; // 1 - elasticity; pull feels firmer than 1:1

function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let p: HTMLElement | null = el?.parentElement ?? null;
  while (p) {
    const oy = getComputedStyle(p).overflowY;
    if (oy === 'auto' || oy === 'scroll') return p;
    p = p.parentElement;
  }
  return null;
}

export function PullToRefresh({ children, onRefresh, disabled }: PullToRefreshProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const y = useMotionValue(0);

  // Refs hold the per-gesture state so we don't re-render on every touchmove.
  const startYRef = useRef<number | null>(null);
  const scrollParentRef = useRef<HTMLElement | null>(null);
  const activePullRef = useRef(false);

  const rotation = useTransform(y, [0, TRIGGER_PX], [0, 360]);
  const opacity = useTransform(y, [0, TRIGGER_PX / 2, TRIGGER_PX], [0, 0.5, 1]);
  const scale = useTransform(y, [0, TRIGGER_PX], [0.5, 1]);
  const indicatorY = useTransform(y, [0, TRIGGER_PX], [-40, 20]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    scrollParentRef.current = findScrollParent(node);

    const isAtTop = () => {
      const sp = scrollParentRef.current;
      if (sp) return sp.scrollTop <= 0;
      return window.scrollY <= 0;
    };

    const onTouchStart = (e: TouchEvent) => {
      if (disabled || isRefreshing) return;
      if (!isAtTop()) {
        startYRef.current = null;
        return;
      }
      startYRef.current = e.touches[0]?.clientY ?? null;
      activePullRef.current = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (startYRef.current === null) return;
      if (disabled || isRefreshing) return;

      const currentY = e.touches[0]?.clientY ?? 0;
      const deltaY = currentY - startYRef.current;

      // Only engage if user is pulling DOWN. Upward gestures fall through
      // to native scroll so the page can scroll past the top.
      if (deltaY <= 0) {
        if (activePullRef.current) {
          // Pull was active but user reversed direction — reset.
          activePullRef.current = false;
          y.set(0);
        }
        return;
      }

      // If the parent has scrolled in the meantime (rare), abort.
      if (!isAtTop()) {
        startYRef.current = null;
        activePullRef.current = false;
        y.set(0);
        return;
      }

      activePullRef.current = true;
      // Block native scroll for THIS gesture only — preventDefault here
      // is what tells the browser "I'm handling this drag, don't scroll".
      // Outside this branch, the browser scrolls normally.
      if (e.cancelable) e.preventDefault();
      y.set(deltaY * RESISTANCE);
    };

    const onTouchEnd = async () => {
      if (startYRef.current === null) return;
      const wasActive = activePullRef.current;
      const pulled = y.get();
      startYRef.current = null;
      activePullRef.current = false;

      if (!wasActive) {
        y.set(0);
        return;
      }

      if (pulled >= TRIGGER_PX) {
        if ('vibrate' in navigator) navigator.vibrate(10);
        setIsRefreshing(true);
        // Hold the indicator at the trigger threshold while refreshing.
        y.set(TRIGGER_PX);
        try {
          await onRefresh();
        } finally {
          setIsRefreshing(false);
          y.set(0);
        }
      } else {
        // Spring back to 0 — small animation via JS-driven step. Snap is
        // acceptable since the gesture didn't reach the trigger.
        y.set(0);
      }
    };

    const onTouchCancel = () => {
      startYRef.current = null;
      activePullRef.current = false;
      y.set(0);
    };

    // Non-passive so preventDefault works inside the active-pull branch.
    node.addEventListener('touchstart', onTouchStart, { passive: true });
    node.addEventListener('touchmove',  onTouchMove,  { passive: false });
    node.addEventListener('touchend',   onTouchEnd,   { passive: true });
    node.addEventListener('touchcancel', onTouchCancel, { passive: true });

    return () => {
      node.removeEventListener('touchstart',  onTouchStart);
      node.removeEventListener('touchmove',   onTouchMove);
      node.removeEventListener('touchend',    onTouchEnd);
      node.removeEventListener('touchcancel', onTouchCancel);
    };
  }, [disabled, isRefreshing, onRefresh, y]);

  return (
    <div ref={containerRef} className="relative">
      {/* Pull indicator */}
      <motion.div
        className="absolute left-1/2 -translate-x-1/2 top-0 z-10 pointer-events-none"
        style={{ opacity, scale, y: indicatorY }}
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

      {/* Content. Translates with motion value `y` during active pull only. */}
      <motion.div style={{ y }}>
        {children}
      </motion.div>
    </div>
  );
}

export default PullToRefresh;

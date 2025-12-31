/**
 * Skeletons - Loading state components
 * 
 * Addresses "Loading States" problem:
 * - Skeleton loaders instead of spinners
 * - Reduces perceived loading time
 * - Maintains layout during load
 * - Smooth transitions when content appears
 */

import { motion } from 'framer-motion';

// ============ BASE SKELETON ============

interface SkeletonProps {
  className?: string;
  animate?: boolean;
}

export function Skeleton({ className = '', animate = true }: SkeletonProps) {
  return (
    <div
      className={`bg-warm-200 rounded ${animate ? 'animate-pulse' : ''} ${className}`}
    />
  );
}

// ============ PULSE RING SKELETON ============

export function PulseRingSkeleton({ size = 'hero' }: { size?: 'hero' | 'small' }) {
  const dimensions = size === 'hero' ? 'w-48 h-48' : 'w-20 h-20';
  
  return (
    <div className={`${dimensions} rounded-full bg-warm-100 animate-pulse flex items-center justify-center`}>
      <div className={`${size === 'hero' ? 'w-40 h-40' : 'w-16 h-16'} rounded-full bg-warm-200`} />
    </div>
  );
}

// ============ PULSE PLUS PAGE SKELETON ============

export function PulsePlusSkeleton() {
  return (
    <div className="max-w-2xl mx-auto pb-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-7 w-32 mb-2" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-10 w-10 rounded-xl" />
      </div>

      {/* Time context */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Skeleton className="h-6 w-28 rounded-full" />
          <Skeleton className="h-6 w-40 rounded-full" />
        </div>
        <Skeleton className="h-14 w-full rounded-xl" />
      </div>

      {/* Pulse rings */}
      <div className="flex flex-col items-center gap-4">
        <PulseRingSkeleton size="hero" />
        <div className="flex gap-4">
          <PulseRingSkeleton size="small" />
          <PulseRingSkeleton size="small" />
          <PulseRingSkeleton size="small" />
        </div>
      </div>

      {/* Action card */}
      <Skeleton className="h-48 w-full rounded-2xl" />

      {/* Action queue */}
      <div className="space-y-2">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
      </div>

      {/* Factors */}
      <div className="space-y-3">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
      </div>
    </div>
  );
}

// ============ CARD SKELETON ============

export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="p-4 rounded-xl bg-white border border-warm-200 space-y-3">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-lg" />
        <div className="flex-1">
          <Skeleton className="h-4 w-24 mb-2" />
          <Skeleton className="h-3 w-32" />
        </div>
      </div>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton 
          key={i} 
          className="h-3" 
          style={{ width: `${100 - i * 15}%` }} 
        />
      ))}
    </div>
  );
}

// ============ METRIC CARD SKELETON ============

export function MetricCardSkeleton() {
  return (
    <div className="p-4 rounded-xl bg-warm-50 space-y-2">
      <div className="flex items-center gap-2">
        <Skeleton className="h-5 w-5 rounded" />
        <Skeleton className="h-4 w-16" />
      </div>
      <Skeleton className="h-8 w-20" />
      <Skeleton className="h-3 w-24" />
    </div>
  );
}

// ============ LIST SKELETON ============

export function ListSkeleton({ items = 3 }: { items?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: items }).map((_, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05 }}
        >
          <Skeleton className="h-14 w-full rounded-xl" />
        </motion.div>
      ))}
    </div>
  );
}

// ============ CHART SKELETON ============

export function ChartSkeleton({ height = 200 }: { height?: number }) {
  return (
    <div 
      className="w-full rounded-xl bg-warm-50 border border-warm-200 flex items-end justify-center gap-2 p-4"
      style={{ height }}
    >
      {[40, 65, 45, 80, 55, 70, 50].map((h, i) => (
        <motion.div
          key={i}
          initial={{ height: 0 }}
          animate={{ height: `${h}%` }}
          transition={{ delay: i * 0.1, duration: 0.5 }}
          className="w-8 bg-warm-200 rounded-t animate-pulse"
        />
      ))}
    </div>
  );
}

// ============ TABLE SKELETON ============

export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="rounded-xl border border-warm-200 overflow-hidden">
      {/* Header */}
      <div className="flex gap-4 p-3 bg-warm-50 border-b border-warm-200">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-4 flex-1" />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div 
          key={rowIndex} 
          className="flex gap-4 p-3 border-b border-warm-100 last:border-0"
        >
          {Array.from({ length: cols }).map((_, colIndex) => (
            <Skeleton 
              key={colIndex} 
              className="h-4 flex-1" 
              style={{ opacity: 1 - rowIndex * 0.1 }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// ============ AVATAR SKELETON ============

export function AvatarSkeleton({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizeClass = {
    sm: 'w-8 h-8',
    md: 'w-10 h-10',
    lg: 'w-14 h-14',
  }[size];

  return <Skeleton className={`${sizeClass} rounded-full`} />;
}

// ============ BUTTON SKELETON ============

export function ButtonSkeleton({ width = 'w-32' }: { width?: string }) {
  return <Skeleton className={`h-10 ${width} rounded-xl`} />;
}

// ============ INLINE LOADING ============

export function InlineLoading({ text = 'Loading...' }: { text?: string }) {
  return (
    <div className="flex items-center gap-2 text-warm-500">
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
          <circle 
            className="opacity-25" 
            cx="12" 
            cy="12" 
            r="10" 
            stroke="currentColor" 
            strokeWidth="4"
          />
          <path 
            className="opacity-75" 
            fill="currentColor" 
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      </motion.div>
      <span className="text-sm">{text}</span>
    </div>
  );
}

// ============ SHIMMER EFFECT (alternative to pulse) ============

export function Shimmer({ className = '' }: { className?: string }) {
  return (
    <div className={`relative overflow-hidden bg-warm-100 ${className}`}>
      <motion.div
        className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/50 to-transparent"
        animate={{ translateX: ['100%', '-100%'] }}
        transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
      />
    </div>
  );
}

export default Skeleton;

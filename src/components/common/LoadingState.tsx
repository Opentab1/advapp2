/**
 * LoadingState - Skeleton loaders and loading states
 * 
 * Provides visual placeholders while data loads.
 */

import { motion } from 'framer-motion';

// ============ PULSE PAGE SKELETON ============

export function PulsePageSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Hero ring skeleton */}
      <div className="flex justify-center">
        <div className="w-40 h-48 bg-warm-200 rounded-2xl" />
      </div>
      
      {/* Supporting rings skeleton */}
      <div className="flex justify-center gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="w-24 h-28 bg-warm-200 rounded-xl" />
        ))}
      </div>
      
      {/* Action skeleton */}
      <div className="h-40 bg-warm-200 rounded-2xl" />
      
      {/* Context bar skeleton */}
      <div className="h-12 bg-warm-200 rounded-xl" />
    </div>
  );
}

// ============ RING SKELETON ============

export function RingSkeleton({ size = 'medium' }: { size?: 'hero' | 'medium' | 'small' }) {
  const sizes = {
    hero: 'w-40 h-48',
    medium: 'w-24 h-28',
    small: 'w-20 h-24',
  };
  
  return (
    <div className={`${sizes[size]} bg-warm-200 rounded-2xl animate-pulse`} />
  );
}

// ============ ACTION SKELETON ============

export function ActionSkeleton() {
  return (
    <div className="p-6 bg-warm-200 rounded-2xl animate-pulse">
      <div className="h-4 w-24 bg-warm-300 rounded mb-4" />
      <div className="h-6 w-48 bg-warm-300 rounded mb-2" />
      <div className="h-4 w-64 bg-warm-300 rounded" />
    </div>
  );
}

// ============ GENERIC CARD SKELETON ============

export function CardSkeleton({ height = 'h-32' }: { height?: string }) {
  return (
    <div className={`${height} bg-warm-200 rounded-xl animate-pulse`} />
  );
}

// ============ FULL SCREEN LOADER ============

export function FullScreenLoader() {
  return (
    <div className="fixed inset-0 bg-warm-50 flex items-center justify-center z-50">
      <motion.div
        className="flex flex-col items-center gap-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        <div className="w-12 h-12 border-4 border-warm-200 border-t-primary rounded-full animate-spin" />
        <p className="text-warm-500 text-sm">Loading...</p>
      </motion.div>
    </div>
  );
}

// ============ INLINE LOADER ============

export function InlineLoader({ text = 'Loading...' }: { text?: string }) {
  return (
    <div className="flex items-center justify-center py-8">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-3 border-warm-200 border-t-primary rounded-full animate-spin" />
        <p className="text-warm-500 text-sm">{text}</p>
      </div>
    </div>
  );
}

export default PulsePageSkeleton;

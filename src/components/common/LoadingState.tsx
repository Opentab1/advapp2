/**
 * LoadingState - Smooth skeleton loaders and loading states
 * 
 * Features:
 * - Shimmer animation instead of pulse
 * - Smooth fade transitions
 * - Dark mode support
 * - Contextual empty states
 */

import { motion, AnimatePresence } from 'framer-motion';
import { WifiOff, AlertCircle, BarChart2, Zap } from 'lucide-react';

// ============ SHIMMER SKELETON ============

function Shimmer({ className }: { className: string }) {
  return (
    <div className={`relative overflow-hidden bg-warm-200 dark:bg-warm-700 ${className}`}>
      <motion.div
        className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 dark:via-white/10 to-transparent"
        animate={{ x: ['-100%', '100%'] }}
        transition={{ repeat: Infinity, duration: 1.5, ease: 'easeInOut' }}
      />
    </div>
  );
}

// ============ PULSE PAGE SKELETON ============

export function PulsePageSkeleton() {
  return (
    <motion.div 
      className="space-y-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Live Stats skeleton */}
      <Shimmer className="h-36 rounded-2xl" />
      
      {/* Hero ring skeleton */}
      <div className="flex justify-center">
        <Shimmer className="w-44 h-52 rounded-2xl" />
      </div>
      
      {/* Supporting rings skeleton */}
      <div className="flex justify-center gap-3">
        {[1, 2, 3].map((i) => (
          <Shimmer key={i} className="w-28 h-32 rounded-xl" />
        ))}
      </div>
      
      {/* Action skeleton */}
      <Shimmer className="h-32 rounded-2xl" />
    </motion.div>
  );
}

// ============ RING SKELETON ============

export function RingSkeleton({ size = 'medium' }: { size?: 'hero' | 'medium' | 'small' }) {
  const sizes = {
    hero: 'w-44 h-52',
    medium: 'w-28 h-32',
    small: 'w-20 h-24',
  };
  
  return <Shimmer className={`${sizes[size]} rounded-2xl`} />;
}

// ============ CARD SKELETON ============

export function CardSkeleton({ height = 'h-32' }: { height?: string }) {
  return <Shimmer className={`${height} rounded-2xl w-full`} />;
}

// ============ CHART SKELETON ============

export function ChartSkeleton() {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Shimmer className="h-5 w-32 rounded" />
        <Shimmer className="h-8 w-20 rounded-lg" />
      </div>
      <Shimmer className="h-48 rounded-xl" />
    </div>
  );
}

// ============ FULL SCREEN LOADER ============

export function FullScreenLoader({ message = 'Loading...' }: { message?: string }) {
  return (
    <motion.div 
      className="fixed inset-0 bg-warm-50 dark:bg-warm-900 flex items-center justify-center z-50"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="flex flex-col items-center gap-4">
        <motion.div
          className="relative"
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1.2, ease: 'linear' }}
        >
          <div className="w-12 h-12 rounded-full border-4 border-warm-200 dark:border-warm-700" />
          <div className="absolute top-0 left-0 w-12 h-12 rounded-full border-4 border-transparent border-t-primary" />
        </motion.div>
        <p className="text-warm-500 dark:text-warm-400 text-sm">{message}</p>
      </div>
    </motion.div>
  );
}

// ============ INLINE LOADER ============

export function InlineLoader({ text = 'Loading...' }: { text?: string }) {
  return (
    <div className="flex items-center justify-center py-8">
      <div className="flex flex-col items-center gap-3">
        <motion.div
          className="w-8 h-8 border-3 border-warm-200 dark:border-warm-700 border-t-primary rounded-full"
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
        />
        <p className="text-warm-500 dark:text-warm-400 text-sm">{text}</p>
      </div>
    </div>
  );
}

// ============ NO DATA STATE ============

interface NoDataStateProps {
  title?: string;
  description?: string;
  icon?: typeof BarChart2;
  onRetry?: () => void;
}

export function NoDataState({ 
  title = 'No data yet',
  description = 'Connect your Pulse device to start seeing insights',
  icon: Icon = Zap,
  onRetry,
}: NoDataStateProps) {
  return (
    <motion.div 
      className="flex flex-col items-center justify-center py-12 px-4 text-center"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="w-16 h-16 rounded-full bg-warm-100 dark:bg-warm-800 flex items-center justify-center mb-4">
        <Icon className="w-8 h-8 text-warm-400 dark:text-warm-500" />
      </div>
      <h3 className="text-lg font-semibold text-warm-700 dark:text-warm-200 mb-1">
        {title}
      </h3>
      <p className="text-sm text-warm-500 dark:text-warm-400 max-w-xs mb-4">
        {description}
      </p>
      {onRetry && (
        <motion.button
          onClick={onRetry}
          className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-xl hover:bg-primary/90 transition-colors"
          whileTap={{ scale: 0.95 }}
        >
          Try Again
        </motion.button>
      )}
    </motion.div>
  );
}

// ============ OFFLINE STATE ============

export function OfflineState({ lastUpdated }: { lastUpdated?: Date | null }) {
  const timeAgo = lastUpdated 
    ? Math.floor((Date.now() - lastUpdated.getTime()) / 60000)
    : null;
  
  return (
    <motion.div 
      className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 flex items-center gap-3"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <WifiOff className="w-5 h-5 text-amber-500 flex-shrink-0" />
      <div>
        <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
          Connection lost
        </p>
        <p className="text-xs text-amber-600 dark:text-amber-500">
          {timeAgo !== null 
            ? `Last updated ${timeAgo} min ago` 
            : 'Trying to reconnect...'}
        </p>
      </div>
    </motion.div>
  );
}

// ============ ERROR STATE ============

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({ 
  title = 'Something went wrong',
  message = 'We couldn\'t load this data. Please try again.',
  onRetry,
}: ErrorStateProps) {
  return (
    <motion.div 
      className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-6 text-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-3" />
      <h3 className="text-base font-semibold text-red-700 dark:text-red-400 mb-1">
        {title}
      </h3>
      <p className="text-sm text-red-600 dark:text-red-500 mb-4">
        {message}
      </p>
      {onRetry && (
        <motion.button
          onClick={onRetry}
          className="px-4 py-2 bg-red-500 text-white text-sm font-medium rounded-xl hover:bg-red-600 transition-colors"
          whileTap={{ scale: 0.95 }}
        >
          Try Again
        </motion.button>
      )}
    </motion.div>
  );
}

// ============ TRANSITION WRAPPER ============

interface FadeTransitionProps {
  show: boolean;
  children: React.ReactNode;
}

export function FadeTransition({ show, children }: FadeTransitionProps) {
  return (
    <AnimatePresence mode="wait">
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default PulsePageSkeleton;

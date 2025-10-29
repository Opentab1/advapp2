import { motion } from 'framer-motion';
import { CloudOff, RefreshCw } from 'lucide-react';
import { AnimatedBackground } from '../components/AnimatedBackground';
import { Logo } from '../components/Logo';

export function Offline() {
  const handleRetry = () => {
    window.location.reload();
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      <AnimatedBackground />

      <motion.div
        className="text-center relative z-10 max-w-md"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
      >
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <Logo className="scale-125" />
        </div>

        {/* Animated Icon */}
        <motion.div
          animate={{
            scale: [1, 1.1, 1],
            opacity: [0.5, 1, 0.5]
          }}
          transition={{ duration: 2, repeat: Infinity }}
          className="mb-6"
        >
          <CloudOff className="w-24 h-24 text-cyan mx-auto" />
        </motion.div>

        {/* Error Message */}
        <motion.h2
          className="text-3xl font-bold mb-4 gradient-text"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          No Signal
        </motion.h2>

        <motion.p
          className="text-gray-400 mb-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          You appear to be offline. Check your internet connection and try again.
        </motion.p>

        {/* Retry Button */}
        <motion.button
          onClick={handleRetry}
          className="btn-primary inline-flex items-center gap-2"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <RefreshCw className="w-5 h-5" />
          Try Again
        </motion.button>

        {/* Status Indicator */}
        <motion.div
          className="mt-8 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-red-500/10 border border-red-500/30"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-sm text-red-400">Offline Mode</span>
        </motion.div>
      </motion.div>
    </div>
  );
}

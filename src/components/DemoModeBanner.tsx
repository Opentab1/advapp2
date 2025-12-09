import { motion } from 'framer-motion';
import { Info } from 'lucide-react';

interface DemoModeBannerProps {
  venueName?: string;
}

export function DemoModeBanner({ venueName }: DemoModeBannerProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className="fixed top-0 left-0 right-0 z-50 bg-gradient-to-r from-amber-500/90 to-orange-500/90 backdrop-blur-sm border-b border-amber-400/50 px-4 py-2"
    >
      <div className="max-w-7xl mx-auto flex items-center justify-center gap-3">
        <Info className="w-5 h-5 text-white animate-pulse" />
        <p className="text-white font-medium text-sm md:text-base">
          🎭 <strong>Demo Mode</strong> - This is a demonstration account with simulated data for {venueName || 'showcase purposes'}
        </p>
      </div>
    </motion.div>
  );
}

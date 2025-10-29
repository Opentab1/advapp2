import { motion } from 'framer-motion';
import { Smile, Meh, Frown } from 'lucide-react';
import type { ComfortLevel } from '../types';
import { getComfortMessage } from '../utils/comfort';

interface ComfortGaugeProps {
  comfortLevel: ComfortLevel;
}

export function ComfortGauge({ comfortLevel }: ComfortGaugeProps) {
  const { score, status, color } = comfortLevel;
  const percentage = score;

  const getIcon = () => {
    if (score >= 70) return Smile;
    if (score >= 40) return Meh;
    return Frown;
  };

  const Icon = getIcon();

  return (
    <motion.div
      className="glass-card p-6"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5 }}
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">Comfort Level</h3>
        <Icon className="w-6 h-6" style={{ color }} />
      </div>

      {/* Circular Gauge */}
      <div className="relative w-48 h-48 mx-auto mb-4">
        <svg className="w-full h-full transform -rotate-90">
          {/* Background circle */}
          <circle
            cx="96"
            cy="96"
            r="80"
            stroke="rgba(255,255,255,0.1)"
            strokeWidth="12"
            fill="none"
          />
          
          {/* Progress circle */}
          <motion.circle
            cx="96"
            cy="96"
            r="80"
            stroke={color}
            strokeWidth="12"
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${2 * Math.PI * 80}`}
            initial={{ strokeDashoffset: 2 * Math.PI * 80 }}
            animate={{ 
              strokeDashoffset: 2 * Math.PI * 80 * (1 - percentage / 100)
            }}
            transition={{ duration: 1.5, ease: 'easeOut' }}
            style={{
              filter: `drop-shadow(0 0 8px ${color})`
            }}
          />
        </svg>

        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <motion.span
            className="text-5xl font-bold"
            style={{ color }}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.5, type: 'spring', stiffness: 200 }}
          >
            {score}
          </motion.span>
          <span className="text-sm text-gray-400 mt-1">/ 100</span>
        </div>
      </div>

      {/* Status */}
      <div className="text-center">
        <div className="inline-block px-4 py-2 rounded-full bg-white/5 border border-white/10 mb-2">
          <span className="text-sm font-semibold capitalize" style={{ color }}>
            {status}
          </span>
        </div>
        <p className="text-sm text-gray-400">
          {getComfortMessage(comfortLevel)}
        </p>
      </div>
    </motion.div>
  );
}

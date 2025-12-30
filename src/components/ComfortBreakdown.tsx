import { motion } from 'framer-motion';
import { Droplets, Volume2, Sun, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { ComfortBreakdown } from '../types';

interface ComfortBreakdownProps {
  breakdown: ComfortBreakdown;
}

export function ComfortBreakdownCard({ breakdown }: ComfortBreakdownProps) {
  const categories = [
    {
      key: 'humidity',
      icon: Droplets,
      label: 'Humidity',
      data: breakdown.humidity,
      color: '#4ecdc4'
    },
    {
      key: 'sound',
      icon: Volume2,
      label: 'Sound Level',
      data: breakdown.sound,
      color: '#00d4ff'
    },
    {
      key: 'lighting',
      icon: Sun,
      label: 'Lighting',
      data: breakdown.lighting,
      color: '#ffd700'
    }
  ];

  const getTrendIcon = (score: number) => {
    if (score >= 80) return TrendingUp;
    if (score <= 50) return TrendingDown;
    return Minus;
  };

  return (
    <motion.div
      className="glass-card p-6"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
    >
      <h3 className="text-xl font-bold gradient-text mb-4">Comfort Breakdown</h3>
      
      <div className="space-y-4">
        {categories.map((category, index) => {
          const TrendIcon = getTrendIcon(category.data.score);
          
          return (
            <motion.div
              key={category.key}
              className="p-4 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.4 + index * 0.1 }}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <div 
                    className="p-2 rounded-lg"
                    style={{ backgroundColor: `${category.color}20`, color: category.color }}
                  >
                    <category.icon className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="font-medium text-white">{category.label}</div>
                    <div className="text-xs text-gray-400">{category.data.status}</div>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  <TrendIcon 
                    className="w-4 h-4"
                    style={{ color: category.color }}
                  />
                  <span 
                    className="text-lg font-bold"
                    style={{ color: category.color }}
                  >
                    {category.data.score}
                  </span>
                </div>
              </div>
              
              {/* Progress Bar */}
              <div className="mt-3 h-2 bg-white/5 rounded-full overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  style={{ backgroundColor: category.color }}
                  initial={{ width: 0 }}
                  animate={{ width: `${category.data.score}%` }}
                  transition={{ duration: 1, delay: 0.5 + index * 0.1 }}
                />
              </div>
              
              <p className="text-xs text-gray-400 mt-2">{category.data.message}</p>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}

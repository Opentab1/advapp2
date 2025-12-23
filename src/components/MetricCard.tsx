import { motion } from 'framer-motion';
import { LucideIcon } from 'lucide-react';

interface MetricCardProps {
  title: string;
  value: string;
  unit: string;
  icon: LucideIcon;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  color?: string;
  delay?: number;
  onClick?: () => void;
  clickHint?: string;
}

export function MetricCard({
  title,
  value,
  unit,
  icon: Icon,
  trend = 'neutral',
  trendValue,
  color = 'cyan',
  delay = 0,
  onClick,
  clickHint
}: MetricCardProps) {
  const trendColors = {
    up: 'text-green-400',
    down: 'text-red-400',
    neutral: 'text-gray-400'
  };

  return (
    <motion.div
      className={`glass-card-hover p-6 relative overflow-hidden ${onClick ? 'cursor-pointer' : ''}`}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.5 }}
      onClick={onClick}
      whileHover={onClick ? { scale: 1.02 } : undefined}
      whileTap={onClick ? { scale: 0.98 } : undefined}
      title={clickHint}
    >
      {/* Background gradient */}
      <div 
        className="absolute inset-0 opacity-5"
        style={{
          background: `radial-gradient(circle at top right, ${color === 'cyan' ? '#00d4ff' : color}, transparent 70%)`
        }}
      />

      <div className="relative z-10">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-white/5">
              <Icon className="w-5 h-5" style={{ color: color === 'cyan' ? '#00d4ff' : color }} />
            </div>
            <span className="text-sm text-gray-400 font-medium">{title}</span>
          </div>
          
          {trendValue && (
            <span className={`text-xs font-semibold ${trendColors[trend]}`}>
              {trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'} {trendValue}
            </span>
          )}
        </div>

        <div className="flex items-baseline gap-2">
          <motion.span
            className="metric-value"
            key={value}
            initial={{ scale: 1.2, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            {value}
          </motion.span>
          <span className="text-lg text-gray-400 font-medium">{unit}</span>
        </div>
      </div>
    </motion.div>
  );
}

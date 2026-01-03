/**
 * TrendAlerts - Proactive alerts when metrics deviate from normal
 * 
 * Shows warnings and opportunities based on historical patterns.
 */

import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, TrendingUp, Info, X, Users, Zap, Clock } from 'lucide-react';
import type { TrendAlert } from '../../services/intelligence.service';
import { haptic } from '../../utils/haptics';

interface TrendAlertsProps {
  alerts: TrendAlert[];
  onDismiss: (alertId: string) => void;
}

export function TrendAlerts({ alerts, onDismiss }: TrendAlertsProps) {
  if (alerts.length === 0) return null;
  
  return (
    <div className="space-y-2">
      <AnimatePresence mode="popLayout">
        {alerts.map((alert, index) => (
          <TrendAlertCard
            key={alert.id}
            alert={alert}
            index={index}
            onDismiss={() => {
              haptic('light');
              onDismiss(alert.id);
            }}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

interface TrendAlertCardProps {
  alert: TrendAlert;
  index: number;
  onDismiss: () => void;
}

function TrendAlertCard({ alert, index, onDismiss }: TrendAlertCardProps) {
  const config = getAlertConfig(alert);
  
  return (
    <motion.div
      className={`relative rounded-xl border p-3 ${config.bg} ${config.border}`}
      initial={{ opacity: 0, x: -20, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 20, scale: 0.95 }}
      transition={{ delay: index * 0.05 }}
      layout
    >
      <div className="flex items-start gap-3">
        <div className={`w-8 h-8 rounded-lg ${config.iconBg} flex items-center justify-center flex-shrink-0`}>
          <config.Icon className={`w-4 h-4 ${config.iconColor}`} />
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className={`text-sm font-semibold ${config.titleColor}`}>
              {alert.title}
            </p>
            <span className={`text-xs px-1.5 py-0.5 rounded ${config.badge}`}>
              {alert.deviation > 0 ? '+' : ''}{alert.deviation}%
            </span>
          </div>
          <p className="text-xs text-warm-400 mt-0.5">
            {alert.message}
          </p>
          <p className="text-[10px] text-warm-500 mt-1">
            Normal: {alert.normalValue} • Now: {alert.currentValue}
          </p>
        </div>
        
        <button
          onClick={onDismiss}
          className="p-1 rounded-lg hover:bg-warm-700 transition-colors"
        >
          <X className="w-4 h-4 text-warm-500" />
        </button>
      </div>
    </motion.div>
  );
}

function getAlertConfig(alert: TrendAlert) {
  const metricIcons = {
    crowd: Users,
    pulse: Zap,
    dwell: Clock,
    sound: AlertTriangle,
    light: AlertTriangle,
  };
  
  if (alert.type === 'warning') {
    return {
      Icon: metricIcons[alert.metric] || AlertTriangle,
      bg: 'bg-amber-900/20',
      border: 'border-amber-800/50',
      iconBg: 'bg-amber-900/30',
      iconColor: 'text-amber-400',
      titleColor: 'text-amber-300',
      badge: 'bg-amber-900/50 text-amber-400',
    };
  }
  
  if (alert.type === 'opportunity') {
    return {
      Icon: metricIcons[alert.metric] || TrendingUp,
      bg: 'bg-green-900/20',
      border: 'border-green-800/50',
      iconBg: 'bg-green-900/30',
      iconColor: 'text-green-400',
      titleColor: 'text-green-300',
      badge: 'bg-green-900/50 text-green-400',
    };
  }
  
  return {
    Icon: Info,
    bg: 'bg-warm-800',
    border: 'border-warm-700',
    iconBg: 'bg-warm-700',
    iconColor: 'text-warm-400',
    titleColor: 'text-warm-200',
    badge: 'bg-warm-700 text-warm-400',
  };
}

export default TrendAlerts;

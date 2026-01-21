/**
 * ActionableInsight - WHOOP-style insight card
 * 
 * Each card answers ONE question with ONE action.
 * No data overload - just clarity.
 */

import { motion } from 'framer-motion';
import { 
  ChevronRight, 
  Trophy, 
  AlertTriangle, 
  Target,
  Zap,
  TrendingUp,
  TrendingDown,
  Volume2,
  Sun,
  Users,
  LucideIcon,
} from 'lucide-react';
import { haptic } from '../../utils/haptics';

type InsightType = 'success' | 'warning' | 'action' | 'neutral';

interface ActionableInsightProps {
  type: InsightType;
  icon?: LucideIcon;
  title: string;
  value: string;
  subtitle?: string;
  action?: string;
  onTap?: () => void;
}

const typeStyles: Record<InsightType, { bg: string; border: string; icon: string; iconBg: string }> = {
  success: {
    bg: 'bg-recovery-high/5',
    border: 'border-recovery-high/30',
    icon: 'text-recovery-high',
    iconBg: 'bg-recovery-high/20',
  },
  warning: {
    bg: 'bg-recovery-low/5',
    border: 'border-recovery-low/30',
    icon: 'text-recovery-low',
    iconBg: 'bg-recovery-low/20',
  },
  action: {
    bg: 'bg-teal/5',
    border: 'border-teal/30',
    icon: 'text-teal',
    iconBg: 'bg-teal/20',
  },
  neutral: {
    bg: 'bg-warm-800/50',
    border: 'border-warm-700',
    icon: 'text-warm-400',
    iconBg: 'bg-warm-700',
  },
};

const defaultIcons: Record<InsightType, LucideIcon> = {
  success: Trophy,
  warning: AlertTriangle,
  action: Target,
  neutral: Zap,
};

export function ActionableInsight({ 
  type, 
  icon, 
  title, 
  value, 
  subtitle, 
  action,
  onTap 
}: ActionableInsightProps) {
  const styles = typeStyles[type];
  const Icon = icon || defaultIcons[type];
  
  const handleTap = () => {
    haptic('light');
    onTap?.();
  };

  const content = (
    <>
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-full ${styles.iconBg} flex items-center justify-center flex-shrink-0`}>
          <Icon className={`w-5 h-5 ${styles.icon}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-warm-400 uppercase tracking-wide mb-0.5">
            {title}
          </div>
          <div className="text-lg font-semibold text-white leading-tight">
            {value}
          </div>
          {subtitle && (
            <div className="text-sm text-warm-300 mt-1">
              {subtitle}
            </div>
          )}
        </div>
        {onTap && (
          <ChevronRight className="w-5 h-5 text-warm-500 flex-shrink-0 mt-2" />
        )}
      </div>
      {action && (
        <div className="mt-3 pt-3 border-t border-warm-700/50">
          <div className="text-sm text-primary flex items-center gap-1">
            <Zap className="w-3.5 h-3.5" />
            {action}
          </div>
        </div>
      )}
    </>
  );

  if (onTap) {
    return (
      <motion.button
        onClick={handleTap}
        className={`w-full ${styles.bg} border ${styles.border} rounded-xl p-4 text-left hover:border-warm-500 transition-colors`}
        whileTap={{ scale: 0.98 }}
      >
        {content}
      </motion.button>
    );
  }

  return (
    <div className={`${styles.bg} border ${styles.border} rounded-xl p-4`}>
      {content}
    </div>
  );
}

// ============ PRE-BUILT INSIGHT GENERATORS ============

interface InsightData {
  score: number;
  scoreDelta: number;
  bestDay?: { date: string; score: number; label?: string };
  worstDay?: { date: string; score: number; label?: string };
  sweetSpot?: { range: string; hitPercentage: number; scoreDiff: number };
  factorScores?: Array<{ factor: string; score: number }>;
}

export function generateInsights(data: InsightData): ActionableInsightProps[] {
  const insights: ActionableInsightProps[] = [];

  // 1. What's Working (Success)
  if (data.bestDay && data.bestDay.score >= 70) {
    insights.push({
      type: 'success',
      icon: Trophy,
      title: 'Best Performance',
      value: `${data.bestDay.date} scored ${data.bestDay.score}`,
      subtitle: data.bestDay.label || 'Strong overall performance',
    });
  }

  // 2. Sweet Spot Insight (Action)
  if (data.sweetSpot) {
    const isHittingTarget = data.sweetSpot.hitPercentage >= 50;
    insights.push({
      type: isHittingTarget ? 'action' : 'warning',
      icon: Target,
      title: 'Your Sweet Spot',
      value: data.sweetSpot.range,
      subtitle: `You hit this ${data.sweetSpot.hitPercentage}% of the time`,
      action: isHittingTarget 
        ? `+${data.sweetSpot.scoreDiff} points when you're in range`
        : `Target this range for +${data.sweetSpot.scoreDiff} points`,
    });
  }

  // 3. Trend Insight
  if (data.scoreDelta !== 0) {
    insights.push({
      type: data.scoreDelta > 0 ? 'success' : 'warning',
      icon: data.scoreDelta > 0 ? TrendingUp : TrendingDown,
      title: data.scoreDelta > 0 ? 'Trending Up' : 'Trending Down',
      value: `${data.scoreDelta > 0 ? '+' : ''}${data.scoreDelta}% vs last period`,
      subtitle: data.scoreDelta > 0 
        ? 'Keep up the momentum'
        : 'Review what changed',
    });
  }

  // 4. What Needs Work (Warning)
  if (data.worstDay && data.worstDay.score < 60) {
    insights.push({
      type: 'warning',
      icon: AlertTriangle,
      title: 'Needs Attention',
      value: `${data.worstDay.date} scored ${data.worstDay.score}`,
      subtitle: data.worstDay.label || 'Room for improvement',
    });
  }

  // 5. Factor Insights (if available)
  if (data.factorScores && data.factorScores.length > 0) {
    // Find weakest factor
    const weakest = data.factorScores.reduce((min, f) => 
      f.score < min.score ? f : min
    , data.factorScores[0]);
    
    if (weakest.score < 60) {
      const factorIcon = weakest.factor === 'sound' ? Volume2 : 
                        weakest.factor === 'light' ? Sun : Users;
      insights.push({
        type: 'warning',
        icon: factorIcon,
        title: `${weakest.factor.charAt(0).toUpperCase() + weakest.factor.slice(1)} Factor`,
        value: `Scoring ${weakest.score}/100`,
        subtitle: 'This is pulling your overall score down',
        action: `Focus on optimizing ${weakest.factor} levels`,
      });
    }
  }

  // Ensure we have at least 2 insights
  if (insights.length < 2) {
    insights.push({
      type: 'neutral',
      icon: Zap,
      title: 'Steady Performance',
      value: `Pulse Score: ${data.score}`,
      subtitle: 'Consistent results this period',
    });
  }

  // Return top 3 most relevant insights
  return insights.slice(0, 3);
}

export default ActionableInsight;

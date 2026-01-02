/**
 * InsightsPanel - AI-style insights and recommendations
 * 
 * Dark mode supported.
 */

import { motion } from 'framer-motion';
import { Lightbulb, Sparkles } from 'lucide-react';
import type { Insight } from '../../services/achievements.service';

interface InsightsPanelProps {
  insights: Insight[];
}

export function InsightsPanel({ insights }: InsightsPanelProps) {
  if (insights.length === 0) {
    return null;
  }
  
  return (
    <motion.div
      className="space-y-3"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <Sparkles className="w-5 h-5 text-purple-500" />
        <h3 className="font-semibold text-warm-800 dark:text-warm-100">Insights</h3>
      </div>
      
      {/* Insight cards */}
      <div className="space-y-2">
        {insights.map((insight, index) => (
          <InsightCard key={insight.id} insight={insight} index={index} />
        ))}
      </div>
    </motion.div>
  );
}

interface InsightCardProps {
  insight: Insight;
  index: number;
}

const TYPE_STYLES = {
  staff: { border: 'border-l-purple-500', bg: 'bg-purple-50 dark:bg-purple-900/20' },
  time: { border: 'border-l-blue-500', bg: 'bg-blue-50 dark:bg-blue-900/20' },
  environment: { border: 'border-l-amber-500', bg: 'bg-amber-50 dark:bg-amber-900/20' },
  trend: { border: 'border-l-green-500', bg: 'bg-green-50 dark:bg-green-900/20' },
};

function InsightCard({ insight, index }: InsightCardProps) {
  const style = TYPE_STYLES[insight.type] || TYPE_STYLES.trend;
  
  return (
    <motion.div
      className={`p-3 rounded-r-xl border-l-4 ${style.border} ${style.bg} transition-colors`}
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.1 }}
    >
      <div className="flex items-start gap-2">
        <span className="text-lg">{insight.icon}</span>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-warm-800 dark:text-warm-100 text-sm">{insight.title}</p>
          <p className="text-xs text-warm-600 dark:text-warm-400 mt-0.5">{insight.description}</p>
          {insight.actionable && (
            <p className="text-xs text-primary font-medium mt-1 flex items-center gap-1">
              <Lightbulb className="w-3 h-3" />
              {insight.actionable}
            </p>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export default InsightsPanel;

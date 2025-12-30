import { useState } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, Zap } from 'lucide-react';
import { PulseRecommendations } from './PulseRecommendations';
import { PulsePlus } from './PulsePlus';

type InsightTab = 'recommendations' | 'events';

export function Insights() {
  const [activeTab, setActiveTab] = useState<InsightTab>('recommendations');

  return (
    <div className="max-w-7xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        {/* Header */}
        <div className="mb-6">
          <h2 className="text-2xl font-bold gradient-text mb-2">Insights</h2>
          <p className="text-gray-400">Recommendations and upcoming events</p>
        </div>

        {/* Tab Selector */}
        <div className="flex gap-2 mb-6">
          <TabButton
            active={activeTab === 'recommendations'}
            onClick={() => setActiveTab('recommendations')}
            icon={TrendingUp}
            label="Recommendations"
          />
          <TabButton
            active={activeTab === 'events'}
            onClick={() => setActiveTab('events')}
            icon={Zap}
            label="Events & Reviews"
          />
        </div>

        {/* Tab Content */}
        {activeTab === 'recommendations' ? (
          <PulseRecommendations />
        ) : (
          <PulsePlus />
        )}
      </motion.div>
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, label }: {
  active: boolean;
  onClick: () => void;
  icon: typeof TrendingUp;
  label: string;
}) {
  return (
    <motion.button
      onClick={onClick}
      className={`
        flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all
        ${active
          ? 'bg-cyan text-navy'
          : 'bg-white/5 text-gray-300 hover:bg-white/10'
        }
      `}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      <Icon className="w-4 h-4" />
      {label}
    </motion.button>
  );
}

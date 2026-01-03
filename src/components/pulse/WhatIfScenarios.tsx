/**
 * WhatIfScenarios - Impact predictions for potential changes
 * 
 * Shows what could happen if the user makes specific adjustments.
 */

import { motion } from 'framer-motion';
import { Lightbulb, TrendingUp, Clock, ChevronRight } from 'lucide-react';
import type { WhatIfScenario } from '../../services/intelligence.service';
import { haptic } from '../../utils/haptics';

interface WhatIfScenariosProps {
  scenarios: WhatIfScenario[];
  onTap?: (scenario: WhatIfScenario) => void;
}

export function WhatIfScenarios({ scenarios, onTap }: WhatIfScenariosProps) {
  if (scenarios.length === 0) return null;
  
  return (
    <motion.div
      className="bg-warm-800 rounded-2xl border border-warm-700 overflow-hidden"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-warm-700 flex items-center gap-2">
        <Lightbulb className="w-4 h-4 text-purple-400" />
        <h3 className="text-sm font-semibold text-warm-100">What If...</h3>
      </div>
      
      {/* Scenarios */}
      <div className="divide-y divide-warm-700">
        {scenarios.map((scenario, index) => (
          <WhatIfCard
            key={scenario.id}
            scenario={scenario}
            index={index}
            onTap={() => {
              if (onTap) {
                haptic('light');
                onTap(scenario);
              }
            }}
          />
        ))}
      </div>
    </motion.div>
  );
}

interface WhatIfCardProps {
  scenario: WhatIfScenario;
  index: number;
  onTap?: () => void;
}

function WhatIfCard({ scenario, index, onTap }: WhatIfCardProps) {
  const isPositive = scenario.predictedImpact.pulseScore > 0;
  
  return (
    <motion.div
      className={`p-4 ${onTap ? 'cursor-pointer hover:bg-warm-700/50' : ''} transition-colors`}
      onClick={onTap}
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.1 }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <p className="text-sm font-medium text-warm-100">{scenario.action}</p>
          <p className="text-xs text-warm-400 mt-1">{scenario.predictedImpact.description}</p>
          
          {/* Impact indicators */}
          <div className="flex items-center gap-3 mt-2">
            {/* Pulse impact */}
            <div className={`flex items-center gap-1 text-xs ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
              <TrendingUp className={`w-3 h-3 ${!isPositive ? 'rotate-180' : ''}`} />
              <span className="font-medium">
                {isPositive ? '+' : ''}{scenario.predictedImpact.pulseScore} Pulse
              </span>
            </div>
            
            {/* Dwell impact */}
            {scenario.predictedImpact.dwellTime > 0 && (
              <div className="flex items-center gap-1 text-xs text-warm-400">
                <Clock className="w-3 h-3" />
                <span>+{scenario.predictedImpact.dwellTime} min dwell</span>
              </div>
            )}
          </div>
          
          {/* Confidence & basis */}
          <p className="text-[10px] text-warm-500 mt-2">
            {scenario.confidence}% confidence • {scenario.basedOn}
          </p>
        </div>
        
        {onTap && (
          <ChevronRight className="w-4 h-4 text-warm-500 flex-shrink-0 mt-1" />
        )}
      </div>
    </motion.div>
  );
}

// Compact version for inline display
interface WhatIfBadgeProps {
  scenario: WhatIfScenario;
}

export function WhatIfBadge({ scenario }: WhatIfBadgeProps) {
  const isPositive = scenario.predictedImpact.pulseScore > 0;
  
  return (
    <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs ${
      isPositive ? 'bg-green-900/20 text-green-400' : 'bg-warm-700 text-warm-400'
    }`}>
      <Lightbulb className="w-3 h-3" />
      <span>{scenario.action}</span>
      <span className="font-medium">
        {isPositive ? '+' : ''}{scenario.predictedImpact.pulseScore}
      </span>
    </div>
  );
}

export default WhatIfScenarios;

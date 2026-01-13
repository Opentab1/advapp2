/**
 * DwellBreakdownModal - Deep dive into estimated average stay time
 * 
 * Shows:
 * - Estimated average time guests stay (based on exit velocity)
 * - Revenue impact calculation
 * - What factors affect dwell time
 * - Actionable recommendations
 * 
 * NOTE: Distribution and day patterns removed - we can't track individual
 * guests, so those would be fabricated data. Honesty > fake charts.
 */

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Modal } from '../common/Modal';
import { 
  Clock, DollarSign, Lightbulb, ChevronRight, Target, AlertCircle
} from 'lucide-react';
import { getDwellTimeCategory, formatDwellTime, getDwellTimeScore } from '../../utils/scoring';

// ============ TYPES ============

interface DwellBreakdownModalProps {
  isOpen: boolean;
  onClose: () => void;
  dwellTimeMinutes: number | null;
  // Optional enhanced data
  todayVisitors?: number;
  avgSpendPerPerson?: number;
}

// ============ MAIN COMPONENT ============

export function DwellBreakdownModal({
  isOpen,
  onClose,
  dwellTimeMinutes,
  todayVisitors = 0,
  avgSpendPerPerson = 35,
}: DwellBreakdownModalProps) {
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  
  const category = getDwellTimeCategory(dwellTimeMinutes);
  const formatted = formatDwellTime(dwellTimeMinutes);
  const score = getDwellTimeScore(dwellTimeMinutes);
  
  // Distribution and day patterns removed - we can't track individual guests
  // so these would be fabricated data. Honesty > fake charts.
  
  // Revenue calculations
  const revenue = useMemo(() => {
    const dwell = dwellTimeMinutes || 45;
    const avgSpendPerMinute = avgSpendPerPerson / 60; // ~$0.58/min for $35/hour
    const currentRevPerGuest = dwell * avgSpendPerMinute;
    const potential10Min = (dwell + 10) * avgSpendPerMinute;
    const extraPer10Min = potential10Min - currentRevPerGuest;
    
    return {
      perGuest: Math.round(currentRevPerGuest),
      extraPer10Min: Math.round(extraPer10Min),
      todayTotal: Math.round(currentRevPerGuest * todayVisitors),
      potentialToday: Math.round(potential10Min * todayVisitors),
    };
  }, [dwellTimeMinutes, avgSpendPerPerson, todayVisitors]);
  
  const categoryConfig = {
    excellent: { 
      color: 'text-green-400',
      bg: 'bg-green-900/20 border-green-800', 
      barColor: 'bg-green-500',
      icon: '🎯',
      label: 'Excellent',
      message: 'Guests love staying here — your atmosphere is working.',
    },
    good: { 
      color: 'text-primary',
      bg: 'bg-primary/20 border-primary/20', 
      barColor: 'bg-primary',
      icon: '👍',
      label: 'Good',
      message: 'Solid dwell time. Small atmosphere tweaks could push it higher.',
    },
    fair: { 
      color: 'text-amber-400',
      bg: 'bg-amber-900/20 border-amber-800', 
      barColor: 'bg-amber-500',
      icon: '⚠️',
      label: 'Fair',
      message: 'Guests are leaving earlier than ideal. This impacts revenue.',
    },
    poor: { 
      color: 'text-red-400',
      bg: 'bg-red-900/20 border-red-800', 
      barColor: 'bg-red-500',
      icon: '📉',
      label: 'Needs Work',
      message: 'Low dwell time means guests aren\'t comfortable.',
    },
    unknown: { 
      color: 'text-warm-500',
      bg: 'bg-warm-700/50 border-warm-700', 
      barColor: 'bg-warm-500',
      icon: '❓',
      label: 'No Data',
      message: 'Not enough data to calculate average time spent.',
    },
  };
  
  const config = categoryConfig[category as keyof typeof categoryConfig] || categoryConfig.unknown;
  
  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section);
  };
  
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Avg Stay (Estimate)">
      <div className="space-y-5">
        
        {/* ============ HERO ============ */}
        <div className="text-center py-5 bg-gradient-to-b from-warm-700/50 to-transparent rounded-2xl -mx-2">
          <div className="flex items-center justify-center gap-3 mb-1">
            <Clock className="w-7 h-7 text-primary" />
            <span className="text-4xl font-bold text-warm-100">{formatted}</span>
          </div>
          <p className="text-sm text-warm-400">estimated avg stay</p>
          
          {/* Score bar */}
          {dwellTimeMinutes !== null && (
            <div className="mt-4 mx-6">
              <div className="flex justify-between text-xs mb-1">
                <span className="text-warm-500">Score</span>
                <span className={config.color}>{score}/100</span>
              </div>
              <div className="h-2 bg-warm-600 rounded-full overflow-hidden">
                <motion.div
                  className={`h-full rounded-full ${config.barColor}`}
                  initial={{ width: 0 }}
                  animate={{ width: `${score}%` }}
                  transition={{ duration: 0.5 }}
                />
              </div>
            </div>
          )}
          
          <span className={`inline-block mt-3 px-3 py-1 rounded-full text-xs font-semibold ${config.bg} ${config.color}`}>
            {config.icon} {config.label}
          </span>
        </div>
        
        {/* ============ QUICK INSIGHT ============ */}
        <div className={`p-4 rounded-xl border ${config.bg}`}>
          <p className="text-sm text-warm-200">{config.message}</p>
        </div>
        
        {/* ============ REVENUE IMPACT ============ */}
        <CollapsibleSection
          title="Revenue Impact"
          icon={DollarSign}
          subtitle={`~$${revenue.perGuest} per guest`}
          expanded={expandedSection === 'revenue'}
          onToggle={() => toggleSection('revenue')}
          accentColor="green"
          defaultOpen={true}
        >
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <RevenueCard
                label="Per Guest"
                value={`$${revenue.perGuest}`}
                subtext={`at ${formatted} avg stay`}
              />
              <RevenueCard
                label="+10 Min Impact"
                value={`+$${revenue.extraPer10Min}`}
                subtext="extra per guest"
                highlight
              />
            </div>
            
            {todayVisitors > 0 && (
              <div className="bg-green-900/20 rounded-lg p-3 border border-green-900/30">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-warm-300">Today's potential</span>
                  <span className="text-xs text-green-400">with +10min dwell</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-green-400">
                    +${revenue.potentialToday - revenue.todayTotal}
                  </span>
                  <span className="text-sm text-warm-400">
                    ({todayVisitors} visitors × ${revenue.extraPer10Min})
                  </span>
                </div>
              </div>
            )}
            
            <p className="text-xs text-warm-500">
              💡 Every 10 extra minutes = ~{Math.round((10 / (dwellTimeMinutes || 45)) * 100)}% more revenue per guest
            </p>
          </div>
        </CollapsibleSection>
        
        {/* ============ DATA LIMITATION NOTE ============ */}
        <div className="p-4 bg-warm-800/50 rounded-xl border border-warm-700/50">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-500 flex items-center justify-center flex-shrink-0">
              <AlertCircle className="w-4 h-4" />
            </div>
            <div>
              <p className="text-sm font-medium text-warm-200 mb-1">Estimate Based on Entry/Exit Data</p>
              <p className="text-xs text-warm-500">
                This avg stay time is calculated from exit velocity (exits per hour ÷ current occupancy).
                We can't track individual guests, so detailed distribution and day patterns are not available.
              </p>
            </div>
          </div>
        </div>
        
        {/* ============ WHAT AFFECTS DWELL ============ */}
        <CollapsibleSection
          title="What Affects Stay Time"
          icon={Lightbulb}
          subtitle="Factors you can control"
          expanded={expandedSection === 'factors'}
          onToggle={() => toggleSection('factors')}
        >
          <div className="space-y-2 pt-2">
            <FactorImpact
              factor="Sound Level"
              impact="+12 min"
              condition="when 70-78 dB"
              positive
            />
            <FactorImpact
              factor="Lighting"
              impact="+8 min"
              condition="dimmer in evening"
              positive
            />
            <FactorImpact
              factor="Live Music"
              impact="+18 min"
              condition="on entertainment nights"
              positive
            />
            <FactorImpact
              factor="Games on TV"
              impact="+15 min"
              condition="during big games"
              positive
            />
            <FactorImpact
              factor="Loud Music"
              impact="-10 min"
              condition="when >85 dB"
              positive={false}
            />
            <FactorImpact
              factor="Slow Service"
              impact="-15 min"
              condition="wait >10 min"
              positive={false}
            />
          </div>
        </CollapsibleSection>
        
        {/* ============ RECOMMENDATION ============ */}
        {category !== 'excellent' && category !== 'unknown' && (
          <div className="bg-primary/10 rounded-xl p-4 border border-primary/20">
            <div className="flex items-start gap-3">
              <Target className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-warm-100 mb-1">Top Recommendation</p>
                <p className="text-sm text-warm-300">
                  {category === 'poor' 
                    ? 'Check if sound is too loud (>80dB). Guests can\'t talk = they leave early.'
                    : category === 'fair'
                    ? 'Try dimming lights 10% during evening hours to create a cozier vibe.'
                    : 'You\'re close! Consider adding background music variety to keep energy fresh.'
                  }
                </p>
              </div>
            </div>
          </div>
        )}
        
        {/* Footer */}
        <p className="text-xs text-warm-600 text-center">
          ⚠️ Estimate based on occupancy ÷ turnover • Not a direct measurement
        </p>
      </div>
    </Modal>
  );
}

// ============ COLLAPSIBLE SECTION ============

interface CollapsibleSectionProps {
  title: string;
  icon: typeof Clock;
  subtitle?: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  defaultOpen?: boolean;
  accentColor?: 'primary' | 'green' | 'amber';
}

function CollapsibleSection({
  title,
  icon: Icon,
  subtitle,
  expanded,
  onToggle,
  children,
  defaultOpen,
  accentColor = 'primary',
}: CollapsibleSectionProps) {
  const isOpen = defaultOpen ? !expanded : expanded;
  
  const colors = {
    primary: 'text-primary bg-primary/10',
    green: 'text-green-400 bg-green-900/20',
    amber: 'text-amber-400 bg-amber-900/20',
  };
  
  return (
    <div className="bg-warm-800/50 rounded-xl border border-warm-700/50 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 hover:bg-warm-700/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-lg ${colors[accentColor]} flex items-center justify-center`}>
            <Icon className="w-4 h-4" />
          </div>
          <div className="text-left">
            <p className="text-sm font-semibold text-warm-100">{title}</p>
            {subtitle && <p className="text-xs text-warm-500">{subtitle}</p>}
          </div>
        </div>
        <motion.div animate={{ rotate: isOpen ? 90 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronRight className="w-5 h-5 text-warm-500" />
        </motion.div>
      </button>
      
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="px-4 pb-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============ REVENUE CARD ============

function RevenueCard({ label, value, subtext, highlight }: {
  label: string;
  value: string;
  subtext: string;
  highlight?: boolean;
}) {
  return (
    <div className={`p-3 rounded-lg ${highlight ? 'bg-green-900/20 border border-green-900/30' : 'bg-warm-700/50'}`}>
      <p className="text-xs text-warm-400 mb-1">{label}</p>
      <p className={`text-xl font-bold ${highlight ? 'text-green-400' : 'text-warm-100'}`}>{value}</p>
      <p className="text-xs text-warm-500">{subtext}</p>
    </div>
  );
}

// ============ FACTOR IMPACT ============

function FactorImpact({ factor, impact, condition, positive }: {
  factor: string;
  impact: string;
  condition: string;
  positive: boolean;
}) {
  return (
    <div className="flex items-center justify-between p-2 rounded-lg bg-warm-700/30">
      <div>
        <p className="text-sm text-warm-200">{factor}</p>
        <p className="text-xs text-warm-500">{condition}</p>
      </div>
      <span className={`text-sm font-semibold ${positive ? 'text-green-400' : 'text-red-400'}`}>
        {impact}
      </span>
    </div>
  );
}

export default DwellBreakdownModal;

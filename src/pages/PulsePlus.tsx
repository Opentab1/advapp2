/**
 * Pulse+ Page - WHOOP-style Command Center
 * 
 * Structure:
 * 1. PULSE RINGS HERO - Main score + 3 supporting rings
 * 2. NEXT ACTION - The single most impactful thing to do right now
 * 3. ACTION QUEUE - Prioritized list of remaining improvements
 * 4. EXTERNAL FACTORS - Sports, holidays that affect traffic
 */

import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Zap, 
  Volume2,
  Sun,
  CheckCircle,
  ChevronRight,
  TrendingUp,
  Target,
  Sparkles,
  ThumbsUp,
  Trophy,
  Calendar,
  Star,
  RefreshCw,
  Users,
  Clock,
  Music,
  X,
  HelpCircle
} from 'lucide-react';
import { PulseRing } from '../components/PulseRing';
import { usePulseScore } from '../hooks/usePulseScore';
import { PulseExplainer } from '../components/PulseExplainer';
import { 
  ActionCelebration, 
  ActionHistory, 
  useActionTracking,
  type CompletedAction 
} from '../components/ActionFeedback';
import sportsService from '../services/sports.service';
import holidayService from '../services/holiday.service';
import type { SportsGame, OccupancyMetrics } from '../types';

// ============ TYPES ============

interface PulseAction {
  id: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  category: 'sound' | 'light' | 'occupancy' | 'timing' | 'general';
  title: string;
  description: string;
  impact: string;
  currentValue?: string;
  targetValue?: string;
  icon: typeof Volume2;
}

// Optimal ranges
const OPTIMAL_RANGES = {
  sound: { min: 70, max: 82, unit: 'dB' },
  light: { min: 50, max: 350, unit: 'lux' },
  temperature: { min: 68, max: 74, unit: '°F' },
};

// Time periods for bars
const TIME_PERIODS = {
  prePeak: { start: 16, end: 19 },
  peak: { start: 19, end: 23 },
};

// Occupancy thresholds (as % of capacity)
const OCCUPANCY_THRESHOLDS = {
  slow: 30,
  busy: 75,
  packed: 90,
};

// ============ MAIN COMPONENT ============

export function PulsePlus() {
  const [todayGames, setTodayGames] = useState<SportsGame[]>([]);
  const [completedActionIds, setCompletedActionIds] = useState<Set<string>>(new Set());
  const [activeDetail, setActiveDetail] = useState<'pulse' | 'dwell' | 'reputation' | 'occupancy' | null>(null);
  
  // Trust/Explainer modal state
  const [showExplainer, setShowExplainer] = useState(false);
  
  // Feedback loop: action tracking with before/after snapshots
  const { 
    completedActions: actionHistory, 
    createSnapshot, 
    completeAction 
  } = useActionTracking();
  
  // Celebration modal state
  const [celebrationAction, setCelebrationAction] = useState<CompletedAction | null>(null);
  const [showCelebration, setShowCelebration] = useState(false);

  // Use centralized pulse score hook
  const pulseData = usePulseScore({ enabled: true, pollingInterval: 30000 });
  
  const {
    loading,
    pulseScore,
    pulseStatus,
    pulseColor,
    soundScore,
    lightScore,
    currentDecibels,
    currentLight,
    dwellTimeFormatted,
    dwellScore,
    reviews,
    reputationScore,
    occupancy,
    currentOccupancy,
    occupancyScore,
    weeklyAvgOccupancy,
    refresh,
  } = pulseData;

  // Load external data (sports, holidays)
  useEffect(() => {
    async function loadExternalData() {
      try {
        const games = await sportsService.getGames();
        const today = new Date().toDateString();
        setTodayGames(games.filter(g => new Date(g.startTime).toDateString() === today));
      } catch (e) {
        console.error('Failed to load sports data:', e);
      }
    }
    loadExternalData();
  }, []);

  // Generate actions based on current data
  const actions = useMemo(() => {
    if (!pulseData.hasData) return [];
    
    const now = new Date();
    
    const hasUpcomingGames = todayGames.some(g => {
      const gameTime = new Date(g.startTime);
      const hoursUntil = (gameTime.getTime() - now.getTime()) / (1000 * 60 * 60);
      return hoursUntil > 0 && hoursUntil < 4;
    });

    return generateActions({
      currentDecibels,
      currentLight,
      occupancy,
      currentHour: now.getHours(),
      dayOfWeek: now.getDay(),
      hasUpcomingGames,
    });
  }, [pulseData.hasData, currentDecibels, currentLight, occupancy, todayGames]);

  // Create snapshots for new actions (feedback loop: track "before" values)
  useEffect(() => {
    actions.forEach(action => {
      if (!completedActionIds.has(action.id)) {
        createSnapshot(action.id, action.title, action.category, {
          decibels: currentDecibels,
          light: currentLight,
          pulseScore: pulseScore,
          occupancy: currentOccupancy,
        });
      }
    });
  }, [actions, completedActionIds, currentDecibels, currentLight, pulseScore, currentOccupancy, createSnapshot]);

  const handleRefresh = async () => {
    await refresh();
  };

  // Feedback loop: complete action with before/after tracking
  const handleCompleteAction = (actionId: string) => {
    // Get current metrics for "after" comparison
    const currentMetrics = {
      decibels: currentDecibels,
      light: currentLight,
      pulseScore: pulseScore,
      occupancy: currentOccupancy,
    };
    
    // Complete and get the result with improvement data
    const completed = completeAction(actionId, currentMetrics);
    
    // Mark as completed
    setCompletedActionIds(prev => new Set([...prev, actionId]));
    
    // Show celebration with before/after comparison
    if (completed) {
      setCelebrationAction(completed);
      setShowCelebration(true);
    }
  };

  // Filter actions
  const heroAction = actions.find(a => !completedActionIds.has(a.id));
  const remainingActions = actions.filter(a => !completedActionIds.has(a.id) && a.id !== heroAction?.id);
  const completedCount = completedActionIds.size;

  // External factors
  const upcomingHolidays = holidayService.getUpcomingHolidays(7);
  const nextHoliday = upcomingHolidays[0];
  const daysUntilHoliday = nextHoliday ? holidayService.getDaysUntil(nextHoliday) : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-3">
          <Zap className="w-12 h-12 text-primary animate-pulse" />
          <p className="text-warm-500">Loading your command center...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto pb-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Zap className="w-6 h-6 text-primary" />
            <h2 className="text-2xl font-bold text-warm-800">Pulse+</h2>
          </div>
          <p className="text-warm-500">Your venue command center</p>
        </div>
        <motion.button
          onClick={handleRefresh}
          disabled={loading}
          className="p-2 rounded-xl bg-warm-100 hover:bg-warm-200 transition-colors"
          whileTap={{ scale: 0.95 }}
        >
          <RefreshCw className={`w-5 h-5 text-warm-600 ${loading ? 'animate-spin' : ''}`} />
        </motion.button>
      </div>

      {/* ============ PULSE RINGS HERO ============ */}
      <motion.div
        className="mb-6"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        {/* Main Pulse Score Ring */}
        <div className="flex justify-center mb-4 relative">
          <PulseRing
            score={pulseScore}
            label="Pulse Score"
            subtitle={pulseStatus}
            color={pulseColor}
            size="hero"
            onClick={() => setActiveDetail('pulse')}
            showHint
          />
          {/* Trust: "How is this calculated?" button */}
          <motion.button
            onClick={() => setShowExplainer(true)}
            className="absolute top-0 right-4 sm:right-8 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-warm-100 hover:bg-warm-200 transition-colors text-warm-600 text-xs font-medium"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            title="Learn how Pulse Score works"
          >
            <HelpCircle className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">How it works</span>
          </motion.button>
        </div>

        {/* Three Supporting Rings */}
        <div className="flex justify-center gap-3 sm:gap-4">
          <PulseRing
            score={dwellScore}
            label="Dwell Time"
            value={dwellTimeFormatted}
            color="#0077B6"
            size="small"
            onClick={() => setActiveDetail('dwell')}
          />
          <PulseRing
            score={reputationScore}
            label="Reputation"
            value={reviews ? `${reviews.rating.toFixed(1)}★` : '--'}
            color="#F59E0B"
            size="small"
            onClick={() => setActiveDetail('reputation')}
          />
          <PulseRing
            score={occupancyScore}
            label="Crowd"
            value={String(currentOccupancy)}
            color="#22C55E"
            size="small"
            onClick={() => setActiveDetail('occupancy')}
          />
        </div>
      </motion.div>

      {/* ============ NEXT ACTION HERO ============ */}
      {heroAction ? (
        <motion.div
          className="mb-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <NextActionHero 
            action={heroAction} 
            onComplete={() => handleCompleteAction(heroAction.id)}
          />
        </motion.div>
      ) : (
        <AllSetCelebration completedCount={completedCount} currentHour={new Date().getHours()} />
      )}

      {/* ============ ACTION QUEUE ============ */}
      {remainingActions.length > 0 && (
        <motion.div
          className="mb-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold text-warm-800">Up Next</h3>
            <span className="text-sm text-warm-500">{remainingActions.length} more</span>
          </div>
          <div className="space-y-2">
            {remainingActions.slice(0, 3).map((action, index) => (
              <ActionCard 
                key={action.id}
                action={action}
                index={index}
                onComplete={() => handleCompleteAction(action.id)}
              />
            ))}
          </div>
        </motion.div>
      )}

      {/* ============ ACTION HISTORY (Feedback Loop) ============ */}
      {actionHistory.length > 0 && (
        <ActionHistory completedActions={actionHistory} />
      )}

      {/* ============ TONIGHT'S FACTORS ============ */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        <h3 className="text-lg font-semibold text-warm-800 mb-3">Tonight's Factors</h3>
        <div className="space-y-3">
          {todayGames.length > 0 && (
            <FactorCard
              icon={Trophy}
              iconColor="text-yellow-500"
              iconBg="bg-yellow-50"
              title={`${todayGames.length} Game${todayGames.length > 1 ? 's' : ''} Today`}
              subtitle={todayGames.slice(0, 2).map(g => `${g.awayTeam} @ ${g.homeTeam}`).join(', ')}
              impact="higher"
            />
          )}

          {nextHoliday && daysUntilHoliday !== null && daysUntilHoliday <= 7 && (
            <FactorCard
              icon={Calendar}
              iconColor="text-purple-500"
              iconBg="bg-purple-50"
              title={nextHoliday.name}
              subtitle={daysUntilHoliday === 0 ? "Today!" : daysUntilHoliday === 1 ? "Tomorrow" : `In ${daysUntilHoliday} days`}
              impact="higher"
            />
          )}

          {reviews && (
            <FactorCard
              icon={Star}
              iconColor="text-amber-500"
              iconBg="bg-amber-50"
              title={`${reviews.rating.toFixed(1)} Stars on Google`}
              subtitle={`${reviews.reviewCount.toLocaleString()} reviews`}
              impact={reviews.rating >= 4.5 ? 'positive' : reviews.rating < 4 ? 'negative' : 'neutral'}
            />
          )}

          {todayGames.length === 0 && (!nextHoliday || daysUntilHoliday === null || daysUntilHoliday > 7) && !reviews && (
            <div className="p-4 rounded-xl bg-warm-50 border border-warm-200 text-center text-warm-500">
              No special factors tonight — typical traffic expected
            </div>
          )}
        </div>
      </motion.div>

      {/* ============ PRO TIP ============ */}
      <motion.div
        className="mt-6 p-4 rounded-xl bg-primary-50 border border-primary-100"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
      >
        <div className="flex items-start gap-3">
          <Sparkles className="w-5 h-5 text-primary mt-0.5" />
          <div>
            <p className="text-sm font-medium text-primary">Pro Tip</p>
            <p className="text-sm text-warm-600 mt-1">
              {getProTip(currentDecibels, todayGames)}
            </p>
          </div>
        </div>
      </motion.div>

      {/* ============ DETAIL MODALS ============ */}
      <AnimatePresence>
        {activeDetail === 'pulse' && (
          <PulseDetailModal
            onClose={() => setActiveDetail(null)}
            pulseScore={pulseScore ?? 0}
            soundScore={soundScore}
            lightScore={lightScore}
            currentDecibels={currentDecibels}
            currentLight={currentLight}
          />
        )}
        {activeDetail === 'dwell' && (
          <DwellDetailModal
            onClose={() => setActiveDetail(null)}
            dwellTimeFormatted={dwellTimeFormatted}
          />
        )}
        {activeDetail === 'reputation' && reviews && (
          <ReputationDetailModal
            onClose={() => setActiveDetail(null)}
            reviews={reviews}
          />
        )}
        {activeDetail === 'occupancy' && (
          <OccupancyDetailModal
            onClose={() => setActiveDetail(null)}
            current={currentOccupancy}
            weeklyAvg={weeklyAvgOccupancy}
            todayTotal={occupancy?.todayTotal ?? 0}
          />
        )}
      </AnimatePresence>

      {/* ============ ACTION CELEBRATION (Feedback Loop) ============ */}
      <ActionCelebration
        isOpen={showCelebration}
        onClose={() => {
          setShowCelebration(false);
          setCelebrationAction(null);
        }}
        action={celebrationAction}
      />

      {/* ============ PULSE EXPLAINER (Trust) ============ */}
      <PulseExplainer
        isOpen={showExplainer}
        onClose={() => setShowExplainer(false)}
        currentScore={pulseScore}
        soundScore={soundScore}
        lightScore={lightScore}
        currentDecibels={currentDecibels}
        currentLight={currentLight}
      />
    </div>
  );
}

// ============ NEXT ACTION HERO COMPONENT ============

function NextActionHero({ action, onComplete }: { action: PulseAction; onComplete: () => void }) {
  const Icon = action.icon;
  
  const priorityColors = {
    critical: 'from-red-500 to-rose-600',
    high: 'from-amber-500 to-orange-500',
    medium: 'from-primary to-blue-600',
    low: 'from-green-500 to-emerald-600',
  };

  const priorityBg = {
    critical: 'bg-red-50 border-red-200',
    high: 'bg-amber-50 border-amber-200',
    medium: 'bg-primary-50 border-primary-100',
    low: 'bg-green-50 border-green-200',
  };

  const priorityLabel = {
    critical: '🚨 Do This Now',
    high: '⚡ Priority Action',
    medium: '💡 Recommended',
    low: '✨ Nice to Have',
  };

  return (
    <div className={`relative overflow-hidden rounded-2xl border-2 ${priorityBg[action.priority]}`}>
      <div className={`bg-gradient-to-r ${priorityColors[action.priority]} px-4 py-2`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-white" />
            <span className="text-sm font-bold text-white uppercase tracking-wide">
              {priorityLabel[action.priority]}
            </span>
          </div>
        </div>
      </div>

      <div className="p-6">
        <div className="flex items-start gap-4">
          <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${priorityColors[action.priority]} flex items-center justify-center flex-shrink-0`}>
            <Icon className="w-7 h-7 text-white" />
          </div>
          
          <div className="flex-1">
            <h3 className="text-xl font-bold text-warm-800 mb-1">{action.title}</h3>
            <p className="text-warm-600 mb-4">{action.description}</p>
            
            {action.currentValue && action.targetValue && (
              <div className="flex items-center gap-4 mb-4 p-3 rounded-lg bg-white/50">
                <div>
                  <p className="text-xs text-warm-500">Current</p>
                  <p className="text-lg font-bold text-warm-800">{action.currentValue}</p>
                </div>
                <ChevronRight className="w-5 h-5 text-warm-400" />
                <div>
                  <p className="text-xs text-warm-500">Target</p>
                  <p className="text-lg font-bold text-green-600">{action.targetValue}</p>
                </div>
              </div>
            )}
            
            <div className="flex items-center gap-2 text-sm text-warm-600">
              <TrendingUp className="w-4 h-4 text-green-500" />
              <span>{action.impact}</span>
            </div>
          </div>
        </div>

        <motion.button
          onClick={onComplete}
          className="w-full mt-6 py-3 rounded-xl bg-warm-800 text-white font-semibold flex items-center justify-center gap-2 hover:bg-warm-900 transition-colors"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <CheckCircle className="w-5 h-5" />
          Mark as Done
        </motion.button>
      </div>
    </div>
  );
}

// ============ ACTION CARD COMPONENT ============

function ActionCard({ action, index, onComplete }: { 
  action: PulseAction; 
  index: number;
  onComplete: () => void;
}) {
  const Icon = action.icon;
  
  const priorityColors = {
    critical: 'border-red-200 bg-red-50',
    high: 'border-amber-200 bg-amber-50',
    medium: 'border-warm-200 bg-warm-50',
    low: 'border-green-200 bg-green-50',
  };

  const priorityDot = {
    critical: 'bg-red-500',
    high: 'bg-amber-500',
    medium: 'bg-primary',
    low: 'bg-green-500',
  };

  return (
    <motion.div
      className={`p-4 rounded-xl border ${priorityColors[action.priority]} flex items-center gap-4`}
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.1 }}
    >
      <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center flex-shrink-0">
        <Icon className="w-5 h-5 text-warm-600" />
      </div>
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className={`w-2 h-2 rounded-full ${priorityDot[action.priority]}`} />
          <p className="font-medium text-warm-800 truncate">{action.title}</p>
        </div>
        <p className="text-sm text-warm-500 truncate">{action.description}</p>
      </div>
      
      <motion.button
        onClick={onComplete}
        className="p-2 rounded-lg bg-white hover:bg-warm-100 transition-colors flex-shrink-0"
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
      >
        <CheckCircle className="w-5 h-5 text-warm-400" />
      </motion.button>
    </motion.div>
  );
}

// ============ ALL SET CELEBRATION ============

function AllSetCelebration({ completedCount, currentHour }: { completedCount: number; currentHour: number }) {
  const getMessage = () => {
    if (completedCount >= 3) {
      return { title: "You're Crushing It! 💪", subtitle: `${completedCount} actions completed`, emoji: "🏆" };
    }
    if (currentHour >= 19 && currentHour < 23) {
      return { title: "Peak Performance! 🔥", subtitle: "Everything's optimized for tonight", emoji: "⚡" };
    }
    if (currentHour >= 16 && currentHour < 19) {
      return { title: "Ready for Tonight! ✨", subtitle: "Set up for success", emoji: "🌅" };
    }
    return { title: "All Dialed In! 🎯", subtitle: "No actions needed right now", emoji: "👌" };
  };

  const { title, subtitle, emoji } = getMessage();

  return (
    <motion.div
      className="mb-6 relative overflow-hidden rounded-2xl"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-green-400 via-emerald-500 to-teal-500 opacity-90" />
      <div className="relative p-8">
        <div className="flex flex-col items-center text-center">
          <motion.div 
            className="text-6xl mb-4"
            animate={{ scale: [1, 1.1, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            {emoji}
          </motion.div>
          <h3 className="text-2xl font-bold text-white mb-2">{title}</h3>
          <p className="text-white/90 text-lg">{subtitle}</p>
        </div>
      </div>
    </motion.div>
  );
}

// ============ FACTOR CARD COMPONENT ============

function FactorCard({ icon: Icon, iconColor, iconBg, title, subtitle, impact }: {
  icon: typeof Trophy;
  iconColor: string;
  iconBg: string;
  title: string;
  subtitle: string;
  impact: 'higher' | 'lower' | 'positive' | 'negative' | 'neutral';
}) {
  return (
    <div className="p-4 rounded-xl bg-white border border-warm-200 flex items-center gap-4">
      <div className={`w-10 h-10 rounded-lg ${iconBg} flex items-center justify-center`}>
        <Icon className={`w-5 h-5 ${iconColor}`} />
      </div>
      <div className="flex-1">
        <p className="font-medium text-warm-800">{title}</p>
        <p className="text-sm text-warm-500">{subtitle}</p>
      </div>
      {impact === 'higher' && (
        <div className="flex items-center gap-1 text-green-600">
          <TrendingUp className="w-4 h-4" />
          <span className="text-xs font-medium">+Traffic</span>
        </div>
      )}
      {impact === 'positive' && <ThumbsUp className="w-5 h-5 text-green-500" />}
    </div>
  );
}

// ============ DETAIL MODALS ============

function ModalWrapper({ onClose, title, children }: { onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-warm-900/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 border border-warm-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-warm-800">{title}</h3>
          <button onClick={onClose} className="p-1 hover:bg-warm-100 rounded-lg">
            <X className="w-5 h-5 text-warm-400" />
          </button>
        </div>
        {children}
      </motion.div>
    </motion.div>
  );
}

function PulseDetailModal({ onClose, pulseScore, soundScore, lightScore, currentDecibels, currentLight }: {
  onClose: () => void;
  pulseScore: number;
  soundScore: number;
  lightScore: number;
  currentDecibels: number | null;
  currentLight: number | null;
}) {
  return (
    <ModalWrapper onClose={onClose} title="Pulse Score Breakdown">
      <div className="text-center py-4">
        <p className="text-5xl font-bold text-warm-800">{pulseScore}</p>
        <p className={`inline-block mt-2 px-3 py-1 rounded-full text-sm font-medium ${
          pulseScore >= 85 ? 'bg-green-50 text-green-600 border border-green-200' :
          pulseScore >= 60 ? 'bg-amber-50 text-amber-600 border border-amber-200' :
          'bg-red-50 text-red-600 border border-red-200'
        }`}>
          {pulseScore >= 85 ? 'Optimal' : pulseScore >= 60 ? 'Good' : 'Needs Adjustment'}
        </p>
      </div>
      <div className="space-y-3">
        <FactorRow icon={Volume2} label="Sound" weight="60%" score={soundScore} current={currentDecibels} unit="dB" optimal="70-82" />
        <FactorRow icon={Sun} label="Light" weight="40%" score={lightScore} current={currentLight} unit="lux" optimal="50-350" />
      </div>
    </ModalWrapper>
  );
}

function FactorRow({ icon: Icon, label, weight, score, current, unit, optimal }: {
  icon: typeof Volume2;
  label: string;
  weight: string;
  score: number;
  current: number | null;
  unit: string;
  optimal: string;
}) {
  return (
    <div className="p-3 rounded-xl bg-warm-50">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Icon className="w-4 h-4 text-primary" />
          </div>
          <div>
            <span className="text-sm font-medium text-warm-800">{label}</span>
            <span className="text-xs text-warm-500 ml-1">({weight})</span>
          </div>
        </div>
        <span className="text-lg font-bold text-warm-800">{score}</span>
      </div>
      <div className="flex justify-between text-xs text-warm-500">
        <span>Current: {current?.toFixed(1) ?? '--'} {unit}</span>
        <span>Optimal: {optimal} {unit}</span>
      </div>
      <div className="mt-2 h-1.5 bg-warm-200 rounded-full overflow-hidden">
        <div 
          className={`h-full rounded-full ${score >= 85 ? 'bg-green-500' : score >= 60 ? 'bg-yellow-500' : 'bg-red-500'}`}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  );
}

function DwellDetailModal({ onClose, dwellTimeFormatted }: {
  onClose: () => void;
  dwellTimeFormatted: string;
}) {
  return (
    <ModalWrapper onClose={onClose} title="Dwell Time Details">
      <div className="text-center py-4">
        <p className="text-4xl font-bold text-warm-800">{dwellTimeFormatted}</p>
        <p className="text-warm-500 mt-2">Average time guests spend at your venue</p>
      </div>
      <div className="p-4 rounded-xl bg-warm-50 text-sm text-warm-600">
        <p><strong>Why it matters:</strong> Longer dwell time = more orders, higher tabs, and better atmosphere.</p>
      </div>
    </ModalWrapper>
  );
}

function ReputationDetailModal({ onClose, reviews }: {
  onClose: () => void;
  reviews: { rating: number; reviewCount: number };
}) {
  return (
    <ModalWrapper onClose={onClose} title="Reputation Details">
      <div className="text-center py-4">
        <p className="text-4xl font-bold text-warm-800">{reviews.rating.toFixed(1)} ★</p>
        <p className="text-warm-500 mt-2">{reviews.reviewCount.toLocaleString()} Google reviews</p>
      </div>
      <div className="p-4 rounded-xl bg-warm-50 text-sm text-warm-600">
        <p><strong>Tip:</strong> Respond to reviews and encourage happy guests to leave feedback.</p>
      </div>
    </ModalWrapper>
  );
}

function OccupancyDetailModal({ onClose, current, weeklyAvg, todayTotal }: {
  onClose: () => void;
  current: number;
  weeklyAvg: number;
  todayTotal: number;
}) {
  return (
    <ModalWrapper onClose={onClose} title="Occupancy Details">
      <div className="text-center py-4">
        <p className="text-4xl font-bold text-warm-800">{current}</p>
        <p className="text-warm-500 mt-2">Currently in venue</p>
      </div>
      <div className="grid grid-cols-2 gap-3 mt-4">
        <div className="p-3 rounded-xl bg-warm-50 text-center">
          <p className="text-lg font-bold text-warm-800">{todayTotal}</p>
          <p className="text-xs text-warm-500">Today's entries</p>
        </div>
        <div className="p-3 rounded-xl bg-warm-50 text-center">
          <p className="text-lg font-bold text-warm-800">{weeklyAvg.toFixed(0)}</p>
          <p className="text-xs text-warm-500">7-day avg/day</p>
        </div>
      </div>
    </ModalWrapper>
  );
}

// ============ ACTION GENERATION ============

interface ActionInput {
  currentDecibels: number | null;
  currentLight: number | null;
  occupancy: OccupancyMetrics | null;
  currentHour: number;
  dayOfWeek: number;
  hasUpcomingGames: boolean;
}

function generateActions(input: ActionInput): PulseAction[] {
  const { currentDecibels, currentLight, occupancy, currentHour, dayOfWeek, hasUpcomingGames } = input;
  const actions: PulseAction[] = [];
  
  const isPeakHours = currentHour >= TIME_PERIODS.peak.start && currentHour < TIME_PERIODS.peak.end;
  const isPrePeak = currentHour >= TIME_PERIODS.prePeak.start && currentHour < TIME_PERIODS.prePeak.end;
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6;
  
  const estimatedCapacity = occupancy?.peakOccupancy ? Math.max(occupancy.peakOccupancy * 1.2, 50) : 100;
  const occupancyPercent = occupancy?.current !== undefined ? (occupancy.current / estimatedCapacity) * 100 : null;

  // Sound actions
  if (currentDecibels !== null) {
    if (currentDecibels > OPTIMAL_RANGES.sound.max) {
      const diff = currentDecibels - OPTIMAL_RANGES.sound.max;
      let priority: PulseAction['priority'] = diff > 12 ? 'critical' : diff > 8 ? 'high' : 'medium';
      if (priority !== 'critical' && occupancyPercent && occupancyPercent > OCCUPANCY_THRESHOLDS.packed) {
        priority = priority === 'high' ? 'critical' : 'high';
      }
      actions.push({
        id: 'sound-high',
        priority,
        category: 'sound',
        title: diff > 10 ? '🔊 Music is Too Loud' : 'Turn Down the Volume',
        description: `Sound is ${Math.round(diff)} dB above optimal. Guests can not hear each other.`,
        impact: 'Comfortable conversation = longer stays',
        currentValue: `${currentDecibels.toFixed(0)} dB`,
        targetValue: `${OPTIMAL_RANGES.sound.max} dB`,
        icon: Volume2,
      });
    } else if (currentDecibels < OPTIMAL_RANGES.sound.min) {
      const diff = OPTIMAL_RANGES.sound.min - currentDecibels;
      actions.push({
        id: 'sound-low',
        priority: diff > 20 ? 'high' : 'medium',
        category: 'sound',
        title: 'Pump Up the Energy',
        description: isPeakHours ? 'Peak hours but energy feels flat. Turn up the music.' : 'A bit quiet. Background music helps fill the space.',
        impact: 'The right energy level makes guests feel part of something',
        currentValue: `${currentDecibels.toFixed(0)} dB`,
        targetValue: `${OPTIMAL_RANGES.sound.min} dB`,
        icon: Music,
      });
    }
  }

  // Light actions
  if (currentLight !== null) {
    if (currentLight > OPTIMAL_RANGES.light.max) {
      actions.push({
        id: 'light-high',
        priority: currentHour >= 19 ? 'high' : 'medium',
        category: 'light',
        title: 'Dim the Lights',
        description: currentHour >= 19 ? 'Evening vibes need softer lighting.' : 'Lighting is harsher than optimal.',
        impact: 'Dimmer evening lighting increases average tab',
        currentValue: `${currentLight.toFixed(0)} lux`,
        targetValue: `${OPTIMAL_RANGES.light.max} lux`,
        icon: Sun,
      });
    }
  }

  // Occupancy actions
  if (occupancyPercent !== null) {
    if (isPeakHours && occupancyPercent < OCCUPANCY_THRESHOLDS.slow && isWeekend) {
      actions.push({
        id: 'occupancy-slow',
        priority: 'medium',
        category: 'occupancy',
        title: 'Slow for a Weekend',
        description: `Only ${Math.round(occupancyPercent)}% capacity. Consider a social post.`,
        impact: 'A quick promo can turn a slow night around',
        icon: Users,
      });
    }
    if (occupancyPercent >= OCCUPANCY_THRESHOLDS.packed) {
      actions.push({
        id: 'occupancy-packed',
        priority: 'high',
        category: 'occupancy',
        title: '🔥 House is Packed!',
        description: `${Math.round(occupancyPercent)}% capacity. Keep service fast.`,
        impact: 'Fast service = higher tips and return visits',
        icon: Users,
      });
    }
  }

  // Time-based actions
  if (isPrePeak && actions.length < 2) {
    actions.push({
      id: 'timing-prepeak',
      priority: 'low',
      category: 'timing',
      title: '⏰ Pre-Peak Prep Time',
      description: hasUpcomingGames ? 'Game coming up! Check TVs, stock the bar.' : 'Rush hour approaching. Time to prep.',
      impact: 'Prepared venues handle rushes smoother',
      icon: Clock,
    });
  }

  if (hasUpcomingGames && !actions.some(a => a.id.includes('game'))) {
    actions.push({
      id: 'timing-gameday',
      priority: 'high',
      category: 'timing',
      title: '🏈 Game Starting Soon',
      description: 'Expect a rush 30 min before kickoff.',
      impact: 'Game crowds order 2x faster — be ready',
      icon: Trophy,
    });
  }

  // Sort by priority
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  actions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return actions;
}

function getProTip(currentDecibels: number | null, games: SportsGame[]): string {
  if (games.length > 0) return "Game day! Staff up and prep for rushes 30 min before game time.";
  if (currentDecibels && currentDecibels > 85) return "High sound levels tire guests faster. Consider a 5-minute volume dip.";
  const tips = [
    "Check in on your Pulse Score every hour during peak times.",
    "Small adjustments early prevent big problems later.",
    "The best bars anticipate, not react.",
  ];
  return tips[Math.floor(Math.random() * tips.length)];
}

export default PulsePlus;

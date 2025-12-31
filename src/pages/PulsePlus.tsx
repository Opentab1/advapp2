/**
 * Pulse+ Page - WHOOP-style Actionable Insights
 * 
 * The core philosophy: Tell the user ONE thing to do, then show why.
 * 
 * Structure:
 * 1. NEXT ACTION HERO - The single most impactful thing to do right now
 * 2. ACTION QUEUE - Prioritized list of improvements
 * 3. WHY IT MATTERS - Context on how each action affects the venue
 * 4. EXTERNAL FACTORS - Sports, holidays, weather that affect traffic
 */

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { 
  Zap, 
  Volume2,
  Sun,
  CheckCircle,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Target,
  Sparkles,
  ThumbsUp,
  Trophy,
  Calendar,
  Star,
  RefreshCw
} from 'lucide-react';
import authService from '../services/auth.service';
import apiService from '../services/api.service';
import sportsService from '../services/sports.service';
import holidayService from '../services/holiday.service';
import venueSettingsService from '../services/venue-settings.service';
import googleReviewsService, { GoogleReviewsData } from '../services/google-reviews.service';
import type { SensorData, SportsGame } from '../types';

// ============ TYPES ============

interface PulseAction {
  id: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  category: 'sound' | 'light' | 'occupancy' | 'general';
  title: string;
  description: string;
  impact: string;
  currentValue?: string;
  targetValue?: string;
  icon: typeof Volume2;
}

// Optimal ranges (same as ScoreRings)
const OPTIMAL_RANGES = {
  sound: { min: 70, max: 82, unit: 'dB' },
  light: { min: 50, max: 350, unit: 'lux' },
};

// ============ MAIN COMPONENT ============

export function PulsePlus() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sensorData, setSensorData] = useState<SensorData | null>(null);
  const [actions, setActions] = useState<PulseAction[]>([]);
  const [todayGames, setTodayGames] = useState<SportsGame[]>([]);
  const [reviews, setReviews] = useState<GoogleReviewsData | null>(null);
  const [completedActions, setCompletedActions] = useState<Set<string>>(new Set());
  
  const user = authService.getStoredUser();
  const venueId = user?.venueId || '';
  const venueName = user?.venueName || '';

  // Load all data
  const loadData = useCallback(async () => {
    if (!venueId) {
      setLoading(false);
      return;
    }

    try {
      const [liveData, games, reviewsData] = await Promise.allSettled([
        apiService.getLiveData(venueId),
        sportsService.getGames(),
        googleReviewsService.getReviews(
          venueName, 
          venueSettingsService.getFormattedAddress(venueId) || '', 
          venueId
        ),
      ]);

      if (liveData.status === 'fulfilled') {
        setSensorData(liveData.value);
        setActions(generateActions(liveData.value));
      }

      if (games.status === 'fulfilled') {
        const today = new Date().toDateString();
        setTodayGames(games.value.filter(g => 
          new Date(g.startTime).toDateString() === today
        ));
      }

      if (reviewsData.status === 'fulfilled' && reviewsData.value) {
        setReviews(reviewsData.value);
      }
    } catch (error) {
      console.error('Error loading Pulse+ data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [venueId, venueName]);

  useEffect(() => {
    loadData();
    // Refresh every 30 seconds
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [loadData]);

  const handleRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const handleCompleteAction = (actionId: string) => {
    setCompletedActions(prev => new Set([...prev, actionId]));
  };

  // Get the top priority action (the HERO)
  const heroAction = actions.find(a => !completedActions.has(a.id));
  const remainingActions = actions.filter(a => !completedActions.has(a.id) && a.id !== heroAction?.id);
  const completedCount = completedActions.size;

  // Get upcoming holiday
  const upcomingHolidays = holidayService.getUpcomingHolidays(7);
  const nextHoliday = upcomingHolidays[0];
  const daysUntilHoliday = nextHoliday ? holidayService.getDaysUntil(nextHoliday) : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-3">
          <Zap className="w-12 h-12 text-primary animate-pulse" />
          <p className="text-warm-500">Loading your actions...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Zap className="w-6 h-6 text-primary" />
            <h2 className="text-2xl font-bold text-warm-800">Pulse+</h2>
          </div>
          <p className="text-warm-500">Your personalized action plan</p>
        </div>
        <motion.button
          onClick={handleRefresh}
          disabled={refreshing}
          className="p-2 rounded-xl bg-warm-100 hover:bg-warm-200 transition-colors"
          whileTap={{ scale: 0.95 }}
        >
          <RefreshCw className={`w-5 h-5 text-warm-600 ${refreshing ? 'animate-spin' : ''}`} />
        </motion.button>
      </div>

      {/* ============ NEXT ACTION HERO ============ */}
      {heroAction ? (
        <motion.div
          className="mb-6"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <NextActionHero 
            action={heroAction} 
            onComplete={() => handleCompleteAction(heroAction.id)}
          />
        </motion.div>
      ) : (
        <motion.div
          className="mb-6 p-8 rounded-2xl bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
        >
          <div className="flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-4">
              <CheckCircle className="w-8 h-8 text-green-600" />
            </div>
            <h3 className="text-xl font-bold text-green-800 mb-2">You're All Set! 🎉</h3>
            <p className="text-green-700">
              Your venue is perfectly optimized. No actions needed right now.
            </p>
            {completedCount > 0 && (
              <p className="text-sm text-green-600 mt-2">
                You completed {completedCount} action{completedCount > 1 ? 's' : ''} this session
              </p>
            )}
          </div>
        </motion.div>
      )}

      {/* ============ ACTION QUEUE ============ */}
      {remainingActions.length > 0 && (
        <motion.div
          className="mb-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
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

      {/* ============ CURRENT STATUS ============ */}
      {sensorData && (
        <motion.div
          className="mb-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <h3 className="text-lg font-semibold text-warm-800 mb-3">Current Status</h3>
          <div className="grid grid-cols-2 gap-3">
            <StatusCard
              icon={Volume2}
              label="Sound"
              value={sensorData.decibels?.toFixed(0) || '--'}
              unit="dB"
              status={getFactorStatus(sensorData.decibels, OPTIMAL_RANGES.sound)}
              optimal={`${OPTIMAL_RANGES.sound.min}-${OPTIMAL_RANGES.sound.max}`}
            />
            <StatusCard
              icon={Sun}
              label="Light"
              value={sensorData.light?.toFixed(0) || '--'}
              unit="lux"
              status={getFactorStatus(sensorData.light, OPTIMAL_RANGES.light)}
              optimal={`${OPTIMAL_RANGES.light.min}-${OPTIMAL_RANGES.light.max}`}
            />
          </div>
        </motion.div>
      )}

      {/* ============ EXTERNAL FACTORS ============ */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        <h3 className="text-lg font-semibold text-warm-800 mb-3">Tonight's Factors</h3>
        <div className="space-y-3">
          {/* Sports Games */}
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

          {/* Upcoming Holiday */}
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

          {/* Reviews */}
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

          {/* No factors */}
          {todayGames.length === 0 && (!nextHoliday || daysUntilHoliday === null || daysUntilHoliday > 7) && !reviews && (
            <div className="p-4 rounded-xl bg-warm-50 border border-warm-200 text-center text-warm-500">
              No special factors tonight — typical traffic expected
            </div>
          )}
        </div>
      </motion.div>

      {/* ============ QUICK TIP ============ */}
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
              {getProTip(sensorData, todayGames)}
            </p>
          </div>
        </div>
      </motion.div>
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

  return (
    <div className={`relative overflow-hidden rounded-2xl border-2 ${priorityBg[action.priority]}`}>
      {/* Priority Banner */}
      <div className={`bg-gradient-to-r ${priorityColors[action.priority]} px-4 py-2`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-white" />
            <span className="text-sm font-bold text-white uppercase tracking-wide">
              {action.priority === 'critical' ? '🚨 Do This Now' : 
               action.priority === 'high' ? '⚡ Priority Action' :
               action.priority === 'medium' ? '💡 Recommended' : '✨ Nice to Have'}
            </span>
          </div>
          <span className="text-xs text-white/80">
            {action.priority === 'critical' ? 'Critical' : 
             action.priority === 'high' ? 'High Impact' : 
             action.priority === 'medium' ? 'Medium Impact' : 'Low Impact'}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        <div className="flex items-start gap-4">
          <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${priorityColors[action.priority]} flex items-center justify-center flex-shrink-0`}>
            <Icon className="w-7 h-7 text-white" />
          </div>
          
          <div className="flex-1">
            <h3 className="text-xl font-bold text-warm-800 mb-1">{action.title}</h3>
            <p className="text-warm-600 mb-4">{action.description}</p>
            
            {/* Current vs Target */}
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
            
            {/* Impact */}
            <div className="flex items-center gap-2 text-sm text-warm-600">
              <TrendingUp className="w-4 h-4 text-green-500" />
              <span>{action.impact}</span>
            </div>
          </div>
        </div>

        {/* Complete Button */}
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
      <div className={`w-10 h-10 rounded-lg bg-white flex items-center justify-center flex-shrink-0`}>
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

// ============ STATUS CARD COMPONENT ============

function StatusCard({ icon: Icon, label, value, unit, status, optimal }: {
  icon: typeof Volume2;
  label: string;
  value: string;
  unit: string;
  status: 'optimal' | 'warning' | 'critical';
  optimal: string;
}) {
  const statusColors = {
    optimal: 'bg-green-50 border-green-200',
    warning: 'bg-amber-50 border-amber-200',
    critical: 'bg-red-50 border-red-200',
  };

  const statusText = {
    optimal: 'text-green-600',
    warning: 'text-amber-600',
    critical: 'text-red-600',
  };

  const statusLabel = {
    optimal: '✓ Optimal',
    warning: '⚠ Adjust',
    critical: '✗ Fix Now',
  };

  return (
    <div className={`p-4 rounded-xl border ${statusColors[status]}`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-4 h-4 ${statusText[status]}`} />
        <span className="text-sm text-warm-600">{label}</span>
      </div>
      <div className="flex items-baseline gap-1 mb-1">
        <span className="text-2xl font-bold text-warm-800">{value}</span>
        <span className="text-sm text-warm-500">{unit}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className={`text-xs font-medium ${statusText[status]}`}>{statusLabel[status]}</span>
        <span className="text-xs text-warm-400">Target: {optimal}</span>
      </div>
    </div>
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
      {impact === 'lower' && (
        <div className="flex items-center gap-1 text-red-600">
          <TrendingDown className="w-4 h-4" />
          <span className="text-xs font-medium">-Traffic</span>
        </div>
      )}
      {impact === 'positive' && (
        <ThumbsUp className="w-5 h-5 text-green-500" />
      )}
    </div>
  );
}

// ============ HELPER FUNCTIONS ============

function generateActions(data: SensorData): PulseAction[] {
  const actions: PulseAction[] = [];
  
  // Check sound
  if (data.decibels !== undefined) {
    if (data.decibels > OPTIMAL_RANGES.sound.max) {
      const diff = data.decibels - OPTIMAL_RANGES.sound.max;
      actions.push({
        id: 'sound-high',
        priority: diff > 10 ? 'critical' : diff > 5 ? 'high' : 'medium',
        category: 'sound',
        title: 'Turn Down the Music',
        description: `Sound level is ${Math.round(diff)} dB above optimal. This makes conversation difficult.`,
        impact: 'Guests stay longer when they can talk comfortably',
        currentValue: `${data.decibels.toFixed(0)} dB`,
        targetValue: `${OPTIMAL_RANGES.sound.max} dB`,
        icon: Volume2,
      });
    } else if (data.decibels < OPTIMAL_RANGES.sound.min) {
      const diff = OPTIMAL_RANGES.sound.min - data.decibels;
      actions.push({
        id: 'sound-low',
        priority: diff > 15 ? 'high' : 'medium',
        category: 'sound',
        title: 'Turn Up the Energy',
        description: `It's quieter than usual. A bit more volume creates better atmosphere.`,
        impact: 'Optimal sound levels increase energy and engagement',
        currentValue: `${data.decibels.toFixed(0)} dB`,
        targetValue: `${OPTIMAL_RANGES.sound.min} dB`,
        icon: Volume2,
      });
    }
  }
  
  // Check light
  if (data.light !== undefined) {
    if (data.light > OPTIMAL_RANGES.light.max) {
      actions.push({
        id: 'light-high',
        priority: 'medium',
        category: 'light',
        title: 'Dim the Lights',
        description: `Lighting is brighter than optimal for a bar atmosphere.`,
        impact: 'Dimmer lighting creates intimacy and encourages longer stays',
        currentValue: `${data.light.toFixed(0)} lux`,
        targetValue: `${OPTIMAL_RANGES.light.max} lux`,
        icon: Sun,
      });
    } else if (data.light < OPTIMAL_RANGES.light.min) {
      actions.push({
        id: 'light-low',
        priority: 'medium',
        category: 'light',
        title: 'Brighten Up',
        description: `It's darker than optimal. Guests need to see menus and each other.`,
        impact: 'Proper lighting improves comfort and order frequency',
        currentValue: `${data.light.toFixed(0)} lux`,
        targetValue: `${OPTIMAL_RANGES.light.min} lux`,
        icon: Sun,
      });
    }
  }
  
  // If everything is optimal, add a positive action
  if (actions.length === 0) {
    actions.push({
      id: 'all-optimal',
      priority: 'low',
      category: 'general',
      title: 'Maintain Current Settings',
      description: 'Your venue is perfectly dialed in. Keep it steady!',
      impact: 'Consistency builds customer trust and comfort',
      icon: CheckCircle,
    });
  }
  
  // Sort by priority
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  actions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
  
  return actions;
}

function getFactorStatus(value: number | undefined, range: { min: number; max: number }): 'optimal' | 'warning' | 'critical' {
  if (value === undefined) return 'warning';
  if (value >= range.min && value <= range.max) return 'optimal';
  
  const rangeSize = range.max - range.min;
  const tolerance = rangeSize * 0.3;
  
  if (value < range.min - tolerance || value > range.max + tolerance) {
    return 'critical';
  }
  return 'warning';
}

function getProTip(data: SensorData | null, games: SportsGame[]): string {
  const tips = [
    "Check in on your Pulse Score every hour during peak times.",
    "Small adjustments early prevent big problems later.",
    "Your regulars notice when the vibe is off — trust the data.",
    "The best bars anticipate, not react.",
  ];

  if (games.length > 0) {
    return "Game day! Staff up and prep for rushes 30 min before game time.";
  }

  if (data?.decibels && data.decibels > 85) {
    return "High sound levels tire guests faster. Consider a 5-minute volume dip.";
  }

  return tips[Math.floor(Math.random() * tips.length)];
}

export default PulsePlus;

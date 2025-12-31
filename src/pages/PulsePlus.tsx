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
  RefreshCw,
  Users,
  Clock,
  Music,
  Thermometer
} from 'lucide-react';
import authService from '../services/auth.service';
import apiService from '../services/api.service';
import sportsService from '../services/sports.service';
import holidayService from '../services/holiday.service';
import venueSettingsService from '../services/venue-settings.service';
import googleReviewsService, { GoogleReviewsData } from '../services/google-reviews.service';
import type { SensorData, SportsGame, OccupancyMetrics } from '../types';

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

interface ActionContext {
  sensorData: SensorData;
  occupancy?: OccupancyMetrics;
  currentHour: number;
  dayOfWeek: number; // 0 = Sunday
  hasUpcomingGames: boolean;
  isHolidayWeek: boolean;
}

// Optimal ranges (same as ScoreRings)
const OPTIMAL_RANGES = {
  sound: { min: 70, max: 82, unit: 'dB' },
  light: { min: 50, max: 350, unit: 'lux' },
  temperature: { min: 68, max: 74, unit: '°F' },
};

// Time periods for bars
const TIME_PERIODS = {
  prePeak: { start: 16, end: 19 },    // 4pm - 7pm
  peak: { start: 19, end: 23 },        // 7pm - 11pm
  latePeak: { start: 23, end: 2 },     // 11pm - 2am
  closing: { start: 2, end: 4 },       // 2am - 4am
  daytime: { start: 11, end: 16 },     // 11am - 4pm
};

// Occupancy thresholds (as % of capacity)
const OCCUPANCY_THRESHOLDS = {
  empty: 10,
  slow: 30,
  moderate: 50,
  busy: 75,
  packed: 90,
};

// ============ MAIN COMPONENT ============

export function PulsePlus() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sensorData, setSensorData] = useState<SensorData | null>(null);
  const [occupancy, setOccupancy] = useState<OccupancyMetrics | null>(null);
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
      const [liveData, occupancyData, games, reviewsData] = await Promise.allSettled([
        apiService.getLiveData(venueId),
        apiService.getOccupancyMetrics(venueId),
        sportsService.getGames(),
        googleReviewsService.getReviews(
          venueName, 
          venueSettingsService.getFormattedAddress(venueId) || '', 
          venueId
        ),
      ]);

      const now = new Date();
      const upcomingHolidays = holidayService.getUpcomingHolidays(7);
      
      // Get games for today
      let todaysGames: SportsGame[] = [];
      if (games.status === 'fulfilled') {
        const today = new Date().toDateString();
        todaysGames = games.value.filter(g => 
          new Date(g.startTime).toDateString() === today
        );
        setTodayGames(todaysGames);
      }

      // Get occupancy
      let currentOccupancy: OccupancyMetrics | undefined;
      if (occupancyData.status === 'fulfilled') {
        currentOccupancy = occupancyData.value;
        setOccupancy(occupancyData.value);
      }

      if (liveData.status === 'fulfilled') {
        setSensorData(liveData.value);
        
        // Build full context for action generation
        const context: ActionContext = {
          sensorData: liveData.value,
          occupancy: currentOccupancy,
          currentHour: now.getHours(),
          dayOfWeek: now.getDay(),
          hasUpcomingGames: todaysGames.some(g => {
            const gameTime = new Date(g.startTime);
            const hoursUntil = (gameTime.getTime() - now.getTime()) / (1000 * 60 * 60);
            return hoursUntil > 0 && hoursUntil < 4; // Game within 4 hours
          }),
          isHolidayWeek: upcomingHolidays.length > 0,
        };
        
        setActions(generateActions(context));
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
        <AllSetCelebration completedCount={completedCount} currentHour={new Date().getHours()} />
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
          {/* Occupancy row */}
          {occupancy && (
            <div className="mt-3 p-4 rounded-xl bg-warm-50 border border-warm-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-warm-600" />
                  <span className="text-sm text-warm-600">Current Crowd</span>
                </div>
                <div className="text-right">
                  <span className="text-lg font-bold text-warm-800">{occupancy.current}</span>
                  <span className="text-sm text-warm-500 ml-1">people</span>
                </div>
              </div>
              <div className="flex items-center justify-between mt-2 text-xs text-warm-500">
                <span>Today: {occupancy.todayTotal} entries</span>
                <span>7d avg: {occupancy.sevenDayAvg?.toFixed(0) || '--'}/day</span>
              </div>
            </div>
          )}
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

// ============ ALL SET CELEBRATION COMPONENT ============

function AllSetCelebration({ completedCount, currentHour }: { completedCount: number; currentHour: number }) {
  // Different messages based on time of day
  const getMessage = () => {
    if (completedCount >= 3) {
      return {
        title: "You're Crushing It! 💪",
        subtitle: `${completedCount} actions completed — your venue is dialed in perfectly.`,
        emoji: "🏆",
      };
    }
    if (currentHour >= 19 && currentHour < 23) {
      return {
        title: "Peak Performance! 🔥",
        subtitle: "Everything's optimized for tonight's rush. You got this.",
        emoji: "⚡",
      };
    }
    if (currentHour >= 16 && currentHour < 19) {
      return {
        title: "Ready for Tonight! ✨",
        subtitle: "You're set up for success. Enjoy the calm before the storm.",
        emoji: "🌅",
      };
    }
    if (currentHour >= 23 || currentHour < 2) {
      return {
        title: "Smooth Sailing! 🌙",
        subtitle: "Late night vibes are perfect. Keep the energy flowing.",
        emoji: "✨",
      };
    }
    return {
      title: "All Dialed In! 🎯",
      subtitle: "Your venue is perfectly optimized. No actions needed right now.",
      emoji: "👌",
    };
  };

  const { title, subtitle, emoji } = getMessage();

  return (
    <motion.div
      className="mb-6 relative overflow-hidden rounded-2xl"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
    >
      {/* Animated gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-green-400 via-emerald-500 to-teal-500 opacity-90" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.2),transparent_50%)]" />
      
      {/* Content */}
      <div className="relative p-8">
        <div className="flex flex-col items-center text-center">
          {/* Big emoji with glow effect */}
          <motion.div 
            className="text-6xl mb-4"
            animate={{ 
              scale: [1, 1.1, 1],
              rotate: [0, 5, -5, 0],
            }}
            transition={{ 
              duration: 2, 
              repeat: Infinity, 
              repeatType: "reverse" 
            }}
          >
            {emoji}
          </motion.div>
          
          <h3 className="text-2xl font-bold text-white mb-2 drop-shadow-lg">
            {title}
          </h3>
          <p className="text-white/90 text-lg max-w-xs">
            {subtitle}
          </p>
          
          {/* Stats row */}
          {completedCount > 0 && (
            <motion.div 
              className="mt-6 flex items-center gap-2 px-4 py-2 rounded-full bg-white/20 backdrop-blur-sm"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
            >
              <CheckCircle className="w-4 h-4 text-white" />
              <span className="text-white font-medium">
                {completedCount} action{completedCount > 1 ? 's' : ''} completed
              </span>
            </motion.div>
          )}
          
          {/* Motivational tag */}
          <motion.p 
            className="mt-4 text-sm text-white/70 italic"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
          >
            "The best bars don't just react — they anticipate."
          </motion.p>
        </div>
      </div>
    </motion.div>
  );
}

// ============ HELPER FUNCTIONS ============

function generateActions(context: ActionContext): PulseAction[] {
  const { sensorData, occupancy, currentHour, dayOfWeek, hasUpcomingGames, isHolidayWeek } = context;
  const actions: PulseAction[] = [];
  
  // Determine current time period
  const isPeakHours = currentHour >= TIME_PERIODS.peak.start && currentHour < TIME_PERIODS.peak.end;
  const isPrePeak = currentHour >= TIME_PERIODS.prePeak.start && currentHour < TIME_PERIODS.prePeak.end;
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6;
  
  // Calculate occupancy percentage (use peakOccupancy as rough capacity estimate, or default to 100)
  const estimatedCapacity = occupancy?.peakOccupancy ? Math.max(occupancy.peakOccupancy * 1.2, 50) : 100;
  const occupancyPercent = occupancy?.current !== undefined 
    ? (occupancy.current / estimatedCapacity) * 100 
    : null;
  
  // ============ SOUND ACTIONS ============
  if (sensorData.decibels !== undefined) {
    const db = sensorData.decibels;
    
    if (db > OPTIMAL_RANGES.sound.max) {
      const diff = db - OPTIMAL_RANGES.sound.max;
      
      // Priority escalates based on: how far off + peak hours + packed venue
      let priority: PulseAction['priority'] = 'medium';
      if (diff > 12) priority = 'critical';
      else if (diff > 8 || (diff > 5 && isPeakHours)) priority = 'high';
      else if (diff > 5) priority = 'medium';
      
      // Extra escalation if it's been loud AND packed (hearing damage + guests leaving)
      if (priority !== 'critical' && occupancyPercent && occupancyPercent > OCCUPANCY_THRESHOLDS.packed) {
        priority = priority === 'high' ? 'critical' : 'high';
      }
      
      actions.push({
        id: 'sound-high',
        priority,
        category: 'sound',
        title: diff > 10 ? '🔊 Music is Too Loud' : 'Turn Down the Volume',
        description: diff > 10 
          ? `At ${Math.round(db)} dB, guests can't hear each other. This drives people away.`
          : `Sound is ${Math.round(diff)} dB above the sweet spot. Dial it back a notch.`,
        impact: diff > 10 
          ? 'Reducing noise by 5-10 dB can add 15+ mins to average stay time'
          : 'Comfortable conversation = more rounds ordered',
        currentValue: `${db.toFixed(0)} dB`,
        targetValue: `${OPTIMAL_RANGES.sound.max} dB`,
        icon: Volume2,
      });
    } else if (db < OPTIMAL_RANGES.sound.min) {
      const diff = OPTIMAL_RANGES.sound.min - db;
      
      // Low sound is less critical, but matters more during peak
      let priority: PulseAction['priority'] = diff > 20 ? 'high' : 'medium';
      if (isPeakHours && diff > 10) priority = 'high';
      
      actions.push({
        id: 'sound-low',
        priority,
        category: 'sound',
        title: 'Pump Up the Energy',
        description: isPeakHours 
          ? `It's peak hours but the energy feels flat. Turn up the music to match the vibe.`
          : `A bit quiet in here. Some background music helps fill the space.`,
        impact: 'The right energy level makes guests feel like they are part of something',
        currentValue: `${db.toFixed(0)} dB`,
        targetValue: `${OPTIMAL_RANGES.sound.min} dB`,
        icon: Music,
      });
    }
  }
  
  // ============ LIGHTING ACTIONS ============
  if (sensorData.light !== undefined) {
    const lux = sensorData.light;
    
    if (lux > OPTIMAL_RANGES.light.max) {
      const diff = lux - OPTIMAL_RANGES.light.max;
      // Bright lights are worse during evening/night
      let priority: PulseAction['priority'] = 'medium';
      if (currentHour >= 19 && diff > 100) priority = 'high';
      
      actions.push({
        id: 'light-high',
        priority,
        category: 'light',
        title: 'Dim the Lights',
        description: currentHour >= 19
          ? `Evening vibes need softer lighting. It's brighter than a coffee shop in here.`
          : `Lighting is harsher than optimal. Softer light = more relaxed guests.`,
        impact: 'Dimmer evening lighting increases average tab by 12%',
        currentValue: `${lux.toFixed(0)} lux`,
        targetValue: `${OPTIMAL_RANGES.light.max} lux`,
        icon: Sun,
      });
    } else if (lux < OPTIMAL_RANGES.light.min) {
      actions.push({
        id: 'light-low',
        priority: 'medium',
        category: 'light',
        title: 'Brighten Up a Bit',
        description: `It's a little too dark — guests should be able to read menus and see each other.`,
        impact: 'Proper visibility increases comfort and order frequency',
        currentValue: `${lux.toFixed(0)} lux`,
        targetValue: `${OPTIMAL_RANGES.light.min} lux`,
        icon: Sun,
      });
    }
  }
  
  // ============ TEMPERATURE ACTIONS ============
  if (sensorData.indoorTemp !== undefined) {
    const temp = sensorData.indoorTemp;
    
    if (temp > OPTIMAL_RANGES.temperature.max) {
      const diff = temp - OPTIMAL_RANGES.temperature.max;
      let priority: PulseAction['priority'] = diff > 6 ? 'high' : 'medium';
      // Escalate if packed
      if (occupancyPercent && occupancyPercent > OCCUPANCY_THRESHOLDS.busy) {
        priority = diff > 4 ? 'critical' : 'high';
      }
      
      actions.push({
        id: 'temp-high',
        priority,
        category: 'general',
        title: '🌡️ Cool It Down',
        description: occupancyPercent && occupancyPercent > OCCUPANCY_THRESHOLDS.busy
          ? `It's ${Math.round(temp)}°F and packed. Body heat adds up fast — crank the AC.`
          : `Getting warm at ${Math.round(temp)}°F. Uncomfortable guests leave sooner.`,
        impact: 'Every degree above 74°F reduces average stay by 8 minutes',
        currentValue: `${temp.toFixed(0)}°F`,
        targetValue: `${OPTIMAL_RANGES.temperature.max}°F`,
        icon: Thermometer,
      });
    } else if (temp < OPTIMAL_RANGES.temperature.min) {
      actions.push({
        id: 'temp-low',
        priority: 'medium',
        category: 'general',
        title: 'Warm It Up',
        description: `At ${Math.round(temp)}°F, guests might be reaching for their jackets.`,
        impact: 'Comfortable temperature keeps guests relaxed and ordering',
        currentValue: `${temp.toFixed(0)}°F`,
        targetValue: `${OPTIMAL_RANGES.temperature.min}°F`,
        icon: Thermometer,
      });
    }
  }
  
  // ============ OCCUPANCY-BASED ACTIONS ============
  if (occupancyPercent !== null) {
    // Slow night during peak hours
    if (isPeakHours && occupancyPercent < OCCUPANCY_THRESHOLDS.slow && isWeekend) {
      actions.push({
        id: 'occupancy-slow-weekend',
        priority: 'medium',
        category: 'occupancy',
        title: 'Slow for a Weekend',
        description: `Only ${Math.round(occupancyPercent)}% capacity on a ${dayOfWeek === 5 ? 'Friday' : dayOfWeek === 6 ? 'Saturday' : 'Sunday'}. Consider a social post or text to regulars.`,
        impact: 'A quick promo can turn a slow night around in 30 minutes',
        currentValue: `${Math.round(occupancyPercent)}%`,
        targetValue: `${OCCUPANCY_THRESHOLDS.moderate}%+`,
        icon: Users,
      });
    }
    
    // Getting packed - prep for rush
    if (occupancyPercent >= OCCUPANCY_THRESHOLDS.busy && occupancyPercent < OCCUPANCY_THRESHOLDS.packed) {
      actions.push({
        id: 'occupancy-busy',
        priority: 'low',
        category: 'occupancy',
        title: 'Getting Busy — Stay Sharp',
        description: `${Math.round(occupancyPercent)}% capacity. Make sure bar is stocked, restrooms checked, and staff is heads-up.`,
        impact: 'Prepared teams turn busy nights into record nights',
        icon: Users,
      });
    }
    
    // Packed house
    if (occupancyPercent >= OCCUPANCY_THRESHOLDS.packed) {
      actions.push({
        id: 'occupancy-packed',
        priority: 'high',
        category: 'occupancy',
        title: '🔥 House is Packed!',
        description: `${Math.round(occupancyPercent)}% capacity — great problem to have! Watch the door, keep service fast.`,
        impact: 'Fast service during rushes = higher tips and return visits',
        icon: Users,
      });
    }
  }
  
  // ============ TIME-OF-DAY ACTIONS ============
  
  // Pre-peak prep (4-7pm)
  if (isPrePeak && actions.length < 2) {
    actions.push({
      id: 'timing-prepeak',
      priority: 'low',
      category: 'timing',
      title: '⏰ Pre-Peak Prep Time',
      description: hasUpcomingGames 
        ? 'Game coming up! Check TVs, stock the bar, brief the team.'
        : 'Rush hour approaching. Good time to restock, check bathrooms, and get set.',
      impact: 'Prepared venues handle rushes 40% smoother',
      icon: Clock,
    });
  }
  
  // Game day reminder
  if (hasUpcomingGames && !actions.some(a => a.id.includes('game'))) {
    actions.push({
      id: 'timing-gameday',
      priority: 'high',
      category: 'timing',
      title: '🏈 Game Starting Soon',
      description: 'Expect a rush 30 minutes before kickoff. All TVs on? Sound ready? Staff prepped?',
      impact: 'Game crowds order 2x faster — be ready or lose sales',
      icon: Trophy,
    });
  }
  
  // Holiday week prep
  if (isHolidayWeek && isPrePeak && !actions.some(a => a.id.includes('holiday'))) {
    actions.push({
      id: 'timing-holiday',
      priority: 'low',
      category: 'timing',
      title: '🎉 Holiday Week',
      description: 'Expect higher traffic than usual. Consider extending happy hour or adding staff.',
      impact: 'Holiday weeks drive 25%+ more traffic',
      icon: Calendar,
    });
  }
  
  // ============ SORT BY PRIORITY ============
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

/**
 * Pulse - Main dashboard page
 * 
 * The home screen. Shows:
 * - Pulse Score (hero ring)
 * - Supporting rings (Dwell, Reputation, Crowd)
 * - Streaks, Goals, Insights
 * - Next Action (hero action card)
 * - Context bar (games, holidays)
 * 
 * All details accessed via tap → modal.
 */

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Zap, RefreshCw, FileText } from 'lucide-react';

// Components
import { PulseScoreHero } from '../components/pulse/PulseScoreHero';
import { SupportingRings } from '../components/pulse/SupportingRings';
import { ActionHero } from '../components/pulse/ActionHero';
import { ActionQueue } from '../components/pulse/ActionQueue';
import { ContextBar } from '../components/pulse/ContextBar';
import { LiveStats } from '../components/pulse/LiveStats';
import { StreakBadge } from '../components/pulse/StreakBadge';
import { GoalProgress } from '../components/pulse/GoalProgress';
import { InsightsPanel } from '../components/pulse/InsightsPanel';
import { CelebrationModal, CelebrationType } from '../components/pulse/CelebrationModal';
import { GoalSetterModal } from '../components/pulse/GoalSetterModal';
import { ActionDetailModal } from '../components/pulse/ActionDetailModal';
import { PulseBreakdownModal } from '../components/pulse/PulseBreakdownModal';
import { DwellBreakdownModal } from '../components/pulse/DwellBreakdownModal';
import { ReputationBreakdownModal } from '../components/pulse/ReputationBreakdownModal';
import { CrowdBreakdownModal } from '../components/pulse/CrowdBreakdownModal';
import { LiveStatsModal } from '../components/pulse/LiveStatsModal';
import { NightReportModal } from '../components/pulse/NightReportModal';
import { PulsePageSkeleton } from '../components/common/LoadingState';

// Hooks & Services
import { usePulseData } from '../hooks/usePulseData';
import { useActions } from '../hooks/useActions';
import sportsService from '../services/sports.service';
import holidayService from '../services/holiday.service';
import authService from '../services/auth.service';
import achievementsService, { Streak, WeeklyGoal, Insight } from '../services/achievements.service';
import staffService from '../services/staff.service';
import { pulseStore } from '../stores/pulseStore';
import type { SportsGame } from '../types';

// New components
import { PullToRefresh } from '../components/common/PullToRefresh';
import { NoDataState, OfflineState, ErrorState } from '../components/common/LoadingState';
import { haptic } from '../utils/haptics';

// ============ MODAL TYPES ============

type ModalType = 'pulse' | 'dwell' | 'reputation' | 'crowd' | 'action' | 'livestats' | null;

interface CelebrationState {
  isOpen: boolean;
  type: CelebrationType;
  title: string;
  subtitle: string;
  value: string | number;
  previousValue?: string | number;
  detail?: string;
}

// ============ MAIN COMPONENT ============

export function Pulse() {
  const user = authService.getStoredUser();
  const venueName = user?.venueName || 'Your Venue';
  const venueId = user?.venueId || '';
  
  // Modal state
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [showGoalSetter, setShowGoalSetter] = useState(false);
  const [showNightReport, setShowNightReport] = useState(false);
  
  // Celebration state
  const [celebration, setCelebration] = useState<CelebrationState>({
    isOpen: false,
    type: 'record',
    title: '',
    subtitle: '',
    value: '',
  });
  
  // Achievement data
  const [streak, setStreak] = useState<Streak>(achievementsService.getStreak());
  const [weeklyGoal, setWeeklyGoal] = useState<WeeklyGoal | null>(achievementsService.getWeeklyGoal());
  const [insights, setInsights] = useState<Insight[]>([]);
  
  // External data
  const [todayGames, setTodayGames] = useState<SportsGame[]>([]);
  
  // Fetch all pulse data
  const pulseData = usePulseData({ enabled: true });
  
  // Generate actions based on current data
  const {
    heroAction,
    remainingActions,
    completedCount,
    completeAction,
  } = useActions({
    currentDecibels: pulseData.currentDecibels,
    currentLight: pulseData.currentLight,
    occupancy: pulseData.occupancyMetrics,
    hasUpcomingGames: todayGames.length > 0,
  });
  
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
  
  // Generate insights
  useEffect(() => {
    const generatedInsights = achievementsService.generateInsights();
    setInsights(generatedInsights);
  }, []);
  
  // Share pulse score with header via store
  useEffect(() => {
    pulseStore.setScore(pulseData.pulseScore);
  }, [pulseData.pulseScore]);
  
  // Track achievements when pulse score changes
  const checkAchievements = useCallback(() => {
    if (pulseData.pulseScore === null) return;
    
    // Check for new record
    const recordResult = achievementsService.checkAndUpdateRecord(
      'best-pulse',
      'Best Pulse Score',
      pulseData.pulseScore,
      ''
    );
    
    if (recordResult?.isNew && recordResult.improvement) {
      setCelebration({
        isOpen: true,
        type: 'record',
        title: 'Best Pulse Score!',
        subtitle: 'You just set a new personal record',
        value: recordResult.record.value,
        previousValue: recordResult.record.previousValue,
        detail: `+${recordResult.improvement} points improvement`,
      });
    }
    
    // Check occupancy record
    if (pulseData.currentOccupancy > 0) {
      const occupancyRecord = achievementsService.checkAndUpdateRecord(
        'best-occupancy',
        'Busiest Night',
        pulseData.currentOccupancy,
        ' guests'
      );
      
      if (occupancyRecord?.isNew && occupancyRecord.improvement && occupancyRecord.improvement > 5) {
        setCelebration({
          isOpen: true,
          type: 'record',
          title: 'Busiest Night Ever!',
          subtitle: 'New occupancy record',
          value: `${occupancyRecord.record.value} guests`,
          previousValue: occupancyRecord.record.previousValue ? `${occupancyRecord.record.previousValue} guests` : undefined,
        });
      }
    }
    
    // Update streak
    const streakResult = achievementsService.updateStreak(pulseData.pulseScore);
    setStreak(achievementsService.getStreak());
    
    if (streakResult.newMilestone) {
      setCelebration({
        isOpen: true,
        type: 'streak',
        title: `${streakResult.newMilestone}-Night Streak!`,
        subtitle: `Above ${streak.threshold} Pulse Score`,
        value: `🔥 ${streakResult.newMilestone}`,
        detail: 'Keep the momentum going!',
      });
    }
    
    // Update weekly goal
    const goalResult = achievementsService.recordDailyScore(pulseData.pulseScore);
    setWeeklyGoal(achievementsService.getWeeklyGoal());
    
    if (goalResult.goalAchieved) {
      const goal = achievementsService.getWeeklyGoal();
      setCelebration({
        isOpen: true,
        type: 'goal',
        title: 'Weekly Goal Achieved!',
        subtitle: `You hit your target of ${goal?.target}`,
        value: `${goal?.currentAvg} avg`,
        detail: `${goal?.daysTracked} days tracked this week`,
      });
    }
    
    // Record for staff tracking
    if (pulseData.pulseScore > 0) {
      staffService.recordPulseScore(pulseData.pulseScore, pulseData.currentOccupancy);
    }
  }, [pulseData.pulseScore, pulseData.currentOccupancy, streak.threshold]);
  
  // Check achievements periodically (not on every render)
  useEffect(() => {
    if (pulseData.pulseScore !== null) {
      checkAchievements();
    }
  }, [pulseData.pulseScore]); // Only when score changes
  
  // Handle setting a new goal
  const handleSetGoal = (target: number) => {
    achievementsService.setWeeklyGoalTarget(target);
    setWeeklyGoal(achievementsService.getWeeklyGoal());
  };
  
  // Holiday data
  const upcomingHolidays = holidayService.getUpcomingHolidays(7);
  const nextHoliday = upcomingHolidays[0];
  const holidayData = nextHoliday ? {
    name: nextHoliday.name,
    daysUntil: holidayService.getDaysUntil(nextHoliday),
  } : null;
  
  // Calculate occupancy score (for ring display)
  const estimatedCapacity = pulseData.peakOccupancy 
    ? Math.max(pulseData.peakOccupancy * 1.2, 50) 
    : 100;
  const occupancyScore = Math.min(100, Math.round((pulseData.currentOccupancy / estimatedCapacity) * 100));
  
  // ============ HANDLERS ============
  
  const handleActionComplete = (actionId?: string) => {
    haptic('success');
    if (actionId) {
      completeAction(actionId);
    } else if (heroAction) {
      completeAction(heroAction.id);
    }
    setActiveModal(null);
  };
  
  // Pull to refresh handler
  const handleRefresh = async () => {
    haptic('medium');
    await pulseData.refresh();
  };
  
  // ============ LOADING STATE ============
  
  if (pulseData.loading && !pulseData.sensorData) {
    return <PulsePageSkeleton />;
  }
  
  // ============ ERROR STATE ============
  
  if (pulseData.error && !pulseData.sensorData) {
    return (
      <div className="space-y-6">
        <motion.div
          className="flex items-center gap-2"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Zap className="w-6 h-6 text-primary" />
          <h1 className="text-xl font-bold text-warm-800 dark:text-warm-100">Pulse</h1>
        </motion.div>
        <ErrorState 
          title="Couldn't load venue data"
          message={pulseData.error}
          onRetry={() => pulseData.refresh()}
        />
      </div>
    );
  }
  
  // ============ RENDER ============
  
  return (
    <PullToRefresh onRefresh={handleRefresh} disabled={pulseData.loading}>
      <div className="space-y-6">
        {/* Header */}
        <motion.div
          className="flex items-center justify-between"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="flex items-center gap-2">
            <Zap className="w-6 h-6 text-primary" />
            <h1 className="text-xl font-bold text-warm-800 dark:text-warm-100">Pulse</h1>
          </div>
          <div className="flex items-center gap-2">
            <motion.button
              onClick={() => { haptic('light'); setShowNightReport(true); }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary/10 dark:bg-primary/20 text-primary text-sm font-medium hover:bg-primary/20 dark:hover:bg-primary/30 transition-colors"
              whileTap={{ scale: 0.95 }}
            >
              <FileText className="w-4 h-4" />
              <span className="hidden sm:inline">Report</span>
            </motion.button>
            <motion.button
              onClick={() => { haptic('light'); pulseData.refresh(); }}
              disabled={pulseData.loading}
              className="p-2 rounded-xl bg-warm-100 dark:bg-warm-800 hover:bg-warm-200 dark:hover:bg-warm-700 transition-colors"
              whileTap={{ scale: 0.95 }}
            >
              <RefreshCw className={`w-5 h-5 text-warm-600 dark:text-warm-400 ${pulseData.loading ? 'animate-spin' : ''}`} />
            </motion.button>
          </div>
        </motion.div>
      
      {/* Offline Warning */}
      {!pulseData.isConnected && pulseData.sensorData && (
        <OfflineState lastUpdated={pulseData.lastUpdated} />
      )}
      
      {/* Live Stats - Eagle's Eye View */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <LiveStats
          decibels={pulseData.currentDecibels}
          light={pulseData.currentLight}
          occupancy={pulseData.currentOccupancy}
          currentSong={pulseData.sensorData?.currentSong}
          artist={pulseData.sensorData?.artist}
          albumArt={pulseData.sensorData?.albumArt}
          lastUpdated={pulseData.lastUpdated}
          onTap={() => setActiveModal('livestats')}
        />
      </motion.div>
      
      {/* Pulse Score Hero */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.15 }}
      >
        <PulseScoreHero
          score={pulseData.pulseScore}
          statusLabel={pulseData.pulseStatusLabel}
          onTap={() => setActiveModal('pulse')}
        />
      </motion.div>
      
      {/* Supporting Rings */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <SupportingRings
          dwellTimeFormatted={pulseData.dwellTimeFormatted}
          dwellScore={pulseData.dwellScore}
          onDwellTap={() => setActiveModal('dwell')}
          rating={pulseData.reviews?.rating ?? null}
          reputationScore={pulseData.reputationScore}
          onReputationTap={() => setActiveModal('reputation')}
          currentOccupancy={pulseData.currentOccupancy}
          occupancyScore={occupancyScore}
          onCrowdTap={() => setActiveModal('crowd')}
        />
      </motion.div>
      
      {/* Streak + Goal Row */}
      <motion.div
        className="grid grid-cols-1 sm:grid-cols-2 gap-3"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
      >
        <StreakBadge streak={streak} />
        <GoalProgress 
          goal={weeklyGoal} 
          onSetGoal={() => setShowGoalSetter(true)} 
        />
      </motion.div>
      
      {/* Insights */}
      {insights.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.28 }}
        >
          <InsightsPanel insights={insights} />
        </motion.div>
      )}
      
      {/* Action Hero */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        <ActionHero
          action={heroAction}
          onSeeWhy={() => setActiveModal('action')}
          onComplete={() => handleActionComplete()}
          completedCount={completedCount}
        />
      </motion.div>
      
      {/* Action Queue */}
      {remainingActions.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <ActionQueue
            actions={remainingActions}
            onComplete={handleActionComplete}
          />
        </motion.div>
      )}
      
      {/* Context Bar */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
      >
        <ContextBar
          games={todayGames}
          nextHoliday={holidayData}
          weather={pulseData.weather ? {
            temp: pulseData.weather.temperature,
            icon: pulseData.weather.icon,
          } : null}
        />
      </motion.div>
      
      {/* ============ MODALS ============ */}
      
      {/* Pulse Breakdown */}
      <PulseBreakdownModal
        isOpen={activeModal === 'pulse'}
        onClose={() => setActiveModal(null)}
        pulseScore={pulseData.pulseScore}
        pulseStatusLabel={pulseData.pulseStatusLabel}
        soundScore={pulseData.soundScore}
        lightScore={pulseData.lightScore}
        currentDecibels={pulseData.currentDecibels}
        currentLight={pulseData.currentLight}
      />
      
      {/* Dwell Breakdown */}
      <DwellBreakdownModal
        isOpen={activeModal === 'dwell'}
        onClose={() => setActiveModal(null)}
        dwellTimeMinutes={pulseData.dwellTimeMinutes}
      />
      
      {/* Reputation Breakdown */}
      <ReputationBreakdownModal
        isOpen={activeModal === 'reputation'}
        onClose={() => setActiveModal(null)}
        reviews={pulseData.reviews}
        venueName={venueName}
      />
      
      {/* Crowd Breakdown */}
      <CrowdBreakdownModal
        isOpen={activeModal === 'crowd'}
        onClose={() => setActiveModal(null)}
        currentOccupancy={pulseData.currentOccupancy}
        todayEntries={pulseData.todayEntries}
        todayExits={pulseData.todayExits}
        peakOccupancy={pulseData.peakOccupancy}
        peakTime={pulseData.peakTime}
      />
      
      {/* Action Detail */}
      <ActionDetailModal
        isOpen={activeModal === 'action'}
        onClose={() => setActiveModal(null)}
        action={heroAction}
        onComplete={() => handleActionComplete()}
      />
      
      {/* Goal Setter */}
      <GoalSetterModal
        isOpen={showGoalSetter}
        onClose={() => setShowGoalSetter(false)}
        onSetGoal={handleSetGoal}
        currentTarget={weeklyGoal?.target}
      />
      
      {/* Celebration */}
      <CelebrationModal
        isOpen={celebration.isOpen}
        onClose={() => setCelebration(prev => ({ ...prev, isOpen: false }))}
        type={celebration.type}
        title={celebration.title}
        subtitle={celebration.subtitle}
        value={celebration.value}
        previousValue={celebration.previousValue}
        detail={celebration.detail}
      />
      
      {/* Live Stats Detail */}
      <LiveStatsModal
        isOpen={activeModal === 'livestats'}
        onClose={() => setActiveModal(null)}
        decibels={pulseData.currentDecibels}
        light={pulseData.currentLight}
        outdoorTemp={pulseData.weather?.temperature ?? null}
        currentOccupancy={pulseData.currentOccupancy}
        todayEntries={pulseData.todayEntries}
        todayExits={pulseData.todayExits}
        peakOccupancy={pulseData.peakOccupancy}
        currentSong={pulseData.sensorData?.currentSong ?? null}
        artist={pulseData.sensorData?.artist ?? null}
        albumArt={pulseData.sensorData?.albumArt ?? null}
        reviews={pulseData.reviews}
        lastUpdated={pulseData.lastUpdated}
      />
      
      {/* Night Report */}
      <NightReportModal
        isOpen={showNightReport}
        onClose={() => setShowNightReport(false)}
        venueName={venueName}
        venueId={venueId}
      />
      </div>
    </PullToRefresh>
  );
}

export default Pulse;

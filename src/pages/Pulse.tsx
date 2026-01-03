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
import { Zap } from 'lucide-react';

// Components
import { PulseScoreHero } from '../components/pulse/PulseScoreHero';
import { SupportingRings } from '../components/pulse/SupportingRings';
import { LiveStats } from '../components/pulse/LiveStats';
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

// Phase A: Simplified components
import { SmartHeader } from '../components/pulse/SmartHeader';
import { AchievementRow } from '../components/pulse/AchievementRow';

// Revenue-focused components (Launch Ready)
import { RevenueHero } from '../components/pulse/RevenueHero';
import { TonightsPlaybook } from '../components/pulse/TonightsPlaybook';
import { VenueRanking } from '../components/pulse/VenueRanking';

// Hooks & Services
import { usePulseData } from '../hooks/usePulseData';
import { useActions } from '../hooks/useActions';
import { useIntelligence } from '../hooks/useIntelligence';
import sportsService from '../services/sports.service';
import authService from '../services/auth.service';
import achievementsService, { Streak, WeeklyGoal } from '../services/achievements.service';
import staffService from '../services/staff.service';
import { pulseStore } from '../stores/pulseStore';
import type { SportsGame } from '../types';

// Intelligence Components
import { TrendAlerts } from '../components/pulse/TrendAlerts';
import { FloatingActions } from '../components/pulse/FloatingActions';

// Common components
import { PullToRefresh } from '../components/common/PullToRefresh';
import { OfflineState, ErrorState } from '../components/common/LoadingState';
import { CollapsibleSection } from '../components/common/CollapsibleSection';
import { haptic } from '../utils/haptics';

// Phase C: Smart defaults
import { useSectionVisibility } from '../hooks/useSectionVisibility';

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
  
  // External data
  const [todayGames, setTodayGames] = useState<SportsGame[]>([]);
  
  // Fetch all pulse data
  const pulseData = usePulseData({ enabled: true });
  
  // Intelligence - AI-powered insights
  const intelligence = useIntelligence({
    enabled: true,
    currentData: pulseData.sensorData || undefined,
    weather: pulseData.weather,
  });
  
  // Generate actions based on current data
  const {
    heroAction,
    completeAction,
  } = useActions({
    currentDecibels: pulseData.currentDecibels,
    currentLight: pulseData.currentLight,
    occupancy: pulseData.occupancyMetrics,
    hasUpcomingGames: todayGames.length > 0,
  });
  
  // Section visibility (Phase C: Smart defaults)
  const sections = useSectionVisibility();
  
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
          <h1 className="text-xl font-bold text-warm-100">Pulse</h1>
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
      <div className="space-y-5">
        {/* Smart Header - Greeting + Peak + Weather + Mode */}
        <SmartHeader
          briefing={intelligence.dailyBriefing}
          peakPrediction={intelligence.peakPrediction}
          weather={pulseData.weather ? {
            temperature: pulseData.weather.temperature,
            icon: pulseData.weather.icon,
          } : null}
          mode={sections.mode}
        />
      
      {/* Offline Warning */}
      {!pulseData.isConnected && pulseData.sensorData && (
        <OfflineState lastUpdated={pulseData.lastUpdated} />
      )}
      
      {/* Trend Alerts - Always visible, can dismiss individually */}
      {intelligence.trendAlerts.length > 0 && (
        <TrendAlerts
          alerts={intelligence.trendAlerts}
          onDismiss={intelligence.dismissAlert}
        />
      )}
      
      {/* Live Stats - Collapsible */}
      <CollapsibleSection
        id="livestats"
        title="Live Stats"
        collapsed={sections.isCollapsed('livestats')}
        onToggle={() => sections.toggle('livestats')}
        showHeader={false}
      >
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
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
      </CollapsibleSection>
      
      {/* Revenue Hero - THE MONEY MOMENT */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.1 }}
      >
        <RevenueHero
          currentOccupancy={pulseData.currentOccupancy}
          dwellTimeMinutes={pulseData.dwellTimeMinutes || 45}
          pulseScore={pulseData.pulseScore ?? 0}
          todayEntries={pulseData.todayEntries || 0}
          todayExits={pulseData.todayExits || 0}
          onTap={() => setActiveModal('pulse')}
        />
      </motion.div>
      
      {/* Venue Ranking - Competitive Edge */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12 }}
      >
        <VenueRanking
          pulseScore={pulseData.pulseScore ?? 0}
          currentOccupancy={pulseData.currentOccupancy || 0}
          city={user?.venueName?.split(' ')[0] || 'Your City'}
        />
      </motion.div>
      
      {/* Tonight's Playbook - Clear Actions */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
      >
        <TonightsPlaybook
          currentDecibels={pulseData.currentDecibels ?? 65}
          currentLight={pulseData.currentLight ?? 50}
          currentOccupancy={pulseData.currentOccupancy ?? 0}
          peakPrediction={intelligence.peakPrediction ? {
            hour: `${intelligence.peakPrediction.predictedPeakHour}:00`,
            expectedOccupancy: intelligence.peakPrediction.predictedPeakOccupancy,
            minutesUntil: Math.max(0, (intelligence.peakPrediction.predictedPeakHour - new Date().getHours()) * 60 - new Date().getMinutes()),
          } : undefined}
          smartActions={intelligence.smartActions.map(a => ({
            id: a.id,
            title: a.title,
            description: a.description,
            priority: a.priority === 'critical' ? 'high' : a.priority,
          }))}
        />
      </motion.div>
      
      {/* Original Pulse Score Hero - Now Secondary */}
      <CollapsibleSection
        id="pulse-details"
        title="Pulse Score Details"
        collapsed={sections.isCollapsed('rings')}
        onToggle={() => sections.toggle('rings')}
        showHeader={true}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
        >
          <PulseScoreHero
            score={pulseData.pulseScore}
            statusLabel={pulseData.pulseStatusLabel}
            onTap={() => setActiveModal('pulse')}
          />
        </motion.div>
      </CollapsibleSection>
      
      {/* Supporting Rings - Collapsible */}
      <CollapsibleSection
        id="rings"
        title="Details"
        collapsed={sections.isCollapsed('rings')}
        onToggle={() => sections.toggle('rings')}
        showHeader={false}
      >
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
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
      </CollapsibleSection>
      
      {/* Achievements - Collapsible */}
      <CollapsibleSection
        id="achievements"
        title="Achievements"
        collapsed={sections.isCollapsed('achievements')}
        onToggle={() => sections.toggle('achievements')}
        showHeader={false}
      >
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
        >
          <AchievementRow
            streak={streak}
            goal={weeklyGoal}
            onSetGoal={() => setShowGoalSetter(true)}
          />
        </motion.div>
      </CollapsibleSection>
      
      
      {/* Floating Action Button */}
      <FloatingActions
        onReport={() => { haptic('medium'); setShowNightReport(true); }}
        onRefresh={() => { haptic('medium'); pulseData.refresh(); }}
        isRefreshing={pulseData.loading}
      />
      
      {/* ============ MODALS ============ */}
      
      {/* Pulse Breakdown */}
      <PulseBreakdownModal
        isOpen={activeModal === 'pulse'}
        onClose={() => setActiveModal(null)}
        pulseScore={pulseData.pulseScore}
        pulseStatusLabel={pulseData.pulseStatusLabel}
        soundScore={pulseData.soundScore}
        lightScore={pulseData.lightScore}
        tempScore={pulseData.tempScore}
        genreScore={pulseData.genreScore}
        vibeScore={pulseData.vibeScore}
        currentDecibels={pulseData.currentDecibels}
        currentLight={pulseData.currentLight}
        indoorTemp={pulseData.sensorData?.indoorTemp}
        outdoorTemp={pulseData.weather?.temperature}
        currentSong={pulseData.sensorData?.currentSong}
        timeSlot={pulseData.timeSlot}
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

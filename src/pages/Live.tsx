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

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Zap, CheckCircle2, Circle, X, AlertTriangle, Wifi } from 'lucide-react';

// Components
import { PulseScoreHero } from '../components/pulse/PulseScoreHero';
import { SupportingRings } from '../components/pulse/SupportingRings';
import { LiveStats } from '../components/pulse/LiveStats';
import { DailyContext } from '../components/pulse/DailyContext';
import { CelebrationModal, CelebrationType } from '../components/pulse/CelebrationModal';
import { ActionDetailModal } from '../components/pulse/ActionDetailModal';
import { PulseBreakdownModal } from '../components/pulse/PulseBreakdownModal';
import { DwellBreakdownModal } from '../components/pulse/DwellBreakdownModal';
import { ReputationBreakdownModal } from '../components/pulse/ReputationBreakdownModal';
import { CrowdBreakdownModal } from '../components/pulse/CrowdBreakdownModal';
import { LiveStatsModal } from '../components/pulse/LiveStatsModal';
import { NightReportModal } from '../components/pulse/NightReportModal';
import { PulsePageSkeleton } from '../components/common/LoadingState';


// Revenue-focused components (Launch Ready)
import { TonightsPlaybook } from '../components/pulse/TonightsPlaybook';
import { TodaysOutlook } from '../components/pulse/TodaysOutlook';
import { LearningProgress } from '../components/pulse/LearningProgress';
import { RetentionMetrics } from '../components/pulse/RetentionMetrics';

// Hooks & Services
import { usePulseData } from '../hooks/usePulseData';
import { useActions } from '../hooks/useActions';
import { useIntelligence } from '../hooks/useIntelligence';
import { useVenueLearning } from '../hooks/useVenueLearning';
import { useDisplayName } from '../hooks/useDisplayName';
import sportsService from '../services/sports.service';
import authService from '../services/auth.service';
import staffService from '../services/staff.service';
import { pulseStore } from '../stores/pulseStore';
import type { SportsGame } from '../types';

// Common components
import { PullToRefresh } from '../components/common/PullToRefresh';
import { OfflineState } from '../components/common/LoadingState';
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

export function Live() {
  const user = authService.getStoredUser();
  const venueId = user?.venueId || '';
  
  // Use display name (custom name if set by admin, otherwise venueId/venueName)
  const { displayName } = useDisplayName();
  const venueName = displayName || user?.venueName || 'Your Venue';
  
  // Modal state
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [showNightReport, setShowNightReport] = useState(false);

  // Setup guide dismiss state (resets each session)
  const [setupDismissed, setSetupDismissed] = useState(
    () => sessionStorage.getItem('setup_guide_dismissed') === '1'
  );
  
  // Celebration state
  const [celebration, setCelebration] = useState<CelebrationState>({
    isOpen: false,
    type: 'record',
    title: '',
    subtitle: '',
    value: '',
  });
  
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
  
  // Venue learning - personalized scoring based on historical data
  const venueLearning = useVenueLearning();
  
  // Generate actions based on current data
  const {
    heroAction,
    completeAction,
  } = useActions({
    currentDecibels: pulseData.currentDecibels,
    currentLight: pulseData.currentLight,
    occupancy: pulseData.occupancyMetrics,
    hasUpcomingGames: todayGames.length > 0,
    totalDrinks: pulseData.totalDrinks,
    drinksPerHour: pulseData.drinksPerHour,
    hasTheftFlag: pulseData.hasTheftFlag,
    retentionRate: pulseData.retentionMetrics.retentionRate,
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
  
  // Share pulse score, weather, and connection status with header via store
  useEffect(() => {
    pulseStore.setScore(pulseData.pulseScore);
  }, [pulseData.pulseScore]);
  
  useEffect(() => {
    if (pulseData.weather) {
      pulseStore.setWeather({
        temperature: pulseData.weather.temperature,
        icon: pulseData.weather.icon,
      });
    }
  }, [pulseData.weather]);
  
  useEffect(() => {
    pulseStore.setConnectionStatus({
      isConnected: pulseData.isConnected,
      lastUpdated: pulseData.lastUpdated,
      dataAgeSeconds: pulseData.dataAgeSeconds,
    });
  }, [pulseData.isConnected, pulseData.lastUpdated, pulseData.dataAgeSeconds]);
  
  // Record for staff tracking
  useEffect(() => {
    if (pulseData.pulseScore !== null && pulseData.pulseScore > 0) {
      staffService.recordPulseScore(pulseData.pulseScore, pulseData.currentOccupancy);
    }
  }, [pulseData.pulseScore, pulseData.currentOccupancy]);
  
  // Crowd ring now shows retention rate (% of tonight's guests still here)
  // This is 100% accurate from raw entry/exit data
  const crowdScore = pulseData.retentionMetrics.retentionRate;

  // ── Pulse score context sentence ──────────────────────────────────────────
  const now = new Date();
  const dayName = now.toLocaleDateString('en-US', { weekday: 'long' });
  const hourLabel = now.toLocaleString('en-US', { hour: 'numeric', hour12: true }).toLowerCase();
  const isWeekendPeak = (now.getDay() === 5 || now.getDay() === 6) && now.getHours() >= 20;

  const pulseContextSentence = (() => {
    const score = pulseData.pulseScore;
    if (score === null) return undefined;
    const prox = pulseData.proximityToBest;
    const best = pulseData.bestNight;
    if (pulseData.isUsingHistoricalData && best && prox !== null) {
      if (prox >= 90) return `On track to match your best ${best.dayOfWeek ?? dayName}.`;
      if (prox >= 70) return `Close to your best ${best.dayOfWeek ?? dayName} — keep it going.`;
      if (prox < 50)  return `Quieter than your usual ${dayName} at this hour.`;
    }
    if (score >= 80 && isWeekendPeak) return `Strong ${dayName} night so far.`;
    if (score < 50 && now.getHours() >= 20) return `Below where you want to be for ${hourLabel} on a ${dayName}.`;
    return undefined;
  })();

  // ── Context for playbook ──────────────────────────────────────────────────
  const historicalDrop = pulseData.proximityToBest !== null
    ? Math.round(100 - pulseData.proximityToBest)
    : null;
  
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
  
  
  // ============ RENDER ============
  
  return (
    <PullToRefresh onRefresh={handleRefresh} disabled={pulseData.loading}>
      <div className="space-y-5">

      {/* ── Alert banners ── */}
      {pulseData.hasTheftFlag && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-start gap-3 px-4 py-3 bg-red-500/15 border border-red-500/30 rounded-2xl"
        >
          <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-red-300">Theft flag detected</p>
            <p className="text-xs text-red-400/80 mt-0.5">VenueScope flagged unrung drinks in a recent shift. Check the VenueScope tab to review.</p>
          </div>
        </motion.div>
      )}

      {!pulseData.isConnected && pulseData.sensorData !== null && pulseData.dataAgeSeconds > 300 && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-start gap-3 px-4 py-3 bg-amber-500/15 border border-amber-500/30 rounded-2xl"
        >
          <Wifi className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-300">Sensor offline</p>
            <p className="text-xs text-amber-400/80 mt-0.5">Last data received {Math.round(pulseData.dataAgeSeconds / 60)} min ago. Check your device connection.</p>
          </div>
        </motion.div>
      )}

      {/* ── Setup guide ── */}
      {!setupDismissed && (() => {
        const hasSensor  = !!pulseData.sensorData;
        const hasVS      = pulseData.hasVenueScopeData;
        const hasReviews = !!pulseData.reviews;
        if (hasSensor && hasVS && hasReviews) return null;
        return (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-warm-800 border border-warm-700 rounded-2xl p-4"
          >
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-white">Getting started</p>
              <button
                onClick={() => { setSetupDismissed(true); sessionStorage.setItem('setup_guide_dismissed', '1'); }}
                className="text-warm-500 hover:text-warm-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2">
              {[
                { done: hasSensor,  label: 'Sensor device connected',     sub: 'Live sound, light, and occupancy data' },
                { done: hasVS,      label: 'VenueScope job processed',     sub: 'CCTV-based drink counting and theft detection' },
                { done: hasReviews, label: 'Google Reviews linked',        sub: 'Reputation score and review tracking' },
              ].map(({ done, label, sub }) => (
                <div key={label} className="flex items-start gap-3">
                  {done
                    ? <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                    : <Circle className="w-4 h-4 text-warm-600 mt-0.5 flex-shrink-0" />
                  }
                  <div>
                    <p className={`text-sm font-medium ${done ? 'text-warm-400 line-through' : 'text-white'}`}>{label}</p>
                    {!done && <p className="text-xs text-warm-500 mt-0.5">{sub}</p>}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        );
      })()}

      {/* Daily Context + Learning Indicator */}
      <div className="flex items-start justify-between gap-3">
        <DailyContext 
          weather={pulseData.weather}
          peakPrediction={intelligence.peakPrediction ? {
            hour: `${intelligence.peakPrediction.predictedPeakHour}:00`,
            expectedOccupancy: intelligence.peakPrediction.predictedPeakOccupancy,
            minutesUntil: Math.max(0, (intelligence.peakPrediction.predictedPeakHour - new Date().getHours()) * 60 - new Date().getMinutes()),
          } : undefined}
        />
        <LearningProgress
          learningProgress={venueLearning.learningProgress}
          status={venueLearning.status}
          patterns={venueLearning.patterns}
          weeksOfData={venueLearning.learning?.weeksOfData || 0}
          isAnalyzing={venueLearning.isAnalyzing}
        />
      </div>

      {/* Pulse Score Hero - Always at top */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
      >
        <PulseScoreHero
          score={pulseData.pulseScore}
          statusLabel={pulseData.pulseStatusLabel}
          onTap={() => setActiveModal('pulse')}
          contextSentence={pulseContextSentence}
        />
      </motion.div>
      
      {/* Quick Actions - Right below Pulse Score */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
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
          venuePatterns={venueLearning.patterns.map(p => ({
            factor: p.factor,
            impact: p.impact,
            confidence: p.confidence,
          }))}
          totalDrinks={pulseData.totalDrinks}
          drinksPerHour={pulseData.drinksPerHour}
          hasTheftFlag={pulseData.hasTheftFlag}
          retentionRate={pulseData.retentionMetrics.retentionRate}
          pulseScore={pulseData.pulseScore}
          dayOfWeek={dayName}
          currentHourLabel={hourLabel}
          historicalDrop={historicalDrop}
        />
      </motion.div>
      
      {/* Offline Warning */}
      {!pulseData.isConnected && pulseData.sensorData && (
        <OfflineState lastUpdated={pulseData.lastUpdated} />
      )}
      
      {/* Owner's Live View */}
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
          totalDrinks={pulseData.totalDrinks}
          drinksPerHour={pulseData.drinksPerHour}
        />
      </motion.div>
      
      {/* Guest Retention Metrics - moved to Results tab for all accounts */}
      
      {/* MY DAY Section Divider */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.12 }}
        className="pt-2"
      >
        <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-whoop">
          My Day
        </h2>
        <div className="mt-2 border-b border-whoop-divider" />
      </motion.div>
      
      {/* Today's Outlook - Holidays, Games, Weather */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
      >
        <TodaysOutlook
          weather={pulseData.weather}
          todayGames={todayGames}
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
        crowdScore={pulseData.crowdScore}
        musicScore={pulseData.musicScore}
        currentDecibels={pulseData.currentDecibels}
        currentLight={pulseData.currentLight}
        currentOccupancy={pulseData.currentOccupancy}
        estimatedCapacity={pulseData.estimatedCapacity}
        currentSong={pulseData.sensorData?.currentSong}
        detectedGenres={pulseData.detectedGenres}
        timeSlot={pulseData.timeSlot}
        bestNight={pulseData.bestNight}
        isUsingHistoricalData={pulseData.isUsingHistoricalData}
        proximityToBest={pulseData.proximityToBest}
        activityScore={pulseData.activityScore ?? undefined}
        retentionScore={pulseData.retentionScore ?? undefined}
        totalDrinks={pulseData.totalDrinks}
        drinksPerHour={pulseData.drinksPerHour}
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
        isBLEEstimated={pulseData.isBLEEstimated}
        totalDevices={pulseData.totalDevices}
        deviceBreakdown={pulseData.deviceBreakdown}
        bleDwellTime={pulseData.bleDwellTime}
        longestVisitorMinutes={pulseData.longestVisitorMinutes}
        totalVisitsTracked={pulseData.totalVisitsTracked}
      />
      
      {/* Action Detail */}
      <ActionDetailModal
        isOpen={activeModal === 'action'}
        onClose={() => setActiveModal(null)}
        action={heroAction}
        onComplete={() => handleActionComplete()}
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
        isBLEEstimated={pulseData.isBLEEstimated}
        totalDevices={pulseData.totalDevices}
        deviceBreakdown={pulseData.deviceBreakdown}
        bleDwellTime={pulseData.bleDwellTime}
        longestVisitorMinutes={pulseData.longestVisitorMinutes}
        totalVisitsTracked={pulseData.totalVisitsTracked}
        totalDrinks={pulseData.totalDrinks}
        drinksPerHour={pulseData.drinksPerHour}
        topBartender={null}
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

export default Live;

/**
 * Pulse - Main dashboard page
 * 
 * The home screen. Shows:
 * - Pulse Score (hero ring)
 * - Supporting rings (Dwell, Reputation, Crowd)
 * - Next Action (hero action card)
 * - Context bar (games, holidays)
 * 
 * All details accessed via tap → modal.
 */

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Zap, RefreshCw } from 'lucide-react';

// Components
import { PulseScoreHero } from '../components/pulse/PulseScoreHero';
import { SupportingRings } from '../components/pulse/SupportingRings';
import { ActionHero } from '../components/pulse/ActionHero';
import { ActionQueue } from '../components/pulse/ActionQueue';
import { ContextBar } from '../components/pulse/ContextBar';
import { LiveStats } from '../components/pulse/LiveStats';
import { ActionDetailModal } from '../components/pulse/ActionDetailModal';
import { PulseBreakdownModal } from '../components/pulse/PulseBreakdownModal';
import { DwellBreakdownModal } from '../components/pulse/DwellBreakdownModal';
import { ReputationBreakdownModal } from '../components/pulse/ReputationBreakdownModal';
import { CrowdBreakdownModal } from '../components/pulse/CrowdBreakdownModal';
import { PulsePageSkeleton } from '../components/common/LoadingState';

// Hooks & Services
import { usePulseData } from '../hooks/usePulseData';
import { useActions } from '../hooks/useActions';
import sportsService from '../services/sports.service';
import holidayService from '../services/holiday.service';
import authService from '../services/auth.service';
import type { SportsGame } from '../types';

// ============ MODAL TYPES ============

type ModalType = 'pulse' | 'dwell' | 'reputation' | 'crowd' | 'action' | null;

// ============ MAIN COMPONENT ============

export function Pulse() {
  const user = authService.getStoredUser();
  const venueName = user?.venueName || 'Your Venue';
  
  // Modal state
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  
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
    if (actionId) {
      completeAction(actionId);
    } else if (heroAction) {
      completeAction(heroAction.id);
    }
    setActiveModal(null);
  };
  
  // ============ LOADING STATE ============
  
  if (pulseData.loading && !pulseData.sensorData) {
    return <PulsePageSkeleton />;
  }
  
  // ============ RENDER ============
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        className="flex items-center justify-between"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center gap-2">
          <Zap className="w-6 h-6 text-primary" />
          <h1 className="text-xl font-bold text-warm-800">Pulse</h1>
        </div>
        <motion.button
          onClick={pulseData.refresh}
          disabled={pulseData.loading}
          className="p-2 rounded-xl bg-warm-100 hover:bg-warm-200 transition-colors"
          whileTap={{ scale: 0.95 }}
        >
          <RefreshCw className={`w-5 h-5 text-warm-600 ${pulseData.loading ? 'animate-spin' : ''}`} />
        </motion.button>
      </motion.div>
      
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
          temperature={pulseData.sensorData?.indoorTemp}
          currentSong={pulseData.sensorData?.currentSong}
          artist={pulseData.sensorData?.artist}
          lastUpdated={pulseData.lastUpdated}
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
    </div>
  );
}

export default Pulse;

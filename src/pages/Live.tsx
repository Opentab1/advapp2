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
import { Zap, CheckCircle2, Circle, X, AlertTriangle, Wifi, ShieldCheck } from 'lucide-react';

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
import venueScopeService from '../services/venuescope.service';
import venueSettingsService from '../services/venue-settings.service';
import staffService from '../services/staff.service';
import { pulseStore } from '../stores/pulseStore';
import { isDemoAccount } from '../utils/demoData';
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

// ── Business hours helper ────────────────────────────────────────────────────
function getBusinessHours(): { open: string; close: string } | null {
  try {
    const saved = localStorage.getItem('pulse_biz_hours');
    if (saved) return JSON.parse(saved);
  } catch { /* ignore */ }
  return null;
}

function isBarOpen(hours: { open: string; close: string }): boolean {
  const now = new Date();
  const [oH, oM] = hours.open.split(':').map(Number);
  const [cH, cM] = hours.close.split(':').map(Number);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const openMin = oH * 60 + oM;
  const closeMin = cH * 60 + cM;
  // Overnight: e.g. 17:00 – 02:00
  if (closeMin <= openMin) return nowMin >= openMin || nowMin < closeMin;
  return nowMin >= openMin && nowMin < closeMin;
}

function formatTime12(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

// ── Dual Ring Hero ────────────────────────────────────────────────────────────
const RING_R = 40;
const RING_CIRC = 2 * Math.PI * RING_R; // 251.33

function Ring({
  pct,
  color,
  label,
  value,
  sub,
  noData,
  closed,
}: {
  pct: number;          // 0-100
  color: string;        // stroke color class
  label: string;
  value: string;
  sub?: string;
  noData?: boolean;
  closed?: boolean;
}) {
  const offset = RING_CIRC * (1 - Math.min(100, Math.max(0, pct)) / 100);
  // closed = bar not open yet; noData = open but no historical baseline
  // Both suppress the fill arc, but closed still shows the ring track + labels clearly
  const suppressFill = noData || closed;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-36 h-36">
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
          {/* Track — always visible */}
          <circle
            cx="50" cy="50" r={RING_R}
            fill="none"
            stroke="currentColor"
            strokeWidth="8"
            className="text-white/20"
          />
          {/* Progress arc — hidden when closed or no data */}
          {!suppressFill && (
            <circle
              cx="50" cy="50" r={RING_R}
              fill="none"
              stroke="currentColor"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={RING_CIRC}
              strokeDashoffset={offset}
              className={`${color} transition-all duration-700`}
            />
          )}
        </svg>
        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-2xl font-bold tabular-nums leading-none ${closed ? 'text-warm-300' : noData ? 'text-warm-300' : 'text-white'}`}>
            {noData ? '—' : closed ? '—' : `${Math.round(pct)}%`}
          </span>
          {closed && (
            <span className="text-[9px] text-warm-600 mt-0.5 uppercase tracking-wide">Closed</span>
          )}
          {!noData && !closed && sub && (
            <span className="text-[10px] text-warm-500 mt-0.5">{sub}</span>
          )}
        </div>
      </div>
      {/* Label below ring */}
      <div className="text-center">
        <div className={`text-xs font-semibold uppercase tracking-wider ${closed ? 'text-warm-400' : noData ? 'text-warm-400' : 'text-warm-400'}`}>
          {label}
        </div>
        <div className={`text-sm font-bold mt-0.5 ${closed ? 'text-warm-300' : noData ? 'text-warm-300' : 'text-white'}`}>
          {value}
        </div>
      </div>
    </div>
  );
}

function TripleRingHero({
  totalDrinks,
  drinksPerHour,
  avgDrinksForDow,
  currentOccupancy,
  venueCapacity,
  avgDwellToday,
  avgDwellLastWeekSameDay,
  hasTheftFlag,
  unrungDrinks,
  onTap,
}: {
  totalDrinks: number | null;
  drinksPerHour: number | null;
  avgDrinksForDow: number | null;
  currentOccupancy: number | null;
  venueCapacity: number | null;
  avgDwellToday: number | null;       // minutes
  avgDwellLastWeekSameDay: number | null; // minutes, same DOW last week
  hasTheftFlag: boolean;
  unrungDrinks?: number;
  onTap?: () => void;
}) {
  const hours = getBusinessHours();
  const open = hours ? isBarOpen(hours) : null;
  const isClosed = open === false;

  // Ring 1 — Drinks % vs historical avg for this DOW
  const drinksPct = (() => {
    if (isClosed || totalDrinks == null || !avgDrinksForDow) return null;
    return Math.min(120, Math.round((totalDrinks / avgDrinksForDow) * 100));
  })();

  // Ring 2 — Capacity %
  const capacityPct = (() => {
    if (isClosed || currentOccupancy == null || !venueCapacity) return null;
    return Math.min(100, Math.round((currentOccupancy / venueCapacity) * 100));
  })();

  // Ring 3 — Dwell time % vs same day last week
  const dwellPct = (() => {
    if (isClosed || avgDwellToday == null || !avgDwellLastWeekSameDay) return null;
    return Math.min(150, Math.round((avgDwellToday / avgDwellLastWeekSameDay) * 100));
  })();

  function fmtDwell(mins: number | null) {
    if (mins == null) return '—';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long' });

  return (
    <motion.div
      className={`bg-warm-800 rounded-2xl border border-warm-700 p-5 ${onTap ? 'cursor-pointer' : ''}`}
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      onClick={onTap}
      whileTap={onTap ? { scale: 0.98 } : undefined}
    >
      {/* Status row */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isClosed ? 'bg-warm-600' : 'bg-green-500 animate-pulse'}`} />
          <span className={`text-xs font-semibold uppercase tracking-wide ${isClosed ? 'text-warm-500' : 'text-green-400'}`}>
            {isClosed ? 'Bar Closed' : open === true ? 'Shift Active' : 'Tonight'}
          </span>
          {hours && isClosed && (
            <span className="text-xs text-warm-600">· Opens {formatTime12(hours.open)}</span>
          )}
        </div>
        {hasTheftFlag && !isClosed && (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-red-400 bg-red-500/15 border border-red-500/25 rounded-full px-2 py-0.5">
            <AlertTriangle className="w-2.5 h-2.5" />
            {unrungDrinks ? `${unrungDrinks} unrung` : 'Theft Flag'}
          </span>
        )}
        {!hasTheftFlag && !isClosed && (
          <span className="flex items-center gap-1 text-[10px] text-emerald-400">
            <ShieldCheck className="w-3 h-3" />No theft flags
          </span>
        )}
      </div>

      {/* Three rings */}
      <div className="flex items-start justify-around gap-2">
        <Ring
          pct={drinksPct ?? 0}
          color="text-teal"
          label="Drinks"
          value={totalDrinks != null ? `${totalDrinks}` : '—'}
          sub={drinksPerHour != null && drinksPerHour > 0 && drinksPerHour < 200 ? `${Math.round(drinksPerHour)}/hr` : avgDrinksForDow ? `avg ${avgDrinksForDow}` : undefined}
          noData={drinksPct === null && !isClosed}
          closed={isClosed}
        />
        <Ring
          pct={capacityPct ?? 0}
          color="text-amber-400"
          label="Capacity"
          value={currentOccupancy != null ? `${currentOccupancy}` : '—'}
          sub={venueCapacity ? `of ${venueCapacity}` : undefined}
          noData={capacityPct === null && !isClosed}
          closed={isClosed}
        />
        <Ring
          pct={dwellPct ?? 0}
          color="text-purple-400"
          label="Dwell Time"
          value={fmtDwell(avgDwellToday)}
          sub={avgDwellLastWeekSameDay ? `last ${today.slice(0, 3)}: ${fmtDwell(avgDwellLastWeekSameDay)}` : undefined}
          noData={dwellPct === null && !isClosed}
          closed={isClosed}
        />
      </div>

      {/* Footnote */}
      {!isClosed && (
        <div className="mt-4 pt-3 border-t border-warm-700/50 text-[10px] text-warm-600 flex flex-wrap gap-x-3 gap-y-1">
          {drinksPct === null && <span>No drink history yet for {today}s</span>}
          {capacityPct === null && venueCapacity == null && <span>Set venue capacity in Settings</span>}
          {dwellPct === null && <span>No dwell history for last {today}</span>}
        </div>
      )}
    </motion.div>
  );
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
  const [latestJobMeta, setLatestJobMeta] = useState<{ topBartender?: string; unrungDrinks?: number; avgDrinkPrice?: number } | null>(null);

  // Ring data
  const [avgDrinksForDow, setAvgDrinksForDow]           = useState<number | null>(null);
  const [venueCapacity, setVenueCapacity]                 = useState<number | null>(null);
  const [avgDwellToday, setAvgDwellToday]                 = useState<number | null>(null);
  const [avgDwellLastWeekSameDay, setAvgDwellLastWeekSameDay] = useState<number | null>(null);
  
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

  // Load VenueScope job history for rings + latest job meta + venue settings
  useEffect(() => {
    if (!venueId) return;

    // Demo account: inject ring data directly — no real jobs in DB
    if (isDemoAccount(venueId)) {
      const dow = new Date().getDay();
      // Realistic DOW-aware avg drinks for a 500-cap venue
      const dowDrinkAvg: Record<number, number> = { 0: 72, 1: 58, 2: 66, 3: 94, 4: 148, 5: 162, 6: 131 };
      setAvgDrinksForDow(dowDrinkAvg[dow] ?? 120);
      setVenueCapacity(500);
      setAvgDwellToday(47);
      setAvgDwellLastWeekSameDay(44);
      setLatestJobMeta({ topBartender: 'Marcus', unrungDrinks: 4, avgDrinkPrice: 14 });
      return;
    }

    venueScopeService.listJobs(venueId, 200).then(jobs => {
      const nonLive = jobs.filter(j => !j.isLive && (j.status === 'done' || j.status === 'completed'));

      // Latest job meta
      const latest = jobs.find(j => j.isLive || j.status === 'done' || j.status === 'running');
      if (latest) {
        setLatestJobMeta(prev => ({
          ...prev,
          topBartender: latest.topBartender || undefined,
          unrungDrinks: latest.unrungDrinks ?? undefined,
        }));
      }

      const todayDow = new Date().getDay(); // 0=Sun..6=Sat

      // Ring 1 — avg drinks for today's day-of-week (exclude today's jobs)
      // Bar day starts at 3 AM — if it's before 3 AM, "today" is yesterday
      const todayStart = new Date();
      if (todayStart.getHours() < 3) todayStart.setDate(todayStart.getDate() - 1);
      todayStart.setHours(3, 0, 0, 0);
      const sameDowJobs = nonLive.filter(j => {
        const d = new Date((j.createdAt ?? 0) * 1000);
        return d.getDay() === todayDow && d < todayStart && (j.totalDrinks ?? 0) > 0;
      });
      if (sameDowJobs.length >= 2) {
        const avg = Math.round(sameDowJobs.reduce((s, j) => s + (j.totalDrinks ?? 0), 0) / sameDowJobs.length);
        setAvgDrinksForDow(avg);
      }

      // Ring 3 — dwell: today's jobs avg + same DOW last week avg
      const oneWeekAgoStart = new Date(todayStart); oneWeekAgoStart.setDate(oneWeekAgoStart.getDate() - 7);
      const oneWeekAgoEnd   = new Date(oneWeekAgoStart); oneWeekAgoEnd.setDate(oneWeekAgoEnd.getDate() + 1);

      const todayDwellJobs = nonLive.filter(j => {
        const d = new Date((j.createdAt ?? 0) * 1000);
        return d >= todayStart && j.avgDwellMin != null;
      });
      if (todayDwellJobs.length > 0) {
        setAvgDwellToday(Math.round(
          todayDwellJobs.reduce((s, j) => s + (j.avgDwellMin ?? 0), 0) / todayDwellJobs.length
        ));
      }

      const lastWeekDwellJobs = nonLive.filter(j => {
        const d = new Date((j.createdAt ?? 0) * 1000);
        return d >= oneWeekAgoStart && d < oneWeekAgoEnd && j.avgDwellMin != null;
      });
      if (lastWeekDwellJobs.length > 0) {
        setAvgDwellLastWeekSameDay(Math.round(
          lastWeekDwellJobs.reduce((s, j) => s + (j.avgDwellMin ?? 0), 0) / lastWeekDwellJobs.length
        ));
      }
    }).catch(() => {});

    // Ring 2 + avg drink price from settings
    venueSettingsService.loadSettingsFromCloud(venueId).then(s => {
      if (s?.avgDrinkPrice) setLatestJobMeta(prev => ({ ...prev, avgDrinkPrice: s.avgDrinkPrice }));
      if (s?.capacity)      setVenueCapacity(s.capacity);
    }).catch(() => {});
  }, [venueId]);

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
  
  if (pulseData.loading && !pulseData.sensorData && !pulseData.hasVenueScopeData) {
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
        if (hasVS || isDemoAccount(venueId)) return null;
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

      {/* Triple Ring Hero */}
      <TripleRingHero
        totalDrinks={pulseData.totalDrinks}
        drinksPerHour={pulseData.drinksPerHour}
        avgDrinksForDow={avgDrinksForDow}
        currentOccupancy={pulseData.currentOccupancy}
        venueCapacity={venueCapacity}
        avgDwellToday={avgDwellToday}
        avgDwellLastWeekSameDay={avgDwellLastWeekSameDay}
        hasTheftFlag={pulseData.hasTheftFlag}
        unrungDrinks={latestJobMeta?.unrungDrinks}
        onTap={() => setActiveModal('livestats')}
      />
      
      {/* Quick Actions - hidden */}
      
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

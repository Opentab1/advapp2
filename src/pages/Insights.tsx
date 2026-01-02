import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  TrendingUp, 
  TrendingDown,
  ChevronDown,
  Calendar,
  Clock,
  Star,
  Zap,
  AlertCircle,
  CheckCircle,
  Trophy,
  RefreshCw,
  ExternalLink,
  Lightbulb,
  Target,
  X,
} from 'lucide-react';
import authService from '../services/auth.service';
import apiService from '../services/api.service';
import googleReviewsService, { GoogleReviewsData } from '../services/google-reviews.service';
import venueSettingsService from '../services/venue-settings.service';
import sportsService from '../services/sports.service';
import holidayService from '../services/holiday.service';
import { calculateRecentDwellTime, formatDwellTime, getDwellTimeCategory } from '../utils/dwellTime';
import type { SensorData, SportsGame } from '../types';

// ============ TYPES ============

interface WeekData {
  totalEntries: number;
  avgOccupancy: number;
  peakDay: string;
  peakDayEntries: number;
  worstDay: string;
  worstDayEntries: number;
  avgSound: number;
  dailyData: DayData[];
}

interface DayData {
  day: string;
  date: Date;
  entries: number;
  avgOccupancy: number;
  avgSound: number;
  peakHour: number;
}

interface PatternInsight {
  id: string;
  type: 'opportunity' | 'warning' | 'success';
  title: string;
  detail: string;
  impact?: string;
}

// ============ MAIN COMPONENT ============

interface InsightsProps {
  hideRings?: boolean;
}

export function Insights({ hideRings = false }: InsightsProps) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>('weekly');
  const [activeRing, setActiveRing] = useState<'dwell' | 'reputation' | 'occupancy' | null>(null);
  
  // Data
  const [thisWeek, setThisWeek] = useState<WeekData | null>(null);
  const [lastWeek, setLastWeek] = useState<WeekData | null>(null);
  const [reviews, setReviews] = useState<GoogleReviewsData | null>(null);
  const [todayGames, setTodayGames] = useState<SportsGame[]>([]);
  const [patterns, setPatterns] = useState<PatternInsight[]>([]);
  const [headline, setHeadline] = useState<{ text: string; type: 'good' | 'warning' | 'neutral' } | null>(null);
  const [dwellTime, setDwellTime] = useState<number | null>(null);
  const [, setAllSensorData] = useState<SensorData[]>([]);

  const user = authService.getStoredUser();
  const venueId = user?.venueId || '';
  const venueName = user?.venueName || '';
  const venueCapacity = 100; // Default capacity - could be fetched from venue settings

  const loadAllData = useCallback(async () => {
    if (!venueId) {
      setLoading(false);
      return;
    }

    try {
      await Promise.all([
        loadWeeklyData(),
        loadReviews(),
        loadTodayGames(),
      ]);
    } catch (e) {
      console.error('Error loading insights:', e);
    } finally {
      setLoading(false);
    }
  }, [venueId]);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadAllData();
    setRefreshing(false);
  };

  // Load 14 days of data and split into this week / last week
  const loadWeeklyData = async () => {
    try {
      const data = await apiService.getHistoricalData(venueId, '14d');
      if (!data?.data?.length) return;

      setAllSensorData(data.data);

      const now = new Date();
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

      const thisWeekData = data.data.filter((d: SensorData) => new Date(d.timestamp) >= oneWeekAgo);
      const lastWeekData = data.data.filter((d: SensorData) => {
        const ts = new Date(d.timestamp);
        return ts >= twoWeeksAgo && ts < oneWeekAgo;
      });

      const tw = processWeekData(thisWeekData);
      const lw = processWeekData(lastWeekData);
      
      setThisWeek(tw);
      setLastWeek(lw);
      
      // Calculate dwell time from recent data
      const recentDwell = calculateRecentDwellTime(data.data, 24);
      setDwellTime(recentDwell);
      
      // Generate patterns and headline
      generatePatterns(tw, lw, data.data);
      generateHeadline(tw, lw);
    } catch (e) {
      console.error('Weekly data error:', e);
    }
  };

  const processWeekData = (data: SensorData[]): WeekData => {
    const byDay = new Map<string, DayData>();
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    data.forEach(item => {
      const date = new Date(item.timestamp);
      const key = date.toDateString();
      
      if (!byDay.has(key)) {
        byDay.set(key, {
          day: dayNames[date.getDay()],
          date,
          entries: 0,
          avgOccupancy: 0,
          avgSound: 0,
          peakHour: 0,
        });
      }
      
      const d = byDay.get(key)!;
      if (item.occupancy?.entries) d.entries = Math.max(d.entries, item.occupancy.entries);
      if (item.occupancy?.current) d.avgOccupancy = Math.max(d.avgOccupancy, item.occupancy.current);
      if (item.decibels) d.avgSound = (d.avgSound + item.decibels) / 2 || item.decibels;
    });

    const days = Array.from(byDay.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
    const totalEntries = days.reduce((sum, d) => sum + d.entries, 0);
    const avgOccupancy = days.length > 0 ? days.reduce((sum, d) => sum + d.avgOccupancy, 0) / days.length : 0;
    const avgSound = days.length > 0 ? days.reduce((sum, d) => sum + d.avgSound, 0) / days.length : 0;

    const sortedByEntries = [...days].sort((a, b) => b.entries - a.entries);
    const peakDay = sortedByEntries[0];
    const worstDay = sortedByEntries[sortedByEntries.length - 1];

    return {
      totalEntries,
      avgOccupancy: Math.round(avgOccupancy),
      peakDay: peakDay?.day || '—',
      peakDayEntries: peakDay?.entries || 0,
      worstDay: worstDay?.day || '—',
      worstDayEntries: worstDay?.entries || 0,
      avgSound: Math.round(avgSound),
      dailyData: days,
    };
  };

  const generatePatterns = (tw: WeekData | null, lw: WeekData | null, _allData: SensorData[]) => {
    const insights: PatternInsight[] = [];

    if (tw && lw && lw.totalEntries > 0) {
      const change = ((tw.totalEntries - lw.totalEntries) / lw.totalEntries) * 100;
      if (change > 15) {
        insights.push({
          id: 'traffic-up',
          type: 'success',
          title: `Traffic up ${Math.round(change)}% this week`,
          detail: `You had ${tw.totalEntries} visitors vs ${lw.totalEntries} last week.`,
          impact: 'Keep doing what you\'re doing!',
        });
      } else if (change < -15) {
        insights.push({
          id: 'traffic-down',
          type: 'warning',
          title: `Traffic down ${Math.abs(Math.round(change))}% this week`,
          detail: `You had ${tw.totalEntries} visitors vs ${lw.totalEntries} last week.`,
          impact: 'Check what was different - weather? events? competition?',
        });
      }
    }

    // Sound pattern
    if (tw && tw.avgSound > 82) {
      insights.push({
        id: 'sound-high',
        type: 'warning',
        title: 'Sound levels running high',
        detail: `Your average this week was ${tw.avgSound} dB. Above 80 dB, conversations become difficult.`,
        impact: 'Guests may leave earlier when it\'s too loud to talk.',
      });
    }

    // Best day pattern
    if (tw && tw.peakDay && tw.peakDayEntries > 0) {
      insights.push({
        id: 'peak-day',
        type: 'success',
        title: `${tw.peakDay} was your best day`,
        detail: `${tw.peakDayEntries} visitors - your highest of the week.`,
        impact: 'Study what made it work and replicate.',
      });
    }

    // Slow day opportunity
    if (tw && tw.worstDay && tw.worstDayEntries < tw.peakDayEntries * 0.5) {
      insights.push({
        id: 'slow-day',
        type: 'opportunity',
        title: `${tw.worstDay} needs attention`,
        detail: `Only ${tw.worstDayEntries} visitors - less than half your best day.`,
        impact: 'Consider a special, event, or promotion.',
      });
    }

    setPatterns(insights);
  };

  const generateHeadline = (tw: WeekData | null, lw: WeekData | null) => {
    if (!tw) {
      setHeadline({ text: 'Gathering data...', type: 'neutral' });
      return;
    }

    if (lw && lw.totalEntries > 0) {
      const change = ((tw.totalEntries - lw.totalEntries) / lw.totalEntries) * 100;
      if (change > 10) {
        setHeadline({ 
          text: `Great week! Traffic up ${Math.round(change)}%`, 
          type: 'good' 
        });
      } else if (change < -10) {
        setHeadline({ 
          text: `Slow week. Traffic down ${Math.abs(Math.round(change))}%`, 
          type: 'warning' 
        });
      } else {
        setHeadline({ 
          text: `Steady week. ${tw.totalEntries} visitors`, 
          type: 'neutral' 
        });
      }
    } else {
      setHeadline({ 
        text: `This week: ${tw.totalEntries} visitors so far`, 
        type: 'neutral' 
      });
    }
  };

  const loadReviews = async () => {
    try {
      const address = venueSettingsService.getFormattedAddress(venueId) || '';
      const data = await googleReviewsService.getReviews(venueName, address, venueId);
      if (data) setReviews(data);
    } catch (e) {
      console.error('Reviews error:', e);
    }
  };

  const loadTodayGames = async () => {
    try {
      const games = await sportsService.getGames();
      // Filter to today's games
      const today = new Date().toDateString();
      const todaysGames = games.filter(g => {
        const gameDate = new Date(g.startTime).toDateString();
        return gameDate === today;
      });
      setTodayGames(todaysGames);
    } catch (e) {
      console.error('Games error:', e);
    }
  };

  // Get next holiday
  const upcomingHolidays = holidayService.getUpcomingHolidays(14);
  const nextHoliday = upcomingHolidays[0];
  const daysUntilHoliday = nextHoliday ? holidayService.getDaysUntil(nextHoliday) : null;

  // Calculate week over week change
  const weekChange = thisWeek && lastWeek && lastWeek.totalEntries > 0
    ? Math.round(((thisWeek.totalEntries - lastWeek.totalEntries) / lastWeek.totalEntries) * 100)
    : null;

  // Calculate ring scores (0-100)
  // Dwell time: 120 min = 100, scale linearly
  const dwellScore = dwellTime ? Math.min(100, Math.round((dwellTime / 120) * 100)) : 0;
  const dwellCategory = getDwellTimeCategory(dwellTime, 'bar');
  
  // Reputation: 5.0 = 100, 1.0 = 0
  const reputationScore = reviews ? Math.round(((reviews.rating - 1) / 4) * 100) : 0;
  
  // Occupancy: avg occupancy as % of capacity
  const occupancyScore = thisWeek ? Math.min(100, Math.round((thisWeek.avgOccupancy / venueCapacity) * 100)) : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <RefreshCw className="w-8 h-8 text-cyan animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold gradient-text">Insights</h2>
          <p className="text-gray-400 text-sm">What's working and what needs attention</p>
        </div>
        <motion.button
          onClick={handleRefresh}
          disabled={refreshing}
          className="p-2 rounded-lg bg-white/5 hover:bg-white/10"
          whileTap={{ scale: 0.95 }}
        >
          <RefreshCw className={`w-5 h-5 text-gray-400 ${refreshing ? 'animate-spin' : ''}`} />
        </motion.button>
      </div>

      {/* Three Score Rings - hidden when embedded in Dashboard */}
      {!hideRings && (
        <>
          <div className="flex justify-center gap-4 mb-8">
            <ScoreRing
              score={dwellScore}
              label="Dwell Time"
              value={formatDwellTime(dwellTime)}
              color="#00d4ff"
              onClick={() => setActiveRing('dwell')}
            />
            <ScoreRing
              score={reputationScore}
              label="Reputation"
              value={reviews ? `${reviews.rating.toFixed(1)}★` : '--'}
              color="#fbbf24"
              onClick={() => setActiveRing('reputation')}
            />
            <ScoreRing
              score={occupancyScore}
              label="Occupancy"
              value={thisWeek ? `${thisWeek.avgOccupancy}` : '--'}
              color="#22c55e"
              onClick={() => setActiveRing('occupancy')}
            />
          </div>

          {/* Ring Detail Modal */}
          <AnimatePresence>
            {activeRing && (
              <RingDetailModal
                type={activeRing}
                onClose={() => setActiveRing(null)}
                dwellTime={dwellTime}
                dwellCategory={dwellCategory}
                reviews={reviews}
                venueName={venueName}
                thisWeek={thisWeek}
                venueCapacity={venueCapacity}
              />
            )}
          </AnimatePresence>
        </>
      )}

      {/* Headline Insight */}
      {headline && (
        <motion.div 
          className={`p-4 rounded-xl mb-6 ${
            headline.type === 'good' ? 'bg-green-500/10 border border-green-500/30' :
            headline.type === 'warning' ? 'bg-yellow-500/10 border border-yellow-500/30' :
            'bg-white/5 border border-white/10'
          }`}
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="flex items-center gap-3">
            {headline.type === 'good' && <TrendingUp className="w-6 h-6 text-green-400" />}
            {headline.type === 'warning' && <TrendingDown className="w-6 h-6 text-yellow-400" />}
            {headline.type === 'neutral' && <Target className="w-6 h-6 text-gray-400" />}
            <span className={`text-lg font-semibold ${
              headline.type === 'good' ? 'text-green-400' :
              headline.type === 'warning' ? 'text-yellow-400' :
              'text-white'
            }`}>
              {headline.text}
            </span>
          </div>
        </motion.div>
      )}

      {/* Tonight's Briefing */}
      <Section
        title="Tonight"
        subtitle={new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
        icon={Clock}
        isOpen={expanded === 'tonight'}
        onToggle={() => setExpanded(expanded === 'tonight' ? null : 'tonight')}
      >
        <div className="space-y-3">
          {/* Games Today */}
          {todayGames.length > 0 ? (
            <div className="p-3 rounded-lg bg-white/5">
              <div className="flex items-center gap-2 mb-2">
                <Trophy className="w-4 h-4 text-cyan" />
                <span className="text-sm font-medium text-white">{todayGames.length} game{todayGames.length > 1 ? 's' : ''} today</span>
              </div>
              <div className="space-y-2">
                {todayGames.slice(0, 3).map(game => (
                  <div key={game.id} className="flex items-center justify-between text-sm">
                    <span className="text-gray-300">{game.awayTeam} @ {game.homeTeam}</span>
                    <span className={game.status === 'live' ? 'text-red-400' : 'text-gray-500'}>
                      {game.status === 'live' ? 'LIVE' : new Date(game.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="p-3 rounded-lg bg-white/5 text-gray-400 text-sm">
              No major games scheduled today
            </div>
          )}

          {/* Holiday Alert */}
          {nextHoliday && daysUntilHoliday !== null && daysUntilHoliday <= 7 && (
            <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/30">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-purple-400" />
                <span className="text-sm font-medium text-purple-300">
                  {nextHoliday.name} {daysUntilHoliday === 0 ? 'is today!' : daysUntilHoliday === 1 ? 'is tomorrow' : `in ${daysUntilHoliday} days`}
                </span>
              </div>
              {nextHoliday.tips && (
                <p className="text-xs text-purple-300/70 mt-1 ml-6">{nextHoliday.tips}</p>
              )}
            </div>
          )}

          {/* Quick tip based on day */}
          <div className="p-3 rounded-lg bg-cyan/5 border border-cyan/20">
            <div className="flex items-start gap-2">
              <Lightbulb className="w-4 h-4 text-cyan mt-0.5" />
              <div>
                <span className="text-sm text-cyan font-medium">Prep tip: </span>
                <span className="text-sm text-gray-300">
                  {thisWeek && thisWeek.peakDay === new Date().toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 3)
                    ? 'This is usually your busiest day. Staff up!'
                    : todayGames.length > 0 
                      ? 'Game day! Expect higher traffic 30 min before first pitch.'
                      : 'Standard night. Focus on customer experience.'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* Weekly Performance */}
      <Section
        title="This Week"
        subtitle={weekChange !== null ? `${weekChange >= 0 ? '+' : ''}${weekChange}% vs last week` : 'Performance summary'}
        icon={TrendingUp}
        isOpen={expanded === 'weekly'}
        onToggle={() => setExpanded(expanded === 'weekly' ? null : 'weekly')}
      >
        {thisWeek ? (
          <div className="space-y-4">
            {/* Stats Grid */}
            <div className="grid grid-cols-3 gap-3">
              <StatBox label="Visitors" value={thisWeek.totalEntries.toString()} change={weekChange} />
              <StatBox label="Peak Day" value={thisWeek.peakDay} sub={`${thisWeek.peakDayEntries} visitors`} />
              <StatBox label="Avg Sound" value={`${thisWeek.avgSound} dB`} status={thisWeek.avgSound > 80 ? 'warning' : 'good'} />
            </div>

            {/* Daily Bar Chart */}
            {thisWeek.dailyData.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 mb-2">Daily visitors</p>
                <div className="flex items-end justify-between gap-1 h-20">
                  {thisWeek.dailyData.map((day, i) => {
                    const max = Math.max(...thisWeek.dailyData.map(d => d.entries), 1);
                    const pct = (day.entries / max) * 100;
                    const isToday = day.date.toDateString() === new Date().toDateString();
                    return (
                      <div key={i} className="flex flex-col items-center gap-1 flex-1">
                        <span className="text-[10px] text-gray-500">{day.entries || ''}</span>
                        <div 
                          className="w-full rounded-t transition-all"
                          style={{ 
                            height: `${Math.max(pct, 4)}%`,
                            background: isToday ? '#00d4ff' : '#333',
                          }}
                        />
                        <span className={`text-[10px] ${isToday ? 'text-cyan' : 'text-gray-500'}`}>
                          {day.day[0]}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-gray-400 text-sm">No data available yet</p>
        )}
      </Section>

      {/* Patterns & Insights */}
      {patterns.length > 0 && (
        <Section
          title="Patterns"
          subtitle={`${patterns.length} insight${patterns.length > 1 ? 's' : ''}`}
          icon={Zap}
          isOpen={expanded === 'patterns'}
          onToggle={() => setExpanded(expanded === 'patterns' ? null : 'patterns')}
        >
          <div className="space-y-2">
            {patterns.map(pattern => (
              <PatternCard key={pattern.id} pattern={pattern} />
            ))}
          </div>
        </Section>
      )}

      {/* Reputation */}
      {reviews && (
        <Section
          title="Reputation"
          subtitle={`${reviews.rating.toFixed(1)} ★ on Google`}
          icon={Star}
          isOpen={expanded === 'reputation'}
          onToggle={() => setExpanded(expanded === 'reputation' ? null : 'reputation')}
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-3xl font-bold text-white">{reviews.rating.toFixed(1)}</span>
                <div>
                  <div className="flex text-yellow-400">
                    {[1, 2, 3, 4, 5].map(i => (
                      <Star 
                        key={i} 
                        className={`w-4 h-4 ${i <= Math.round(reviews.rating) ? 'fill-current' : ''}`} 
                      />
                    ))}
                  </div>
                  <p className="text-xs text-gray-400">{reviews.reviewCount.toLocaleString()} reviews</p>
                </div>
              </div>
              <a
                href={`https://www.google.com/maps/search/${encodeURIComponent(venueName)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-sm text-cyan hover:underline"
              >
                View <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            
            {reviews.rating >= 4.5 && (
              <div className="p-2 rounded-lg bg-green-500/10 text-green-400 text-sm flex items-center gap-2">
                <CheckCircle className="w-4 h-4" />
                Excellent rating! Keep it up.
              </div>
            )}
            {reviews.rating < 4.0 && (
              <div className="p-2 rounded-lg bg-yellow-500/10 text-yellow-400 text-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                Room for improvement. Check recent reviews for feedback.
              </div>
            )}
          </div>
        </Section>
      )}
    </div>
  );
}

// ============ SUB-COMPONENTS ============

function Section({ title, subtitle, icon: Icon, isOpen, onToggle, children }: {
  title: string;
  subtitle: string;
  icon: typeof TrendingUp;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <motion.div 
      className="glass-card mb-4 overflow-hidden"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <button
        onClick={onToggle}
        className="w-full p-4 flex items-center justify-between hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center">
            <Icon className="w-5 h-5 text-cyan" />
          </div>
          <div className="text-left">
            <p className="text-base font-semibold text-white">{title}</p>
            <p className="text-xs text-gray-400">{subtitle}</p>
          </div>
        </div>
        <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
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
    </motion.div>
  );
}

function StatBox({ label, value, sub, change, status }: {
  label: string;
  value: string;
  sub?: string;
  change?: number | null;
  status?: 'good' | 'warning';
}) {
  return (
    <div className="p-3 rounded-lg bg-white/5">
      <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-lg font-bold ${status === 'warning' ? 'text-yellow-400' : 'text-white'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
      {change !== undefined && change !== null && (
        <p className={`text-xs ${change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
          {change >= 0 ? '+' : ''}{change}%
        </p>
      )}
    </div>
  );
}

function PatternCard({ pattern }: { pattern: PatternInsight }) {
  const colors = {
    opportunity: { bg: 'bg-blue-500/10', border: 'border-blue-500/30', icon: Lightbulb, iconColor: 'text-blue-400' },
    warning: { bg: 'bg-yellow-500/10', border: 'border-yellow-500/30', icon: AlertCircle, iconColor: 'text-yellow-400' },
    success: { bg: 'bg-green-500/10', border: 'border-green-500/30', icon: CheckCircle, iconColor: 'text-green-400' },
  };
  const style = colors[pattern.type];
  const Icon = style.icon;

  return (
    <div className={`p-3 rounded-lg ${style.bg} border ${style.border}`}>
      <div className="flex items-start gap-2">
        <Icon className={`w-4 h-4 mt-0.5 ${style.iconColor}`} />
        <div className="flex-1">
          <p className="text-sm font-medium text-white">{pattern.title}</p>
          <p className="text-xs text-gray-400 mt-0.5">{pattern.detail}</p>
          {pattern.impact && (
            <p className="text-xs text-gray-300 mt-1 italic">→ {pattern.impact}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ============ SCORE RING COMPONENT ============

function ScoreRing({ score, label, value, color, onClick }: {
  score: number;
  label: string;
  value: string;
  color: string;
  onClick: () => void;
}) {
  const size = 100;
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (score / 100) * circumference;

  return (
    <motion.button
      onClick={onClick}
      className="flex flex-col items-center gap-2 p-2 rounded-xl hover:bg-white/5 transition-colors"
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
    >
      <div className="relative" style={{ width: size, height: size }}>
        {/* Background circle */}
        <svg className="absolute inset-0 -rotate-90" width={size} height={size}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.1)"
            strokeWidth={strokeWidth}
          />
          {/* Animated progress circle */}
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 1, ease: "easeOut" }}
          />
        </svg>
        {/* Center content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-bold text-white">{value}</span>
        </div>
      </div>
      <span className="text-xs text-gray-400 font-medium">{label}</span>
    </motion.button>
  );
}

// ============ RING DETAIL MODAL ============

function RingDetailModal({ type, onClose, dwellTime, dwellCategory, reviews, venueName, thisWeek, venueCapacity }: {
  type: 'dwell' | 'reputation' | 'occupancy';
  onClose: () => void;
  dwellTime: number | null;
  dwellCategory: string;
  reviews: GoogleReviewsData | null;
  venueName: string;
  thisWeek: WeekData | null;
  venueCapacity: number;
}) {
  const titles = {
    dwell: 'Average Dwell Time',
    reputation: 'Reputation',
    occupancy: 'Occupancy',
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="glass-card w-full max-w-sm p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-white">{titles[type]}</h3>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-lg">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {type === 'dwell' && (
          <div className="space-y-4">
            <div className="text-center py-4">
              <p className="text-4xl font-bold text-cyan">{formatDwellTime(dwellTime)}</p>
              <p className="text-sm text-gray-400 mt-1">average time guests stay</p>
            </div>
            <div className={`p-3 rounded-lg ${
              dwellCategory === 'excellent' ? 'bg-green-500/10 border border-green-500/30' :
              dwellCategory === 'good' ? 'bg-cyan/10 border border-cyan/30' :
              dwellCategory === 'fair' ? 'bg-yellow-500/10 border border-yellow-500/30' :
              'bg-red-500/10 border border-red-500/30'
            }`}>
              <p className={`text-sm font-medium ${
                dwellCategory === 'excellent' ? 'text-green-400' :
                dwellCategory === 'good' ? 'text-cyan' :
                dwellCategory === 'fair' ? 'text-yellow-400' :
                'text-red-400'
              }`}>
                {dwellCategory === 'excellent' ? '🎯 Excellent!' :
                 dwellCategory === 'good' ? '👍 Good' :
                 dwellCategory === 'fair' ? '⚠️ Fair' :
                 '📉 Needs work'}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {dwellCategory === 'excellent' ? 'Guests love staying. Keep doing what you\'re doing!' :
                 dwellCategory === 'good' ? 'Solid dwell time. Room to optimize.' :
                 dwellCategory === 'fair' ? 'Guests might be leaving early. Check atmosphere.' :
                 'Low dwell time hurts revenue. Review your experience.'}
              </p>
            </div>
            <div className="text-xs text-gray-500">
              <p><strong>What is dwell time?</strong></p>
              <p className="mt-1">How long guests stay on average. Longer = more drinks, more food, more revenue.</p>
            </div>
          </div>
        )}

        {type === 'reputation' && (
          <div className="space-y-4">
            {reviews ? (
              <>
                <div className="text-center py-4">
                  <p className="text-4xl font-bold text-yellow-400">{reviews.rating.toFixed(1)}</p>
                  <div className="flex justify-center text-yellow-400 mt-2">
                    {[1, 2, 3, 4, 5].map(i => (
                      <Star 
                        key={i} 
                        className={`w-5 h-5 ${i <= Math.round(reviews.rating) ? 'fill-current' : ''}`} 
                      />
                    ))}
                  </div>
                  <p className="text-sm text-gray-400 mt-2">{reviews.reviewCount.toLocaleString()} reviews on Google</p>
                </div>
                <div className={`p-3 rounded-lg ${
                  reviews.rating >= 4.5 ? 'bg-green-500/10 border border-green-500/30' :
                  reviews.rating >= 4.0 ? 'bg-cyan/10 border border-cyan/30' :
                  reviews.rating >= 3.5 ? 'bg-yellow-500/10 border border-yellow-500/30' :
                  'bg-red-500/10 border border-red-500/30'
                }`}>
                  <p className={`text-sm font-medium ${
                    reviews.rating >= 4.5 ? 'text-green-400' :
                    reviews.rating >= 4.0 ? 'text-cyan' :
                    reviews.rating >= 3.5 ? 'text-yellow-400' :
                    'text-red-400'
                  }`}>
                    {reviews.rating >= 4.5 ? '🌟 Outstanding!' :
                     reviews.rating >= 4.0 ? '✅ Strong reputation' :
                     reviews.rating >= 3.5 ? '⚠️ Room to improve' :
                     '🚨 Needs attention'}
                  </p>
                </div>
                <a
                  href={`https://www.google.com/maps/search/${encodeURIComponent(venueName)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm text-cyan"
                >
                  View on Google <ExternalLink className="w-4 h-4" />
                </a>
              </>
            ) : (
              <div className="text-center py-8 text-gray-400">
                <Star className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>Google Reviews not configured</p>
                <p className="text-xs mt-1">Set up your venue address in Settings</p>
              </div>
            )}
          </div>
        )}

        {type === 'occupancy' && (
          <div className="space-y-4">
            <div className="text-center py-4">
              <p className="text-4xl font-bold text-green-400">
                {thisWeek ? thisWeek.avgOccupancy : '--'}
              </p>
              <p className="text-sm text-gray-400 mt-1">avg guests this week</p>
            </div>
            {thisWeek && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-lg bg-white/5">
                    <p className="text-xs text-gray-500 uppercase">Peak</p>
                    <p className="text-lg font-bold text-white">{thisWeek.peakDayEntries}</p>
                    <p className="text-xs text-gray-400">on {thisWeek.peakDay}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-white/5">
                    <p className="text-xs text-gray-500 uppercase">Total</p>
                    <p className="text-lg font-bold text-white">{thisWeek.totalEntries}</p>
                    <p className="text-xs text-gray-400">visitors this week</p>
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-white/5">
                  <p className="text-xs text-gray-500 mb-2">Capacity utilization</p>
                  <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                    <motion.div 
                      className="h-full bg-green-500 rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(100, (thisWeek.avgOccupancy / venueCapacity) * 100)}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    {Math.round((thisWeek.avgOccupancy / venueCapacity) * 100)}% of {venueCapacity} capacity
                  </p>
                </div>
              </>
            )}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  X,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Minus,
  Star,
  Clock,
  Users,
  Music,
  Lightbulb,
  CheckCircle,
  AlertTriangle,
  Target,
  ExternalLink,
  RefreshCw
} from 'lucide-react';
import googleReviewsService, { GoogleReviewsData } from '../services/google-reviews.service';
import authService from '../services/auth.service';
import venueSettingsService from '../services/venue-settings.service';
import holidayService from '../services/holiday.service';
import sportsService from '../services/sports.service';
import songLogService from '../services/song-log.service';
import apiService from '../services/api.service';
import type { SportsGame } from '../types';

// WHOOP Color Palette
const COLORS = {
  black: '#000000',
  cardBg: '#1a1a1a',
  traffic: '#0085FF',    // Blue
  reputation: '#00D084', // Green
  engagement: '#8B5CF6', // Purple
  warning: '#FF4444',
  amber: '#FFAA00',
  neutral: '#6B6B6B',
  white: '#FFFFFF',
};

type MetricType = 'traffic' | 'reputation' | 'engagement' | null;

interface WeeklyData {
  day: string;
  value: number;
  date: Date;
  entries: number;
  exits: number;
}

interface InsightData {
  type: 'opportunity' | 'winning' | 'watch';
  title: string;
  subtitle: string;
  description?: string;
}

interface TrafficMetrics {
  score: number;
  trend: number;
  trendDirection: 'up' | 'down' | 'flat';
  peakDay: string;
  peakHour: string;
  weeklyData: WeeklyData[];
  totalEntries: number;
  avgDaily: number;
}

interface EngagementMetrics {
  score: number;
  trend: number;
  trendDirection: 'up' | 'down' | 'flat';
  avgDwellTime: number;
  topGenres: { name: string; percent: number }[];
  engagementFactors: { icon: string; label: string; bonus: string }[];
}

export function Insights() {
  const [expandedMetric, setExpandedMetric] = useState<MetricType>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  // Data states
  const [venueScore, setVenueScore] = useState(0);
  const [animatedScore, setAnimatedScore] = useState(0);
  const [scoreTrend, setScoreTrend] = useState(0);
  const [reviewsData, setReviewsData] = useState<GoogleReviewsData | null>(null);
  const [trafficMetrics, setTrafficMetrics] = useState<TrafficMetrics | null>(null);
  const [engagementMetrics, setEngagementMetrics] = useState<EngagementMetrics | null>(null);
  const [upcomingGames, setUpcomingGames] = useState<SportsGame[]>([]);
  const [insights, setInsights] = useState<InsightData[]>([]);
  const [nextHoliday, setNextHoliday] = useState<{ name: string; daysUntil: number; tips: string[] } | null>(null);

  const user = authService.getStoredUser();
  const venueName = user?.venueName || 'Your Venue';
  const venueId = user?.venueId || '';

  // Load all data on mount
  useEffect(() => {
    if (venueId) {
      loadAllData();
    }
  }, [venueId]);

  // Animate score on load
  useEffect(() => {
    if (venueScore === 0) return;
    
    const duration = 1500;
    const steps = 60;
    const increment = venueScore / steps;
    let current = 0;
    
    const timer = setInterval(() => {
      current += increment;
      if (current >= venueScore) {
        setAnimatedScore(venueScore);
        clearInterval(timer);
      } else {
        setAnimatedScore(Math.floor(current));
      }
    }, duration / steps);

    return () => clearInterval(timer);
  }, [venueScore]);

  const loadAllData = async () => {
    setLoading(true);
    
    try {
      await Promise.all([
        loadReviewsData(),
        loadTrafficData(),
        loadEngagementData(),
        loadSportsData(),
        loadHolidayData(),
      ]);
      
      // Generate insights after all data is loaded
      generateInsights();
      
    } catch (error) {
      console.error('Error loading insights data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadAllData();
    setRefreshing(false);
  };

  // Load Google Reviews data
  const loadReviewsData = async () => {
    try {
      const address = venueSettingsService.getFormattedAddress(venueId) || '';
      const reviews = await googleReviewsService.getReviews(venueName, address, venueId);
      if (reviews) {
        setReviewsData(reviews);
      }
    } catch (e) {
      console.error('Error loading reviews:', e);
    }
  };

  // Load traffic/occupancy data from DynamoDB
  const loadTrafficData = async () => {
    try {
      // Get last 7 days of data
      const data = await apiService.getHistoricalData(venueId, '7d');
      
      if (!data?.data || data.data.length === 0) {
        // Set default/empty metrics
        setTrafficMetrics({
          score: 0,
          trend: 0,
          trendDirection: 'flat',
          peakDay: '--',
          peakHour: '--',
          weeklyData: getEmptyWeeklyData(),
          totalEntries: 0,
          avgDaily: 0,
        });
        return;
      }

      // Process weekly data
      const weeklyData = processWeeklyData(data.data);
      
      // Calculate metrics
      const totalEntries = weeklyData.reduce((sum, d) => sum + d.entries, 0);
      const avgDaily = Math.round(totalEntries / 7);
      
      // Find peak day
      const peakDayData = weeklyData.reduce((max, d) => d.entries > max.entries ? d : max, weeklyData[0]);
      const peakDay = peakDayData.day;
      
      // Calculate trend (compare last 3 days to previous 3 days)
      const recent = weeklyData.slice(-3).reduce((sum, d) => sum + d.entries, 0);
      const previous = weeklyData.slice(0, 3).reduce((sum, d) => sum + d.entries, 0);
      const trend = previous > 0 ? Math.round(((recent - previous) / previous) * 100) : 0;
      
      // Calculate traffic score (0-100 based on performance)
      const maxPossibleDaily = 200; // Adjust based on venue capacity
      const score = Math.min(100, Math.round((avgDaily / maxPossibleDaily) * 100));

      setTrafficMetrics({
        score,
        trend,
        trendDirection: trend > 5 ? 'up' : trend < -5 ? 'down' : 'flat',
        peakDay,
        peakHour: '9 PM', // TODO: Calculate from hourly data
        weeklyData,
        totalEntries,
        avgDaily,
      });
      
    } catch (e) {
      console.error('Error loading traffic data:', e);
      setTrafficMetrics({
        score: 0,
        trend: 0,
        trendDirection: 'flat',
        peakDay: '--',
        peakHour: '--',
        weeklyData: getEmptyWeeklyData(),
        totalEntries: 0,
        avgDaily: 0,
      });
    }
  };

  // Load engagement data (dwell time, genres)
  const loadEngagementData = async () => {
    try {
      // Get genre stats from song log
      const genreStats = songLogService.getGenreStats();
      const topGenres = genreStats.slice(0, 4).map(g => ({
        name: g.genre,
        percent: g.percentage,
      }));

      // Get dwell time from API if available
      let avgDwellTime = 0;
      try {
        const occupancy = await apiService.getOccupancyMetrics(venueId);
        if (occupancy?.averageDwellTime) {
          avgDwellTime = occupancy.averageDwellTime;
        }
      } catch (e) {
        // Use fallback
        avgDwellTime = 42; // Default estimate
      }

      // Calculate engagement score
      const dwellScore = Math.min(50, (avgDwellTime / 60) * 50);
      const genreScore = topGenres.length > 0 ? 25 : 0;
      const baseScore = 25;
      const score = Math.round(baseScore + dwellScore + genreScore);

      // Engagement factors based on data
      const factors: { icon: string; label: string; bonus: string }[] = [];
      
      if (topGenres.length > 0) {
        factors.push({
          icon: '🎵',
          label: `${topGenres[0].name} music`,
          bonus: '+15 min',
        });
      }
      
      factors.push({
        icon: '🏈',
        label: 'Game days',
        bonus: '+12 min',
      });
      
      factors.push({
        icon: '🍺',
        label: 'Happy hour',
        bonus: '+8 min',
      });

      setEngagementMetrics({
        score,
        trend: 8, // TODO: Calculate from historical
        trendDirection: 'up',
        avgDwellTime,
        topGenres: topGenres.length > 0 ? topGenres : [
          { name: 'Country', percent: 34 },
          { name: 'Rock', percent: 28 },
          { name: 'Pop', percent: 22 },
          { name: 'Other', percent: 16 },
        ],
        engagementFactors: factors,
      });

    } catch (e) {
      console.error('Error loading engagement data:', e);
    }
  };

  // Load sports games
  const loadSportsData = async () => {
    try {
      const games = await sportsService.getGames();
      const upcoming = games.filter(g => g.status === 'scheduled' || g.status === 'live');
      setUpcomingGames(upcoming.slice(0, 5));
    } catch (e) {
      console.error('Error loading sports data:', e);
    }
  };

  // Load holiday data
  const loadHolidayData = async () => {
    try {
      const holidays = holidayService.getUpcomingHolidays(3);
      if (holidays.length > 0) {
        const daysUntil = holidayService.getDaysUntil(holidays[0]);
        setNextHoliday({ 
          name: holidays[0].name, 
          daysUntil,
          tips: holidays[0].tips || [],
        });
      }
    } catch (e) {
      console.error('Error loading holiday data:', e);
    }
  };

  // Generate dynamic insights based on data
  const generateInsights = () => {
    const newInsights: InsightData[] = [];

    // Opportunity: Upcoming games
    if (upcomingGames.length > 0) {
      const bigGame = upcomingGames.find(g => 
        g.homeTeam.includes('Cowboys') || g.homeTeam.includes('Eagles') ||
        g.awayTeam.includes('Cowboys') || g.awayTeam.includes('Eagles')
      ) || upcomingGames[0];
      
      const gameTime = new Date(bigGame.startTime);
      const timeStr = gameTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      const dayStr = gameTime.toLocaleDateString('en-US', { weekday: 'long' });
      
      newInsights.push({
        type: 'opportunity',
        title: `${bigGame.sport} Game ${dayStr}`,
        subtitle: `${bigGame.awayTeam} vs ${bigGame.homeTeam} · ${timeStr}`,
        description: 'Sports bars see +40% traffic during big games',
      });
    }

    // Winning: Best performing day/time
    if (trafficMetrics && trafficMetrics.peakDay !== '--') {
      const topGenre = engagementMetrics?.topGenres[0]?.name || 'your music';
      newInsights.push({
        type: 'winning',
        title: `${trafficMetrics.peakDay} nights are your superpower`,
        subtitle: `${trafficMetrics.peakHour} · ${topGenre} · Peak traffic`,
      });
    }

    // Watch: Areas needing attention
    if (trafficMetrics && trafficMetrics.weeklyData.length > 0) {
      const worstDay = trafficMetrics.weeklyData.reduce((min, d) => 
        d.entries < min.entries ? d : min, trafficMetrics.weeklyData[0]
      );
      
      if (worstDay.entries < trafficMetrics.avgDaily * 0.5) {
        newInsights.push({
          type: 'watch',
          title: `${worstDay.day} traffic is below average`,
          subtitle: 'Consider a weekly special, trivia, or live music',
        });
      }
    }

    // Holiday opportunity
    if (nextHoliday && nextHoliday.daysUntil <= 14) {
      newInsights.push({
        type: 'opportunity',
        title: `${nextHoliday.name} in ${nextHoliday.daysUntil} days`,
        subtitle: nextHoliday.tips[0] || 'Plan staffing and promotions ahead',
      });
    }

    setInsights(newInsights);

    // Calculate overall venue score
    calculateVenueScore();
  };

  // Calculate venue score based on all metrics
  const calculateVenueScore = () => {
    let score = 50; // Base
    
    // Reviews contribution (0-25 points)
    if (reviewsData) {
      score += Math.min(25, (reviewsData.rating / 5) * 25);
    }
    
    // Traffic contribution (0-25 points)
    if (trafficMetrics) {
      score += Math.min(25, (trafficMetrics.score / 100) * 25);
    }
    
    // Engagement contribution (0-25 points)
    if (engagementMetrics) {
      score += Math.min(25, (engagementMetrics.score / 100) * 25);
    }
    
    // Trend bonus (-10 to +10)
    const avgTrend = (
      (trafficMetrics?.trend || 0) + 
      (engagementMetrics?.trend || 0)
    ) / 2;
    score += Math.max(-10, Math.min(10, avgTrend / 2));
    
    setVenueScore(Math.round(Math.min(100, Math.max(0, score))));
    setScoreTrend(Math.round(avgTrend));
  };

  // Re-calculate when metrics change
  useEffect(() => {
    if (trafficMetrics || engagementMetrics || reviewsData) {
      generateInsights();
    }
  }, [trafficMetrics, engagementMetrics, reviewsData, upcomingGames]);

  // Helper: Process historical data into weekly format
  const processWeeklyData = (data: any[]): WeeklyData[] => {
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const weekData: WeeklyData[] = [];
    
    // Group by day
    const byDay: { [key: string]: { entries: number; exits: number; date: Date } } = {};
    
    data.forEach(item => {
      const date = new Date(item.timestamp);
      const dayKey = date.toDateString();
      
      if (!byDay[dayKey]) {
        byDay[dayKey] = { entries: 0, exits: 0, date };
      }
      
      if (item.occupancy) {
        byDay[dayKey].entries += item.occupancy.entries || 0;
        byDay[dayKey].exits += item.occupancy.exits || 0;
      }
    });

    // Convert to array and sort by date
    const sortedDays = Object.values(byDay).sort((a, b) => 
      a.date.getTime() - b.date.getTime()
    );

    // Take last 7 days
    const last7 = sortedDays.slice(-7);
    
    last7.forEach(day => {
      const maxEntries = Math.max(...last7.map(d => d.entries), 1);
      weekData.push({
        day: dayNames[day.date.getDay()],
        value: Math.round((day.entries / maxEntries) * 100),
        date: day.date,
        entries: day.entries,
        exits: day.exits,
      });
    });

    // Ensure we have 7 days
    while (weekData.length < 7) {
      weekData.unshift({
        day: dayNames[(weekData[0]?.date.getDay() - 1 + 7) % 7] || '--',
        value: 0,
        date: new Date(),
        entries: 0,
        exits: 0,
      });
    }

    return weekData;
  };

  // Helper: Get empty weekly data
  const getEmptyWeeklyData = (): WeeklyData[] => {
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return dayNames.map(day => ({
      day,
      value: 0,
      date: new Date(),
      entries: 0,
      exits: 0,
    }));
  };

  // UI Helpers
  const getScoreColor = (score: number) => {
    if (score >= 67) return COLORS.reputation;
    if (score >= 34) return COLORS.amber;
    return COLORS.warning;
  };

  const getScoreLabel = (score: number) => {
    if (score >= 80) return 'Thriving';
    if (score >= 67) return 'Performing above average';
    if (score >= 50) return 'Steady performance';
    if (score >= 34) return 'Room for improvement';
    return 'Needs attention';
  };

  const getTrendIcon = (direction: 'up' | 'down' | 'flat') => {
    switch (direction) {
      case 'up': return <TrendingUp className="w-4 h-4" />;
      case 'down': return <TrendingDown className="w-4 h-4" />;
      default: return <Minus className="w-4 h-4" />;
    }
  };

  const scoreColor = getScoreColor(animatedScore);

  // Loading state
  if (loading) {
    return (
      <div className="max-w-4xl mx-auto flex items-center justify-center min-h-[60vh]" style={{ background: COLORS.black }}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 mx-auto mb-4" style={{ borderColor: COLORS.traffic }} />
          <p style={{ color: COLORS.neutral }}>Loading insights...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto" style={{ background: COLORS.black, minHeight: '100vh' }}>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="pb-24"
      >
        {/* Header with Refresh */}
        <div className="flex items-center justify-between px-4 pt-4">
          <h1 className="text-xl font-bold" style={{ color: COLORS.white }}>Insights</h1>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="p-2 rounded-lg transition-all"
            style={{ background: COLORS.cardBg }}
          >
            <RefreshCw 
              className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`} 
              style={{ color: COLORS.neutral }} 
            />
          </button>
        </div>

        {/* Hero: Venue Pulse Score */}
        <div className="flex flex-col items-center pt-6 pb-10">
          {/* Score Ring */}
          <div className="relative w-48 h-48 mb-6">
            <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
              <circle
                cx="50"
                cy="50"
                r="42"
                fill="none"
                stroke={COLORS.cardBg}
                strokeWidth="8"
              />
              <motion.circle
                cx="50"
                cy="50"
                r="42"
                fill="none"
                stroke={scoreColor}
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={`${(animatedScore / 100) * 264} 264`}
                initial={{ strokeDasharray: '0 264' }}
                animate={{ strokeDasharray: `${(animatedScore / 100) * 264} 264` }}
                transition={{ duration: 1.5, ease: 'easeOut' }}
                style={{ filter: `drop-shadow(0 0 10px ${scoreColor}40)` }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <motion.span 
                className="text-5xl font-bold"
                style={{ color: COLORS.white }}
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.3 }}
              >
                {animatedScore}
              </motion.span>
              <span className="text-xs font-medium tracking-wider" style={{ color: COLORS.neutral }}>
                VENUE PULSE
              </span>
            </div>
          </div>
          
          <motion.p 
            className="text-base font-medium mb-1"
            style={{ color: COLORS.white }}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
          >
            {getScoreLabel(animatedScore)}
          </motion.p>
          <motion.div 
            className="flex items-center gap-1 text-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.7 }}
          >
            {scoreTrend !== 0 && (
              <>
                <span style={{ color: scoreTrend > 0 ? COLORS.reputation : COLORS.warning }}>
                  {getTrendIcon(scoreTrend > 0 ? 'up' : 'down')}
                </span>
                <span style={{ color: scoreTrend > 0 ? COLORS.reputation : COLORS.warning }}>
                  {scoreTrend > 0 ? '↑' : '↓'} {Math.abs(scoreTrend)}%
                </span>
                <span style={{ color: COLORS.neutral }}>vs last week</span>
              </>
            )}
          </motion.div>
        </div>

        {/* Three Metric Cards */}
        <div className="px-4 mb-8">
          <div className="grid grid-cols-3 gap-3">
            <MetricCard
              type="traffic"
              label="TRAFFIC"
              value={trafficMetrics?.score.toString() || '--'}
              subtext={trafficMetrics?.trendDirection === 'up' ? `↑ ${trafficMetrics.trend}%` : 
                       trafficMetrics?.trendDirection === 'down' ? `↓ ${Math.abs(trafficMetrics.trend)}%` : '--'}
              subLabel={trafficMetrics ? `${trafficMetrics.avgDaily}/day avg` : 'No data'}
              color={COLORS.traffic}
              onClick={() => setExpandedMetric('traffic')}
            />
            <MetricCard
              type="reputation"
              label="REPUTATION"
              value={reviewsData?.rating.toFixed(1) || '--'}
              subtext={reviewsData ? '★'.repeat(Math.round(reviewsData.rating)) : '--'}
              subLabel={reviewsData ? `${reviewsData.reviewCount} reviews` : 'Not configured'}
              color={COLORS.reputation}
              onClick={() => setExpandedMetric('reputation')}
            />
            <MetricCard
              type="engagement"
              label="ENGAGEMENT"
              value={engagementMetrics?.score.toString() || '--'}
              subtext={engagementMetrics?.trendDirection === 'up' ? `↑ ${engagementMetrics.trend}%` : '--'}
              subLabel={engagementMetrics ? `${engagementMetrics.avgDwellTime} min avg` : 'No data'}
              color={COLORS.engagement}
              onClick={() => setExpandedMetric('engagement')}
            />
          </div>
        </div>

        {/* Weekly Timeline */}
        {trafficMetrics && (
          <div className="px-4 mb-8">
            <div className="p-4 rounded-2xl" style={{ background: COLORS.cardBg }}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold" style={{ color: COLORS.neutral }}>
                  THIS WEEK
                </h3>
                <span className="text-xs" style={{ color: COLORS.neutral }}>
                  {trafficMetrics.totalEntries} total visits
                </span>
              </div>
              <div className="flex justify-between items-end h-24">
                {trafficMetrics.weeklyData.map((day, i) => {
                  const height = Math.max(5, day.value);
                  const isToday = day.date.toDateString() === new Date().toDateString();
                  return (
                    <div key={i} className="flex flex-col items-center gap-2 flex-1">
                      <span className="text-[10px] font-bold" style={{ color: COLORS.white }}>
                        {day.entries > 0 ? day.entries : ''}
                      </span>
                      <div 
                        className="w-full max-w-[24px] rounded-t-md transition-all"
                        style={{ 
                          height: `${height}%`,
                          background: isToday 
                            ? COLORS.traffic 
                            : day.value >= 80 
                              ? COLORS.reputation 
                              : day.value >= 50 
                                ? COLORS.amber 
                                : COLORS.neutral,
                          opacity: isToday ? 1 : 0.6,
                        }}
                      />
                      <span 
                        className="text-xs font-medium"
                        style={{ color: isToday ? COLORS.white : COLORS.neutral }}
                      >
                        {day.day}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Insight Cards */}
        <div className="px-4 space-y-3 mb-8">
          {insights.length > 0 ? (
            insights.map((insight, i) => (
              <InsightCard key={i} {...insight} />
            ))
          ) : (
            <div 
              className="p-4 rounded-2xl text-center"
              style={{ background: COLORS.cardBg }}
            >
              <p className="text-sm" style={{ color: COLORS.neutral }}>
                Keep collecting data to unlock personalized insights
              </p>
            </div>
          )}
        </div>

        {/* Coach Tip */}
        <div className="px-4 mb-8">
          <div 
            className="p-5 rounded-2xl border"
            style={{ 
              background: 'linear-gradient(135deg, #1a1a1a 0%, #0d0d0d 100%)',
              borderColor: '#333',
            }}
          >
            <div className="flex items-start gap-4">
              <div 
                className="p-2 rounded-lg flex-shrink-0"
                style={{ background: `${COLORS.engagement}20` }}
              >
                <Lightbulb className="w-5 h-5" style={{ color: COLORS.engagement }} />
              </div>
              <div className="flex-1">
                <p className="text-sm leading-relaxed" style={{ color: COLORS.white }}>
                  {nextHoliday && nextHoliday.daysUntil <= 14 ? (
                    <>
                      <strong>{nextHoliday.name}</strong> is in {nextHoliday.daysUntil} days. 
                      {nextHoliday.tips[0] ? ` ${nextHoliday.tips[0]}` : ' Plan your staffing and promotions.'}
                    </>
                  ) : trafficMetrics?.peakDay ? (
                    <>
                      <strong>Pro tip:</strong> Your busiest day is {trafficMetrics.peakDay}. 
                      Consider adding staff during {trafficMetrics.peakHour} rush hours.
                    </>
                  ) : (
                    <>
                      <strong>Getting started:</strong> Keep your venue running to collect insights 
                      about your peak times and customer patterns.
                    </>
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="px-4">
          <div className="grid grid-cols-4 gap-2">
            <QuickStat 
              label="Top Genre" 
              value={engagementMetrics?.topGenres[0]?.name || '--'} 
            />
            <QuickStat 
              label="Peak Day" 
              value={trafficMetrics?.peakDay || '--'} 
            />
            <QuickStat 
              label="Avg Visit" 
              value={engagementMetrics ? `${engagementMetrics.avgDwellTime}m` : '--'} 
            />
            <QuickStat 
              label="Rating" 
              value={reviewsData ? `${reviewsData.rating.toFixed(1)}★` : '--'} 
            />
          </div>
        </div>

        {/* Expanded Metric Modal */}
        <AnimatePresence>
          {expandedMetric && (
            <MetricModal
              type={expandedMetric}
              onClose={() => setExpandedMetric(null)}
              reviewsData={reviewsData}
              trafficMetrics={trafficMetrics}
              engagementMetrics={engagementMetrics}
              venueName={venueName}
              venueId={venueId}
            />
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

// Metric Card Component
function MetricCard({ 
  type, 
  label, 
  value, 
  subtext, 
  subLabel, 
  color, 
  onClick 
}: {
  type: string;
  label: string;
  value: string;
  subtext: string;
  subLabel: string;
  color: string;
  onClick: () => void;
}) {
  return (
    <motion.button
      onClick={onClick}
      className="p-4 rounded-2xl text-left transition-all relative overflow-hidden"
      style={{ background: COLORS.cardBg }}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      <div 
        className="absolute inset-0 opacity-20"
        style={{
          background: `radial-gradient(circle at 50% 120%, ${color}40 0%, transparent 60%)`,
        }}
      />
      
      <div className="relative z-10">
        <span 
          className="text-[10px] font-semibold tracking-wider block mb-3"
          style={{ color: COLORS.neutral }}
        >
          {label}
        </span>
        <span 
          className="text-3xl font-bold block mb-1"
          style={{ color }}
        >
          {value}
        </span>
        <span 
          className="text-sm block mb-1"
          style={{ color: subtext.includes('↑') ? COLORS.reputation : subtext.includes('↓') ? COLORS.warning : color }}
        >
          {subtext}
        </span>
        <span 
          className="text-[10px] block"
          style={{ color: COLORS.neutral }}
        >
          {subLabel}
        </span>
        
        <ChevronRight 
          className="absolute bottom-4 right-3 w-4 h-4"
          style={{ color: COLORS.neutral }}
        />
      </div>
    </motion.button>
  );
}

// Insight Card Component
function InsightCard({ 
  type, 
  title, 
  subtitle, 
  description,
}: InsightData) {
  const colors = {
    opportunity: { bg: COLORS.traffic, border: `${COLORS.traffic}50` },
    winning: { bg: COLORS.reputation, border: `${COLORS.reputation}50` },
    watch: { bg: COLORS.amber, border: `${COLORS.amber}50` },
  };

  const labels = {
    opportunity: '🎯 OPPORTUNITY',
    winning: '✅ WINNING',
    watch: '⚠️ WATCH',
  };

  return (
    <motion.div
      className="p-4 rounded-2xl border-l-4"
      style={{ 
        background: COLORS.cardBg,
        borderLeftColor: colors[type].bg,
      }}
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      whileHover={{ x: 4 }}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <span 
            className="text-[10px] font-bold tracking-wider block mb-2"
            style={{ color: colors[type].bg }}
          >
            {labels[type]}
          </span>
          <h4 className="text-sm font-semibold mb-1" style={{ color: COLORS.white }}>
            {title}
          </h4>
          <p className="text-xs" style={{ color: COLORS.neutral }}>
            {subtitle}
          </p>
          {description && (
            <p className="text-xs mt-2" style={{ color: colors[type].bg }}>
              {description}
            </p>
          )}
        </div>
        <ChevronRight className="w-5 h-5 mt-1" style={{ color: COLORS.neutral }} />
      </div>
    </motion.div>
  );
}

// Quick Stat Component
function QuickStat({ label, value }: { label: string; value: string }) {
  return (
    <div 
      className="p-3 rounded-xl text-center"
      style={{ background: COLORS.cardBg }}
    >
      <span 
        className="text-[9px] font-semibold tracking-wider block mb-1"
        style={{ color: COLORS.neutral }}
      >
        {label}
      </span>
      <span 
        className="text-sm font-bold truncate block"
        style={{ color: COLORS.white }}
      >
        {value}
      </span>
    </div>
  );
}

// Metric Modal (Expanded View)
function MetricModal({ 
  type, 
  onClose, 
  reviewsData,
  trafficMetrics,
  engagementMetrics,
  venueName,
  venueId,
}: {
  type: MetricType;
  onClose: () => void;
  reviewsData: GoogleReviewsData | null;
  trafficMetrics: TrafficMetrics | null;
  engagementMetrics: EngagementMetrics | null;
  venueName: string;
  venueId: string;
}) {
  if (!type) return null;

  const config = {
    traffic: {
      color: COLORS.traffic,
      title: 'TRAFFIC',
      value: trafficMetrics?.score.toString() || '--',
      subtitle: trafficMetrics ? `${trafficMetrics.avgDaily} avg daily visitors` : 'No data available',
    },
    reputation: {
      color: COLORS.reputation,
      title: 'REPUTATION',
      value: reviewsData?.rating.toFixed(1) || '--',
      subtitle: reviewsData ? `${reviewsData.reviewCount} Google reviews` : 'Not configured',
    },
    engagement: {
      color: COLORS.engagement,
      title: 'ENGAGEMENT',
      value: engagementMetrics?.score.toString() || '--',
      subtitle: engagementMetrics ? `${engagementMetrics.avgDwellTime} min average visit` : 'No data available',
    },
  };

  const { color, title, value, subtitle } = config[type];

  const openGoogleMaps = () => {
    const address = venueSettingsService.getFormattedAddress(venueId) || '';
    const query = encodeURIComponent(`${venueName} ${address}`);
    window.open(`https://www.google.com/maps/search/${query}`, '_blank');
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className="absolute inset-0"
        style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)' }}
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />

      <motion.div
        className="relative w-full max-w-lg rounded-t-3xl overflow-hidden"
        style={{ background: COLORS.black, maxHeight: '90vh' }}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      >
        <div 
          className="flex items-center justify-between p-4 border-b"
          style={{ borderColor: '#222' }}
        >
          <button 
            onClick={onClose}
            className="flex items-center gap-2 text-sm"
            style={{ color: COLORS.white }}
          >
            ← {title}
          </button>
          <button onClick={onClose}>
            <X className="w-6 h-6" style={{ color: COLORS.neutral }} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto" style={{ maxHeight: 'calc(90vh - 60px)' }}>
          {/* Main Score */}
          <div className="text-center mb-8">
            <motion.span 
              className="text-6xl font-bold block mb-2"
              style={{ color }}
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
            >
              {value}{type === 'reputation' && value !== '--' && ' ★'}
            </motion.span>
            <span className="text-sm" style={{ color: COLORS.neutral }}>
              {subtitle}
            </span>
          </div>

          {/* Traffic Details */}
          {type === 'traffic' && trafficMetrics && (
            <>
              <div className="mb-6">
                <h4 className="text-xs font-semibold mb-4" style={{ color: COLORS.neutral }}>
                  THIS WEEK
                </h4>
                <div className="flex justify-between items-end h-32">
                  {trafficMetrics.weeklyData.map((day, i) => (
                    <div key={i} className="flex flex-col items-center gap-2 flex-1">
                      <span className="text-xs font-bold" style={{ color: COLORS.white }}>
                        {day.entries > 0 ? day.entries : ''}
                      </span>
                      <div 
                        className="w-8 rounded-t-md"
                        style={{ 
                          height: `${Math.max(5, day.value * 0.8)}px`,
                          background: day.value >= 80 ? color : `${color}60`,
                        }}
                      />
                      <span className="text-xs" style={{ color: COLORS.neutral }}>
                        {day.day}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mb-6">
                <h4 className="text-xs font-semibold mb-4" style={{ color: COLORS.neutral }}>
                  SUMMARY
                </h4>
                <div className="grid grid-cols-2 gap-3">
                  <StatBox label="Total Visitors" value={trafficMetrics.totalEntries.toString()} color={color} />
                  <StatBox label="Daily Average" value={trafficMetrics.avgDaily.toString()} color={color} />
                  <StatBox label="Peak Day" value={trafficMetrics.peakDay} color={color} />
                  <StatBox label="Weekly Trend" value={`${trafficMetrics.trend > 0 ? '+' : ''}${trafficMetrics.trend}%`} color={trafficMetrics.trend >= 0 ? COLORS.reputation : COLORS.warning} />
                </div>
              </div>

              <div 
                className="p-4 rounded-xl"
                style={{ background: `${color}15` }}
              >
                <div className="flex items-start gap-3">
                  <Lightbulb className="w-5 h-5 mt-0.5" style={{ color }} />
                  <div>
                    <h5 className="text-sm font-semibold mb-1" style={{ color: COLORS.white }}>
                      Insight
                    </h5>
                    <p className="text-xs" style={{ color: COLORS.neutral }}>
                      {trafficMetrics.peakDay} is your best day. Consider running promotions on slower days to balance traffic.
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Reputation Details */}
          {type === 'reputation' && (
            <>
              {reviewsData ? (
                <>
                  <div className="mb-6 p-4 rounded-xl" style={{ background: COLORS.cardBg }}>
                    <h4 className="text-xs font-semibold mb-3" style={{ color: COLORS.neutral }}>
                      RATING QUALITY
                    </h4>
                    <div className="flex items-center gap-3">
                      {reviewsData.rating >= 4.5 ? (
                        <>
                          <CheckCircle className="w-5 h-5" style={{ color: COLORS.reputation }} />
                          <span style={{ color: COLORS.white }}>Excellent rating!</span>
                        </>
                      ) : reviewsData.rating >= 4.0 ? (
                        <>
                          <TrendingUp className="w-5 h-5" style={{ color: COLORS.amber }} />
                          <span style={{ color: COLORS.white }}>Good rating - room to grow</span>
                        </>
                      ) : (
                        <>
                          <AlertTriangle className="w-5 h-5" style={{ color: COLORS.warning }} />
                          <span style={{ color: COLORS.white }}>Needs attention</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="mb-6">
                    <h4 className="text-xs font-semibold mb-4" style={{ color: COLORS.neutral }}>
                      AT A GLANCE
                    </h4>
                    <div className="grid grid-cols-2 gap-3">
                      <StatBox label="Rating" value={`${reviewsData.rating.toFixed(1)} ★`} color={color} />
                      <StatBox label="Total Reviews" value={reviewsData.reviewCount.toString()} color={color} />
                      {reviewsData.priceLevel && (
                        <StatBox label="Price Level" value={reviewsData.priceLevel} color={color} />
                      )}
                    </div>
                  </div>

                  <button 
                    className="w-full p-4 rounded-xl flex items-center justify-center gap-2"
                    style={{ background: COLORS.cardBg }}
                    onClick={openGoogleMaps}
                  >
                    <span style={{ color: COLORS.white }}>View on Google Maps</span>
                    <ExternalLink className="w-4 h-4" style={{ color: COLORS.neutral }} />
                  </button>
                </>
              ) : (
                <div className="text-center py-8">
                  <Star className="w-12 h-12 mx-auto mb-4" style={{ color: COLORS.neutral }} />
                  <p style={{ color: COLORS.neutral }}>
                    Configure your venue address in Settings to see Google Reviews
                  </p>
                </div>
              )}
            </>
          )}

          {/* Engagement Details */}
          {type === 'engagement' && engagementMetrics && (
            <>
              <div className="mb-6 text-center">
                <h4 className="text-xs font-semibold mb-4" style={{ color: COLORS.neutral }}>
                  AVERAGE DWELL TIME
                </h4>
                <span className="text-4xl font-bold" style={{ color: COLORS.white }}>
                  {engagementMetrics.avgDwellTime} min
                </span>
                <p className="text-xs mt-2" style={{ color: COLORS.neutral }}>
                  (industry avg: 38 min)
                </p>
              </div>

              <div className="mb-6">
                <h4 className="text-xs font-semibold mb-4" style={{ color: COLORS.neutral }}>
                  WHAT KEEPS CUSTOMERS
                </h4>
                <div className="space-y-3">
                  {engagementMetrics.engagementFactors.map((factor, i) => (
                    <div 
                      key={i}
                      className="flex items-center justify-between p-3 rounded-lg"
                      style={{ background: COLORS.cardBg }}
                    >
                      <span style={{ color: COLORS.white }}>
                        {factor.icon} {factor.label}
                      </span>
                      <span className="text-sm font-bold" style={{ color }}>
                        {factor.bonus}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-4 rounded-xl" style={{ background: COLORS.cardBg }}>
                <h4 className="text-xs font-semibold mb-3" style={{ color: COLORS.neutral }}>
                  TOP GENRES PLAYED
                </h4>
                <div className="flex flex-wrap gap-2">
                  {engagementMetrics.topGenres.map((genre, i) => (
                    <span 
                      key={i}
                      className="px-3 py-1 rounded-full text-xs font-medium"
                      style={{ 
                        background: i === 0 ? `${color}30` : COLORS.cardBg,
                        color: i === 0 ? color : COLORS.neutral,
                        border: `1px solid ${i === 0 ? color : COLORS.neutral}30`,
                      }}
                    >
                      {genre.name} {genre.percent}%
                    </span>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// Stat Box Component
function StatBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div 
      className="p-3 rounded-xl text-center"
      style={{ background: COLORS.cardBg }}
    >
      <span 
        className="text-[10px] font-semibold tracking-wider block mb-1"
        style={{ color: COLORS.neutral }}
      >
        {label}
      </span>
      <span 
        className="text-lg font-bold"
        style={{ color }}
      >
        {value}
      </span>
    </div>
  );
}

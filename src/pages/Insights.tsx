import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  X,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Star,
  Lightbulb,
  CheckCircle,
  AlertTriangle,
  ExternalLink,
  RefreshCw,
  Music,
} from 'lucide-react';
import googleReviewsService, { GoogleReviewsData } from '../services/google-reviews.service';
import authService from '../services/auth.service';
import venueSettingsService from '../services/venue-settings.service';
import holidayService from '../services/holiday.service';
import sportsService from '../services/sports.service';
import songLogService, { GenreStats } from '../services/song-log.service';
import apiService from '../services/api.service';
import type { SportsGame, OccupancyMetrics, SensorData } from '../types';

// WHOOP Color Palette
const COLORS = {
  black: '#000000',
  cardBg: '#1a1a1a',
  traffic: '#0085FF',
  reputation: '#00D084',
  engagement: '#8B5CF6',
  warning: '#FF4444',
  amber: '#FFAA00',
  neutral: '#6B6B6B',
  white: '#FFFFFF',
};

type MetricType = 'traffic' | 'reputation' | 'engagement' | null;

interface WeeklyData {
  day: string;
  shortDay: string;
  value: number;
  date: Date;
  entries: number;
  exits: number;
  peak: number;
}

interface HourlyData {
  hour: number;
  label: string;
  entries: number;
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
  hourlyData: HourlyData[];
  totalEntries: number;
  totalExits: number;
  avgDaily: number;
  currentOccupancy: number;
}

interface EngagementMetrics {
  score: number;
  trend: number;
  trendDirection: 'up' | 'down' | 'flat';
  avgDwellTime: number;
  topGenres: GenreStats[];
  totalSongsPlayed: number;
}

export function Insights() {
  const [expandedMetric, setExpandedMetric] = useState<MetricType>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  // Core metrics
  const [venueScore, setVenueScore] = useState(0);
  const [animatedScore, setAnimatedScore] = useState(0);
  const [scoreTrend, setScoreTrend] = useState(0);
  
  // Data from services
  const [reviewsData, setReviewsData] = useState<GoogleReviewsData | null>(null);
  const [trafficMetrics, setTrafficMetrics] = useState<TrafficMetrics | null>(null);
  const [engagementMetrics, setEngagementMetrics] = useState<EngagementMetrics | null>(null);
  const [occupancyMetrics, setOccupancyMetrics] = useState<OccupancyMetrics | null>(null);
  const [upcomingGames, setUpcomingGames] = useState<SportsGame[]>([]);
  const [insights, setInsights] = useState<InsightData[]>([]);
  const [nextHoliday, setNextHoliday] = useState<{ name: string; daysUntil: number; tip: string } | null>(null);
  
  // Keep refs for data that needs to be accessed synchronously
  const dataRef = useRef<{
    reviews: GoogleReviewsData | null;
    traffic: TrafficMetrics | null;
    engagement: EngagementMetrics | null;
    occupancy: OccupancyMetrics | null;
    games: SportsGame[];
    holiday: { name: string; daysUntil: number; tip: string } | null;
  }>({
    reviews: null,
    traffic: null,
    engagement: null,
    occupancy: null,
    games: [],
    holiday: null,
  });

  const user = authService.getStoredUser();
  const venueName = user?.venueName || 'Your Venue';
  const venueId = user?.venueId || '';

  // Load all data on mount
  useEffect(() => {
    if (venueId) {
      loadAllData();
    } else {
      setLoading(false);
    }
  }, [venueId]);

  // Animate score when it changes
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
    console.log('📊 Insights: Loading all data...');
    
    try {
      // Load all data in parallel - don't fail if some services error
      const results = await Promise.allSettled([
        loadReviewsData(),
        loadHistoricalData(),
        loadOccupancyMetrics(),
        loadSportsData(),
        loadGenreData(),
      ]);

      // Load holiday data (sync)
      loadHolidayData();

      // Log results
      console.log('📊 Insights: Data loading results:', results.map((r, i) => ({
        index: i,
        status: r.status,
        value: r.status === 'fulfilled' ? (r.value ? 'has data' : 'no data') : 'failed'
      })));

      // Calculate final scores after all data is loaded
      calculateFinalScores();

    } catch (error) {
      console.error('📊 Insights: Error in loadAllData:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadAllData();
    setRefreshing(false);
  };

  // Load Google Reviews
  const loadReviewsData = async (): Promise<GoogleReviewsData | null> => {
    try {
      const address = venueSettingsService.getFormattedAddress(venueId) || '';
      console.log('📊 Loading reviews for:', venueName, address);
      const reviews = await googleReviewsService.getReviews(venueName, address, venueId);
      if (reviews) {
        console.log('📊 Reviews loaded:', reviews.rating, 'stars');
        setReviewsData(reviews);
        dataRef.current.reviews = reviews;
        return reviews;
      }
    } catch (e) {
      console.error('📊 Error loading reviews:', e);
    }
    return null;
  };

  // Load historical sensor data and process it
  const loadHistoricalData = async (): Promise<TrafficMetrics | null> => {
    try {
      console.log('📊 Loading historical data for venue:', venueId);
      const data = await apiService.getHistoricalData(venueId, '7d');
      
      if (data?.data && data.data.length > 0) {
        console.log('📊 Historical data loaded:', data.data.length, 'readings');
        const traffic = processTrafficData(data.data);
        return traffic;
      } else {
        console.log('📊 No historical data found');
      }
    } catch (e) {
      console.error('📊 Error loading historical data:', e);
    }
    return null;
  };

  // Load occupancy metrics and process engagement
  const loadOccupancyMetrics = async (): Promise<OccupancyMetrics | null> => {
    try {
      console.log('📊 Loading occupancy metrics for venue:', venueId);
      const metrics = await apiService.getOccupancyMetrics(venueId);
      console.log('📊 Occupancy metrics loaded:', metrics);
      setOccupancyMetrics(metrics);
      dataRef.current.occupancy = metrics;
      return metrics;
    } catch (e) {
      console.error('📊 Error loading occupancy metrics:', e);
    }
    return null;
  };

  // Load sports games
  const loadSportsData = async (): Promise<SportsGame[]> => {
    try {
      const games = await sportsService.getGames();
      const upcoming = games.filter(g => g.status === 'scheduled' || g.status === 'live');
      console.log('📊 Sports games loaded:', upcoming.length, 'upcoming');
      setUpcomingGames(upcoming.slice(0, 5));
      dataRef.current.games = upcoming.slice(0, 5);
      return upcoming;
    } catch (e) {
      console.error('📊 Error loading sports data:', e);
    }
    return [];
  };

  // Load genre data and calculate engagement
  const loadGenreData = async (): Promise<GenreStats[]> => {
    try {
      console.log('📊 Loading genre data...');
      // First ensure songs are loaded from DynamoDB
      await songLogService.fetchSongsFromDynamoDB(30);
      // Then get genre stats
      const genres = await songLogService.getGenreStats(10, '30d');
      console.log('📊 Genre stats loaded:', genres.length, 'genres');
      
      // Get total songs
      const songs = songLogService.getSongs();
      
      // Create engagement metrics
      const engagement: EngagementMetrics = {
        score: 50, // Base score
        trend: 0,
        trendDirection: 'flat',
        avgDwellTime: dataRef.current.occupancy?.avgDwellTimeMinutes || 0,
        topGenres: genres.slice(0, 5),
        totalSongsPlayed: songs.length,
      };
      
      // Calculate engagement score
      let score = 40;
      
      // Dwell time contribution (0-30 points)
      if (engagement.avgDwellTime > 0) {
        score += Math.min(30, (engagement.avgDwellTime / 60) * 30);
      }
      
      // Genre diversity (0-15 points)
      if (genres.length >= 5) score += 15;
      else if (genres.length >= 3) score += 10;
      else if (genres.length >= 1) score += 5;
      
      // Songs played bonus (0-15 points)
      if (songs.length >= 100) score += 15;
      else if (songs.length >= 50) score += 10;
      else if (songs.length >= 10) score += 5;
      
      engagement.score = Math.round(Math.min(100, score));
      
      setEngagementMetrics(engagement);
      dataRef.current.engagement = engagement;
      
      return genres;
    } catch (e) {
      console.error('📊 Error loading genre data:', e);
    }
    return [];
  };

  // Load holiday data
  const loadHolidayData = () => {
    try {
      const holidays = holidayService.getUpcomingHolidays(60);
      if (holidays.length > 0) {
        const daysUntil = holidayService.getDaysUntil(holidays[0]);
        const holiday = { 
          name: holidays[0].name, 
          daysUntil,
          tip: holidays[0].tips || '',
        };
        setNextHoliday(holiday);
        dataRef.current.holiday = holiday;
        console.log('📊 Next holiday:', holiday.name, 'in', daysUntil, 'days');
      }
    } catch (e) {
      console.error('📊 Error loading holiday data:', e);
    }
  };

  // Process historical data into traffic metrics
  const processTrafficData = (data: SensorData[]): TrafficMetrics | null => {
    if (!data || data.length === 0) {
      console.log('📊 No data to process for traffic');
      return null;
    }

    console.log('📊 Processing', data.length, 'sensor readings for traffic');

    // Group by day
    const byDay = new Map<string, { date: Date; entries: number; exits: number; peak: number; readings: number }>();
    const byHour = new Map<number, { entries: number; count: number }>();
    
    data.forEach(item => {
      const date = new Date(item.timestamp);
      const dayKey = date.toDateString();
      const hour = date.getHours();
      
      // Daily aggregation
      if (!byDay.has(dayKey)) {
        byDay.set(dayKey, { date, entries: 0, exits: 0, peak: 0, readings: 0 });
      }
      const dayData = byDay.get(dayKey)!;
      
      if (item.occupancy) {
        dayData.entries += item.occupancy.entries || 0;
        dayData.exits += item.occupancy.exits || 0;
        dayData.peak = Math.max(dayData.peak, item.occupancy.current || 0);
      }
      dayData.readings++;
      
      // Hourly aggregation
      if (!byHour.has(hour)) {
        byHour.set(hour, { entries: 0, count: 0 });
      }
      const hourData = byHour.get(hour)!;
      if (item.occupancy) {
        hourData.entries += item.occupancy.entries || 0;
      }
      hourData.count++;
    });

    // Convert to arrays
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const sortedDays = Array.from(byDay.values())
      .sort((a, b) => a.date.getTime() - b.date.getTime());
    
    // Take last 7 days
    const last7Days = sortedDays.slice(-7);
    const maxEntries = Math.max(...last7Days.map(d => d.entries), 1);
    
    const weeklyData: WeeklyData[] = last7Days.map(day => ({
      day: dayNames[day.date.getDay()],
      shortDay: dayNames[day.date.getDay()].substring(0, 1),
      value: Math.round((day.entries / maxEntries) * 100),
      date: day.date,
      entries: day.entries,
      exits: day.exits,
      peak: day.peak,
    }));

    // Pad to 7 days if needed
    while (weeklyData.length < 7) {
      const prevDate = weeklyData.length > 0 
        ? new Date(weeklyData[0].date.getTime() - 24 * 60 * 60 * 1000)
        : new Date();
      weeklyData.unshift({
        day: dayNames[prevDate.getDay()],
        shortDay: dayNames[prevDate.getDay()].substring(0, 1),
        value: 0,
        date: prevDate,
        entries: 0,
        exits: 0,
        peak: 0,
      });
    }

    // Calculate hourly data
    const hourlyData: HourlyData[] = [];
    for (let h = 0; h < 24; h++) {
      const hourInfo = byHour.get(h);
      hourlyData.push({
        hour: h,
        label: h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`,
        entries: hourInfo ? Math.round(hourInfo.entries / Math.max(hourInfo.count, 1)) : 0,
      });
    }

    // Find peak day and hour
    const peakDayData = weeklyData.reduce((max, d) => d.entries > max.entries ? d : max, weeklyData[0]);
    const peakHourData = hourlyData.reduce((max, h) => h.entries > max.entries ? h : max, hourlyData[0]);
    
    // Calculate totals
    const totalEntries = weeklyData.reduce((sum, d) => sum + d.entries, 0);
    const totalExits = weeklyData.reduce((sum, d) => sum + d.exits, 0);
    const avgDaily = Math.round(totalEntries / 7);
    
    // Calculate trend (last 3 days vs first 3 days)
    const recent = weeklyData.slice(-3).reduce((sum, d) => sum + d.entries, 0);
    const previous = weeklyData.slice(0, 3).reduce((sum, d) => sum + d.entries, 0);
    const trend = previous > 0 ? Math.round(((recent - previous) / previous) * 100) : 0;
    
    // Calculate score (normalized 0-100)
    const hasRealData = totalEntries > 0;
    let score = 50; // Base score
    if (hasRealData) {
      const maxDailyCapacity = 200;
      score = Math.min(100, Math.round((avgDaily / maxDailyCapacity) * 100));
    }
    
    // Current occupancy from most recent data point
    const currentOccupancy = data[data.length - 1]?.occupancy?.current || 0;

    const traffic: TrafficMetrics = {
      score,
      trend,
      trendDirection: trend > 5 ? 'up' : trend < -5 ? 'down' : 'flat',
      peakDay: peakDayData?.day || 'Sat',
      peakHour: peakHourData?.label || '9p',
      weeklyData,
      hourlyData,
      totalEntries,
      totalExits,
      avgDaily,
      currentOccupancy,
    };

    setTrafficMetrics(traffic);
    dataRef.current.traffic = traffic;
    
    console.log('📊 Traffic metrics calculated:', traffic);
    return traffic;
  };

  // Calculate final scores after all data is loaded
  const calculateFinalScores = useCallback(() => {
    console.log('📊 Calculating final scores with data:', {
      reviews: dataRef.current.reviews ? 'yes' : 'no',
      traffic: dataRef.current.traffic ? 'yes' : 'no',
      engagement: dataRef.current.engagement ? 'yes' : 'no',
      occupancy: dataRef.current.occupancy ? 'yes' : 'no',
    });

    let score = 50; // Base score - everyone starts at 50
    let trendSum = 0;
    let trendCount = 0;

    // Reviews contribution (0-25 points)
    if (dataRef.current.reviews && dataRef.current.reviews.rating > 0) {
      const reviewBonus = (dataRef.current.reviews.rating / 5) * 25;
      score += reviewBonus;
      console.log('📊 Review bonus:', reviewBonus);
    }

    // Traffic contribution (0-15 points)
    if (dataRef.current.traffic) {
      const trafficBonus = (dataRef.current.traffic.score / 100) * 15;
      score += trafficBonus;
      console.log('📊 Traffic bonus:', trafficBonus);
      if (dataRef.current.traffic.trend !== 0) {
        trendSum += dataRef.current.traffic.trend;
        trendCount++;
      }
    }

    // Engagement contribution (0-10 points)
    if (dataRef.current.engagement) {
      const engagementBonus = (dataRef.current.engagement.score / 100) * 10;
      score += engagementBonus;
      console.log('📊 Engagement bonus:', engagementBonus);
    }

    // Occupancy health contribution - using averages
    if (dataRef.current.occupancy) {
      const occ = dataRef.current.occupancy;
      // If 7-day avg > 30-day avg, venue is growing
      if (occ.sevenDayAvg > 0 && occ.thirtyDayAvg > 0) {
        const occupancyTrend = (occ.sevenDayAvg / occ.thirtyDayAvg) - 1;
        if (occupancyTrend > 0) {
          score += Math.min(5, occupancyTrend * 50);
        }
        trendSum += occupancyTrend * 100;
        trendCount++;
      }
    }

    const finalScore = Math.round(Math.min(100, Math.max(0, score)));
    const avgTrend = trendCount > 0 ? Math.round(trendSum / trendCount) : 0;

    console.log('📊 Final venue score:', finalScore, 'trend:', avgTrend);

    setVenueScore(finalScore);
    setScoreTrend(avgTrend);

    // Generate insights
    generateInsights();
  }, []);

  // Generate dynamic insights
  const generateInsights = () => {
    const newInsights: InsightData[] = [];
    const traffic = dataRef.current.traffic;
    const games = dataRef.current.games;
    const holiday = dataRef.current.holiday;

    // Opportunity: Upcoming games
    if (games.length > 0) {
      const nextGame = games[0];
      const gameTime = new Date(nextGame.startTime);
      const timeStr = gameTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      const dayStr = gameTime.toLocaleDateString('en-US', { weekday: 'short' });
      
      newInsights.push({
        type: 'opportunity',
        title: `${nextGame.sport}: ${nextGame.awayTeam} @ ${nextGame.homeTeam}`,
        subtitle: `${dayStr} at ${timeStr}`,
        description: 'Sports events drive +40% average traffic',
      });
    }

    // Opportunity: Upcoming holiday
    if (holiday && holiday.daysUntil <= 14 && holiday.daysUntil > 0) {
      newInsights.push({
        type: 'opportunity',
        title: `${holiday.name} in ${holiday.daysUntil} days`,
        subtitle: holiday.tip || 'Plan staffing and promotions',
      });
    }

    // Winning: Best performing day
    if (traffic && traffic.weeklyData.some(d => d.entries > 0)) {
      const peakDay = traffic.weeklyData.reduce((max, d) => 
        d.entries > max.entries ? d : max, 
        traffic.weeklyData[0]
      );
      if (peakDay.entries > 0) {
        newInsights.push({
          type: 'winning',
          title: `${peakDay.day} is your strongest day`,
          subtitle: `${peakDay.entries} visitors · Peak at ${traffic.peakHour}`,
        });
      }
    }

    // Watch: Underperforming days
    if (traffic && traffic.avgDaily > 0) {
      const worstDay = traffic.weeklyData
        .filter(d => d.entries >= 0)
        .reduce((min, d) => d.entries < min.entries ? d : min, 
          { ...traffic.weeklyData[0], entries: Infinity }
        );
      
      if (worstDay.entries !== Infinity && worstDay.entries < traffic.avgDaily * 0.5) {
        newInsights.push({
          type: 'watch',
          title: `${worstDay.day} is underperforming`,
          subtitle: `${worstDay.entries} visitors vs ${traffic.avgDaily} avg · Try a weekly special`,
        });
      }
    }

    setInsights(newInsights);
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
    return 'Building momentum';
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
        {/* Header */}
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
          <div className="relative w-48 h-48 mb-6">
            <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="42" fill="none" stroke={COLORS.cardBg} strokeWidth="8" />
              <motion.circle
                cx="50" cy="50" r="42"
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
          
          {scoreTrend !== 0 && (
            <motion.div 
              className="flex items-center gap-1 text-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.7 }}
            >
              {scoreTrend > 0 ? (
                <TrendingUp className="w-4 h-4" style={{ color: COLORS.reputation }} />
              ) : (
                <TrendingDown className="w-4 h-4" style={{ color: COLORS.warning }} />
              )}
              <span style={{ color: scoreTrend > 0 ? COLORS.reputation : COLORS.warning }}>
                {scoreTrend > 0 ? '+' : ''}{scoreTrend}%
              </span>
              <span style={{ color: COLORS.neutral }}>vs last week</span>
            </motion.div>
          )}
        </div>

        {/* Three Metric Cards */}
        <div className="px-4 mb-8">
          <div className="grid grid-cols-3 gap-3">
            <MetricCard
              label="TRAFFIC"
              value={trafficMetrics?.score?.toString() || '50'}
              subtext={trafficMetrics ? (
                trafficMetrics.trendDirection === 'up' ? `↑ ${trafficMetrics.trend}%` :
                trafficMetrics.trendDirection === 'down' ? `↓ ${Math.abs(trafficMetrics.trend)}%` : '―'
              ) : '―'}
              subLabel={trafficMetrics?.avgDaily ? `${trafficMetrics.avgDaily}/day` : 'Collecting data...'}
              color={COLORS.traffic}
              onClick={() => setExpandedMetric('traffic')}
            />
            <MetricCard
              label="REPUTATION"
              value={reviewsData?.rating ? reviewsData.rating.toFixed(1) : '―'}
              subtext={reviewsData?.rating ? '★'.repeat(Math.round(reviewsData.rating)) : ''}
              subLabel={reviewsData?.reviewCount ? `${reviewsData.reviewCount} reviews` : 'Set address in Settings'}
              color={COLORS.reputation}
              onClick={() => setExpandedMetric('reputation')}
            />
            <MetricCard
              label="ENGAGEMENT"
              value={engagementMetrics?.score?.toString() || '50'}
              subtext={engagementMetrics?.avgDwellTime ? `${engagementMetrics.avgDwellTime}m avg` : '―'}
              subLabel={engagementMetrics?.topGenres?.[0]?.genre || 'Analyzing music...'}
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
                  {trafficMetrics.totalEntries > 0 
                    ? `${trafficMetrics.totalEntries.toLocaleString()} total visitors`
                    : 'Collecting traffic data...'}
                </span>
              </div>
              <div className="flex justify-between items-end h-24">
                {trafficMetrics.weeklyData.map((day, i) => {
                  const height = Math.max(8, day.value);
                  const isToday = day.date.toDateString() === new Date().toDateString();
                  return (
                    <div key={i} className="flex flex-col items-center gap-2 flex-1">
                      {day.entries > 0 && (
                        <span className="text-[10px] font-bold" style={{ color: COLORS.white }}>
                          {day.entries}
                        </span>
                      )}
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
                          opacity: isToday ? 1 : 0.7,
                        }}
                      />
                      <span 
                        className="text-xs font-medium"
                        style={{ color: isToday ? COLORS.white : COLORS.neutral }}
                      >
                        {day.shortDay}
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
            <div className="p-4 rounded-2xl text-center" style={{ background: COLORS.cardBg }}>
              <p className="text-sm" style={{ color: COLORS.neutral }}>
                Collecting data to generate personalized insights...
              </p>
            </div>
          )}
        </div>

        {/* Coach Tip */}
        <div className="px-4 mb-8">
          <div 
            className="p-5 rounded-2xl border"
            style={{ background: 'linear-gradient(135deg, #1a1a1a 0%, #0d0d0d 100%)', borderColor: '#333' }}
          >
            <div className="flex items-start gap-4">
              <div className="p-2 rounded-lg flex-shrink-0" style={{ background: `${COLORS.engagement}20` }}>
                <Lightbulb className="w-5 h-5" style={{ color: COLORS.engagement }} />
              </div>
              <div className="flex-1">
                <p className="text-sm leading-relaxed" style={{ color: COLORS.white }}>
                  {nextHoliday && nextHoliday.daysUntil <= 7 ? (
                    <>
                      <strong>{nextHoliday.name}</strong> is in {nextHoliday.daysUntil} days. 
                      {nextHoliday.tip ? ` ${nextHoliday.tip}` : ' Plan your staffing and promotions.'}
                    </>
                  ) : trafficMetrics?.peakDay && trafficMetrics.peakHour ? (
                    <>
                      <strong>Peak times:</strong> {trafficMetrics.peakDay}s around {trafficMetrics.peakHour}. 
                      Ensure full staffing during these hours.
                    </>
                  ) : occupancyMetrics && occupancyMetrics.peakTime ? (
                    <>
                      <strong>Today's peak:</strong> {occupancyMetrics.peakOccupancy} people at {occupancyMetrics.peakTime}.
                    </>
                  ) : (
                    <>
                      <strong>Getting started:</strong> Keep your sensors running to unlock personalized insights about your venue.
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
              value={engagementMetrics?.topGenres?.[0]?.genre?.substring(0, 8) || '―'} 
            />
            <QuickStat 
              label="Peak Day" 
              value={trafficMetrics?.peakDay || '―'} 
            />
            <QuickStat 
              label="Dwell" 
              value={engagementMetrics?.avgDwellTime ? `${engagementMetrics.avgDwellTime}m` : '―'} 
            />
            <QuickStat 
              label="Rating" 
              value={reviewsData?.rating ? `${reviewsData.rating.toFixed(1)}★` : '―'} 
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
              occupancyMetrics={occupancyMetrics}
              venueName={venueName}
              venueId={venueId}
            />
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

// ============ COMPONENTS ============

function MetricCard({ label, value, subtext, subLabel, color, onClick }: {
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
        style={{ background: `radial-gradient(circle at 50% 120%, ${color}40 0%, transparent 60%)` }}
      />
      <div className="relative z-10">
        <span className="text-[10px] font-semibold tracking-wider block mb-3" style={{ color: COLORS.neutral }}>
          {label}
        </span>
        <span className="text-3xl font-bold block mb-1" style={{ color }}>{value}</span>
        <span className="text-sm block mb-1" style={{ 
          color: subtext.includes('↑') ? COLORS.reputation : subtext.includes('↓') ? COLORS.warning : color 
        }}>
          {subtext}
        </span>
        <span className="text-[10px] block truncate" style={{ color: COLORS.neutral }}>{subLabel}</span>
        <ChevronRight className="absolute bottom-4 right-3 w-4 h-4" style={{ color: COLORS.neutral }} />
      </div>
    </motion.button>
  );
}

function InsightCard({ type, title, subtitle, description }: InsightData) {
  const colors = {
    opportunity: { bg: COLORS.traffic },
    winning: { bg: COLORS.reputation },
    watch: { bg: COLORS.amber },
  };
  const labels = {
    opportunity: '🎯 OPPORTUNITY',
    winning: '✅ WINNING',
    watch: '⚠️ WATCH',
  };

  return (
    <motion.div
      className="p-4 rounded-2xl border-l-4"
      style={{ background: COLORS.cardBg, borderLeftColor: colors[type].bg }}
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      whileHover={{ x: 4 }}
    >
      <span className="text-[10px] font-bold tracking-wider block mb-2" style={{ color: colors[type].bg }}>
        {labels[type]}
      </span>
      <h4 className="text-sm font-semibold mb-1" style={{ color: COLORS.white }}>{title}</h4>
      <p className="text-xs" style={{ color: COLORS.neutral }}>{subtitle}</p>
      {description && <p className="text-xs mt-2" style={{ color: colors[type].bg }}>{description}</p>}
    </motion.div>
  );
}

function QuickStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 rounded-xl text-center" style={{ background: COLORS.cardBg }}>
      <span className="text-[9px] font-semibold tracking-wider block mb-1" style={{ color: COLORS.neutral }}>{label}</span>
      <span className="text-sm font-bold truncate block" style={{ color: COLORS.white }}>{value}</span>
    </div>
  );
}

function MetricModal({ type, onClose, reviewsData, trafficMetrics, engagementMetrics, occupancyMetrics, venueName, venueId }: {
  type: MetricType;
  onClose: () => void;
  reviewsData: GoogleReviewsData | null;
  trafficMetrics: TrafficMetrics | null;
  engagementMetrics: EngagementMetrics | null;
  occupancyMetrics: OccupancyMetrics | null;
  venueName: string;
  venueId: string;
}) {
  if (!type) return null;

  const configs: Record<string, { color: string; title: string }> = {
    traffic: { color: COLORS.traffic, title: 'TRAFFIC' },
    reputation: { color: COLORS.reputation, title: 'REPUTATION' },
    engagement: { color: COLORS.engagement, title: 'ENGAGEMENT' },
  };
  const { color, title } = configs[type];

  const openGoogleMaps = () => {
    const address = venueSettingsService.getFormattedAddress(venueId) || '';
    window.open(`https://www.google.com/maps/search/${encodeURIComponent(`${venueName} ${address}`)}`, '_blank');
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
      />
      <motion.div
        className="relative w-full max-w-lg rounded-t-3xl overflow-hidden"
        style={{ background: COLORS.black, maxHeight: '90vh' }}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      >
        <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: '#222' }}>
          <button onClick={onClose} className="text-sm" style={{ color: COLORS.white }}>← {title}</button>
          <button onClick={onClose}><X className="w-6 h-6" style={{ color: COLORS.neutral }} /></button>
        </div>

        <div className="p-6 overflow-y-auto" style={{ maxHeight: 'calc(90vh - 60px)' }}>
          {/* TRAFFIC */}
          {type === 'traffic' && (
            <>
              <div className="text-center mb-8">
                <span className="text-6xl font-bold" style={{ color }}>{trafficMetrics?.score || 50}</span>
                <p className="text-sm mt-2" style={{ color: COLORS.neutral }}>
                  {trafficMetrics?.avgDaily ? `${trafficMetrics.avgDaily} avg daily visitors` : 'Collecting traffic data...'}
                </p>
              </div>
              
              {trafficMetrics && trafficMetrics.totalEntries > 0 && (
                <div className="mb-6">
                  <h4 className="text-xs font-semibold mb-4" style={{ color: COLORS.neutral }}>WEEKLY BREAKDOWN</h4>
                  <div className="flex justify-between items-end h-32">
                    {trafficMetrics.weeklyData.map((day, i) => (
                      <div key={i} className="flex flex-col items-center gap-2 flex-1">
                        <span className="text-xs font-bold" style={{ color: COLORS.white }}>{day.entries || ''}</span>
                        <div 
                          className="w-8 rounded-t-md"
                          style={{ height: `${Math.max(8, day.value * 0.8)}px`, background: day.value >= 80 ? color : `${color}60` }}
                        />
                        <span className="text-xs" style={{ color: COLORS.neutral }}>{day.day}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 mb-6">
                <StatBox label="Total Visitors" value={trafficMetrics?.totalEntries?.toLocaleString() || '―'} color={color} />
                <StatBox label="Peak Day" value={trafficMetrics?.peakDay || '―'} color={color} />
                <StatBox label="Peak Hour" value={trafficMetrics?.peakHour || '―'} color={color} />
                <StatBox label="Trend" value={trafficMetrics ? `${trafficMetrics.trend > 0 ? '+' : ''}${trafficMetrics.trend}%` : '―'} 
                  color={trafficMetrics && trafficMetrics.trend >= 0 ? COLORS.reputation : COLORS.warning} />
              </div>

              {occupancyMetrics && (
                <div className="p-4 rounded-xl" style={{ background: `${color}15` }}>
                  <h5 className="text-xs font-semibold mb-2" style={{ color: COLORS.neutral }}>AVERAGES</h5>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-lg font-bold" style={{ color }}>{occupancyMetrics.sevenDayAvg || '―'}</p>
                      <p className="text-[10px]" style={{ color: COLORS.neutral }}>7-day</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold" style={{ color }}>{occupancyMetrics.fourteenDayAvg || '―'}</p>
                      <p className="text-[10px]" style={{ color: COLORS.neutral }}>14-day</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold" style={{ color }}>{occupancyMetrics.thirtyDayAvg || '―'}</p>
                      <p className="text-[10px]" style={{ color: COLORS.neutral }}>30-day</p>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* REPUTATION */}
          {type === 'reputation' && (
            reviewsData ? (
              <>
                <div className="text-center mb-8">
                  <span className="text-6xl font-bold" style={{ color }}>{reviewsData.rating.toFixed(1)} ★</span>
                  <p className="text-sm mt-2" style={{ color: COLORS.neutral }}>{reviewsData.reviewCount} Google reviews</p>
                </div>
                
                <div className="mb-6 p-4 rounded-xl" style={{ background: COLORS.cardBg }}>
                  <div className="flex items-center gap-3">
                    {reviewsData.rating >= 4.5 ? (
                      <><CheckCircle className="w-5 h-5" style={{ color: COLORS.reputation }} /><span style={{ color: COLORS.white }}>Excellent rating!</span></>
                    ) : reviewsData.rating >= 4.0 ? (
                      <><TrendingUp className="w-5 h-5" style={{ color: COLORS.amber }} /><span style={{ color: COLORS.white }}>Good rating</span></>
                    ) : (
                      <><AlertTriangle className="w-5 h-5" style={{ color: COLORS.warning }} /><span style={{ color: COLORS.white }}>Needs attention</span></>
                    )}
                  </div>
                </div>

                {reviewsData.priceLevel && (
                  <div className="mb-6">
                    <StatBox label="Price Level" value={reviewsData.priceLevel} color={color} />
                  </div>
                )}

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
              <div className="text-center py-12">
                <Star className="w-12 h-12 mx-auto mb-4" style={{ color: COLORS.neutral }} />
                <p style={{ color: COLORS.white }}>Google Reviews not configured</p>
                <p className="text-sm mt-2" style={{ color: COLORS.neutral }}>Add your venue address in Settings to see your reputation score</p>
              </div>
            )
          )}

          {/* ENGAGEMENT */}
          {type === 'engagement' && (
            <>
              <div className="text-center mb-8">
                <span className="text-6xl font-bold" style={{ color }}>{engagementMetrics?.score || 50}</span>
                <p className="text-sm mt-2" style={{ color: COLORS.neutral }}>Engagement score</p>
              </div>

              <div className="mb-6 p-4 rounded-xl text-center" style={{ background: COLORS.cardBg }}>
                <h4 className="text-xs font-semibold mb-2" style={{ color: COLORS.neutral }}>AVG DWELL TIME</h4>
                <span className="text-4xl font-bold" style={{ color: COLORS.white }}>
                  {engagementMetrics?.avgDwellTime ? `${engagementMetrics.avgDwellTime} min` : '―'}
                </span>
                {engagementMetrics?.avgDwellTime && engagementMetrics.avgDwellTime > 0 && (
                  <p className="text-xs mt-2" style={{ color: COLORS.neutral }}>
                    {engagementMetrics.avgDwellTime >= 45 ? 'Above industry average (38 min)' : 'Industry average: 38 min'}
                  </p>
                )}
              </div>

              {engagementMetrics?.topGenres && engagementMetrics.topGenres.length > 0 && (
                <div className="mb-6">
                  <h4 className="text-xs font-semibold mb-4" style={{ color: COLORS.neutral }}>TOP GENRES</h4>
                  <div className="space-y-2">
                    {engagementMetrics.topGenres.map((genre, i) => (
                      <div key={i} className="flex items-center justify-between p-3 rounded-lg" style={{ background: COLORS.cardBg }}>
                        <div className="flex items-center gap-2">
                          <Music className="w-4 h-4" style={{ color: i === 0 ? color : COLORS.neutral }} />
                          <span style={{ color: COLORS.white }}>{genre.genre}</span>
                        </div>
                        <span className="text-sm" style={{ color: i === 0 ? color : COLORS.neutral }}>
                          {genre.plays} plays
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <StatBox label="Songs Played" value={engagementMetrics?.totalSongsPlayed?.toString() || '―'} color={color} />
                <StatBox label="Top Genre" value={engagementMetrics?.topGenres?.[0]?.genre || '―'} color={color} />
              </div>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

function StatBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="p-3 rounded-xl text-center" style={{ background: COLORS.cardBg }}>
      <span className="text-[10px] font-semibold tracking-wider block mb-1" style={{ color: COLORS.neutral }}>{label}</span>
      <span className="text-lg font-bold" style={{ color }}>{value}</span>
    </div>
  );
}

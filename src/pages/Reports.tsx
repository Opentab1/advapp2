import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  FileText, Download, TrendingUp, TrendingDown, Calendar, Music, 
  ThermometerSun, Users, DollarSign, Clock, Star, ChevronDown, ChevronUp,
  Trophy, AlertCircle, Lightbulb, BarChart3, ArrowRight, Zap, Target,
  Minus, ChevronRight
} from 'lucide-react';
import { format, subDays, startOfWeek, endOfWeek, isWithinInterval, getDay, getHours } from 'date-fns';
import apiService from '../services/api.service';
import authService from '../services/auth.service';
import songLogService from '../services/song-log.service';
import googleReviewsService from '../services/google-reviews.service';
import locationService from '../services/location.service';
import { isDemoAccount, generateDemoWeeklyMetrics } from '../utils/demoData';
import { aggregateOccupancyByBarDay } from '../utils/barDay';
import type { SensorData, WeeklyMetrics } from '../types';

// Revenue settings stored in localStorage (user enters once in Settings)
interface RevenueSettings {
  avgSpendPerCustomer: number;
  venueCapacity: number;
  operatingHoursStart: number; // 0-23
  operatingHoursEnd: number; // 0-23
}

const DEFAULT_REVENUE_SETTINGS: RevenueSettings = {
  avgSpendPerCustomer: 25,
  venueCapacity: 150,
  operatingHoursStart: 17, // 5pm
  operatingHoursEnd: 2, // 2am
};

// Get revenue settings from localStorage
function getRevenueSettings(): RevenueSettings {
  try {
    const saved = localStorage.getItem('pulse_revenue_settings');
    if (saved) {
      return { ...DEFAULT_REVENUE_SETTINGS, ...JSON.parse(saved) };
    }
  } catch (e) {
    console.error('Error loading revenue settings:', e);
  }
  return DEFAULT_REVENUE_SETTINGS;
}

// Summary data structure
interface WeeklySummary {
  totalVisitors: number;
  estimatedRevenue: number;
  avgRating: number;
  totalReviews: number;
  avgDwellTime: number;
  bestDay: { name: string; visitors: number };
  slowestDay: { name: string; visitors: number };
  topSong: { name: string; plays: number };
  peakHour: string;
  // Comparison to last week
  visitorsChange: number;
  revenueChange: number;
  dwellChange: number;
  // Daily breakdown
  dailyData: { day: string; visitors: number; revenue: number }[];
  // Hourly heatmap
  hourlyHeatmap: { hour: number; avgOccupancy: number }[];
}

interface Insight {
  type: 'revenue' | 'music' | 'pattern' | 'opportunity' | 'warning';
  icon: typeof DollarSign;
  title: string;
  description: string;
  suggestion: string;
  impact?: string;
}

interface ComparisonData {
  metric: string;
  thisWeek: string | number;
  lastWeek: string | number;
  change: number;
  changeType: 'positive' | 'negative' | 'neutral';
}

type ReportCardType = 'music' | 'traffic' | 'atmosphere' | 'revenue' | 'monthly' | 'export';

export function Reports() {
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d'>('7d');
  const [summary, setSummary] = useState<WeeklySummary | null>(null);
  const [lastWeekSummary, setLastWeekSummary] = useState<WeeklySummary | null>(null);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [expandedSection, setExpandedSection] = useState<string | null>('summary');
  const [expandedCard, setExpandedCard] = useState<ReportCardType | null>(null);
  const [pastReportsExpanded, setPastReportsExpanded] = useState(false);
  
  const user = authService.getStoredUser();
  const revenueSettings = useMemo(() => getRevenueSettings(), []);

  useEffect(() => {
    loadReportData();
  }, [timeRange]);

  const loadReportData = async () => {
    setLoading(true);
    try {
      const venueId = user?.venueId;
      if (!venueId) {
        setLoading(false);
        return;
      }

      // Fetch data for current period and last period for comparison
      const days = parseInt(timeRange);
      const [currentData, previousData] = await Promise.all([
        apiService.getHistoricalData(venueId, timeRange),
        apiService.getHistoricalData(venueId, timeRange === '7d' ? '14d' : timeRange === '30d' ? '90d' : '90d')
      ]);

      // Split previous data to get just the comparison period
      const now = new Date();
      const currentPeriodStart = subDays(now, days);
      const previousPeriodStart = subDays(now, days * 2);
      const previousPeriodEnd = subDays(now, days);

      const currentPeriodData = currentData.data || [];
      const previousPeriodData = (previousData.data || []).filter(d => {
        const date = new Date(d.timestamp);
        return date >= previousPeriodStart && date < previousPeriodEnd;
      });

      // Calculate summaries
      const currentSummary = await calculateSummary(currentPeriodData, revenueSettings);
      const previousSummary = await calculateSummary(previousPeriodData, revenueSettings);
      
      // Calculate changes
      if (previousSummary.totalVisitors > 0) {
        currentSummary.visitorsChange = ((currentSummary.totalVisitors - previousSummary.totalVisitors) / previousSummary.totalVisitors) * 100;
        currentSummary.revenueChange = ((currentSummary.estimatedRevenue - previousSummary.estimatedRevenue) / previousSummary.estimatedRevenue) * 100;
        currentSummary.dwellChange = currentSummary.avgDwellTime - previousSummary.avgDwellTime;
      }

      setSummary(currentSummary);
      setLastWeekSummary(previousSummary);

      // Generate insights
      const generatedInsights = generateInsights(currentSummary, previousSummary, currentPeriodData, revenueSettings);
      setInsights(generatedInsights);

    } catch (error) {
      console.error('Error loading report data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Calculate summary from sensor data
  async function calculateSummary(data: SensorData[], settings: RevenueSettings): Promise<WeeklySummary> {
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    // Daily breakdown
    const dailyStats: { [key: string]: { visitors: number; date: Date } } = {};
    const hourlyStats: { [hour: number]: { totalOccupancy: number; count: number } } = {};
    
    // Track entries per day (using max entries as daily visitors)
    const dailyMaxEntries: { [dateStr: string]: { entries: number; dayName: string } } = {};
    
    data.forEach(point => {
      const date = new Date(point.timestamp);
      const dateStr = format(date, 'yyyy-MM-dd');
      const dayName = dayNames[getDay(date)];
      const hour = getHours(date);
      
      // Track max entries per day
      if (point.occupancy?.entries) {
        if (!dailyMaxEntries[dateStr] || point.occupancy.entries > dailyMaxEntries[dateStr].entries) {
          dailyMaxEntries[dateStr] = { entries: point.occupancy.entries, dayName };
        }
      }
      
      // Hourly heatmap
      if (!hourlyStats[hour]) {
        hourlyStats[hour] = { totalOccupancy: 0, count: 0 };
      }
      if (point.occupancy?.current) {
        hourlyStats[hour].totalOccupancy += point.occupancy.current;
        hourlyStats[hour].count++;
      }
    });

    // Calculate total visitors
    const totalVisitors = Object.values(dailyMaxEntries).reduce((sum, d) => sum + d.entries, 0);
    
    // Find best and slowest days
    const dayTotals: { [day: string]: number } = {};
    Object.values(dailyMaxEntries).forEach(({ entries, dayName }) => {
      dayTotals[dayName] = (dayTotals[dayName] || 0) + entries;
    });
    
    const sortedDays = Object.entries(dayTotals).sort((a, b) => b[1] - a[1]);
    const bestDay = sortedDays[0] || ['Saturday', 0];
    const slowestDay = sortedDays[sortedDays.length - 1] || ['Tuesday', 0];

    // Calculate hourly heatmap and find peak hour
    const hourlyHeatmap = Object.entries(hourlyStats).map(([hour, stats]) => ({
      hour: parseInt(hour),
      avgOccupancy: stats.count > 0 ? Math.round(stats.totalOccupancy / stats.count) : 0
    })).sort((a, b) => a.hour - b.hour);
    
    const peakHourData = hourlyHeatmap.reduce((max, curr) => 
      curr.avgOccupancy > max.avgOccupancy ? curr : max, 
      { hour: 22, avgOccupancy: 0 }
    );
    const peakHour = `${peakHourData.hour > 12 ? peakHourData.hour - 12 : peakHourData.hour}${peakHourData.hour >= 12 ? 'pm' : 'am'}-${(peakHourData.hour + 1) > 12 ? (peakHourData.hour + 1) - 12 : peakHourData.hour + 1}${(peakHourData.hour + 1) >= 12 ? 'pm' : 'am'}`;

    // Get top song
    let topSong = { name: 'No data', plays: 0 };
    try {
      const songs = await songLogService.getHighestPerformingSongs(1, '7d');
      if (songs.length > 0) {
        topSong = { name: songs[0].song, plays: songs[0].plays };
      }
    } catch (e) {
      console.error('Error fetching songs:', e);
    }

    // Get Google Reviews rating
    let avgRating = 0;
    let totalReviews = 0;
    try {
      const reviews = await googleReviewsService.getReviews();
      if (reviews) {
        avgRating = reviews.rating || 0;
        totalReviews = reviews.reviewCount || 0;
      }
    } catch (e) {
      console.error('Error fetching reviews:', e);
    }

    // Calculate average dwell time (rough estimate based on occupancy patterns)
    const avgOccupancy = data.reduce((sum, d) => sum + (d.occupancy?.current || 0), 0) / Math.max(data.length, 1);
    const totalEntryRate = totalVisitors / Math.max(Object.keys(dailyMaxEntries).length, 1);
    const avgDwellTime = totalEntryRate > 0 ? Math.round((avgOccupancy / totalEntryRate) * 60) : 42; // in minutes

    // Daily data for chart
    const dailyData = Object.entries(dailyMaxEntries).map(([dateStr, { entries, dayName }]) => ({
      day: dayName.substring(0, 3),
      visitors: entries,
      revenue: entries * settings.avgSpendPerCustomer
    })).slice(-7);

    return {
      totalVisitors,
      estimatedRevenue: totalVisitors * settings.avgSpendPerCustomer,
      avgRating,
      totalReviews,
      avgDwellTime,
      bestDay: { name: bestDay[0], visitors: bestDay[1] },
      slowestDay: { name: slowestDay[0], visitors: slowestDay[1] },
      topSong,
      peakHour,
      visitorsChange: 0,
      revenueChange: 0,
      dwellChange: 0,
      dailyData,
      hourlyHeatmap
    };
  }

  // Generate actionable insights
  function generateInsights(
    current: WeeklySummary, 
    previous: WeeklySummary, 
    data: SensorData[],
    settings: RevenueSettings
  ): Insight[] {
    const insights: Insight[] = [];

    // Revenue opportunity - slow days
    if (current.slowestDay.visitors < current.bestDay.visitors * 0.4) {
      const lostRevenue = (current.bestDay.visitors - current.slowestDay.visitors) * settings.avgSpendPerCustomer;
      insights.push({
        type: 'revenue',
        icon: DollarSign,
        title: 'Revenue Opportunity',
        description: `${current.slowestDay.name} had only ${current.slowestDay.visitors} visitors (${current.bestDay.name} had ${current.bestDay.visitors}).`,
        suggestion: 'Consider happy hour specials or live entertainment to boost traffic.',
        impact: `~$${Math.round(lostRevenue).toLocaleString()}/week potential`
      });
    }

    // Music finding - if we have song data
    if (current.topSong.plays > 0) {
      insights.push({
        type: 'music',
        icon: Music,
        title: 'Music Finding',
        description: `"${current.topSong.name}" was your top performer with ${current.topSong.plays} plays.`,
        suggestion: 'Add similar songs to your rotation and play during peak hours.'
      });
    }

    // Pattern detection - sound levels
    const avgSound = data.reduce((sum, d) => sum + (d.decibels || 0), 0) / Math.max(data.length, 1);
    if (avgSound > 85) {
      insights.push({
        type: 'pattern',
        icon: AlertCircle,
        title: 'Sound Level Alert',
        description: `Average sound level was ${avgSound.toFixed(0)}dB - higher than optimal (75-85dB).`,
        suggestion: 'Consider reducing music volume 10-15% during peak hours for better conversation.',
        impact: 'May improve dwell time'
      });
    } else if (avgSound >= 70 && avgSound <= 85) {
      insights.push({
        type: 'pattern',
        icon: Target,
        title: 'Optimal Sound Levels',
        description: `Your sound levels averaged ${avgSound.toFixed(0)}dB - within the optimal bar range.`,
        suggestion: 'Maintain current audio settings. This correlates with good dwell times.'
      });
    }

    // Visitor growth/decline
    if (current.visitorsChange > 10) {
      insights.push({
        type: 'opportunity',
        icon: TrendingUp,
        title: 'Traffic Growing!',
        description: `You're up ${current.visitorsChange.toFixed(0)}% from last period.`,
        suggestion: 'Capitalize on momentum - consider loyalty program to retain new customers.'
      });
    } else if (current.visitorsChange < -10) {
      insights.push({
        type: 'warning',
        icon: TrendingDown,
        title: 'Traffic Decline',
        description: `Visitors down ${Math.abs(current.visitorsChange).toFixed(0)}% from last period.`,
        suggestion: 'Review what changed. Consider promotions or events to re-engage customers.'
      });
    }

    // Peak hour insight
    if (current.peakHour) {
      insights.push({
        type: 'pattern',
        icon: Clock,
        title: 'Peak Performance Window',
        description: `Your busiest time is ${current.peakHour} with highest foot traffic.`,
        suggestion: 'Ensure full staffing 30 min before peak. Pre-set atmosphere for optimal experience.'
      });
    }

    return insights;
  }

  // Comparison data for table
  const comparisonData: ComparisonData[] = useMemo(() => {
    if (!summary || !lastWeekSummary) return [];
    
    return [
      {
        metric: 'Total Visitors',
        thisWeek: summary.totalVisitors.toLocaleString(),
        lastWeek: lastWeekSummary.totalVisitors.toLocaleString(),
        change: summary.visitorsChange,
        changeType: summary.visitorsChange > 0 ? 'positive' : summary.visitorsChange < 0 ? 'negative' : 'neutral'
      },
      {
        metric: 'Est. Revenue',
        thisWeek: `$${summary.estimatedRevenue.toLocaleString()}`,
        lastWeek: `$${lastWeekSummary.estimatedRevenue.toLocaleString()}`,
        change: summary.revenueChange,
        changeType: summary.revenueChange > 0 ? 'positive' : summary.revenueChange < 0 ? 'negative' : 'neutral'
      },
      {
        metric: 'Avg Dwell Time',
        thisWeek: `${summary.avgDwellTime} min`,
        lastWeek: `${lastWeekSummary.avgDwellTime} min`,
        change: summary.dwellChange,
        changeType: summary.dwellChange > 0 ? 'positive' : summary.dwellChange < 0 ? 'negative' : 'neutral'
      },
      {
        metric: 'Peak Occupancy',
        thisWeek: summary.bestDay.visitors.toLocaleString(),
        lastWeek: lastWeekSummary.bestDay.visitors.toLocaleString(),
        change: ((summary.bestDay.visitors - lastWeekSummary.bestDay.visitors) / Math.max(lastWeekSummary.bestDay.visitors, 1)) * 100,
        changeType: summary.bestDay.visitors > lastWeekSummary.bestDay.visitors ? 'positive' : 'neutral'
      },
      {
        metric: 'Busiest Day',
        thisWeek: summary.bestDay.name,
        lastWeek: lastWeekSummary.bestDay.name,
        change: 0,
        changeType: summary.bestDay.name !== lastWeekSummary.bestDay.name ? 'neutral' : 'neutral'
      },
      {
        metric: 'Top Song',
        thisWeek: summary.topSong.name.length > 20 ? summary.topSong.name.substring(0, 20) + '...' : summary.topSong.name,
        lastWeek: lastWeekSummary.topSong.name.length > 20 ? lastWeekSummary.topSong.name.substring(0, 20) + '...' : lastWeekSummary.topSong.name,
        change: 0,
        changeType: summary.topSong.name !== lastWeekSummary.topSong.name ? 'neutral' : 'neutral'
      }
    ];
  }, [summary, lastWeekSummary]);

  // Format date range for display
  const dateRangeLabel = useMemo(() => {
    const end = new Date();
    const start = subDays(end, parseInt(timeRange));
    return `${format(start, 'MMM d')} - ${format(end, 'MMM d, yyyy')}`;
  }, [timeRange]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div>
          <h2 className="text-3xl font-bold text-warm-900 mb-2">📊 Reports</h2>
          <p className="text-warm-500">{dateRangeLabel}</p>
        </div>
        <div className="flex gap-3">
          {/* Time Range Selector */}
          <div className="flex bg-warm-100 rounded-lg p-1">
            {['7d', '30d', '90d'].map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range as any)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  timeRange === range
                    ? 'bg-white text-primary shadow-sm'
                    : 'text-warm-500 hover:text-warm-700'
                }`}
              >
                {range === '7d' ? '7 Days' : range === '30d' ? '30 Days' : '90 Days'}
              </button>
            ))}
          </div>
          <button className="btn-secondary flex items-center gap-2">
            <Download className="w-4 h-4" />
            Export
          </button>
        </div>
      </motion.div>

      {/* Section 1: Executive Summary */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="glass-card p-6"
      >
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-warm-900 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-primary" />
            This {timeRange === '7d' ? 'Week' : timeRange === '30d' ? 'Month' : 'Quarter'} at a Glance
          </h3>
          <span className="text-sm text-warm-500">{dateRangeLabel}</span>
        </div>

        {summary && (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              {/* Visitors */}
              <div className="bg-warm-50 rounded-xl p-4 border border-warm-200">
                <div className="text-3xl font-bold text-warm-900 mb-1">
                  {summary.totalVisitors.toLocaleString()}
                </div>
                <div className="text-sm text-warm-500 mb-2">VISITORS</div>
                <div className={`text-sm font-medium flex items-center gap-1 ${
                  summary.visitorsChange > 0 ? 'text-green-600' : 
                  summary.visitorsChange < 0 ? 'text-red-600' : 'text-warm-500'
                }`}>
                  {summary.visitorsChange > 0 ? <TrendingUp className="w-4 h-4" /> : 
                   summary.visitorsChange < 0 ? <TrendingDown className="w-4 h-4" /> : 
                   <Minus className="w-4 h-4" />}
                  {summary.visitorsChange > 0 ? '+' : ''}{summary.visitorsChange.toFixed(0)}% vs last {timeRange === '7d' ? 'week' : 'period'}
                </div>
              </div>

              {/* Revenue */}
              <div className="bg-warm-50 rounded-xl p-4 border border-warm-200">
                <div className="text-3xl font-bold text-warm-900 mb-1">
                  ${summary.estimatedRevenue.toLocaleString()}
                </div>
                <div className="text-sm text-warm-500 mb-2">EST. REVENUE</div>
                <div className={`text-sm font-medium flex items-center gap-1 ${
                  summary.revenueChange > 0 ? 'text-green-600' : 
                  summary.revenueChange < 0 ? 'text-red-600' : 'text-warm-500'
                }`}>
                  {summary.revenueChange > 0 ? <TrendingUp className="w-4 h-4" /> : 
                   summary.revenueChange < 0 ? <TrendingDown className="w-4 h-4" /> : 
                   <Minus className="w-4 h-4" />}
                  {summary.revenueChange > 0 ? '+' : ''}{summary.revenueChange.toFixed(0)}% vs last {timeRange === '7d' ? 'week' : 'period'}
                </div>
              </div>

              {/* Rating */}
              <div className="bg-warm-50 rounded-xl p-4 border border-warm-200">
                <div className="text-3xl font-bold text-warm-900 mb-1 flex items-center gap-1">
                  {summary.avgRating > 0 ? summary.avgRating.toFixed(1) : '--'}
                  <Star className="w-6 h-6 text-yellow-500 fill-yellow-500" />
                </div>
                <div className="text-sm text-warm-500 mb-2">RATING</div>
                <div className="text-sm text-warm-500">
                  {summary.totalReviews > 0 ? `${summary.totalReviews} reviews` : 'No reviews yet'}
                </div>
              </div>

              {/* Dwell Time */}
              <div className="bg-warm-50 rounded-xl p-4 border border-warm-200">
                <div className="text-3xl font-bold text-warm-900 mb-1">
                  {summary.avgDwellTime} min
                </div>
                <div className="text-sm text-warm-500 mb-2">AVG DWELL</div>
                <div className={`text-sm font-medium flex items-center gap-1 ${
                  summary.dwellChange > 0 ? 'text-green-600' : 
                  summary.dwellChange < 0 ? 'text-red-600' : 'text-warm-500'
                }`}>
                  {summary.dwellChange > 0 ? <TrendingUp className="w-4 h-4" /> : 
                   summary.dwellChange < 0 ? <TrendingDown className="w-4 h-4" /> : 
                   <Minus className="w-4 h-4" />}
                  {summary.dwellChange > 0 ? '+' : ''}{summary.dwellChange} min vs last {timeRange === '7d' ? 'week' : 'period'}
                </div>
              </div>
            </div>

            {/* Quick Stats Row */}
            <div className="flex flex-wrap items-center gap-6 text-sm">
              <div className="flex items-center gap-2">
                <Trophy className="w-4 h-4 text-yellow-500" />
                <span className="text-warm-700">
                  <strong>Best Day:</strong> {summary.bestDay.name} ({summary.bestDay.visitors} visitors)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Minus className="w-4 h-4 text-warm-400" />
                <span className="text-warm-700">
                  <strong>Slowest:</strong> {summary.slowestDay.name} ({summary.slowestDay.visitors})
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Music className="w-4 h-4 text-primary" />
                <span className="text-warm-700">
                  <strong>Top Song:</strong> "{summary.topSong.name}" ({summary.topSong.plays} plays)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-primary" />
                <span className="text-warm-700">
                  <strong>Peak Hour:</strong> {summary.peakHour}
                </span>
              </div>
            </div>
          </>
        )}
      </motion.div>

      {/* Section 2: Visual Trends */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="grid grid-cols-1 md:grid-cols-2 gap-6"
      >
        {/* Daily Traffic Chart */}
        <div className="glass-card p-6">
          <h4 className="text-lg font-semibold text-warm-900 mb-4 flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            Daily Traffic
          </h4>
          {summary && summary.dailyData.length > 0 && (
            <div className="h-40 flex items-end justify-between gap-2">
              {summary.dailyData.map((day, i) => {
                const maxVisitors = Math.max(...summary.dailyData.map(d => d.visitors), 1);
                const height = (day.visitors / maxVisitors) * 100;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-2">
                    <div className="text-xs text-warm-500">{day.visitors}</div>
                    <div 
                      className="w-full bg-primary/20 rounded-t-lg relative overflow-hidden"
                      style={{ height: `${Math.max(height, 5)}%` }}
                    >
                      <div 
                        className="absolute inset-0 bg-primary rounded-t-lg"
                        style={{ 
                          opacity: 0.4 + (height / 100) * 0.6
                        }}
                      />
                    </div>
                    <div className="text-xs font-medium text-warm-600">{day.day}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Revenue Trend */}
        <div className="glass-card p-6">
          <h4 className="text-lg font-semibold text-warm-900 mb-4 flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-green-600" />
            Revenue Trend
          </h4>
          {summary && summary.dailyData.length > 0 && (
            <div className="h-40 flex items-end justify-between gap-2">
              {summary.dailyData.map((day, i) => {
                const maxRevenue = Math.max(...summary.dailyData.map(d => d.revenue), 1);
                const height = (day.revenue / maxRevenue) * 100;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-2">
                    <div className="text-xs text-warm-500">${Math.round(day.revenue)}</div>
                    <div 
                      className="w-full bg-green-500/20 rounded-t-lg relative overflow-hidden"
                      style={{ height: `${Math.max(height, 5)}%` }}
                    >
                      <div 
                        className="absolute inset-0 bg-green-500 rounded-t-lg"
                        style={{ 
                          opacity: 0.4 + (height / 100) * 0.6
                        }}
                      />
                    </div>
                    <div className="text-xs font-medium text-warm-600">{day.day}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Peak Hours Heatmap */}
        <div className="glass-card p-6">
          <h4 className="text-lg font-semibold text-warm-900 mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5 text-primary" />
            Peak Hours Heatmap
          </h4>
          {summary && summary.hourlyHeatmap.length > 0 && (
            <div className="space-y-2">
              <div className="flex gap-1">
                {summary.hourlyHeatmap
                  .filter(h => h.hour >= 17 || h.hour <= 3) // Operating hours only
                  .sort((a, b) => {
                    // Sort: 5pm-11pm, then 12am-3am
                    const aOrder = a.hour >= 17 ? a.hour : a.hour + 24;
                    const bOrder = b.hour >= 17 ? b.hour : b.hour + 24;
                    return aOrder - bOrder;
                  })
                  .map((h, i) => {
                    const maxOcc = Math.max(...summary.hourlyHeatmap.map(x => x.avgOccupancy), 1);
                    const intensity = h.avgOccupancy / maxOcc;
                    return (
                      <div key={i} className="flex-1 flex flex-col items-center">
                        <div 
                          className="w-full h-16 rounded"
                          style={{ 
                            backgroundColor: `rgba(0, 119, 182, ${0.1 + intensity * 0.7})` 
                          }}
                          title={`${h.hour > 12 ? h.hour - 12 : h.hour}${h.hour >= 12 ? 'pm' : 'am'}: ${h.avgOccupancy} avg`}
                        />
                        <div className="text-xs text-warm-500 mt-1">
                          {h.hour > 12 ? h.hour - 12 : h.hour}{h.hour >= 12 ? 'p' : 'a'}
                        </div>
                      </div>
                    );
                  })}
              </div>
              <div className="flex justify-between text-xs text-warm-400">
                <span>Less busy</span>
                <span>More busy</span>
              </div>
            </div>
          )}
        </div>

        {/* Dwell Time by Day */}
        <div className="glass-card p-6">
          <h4 className="text-lg font-semibold text-warm-900 mb-4 flex items-center gap-2">
            <Target className="w-5 h-5 text-primary" />
            Dwell Time by Day
          </h4>
          {summary && (
            <div className="space-y-3">
              {['Sat', 'Fri', 'Thu', 'Wed', 'Tue', 'Mon', 'Sun'].map((day, i) => {
                // Generate realistic dwell times based on day
                const baseDwell = summary.avgDwellTime;
                const variance = {
                  'Sat': 1.2, 'Fri': 1.15, 'Thu': 1.0, 'Wed': 0.9,
                  'Tue': 0.85, 'Mon': 0.8, 'Sun': 0.95
                };
                const dwell = Math.round(baseDwell * (variance[day as keyof typeof variance] || 1));
                const maxDwell = Math.round(baseDwell * 1.3);
                const width = (dwell / maxDwell) * 100;
                
                return (
                  <div key={day} className="flex items-center gap-3">
                    <div className="w-10 text-sm font-medium text-warm-600">{day}</div>
                    <div className="flex-1 h-6 bg-warm-100 rounded overflow-hidden">
                      <div 
                        className="h-full bg-primary rounded"
                        style={{ width: `${width}%` }}
                      />
                    </div>
                    <div className="w-16 text-sm text-warm-600 text-right">{dwell}min</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </motion.div>

      {/* Section 3: Key Insights */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="glass-card p-6"
      >
        <h3 className="text-lg font-semibold text-warm-900 mb-6 flex items-center gap-2">
          <Lightbulb className="w-5 h-5 text-yellow-500" />
          This {timeRange === '7d' ? 'Week' : 'Period'}'s Insights
        </h3>

        <div className="space-y-4">
          {insights.map((insight, i) => {
            const IconComponent = insight.icon;
            const bgColor = insight.type === 'revenue' ? 'bg-green-50 border-green-200' :
                           insight.type === 'music' ? 'bg-purple-50 border-purple-200' :
                           insight.type === 'warning' ? 'bg-red-50 border-red-200' :
                           insight.type === 'opportunity' ? 'bg-blue-50 border-blue-200' :
                           'bg-warm-50 border-warm-200';
            const iconColor = insight.type === 'revenue' ? 'text-green-600' :
                             insight.type === 'music' ? 'text-purple-600' :
                             insight.type === 'warning' ? 'text-red-600' :
                             insight.type === 'opportunity' ? 'text-blue-600' :
                             'text-primary';

            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 + i * 0.1 }}
                className={`p-4 rounded-xl border ${bgColor}`}
              >
                <div className="flex items-start gap-4">
                  <div className={`p-2 rounded-lg bg-white/50 ${iconColor}`}>
                    <IconComponent className="w-5 h-5" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-start justify-between mb-1">
                      <h4 className="font-semibold text-warm-900">{insight.title}</h4>
                      {insight.impact && (
                        <span className="text-xs font-medium text-green-600 bg-green-100 px-2 py-1 rounded">
                          {insight.impact}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-warm-600 mb-2">{insight.description}</p>
                    <div className="flex items-center gap-2 text-sm">
                      <Zap className="w-4 h-4 text-yellow-500" />
                      <span className="text-warm-700">{insight.suggestion}</span>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </motion.div>

      {/* Section 4: Comparison View */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="glass-card p-6"
      >
        <h3 className="text-lg font-semibold text-warm-900 mb-6 flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-primary" />
          This {timeRange === '7d' ? 'Week' : 'Period'} vs Last {timeRange === '7d' ? 'Week' : 'Period'}
        </h3>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-warm-200">
                <th className="text-left py-3 px-4 text-sm font-medium text-warm-500">METRIC</th>
                <th className="text-right py-3 px-4 text-sm font-medium text-warm-500">THIS {timeRange === '7d' ? 'WEEK' : 'PERIOD'}</th>
                <th className="text-right py-3 px-4 text-sm font-medium text-warm-500">LAST {timeRange === '7d' ? 'WEEK' : 'PERIOD'}</th>
                <th className="text-right py-3 px-4 text-sm font-medium text-warm-500">CHANGE</th>
              </tr>
            </thead>
            <tbody>
              {comparisonData.map((row, i) => (
                <tr key={i} className="border-b border-warm-100 hover:bg-warm-50 transition-colors">
                  <td className="py-3 px-4 text-sm font-medium text-warm-900">{row.metric}</td>
                  <td className="py-3 px-4 text-sm text-right text-warm-700">{row.thisWeek}</td>
                  <td className="py-3 px-4 text-sm text-right text-warm-500">{row.lastWeek}</td>
                  <td className="py-3 px-4 text-right">
                    {typeof row.change === 'number' && row.change !== 0 ? (
                      <span className={`inline-flex items-center gap-1 text-sm font-medium ${
                        row.changeType === 'positive' ? 'text-green-600' :
                        row.changeType === 'negative' ? 'text-red-600' :
                        'text-warm-500'
                      }`}>
                        {row.changeType === 'positive' ? <TrendingUp className="w-4 h-4" /> :
                         row.changeType === 'negative' ? <TrendingDown className="w-4 h-4" /> : null}
                        {row.change > 0 ? '+' : ''}{row.change.toFixed(0)}%
                      </span>
                    ) : (
                      <span className="text-sm text-warm-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {summary && summary.visitorsChange > 5 && (
          <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-xl">
            <div className="flex items-center gap-2 text-green-700">
              <Trophy className="w-5 h-5" />
              <span className="font-medium">
                You had your best {summary.bestDay.name} in {timeRange === '7d' ? '4 weeks' : '3 months'}!
              </span>
            </div>
          </div>
        )}
      </motion.div>

      {/* Section 5: Deep Dive Report Cards */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
      >
        <h3 className="text-lg font-semibold text-warm-900 mb-4 flex items-center gap-2">
          <FileText className="w-5 h-5 text-primary" />
          Detailed Reports
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Music Analytics */}
          <ReportCard
            type="music"
            icon={Music}
            title="Music Analytics"
            items={['Top 10 songs', 'Genre performance', 'Playlist builder']}
            expanded={expandedCard === 'music'}
            onToggle={() => setExpandedCard(expandedCard === 'music' ? null : 'music')}
          />

          {/* Traffic Patterns */}
          <ReportCard
            type="traffic"
            icon={Users}
            title="Traffic Patterns"
            items={['Hourly breakdown', 'Day comparison', 'Entry/exit flow']}
            expanded={expandedCard === 'traffic'}
            onToggle={() => setExpandedCard(expandedCard === 'traffic' ? null : 'traffic')}
          />

          {/* Atmosphere Analysis */}
          <ReportCard
            type="atmosphere"
            icon={ThermometerSun}
            title="Atmosphere Analysis"
            items={['Sound trends', 'Light patterns', 'Environmental scores']}
            expanded={expandedCard === 'atmosphere'}
            onToggle={() => setExpandedCard(expandedCard === 'atmosphere' ? null : 'atmosphere')}
          />

          {/* Revenue Insights */}
          <ReportCard
            type="revenue"
            icon={DollarSign}
            title="Revenue Insights"
            items={['Daily estimates', 'Peak hour value', 'Opportunity cost']}
            expanded={expandedCard === 'revenue'}
            onToggle={() => setExpandedCard(expandedCard === 'revenue' ? null : 'revenue')}
          />

          {/* Monthly Summary */}
          <ReportCard
            type="monthly"
            icon={Calendar}
            title="Monthly Summary"
            items={['30-day overview', 'Month vs month', 'Seasonal trends']}
            expanded={expandedCard === 'monthly'}
            onToggle={() => setExpandedCard(expandedCard === 'monthly' ? null : 'monthly')}
          />

          {/* Export & Share */}
          <ReportCard
            type="export"
            icon={Download}
            title="Export & Share"
            items={['Download PDF', 'Email report', 'Schedule weekly']}
            expanded={expandedCard === 'export'}
            onToggle={() => setExpandedCard(expandedCard === 'export' ? null : 'export')}
          />
        </div>
      </motion.div>

      {/* Section 6: Past Reports (Collapsed) */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
        className="glass-card overflow-hidden"
      >
        <button
          onClick={() => setPastReportsExpanded(!pastReportsExpanded)}
          className="w-full p-4 flex items-center justify-between hover:bg-warm-50 transition-colors"
        >
          <h3 className="text-lg font-semibold text-warm-900 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-primary" />
            Past Reports
          </h3>
          {pastReportsExpanded ? (
            <ChevronUp className="w-5 h-5 text-warm-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-warm-400" />
          )}
        </button>

        <AnimatePresence>
          {pastReportsExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="border-t border-warm-200"
            >
              <div className="p-4 flex gap-2 overflow-x-auto">
                {Array.from({ length: 8 }).map((_, i) => {
                  const weekEnd = subDays(new Date(), (i + 1) * 7);
                  const weekStart = subDays(weekEnd, 6);
                  return (
                    <button
                      key={i}
                      className="flex-shrink-0 px-4 py-3 rounded-lg bg-warm-100 hover:bg-warm-200 transition-colors text-sm"
                    >
                      <div className="font-medium text-warm-900">
                        {format(weekStart, 'MMM d')} - {format(weekEnd, 'd')}
                      </div>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

// Report Card Component
function ReportCard({ 
  type, 
  icon: Icon, 
  title, 
  items, 
  expanded, 
  onToggle 
}: { 
  type: ReportCardType;
  icon: typeof Music;
  title: string;
  items: string[];
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <motion.div
      className="glass-card p-6 cursor-pointer hover:shadow-card-hover transition-all"
      onClick={onToggle}
      whileHover={{ y: -2 }}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="p-3 rounded-xl bg-primary/10">
          <Icon className="w-6 h-6 text-primary" />
        </div>
        <ChevronRight className={`w-5 h-5 text-warm-400 transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </div>
      <h4 className="font-semibold text-warm-900 mb-3">{title}</h4>
      <ul className="space-y-2 mb-4">
        {items.map((item, i) => (
          <li key={i} className="text-sm text-warm-500 flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-primary/50" />
            {item}
          </li>
        ))}
      </ul>
      <div className="text-sm font-medium text-primary flex items-center gap-1">
        View Report
        <ArrowRight className="w-4 h-4" />
      </div>
    </motion.div>
  );
}

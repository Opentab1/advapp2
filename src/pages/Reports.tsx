/**
 * Reports Page - WHOOP-style Weekly/Monthly Summaries
 * 
 * Philosophy: One clear story, not a data dump.
 * - 3 hero metrics
 * - 1 highlight of the period
 * - 1 actionable recommendation
 * - Simple week/month navigation
 */

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  FileText, 
  ChevronLeft, 
  ChevronRight, 
  Users, 
  Zap, 
  Clock,
  TrendingUp,
  TrendingDown,
  Sparkles,
  RefreshCw,
  Calendar,
  BarChart3
} from 'lucide-react';
import { format, subWeeks, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import apiService from '../services/api.service';
import authService from '../services/auth.service';
import { isDemoAccount } from '../utils/demoData';
import { aggregateOccupancyByBarDay } from '../utils/barDay';
import locationService from '../services/location.service';

// ============ TYPES ============

interface ReportData {
  periodStart: Date;
  periodEnd: Date;
  periodType: 'week' | 'month';
  
  // Hero metrics
  totalVisitors: number;
  avgPulseScore: number;
  peakTime: string;
  
  // Comparisons
  visitorsTrend: number; // % change from previous period
  pulseTrend: number;
  
  // Highlight
  highlightTitle: string;
  highlightDescription: string;
  highlightType: 'positive' | 'neutral' | 'negative';
  
  // Action
  actionTitle: string;
  actionDescription: string;
  
  // Supporting data
  dailyVisitors: { day: string; count: number }[];
  avgSound: number;
  avgLight: number;
  peakOccupancy: number;
  dataPoints: number;
}

// ============ MAIN COMPONENT ============

export function Reports() {
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<ReportData | null>(null);
  const [periodType, setPeriodType] = useState<'week' | 'month'>('week');
  const [periodOffset, setPeriodOffset] = useState(0); // 0 = current, 1 = previous, etc.

  const user = authService.getStoredUser();
  const venueId = user?.venueId || '';

  useEffect(() => {
    loadReport();
  }, [periodType, periodOffset, venueId]);

  const loadReport = async () => {
    if (!venueId) {
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      // Calculate period dates
      const now = new Date();
      let periodStart: Date;
      let periodEnd: Date;
      if (periodType === 'week') {
        const currentWeekStart = startOfWeek(now, { weekStartsOn: 1 }); // Monday
        periodStart = subWeeks(currentWeekStart, periodOffset);
        periodEnd = endOfWeek(periodStart, { weekStartsOn: 1 });
      } else {
        const currentMonthStart = startOfMonth(now);
        periodStart = subMonths(currentMonthStart, periodOffset);
        periodEnd = endOfMonth(periodStart);
      }

      // For demo accounts, generate demo data
      if (isDemoAccount(venueId)) {
        const demoReport = generateDemoReport(periodStart, periodEnd, periodType);
        setReport(demoReport);
        setLoading(false);
        return;
      }

      // Fetch real data
      const daysToFetch = periodType === 'week' ? '7d' : '30d';
      const currentData = await apiService.getHistoricalData(venueId, daysToFetch as any);

      // Calculate metrics
      const reportData = calculateReportMetrics(
        currentData.data || [],
        periodStart,
        periodEnd,
        periodType
      );

      setReport(reportData);
    } catch (error) {
      console.error('Error loading report:', error);
      // Generate empty report
      setReport(generateEmptyReport(new Date(), periodType));
    } finally {
      setLoading(false);
    }
  };

  const navigatePeriod = (direction: 'prev' | 'next') => {
    if (direction === 'prev') {
      setPeriodOffset(prev => prev + 1);
    } else if (periodOffset > 0) {
      setPeriodOffset(prev => prev - 1);
    }
  };

  const isCurrentPeriod = periodOffset === 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="w-8 h-8 text-primary animate-spin" />
          <p className="text-warm-500">Loading report...</p>
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-3">
          <FileText className="w-12 h-12 text-warm-300" />
          <p className="text-warm-500">No report data available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto pb-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <BarChart3 className="w-6 h-6 text-primary" />
            <h2 className="text-2xl font-bold text-warm-800">Reports</h2>
          </div>
          <p className="text-warm-500">Your venue performance summary</p>
        </div>
        
        {/* Period Type Toggle */}
        <div className="flex rounded-xl bg-warm-100 p-1">
          <button
            onClick={() => { setPeriodType('week'); setPeriodOffset(0); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              periodType === 'week' 
                ? 'bg-white text-warm-800 shadow-sm' 
                : 'text-warm-500 hover:text-warm-700'
            }`}
          >
            Weekly
          </button>
          <button
            onClick={() => { setPeriodType('month'); setPeriodOffset(0); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              periodType === 'month' 
                ? 'bg-white text-warm-800 shadow-sm' 
                : 'text-warm-500 hover:text-warm-700'
            }`}
          >
            Monthly
          </button>
        </div>
      </div>

      {/* Period Navigation */}
      <motion.div
        className="flex items-center justify-between mb-6 p-4 rounded-xl bg-white border border-warm-200"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <button
          onClick={() => navigatePeriod('prev')}
          className="p-2 rounded-lg hover:bg-warm-100 transition-colors"
        >
          <ChevronLeft className="w-5 h-5 text-warm-600" />
        </button>
        
        <div className="text-center">
          <div className="flex items-center justify-center gap-2 mb-1">
            <Calendar className="w-4 h-4 text-primary" />
            <span className="text-lg font-semibold text-warm-800">
              {format(report.periodStart, 'MMM d')} - {format(report.periodEnd, 'MMM d, yyyy')}
            </span>
          </div>
          {isCurrentPeriod && (
            <span className="text-xs text-primary font-medium">Current {periodType}</span>
          )}
        </div>
        
        <button
          onClick={() => navigatePeriod('next')}
          disabled={isCurrentPeriod}
          className={`p-2 rounded-lg transition-colors ${
            isCurrentPeriod 
              ? 'opacity-30 cursor-not-allowed' 
              : 'hover:bg-warm-100'
          }`}
        >
          <ChevronRight className="w-5 h-5 text-warm-600" />
        </button>
      </motion.div>

      {/* ============ HERO METRICS ============ */}
      <motion.div
        className="grid grid-cols-3 gap-3 mb-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <HeroMetric
          icon={Users}
          value={report.totalVisitors.toLocaleString()}
          label="Visitors"
          trend={report.visitorsTrend}
          color="text-primary"
        />
        <HeroMetric
          icon={Zap}
          value={report.avgPulseScore > 0 ? String(report.avgPulseScore) : '--'}
          label="Avg Pulse"
          trend={report.pulseTrend}
          color="text-amber-500"
        />
        <HeroMetric
          icon={Clock}
          value={report.peakTime || '--'}
          label="Peak Time"
          color="text-green-500"
        />
      </motion.div>

      {/* ============ HIGHLIGHT OF THE PERIOD ============ */}
      <motion.div
        className={`mb-6 p-5 rounded-2xl border-2 ${
          report.highlightType === 'positive' 
            ? 'bg-green-50 border-green-200' 
            : report.highlightType === 'negative'
            ? 'bg-amber-50 border-amber-200'
            : 'bg-warm-50 border-warm-200'
        }`}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
            report.highlightType === 'positive' 
              ? 'bg-green-100' 
              : report.highlightType === 'negative'
              ? 'bg-amber-100'
              : 'bg-warm-100'
          }`}>
            {report.highlightType === 'positive' ? (
              <TrendingUp className="w-5 h-5 text-green-600" />
            ) : report.highlightType === 'negative' ? (
              <TrendingDown className="w-5 h-5 text-amber-600" />
            ) : (
              <Sparkles className="w-5 h-5 text-warm-600" />
            )}
          </div>
          <div>
            <h3 className="font-semibold text-warm-800 mb-1">
              {periodType === 'week' ? 'This Week' : 'This Month'}'s Highlight
            </h3>
            <p className="text-lg font-medium text-warm-700">{report.highlightTitle}</p>
            <p className="text-sm text-warm-500 mt-1">{report.highlightDescription}</p>
          </div>
        </div>
      </motion.div>

      {/* ============ ACTIONABLE RECOMMENDATION ============ */}
      <motion.div
        className="mb-6 p-5 rounded-2xl bg-primary-50 border border-primary-100"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-primary mb-1">Try This Next {periodType === 'week' ? 'Week' : 'Month'}</h3>
            <p className="text-lg font-medium text-warm-700">{report.actionTitle}</p>
            <p className="text-sm text-warm-500 mt-1">{report.actionDescription}</p>
          </div>
        </div>
      </motion.div>

      {/* ============ DAILY BREAKDOWN (if weekly) ============ */}
      {periodType === 'week' && report.dailyVisitors.length > 0 && (
        <motion.div
          className="mb-6 p-5 rounded-2xl bg-white border border-warm-200"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <h3 className="font-semibold text-warm-800 mb-4">Daily Breakdown</h3>
          <div className="flex justify-between items-end h-32">
            {report.dailyVisitors.map((day, i) => {
              const maxCount = Math.max(...report.dailyVisitors.map(d => d.count), 1);
              const heightPercent = (day.count / maxCount) * 100;
              return (
                <div key={i} className="flex flex-col items-center gap-2 flex-1">
                  <div 
                    className="w-full max-w-[40px] bg-primary/20 rounded-t-lg transition-all relative group"
                    style={{ height: `${Math.max(heightPercent, 5)}%` }}
                  >
                    <div 
                      className="absolute inset-0 bg-primary rounded-t-lg"
                      style={{ height: `${heightPercent}%` }}
                    />
                    <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-xs font-medium text-warm-600 opacity-0 group-hover:opacity-100 transition-opacity">
                      {day.count}
                    </div>
                  </div>
                  <span className="text-xs text-warm-500">{day.day}</span>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* ============ SUPPORTING METRICS ============ */}
      <motion.div
        className="grid grid-cols-2 gap-3"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
      >
        <div className="p-4 rounded-xl bg-white border border-warm-200">
          <p className="text-sm text-warm-500 mb-1">Avg Sound</p>
          <p className="text-xl font-bold text-warm-800">
            {report.avgSound > 0 ? `${report.avgSound.toFixed(0)} dB` : '--'}
          </p>
        </div>
        <div className="p-4 rounded-xl bg-white border border-warm-200">
          <p className="text-sm text-warm-500 mb-1">Avg Light</p>
          <p className="text-xl font-bold text-warm-800">
            {report.avgLight > 0 ? `${report.avgLight.toFixed(0)} lux` : '--'}
          </p>
        </div>
        <div className="p-4 rounded-xl bg-white border border-warm-200">
          <p className="text-sm text-warm-500 mb-1">Peak Crowd</p>
          <p className="text-xl font-bold text-warm-800">
            {report.peakOccupancy > 0 ? report.peakOccupancy : '--'}
          </p>
        </div>
        <div className="p-4 rounded-xl bg-white border border-warm-200">
          <p className="text-sm text-warm-500 mb-1">Data Points</p>
          <p className="text-xl font-bold text-warm-800">
            {report.dataPoints > 0 ? report.dataPoints.toLocaleString() : '--'}
          </p>
        </div>
      </motion.div>
    </div>
  );
}

// ============ HERO METRIC COMPONENT ============

function HeroMetric({ icon: Icon, value, label, trend, color }: {
  icon: typeof Users;
  value: string;
  label: string;
  trend?: number;
  color: string;
}) {
  return (
    <div className="p-4 rounded-2xl bg-white border border-warm-200 text-center">
      <div className={`w-10 h-10 rounded-xl mx-auto mb-2 flex items-center justify-center bg-warm-100`}>
        <Icon className={`w-5 h-5 ${color}`} />
      </div>
      <p className="text-2xl font-bold text-warm-800">{value}</p>
      <p className="text-xs text-warm-500 mt-1">{label}</p>
      {trend !== undefined && trend !== 0 && (
        <div className={`flex items-center justify-center gap-1 mt-2 text-xs font-medium ${
          trend > 0 ? 'text-green-600' : 'text-red-500'
        }`}>
          {trend > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          <span>{Math.abs(trend)}% vs last {label.includes('Pulse') ? 'period' : 'week'}</span>
        </div>
      )}
    </div>
  );
}

// ============ DATA PROCESSING ============

function calculateReportMetrics(
  currentData: any[],
  periodStart: Date,
  periodEnd: Date,
  periodType: 'week' | 'month'
): ReportData {
  // Get timezone
  const locations = locationService.getLocations();
  const timezone = locations[0]?.timezone || 'America/New_York';
  
  // Aggregate occupancy by bar day
  const occupancyStats = aggregateOccupancyByBarDay(currentData, periodStart, periodEnd, timezone);
  
  // Calculate averages
  let totalDecibels = 0, decibelCount = 0;
  let totalLight = 0, lightCount = 0;
  let maxOccupancy = 0;
  
  currentData.forEach(point => {
    if (point.decibels > 0) { totalDecibels += point.decibels; decibelCount++; }
    if (point.light >= 0) { totalLight += point.light; lightCount++; }
    if (point.occupancy?.current > maxOccupancy) maxOccupancy = point.occupancy.current;
  });
  
  const avgSound = decibelCount > 0 ? totalDecibels / decibelCount : 0;
  const avgLight = lightCount > 0 ? totalLight / lightCount : 0;
  
  // Calculate peak time
  const hourlyOccupancy: { [hour: number]: number[] } = {};
  currentData.forEach(point => {
    if (point.occupancy?.current) {
      const hour = new Date(point.timestamp).getHours();
      if (!hourlyOccupancy[hour]) hourlyOccupancy[hour] = [];
      hourlyOccupancy[hour].push(point.occupancy.current);
    }
  });
  
  let peakHour = 21; // default 9pm
  let peakAvg = 0;
  Object.entries(hourlyOccupancy).forEach(([hour, values]) => {
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    if (avg > peakAvg) {
      peakAvg = avg;
      peakHour = parseInt(hour);
    }
  });
  const peakTime = `${peakHour > 12 ? peakHour - 12 : peakHour}${peakHour >= 12 ? 'pm' : 'am'}`;
  
  // Daily breakdown
  const dailyVisitors: { day: string; count: number }[] = [];
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  
  if (periodType === 'week') {
    occupancyStats.dailyBreakdown.forEach((day, i) => {
      dailyVisitors.push({
        day: days[i] || format(new Date(day.date), 'EEE'),
        count: day.entries
      });
    });
    // Fill missing days
    while (dailyVisitors.length < 7) {
      dailyVisitors.push({ day: days[dailyVisitors.length], count: 0 });
    }
  }
  
  // Calculate pulse score (simplified)
  const avgPulseScore = avgSound > 0 ? Math.round(
    (avgSound >= 70 && avgSound <= 82 ? 85 : 60) * 0.6 +
    (avgLight >= 50 && avgLight <= 350 ? 85 : 60) * 0.4
  ) : 0;
  
  // Generate highlight
  const { highlightTitle, highlightDescription, highlightType } = generateHighlight(
    occupancyStats.totalEntries,
    avgPulseScore,
    dailyVisitors,
    periodType
  );
  
  // Generate action
  const { actionTitle, actionDescription } = generateAction(
    avgSound,
    avgLight,
    peakHour,
    dailyVisitors
  );
  
  return {
    periodStart,
    periodEnd,
    periodType,
    totalVisitors: occupancyStats.totalEntries,
    avgPulseScore,
    peakTime,
    visitorsTrend: 0, // Would need prev period data
    pulseTrend: 0,
    highlightTitle,
    highlightDescription,
    highlightType,
    actionTitle,
    actionDescription,
    dailyVisitors,
    avgSound,
    avgLight,
    peakOccupancy: maxOccupancy,
    dataPoints: currentData.length,
  };
}

function generateHighlight(
  totalVisitors: number,
  avgPulse: number,
  dailyVisitors: { day: string; count: number }[],
  periodType: 'week' | 'month'
): { highlightTitle: string; highlightDescription: string; highlightType: 'positive' | 'neutral' | 'negative' } {
  // Find best day
  const bestDay = dailyVisitors.reduce((best, day) => 
    day.count > best.count ? day : best
  , { day: '', count: 0 });
  
  if (bestDay.count > 0 && periodType === 'week') {
    return {
      highlightTitle: `${bestDay.day} was your busiest day`,
      highlightDescription: `You had ${bestDay.count} visitors — ${Math.round((bestDay.count / totalVisitors) * 100)}% of your weekly traffic.`,
      highlightType: 'positive',
    };
  }
  
  if (avgPulse >= 80) {
    return {
      highlightTitle: 'Great atmosphere scores!',
      highlightDescription: `Your average Pulse Score was ${avgPulse} — your venue vibe is on point.`,
      highlightType: 'positive',
    };
  }
  
  if (totalVisitors > 0) {
    return {
      highlightTitle: `${totalVisitors.toLocaleString()} visitors this ${periodType}`,
      highlightDescription: `Your venue welcomed ${totalVisitors.toLocaleString()} guests.`,
      highlightType: 'neutral',
    };
  }
  
  return {
    highlightTitle: 'No data collected yet',
    highlightDescription: 'Start tracking to see insights here.',
    highlightType: 'neutral',
  };
}

function generateAction(
  avgSound: number,
  avgLight: number,
  peakHour: number,
  dailyVisitors: { day: string; count: number }[]
): { actionTitle: string; actionDescription: string } {
  // Find slowest day
  const slowestDay = dailyVisitors.reduce((slowest, day) => 
    day.count < slowest.count && day.count > 0 ? day : slowest
  , { day: '', count: Infinity });

  if (avgSound > 85) {
    return {
      actionTitle: 'Lower the volume slightly',
      actionDescription: `Your average sound was ${avgSound.toFixed(0)} dB — try bringing it down to 75-82 dB for better conversation.`,
    };
  }
  
  if (avgLight > 400) {
    return {
      actionTitle: 'Dim the lights in the evening',
      actionDescription: `Your average light was ${avgLight.toFixed(0)} lux — dimmer lighting creates a better bar atmosphere.`,
    };
  }
  
  if (slowestDay.day && slowestDay.count < Infinity) {
    return {
      actionTitle: `Boost ${slowestDay.day} traffic`,
      actionDescription: `${slowestDay.day} was your slowest day. Consider a special or promotion to drive traffic.`,
    };
  }
  
  if (peakHour < 20) {
    return {
      actionTitle: 'Extend peak hours',
      actionDescription: `Your peak is around ${peakHour > 12 ? peakHour - 12 : peakHour}pm. Try events or specials to keep energy going later.`,
    };
  }
  
  return {
    actionTitle: 'Keep doing what works',
    actionDescription: 'Your metrics look balanced. Focus on consistency and watch for trends.',
  };
}

function generateDemoReport(periodStart: Date, periodEnd: Date, periodType: 'week' | 'month'): ReportData {
  const isWeek = periodType === 'week';
  const baseVisitors = isWeek ? 847 : 3420;
  
  return {
    periodStart,
    periodEnd,
    periodType,
    totalVisitors: baseVisitors + Math.floor(Math.random() * 100),
    avgPulseScore: 76 + Math.floor(Math.random() * 10),
    peakTime: '9pm',
    visitorsTrend: Math.floor(Math.random() * 20) - 5,
    pulseTrend: Math.floor(Math.random() * 10) - 3,
    highlightTitle: isWeek ? 'Saturday was your busiest night' : 'Week 2 had the highest traffic',
    highlightDescription: isWeek 
      ? 'You had 234 visitors — 28% of your weekly traffic.'
      : 'The second week of the month drove 32% of total visits.',
    highlightType: 'positive',
    actionTitle: isWeek ? 'Boost Tuesday traffic' : 'Focus on early-week promotions',
    actionDescription: isWeek
      ? 'Tuesday was your slowest day with only 67 visitors. Consider a special or event.'
      : 'Tuesdays and Wednesdays consistently underperform. Try happy hour specials.',
    dailyVisitors: isWeek ? [
      { day: 'Mon', count: 89 },
      { day: 'Tue', count: 67 },
      { day: 'Wed', count: 95 },
      { day: 'Thu', count: 123 },
      { day: 'Fri', count: 189 },
      { day: 'Sat', count: 234 },
      { day: 'Sun', count: 145 },
    ] : [],
    avgSound: 74.5,
    avgLight: 180,
    peakOccupancy: 87,
    dataPoints: isWeek ? 2016 : 8640,
  };
}

function generateEmptyReport(now: Date, periodType: 'week' | 'month'): ReportData {
  const periodStart = periodType === 'week' 
    ? startOfWeek(now, { weekStartsOn: 1 })
    : startOfMonth(now);
  const periodEnd = periodType === 'week'
    ? endOfWeek(now, { weekStartsOn: 1 })
    : endOfMonth(now);
    
  return {
    periodStart,
    periodEnd,
    periodType,
    totalVisitors: 0,
    avgPulseScore: 0,
    peakTime: '',
    visitorsTrend: 0,
    pulseTrend: 0,
    highlightTitle: 'No data yet',
    highlightDescription: 'Start collecting data to see insights here.',
    highlightType: 'neutral',
    actionTitle: 'Set up your sensors',
    actionDescription: 'Once data starts flowing, you will see actionable recommendations here.',
    dailyVisitors: [],
    avgSound: 0,
    avgLight: 0,
    peakOccupancy: 0,
    dataPoints: 0,
  };
}

export default Reports;

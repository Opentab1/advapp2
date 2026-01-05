/**
 * Reports - Executive summary for managers
 * 
 * Comprehensive, value-packed reports that translate data into
 * dollars and decisions. Supports daily, weekly, and monthly views.
 */

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { 
  FileText, Download, Share2, Users, TrendingUp, TrendingDown,
  DollarSign, Target, CheckCircle, AlertTriangle, 
  RefreshCw, Calendar, ChevronRight, Lightbulb, Star, Music,
  ArrowUp, ArrowDown, Minus, Mail, Copy, Zap
} from 'lucide-react';
import apiService from '../services/api.service';
import authService from '../services/auth.service';
import { calculatePulseScore } from '../utils/scoring';
import { PullToRefresh } from '../components/common/PullToRefresh';
import { haptic } from '../utils/haptics';
import type { SensorData, TimeRange } from '../types';

// ============ TYPES ============

type ReportPeriod = 'today' | 'week' | 'month';

interface PeriodConfig {
  label: string;
  apiRange: TimeRange;
  comparisonLabel: string;
  dateFormat: Intl.DateTimeFormatOptions;
}

interface ReportSummary {
  period: ReportPeriod;
  dateRange: string;
  // Core metrics
  avgPulseScore: number | null;
  peakPulseScore: number | null;
  peakPulseTime: string | null;
  lowestPulseScore: number | null;
  lowestPulseTime: string | null;
  // Traffic
  totalVisitors: number;
  avgVisitorsPerDay: number;
  peakOccupancy: number;
  peakOccupancyTime: string | null;
  // Environment
  avgDecibels: number | null;
  avgLight: number | null;
  // Performance
  hoursAbove80: number;
  hoursBelow60: number;
  totalHours: number;
  // Revenue estimate
  estimatedRevenue: number;
  revenuePerVisitor: number;
  // Highlights
  bestHour: { time: string; score: number; occupancy: number } | null;
  worstHour: { time: string; score: number; reason: string } | null;
  topSong: { name: string; artist: string; playCount: number } | null;
  longestStreak: { start: string; end: string; hours: number } | null;
  // Comparison to previous period
  comparison: {
    visitors: number; // percentage change
    pulseScore: number; // point change
    revenue: number; // percentage change
  } | null;
  // Hourly/Daily data for chart
  timelineData: Array<{ label: string; score: number | null; occupancy: number }>;
  // AI Recommendations
  recommendations: string[];
}

const PERIOD_CONFIG: Record<ReportPeriod, PeriodConfig> = {
  today: {
    label: 'Today',
    apiRange: '24h',
    comparisonLabel: 'vs Yesterday',
    dateFormat: { weekday: 'long', month: 'short', day: 'numeric' },
  },
  week: {
    label: 'This Week',
    apiRange: '7d',
    comparisonLabel: 'vs Last Week',
    dateFormat: { month: 'short', day: 'numeric' },
  },
  month: {
    label: 'This Month',
    apiRange: '30d',
    comparisonLabel: 'vs Last Month',
    dateFormat: { month: 'long', year: 'numeric' },
  },
};

// ============ MAIN COMPONENT ============

export function Reports() {
  const user = authService.getStoredUser();
  const venueId = user?.venueId || '';
  const venueName = user?.venueName || 'Venue';
  
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<ReportPeriod>('today');
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [showShareMenu, setShowShareMenu] = useState(false);

  const fetchReportData = useCallback(async () => {
    if (!venueId) return;
    
    setLoading(true);
    try {
      const config = PERIOD_CONFIG[period];
      
      // Fetch current period data
      const result = await apiService.getHistoricalData(venueId, config.apiRange);
      
      // Fetch previous period for comparison
      let previousResult = null;
      try {
        const prevRange = period === 'today' ? '24h' : period === 'week' ? '14d' : '90d';
        previousResult = await apiService.getHistoricalData(venueId, prevRange as TimeRange);
      } catch {
        // Comparison data optional
      }
      
      if (result?.data && result.data.length > 0) {
        const processed = processReportData(result.data, previousResult?.data || [], period);
        setSummary(processed);
      } else {
        setSummary(null);
      }
    } catch (err) {
      console.error('Failed to fetch report data:', err);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [venueId, period]);

  useEffect(() => {
    fetchReportData();
  }, [fetchReportData]);

  const handlePeriodChange = (newPeriod: ReportPeriod) => {
    haptic('selection');
    setPeriod(newPeriod);
  };

  const handleRefresh = async () => {
    haptic('medium');
    await fetchReportData();
  };

  // ============ SHARE FUNCTIONS ============

  const generateReportText = (data: ReportSummary, venue: string): string => {
    const grade = getGrade(data.avgPulseScore);
    const config = PERIOD_CONFIG[data.period];
    
    let text = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `  ${venue.toUpperCase()} PERFORMANCE REPORT\n`;
    text += `  ${config.label} • ${data.dateRange}\n`;
    text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    
    text += `📊 OVERALL GRADE: ${grade}\n`;
    text += `   Pulse Score: ${data.avgPulseScore ?? '--'}/100\n\n`;
    
    text += `💰 REVENUE IMPACT\n`;
    text += `───────────────────────────────────\n`;
    text += `   Estimated Revenue: $${data.estimatedRevenue.toLocaleString()}\n`;
    text += `   Per Visitor: $${data.revenuePerVisitor.toFixed(2)}\n`;
    if (data.comparison) {
      const revSign = data.comparison.revenue >= 0 ? '+' : '';
      text += `   ${config.comparisonLabel}: ${revSign}${data.comparison.revenue}%\n`;
    }
    text += `\n`;
    
    text += `👥 TRAFFIC\n`;
    text += `───────────────────────────────────\n`;
    text += `   Total Visitors: ${data.totalVisitors.toLocaleString()}\n`;
    text += `   Peak Crowd: ${data.peakOccupancy} @ ${data.peakOccupancyTime || '--'}\n`;
    if (data.comparison) {
      const visSign = data.comparison.visitors >= 0 ? '+' : '';
      text += `   ${config.comparisonLabel}: ${visSign}${data.comparison.visitors}%\n`;
    }
    text += `\n`;
    
    text += `⭐ HIGHLIGHTS\n`;
    text += `───────────────────────────────────\n`;
    if (data.bestHour) {
      text += `   Best: ${data.bestHour.time} (Score ${data.bestHour.score})\n`;
    }
    if (data.worstHour) {
      text += `   Needs Work: ${data.worstHour.time} - ${data.worstHour.reason}\n`;
    }
    if (data.topSong) {
      text += `   Top Song: "${data.topSong.name}" by ${data.topSong.artist}\n`;
    }
    text += `\n`;
    
    if (data.recommendations.length > 0) {
      text += `🔧 RECOMMENDATIONS\n`;
      text += `───────────────────────────────────\n`;
      data.recommendations.forEach((rec, i) => {
        text += `   ${i + 1}. ${rec}\n`;
      });
      text += `\n`;
    }
    
    text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `  Generated by Advizia Pulse\n`;
    text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    
    return text;
  };

  const handleCopyReport = async () => {
    if (!summary) return;
    haptic('medium');
    const text = generateReportText(summary, venueName);
    await navigator.clipboard.writeText(text);
    setShowShareMenu(false);
    alert('Report copied to clipboard!');
  };

  const handleShareReport = async () => {
    if (!summary) return;
    haptic('medium');
    const text = generateReportText(summary, venueName);
    
    if (navigator.share) {
      try {
        await navigator.share({ 
          title: `${venueName} - ${PERIOD_CONFIG[period].label} Report`,
          text 
        });
      } catch {
        await navigator.clipboard.writeText(text);
      }
    } else {
      await navigator.clipboard.writeText(text);
      alert('Report copied to clipboard!');
    }
    setShowShareMenu(false);
  };

  const handleEmailReport = () => {
    if (!summary) return;
    haptic('medium');
    const text = generateReportText(summary, venueName);
    const subject = encodeURIComponent(`${venueName} - ${PERIOD_CONFIG[period].label} Performance Report`);
    const body = encodeURIComponent(text);
    window.open(`mailto:?subject=${subject}&body=${body}`);
    setShowShareMenu(false);
  };

  const handleDownloadReport = () => {
    if (!summary) return;
    haptic('medium');
    const text = generateReportText(summary, venueName);
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const dateStr = new Date().toISOString().split('T')[0];
    a.download = `${venueName.replace(/\s+/g, '-')}-${period}-report-${dateStr}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setShowShareMenu(false);
  };

  // ============ RENDER ============

  const grade = getGrade(summary?.avgPulseScore ?? null);
  const gradeColor = getGradeColor(grade);
  const config = PERIOD_CONFIG[period];

  return (
    <PullToRefresh onRefresh={handleRefresh} disabled={loading}>
      <div className="space-y-5">
        {/* Header */}
        <motion.div
          className="flex items-center justify-between"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div>
            <h1 className="text-2xl font-bold text-white">Reports</h1>
            <p className="text-sm text-text-secondary mt-0.5">Performance insights & analytics</p>
          </div>
          <motion.button
            onClick={handleRefresh}
            className="p-2 rounded-lg bg-whoop-panel text-text-muted hover:text-white transition-colors"
            whileTap={{ scale: 0.95 }}
            disabled={loading}
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </motion.button>
        </motion.div>

        {/* Period Selector */}
        <motion.div
          className="flex gap-2 p-1 bg-whoop-panel rounded-xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          {(Object.keys(PERIOD_CONFIG) as ReportPeriod[]).map((p) => (
            <button
              key={p}
              onClick={() => handlePeriodChange(p)}
              className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all ${
                period === p
                  ? 'bg-teal text-black'
                  : 'text-text-secondary hover:text-white'
              }`}
            >
              {PERIOD_CONFIG[p].label}
            </button>
          ))}
        </motion.div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-teal border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* No Data */}
        {!loading && !summary && (
          <motion.div
            className="glass-card p-8 text-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <FileText className="w-12 h-12 text-text-muted mx-auto mb-3" />
            <p className="text-white font-medium">No data for {config.label.toLowerCase()}</p>
            <p className="text-sm text-text-secondary mt-1">
              Check back after your venue has been open.
            </p>
          </motion.div>
        )}

        {/* Report Content */}
        {!loading && summary && (
          <>
            {/* 1. Executive Summary */}
            <motion.div
              className="glass-card p-6"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="text-xs text-text-secondary uppercase tracking-whoop">Overall Grade</p>
                  <div className={`text-6xl font-bold ${gradeColor} mt-1`}>{grade}</div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-text-secondary">{config.label}</p>
                  <p className="text-sm text-white font-medium">{summary.dateRange}</p>
                </div>
              </div>
              
              <div className="flex items-center gap-2 mb-4">
                <Target className="w-4 h-4 text-text-muted" />
                <span className="text-white">
                  Pulse Score: <strong className={gradeColor}>{summary.avgPulseScore ?? '--'}</strong>/100
                </span>
                {summary.comparison && (
                  <ComparisonBadge value={summary.comparison.pulseScore} suffix="pts" />
                )}
              </div>
              
              {/* Quick insight */}
              <div className="p-3 rounded-lg bg-whoop-panel-secondary">
                {summary.avgPulseScore !== null && summary.avgPulseScore >= 80 ? (
                  <div className="flex items-center gap-2 text-recovery-high">
                    <CheckCircle className="w-4 h-4" />
                    <span className="text-sm">Excellent performance! Keep up the great work.</span>
                  </div>
                ) : summary.avgPulseScore !== null && summary.avgPulseScore >= 60 ? (
                  <div className="flex items-center gap-2 text-teal">
                    <TrendingUp className="w-4 h-4" />
                    <span className="text-sm">Solid performance with room for improvement.</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-recovery-medium">
                    <AlertTriangle className="w-4 h-4" />
                    <span className="text-sm">Review recommendations below to improve.</span>
                  </div>
                )}
              </div>
            </motion.div>

            {/* 2. The Money Story */}
            <motion.div
              className="glass-card p-5"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
            >
              <div className="flex items-center gap-2 mb-4">
                <DollarSign className="w-5 h-5 text-recovery-high" />
                <h3 className="font-semibold text-white">Revenue Impact</h3>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-text-muted mb-1">Estimated Revenue</p>
                  <p className="text-3xl font-bold text-recovery-high">
                    ${summary.estimatedRevenue.toLocaleString()}
                  </p>
                  {summary.comparison && (
                    <ComparisonBadge value={summary.comparison.revenue} suffix="%" className="mt-1" />
                  )}
                </div>
                <div>
                  <p className="text-xs text-text-muted mb-1">Per Visitor</p>
                  <p className="text-3xl font-bold text-white">
                    ${summary.revenuePerVisitor.toFixed(0)}
                  </p>
                  <p className="text-xs text-text-secondary mt-1">avg spend</p>
                </div>
              </div>
              
              <div className="mt-4 pt-4 border-t border-whoop-divider">
                <p className="text-xs text-text-secondary">
                  💡 A 10-point Pulse Score increase typically means +$2-3 per visitor
                </p>
              </div>
            </motion.div>

            {/* 3. vs Last Period */}
            {summary.comparison && (
              <motion.div
                className="glass-card p-5"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
              >
                <div className="flex items-center gap-2 mb-4">
                  <Calendar className="w-5 h-5 text-strain" />
                  <h3 className="font-semibold text-white">{config.comparisonLabel}</h3>
                </div>
                
                <div className="grid grid-cols-3 gap-3">
                  <ComparisonStat
                    label="Visitors"
                    value={summary.comparison.visitors}
                    suffix="%"
                  />
                  <ComparisonStat
                    label="Score"
                    value={summary.comparison.pulseScore}
                    suffix="pts"
                  />
                  <ComparisonStat
                    label="Revenue"
                    value={summary.comparison.revenue}
                    suffix="%"
                  />
                </div>
              </motion.div>
            )}

            {/* 4. Highlights */}
            <motion.div
              className="glass-card p-5"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
            >
              <div className="flex items-center gap-2 mb-4">
                <Star className="w-5 h-5 text-recovery-medium" />
                <h3 className="font-semibold text-white">Highlights</h3>
              </div>
              
              <div className="space-y-3">
                {summary.bestHour && (
                  <HighlightRow
                    icon={<TrendingUp className="w-4 h-4 text-recovery-high" />}
                    label="Best Performance"
                    value={`${summary.bestHour.time} • Score ${summary.bestHour.score}`}
                    subtext={`${summary.bestHour.occupancy} guests`}
                    positive
                  />
                )}
                
                {summary.worstHour && (
                  <HighlightRow
                    icon={<TrendingDown className="w-4 h-4 text-recovery-low" />}
                    label="Needs Attention"
                    value={summary.worstHour.time}
                    subtext={summary.worstHour.reason}
                    positive={false}
                  />
                )}
                
                {summary.longestStreak && (
                  <HighlightRow
                    icon={<Zap className="w-4 h-4 text-teal" />}
                    label="Best Streak"
                    value={`${summary.longestStreak.hours} hours above 70`}
                    subtext={`${summary.longestStreak.start} - ${summary.longestStreak.end}`}
                    positive
                  />
                )}
                
                {summary.topSong && (
                  <HighlightRow
                    icon={<Music className="w-4 h-4 text-strain" />}
                    label="Top Song"
                    value={summary.topSong.name}
                    subtext={`${summary.topSong.artist} • ${summary.topSong.playCount} plays`}
                    positive
                  />
                )}
              </div>
            </motion.div>

            {/* 5. Recommendations */}
            {summary.recommendations.length > 0 && (
              <motion.div
                className="glass-card p-5"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
              >
                <div className="flex items-center gap-2 mb-4">
                  <Lightbulb className="w-5 h-5 text-recovery-medium" />
                  <h3 className="font-semibold text-white">What To Fix Next Time</h3>
                </div>
                
                <div className="space-y-3">
                  {summary.recommendations.map((rec, i) => (
                    <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-whoop-panel-secondary">
                      <div className="w-6 h-6 rounded-full bg-teal/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-xs font-bold text-teal">{i + 1}</span>
                      </div>
                      <p className="text-sm text-text-secondary">{rec}</p>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* 6. Timeline */}
            {summary.timelineData.length > 0 && (
              <motion.div
                className="glass-card p-5"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25 }}
              >
                <h3 className="text-xs text-text-secondary uppercase tracking-whoop mb-4">
                  {period === 'today' ? 'Hourly' : period === 'week' ? 'Daily' : 'Weekly'} Timeline
                </h3>
                
                <div className="space-y-1.5">
                  {summary.timelineData.filter(t => t.score !== null).slice(0, 12).map((t, idx) => (
                    <div key={t.label} className="flex items-center gap-3">
                      <div className="w-14 text-xs text-text-muted">{t.label}</div>
                      <div className="flex-1 h-5 bg-whoop-panel-secondary rounded-full overflow-hidden">
                        <motion.div
                          className={`h-full rounded-full ${
                            t.score! >= 80 ? 'bg-recovery-high' 
                            : t.score! >= 60 ? 'bg-teal' 
                            : 'bg-recovery-low'
                          }`}
                          initial={{ width: 0 }}
                          animate={{ width: `${t.score}%` }}
                          transition={{ duration: 0.4, delay: idx * 0.02 }}
                        />
                      </div>
                      <div className="w-8 text-right text-sm font-medium text-white">{t.score}</div>
                      <div className="w-10 text-right text-xs text-text-muted">
                        <Users className="w-3 h-3 inline mr-0.5" />
                        {t.occupancy}
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* 7. Share Options */}
            <motion.div
              className="space-y-3"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
            >
              {/* Main action buttons */}
              <div className="grid grid-cols-2 gap-3">
                <motion.button
                  onClick={() => setShowShareMenu(!showShareMenu)}
                  className="flex items-center justify-center gap-2 py-4 bg-teal text-black font-semibold rounded-xl"
                  whileTap={{ scale: 0.97 }}
                >
                  <Share2 className="w-5 h-5" />
                  Share Report
                </motion.button>
                
                <motion.button
                  onClick={handleDownloadReport}
                  className="flex items-center justify-center gap-2 py-4 bg-whoop-panel border border-whoop-divider text-white font-semibold rounded-xl"
                  whileTap={{ scale: 0.97 }}
                >
                  <Download className="w-5 h-5" />
                  Download
                </motion.button>
              </div>
              
              {/* Share menu */}
              {showShareMenu && (
                <motion.div
                  className="glass-card p-2 space-y-1"
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <ShareOption
                    icon={<Copy className="w-4 h-4" />}
                    label="Copy to Clipboard"
                    onClick={handleCopyReport}
                  />
                  <ShareOption
                    icon={<Share2 className="w-4 h-4" />}
                    label="Share..."
                    onClick={handleShareReport}
                  />
                  <ShareOption
                    icon={<Mail className="w-4 h-4" />}
                    label="Email to Manager"
                    onClick={handleEmailReport}
                  />
                </motion.div>
              )}
            </motion.div>

            {/* Footer */}
            <div className="text-center py-4">
              <p className="text-xs text-text-muted">
                Powered by Advizia Pulse
              </p>
            </div>
          </>
        )}
      </div>
    </PullToRefresh>
  );
}

// ============ HELPER COMPONENTS ============

function ComparisonBadge({ 
  value, 
  suffix = '', 
  className = '' 
}: { 
  value: number; 
  suffix?: string;
  className?: string;
}) {
  const isPositive = value >= 0;
  const Icon = isPositive ? ArrowUp : ArrowDown;
  
  return (
    <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-medium ${
      isPositive ? 'bg-recovery-high/20 text-recovery-high' : 'bg-recovery-low/20 text-recovery-low'
    } ${className}`}>
      <Icon className="w-3 h-3" />
      {isPositive ? '+' : ''}{value}{suffix}
    </span>
  );
}

function ComparisonStat({ 
  label, 
  value, 
  suffix 
}: { 
  label: string; 
  value: number; 
  suffix: string;
}) {
  const isPositive = value >= 0;
  const isNeutral = value === 0;
  const Icon = isNeutral ? Minus : isPositive ? ArrowUp : ArrowDown;
  const color = isNeutral ? 'text-text-muted' : isPositive ? 'text-recovery-high' : 'text-recovery-low';
  
  return (
    <div className="text-center p-3 rounded-lg bg-whoop-panel-secondary">
      <p className="text-xs text-text-muted mb-1">{label}</p>
      <div className={`flex items-center justify-center gap-1 ${color}`}>
        <Icon className="w-4 h-4" />
        <span className="text-lg font-bold">
          {isPositive && !isNeutral ? '+' : ''}{value}{suffix}
        </span>
      </div>
    </div>
  );
}

function HighlightRow({
  icon,
  label,
  value,
  subtext,
  positive,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subtext: string;
  positive: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg border ${
      positive ? 'bg-recovery-high/5 border-recovery-high/20' : 'bg-recovery-low/5 border-recovery-low/20'
    }`}>
      <div className="flex-shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-text-muted">{label}</p>
        <p className="text-sm font-medium text-white truncate">{value}</p>
      </div>
      <p className="text-xs text-text-secondary text-right">{subtext}</p>
    </div>
  );
}

function ShareOption({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-whoop-panel-secondary transition-colors text-left"
    >
      <span className="text-text-muted">{icon}</span>
      <span className="text-sm text-white">{label}</span>
      <ChevronRight className="w-4 h-4 text-text-muted ml-auto" />
    </button>
  );
}

// ============ DATA PROCESSING ============

function processReportData(
  data: SensorData[],
  previousData: SensorData[],
  period: ReportPeriod
): ReportSummary {
  const now = new Date();
  
  // Group data by time unit
  const isDaily = period === 'today';
  const timeMap = new Map<string, SensorData[]>();
  
  data.forEach(d => {
    const date = new Date(d.timestamp);
    let key: string;
    if (isDaily) {
      key = formatHour(date.getHours());
    } else if (period === 'week') {
      key = date.toLocaleDateString('en-US', { weekday: 'short' });
    } else {
      key = `Week ${Math.ceil(date.getDate() / 7)}`;
    }
    if (!timeMap.has(key)) timeMap.set(key, []);
    timeMap.get(key)!.push(d);
  });
  
  // Calculate metrics
  let totalPulse = 0, pulseCount = 0;
  let totalDb = 0, dbCount = 0;
  let totalLight = 0, lightCount = 0;
  let peakOccupancy = 0, peakOccupancyTime: string | null = null;
  let peakPulse = 0, peakPulseTime: string | null = null;
  let lowestPulse = 100, lowestPulseTime: string | null = null;
  let hoursAbove80 = 0, hoursBelow60 = 0;
  
  const timelineData: Array<{ label: string; score: number | null; occupancy: number }> = [];
  const songCounts = new Map<string, { name: string; artist: string; count: number }>();
  
  // Track streak
  let currentStreak = 0;
  let maxStreak = 0;
  let streakStart = '';
  let streakEnd = '';
  let currentStreakStart = '';
  
  // Best/worst tracking
  let bestHour: { time: string; score: number; occupancy: number } | null = null;
  let worstHour: { time: string; score: number; reason: string } | null = null;
  
  timeMap.forEach((items, timeKey) => {
    let timePulse = 0, timePulseCount = 0;
    let timeOccupancy = 0;
    let timeDb = 0, timeDbCount = 0;
    
    items.forEach(d => {
      if (d.decibels !== undefined && d.light !== undefined) {
        const { score } = calculatePulseScore(d.decibels, d.light);
        if (score !== null) {
          timePulse += score;
          timePulseCount++;
          totalPulse += score;
          pulseCount++;
        }
      }
      if (d.decibels) { totalDb += d.decibels; dbCount++; timeDb += d.decibels; timeDbCount++; }
      if (d.light) { totalLight += d.light; lightCount++; }
      if (d.occupancy?.current && d.occupancy.current > timeOccupancy) {
        timeOccupancy = d.occupancy.current;
      }
      
      // Track songs
      if (d.currentSong && d.artist) {
        const songKey = `${d.currentSong}-${d.artist}`;
        if (!songCounts.has(songKey)) {
          songCounts.set(songKey, { name: d.currentSong, artist: d.artist, count: 0 });
        }
        songCounts.get(songKey)!.count++;
      }
    });
    
    const avgTimePulse = timePulseCount > 0 ? Math.round(timePulse / timePulseCount) : null;
    const avgTimeDb = timeDbCount > 0 ? Math.round(timeDb / timeDbCount) : null;
    
    timelineData.push({ label: timeKey, score: avgTimePulse, occupancy: timeOccupancy });
    
    if (avgTimePulse !== null) {
      if (avgTimePulse >= 80) hoursAbove80++;
      if (avgTimePulse < 60) hoursBelow60++;
      
      if (avgTimePulse > peakPulse) { peakPulse = avgTimePulse; peakPulseTime = timeKey; }
      if (avgTimePulse < lowestPulse) { lowestPulse = avgTimePulse; lowestPulseTime = timeKey; }
      
      // Best hour
      if (!bestHour || avgTimePulse > bestHour.score) {
        bestHour = { time: timeKey, score: avgTimePulse, occupancy: timeOccupancy };
      }
      
      // Worst hour
      if (avgTimePulse < 60 && (!worstHour || avgTimePulse < worstHour.score)) {
        let reason = 'Score below target';
        if (avgTimeDb && avgTimeDb > 80) reason = 'Sound too loud';
        else if (avgTimeDb && avgTimeDb < 65) reason = 'Sound too quiet';
        worstHour = { time: timeKey, score: avgTimePulse, reason };
      }
      
      // Streak tracking
      if (avgTimePulse >= 70) {
        if (currentStreak === 0) currentStreakStart = timeKey;
        currentStreak++;
        if (currentStreak > maxStreak) {
          maxStreak = currentStreak;
          streakStart = currentStreakStart;
          streakEnd = timeKey;
        }
      } else {
        currentStreak = 0;
      }
    }
    
    if (timeOccupancy > peakOccupancy) {
      peakOccupancy = timeOccupancy;
      peakOccupancyTime = timeKey;
    }
  });
  
  // Total visitors
  const entriesSet = new Set<number>();
  data.forEach(d => { if (d.occupancy?.entries) entriesSet.add(d.occupancy.entries); });
  const totalVisitors = entriesSet.size > 0 ? Math.max(...entriesSet) : Math.max(peakOccupancy * 3, 50);
  
  // Revenue estimation
  const avgPulseScore = pulseCount > 0 ? Math.round(totalPulse / pulseCount) : null;
  const baseSpendPerVisitor = 25; // Base $25 per visitor
  const pulseMultiplier = avgPulseScore ? 1 + ((avgPulseScore - 50) / 100) : 1;
  const revenuePerVisitor = baseSpendPerVisitor * pulseMultiplier;
  const estimatedRevenue = Math.round(totalVisitors * revenuePerVisitor);
  
  // Top song
  let topSong: { name: string; artist: string; playCount: number } | null = null;
  songCounts.forEach((song) => {
    if (!topSong || song.count > topSong.playCount) {
      topSong = { name: song.name, artist: song.artist, playCount: song.count };
    }
  });
  
  // Longest streak
  const longestStreak = maxStreak >= 2 ? { start: streakStart, end: streakEnd, hours: maxStreak } : null;
  
  // Calculate comparison
  let comparison: ReportSummary['comparison'] = null;
  if (previousData.length > 0) {
    // Split previous data based on period
    const prevPeriodData = period === 'today' 
      ? previousData.filter(d => {
          const date = new Date(d.timestamp);
          const yesterday = new Date(now);
          yesterday.setDate(yesterday.getDate() - 1);
          return date.toDateString() === yesterday.toDateString();
        })
      : period === 'week'
        ? previousData.filter(d => {
            const date = new Date(d.timestamp);
            const daysAgo = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
            return daysAgo >= 7 && daysAgo < 14;
          })
        : previousData.filter(d => {
            const date = new Date(d.timestamp);
            const daysAgo = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
            return daysAgo >= 30 && daysAgo < 60;
          });
    
    if (prevPeriodData.length > 0) {
      let prevPulse = 0, prevPulseCount = 0;
      const prevEntriesSet = new Set<number>();
      
      prevPeriodData.forEach(d => {
        if (d.decibels !== undefined && d.light !== undefined) {
          const { score } = calculatePulseScore(d.decibels, d.light);
          if (score !== null) { prevPulse += score; prevPulseCount++; }
        }
        if (d.occupancy?.entries) prevEntriesSet.add(d.occupancy.entries);
      });
      
      const prevAvgPulse = prevPulseCount > 0 ? Math.round(prevPulse / prevPulseCount) : null;
      const prevVisitors = prevEntriesSet.size > 0 ? Math.max(...prevEntriesSet) : 0;
      const prevRevenue = prevVisitors * baseSpendPerVisitor * (prevAvgPulse ? 1 + ((prevAvgPulse - 50) / 100) : 1);
      
      comparison = {
        visitors: prevVisitors > 0 ? Math.round(((totalVisitors - prevVisitors) / prevVisitors) * 100) : 0,
        pulseScore: avgPulseScore !== null && prevAvgPulse !== null ? avgPulseScore - prevAvgPulse : 0,
        revenue: prevRevenue > 0 ? Math.round(((estimatedRevenue - prevRevenue) / prevRevenue) * 100) : 0,
      };
    }
  }
  
  // Generate recommendations
  const recommendations: string[] = [];
  const avgDecibels = dbCount > 0 ? Math.round(totalDb / dbCount) : null;
  const avgLight = lightCount > 0 ? Math.round(totalLight / lightCount) : null;
  
  if (avgDecibels && avgDecibels > 78) {
    recommendations.push(`Sound averaged ${avgDecibels}dB - try keeping it under 78dB during conversation hours.`);
  } else if (avgDecibels && avgDecibels < 65) {
    recommendations.push(`Sound was quiet at ${avgDecibels}dB avg - boost energy with 70-75dB during peak hours.`);
  }
  
  if (avgLight && avgLight > 400) {
    recommendations.push(`Lighting was bright (${avgLight} lux) - dim after 8pm to create better ambiance.`);
  }
  
  if (hoursBelow60 > hoursAbove80) {
    recommendations.push(`More hours below 60 than above 80 - focus on environment during ${lowestPulseTime || 'slow periods'}.`);
  }
  
  if (peakOccupancyTime && peakPulseTime && peakOccupancyTime !== peakPulseTime) {
    recommendations.push(`Peak crowd (${peakOccupancyTime}) didn't match peak performance (${peakPulseTime}) - align staffing and music.`);
  }
  
  if (recommendations.length === 0 && avgPulseScore && avgPulseScore >= 75) {
    recommendations.push(`Great job! Maintain current sound (${avgDecibels || '--'}dB) and lighting settings.`);
  }
  
  // Date range string
  const dateRange = period === 'today'
    ? now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
    : period === 'week'
      ? `${new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
      : now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  
  return {
    period,
    dateRange,
    avgPulseScore,
    peakPulseScore: peakPulse > 0 ? peakPulse : null,
    peakPulseTime,
    lowestPulseScore: lowestPulse < 100 ? lowestPulse : null,
    lowestPulseTime,
    totalVisitors,
    avgVisitorsPerDay: period === 'today' ? totalVisitors : Math.round(totalVisitors / (period === 'week' ? 7 : 30)),
    peakOccupancy,
    peakOccupancyTime,
    avgDecibels,
    avgLight,
    hoursAbove80,
    hoursBelow60,
    totalHours: timelineData.filter(t => t.score !== null).length,
    estimatedRevenue,
    revenuePerVisitor,
    bestHour,
    worstHour,
    topSong,
    longestStreak,
    comparison,
    timelineData,
    recommendations,
  };
}

function getGrade(score: number | null): string {
  if (score === null) return '--';
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  return 'D';
}

function getGradeColor(grade: string): string {
  switch (grade) {
    case 'A': return 'text-recovery-high';
    case 'B': return 'text-teal';
    case 'C': return 'text-recovery-medium';
    case 'D': return 'text-recovery-low';
    default: return 'text-text-muted';
  }
}

function formatHour(hour: number): string {
  if (hour === 0) return '12am';
  if (hour === 12) return '12pm';
  if (hour < 12) return `${hour}am`;
  return `${hour - 12}pm`;
}

export default Reports;

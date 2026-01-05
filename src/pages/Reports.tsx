/**
 * Reports - Executive summary for managers
 * 
 * Simple, clean, and highly valuable.
 * Designed to be shared with managers or reviewed personally.
 */

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { 
  FileText, Download, Share2, Users, TrendingUp, TrendingDown,
  Clock, Volume2, DollarSign, Target, CheckCircle, AlertTriangle, RefreshCw
} from 'lucide-react';
import apiService from '../services/api.service';
import authService from '../services/auth.service';
import { calculatePulseScore } from '../utils/scoring';
import { PullToRefresh } from '../components/common/PullToRefresh';
import { haptic } from '../utils/haptics';
import type { SensorData } from '../types';

interface NightSummary {
  date: string;
  dateFormatted: string;
  dayOfWeek: string;
  // Core metrics
  avgPulseScore: number | null;
  peakPulseScore: number | null;
  peakPulseHour: string | null;
  // Traffic
  totalVisitors: number;
  peakOccupancy: number;
  peakOccupancyHour: string | null;
  // Environment
  avgDecibels: number | null;
  avgLight: number | null;
  // Performance
  hoursAbove80: number;
  hoursBelow60: number;
  totalHours: number;
  // Hourly for chart
  hourlyScores: Array<{ hour: string; score: number | null; occupancy: number }>;
}

export function Reports() {
  const user = authService.getStoredUser();
  const venueId = user?.venueId || '';
  const venueName = user?.venueName || 'Venue';
  
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<NightSummary | null>(null);

  const fetchNightData = useCallback(async () => {
    if (!venueId) return;
    
    setLoading(true);
    try {
      const result = await apiService.getHistoricalData(venueId, '24h');
      
      if (result?.data && result.data.length > 0) {
        const processed = processNightData(result.data);
        setSummary(processed);
      } else {
        setSummary(null);
      }
    } catch (err) {
      console.error('Failed to fetch night data:', err);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [venueId]);

  useEffect(() => {
    fetchNightData();
  }, [fetchNightData]);

  const processNightData = (data: SensorData[]): NightSummary => {
    const now = new Date();
    
    // Group by hour
    const hourlyMap = new Map<number, SensorData[]>();
    data.forEach(d => {
      const hour = new Date(d.timestamp).getHours();
      if (!hourlyMap.has(hour)) hourlyMap.set(hour, []);
      hourlyMap.get(hour)!.push(d);
    });
    
    let totalPulse = 0, pulseCount = 0;
    let totalDb = 0, dbCount = 0;
    let totalLight = 0, lightCount = 0;
    let peakOccupancy = 0, peakOccupancyHour: string | null = null;
    let peakPulse = 0, peakPulseHour: string | null = null;
    let hoursAbove80 = 0, hoursBelow60 = 0;
    
    const hourlyScores: Array<{ hour: string; score: number | null; occupancy: number }> = [];
    
    // Process each hour
    for (let h = 0; h < 24; h++) {
      const hourData = hourlyMap.get(h) || [];
      if (hourData.length === 0) continue;
      
      let hourPulse = 0, hourPulseCount = 0;
      let hourOccupancy = 0;
      
      hourData.forEach(d => {
        if (d.decibels !== undefined && d.light !== undefined) {
          const { score } = calculatePulseScore(d.decibels, d.light);
          if (score !== null) {
            hourPulse += score;
            hourPulseCount++;
            totalPulse += score;
            pulseCount++;
          }
        }
        if (d.decibels) { totalDb += d.decibels; dbCount++; }
        if (d.light) { totalLight += d.light; lightCount++; }
        if (d.occupancy?.current && d.occupancy.current > hourOccupancy) {
          hourOccupancy = d.occupancy.current;
        }
      });
      
      const avgHourPulse = hourPulseCount > 0 ? Math.round(hourPulse / hourPulseCount) : null;
      const hourLabel = formatHour(h);
      
      hourlyScores.push({ hour: hourLabel, score: avgHourPulse, occupancy: hourOccupancy });
      
      if (avgHourPulse !== null) {
        if (avgHourPulse >= 80) hoursAbove80++;
        if (avgHourPulse < 60) hoursBelow60++;
        if (avgHourPulse > peakPulse) { peakPulse = avgHourPulse; peakPulseHour = hourLabel; }
      }
      
      if (hourOccupancy > peakOccupancy) {
        peakOccupancy = hourOccupancy;
        peakOccupancyHour = hourLabel;
      }
    }
    
    // Total visitors estimation
    const entriesSet = new Set<number>();
    data.forEach(d => { if (d.occupancy?.entries) entriesSet.add(d.occupancy.entries); });
    const totalVisitors = entriesSet.size > 0 ? Math.max(...entriesSet) : 0;
    
    const reportDate = data.length > 0 ? new Date(data[data.length - 1].timestamp) : now;
    
    return {
      date: reportDate.toISOString().split('T')[0],
      dateFormatted: reportDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      dayOfWeek: reportDate.toLocaleDateString('en-US', { weekday: 'long' }),
      avgPulseScore: pulseCount > 0 ? Math.round(totalPulse / pulseCount) : null,
      peakPulseScore: peakPulse > 0 ? peakPulse : null,
      peakPulseHour,
      totalVisitors,
      peakOccupancy,
      peakOccupancyHour,
      avgDecibels: dbCount > 0 ? Math.round(totalDb / dbCount) : null,
      avgLight: lightCount > 0 ? Math.round(totalLight / lightCount) : null,
      hoursAbove80,
      hoursBelow60,
      totalHours: hourlyScores.length,
      hourlyScores: hourlyScores.sort((a, b) => {
        const getHour = (h: string) => {
          const num = parseInt(h);
          const isPM = h.includes('pm');
          if (num === 12) return isPM ? 12 : 0;
          return isPM ? num + 12 : num;
        };
        return getHour(a.hour) - getHour(b.hour);
      }),
    };
  };

  const handleShare = async () => {
    if (!summary) return;
    haptic('medium');
    
    const text = generateReportText(summary, venueName);
    
    if (navigator.share) {
      try {
        await navigator.share({ title: `${venueName} - Performance Report`, text });
      } catch {
        navigator.clipboard.writeText(text);
      }
    } else {
      navigator.clipboard.writeText(text);
      alert('Report copied to clipboard!');
    }
  };

  const generateReportText = (data: NightSummary, venue: string): string => {
    const grade = data.avgPulseScore !== null 
      ? data.avgPulseScore >= 85 ? 'A' : data.avgPulseScore >= 70 ? 'B' : data.avgPulseScore >= 55 ? 'C' : 'D'
      : '--';
    
    let text = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `  ${venue.toUpperCase()} PERFORMANCE REPORT\n`;
    text += `  ${data.dayOfWeek}, ${data.dateFormatted}\n`;
    text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    
    text += `OVERALL GRADE: ${grade}\n`;
    text += `Pulse Score: ${data.avgPulseScore ?? '--'}/100\n\n`;
    
    text += `KEY METRICS\n`;
    text += `───────────────────────────────\n`;
    text += `👥 Total Visitors: ${data.totalVisitors}\n`;
    text += `📈 Peak Crowd: ${data.peakOccupancy} @ ${data.peakOccupancyHour || '--'}\n`;
    text += `⚡ Peak Performance: ${data.peakPulseScore || '--'} @ ${data.peakPulseHour || '--'}\n`;
    text += `🔊 Avg Sound: ${data.avgDecibels ?? '--'} dB\n\n`;
    
    text += `PERFORMANCE BREAKDOWN\n`;
    text += `───────────────────────────────\n`;
    text += `✅ Hours above 80: ${data.hoursAbove80}/${data.totalHours}\n`;
    text += `⚠️ Hours below 60: ${data.hoursBelow60}/${data.totalHours}\n\n`;
    
    text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `  Generated by Advizia Pulse\n`;
    text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    
    return text;
  };

  const handleDownload = () => {
    if (!summary) return;
    haptic('medium');
    
    const text = generateReportText(summary, venueName);
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${venueName.replace(/\s+/g, '-')}-report-${summary.date}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleRefresh = async () => {
    haptic('medium');
    await fetchNightData();
  };

  // Calculate grade
  const grade = summary?.avgPulseScore !== null 
    ? (summary?.avgPulseScore ?? 0) >= 85 ? 'A' 
      : (summary?.avgPulseScore ?? 0) >= 70 ? 'B' 
      : (summary?.avgPulseScore ?? 0) >= 55 ? 'C' : 'D'
    : '--';
  
  const gradeColor = grade === 'A' ? 'text-recovery-high' 
    : grade === 'B' ? 'text-teal' 
    : grade === 'C' ? 'text-recovery-medium' 
    : 'text-recovery-low';

  return (
    <PullToRefresh onRefresh={handleRefresh} disabled={loading}>
      <div className="space-y-6">
        {/* Header */}
        <motion.div
          className="flex items-center justify-between"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div>
            <h1 className="text-2xl font-bold text-white">Performance Report</h1>
            {summary && (
              <p className="text-sm text-text-secondary mt-1">
                {summary.dayOfWeek}, {summary.dateFormatted}
              </p>
            )}
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
            <p className="text-white font-medium">No data yet</p>
            <p className="text-sm text-text-secondary mt-1">
              Check back after your venue has been open.
            </p>
          </motion.div>
        )}

        {/* Report Content */}
        {!loading && summary && (
          <>
            {/* Grade Card - The Hero */}
            <motion.div
              className="glass-card p-6 text-center"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
            >
              <p className="text-xs text-text-secondary uppercase tracking-whoop mb-2">Overall Grade</p>
              <div className={`text-7xl font-bold ${gradeColor} mb-2`}>{grade}</div>
              <div className="flex items-center justify-center gap-2">
                <Target className="w-4 h-4 text-text-muted" />
                <span className="text-lg text-white">
                  Pulse Score: <strong>{summary.avgPulseScore ?? '--'}</strong>/100
                </span>
              </div>
              
              {/* Quick insight */}
              <div className="mt-4 pt-4 border-t border-whoop-divider">
                {summary.avgPulseScore !== null && summary.avgPulseScore >= 80 ? (
                  <div className="flex items-center justify-center gap-2 text-recovery-high">
                    <CheckCircle className="w-4 h-4" />
                    <span className="text-sm">Great night! Keep it up.</span>
                  </div>
                ) : summary.avgPulseScore !== null && summary.avgPulseScore >= 60 ? (
                  <div className="flex items-center justify-center gap-2 text-teal">
                    <TrendingUp className="w-4 h-4" />
                    <span className="text-sm">Solid performance with room to grow.</span>
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-2 text-recovery-medium">
                    <AlertTriangle className="w-4 h-4" />
                    <span className="text-sm">Review sound & lighting for improvements.</span>
                  </div>
                )}
              </div>
            </motion.div>

            {/* Key Metrics Grid */}
            <motion.div
              className="grid grid-cols-2 gap-3"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
            >
              <MetricCard
                icon={<Users className="w-5 h-5" />}
                label="Total Visitors"
                value={summary.totalVisitors.toString()}
                subtext={summary.peakOccupancyHour ? `Peak: ${summary.peakOccupancy} @ ${summary.peakOccupancyHour}` : undefined}
                color="text-teal"
              />
              <MetricCard
                icon={<TrendingUp className="w-5 h-5" />}
                label="Peak Performance"
                value={summary.peakPulseScore?.toString() ?? '--'}
                subtext={summary.peakPulseHour ? `@ ${summary.peakPulseHour}` : undefined}
                color="text-recovery-high"
              />
              <MetricCard
                icon={<Volume2 className="w-5 h-5" />}
                label="Avg Sound"
                value={`${summary.avgDecibels ?? '--'}`}
                subtext="dB"
                color="text-strain"
              />
              <MetricCard
                icon={<Clock className="w-5 h-5" />}
                label="Hours Tracked"
                value={summary.totalHours.toString()}
                subtext={`${summary.hoursAbove80} excellent`}
                color="text-sleep"
              />
            </motion.div>

            {/* Performance Breakdown */}
            <motion.div
              className="glass-card p-5"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
            >
              <h3 className="text-xs text-text-secondary uppercase tracking-whoop mb-4">Performance Breakdown</h3>
              
              <div className="space-y-3">
                <PerformanceRow
                  label="Excellent (80+)"
                  count={summary.hoursAbove80}
                  total={summary.totalHours}
                  color="bg-recovery-high"
                />
                <PerformanceRow
                  label="Good (60-79)"
                  count={summary.totalHours - summary.hoursAbove80 - summary.hoursBelow60}
                  total={summary.totalHours}
                  color="bg-teal"
                />
                <PerformanceRow
                  label="Needs Work (<60)"
                  count={summary.hoursBelow60}
                  total={summary.totalHours}
                  color="bg-recovery-low"
                />
              </div>
            </motion.div>

            {/* Hourly Timeline */}
            {summary.hourlyScores.length > 0 && (
              <motion.div
                className="glass-card p-5"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
              >
                <h3 className="text-xs text-text-secondary uppercase tracking-whoop mb-4">Hourly Timeline</h3>
                
                <div className="space-y-1.5">
                  {summary.hourlyScores.filter(h => h.score !== null).map((h, idx) => (
                    <div key={h.hour} className="flex items-center gap-3">
                      <div className="w-12 text-xs text-text-muted">{h.hour}</div>
                      <div className="flex-1 h-6 bg-whoop-panel-secondary rounded-full overflow-hidden">
                        <motion.div
                          className={`h-full rounded-full ${
                            h.score! >= 80 ? 'bg-recovery-high' 
                            : h.score! >= 60 ? 'bg-teal' 
                            : 'bg-recovery-low'
                          }`}
                          initial={{ width: 0 }}
                          animate={{ width: `${h.score}%` }}
                          transition={{ duration: 0.5, delay: idx * 0.03 }}
                        />
                      </div>
                      <div className="w-8 text-right text-sm font-medium text-white">{h.score}</div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* Action Buttons */}
            <motion.div
              className="grid grid-cols-2 gap-3"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
            >
              <motion.button
                onClick={handleShare}
                className="flex items-center justify-center gap-2 py-4 bg-teal text-black font-semibold rounded-xl"
                whileTap={{ scale: 0.97 }}
              >
                <Share2 className="w-5 h-5" />
                Share
              </motion.button>
              
              <motion.button
                onClick={handleDownload}
                className="flex items-center justify-center gap-2 py-4 bg-whoop-panel border border-whoop-divider text-white font-semibold rounded-xl"
                whileTap={{ scale: 0.97 }}
              >
                <Download className="w-5 h-5" />
                Download
              </motion.button>
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

// ============ COMPONENTS ============

function MetricCard({ 
  icon, label, value, subtext, color 
}: { 
  icon: React.ReactNode; 
  label: string; 
  value: string; 
  subtext?: string;
  color: string;
}) {
  return (
    <div className="glass-card p-4">
      <div className={`${color} mb-2`}>{icon}</div>
      <p className="text-xs text-text-muted mb-1">{label}</p>
      <p className="text-2xl font-bold text-white">{value}</p>
      {subtext && <p className="text-xs text-text-secondary mt-1">{subtext}</p>}
    </div>
  );
}

function PerformanceRow({ 
  label, count, total, color 
}: { 
  label: string; 
  count: number; 
  total: number; 
  color: string;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  
  return (
    <div className="flex items-center gap-3">
      <div className="w-28 text-sm text-text-secondary">{label}</div>
      <div className="flex-1 h-3 bg-whoop-panel-secondary rounded-full overflow-hidden">
        <motion.div
          className={`h-full rounded-full ${color}`}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.5 }}
        />
      </div>
      <div className="w-16 text-right text-sm text-white">
        {count} <span className="text-text-muted">/ {total}</span>
      </div>
    </div>
  );
}

// ============ HELPERS ============

function formatHour(hour: number): string {
  if (hour === 0) return '12am';
  if (hour === 12) return '12pm';
  if (hour < 12) return `${hour}am`;
  return `${hour - 12}pm`;
}

export default Reports;

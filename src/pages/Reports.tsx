/**
 * Reports - Dedicated reports page
 * 
 * Shows night reports, export functionality, and historical summaries.
 * Moved from the modal to a dedicated tab for better UX.
 */

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { 
  FileText, Download, Share2, Users, Zap, Volume2, 
  TrendingUp, TrendingDown, RefreshCw,
  ChevronDown, ChevronUp, Calendar, Sun, Moon
} from 'lucide-react';
import apiService from '../services/api.service';
import authService from '../services/auth.service';
import { calculatePulseScore } from '../utils/scoring';
import { PullToRefresh } from '../components/common/PullToRefresh';
import { haptic } from '../utils/haptics';
import type { SensorData } from '../types';

interface HourlyData {
  hour: number;
  hourLabel: string;
  avgPulseScore: number | null;
  avgDecibels: number | null;
  avgLight: number | null;
  peakOccupancy: number;
  entries: number;
  dataPoints: number;
}

interface NightSummary {
  date: string;
  dateFormatted: string;
  dayOfWeek: string;
  overallPulseScore: number | null;
  peakPulseScore: number | null;
  peakPulseHour: string | null;
  lowestPulseScore: number | null;
  lowestPulseHour: string | null;
  totalVisitors: number;
  peakOccupancy: number;
  peakOccupancyHour: string | null;
  avgDecibels: number | null;
  avgLight: number | null;
  hoursTracked: number;
  hourlyData: HourlyData[];
}

export function Reports() {
  const user = authService.getStoredUser();
  const venueId = user?.venueId || '';
  const venueName = user?.venueName || 'Venue';
  
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<NightSummary | null>(null);
  const [showAllHours, setShowAllHours] = useState(false);

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
    const today = now.toDateString();
    
    const todayData = data.filter(d => {
      const date = new Date(d.timestamp);
      return date.toDateString() === today;
    });
    
    const relevantData = todayData.length > 0 ? todayData : data;
    
    const hourlyMap = new Map<number, SensorData[]>();
    relevantData.forEach(d => {
      const hour = new Date(d.timestamp).getHours();
      if (!hourlyMap.has(hour)) {
        hourlyMap.set(hour, []);
      }
      hourlyMap.get(hour)!.push(d);
    });
    
    const hourlyData: HourlyData[] = [];
    let totalPulseScore = 0;
    let pulseScoreCount = 0;
    let totalDecibels = 0;
    let decibelCount = 0;
    let totalLight = 0;
    let lightCount = 0;
    let overallPeakOccupancy = 0;
    let peakOccupancyHour: string | null = null;
    let peakPulseScore = 0;
    let peakPulseHour: string | null = null;
    let lowestPulseScore = 100;
    let lowestPulseHour: string | null = null;
    
    for (let hour = 0; hour < 24; hour++) {
      const hourData = hourlyMap.get(hour) || [];
      const hourLabel = formatHour(hour);
      
      if (hourData.length === 0) continue;
      
      let hourPulseTotal = 0;
      let hourPulseCount = 0;
      let hourDbTotal = 0;
      let hourDbCount = 0;
      let hourLightTotal = 0;
      let hourLightCount = 0;
      let hourPeakOccupancy = 0;
      let hourEntries = 0;
      
      hourData.forEach(d => {
        if (d.decibels !== undefined && d.light !== undefined) {
          const { score } = calculatePulseScore(d.decibels, d.light);
          if (score !== null) {
            hourPulseTotal += score;
            hourPulseCount++;
            totalPulseScore += score;
            pulseScoreCount++;
          }
        }
        
        if (d.decibels !== undefined && d.decibels !== null) {
          hourDbTotal += d.decibels;
          hourDbCount++;
          totalDecibels += d.decibels;
          decibelCount++;
        }
        
        if (d.light !== undefined && d.light !== null) {
          hourLightTotal += d.light;
          hourLightCount++;
          totalLight += d.light;
          lightCount++;
        }
        
        if (d.occupancy) {
          if (d.occupancy.current > hourPeakOccupancy) {
            hourPeakOccupancy = d.occupancy.current;
          }
          if (d.occupancy.entries) {
            hourEntries = Math.max(hourEntries, d.occupancy.entries);
          }
        }
      });
      
      const avgPulseScore = hourPulseCount > 0 ? Math.round(hourPulseTotal / hourPulseCount) : null;
      const avgDecibels = hourDbCount > 0 ? Math.round(hourDbTotal / hourDbCount) : null;
      const avgLight = hourLightCount > 0 ? Math.round(hourLightTotal / hourLightCount) : null;
      
      if (avgPulseScore !== null) {
        if (avgPulseScore > peakPulseScore) {
          peakPulseScore = avgPulseScore;
          peakPulseHour = hourLabel;
        }
        if (avgPulseScore < lowestPulseScore) {
          lowestPulseScore = avgPulseScore;
          lowestPulseHour = hourLabel;
        }
      }
      
      if (hourPeakOccupancy > overallPeakOccupancy) {
        overallPeakOccupancy = hourPeakOccupancy;
        peakOccupancyHour = hourLabel;
      }
      
      hourlyData.push({
        hour,
        hourLabel,
        avgPulseScore,
        avgDecibels,
        avgLight,
        peakOccupancy: hourPeakOccupancy,
        entries: hourEntries,
        dataPoints: hourData.length,
      });
    }
    
    const entriesSet = new Set<number>();
    relevantData.forEach(d => {
      if (d.occupancy?.entries) {
        entriesSet.add(d.occupancy.entries);
      }
    });
    const totalVisitors = entriesSet.size > 0 ? Math.max(...entriesSet) : 0;
    
    const reportDate = relevantData.length > 0 
      ? new Date(relevantData[relevantData.length - 1].timestamp)
      : now;
    
    return {
      date: reportDate.toISOString().split('T')[0],
      dateFormatted: reportDate.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric' 
      }),
      dayOfWeek: reportDate.toLocaleDateString('en-US', { weekday: 'long' }),
      overallPulseScore: pulseScoreCount > 0 ? Math.round(totalPulseScore / pulseScoreCount) : null,
      peakPulseScore: peakPulseScore > 0 ? peakPulseScore : null,
      peakPulseHour,
      lowestPulseScore: lowestPulseScore < 100 ? lowestPulseScore : null,
      lowestPulseHour,
      totalVisitors,
      peakOccupancy: overallPeakOccupancy,
      peakOccupancyHour,
      avgDecibels: decibelCount > 0 ? Math.round(totalDecibels / decibelCount) : null,
      avgLight: lightCount > 0 ? Math.round(totalLight / lightCount) : null,
      hoursTracked: hourlyData.length,
      hourlyData: hourlyData.sort((a, b) => a.hour - b.hour),
    };
  };

  const handleShare = async () => {
    if (!summary) return;
    haptic('medium');
    
    const text = generateShareText(summary, venueName);
    
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${venueName} - Night Report`,
          text,
        });
      } catch {
        navigator.clipboard.writeText(text);
      }
    } else {
      navigator.clipboard.writeText(text);
    }
  };

  const generateShareText = (data: NightSummary, venue: string): string => {
    let text = `📊 ${venue} Night Report\n`;
    text += `📅 ${data.dayOfWeek}, ${data.dateFormatted}\n\n`;
    text += `⚡ Pulse Score: ${data.overallPulseScore ?? '--'}\n`;
    if (data.peakPulseScore && data.peakPulseHour) {
      text += `   Peak: ${data.peakPulseScore} @ ${data.peakPulseHour}\n`;
    }
    text += `\n👥 Visitors: ${data.totalVisitors}\n`;
    if (data.peakOccupancy && data.peakOccupancyHour) {
      text += `   Peak: ${data.peakOccupancy} @ ${data.peakOccupancyHour}\n`;
    }
    text += `\n🔊 Avg Sound: ${data.avgDecibels ?? '--'} dB\n`;
    text += `💡 Avg Light: ${data.avgLight ?? '--'} lux\n`;
    return text;
  };

  const handleDownload = () => {
    if (!summary) return;
    haptic('medium');
    
    const text = generateShareText(summary, venueName);
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${venueName.replace(/\s+/g, '-')}-night-report-${summary.date}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleRefresh = async () => {
    haptic('medium');
    await fetchNightData();
  };

  const visibleHours = showAllHours 
    ? summary?.hourlyData || []
    : (summary?.hourlyData || []).filter(h => h.hour >= 16 || h.hour <= 2);

  const currentHour = new Date().getHours();
  const isNightTime = currentHour >= 18 || currentHour < 6;

  return (
    <PullToRefresh onRefresh={handleRefresh} disabled={loading}>
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
                <FileText className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">Reports</h1>
                <p className="text-sm text-warm-400">
                  {isNightTime ? 'Tonight' : 'Today'}'s performance summary
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <motion.button
                onClick={handleRefresh}
                className="p-2 rounded-lg bg-warm-800 text-warm-400 hover:text-white transition-colors"
                whileTap={{ scale: 0.95 }}
                disabled={loading}
              >
                <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
              </motion.button>
            </div>
          </div>
        </motion.div>

        {/* Date Indicator */}
        {summary && (
          <motion.div
            className="flex items-center gap-2 text-warm-400"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
          >
            {isNightTime ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            <span className="text-sm">{summary.dayOfWeek}, {summary.dateFormatted}</span>
          </motion.div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* No Data State */}
        {!loading && !summary && (
          <motion.div
            className="glass-card p-8 text-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <Calendar className="w-12 h-12 text-warm-600 mx-auto mb-3" />
            <p className="text-warm-300 font-medium">No data available</p>
            <p className="text-sm text-warm-400 mt-1">
              Check back after your venue has been open.
            </p>
          </motion.div>
        )}

        {/* Report Content */}
        {!loading && summary && (
          <>
            {/* Hero Stats */}
            <motion.div
              className="glass-card p-5"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
            >
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-sm text-warm-400 mb-1">Average Pulse Score</p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-5xl font-bold text-primary">
                      {summary.overallPulseScore ?? '--'}
                    </span>
                    {summary.hoursTracked > 0 && (
                      <span className="text-sm text-warm-400">
                        / {summary.hoursTracked}hrs
                      </span>
                    )}
                  </div>
                </div>
                <Zap className="w-12 h-12 text-primary/30" />
              </div>
              
              {/* Peak / Lowest */}
              <div className="flex gap-4 pt-3 border-t border-warm-700">
                {summary.peakPulseHour && (
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-green-500" />
                    <span className="text-sm text-warm-300">
                      Peak: <strong className="text-green-400">{summary.peakPulseScore}</strong> @ {summary.peakPulseHour}
                    </span>
                  </div>
                )}
                {summary.lowestPulseHour && (
                  <div className="flex items-center gap-2">
                    <TrendingDown className="w-4 h-4 text-red-500" />
                    <span className="text-sm text-warm-300">
                      Low: <strong className="text-red-400">{summary.lowestPulseScore}</strong> @ {summary.lowestPulseHour}
                    </span>
                  </div>
                )}
              </div>
            </motion.div>

            {/* Quick Stats */}
            <motion.div
              className="grid grid-cols-2 gap-3"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
            >
              <div className="glass-card p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Users className="w-4 h-4 text-cyan-400" />
                  <span className="text-xs text-warm-400">Total Visitors</span>
                </div>
                <div className="text-2xl font-bold text-white">
                  {summary.totalVisitors.toLocaleString()}
                </div>
                {summary.peakOccupancyHour && (
                  <p className="text-xs text-warm-500 mt-1">
                    Peak: {summary.peakOccupancy} @ {summary.peakOccupancyHour}
                  </p>
                )}
              </div>
              
              <div className="glass-card p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Volume2 className="w-4 h-4 text-amber-400" />
                  <span className="text-xs text-warm-400">Avg Sound</span>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-bold text-white">
                    {summary.avgDecibels ?? '--'}
                  </span>
                  <span className="text-sm text-warm-400">dB</span>
                </div>
              </div>
            </motion.div>

            {/* Hourly Breakdown */}
            <motion.div
              className="glass-card p-5"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-white">Hourly Breakdown</h3>
                <button
                  onClick={() => { haptic('selection'); setShowAllHours(!showAllHours); }}
                  className="flex items-center gap-1 text-sm text-primary"
                >
                  {showAllHours ? 'Peak hours' : 'All hours'}
                  {showAllHours ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
              </div>
              
              <div className="space-y-2">
                {visibleHours.length === 0 ? (
                  <p className="text-sm text-warm-400 text-center py-4">
                    No data for these hours
                  </p>
                ) : (
                  visibleHours.map((hour) => (
                    <HourRow key={hour.hour} data={hour} />
                  ))
                )}
              </div>
            </motion.div>

            {/* Actions */}
            <motion.div
              className="flex gap-3"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
            >
              <motion.button
                onClick={handleShare}
                className="flex-1 flex items-center justify-center gap-2 py-3 bg-primary/20 text-primary rounded-xl font-medium"
                whileTap={{ scale: 0.97 }}
              >
                <Share2 className="w-5 h-5" />
                Share Report
              </motion.button>
              
              <motion.button
                onClick={handleDownload}
                className="flex-1 flex items-center justify-center gap-2 py-3 bg-warm-800 text-warm-200 rounded-xl font-medium"
                whileTap={{ scale: 0.97 }}
              >
                <Download className="w-5 h-5" />
                Download
              </motion.button>
            </motion.div>

            {/* Footer */}
            <div className="text-center py-4">
              <p className="text-xs text-warm-600">
                Report generated by Advizia Pulse
              </p>
            </div>
          </>
        )}
      </div>
    </PullToRefresh>
  );
}

// ============ HOUR ROW ============

function HourRow({ data }: { data: HourlyData }) {
  const pulseColor = data.avgPulseScore === null 
    ? 'text-warm-400' 
    : data.avgPulseScore >= 85 
      ? 'text-green-400' 
      : data.avgPulseScore >= 60 
        ? 'text-amber-400' 
        : 'text-red-400';
  
  return (
    <div className="flex items-center gap-3 p-2 rounded-lg bg-warm-700/30">
      <div className="w-14 text-sm font-medium text-warm-300">
        {data.hourLabel}
      </div>
      
      <div className="flex-1">
        <div className="h-5 bg-warm-600 rounded-full overflow-hidden">
          {data.avgPulseScore !== null && (
            <motion.div
              className={`h-full rounded-full ${
                data.avgPulseScore >= 85 
                  ? 'bg-green-500' 
                  : data.avgPulseScore >= 60 
                    ? 'bg-amber-500' 
                    : 'bg-red-500'
              }`}
              initial={{ width: 0 }}
              animate={{ width: `${data.avgPulseScore}%` }}
              transition={{ duration: 0.5 }}
            />
          )}
        </div>
      </div>
      
      <div className={`w-8 text-right font-bold text-sm ${pulseColor}`}>
        {data.avgPulseScore ?? '--'}
      </div>
      
      <div className="w-12 text-right text-xs text-warm-500">
        <Users className="w-3 h-3 inline mr-0.5" />
        {data.peakOccupancy}
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

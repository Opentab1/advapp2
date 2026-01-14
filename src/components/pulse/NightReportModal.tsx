/**
 * NightReportModal - End of Night Summary Report
 * 
 * Comprehensive breakdown of tonight's performance by hour.
 * Designed for quick sharing/screenshots.
 */

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  X, Download, Share2, Users, Zap, Volume2, 
  TrendingUp, TrendingDown,
  ChevronDown, ChevronUp, Calendar
} from 'lucide-react';
import apiService from '../../services/api.service';
import { calculatePulseScore } from '../../utils/scoring';
import type { SensorData } from '../../types';

interface NightReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  venueName: string;
  venueId: string;
}

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

export function NightReportModal({ isOpen, onClose, venueName, venueId }: NightReportModalProps) {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<NightSummary | null>(null);
  const [showAllHours, setShowAllHours] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  // Fetch and process data
  useEffect(() => {
    if (isOpen && venueId) {
      fetchNightData();
    }
  }, [isOpen, venueId]);

  const fetchNightData = async () => {
    setLoading(true);
    try {
      // Fetch last 24 hours of data
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
  };

  const processNightData = (data: SensorData[]): NightSummary => {
    const now = new Date();
    const today = now.toDateString();
    
    // Filter to today's data only (or last operating hours)
    const todayData = data.filter(d => {
      const date = new Date(d.timestamp);
      return date.toDateString() === today;
    });
    
    // Use all data if no today data
    const relevantData = todayData.length > 0 ? todayData : data;
    
    // Group by hour
    const hourlyMap = new Map<number, SensorData[]>();
    relevantData.forEach(d => {
      const hour = new Date(d.timestamp).getHours();
      if (!hourlyMap.has(hour)) {
        hourlyMap.set(hour, []);
      }
      hourlyMap.get(hour)!.push(d);
    });
    
    // Process hourly data
    const hourlyData: HourlyData[] = [];
    let totalPulseScore = 0;
    let pulseScoreCount = 0;
    let totalDecibels = 0;
    let decibelCount = 0;
    let totalLight = 0;
    let lightCount = 0;
    let totalVisitors = 0;
    let overallPeakOccupancy = 0;
    let peakOccupancyHour: string | null = null;
    let peakPulseScore = 0;
    let peakPulseHour: string | null = null;
    let lowestPulseScore = 100;
    let lowestPulseHour: string | null = null;
    
    // Process each hour
    for (let hour = 0; hour < 24; hour++) {
      const hourData = hourlyMap.get(hour) || [];
      const hourLabel = formatHour(hour);
      
      if (hourData.length === 0) {
        continue; // Skip hours with no data
      }
      
      // Calculate hourly averages
      let hourPulseTotal = 0;
      let hourPulseCount = 0;
      let hourDbTotal = 0;
      let hourDbCount = 0;
      let hourLightTotal = 0;
      let hourLightCount = 0;
      let hourPeakOccupancy = 0;
      let hourEntries = 0;
      
      hourData.forEach(d => {
        // Calculate pulse score - pass timestamp for accurate historical scoring
        if (d.decibels !== undefined && d.light !== undefined) {
          const { score } = calculatePulseScore(d.decibels, d.light, d.indoorTemp, d.outdoorTemp, null, null, null, d.timestamp);
          if (score !== null) {
            hourPulseTotal += score;
            hourPulseCount++;
            totalPulseScore += score;
            pulseScoreCount++;
          }
        }
        
        // Sound
        if (d.decibels !== undefined && d.decibels !== null) {
          hourDbTotal += d.decibels;
          hourDbCount++;
          totalDecibels += d.decibels;
          decibelCount++;
        }
        
        // Light
        if (d.light !== undefined && d.light !== null) {
          hourLightTotal += d.light;
          hourLightCount++;
          totalLight += d.light;
          lightCount++;
        }
        
        // Occupancy
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
      
      // Track peak/lowest pulse
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
      
      // Track peak occupancy
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
    
    // Calculate total visitors from max entries per day
    const entriesSet = new Set<number>();
    relevantData.forEach(d => {
      if (d.occupancy?.entries) {
        entriesSet.add(d.occupancy.entries);
      }
    });
    totalVisitors = entriesSet.size > 0 ? Math.max(...entriesSet) : 0;
    
    // Get date info
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

  // Share functionality
  const handleShare = async () => {
    if (!summary) return;
    
    const text = generateShareText(summary, venueName);
    
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${venueName} - Night Report`,
          text,
        });
      } catch (err) {
        // User cancelled or error
        copyToClipboard(text);
      }
    } else {
      copyToClipboard(text);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    // Could add a toast notification here
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
    
    text += `\n📈 Hourly Breakdown:\n`;
    data.hourlyData.slice(0, 8).forEach(h => {
      text += `${h.hourLabel}: Pulse ${h.avgPulseScore ?? '--'} | ${h.peakOccupancy} people\n`;
    });
    
    return text;
  };

  // Download as image (simplified - copies text for now)
  const handleDownload = () => {
    if (!summary) return;
    
    const text = generateShareText(summary, venueName);
    
    // Create a blob and download
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

  // Visible hours (show peak hours by default)
  const visibleHours = showAllHours 
    ? summary?.hourlyData || []
    : (summary?.hourlyData || []).filter(h => h.hour >= 16 || h.hour <= 2); // 4pm - 2am

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 bg-black/60 z-50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          
          {/* Modal */}
          <motion.div
            className="fixed inset-4 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-full sm:max-w-lg sm:max-h-[85vh] bg-warm-800 rounded-2xl z-50 overflow-hidden flex flex-col"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-warm-700">
              <div>
                <h2 className="text-lg font-bold text-warm-100">Night Report</h2>
                {summary && (
                  <p className="text-sm text-warm-400">
                    {summary.dayOfWeek}, {summary.dateFormatted}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <motion.button
                  onClick={handleShare}
                  className="p-2 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                  whileTap={{ scale: 0.95 }}
                  disabled={!summary}
                >
                  <Share2 className="w-5 h-5" />
                </motion.button>
                <motion.button
                  onClick={handleDownload}
                  className="p-2 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                  whileTap={{ scale: 0.95 }}
                  disabled={!summary}
                >
                  <Download className="w-5 h-5" />
                </motion.button>
                <motion.button
                  onClick={onClose}
                  className="p-2 rounded-lg hover:bg-warm-700 transition-colors"
                  whileTap={{ scale: 0.95 }}
                >
                  <X className="w-5 h-5 text-warm-500" />
                </motion.button>
              </div>
            </div>
            
            {/* Content */}
            <div ref={reportRef} className="flex-1 overflow-y-auto p-4 space-y-6">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
              ) : !summary ? (
                <div className="text-center py-12">
                  <Calendar className="w-12 h-12 text-warm-600 mx-auto mb-3" />
                  <p className="text-warm-300 font-medium">No data for tonight</p>
                  <p className="text-sm text-warm-400 mt-1">
                    Check back after your venue has been open.
                  </p>
                </div>
              ) : (
                <>
                  {/* Hero Stats */}
                  <div className="grid grid-cols-2 gap-3">
                    {/* Overall Pulse Score */}
                    <div className="col-span-2 p-4 rounded-xl bg-gradient-to-br from-primary/20 to-primary/10 border border-primary/20">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-warm-400 mb-1">Average Pulse Score</p>
                          <div className="flex items-baseline gap-2">
                            <span className="text-4xl font-bold text-primary">
                              {summary.overallPulseScore ?? '--'}
                            </span>
                            {summary.hoursTracked > 0 && (
                              <span className="text-sm text-warm-400">
                                / {summary.hoursTracked}hrs tracked
                              </span>
                            )}
                          </div>
                        </div>
                        <Zap className="w-10 h-10 text-primary/30" />
                      </div>
                      
                      {/* Peak / Lowest */}
                      <div className="flex gap-4 mt-3 pt-3 border-t border-primary/20">
                        {summary.peakPulseHour && (
                          <div className="flex items-center gap-2">
                            <TrendingUp className="w-4 h-4 text-green-500" />
                            <span className="text-sm text-warm-300">
                              Peak: <strong>{summary.peakPulseScore}</strong> @ {summary.peakPulseHour}
                            </span>
                          </div>
                        )}
                        {summary.lowestPulseHour && (
                          <div className="flex items-center gap-2">
                            <TrendingDown className="w-4 h-4 text-red-500" />
                            <span className="text-sm text-warm-300">
                              Low: <strong>{summary.lowestPulseScore}</strong> @ {summary.lowestPulseHour}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                    
                    {/* Total Visitors */}
                    <StatCard
                      icon={Users}
                      label="Total Visitors"
                      value={summary.totalVisitors}
                      subtitle={summary.peakOccupancyHour ? `Peak: ${summary.peakOccupancy} @ ${summary.peakOccupancyHour}` : undefined}
                    />
                    
                    {/* Avg Sound */}
                    <StatCard
                      icon={Volume2}
                      label="Avg Sound"
                      value={summary.avgDecibels}
                      unit="dB"
                    />
                  </div>
                  
                  {/* Hourly Breakdown */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-semibold text-warm-100">Hourly Breakdown</h3>
                      <button
                        onClick={() => setShowAllHours(!showAllHours)}
                        className="flex items-center gap-1 text-sm text-primary"
                      >
                        {showAllHours ? 'Show peak hours' : 'Show all hours'}
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
                  </div>
                  
                  {/* Footer */}
                  <div className="text-center pt-4 border-t border-warm-700">
                    <p className="text-xs text-warm-500">
                      Report generated by Advizia Pulse
                    </p>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ============ STAT CARD ============

interface StatCardProps {
  icon: typeof Users;
  label: string;
  value: number | null;
  unit?: string;
  subtitle?: string;
}

function StatCard({ icon: Icon, label, value, unit, subtitle }: StatCardProps) {
  return (
    <div className="p-3 rounded-xl bg-warm-700/50 border border-warm-600">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4 text-warm-400" />
        <span className="text-xs text-warm-400">{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold text-warm-100">
          {value !== null ? value.toLocaleString() : '--'}
        </span>
        {unit && <span className="text-sm text-warm-400">{unit}</span>}
      </div>
      {subtitle && (
        <p className="text-xs text-warm-400 mt-1">{subtitle}</p>
      )}
    </div>
  );
}

// ============ HOUR ROW ============

interface HourRowProps {
  data: HourlyData;
}

function HourRow({ data }: HourRowProps) {
  const pulseColor = data.avgPulseScore === null 
    ? 'text-warm-400' 
    : data.avgPulseScore >= 85 
      ? 'text-green-400' 
      : data.avgPulseScore >= 60 
        ? 'text-amber-400' 
        : 'text-red-400';
  
  return (
    <div className="flex items-center gap-3 p-2 rounded-lg bg-warm-700/30">
      {/* Time */}
      <div className="w-16 text-sm font-medium text-warm-300">
        {data.hourLabel}
      </div>
      
      {/* Pulse Score Bar */}
      <div className="flex-1">
        <div className="h-6 bg-warm-600 rounded-full overflow-hidden">
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
              transition={{ duration: 0.5, delay: 0.1 }}
            />
          )}
        </div>
      </div>
      
      {/* Score */}
      <div className={`w-10 text-right font-bold ${pulseColor}`}>
        {data.avgPulseScore ?? '--'}
      </div>
      
      {/* Occupancy */}
      <div className="w-14 text-right text-sm text-warm-400">
        <Users className="w-3 h-3 inline mr-1" />
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

export default NightReportModal;

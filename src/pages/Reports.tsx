/**
 * Reports - Manager's Closing Shift Audit
 * 
 * "The Z-Report for Experience"
 * 
 * A brutal, honest audit of the shift.
 * 1. Financial efficiency ($/Head)
 * 2. Compliance (Did staff follow the system?)
 * 3. The "Tape" (Hour-by-hour audit)
 */

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { 
  DollarSign, Users, Clock, Zap, AlertTriangle, 
  CheckCircle, XCircle, Share2, Download,
  Music, Volume2, TrendingUp
} from 'lucide-react';
import apiService from '../services/api.service';
import authService from '../services/auth.service';
import { calculatePulseScore, getScoreColor } from '../utils/scoring';
import { PullToRefresh } from '../components/common/PullToRefresh';
import { calculateDwellTimeFromHistory, formatDwellTime } from '../utils/dwellTime';
import { haptic } from '../utils/haptics';
import type { SensorData, TimeRange } from '../types';

// ============ TYPES ============

type ReportPeriod = 'today' | 'week' | 'month';

interface ShiftAudit {
  period: ReportPeriod;
  dateRange: string;
  
  // The Money Table
  totalGuests: number;
  peakCrowd: number;
  peakTime: string;
  revenuePerHead: number; // The efficiency metric
  estimatedRevenue: number;
  
  // The Grades
  shiftScore: number; // Overall pulse score
  staffCompliance: number; // % time in optimal range
  
  // The Tape (Hour by Hour)
  tape: TapeEntry[];
  
  // The Fix List
  issues: string[];
}

interface TapeEntry {
  time: string;
  score: number;
  occupancy: number;
  decibels: number;
  song?: string;
  status: 'optimal' | 'warning' | 'critical';
  insight?: string; // "Too loud (92dB)"
}

// ============ MAIN COMPONENT ============

export function Reports() {
  const user = authService.getStoredUser();
  const venueId = user?.venueId || '';
  const venueName = user?.venueName || 'Venue';
  
  const [loading, setLoading] = useState(true);
  const [audit, setAudit] = useState<ShiftAudit | null>(null);

  const fetchAudit = useCallback(async () => {
    if (!venueId) return;
    setLoading(true);
    
    try {
      // Always fetch 24h for the shift report (today)
      const result = await apiService.getHistoricalData(venueId, '24h');
      
      if (result?.data && result.data.length > 0) {
        setAudit(processShiftAudit(result.data));
      } else {
        setAudit(null);
      }
    } catch (err) {
      console.error('Failed to fetch audit:', err);
      setAudit(null);
    } finally {
      setLoading(false);
    }
  }, [venueId]);

  useEffect(() => {
    fetchAudit();
  }, [fetchAudit]);

  const handleRefresh = async () => {
    haptic('medium');
    await fetchAudit();
  };
  
  // Share Handler
  const handleShare = async () => {
    if (!audit) return;
    haptic('medium');
    const text = `SHIFT AUDIT: ${audit.dateRange}\nScore: ${audit.shiftScore}/100\nRev/Head: $${audit.revenuePerHead}\nGuests: ${audit.totalGuests}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Shift Audit', text });
      else await navigator.clipboard.writeText(text);
    } catch (e) { console.error(e); }
  };

  return (
    <PullToRefresh onRefresh={handleRefresh} disabled={loading}>
      <div className="space-y-6 pb-12">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-warm-100 tracking-tight">SHIFT AUDIT</h1>
            <p className="text-xs font-mono text-warm-400 mt-1">
              {audit ? audit.dateRange : 'SYNCING...'}
            </p>
          </div>
          <button 
            onClick={handleShare}
            className="p-2 bg-warm-800 rounded-lg text-warm-300 hover:text-white transition-colors"
          >
            <Share2 className="w-5 h-5" />
          </button>
        </div>

        {/* Loading */}
        {loading && (
          <div className="py-20 flex justify-center">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* The Audit Content */}
        {!loading && audit && (
          <>
            {/* 1. The Grade Card */}
            <div className="grid grid-cols-2 gap-4">
              <AuditMetric 
                label="SHIFT SCORE" 
                value={audit.shiftScore.toString()} 
                subtext="/ 100"
                color={getScoreColor(audit.shiftScore)}
                isMain
              />
              <AuditMetric 
                label="REV / HEAD" 
                value={`$${audit.revenuePerHead}`} 
                subtext="Efficiency"
                color="text-warm-100"
                isMain
              />
            </div>

            {/* 2. The Money Table */}
            <div className="bg-warm-800 border border-warm-700 rounded-none sm:rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-warm-700 bg-warm-900/50 flex justify-between items-center">
                <span className="text-xs font-mono text-warm-400 uppercase">Financials</span>
                <span className="text-xs font-mono text-green-400">EST. ${audit.estimatedRevenue.toLocaleString()}</span>
              </div>
              <div className="grid grid-cols-3 divide-x divide-warm-700">
                <div className="p-4 text-center">
                  <div className="text-xs text-warm-500 mb-1">GUESTS</div>
                  <div className="text-lg font-bold text-warm-100">{audit.totalGuests}</div>
                </div>
                <div className="p-4 text-center">
                  <div className="text-xs text-warm-500 mb-1">PEAK</div>
                  <div className="text-lg font-bold text-warm-100">{audit.peakCrowd}</div>
                  <div className="text-[10px] text-warm-500">{audit.peakTime}</div>
                </div>
                <div className="p-4 text-center">
                  <div className="text-xs text-warm-500 mb-1">COMPLIANCE</div>
                  <div className={`text-lg font-bold ${audit.staffCompliance >= 80 ? 'text-green-400' : 'text-amber-400'}`}>
                    {audit.staffCompliance}%
                  </div>
                </div>
              </div>
            </div>

            {/* 3. The Fix List (Issues) */}
            {audit.issues.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-mono text-warm-400 uppercase px-1">Missed Opportunities</h3>
                {audit.issues.map((issue, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 bg-red-900/10 border border-red-900/30 rounded-lg">
                    <XCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                    <span className="text-sm text-red-200 font-mono leading-tight">{issue}</span>
                  </div>
                ))}
              </div>
            )}

            {/* 4. The Tape (Hour by Hour) */}
            <div>
              <div className="flex justify-between items-end px-1 mb-3">
                <h3 className="text-xs font-mono text-warm-400 uppercase">Hourly Tape</h3>
                <span className="text-[10px] text-warm-500 font-mono">LATEST FIRST</span>
              </div>
              
              <div className="border-l-2 border-warm-800 ml-3 space-y-6">
                {audit.tape.map((entry, i) => (
                  <div key={i} className="relative pl-6">
                    {/* Timeline Node */}
                    <div className={`absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full border-2 border-warm-900 ${
                      entry.status === 'optimal' ? 'bg-green-500' : 
                      entry.status === 'warning' ? 'bg-amber-500' : 'bg-red-500'
                    }`} />
                    
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="text-sm font-bold text-warm-200 font-mono">{entry.time}</span>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={`text-xs font-bold ${getScoreColor(entry.score)}`}>
                            {entry.score} Score
                          </span>
                          <span className="text-xs text-warm-500">•</span>
                          <span className="text-xs text-warm-400 font-mono">{entry.occupancy} ppl</span>
                        </div>
                      </div>
                      
                      <div className="text-right">
                        <div className={`text-xs font-mono ${
                          entry.decibels > 90 ? 'text-red-400 font-bold' : 'text-warm-400'
                        }`}>
                          {entry.decibels}dB
                        </div>
                        {entry.song && (
                          <div className="flex items-center justify-end gap-1 mt-0.5 text-[10px] text-warm-500 max-w-[120px] truncate">
                            <Music className="w-3 h-3" />
                            {entry.song}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Alert / Insight */}
                    {entry.insight && (
                      <div className="mt-2 text-xs text-red-300 bg-red-900/20 px-2 py-1 rounded border-l-2 border-red-500/50 font-mono">
                        ⚠️ {entry.insight}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
            
            <div className="text-center pt-8 pb-4">
              <p className="text-[10px] font-mono text-warm-600 uppercase">End of Report</p>
            </div>
          </>
        )}
      </div>
    </PullToRefresh>
  );
}

// ============ HELPER COMPONENTS ============

function AuditMetric({ label, value, subtext, color, isMain }: any) {
  return (
    <div className="bg-warm-800 p-4 rounded-xl border border-warm-700">
      <div className="text-[10px] font-mono text-warm-500 mb-1">{label}</div>
      <div className={`font-bold ${isMain ? 'text-3xl' : 'text-xl'} ${color} tracking-tight`}>
        {value}
      </div>
      <div className="text-[10px] text-warm-400 mt-0.5">{subtext}</div>
    </div>
  );
}

// ============ LOGIC ============

function processShiftAudit(data: SensorData[]): ShiftAudit {
  const now = new Date();
  
  // 1. Calculate Shift Totals
  const totalEntries = new Set<number>();
  let peakCrowd = 0;
  let peakTime = '--:--';
  let totalScore = 0, scoreCount = 0;
  let optimalHours = 0, totalHours = 0;
  
  // Group by hour for Tape
  const hourlyData = new Map<string, TapeEntry>();
  
  data.forEach(d => {
    // Totals
    if (d.occupancy?.entries) totalEntries.add(d.occupancy.entries);
    if (d.occupancy?.current && d.occupancy.current > peakCrowd) {
      peakCrowd = d.occupancy.current;
      peakTime = new Date(d.timestamp).toLocaleTimeString([], {hour:'numeric', minute:'2-digit'});
    }
    
    // Scores
    const { score } = calculatePulseScore(d.decibels, d.light);
    if (score) {
      totalScore += score;
      scoreCount++;
    }
    
    // Hourly Aggregation (Simple: last reading of hour overrides)
    const hourKey = new Date(d.timestamp).getHours();
    const timeLabel = formatHour(hourKey);
    
    if (!hourlyData.has(timeLabel)) {
      hourlyData.set(timeLabel, {
        time: timeLabel,
        score: score || 0,
        occupancy: d.occupancy?.current || 0,
        decibels: Math.round(d.decibels),
        song: d.currentSong,
        status: 'optimal' // will refine
      });
      totalHours++;
      if (score && score >= 70) optimalHours++;
    }
  });
  
  // Tape Refining
  const tape = Array.from(hourlyData.values()).reverse(); // Latest first
  tape.forEach(entry => {
    if (entry.score < 60) {
      entry.status = 'critical';
      entry.insight = 'Score dropped below 60';
    } else if (entry.decibels > 92) {
      entry.status = 'warning';
      entry.insight = 'Volume unsafe (>92dB)';
    } else if (entry.score >= 80) {
      entry.status = 'optimal';
    } else {
      entry.status = 'warning';
    }
  });

  // Financials
  const totalGuests = totalEntries.size > 0 ? Math.max(...totalEntries) : Math.max(peakCrowd * 2.5, 0);
  const shiftScore = scoreCount > 0 ? Math.round(totalScore / scoreCount) : 0;
  
  const baseSpend = 25;
  const efficiency = shiftScore >= 80 ? 1.2 : shiftScore >= 60 ? 1.0 : 0.8;
  const revenuePerHead = Math.round(baseSpend * efficiency);
  const estimatedRevenue = totalGuests * revenuePerHead;
  const staffCompliance = totalHours > 0 ? Math.round((optimalHours / totalHours) * 100) : 100;

  // Issues
  const issues: string[] = [];
  if (staffCompliance < 70) issues.push('Staff compliance below 70%');
  if (tape.some(t => t.decibels > 95)) issues.push('Volume peaked above 95dB (Risk)');
  if (peakCrowd > 0 && peakCrowd < 50 && shiftScore > 90) issues.push('Great vibe but low traffic');

  return {
    period: 'today',
    dateRange: now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase(),
    totalGuests,
    peakCrowd,
    peakTime,
    revenuePerHead,
    estimatedRevenue,
    shiftScore,
    staffCompliance,
    tape,
    issues
  };
}

function formatHour(hour: number) {
  if (hour === 0) return '12AM';
  if (hour === 12) return '12PM';
  if (hour > 12) return `${hour - 12}PM`;
  return `${hour}AM`;
}

export default Reports;

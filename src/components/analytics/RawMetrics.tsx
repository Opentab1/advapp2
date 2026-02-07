/**
 * RawMetrics - Show the actual raw data so owners can see it themselves
 * 
 * - Total entries / exits
 * - Avg dB per day
 * - Avg lux per day
 * - Avg pulse score per day
 * - Top played songs
 */

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  ChevronDown, 
  ChevronUp, 
  Users, 
  LogIn, 
  LogOut,
  Volume2,
  Sun,
  Zap,
  Music,
} from 'lucide-react';
import { haptic } from '../../utils/haptics';
import { calculatePulseScore } from '../../utils/scoring';
import songLogService from '../../services/song-log.service';
import type { SensorData } from '../../types';

interface RawMetricsProps {
  data: SensorData[];
  loading: boolean;
}

interface MetricRow {
  day: string;
  entries: number;
  exits: number;
  avgDb: number;
  avgLux: number;
  avgScore: number;
  peakCrowd: number;
}

interface TopSong {
  title: string;
  artist: string;
  count: number;
}

function processMetrics(data: SensorData[]): { 
  rows: MetricRow[]; 
  totals: { entries: number; exits: number; avgDb: number; avgLux: number; avgScore: number };
} {
  if (data.length === 0) {
    return { 
      rows: [], 
      totals: { entries: 0, exits: 0, avgDb: 0, avgLux: 0, avgScore: 0 } 
    };
  }

  // Group by date
  const byDate: Record<string, SensorData[]> = {};
  data.forEach(d => {
    const date = new Date(d.timestamp).toDateString();
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(d);
  });

  const rows: MetricRow[] = [];
  let totalEntries = 0;
  let totalExits = 0;
  let totalDb = 0, dbCount = 0;
  let totalLux = 0, luxCount = 0;
  let totalScore = 0, scoreCount = 0;
  
  Object.entries(byDate).forEach(([dateStr, readings]) => {
    const date = new Date(dateStr);
    const dayLabel = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    
    // Sort by time
    const sorted = [...readings].sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    
    // Calculate entries/exits delta for this day
    const firstReading = sorted[0];
    const lastReading = sorted[sorted.length - 1];
    const dayEntries = Math.max(0, (lastReading.occupancy?.entries ?? 0) - (firstReading.occupancy?.entries ?? 0));
    const dayExits = Math.max(0, (lastReading.occupancy?.exits ?? 0) - (firstReading.occupancy?.exits ?? 0));
    
    totalEntries += dayEntries;
    totalExits += dayExits;
    
    // Calculate averages
    let dbSum = 0, dbDayCount = 0;
    let luxSum = 0, luxDayCount = 0;
    let scoreSum = 0, scoreDayCount = 0;
    let peakCrowd = 0;
    
    sorted.forEach(r => {
      if (r.decibels && r.decibels > 0) {
        dbSum += r.decibels;
        dbDayCount++;
        totalDb += r.decibels;
        dbCount++;
      }
      if (r.light !== undefined && r.light >= 0) {
        luxSum += r.light;
        luxDayCount++;
        totalLux += r.light;
        luxCount++;
      }
      if (r.occupancy?.current && r.occupancy.current > peakCrowd) {
        peakCrowd = r.occupancy.current;
      }
      
      // Calculate pulse score
      const { score } = calculatePulseScore(r.decibels, r.light, r.indoorTemp, r.outdoorTemp, null, null, null, r.timestamp);
      if (score !== null) {
        scoreSum += score;
        scoreDayCount++;
        totalScore += score;
        scoreCount++;
      }
    });
    
    rows.push({
      day: dayLabel,
      entries: dayEntries,
      exits: dayExits,
      avgDb: dbDayCount > 0 ? Math.round(dbSum / dbDayCount) : 0,
      avgLux: luxDayCount > 0 ? Math.round(luxSum / luxDayCount) : 0,
      avgScore: scoreDayCount > 0 ? Math.round(scoreSum / scoreDayCount) : 0,
      peakCrowd,
    });
  });
  
  // Sort by date descending
  rows.sort((a, b) => new Date(b.day).getTime() - new Date(a.day).getTime());
  
  return {
    rows,
    totals: {
      entries: totalEntries,
      exits: totalExits,
      avgDb: dbCount > 0 ? Math.round(totalDb / dbCount) : 0,
      avgLux: luxCount > 0 ? Math.round(totalLux / luxCount) : 0,
      avgScore: scoreCount > 0 ? Math.round(totalScore / scoreCount) : 0,
    },
  };
}

export function RawMetrics({ data, loading }: RawMetricsProps) {
  const [expanded, setExpanded] = useState(true);
  const [topSongs, setTopSongs] = useState<TopSong[]>([]);
  const [loadingSongs, setLoadingSongs] = useState(true);
  
  const { rows, totals } = processMetrics(data);
  
  // Load top songs
  useEffect(() => {
    async function loadSongs() {
      setLoadingSongs(true);
      try {
        const songs = await songLogService.getTopSongs(5);
        setTopSongs(songs.map(s => ({
          title: s.title,
          artist: s.artist,
          count: s.playCount,
        })));
      } catch (err) {
        console.error('Failed to load top songs:', err);
      }
      setLoadingSongs(false);
    }
    loadSongs();
  }, []);
  
  if (loading) {
    return (
      <div className="bg-whoop-panel border border-whoop-divider rounded-xl overflow-hidden">
        <div className="p-4 border-b border-whoop-divider">
          <div className="h-5 bg-warm-700 rounded w-32 animate-pulse" />
        </div>
        <div className="p-4 space-y-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-12 bg-warm-800 rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <motion.div
      className="bg-whoop-panel border border-whoop-divider rounded-xl overflow-hidden"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Header */}
      <button
        onClick={() => { haptic('light'); setExpanded(!expanded); }}
        className="w-full p-4 flex items-center justify-between border-b border-whoop-divider hover:bg-warm-800/50 transition-colors"
      >
        <h3 className="text-sm font-semibold text-warm-200 uppercase tracking-whoop">
          Raw Data
        </h3>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-warm-500" />
        ) : (
          <ChevronDown className="w-4 h-4 text-warm-500" />
        )}
      </button>
      
      {expanded && (
        <div className="p-4 space-y-6">
          
          {/* Period Totals - adapt based on available data */}
          {(() => {
            // Check what data is available (Pi Zero 2W has no entries/exits or lux)
            const hasEntriesExits = totals.entries > 0 || totals.exits > 0;
            const hasSound = totals.avgDb > 0;
            const hasLux = totals.avgLux > 0;
            const visibleCards = [hasEntriesExits, hasEntriesExits, hasSound, true].filter(Boolean).length;
            const gridCols = visibleCards <= 2 ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-4';
            
            return (
              <div className={`grid ${gridCols} gap-3`}>
                {/* Entries - only show if we have entry/exit tracking */}
                {hasEntriesExits && (
                  <div className="bg-warm-800/50 rounded-lg p-3">
                    <div className="flex items-center gap-2 text-warm-400 text-xs mb-1">
                      <LogIn className="w-3 h-3" />
                      Total Entries
                    </div>
                    <div className="text-xl font-bold text-white">{totals.entries.toLocaleString()}</div>
                  </div>
                )}
                {/* Exits - only show if we have entry/exit tracking */}
                {hasEntriesExits && (
                  <div className="bg-warm-800/50 rounded-lg p-3">
                    <div className="flex items-center gap-2 text-warm-400 text-xs mb-1">
                      <LogOut className="w-3 h-3" />
                      Total Exits
                    </div>
                    <div className="text-xl font-bold text-white">{totals.exits.toLocaleString()}</div>
                  </div>
                )}
                {/* Sound - only show if we have sound data */}
                {hasSound && (
                  <div className="bg-warm-800/50 rounded-lg p-3">
                    <div className="flex items-center gap-2 text-warm-400 text-xs mb-1">
                      <Volume2 className="w-3 h-3" />
                      Avg Sound
                    </div>
                    <div className="text-xl font-bold text-white">{totals.avgDb} dB</div>
                  </div>
                )}
                {/* Score - always show */}
                <div className="bg-warm-800/50 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-warm-400 text-xs mb-1">
                    <Zap className="w-3 h-3" />
                    Avg Score
                  </div>
                  <div className="text-xl font-bold text-white">{totals.avgScore}</div>
                </div>
              </div>
            );
          })()}
          
          {/* Daily Metrics Table */}
          {rows.length > 0 && (
            <div>
              <h4 className="text-xs text-warm-400 uppercase tracking-wide mb-2">By Day</h4>
              {(() => {
                // Check what columns have data (hide empty columns for Pi Zero 2W)
                const hasEntriesExits = totals.entries > 0 || totals.exits > 0;
                const hasLux = totals.avgLux > 0;
                const hasDb = totals.avgDb > 0;
                
                return (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-warm-700 text-warm-400">
                          <th className="text-left p-2 font-medium">Day</th>
                          {hasEntriesExits && <th className="text-right p-2 font-medium">Entries</th>}
                          {hasEntriesExits && <th className="text-right p-2 font-medium">Exits</th>}
                          {hasDb && <th className="text-right p-2 font-medium hidden sm:table-cell">Avg dB</th>}
                          {hasLux && <th className="text-right p-2 font-medium hidden sm:table-cell">Avg Lux</th>}
                          <th className="text-right p-2 font-medium">Score</th>
                          <th className="text-right p-2 font-medium hidden md:table-cell">Peak</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row, idx) => (
                          <tr key={idx} className="border-b border-warm-800 last:border-b-0">
                            <td className="p-2 text-white">{row.day}</td>
                            {hasEntriesExits && <td className="p-2 text-right text-warm-300">{row.entries}</td>}
                            {hasEntriesExits && <td className="p-2 text-right text-warm-300">{row.exits}</td>}
                            {hasDb && <td className="p-2 text-right text-warm-300 hidden sm:table-cell">{row.avgDb > 0 ? `${row.avgDb}` : '—'}</td>}
                            {hasLux && <td className="p-2 text-right text-warm-300 hidden sm:table-cell">{row.avgLux > 0 ? `${row.avgLux}` : '—'}</td>}
                            <td className="p-2 text-right text-white font-medium">{row.avgScore > 0 ? row.avgScore : '—'}</td>
                            <td className="p-2 text-right text-warm-300 hidden md:table-cell">{row.peakCrowd > 0 ? row.peakCrowd : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>
          )}
          
          {/* Top Songs */}
          <div>
            <h4 className="text-xs text-warm-400 uppercase tracking-wide mb-2 flex items-center gap-2">
              <Music className="w-3 h-3" />
              Top Songs This Period
            </h4>
            {loadingSongs ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-8 bg-warm-800 rounded animate-pulse" />
                ))}
              </div>
            ) : topSongs.length > 0 ? (
              <div className="space-y-1">
                {topSongs.map((song, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2 bg-warm-800/30 rounded">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-warm-500 text-sm w-5">{idx + 1}.</span>
                      <div className="min-w-0">
                        <div className="text-white text-sm truncate">{song.title}</div>
                        <div className="text-warm-400 text-xs truncate">{song.artist}</div>
                      </div>
                    </div>
                    <div className="text-warm-400 text-sm flex-shrink-0 ml-2">
                      {song.count}x
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-warm-500 text-sm">No song data available</p>
            )}
          </div>
          
        </div>
      )}
    </motion.div>
  );
}

export default RawMetrics;

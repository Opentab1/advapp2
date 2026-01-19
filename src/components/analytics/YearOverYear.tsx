import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  TrendingUp, TrendingDown, Calendar, Trophy, Users, Clock,
  RefreshCw, Minus
} from 'lucide-react';
import { format, subYears, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';
import dynamoDBService from '../../services/dynamodb.service';
import authService from '../../services/auth.service';
import type { SensorData } from '../../types';

type ComparisonPeriod = 'week' | 'month' | 'custom';

interface PeriodStats {
  guests: number;
  avgStay: number | null;
  peakDay: string;
  peakGuests: number;
  avgScore: number;
}

interface ComparisonResult {
  current: PeriodStats;
  previous: PeriodStats;
  deltas: {
    guests: number;
    avgStay: number | null;
    peakGuests: number;
    avgScore: number;
  };
}

interface BestRecord {
  date: string;
  value: number;
  label: string;
}

export function YearOverYear() {
  const [period, setPeriod] = useState<ComparisonPeriod>('week');
  const [loading, setLoading] = useState(true);
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);
  const [bestRecords, setBestRecords] = useState<{
    bestDay: BestRecord | null;
    bestWeek: BestRecord | null;
    bestMonth: BestRecord | null;
  }>({ bestDay: null, bestWeek: null, bestMonth: null });
  
  const user = authService.getStoredUser();
  const venueId = user?.venueId;

  useEffect(() => {
    if (venueId) {
      loadComparison();
    }
  }, [venueId, period]);

  const loadComparison = async () => {
    if (!venueId) return;
    setLoading(true);
    
    try {
      const now = new Date();
      let currentStart: Date, currentEnd: Date, previousStart: Date, previousEnd: Date;
      
      if (period === 'week') {
        currentStart = startOfWeek(now, { weekStartsOn: 1 });
        currentEnd = endOfWeek(now, { weekStartsOn: 1 });
        previousStart = startOfWeek(subYears(now, 1), { weekStartsOn: 1 });
        previousEnd = endOfWeek(subYears(now, 1), { weekStartsOn: 1 });
      } else {
        currentStart = startOfMonth(now);
        currentEnd = endOfMonth(now);
        previousStart = startOfMonth(subYears(now, 1));
        previousEnd = endOfMonth(subYears(now, 1));
      }

      // Fetch current period data
      const currentData = await dynamoDBService.getSensorDataByDateRange(
        venueId, currentStart, currentEnd, 10000
      );
      
      // Fetch previous year data
      const previousData = await dynamoDBService.getSensorDataByDateRange(
        venueId, previousStart, previousEnd, 10000
      );

      const currentStats = calculatePeriodStats(currentData || []);
      const previousStats = calculatePeriodStats(previousData || []);

      setComparison({
        current: currentStats,
        previous: previousStats,
        deltas: {
          guests: previousStats.guests > 0 
            ? Math.round(((currentStats.guests - previousStats.guests) / previousStats.guests) * 100)
            : 0,
          avgStay: currentStats.avgStay !== null && previousStats.avgStay !== null
            ? Math.round(currentStats.avgStay - previousStats.avgStay)
            : null,
          peakGuests: previousStats.peakGuests > 0
            ? Math.round(((currentStats.peakGuests - previousStats.peakGuests) / previousStats.peakGuests) * 100)
            : 0,
          avgScore: Math.round(currentStats.avgScore - previousStats.avgScore),
        }
      });

      // Load best records (all-time)
      await loadBestRecords();
      
    } catch (error) {
      console.error('Error loading YoY comparison:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadBestRecords = async () => {
    if (!venueId) return;
    
    try {
      // Get last 365 days of data for best records
      const data = await dynamoDBService.getHistoricalSensorData(venueId, '365d');
      if (!data?.data?.length) return;

      const byDay = new Map<string, SensorData[]>();
      data.data.forEach(d => {
        const day = format(new Date(d.timestamp), 'yyyy-MM-dd');
        if (!byDay.has(day)) byDay.set(day, []);
        byDay.get(day)!.push(d);
      });

      // Find best day by guests
      let bestDay: BestRecord | null = null;
      byDay.forEach((dayData, dateStr) => {
        const guests = calculateGuests(dayData);
        if (!bestDay || guests > bestDay.value) {
          bestDay = {
            date: dateStr,
            value: guests,
            label: format(new Date(dateStr), 'EEEE, MMM d, yyyy')
          };
        }
      });

      setBestRecords({
        bestDay,
        bestWeek: null, // Could calculate but keeping simple
        bestMonth: null
      });
      
    } catch (error) {
      console.error('Error loading best records:', error);
    }
  };

  const calculatePeriodStats = (data: SensorData[]): PeriodStats => {
    if (!data.length) {
      return { guests: 0, avgStay: null, peakDay: 'N/A', peakGuests: 0, avgScore: 0 };
    }

    const sorted = [...data].sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    // Calculate guests
    const guests = calculateGuests(sorted);

    // Group by day for peak
    const byDay = new Map<string, SensorData[]>();
    sorted.forEach(d => {
      const day = format(new Date(d.timestamp), 'yyyy-MM-dd');
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day)!.push(d);
    });

    let peakDay = 'N/A';
    let peakGuests = 0;
    byDay.forEach((dayData, dateStr) => {
      const dayGuests = calculateGuests(dayData);
      if (dayGuests > peakGuests) {
        peakGuests = dayGuests;
        peakDay = format(new Date(dateStr), 'EEEE');
      }
    });

    // Calculate avg score based on occupancy performance
    const avgOcc = sorted.reduce((sum, d) => sum + (d.occupancy?.current || 0), 0) / sorted.length;
    const maxOcc = Math.max(...sorted.map(d => d.occupancy?.current || 0));
    const avgScore = maxOcc > 0 ? Math.round((avgOcc / maxOcc) * 100) : 0;

    // Calculate avg stay (simplified)
    let avgStay: number | null = null;
    if (guests > 0 && sorted.length > 1) {
      const totalHours = (new Date(sorted[sorted.length - 1].timestamp).getTime() - 
        new Date(sorted[0].timestamp).getTime()) / (1000 * 60 * 60);
      if (totalHours > 0) {
        avgStay = Math.round((avgOcc * totalHours * 60) / guests);
      }
    }

    return { guests, avgStay, peakDay, peakGuests, avgScore };
  };

  const calculateGuests = (data: SensorData[]): number => {
    const withEntries = data.filter(d => d.occupancy?.entries !== undefined);
    if (withEntries.length < 2) return 0;
    
    const sorted = withEntries.sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    
    return Math.max(0, 
      (sorted[sorted.length - 1].occupancy?.entries || 0) - 
      (sorted[0].occupancy?.entries || 0)
    );
  };

  const DeltaIndicator = ({ value, suffix = '%', inverse = false }: { value: number | null; suffix?: string; inverse?: boolean }) => {
    if (value === null) return <span className="text-warm-500">—</span>;
    
    const isPositive = inverse ? value < 0 : value > 0;
    const isNeutral = value === 0;
    
    return (
      <span className={`flex items-center gap-1 text-sm font-medium ${
        isNeutral ? 'text-warm-400' : isPositive ? 'text-emerald-400' : 'text-red-400'
      }`}>
        {isNeutral ? <Minus className="w-3 h-3" /> : isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
        {value > 0 ? '+' : ''}{value}{suffix}
      </span>
    );
  };

  const periodLabel = period === 'week' 
    ? `This Week vs Same Week ${new Date().getFullYear() - 1}`
    : `This Month vs Same Month ${new Date().getFullYear() - 1}`;

  return (
    <div className="space-y-6">
      {/* Period Selector */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar className="w-5 h-5 text-primary" />
          <span className="text-warm-400 text-sm">{periodLabel}</span>
        </div>
        
        <div className="flex items-center gap-2 bg-warm-800 rounded-lg p-1">
          {(['week', 'month'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 text-sm rounded-md transition-all ${
                period === p
                  ? 'bg-primary/20 text-primary border border-primary/30'
                  : 'text-warm-400 hover:text-white'
              }`}
            >
              {p === 'week' ? 'This Week' : 'This Month'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-8 h-8 text-primary animate-spin" />
        </div>
      ) : comparison ? (
        <>
          {/* Comparison Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-card p-4"
            >
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-4 h-4 text-primary" />
                <span className="text-xs text-warm-400">Total Guests</span>
              </div>
              <div className="text-2xl font-bold text-white">{comparison.current.guests.toLocaleString()}</div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-warm-500">vs {comparison.previous.guests.toLocaleString()}</span>
                <DeltaIndicator value={comparison.deltas.guests} />
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="glass-card p-4"
            >
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-4 h-4 text-cyan-400" />
                <span className="text-xs text-warm-400">Avg Stay</span>
              </div>
              <div className="text-2xl font-bold text-white">
                {comparison.current.avgStay !== null ? `${comparison.current.avgStay} min` : '—'}
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-warm-500">
                  vs {comparison.previous.avgStay !== null ? `${comparison.previous.avgStay} min` : '—'}
                </span>
                <DeltaIndicator value={comparison.deltas.avgStay} suffix=" min" />
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="glass-card p-4"
            >
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                <span className="text-xs text-warm-400">Peak Day Guests</span>
              </div>
              <div className="text-2xl font-bold text-white">{comparison.current.peakGuests.toLocaleString()}</div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-warm-500">{comparison.current.peakDay}</span>
                <DeltaIndicator value={comparison.deltas.peakGuests} />
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="glass-card p-4"
            >
              <div className="flex items-center gap-2 mb-2">
                <Trophy className="w-4 h-4 text-amber-400" />
                <span className="text-xs text-warm-400">Avg Score</span>
              </div>
              <div className="text-2xl font-bold text-white">{comparison.current.avgScore}</div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-warm-500">vs {comparison.previous.avgScore}</span>
                <DeltaIndicator value={comparison.deltas.avgScore} suffix=" pts" />
              </div>
            </motion.div>
          </div>

          {/* Best Records */}
          {bestRecords.bestDay && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="glass-card p-6"
            >
              <div className="flex items-center gap-3 mb-4">
                <Trophy className="w-6 h-6 text-amber-400" />
                <h3 className="text-lg font-semibold text-white">Your Best Days Ever</h3>
              </div>
              
              <div className="bg-gradient-to-r from-amber-500/10 to-orange-500/10 rounded-xl p-4 border border-amber-500/20">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm text-warm-400">All-Time Best Day</div>
                    <div className="text-lg font-bold text-white mt-1">{bestRecords.bestDay.label}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-3xl font-bold text-amber-400">{bestRecords.bestDay.value.toLocaleString()}</div>
                    <div className="text-sm text-warm-400">guests</div>
                  </div>
                </div>
              </div>
              
              <p className="text-xs text-warm-500 mt-4 text-center">
                Based on available data. The longer you use Pulse, the more records you'll track.
              </p>
            </motion.div>
          )}

          {/* No Previous Data Notice */}
          {comparison.previous.guests === 0 && (
            <div className="glass-card p-4 border-l-4 border-amber-500">
              <p className="text-sm text-warm-400">
                <strong className="text-amber-400">No data from last year.</strong> Keep using Pulse and you'll unlock year-over-year comparisons as your historical data grows.
              </p>
            </div>
          )}
        </>
      ) : (
        <div className="glass-card p-12 text-center">
          <Calendar className="w-12 h-12 text-warm-600 mx-auto mb-3" />
          <p className="text-warm-400">No comparison data available</p>
        </div>
      )}
    </div>
  );
}

export default YearOverYear;

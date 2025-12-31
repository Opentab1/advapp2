import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Minus, Clock, Target, BarChart3 } from 'lucide-react';
import apiService from '../services/api.service';
import authService from '../services/auth.service';
import type { SensorData } from '../types';

interface LiveContextProps {
  currentOccupancy: number | null;
  todayEntries: number | null;
}

interface HistoricalComparison {
  lastWeekSameTime: number;
  lastWeekTotal: number;
  averageForThisTime: number;
  averageTotal: number;
  trend: 'up' | 'down' | 'stable';
  trendAmount: number;
  percentVsUsual: number;
  percentVsLastWeek: number;
  predictedPeak: string | null;
  predictedTotal: number | null;
}

export function LiveContext({ currentOccupancy, todayEntries }: LiveContextProps) {
  const [comparison, setComparison] = useState<HistoricalComparison | null>(null);
  const [loading, setLoading] = useState(true);
  const [hourlyTrend, setHourlyTrend] = useState<number>(0);

  const user = authService.getStoredUser();
  const venueId = user?.venueId || '';

  useEffect(() => {
    loadComparison();
  }, [venueId, currentOccupancy]);

  async function loadComparison() {
    if (!venueId) return;

    try {
      // Fetch last 14 days of data for comparison
      const historicalData = await apiService.getHistoricalData(venueId, '14d');
      
      if (!historicalData?.data || historicalData.data.length === 0) {
        setLoading(false);
        return;
      }

      const now = new Date();
      const currentHour = now.getHours();
      const currentDay = now.getDay(); // 0 = Sunday, 6 = Saturday
      
      // Group data by date
      const dailyData: { [date: string]: SensorData[] } = {};
      historicalData.data.forEach(point => {
        const date = new Date(point.timestamp).toDateString();
        if (!dailyData[date]) dailyData[date] = [];
        dailyData[date].push(point);
      });

      // Find last week same day
      const lastWeekDate = new Date(now);
      lastWeekDate.setDate(lastWeekDate.getDate() - 7);
      const lastWeekKey = lastWeekDate.toDateString();
      const lastWeekData = dailyData[lastWeekKey] || [];

      // Get last week's occupancy at this time
      let lastWeekSameTime = 0;
      let lastWeekTotal = 0;
      
      if (lastWeekData.length > 0) {
        // Find data point closest to current hour (expand search to ±2 hours)
        let sameTimePoint = lastWeekData.find(p => {
          const pointHour = new Date(p.timestamp).getHours();
          return Math.abs(pointHour - currentHour) <= 1;
        });
        
        // If no exact match, try wider window
        if (!sameTimePoint) {
          sameTimePoint = lastWeekData.find(p => {
            const pointHour = new Date(p.timestamp).getHours();
            return Math.abs(pointHour - currentHour) <= 3;
          });
        }
        
        lastWeekSameTime = sameTimePoint?.occupancy?.current || 0;
        
        // Get total entries for last week same day
        const entriesValues = lastWeekData
          .map(p => p.occupancy?.entries || 0)
          .filter(e => e > 0);
        lastWeekTotal = entriesValues.length > 0 ? Math.max(...entriesValues) : 0;
      }
      
      console.log('📊 LiveContext - Last week data:', { 
        lastWeekKey, 
        dataPoints: lastWeekData.length, 
        lastWeekSameTime, 
        lastWeekTotal 
      });

      // Calculate average for this day of week at this hour
      const sameDayData: number[] = [];
      const sameDayTotals: number[] = [];
      
      Object.entries(dailyData).forEach(([dateStr, points]) => {
        const date = new Date(dateStr);
        if (date.getDay() === currentDay && dateStr !== now.toDateString()) {
          // Same day of week, not today
          // Try to find a point within ±2 hours of current time
          let sameHourPoint = points.find(p => {
            const pointHour = new Date(p.timestamp).getHours();
            return Math.abs(pointHour - currentHour) <= 1;
          });
          
          // Expand search if needed
          if (!sameHourPoint) {
            sameHourPoint = points.find(p => {
              const pointHour = new Date(p.timestamp).getHours();
              return Math.abs(pointHour - currentHour) <= 3;
            });
          }
          
          if (sameHourPoint?.occupancy?.current && sameHourPoint.occupancy.current > 0) {
            sameDayData.push(sameHourPoint.occupancy.current);
          }
          
          const entriesValues = points.map(p => p.occupancy?.entries || 0).filter(e => e > 0);
          if (entriesValues.length > 0) {
            sameDayTotals.push(Math.max(...entriesValues));
          }
        }
      });

      const averageForThisTime = sameDayData.length > 0 
        ? Math.round(sameDayData.reduce((a, b) => a + b, 0) / sameDayData.length)
        : 0;
      
      const averageTotal = sameDayTotals.length > 0
        ? Math.round(sameDayTotals.reduce((a, b) => a + b, 0) / sameDayTotals.length)
        : 0;
      
      console.log('📊 LiveContext - Average data:', { 
        sameDayDataPoints: sameDayData.length, 
        averageForThisTime, 
        averageTotal 
      });

      // Calculate hourly trend (last hour vs current)
      const todayKey = now.toDateString();
      const todayData = dailyData[todayKey] || [];
      let trendAmount = 0;
      
      if (todayData.length >= 2) {
        const recentPoints = todayData
          .filter(p => {
            const pointTime = new Date(p.timestamp);
            const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
            return pointTime >= hourAgo;
          })
          .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        
        if (recentPoints.length >= 2) {
          const firstOcc = recentPoints[0]?.occupancy?.current || 0;
          const lastOcc = recentPoints[recentPoints.length - 1]?.occupancy?.current || 0;
          trendAmount = lastOcc - firstOcc;
        }
      }

      // Calculate percent vs usual
      const current = currentOccupancy || 0;
      const percentVsUsual = averageForThisTime > 0 
        ? Math.round(((current - averageForThisTime) / averageForThisTime) * 100)
        : 0;

      const percentVsLastWeek = lastWeekSameTime > 0
        ? Math.round(((current - lastWeekSameTime) / lastWeekSameTime) * 100)
        : 0;

      // Predict peak time (simple heuristic based on historical patterns)
      let predictedPeak: string | null = null;
      let peakHour = 22; // Default 10pm
      
      if (sameDayData.length > 0) {
        // Find historical peak hour for this day
        const hourlyAvg: { [hour: number]: number[] } = {};
        Object.entries(dailyData).forEach(([dateStr, points]) => {
          const date = new Date(dateStr);
          if (date.getDay() === currentDay) {
            points.forEach(p => {
              const hour = new Date(p.timestamp).getHours();
              if (!hourlyAvg[hour]) hourlyAvg[hour] = [];
              if (p.occupancy?.current) hourlyAvg[hour].push(p.occupancy.current);
            });
          }
        });
        
        let maxAvg = 0;
        Object.entries(hourlyAvg).forEach(([hour, values]) => {
          const avg = values.reduce((a, b) => a + b, 0) / values.length;
          if (avg > maxAvg) {
            maxAvg = avg;
            peakHour = parseInt(hour);
          }
        });
      }

      // Calculate time until peak
      if (currentHour < peakHour) {
        const minutesUntilPeak = (peakHour - currentHour) * 60 - now.getMinutes();
        if (minutesUntilPeak <= 120) {
          predictedPeak = minutesUntilPeak <= 60 
            ? `~${minutesUntilPeak} min`
            : `~${Math.round(minutesUntilPeak / 60)} hr`;
        }
      }

      // Predict total based on current pace
      let predictedTotal: number | null = null;
      if (todayEntries && todayEntries > 0 && averageTotal > 0) {
        // Simple projection: current entries / % of night completed * average
        const hoursOpen = currentHour >= 17 ? currentHour - 17 : 0; // Assume open at 5pm
        const totalHours = 9; // Assume 9 hour night
        if (hoursOpen > 0) {
          const paceMultiplier = (todayEntries / hoursOpen) * totalHours;
          predictedTotal = Math.round(Math.min(paceMultiplier, averageTotal * 1.5));
        }
      }

      setComparison({
        lastWeekSameTime,
        lastWeekTotal,
        averageForThisTime,
        averageTotal,
        trend: trendAmount > 2 ? 'up' : trendAmount < -2 ? 'down' : 'stable',
        trendAmount: Math.abs(trendAmount),
        percentVsUsual,
        percentVsLastWeek,
        predictedPeak,
        predictedTotal
      });
      
      setHourlyTrend(trendAmount);
      setLoading(false);
    } catch (e) {
      console.error('Error loading comparison:', e);
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="glass-card p-4 mb-6 animate-pulse">
        <div className="h-6 bg-warm-200 rounded w-3/4"></div>
      </div>
    );
  }

  // Show nothing if no comparison data at all
  if (!comparison) {
    return (
      <div className="glass-card p-4 mb-6">
        <p className="text-sm text-warm-500 text-center">
          Building comparison data... Check back after more historical data is collected.
        </p>
      </div>
    );
  }
  
  // Check if we have enough data for meaningful comparisons
  const hasLastWeekData = comparison.lastWeekTotal > 0 || comparison.lastWeekSameTime > 0;
  const hasAverageData = comparison.averageForThisTime > 0 || comparison.averageTotal > 0;

  const getDayName = () => {
    return new Date().toLocaleDateString('en-US', { weekday: 'long' });
  };

  const getTimeString = () => {
    return new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  return (
    <div className="space-y-4 mb-6">
      {/* Right Now Context Bar */}
      <motion.div
        className="glass-card p-4"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          {/* vs Usual */}
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              comparison.percentVsUsual > 0 ? 'bg-green-100' : 
              comparison.percentVsUsual < 0 ? 'bg-red-100' : 'bg-warm-100'
            }`}>
              <BarChart3 className={`w-5 h-5 ${
                comparison.percentVsUsual > 0 ? 'text-green-600' : 
                comparison.percentVsUsual < 0 ? 'text-red-600' : 'text-warm-600'
              }`} />
            </div>
            <div>
              <p className="text-sm font-medium text-warm-800">
                {comparison.percentVsUsual > 0 ? (
                  <span className="text-green-600">{comparison.percentVsUsual}% busier</span>
                ) : comparison.percentVsUsual < 0 ? (
                  <span className="text-red-600">{Math.abs(comparison.percentVsUsual)}% slower</span>
                ) : (
                  <span className="text-warm-600">On par</span>
                )} than usual
              </p>
              <p className="text-xs text-warm-500">for {getDayName()} {getTimeString()}</p>
            </div>
          </div>

          {/* Trend */}
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              comparison.trend === 'up' ? 'bg-green-100' : 
              comparison.trend === 'down' ? 'bg-amber-100' : 'bg-warm-100'
            }`}>
              {comparison.trend === 'up' ? (
                <TrendingUp className="w-5 h-5 text-green-600" />
              ) : comparison.trend === 'down' ? (
                <TrendingDown className="w-5 h-5 text-amber-600" />
              ) : (
                <Minus className="w-5 h-5 text-warm-600" />
              )}
            </div>
            <div>
              <p className="text-sm font-medium text-warm-800">
                {comparison.trend === 'up' ? (
                  <span className="text-green-600">Crowd growing</span>
                ) : comparison.trend === 'down' ? (
                  <span className="text-amber-600">Crowd thinning</span>
                ) : (
                  <span className="text-warm-600">Steady</span>
                )}
              </p>
              <p className="text-xs text-warm-500">
                {comparison.trend !== 'stable' ? `${comparison.trendAmount} in last hour` : 'last hour'}
              </p>
            </div>
          </div>

          {/* Peak Prediction */}
          {comparison.predictedPeak && (
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center">
                <Target className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-warm-800">
                  Peak in <span className="text-primary">{comparison.predictedPeak}</span>
                </p>
                <p className="text-xs text-warm-500">based on patterns</p>
              </div>
            </div>
          )}
        </div>
      </motion.div>

      {/* Comparison Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* vs Last Week */}
        <motion.div
          className="glass-card p-4"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 text-warm-400" />
            <span className="text-xs text-warm-500">vs Last {getDayName()}</span>
          </div>
          {hasLastWeekData && comparison.lastWeekSameTime > 0 ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className={`text-2xl font-bold ${
                  comparison.percentVsLastWeek > 0 ? 'text-green-600' : 
                  comparison.percentVsLastWeek < 0 ? 'text-red-600' : 'text-warm-800'
                }`}>
                  {comparison.percentVsLastWeek > 0 ? '+' : ''}{comparison.percentVsLastWeek}%
                </span>
                {comparison.percentVsLastWeek !== 0 && (
                  comparison.percentVsLastWeek > 0 ? (
                    <TrendingUp className="w-4 h-4 text-green-600" />
                  ) : (
                    <TrendingDown className="w-4 h-4 text-red-600" />
                  )
                )}
              </div>
              <p className="text-xs text-warm-500 mt-1">
                {comparison.lastWeekSameTime} people last week
              </p>
            </>
          ) : (
            <>
              <p className="text-lg font-medium text-warm-400">No data</p>
              <p className="text-xs text-warm-400 mt-1">No data from last {getDayName()}</p>
            </>
          )}
        </motion.div>

        {/* vs Average */}
        <motion.div
          className="glass-card p-4"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
        >
          <div className="flex items-center gap-2 mb-2">
            <BarChart3 className="w-4 h-4 text-warm-400" />
            <span className="text-xs text-warm-500">vs Average</span>
          </div>
          {hasAverageData && comparison.averageForThisTime > 0 ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className={`text-2xl font-bold ${
                  comparison.percentVsUsual > 0 ? 'text-green-600' : 
                  comparison.percentVsUsual < 0 ? 'text-red-600' : 'text-warm-800'
                }`}>
                  {comparison.percentVsUsual > 0 ? '+' : ''}{comparison.percentVsUsual}%
                </span>
              </div>
              <p className="text-xs text-warm-500 mt-1">
                avg {comparison.averageForThisTime} at this time
              </p>
            </>
          ) : (
            <>
              <p className="text-lg font-medium text-warm-400">Building...</p>
              <p className="text-xs text-warm-400 mt-1">Need more historical data</p>
            </>
          )}
        </motion.div>

        {/* Last Week Total */}
        <motion.div
          className="glass-card p-4"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 text-warm-400" />
            <span className="text-xs text-warm-500">Last {getDayName()} Total</span>
          </div>
          {hasLastWeekData && comparison.lastWeekTotal > 0 ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-warm-800">
                  {comparison.lastWeekTotal}
                </span>
                <span className="text-sm text-warm-500">visitors</span>
              </div>
              <p className="text-xs text-warm-500 mt-1">
                {todayEntries ? `You have ${todayEntries} so far` : 'tracking...'}
              </p>
            </>
          ) : (
            <>
              <p className="text-lg font-medium text-warm-400">No data</p>
              <p className="text-xs text-warm-400 mt-1">
                {todayEntries ? `Today: ${todayEntries} so far` : 'Collecting data...'}
              </p>
            </>
          )}
        </motion.div>

        {/* Projected Total */}
        {comparison.predictedTotal && comparison.predictedTotal > 0 ? (
          <motion.div
            className="glass-card p-4"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Target className="w-4 h-4 text-primary" />
              <span className="text-xs text-warm-500">Tonight's Projection</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-primary">
                ~{comparison.predictedTotal}
              </span>
              <span className="text-sm text-warm-500">visitors</span>
            </div>
            <p className="text-xs text-warm-500 mt-1">at current pace</p>
          </motion.div>
        ) : (
          <motion.div
            className="glass-card p-4"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Target className="w-4 h-4 text-warm-400" />
              <span className="text-xs text-warm-500">Tonight's Projection</span>
            </div>
            <p className="text-lg font-medium text-warm-400">Calculating...</p>
            <p className="text-xs text-warm-400 mt-1">Need more data</p>
          </motion.div>
        )}
      </div>
    </div>
  );
}

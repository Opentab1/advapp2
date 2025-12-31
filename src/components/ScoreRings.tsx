import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Star, ExternalLink, Volume2, Sun, ChevronDown } from 'lucide-react';
import authService from '../services/auth.service';
import apiService from '../services/api.service';
import googleReviewsService, { GoogleReviewsData } from '../services/google-reviews.service';
import venueSettingsService from '../services/venue-settings.service';
import { calculateRecentDwellTime, formatDwellTime, getDwellTimeCategory } from '../utils/dwellTime';
import type { SensorData } from '../types';

interface WeekData {
  avgOccupancy: number;
  peakDayEntries: number;
  totalEntries: number;
  peakDay: string;
}

// Optimal ranges for Pulse Score calculation
const OPTIMAL_RANGES = {
  sound: { min: 70, max: 82 },
  light: { min: 50, max: 350 },
};

const WEIGHTS = { sound: 0.60, light: 0.40 };

function calculateFactorScore(value: number | undefined, range: { min: number; max: number }): number {
  if (value === undefined || value === null) return 0;
  if (value >= range.min && value <= range.max) return 100;
  const rangeSize = range.max - range.min;
  const tolerance = rangeSize * 0.5;
  if (value < range.min) {
    return Math.max(0, Math.round(100 - ((range.min - value) / tolerance) * 100));
  } else {
    return Math.max(0, Math.round(100 - ((value - range.max) / tolerance) * 100));
  }
}

interface ScoreRingsProps {
  sensorData?: SensorData | null;
}

export function ScoreRings({ sensorData }: ScoreRingsProps) {
  const [loading, setLoading] = useState(true);
  const [activeDetail, setActiveDetail] = useState<'pulse' | 'dwell' | 'reputation' | 'occupancy' | null>(null);
  const [dwellTime, setDwellTime] = useState<number | null>(null);
  const [reviews, setReviews] = useState<GoogleReviewsData | null>(null);
  const [thisWeek, setThisWeek] = useState<WeekData | null>(null);
  const [allSensorData, setAllSensorData] = useState<SensorData[]>([]);

  const user = authService.getStoredUser();
  const venueId = user?.venueId || '';
  const venueName = user?.venueName || '';
  const venueCapacity = 150;

  const loadData = useCallback(async () => {
    if (!venueId) return;
    setLoading(true);

    try {
      // Get venue address for Google Reviews
      const venueAddress = venueSettingsService.getFormattedAddress(venueId) || '';
      
      const [historicalResult, reviewsResult] = await Promise.allSettled([
        apiService.getHistoricalData(venueId, '7d'),
        googleReviewsService.getReviews(venueName, venueAddress, venueId)
      ]);

      if (historicalResult.status === 'fulfilled' && historicalResult.value?.data) {
        const data = historicalResult.value.data;
        setAllSensorData(data);
        const dwell = calculateRecentDwellTime(data);
        setDwellTime(dwell);
        const weekData = processWeekData(data);
        setThisWeek(weekData);
      }

      if (reviewsResult.status === 'fulfilled' && reviewsResult.value) {
        setReviews(reviewsResult.value);
      }
    } catch (e) {
      console.error('Error loading score rings data:', e);
    } finally {
      setLoading(false);
    }
  }, [venueId, venueName]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function processWeekData(data: SensorData[]): WeekData {
    // Only process data from the last 7 days
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    const dailyData: { [date: string]: { entries: number; occupancy: number[] } } = {};
    
    data.forEach(point => {
      const pointDate = new Date(point.timestamp);
      // Skip data older than 7 days
      if (pointDate < sevenDaysAgo) return;
      
      const date = pointDate.toDateString();
      if (!dailyData[date]) {
        dailyData[date] = { entries: 0, occupancy: [] };
      }
      // Take the max entries value for each day (entries is cumulative within a day)
      if (point.occupancy?.entries && point.occupancy.entries > 0) {
        dailyData[date].entries = Math.max(dailyData[date].entries, point.occupancy.entries);
      }
      if (point.occupancy?.current && point.occupancy.current > 0) {
        dailyData[date].occupancy.push(point.occupancy.current);
      }
    });

    const days = Object.entries(dailyData);
    let totalEntries = 0;
    let peakDay = '';
    let peakDayEntries = 0;
    let totalOccupancy = 0;
    let occupancyCount = 0;

    days.forEach(([date, dayData]) => {
      // Cap daily entries to a reasonable number (max 2000 per day for a typical venue)
      const cappedEntries = Math.min(dayData.entries, 2000);
      totalEntries += cappedEntries;
      
      if (cappedEntries > peakDayEntries) {
        peakDayEntries = cappedEntries;
        peakDay = new Date(date).toLocaleDateString('en-US', { weekday: 'short' });
      }
      dayData.occupancy.forEach(o => {
        totalOccupancy += o;
        occupancyCount++;
      });
    });

    console.log('📊 ScoreRings weekly data:', { 
      daysProcessed: days.length, 
      totalEntries, 
      peakDayEntries, 
      peakDay,
      avgOccupancy: occupancyCount > 0 ? Math.round(totalOccupancy / occupancyCount) : 0
    });

    return {
      avgOccupancy: occupancyCount > 0 ? Math.round(totalOccupancy / occupancyCount) : 0,
      peakDayEntries,
      totalEntries,
      peakDay
    };
  }

  // Calculate Pulse Score from live sensor data
  const soundScore = calculateFactorScore(sensorData?.decibels, OPTIMAL_RANGES.sound);
  const lightScore = calculateFactorScore(sensorData?.light, OPTIMAL_RANGES.light);
  const pulseScore = Math.round((soundScore * WEIGHTS.sound) + (lightScore * WEIGHTS.light));
  const hasPulseData = sensorData && (sensorData.decibels || sensorData.light);

  // Calculate other scores
  const dwellCategory = getDwellTimeCategory(dwellTime);
  const dwellScore = dwellTime !== null ? Math.min(100, Math.max(0, (dwellTime / 60) * 100)) : 0;
  const reputationScore = reviews ? (reviews.rating / 5) * 100 : 0;
  const occupancyScore = thisWeek ? Math.min(100, (thisWeek.avgOccupancy / venueCapacity) * 100) : 0;

  // Get pulse status
  const pulseStatus = pulseScore >= 85 ? 'Optimal' : pulseScore >= 60 ? 'Good' : 'Adjust';
  const pulseColor = pulseScore >= 85 ? '#22C55E' : pulseScore >= 60 ? '#F59E0B' : '#EF4444';

  if (loading) {
    return (
      <div className="flex flex-col items-center gap-6 mb-6">
        <div className="w-32 h-40 bg-warm-100 rounded-xl animate-pulse" />
        <div className="flex justify-center gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="w-24 h-32 bg-warm-100 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Main Pulse Score - Centered */}
      <div className="flex flex-col items-center mb-6">
        <motion.div
          className="flex flex-col items-center"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <PulseRing
            score={hasPulseData ? pulseScore : null}
            status={pulseStatus}
            color={pulseColor}
            onClick={() => setActiveDetail('pulse')}
          />
        </motion.div>
      </div>

      {/* Three Score Rings */}
      <div className="flex justify-center gap-4 sm:gap-6 mb-6">
        <ScoreRing
          score={dwellScore}
          label="Dwell Time"
          value={formatDwellTime(dwellTime)}
          color="#0077B6"
          onClick={() => setActiveDetail('dwell')}
        />
        <ScoreRing
          score={reputationScore}
          label="Reputation"
          value={reviews ? `${reviews.rating.toFixed(1)}★` : '--'}
          color="#F59E0B"
          onClick={() => setActiveDetail('reputation')}
        />
        <ScoreRing
          score={occupancyScore}
          label="Occupancy"
          value={thisWeek ? `${thisWeek.avgOccupancy}` : '--'}
          color="#22C55E"
          onClick={() => setActiveDetail('occupancy')}
        />
      </div>

      {/* Detail Modals */}
      <AnimatePresence>
        {activeDetail === 'pulse' && (
          <PulseDetailModal
            onClose={() => setActiveDetail(null)}
            pulseScore={pulseScore}
            soundScore={soundScore}
            lightScore={lightScore}
            sensorData={sensorData}
          />
        )}
        {activeDetail === 'dwell' && (
          <RingDetailModal
            type="dwell"
            onClose={() => setActiveDetail(null)}
            dwellTime={dwellTime}
            dwellCategory={dwellCategory}
            reviews={reviews}
            venueName={venueName}
            thisWeek={thisWeek}
            venueCapacity={venueCapacity}
          />
        )}
        {activeDetail === 'reputation' && (
          <RingDetailModal
            type="reputation"
            onClose={() => setActiveDetail(null)}
            dwellTime={dwellTime}
            dwellCategory={dwellCategory}
            reviews={reviews}
            venueName={venueName}
            thisWeek={thisWeek}
            venueCapacity={venueCapacity}
          />
        )}
        {activeDetail === 'occupancy' && (
          <RingDetailModal
            type="occupancy"
            onClose={() => setActiveDetail(null)}
            dwellTime={dwellTime}
            dwellCategory={dwellCategory}
            reviews={reviews}
            venueName={venueName}
            thisWeek={thisWeek}
            venueCapacity={venueCapacity}
          />
        )}
      </AnimatePresence>
    </>
  );
}

// Main Pulse Score Ring (larger)
function PulseRing({ score, status, color, onClick }: {
  score: number | null;
  status: string;
  color: string;
  onClick: () => void;
}) {
  const size = 140;
  const strokeWidth = 10;
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = score !== null ? circumference - (score / 100) * circumference : circumference;

  return (
    <motion.button
      onClick={onClick}
      className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-white border border-warm-200 shadow-card hover:shadow-card-hover transition-shadow"
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      <div className="relative" style={{ width: size, height: size }}>
        <svg className="absolute inset-0 -rotate-90" width={size} height={size}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#E7E5E4"
            strokeWidth={strokeWidth}
          />
          {score !== null && (
            <motion.circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={color}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeDasharray={circumference}
              initial={{ strokeDashoffset: circumference }}
              animate={{ strokeDashoffset: offset }}
              transition={{ duration: 1, ease: "easeOut" }}
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-4xl font-bold text-warm-800">{score ?? '--'}</span>
          <span className="text-xs text-warm-500 font-medium">{status}</span>
        </div>
      </div>
      <div className="text-center">
        <span className="text-sm font-semibold text-warm-800">Pulse Score</span>
        <div className="flex items-center justify-center gap-1 text-xs text-primary mt-1">
          <span>details</span>
          <ChevronDown className="w-3 h-3" />
        </div>
      </div>
    </motion.button>
  );
}

// Score Ring Component (smaller)
function ScoreRing({ score, label, value, color, onClick }: {
  score: number;
  label: string;
  value: string;
  color: string;
  onClick: () => void;
}) {
  const size = 90;
  const strokeWidth = 7;
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (score / 100) * circumference;

  return (
    <motion.button
      onClick={onClick}
      className="flex flex-col items-center gap-2 p-3 rounded-xl bg-white border border-warm-200 shadow-soft hover:shadow-card transition-shadow"
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
    >
      <div className="relative" style={{ width: size, height: size }}>
        <svg className="absolute inset-0 -rotate-90" width={size} height={size}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#E7E5E4"
            strokeWidth={strokeWidth}
          />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 1, ease: "easeOut" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-bold text-warm-800">{value}</span>
        </div>
      </div>
      <span className="text-xs text-warm-600 font-medium">{label}</span>
      <div className="flex items-center gap-1 text-xs text-primary">
        <span>details</span>
        <ChevronDown className="w-3 h-3" />
      </div>
    </motion.button>
  );
}

// Pulse Score Detail Modal
function PulseDetailModal({ onClose, pulseScore, soundScore, lightScore, sensorData }: {
  onClose: () => void;
  pulseScore: number;
  soundScore: number;
  lightScore: number;
  sensorData?: SensorData | null;
}) {
  const status = pulseScore >= 85 ? 'Optimal' : pulseScore >= 60 ? 'Good' : 'Needs Adjustment';
  const statusColor = pulseScore >= 85 ? 'text-green-600 bg-green-50 border-green-200' : 
                      pulseScore >= 60 ? 'text-yellow-600 bg-yellow-50 border-yellow-200' : 
                      'text-red-600 bg-red-50 border-red-200';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-warm-900/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 border border-warm-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-warm-800">Pulse Score Details</h3>
          <button onClick={onClose} className="p-1 hover:bg-warm-100 rounded-lg">
            <X className="w-5 h-5 text-warm-400" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Main Score */}
          <div className="text-center py-4">
            <p className="text-5xl font-bold text-warm-800">{pulseScore}</p>
            <p className={`inline-block mt-2 px-3 py-1 rounded-full text-sm font-medium border ${statusColor}`}>
              {status}
            </p>
          </div>

          {/* Breakdown */}
          <div className="space-y-3">
            <p className="text-xs text-warm-500 uppercase tracking-wide font-medium">Factor Breakdown</p>
            
            {/* Sound */}
            <div className="p-3 rounded-xl bg-warm-50">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Volume2 className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <span className="text-sm font-medium text-warm-800">Sound</span>
                    <span className="text-xs text-warm-500 ml-1">(60%)</span>
                  </div>
                </div>
                <span className="text-lg font-bold text-warm-800">{soundScore}</span>
              </div>
              <div className="flex justify-between text-xs text-warm-500">
                <span>Current: {sensorData?.decibels?.toFixed(1) ?? '--'} dB</span>
                <span>Optimal: 70-82 dB</span>
              </div>
              <div className="mt-2 h-1.5 bg-warm-200 rounded-full overflow-hidden">
                <div 
                  className={`h-full rounded-full ${soundScore >= 85 ? 'bg-green-500' : soundScore >= 60 ? 'bg-yellow-500' : 'bg-red-500'}`}
                  style={{ width: `${soundScore}%` }}
                />
              </div>
            </div>

            {/* Light */}
            <div className="p-3 rounded-xl bg-warm-50">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-yellow-500/10 flex items-center justify-center">
                    <Sun className="w-4 h-4 text-yellow-500" />
                  </div>
                  <div>
                    <span className="text-sm font-medium text-warm-800">Light</span>
                    <span className="text-xs text-warm-500 ml-1">(40%)</span>
                  </div>
                </div>
                <span className="text-lg font-bold text-warm-800">{lightScore}</span>
              </div>
              <div className="flex justify-between text-xs text-warm-500">
                <span>Current: {sensorData?.light?.toFixed(0) ?? '--'} lux</span>
                <span>Optimal: 50-350 lux</span>
              </div>
              <div className="mt-2 h-1.5 bg-warm-200 rounded-full overflow-hidden">
                <div 
                  className={`h-full rounded-full ${lightScore >= 85 ? 'bg-green-500' : lightScore >= 60 ? 'bg-yellow-500' : 'bg-red-500'}`}
                  style={{ width: `${lightScore}%` }}
                />
              </div>
            </div>
          </div>

          {/* Calculation */}
          <div className="p-3 rounded-xl bg-warm-50 border border-warm-200">
            <p className="text-xs text-warm-500 mb-2">Live Calculation</p>
            <div className="font-mono text-sm space-y-1">
              <div className="flex justify-between text-warm-600">
                <span>Sound: {soundScore} × 60%</span>
                <span className="text-warm-800">{(soundScore * 0.6).toFixed(1)}</span>
              </div>
              <div className="flex justify-between text-warm-600">
                <span>Light: {lightScore} × 40%</span>
                <span className="text-warm-800">{(lightScore * 0.4).toFixed(1)}</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-warm-200 font-bold text-warm-800">
                <span>Total</span>
                <span>{pulseScore}</span>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// Ring Detail Modal
function RingDetailModal({ type, onClose, dwellTime, dwellCategory, reviews, venueName, thisWeek, venueCapacity }: {
  type: 'dwell' | 'reputation' | 'occupancy';
  onClose: () => void;
  dwellTime: number | null;
  dwellCategory: string;
  reviews: GoogleReviewsData | null;
  venueName: string;
  thisWeek: WeekData | null;
  venueCapacity: number;
}) {
  const titles = {
    dwell: 'Dwell Time Details',
    reputation: 'Reputation Details',
    occupancy: 'Occupancy Details',
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-warm-900/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 border border-warm-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-warm-800">{titles[type]}</h3>
          <button onClick={onClose} className="p-1 hover:bg-warm-100 rounded-lg">
            <X className="w-5 h-5 text-warm-400" />
          </button>
        </div>

        {type === 'dwell' && (
          <div className="space-y-4">
            <div className="text-center py-4">
              <p className="text-4xl font-bold text-primary">{formatDwellTime(dwellTime)}</p>
              <p className="text-sm text-warm-500 mt-1">average time guests stay</p>
            </div>
            <div className={`p-3 rounded-lg ${
              dwellCategory === 'excellent' ? 'bg-green-50 border border-green-200' :
              dwellCategory === 'good' ? 'bg-primary-50 border border-primary-100' :
              dwellCategory === 'fair' ? 'bg-yellow-50 border border-yellow-200' :
              'bg-red-50 border border-red-200'
            }`}>
              <p className={`text-sm font-medium ${
                dwellCategory === 'excellent' ? 'text-green-700' :
                dwellCategory === 'good' ? 'text-primary-600' :
                dwellCategory === 'fair' ? 'text-yellow-700' :
                'text-red-700'
              }`}>
                {dwellCategory === 'excellent' ? '🎯 Excellent! Guests love staying.' :
                 dwellCategory === 'good' ? '👍 Good dwell time.' :
                 dwellCategory === 'fair' ? '⚠️ Fair - room to improve.' :
                 '📉 Low dwell time affects revenue.'}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-warm-50 text-xs text-warm-600">
              <p className="font-medium text-warm-800 mb-1">What is dwell time?</p>
              <p>How long guests stay on average. Longer = more drinks, more food, more revenue.</p>
            </div>
          </div>
        )}

        {type === 'reputation' && (
          <div className="space-y-4">
            {reviews ? (
              <>
                <div className="text-center py-4">
                  <p className="text-4xl font-bold text-warning">{reviews.rating.toFixed(1)}</p>
                  <div className="flex justify-center text-warning mt-2">
                    {[1, 2, 3, 4, 5].map(i => (
                      <Star 
                        key={i} 
                        className={`w-5 h-5 ${i <= Math.round(reviews.rating) ? 'fill-current' : ''}`} 
                      />
                    ))}
                  </div>
                  <p className="text-sm text-warm-500 mt-2">{reviews.reviewCount.toLocaleString()} Google reviews</p>
                </div>
                <a
                  href={`https://www.google.com/maps/search/${encodeURIComponent(venueName)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full py-2 rounded-lg bg-warm-100 hover:bg-warm-200 text-sm text-primary font-medium"
                >
                  View on Google <ExternalLink className="w-4 h-4" />
                </a>
              </>
            ) : (
              <div className="text-center py-8 text-warm-500">
                <Star className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>Google Reviews not configured</p>
                <p className="text-xs mt-1">Set up your venue address in Settings</p>
              </div>
            )}
          </div>
        )}

        {type === 'occupancy' && (
          <div className="space-y-4">
            <div className="text-center py-4">
              <p className="text-4xl font-bold text-success">
                {thisWeek ? thisWeek.avgOccupancy : '--'}
              </p>
              <p className="text-sm text-warm-500 mt-1">avg guests this week</p>
            </div>
            {thisWeek && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-lg bg-warm-50">
                    <p className="text-xs text-warm-500 uppercase">Peak Day</p>
                    <p className="text-lg font-bold text-warm-800">{thisWeek.peakDayEntries}</p>
                    <p className="text-xs text-warm-500">on {thisWeek.peakDay}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-warm-50">
                    <p className="text-xs text-warm-500 uppercase">Weekly Total</p>
                    <p className="text-lg font-bold text-warm-800">{thisWeek.totalEntries}</p>
                    <p className="text-xs text-warm-500">visitors</p>
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-warm-50">
                  <p className="text-xs text-warm-500 mb-2">Capacity utilization</p>
                  <div className="h-2 bg-warm-200 rounded-full overflow-hidden">
                    <motion.div 
                      className="h-full bg-success rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(100, (thisWeek.avgOccupancy / venueCapacity) * 100)}%` }}
                    />
                  </div>
                  <p className="text-xs text-warm-500 mt-1">
                    {Math.round((thisWeek.avgOccupancy / venueCapacity) * 100)}% of {venueCapacity} capacity
                  </p>
                </div>
              </>
            )}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

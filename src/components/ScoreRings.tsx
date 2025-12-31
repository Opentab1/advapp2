import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Star, ExternalLink } from 'lucide-react';
import authService from '../services/auth.service';
import apiService from '../services/api.service';
import googleReviewsService, { GoogleReviewsData } from '../services/google-reviews.service';
import { calculateRecentDwellTime, formatDwellTime, getDwellTimeCategory } from '../utils/dwellTime';
import type { SensorData } from '../types';

interface WeekData {
  avgOccupancy: number;
  peakDayEntries: number;
  totalEntries: number;
  peakDay: string;
}

export function ScoreRings() {
  const [loading, setLoading] = useState(true);
  const [activeRing, setActiveRing] = useState<'dwell' | 'reputation' | 'occupancy' | null>(null);
  const [dwellTime, setDwellTime] = useState<number | null>(null);
  const [reviews, setReviews] = useState<GoogleReviewsData | null>(null);
  const [thisWeek, setThisWeek] = useState<WeekData | null>(null);
  const [allSensorData, setAllSensorData] = useState<SensorData[]>([]);

  const user = authService.getStoredUser();
  const venueId = user?.venueId || '';
  const venueName = user?.venueName || '';
  const venueCapacity = 150; // Default capacity

  const loadData = useCallback(async () => {
    if (!venueId) return;
    setLoading(true);

    try {
      // Fetch data in parallel
      const [historicalResult, reviewsResult] = await Promise.allSettled([
        apiService.getHistoricalData(venueId, '7d'),
        googleReviewsService.getReviews(venueName)
      ]);

      // Process historical data
      if (historicalResult.status === 'fulfilled' && historicalResult.value?.data) {
        const data = historicalResult.value.data;
        setAllSensorData(data);

        // Calculate dwell time
        const dwell = calculateRecentDwellTime(data);
        setDwellTime(dwell);

        // Process weekly data
        const weekData = processWeekData(data);
        setThisWeek(weekData);
      }

      // Process reviews
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

  // Process week data helper
  function processWeekData(data: SensorData[]): WeekData {
    const dailyData: { [date: string]: { entries: number; occupancy: number[] } } = {};
    
    data.forEach(point => {
      const date = new Date(point.timestamp).toDateString();
      if (!dailyData[date]) {
        dailyData[date] = { entries: 0, occupancy: [] };
      }
      if (point.occupancy?.entries) {
        dailyData[date].entries = Math.max(dailyData[date].entries, point.occupancy.entries);
      }
      if (point.occupancy?.current) {
        dailyData[date].occupancy.push(point.occupancy.current);
      }
    });

    const days = Object.entries(dailyData);
    let totalEntries = 0;
    let peakDay = '';
    let peakDayEntries = 0;
    let totalOccupancy = 0;
    let occupancyCount = 0;

    days.forEach(([date, data]) => {
      totalEntries += data.entries;
      if (data.entries > peakDayEntries) {
        peakDayEntries = data.entries;
        peakDay = new Date(date).toLocaleDateString('en-US', { weekday: 'short' });
      }
      data.occupancy.forEach(o => {
        totalOccupancy += o;
        occupancyCount++;
      });
    });

    return {
      avgOccupancy: occupancyCount > 0 ? Math.round(totalOccupancy / occupancyCount) : 0,
      peakDayEntries,
      totalEntries,
      peakDay
    };
  }

  // Calculate scores
  const dwellCategory = getDwellTimeCategory(dwellTime);
  const dwellScore = dwellTime !== null
    ? Math.min(100, Math.max(0, (dwellTime / 60) * 100)) // 60 min = 100%
    : 0;

  const reputationScore = reviews
    ? (reviews.rating / 5) * 100
    : 0;

  const occupancyScore = thisWeek
    ? Math.min(100, (thisWeek.avgOccupancy / venueCapacity) * 100)
    : 0;

  if (loading) {
    return (
      <div className="flex justify-center gap-4 mb-6">
        {[1, 2, 3].map(i => (
          <div key={i} className="w-24 h-32 bg-warm-100 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="flex justify-center gap-6 mb-6">
        <ScoreRing
          score={dwellScore}
          label="Dwell Time"
          value={formatDwellTime(dwellTime)}
          color="#0077B6"
          onClick={() => setActiveRing('dwell')}
        />
        <ScoreRing
          score={reputationScore}
          label="Reputation"
          value={reviews ? `${reviews.rating.toFixed(1)}★` : '--'}
          color="#F59E0B"
          onClick={() => setActiveRing('reputation')}
        />
        <ScoreRing
          score={occupancyScore}
          label="Occupancy"
          value={thisWeek ? `${thisWeek.avgOccupancy}` : '--'}
          color="#22C55E"
          onClick={() => setActiveRing('occupancy')}
        />
      </div>

      {/* Ring Detail Modal */}
      <AnimatePresence>
        {activeRing && (
          <RingDetailModal
            type={activeRing}
            onClose={() => setActiveRing(null)}
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

// Score Ring Component
function ScoreRing({ score, label, value, color, onClick }: {
  score: number;
  label: string;
  value: string;
  color: string;
  onClick: () => void;
}) {
  const size = 100;
  const strokeWidth = 8;
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
          <span className="text-xl font-bold text-warm-800">{value}</span>
        </div>
      </div>
      <span className="text-xs text-warm-500 font-medium">{label}</span>
    </motion.button>
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
    dwell: 'Average Dwell Time',
    reputation: 'Reputation',
    occupancy: 'Occupancy',
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
                {dwellCategory === 'excellent' ? '🎯 Excellent!' :
                 dwellCategory === 'good' ? '👍 Good' :
                 dwellCategory === 'fair' ? '⚠️ Fair' :
                 '📉 Needs work'}
              </p>
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
                  <p className="text-sm text-warm-500 mt-2">{reviews.reviewCount.toLocaleString()} reviews</p>
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
                    <p className="text-xs text-warm-500 uppercase">Peak</p>
                    <p className="text-lg font-bold text-warm-800">{thisWeek.peakDayEntries}</p>
                    <p className="text-xs text-warm-500">on {thisWeek.peakDay}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-warm-50">
                    <p className="text-xs text-warm-500 uppercase">Total</p>
                    <p className="text-lg font-bold text-warm-800">{thisWeek.totalEntries}</p>
                    <p className="text-xs text-warm-500">this week</p>
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

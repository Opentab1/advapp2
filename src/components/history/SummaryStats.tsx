/**
 * SummaryStats - Key metrics summary for History page
 * 
 * Replaces old card design with 4 unified Rings:
 * - Pulse Score (Avg)
 * - Dwell Time (Avg)
 * - Reputation (Latest/Avg)
 * - Crowd (Peak)
 * 
 * Consistent with main dashboard visual language.
 */

import { motion } from 'framer-motion';
import { Ring } from '../common/Ring';
import { calculatePulseScore } from '../../utils/scoring';
import { calculateDwellTimeFromHistory, formatDwellTime } from '../../utils/dwellTime';
import { RING_COLORS } from '../../utils/constants';
import type { SensorData, TimeRange } from '../../types';

interface SummaryStatsProps {
  data: SensorData[];
  timeRange: TimeRange;
}

export function SummaryStats({ data, timeRange }: SummaryStatsProps) {
  const summary = calculateHistorySummary(data);
  const rangeLabel = getPeriodLabel(timeRange);

  const rings = [
    {
      id: 'pulse',
      label: 'Avg Score',
      score: summary.avgPulseScore,
      value: summary.avgPulseScore?.toString() || '--',
      subtitle: rangeLabel,
      color: RING_COLORS.pulse,
    },
    {
      id: 'dwell',
      label: 'Avg Stay',
      score: summary.dwellScore, // 0-100 score for ring
      value: formatDwellTime(summary.avgDwellTime),
      subtitle: rangeLabel,
      color: RING_COLORS.dwell,
    },
    {
      id: 'reputation',
      label: 'Rating',
      score: summary.reputationScore,
      value: summary.avgRating ? `${summary.avgRating.toFixed(1)}★` : '--',
      subtitle: 'Google',
      color: RING_COLORS.reputation,
    },
    {
      id: 'crowd',
      label: 'Peak Crowd',
      score: summary.occupancyScore,
      value: summary.peakOccupancy.toString(),
      subtitle: summary.peakTime || 'at peak',
      color: RING_COLORS.crowd,
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {rings.map((ring, i) => (
        <motion.div
          key={ring.id}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: i * 0.05 }}
          className="flex justify-center"
        >
          <Ring
            size="medium"
            score={ring.score}
            label={ring.label}
            value={ring.value}
            subtitle={ring.subtitle}
            color={ring.color}
            glow={false} // Cleaner look for history
          />
        </motion.div>
      ))}
    </div>
  );
}

// ============ LOGIC ============

interface HistorySummary {
  avgPulseScore: number | null;
  avgDwellTime: number | null;
  dwellScore: number;
  avgRating: number | null;
  reputationScore: number;
  peakOccupancy: number;
  peakTime: string | null;
  occupancyScore: number;
}

function calculateHistorySummary(data: SensorData[]): HistorySummary {
  if (!data || data.length === 0) {
    return {
      avgPulseScore: null,
      avgDwellTime: null,
      dwellScore: 0,
      avgRating: null,
      reputationScore: 0,
      peakOccupancy: 0,
      peakTime: null,
      occupancyScore: 0,
    };
  }

  // 1. Avg Pulse Score
  let totalScore = 0;
  let count = 0;
  
  // 2. Peak Occupancy
  let peakOccupancy = 0;
  let peakTime: string | null = null;
  
  data.forEach(d => {
    const { score } = calculatePulseScore(d.decibels, d.light);
    if (score !== null) {
      totalScore += score;
      count++;
    }
    
    if (d.occupancy?.current && d.occupancy.current > peakOccupancy) {
      peakOccupancy = d.occupancy.current;
      peakTime = new Date(d.timestamp).toLocaleTimeString([], { 
        weekday: 'short', 
        hour: 'numeric',
        minute: '2-digit'
      });
    }
  });
  
  const avgPulseScore = count > 0 ? Math.round(totalScore / count) : null;
  
  // 3. Avg Dwell Time
  // Use simple estimation: 24h * 7 for week range approx
  const avgDwellTime = calculateDwellTimeFromHistory(data, 24 * 7); 
  const dwellScore = avgDwellTime ? Math.min(100, Math.round((avgDwellTime / 90) * 100)) : 0; // Target 90m
  
  // 4. Reputation (Mock for now as it's external data)
  const avgRating = 4.8; 
  const reputationScore = 96;
  
  // 5. Occupancy Score (vs Capacity)
  // Assuming capacity ~150 for relative scoring if not set
  const capacity = 150; 
  const occupancyScore = Math.min(100, Math.round((peakOccupancy / capacity) * 100));

  return {
    avgPulseScore,
    avgDwellTime,
    dwellScore,
    avgRating,
    reputationScore,
    peakOccupancy,
    peakTime,
    occupancyScore,
  };
}

function getPeriodLabel(range: TimeRange): string {
  switch (range) {
    case '24h': return 'Today';
    case '7d': return '7 Day Avg';
    case '14d': return '14 Day Avg';
    case '30d': return '30 Day Avg';
    case '90d': return '90 Day Avg';
    default: return 'Avg';
  }
}

export default SummaryStats;

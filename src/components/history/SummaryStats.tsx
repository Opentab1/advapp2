/**
 * SummaryStats - Key metrics summary for History page
 * 
 * Shows:
 * - Total visitors
 * - Peak occupancy
 * - Average sound
 * - Data quality
 */

import { motion } from 'framer-motion';
import { Users, TrendingUp, Volume2, Database } from 'lucide-react';
import type { SensorData, TimeRange } from '../../types';

interface SummaryStatsProps {
  data: SensorData[];
  timeRange: TimeRange;
}

interface StatItem {
  id: string;
  label: string;
  value: string;
  subValue?: string;
  icon: React.ElementType;
  color: string;
}

export function SummaryStats({ data, timeRange }: SummaryStatsProps) {
  const summary = calculateSummary(data);
  const periodLabel = getPeriodLabel(timeRange);
  
  const stats: StatItem[] = [
    {
      id: 'visitors',
      label: 'Total Visitors',
      value: summary.totalVisitors.toLocaleString(),
      subValue: periodLabel,
      icon: Users,
      color: 'text-green-400',
    },
    {
      id: 'peak',
      label: 'Peak Occupancy',
      value: summary.peakOccupancy.toString(),
      subValue: summary.peakTime || 'at peak',
      icon: TrendingUp,
      color: 'text-amber-400',
    },
    {
      id: 'sound',
      label: 'Avg Sound',
      value: `${summary.avgSound.toFixed(0)} dB`,
      subValue: getSoundLabel(summary.avgSound),
      icon: Volume2,
      color: 'text-blue-400',
    },
    {
      id: 'data',
      label: 'Data Points',
      value: summary.dataPoints.toLocaleString(),
      subValue: getDataQuality(summary.dataPoints, timeRange),
      icon: Database,
      color: 'text-purple-400',
    },
  ];
  
  return (
    <motion.div
      className="grid grid-cols-2 sm:grid-cols-4 gap-3"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {stats.map((stat, i) => (
        <motion.div
          key={stat.id}
          className="bg-warm-800 rounded-xl border border-warm-700 p-3"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05 }}
        >
          <div className="flex items-center gap-2 mb-2">
            <stat.icon className={`w-4 h-4 ${stat.color}`} />
            <span className="text-xs text-warm-400">{stat.label}</span>
          </div>
          <p className="text-xl font-bold text-warm-100">{stat.value}</p>
          {stat.subValue && (
            <p className="text-xs text-warm-500 mt-0.5">{stat.subValue}</p>
          )}
        </motion.div>
      ))}
    </motion.div>
  );
}

// ============ HELPERS ============

interface Summary {
  totalVisitors: number;
  peakOccupancy: number;
  peakTime: string | null;
  avgSound: number;
  dataPoints: number;
}

function calculateSummary(data: SensorData[]): Summary {
  let totalVisitors = 0;
  let peakOccupancy = 0;
  let peakTime: string | null = null;
  let totalSound = 0;
  let soundCount = 0;
  
  const dailyEntries = new Map<string, number>();
  
  data.forEach((item) => {
    const date = new Date(item.timestamp).toDateString();
    
    if (item.occupancy?.entries) {
      const current = dailyEntries.get(date) || 0;
      dailyEntries.set(date, Math.max(current, item.occupancy.entries));
    }
    
    if (item.occupancy?.current && item.occupancy.current > peakOccupancy) {
      peakOccupancy = item.occupancy.current;
      peakTime = new Date(item.timestamp).toLocaleString('en-US', {
        weekday: 'short',
        hour: 'numeric',
        minute: '2-digit',
      });
    }
    
    if (item.decibels) {
      totalSound += item.decibels;
      soundCount++;
    }
  });
  
  dailyEntries.forEach((entries) => {
    totalVisitors += entries;
  });
  
  return {
    totalVisitors,
    peakOccupancy,
    peakTime,
    avgSound: soundCount > 0 ? totalSound / soundCount : 0,
    dataPoints: data.length,
  };
}

function getPeriodLabel(range: TimeRange): string {
  switch (range) {
    case '24h': return 'today';
    case '7d': return 'this week';
    case '30d': return 'this month';
    case '90d': return 'this quarter';
    default: return 'period';
  }
}

function getSoundLabel(avg: number): string {
  if (avg < 60) return 'Quiet';
  if (avg < 70) return 'Moderate';
  if (avg < 80) return 'Lively';
  return 'Loud';
}

function getDataQuality(points: number, range: TimeRange): string {
  const expected: Record<TimeRange, number> = {
    'live': 1,
    '6h': 72,
    '24h': 288,
    '7d': 2016,
    '14d': 4032,
    '30d': 8640,
    '90d': 25920,
  };
  
  const ratio = points / (expected[range] || 288);
  if (ratio >= 0.8) return 'Excellent coverage';
  if (ratio >= 0.5) return 'Good coverage';
  if (ratio >= 0.2) return 'Partial coverage';
  return 'Limited data';
}

export default SummaryStats;

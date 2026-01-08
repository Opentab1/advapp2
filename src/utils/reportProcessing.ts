import type { SensorData } from '../types';
import { calculatePulseScore } from './scoring';
import { calculateDwellTimeFromHistory } from './dwellTime';

export interface ProcessedReportData {
  avgScore: number;
  revenueTrend: number;
  revenuePerHour: number;
  peakWindow: string;
  upsideOpportunity: string;
  verdict: {
    scoreThreshold: number;
    peakPercentage: number;
  };
  impacts: Array<{
    icon: 'volume' | 'users' | 'light' | 'temp';
    condition: string;
    outcome: string;
    type: 'positive' | 'negative';
  }>;
  scoreTrend: Array<{ label: string; value: number; isCurrent?: boolean }>;
  envSales: Array<{
    range: string;
    revenue: number;
    samples: number;
    isOptimal?: boolean;
  }>;
  heatmap: Array<{ day: number; hour: number; score: number }>;
  insights: Array<{ icon: 'trend-down' | 'clock' | 'users'; title: string; desc: string }>;
  archive: Array<{ label: string; date: string }>;
}

export function processReportData(data: SensorData[]): ProcessedReportData {
  if (!data || data.length === 0) {
    return getEmptyReportData();
  }

  // 1. Basic Stats
  let totalScore = 0;
  let count = 0;
  let peakScore = 0;
  let peakTime = new Date();
  
  // 2. Heatmap Prep (7x24 grid)
  const heatmapGrid = new Array(7).fill(0).map(() => new Array(24).fill({ sum: 0, count: 0 }));
  
  // 3. Env Sales Prep (Buckets)
  const soundBuckets: Record<string, { revSum: number; count: number }> = {
    '65-70': { revSum: 0, count: 0 },
    '71-76': { revSum: 0, count: 0 },
    '77-82': { revSum: 0, count: 0 },
    '83-88': { revSum: 0, count: 0 },
    '89+': { revSum: 0, count: 0 },
  };

  data.forEach(d => {
    const date = new Date(d.timestamp);
    const day = date.getDay();
    const hour = date.getHours();
    
    // Score
    const { score } = calculatePulseScore(d.decibels, d.light);
    if (score) {
      totalScore += score;
      count++;
      if (score > peakScore) {
        peakScore = score;
        peakTime = date;
      }
      
      // Heatmap
      const cell = heatmapGrid[day][hour];
      heatmapGrid[day][hour] = { sum: cell.sum + score, count: cell.count + 1 };
    }
    
    // Revenue Estimate (Mock logic: Headcount * $25 + Vibe Bonus)
    const headcount = d.occupancy?.current || 0;
    const baseRev = headcount * 25; // Base spend/hr/head
    const vibeBonus = score && score > 70 ? (score - 70) * 0.5 : 0; // Bonus %
    const estRev = baseRev * (1 + vibeBonus / 100);
    
    // Env Sales Bucketing
    const db = d.decibels;
    let bucket = '89+';
    if (db < 71) bucket = '65-70';
    else if (db < 77) bucket = '71-76';
    else if (db < 83) bucket = '77-82';
    else if (db < 89) bucket = '83-88';
    
    soundBuckets[bucket].revSum += estRev;
    soundBuckets[bucket].count += 1; // 1 data point = 1 unit of time (e.g. 1 hour or 15 min)
  });

  const avgScore = count > 0 ? Math.round(totalScore / count) : 0;
  
  // 4. Format Heatmap
  const heatmap = heatmapGrid.flatMap((hours, d) => 
    hours.map((h, hIdx) => ({
      day: d,
      hour: hIdx,
      score: h.count > 0 ? Math.round(h.sum / h.count) : 0
    }))
  ).filter(h => h.score > 0);

  // 5. Format Env Sales
  const envSales = Object.entries(soundBuckets).map(([range, val]) => ({
    range: `${range}dB`,
    revenue: val.count > 0 ? Math.round(val.revSum / val.count) : 0, // Revenue per unit time
    samples: val.count,
    isOptimal: range === '77-82' // Logic would be dynamic in real ML model
  }));

  // 6. Generate Insights (Rule-based)
  const insights: ProcessedReportData['insights'] = [];
  if (avgScore < 70) {
    insights.push({ icon: 'trend-down', title: 'Low Vibe Score', desc: 'Average score is below optimal range (70+).' });
  }
  // Check for dropoff (Mock check)
  // In real app, analyze heatmap for patterns
  insights.push({ icon: 'trend-down', title: 'Drop-off at 6-7 PM', desc: 'Score drops consistently during shift change.' });

  // 7. Timeline Trend (Last 5 hours)
  // Assuming data is sorted, take last 5
  const sortedData = [...data].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const scoreTrend = sortedData.slice(-5).map(d => {
    const { score } = calculatePulseScore(d.decibels, d.light);
    return {
      label: new Date(d.timestamp).toLocaleTimeString([], { hour: 'numeric' }),
      value: score || 0,
      isCurrent: d === sortedData[sortedData.length - 1]
    };
  });

  return {
    avgScore,
    revenueTrend: 12, // Placeholder
    revenuePerHour: 840, // Placeholder
    peakWindow: peakTime.toLocaleTimeString([], { weekday: 'short', hour: 'numeric' }),
    upsideOpportunity: '+18%',
    verdict: {
      scoreThreshold: 80,
      peakPercentage: 42
    },
    impacts: [
      { icon: 'volume', condition: 'Sound > 85dB', outcome: 'Revenue/min ↓ 12%', type: 'negative' },
      { icon: 'users', condition: 'Crowd 80-90% Cap', outcome: 'Dwell Time ↑ 15m', type: 'positive' }
    ],
    scoreTrend,
    envSales,
    heatmap,
    insights,
    archive: [
      { label: 'Weekly Report', date: 'Oct 1-7' },
      { label: 'Weekly Report', date: 'Sep 24-30' }
    ]
  };
}

function getEmptyReportData(): ProcessedReportData {
  return {
    avgScore: 0,
    revenueTrend: 0,
    revenuePerHour: 0,
    peakWindow: '--',
    upsideOpportunity: '--',
    verdict: { scoreThreshold: 0, peakPercentage: 0 },
    impacts: [],
    scoreTrend: [],
    envSales: [],
    heatmap: [],
    insights: [],
    archive: []
  };
}

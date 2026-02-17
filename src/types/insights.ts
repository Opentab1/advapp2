/**
 * Insights/Analytics Types
 * 
 * Data structures for the merged Analytics page (formerly History + Reports)
 * Supports 3-level progressive disclosure: Report → Supporting Data → Raw Data
 */

export type InsightsTimeRange = 'last_night' | '7d' | '14d' | '30d';

// ============ LEVEL 1: SUMMARY ============

export interface InsightsSummary {
  score: number;
  scoreDelta: number;              // vs previous period (percentage)
  avgStayMinutes: number | null;   // null if not enough exit data
  avgStayDelta: number | null;     // vs previous period (percentage), null if can't calculate
  totalGuests: number;
  guestsIsEstimate: boolean;       // true if extrapolated from partial data
  guestsDelta: number;             // vs previous period (percentage)
  summaryText: string;             // "Solid night. Dwell time up..."
  peakHours: string;               // "9pm - 1am"
  timeInZoneHours: number;         // 4.2
  totalPeakHours: number;          // 6
}

export interface HourlyData {
  hour: string;                    // "7pm"
  score: number;
  label: string;                   // "Warming up"
  isHighlight: boolean;            // true for peak
}

export interface FactorScore {
  factor: 'sound' | 'light' | 'crowd';
  score: number;
  label: string;                   // "In range all night"
}

// ============ LEVEL 1: SWEET SPOT ============

export interface SweetSpotBucket {
  range: string;                   // "75-82 dB"
  avgScore: number;                // Average Pulse Score in this bucket (real data)
  sampleCount: number;
  isOptimal: boolean;
}

export interface SweetSpotData {
  variable: 'sound' | 'light' | 'crowd';
  buckets: SweetSpotBucket[];
  optimalRange: string;            // "75-82 dB"
  optimalScore: number;            // Avg score in optimal range (real)
  outsideScore: number;            // Avg score outside optimal range (real)
  hitPercentage: number;           // 68 (percent of time in optimal range)
  totalSamples: number;
}

// ============ LEVEL 1: TREND ============

export interface TrendData {
  avgStay: number | null;          // null if not enough exit data
  avgStayDelta: number | null;     // percentage change, null if can't calculate
  totalGuests: number;
  guestsIsEstimate: boolean;       // true if extrapolated from partial data
  guestsDelta: number;             // percentage change
  bestDay: {
    date: string;
    score: number;
    label?: string;                // "Peak crowd, stayed in zone all night"
  };
  worstDay: {
    date: string;
    score: number;
    label?: string;                // "Low crowd, sound too quiet"
  };
  weekOverWeek: Array<{
    label: string;                 // "This Week" / "Last Week"
    avgScore: number;
    avgStay: number | null;        // null if not enough exit data
    guests: number;
  }>;
}

// ============ LEVEL 2: COMPARISON ============

export interface PeriodComparison {
  current: {
    score: number;
    avgStay: number | null;        // null if not enough exit data
    guests: number;
  };
  previous: {
    score: number;
    avgStay: number | null;        // null if not enough exit data
    guests: number;
  };
  periodLabel: string;             // "vs last Thursday"
}

// ============ LEVEL 3: RAW DATA ============

export interface RawDataPoint {
  timestamp: Date;
  score: number;
  decibels: number;
  light: number;
  occupancy: number;
  dwellMinutes: number | null;
  temperature: number;
}

export interface RawDataStats {
  average: number;
  min: { value: number; timestamp: string };
  max: { value: number; timestamp: string };
  dataPoints: number;
  dateRange: { start: string; end: string };
}

// ============ COMBINED INSIGHTS DATA ============

export interface InsightsData {
  // Loading state
  loading: boolean;
  error: string | null;
  
  // Level 1 data
  summary: InsightsSummary | null;
  sweetSpot: SweetSpotData | null;
  allSweetSpots: Record<'sound' | 'light' | 'crowd', SweetSpotData> | null;
  trend: TrendData | null;
  
  // Level 2 data
  hourlyData: HourlyData[];
  factorScores: FactorScore[];
  comparison: PeriodComparison | null;
  trendChartData: Array<{ date: Date; score: number; avgStay: number; guests: number }>;
  dwellCorrelations: DwellCorrelationData | null;
  
  // Level 3 data
  rawData: RawDataPoint[];
  
  // Full sensor data (with entries/exits for charts that need it)
  sensorData: import('../types').SensorData[];
  
  // Actions
  refresh: () => Promise<void>;
}

// ============ DWELL CORRELATION ============

export interface CorrelationDataPoint {
  timestamp: Date;
  hour: string;                    // "Mon 9pm"
  metricValue: number;             // Sound dB, Light lux, or Crowd count
  dwellMinutes: number | null;     // Avg dwell for that time period
}

export interface DwellCorrelation {
  factor: 'sound' | 'light' | 'crowd';
  label: string;                   // "Sound Level"
  unit: string;                    // "dB", "lux", "guests"
  dataPoints: CorrelationDataPoint[];
  overallAvgDwell: number;
  overallAvgMetric: number;
  correlationStrength: number;     // -1 to 1 (positive = higher metric = longer stay)
  insight: string;                 // "Higher sound levels correlate with longer stays"
  totalSamples: number;
  confidence: 'high' | 'medium' | 'low';
}

export interface DwellCorrelationData {
  sound: DwellCorrelation | null;
  light: DwellCorrelation | null;
  crowd: DwellCorrelation | null;
  hasData: boolean;
  totalDataPoints: number;
}

// ============ HELPER TYPES ============

export type MetricType = 'score' | 'sound' | 'light' | 'crowd' | 'dwell';

export type SweetSpotVariable = 'sound' | 'light' | 'crowd';

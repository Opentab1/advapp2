import type { SensorData } from '../types';

/**
 * Calculate average dwell time using Little's Law: W = L / λ
 * 
 * Where:
 *   W = Average dwell time (what we're calculating)
 *   L = Average number in system (occupancy)
 *   λ = Arrival rate (entries per unit time)
 * 
 * @param avgOccupancy - Average occupancy during the period
 * @param totalEntries - Total entries during the period
 * @param periodHours - Time period in hours (default 1)
 * @returns Average dwell time in minutes, or null if cannot calculate
 */
export function calculateDwellTime(
  avgOccupancy: number,
  totalEntries: number,
  periodHours: number = 1
): number | null {
  // Need entries to calculate
  if (totalEntries === 0 || avgOccupancy === 0) {
    return null;
  }

  // Little's Law: W = L / λ
  // λ = entries per hour
  const arrivalRate = totalEntries / periodHours;
  const dwellTimeHours = avgOccupancy / arrivalRate;
  const dwellTimeMinutes = dwellTimeHours * 60;

  // Sanity check: dwell time should be reasonable (between 1 minute and 24 hours)
  if (dwellTimeMinutes < 1 || dwellTimeMinutes > 1440) {
    return null;
  }

  return Math.round(dwellTimeMinutes);
}

/**
 * Calculate dwell time from historical sensor data
 * Uses average occupancy and total entries across the dataset
 * 
 * Both hourly aggregated and raw data use CUMULATIVE counters for entries.
 * We always use delta calculation: lastEntries - firstEntries
 * 
 * @param data - Array of sensor data points
 * @param timeRangeHours - Total time range in hours
 * @returns Average dwell time in minutes, or null if cannot calculate
 */
export function calculateDwellTimeFromHistory(
  data: SensorData[],
  timeRangeHours: number
): number | null {
  if (!data || data.length === 0) {
    return null;
  }

  // Calculate average occupancy across all data points
  const occupancyValues = data
    .filter(d => d.occupancy?.current !== undefined)
    .map(d => d.occupancy!.current);

  if (occupancyValues.length === 0) {
    return null;
  }

  const avgOccupancy = occupancyValues.reduce((sum, val) => sum + val, 0) / occupancyValues.length;

  // Get entries data sorted by timestamp
  const entryData = data
    .filter(d => d.occupancy?.entries !== undefined && d.occupancy.entries >= 0)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  
  if (entryData.length < 2) {
    return null;
  }

  // Simple calculation: latest entries - earliest entries
  // Counter is cumulative all-time (never resets)
  const earliest = entryData[0];
  const latest = entryData[entryData.length - 1];
  const totalEntries = Math.max(0, latest.occupancy!.entries - earliest.occupancy!.entries);

  return calculateDwellTime(avgOccupancy, totalEntries, timeRangeHours);
}

/**
 * Calculate dwell time for current hour (rolling window)
 * Uses recent data points to estimate current dwell time
 * 
 * @param currentOccupancy - Current occupancy count
 * @param entriesThisHour - Total entries in the current hour
 * @returns Estimated dwell time in minutes, or null if cannot calculate
 */
export function calculateCurrentHourDwellTime(
  currentOccupancy: number,
  entriesThisHour: number
): number | null {
  return calculateDwellTime(currentOccupancy, entriesThisHour, 1);
}

/**
 * Calculate dwell time from recent sensor data (last N hours)
 * Uses Little's Law: W = L / λ
 * 
 * Formula: Dwell Time (hours) = Avg Occupancy / (Entries per Hour)
 * Then convert to minutes.
 * 
 * @param data - Array of sensor data points (should include recent history)
 * @param hoursBack - How many hours of recent data to use (default 4)
 * @returns Average dwell time in minutes, or null if cannot calculate
 */
export function calculateRecentDwellTime(
  data: SensorData[],
  hoursBack: number = 4
): number | null {
  if (!data || data.length === 0) {
    console.log('📊 Dwell time: No data provided');
    return null;
  }

  // Sort all data by timestamp (oldest first)
  const sorted = [...data].sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // Try to use recent data, but fall back to all available data
  const now = new Date();
  const cutoffTime = new Date(now.getTime() - hoursBack * 60 * 60 * 1000);
  
  let recentData = sorted.filter(d => new Date(d.timestamp) >= cutoffTime);
  
  // If not enough recent data, use all available data
  if (recentData.length < 2) {
    console.log('📊 Dwell time: Not enough recent data, using full dataset');
    recentData = sorted;
  }

  if (recentData.length < 2) {
    console.log('📊 Dwell time: Still not enough data points');
    return null;
  }

  // Calculate average occupancy from data points with occupancy > 0
  const occupancyValues = recentData
    .filter(d => d.occupancy?.current !== undefined && d.occupancy.current > 0)
    .map(d => d.occupancy!.current);

  if (occupancyValues.length === 0) {
    console.log('📊 Dwell time: No occupancy data found');
    return null;
  }

  const avgOccupancy = occupancyValues.reduce((sum, val) => sum + val, 0) / occupancyValues.length;

  // Get entries - both hourly and raw data use cumulative counters
  const entryData = recentData.filter(d => d.occupancy?.entries !== undefined && d.occupancy.entries >= 0);
  
  if (entryData.length < 2) {
    console.log('📊 Dwell time: Not enough entry data');
    return null;
  }

  // Simple calculation: latest entries - earliest entries
  // Counter is cumulative all-time (never resets)
  const sortedEntryData = [...entryData].sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  
  const earliest = sortedEntryData[0];
  const latest = sortedEntryData[sortedEntryData.length - 1];
  const totalEntries = Math.max(0, latest.occupancy!.entries - earliest.occupancy!.entries);

  // Calculate actual time span
  const firstTime = new Date(recentData[0].timestamp).getTime();
  const lastTime = new Date(recentData[recentData.length - 1].timestamp).getTime();
  const actualHours = (lastTime - firstTime) / (1000 * 60 * 60);

  console.log(`📊 Dwell time debug:`, {
    dataPoints: recentData.length,
    avgOccupancy: avgOccupancy.toFixed(1),
    minEntries,
    maxEntries,
    totalEntries,
    actualHours: actualHours.toFixed(2)
  });

  // If no new entries in the period, estimate based on current occupancy
  if (totalEntries === 0 || actualHours < 0.1) {
    // Fallback: If people are in venue but no new entries recorded,
    // estimate based on typical bar dwell time (60-90 minutes)
    if (avgOccupancy > 0) {
      console.log('📊 Dwell time: Using fallback estimate (no entry changes)');
      return 75; // Default estimate for bars
    }
    return null;
  }

  // Little's Law: W = L / λ
  // λ = entries per hour
  const arrivalRate = totalEntries / actualHours;
  const dwellTimeHours = avgOccupancy / arrivalRate;
  const dwellTimeMinutes = dwellTimeHours * 60;

  console.log(`📊 Dwell time result: ${dwellTimeMinutes.toFixed(1)} minutes (rate=${arrivalRate.toFixed(2)}/hr)`);

  // Sanity check: dwell time should be between 5 minutes and 6 hours for a bar
  if (dwellTimeMinutes < 5) {
    return 5;
  }
  if (dwellTimeMinutes > 360) {
    return 360;
  }

  return Math.round(dwellTimeMinutes);
}

/**
 * Format dwell time for display
 * 
 * @param dwellTimeMinutes - Dwell time in minutes
 * @returns Formatted string (e.g., "1h 23m" or "45m")
 */
export function formatDwellTime(dwellTimeMinutes: number | null): string {
  if (dwellTimeMinutes === null) {
    return '--';
  }

  const hours = Math.floor(dwellTimeMinutes / 60);
  const minutes = Math.round(dwellTimeMinutes % 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

/**
 * Get dwell time category for display styling
 * 
 * @param dwellTimeMinutes - Dwell time in minutes
 * @param venueType - Type of venue (affects what's considered good)
 * @returns Category: 'excellent' | 'good' | 'fair' | 'poor'
 */
export function getDwellTimeCategory(
  dwellTimeMinutes: number | null,
  venueType: 'restaurant' | 'bar' | 'nightclub' | 'cafe' | 'other' = 'other'
): 'excellent' | 'good' | 'fair' | 'poor' {
  if (dwellTimeMinutes === null) {
    return 'poor';
  }

  // Different thresholds for different venue types
  const thresholds = {
    cafe: { excellent: 45, good: 30, fair: 20 },
    restaurant: { excellent: 90, good: 60, fair: 45 },
    bar: { excellent: 120, good: 75, fair: 45 },
    nightclub: { excellent: 180, good: 120, fair: 90 },
    other: { excellent: 90, good: 60, fair: 30 }
  };

  const t = thresholds[venueType];

  if (dwellTimeMinutes >= t.excellent) return 'excellent';
  if (dwellTimeMinutes >= t.good) return 'good';
  if (dwellTimeMinutes >= t.fair) return 'fair';
  return 'poor';
}

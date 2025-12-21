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

  // Sum total entries across all data points
  // Note: Each data point may have incremental entries, or we may need to use first/last
  const entryData = data.filter(d => d.occupancy?.entries !== undefined);
  
  if (entryData.length === 0) {
    return null;
  }

  // Use the difference between first and last entry counts
  const firstEntries = entryData[0].occupancy!.entries;
  const lastEntries = entryData[entryData.length - 1].occupancy!.entries;
  const totalEntries = Math.max(0, lastEntries - firstEntries);

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
 * Filters data to only include readings from the specified time window
 * and calculates using Little's Law
 * 
 * @param data - Array of sensor data points (should include recent history)
 * @param hoursBack - How many hours of recent data to use (default 2)
 * @returns Average dwell time in minutes, or null if cannot calculate
 */
export function calculateRecentDwellTime(
  data: SensorData[],
  hoursBack: number = 2
): number | null {
  if (!data || data.length === 0) {
    return null;
  }

  const now = new Date();
  const cutoffTime = new Date(now.getTime() - hoursBack * 60 * 60 * 1000);

  // Filter to only recent data
  const recentData = data.filter(d => {
    const timestamp = new Date(d.timestamp);
    return timestamp >= cutoffTime;
  });

  if (recentData.length < 2) {
    // Need at least 2 data points to calculate entry difference
    return null;
  }

  // Sort by timestamp (oldest first)
  const sorted = [...recentData].sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // Calculate average occupancy from recent data
  const occupancyValues = sorted
    .filter(d => d.occupancy?.current !== undefined && d.occupancy.current > 0)
    .map(d => d.occupancy!.current);

  if (occupancyValues.length === 0) {
    return null;
  }

  const avgOccupancy = occupancyValues.reduce((sum, val) => sum + val, 0) / occupancyValues.length;

  // Get entries difference in the time window
  const entryData = sorted.filter(d => d.occupancy?.entries !== undefined);
  
  if (entryData.length < 2) {
    return null;
  }

  const firstEntries = entryData[0].occupancy!.entries;
  const lastEntries = entryData[entryData.length - 1].occupancy!.entries;
  const totalEntries = Math.max(0, lastEntries - firstEntries);

  // Calculate actual time span (might be less than hoursBack if data is limited)
  const firstTime = new Date(sorted[0].timestamp).getTime();
  const lastTime = new Date(sorted[sorted.length - 1].timestamp).getTime();
  const actualHours = (lastTime - firstTime) / (1000 * 60 * 60);

  // Need a reasonable time span
  if (actualHours < 0.25 || totalEntries === 0) {
    return null;
  }

  console.log(`📊 Dwell time calc: avgOccupancy=${avgOccupancy.toFixed(1)}, entries=${totalEntries}, hours=${actualHours.toFixed(2)}`);

  return calculateDwellTime(avgOccupancy, totalEntries, actualHours);
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

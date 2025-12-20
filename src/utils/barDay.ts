/**
 * Bar Day Utilities
 * 
 * For bars/nightlife venues, a "day" runs from 3am to 3am
 * instead of midnight to midnight. This ensures customers
 * who enter at 11pm and leave at 1am are counted as the same day.
 */

const BAR_DAY_START_HOUR = 3; // 3am

/**
 * Get the start of the current "bar day" (3am) in the venue's timezone
 * 
 * If current time is before 3am, returns 3am yesterday
 * If current time is after 3am, returns 3am today
 * 
 * @param timezone - IANA timezone string (e.g., 'America/New_York')
 * @returns Date object representing the start of the current bar day in UTC
 */
export function getBarDayStart(timezone: string = 'America/New_York'): Date {
  const now = new Date();
  
  // Get current time in the venue's timezone
  const venueTime = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
  const venueHour = venueTime.getHours();
  
  // Determine if we're before or after 3am in venue time
  const isBeforeBarDayStart = venueHour < BAR_DAY_START_HOUR;
  
  // Calculate the bar day start date in venue timezone
  const barDayStart = new Date(venueTime);
  barDayStart.setHours(BAR_DAY_START_HOUR, 0, 0, 0);
  
  // If it's before 3am, the bar day started yesterday at 3am
  if (isBeforeBarDayStart) {
    barDayStart.setDate(barDayStart.getDate() - 1);
  }
  
  // Convert back to UTC for API queries
  // We need to find the UTC time that corresponds to 3am in the venue timezone
  const offsetMs = now.getTime() - venueTime.getTime();
  const barDayStartUTC = new Date(barDayStart.getTime() + offsetMs);
  
  return barDayStartUTC;
}

/**
 * Get bar day start as ISO string for GraphQL queries
 */
export function getBarDayStartISO(timezone: string = 'America/New_York'): string {
  return getBarDayStart(timezone).toISOString();
}

/**
 * Calculate total entries and exits from sensor data array
 * for the current bar day (3am to now)
 * 
 * @param data - Array of sensor data with occupancy info
 * @param timezone - Venue timezone
 * @returns Object with total entries and exits for the bar day
 */
export function calculateBarDayOccupancy(
  data: Array<{ timestamp: string; occupancy?: { entries: number; exits: number; current?: number } }>,
  timezone: string = 'America/New_York'
): { entries: number; exits: number; current: number } {
  const barDayStart = getBarDayStart(timezone);
  
  let totalEntries = 0;
  let totalExits = 0;
  let latestCurrent = 0;
  
  // Filter data to only include records from bar day start
  const barDayData = data.filter(item => {
    const itemTime = new Date(item.timestamp);
    return itemTime >= barDayStart;
  });
  
  // If we have data points, we need to determine if entries/exits are cumulative or incremental
  // Assuming they're cumulative (reset at some point), we take the latest values
  // If they're incremental, we'd sum them up
  
  // For now, let's assume the IoT device sends cumulative values that reset
  // So we take the max values we've seen (or latest if monotonically increasing)
  if (barDayData.length > 0) {
    // Sort by timestamp descending to get latest first
    const sorted = [...barDayData].sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    
    // Get the latest record's values
    const latest = sorted[0];
    if (latest.occupancy) {
      totalEntries = latest.occupancy.entries || 0;
      totalExits = latest.occupancy.exits || 0;
      latestCurrent = latest.occupancy.current || 0;
    }
  }
  
  return {
    entries: totalEntries,
    exits: totalExits,
    current: latestCurrent
  };
}

/**
 * Format bar day time range for display
 * e.g., "3:00 AM - Now" or "3:00 AM Yesterday - Now"
 */
export function formatBarDayRange(timezone: string = 'America/New_York'): string {
  const now = new Date();
  const venueTime = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
  const venueHour = venueTime.getHours();
  
  const isBeforeBarDayStart = venueHour < BAR_DAY_START_HOUR;
  
  if (isBeforeBarDayStart) {
    return '3:00 AM Yesterday - Now';
  }
  return '3:00 AM - Now';
}

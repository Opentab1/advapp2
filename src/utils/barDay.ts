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
 * Both hourly aggregated and raw data use CUMULATIVE counters for entries/exits.
 * We always use delta calculation: lastEntries - firstEntries
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
  
  // Filter data to only include records with occupancy data at or after bar day start
  const dataWithOccupancy = data.filter(item => 
    item.occupancy && new Date(item.timestamp) >= barDayStart
  );
  
  if (dataWithOccupancy.length === 0) {
    return { entries: 0, exits: 0, current: 0 };
  }
  
  // Sort by timestamp ascending (oldest first)
  const sorted = [...dataWithOccupancy].sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  
  // Get first and last readings
  const first = sorted[0];
  const latest = sorted[sorted.length - 1];
  const latestCurrent = latest.occupancy?.current || 0;
  
  // Sum all deltas to handle counter resets
  let barDayEntries = 0;
  let barDayExits = 0;
  
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    
    const prevEntries = prev.occupancy?.entries || 0;
    const currEntries = curr.occupancy?.entries || 0;
    const prevExits = prev.occupancy?.exits || 0;
    const currExits = curr.occupancy?.exits || 0;
    
    if (currEntries > prevEntries) {
      barDayEntries += (currEntries - prevEntries);
    } else if (currEntries < prevEntries) {
      barDayEntries += currEntries; // Counter reset
    }
    
    if (currExits > prevExits) {
      barDayExits += (currExits - prevExits);
    } else if (currExits < prevExits) {
      barDayExits += currExits; // Counter reset
    }
  }
  
  console.log('📊 Bar day calculation (delta method):', {
    barDayStart: barDayStart.toISOString(),
    firstReading: first.timestamp,
    latestReading: latest.timestamp,
    startEntries,
    latestEntries,
    barDayEntries,
    startExits,
    latestExits,
    barDayExits,
    currentOccupancy: latestCurrent
  });
  
  return {
    entries: barDayEntries,
    exits: barDayExits,
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

/**
 * Get all bar day boundaries within a date range
 * Each bar day runs from 3am to 3am the next day
 * 
 * @param startDate - Start of the range
 * @param endDate - End of the range
 * @param timezone - Venue timezone
 * @returns Array of bar day periods with start/end times
 */
export function getBarDayBoundaries(
  startDate: Date,
  endDate: Date,
  timezone: string = 'America/New_York'
): Array<{ start: Date; end: Date; label: string }> {
  const boundaries: Array<{ start: Date; end: Date; label: string }> = [];
  
  // Convert to venue timezone to work with local times
  const startVenue = new Date(startDate.toLocaleString('en-US', { timeZone: timezone }));
  const endVenue = new Date(endDate.toLocaleString('en-US', { timeZone: timezone }));
  
  // Find the first 3am on or before startDate
  let current = new Date(startVenue);
  current.setHours(BAR_DAY_START_HOUR, 0, 0, 0);
  if (startVenue.getHours() < BAR_DAY_START_HOUR) {
    current.setDate(current.getDate() - 1);
  }
  
  // Iterate through bar days
  while (current < endVenue) {
    const barDayStart = new Date(current);
    const barDayEnd = new Date(current);
    barDayEnd.setDate(barDayEnd.getDate() + 1);
    
    // Format label as "Mon Dec 18" (the date the bar day starts on)
    const label = barDayStart.toLocaleDateString('en-US', { 
      weekday: 'short', 
      month: 'short', 
      day: 'numeric',
      timeZone: timezone 
    });
    
    boundaries.push({
      start: barDayStart,
      end: barDayEnd,
      label
    });
    
    current = barDayEnd;
  }
  
  return boundaries;
}

/**
 * Aggregate occupancy data by bar day for a date range
 * Returns daily totals for entries/exits based on 3am-3am boundaries
 * 
 * Both hourly aggregated and raw data use CUMULATIVE counters.
 * For each bar day, we calculate: lastEntries - firstEntries
 * 
 * @param data - Array of sensor data with occupancy info
 * @param startDate - Start of the range
 * @param endDate - End of the range  
 * @param timezone - Venue timezone
 * @returns Object with total entries/exits and daily breakdown
 */
export function aggregateOccupancyByBarDay(
  data: Array<{ timestamp: string; occupancy?: { entries: number; exits: number; current?: number } }>,
  startDate: Date,
  endDate: Date,
  timezone: string = 'America/New_York'
): {
  totalEntries: number;
  totalExits: number;
  dailyBreakdown: Array<{ date: string; entries: number; exits: number }>;
} {
  const barDays = getBarDayBoundaries(startDate, endDate, timezone);
  const dailyBreakdown: Array<{ date: string; entries: number; exits: number }> = [];
  let totalEntries = 0;
  let totalExits = 0;
  
  // Filter data to only include records with occupancy
  const dataWithOccupancy = data.filter(item => item.occupancy);
  
  if (dataWithOccupancy.length === 0) {
    return { totalEntries: 0, totalExits: 0, dailyBreakdown: [] };
  }
  
  // Sort by timestamp ascending
  const sorted = [...dataWithOccupancy].sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  
  // Process each bar day
  for (const barDay of barDays) {
    // Get data points within this bar day
    const barDayData = sorted.filter(item => {
      const itemTime = new Date(item.timestamp);
      return itemTime >= barDay.start && itemTime < barDay.end;
    });
    
    if (barDayData.length === 0) {
      dailyBreakdown.push({ date: barDay.label, entries: 0, exits: 0 });
      continue;
    }
    
    // Sum all deltas to handle counter resets
    let dayEntries = 0;
    let dayExits = 0;
    
    for (let i = 1; i < barDayData.length; i++) {
      const prev = barDayData[i - 1];
      const curr = barDayData[i];
      
      const prevEntries = prev.occupancy?.entries || 0;
      const currEntries = curr.occupancy?.entries || 0;
      const prevExits = prev.occupancy?.exits || 0;
      const currExits = curr.occupancy?.exits || 0;
      
      if (currEntries > prevEntries) {
        dayEntries += (currEntries - prevEntries);
      } else if (currEntries < prevEntries) {
        dayEntries += currEntries; // Counter reset
      }
      
      if (currExits > prevExits) {
        dayExits += (currExits - prevExits);
      } else if (currExits < prevExits) {
        dayExits += currExits; // Counter reset
      }
    }
    
    dailyBreakdown.push({ 
      date: barDay.label, 
      entries: dayEntries, 
      exits: dayExits 
    });
    
    totalEntries += dayEntries;
    totalExits += dayExits;
  }
  
  console.log('📊 Bar day aggregation complete:', {
    period: `${startDate.toISOString()} to ${endDate.toISOString()}`,
    barDaysProcessed: barDays.length,
    totalEntries,
    totalExits,
    dailyBreakdown
  });
  
  return { totalEntries, totalExits, dailyBreakdown };
}

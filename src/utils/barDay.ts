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
 * Strategy: If the device sends cumulative values (since device start or midnight),
 * we calculate the DIFFERENCE between the first reading at 3am and the latest reading.
 * This gives us only the activity since 3am.
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
  
  // Filter data to only include records with occupancy data
  const dataWithOccupancy = data.filter(item => item.occupancy);
  
  if (dataWithOccupancy.length === 0) {
    return { entries: 0, exits: 0, current: 0 };
  }
  
  // Sort by timestamp ascending (oldest first)
  const sorted = [...dataWithOccupancy].sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  
  // Find the first reading at or after bar day start (3am)
  const firstAfterBarDayStart = sorted.find(item => 
    new Date(item.timestamp) >= barDayStart
  );
  
  // Get the latest reading (last in sorted array)
  const latest = sorted[sorted.length - 1];
  
  // Get the current occupancy from latest reading
  const latestCurrent = latest.occupancy?.current || 0;
  
  // If we have a reading from bar day start, calculate the difference
  // Otherwise, fall back to the latest values (device may have reset at 3am)
  if (firstAfterBarDayStart && firstAfterBarDayStart !== latest) {
    const startEntries = firstAfterBarDayStart.occupancy?.entries || 0;
    const startExits = firstAfterBarDayStart.occupancy?.exits || 0;
    const latestEntries = latest.occupancy?.entries || 0;
    const latestExits = latest.occupancy?.exits || 0;
    
    // Calculate difference (activity since bar day start)
    const barDayEntries = Math.max(0, latestEntries - startEntries);
    const barDayExits = Math.max(0, latestExits - startExits);
    
    console.log('📊 Bar day calculation (difference method):', {
      barDayStart: barDayStart.toISOString(),
      firstReading: firstAfterBarDayStart.timestamp,
      latestReading: latest.timestamp,
      startEntries,
      latestEntries,
      barDayEntries,
      startExits,
      latestExits,
      barDayExits
    });
    
    return {
      entries: barDayEntries,
      exits: barDayExits,
      current: latestCurrent
    };
  }
  
  // Fallback: If no reading from before bar day start, 
  // the device likely reset at 3am, so use latest values directly
  console.log('📊 Bar day calculation (direct method - device likely reset at 3am):', {
    barDayStart: barDayStart.toISOString(),
    latestReading: latest.timestamp,
    entries: latest.occupancy?.entries || 0,
    exits: latest.occupancy?.exits || 0
  });
  
  return {
    entries: latest.occupancy?.entries || 0,
    exits: latest.occupancy?.exits || 0,
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

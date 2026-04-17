import type { 
  SensorData, 
  HistoricalData, 
  TimeRange, 
  OccupancyMetrics, 
  Location, 
  WeeklyReport, 
  WeeklyMetrics, 
  ReportInsight,
  VenueOptimalRanges,
  PulseScoreResult 
} from '../types';
import type { GoogleReviewsData } from '../services/google-reviews.service';
import type { WeatherData } from '../services/weather.service';
import type { VenueScopeJob } from '../services/venuescope.service';

/**
 * Demo Account Configuration
 * The Showcase Lounge - A premium multi-level venue in Tampa's Hyde Park
 * Large capacity venue to show impressive numbers
 */
export const DEMO_VENUE = {
  venueId: 'theshowcaselounge',
  venueName: 'The Showcase Lounge',
  address: '1521 S Howard Ave, Tampa, FL 33606',
  timezone: 'America/New_York',
  capacity: 500, // Large venue - currently at 430/500 (86% capacity!)
};

/**
 * Check if this is the demo account
 */
export function isDemoAccount(venueId?: string): boolean {
  return venueId === 'theshowcaselounge';
}

/**
 * Generate demo Google Reviews data
 * High-volume venue: 4.7 stars with 2,340 reviews
 */
export function generateDemoGoogleReviews(): GoogleReviewsData {
  return {
    name: DEMO_VENUE.venueName,
    rating: 4.7,
    reviewCount: 2340,
    priceLevel: '$$',
    address: DEMO_VENUE.address,
    placeId: 'ChIJ_demo_showcase_lounge',
    url: 'https://www.google.com/maps/place/The+Showcase+Lounge',
    lastUpdated: new Date().toISOString(),
    recentReviews: [
      {
        rating: 5,
        text: 'THE place to be on weekends! Always packed but the energy is unmatched. VIP bottle service is worth it.',
        author: 'Sarah M.',
        date: '2 days ago',
      },
      {
        rating: 5,
        text: 'Best nightlife spot in Tampa hands down. Three floors, great DJs, and the rooftop views are incredible.',
        author: 'Mike R.',
        date: '4 days ago',
      },
      {
        rating: 5,
        text: 'Celebrated my birthday here - they went above and beyond! Definitely the hottest spot in SoHo.',
        author: 'Jennifer K.',
        date: '1 week ago',
      },
      {
        rating: 4,
        text: 'Great venue, can get very crowded after 11pm. Get there early or get bottle service. Music is always on point.',
        author: 'David L.',
        date: '1 week ago',
      },
    ],
  };
}

/**
 * Generate demo Weather data
 * Tampa, FL weather patterns - matches WeatherData interface
 */
export function generateDemoWeather(): WeatherData {
  const hour = new Date().getHours();
  const isDay = hour >= 6 && hour < 20;
  
  // Tampa weather - warm and sometimes humid
  const baseTemp = isDay ? 78 : 72;
  const tempVariation = Math.random() * 4 - 2;
  const temp = Math.round(baseTemp + tempVariation);
  
  // Random weather conditions weighted toward good weather (Tampa)
  const roll = Math.random();
  let conditions: string;
  let icon: string;
  
  if (roll > 0.85) {
    conditions = 'Partly Cloudy';
    icon = '⛅';
  } else if (roll > 0.95) {
    conditions = 'Light Rain';
    icon = '🌧️';
  } else {
    conditions = isDay ? 'Clear' : 'Clear';
    icon = isDay ? '☀️' : '🌙';
  }
  
  return {
    temperature: temp,
    feelsLike: temp + 2, // Feels warmer in Tampa humidity
    humidity: Math.round(55 + Math.random() * 20),
    conditions,
    icon,
    windSpeed: Math.round(5 + Math.random() * 8),
    isDay,
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Demo account target: 430 people in venue
 * This creates a busy, successful bar impression
 */
const DEMO_TARGET_OCCUPANCY = 430;
const DEMO_CAPACITY = 500; // Upgraded capacity for a larger venue

/**
 * Cumulative counters for realistic occupancy simulation
 * For demo: Always shows ~430 people with realistic entry/exit numbers
 */
let cumulativeEntries = 0;
let cumulativeExits = 0;
let lastResetDate: string | null = null;
let demoInitialized = false;

function resetCountersIfNewDay() {
  const now = new Date();
  const today = now.toDateString();
  const hour = now.getHours();
  
  // For demo account: Initialize to show 430 current occupancy
  if (!demoInitialized || (hour >= 3 && lastResetDate !== today)) {
    // Calculate entries/exits to result in ~430 current
    // Realistic: ~850 total entries today, ~420 exits = 430 inside
    const hoursSinceOpen = Math.max(1, hour >= 16 ? hour - 16 : (hour < 3 ? hour + 8 : 1));
    const baseEntries = 650 + (hoursSinceOpen * 45); // ~850-1000+ by late evening
    const variation = Math.floor(Math.random() * 50);
    
    cumulativeEntries = baseEntries + variation;
    cumulativeExits = cumulativeEntries - DEMO_TARGET_OCCUPANCY - Math.floor(Math.random() * 20 - 10);
    
    lastResetDate = today;
    demoInitialized = true;
  }
}

/**
 * Generate realistic sensor data for a given timestamp
 * Patterns based on real bar data from jimmyneutron venue
 */
function generateSensorData(timestamp: Date): SensorData {
  resetCountersIfNewDay();
  
  const hour = timestamp.getHours();
  const minute = timestamp.getMinutes();
  const dayOfWeek = timestamp.getDay();
  
  // Time periods for a cocktail lounge
  const isClosedHours = hour >= 2 && hour < 16; // Closed 2am-4pm
  const isHappyHour = hour >= 16 && hour < 19; // 4pm-7pm
  const isPrimeTime = hour >= 19 && hour < 23; // 7pm-11pm (peak)
  const isLateNight = hour >= 23 || hour < 2; // 11pm-2am
  const isWeekend = dayOfWeek === 5 || dayOfWeek === 6;
  const isThursday = dayOfWeek === 4;
  
  // ============ SOUND LEVELS ============
  // Sound levels for a packed venue with 430 people
  let baseDecibels: number;
  if (isClosedHours) {
    baseDecibels = 42 + Math.random() * 5; // Ambient noise only
  } else if (isHappyHour) {
    baseDecibels = 74 + Math.random() * 5; // Building crowd noise
  } else if (isPrimeTime) {
    baseDecibels = 82 + Math.random() * 6; // Packed house - energetic!
    if (isWeekend) baseDecibels += 3; // Even louder on weekends
  } else if (isLateNight) {
    baseDecibels = 85 + Math.random() * 5; // Peak late night energy
  } else {
    baseDecibels = 72 + Math.random() * 5;
  }
  
  // ============ LIGHTING ============
  // Cocktail lounges dim lights as evening progresses
  let baseLight: number;
  if (isClosedHours) {
    baseLight = 50 + Math.random() * 30; // Security lights only
  } else if (isHappyHour) {
    baseLight = 280 + Math.random() * 40; // Still bright, transitioning
  } else if (isPrimeTime) {
    baseLight = 150 + Math.random() * 50; // Dim, intimate
  } else if (isLateNight) {
    baseLight = 120 + Math.random() * 40; // Very dim, club-like
  } else {
    baseLight = 200 + Math.random() * 50;
  }
  
  // ============ TEMPERATURE ============
  // Indoor temp controlled, outdoor varies
  const baseIndoorTemp = 71 + Math.random() * 2; // Well-controlled HVAC
  if (isPrimeTime && isWeekend) {
    // Slightly warmer when crowded
  }
  const baseOutdoorTemp = 75 + Math.random() * 8 - 4; // Tampa evening weather
  
  // ============ HUMIDITY ============
  const baseHumidity = 48 + Math.random() * 12;
  
  // ============ OCCUPANCY ============
  // Demo account: Always show ~430 people with small fluctuations
  // Add small random changes to make it feel live
  const occupancyFluctuation = Math.floor(Math.random() * 20 - 10); // ±10
  
  // Slowly increment entries/exits to show activity
  if (!isClosedHours) {
    cumulativeEntries += Math.floor(2 + Math.random() * 4); // 2-6 new entries
    cumulativeExits += Math.floor(1 + Math.random() * 3); // 1-4 exits
  }
  
  // Always target ~430 current occupancy
  const currentOccupancy = Math.max(400, Math.min(460, DEMO_TARGET_OCCUPANCY + occupancyFluctuation));
  
  // Get song info
  const songInfo = getRandomSongInfo(hour);
  
  return {
    timestamp: timestamp.toISOString(),
    decibels: Math.round(baseDecibels * 10) / 10,
    light: Math.round(baseLight * 10) / 10,
    indoorTemp: Math.round(baseIndoorTemp * 10) / 10,
    outdoorTemp: Math.round(baseOutdoorTemp * 10) / 10,
    humidity: Math.round(baseHumidity * 10) / 10,
    currentSong: songInfo.song,
    artist: songInfo.artist,
    albumArt: songInfo.art,
    occupancy: {
      current: currentOccupancy,
      entries: cumulativeEntries,
      exits: cumulativeExits,
      capacity: DEMO_CAPACITY
    }
  };
}

/**
 * Curated song playlists for upscale cocktail lounge
 * Time-appropriate music for different parts of the evening
 */
const SONGS = {
  // Happy hour - chill, upbeat, conversational
  happyHour: [
    { song: "Superstition", artist: "Stevie Wonder", art: "https://i.scdn.co/image/ab67616d0000b273b0b60615b97e364e22a21d5f" },
    { song: "Lovely Day", artist: "Bill Withers", art: "https://i.scdn.co/image/ab67616d0000b273bd5ec58e02e60ccb7d0c971a" },
    { song: "Kiss", artist: "Prince", art: "https://i.scdn.co/image/ab67616d0000b273e319baafd16e84f0408af2a0" },
    { song: "Got To Give It Up", artist: "Marvin Gaye", art: "https://i.scdn.co/image/ab67616d0000b273dc30583ba717007b00cceb25" },
    { song: "Le Freak", artist: "Chic", art: "https://i.scdn.co/image/ab67616d0000b273fea0200445a1e05389e167b5" },
    { song: "September", artist: "Earth, Wind & Fire", art: "https://i.scdn.co/image/ab67616d0000b273b265a4c0c0085c0b047ac7dc" },
    { song: "I Wanna Dance with Somebody", artist: "Whitney Houston", art: "https://i.scdn.co/image/ab67616d0000b2731e0c142f42a0e97d8a643a78" },
    { song: "Valerie", artist: "Amy Winehouse", art: "https://i.scdn.co/image/ab67616d0000b273ccdddd46119a4ff53eaf1f5d" },
  ],
  // Prime time - energetic, crowd-pleasers
  primeTime: [
    { song: "Uptown Funk", artist: "Bruno Mars", art: "https://i.scdn.co/image/ab67616d0000b2739e2f95ae77cf436017ada9cb" },
    { song: "Blinding Lights", artist: "The Weeknd", art: "https://i.scdn.co/image/ab67616d0000b2738863bc11d2aa12b54f5aeb36" },
    { song: "Levitating", artist: "Dua Lipa", art: "https://i.scdn.co/image/ab67616d0000b273be841ba4bc24340152e3a79a" },
    { song: "Mr. Brightside", artist: "The Killers", art: "https://i.scdn.co/image/ab67616d0000b273ccdddd46119a4ff53eaf1f5d" },
    { song: "Shut Up and Dance", artist: "Walk the Moon", art: "https://i.scdn.co/image/ab67616d0000b2731e0c142f42a0e97d8a643a78" },
    { song: "Don't Start Now", artist: "Dua Lipa", art: "https://i.scdn.co/image/ab67616d0000b273232711f7d66a48bf9984e61f" },
    { song: "Physical", artist: "Dua Lipa", art: "https://i.scdn.co/image/ab67616d0000b273be841ba4bc24340152e3a79a" },
    { song: "Save Your Tears", artist: "The Weeknd", art: "https://i.scdn.co/image/ab67616d0000b2738863bc11d2aa12b54f5aeb36" },
    { song: "Heat Waves", artist: "Glass Animals", art: "https://i.scdn.co/image/ab67616d0000b273ed317ec3fc4e18a0d5822a1e" },
    { song: "As It Was", artist: "Harry Styles", art: "https://i.scdn.co/image/ab67616d0000b27395be3a346177524b62a6827f" },
  ],
  // Late night - classics, singalongs
  lateNight: [
    { song: "Don't Stop Believin'", artist: "Journey", art: "https://i.scdn.co/image/ab67616d0000b2731fe09a8e8e7f6f1ab67616d0" },
    { song: "Livin' on a Prayer", artist: "Bon Jovi", art: "https://i.scdn.co/image/ab67616d0000b27395be3a346177524b62a6827f" },
    { song: "Sweet Caroline", artist: "Neil Diamond", art: "https://i.scdn.co/image/ab67616d0000b273e319baafd16e84f0408af2a0" },
    { song: "Bohemian Rhapsody", artist: "Queen", art: "https://i.scdn.co/image/ab67616d0000b273ce4f1737bc8a646c8c4bd25a" },
    { song: "Don't Stop Me Now", artist: "Queen", art: "https://i.scdn.co/image/ab67616d0000b273ce4f1737bc8a646c8c4bd25a" },
    { song: "Piano Man", artist: "Billy Joel", art: "https://i.scdn.co/image/ab67616d0000b27321ebf49b3292c3f0f575f0f5" },
    { song: "Wonderwall", artist: "Oasis", art: "https://i.scdn.co/image/ab67616d0000b273b0b60615b97e364e22a21d5f" },
    { song: "Come On Eileen", artist: "Dexys Midnight Runners", art: "https://i.scdn.co/image/ab67616d0000b273dc30583ba717007b00cceb25" },
  ],
  // Closed - no music
  // Even during closed hours, demo shows ambient music (for demo purposes)
  closed: [
    { song: "Chill Vibes Mix", artist: "House DJ", art: "https://i.scdn.co/image/ab67616d0000b273c5716278abba6a103ad13aa7" },
    { song: "Smooth Jazz Session", artist: "Late Night Collective", art: "https://i.scdn.co/image/ab67616d0000b273f6b55ca93bd33211227b502b" },
    { song: "Lo-Fi Beats", artist: "Chillhop Music", art: "https://i.scdn.co/image/ab67616d0000b2738a3f0a3ca7929dea23cd274c" },
  ]
};

/**
 * Get song info appropriate for the time of day
 */
function getRandomSongInfo(hour: number): { song: string | null; artist: string | null; art: string | null } {
  const isClosedHours = hour >= 2 && hour < 16;
  const isHappyHour = hour >= 16 && hour < 19;
  const isPrimeTime = hour >= 19 && hour < 23;
  
  let playlist = isClosedHours ? SONGS.closed :
                 isHappyHour ? SONGS.happyHour :
                 isPrimeTime ? SONGS.primeTime : SONGS.lateNight;
  
  return playlist[Math.floor(Math.random() * playlist.length)];
}

// Legacy functions for backward compatibility
function getRandomSong(hour: number): string {
  return getRandomSongInfo(hour).song || '';
}

function getRandomArtist(hour: number): string {
  return getRandomSongInfo(hour).artist || '';
}

function getRandomAlbumArt(hour: number): string {
  return getRandomSongInfo(hour).art || '';
}

/**
 * Generate live sensor data (current time)
 */
export function generateDemoLiveData(): SensorData {
  return generateSensorData(new Date());
}

/**
 * Generate demo sensor data for a date range
 * Used for dwell time calculation - needs data points throughout the day
 * Uses its own cumulative counters to ensure consistent progression
 */
export function generateDemoDateRangeData(startTime: Date, endTime: Date): SensorData[] {
  const data: SensorData[] = [];
  const start = startTime.getTime();
  const end = endTime.getTime();
  
  // Generate data points every 15 minutes
  const interval = 15 * 60 * 1000; // 15 minutes
  
  // Initialize counters for this range
  let rangeEntries = 650; // Starting baseline
  let rangeExits = 220;   // Starting baseline
  
  for (let timestamp = start; timestamp <= end; timestamp += interval) {
    const date = new Date(timestamp);
    const hour = date.getHours();
    const dayOfWeek = date.getDay();
    
    // Time periods
    const isClosedHours = hour >= 2 && hour < 16;
    const isHappyHour = hour >= 16 && hour < 19;
    const isPrimeTime = hour >= 19 && hour < 23;
    const isLateNight = hour >= 23 || hour < 2;
    const isWeekend = dayOfWeek === 5 || dayOfWeek === 6;
    
    // Increment counters during open hours
    if (!isClosedHours) {
      // Higher activity during prime time
      if (isPrimeTime) {
        rangeEntries += Math.floor(4 + Math.random() * 6); // 4-10 entries
        rangeExits += Math.floor(2 + Math.random() * 4);   // 2-6 exits
      } else if (isLateNight) {
        rangeEntries += Math.floor(2 + Math.random() * 4); // 2-6 entries
        rangeExits += Math.floor(3 + Math.random() * 5);   // 3-8 exits (people leaving)
      } else if (isHappyHour) {
        rangeEntries += Math.floor(5 + Math.random() * 7); // 5-12 entries
        rangeExits += Math.floor(1 + Math.random() * 2);   // 1-3 exits
      }
      if (isWeekend) {
        rangeEntries += Math.floor(Math.random() * 3); // Extra weekend traffic
      }
    }
    
    // Calculate current occupancy (with realistic fluctuation)
    const baseOccupancy = Math.max(0, rangeEntries - rangeExits);
    const currentOccupancy = Math.min(480, Math.max(380, 430 + Math.floor(Math.random() * 40 - 20)));
    
    // Generate sound/light based on time
    let decibels: number, light: number;
    if (isClosedHours) {
      decibels = 42 + Math.random() * 5;
      light = 50 + Math.random() * 30;
    } else if (isHappyHour) {
      decibels = 74 + Math.random() * 5;
      light = 280 + Math.random() * 40;
    } else if (isPrimeTime) {
      decibels = 82 + Math.random() * 6 + (isWeekend ? 3 : 0);
      light = 150 + Math.random() * 50;
    } else {
      decibels = 85 + Math.random() * 5;
      light = 120 + Math.random() * 40;
    }
    
    const songInfo = getRandomSongInfo(hour);
    
    data.push({
      timestamp: date.toISOString(),
      decibels: Math.round(decibels * 10) / 10,
      light: Math.round(light * 10) / 10,
      indoorTemp: Math.round((71 + Math.random() * 2) * 10) / 10,
      outdoorTemp: Math.round((75 + Math.random() * 8 - 4) * 10) / 10,
      humidity: Math.round((48 + Math.random() * 12) * 10) / 10,
      currentSong: songInfo.song,
      artist: songInfo.artist,
      albumArt: songInfo.art,
      occupancy: {
        current: currentOccupancy,
        entries: rangeEntries,
        exits: rangeExits,
        capacity: DEMO_CAPACITY
      }
    });
  }
  
  console.log(`🎭 Demo: Generated ${data.length} data points for dwell time (${rangeEntries} entries, ${rangeExits} exits)`);
  return data;
}

/**
 * Generate historical data for a time range
 * IMPRESSIVE DEMO DATA - Shows a thriving, busy venue
 */
export function generateDemoHistoricalData(venueId: string, range: TimeRange): HistoricalData {
  const now = Date.now();
  const data: SensorData[] = [];
  
  // Calculate time range - use tighter intervals for more data points
  let startTime: number;
  let interval: number; // milliseconds between data points
  
  switch (range) {
    case 'live':
      startTime = now - (5 * 60 * 1000); // Last 5 minutes
      interval = 15 * 1000; // 15 seconds
      break;
    case '6h':
      startTime = now - (6 * 60 * 60 * 1000);
      interval = 5 * 60 * 1000; // 5 minutes
      break;
    case '24h':
      startTime = now - (24 * 60 * 60 * 1000);
      interval = 10 * 60 * 1000; // 10 minutes (more data points)
      break;
    case '7d':
      startTime = now - (7 * 24 * 60 * 60 * 1000);
      interval = 30 * 60 * 1000; // 30 minutes (more data points)
      break;
    case '14d':
      startTime = now - (14 * 24 * 60 * 60 * 1000);
      interval = 60 * 60 * 1000; // 1 hour
      break;
    case '30d':
      startTime = now - (30 * 24 * 60 * 60 * 1000);
      interval = 2 * 60 * 60 * 1000; // 2 hours
      break;
    case '90d':
      startTime = now - (90 * 24 * 60 * 60 * 1000);
      interval = 4 * 60 * 60 * 1000; // 4 hours
      break;
    default:
      startTime = now - (24 * 60 * 60 * 1000);
      interval = 10 * 60 * 1000;
  }
  
  // Generate data points with proper cumulative entries/exits
  // This ensures avg stay calculation works correctly
  let cumulativeEntriesHist = 0;
  let cumulativeExitsHist = 0;
  let lastDayOfYear = -1;
  
  // Use seeded random for consistent demo data
  let seed = 12345;
  const seededRandom = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  
  for (let timestamp = startTime; timestamp <= now; timestamp += interval) {
    const date = new Date(timestamp);
    const hour = date.getHours();
    const dayOfWeek = date.getDay();
    const dayOfYear = Math.floor((timestamp - new Date(date.getFullYear(), 0, 0).getTime()) / (1000 * 60 * 60 * 24));
    
    // Reset counters at 3am each day (bar day boundary)
    if (dayOfYear !== lastDayOfYear && hour >= 3) {
      cumulativeEntriesHist = 0;
      cumulativeExitsHist = 0;
      lastDayOfYear = dayOfYear;
    }
    
    // Time periods
    const isClosedHours = hour >= 3 && hour < 16;
    const isHappyHour = hour >= 16 && hour < 19;
    const isPrimeTime = hour >= 19 && hour < 23;
    const isLateNight = hour >= 23 || hour < 3;
    const isWeekend = dayOfWeek === 5 || dayOfWeek === 6;
    const isThursday = dayOfWeek === 4;
    
    // IMPRESSIVE GUEST COUNTS - busy venue!
    if (!isClosedHours) {
      let newEntries = 0;
      let newExits = 0;
      
      if (isPrimeTime) {
        // Peak hours: 40-70 entries per hour, building to capacity
        newEntries = 40 + Math.floor(seededRandom() * 30);
        newExits = 15 + Math.floor(seededRandom() * 15);
      } else if (isLateNight) {
        // Late night: still busy, gradual exit
        newEntries = 20 + Math.floor(seededRandom() * 20);
        newExits = 30 + Math.floor(seededRandom() * 20);
      } else if (isHappyHour) {
        // Happy hour: rapid build-up
        newEntries = 50 + Math.floor(seededRandom() * 30);
        newExits = 10 + Math.floor(seededRandom() * 10);
      }
      
      // Weekend multiplier - even busier!
      if (isWeekend) {
        newEntries = Math.floor(newEntries * 1.4);
      } else if (isThursday) {
        newEntries = Math.floor(newEntries * 1.2); // College night
      }
      
      // Scale entries based on interval (if interval is 30 min, halve the hourly rate)
      const intervalHours = interval / (60 * 60 * 1000);
      newEntries = Math.floor(newEntries * intervalHours);
      newExits = Math.floor(newExits * intervalHours);
      
      cumulativeEntriesHist += newEntries;
      cumulativeExitsHist += newExits;
    }
    
    // Calculate current occupancy - target high numbers
    let currentOcc = Math.max(0, cumulativeEntriesHist - cumulativeExitsHist);
    
    // During open hours, ensure minimum crowd for active venue appearance
    if (!isClosedHours) {
      if (isPrimeTime) {
        currentOcc = Math.max(currentOcc, 320 + Math.floor(seededRandom() * 80)); // 320-400 during prime
      } else if (isLateNight) {
        currentOcc = Math.max(currentOcc, 200 + Math.floor(seededRandom() * 100)); // 200-300 late night
      } else if (isHappyHour) {
        currentOcc = Math.max(currentOcc, 150 + Math.floor(seededRandom() * 80)); // 150-230 happy hour
      }
      if (isWeekend && isPrimeTime) {
        currentOcc = Math.min(480, currentOcc + 50); // Even more on weekends
      }
    }
    currentOcc = Math.min(480, currentOcc);
    
    // Generate sound/light based on time and crowd size
    let decibels: number, light: number;
    if (isClosedHours) {
      decibels = 42 + seededRandom() * 5;
      light = 50 + seededRandom() * 30;
    } else if (isHappyHour) {
      decibels = 74 + seededRandom() * 6;
      light = 280 + seededRandom() * 40;
    } else if (isPrimeTime) {
      // Prime time: energetic sound levels
      decibels = 80 + seededRandom() * 8 + (isWeekend ? 4 : 0);
      light = 140 + seededRandom() * 50;
    } else if (isLateNight) {
      // Late night: loud and club-like
      decibels = 82 + seededRandom() * 6;
      light = 100 + seededRandom() * 40;
    } else {
      decibels = 76 + seededRandom() * 5;
      light = 180 + seededRandom() * 40;
    }
    
    const songInfo = getRandomSongInfo(hour);
    
    data.push({
      timestamp: date.toISOString(),
      decibels: Math.round(decibels * 10) / 10,
      light: Math.round(light * 10) / 10,
      indoorTemp: Math.round((70 + seededRandom() * 3) * 10) / 10,
      outdoorTemp: Math.round((74 + seededRandom() * 10 - 5) * 10) / 10,
      humidity: Math.round((45 + seededRandom() * 15) * 10) / 10,
      currentSong: songInfo.song,
      artist: songInfo.artist,
      albumArt: songInfo.art,
      occupancy: {
        current: isClosedHours ? 0 : currentOcc,
        entries: cumulativeEntriesHist,
        exits: cumulativeExitsHist,
        capacity: DEMO_CAPACITY
      }
    });
  }
  
  console.log(`🎭 Demo: Generated ${data.length} historical data points for ${range}`);
  
  return {
    data,
    venueId,
    range
  };
}

/**
 * Generate demo occupancy metrics
 * Target: 430 people currently in venue - IMPRESSIVE NUMBERS!
 */
export function generateDemoOccupancyMetrics(): OccupancyMetrics {
  const hour = new Date().getHours();
  const dayOfWeek = new Date().getDay();
  const isClosedHours = hour >= 3 && hour < 16;
  const isWeekend = dayOfWeek === 5 || dayOfWeek === 6;
  const isPrimeTime = hour >= 19 && hour < 23;
  
  // Dynamic current occupancy based on time
  let current = 0;
  if (!isClosedHours) {
    if (isPrimeTime) {
      current = 380 + Math.floor(Math.random() * 60); // 380-440 during prime
    } else if (hour >= 23 || hour < 3) {
      current = 280 + Math.floor(Math.random() * 80); // 280-360 late night
    } else if (hour >= 16 && hour < 19) {
      current = 180 + Math.floor(Math.random() * 60); // 180-240 happy hour
    }
    if (isWeekend) current = Math.min(475, current + 40); // Boost on weekends
  }
  
  // Impressive daily numbers
  const todayEntries = 1150 + Math.floor(Math.random() * 100); // 1150-1250 entries today!
  const todayExits = todayEntries - current;
  
  // Great dwell time - people stay and spend
  const avgDwellTimeMinutes = 95 + Math.floor(Math.random() * 25); // 95-120 min avg
  
  return {
    current,
    todayEntries,
    todayExits,
    todayTotal: todayEntries,
    peakOccupancy: 462, // Peak tonight
    peakTime: '22:45',
    sevenDayAvg: 412,     // Strong 7-day average
    fourteenDayAvg: 398,  // Consistent performance
    thirtyDayAvg: 385,    // Growing trend
    avgDwellTimeMinutes
  };
}

/**
 * Generate demo locations
 */
export function generateDemoLocations(): Location[] {
  return [
    {
      id: 'mainfloor',
      name: 'Main Floor',
      address: '456 Bay Street, Tampa, FL 33602',
      timezone: 'America/New_York',
      deviceId: 'rpi-theshowcaselounge-001'
    },
    {
      id: 'rooftop',
      name: 'Rooftop Lounge',
      address: '456 Bay Street, Tampa, FL 33602',
      timezone: 'America/New_York',
      deviceId: 'rpi-theshowcaselounge-002'
    }
  ];
}

/**
 * Generate demo weekly metrics for AI reports
 * IMPRESSIVE NUMBERS - thriving high-volume venue
 */
export function generateDemoWeeklyMetrics(): WeeklyMetrics {
  return {
    avgComfort: 82.5,           // Excellent comfort
    avgTemperature: 70.8,       // Perfect temp
    avgDecibels: 79.4,          // Energetic but not overwhelming
    avgHumidity: 48.5,          // Comfortable humidity
    peakHours: ['9-10 PM', '10-11 PM', '11-12 AM'],
    totalCustomers: 8245,       // ~1178/night average - packed!
    totalRevenue: 42800,        // ~$38.50/person average — realistic for a busy nightclub
    topSongs: [
      { song: 'Last Night', plays: 127 },
      { song: 'Blinding Lights', plays: 118 },
      { song: 'Uptown Funk', plays: 112 },
      { song: 'Mr. Brightside', plays: 105 },
      { song: 'Anti-Hero', plays: 94 }
    ]
  };
}

/**
 * Generate demo weekly report with realistic AI insights
 */
export function generateDemoWeeklyReport(weekStart: Date, weekEnd: Date): WeeklyReport {
  const metrics = generateDemoWeeklyMetrics();
  
  const insights: ReportInsight[] = [
    {
      category: 'Comfort',
      title: 'Overall Comfort Level',
      description: 'Average comfort score of 78.5 indicates good environmental conditions with room for optimization during peak hours.',
      trend: 'up',
      value: '78.5'
    },
    {
      category: 'Temperature',
      title: 'Temperature Management',
      description: 'Average temperature of 71.2°F maintained throughout the week, providing optimal comfort for most guests.',
      trend: 'stable',
      value: '71.2°F'
    },
    {
      category: 'Atmosphere',
      title: 'Sound Environment',
      description: 'Average sound level of 73.8 dB creates an energetic atmosphere perfect for social dining and entertainment.',
      trend: 'stable',
      value: '73.8 dB'
    },
    {
      category: 'Revenue',
      title: 'Sales Performance',
      description: 'Generated $42,800 in revenue with an average of $38.50 per customer. VenueScope flagged an estimated $48 in unrung drinks by Jordan on Saturday — recommend POS audit.',
      trend: 'up',
      value: '$42,800'
    },
    {
      category: 'Entertainment',
      title: 'Popular Music',
      description: '"Uptown Funk" was the most played track with 42 plays, resonating well with your guests.',
      trend: 'up',
      value: '42 plays'
    }
  ];

  const recommendations = [
    'Excellent comfort levels maintained! Continue current environmental management practices.',
    'Temperature levels are optimal. Maintain current HVAC settings.',
    'Sound levels create an energetic atmosphere. Current audio settings are effective.',
    'Optimize staffing for peak hours: 6-7 PM, 8-9 PM, 9-10 PM. Consider special promotions during slower periods.',
    'Strong per-customer spend! Continue promoting high-value items and excellent service.',
    'Top songs (Uptown Funk, Mr. Brightside, Don\'t Stop Believin\') resonate well. Create similar playlists for consistent atmosphere.'
  ];

  const summary = `This week showed good environmental conditions with an average comfort score of 78.5. Total revenue reached $42,800 across 1,112 customers (avg $38.50/head), with peak activity during 9-10 PM and 10-11 PM. Bartender ranking: Marcus (#1, 91 drinks, clean record), Priya (#2, 67 drinks, clean record), Jordan (flagged — 4 drinks served 11:18–11:31 PM with no POS ring, est. loss $48). Recommend POS audit for Saturday night shift.`;

  return {
    id: `report-demo-${Date.now()}`,
    weekStart: weekStart.toISOString(),
    weekEnd: weekEnd.toISOString(),
    generatedAt: new Date().toISOString(),
    summary,
    insights,
    metrics,
    recommendations
  };
}

/**
 * Generate demo monthly performance report
 */
export function generateDemoMonthlyReport(weekStart: Date, weekEnd: Date): WeeklyReport {
  const metrics = generateDemoWeeklyMetrics();
  // Scale up for monthly (30 days vs 7 days) — keep revenue realistic
  metrics.totalCustomers = Math.floor(metrics.totalCustomers * (30 / 7));  // ~35,335 → realistic: 4,779
  metrics.totalRevenue = 184000; // Fixed realistic monthly figure
  
  const insights: ReportInsight[] = [
    {
      category: 'Performance',
      title: 'Monthly Overview',
      description: `This month delivered $184,000 in total revenue across 4,779 customers (avg $38.50/head), representing a 9% increase over last month.`,
      trend: 'up',
      value: '$184K'
    },
    {
      category: 'Growth',
      title: 'Customer Traffic',
      description: 'Daily average of 159 customers with peak weekends reaching 280+ guests. Friday and Saturday account for 58% of monthly revenue.',
      trend: 'up',
      value: '4,779'
    },
    {
      category: 'Revenue',
      title: 'Sales Trends',
      description: 'Average spend per customer: $38.50, with strongest performance on Saturday nights. VenueScope identified $48 in potential theft from unrung drinks — see bartender audit below.',
      trend: 'stable',
      value: '$38.50'
    },
    {
      category: 'Bartender Audit',
      title: 'Theft Alert — Jordan',
      description: 'Jordan served 4 drinks between 11:18 PM – 11:31 PM Saturday with no POS ring. Estimated loss: $48. Marcus and Priya both have clean records this month.',
      trend: 'down',
      value: '-$48'
    }
  ];

  return {
    id: `report-monthly-${Date.now()}`,
    weekStart: weekStart.toISOString(),
    weekEnd: weekEnd.toISOString(),
    generatedAt: new Date().toISOString(),
    summary: 'Monthly revenue of $184,000 (avg $38.50/customer) was up 9% month-over-month. Bartender performance: Marcus led with 91 drinks/shift and a clean POS record; Priya was close behind with 67 drinks/shift, also clean. Jordan was flagged for 4 unrung drinks on Saturday night (11:18–11:31 PM, est. $48 loss). Recommend a POS audit for Jordan\'s Saturday shifts.',
    insights,
    metrics,
    recommendations: [
      'Schedule a POS audit review with Jordan for Saturday\'s shift — 4 drinks unrung, $48 estimated loss.',
      'Capitalize on weekend success by introducing premium bottle service packages on Fridays and Saturdays.',
      'Consider extending happy hour on Wednesdays to boost mid-week traffic.',
      'Launch a loyalty program to convert first-time weekend visitors into regulars.',
      'Optimize staffing for identified peak hours: 9–11 PM on weekends (highest volume window).'
    ]
  };
}

/**
 * Generate demo music analytics report
 */
export function generateDemoMusicReport(weekStart: Date, weekEnd: Date): WeeklyReport {
  const metrics = generateDemoWeeklyMetrics();
  
  const insights: ReportInsight[] = [
    {
      category: 'Top Tracks',
      title: 'Most Popular Songs',
      description: '"Uptown Funk" dominated with 42 plays, followed closely by "Mr. Brightside" (38 plays) and "Don\'t Stop Believin\'" (35 plays).',
      trend: 'up',
      value: '42 plays'
    },
    {
      category: 'Genre Mix',
      title: 'Music Diversity',
      description: 'Classic rock (35%), Pop (40%), and R&B (25%) created an energetic yet balanced atmosphere.',
      trend: 'stable',
      value: '3 genres'
    },
    {
      category: 'Peak Response',
      title: 'Guest Engagement',
      description: 'Upbeat tempo tracks during 8-10 PM correlated with 18% higher bar sales and increased dwell time.',
      trend: 'up',
      value: '+18%'
    }
  ];

  return {
    id: `report-music-${Date.now()}`,
    weekStart: weekStart.toISOString(),
    weekEnd: weekEnd.toISOString(),
    generatedAt: new Date().toISOString(),
    summary: 'Music selection successfully created an energetic atmosphere with strong guest engagement. Upbeat classics during peak hours (8-10 PM) showed the highest correlation with bar sales and extended guest stays.',
    insights,
    metrics,
    recommendations: [
      'Increase rotation of high-energy classics during 8-10 PM peak hours.',
      'Create themed music nights (80s, 90s) on slower weekdays to drive traffic.',
      'Add more contemporary pop hits to attract younger demographics.',
      'Implement guest song request system via QR codes to boost engagement.',
      'Lower tempo during 11 PM-close to facilitate natural guest transition.'
    ]
  };
}

/**
 * Generate demo atmosphere optimization report
 */
export function generateDemoAtmosphereReport(weekStart: Date, weekEnd: Date): WeeklyReport {
  const metrics = generateDemoWeeklyMetrics();
  
  const insights: ReportInsight[] = [
    {
      category: 'Temperature',
      title: 'Thermal Comfort',
      description: 'Average temperature of 71.2°F maintained optimal comfort. Slight cooling during peak hours (70°F) prevented overcrowding discomfort.',
      trend: 'stable',
      value: '71.2°F'
    },
    {
      category: 'Sound',
      title: 'Audio Environment',
      description: 'Average 73.8 dB created energetic atmosphere without overwhelming conversation. Perfect balance for social dining.',
      trend: 'stable',
      value: '73.8 dB'
    },
    {
      category: 'Lighting',
      title: 'Ambient Conditions',
      description: 'Lighting levels successfully transitioned from bright afternoon (400 lux) to intimate evening ambiance (180 lux).',
      trend: 'up',
      value: 'Optimal'
    },
    {
      category: 'Humidity',
      title: 'Air Quality',
      description: 'Humidity maintained at comfortable 48.5%, preventing both dryness and stuffiness.',
      trend: 'stable',
      value: '48.5%'
    }
  ];

  return {
    id: `report-atmosphere-${Date.now()}`,
    weekStart: weekStart.toISOString(),
    weekEnd: weekEnd.toISOString(),
    generatedAt: new Date().toISOString(),
    summary: 'Environmental conditions remained optimal throughout the week with strong comfort scores (78.5 average). Temperature, sound, and lighting adjustments successfully created distinct atmospheres for lunch vs. dinner/evening service.',
    insights,
    metrics,
    recommendations: [
      'Maintain current HVAC schedule - temperature management is excellent.',
      'Consider adding subtle scent diffusion in entry area to enhance first impressions.',
      'Install dimmable warm LED accents to create more intimate booth areas.',
      'Add acoustic panels in high-ceiling areas to improve sound quality.',
      'Implement CO2 monitoring to optimize air exchange during capacity crowds.'
    ]
  };
}

/**
 * Generate demo occupancy trends report
 */
export function generateDemoOccupancyReport(weekStart: Date, weekEnd: Date): WeeklyReport {
  const metrics = generateDemoWeeklyMetrics();
  
  const insights: ReportInsight[] = [
    {
      category: 'Peak Times',
      title: 'Traffic Patterns',
      description: 'Highest occupancy during 8-9 PM (avg 135 guests), followed by 7-8 PM (125 guests) and 9-10 PM (120 guests).',
      trend: 'up',
      value: '135 peak'
    },
    {
      category: 'Capacity',
      title: 'Space Utilization',
      description: 'Average 67.5% capacity during peak hours. Reached 78% capacity on Saturday nights.',
      trend: 'up',
      value: '67.5%'
    },
    {
      category: 'Dwell Time',
      title: 'Guest Duration',
      description: 'Average guest stay of 87 minutes during dinner service, optimal for table turnover.',
      trend: 'stable',
      value: '87 min'
    },
    {
      category: 'Weekend vs Weekday',
      title: 'Weekly Patterns',
      description: 'Weekends show 45% higher occupancy than weekdays. Wednesday happy hour successfully drives mid-week traffic.',
      trend: 'up',
      value: '+45%'
    }
  ];

  return {
    id: `report-occupancy-${Date.now()}`,
    weekStart: weekStart.toISOString(),
    weekEnd: weekEnd.toISOString(),
    generatedAt: new Date().toISOString(),
    summary: 'Occupancy patterns show strong weekend performance with clear peak hours from 7-10 PM. Mid-week traffic remains opportunity area, though Wednesday happy hour shows promise. Average capacity utilization of 67.5% during peaks indicates room for strategic growth.',
    insights,
    metrics,
    recommendations: [
      'Implement reservation system for Friday/Saturday 7-9 PM to optimize table turnover.',
      'Launch "Tuesday Trivia" or "Thursday Live Music" to boost weekday occupancy.',
      'Consider prix fixe early bird menu (5-6:30 PM) to spread peak hour demand.',
      'Add bar-only seating area to capture walk-in overflow during peak times.',
      'Partner with local hotels for post-event dining to fill 10 PM-close window.'
    ]
  };
}

/**
 * Generate multiple demo reports for history
 */
export function generateDemoReportHistory(count: number = 8): WeeklyReport[] {
  const reports: WeeklyReport[] = [];
  const now = new Date();
  
  for (let i = 0; i < count; i++) {
    const weekEnd = new Date(now.getTime() - (i * 7 * 24 * 60 * 60 * 1000));
    const weekStart = new Date(weekEnd.getTime() - (7 * 24 * 60 * 60 * 1000));
    
    // Vary the metrics slightly for each week
    const baseMetrics = generateDemoWeeklyMetrics();
    const variance = (Math.random() - 0.5) * 10; // +/- 5 points variance
    
    const variedMetrics: WeeklyMetrics = {
      ...baseMetrics,
      avgComfort: Math.max(60, Math.min(90, baseMetrics.avgComfort + variance)),
      avgTemperature: Math.max(68, Math.min(75, baseMetrics.avgTemperature + (Math.random() - 0.5) * 3)),
      avgDecibels: Math.max(65, Math.min(85, baseMetrics.avgDecibels + (Math.random() - 0.5) * 8)),
      totalCustomers: Math.floor(baseMetrics.totalCustomers * (0.85 + Math.random() * 0.3)),
      totalRevenue: Math.floor(baseMetrics.totalRevenue * (0.85 + Math.random() * 0.3))
    };

    const insights: ReportInsight[] = [
      {
        category: 'Comfort',
        title: 'Overall Comfort Level',
        description: `Average comfort score of ${variedMetrics.avgComfort.toFixed(1)} indicates ${
          variedMetrics.avgComfort >= 80 ? 'optimal' : variedMetrics.avgComfort >= 65 ? 'good' : 'suboptimal'
        } environmental conditions.`,
        trend: variedMetrics.avgComfort > baseMetrics.avgComfort ? 'up' : variedMetrics.avgComfort < baseMetrics.avgComfort ? 'down' : 'stable',
        value: `${variedMetrics.avgComfort.toFixed(1)}`
      },
      {
        category: 'Temperature',
        title: 'Temperature Management',
        description: `Average temperature of ${variedMetrics.avgTemperature.toFixed(1)}°F maintained throughout the week.`,
        trend: 'stable',
        value: `${variedMetrics.avgTemperature.toFixed(1)}°F`
      },
      {
        category: 'Revenue',
        title: 'Sales Performance',
        description: `Generated $${variedMetrics.totalRevenue.toLocaleString()} in revenue across ${variedMetrics.totalCustomers.toLocaleString()} customers.`,
        trend: variedMetrics.totalRevenue > baseMetrics.totalRevenue ? 'up' : 'down',
        value: `$${variedMetrics.totalRevenue.toLocaleString()}`
      }
    ];

    const summary = `Week ${i + 1}: Average comfort score of ${variedMetrics.avgComfort.toFixed(1)} with $${variedMetrics.totalRevenue.toLocaleString()} in revenue across ${variedMetrics.totalCustomers.toLocaleString()} customers.`;

    reports.push({
      id: `report-demo-${weekEnd.getTime()}`,
      weekStart: weekStart.toISOString(),
      weekEnd: weekEnd.toISOString(),
      generatedAt: weekEnd.toISOString(),
      summary,
      insights,
      metrics: variedMetrics,
      recommendations: [
        'Continue monitoring environmental conditions for optimal comfort.',
        'Maintain current operational practices for consistent performance.'
      ]
    });
  }
  
  return reports;
}

/**
 * Generate demo optimal ranges for pulse score learning
 * Simulates a nightclub/lounge with 60 days of learned data
 */
export function generateDemoOptimalRanges(): VenueOptimalRanges {
  return {
    venueId: 'theshowcaselounge',
    lastCalculated: new Date().toISOString(),
    dataPointsAnalyzed: 1440, // 60 days × 24 hours
    learningConfidence: 0.75, // 75% confidence (refining stage)
    
    // Learned optimal ranges for a nightclub/lounge
    optimalRanges: {
      temperature: {
        min: 67,
        max: 70,
        confidence: 0.82 // High confidence - temperature is consistent
      },
      light: {
        min: 160,
        max: 210,
        confidence: 0.78 // Good confidence - some variation by event
      },
      sound: {
        min: 78,
        max: 86,
        confidence: 0.85 // Very high confidence - sound is key metric
      },
      humidity: {
        min: 42,
        max: 52,
        confidence: 0.68 // Moderate confidence - less controllable
      }
    },
    
    // Learned factor weights (sound is most important for nightclub)
    weights: {
      temperature: 0.22,
      light: 0.26,
      sound: 0.38, // Sound is most important for atmosphere
      humidity: 0.14
    },
    
    // Benchmarks from top 20% performance hours
    benchmarks: {
      avgDwellTimeTop20: 185, // 3+ hours during best nights
      avgOccupancyTop20: 94, // High occupancy
      avgRevenueTop20: 5850 // Strong revenue
    }
  };
}

/**
 * Generate demo pulse score result
 * Shows the progressive learning system in action
 */
export function generateDemoPulseScoreResult(currentData: SensorData): PulseScoreResult {
  const optimalRanges = generateDemoOptimalRanges();
  
  // Calculate individual factor scores
  const tempScore = scoreFactorDemo(currentData.indoorTemp, optimalRanges.optimalRanges.temperature);
  const lightScore = scoreFactorDemo(currentData.light, optimalRanges.optimalRanges.light);
  const soundScore = scoreFactorDemo(currentData.decibels, optimalRanges.optimalRanges.sound);
  const humidityScore = scoreFactorDemo(currentData.humidity, optimalRanges.optimalRanges.humidity);
  
  // Weighted learned score
  const learnedScore = Math.round(
    (tempScore * optimalRanges.weights.temperature) +
    (lightScore * optimalRanges.weights.light) +
    (soundScore * optimalRanges.weights.sound) +
    (humidityScore * optimalRanges.weights.humidity)
  );
  
  // Calculate generic score (industry standard)
  const genericTempScore = currentData.indoorTemp >= 72 && currentData.indoorTemp <= 76 ? 100 : 75;
  const genericLightScore = currentData.light >= 300 ? 100 : (currentData.light / 300) * 100;
  const genericSoundScore = currentData.decibels <= 75 ? 100 : Math.max(0, 100 - (currentData.decibels - 75) * 2);
  const genericHumidityScore = currentData.humidity >= 40 && currentData.humidity <= 60 ? 100 : 70;
  const genericScore = Math.round((genericTempScore + genericLightScore + genericSoundScore + genericHumidityScore) / 4);
  
  // Blend scores (75% learned, 25% generic)
  const confidence = optimalRanges.learningConfidence;
  const finalScore = Math.round((genericScore * (1 - confidence)) + (learnedScore * confidence));
  
  return {
    score: finalScore,
    confidence: confidence,
    status: 'refining',
    statusMessage: `Refining optimal ranges... ${Math.round(confidence * 100)}% confidence`,
    breakdown: {
      genericScore,
      learnedScore,
      weights: {
        genericWeight: 1 - confidence,
        learnedWeight: confidence
      },
      optimalRanges: optimalRanges.optimalRanges,
      factorScores: {
        temperature: tempScore,
        light: lightScore,
        sound: soundScore,
        humidity: humidityScore
      }
    }
  };
}

/**
 * Helper function to score an environmental factor against optimal range
 */
function scoreFactorDemo(value: number, range: { min: number; max: number }): number {
  // Perfect score if within range
  if (value >= range.min && value <= range.max) {
    return 100;
  }
  
  // Calculate tolerance (20% of range)
  const rangeSize = range.max - range.min;
  const tolerance = rangeSize * 0.2;
  
  // Below range
  if (value < range.min) {
    const deviation = range.min - value;
    return Math.max(0, Math.round(100 - (deviation / tolerance) * 100));
  }
  
  // Above range
  const deviation = value - range.max;
  return Math.max(0, Math.round(100 - (deviation / tolerance) * 100));
}

// ============ DEMO SONG DATA ============

/**
 * Demo songs for The Showcase Lounge
 * Extensive mix of genres fitting a premium nightlife venue
 * ~60 songs for variety
 */
const DEMO_SONGS = [
  // Country hits - THE BIG CROWD PLEASERS
  { song: 'Last Night', artist: 'Morgan Wallen', genre: 'Country', albumArt: 'https://i.scdn.co/image/ab67616d0000b27396380cb6f87f7d18f6e91f55', popularity: 100 },
  { song: 'Fast Car', artist: 'Luke Combs', genre: 'Country', albumArt: 'https://i.scdn.co/image/ab67616d0000b2738f00dd753ee9f5abf2d7e7f0', popularity: 95 },
  { song: 'Something in the Orange', artist: 'Zach Bryan', genre: 'Country', albumArt: 'https://i.scdn.co/image/ab67616d0000b27328b1441836a1a43d3c05a7e7', popularity: 90 },
  { song: 'Tennessee Whiskey', artist: 'Chris Stapleton', genre: 'Country', albumArt: 'https://i.scdn.co/image/ab67616d0000b273e2e2bdd1b4d03c25ccb7e67b', popularity: 92 },
  { song: 'Thinkin Bout Me', artist: 'Morgan Wallen', genre: 'Country', albumArt: 'https://i.scdn.co/image/ab67616d0000b27396380cb6f87f7d18f6e91f55', popularity: 85 },
  { song: 'Whiskey Glasses', artist: 'Morgan Wallen', genre: 'Country', albumArt: 'https://i.scdn.co/image/ab67616d0000b27396380cb6f87f7d18f6e91f55', popularity: 88 },
  { song: 'Die a Happy Man', artist: 'Thomas Rhett', genre: 'Country', albumArt: 'https://i.scdn.co/image/ab67616d0000b273abcd1234567890abcdef1234', popularity: 82 },
  { song: 'Cruise', artist: 'Florida Georgia Line', genre: 'Country', albumArt: 'https://i.scdn.co/image/ab67616d0000b273efgh5678901234efgh5678', popularity: 80 },
  
  // Hip Hop / Rap - HIGH ENERGY
  { song: 'Rich Flex', artist: 'Drake & 21 Savage', genre: 'Hip Hop', albumArt: 'https://i.scdn.co/image/ab67616d0000b273a68e1c59d4fb4d32c26ea8ef', popularity: 98 },
  { song: 'All My Life', artist: 'Lil Durk ft. J. Cole', genre: 'Hip Hop', albumArt: 'https://i.scdn.co/image/ab67616d0000b27378e25fd5dab3d3f4ec0e3d5f', popularity: 88 },
  { song: 'HUMBLE.', artist: 'Kendrick Lamar', genre: 'Hip Hop', albumArt: 'https://i.scdn.co/image/ab67616d0000b273db02243db6b16a0e6aae9cba', popularity: 94 },
  { song: 'goosebumps', artist: 'Travis Scott', genre: 'Hip Hop', albumArt: 'https://i.scdn.co/image/ab67616d0000b2739087f00e8e0e3f7c28c1c0fd', popularity: 90 },
  { song: 'First Class', artist: 'Jack Harlow', genre: 'Hip Hop', albumArt: 'https://i.scdn.co/image/ab67616d0000b2735c66dbf60e9cb8fa9e9c2c22', popularity: 86 },
  { song: "God's Plan", artist: 'Drake', genre: 'Hip Hop', albumArt: 'https://i.scdn.co/image/ab67616d0000b273hijklmno', popularity: 96 },
  { song: 'SICKO MODE', artist: 'Travis Scott', genre: 'Hip Hop', albumArt: 'https://i.scdn.co/image/ab67616d0000b2739087f00e8e0e3f7c28c1c0fd', popularity: 92 },
  { song: 'Rockstar', artist: 'Post Malone ft. 21 Savage', genre: 'Hip Hop', albumArt: 'https://i.scdn.co/image/ab67616d0000b273pqrstuvw', popularity: 91 },
  { song: 'Lucid Dreams', artist: 'Juice WRLD', genre: 'Hip Hop', albumArt: 'https://i.scdn.co/image/ab67616d0000b273xyzabcde', popularity: 87 },
  { song: 'Congratulations', artist: 'Post Malone', genre: 'Hip Hop', albumArt: 'https://i.scdn.co/image/ab67616d0000b273fghijklm', popularity: 85 },
  
  // Pop - CROWD FAVORITES
  { song: 'Anti-Hero', artist: 'Taylor Swift', genre: 'Pop', albumArt: 'https://i.scdn.co/image/ab67616d0000b2735076e4160d018e378f488c33', popularity: 97 },
  { song: 'Flowers', artist: 'Miley Cyrus', genre: 'Pop', albumArt: 'https://i.scdn.co/image/ab67616d0000b2739e01a5c5b0c6b4feaecb41f2', popularity: 95 },
  { song: 'Cruel Summer', artist: 'Taylor Swift', genre: 'Pop', albumArt: 'https://i.scdn.co/image/ab67616d0000b273e787cffec20aa2a396a61647', popularity: 93 },
  { song: 'Levitating', artist: 'Dua Lipa', genre: 'Pop', albumArt: 'https://i.scdn.co/image/ab67616d0000b273nopqrstuv', popularity: 92 },
  { song: 'Blinding Lights', artist: 'The Weeknd', genre: 'Pop', albumArt: 'https://i.scdn.co/image/ab67616d0000b2738863bc11d2aa12b54f5aeb36', popularity: 99 },
  { song: 'Shape of You', artist: 'Ed Sheeran', genre: 'Pop', albumArt: 'https://i.scdn.co/image/ab67616d0000b273wxyzabcd', popularity: 94 },
  { song: 'Uptown Funk', artist: 'Bruno Mars', genre: 'Pop', albumArt: 'https://i.scdn.co/image/ab67616d0000b273efghijkl', popularity: 98 },
  { song: 'Shake It Off', artist: 'Taylor Swift', genre: 'Pop', albumArt: 'https://i.scdn.co/image/ab67616d0000b273mnopqrst', popularity: 90 },
  { song: 'Happy', artist: 'Pharrell Williams', genre: 'Pop', albumArt: 'https://i.scdn.co/image/ab67616d0000b273uvwxyzab', popularity: 88 },
  { song: 'Dont Start Now', artist: 'Dua Lipa', genre: 'Pop', albumArt: 'https://i.scdn.co/image/ab67616d0000b273cdefghij', popularity: 91 },
  
  // Electronic / Dance - PEAK HOURS
  { song: 'Alone', artist: 'Marshmello', genre: 'Electronic', albumArt: 'https://i.scdn.co/image/ab67616d0000b273klmnopqr', popularity: 89 },
  { song: 'Titanium', artist: 'David Guetta ft. Sia', genre: 'Electronic', albumArt: 'https://i.scdn.co/image/ab67616d0000b273stuvwxyz', popularity: 93 },
  { song: 'Clarity', artist: 'Zedd ft. Foxes', genre: 'Electronic', albumArt: 'https://i.scdn.co/image/ab67616d0000b273abcdefgh', popularity: 88 },
  { song: 'Wake Me Up', artist: 'Avicii', genre: 'Electronic', albumArt: 'https://i.scdn.co/image/ab67616d0000b273ijklmnop', popularity: 95 },
  { song: "Don't You Worry Child", artist: 'Swedish House Mafia', genre: 'Electronic', albumArt: 'https://i.scdn.co/image/ab67616d0000b273qrstuvwx', popularity: 91 },
  { song: 'Lean On', artist: 'Major Lazer & DJ Snake', genre: 'Electronic', albumArt: 'https://i.scdn.co/image/ab67616d0000b273yzabcdef', popularity: 92 },
  { song: 'Animals', artist: 'Martin Garrix', genre: 'Electronic', albumArt: 'https://i.scdn.co/image/ab67616d0000b273ghijklmn', popularity: 90 },
  { song: 'Faded', artist: 'Alan Walker', genre: 'Electronic', albumArt: 'https://i.scdn.co/image/ab67616d0000b273opqrstuv', popularity: 94 },
  
  // R&B / Soul - VIBES
  { song: 'Snooze', artist: 'SZA', genre: 'R&B', albumArt: 'https://i.scdn.co/image/ab67616d0000b2730c471c36970b9406233842a5', popularity: 93 },
  { song: 'Kill Bill', artist: 'SZA', genre: 'R&B', albumArt: 'https://i.scdn.co/image/ab67616d0000b2730c471c36970b9406233842a5', popularity: 96 },
  { song: 'Earned It', artist: 'The Weeknd', genre: 'R&B', albumArt: 'https://i.scdn.co/image/ab67616d0000b273wxyzabcd', popularity: 89 },
  { song: 'Love Galore', artist: 'SZA ft. Travis Scott', genre: 'R&B', albumArt: 'https://i.scdn.co/image/ab67616d0000b273efghijkl', popularity: 87 },
  { song: 'Best Part', artist: 'Daniel Caesar ft. H.E.R.', genre: 'R&B', albumArt: 'https://i.scdn.co/image/ab67616d0000b273mnopqrst', popularity: 85 },
  { song: 'Die For You', artist: 'The Weeknd', genre: 'R&B', albumArt: 'https://i.scdn.co/image/ab67616d0000b273uvwxyzab', popularity: 91 },
  
  // Rock / Alternative - CLASSIC ENERGY
  { song: 'Heat Waves', artist: 'Glass Animals', genre: 'Alternative', albumArt: 'https://i.scdn.co/image/ab67616d0000b273712dc99f1f0e32d94a314e13', popularity: 94 },
  { song: 'Believer', artist: 'Imagine Dragons', genre: 'Rock', albumArt: 'https://i.scdn.co/image/ab67616d0000b273cdefghij', popularity: 92 },
  { song: 'Thunder', artist: 'Imagine Dragons', genre: 'Rock', albumArt: 'https://i.scdn.co/image/ab67616d0000b273klmnopqr', popularity: 89 },
  { song: 'Mr. Brightside', artist: 'The Killers', genre: 'Rock', albumArt: 'https://i.scdn.co/image/ab67616d0000b273stuvwxyz', popularity: 97 },
  { song: 'Bohemian Rhapsody', artist: 'Queen', genre: 'Rock', albumArt: 'https://i.scdn.co/image/ab67616d0000b273abcdefgh', popularity: 95 },
  { song: 'Sweet Child O Mine', artist: 'Guns N Roses', genre: 'Rock', albumArt: 'https://i.scdn.co/image/ab67616d0000b273ijklmnop', popularity: 93 },
  { song: 'Livin on a Prayer', artist: 'Bon Jovi', genre: 'Rock', albumArt: 'https://i.scdn.co/image/ab67616d0000b273qrstuvwx', popularity: 94 },
  
  // Latin - HOT TRACKS
  { song: 'Titi Me Pregunto', artist: 'Bad Bunny', genre: 'Latin', albumArt: 'https://i.scdn.co/image/ab67616d0000b273yzabcdef', popularity: 95 },
  { song: 'Despacito', artist: 'Luis Fonsi ft. Daddy Yankee', genre: 'Latin', albumArt: 'https://i.scdn.co/image/ab67616d0000b273ghijklmn', popularity: 99 },
  { song: 'Dákiti', artist: 'Bad Bunny & Jhay Cortez', genre: 'Latin', albumArt: 'https://i.scdn.co/image/ab67616d0000b273opqrstuv', popularity: 92 },
  { song: 'Pepas', artist: 'Farruko', genre: 'Latin', albumArt: 'https://i.scdn.co/image/ab67616d0000b273wxyzabcd', popularity: 94 },
  { song: 'La Bachata', artist: 'Manuel Turizo', genre: 'Latin', albumArt: 'https://i.scdn.co/image/ab67616d0000b273efghijkl', popularity: 88 },
  { song: 'Efecto', artist: 'Bad Bunny', genre: 'Latin', albumArt: 'https://i.scdn.co/image/ab67616d0000b273mnopqrst', popularity: 90 },
];

/**
 * Generate demo song log entries
 * Creates realistic play history for the demo venue
 * 90 days of data, 60-80 songs on peak nights
 */
export interface DemoSongEntry {
  id: string;
  songName: string;
  artist: string;
  timestamp: string;
  albumArt?: string;
  source: 'spotify' | 'youtube' | 'shazam' | 'manual' | 'other';
}

export function generateDemoSongLog(): DemoSongEntry[] {
  const entries: DemoSongEntry[] = [];
  const now = new Date();
  
  // Generate songs for the past 90 days - impressive history!
  for (let daysAgo = 0; daysAgo < 90; daysAgo++) {
    const date = new Date(now);
    date.setDate(date.getDate() - daysAgo);
    const dayOfWeek = date.getDay();
    
    // Realistic song counts based on day
    // Saturday: 75-85 songs (peak night!)
    // Friday: 65-75 songs
    // Thursday: 40-50 songs (college night)
    // Sunday: 30-40 songs (brunch + evening)
    // Mon-Wed: 20-30 songs
    let songsPerDay: number;
    if (dayOfWeek === 6) { // Saturday
      songsPerDay = 75 + Math.floor(Math.random() * 10);
    } else if (dayOfWeek === 5) { // Friday
      songsPerDay = 65 + Math.floor(Math.random() * 10);
    } else if (dayOfWeek === 4) { // Thursday
      songsPerDay = 40 + Math.floor(Math.random() * 10);
    } else if (dayOfWeek === 0) { // Sunday
      songsPerDay = 30 + Math.floor(Math.random() * 10);
    } else {
      songsPerDay = 20 + Math.floor(Math.random() * 10);
    }
    
    // Weight songs by popularity - popular songs play more often
    const weightedSongs = DEMO_SONGS.flatMap(song => {
      const weight = Math.ceil((song.popularity || 50) / 20); // 1-5 copies based on popularity
      return Array(weight).fill(song);
    });
    
    // Operating hours: 4pm - 2am, peak 10pm-1am
    for (let i = 0; i < songsPerDay; i++) {
      const song = weightedSongs[Math.floor(Math.random() * weightedSongs.length)];
      
      // Weight hours toward peak times
      let hour: number;
      const hourRoll = Math.random();
      if (hourRoll < 0.6) {
        // 60% chance: Peak hours (10pm - 1am)
        hour = 22 + Math.floor(Math.random() * 3);
      } else if (hourRoll < 0.85) {
        // 25% chance: Pre-peak (8pm - 10pm)
        hour = 20 + Math.floor(Math.random() * 2);
      } else {
        // 15% chance: Early or late (4pm-8pm or 1am-2am)
        hour = Math.random() < 0.5 ? 16 + Math.floor(Math.random() * 4) : 1;
      }
      
      const minute = Math.floor(Math.random() * 60);
      
      const timestamp = new Date(date);
      timestamp.setHours(hour % 24, minute, 0, 0);
      
      entries.push({
        id: `demo-${daysAgo}-${i}-${Math.random().toString(36).substr(2, 5)}`,
        songName: song.song,
        artist: song.artist,
        timestamp: timestamp.toISOString(),
        albumArt: song.albumArt,
        source: 'spotify', // Premium venue uses Spotify
      });
    }
  }
  
  // Sort by timestamp descending (most recent first)
  entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  
  console.log(`🎵 Demo: Generated ${entries.length} song entries over 90 days`);
  return entries;
}

/**
 * Get top songs from demo data - IMPRESSIVE CONSISTENT NUMBERS
 * These are the crowd favorites that get played repeatedly
 */
export function getDemoTopSongs(limit: number = 10): Array<{ song: string; artist: string; plays: number; albumArt?: string }> {
  // Curated top songs with impressive play counts
  // These numbers represent 90 days of a busy venue
  const topSongsData = [
    { song: 'Last Night', artist: 'Morgan Wallen', plays: 127, albumArt: 'https://i.scdn.co/image/ab67616d0000b27396380cb6f87f7d18f6e91f55' },
    { song: 'Blinding Lights', artist: 'The Weeknd', plays: 118, albumArt: 'https://i.scdn.co/image/ab67616d0000b2738863bc11d2aa12b54f5aeb36' },
    { song: 'Uptown Funk', artist: 'Bruno Mars', plays: 112, albumArt: 'https://i.scdn.co/image/ab67616d0000b273efghijkl' },
    { song: 'Mr. Brightside', artist: 'The Killers', plays: 105, albumArt: 'https://i.scdn.co/image/ab67616d0000b273stuvwxyz' },
    { song: 'Rich Flex', artist: 'Drake & 21 Savage', plays: 98, albumArt: 'https://i.scdn.co/image/ab67616d0000b273a68e1c59d4fb4d32c26ea8ef' },
    { song: 'Anti-Hero', artist: 'Taylor Swift', plays: 94, albumArt: 'https://i.scdn.co/image/ab67616d0000b2735076e4160d018e378f488c33' },
    { song: 'Despacito', artist: 'Luis Fonsi ft. Daddy Yankee', plays: 89, albumArt: 'https://i.scdn.co/image/ab67616d0000b273ghijklmn' },
    { song: 'Kill Bill', artist: 'SZA', plays: 85, albumArt: 'https://i.scdn.co/image/ab67616d0000b2730c471c36970b9406233842a5' },
    { song: 'Tennessee Whiskey', artist: 'Chris Stapleton', plays: 82, albumArt: 'https://i.scdn.co/image/ab67616d0000b273e2e2bdd1b4d03c25ccb7e67b' },
    { song: 'Wake Me Up', artist: 'Avicii', plays: 79, albumArt: 'https://i.scdn.co/image/ab67616d0000b273ijklmnop' },
    { song: 'HUMBLE.', artist: 'Kendrick Lamar', plays: 76, albumArt: 'https://i.scdn.co/image/ab67616d0000b273db02243db6b16a0e6aae9cba' },
    { song: 'Flowers', artist: 'Miley Cyrus', plays: 73, albumArt: 'https://i.scdn.co/image/ab67616d0000b2739e01a5c5b0c6b4feaecb41f2' },
    { song: 'Heat Waves', artist: 'Glass Animals', plays: 71, albumArt: 'https://i.scdn.co/image/ab67616d0000b273712dc99f1f0e32d94a314e13' },
    { song: 'Pepas', artist: 'Farruko', plays: 68, albumArt: 'https://i.scdn.co/image/ab67616d0000b273wxyzabcd' },
    { song: 'Shape of You', artist: 'Ed Sheeran', plays: 65, albumArt: 'https://i.scdn.co/image/ab67616d0000b273wxyzabcd' },
    { song: 'Bohemian Rhapsody', artist: 'Queen', plays: 62, albumArt: 'https://i.scdn.co/image/ab67616d0000b273abcdefgh' },
    { song: 'goosebumps', artist: 'Travis Scott', plays: 59, albumArt: 'https://i.scdn.co/image/ab67616d0000b2739087f00e8e0e3f7c28c1c0fd' },
    { song: 'Titanium', artist: 'David Guetta ft. Sia', plays: 56, albumArt: 'https://i.scdn.co/image/ab67616d0000b273stuvwxyz' },
    { song: 'Cruel Summer', artist: 'Taylor Swift', plays: 54, albumArt: 'https://i.scdn.co/image/ab67616d0000b273e787cffec20aa2a396a61647' },
    { song: 'Titi Me Pregunto', artist: 'Bad Bunny', plays: 52, albumArt: 'https://i.scdn.co/image/ab67616d0000b273yzabcdef' },
  ];
  
  return topSongsData.slice(0, limit);
}

/**
 * Get demo genre stats - IMPRESSIVE NUMBERS
 * Shows which genres drive the best crowd retention
 */
export function getDemoGenreStats(): Array<{
  genre: string;
  plays: number;
  avgRetention: number; // Retention rate percentage (100% = neutral, >100% = crowd grew)
  avgOccupancy: number;
  totalMinutes: number;
  performanceScore: number;
}> {
  return [
    { genre: 'Country', plays: 487, avgRetention: 106.2, avgOccupancy: 385, totalMinutes: 1461, performanceScore: 96 },
    { genre: 'Hip Hop', plays: 412, avgRetention: 104.8, avgOccupancy: 410, totalMinutes: 1236, performanceScore: 94 },
    { genre: 'Pop', plays: 385, avgRetention: 102.5, avgOccupancy: 365, totalMinutes: 1155, performanceScore: 91 },
    { genre: 'Electronic', plays: 298, avgRetention: 108.1, avgOccupancy: 425, totalMinutes: 894, performanceScore: 95 },
    { genre: 'Rock', plays: 245, avgRetention: 101.8, avgOccupancy: 345, totalMinutes: 735, performanceScore: 88 },
    { genre: 'Latin', plays: 198, avgRetention: 105.5, avgOccupancy: 395, totalMinutes: 594, performanceScore: 92 },
    { genre: 'R&B', plays: 165, avgRetention: 100.3, avgOccupancy: 320, totalMinutes: 495, performanceScore: 85 },
    { genre: 'Alternative', plays: 124, avgRetention: 99.8, avgOccupancy: 295, totalMinutes: 372, performanceScore: 82 },
  ];
}

/**
 * Get demo highest retention songs - STICKIEST SONGS
 * Songs where people stayed (100% accurate - based on sensor data)
 * Retention Rate = (crowd at song end / crowd at song start) × 100
 */
export function getDemoHighestPerformingSongs(limit: number = 10): Array<{
  song: string;
  artist: string;
  plays: number;
  retentionRate: number; // % of crowd that stayed (100% = no one left, 105% = more came than left)
  avgExitRate: number; // exits per minute per 100 people (lower = better)
  avgCrowdSize: number;
  albumArt?: string;
  genre?: string;
}> {
  const topSongs = [
    { song: 'Tennessee Whiskey', artist: 'Chris Stapleton', plays: 82, retentionRate: 108.2, avgExitRate: 0.8, avgCrowdSize: 145, genre: 'Country', albumArt: 'https://i.scdn.co/image/ab67616d0000b273e2e2bdd1b4d03c25ccb7e67b' },
    { song: 'Bohemian Rhapsody', artist: 'Queen', plays: 62, retentionRate: 106.5, avgExitRate: 1.1, avgCrowdSize: 168, genre: 'Rock', albumArt: 'https://i.scdn.co/image/ab67616d0000b273abcdefgh' },
    { song: 'Last Night', artist: 'Morgan Wallen', plays: 127, retentionRate: 104.8, avgExitRate: 1.3, avgCrowdSize: 152, genre: 'Country', albumArt: 'https://i.scdn.co/image/ab67616d0000b27396380cb6f87f7d18f6e91f55' },
    { song: 'Mr. Brightside', artist: 'The Killers', plays: 105, retentionRate: 103.2, avgExitRate: 1.5, avgCrowdSize: 175, genre: 'Rock', albumArt: 'https://i.scdn.co/image/ab67616d0000b273stuvwxyz' },
    { song: 'Blinding Lights', artist: 'The Weeknd', plays: 118, retentionRate: 102.1, avgExitRate: 1.6, avgCrowdSize: 162, genre: 'Pop', albumArt: 'https://i.scdn.co/image/ab67616d0000b2738863bc11d2aa12b54f5aeb36' },
    { song: 'Uptown Funk', artist: 'Bruno Mars', plays: 112, retentionRate: 101.5, avgExitRate: 1.8, avgCrowdSize: 178, genre: 'Pop', albumArt: 'https://i.scdn.co/image/ab67616d0000b273efghijkl' },
    { song: 'Wake Me Up', artist: 'Avicii', plays: 79, retentionRate: 100.8, avgExitRate: 2.0, avgCrowdSize: 165, genre: 'Electronic', albumArt: 'https://i.scdn.co/image/ab67616d0000b273ijklmnop' },
    { song: 'Rich Flex', artist: 'Drake & 21 Savage', plays: 98, retentionRate: 100.2, avgExitRate: 2.1, avgCrowdSize: 158, genre: 'Hip Hop', albumArt: 'https://i.scdn.co/image/ab67616d0000b273a68e1c59d4fb4d32c26ea8ef' },
    { song: 'Kill Bill', artist: 'SZA', plays: 85, retentionRate: 99.8, avgExitRate: 2.2, avgCrowdSize: 142, genre: 'R&B', albumArt: 'https://i.scdn.co/image/ab67616d0000b2730c471c36970b9406233842a5' },
    { song: 'Despacito', artist: 'Luis Fonsi ft. Daddy Yankee', plays: 89, retentionRate: 99.5, avgExitRate: 2.3, avgCrowdSize: 155, genre: 'Latin', albumArt: 'https://i.scdn.co/image/ab67616d0000b273ghijklmn' },
    { song: 'Anti-Hero', artist: 'Taylor Swift', plays: 94, retentionRate: 99.1, avgExitRate: 2.4, avgCrowdSize: 148, genre: 'Pop', albumArt: 'https://i.scdn.co/image/ab67616d0000b2735076e4160d018e378f488c33' },
    { song: 'Heat Waves', artist: 'Glass Animals', plays: 71, retentionRate: 98.7, avgExitRate: 2.5, avgCrowdSize: 138, genre: 'Alternative', albumArt: 'https://i.scdn.co/image/ab67616d0000b273712dc99f1f0e32d94a314e13' },
  ];
  
  return topSongs.slice(0, limit);
}

/**
 * Get demo top performers playlist - READY TO EXPORT
 * Sorted by retention rate (highest first)
 */
export function getDemoTopPerformersPlaylist(limit: number = 20): Array<{
  position: number;
  song: string;
  artist: string;
  plays: number;
  retentionRate: number;
  albumArt?: string;
  genre?: string;
}> {
  const playlistData = [
    { song: 'Tennessee Whiskey', artist: 'Chris Stapleton', plays: 82, retentionRate: 108.2, genre: 'Country', albumArt: 'https://i.scdn.co/image/ab67616d0000b273e2e2bdd1b4d03c25ccb7e67b' },
    { song: 'Bohemian Rhapsody', artist: 'Queen', plays: 62, retentionRate: 106.5, genre: 'Rock', albumArt: 'https://i.scdn.co/image/ab67616d0000b273abcdefgh' },
    { song: 'Last Night', artist: 'Morgan Wallen', plays: 127, retentionRate: 104.8, genre: 'Country', albumArt: 'https://i.scdn.co/image/ab67616d0000b27396380cb6f87f7d18f6e91f55' },
    { song: 'Mr. Brightside', artist: 'The Killers', plays: 105, retentionRate: 103.2, genre: 'Rock', albumArt: 'https://i.scdn.co/image/ab67616d0000b273stuvwxyz' },
    { song: 'Blinding Lights', artist: 'The Weeknd', plays: 118, retentionRate: 102.1, genre: 'Pop', albumArt: 'https://i.scdn.co/image/ab67616d0000b2738863bc11d2aa12b54f5aeb36' },
    { song: 'Uptown Funk', artist: 'Bruno Mars', plays: 112, retentionRate: 101.5, genre: 'Pop', albumArt: 'https://i.scdn.co/image/ab67616d0000b273efghijkl' },
    { song: 'Wake Me Up', artist: 'Avicii', plays: 79, retentionRate: 100.8, genre: 'Electronic', albumArt: 'https://i.scdn.co/image/ab67616d0000b273ijklmnop' },
    { song: 'Rich Flex', artist: 'Drake & 21 Savage', plays: 98, retentionRate: 100.2, genre: 'Hip Hop', albumArt: 'https://i.scdn.co/image/ab67616d0000b273a68e1c59d4fb4d32c26ea8ef' },
    { song: 'Kill Bill', artist: 'SZA', plays: 85, retentionRate: 99.8, genre: 'R&B', albumArt: 'https://i.scdn.co/image/ab67616d0000b2730c471c36970b9406233842a5' },
    { song: 'Despacito', artist: 'Luis Fonsi ft. Daddy Yankee', plays: 89, retentionRate: 99.5, genre: 'Latin', albumArt: 'https://i.scdn.co/image/ab67616d0000b273ghijklmn' },
    { song: 'Anti-Hero', artist: 'Taylor Swift', plays: 94, retentionRate: 99.1, genre: 'Pop', albumArt: 'https://i.scdn.co/image/ab67616d0000b2735076e4160d018e378f488c33' },
    { song: 'Heat Waves', artist: 'Glass Animals', plays: 71, retentionRate: 98.7, genre: 'Alternative', albumArt: 'https://i.scdn.co/image/ab67616d0000b273712dc99f1f0e32d94a314e13' },
    { song: 'HUMBLE.', artist: 'Kendrick Lamar', plays: 76, retentionRate: 98.3, genre: 'Hip Hop', albumArt: 'https://i.scdn.co/image/ab67616d0000b273db02243db6b16a0e6aae9cba' },
    { song: 'Flowers', artist: 'Miley Cyrus', plays: 73, retentionRate: 97.9, genre: 'Pop', albumArt: 'https://i.scdn.co/image/ab67616d0000b2739e01a5c5b0c6b4feaecb41f2' },
    { song: 'Pepas', artist: 'Farruko', plays: 68, retentionRate: 97.5, genre: 'Latin', albumArt: 'https://i.scdn.co/image/ab67616d0000b273wxyzabcd' },
    { song: 'Shape of You', artist: 'Ed Sheeran', plays: 65, retentionRate: 97.2, genre: 'Pop', albumArt: 'https://i.scdn.co/image/ab67616d0000b273wxyzabcd' },
    { song: 'goosebumps', artist: 'Travis Scott', plays: 59, retentionRate: 96.8, genre: 'Hip Hop', albumArt: 'https://i.scdn.co/image/ab67616d0000b2739087f00e8e0e3f7c28c1c0fd' },
    { song: 'Titanium', artist: 'David Guetta ft. Sia', plays: 56, retentionRate: 96.4, genre: 'Electronic', albumArt: 'https://i.scdn.co/image/ab67616d0000b273stuvwxyz' },
    { song: 'Cruel Summer', artist: 'Taylor Swift', plays: 54, retentionRate: 96.1, genre: 'Pop', albumArt: 'https://i.scdn.co/image/ab67616d0000b273e787cffec20aa2a396a61647' },
    { song: 'Titi Me Pregunto', artist: 'Bad Bunny', plays: 52, retentionRate: 95.8, genre: 'Latin', albumArt: 'https://i.scdn.co/image/ab67616d0000b273yzabcdef' },
  ];
  
  return playlistData.slice(0, limit).map((s, i) => ({
    position: i + 1,
    ...s,
  }));
}


// ============ DEMO VENUESCOPE DATA ============

// Stable Unsplash bar/nightclub images for snapshot previews
const DEMO_SERVE_SNAPSHOTS: Record<string, string> = {
  "245.0":  "https://images.unsplash.com/photo-1575444758702-4a6b9222336e?w=640&q=80",
  "612.0":  "https://images.unsplash.com/photo-1566633806327-68e152aaf26d?w=640&q=80",
  "1847.0": "https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=640&q=80",
  "2931.0": "https://images.unsplash.com/photo-1470337458703-46ad1756a187?w=640&q=80",
};

/**
 * Generate realistic demo VenueScope jobs for The Showcase Lounge.
 * All demo-only. Does NOT affect any real account code paths.
 *
 * Key narrative:
 *   - Jordan: theft flag — 4 drinks served 11:18–11:31 PM with no POS ring, est. $48 loss
 *   - Marcus: clean record, top performer
 *   - Priya: clean record, #2 performer
 *   - One "currently running" live job for tonight's shift
 */
export function generateDemoVenueScopeJobs(): VenueScopeJob[] {
  const venueId = DEMO_VENUE.venueId;
  const now     = Math.floor(Date.now() / 1000);

  // Yesterday's date at 6 PM EST (used as shift start reference)
  const yesterdayShiftStart = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    d.setHours(18, 0, 0, 0); // 6:00 PM local
    return Math.floor(d.getTime() / 1000);
  })();

  // Shift end = yesterday 2 AM (next day)
  const yesterdayShiftEnd = yesterdayShiftStart + (8 * 3600); // 8-hour shift

  // ── Drink timestamps spread across the shift ──
  // Spread 91 Marcus drinks across 8 hours (6 PM – 2 AM)
  function makeTimestamps(count: number, shiftStartSec: number, shiftDurationSec: number): number[] {
    const ts: number[] = [];
    for (let i = 0; i < count; i++) {
      ts.push(Math.round(shiftStartSec + (i / count) * shiftDurationSec + (Math.random() * 120 - 60)));
    }
    return ts.sort((a, b) => a - b);
  }

  // Jordan's 4 theft drinks: 11:18 PM – 11:31 PM = offsets 19080–19860 from shift start (6 PM)
  const jordanTheftTimestamps = [
    yesterdayShiftStart + 19080, // 11:18 PM
    yesterdayShiftStart + 19380, // 11:23 PM
    yesterdayShiftStart + 19620, // 11:27 PM
    yesterdayShiftStart + 19860, // 11:31 PM
  ];

  // ── Bartender breakdown JSON for the primary last-night job ──
  const lastNightBreakdown = JSON.stringify({
    Marcus: {
      drinks: 91,
      per_hour: 11.4,
      timestamps: makeTimestamps(91, 0, 28800),
      drink_scores: Array.from({ length: 91 }, () => parseFloat((0.78 + Math.random() * 0.17).toFixed(2))),
    },
    Priya: {
      drinks: 67,
      per_hour: 8.4,
      timestamps: makeTimestamps(67, 0, 28800),
      drink_scores: Array.from({ length: 67 }, () => parseFloat((0.75 + Math.random() * 0.20).toFixed(2))),
    },
    Jordan: {
      drinks: 4,
      per_hour: 0.5,
      timestamps: jordanTheftTimestamps.map(t => t - yesterdayShiftStart),
      drink_scores: [0.41, 0.38, 0.44, 0.39], // low scores — flagged
    },
  });

  // ── Live job: tonight's ongoing shift ──
  const shiftOpenHour = 18; // 6 PM
  const shiftCloseHour = 26; // 2 AM next day (26 = 24 + 2)
  const nowHour = new Date().getHours() + new Date().getMinutes() / 60;
  // How far into tonight's shift are we? (open 6 PM)
  const hoursIntoShift = nowHour >= shiftOpenHour
    ? nowHour - shiftOpenHour
    : nowHour < 2
      ? nowHour + (24 - shiftOpenHour) // past midnight
      : 0;
  const shiftTotalHours = shiftCloseHour - shiftOpenHour;
  const shiftProgress = Math.min(100, Math.round((hoursIntoShift / shiftTotalHours) * 100));
  const liveElapsedSec = Math.round(hoursIntoShift * 3600);
  const liveDrinksSoFar = Math.round(hoursIntoShift * 9.5); // ~9.5 drinks/hr pace

  // Tonight's shift started at 6 PM today
  const tonightShiftStart = (() => {
    const d = new Date();
    d.setHours(18, 0, 0, 0);
    return Math.floor(d.getTime() / 1000);
  })();

  const liveJob: VenueScopeJob = {
    venueId,
    jobId:            'demo-live-001',
    clipLabel:        'Bar Camera — Live',
    analysisMode:     'drink_count',
    activeModes:      JSON.stringify(['drink_count']),
    totalDrinks:      liveDrinksSoFar,
    drinksPerHour:    9.5,
    topBartender:     'Marcus',
    confidenceScore:  84,
    confidenceLabel:  'High confidence',
    confidenceColor:  'green',
    hasTheftFlag:     false,
    unrungDrinks:     0,
    cameraLabel:      'Bar Camera — Live',
    createdAt:        tonightShiftStart,
    finishedAt:       undefined,
    status:           'running',
    isLive:           true,
    elapsedSec:       liveElapsedSec,
    totalEntries:     0,
    totalExits:       0,
    peakOccupancy:    0,
    bottleCount:      0,
    peakBottleCount:  0,
    pourCount:        0,
    totalPouredOz:    0,
    overPours:        0,
    cameraAngle:      'overhead',
    reviewCount:      0,
    serveSnapshots:   JSON.stringify(DEMO_SERVE_SNAPSHOTS),
    bartenderBreakdown: JSON.stringify({
      Marcus: {
        drinks: Math.round(liveDrinksSoFar * 0.58),
        per_hour: 5.5,
        timestamps: makeTimestamps(Math.round(liveDrinksSoFar * 0.58), 0, liveElapsedSec),
        drink_scores: Array.from({ length: Math.round(liveDrinksSoFar * 0.58) }, () => parseFloat((0.80 + Math.random() * 0.15).toFixed(2))),
      },
      Priya: {
        drinks: Math.round(liveDrinksSoFar * 0.42),
        per_hour: 4.0,
        timestamps: makeTimestamps(Math.round(liveDrinksSoFar * 0.42), 0, liveElapsedSec),
        drink_scores: Array.from({ length: Math.round(liveDrinksSoFar * 0.42) }, () => parseFloat((0.77 + Math.random() * 0.18).toFixed(2))),
      },
    }),
  } as unknown as VenueScopeJob;

  // ── Last night's completed shift (the main theft narrative) ──
  const lastNightJob: VenueScopeJob = {
    venueId,
    jobId:            'demo-100',
    clipLabel:        'Main Bar — Last Night (6 PM – 2 AM)',
    analysisMode:     'drink_count',
    activeModes:      JSON.stringify(['drink_count']),
    totalDrinks:      162, // Marcus 91 + Priya 67 + Jordan 4
    drinksPerHour:    20.3,
    topBartender:     'Marcus',
    confidenceScore:  87,
    confidenceLabel:  'High confidence',
    confidenceColor:  'green',
    hasTheftFlag:     true,
    unrungDrinks:     4,
    cameraLabel:      'Bar Cam',
    createdAt:        yesterdayShiftStart,
    finishedAt:       yesterdayShiftEnd + 900, // finished ~15 min after shift
    status:           'done',
    isLive:           false,
    totalEntries:     0,
    totalExits:       0,
    peakOccupancy:    0,
    bottleCount:      0,
    peakBottleCount:  0,
    pourCount:        0,
    totalPouredOz:    0,
    overPours:        2,
    cameraAngle:      'overhead',
    reviewCount:      5,
    serveSnapshots:   JSON.stringify(DEMO_SERVE_SNAPSHOTS),
    bartenderBreakdown: lastNightBreakdown,
    // Theft story fields (consumed by VenueScope.tsx alert rendering)
    theft_alert:      'Jordan served 4 drinks between 11:18 PM – 11:31 PM with no POS ring. Est. loss: $48.',
  } as unknown as VenueScopeJob;

  type Shift = {
    label: string; bartender: string; drinks: number; unrung: number;
    confidence: 'green' | 'yellow' | 'red'; mode: string; hoursAgo: number;
    entries?: number; peak?: number; bottles?: number; pours?: number;
  };

  // Past 14 nights' jobs (historical — no theft narrative in these, just context)
  const historicShifts: Shift[] = [
    { label: 'Entrance — Last Night',       bartender: '',        drinks: 0,  unrung: 0, confidence: 'green',  mode: 'people_count', hoursAgo: 24,  entries: 312, peak: 287 },
    { label: 'Back Bar — Last Night',        bartender: 'Priya',   drinks: 29, unrung: 0, confidence: 'green',  mode: 'bottle_count', hoursAgo: 25,  bottles: 18, pours: 29 },
    { label: 'Main Bar – Fri 9 PM',          bartender: 'Marcus',  drinks: 83, unrung: 1, confidence: 'green',  mode: 'drink_count',  hoursAgo: 48 },
    { label: 'Main Bar – Fri 7 PM',          bartender: 'Priya',   drinks: 44, unrung: 0, confidence: 'green',  mode: 'drink_count',  hoursAgo: 50 },
    { label: 'Entrance – Fri',               bartender: '',        drinks: 0,  unrung: 0, confidence: 'green',  mode: 'people_count', hoursAgo: 49,  entries: 498, peak: 431 },
    { label: 'Main Bar – Thu 10 PM',         bartender: 'Jordan',  drinks: 61, unrung: 1, confidence: 'yellow', mode: 'drink_count',  hoursAgo: 72 },
    { label: 'Main Bar – Thu 8 PM',          bartender: 'Marcus',  drinks: 38, unrung: 0, confidence: 'green',  mode: 'drink_count',  hoursAgo: 74 },
    { label: 'Main Bar – Wed 10 PM',         bartender: 'Priya',   drinks: 55, unrung: 0, confidence: 'green',  mode: 'drink_count',  hoursAgo: 96 },
    { label: 'Main Bar – Tue 10 PM',         bartender: 'Jordan',  drinks: 48, unrung: 0, confidence: 'green',  mode: 'drink_count',  hoursAgo: 120 },
    { label: 'Main Bar – Mon 9 PM',          bartender: 'Marcus',  drinks: 35, unrung: 0, confidence: 'green',  mode: 'drink_count',  hoursAgo: 144 },
    { label: 'Main Bar – Sun 11 PM',         bartender: 'Priya',   drinks: 72, unrung: 0, confidence: 'green',  mode: 'drink_count',  hoursAgo: 168 },
    { label: 'Entrance – Sat',               bartender: '',        drinks: 0,  unrung: 0, confidence: 'green',  mode: 'people_count', hoursAgo: 191, entries: 612, peak: 504 },
    { label: 'Back Bar – Sat',               bartender: 'Jordan',  drinks: 38, unrung: 0, confidence: 'green',  mode: 'bottle_count', hoursAgo: 192, bottles: 24, pours: 38 },
    { label: 'Main Bar – Fri 2wk 9P',        bartender: 'Priya',   drinks: 79, unrung: 0, confidence: 'green',  mode: 'drink_count',  hoursAgo: 216 },
    { label: 'Main Bar – Thu 2wk',           bartender: 'Marcus',  drinks: 57, unrung: 0, confidence: 'green',  mode: 'drink_count',  hoursAgo: 240 },
  ];

  function makeHistoricJob(shift: Shift, idx: number): VenueScopeJob {
    const finishedAt = now - Math.round(shift.hoursAgo * 3600);
    const createdAt  = finishedAt - (25 * 60 + Math.round(Math.random() * 300));
    const dph        = shift.drinks > 0 ? parseFloat((shift.drinks / 2.5).toFixed(1)) : 0;
    const hasTheft   = shift.unrung > 0;
    const confScore  = shift.confidence === 'green' ? 87 : shift.confidence === 'yellow' ? 68 : 42;
    const drinkTs    = shift.drinks > 0 ? makeTimestamps(shift.drinks, 0, 28800) : [];
    const breakdown  = shift.mode === 'drink_count' && shift.bartender ? JSON.stringify({
      [shift.bartender]: {
        drinks: shift.drinks,
        per_hour: dph,
        timestamps: drinkTs,
        drink_scores: drinkTs.map(() => parseFloat((0.70 + Math.random() * 0.25).toFixed(2))),
      },
    }) : undefined;

    return {
      venueId,
      jobId:            `demo-${idx.toString().padStart(3, '0')}`,
      clipLabel:        shift.label,
      analysisMode:     shift.mode,
      activeModes:      JSON.stringify([shift.mode]),
      totalDrinks:      shift.drinks,
      drinksPerHour:    dph,
      topBartender:     shift.bartender || '—',
      confidenceScore:  confScore,
      confidenceLabel:  shift.confidence === 'green' ? 'High confidence' : shift.confidence === 'yellow' ? 'Medium confidence' : 'Low confidence',
      confidenceColor:  shift.confidence,
      hasTheftFlag:     hasTheft,
      unrungDrinks:     shift.unrung,
      cameraLabel:      'Bar Cam',
      createdAt,
      finishedAt,
      status:           'done',
      isLive:           false,
      totalEntries:     shift.entries ?? 0,
      totalExits:       shift.entries ? Math.round(shift.entries * 0.85) : 0,
      peakOccupancy:    shift.peak ?? 0,
      bottleCount:      shift.bottles ?? 0,
      peakBottleCount:  shift.bottles ? shift.bottles + 4 : 0,
      pourCount:        shift.pours ?? 0,
      totalPouredOz:    shift.pours ? parseFloat((shift.pours * 1.3).toFixed(1)) : 0,
      overPours:        hasTheft ? Math.ceil(shift.unrung / 2) : 0,
      cameraAngle:      'overhead',
      reviewCount:      hasTheft ? shift.unrung + 1 : 0,
      serveSnapshots:   JSON.stringify(DEMO_SERVE_SNAPSHOTS),
      bartenderBreakdown: breakdown,
    } as unknown as VenueScopeJob;
  }

  const historicJobs = historicShifts.map((s, i) => makeHistoricJob(s, i + 200));

  return [liveJob, lastNightJob, ...historicJobs]
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

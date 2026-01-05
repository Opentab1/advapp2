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
  closed: [
    { song: null, artist: null, art: null }
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
 * Generate historical data for a time range
 */
export function generateDemoHistoricalData(venueId: string, range: TimeRange): HistoricalData {
  const now = Date.now();
  const data: SensorData[] = [];
  
  // Calculate time range
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
      interval = 15 * 60 * 1000; // 15 minutes
      break;
    case '7d':
      startTime = now - (7 * 24 * 60 * 60 * 1000);
      interval = 60 * 60 * 1000; // 1 hour
      break;
    case '30d':
      startTime = now - (30 * 24 * 60 * 60 * 1000);
      interval = 4 * 60 * 60 * 1000; // 4 hours
      break;
    case '90d':
      startTime = now - (90 * 24 * 60 * 60 * 1000);
      interval = 12 * 60 * 60 * 1000; // 12 hours
      break;
    default:
      startTime = now - (24 * 60 * 60 * 1000);
      interval = 15 * 60 * 1000;
  }
  
  // Generate data points
  for (let timestamp = startTime; timestamp <= now; timestamp += interval) {
    data.push(generateSensorData(new Date(timestamp)));
  }
  
  return {
    data,
    venueId,
    range
  };
}

/**
 * Generate demo occupancy metrics
 * Target: 430 people currently in venue
 */
export function generateDemoOccupancyMetrics(): OccupancyMetrics {
  const hour = new Date().getHours();
  const isClosedHours = hour >= 2 && hour < 16;
  
  // Demo always shows ~430 current occupancy (busy venue!)
  const current = isClosedHours ? 0 : DEMO_TARGET_OCCUPANCY + Math.floor(Math.random() * 20 - 10);
  
  // Realistic numbers for a venue that's had 430 people
  const todayEntries = 892 + Math.floor(Math.random() * 50); // ~900 entries today
  const todayExits = todayEntries - current; // Math works out to ~430 inside
  
  // Dwell time for a packed venue - people staying ~2 hours
  const avgDwellTimeMinutes = 115 + Math.floor(Math.random() * 20); // ~2 hours avg
  
  return {
    current,
    todayEntries,
    todayExits,
    todayTotal: todayEntries,
    peakOccupancy: 458, // Peak was even higher tonight!
    peakTime: '22:15',
    sevenDayAvg: 385,
    fourteenDayAvg: 372,
    thirtyDayAvg: 358,
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
 * Numbers reflect a high-volume venue with 430+ nightly guests
 */
export function generateDemoWeeklyMetrics(): WeeklyMetrics {
  return {
    avgComfort: 76.2,
    avgTemperature: 71.8,
    avgDecibels: 81.4, // Louder with big crowds
    avgHumidity: 52.3,
    peakHours: ['9-10 PM', '10-11 PM', '11-12 AM'],
    totalCustomers: 5847, // ~835/night average
    totalRevenue: 312500, // ~$53/person average
    topSongs: [
      { song: 'Blinding Lights', plays: 89 },
      { song: 'Uptown Funk', plays: 76 },
      { song: 'Mr. Brightside', plays: 71 },
      { song: 'Levitating', plays: 68 },
      { song: 'Don\'t Stop Believin\'', plays: 64 }
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
      description: 'Generated $94,250 in revenue with an average of $51.03 per customer, showing strong performance this week.',
      trend: 'up',
      value: '$94,250'
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

  const summary = `This week showed good environmental conditions with an average comfort score of 78.5. Total revenue reached $94,250 across 1,847 customers, with peak activity during 6-7 PM, 8-9 PM, 9-10 PM. The energetic atmosphere and curated music selection contributed to strong guest satisfaction and spending.`;

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
  // Scale up for monthly (30 days vs 7 days)
  metrics.totalCustomers = Math.floor(metrics.totalCustomers * 4.3);
  metrics.totalRevenue = Math.floor(metrics.totalRevenue * 4.3);
  
  const insights: ReportInsight[] = [
    {
      category: 'Performance',
      title: 'Monthly Overview',
      description: `This month showed exceptional growth with 7,942 total customers and $405,475 in revenue, representing a 12% increase over last month.`,
      trend: 'up',
      value: '$405K'
    },
    {
      category: 'Growth',
      title: 'Customer Traffic',
      description: 'Daily average of 265 customers with peak weekends reaching 350+ guests.',
      trend: 'up',
      value: '7,942'
    },
    {
      category: 'Revenue',
      title: 'Sales Trends',
      description: 'Average spend per customer maintained at $51.03, with strong performance in premium menu items.',
      trend: 'stable',
      value: '$51.03'
    }
  ];

  return {
    id: `report-monthly-${Date.now()}`,
    weekStart: weekStart.toISOString(),
    weekEnd: weekEnd.toISOString(),
    generatedAt: new Date().toISOString(),
    summary: 'Monthly performance exceeded targets with 12% revenue growth. Peak activity during weekend evenings, with Friday and Saturday showing the strongest performance. Customer satisfaction remained high with optimal environmental conditions.',
    insights,
    metrics,
    recommendations: [
      'Capitalize on weekend success by introducing premium tasting menus on Fridays and Saturdays.',
      'Consider extending happy hour on Wednesdays to boost mid-week traffic.',
      'Launch loyalty program to convert first-time weekend visitors into regulars.',
      'Optimize staffing for identified peak hours: 6-10 PM on weekends.'
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

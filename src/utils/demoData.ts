import type { SensorData, HistoricalData, TimeRange, OccupancyMetrics, Location, WeeklyReport, WeeklyMetrics, ReportInsight } from '../types';

/**
 * Check if this is the demo account
 */
export function isDemoAccount(venueId?: string): boolean {
  return venueId === 'theshowcaselounge';
}

/**
 * Generate realistic sensor data for a given timestamp
 */
function generateSensorData(timestamp: Date): SensorData {
  const hour = timestamp.getHours();
  const dayOfWeek = timestamp.getDay();
  
  // Busier on weekends (Friday=5, Saturday=6), peak hours 6pm-11pm
  const isWeekend = dayOfWeek === 5 || dayOfWeek === 6;
  const isPeakHour = hour >= 18 && hour <= 23;
  const isLunchRush = hour >= 11 && hour <= 14;
  const isClosedHours = hour >= 2 && hour < 10; // Closed 2am-10am
  
  // Base noise level with peaks
  let baseNoise = isClosedHours ? 45 : 65;
  if (isPeakHour) baseNoise += 15;
  if (isLunchRush) baseNoise += 8;
  if (isWeekend) baseNoise += 5;
  
  const decibels = baseNoise + (Math.random() * 10 - 5);
  
  // Temperature (cooler at night)
  const baseTemp = 72;
  const tempVariation = hour < 6 ? -2 : (hour > 18 ? -1 : 0);
  const indoorTemp = baseTemp + tempVariation + (Math.random() * 3 - 1.5);
  const outdoorTemp = indoorTemp - 5 + (Math.random() * 4 - 2);
  
  // Humidity
  const humidity = 45 + (Math.random() * 20 - 10);
  
  // Light (brighter during day, dimmer at night)
  const isDaytime = hour >= 10 && hour <= 20;
  const light = isDaytime ? 350 + (Math.random() * 100 - 50) : 150 + (Math.random() * 50 - 25);
  
  // Occupancy (more people during peak hours)
  let occupancyBase = isClosedHours ? 0 : 30;
  if (isPeakHour) occupancyBase = 120;
  if (isLunchRush) occupancyBase = 80;
  if (isWeekend) occupancyBase += 30;
  
  const current = Math.floor(Math.max(0, occupancyBase + (Math.random() * 20 - 10)));
  const entries = Math.floor(current * 1.5 + Math.random() * 10);
  const exits = Math.floor(entries * 0.9 + Math.random() * 5);
  
  return {
    timestamp: timestamp.toISOString(),
    decibels: Math.round(decibels * 10) / 10,
    light: Math.round(light * 10) / 10,
    indoorTemp: Math.round(indoorTemp * 10) / 10,
    outdoorTemp: Math.round(outdoorTemp * 10) / 10,
    humidity: Math.round(humidity * 10) / 10,
    currentSong: getRandomSong(hour),
    artist: getRandomArtist(hour),
    albumArt: getRandomAlbumArt(hour),
    occupancy: {
      current,
      entries,
      exits,
      capacity: 200
    }
  };
}

/**
 * Song playlists based on time of day
 */
const SONGS = {
  daytime: [
    { song: "Good Vibrations", artist: "The Beach Boys", art: "https://i.scdn.co/image/ab67616d0000b273e319baafd16e84f0408af2a0" },
    { song: "Walking on Sunshine", artist: "Katrina and the Waves", art: "https://i.scdn.co/image/ab67616d0000b273a7e4654c5c4b6a8e4e7f6f1a" },
    { song: "Don't Stop Believin'", artist: "Journey", art: "https://i.scdn.co/image/ab67616d0000b2731fe09a8e8e7f6f1ab67616d0" },
    { song: "Sweet Caroline", artist: "Neil Diamond", art: "https://i.scdn.co/image/ab67616d0000b273e319baafd16e84f0408af2a0" },
    { song: "Here Comes the Sun", artist: "The Beatles", art: "https://i.scdn.co/image/ab67616d0000b273dc30583ba717007b00cceb25" },
    { song: "Three Little Birds", artist: "Bob Marley", art: "https://i.scdn.co/image/ab67616d0000b273fea0200445a1e05389e167b5" },
    { song: "Lovely Day", artist: "Bill Withers", art: "https://i.scdn.co/image/ab67616d0000b273bd5ec58e02e60ccb7d0c971a" }
  ],
  evening: [
    { song: "Uptown Funk", artist: "Mark Ronson ft. Bruno Mars", art: "https://i.scdn.co/image/ab67616d0000b2739e2f95ae77cf436017ada9cb" },
    { song: "Shut Up and Dance", artist: "Walk the Moon", art: "https://i.scdn.co/image/ab67616d0000b2731e0c142f42a0e97d8a643a78" },
    { song: "Can't Stop the Feeling", artist: "Justin Timberlake", art: "https://i.scdn.co/image/ab67616d0000b273ed317ec3fc4e18a0d5822a1e" },
    { song: "Mr. Brightside", artist: "The Killers", art: "https://i.scdn.co/image/ab67616d0000b273ccdddd46119a4ff53eaf1f5d" },
    { song: "24K Magic", artist: "Bruno Mars", art: "https://i.scdn.co/image/ab67616d0000b273232711f7d66a48bf9984e61f" },
    { song: "Blinding Lights", artist: "The Weeknd", art: "https://i.scdn.co/image/ab67616d0000b2738863bc11d2aa12b54f5aeb36" },
    { song: "Levitating", artist: "Dua Lipa", art: "https://i.scdn.co/image/ab67616d0000b273be841ba4bc24340152e3a79a" }
  ],
  lateNight: [
    { song: "Closing Time", artist: "Semisonic", art: "https://i.scdn.co/image/ab67616d0000b273e319baafd16e84f0408af2a0" },
    { song: "September", artist: "Earth, Wind & Fire", art: "https://i.scdn.co/image/ab67616d0000b273b265a4c0c0085c0b047ac7dc" },
    { song: "Livin' on a Prayer", artist: "Bon Jovi", art: "https://i.scdn.co/image/ab67616d0000b27395be3a346177524b62a6827f" },
    { song: "Sweet Child O' Mine", artist: "Guns N' Roses", art: "https://i.scdn.co/image/ab67616d0000b27321ebf49b3292c3f0f575f0f5" },
    { song: "Don't Stop Me Now", artist: "Queen", art: "https://i.scdn.co/image/ab67616d0000b273ce4f1737bc8a646c8c4bd25a" },
    { song: "Bohemian Rhapsody", artist: "Queen", art: "https://i.scdn.co/image/ab67616d0000b273ce4f1737bc8a646c8c4bd25a" },
    { song: "Hotel California", artist: "Eagles", art: "https://i.scdn.co/image/ab67616d0000b273b0b60615b97e364e22a21d5f" }
  ],
  closed: [
    { song: "Ambient Lounge Music", artist: "After Hours", art: "https://i.scdn.co/image/ab67616d0000b273e319baafd16e84f0408af2a0" }
  ]
};

function getRandomSong(hour: number): string {
  const isClosedHours = hour >= 2 && hour < 10;
  let playlist = isClosedHours ? SONGS.closed : 
                 hour >= 10 && hour < 17 ? SONGS.daytime :
                 hour >= 17 && hour < 22 ? SONGS.evening : SONGS.lateNight;
  
  const random = playlist[Math.floor(Math.random() * playlist.length)];
  return random.song;
}

function getRandomArtist(hour: number): string {
  const isClosedHours = hour >= 2 && hour < 10;
  let playlist = isClosedHours ? SONGS.closed :
                 hour >= 10 && hour < 17 ? SONGS.daytime :
                 hour >= 17 && hour < 22 ? SONGS.evening : SONGS.lateNight;
  
  const random = playlist[Math.floor(Math.random() * playlist.length)];
  return random.artist;
}

function getRandomAlbumArt(hour: number): string {
  const isClosedHours = hour >= 2 && hour < 10;
  let playlist = isClosedHours ? SONGS.closed :
                 hour >= 10 && hour < 17 ? SONGS.daytime :
                 hour >= 17 && hour < 22 ? SONGS.evening : SONGS.lateNight;
  
  const random = playlist[Math.floor(Math.random() * playlist.length)];
  return random.art;
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
 */
export function generateDemoOccupancyMetrics(): OccupancyMetrics {
  const hour = new Date().getHours();
  const isPeakHour = hour >= 18 && hour <= 23;
  const isClosedHours = hour >= 2 && hour < 10;
  
  const currentBase = isClosedHours ? 0 : isPeakHour ? 120 : 45;
  const current = Math.floor(Math.max(0, currentBase + (Math.random() * 20 - 10)));
  
  return {
    current,
    todayEntries: Math.floor(current * 8 + Math.random() * 50),
    todayExits: Math.floor(current * 7.5 + Math.random() * 40),
    todayTotal: Math.floor(current * 8),
    peakOccupancy: 156,
    peakTime: '21:30',
    sevenDayAvg: 85,
    fourteenDayAvg: 82,
    thirtyDayAvg: 78
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
 */
export function generateDemoWeeklyMetrics(): WeeklyMetrics {
  return {
    avgComfort: 78.5,
    avgTemperature: 71.2,
    avgDecibels: 73.8,
    avgHumidity: 48.5,
    peakHours: ['6-7 PM', '8-9 PM', '9-10 PM'],
    totalCustomers: 1847,
    totalRevenue: 94250,
    topSongs: [
      { song: 'Uptown Funk', plays: 42 },
      { song: 'Mr. Brightside', plays: 38 },
      { song: 'Don\'t Stop Believin\'', plays: 35 },
      { song: 'Shut Up and Dance', plays: 31 },
      { song: 'September', plays: 28 }
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

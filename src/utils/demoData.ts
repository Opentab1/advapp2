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
  const todayEntries = Math.floor(current * 8 + Math.random() * 50);
  
  // Calculate realistic dwell time for a nightclub/lounge
  // During peak hours: longer dwell time (2-3 hours)
  // During off-peak: moderate dwell time (1-2 hours)
  // Using Little's Law: W = L / λ
  let avgDwellTimeMinutes: number | null = null;
  if (todayEntries > 0 && current > 0) {
    // Estimate hourly entry rate based on time of day
    const hourlyEntries = isPeakHour ? todayEntries * 0.15 : todayEntries * 0.08;
    if (hourlyEntries > 0) {
      avgDwellTimeMinutes = Math.round((current / hourlyEntries) * 60);
      // Clamp to reasonable values for a nightclub
      avgDwellTimeMinutes = Math.max(45, Math.min(240, avgDwellTimeMinutes));
    }
  }
  
  return {
    current,
    todayEntries,
    todayExits: Math.floor(current * 7.5 + Math.random() * 40),
    todayTotal: Math.floor(current * 8),
    peakOccupancy: 156,
    peakTime: '21:30',
    sevenDayAvg: 85,
    fourteenDayAvg: 82,
    thirtyDayAvg: 78,
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

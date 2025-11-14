export interface User {
  id: string;
  email: string;
  venueId?: string; // Optional - only for client users
  venueName?: string; // Optional - only for client users
  role: 'owner' | 'manager' | 'staff' | 'admin' | 'sales' | 'support' | 'installer' | 'custom';
  locations?: Location[];
  permissions?: string[]; // For custom roles
}

export interface AdminUser extends User {
  role: 'admin' | 'sales' | 'support' | 'installer';
  venueId: undefined; // Admins don't have venues
  assignedVenues?: string[]; // For sales/support - venues they manage
}

export interface ClientUser extends User {
  role: 'owner' | 'manager' | 'staff' | 'custom';
  venueId: string; // Required for clients
  venueName: string; // Required for clients
}

export interface Location {
  id: string;
  name: string;
  address?: string;
  timezone?: string;
  deviceId?: string;
}

export interface SensorData {
  timestamp: string;
  decibels: number;
  light: number;
  indoorTemp: number;
  outdoorTemp: number;
  humidity: number;
  currentSong?: string;
  albumArt?: string;
  artist?: string;
  occupancy?: OccupancyData;
}

export interface OccupancyData {
  current: number;
  entries: number;
  exits: number;
  capacity?: number;
}

export interface OccupancyMetrics {
  current: number;
  todayEntries: number;
  todayExits: number;
  todayTotal: number;
  sevenDayAvg: number;
  fourteenDayAvg: number;
  thirtyDayAvg: number;
  peakOccupancy: number;
  peakTime?: string;
}

export interface HistoricalData {
  data: SensorData[];
  venueId: string;
  range: TimeRange;
}

export type TimeRange = 'live' | '6h' | '24h' | '7d' | '30d' | '90d';

export interface ComfortLevel {
  score: number; // 0-100
  status: 'excellent' | 'good' | 'fair' | 'poor';
  color: string;
}

export interface ComfortBreakdown {
  overall: ComfortLevel;
  temperature: {
    score: number;
    status: string;
    message: string;
  };
  humidity: {
    score: number;
    status: string;
    message: string;
  };
  sound: {
    score: number;
    status: string;
    message: string;
  };
  lighting: {
    score: number;
    status: string;
    message: string;
  };
}

export interface ChartDataPoint {
  x: Date;
  y: number;
}

export interface DashboardMetrics {
  decibels: number;
  light: number;
  indoorTemp: number;
  outdoorTemp: number;
  humidity: number;
  comfortLevel: ComfortLevel;
  currentSong?: string;
  albumArt?: string;
  lastUpdated: Date;
}

export interface AppSettings {
  theme: 'dark' | 'light';
  soundAlerts: boolean;
  refreshInterval: number; // in seconds
  notifications: boolean;
  venueId: string;
  locationId: string;
  toastPOSEnabled: boolean;
  toastAPIKey?: string;
}

export interface APIError {
  message: string;
  code?: string;
  statusCode?: number;
}

// Toast POS Integration
export interface ToastOrder {
  orderId: string;
  timestamp: string;
  total: number;
  items: ToastOrderItem[];
  tableNumber?: string;
  guestCount?: number;
}

export interface ToastOrderItem {
  name: string;
  quantity: number;
  price: number;
  category: string;
}

export interface ToastMetrics {
  totalOrders: number;
  totalRevenue: number;
  averageOrderValue: number;
  topItems: Array<{ name: string; count: number; revenue: number }>;
  revenueByHour: Array<{ hour: number; revenue: number }>;
}

// Sports Data
export interface SportsGame {
  id: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  status: 'scheduled' | 'live' | 'final';
  startTime: string;
  network?: string;
}

// Song Log
export interface SongLogEntry {
  id: string;
  timestamp: string;
  songName: string;
  artist: string;
  albumArt?: string;
  duration?: number;
  source: 'spotify' | 'youtube' | 'other';
  genre?: string; // For future genre detection
}

// AI Weekly Report
export interface WeeklyReport {
  id: string;
  weekStart: string;
  weekEnd: string;
  generatedAt: string;
  summary: string;
  insights: ReportInsight[];
  metrics: WeeklyMetrics;
  recommendations: string[];
}

export interface ReportInsight {
  category: string;
  title: string;
  description: string;
  trend: 'up' | 'down' | 'stable';
  value: string;
}

export interface WeeklyMetrics {
  avgComfort: number;
  avgTemperature: number;
  avgDecibels: number;
  avgHumidity: number;
  peakHours: string[];
  totalCustomers: number;
  totalRevenue: number;
  topSongs: Array<{ song: string; plays: number }>;
}

export interface User {
  id: string;
  email: string;
  venueId: string;
  venueName: string;
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
}

export interface APIError {
  message: string;
  code?: string;
  statusCode?: number;
}

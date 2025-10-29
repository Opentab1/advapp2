import { format, formatDistance } from 'date-fns';

export function formatDate(date: Date | string, formatStr: string = 'MMM dd, yyyy HH:mm'): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return format(d, formatStr);
}

export function formatRelativeTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return formatDistance(d, new Date(), { addSuffix: true });
}

export function formatNumber(num: number, decimals: number = 1): string {
  return num.toFixed(decimals);
}

export function formatTemperature(temp: number): string {
  return `${temp.toFixed(1)}°F`;
}

export function formatDecibels(db: number): string {
  return `${db.toFixed(1)} dB`;
}

export function formatLight(lux: number): string {
  return `${Math.round(lux)} lux`;
}

export function formatHumidity(humidity: number): string {
  return `${humidity.toFixed(0)}%`;
}

export function formatOccupancy(count: number): string {
  return `${Math.round(count)}`;
}

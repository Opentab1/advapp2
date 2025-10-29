import type { ComfortLevel, SensorData } from '../types';

export function calculateComfortLevel(data: SensorData): ComfortLevel {
  // Temperature score (optimal: 72-76°F)
  let tempScore = 0;
  if (data.indoorTemp >= 72 && data.indoorTemp <= 76) {
    tempScore = 100;
  } else if (data.indoorTemp >= 68 && data.indoorTemp <= 80) {
    const distanceFromIdeal = Math.min(
      Math.abs(data.indoorTemp - 72),
      Math.abs(data.indoorTemp - 76)
    );
    tempScore = 100 - (distanceFromIdeal * 12.5); // 8 degrees away = 0
  } else {
    tempScore = 0;
  }

  // Light score (optimal: >= 300 lux)
  const lightScore = data.light >= 300 ? 100 : (data.light / 300) * 100;

  // Noise score (optimal: <= 75 dB)
  const noiseScore = data.decibels <= 75 ? 100 : Math.max(0, 100 - (data.decibels - 75) * 2);

  // Calculate average
  const score = Math.round((tempScore + lightScore + noiseScore) / 3);

  // Determine status and color
  let status: ComfortLevel['status'];
  let color: string;

  if (score >= 80) {
    status = 'excellent';
    color = '#00ff88'; // Green
  } else if (score >= 60) {
    status = 'good';
    color = '#00d4ff'; // Cyan
  } else if (score >= 40) {
    status = 'fair';
    color = '#ffd700'; // Yellow
  } else {
    status = 'poor';
    color = '#ff4444'; // Red
  }

  return { score, status, color };
}

export function getComfortMessage(level: ComfortLevel): string {
  switch (level.status) {
    case 'excellent':
      return 'Optimal environment conditions';
    case 'good':
      return 'Comfortable environment';
    case 'fair':
      return 'Environment could be improved';
    case 'poor':
      return 'Suboptimal conditions detected';
  }
}

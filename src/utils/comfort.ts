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

export function calculateComfortBreakdown(data: SensorData): import('../types').ComfortBreakdown {
  // Temperature score (optimal: 72-76°F)
  let tempScore = 0;
  let tempStatus = '';
  let tempMessage = '';
  
  if (data.indoorTemp >= 72 && data.indoorTemp <= 76) {
    tempScore = 100;
    tempStatus = 'Excellent';
    tempMessage = 'Temperature is in optimal range';
  } else if (data.indoorTemp >= 68 && data.indoorTemp <= 80) {
    const distanceFromIdeal = Math.min(
      Math.abs(data.indoorTemp - 72),
      Math.abs(data.indoorTemp - 76)
    );
    tempScore = Math.round(100 - (distanceFromIdeal * 12.5));
    tempStatus = tempScore >= 70 ? 'Good' : 'Fair';
    tempMessage = `Temperature is ${data.indoorTemp > 76 ? 'slightly warm' : 'slightly cool'}`;
  } else {
    tempScore = 0;
    tempStatus = 'Poor';
    tempMessage = `Temperature is ${data.indoorTemp > 80 ? 'too warm' : 'too cool'}`;
  }

  // Humidity score (optimal: 40-60%)
  let humidityScore = 0;
  let humidityStatus = '';
  let humidityMessage = '';
  
  if (data.humidity >= 40 && data.humidity <= 60) {
    humidityScore = 100;
    humidityStatus = 'Excellent';
    humidityMessage = 'Humidity level is optimal';
  } else if (data.humidity >= 30 && data.humidity <= 70) {
    const distanceFromIdeal = Math.min(
      Math.abs(data.humidity - 40),
      Math.abs(data.humidity - 60)
    );
    humidityScore = Math.round(100 - (distanceFromIdeal * 5));
    humidityStatus = humidityScore >= 70 ? 'Good' : 'Fair';
    humidityMessage = `Humidity is ${data.humidity > 60 ? 'slightly high' : 'slightly low'}`;
  } else {
    humidityScore = 0;
    humidityStatus = 'Poor';
    humidityMessage = `Humidity is ${data.humidity > 70 ? 'too high' : 'too low'}`;
  }

  // Sound score (optimal: <= 75 dB)
  let soundScore = 0;
  let soundStatus = '';
  let soundMessage = '';
  
  if (data.decibels <= 75) {
    soundScore = 100;
    soundStatus = 'Excellent';
    soundMessage = 'Sound level is comfortable';
  } else if (data.decibels <= 85) {
    soundScore = Math.round(100 - ((data.decibels - 75) * 10));
    soundStatus = soundScore >= 70 ? 'Good' : 'Fair';
    soundMessage = 'Sound level is moderately elevated';
  } else {
    soundScore = Math.max(0, 100 - ((data.decibels - 75) * 2));
    soundStatus = 'Poor';
    soundMessage = 'Sound level is too high';
  }

  // Light score (optimal: >= 300 lux)
  let lightScore = 0;
  let lightStatus = '';
  let lightMessage = '';
  
  if (data.light >= 300) {
    lightScore = 100;
    lightStatus = 'Excellent';
    lightMessage = 'Lighting is ideal';
  } else if (data.light >= 200) {
    lightScore = Math.round((data.light / 300) * 100);
    lightStatus = lightScore >= 70 ? 'Good' : 'Fair';
    lightMessage = 'Lighting is adequate';
  } else {
    lightScore = Math.round((data.light / 300) * 100);
    lightStatus = 'Poor';
    lightMessage = 'Lighting is insufficient';
  }

  // Calculate overall comfort level
  const overallComfortLevel = calculateComfortLevel(data);

  return {
    overall: overallComfortLevel,
    temperature: {
      score: tempScore,
      status: tempStatus,
      message: tempMessage
    },
    humidity: {
      score: humidityScore,
      status: humidityStatus,
      message: humidityMessage
    },
    sound: {
      score: soundScore,
      status: soundStatus,
      message: soundMessage
    },
    lighting: {
      score: lightScore,
      status: lightStatus,
      message: lightMessage
    }
  };
}

/**
 * Pulse Store - Simple shared state for Pulse Score and Weather
 * 
 * Allows the Pulse page to share the current score and weather with the Header.
 */

import { useState, useEffect } from 'react';

export interface WeatherData {
  temperature: number;
  icon: string;
}

type ScoreListener = (score: number | null) => void;
type WeatherListener = (weather: WeatherData | null) => void;

class PulseStore {
  private score: number | null = null;
  private weather: WeatherData | null = null;
  private scoreListeners: Set<ScoreListener> = new Set();
  private weatherListeners: Set<WeatherListener> = new Set();
  
  getScore(): number | null {
    return this.score;
  }
  
  setScore(score: number | null): void {
    if (this.score !== score) {
      this.score = score;
      this.scoreListeners.forEach(listener => listener(score));
    }
  }
  
  subscribeScore(listener: ScoreListener): () => void {
    this.scoreListeners.add(listener);
    return () => this.scoreListeners.delete(listener);
  }
  
  getWeather(): WeatherData | null {
    return this.weather;
  }
  
  setWeather(weather: WeatherData | null): void {
    // Only update if values changed
    if (
      this.weather?.temperature !== weather?.temperature ||
      this.weather?.icon !== weather?.icon
    ) {
      this.weather = weather;
      this.weatherListeners.forEach(listener => listener(weather));
    }
  }
  
  subscribeWeather(listener: WeatherListener): () => void {
    this.weatherListeners.add(listener);
    return () => this.weatherListeners.delete(listener);
  }
}

export const pulseStore = new PulseStore();

// React hook for pulse score
export function usePulseScore(): number | null {
  const [score, setScore] = useState<number | null>(pulseStore.getScore());
  
  useEffect(() => {
    return pulseStore.subscribeScore(setScore);
  }, []);
  
  return score;
}

// React hook for weather
export function useWeather(): WeatherData | null {
  const [weather, setWeather] = useState<WeatherData | null>(pulseStore.getWeather());
  
  useEffect(() => {
    return pulseStore.subscribeWeather(setWeather);
  }, []);
  
  return weather;
}

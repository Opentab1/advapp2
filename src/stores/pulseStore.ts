/**
 * Pulse Store - Simple shared state for Pulse Score, Weather, and Data Connection
 * 
 * Allows the Pulse page to share state with the Header.
 */

import { useState, useEffect } from 'react';

export interface WeatherData {
  temperature: number;
  icon: string;
}

export interface DataConnectionStatus {
  isConnected: boolean;
  lastUpdated: Date | null;
  dataAgeSeconds: number;
}

type ScoreListener = (score: number | null) => void;
type WeatherListener = (weather: WeatherData | null) => void;
type ConnectionListener = (status: DataConnectionStatus) => void;

class PulseStore {
  private score: number | null = null;
  private weather: WeatherData | null = null;
  private connectionStatus: DataConnectionStatus = { isConnected: false, lastUpdated: null, dataAgeSeconds: Infinity };
  private scoreListeners: Set<ScoreListener> = new Set();
  private weatherListeners: Set<WeatherListener> = new Set();
  private connectionListeners: Set<ConnectionListener> = new Set();
  
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
  
  getConnectionStatus(): DataConnectionStatus {
    return this.connectionStatus;
  }
  
  setConnectionStatus(status: DataConnectionStatus): void {
    if (
      this.connectionStatus.isConnected !== status.isConnected ||
      this.connectionStatus.dataAgeSeconds !== status.dataAgeSeconds
    ) {
      this.connectionStatus = status;
      this.connectionListeners.forEach(listener => listener(status));
    }
  }
  
  subscribeConnection(listener: ConnectionListener): () => void {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
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

// React hook for data connection status
export function useDataConnection(): DataConnectionStatus {
  const [status, setStatus] = useState<DataConnectionStatus>(pulseStore.getConnectionStatus());
  
  useEffect(() => {
    return pulseStore.subscribeConnection(setStatus);
  }, []);
  
  return status;
}

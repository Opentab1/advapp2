/**
 * useIntelligence - Hook for AI-powered insights
 * 
 * Provides:
 * - Smart actions with historical context
 * - Trend alerts
 * - Peak predictions
 * - What-if scenarios
 * - Daily briefing
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import intelligenceService, {
  SmartAction,
  TrendAlert,
  PeakPrediction,
  WhatIfScenario,
  DailyBriefing,
} from '../services/intelligence.service';
import apiService from '../services/api.service';
import authService from '../services/auth.service';
import type { SensorData } from '../types';

interface UseIntelligenceOptions {
  enabled?: boolean;
  currentData?: SensorData | null;
  weather?: { temperature: number; conditions?: string; condition?: string } | null;
}

interface UseIntelligenceReturn {
  // Data
  smartActions: SmartAction[];
  trendAlerts: TrendAlert[];
  peakPrediction: PeakPrediction | null;
  whatIfScenarios: WhatIfScenario[];
  dailyBriefing: DailyBriefing | null;
  
  // State
  loading: boolean;
  error: string | null;
  
  // Actions
  refresh: () => Promise<void>;
  dismissAlert: (alertId: string) => void;
}

export function useIntelligence(options: UseIntelligenceOptions = {}): UseIntelligenceReturn {
  const { enabled = true, currentData, weather } = options;
  
  const user = authService.getStoredUser();
  const venueId = user?.venueId || '';
  
  // State
  const [historicalData, setHistoricalData] = useState<SensorData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(new Set());
  
  // Fetch historical data for analysis
  const fetchHistoricalData = useCallback(async () => {
    if (!venueId || !enabled) {
      setLoading(false);
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      // Fetch 14 days of data for pattern analysis
      const result = await apiService.getHistoricalData(venueId, '14d');
      if (result?.data) {
        setHistoricalData(result.data);
      }
    } catch (err: any) {
      console.error('Failed to fetch intelligence data:', err);
      setError(err.message || 'Failed to load intelligence data');
    } finally {
      setLoading(false);
    }
  }, [venueId, enabled]);
  
  // Initial fetch
  useEffect(() => {
    fetchHistoricalData();
  }, [fetchHistoricalData]);
  
  // Normalize weather data
  const normalizedWeather = useMemo(() => {
    if (!weather) return undefined;
    return {
      temperature: weather.temperature,
      condition: weather.condition || weather.conditions || '',
    };
  }, [weather]);
  
  // Generate smart actions
  const smartActions = useMemo(() => {
    if (!currentData || historicalData.length === 0) return [];
    return intelligenceService.generateSmartActions(
      currentData,
      historicalData,
      normalizedWeather
    );
  }, [currentData, historicalData, normalizedWeather]);
  
  // Detect trend alerts
  const allTrendAlerts = useMemo(() => {
    if (!currentData || historicalData.length === 0) return [];
    return intelligenceService.detectTrendAlerts(currentData, historicalData);
  }, [currentData, historicalData]);
  
  // Filter out dismissed alerts
  const trendAlerts = useMemo(() => {
    return allTrendAlerts.filter(a => !dismissedAlerts.has(a.id));
  }, [allTrendAlerts, dismissedAlerts]);
  
  // Peak prediction
  const peakPrediction = useMemo(() => {
    if (historicalData.length === 0) return null;
    return intelligenceService.predictPeakHour(historicalData);
  }, [historicalData]);
  
  // What-if scenarios
  const whatIfScenarios = useMemo(() => {
    if (!currentData || historicalData.length === 0) return [];
    return intelligenceService.generateWhatIfScenarios(currentData, historicalData);
  }, [currentData, historicalData]);
  
  // Daily briefing
  const dailyBriefing = useMemo(() => {
    if (historicalData.length === 0) return null;
    return intelligenceService.generateDailyBriefing(
      historicalData,
      normalizedWeather
    );
  }, [historicalData, normalizedWeather]);
  
  // Dismiss alert
  const dismissAlert = useCallback((alertId: string) => {
    setDismissedAlerts(prev => new Set([...prev, alertId]));
  }, []);
  
  return {
    smartActions,
    trendAlerts,
    peakPrediction,
    whatIfScenarios,
    dailyBriefing,
    loading,
    error,
    refresh: fetchHistoricalData,
    dismissAlert,
  };
}

export default useIntelligence;

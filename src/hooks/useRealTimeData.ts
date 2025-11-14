import { useState, useEffect, useCallback } from 'react';
import type { SensorData } from '../types';
import apiService from '../services/api.service';
import iotService from '../services/iot.service';

interface UseRealTimeDataOptions {
  venueId: string;
  interval?: number; // in milliseconds
  enabled?: boolean;
}

export function useRealTimeData({ venueId, interval = 10000, enabled = true }: UseRealTimeDataOptions) {
  const [data, setData] = useState<SensorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usingIoT, setUsingIoT] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const liveData = await apiService.getLiveData(venueId);
      setData(liveData);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  }, [venueId]);

  useEffect(() => {
    if (!enabled) return;

    let intervalId: NodeJS.Timeout | undefined;

    // Use HTTP polling only (IoT disabled for now)
    console.log('📡 Using HTTP polling for data updates');
    setUsingIoT(false);
    
    // Initial fetch
    fetchData();
    
    // Set up polling interval
    intervalId = setInterval(() => {
      fetchData();
    }, interval);

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [fetchData, interval, enabled, venueId]);

  return { data, loading, error, refetch: fetchData, usingIoT };
}

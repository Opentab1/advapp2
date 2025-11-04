import { useState, useEffect, useCallback } from 'react';
import type { SensorData } from '../types';
import apiService from '../services/api.service';
import iotService from '../services/iot.service';

interface UseRealTimeDataOptions {
  venueId: string;
  interval?: number; // in milliseconds
  enabled?: boolean;
}

export function useRealTimeData({ venueId, interval = 15000, enabled = true }: UseRealTimeDataOptions) {
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
      setData(null);
      setError(err.message || 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  }, [venueId]);

  useEffect(() => {
    if (!enabled) return;

    let unsubscribe: (() => void) | undefined;
    let intervalId: NodeJS.Timeout | undefined;

    // Try to connect to AWS IoT for real-time streaming
    iotService.connect(venueId).then(() => {
      if (iotService.isConnected()) {
        console.log('✅ Using AWS IoT for real-time data');
        setUsingIoT(true);
        setLoading(false);
        
        // Subscribe to IoT messages - this replaces polling
        unsubscribe = iotService.onMessage((sensorData) => {
          setData(sensorData);
          setError(null);
        });
      } else {
        // IoT connection failed, fall back to polling
        console.log('⚠️ AWS IoT unavailable, using polling fallback');
        fetchData();
        intervalId = setInterval(() => {
          fetchData();
        }, interval);
      }
    }).catch((err) => {
      console.log('⚠️ AWS IoT unavailable, using polling fallback:', err);
      // IoT connection failed, fall back to polling
      fetchData();
      intervalId = setInterval(() => {
        fetchData();
      }, interval);
    });

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
      if (unsubscribe) {
        unsubscribe();
      }
      if (usingIoT) {
        iotService.disconnect();
      }
    };
  }, [fetchData, interval, enabled, venueId, usingIoT]);

  return { data, loading, error, refetch: fetchData, usingIoT };
}

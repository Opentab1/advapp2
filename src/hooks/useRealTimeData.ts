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
      setError(err.message || 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  }, [venueId]);

  useEffect(() => {
    if (!enabled) return;

    // Connect to AWS IoT for real-time streaming
    iotService.connect(venueId).then(() => {
      if (iotService.isConnected()) {
        console.log('✅ Using AWS IoT for real-time data');
        setUsingIoT(true);
        setLoading(false);
        
        // Subscribe to IoT messages
        const unsubscribe = iotService.onMessage((sensorData) => {
          setData(sensorData);
          setError(null);
        });
        
        return unsubscribe;
      } else {
        setError('Failed to connect to AWS IoT. Please check your configuration.');
        setLoading(false);
      }
    }).catch((err) => {
      console.error('❌ AWS IoT connection failed:', err);
      setError(err.message || 'Failed to connect to AWS IoT');
      setLoading(false);
      // Do not fall back to polling/mock data - require real MQTT connection
    });

    return () => {
      if (usingIoT) {
        iotService.disconnect();
      }
    };
  }, [fetchData, interval, enabled, venueId, usingIoT]);

  return { data, loading, error, refetch: fetchData, usingIoT };
}

import { useState, useEffect, useCallback } from 'react';
import type { SensorData } from '../types';
import apiService from '../services/api.service';
import iotService from '../services/iot.service';

interface UseRealTimeDataOptions {
  venueId: string;
  locationId?: string;
  interval?: number; // legacy support
  enabled?: boolean;
}

export function useRealTimeData({ venueId, locationId, enabled = true }: UseRealTimeDataOptions) {
  const [data, setData] = useState<SensorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usingIoT, setUsingIoT] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const liveData = await apiService.getLiveData(venueId);
      setData(liveData);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch data');
    } finally {
      setLoading(false);
      setUsingIoT(false);
    }
  }, [venueId]);

  useEffect(() => {
    if (!enabled) return;

    let cancel = false;
    setUsingIoT(false);
    setLoading(true);
    setError(null);

    const initialize = async () => {
      try {
        await iotService.connect({ venueId, locationId });
      } catch (err: any) {
        console.error('Failed to connect to AWS IoT, falling back to API', err);
        if (!cancel) {
          setUsingIoT(false);
          await fetchData();
        }
        return;
      }

      if (!cancel) {
        console.log('✅ Using AWS IoT for real-time data');
      }
    };

    initialize();

    const unsubscribe = iotService.onMessage((sensorData) => {
      if (cancel) return;
      setUsingIoT(true);
      setLoading(false);
      setError(null);
      setData(sensorData);
    });

    return () => {
      cancel = true;
      unsubscribe();
      iotService.disconnect();
    };
  }, [fetchData, enabled, venueId, locationId]);

  const refetch = useCallback(async () => {
    try {
      await iotService.connect({ venueId, locationId });
    } catch (err) {
      await fetchData();
    }
  }, [fetchData, venueId, locationId]);

  return { data, loading, error, refetch, usingIoT };
}

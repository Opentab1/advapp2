import { useEffect, useState, useCallback } from 'react';
import occupancyService from '../services/occupancy.service';
import type { OccupancyLive, OccupancyAggregate, OccupancyPeriod } from '../types';

interface UseOccupancyOptions {
  venueId: string;
  refreshIntervalMs?: number;
  periods?: OccupancyPeriod[];
  enabled?: boolean;
}

export function useOccupancy({
  venueId,
  refreshIntervalMs = 30000,
  periods = ['1d', '7d', '14d'],
  enabled = true
}: UseOccupancyOptions) {
  const [live, setLive] = useState<OccupancyLive | null>(null);
  const [aggregates, setAggregates] = useState<OccupancyAggregate[] | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const [liveData, agg] = await Promise.all([
        occupancyService.getLiveOccupancy(venueId),
        occupancyService.getOccupancyAggregates(venueId, periods)
      ]);
      setLive(liveData);
      setAggregates(agg);
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch occupancy');
    } finally {
      setLoading(false);
    }
  }, [venueId, periods, enabled]);

  useEffect(() => {
    if (!enabled) return;
    fetchAll();
    const id = setInterval(fetchAll, refreshIntervalMs);
    return () => clearInterval(id);
  }, [fetchAll, refreshIntervalMs, enabled]);

  return {
    live,
    aggregates,
    loading,
    error,
    refetch: fetchAll
  };
}

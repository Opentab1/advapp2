/**
 * History - Analytics and trends page (Redesigned)
 * 
 * Shows historical data with:
 * - Smart header with date context
 * - Modern time range selector
 * - Summary stats at top
 * - Collapsible chart cards
 * - Period comparison
 * - FAB for export/refresh
 */

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';

// Components
import { HistoryHeader } from '../components/history/HistoryHeader';
import { TimeRangeSelector } from '../components/history/TimeRangeSelector';
import { SummaryStats } from '../components/history/SummaryStats';
import { ChartCard } from '../components/history/ChartCard';
import { PeriodComparison } from '../components/history/PeriodComparison';
import { CardSkeleton, EmptyHistoryState, ErrorState } from '../components/common/LoadingState';
import { PullToRefresh } from '../components/common/PullToRefresh';
import { CollapsibleSection } from '../components/common/CollapsibleSection';

// Hooks & Services
import { usePeriodComparison } from '../hooks/usePeriodComparison';
import apiService from '../services/api.service';
import authService from '../services/auth.service';
import { historicalCache } from '../services/dynamodb.service';
import { haptic } from '../utils/haptics';
import type { TimeRange, HistoricalData } from '../types';

// ============ MAIN COMPONENT ============

export function History() {
  const user = authService.getStoredUser();
  const venueId = user?.venueId || '';
  const venueName = user?.venueName || 'Venue';
  
  const [timeRange, setTimeRange] = useState<TimeRange>('7d');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<HistoricalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fetchId, setFetchId] = useState(0);
  const [comparisonCollapsed, setComparisonCollapsed] = useState(false);
  
  // Period comparison
  const periodComparison = usePeriodComparison(venueId, timeRange);
  
  // Fetch data
  const fetchData = useCallback(async (forceRefresh = false) => {
    if (!venueId) return;
    
    setLoading(true);
    setError(null);
    setData(null);
    setFetchId(prev => prev + 1);
    
    try {
      if (forceRefresh) {
        historicalCache.clearRange(venueId, timeRange);
      }
      
      const result = await apiService.getHistoricalData(venueId, timeRange);
      setData(result);
    } catch (err: any) {
      setError(err.message || 'Failed to load historical data');
    } finally {
      setLoading(false);
    }
  }, [venueId, timeRange]);
  
  useEffect(() => {
    fetchData(false);
  }, [fetchData]);
  
  const handleRefresh = async () => {
    haptic('medium');
    await fetchData(true);
  };
  
  const handleExport = () => {
    haptic('medium');
    if (data?.data && data.data.length > 0) {
      apiService.exportToCSV(data.data, true, venueName);
    }
  };
  
  const handleTimeRangeChange = (range: TimeRange) => {
    if (venueId) {
      historicalCache.clearRange(venueId, range);
    }
    setTimeRange(range);
  };
  
  return (
    <PullToRefresh onRefresh={handleRefresh} disabled={loading}>
      <div className="space-y-5 pb-20">
        {/* Smart Header */}
        <HistoryHeader
          timeRange={timeRange}
          dataPoints={data?.data?.length}
        />
        
        {/* Time Range Selector */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.05 }}
        >
          <TimeRangeSelector
            value={timeRange}
            onChange={handleTimeRangeChange}
            disabled={loading}
          />
        </motion.div>
        
        {/* Error State */}
        {error && (
          <ErrorState
            title="Couldn't load history"
            message={error}
            onRetry={handleRefresh}
          />
        )}
        
        {/* Loading State */}
        {loading && !data && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[1, 2, 3, 4].map(i => (
                <CardSkeleton key={i} height="h-20" />
              ))}
            </div>
            <CardSkeleton height="h-64" />
            <CardSkeleton height="h-64" />
          </div>
        )}
        
        {/* Data Content */}
        {data?.data && data.data.length > 0 && (
          <>
            {/* Summary Stats */}
            <SummaryStats data={data.data} timeRange={timeRange} />
            
            {/* Period Comparison (Collapsible) */}
            <CollapsibleSection
              id="comparison"
              title="Period Comparison"
              collapsed={comparisonCollapsed}
              onToggle={() => setComparisonCollapsed(!comparisonCollapsed)}
              showHeader={true}
            >
              <motion.div
                key={`comparison-${timeRange}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                <PeriodComparison
                  currentPeriod={periodComparison.currentPeriod}
                  previousPeriod={periodComparison.previousPeriod}
                  config={periodComparison.config}
                  loading={periodComparison.loading}
                />
              </motion.div>
            </CollapsibleSection>
            
            {/* Charts - Desktop: 2-column grid */}
            <motion.div
              key={`charts-${timeRange}-${fetchId}`}
              className="grid grid-cols-1 lg:grid-cols-2 gap-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.15 }}
            >
              {/* Primary Charts (Full Width on Mobile) */}
              <ChartCard
                data={data.data}
                metric="pulse"
                timeRange={timeRange}
                fetchId={fetchId}
              />

              <ChartCard
                data={data.data}
                metric="dwell"
                timeRange={timeRange}
                fetchId={fetchId}
              />

              <ChartCard
                data={data.data}
                metric="occupancy"
                timeRange={timeRange}
                fetchId={fetchId}
              />
              
              <ChartCard
                data={data.data}
                metric="decibels"
                timeRange={timeRange}
                fetchId={fetchId}
              />
              
              <ChartCard
                data={data.data}
                metric="light"
                timeRange={timeRange}
                fetchId={fetchId}
                defaultCollapsed={true}
              />
            </motion.div>
          </>
        )}
        
        {/* No Data State */}
        {!loading && (!data?.data || data.data.length === 0) && !error && (
          <EmptyHistoryState onRetry={handleRefresh} />
        )}
      </div>
    </PullToRefresh>
  );
}

export default History;

/**
 * LiveView Component - Staged Loading Implementation
 * 
 * This component implements the WHOOP-style "hero first" loading pattern:
 * 1. Pulse Score appears in <0.5 seconds (current sensor data)
 * 2. Today's stats fade in (occupancy, entries)
 * 3. Context loads in background (weather, comparisons)
 * 4. Historical charts load on-demand
 * 
 * Current data is NEVER cached - always fresh.
 */

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  RefreshCw,
  Download,
} from 'lucide-react';
import { useStagedLoading } from '../hooks/useStagedLoading';
import { ScoreRings } from './ScoreRings';
import { LiveContext } from './LiveContext';
import { TimeRangeToggle } from './TimeRangeToggle';
import { ConnectionStatus } from './ConnectionStatus';
import { LiveMetricsPanel } from './LiveMetricsPanel';
import { DataChart } from './DataChart';
import { LoadingSpinner } from './LoadingSpinner';
// Note: barDay utils available if needed for future calculations
// import { calculateBarDayOccupancy, formatBarDayRange } from '../utils/barDay';
import apiService from '../services/api.service';
import type { TimeRange, SensorData, Location } from '../types';

interface LiveViewProps {
  venueId: string;
  venueName: string;
  currentLocation?: Location;
  onExport?: (data: SensorData[]) => void;
}

export function LiveView({ 
  venueId, 
  venueName, 
  currentLocation,
  onExport 
}: LiveViewProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>('live');
  
  // Use staged loading hook
  const {
    heroData,
    heroLoading,
    heroError,
    todayOccupancy,
    todayLoading,
    weatherData,
    historicalData,
    historicalLoading,
    historicalFromCache,
    refreshHero,
    loadHistoricalRange,
    hasHeroData,
  } = useStagedLoading({
    venueId,
    enabled: true,
    pollingInterval: 15000, // 15 seconds
  });
  
  // Track bar day occupancy (calculated from 24h data)
  const [barDayOccupancy, setBarDayOccupancy] = useState<{
    entries: number;
    exits: number;
    current: number;
  } | null>(null);
  
  // Load bar day occupancy when we have today's data
  useEffect(() => {
    if (todayOccupancy) {
      // Use occupancy metrics directly for now
      // The full bar day calculation will happen when historical data loads
      setBarDayOccupancy({
        entries: todayOccupancy.todayEntries || 0,
        exits: todayOccupancy.todayExits || 0,
        current: todayOccupancy.current || 0,
      });
    }
  }, [todayOccupancy]);
  
  // Handle time range change
  const handleTimeRangeChange = (range: TimeRange) => {
    setTimeRange(range);
    if (range !== 'live') {
      loadHistoricalRange(range);
    }
  };
  
  // Handle refresh
  const handleRefresh = () => {
    if (timeRange === 'live') {
      refreshHero();
    } else {
      loadHistoricalRange(timeRange);
    }
  };
  
  // Handle export
  const handleExport = () => {
    const dataToExport = timeRange === 'live' 
      ? heroData ? [heroData] : []
      : historicalData?.data || [];
    
    if (dataToExport.length > 0 && onExport) {
      onExport(dataToExport);
    } else if (dataToExport.length > 0) {
      apiService.exportToCSV(dataToExport, true, venueName);
    }
  };
  
  // Get current data based on view
  const currentData = timeRange === 'live' 
    ? heroData 
    : historicalData?.data?.[historicalData.data.length - 1] || null;
  
  const chartData = timeRange === 'live'
    ? []
    : historicalData?.data || [];
  
  return (
    <>
      {/* Time Range Selector */}
      <motion.div
        className="mb-6"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex flex-wrap items-center justify-between gap-4 mb-2">
          <div className="flex flex-col gap-2">
            <h2 className="text-2xl font-bold gradient-text">
              {timeRange === 'live' ? 'Live Monitoring' : 'Historical Data'}
            </h2>
            {/* Connection status for live view */}
            {currentLocation && timeRange === 'live' && (
              <ConnectionStatus 
                isConnected={hasHeroData}
                usingIoT={false}
                locationName={currentLocation.name}
              />
            )}
          </div>
          
          <div className="flex gap-2">
            <motion.button
              onClick={handleRefresh}
              className="btn-secondary px-4 py-2 flex items-center gap-2"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              title="Refresh (R)"
              disabled={heroLoading || historicalLoading}
            >
              <RefreshCw className={`w-4 h-4 ${(heroLoading || historicalLoading) ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </motion.button>
            
            {/* Export button shows when viewing historical data */}
            {timeRange !== 'live' && (
              <motion.button
                onClick={handleExport}
                className="btn-primary px-4 py-2 flex items-center gap-2"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                title="Export CSV (E)"
                disabled={!currentData || historicalLoading}
              >
                <Download className="w-4 h-4" />
                <span className="hidden sm:inline">Export</span>
              </motion.button>
            )}
          </div>
        </div>

        {/* Time range toggle */}
        <TimeRangeToggle 
          selected={timeRange} 
          onChange={handleTimeRangeChange} 
        />
      </motion.div>

      {/* ============ LIVE VIEW ============ */}
      {timeRange === 'live' && (
        <>
          {/* HERO: Pulse Score - Loads First */}
          {heroLoading && !hasHeroData ? (
            <div className="flex items-center justify-center py-12">
              <div className="flex flex-col items-center gap-3">
                <div className="w-12 h-12 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
                <p className="text-sm text-warm-500">Loading Pulse Score...</p>
              </div>
            </div>
          ) : heroError && !hasHeroData ? (
            <motion.div
              className="mb-6 p-6 rounded-xl bg-red-50 border border-red-200"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <p className="text-red-700 font-medium">Unable to load current data</p>
              <p className="text-sm text-red-600 mt-1">{heroError}</p>
              <button
                onClick={refreshHero}
                className="mt-3 px-4 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg text-sm font-medium"
              >
                Try Again
              </button>
            </motion.div>
          ) : (
            <>
              {/* Score Rings - HERO COMPONENT */}
              <motion.div 
                className="mb-6"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3 }}
              >
                <ScoreRings sensorData={currentData} />
              </motion.div>
              
              {/* Live Context + Comparisons - Loads after hero */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2 }}
              >
                <LiveContext 
                  currentOccupancy={barDayOccupancy?.current ?? todayOccupancy?.current ?? null}
                  todayEntries={barDayOccupancy?.entries ?? todayOccupancy?.todayEntries ?? null}
                />
              </motion.div>
            </>
          )}

          {/* Live Metrics Panel - Loads with hero */}
          {hasHeroData && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
            >
              <LiveMetricsPanel
                sensorData={heroData}
                occupancy={barDayOccupancy ?? todayOccupancy}
                weatherData={weatherData}
                loading={todayLoading}
              />
            </motion.div>
          )}
        </>
      )}

      {/* ============ HISTORICAL VIEW ============ */}
      {timeRange !== 'live' && (
        <>
          {/* Show cached data indicator */}
          {historicalFromCache && (
            <motion.div
              className="mb-4 p-3 rounded-lg bg-primary-50 border border-primary-100"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
                <span className="text-sm text-primary">
                  Showing cached data • Refreshing in background...
                </span>
              </div>
            </motion.div>
          )}
          
          {/* Loading state for historical */}
          {historicalLoading && !historicalData ? (
            <div className="flex items-center justify-center py-12">
              <LoadingSpinner />
            </div>
          ) : chartData.length > 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-6"
            >
              {/* Charts */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <DataChart
                  data={chartData}
                  metric="occupancy"
                  title="Occupancy Over Time"
                  color="#00d4ff"
                />
                
                <DataChart
                  data={chartData}
                  metric="decibels"
                  title="Sound Level Over Time"
                  color="#00d4ff"
                />
                
                <DataChart
                  data={chartData}
                  metric="light"
                  title="Light Level Over Time"
                  color="#ffd700"
                />
              </div>
            </motion.div>
          ) : (
            <div className="text-center py-12">
              <p className="text-warm-500">No historical data available for this range.</p>
            </div>
          )}
        </>
      )}
    </>
  );
}

export default LiveView;

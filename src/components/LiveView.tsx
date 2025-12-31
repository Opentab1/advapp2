/**
 * LiveView Component - "At a Glance" Tab
 * 
 * This is the data exploration view - raw metrics and charts.
 * The Pulse Score rings are now on Pulse+ page.
 * 
 * Structure:
 * 1. Live Metrics Panel (sound, light, temp, occupancy)
 * 2. Context (weather, comparisons)
 * 3. Historical Charts (on-demand)
 */

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  RefreshCw,
  Download,
  Activity,
} from 'lucide-react';
import { useStagedLoading } from '../hooks/useStagedLoading';
import { LiveContext } from './LiveContext';
import { TimeRangeToggle } from './TimeRangeToggle';
import { ConnectionStatus } from './ConnectionStatus';
import { LiveMetricsPanel } from './LiveMetricsPanel';
import { DataChart } from './DataChart';
import { LoadingSpinner } from './LoadingSpinner';
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
    pollingInterval: 15000,
  });
  
  // Track bar day occupancy
  const [barDayOccupancy, setBarDayOccupancy] = useState<{
    entries: number;
    exits: number;
    current: number;
  } | null>(null);
  
  useEffect(() => {
    if (todayOccupancy) {
      setBarDayOccupancy({
        entries: todayOccupancy.todayEntries || 0,
        exits: todayOccupancy.todayExits || 0,
        current: todayOccupancy.current || 0,
      });
    }
  }, [todayOccupancy]);
  
  const handleTimeRangeChange = (range: TimeRange) => {
    setTimeRange(range);
    if (range !== 'live') {
      loadHistoricalRange(range);
    }
  };
  
  const handleRefresh = () => {
    if (timeRange === 'live') {
      refreshHero();
    } else {
      loadHistoricalRange(timeRange);
    }
  };
  
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
  
  const currentData = timeRange === 'live' 
    ? heroData 
    : historicalData?.data?.[historicalData.data.length - 1] || null;
  
  const chartData = timeRange === 'live'
    ? []
    : historicalData?.data || [];
  
  return (
    <>
      {/* Header */}
      <motion.div
        className="mb-6"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Activity className="w-6 h-6 text-primary" />
              <h2 className="text-2xl font-bold text-warm-800">
                {timeRange === 'live' ? 'Live Metrics' : 'Historical Data'}
              </h2>
            </div>
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
              disabled={heroLoading || historicalLoading}
            >
              <RefreshCw className={`w-4 h-4 ${(heroLoading || historicalLoading) ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </motion.button>
            
            {timeRange !== 'live' && (
              <motion.button
                onClick={handleExport}
                className="btn-primary px-4 py-2 flex items-center gap-2"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                disabled={!currentData || historicalLoading}
              >
                <Download className="w-4 h-4" />
                <span className="hidden sm:inline">Export</span>
              </motion.button>
            )}
          </div>
        </div>

        <TimeRangeToggle 
          selected={timeRange} 
          onChange={handleTimeRangeChange} 
        />
      </motion.div>

      {/* ============ LIVE VIEW ============ */}
      {timeRange === 'live' && (
        <>
          {heroLoading && !hasHeroData ? (
            <div className="flex items-center justify-center py-12">
              <div className="flex flex-col items-center gap-3">
                <div className="w-12 h-12 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
                <p className="text-sm text-warm-500">Loading live data...</p>
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
              {/* Live Metrics Panel - The main content */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-6"
              >
                <LiveMetricsPanel
                  sensorData={heroData}
                  occupancy={barDayOccupancy ?? todayOccupancy}
                  weatherData={weatherData}
                  loading={todayLoading}
                />
              </motion.div>

              {/* Context + Comparisons */}
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
        </>
      )}

      {/* ============ HISTORICAL VIEW ============ */}
      {timeRange !== 'live' && (
        <>
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

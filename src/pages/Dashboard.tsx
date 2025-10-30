import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  Thermometer, 
  Sun, 
  Volume2, 
  Droplets, 
  Download,
  RefreshCw,
  Cloud,
  Users,
  UserPlus,
  UserMinus,
  TrendingUp
} from 'lucide-react';
import { TopBar } from '../components/TopBar';
import { Sidebar } from '../components/Sidebar';
import { AnimatedBackground } from '../components/AnimatedBackground';
import { MetricCard } from '../components/MetricCard';
import { ComfortGauge } from '../components/ComfortGauge';
import { ComfortBreakdownCard } from '../components/ComfortBreakdown';
import { SportsWidget } from '../components/SportsWidget';
import { DataChart } from '../components/DataChart';
import { TimeRangeToggle } from '../components/TimeRangeToggle';
import { NowPlaying } from '../components/NowPlaying';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { ErrorMessage } from '../components/ErrorMessage';
import { ConnectionStatus } from '../components/ConnectionStatus';
import { Settings } from './Settings';
import { SongLog } from './SongLog';
import { Reports } from './Reports';
import { useRealTimeData } from '../hooks/useRealTimeData';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { calculateComfortLevel, calculateComfortBreakdown } from '../utils/comfort';
import { formatTemperature, formatDecibels, formatLight, formatHumidity } from '../utils/format';
import apiService from '../services/api.service';
import authService from '../services/auth.service';
import locationService from '../services/location.service';
import songLogService from '../services/song-log.service';
import { VENUE_CONFIG } from '../config/amplify';
import type { TimeRange, SensorData, HistoricalData, OccupancyMetrics } from '../types';

export function Dashboard() {
  const user = authService.getStoredUser();
  const [activeTab, setActiveTab] = useState('live');
  const [timeRange, setTimeRange] = useState<TimeRange>('live');
  const [historicalData, setHistoricalData] = useState<HistoricalData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [soundAlerts, setSoundAlerts] = useState(true);
  const [occupancyMetrics, setOccupancyMetrics] = useState<OccupancyMetrics | null>(null);
  
  // Use Ferg's Sports Bar venue ID
  const venueId = user?.venueId || VENUE_CONFIG.venueId;
  
  // Multi-location support (locations within the venue)
  const locations = user?.locations || locationService.getLocations();
  const [currentLocationId, setCurrentLocationId] = useState<string>(
    locationService.getCurrentLocationId() || VENUE_CONFIG.locationId
  );
  
  const currentLocation = locations.find(l => l.id === currentLocationId);

  // Real-time data for live view (uses venue ID for data isolation)
  const { 
    data: liveData, 
    loading: liveLoading, 
    error: liveError,
    refetch,
    usingIoT
  } = useRealTimeData({
    venueId: venueId,
    enabled: timeRange === 'live'
  });
  
  // Log songs when they change
  useEffect(() => {
    if (liveData?.currentSong) {
      const lastSong = localStorage.getItem('lastSongLogged');
      const currentSongKey = `${liveData.currentSong}-${liveData.timestamp}`;
      
      if (lastSong !== currentSongKey) {
        songLogService.addSong({
          timestamp: liveData.timestamp,
          songName: liveData.currentSong,
          artist: liveData.artist || 'Unknown Artist',
          albumArt: liveData.albumArt,
          source: 'spotify'
        });
        localStorage.setItem('lastSongLogged', currentSongKey);
      }
    }
  }, [liveData?.currentSong, liveData?.timestamp]);
  
  // Handle location change
  const handleLocationChange = (locationId: string) => {
    setCurrentLocationId(locationId);
    locationService.setCurrentLocationId(locationId);
    // Refetch data for new location
    if (timeRange === 'live') {
      refetch();
    } else {
      loadHistoricalData();
    }
  };

  // Load historical data when time range changes
  useEffect(() => {
    if (timeRange !== 'live') {
      loadHistoricalData();
    }
  }, [timeRange]);

  // Load occupancy metrics
  useEffect(() => {
    loadOccupancyMetrics();
    // Refresh occupancy metrics every 30 seconds
    const interval = setInterval(loadOccupancyMetrics, 30000);
    return () => clearInterval(interval);
  }, [venueId]);

  const loadOccupancyMetrics = async () => {
    try {
      const metrics = await apiService.getOccupancyMetrics(venueId);
      setOccupancyMetrics(metrics);
    } catch (err: any) {
      console.error('Failed to load occupancy metrics:', err);
    }
  };

  const loadHistoricalData = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Use venueId for data isolation, not locationId
      const data = await apiService.getHistoricalData(venueId, timeRange);
      setHistoricalData(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = () => {
    const dataToExport = timeRange === 'live' 
      ? liveData ? [liveData] : []
      : historicalData?.data || [];
    
    if (dataToExport.length > 0) {
      apiService.exportToCSV(dataToExport);
    }
  };

  const handleLogout = async () => {
    await authService.logout();
    window.location.reload();
  };

  // Keyboard shortcuts
  useKeyboardShortcuts({
    onRefresh: refetch,
    onExport: handleExport
  });

  // Get current data based on view
  const currentData: SensorData | null = timeRange === 'live' 
    ? liveData 
    : historicalData?.data[historicalData.data.length - 1] || null;

  const chartData: SensorData[] = timeRange === 'live'
    ? liveData ? [liveData] : []
    : historicalData?.data || [];

  const comfortLevel = currentData ? calculateComfortLevel(currentData) : null;
  const comfortBreakdown = currentData ? calculateComfortBreakdown(currentData) : null;

  // Show loading state
  if (timeRange === 'live' && liveLoading && !liveData) {
    return <LoadingSpinner fullScreen />;
  }

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden">
      <AnimatedBackground />

      {/* Top Bar */}
      <TopBar
        venueName={VENUE_CONFIG.venueName}
        onLogout={handleLogout}
        soundAlerts={soundAlerts}
        onToggleSoundAlerts={() => setSoundAlerts(!soundAlerts)}
        locations={locations}
        currentLocationId={currentLocationId}
        onLocationChange={handleLocationChange}
      />

      <div className="flex flex-1 relative z-10">
        {/* Sidebar */}
        <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />

        {/* Main Content */}
        <main className="flex-1 p-4 md:p-6 lg:p-8 overflow-auto pb-24 lg:pb-8">
          {activeTab === 'live' || activeTab === 'history' ? (
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
                    {currentLocation && (
                      <ConnectionStatus 
                        isConnected={!!liveData}
                        usingIoT={usingIoT}
                        locationName={VENUE_CONFIG.locationName}
                      />
                    )}
                  </div>
                  
                  <div className="flex gap-2">
                    <motion.button
                      onClick={refetch}
                      className="btn-secondary px-4 py-2 flex items-center gap-2"
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      title="Refresh (R)"
                    >
                      <RefreshCw className="w-4 h-4" />
                      <span className="hidden sm:inline">Refresh</span>
                    </motion.button>
                    
                    <motion.button
                      onClick={handleExport}
                      className="btn-primary px-4 py-2 flex items-center gap-2"
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      title="Export CSV (E)"
                      disabled={!currentData}
                    >
                      <Download className="w-4 h-4" />
                      <span className="hidden sm:inline">Export</span>
                    </motion.button>
                  </div>
                </div>

                <TimeRangeToggle selected={timeRange} onChange={setTimeRange} />
              </motion.div>

              {/* Error Message */}
              {(error || liveError) && (
                <ErrorMessage 
                  message={error || liveError || 'Unknown error'} 
                  onRetry={timeRange === 'live' ? refetch : loadHistoricalData}
                />
              )}

              {/* Loading State */}
              {loading && <LoadingSpinner />}

              {/* Dashboard Content */}
              {!loading && currentData && (
                <>
                  {/* Occupancy Metrics Section */}
                  {occupancyMetrics && (
                    <motion.div
                      className="mb-6"
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.1 }}
                    >
                      <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                        <Users className="w-5 h-5 text-cyan-400" />
                        Occupancy Tracking
                      </h3>
                      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                        <MetricCard
                          title="Current Occupancy"
                          value={occupancyMetrics.current.toString()}
                          unit="people"
                          icon={Users}
                          color="#00d4ff"
                          delay={0}
                        />
                        
                        <MetricCard
                          title="Today's Entries"
                          value={occupancyMetrics.todayEntries.toString()}
                          unit="people"
                          icon={UserPlus}
                          color="#4ade80"
                          delay={0.05}
                        />
                        
                        <MetricCard
                          title="Today's Exits"
                          value={occupancyMetrics.todayExits.toString()}
                          unit="people"
                          icon={UserMinus}
                          color="#f87171"
                          delay={0.1}
                        />
                        
                        <MetricCard
                          title="Peak Today"
                          value={occupancyMetrics.peakOccupancy.toString()}
                          unit={occupancyMetrics.peakTime ? `@ ${occupancyMetrics.peakTime}` : 'people'}
                          icon={TrendingUp}
                          color="#fbbf24"
                          delay={0.15}
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="glass-card p-4">
                          <div className="text-sm text-gray-400 mb-1">7-Day Average</div>
                          <div className="text-2xl font-bold text-cyan-400">
                            {occupancyMetrics.sevenDayAvg}
                            <span className="text-sm text-gray-400 ml-2">people/day</span>
                          </div>
                        </div>
                        
                        <div className="glass-card p-4">
                          <div className="text-sm text-gray-400 mb-1">14-Day Average</div>
                          <div className="text-2xl font-bold text-cyan-400">
                            {occupancyMetrics.fourteenDayAvg}
                            <span className="text-sm text-gray-400 ml-2">people/day</span>
                          </div>
                        </div>
                        
                        <div className="glass-card p-4">
                          <div className="text-sm text-gray-400 mb-1">30-Day Average</div>
                          <div className="text-2xl font-bold text-cyan-400">
                            {occupancyMetrics.thirtyDayAvg}
                            <span className="text-sm text-gray-400 ml-2">people/day</span>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {/* Hero Metrics Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
                    <MetricCard
                      title="Sound Level"
                      value={formatDecibels(currentData.decibels).split(' ')[0]}
                      unit="dB"
                      icon={Volume2}
                      color="#00d4ff"
                      delay={0}
                    />
                    
                    <MetricCard
                      title="Light Level"
                      value={formatLight(currentData.light).split(' ')[0]}
                      unit="lux"
                      icon={Sun}
                      color="#ffd700"
                      delay={0.1}
                    />
                    
                    <MetricCard
                      title="Indoor Temp"
                      value={formatTemperature(currentData.indoorTemp).split('°')[0]}
                      unit="°F"
                      icon={Thermometer}
                      color="#ff6b6b"
                      delay={0.2}
                    />
                    
                    <MetricCard
                      title="Outdoor Temp"
                      value={formatTemperature(currentData.outdoorTemp).split('°')[0]}
                      unit="°F"
                      icon={Cloud}
                      color="#60a5fa"
                      delay={0.25}
                    />
                    
                    <MetricCard
                      title="Humidity"
                      value={formatHumidity(currentData.humidity).replace('%', '')}
                      unit="%"
                      icon={Droplets}
                      color="#4ecdc4"
                      delay={0.3}
                    />
                  </div>

                  {/* Now Playing & Comfort Level */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                    <div className="lg:col-span-2">
                      {currentData.currentSong && (
                        <NowPlaying 
                          song={currentData.currentSong} 
                          albumArt={currentData.albumArt}
                        />
                      )}
                    </div>
                    
                    {comfortLevel && (
                      <div className="flex justify-center lg:justify-end">
                        <ComfortGauge comfortLevel={comfortLevel} />
                      </div>
                    )}
                  </div>

                  {/* Comfort Breakdown & Sports */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                    {comfortBreakdown && (
                      <ComfortBreakdownCard breakdown={comfortBreakdown} />
                    )}
                    <SportsWidget />
                  </div>

                  {/* Charts */}
                  {chartData.length > 0 && (
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
                      
                      <DataChart
                        data={chartData}
                        metric="indoorTemp"
                        title="Indoor Temperature"
                        color="#ff6b6b"
                      />
                      
                      <DataChart
                        data={chartData}
                        metric="outdoorTemp"
                        title="Outdoor Temperature"
                        color="#60a5fa"
                      />
                    </div>
                  )}
                </>
              )}
            </>
          ) : activeTab === 'songs' ? (
            <SongLog />
          ) : activeTab === 'reports' ? (
            <Reports />
          ) : activeTab === 'settings' ? (
            <Settings />
          ) : (
            // Placeholder for other tabs
            <motion.div
              className="flex items-center justify-center h-full"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <div className="text-center">
                <h2 className="text-2xl font-bold gradient-text mb-2">
                  {activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}
                </h2>
                <p className="text-gray-400">Coming soon...</p>
              </div>
            </motion.div>
          )}
        </main>
      </div>
    </div>
  );
}

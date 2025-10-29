import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  Thermometer, 
  Sun, 
  Volume2, 
  Droplets, 
  Download,
  RefreshCw
} from 'lucide-react';
import { TopBar } from '../components/TopBar';
import { Sidebar } from '../components/Sidebar';
import { AnimatedBackground } from '../components/AnimatedBackground';
import { MetricCard } from '../components/MetricCard';
import { ComfortGauge } from '../components/ComfortGauge';
import { DataChart } from '../components/DataChart';
import { TimeRangeToggle } from '../components/TimeRangeToggle';
import { NowPlaying } from '../components/NowPlaying';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { ErrorMessage } from '../components/ErrorMessage';
import { useRealTimeData } from '../hooks/useRealTimeData';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { calculateComfortLevel } from '../utils/comfort';
import { formatTemperature, formatDecibels, formatLight, formatHumidity } from '../utils/format';
import apiService from '../services/api.service';
import authService from '../services/auth.service';
import type { TimeRange, SensorData, HistoricalData } from '../types';

export function Dashboard() {
  const user = authService.getStoredUser();
  const [activeTab, setActiveTab] = useState('live');
  const [timeRange, setTimeRange] = useState<TimeRange>('live');
  const [historicalData, setHistoricalData] = useState<HistoricalData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [soundAlerts, setSoundAlerts] = useState(true);

  // Real-time data for live view
  const { 
    data: liveData, 
    loading: liveLoading, 
    error: liveError,
    refetch 
  } = useRealTimeData({
    venueId: user?.venueId || 'demo',
    enabled: timeRange === 'live'
  });

  // Load historical data when time range changes
  useEffect(() => {
    if (timeRange !== 'live') {
      loadHistoricalData();
    }
  }, [timeRange]);

  const loadHistoricalData = async () => {
    if (!user) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const data = await apiService.getHistoricalData(user.venueId, timeRange);
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

  // Show loading state
  if (timeRange === 'live' && liveLoading && !liveData) {
    return <LoadingSpinner fullScreen />;
  }

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden">
      <AnimatedBackground />

      {/* Top Bar */}
      <TopBar
        venueName={user?.venueName || 'Demo Venue'}
        onLogout={handleLogout}
        soundAlerts={soundAlerts}
        onToggleSoundAlerts={() => setSoundAlerts(!soundAlerts)}
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
                  <h2 className="text-2xl font-bold gradient-text">
                    {timeRange === 'live' ? 'Live Monitoring' : 'Historical Data'}
                  </h2>
                  
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
                  {/* Hero Metrics Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
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

                  {/* Charts */}
                  {chartData.length > 0 && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
                        metric="humidity"
                        title="Humidity Level"
                        color="#4ecdc4"
                      />
                    </div>
                  )}
                </>
              )}
            </>
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

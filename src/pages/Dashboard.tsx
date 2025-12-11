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
import { PulseScore } from '../components/PulseScore';
import { SportsWidget } from '../components/SportsWidget';
import { DataChart } from '../components/DataChart';
import { TimeRangeToggle } from '../components/TimeRangeToggle';
import { NowPlaying } from '../components/NowPlaying';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { ErrorMessage } from '../components/ErrorMessage';
import { ConnectionStatus } from '../components/ConnectionStatus';
import { TermsModal } from '../components/TermsModal';
import { DemoModeBanner } from '../components/DemoModeBanner';
import { Settings } from './Settings';
import { SongLog } from './SongLog';
import { Reports } from './Reports';
import { Support } from './Support';
import { isAdminUser, isClientUser, canSkipTerms } from '../utils/userRoles';
import { useRealTimeData } from '../hooks/useRealTimeData';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { calculateComfortLevel, calculateComfortBreakdown } from '../utils/comfort';
import { formatTemperature, formatDecibels, formatLight, formatHumidity } from '../utils/format';
import apiService from '../services/api.service';
import authService from '../services/auth.service';
import locationService from '../services/location.service';
import songLogService from '../services/song-log.service';
import { isDemoAccount } from '../utils/demoData';
import type { TimeRange, SensorData, HistoricalData, OccupancyMetrics, Location } from '../types';

export function Dashboard() {
  const [user, setUser] = useState(authService.getStoredUser());
  const [userLoading, setUserLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('live');
  const [timeRange, setTimeRange] = useState<TimeRange>('live');
  const [historicalData, setHistoricalData] = useState<HistoricalData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [soundAlerts, setSoundAlerts] = useState(true);
  const [occupancyMetrics, setOccupancyMetrics] = useState<OccupancyMetrics | null>(null);
  
  // Check if this is demo mode
  const isDemoMode = isDemoAccount(user?.venueId);
  
  // Terms of Service modal state
  const [showTermsModal, setShowTermsModal] = useState(false);
  
  // Check if user has accepted terms on mount
  useEffect(() => {
    if (user?.email) {
      const termsKey = `pulse_terms_accepted_${user.email}`;
      const hasAccepted = localStorage.getItem(termsKey);
      if (!hasAccepted) {
        setShowTermsModal(true);
      }
    }
  }, [user?.email]);
  
  const handleAcceptTerms = () => {
    if (user?.email) {
      const termsKey = `pulse_terms_accepted_${user.email}`;
      localStorage.setItem(termsKey, 'true');
      localStorage.setItem(`pulse_terms_accepted_date_${user.email}`, new Date().toISOString());
      setShowTermsModal(false);
    }
  };
  
  const handleSkipTerms = () => {
    // Only admins can skip - check permission
    if (canSkipTerms(user)) {
      setShowTermsModal(false);
    }
  };
  
  // Try to refresh user if authenticated but no stored user
  useEffect(() => {
    const refreshUser = async () => {
      if (!user && authService.isAuthenticated() && !userLoading) {
        setUserLoading(true);
        try {
          const refreshedUser = await authService.getCurrentAuthenticatedUser();
          setUser(refreshedUser);
        } catch (error: any) {
          console.error('Failed to refresh user:', error);
          // If refresh fails, logout and redirect to login
          await authService.logout();
          window.location.href = '/login';
        } finally {
          setUserLoading(false);
        }
      }
    };
    
    refreshUser();
  }, [user, userLoading]);
  
  // User must be authenticated
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-blue-900 to-purple-900">
        <div className="max-w-md">
          {userLoading ? (
            <LoadingSpinner fullScreen />
          ) : (
            <ErrorMessage 
              message="Authentication required. Please log in."
              onRetry={() => {
                authService.logout().then(() => window.location.href = '/login');
              }}
            />
          )}
        </div>
      </div>
    );
  }

  // Check if user is admin or client
  const isAdmin = isAdminUser(user);
  const isClient = isClientUser(user);

  // If neither admin nor client (shouldn't happen), show error
  if (!isAdmin && !isClient) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-blue-900 to-purple-900">
        <div className="max-w-md">
          <ErrorMessage 
            message="Invalid user configuration. Please contact support."
            onRetry={() => {
              authService.logout().then(() => window.location.href = '/login');
            }}
          />
        </div>
      </div>
    );
  }

  const venueId = user?.venueId;
  const venueName = user?.venueName || user?.email?.split('@')[0] || 'Your Venue';
  
  // Safety check: If no venueId, show error state
  if (!venueId) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-gray-900 via-purple-900/20 to-blue-900/20">
        <div className="glass-card p-8 max-w-md text-center">
          <h2 className="text-2xl font-bold text-red-400 mb-4">⚠️ Configuration Error</h2>
          <p className="text-gray-300 mb-4">Your user account is missing the venue ID attribute.</p>
          <p className="text-sm text-gray-400">Please contact your administrator to configure your account properly.</p>
          <button
            onClick={() => authService.logout().then(() => window.location.href = '/login')}
            className="btn-secondary mt-6"
          >
            Logout
          </button>
        </div>
      </div>
    );
  }
  
  // Multi-location support (locations within the venue)
  // Always start with empty array to force fresh fetch from DynamoDB
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationsError, setLocationsError] = useState<string | null>(null);
  const [locationsLoading, setLocationsLoading] = useState(false);
  
  // Fetch locations if not already loaded
  useEffect(() => {
    const loadLocations = async () => {
      if (locations.length === 0 && !locationsLoading && venueId) {
        setLocationsLoading(true);
        try {
          // Pass venueId directly instead of fetching from session again
          const fetchedLocations = await locationService.fetchLocationsFromDynamoDB(venueId);
          setLocations(fetchedLocations);
          setLocationsError(null);
          // Set initial location if none selected
          if (!locationService.getCurrentLocationId() && fetchedLocations.length > 0) {
            locationService.setCurrentLocationId(fetchedLocations[0].id);
          }
        } catch (error: any) {
          console.error('Failed to load locations:', error);
          setLocationsError(error.message || 'Failed to load locations');
        } finally {
          setLocationsLoading(false);
        }
      }
    };
    
    loadLocations();
  }, [venueId]);
  
  const [currentLocationId, setCurrentLocationId] = useState<string>(
    locationService.getCurrentLocationId() || ''
  );
  
  // Update currentLocationId when locations load
  useEffect(() => {
    if (locations.length > 0 && !currentLocationId) {
      const newLocationId = locations[0].id;
      setCurrentLocationId(newLocationId);
      locationService.setCurrentLocationId(newLocationId);
    }
  }, [locations, currentLocationId]);
  
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

  // Auto-switch time range based on active tab
  useEffect(() => {
    if (activeTab === 'history' && timeRange === 'live') {
      setTimeRange('24h');
    } else if (activeTab === 'live' && timeRange !== 'live') {
      setTimeRange('live');
    }
  }, [activeTab]);

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
      // Don't set error state - occupancy is optional
      // If it fails, the section just won't render
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
      apiService.exportToCSV(dataToExport, true, venueName);
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

  // If admin user, show admin portal instead
  if (isAdmin) {
    return (
      <>
        {/* Terms of Service Modal - admins can skip */}
        {showTermsModal && (
          <TermsModal 
            onAccept={handleAcceptTerms}
            onSkip={handleSkipTerms}
            userEmail={user?.email || 'User'}
          />
        )}
        <AdminPortal />
      </>
    );
  }

  // Client user dashboard
  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden">
      <AnimatedBackground />
      
      {/* Demo Mode Banner */}
      {isDemoMode && <DemoModeBanner venueName={user?.venueName} />}
      
      {/* Terms of Service Modal - clients must accept */}
      {showTermsModal && (
        <TermsModal 
          onAccept={handleAcceptTerms}
          userEmail={user?.email || 'User'}
        />
      )}

      {/* Top Bar */}
      <TopBar
        venueName={venueName}
        onLogout={handleLogout}
        soundAlerts={soundAlerts}
        onToggleSoundAlerts={() => setSoundAlerts(!soundAlerts)}
        locations={locations}
        currentLocationId={currentLocationId}
        onLocationChange={handleLocationChange}
      />

      {/* Locations Error Banner */}
      {locationsError && locations.length === 0 && (
        <motion.div
          className="mx-4 mt-4 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/30"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-sm font-semibold text-yellow-400">⚠️ Location Configuration Required</span>
              </div>
              <p className="text-sm text-yellow-300/90 mb-3">
                {locationsError}
              </p>
              <div className="text-xs text-yellow-300/70 space-y-2 mb-3">
                <p className="font-semibold text-yellow-300">To fix this:</p>
                <ol className="list-decimal ml-4 space-y-1">
                  <li>Open AWS Console → DynamoDB</li>
                  <li>Find your <code className="px-1 py-0.5 bg-black/20 rounded">VenueConfig</code> table</li>
                  <li>Add location entries for venue: <code className="px-1 py-0.5 bg-black/20 rounded">{venueId}</code></li>
                  <li>Clear cache in Settings page and refresh</li>
                </ol>
              </div>
              <div className="p-2 bg-black/20 rounded text-xs text-yellow-300/60 mb-3">
                <p className="font-semibold mb-1">Required DynamoDB fields:</p>
                <code>locationId, displayName, venueId, address (optional), timezone (optional), deviceId (optional)</code>
              </div>
              <button
                onClick={() => {
                  setActiveTab('settings');
                }}
                className="px-3 py-1.5 rounded bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-300 text-xs font-medium transition-colors"
              >
                Go to Settings → Clear Cache
              </button>
            </div>
          </div>
        </motion.div>
      )}
      
      {/* No Locations Warning (but no error) */}
      {!locationsError && locations.length === 0 && !locationsLoading && (
        <motion.div
          className="mx-4 mt-4 p-4 rounded-lg bg-blue-500/10 border border-blue-500/30"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-semibold text-blue-400">ℹ️ No Locations Found</span>
              </div>
              <p className="text-xs text-blue-300/80 mb-2">
                No locations are configured for your venue yet. You may be seeing cached data from a previous session.
              </p>
              <button
                onClick={() => {
                  locationService.clearCache();
                  window.location.reload();
                }}
                className="px-3 py-1.5 rounded bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 text-xs font-medium transition-colors"
              >
                Clear Cache & Refresh
              </button>
            </div>
          </div>
        </motion.div>
      )}

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
                        locationName={currentLocation.name}
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

                {activeTab === 'history' && (
                  <TimeRangeToggle 
                    selected={timeRange} 
                    onChange={setTimeRange} 
                    excludeLive={true}
                  />
                )}
              </motion.div>

              {/* Warning Message for Limited Historical Data */}
              {!error && !liveError && historicalData?.message && (
                <motion.div
                  className="mb-6 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/30"
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <div className="flex items-start gap-3">
                    <div className="text-yellow-400 text-xl">⚠️</div>
                    <div className="flex-1">
                      <h3 className="text-base font-semibold text-yellow-400 mb-1">Device Offline - Showing Historical Data</h3>
                      <p className="text-sm text-yellow-300">{historicalData.message}</p>
                      <p className="text-xs text-yellow-300/70 mt-2">
                        Your IoT device appears to be offline. Check device power, network connection, or restart the Raspberry Pi.
                      </p>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Error Message */}
              {(error || liveError) && (
                <motion.div
                  className="mb-6 p-6 rounded-lg bg-red-500/10 border border-red-500/30"
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <div className="flex items-start gap-4">
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold text-red-400 mb-2">Unable to Load Data from DynamoDB</h3>
                      <p className="text-sm text-red-300 mb-3">{error || liveError}</p>
                      <div className="text-xs text-red-300/80 mb-4">
                        <p className="font-semibold mb-2">Possible causes:</p>
                        <ul className="list-disc ml-4 space-y-1">
                          <li>GraphQL API endpoint not configured (check <code className="px-1 py-0.5 bg-black/20 rounded">VITE_GRAPHQL_ENDPOINT</code> in .env)</li>
                          <li>AWS AppSync API not set up (see <code className="px-1 py-0.5 bg-black/20 rounded">DYNAMODB_SETUP.md</code>)</li>
                          <li>DynamoDB tables missing or empty (SensorData, VenueConfig, OccupancyMetrics)</li>
                          <li>Invalid venueId in Cognito user attributes (<code className="px-1 py-0.5 bg-black/20 rounded">custom:venueId</code>)</li>
                          <li>AppSync resolvers not configured correctly</li>
                          <li>No sensor data published to DynamoDB yet</li>
                        </ul>
                        <p className="mt-3">
                          <strong>Check browser console (F12)</strong> for detailed error logs.
                        </p>
                        <p className="mt-2">
                          <strong>Your venueId:</strong> <code className="px-1 py-0.5 bg-black/20 rounded">{venueId}</code>
                        </p>
                        <p className="mt-2 text-yellow-300">
                          📚 <strong>Setup Guide:</strong> See <code className="px-1 py-0.5 bg-black/20 rounded">DYNAMODB_SETUP.md</code> for complete instructions
                        </p>
                      </div>
                      <button
                        onClick={timeRange === 'live' ? refetch : loadHistoricalData}
                        className="btn-primary px-4 py-2"
                      >
                        Retry
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Loading State */}
              {loading && <LoadingSpinner />}

              {/* Dashboard Content */}
              {!loading && currentData && (
                <>
                  {/* Pulse Score */}
                  <PulseScore
                    score={comfortLevel?.score ?? null}
                    breakdown={undefined}
                    trend="stable"
                  />

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
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-4 mb-6">
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
                      delay={0.25}
                    />
                    
                    <MetricCard
                      title="Entries"
                      value={occupancyMetrics?.todayEntries.toString() || '0'}
                      unit="people"
                      icon={UserPlus}
                      color="#4ade80"
                      delay={0.3}
                    />
                    
                    <MetricCard
                      title="Exits"
                      value={occupancyMetrics?.todayExits.toString() || '0'}
                      unit="people"
                      icon={UserMinus}
                      color="#f87171"
                      delay={0.35}
                    />
                    
                    <MetricCard
                      title="Total Occupancy"
                      value={occupancyMetrics?.current.toString() || '0'}
                      unit="people"
                      icon={Users}
                      color="#a78bfa"
                      delay={0.4}
                    />
                  </div>

                  {/* Now Playing & Comfort Level */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                    <div className="lg:col-span-2">
                      {currentData.currentSong && (
                        <NowPlaying 
                          song={currentData.currentSong}
                          artist={currentData.artist}
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

                  {/* Comfort Breakdown & Sports - History Tab Only */}
                  {activeTab === 'history' && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                      {comfortBreakdown && (
                        <ComfortBreakdownCard breakdown={comfortBreakdown} />
                      )}
                      <SportsWidget />
                    </div>
                  )}

                  {/* Charts - History Tab Only */}
                  {activeTab === 'history' && chartData.length > 0 && (
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

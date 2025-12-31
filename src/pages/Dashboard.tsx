import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  Sun, 
  Volume2, 
  Download,
  RefreshCw,
  CloudSun,
  Users,
  UserPlus,
  UserMinus,
  TrendingUp,
  Clock
} from 'lucide-react';
import { TopBar } from '../components/TopBar';
import { Sidebar } from '../components/Sidebar';
import { AnimatedBackground } from '../components/AnimatedBackground';
import { MetricCard } from '../components/MetricCard';
import { PulseScoreLive } from '../components/PulseScoreLive';
import { SportsWidget } from '../components/SportsWidget';
import { DataChart } from '../components/DataChart';
import { TimeRangeToggle } from '../components/TimeRangeToggle';
import { NowPlaying } from '../components/NowPlaying';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { ErrorMessage } from '../components/ErrorMessage';
import { ConnectionStatus } from '../components/ConnectionStatus';
import { TermsModal, hasAcceptedTerms } from '../components/TermsModal';
import { DemoModeBanner } from '../components/DemoModeBanner';
import { LiveView } from '../components/LiveView';
import { Settings } from './Settings';
import { SongLog } from './SongLog';
import { Reports } from './Reports';
import { Support } from './Support';
import { Insights } from './Insights';
import { ScoreRings } from '../components/ScoreRings';
import { LiveContext } from '../components/LiveContext';
import { isAdminUser, isClientUser, canSkipTerms } from '../utils/userRoles';
import { useRealTimeData } from '../hooks/useRealTimeData';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { calculateComfortLevel, calculateComfortBreakdown } from '../utils/comfort';
import { formatTemperature, formatDecibels as formatDecibelsLegacy, formatLight as formatLightLegacy, formatHumidity as formatHumidityLegacy } from '../utils/format';
import { formatDwellTime, calculateRecentDwellTime, calculateDwellTimeFromHistory } from '../utils/dwellTime';
import { formatValueNoZero, formatValueAllowZero, formatOccupancy } from '../utils/dataDisplay';
import { calculateBarDayOccupancy, formatBarDayRange, aggregateOccupancyByBarDay } from '../utils/barDay';
import apiService from '../services/api.service';
import authService from '../services/auth.service';
import locationService from '../services/location.service';
import songLogService from '../services/song-log.service';
import weatherService, { WeatherData } from '../services/weather.service';
import venueSettingsService from '../services/venue-settings.service';
import userSettingsService from '../services/user-settings.service';
import { isDemoAccount } from '../utils/demoData';
import { preloadHistoricalData } from '../services/dynamodb.service';
import type { TimeRange, SensorData, HistoricalData, OccupancyMetrics, Location } from '../types';

// Feature flag: Use new staged loading for Live view
const USE_STAGED_LOADING = true;

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
  const [barDayOccupancy, setBarDayOccupancy] = useState<{ entries: number; exits: number; current: number } | null>(null);
  const [periodOccupancy, setPeriodOccupancy] = useState<{ entries: number; exits: number; current: number } | null>(null);
  const [calculatedDwellTime, setCalculatedDwellTime] = useState<number | null>(null);
  const [weatherData, setWeatherData] = useState<WeatherData | null>(null);
  
  // Check if this is demo mode
  const isDemoMode = isDemoAccount(user?.venueId);
  
  // Terms of Service modal state
  const [showTermsModal, setShowTermsModal] = useState(false);
  
  // Check if user has accepted terms on mount
  // First check localStorage (device-level), then check server (account-level)
  useEffect(() => {
    const checkTermsAcceptance = async () => {
      if (user?.email) {
        // Check localStorage first - if accepted on this device, skip
        if (hasAcceptedTerms()) {
          return;
        }
        // Then check server
        const hasAccepted = await userSettingsService.hasAcceptedTerms();
        if (!hasAccepted) {
          setShowTermsModal(true);
        }
      }
    };
    checkTermsAcceptance();
  }, [user?.email]);
  
  const handleAcceptTerms = async () => {
    if (user?.email) {
      await userSettingsService.acceptTerms();
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
  // ============================================
  // BACKGROUND PRELOAD - Option B: Start loading historical data in background
  // This runs once when venueId is available, so comparison data is ready faster
  // ============================================
  useEffect(() => {
    if (venueId && !isDemoMode) {
      // Start background preload - this won't block the UI
      preloadHistoricalData(venueId).catch(err => {
        console.warn('Background preload failed:', err);
        // Don't throw - preload failures shouldn't break the app
      });
    }
  }, [venueId, isDemoMode]);

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
  
  // Track last logged song in memory (deduplication handled by songLogService)
  useEffect(() => {
    if (liveData?.currentSong) {
      // songLogService handles deduplication internally
      songLogService.addSong({
        timestamp: liveData.timestamp,
        songName: liveData.currentSong,
        artist: liveData.artist || 'Unknown Artist',
        albumArt: liveData.albumArt,
        source: 'spotify'
      });
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
      loadHistoricalData(timeRange);
    }
  };

  // Load historical data when time range changes
  useEffect(() => {
    if (timeRange !== 'live') {
      loadHistoricalData(timeRange);
    }
  }, [timeRange]);

  // Time range is now controlled by the toggle on the Live tab
  // No need to auto-switch based on tab anymore

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

  // Load bar day occupancy (3am-3am for bars) and calculate dwell time
  const loadBarDayOccupancy = async () => {
    try {
      // Get venue timezone from current location or default to EST
      const timezone = currentLocation?.timezone || 'America/New_York';
      
      // Fetch last 24 hours of data to ensure we capture the full bar day
      const data = await apiService.getHistoricalData(venueId, '24h');
      
      if (data?.data && data.data.length > 0) {
        const barDayStats = calculateBarDayOccupancy(data.data, timezone);
        setBarDayOccupancy(barDayStats);
        console.log('📊 Bar day occupancy calculated:', barDayStats, `(${formatBarDayRange(timezone)})`);
        
        // Calculate dwell time from last 2 hours of sensor data
        const dwellTime = calculateRecentDwellTime(data.data, 2);
        setCalculatedDwellTime(dwellTime);
        console.log('📊 Dwell time calculated from recent data:', dwellTime ? `${dwellTime} minutes` : 'N/A');
      }
    } catch (err: any) {
      console.error('Failed to load bar day occupancy:', err);
      // Don't set error - this is supplementary data
    }
  };

  // Load bar day occupancy on mount and refresh every 30 seconds
  useEffect(() => {
    if (venueId && currentLocation) {
      loadBarDayOccupancy();
      const interval = setInterval(loadBarDayOccupancy, 30000);
      return () => clearInterval(interval);
    }
  }, [venueId, currentLocation]);

  // Load weather data based on venue address
  const loadWeatherData = async () => {
    // First try to get address from venue settings (user-configured)
    let address = venueId ? venueSettingsService.getFormattedAddress(venueId) : null;
    
    // Fall back to location address from DynamoDB
    if (!address) {
      address = currentLocation?.address || null;
    }
    
    console.log('⛅ Weather lookup - venueId:', venueId);
    console.log('⛅ Weather lookup - address from settings:', venueSettingsService.getFormattedAddress(venueId || ''));
    console.log('⛅ Weather lookup - address from location:', currentLocation?.address);
    console.log('⛅ Weather lookup - using address:', address);
    
    if (!address || address === 'No address provided' || address.trim() === '') {
      console.log('⛅ No valid address available for weather lookup');
      return;
    }
    
    try {
      const weather = await weatherService.getWeatherByAddress(address);
      console.log('⛅ Weather result:', weather);
      if (weather) {
        setWeatherData(weather);
      }
    } catch (err) {
      console.error('Failed to load weather data:', err);
    }
  };

  // Load weather on mount and refresh every 90 minutes
  useEffect(() => {
    // Check for address from venue settings or location
    const settingsAddress = venueId ? venueSettingsService.getFormattedAddress(venueId) : null;
    const locationAddress = currentLocation?.address;
    const address = settingsAddress || locationAddress;
    
    if (address && address !== 'No address provided' && address.trim() !== '') {
      loadWeatherData();
      const interval = setInterval(loadWeatherData, 90 * 60 * 1000); // 90 minutes
      return () => clearInterval(interval);
    }
  }, [currentLocation?.address, venueId]);

  // Refresh weather when switching to live tab (in case address was updated in settings)
  useEffect(() => {
    if (activeTab === 'live') {
      // Check if we have a new address that might need weather data
      const settingsAddress = venueId ? venueSettingsService.getFormattedAddress(venueId) : null;
      if (settingsAddress && !weatherData) {
        loadWeatherData();
      }
    }
  }, [activeTab]);

  const loadHistoricalData = async (range?: TimeRange) => {
    const effectiveRange = range || timeRange;
    setLoading(true);
    setError(null);
    
    console.log(`📊 Loading historical data for range: ${effectiveRange}`);
    
    try {
      // Use venueId for data isolation, not locationId
      const data = await apiService.getHistoricalData(venueId, effectiveRange);
      setHistoricalData(data);
      // Clear any previous errors since we successfully got data (even if empty/old)
      setError(null);
      
      // Calculate period-specific occupancy using bar day logic
      if (data?.data && data.data.length > 0) {
        const timezone = currentLocation?.timezone || 'America/New_York';
        const now = new Date();
        let periodStart: Date;
        
        // Calculate period start based on effectiveRange
        switch (effectiveRange) {
          case '6h':
            periodStart = new Date(now.getTime() - 6 * 60 * 60 * 1000);
            break;
          case '24h':
            periodStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            break;
          case '7d':
            periodStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
          case '30d':
            periodStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            break;
          case '90d':
            periodStart = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
            break;
          default:
            periodStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        }
        
        // Log the data range we received
        const sortedData = [...data.data].sort((a, b) => 
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
        const oldestData = sortedData[0];
        const newestData = sortedData[sortedData.length - 1];
        
        console.log(`📊 Historical data received for ${effectiveRange}:`, {
          requestedRange: `${periodStart.toISOString()} to ${now.toISOString()}`,
          actualRange: `${oldestData?.timestamp} to ${newestData?.timestamp}`,
          totalRecords: data.data.length,
          recordsWithOccupancy: data.data.filter(d => d.occupancy).length
        });
        
        const periodStats = aggregateOccupancyByBarDay(data.data, periodStart, now, timezone);
        
        // Get peak occupancy from data
        let peakCurrent = 0;
        data.data.forEach(item => {
          if (item.occupancy?.current && item.occupancy.current > peakCurrent) {
            peakCurrent = item.occupancy.current;
          }
        });
        
        setPeriodOccupancy({
          entries: periodStats.totalEntries,
          exits: periodStats.totalExits,
          current: peakCurrent
        });
        
        console.log(`📊 Period occupancy calculated for ${effectiveRange}:`, {
          entries: periodStats.totalEntries,
          exits: periodStats.totalExits,
          peakCurrent,
          daysProcessed: periodStats.dailyBreakdown.length,
          dailyBreakdown: periodStats.dailyBreakdown
        });
        
        // Calculate dwell time for this time range
        const rangeHours = {
          '6h': 6,
          '24h': 24,
          '7d': 7 * 24,
          '14d': 14 * 24,
          '30d': 30 * 24,
          '90d': 90 * 24,
          'live': 2 // fallback
        }[effectiveRange] || 24;
        
        const periodDwellTime = calculateDwellTimeFromHistory(data.data, rangeHours);
        setCalculatedDwellTime(periodDwellTime);
        console.log(`📊 Dwell time for ${effectiveRange}: ${periodDwellTime ? `${periodDwellTime} min` : 'N/A'}`);
      } else {
        console.log(`⚠️ No historical data for ${effectiveRange}`);
        setPeriodOccupancy(null);
        setCalculatedDwellTime(null);
      }
    } catch (err: any) {
      // Only set error if we truly failed to connect to DynamoDB
      // Don't show error for "device offline" scenarios (handled by warning banner)
      if (err.message && !err.message.includes('No sensor data has been collected yet')) {
        setError(err.message);
      }
      // If it's a "no data yet" message, just set empty historical data
      setHistoricalData(null);
      setPeriodOccupancy(null);
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

  // Keyboard shortcuts - Export only available when viewing historical data
  useKeyboardShortcuts({
    onRefresh: refetch,
    onExport: timeRange !== 'live' ? handleExport : undefined
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
          {activeTab === 'live' ? (
            USE_STAGED_LOADING ? (
              /* NEW: Staged loading LiveView - loads hero first, then everything else */
              <LiveView
                venueId={venueId}
                venueName={venueName}
                currentLocation={currentLocation}
                onExport={(data) => apiService.exportToCSV(data, true, venueName)}
              />
            ) : (
            <>
              {/* LEGACY: Time Range Selector */}
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
                    {/* Show connection status when viewing live data */}
                    {currentLocation && timeRange === 'live' && (
                      <ConnectionStatus 
                        isConnected={!!liveData}
                        usingIoT={usingIoT}
                        locationName={currentLocation.name}
                      />
                    )}
                  </div>
                  
                  <div className="flex gap-2">
                    <motion.button
                      onClick={timeRange === 'live' ? refetch : () => loadHistoricalData(timeRange)}
                      className="btn-secondary px-4 py-2 flex items-center gap-2"
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      title="Refresh (R)"
                    >
                      <RefreshCw className="w-4 h-4" />
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
                        disabled={!currentData}
                      >
                        <Download className="w-4 h-4" />
                        <span className="hidden sm:inline">Export</span>
                      </motion.button>
                    )}
                  </div>
                </div>

                {/* Time range toggle - always visible */}
                <TimeRangeToggle 
                  selected={timeRange} 
                  onChange={setTimeRange} 
                />
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

              {/* Error Message - Only show for critical setup errors, not routine device offline */}
              {(error || liveError) && 
               (timeRange !== 'live' && (!historicalData || historicalData.data.length === 0)) && 
               !error?.includes('No sensor data found') && 
               !liveError?.includes('No sensor data found') && (
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
                        onClick={timeRange === 'live' ? refetch : () => loadHistoricalData(timeRange)}
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

              {/* Dashboard Content - Always show cards, use dashes when no data */}
              {!loading && (
                <>
                  {/* Pulse Score + Score Rings - Live view only */}
                  {timeRange === 'live' && (
                    <>
                      <div className="mb-6">
                        <ScoreRings sensorData={currentData} />
                      </div>
                      
                      {/* Right Now Context + Comparisons */}
                      <LiveContext 
                        currentOccupancy={barDayOccupancy?.current ?? occupancyMetrics?.current ?? null}
                        todayEntries={barDayOccupancy?.entries ?? occupancyMetrics?.todayEntries ?? null}
                      />
                    </>
                  )}

                  {/* Pulse Score - Historical view */}
                  {timeRange !== 'live' && (
                    <div className="mb-6">
                      <PulseScoreLive sensorData={currentData} />
                    </div>
                  )}

                  {/* LIVE VIEW: Two-column layout with metrics panel + insights */}
                  {timeRange === 'live' && (
                    <div className="flex flex-col lg:flex-row gap-6 mb-6">
                      {/* Left Panel - Live Metrics */}
                      <motion.div
                        className="lg:w-80 flex-shrink-0"
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                      >
                        <div className="glass-card p-4 space-y-3">
                          <h3 className="text-lg font-semibold text-warm-800 mb-4">Live Metrics</h3>
                          
                          {/* Sound Level */}
                          <div className="flex items-center justify-between p-3 bg-warm-50 rounded-xl">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                                <Volume2 className="w-5 h-5 text-primary" />
                              </div>
                              <span className="text-sm text-warm-600">Sound Level</span>
                            </div>
                            <div className="text-right">
                              <div className="text-xl font-bold text-warm-800">{formatValueNoZero(currentData?.decibels)}</div>
                              <div className="text-xs text-warm-500">dB</div>
                            </div>
                          </div>

                          {/* Light Level */}
                          <div className="flex items-center justify-between p-3 bg-warm-50 rounded-xl">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-lg bg-yellow-500/10 flex items-center justify-center">
                                <Sun className="w-5 h-5 text-yellow-500" />
                              </div>
                              <span className="text-sm text-warm-600">Light Level</span>
                            </div>
                            <div className="text-right">
                              <div className="text-xl font-bold text-warm-800">{formatValueAllowZero(currentData?.light)}</div>
                              <div className="text-xs text-warm-500">lux</div>
                            </div>
                          </div>

                          {/* Outdoor Temp */}
                          <div 
                            className={`flex items-center justify-between p-3 bg-warm-50 rounded-xl ${!weatherData ? 'cursor-pointer hover:bg-warm-100' : ''}`}
                            onClick={!weatherData ? () => setActiveTab('settings') : undefined}
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-lg bg-sky-500/10 flex items-center justify-center">
                                <CloudSun className="w-5 h-5 text-sky-500" />
                              </div>
                              <span className="text-sm text-warm-600">Outdoor</span>
                            </div>
                            <div className="text-right">
                              <div className="text-xl font-bold text-warm-800">
                                {weatherData ? `${weatherData.temperature}°` : '--'}
                              </div>
                              <div className="text-xs text-warm-500">
                                {weatherData ? weatherData.icon : 'Set address'}
                              </div>
                            </div>
                          </div>

                          {/* Divider */}
                          <div className="border-t border-warm-200 my-2"></div>

                          {/* Entries Today */}
                          <div className="flex items-center justify-between p-3 bg-warm-50 rounded-xl">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                                <UserPlus className="w-5 h-5 text-green-500" />
                              </div>
                              <span className="text-sm text-warm-600">Entries Today</span>
                            </div>
                            <div className="text-right">
                              <div className="text-xl font-bold text-warm-800">
                                {formatOccupancy(barDayOccupancy?.entries ?? occupancyMetrics?.todayEntries ?? liveData?.occupancy?.entries)}
                              </div>
                              <div className="text-xs text-warm-500">people</div>
                            </div>
                          </div>

                          {/* Exits Today */}
                          <div className="flex items-center justify-between p-3 bg-warm-50 rounded-xl">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center">
                                <UserMinus className="w-5 h-5 text-red-500" />
                              </div>
                              <span className="text-sm text-warm-600">Exits Today</span>
                            </div>
                            <div className="text-right">
                              <div className="text-xl font-bold text-warm-800">
                                {formatOccupancy(barDayOccupancy?.exits ?? occupancyMetrics?.todayExits ?? liveData?.occupancy?.exits)}
                              </div>
                              <div className="text-xs text-warm-500">people</div>
                            </div>
                          </div>

                          {/* Current Occupancy */}
                          <div className="flex items-center justify-between p-3 bg-warm-50 rounded-xl">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                                <Users className="w-5 h-5 text-purple-500" />
                              </div>
                              <span className="text-sm text-warm-600">Current Occupancy</span>
                            </div>
                            <div className="text-right">
                              <div className="text-xl font-bold text-warm-800">
                                {formatOccupancy(barDayOccupancy?.current ?? occupancyMetrics?.current)}
                              </div>
                              <div className="text-xs text-warm-500">people</div>
                            </div>
                          </div>

                          {/* Avg Dwell Time */}
                          <div className="flex items-center justify-between p-3 bg-warm-50 rounded-xl">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-lg bg-pink-500/10 flex items-center justify-center">
                                <Clock className="w-5 h-5 text-pink-500" />
                              </div>
                              <span className="text-sm text-warm-600">Avg Dwell Time</span>
                            </div>
                            <div className="text-right">
                              <div className="text-xl font-bold text-warm-800">
                                {calculatedDwellTime !== null ? formatDwellTime(calculatedDwellTime) : '--'}
                              </div>
                              <div className="text-xs text-warm-500">per visit</div>
                            </div>
                          </div>

                          {/* Now Playing - compact */}
                          {currentData?.currentSong && (
                            <>
                              <div className="border-t border-warm-200 my-2"></div>
                              <div className="p-3 bg-warm-50 rounded-xl">
                                <div className="flex items-center gap-3">
                                  {currentData.albumArt && (
                                    <img 
                                      src={currentData.albumArt} 
                                      alt="Album art"
                                      className="w-10 h-10 rounded-lg object-cover"
                                    />
                                  )}
                                  <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium text-warm-800 truncate">
                                      {currentData.currentSong}
                                    </div>
                                    <div className="text-xs text-warm-500 truncate">
                                      {currentData.artist || 'Unknown Artist'}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      </motion.div>

                      {/* Right Panel - Insights */}
                      <div className="flex-1 min-w-0">
                        <Insights hideRings />
                      </div>
                    </div>
                  )}

                  {/* HISTORICAL VIEW: Original layout */}
                  {timeRange !== 'live' && (
                    <>
                      {/* Occupancy Metrics Section */}
                      {occupancyMetrics && (
                        <motion.div
                          className="mb-6"
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.1 }}
                        >
                          <h3 className="text-xl font-bold text-warm-800 mb-4 flex items-center gap-2">
                            <Users className="w-5 h-5 text-primary" />
                            Occupancy Tracking
                          </h3>
                          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                            <MetricCard
                              title="Peak Occupancy"
                              value={formatOccupancy(periodOccupancy?.current)}
                              unit="people"
                              icon={Users}
                              color="#00d4ff"
                              delay={0}
                            />
                            
                            <MetricCard
                              title={`Entries (${timeRange})`}
                              value={formatOccupancy(periodOccupancy?.entries)}
                              unit="people"
                              icon={UserPlus}
                              color="#4ade80"
                              delay={0.05}
                            />
                            
                            <MetricCard
                              title={`Exits (${timeRange})`}
                              value={formatOccupancy(periodOccupancy?.exits)}
                              unit="people"
                              icon={UserMinus}
                              color="#f87171"
                              delay={0.1}
                            />
                            
                            <MetricCard
                              title="Peak Today"
                              value={formatOccupancy(occupancyMetrics.peakOccupancy)}
                              unit={occupancyMetrics.peakTime ? `@ ${occupancyMetrics.peakTime}` : 'people'}
                              icon={TrendingUp}
                              color="#fbbf24"
                              delay={0.15}
                            />
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div className="glass-card p-4">
                              <div className="text-sm text-warm-500 mb-1">7-Day Average</div>
                              <div className="text-2xl font-bold text-primary">
                                {formatOccupancy(occupancyMetrics.sevenDayAvg)}
                                <span className="text-sm text-warm-500 ml-2">people/day</span>
                              </div>
                            </div>
                            
                            <div className="glass-card p-4">
                              <div className="text-sm text-warm-500 mb-1">14-Day Average</div>
                              <div className="text-2xl font-bold text-primary">
                                {formatOccupancy(occupancyMetrics.fourteenDayAvg)}
                                <span className="text-sm text-warm-500 ml-2">people/day</span>
                              </div>
                            </div>
                            
                            <div className="glass-card p-4">
                              <div className="text-sm text-warm-500 mb-1">30-Day Average</div>
                              <div className="text-2xl font-bold text-primary">
                                {formatOccupancy(occupancyMetrics.thirtyDayAvg)}
                                <span className="text-sm text-warm-500 ml-2">people/day</span>
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      )}

                      {/* Hero Metrics Grid - Historical */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4 mb-6">
                        <MetricCard
                          title="Sound Level"
                          value={formatValueNoZero(currentData?.decibels)}
                          unit="dB"
                          icon={Volume2}
                          color="#00d4ff"
                          delay={0}
                        />
                        
                        <MetricCard
                          title="Light Level"
                          value={formatValueAllowZero(currentData?.light)}
                          unit="lux"
                          icon={Sun}
                          color="#ffd700"
                          delay={0.1}
                        />
                        
                        <MetricCard
                          title="Outdoor"
                          value={weatherData ? weatherData.temperature.toString() : '--'}
                          unit={weatherData ? `${weatherData.icon}` : '°F'}
                          icon={CloudSun}
                          color="#87CEEB"
                          delay={0.22}
                          onClick={!weatherData ? () => setActiveTab('settings') : undefined}
                          clickHint={!weatherData ? 'Click to set venue address' : undefined}
                        />
                        
                        <MetricCard
                          title={`Entries (${timeRange})`}
                          value={formatOccupancy(periodOccupancy?.entries)}
                          unit="people"
                          icon={UserPlus}
                          color="#4ade80"
                          delay={0.3}
                        />
                        
                        <MetricCard
                          title={`Exits (${timeRange})`}
                          value={formatOccupancy(periodOccupancy?.exits)}
                          unit="people"
                          icon={UserMinus}
                          color="#f87171"
                          delay={0.35}
                        />
                        
                        <MetricCard
                          title="Peak Occupancy"
                          value={formatOccupancy(periodOccupancy?.current)}
                          unit="people"
                          icon={Users}
                          color="#a78bfa"
                          delay={0.4}
                        />

                        <MetricCard
                          title={`Avg Dwell (${timeRange})`}
                          value={calculatedDwellTime !== null ? formatDwellTime(calculatedDwellTime) : '--'}
                          unit="avg"
                          icon={Clock}
                          color="#ec4899"
                          delay={0.4}
                        />
                      </div>

                      {/* Sports Widget - Historical view */}
                      <div className="mb-6">
                        <SportsWidget />
                      </div>
                    </>
                  )}

                  {/* Charts - Historical view only */}
                  {timeRange !== 'live' && chartData.length > 0 && (
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
                      
                      {/* Outdoor Weather */}
                      <motion.div 
                        className="glass-card p-6"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                      >
                        <div className="flex items-center gap-3 mb-4">
                          <CloudSun className="w-5 h-5 text-sky-400" />
                          <h3 className="text-lg font-semibold text-white">Outdoor Weather</h3>
                        </div>
                        {weatherData ? (
                          <div className="flex flex-col items-center justify-center h-48 bg-gradient-to-br from-sky-500/10 to-blue-500/10 rounded-xl border border-sky-500/20">
                            <div className="text-5xl mb-2">{weatherData.icon}</div>
                            <div className="text-4xl font-bold text-white">{weatherData.temperature}°F</div>
                            <div className="text-lg text-sky-300 mt-1">{weatherData.conditions}</div>
                            <div className="flex items-center gap-4 mt-3 text-sm text-gray-400">
                              <span>Feels like {weatherData.feelsLike}°F</span>
                              <span>•</span>
                              <span>{weatherData.humidity}% humidity</span>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center justify-center h-48 bg-white/5 rounded-xl border border-dashed border-white/20">
                            <CloudSun className="w-12 h-12 text-sky-400/50 mb-3" />
                            {(() => {
                              const settingsAddress = venueId ? venueSettingsService.getFormattedAddress(venueId) : null;
                              const hasAddress = settingsAddress || (currentLocation?.address && currentLocation.address !== 'No address provided');
                              return (
                                <>
                                  <p className="text-lg font-medium text-white/70">
                                    {hasAddress ? 'Loading weather...' : 'No Address Set'}
                                  </p>
                                  <p className="text-sm text-gray-500 mt-1 text-center px-4">
                                    {hasAddress
                                      ? 'Based on venue address'
                                      : 'Add your venue address in Settings'}
                                  </p>
                                  {!hasAddress && (
                                    <button
                                      onClick={() => setActiveTab('settings')}
                                      className="mt-3 px-4 py-2 text-sm bg-cyan/20 hover:bg-cyan/30 text-cyan border border-cyan/30 rounded-lg transition-colors"
                                    >
                                      Go to Settings
                                    </button>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                        )}
                      </motion.div>
                    </div>
                  )}

                </>
              )}
            </>
            )
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

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Key, MapPin, Check, Building2,
  User, Info, CloudSun, Sliders, Users, Save, CreditCard, Bell, DollarSign,
  Camera, Download, Wifi, WifiOff, RefreshCw, Circle
} from 'lucide-react';
import connectService, { ConnectStatus } from '../services/connect.service';
import alertsService, { AlertPreferences } from '../services/alerts.service';
import authService from '../services/auth.service';
import venueSettingsService, { VenueAddress } from '../services/venue-settings.service';
import weatherService from '../services/weather.service';
import { getUserRoleDisplay } from '../utils/userRoles';
import { ChangePasswordModal } from '../components/ChangePasswordModal';
import { AddressSettings } from '../components/AddressSettings';
import { CalibrationSettings } from '../components/CalibrationSettings';
import { POSIntegration } from '../components/settings/POSIntegration';
import { haptic } from '../utils/haptics';
import { useDisplayName } from '../hooks/useDisplayName';

export function Settings() {
  const [activeTab, setActiveTab] = useState<'account' | 'venue' | 'integrations' | 'calibration' | 'alerts' | 'cameras' | 'about'>('account');
  const [connectStatus, setConnectStatus] = useState<ConnectStatus | null>(null);
  const [connectLoading, setConnectLoading] = useState(false);
  const [alertPrefs, setAlertPrefs] = useState<AlertPreferences>(() => alertsService.getPreferences());
  const [alertsSaved, setAlertsSaved] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [savedAddress, setSavedAddress] = useState<VenueAddress | null>(null);
  const [capacity, setCapacity] = useState<number | ''>('');
  const [capacitySaving, setCapacitySaving] = useState(false);
  const [capacitySaved, setCapacitySaved] = useState(false);
  const [avgDrinkPrice, setAvgDrinkPrice] = useState<number | ''>('');
  const [drinkPriceSaving, setDrinkPriceSaving] = useState(false);
  const [drinkPriceSaved, setDrinkPriceSaved] = useState(false);
  const user = authService.getStoredUser();
  
  // Use display name (custom name if set by admin, otherwise venueId/venueName)
  const { displayName } = useDisplayName();

  // Poll camera connection status when on cameras tab
  useEffect(() => {
    if (activeTab !== 'cameras') return;
    const stop = connectService.watchStatus(setConnectStatus);
    return stop;
  }, [activeTab]);

  useEffect(() => {
    // Load saved address, capacity, and drink price
    if (user?.venueId) {
      const address = venueSettingsService.getAddress(user.venueId);
      setSavedAddress(address);

      const savedCapacity = venueSettingsService.getCapacity(user.venueId);
      if (savedCapacity) {
        setCapacity(savedCapacity);
      }

      venueSettingsService.loadSettingsFromCloud(user.venueId).then(s => {
        if (s?.avgDrinkPrice) setAvgDrinkPrice(s.avgDrinkPrice);
        else setAvgDrinkPrice(12);
      });
    }
  }, [user?.venueId]);

  const handleSaveCapacity = async () => {
    if (!user?.venueId || !capacity) return;

    setCapacitySaving(true);
    try {
      await venueSettingsService.saveCapacity(user.venueId, Number(capacity));
      haptic('success');
      setCapacitySaved(true);
      setTimeout(() => setCapacitySaved(false), 3000);
    } catch (error) {
      console.error('Failed to save capacity:', error);
    } finally {
      setCapacitySaving(false);
    }
  };

  const handleSaveDrinkPrice = async () => {
    if (!user?.venueId || avgDrinkPrice === '') return;

    setDrinkPriceSaving(true);
    try {
      await venueSettingsService.saveAvgDrinkPrice(user.venueId, Number(avgDrinkPrice));
      haptic('success');
      setDrinkPriceSaved(true);
      setTimeout(() => setDrinkPriceSaved(false), 3000);
    } catch (error) {
      console.error('Failed to save drink price:', error);
    } finally {
      setDrinkPriceSaving(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h2 className="text-3xl font-bold text-white mb-2">⚙️ Settings</h2>
        <p className="text-warm-400 mb-8">Manage your account and venue</p>

        {/* Tab Navigation */}
        <div className="flex gap-2 mb-6 overflow-x-auto">
          {[
            { id: 'account' as const, label: 'Account', icon: User },
            { id: 'venue' as const, label: 'Venue', icon: MapPin },
            { id: 'integrations' as const, label: 'Integrations', icon: CreditCard },
            { id: 'calibration' as const, label: 'Calibration', icon: Sliders },
            { id: 'alerts' as const, label: 'Alerts', icon: Bell },
            { id: 'cameras' as const, label: 'Cameras', icon: Camera },
            { id: 'about' as const, label: 'About', icon: Info },
          ].map((tab) => (
            <motion.button
              key={tab.id}
              onClick={() => { haptic('selection'); setActiveTab(tab.id); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-primary/20 border border-primary/50 text-white'
                  : 'bg-warm-800 border border-warm-700 text-warm-400 hover:text-white'
              }`}
              whileTap={{ scale: 0.95 }}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </motion.button>
          ))}
        </div>

        <div className="space-y-6">
          {/* Account Tab */}
          {activeTab === 'account' && (
            <motion.div
              className="bg-warm-800/50 border border-warm-700 rounded-2xl p-6"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
            >
              <h3 className="text-xl font-semibold text-white mb-6">Account Information</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-warm-300 mb-2">Email</label>
                  <input
                    type="text"
                    value={user?.email || ''}
                    disabled
                    className="w-full px-4 py-2 bg-warm-900 border border-warm-700 rounded-lg text-warm-400 cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-warm-300 mb-2">Venue</label>
                  <input
                    type="text"
                    value={displayName || 'Not configured'}
                    disabled
                    className="w-full px-4 py-2 bg-warm-900 border border-warm-700 rounded-lg text-warm-400 cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-warm-300 mb-2">Role</label>
                  <input
                    type="text"
                    value={user?.role ? getUserRoleDisplay(user.role) : 'Not configured'}
                    disabled
                    className="w-full px-4 py-2 bg-warm-900 border border-warm-700 rounded-lg text-warm-400 cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-warm-300 mb-2">Account Status</label>
                  <div className="flex items-center gap-2 px-4 py-2 bg-green-500/10 border border-green-500/30 rounded-lg">
                    <Check className="w-4 h-4 text-green-400" />
                    <span className="text-green-400 font-medium">Active</span>
                  </div>
                </div>
                <button 
                  onClick={() => setShowPasswordModal(true)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-warm-700 hover:bg-warm-600 text-white rounded-lg transition-colors"
                >
                  <Key className="w-4 h-4" />
                  Change Password
                </button>
              </div>
            </motion.div>
          )}

          {/* Change Password Modal */}
          <ChangePasswordModal
            isOpen={showPasswordModal}
            onClose={() => setShowPasswordModal(false)}
          />

          {/* Venue Tab */}
          {activeTab === 'venue' && (
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-6"
            >
              {/* Address Settings */}
              <div className="bg-warm-800/50 border border-warm-700 rounded-2xl p-6">
                <div className="flex items-center gap-3 mb-4">
                  <CloudSun className="w-5 h-5 text-cyan-400" />
                  <h3 className="text-xl font-semibold text-white">Venue Address</h3>
                </div>
                <p className="text-sm text-warm-400 mb-6">
                  Set your venue's address to enable outdoor weather display on your dashboard. 
                  This address is used to fetch current weather conditions from our weather service.
                </p>
                
                {user?.venueId ? (
                  <AddressSettings 
                    venueId={user.venueId}
                    inline={true}
                    onAddressSaved={(address) => {
                      setSavedAddress(address);
                      // Clear weather cache to trigger refresh
                      weatherService.clearCache();
                    }}
                  />
                ) : (
                  <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                    <p className="text-sm text-yellow-300">
                      Venue ID not configured. Please contact your administrator.
                    </p>
                  </div>
                )}
                
                {savedAddress && (
                  <div className="mt-4 p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <Check className="w-4 h-4 text-green-400" />
                      <span className="text-sm font-medium text-green-400">Current Address</span>
                    </div>
                    <p className="text-sm text-green-300">
                      {savedAddress.street}, {savedAddress.city}, {savedAddress.state} {savedAddress.zipCode}
                    </p>
                  </div>
                )}
              </div>

              {/* Venue Capacity */}
              <div className="bg-warm-800/50 border border-warm-700 rounded-2xl p-6">
                <div className="flex items-center gap-3 mb-4">
                  <Users className="w-5 h-5 text-green-400" />
                  <h3 className="text-xl font-semibold text-white">Venue Capacity</h3>
                </div>
                <p className="text-sm text-warm-400 mb-6">
                  Set your venue's maximum capacity. This is used to calculate accurate occupancy percentages 
                  and compare to your best historical performance.
                </p>
                
                {user?.venueId ? (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-warm-300 mb-2">Maximum Capacity (people)</label>
                      <input
                        type="number"
                        min="1"
                        max="10000"
                        value={capacity}
                        onChange={(e) => setCapacity(e.target.value ? Number(e.target.value) : '')}
                        placeholder="e.g., 200"
                        className="w-full px-4 py-3 bg-warm-900 border border-warm-700 rounded-lg text-white focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
                      />
                      <p className="text-xs text-warm-500 mt-2">
                        This is the maximum number of people your venue can legally or comfortably hold.
                      </p>
                    </div>
                    
                    <button
                      onClick={handleSaveCapacity}
                      disabled={!capacity || capacitySaving}
                      className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-medium transition-all ${
                        capacitySaved 
                          ? 'bg-green-500/20 border border-green-500/50 text-green-400'
                          : 'bg-primary/20 border border-primary/50 text-primary hover:bg-primary/30'
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      {capacitySaved ? (
                        <>
                          <Check className="w-4 h-4" />
                          Saved!
                        </>
                      ) : (
                        <>
                          <Save className="w-4 h-4" />
                          {capacitySaving ? 'Saving...' : 'Save Capacity'}
                        </>
                      )}
                    </button>
                  </div>
                ) : (
                  <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                    <p className="text-sm text-yellow-300">
                      Venue ID not configured. Please contact your administrator.
                    </p>
                  </div>
                )}
              </div>

              {/* Average Drink Price */}
              <div className="bg-warm-800/50 border border-warm-700 rounded-2xl p-6">
                <div className="flex items-center gap-3 mb-4">
                  <DollarSign className="w-5 h-5 text-red-400" />
                  <h3 className="text-xl font-semibold text-white">Average Drink Price</h3>
                </div>
                <p className="text-sm text-warm-400 mb-6">
                  Used to calculate estimated revenue loss from unrung drinks detected by VenueScope.
                  Appears in the Theft Investigation modal and summary totals.
                </p>

                {user?.venueId ? (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-warm-300 mb-2">Price per drink ($)</label>
                      <input
                        type="number"
                        min="1"
                        max="100"
                        step="0.50"
                        value={avgDrinkPrice}
                        onChange={e => setAvgDrinkPrice(e.target.value ? Number(e.target.value) : '')}
                        placeholder="e.g., 12"
                        className="w-full px-4 py-3 bg-warm-900 border border-warm-700 rounded-lg text-white focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
                      />
                      <p className="text-xs text-warm-500 mt-2">
                        Industry average is $10–$14. Use your venue's average check per drink.
                      </p>
                    </div>

                    <button
                      onClick={handleSaveDrinkPrice}
                      disabled={avgDrinkPrice === '' || drinkPriceSaving}
                      className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-medium transition-all ${
                        drinkPriceSaved
                          ? 'bg-green-500/20 border border-green-500/50 text-green-400'
                          : 'bg-primary/20 border border-primary/50 text-primary hover:bg-primary/30'
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      {drinkPriceSaved ? (
                        <><Check className="w-4 h-4" />Saved!</>
                      ) : (
                        <><Save className="w-4 h-4" />{drinkPriceSaving ? 'Saving...' : 'Save Price'}</>
                      )}
                    </button>
                  </div>
                ) : (
                  <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                    <p className="text-sm text-yellow-300">Venue ID not configured.</p>
                  </div>
                )}
              </div>

              {/* Venue Info (read-only) */}
              <div className="bg-warm-800/50 border border-warm-700 rounded-2xl p-6">
                <div className="flex items-center gap-3 mb-4">
                  <Building2 className="w-5 h-5 text-cyan-400" />
                  <h3 className="text-xl font-semibold text-white">Venue Information</h3>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-warm-300 mb-2">Venue Name</label>
                    <input
                      type="text"
                      value={displayName || 'Not configured'}
                      disabled
                      className="w-full px-4 py-2 bg-warm-900 border border-warm-700 rounded-lg text-warm-400 cursor-not-allowed"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-warm-300 mb-2">Venue ID</label>
                    <input
                      type="text"
                      value={user?.venueId || 'Not configured'}
                      disabled
                      className="w-full px-4 py-2 bg-warm-900 border border-warm-700 rounded-lg text-warm-400 cursor-not-allowed"
                    />
                  </div>
                  <p className="text-xs text-warm-500">
                    Venue information is managed by your system administrator. Contact support to make changes.
                  </p>
                </div>
              </div>
            </motion.div>
          )}

          {/* Integrations Tab */}
          {activeTab === 'integrations' && (
            <motion.div
              className="bg-warm-800/50 border border-warm-700 rounded-2xl p-6"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
            >
              <POSIntegration />
            </motion.div>
          )}

          {/* Calibration Tab */}
          {activeTab === 'calibration' && (
            <motion.div
              className="bg-warm-800/50 border border-warm-700 rounded-2xl p-6"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
            >
              <div className="flex items-center gap-3 mb-4">
                <Sliders className="w-5 h-5 text-primary" />
                <h3 className="text-xl font-semibold text-white">Venue Calibration</h3>
              </div>
              <p className="text-sm text-warm-400 mb-6">
                Customize optimal sound and light ranges for your specific venue type.
                These settings affect how Pulse Score and recommendations are calculated.
              </p>
              
              {user?.venueId ? (
                <CalibrationSettings venueId={user.venueId} />
              ) : (
                <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                  <p className="text-sm text-yellow-300">
                    Venue ID not configured. Please contact your administrator.
                  </p>
                </div>
              )}
            </motion.div>
          )}

          {/* Alerts Tab */}
          {activeTab === 'alerts' && (
            <motion.div
              className="bg-warm-800/50 border border-warm-700 rounded-2xl p-6 space-y-6"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
            >
              <div>
                <h3 className="text-xl font-semibold text-white mb-1">Alert Thresholds</h3>
                <p className="text-sm text-warm-400">Get notified in-app when your venue needs attention.</p>
              </div>

              {/* Helper to render a toggle row */}
              {([
                {
                  key: 'capacityEnabled',
                  label: 'Crowd capacity',
                  desc: 'Alert when occupancy exceeds a % of your venue limit',
                  threshold: { key: 'capacityThresholdPct', label: 'Alert at', suffix: '% of capacity', min: 50, max: 100 },
                },
                {
                  key: 'dwellEnabled',
                  label: 'Dwell time drop',
                  desc: 'Alert when average stay drops vs last week',
                  threshold: { key: 'dwellDropPct', label: 'Alert when drops by', suffix: '%', min: 5, max: 50 },
                },
                {
                  key: 'pulseEnabled',
                  label: 'Low Pulse Score',
                  desc: 'Alert when score falls below threshold',
                  threshold: { key: 'pulseThreshold', label: 'Alert below score', suffix: '', min: 10, max: 60 },
                },
                {
                  key: 'connectionEnabled',
                  label: 'Sensor connection lost',
                  desc: 'Alert when sensor data goes stale',
                  threshold: { key: 'connectionStaleMinutes', label: 'Alert after', suffix: ' min without data', min: 5, max: 60 },
                },
                {
                  key: 'posEnabled',
                  label: 'POS vs Camera variance',
                  desc: 'Alert when drink count differs from POS',
                  threshold: { key: 'posVariancePct', label: 'Alert above', suffix: '% variance', min: 5, max: 50 },
                },
              ] as const).map(({ key, label, desc, threshold }) => (
                <div key={key} className="border border-warm-700 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">{label}</p>
                      <p className="text-xs text-warm-400 mt-0.5">{desc}</p>
                    </div>
                    <button
                      onClick={() => setAlertPrefs(p => ({ ...p, [key]: !p[key as keyof AlertPreferences] }))}
                      className={`w-10 h-5 rounded-full relative transition-colors flex-shrink-0 ${alertPrefs[key as keyof AlertPreferences] ? 'bg-primary' : 'bg-warm-700'}`}
                    >
                      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${alertPrefs[key as keyof AlertPreferences] ? 'left-5' : 'left-0.5'}`} />
                    </button>
                  </div>
                  {alertPrefs[key as keyof AlertPreferences] && (
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-warm-400 flex-shrink-0">{threshold.label}</span>
                      <input
                        type="range"
                        min={threshold.min}
                        max={threshold.max}
                        value={alertPrefs[threshold.key as keyof AlertPreferences] as number}
                        onChange={e => setAlertPrefs(p => ({ ...p, [threshold.key]: Number(e.target.value) }))}
                        className="flex-1 accent-primary"
                      />
                      <span className="text-sm font-semibold text-white w-24 text-right flex-shrink-0">
                        {alertPrefs[threshold.key as keyof AlertPreferences] as number}{threshold.suffix}
                      </span>
                    </div>
                  )}
                </div>
              ))}

              <motion.button
                onClick={() => {
                  alertsService.savePreferences(alertPrefs);
                  haptic('success');
                  setAlertsSaved(true);
                  setTimeout(() => setAlertsSaved(false), 3000);
                }}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-primary/20 border border-primary/40 text-white font-medium text-sm hover:bg-primary/30 transition-colors"
                whileTap={{ scale: 0.97 }}
              >
                {alertsSaved ? <><Check className="w-4 h-4 text-primary" /> Saved</> : <><Save className="w-4 h-4" /> Save Alert Settings</>}
              </motion.button>
            </motion.div>
          )}

          {/* Cameras Tab */}
          {activeTab === 'cameras' && (
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-6"
            >
              {/* Connection Status */}
              <div className="bg-warm-800/50 border border-warm-700 rounded-2xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    {connectStatus?.connected
                      ? <Wifi className="w-5 h-5 text-green-400" />
                      : <WifiOff className="w-5 h-5 text-warm-500" />
                    }
                    <h3 className="text-xl font-semibold text-white">VenueScope Connect</h3>
                  </div>
                  <button
                    onClick={async () => {
                      setConnectLoading(true);
                      connectService.clearCache();
                      const s = await connectService.getStatus();
                      setConnectStatus(s);
                      setConnectLoading(false);
                    }}
                    className="p-2 text-warm-400 hover:text-white transition-colors"
                  >
                    <RefreshCw className={`w-4 h-4 ${connectLoading ? 'animate-spin' : ''}`} />
                  </button>
                </div>

                {connectStatus?.connected ? (
                  <div className="flex items-center gap-2 px-4 py-2 bg-green-500/10 border border-green-500/30 rounded-lg mb-4">
                    <Circle className="w-2 h-2 fill-green-400 text-green-400" />
                    <span className="text-green-400 text-sm font-medium">
                      Connected — {connectStatus.cameraCount} camera{connectStatus.cameraCount !== 1 ? 's' : ''} active
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 px-4 py-2 bg-warm-700/50 border border-warm-600 rounded-lg mb-4">
                    <Circle className="w-2 h-2 fill-warm-500 text-warm-500" />
                    <span className="text-warm-400 text-sm">
                      No venue PC connected yet
                    </span>
                  </div>
                )}

                <p className="text-sm text-warm-400 mb-6">
                  VenueScope Connect runs silently on any always-on PC at the venue.
                  It links your cameras privately — no ports opened, cameras never exposed to the internet.
                </p>

                <button
                  onClick={() => connectService.downloadInstaller()}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary/20 border border-primary/50 text-primary hover:bg-primary/30 rounded-lg font-medium transition-all"
                >
                  <Download className="w-4 h-4" />
                  Download VenueScope Connect
                </button>

                <div className="mt-4 space-y-3">
                  {[
                    { step: '1', text: 'Download and run the installer on any PC at the venue' },
                    { step: '2', text: 'The installer handles everything automatically — nothing to configure' },
                    { step: '3', text: 'Cameras appear here within 2 minutes' },
                  ].map(({ step, text }) => (
                    <div key={step} className="flex items-start gap-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/20 border border-primary/40 text-primary text-xs flex items-center justify-center font-bold">
                        {step}
                      </span>
                      <p className="text-sm text-warm-300 pt-0.5">{text}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Connected Cameras */}
              {connectStatus?.cameras && connectStatus.cameras.length > 0 && (
                <div className="bg-warm-800/50 border border-warm-700 rounded-2xl p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <Camera className="w-5 h-5 text-cyan-400" />
                    <h3 className="text-xl font-semibold text-white">Connected Cameras</h3>
                  </div>
                  <div className="space-y-3">
                    {connectStatus.cameras.map((cam) => (
                      <div
                        key={cam.cameraId}
                        className="flex items-center justify-between p-4 bg-warm-900/50 border border-warm-700 rounded-xl"
                      >
                        <div className="flex items-center gap-3">
                          <Circle className={`w-2 h-2 flex-shrink-0 ${
                            cam.isOnline ? 'fill-green-400 text-green-400' : 'fill-red-400 text-red-400'
                          }`} />
                          <div>
                            <p className="text-sm font-medium text-white">{cam.name}</p>
                            <p className="text-xs text-warm-500">{cam.mode} · {cam.location}</p>
                          </div>
                        </div>
                        <span className={`text-xs px-2 py-1 rounded-full ${
                          cam.enabled
                            ? 'bg-green-500/10 text-green-400 border border-green-500/30'
                            : 'bg-warm-700 text-warm-400 border border-warm-600'
                        }`}>
                          {cam.enabled ? 'Active' : 'Disabled'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Requirements */}
              <div className="bg-warm-800/50 border border-warm-700 rounded-2xl p-6">
                <h3 className="text-lg font-semibold text-white mb-3">Requirements</h3>
                <ul className="space-y-2 text-sm text-warm-400">
                  <li className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-green-400 flex-shrink-0" />
                    Any always-on Windows, Mac, or Linux PC at the venue
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-green-400 flex-shrink-0" />
                    PC must be on the same network as the cameras
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-green-400 flex-shrink-0" />
                    Internet connection (outbound only — no ports to open)
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-green-400 flex-shrink-0" />
                    PC plugged into power (installer disables sleep automatically)
                  </li>
                </ul>
              </div>
            </motion.div>
          )}

          {/* About Tab */}
          {activeTab === 'about' && (
            <motion.div
              className="bg-warm-800/50 border border-warm-700 rounded-2xl p-6"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
            >
              <h3 className="text-xl font-semibold text-white mb-6">About Pulse</h3>
              <div className="space-y-6">
                <div className="text-center py-6">
                  <div className="text-4xl font-bold bg-gradient-to-r from-primary to-cyan-400 bg-clip-text text-transparent mb-2">Pulse</div>
                  <div className="text-warm-400 mb-1">by Advizia</div>
                  <div className="text-sm text-warm-500">Version 2.0.0</div>
                  <div className="text-xs text-warm-600 mt-2">Last Updated: March 2026</div>
                </div>

                <div className="space-y-3">
                  <div className="p-4 bg-warm-900 rounded-lg">
                    <div className="text-sm text-warm-400 mb-1">Support</div>
                    <a href="mailto:support@advizia.com" className="text-cyan-400 hover:text-cyan-300">
                      support@advizia.com
                    </a>
                  </div>

                  <div className="p-4 bg-warm-900 rounded-lg">
                    <div className="text-sm text-warm-400 mb-1">Documentation</div>
                    <a href="#" className="text-cyan-400 hover:text-cyan-300">
                      docs.advizia.com
                    </a>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button className="flex-1 px-4 py-2 bg-warm-700 hover:bg-warm-600 text-white rounded-lg transition-colors text-sm">
                    Terms of Service
                  </button>
                  <button className="flex-1 px-4 py-2 bg-warm-700 hover:bg-warm-600 text-white rounded-lg transition-colors text-sm">
                    Privacy Policy
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

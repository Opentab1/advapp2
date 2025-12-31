import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  Save, Key, MapPin, DollarSign, Check, Building2, Trash2, AlertTriangle,
  User, Bell, Settings as SettingsIcon, Info, Mail, Phone, Globe, CloudSun,
  Users, Clock, TrendingUp
} from 'lucide-react';
import type { AppSettings } from '../types';
import authService from '../services/auth.service';
import toastPOSService from '../services/toast-pos.service';
import locationService from '../services/location.service';
import venueSettingsService, { VenueAddress } from '../services/venue-settings.service';
import userSettingsService from '../services/user-settings.service';
import weatherService from '../services/weather.service';
import themeService from '../services/theme.service';
import { getUserRoleDisplay } from '../utils/userRoles';
import { ChangePasswordModal } from '../components/ChangePasswordModal';
import { AddressSettings } from '../components/AddressSettings';

// Revenue settings for Reports calculations
interface RevenueSettings {
  avgSpendPerCustomer: number;
  venueCapacity: number;
  operatingHoursStart: number;
  operatingHoursEnd: number;
}

const DEFAULT_REVENUE_SETTINGS: RevenueSettings = {
  avgSpendPerCustomer: 25,
  venueCapacity: 150,
  operatingHoursStart: 17,
  operatingHoursEnd: 2,
};

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'light',
  soundAlerts: true,
  refreshInterval: 5,
  notifications: true,
  venueId: '', // Will be populated from user's Cognito attributes, not stored here
  locationId: '', // Will be populated from user's Cognito attributes, not stored here
  toastPOSEnabled: false,
  toastAPIKey: ''
};

export function Settings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [cacheCleared, setCacheCleared] = useState(false);
  const [toastRestaurantGuid, setToastRestaurantGuid] = useState('');
  const [activeTab, setActiveTab] = useState<'account' | 'venue' | 'revenue' | 'notifications' | 'preferences' | 'integrations' | 'about'>('account');
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [savedAddress, setSavedAddress] = useState<VenueAddress | null>(null);
  const [revenueSettings, setRevenueSettings] = useState<RevenueSettings>(DEFAULT_REVENUE_SETTINGS);
  const [revenueSaved, setRevenueSaved] = useState(false);
  const user = authService.getStoredUser();

  useEffect(() => {
    loadSettings();
    // Load saved address
    if (user?.venueId) {
      const address = venueSettingsService.getAddress(user.venueId);
      setSavedAddress(address);
    }
    // Load revenue settings
    try {
      const savedRevenue = localStorage.getItem('pulse_revenue_settings');
      if (savedRevenue) {
        setRevenueSettings({ ...DEFAULT_REVENUE_SETTINGS, ...JSON.parse(savedRevenue) });
      }
    } catch (e) {
      console.error('Error loading revenue settings:', e);
    }
  }, []);

  const loadSettings = async () => {
    try {
      // Get venueId and locationId from authenticated user
      const user = authService.getStoredUser();
      
      // Load user settings from DynamoDB
      const userSettings = await userSettingsService.getUserSettings();
      
      // Load Toast POS credentials
      const toastCreds = toastPOSService.getCredentials();
      if (toastCreds) {
        setToastRestaurantGuid(toastCreds.restaurantGuid);
      }
      
      // Set settings from DynamoDB (with user's venue info)
      // Filter 'auto' theme to 'light' since AppSettings only supports 'light' | 'dark'
      const theme = userSettings.theme === 'auto' ? 'light' : userSettings.theme;
      setSettings({
        ...DEFAULT_SETTINGS,
        theme,
        soundAlerts: userSettings.soundAlerts,
        refreshInterval: userSettings.refreshInterval,
        notifications: userSettings.notifications,
        toastPOSEnabled: toastCreds?.apiKey ? true : false,
        toastAPIKey: toastCreds?.apiKey || '',
        venueId: user?.venueId || '',
        locationId: user?.locations?.[0]?.id || ''
      });
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  };

  const saveSettings = async () => {
    try {
      // Save Toast POS credentials to the service (stored in DynamoDB)
      if (settings.toastPOSEnabled && settings.toastAPIKey && toastRestaurantGuid) {
        await toastPOSService.setCredentials(settings.toastAPIKey, toastRestaurantGuid);
      } else if (!settings.toastPOSEnabled) {
        await toastPOSService.clearCredentials();
      }
      
      // Save user settings to DynamoDB
      await userSettingsService.saveUserSettings({
        theme: settings.theme as 'light' | 'dark' | 'auto',
        soundAlerts: settings.soundAlerts,
        refreshInterval: settings.refreshInterval,
        notifications: settings.notifications,
      });
      
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (error) {
      console.error('Error saving settings:', error);
    }
  };

  const clearLocationCache = () => {
    try {
      locationService.clearCache();
      setCacheCleared(true);
      setTimeout(() => {
        setCacheCleared(false);
        // Reload the page to fetch fresh locations
        window.location.reload();
      }, 2000);
    } catch (error) {
      console.error('Error clearing cache:', error);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h2 className="text-3xl font-bold gradient-text mb-2">⚙️ Settings</h2>
        <p className="text-gray-400 mb-8">Manage your account and preferences</p>

        {/* Tab Navigation */}
        <div className="flex gap-2 mb-6 overflow-x-auto">
          {[
            { id: 'account' as const, label: 'Account', icon: User },
            { id: 'venue' as const, label: 'Venue', icon: MapPin },
            { id: 'revenue' as const, label: 'Revenue', icon: TrendingUp },
            { id: 'notifications' as const, label: 'Notifications', icon: Bell },
            { id: 'preferences' as const, label: 'Preferences', icon: SettingsIcon },
            { id: 'integrations' as const, label: 'Integrations', icon: DollarSign },
            { id: 'about' as const, label: 'About', icon: Info },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-purple-500/20 border border-purple-500/50 text-white'
                  : 'bg-white/5 border border-white/10 text-gray-400 hover:text-white'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        <div className="space-y-6">
          {/* Account Tab */}
          {activeTab === 'account' && (
            <motion.div
              className="glass-card p-6"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
            >
              <h3 className="text-xl font-semibold text-white mb-6">Account Information</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Email</label>
                  <input
                    type="text"
                    value={user?.email || ''}
                    disabled
                    className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-gray-400 cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Venue</label>
                  <input
                    type="text"
                    value={user?.venueName || 'Not configured'}
                    disabled
                    className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-gray-400 cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Role</label>
                  <input
                    type="text"
                    value={user?.role ? getUserRoleDisplay(user.role) : 'Not configured'}
                    disabled
                    className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-gray-400 cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Account Status</label>
                  <div className="flex items-center gap-2 px-4 py-2 bg-green-500/10 border border-green-500/30 rounded-lg">
                    <Check className="w-4 h-4 text-green-400" />
                    <span className="text-green-400 font-medium">Active</span>
                  </div>
                </div>
                <button 
                  onClick={() => setShowPasswordModal(true)}
                  className="btn-secondary w-full flex items-center justify-center gap-2"
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
              <div className="glass-card p-6">
                <div className="flex items-center gap-3 mb-4">
                  <CloudSun className="w-5 h-5 text-cyan" />
                  <h3 className="text-xl font-semibold text-white">Venue Address</h3>
                </div>
                <p className="text-sm text-gray-400 mb-6">
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

              {/* Venue Info (read-only) */}
              <div className="glass-card p-6">
                <div className="flex items-center gap-3 mb-4">
                  <Building2 className="w-5 h-5 text-cyan" />
                  <h3 className="text-xl font-semibold text-white">Venue Information</h3>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Venue Name</label>
                    <input
                      type="text"
                      value={user?.venueName || 'Not configured'}
                      disabled
                      className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-gray-400 cursor-not-allowed"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Venue ID</label>
                    <input
                      type="text"
                      value={user?.venueId || 'Not configured'}
                      disabled
                      className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-gray-400 cursor-not-allowed"
                    />
                  </div>
                  <p className="text-xs text-gray-500">
                    Venue information is managed by your system administrator. Contact support to make changes.
                  </p>
                </div>
              </div>
            </motion.div>
          )}

          {/* Revenue Tab */}
          {activeTab === 'revenue' && (
            <motion.div
              className="glass-card p-6"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
            >
              <div className="flex items-center gap-3 mb-4">
                <TrendingUp className="w-5 h-5 text-cyan" />
                <h3 className="text-xl font-semibold text-white">Revenue Settings</h3>
              </div>
              <p className="text-sm text-gray-400 mb-6">
                Configure these settings to enable accurate revenue estimates in your Reports dashboard.
                All calculations are done locally - this data stays on your device.
              </p>

              <div className="space-y-6">
                {/* Average Spend Per Customer */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    <DollarSign className="w-4 h-4 inline mr-2" />
                    Average Spend Per Customer ($)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="500"
                    value={revenueSettings.avgSpendPerCustomer}
                    onChange={(e) => setRevenueSettings({ 
                      ...revenueSettings, 
                      avgSpendPerCustomer: parseInt(e.target.value) || 25 
                    })}
                    className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-cyan/50 focus:ring-2 focus:ring-cyan/20 transition-all text-white"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Average amount a customer spends per visit (food, drinks, etc.)
                  </p>
                </div>

                {/* Venue Capacity */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    <Users className="w-4 h-4 inline mr-2" />
                    Venue Capacity
                  </label>
                  <input
                    type="number"
                    min="10"
                    max="5000"
                    value={revenueSettings.venueCapacity}
                    onChange={(e) => setRevenueSettings({ 
                      ...revenueSettings, 
                      venueCapacity: parseInt(e.target.value) || 150 
                    })}
                    className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-cyan/50 focus:ring-2 focus:ring-cyan/20 transition-all text-white"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Maximum number of people your venue can hold
                  </p>
                </div>

                {/* Operating Hours */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      <Clock className="w-4 h-4 inline mr-2" />
                      Opening Hour
                    </label>
                    <select
                      value={revenueSettings.operatingHoursStart}
                      onChange={(e) => setRevenueSettings({ 
                        ...revenueSettings, 
                        operatingHoursStart: parseInt(e.target.value) 
                      })}
                      className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white"
                    >
                      {Array.from({ length: 24 }, (_, i) => (
                        <option key={i} value={i}>
                          {i === 0 ? '12 AM' : i < 12 ? `${i} AM` : i === 12 ? '12 PM' : `${i - 12} PM`}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      <Clock className="w-4 h-4 inline mr-2" />
                      Closing Hour
                    </label>
                    <select
                      value={revenueSettings.operatingHoursEnd}
                      onChange={(e) => setRevenueSettings({ 
                        ...revenueSettings, 
                        operatingHoursEnd: parseInt(e.target.value) 
                      })}
                      className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white"
                    >
                      {Array.from({ length: 24 }, (_, i) => (
                        <option key={i} value={i}>
                          {i === 0 ? '12 AM' : i < 12 ? `${i} AM` : i === 12 ? '12 PM' : `${i - 12} PM`}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Example Calculation */}
                <div className="p-4 bg-cyan/5 border border-cyan/20 rounded-lg">
                  <p className="text-sm text-cyan-300">
                    <strong>Example:</strong> With ${revenueSettings.avgSpendPerCustomer} avg spend and {revenueSettings.venueCapacity} capacity, 
                    a full house = ${(revenueSettings.avgSpendPerCustomer * revenueSettings.venueCapacity).toLocaleString()} potential revenue
                  </p>
                </div>

                {/* Save Button */}
                <motion.button
                  onClick={() => {
                    try {
                      localStorage.setItem('pulse_revenue_settings', JSON.stringify(revenueSettings));
                      setRevenueSaved(true);
                      setTimeout(() => setRevenueSaved(false), 3000);
                    } catch (e) {
                      console.error('Error saving revenue settings:', e);
                    }
                  }}
                  className="w-full btn-primary flex items-center justify-center gap-2"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  {revenueSaved ? (
                    <>
                      <Check className="w-5 h-5" />
                      Saved!
                    </>
                  ) : (
                    <>
                      <Save className="w-5 h-5" />
                      Save Revenue Settings
                    </>
                  )}
                </motion.button>
              </div>
            </motion.div>
          )}

          {/* Notifications Tab */}
          {activeTab === 'notifications' && (
            <motion.div
              className="glass-card p-6"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
            >
              <h3 className="text-xl font-semibold text-white mb-6">Notification Preferences</h3>
              <div className="space-y-6">
                <div>
                  <h4 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
                    <Mail className="w-4 h-4" />
                    Email Notifications
                  </h4>
                  <div className="space-y-3">
                    {[
                      { label: 'Daily summary reports', sublabel: '9:00 AM', checked: true },
                      { label: 'High occupancy alerts', sublabel: 'Above 80% capacity', checked: true },
                      { label: 'Temperature alerts', sublabel: 'Outside 68-74°F', checked: true },
                      { label: 'Weekly performance reports', sublabel: 'Monday 9:00 AM', checked: false },
                      { label: 'Monthly insights', sublabel: '1st of month', checked: false },
                      { label: 'Sensor offline alerts', sublabel: 'Immediate', checked: true },
                    ].map((item, i) => (
                      <div key={i} className="flex items-center justify-between p-3 bg-white/5 rounded">
                        <div>
                          <div className="text-white text-sm">{item.label}</div>
                          <div className="text-xs text-gray-400">{item.sublabel}</div>
                        </div>
                        <input type="checkbox" defaultChecked={item.checked} className="w-5 h-5" />
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
                    <Phone className="w-4 h-4" />
                    SMS Notifications
                    <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-400">Optional</span>
                  </h4>
                  <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg mb-4">
                    <p className="text-sm text-blue-300">
                      SMS notifications require phone verification and may incur additional costs.
                    </p>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-white text-sm">Enable SMS alerts</span>
                      <input type="checkbox" className="w-5 h-5" />
                    </div>
                    <input
                      type="tel"
                      placeholder="+1 (555) 000-0000"
                      className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white"
                      disabled
                    />
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* Preferences Tab */}
          {activeTab === 'preferences' && (
            <motion.div
              className="glass-card p-6"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
            >
              <h3 className="text-xl font-semibold text-white mb-6">Display Preferences</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-white">Sound Alerts</p>
                    <p className="text-xs text-gray-400">Play sounds for notifications</p>
                  </div>
                  <button
                    onClick={() => setSettings({ ...settings, soundAlerts: !settings.soundAlerts })}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      settings.soundAlerts ? 'bg-cyan' : 'bg-gray-600'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        settings.soundAlerts ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Temperature Unit
                  </label>
                  <select className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white">
                    <option>Fahrenheit (°F)</option>
                    <option>Celsius (°C)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Time Zone
                  </label>
                  <select className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white">
                    <option>America/New_York (Eastern)</option>
                    <option>America/Chicago (Central)</option>
                    <option>America/Denver (Mountain)</option>
                    <option>America/Los_Angeles (Pacific)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Refresh Interval (seconds)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="60"
                    value={settings.refreshInterval}
                    onChange={(e) => setSettings({ ...settings, refreshInterval: parseInt(e.target.value) || 5 })}
                    className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-cyan/50 focus:ring-2 focus:ring-cyan/20 transition-all text-white"
                  />
                </div>
              </div>
            </motion.div>
          )}

          {/* Integrations Tab */}
          {activeTab === 'integrations' && (
            <>
          {/* Venue Configuration */}
          <motion.div
            className="glass-card p-6"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
          >
            <div className="flex items-center gap-3 mb-4">
              <MapPin className="w-5 h-5 text-cyan" />
              <h3 className="text-xl font-semibold text-white">Venue Configuration</h3>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Venue ID
                </label>
                <input
                  type="text"
                  value={settings.venueId}
                  disabled
                  className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-gray-400 cursor-not-allowed"
                />
                <p className="text-xs text-gray-400 mt-1">
                  Venue: {user?.venueName || 'Not configured'}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Location ID
                </label>
                <input
                  type="text"
                  value={settings.locationId}
                  disabled
                  className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-gray-400 cursor-not-allowed"
                />
                <p className="text-xs text-gray-400 mt-1">
                  Location: {user?.locations?.[0]?.name || 'Not configured'}
                </p>
              </div>
            </div>
          </motion.div>

          {/* Toast POS Integration */}
          <motion.div
            className="glass-card p-6"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
          >
            <div className="flex items-center gap-3 mb-4">
              <DollarSign className="w-5 h-5 text-cyan" />
              <h3 className="text-xl font-semibold text-white">Toast POS Integration</h3>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-white">Enable Toast POS</p>
                  <p className="text-xs text-gray-400">Connect to Toast for revenue analytics</p>
                </div>
                <button
                  onClick={() => setSettings({ ...settings, toastPOSEnabled: !settings.toastPOSEnabled })}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    settings.toastPOSEnabled ? 'bg-cyan' : 'bg-gray-600'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      settings.toastPOSEnabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {settings.toastPOSEnabled && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      <Key className="w-4 h-4 inline mr-2" />
                      Toast API Key
                    </label>
                    <input
                      type="password"
                      value={settings.toastAPIKey || ''}
                      onChange={(e) => setSettings({ ...settings, toastAPIKey: e.target.value })}
                      placeholder="Enter your Toast API key"
                      className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-cyan/50 focus:ring-2 focus:ring-cyan/20 transition-all text-white"
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      Get your API key from Toast Dashboard → Integrations → API Access
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      <Building2 className="w-4 h-4 inline mr-2" />
                      Restaurant GUID
                    </label>
                    <input
                      type="text"
                      value={toastRestaurantGuid}
                      onChange={(e) => setToastRestaurantGuid(e.target.value)}
                      placeholder="Enter your Restaurant GUID"
                      className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-cyan/50 focus:ring-2 focus:ring-cyan/20 transition-all text-white"
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      Find your Restaurant GUID in Toast Dashboard → Locations
                    </p>
                  </div>

                  <div className="p-3 bg-cyan/5 border border-cyan/20 rounded-lg">
                    <p className="text-xs text-cyan-300">
                      <strong>Note:</strong> Toast POS credentials are stored securely in your browser's local storage and are only used to fetch your restaurant data.
                    </p>
                  </div>
                </>
              )}
            </div>
          </motion.div>

          {/* Cache Management */}
          <motion.div
            className="glass-card p-6"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 }}
          >
            <div className="flex items-center gap-3 mb-4">
              <Trash2 className="w-5 h-5 text-yellow-500" />
              <h3 className="text-xl font-semibold text-white">Cache Management</h3>
            </div>

            <div className="space-y-4">
              <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm text-yellow-300 font-medium mb-1">
                      Seeing old or fake location data?
                    </p>
                    <p className="text-xs text-yellow-300/80">
                      Clear the location cache to remove old cached locations and fetch fresh data from your AWS DynamoDB VenueConfig table. The page will reload after clearing.
                    </p>
                  </div>
                </div>
              </div>

              <motion.button
                onClick={clearLocationCache}
                disabled={cacheCleared}
                className={`w-full px-4 py-3 rounded-lg border transition-all flex items-center justify-center gap-2 ${
                  cacheCleared
                    ? 'bg-green-500/20 border-green-500/50 text-green-400'
                    : 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/20'
                }`}
                whileHover={cacheCleared ? {} : { scale: 1.02 }}
                whileTap={cacheCleared ? {} : { scale: 0.98 }}
              >
                {cacheCleared ? (
                  <>
                    <Check className="w-5 h-5" />
                    Cache Cleared! Reloading...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-5 h-5" />
                    Clear Location Cache
                  </>
                )}
              </motion.button>
            </div>
          </motion.div>
            </>
          )}

          {/* About Tab */}
          {activeTab === 'about' && (
            <motion.div
              className="glass-card p-6"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
            >
              <h3 className="text-xl font-semibold text-white mb-6">About Pulse</h3>
              <div className="space-y-6">
                <div className="text-center py-6">
                  <div className="text-4xl font-bold gradient-text mb-2">Pulse</div>
                  <div className="text-gray-400 mb-1">by Advizia</div>
                  <div className="text-sm text-gray-500">Version 2.0.0</div>
                  <div className="text-xs text-gray-600 mt-2">Last Updated: Nov 6, 2025</div>
                </div>

                <div className="space-y-3">
                  <div className="p-4 bg-white/5 rounded-lg">
                    <div className="text-sm text-gray-400 mb-1">Support</div>
                    <a href="mailto:support@advizia.com" className="text-cyan-400 hover:text-cyan-300">
                      support@advizia.com
                    </a>
                  </div>

                  <div className="p-4 bg-white/5 rounded-lg">
                    <div className="text-sm text-gray-400 mb-1">Documentation</div>
                    <a href="#" className="text-cyan-400 hover:text-cyan-300">
                      docs.advizia.com
                    </a>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button className="btn-secondary flex-1">Terms of Service</button>
                  <button className="btn-secondary flex-1">Privacy Policy</button>
                </div>
              </div>
            </motion.div>
          )}

          {/* Save Button for Integrations */}
          {activeTab === 'integrations' && (
          <motion.button
            onClick={saveSettings}
            className="w-full btn-primary flex items-center justify-center gap-2 mt-6"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
          >
            {saved ? (
              <>
                <Check className="w-5 h-5" />
                Settings Saved!
              </>
            ) : (
              <>
                <Save className="w-5 h-5" />
                Save Settings
              </>
            )}
          </motion.button>
          )}
        </div>
      </motion.div>
    </div>
  );
}

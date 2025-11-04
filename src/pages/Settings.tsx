import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Save, Key, MapPin, DollarSign, Check } from 'lucide-react';
import type { AppSettings } from '../types';
import { VENUE_CONFIG } from '../config/amplify';
import authService from '../services/auth.service';

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
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

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = () => {
    try {
      // Get venueId and locationId from authenticated user, not localStorage
      const user = authService.getStoredUser();
      
      // Load other settings from localStorage (excluding venueId/locationId)
      const stored = localStorage.getItem('appSettings');
      let parsedSettings: Partial<AppSettings> = {};
      if (stored) {
        const parsed = JSON.parse(stored);
        // Explicitly exclude venueId and locationId from stored settings
        parsedSettings = {
          theme: parsed.theme,
          soundAlerts: parsed.soundAlerts,
          refreshInterval: parsed.refreshInterval,
          notifications: parsed.notifications,
          toastPOSEnabled: parsed.toastPOSEnabled,
          toastAPIKey: parsed.toastAPIKey
        };
      }
      
      // Set venueId and locationId from user, not from stored settings
      setSettings({
        ...DEFAULT_SETTINGS,
        ...parsedSettings,
        venueId: user?.venueId || '',
        locationId: user?.locations?.[0]?.id || ''
      });
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  };

  const saveSettings = () => {
    try {
      // Save settings but exclude venueId and locationId (they come from user attributes)
      const settingsToSave = {
        theme: settings.theme,
        soundAlerts: settings.soundAlerts,
        refreshInterval: settings.refreshInterval,
        notifications: settings.notifications,
        toastPOSEnabled: settings.toastPOSEnabled,
        toastAPIKey: settings.toastAPIKey
      };
      
      localStorage.setItem('appSettings', JSON.stringify(settingsToSave));
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (error) {
      console.error('Error saving settings:', error);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h2 className="text-3xl font-bold gradient-text mb-8">Settings</h2>

        <div className="space-y-6">
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
                  Configured: {VENUE_CONFIG.venueName}
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
                  Configured: {VENUE_CONFIG.locationName}
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
                    Get your API key from Toast Dashboard → Integrations
                  </p>
                </div>
              )}
            </div>
          </motion.div>

          {/* Display Preferences */}
          <motion.div
            className="glass-card p-6"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 }}
          >
            <h3 className="text-xl font-semibold text-white mb-4">Display Preferences</h3>

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

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-white">Notifications</p>
                  <p className="text-xs text-gray-400">Show browser notifications</p>
                </div>
                <button
                  onClick={() => setSettings({ ...settings, notifications: !settings.notifications })}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    settings.notifications ? 'bg-cyan' : 'bg-gray-600'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      settings.notifications ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
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

          {/* Save Button */}
          <motion.button
            onClick={saveSettings}
            className="w-full btn-primary flex items-center justify-center gap-2"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
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
        </div>
      </motion.div>
    </div>
  );
}

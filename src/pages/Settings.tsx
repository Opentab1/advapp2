import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  Key, MapPin, Check, Building2,
  User, Info, CloudSun, Sliders, Users, Save, CreditCard
} from 'lucide-react';
import authService from '../services/auth.service';
import venueSettingsService, { VenueAddress } from '../services/venue-settings.service';
import weatherService from '../services/weather.service';
import { getUserRoleDisplay } from '../utils/userRoles';
import { ChangePasswordModal } from '../components/ChangePasswordModal';
import { AddressSettings } from '../components/AddressSettings';
import { CalibrationSettings } from '../components/CalibrationSettings';
import { POSIntegration } from '../components/settings/POSIntegration';
import { haptic } from '../utils/haptics';

export function Settings() {
  const [activeTab, setActiveTab] = useState<'account' | 'venue' | 'integrations' | 'calibration' | 'about'>('account');
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [savedAddress, setSavedAddress] = useState<VenueAddress | null>(null);
  const [capacity, setCapacity] = useState<number | ''>('');
  const [capacitySaving, setCapacitySaving] = useState(false);
  const [capacitySaved, setCapacitySaved] = useState(false);
  const user = authService.getStoredUser();

  useEffect(() => {
    // Load saved address and capacity
    if (user?.venueId) {
      const address = venueSettingsService.getAddress(user.venueId);
      setSavedAddress(address);
      
      const savedCapacity = venueSettingsService.getCapacity(user.venueId);
      if (savedCapacity) {
        setCapacity(savedCapacity);
      }
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
                    value={user?.venueName || 'Not configured'}
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
                      value={user?.venueName || 'Not configured'}
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
                  <div className="text-xs text-warm-600 mt-2">Last Updated: Jan 2, 2026</div>
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

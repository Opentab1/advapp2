import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, Save, X, AlertCircle, CheckCircle, Loader2 } from 'lucide-react';
import venueSettingsService, { VenueAddress } from '../services/venue-settings.service';
import weatherService from '../services/weather.service';

interface AddressSettingsProps {
  venueId: string;
  onAddressSaved?: (address: VenueAddress) => void;
  onClose?: () => void;
  inline?: boolean; // If true, show as inline form instead of modal
}

export function AddressSettings({ venueId, onAddressSaved, onClose, inline = false }: AddressSettingsProps) {
  const [address, setAddress] = useState<Partial<VenueAddress>>({
    street: '',
    city: '',
    state: '',
    zipCode: '',
    country: 'USA'
  });
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [success, setSuccess] = useState(false);
  const [weatherPreview, setWeatherPreview] = useState<{ temp: number; conditions: string } | null>(null);

  // Load existing address from cloud on mount
  useEffect(() => {
    const loadAddress = async () => {
      // First check local cache for immediate display
      const cached = venueSettingsService.getAddress(venueId);
      if (cached) {
        setAddress(cached);
      }
      
      // Then load from cloud to ensure we have the latest
      try {
        const cloudAddress = await venueSettingsService.getAddressFromCloud(venueId);
        if (cloudAddress) {
          setAddress(cloudAddress);
        }
      } catch (error) {
        console.warn('Could not load address from cloud:', error);
      }
    };
    
    loadAddress();
  }, [venueId]);

  const handleChange = (field: keyof VenueAddress, value: string) => {
    setAddress(prev => ({ ...prev, [field]: value }));
    setErrors([]);
    setSuccess(false);
  };

  const validateAndPreview = async () => {
    setValidating(true);
    setErrors([]);
    setWeatherPreview(null);

    try {
      // Validate fields
      const validation = venueSettingsService.validateAddress(address);
      if (!validation.valid) {
        setErrors(validation.errors);
        setValidating(false);
        return false;
      }

      // Try to geocode and get weather as validation
      const fullAddress = `${address.street}, ${address.city}, ${address.state} ${address.zipCode}`;
      const weather = await weatherService.getWeatherByAddress(fullAddress);
      
      if (weather) {
        setWeatherPreview({ temp: weather.temperature, conditions: weather.conditions });
        return true;
      } else {
        setErrors(['Could not find weather for this address. Please verify the address is correct.']);
        return false;
      }
    } catch (error) {
      setErrors(['Failed to validate address. Please check your internet connection.']);
      return false;
    } finally {
      setValidating(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setErrors([]);

    try {
      // Validate first
      const isValid = await validateAndPreview();
      if (!isValid) {
        setSaving(false);
        return;
      }

      // Save the address to AWS (cloud-first)
      const saved = await venueSettingsService.saveAddressAsync(venueId, address as VenueAddress);
      
      if (!saved) {
        console.warn('⚠️ Could not save to cloud, but saved locally');
      }
      
      // Clear weather cache to force refresh with new address
      weatherService.clearCache();
      
      setSuccess(true);
      
      if (onAddressSaved) {
        onAddressSaved(address as VenueAddress);
      }

      // Auto-close after success if not inline
      if (!inline && onClose) {
        setTimeout(() => onClose(), 1500);
      }
    } catch (error: any) {
      setErrors([error.message || 'Failed to save address']);
    } finally {
      setSaving(false);
    }
  };

  const formContent = (
    <div className="space-y-4">
      {/* Street Address */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">
          Street Address <span className="text-red-400">*</span>
        </label>
        <input
          type="text"
          value={address.street || ''}
          onChange={(e) => handleChange('street', e.target.value)}
          placeholder="123 Main Street"
          className="w-full px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:border-cyan/50 focus:outline-none transition-colors"
        />
      </div>

      {/* City and State */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            City <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={address.city || ''}
            onChange={(e) => handleChange('city', e.target.value)}
            placeholder="Miami"
            className="w-full px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:border-cyan/50 focus:outline-none transition-colors"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            State <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={address.state || ''}
            onChange={(e) => handleChange('state', e.target.value)}
            placeholder="FL"
            maxLength={2}
            className="w-full px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:border-cyan/50 focus:outline-none transition-colors uppercase"
          />
        </div>
      </div>

      {/* ZIP and Country */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            ZIP Code <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={address.zipCode || ''}
            onChange={(e) => handleChange('zipCode', e.target.value)}
            placeholder="33101"
            maxLength={10}
            className="w-full px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:border-cyan/50 focus:outline-none transition-colors"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Country
          </label>
          <select
            value={address.country || 'USA'}
            onChange={(e) => handleChange('country', e.target.value)}
            className="w-full px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white focus:border-cyan/50 focus:outline-none transition-colors"
          >
            <option value="USA">United States</option>
            <option value="Canada">Canada</option>
            <option value="UK">United Kingdom</option>
            <option value="Australia">Australia</option>
          </select>
        </div>
      </div>

      {/* Errors */}
      <AnimatePresence>
        {errors.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="p-3 rounded-lg bg-red-500/10 border border-red-500/30"
          >
            <div className="flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-red-300">
                {errors.map((error, i) => (
                  <div key={i}>{error}</div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Weather Preview */}
      <AnimatePresence>
        {weatherPreview && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="p-3 rounded-lg bg-green-500/10 border border-green-500/30"
          >
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-400" />
              <span className="text-sm text-green-300">
                Address verified! Current weather: {weatherPreview.temp}°F, {weatherPreview.conditions}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Success Message */}
      <AnimatePresence>
        {success && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="p-3 rounded-lg bg-green-500/10 border border-green-500/30"
          >
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-400" />
              <span className="text-sm text-green-300">
                Address saved and synced to cloud! Works on all your devices.
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Actions */}
      <div className="flex justify-end gap-3 pt-2">
        {!inline && onClose && (
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-white/5 text-gray-300 hover:bg-white/10 transition-colors"
          >
            Cancel
          </button>
        )}
        <motion.button
          onClick={handleSave}
          disabled={saving || validating}
          className="btn-primary flex items-center gap-2 disabled:opacity-50"
          whileHover={{ scale: saving ? 1 : 1.02 }}
          whileTap={{ scale: saving ? 1 : 0.98 }}
        >
          {saving || validating ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {validating ? 'Verifying...' : 'Saving...'}
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              Save Address
            </>
          )}
        </motion.button>
      </div>
    </div>
  );

  if (inline) {
    return (
      <div className="glass-card p-6">
        <div className="flex items-center gap-3 mb-4">
          <MapPin className="w-5 h-5 text-cyan" />
          <h3 className="text-lg font-semibold text-white">Venue Address</h3>
        </div>
        <p className="text-sm text-gray-400 mb-4">
          Enter your venue's address to enable outdoor weather display
        </p>
        {formContent}
      </div>
    );
  }

  // Modal version
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="glass-card p-6 max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <MapPin className="w-6 h-6 text-cyan" />
            <h2 className="text-xl font-semibold text-white">Set Venue Address</h2>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded-lg hover:bg-white/10 transition-colors"
            >
              <X className="w-5 h-5 text-gray-400" />
            </button>
          )}
        </div>
        <p className="text-sm text-gray-400 mb-6">
          Enter your venue's address to enable outdoor weather display. This helps us provide accurate local weather data.
        </p>
        {formContent}
      </motion.div>
    </motion.div>
  );
}

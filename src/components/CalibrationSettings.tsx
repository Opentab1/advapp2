/**
 * CalibrationSettings - Venue calibration UI
 * 
 * Allows venue owners to customize optimal ranges for their specific venue type.
 * Uses presets or manual sliders for sound and light ranges.
 */

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Volume2, Sun, Check, RotateCcw, Sparkles } from 'lucide-react';
import venueCalibrationService, { 
  VenueCalibration, 
  VENUE_TYPE_PRESETS 
} from '../services/venue-calibration.service';
import { TIME_SLOT_RANGES } from '../utils/constants';
import { getCurrentTimeSlot } from '../utils/scoring';
import { haptic } from '../utils/haptics';

interface CalibrationSettingsProps {
  venueId: string;
}

export function CalibrationSettings({ venueId }: CalibrationSettingsProps) {
  const [calibration, setCalibration] = useState<VenueCalibration | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  
  // Get current time slot defaults for reference
  const timeSlot = getCurrentTimeSlot();
  const defaults = TIME_SLOT_RANGES[timeSlot];
  
  // Local state for editing
  const [soundMin, setSoundMin] = useState(defaults.sound.min);
  const [soundMax, setSoundMax] = useState(defaults.sound.max);
  const [lightMin, setLightMin] = useState(defaults.light.min);
  const [lightMax, setLightMax] = useState(defaults.light.max);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  
  // Load existing calibration
  useEffect(() => {
    const existing = venueCalibrationService.getCalibration(venueId);
    if (existing) {
      setCalibration(existing);
      if (existing.sound) {
        setSoundMin(existing.sound.min);
        setSoundMax(existing.sound.max);
      }
      if (existing.light) {
        setLightMin(existing.light.min);
        setLightMax(existing.light.max);
      }
      if (existing.venueType) {
        setSelectedPreset(existing.venueType);
      }
    }
  }, [venueId]);
  
  const handlePresetSelect = (presetKey: string) => {
    haptic('selection');
    const preset = VENUE_TYPE_PRESETS[presetKey];
    setSoundMin(preset.sound.min);
    setSoundMax(preset.sound.max);
    setLightMin(preset.light.min);
    setLightMax(preset.light.max);
    setSelectedPreset(presetKey);
  };
  
  const handleSave = () => {
    haptic('success');
    const newCalibration: VenueCalibration = {
      venueId,
      sound: { min: soundMin, max: soundMax },
      light: { min: lightMin, max: lightMax },
      venueType: selectedPreset as VenueCalibration['venueType'] || 'custom',
      updatedAt: new Date().toISOString(),
    };
    venueCalibrationService.saveCalibration(newCalibration);
    setCalibration(newCalibration);
    setShowSuccess(true);
    setTimeout(() => setShowSuccess(false), 2000);
  };
  
  const handleReset = () => {
    haptic('warning');
    venueCalibrationService.clearCalibration(venueId);
    setCalibration(null);
    setSoundMin(defaults.sound.min);
    setSoundMax(defaults.sound.max);
    setLightMin(defaults.light.min);
    setLightMax(defaults.light.max);
    setSelectedPreset(null);
  };
  
  return (
    <div className="space-y-6">
      {/* Presets */}
      <div>
        <h4 className="text-sm font-medium text-warm-300 mb-3">Quick Presets</h4>
        <p className="text-xs text-warm-500 mb-4">
          Choose a venue type to apply recommended ranges, or customize below.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {Object.entries(VENUE_TYPE_PRESETS).map(([key, preset]) => (
            <button
              key={key}
              onClick={() => handlePresetSelect(key)}
              className={`p-3 rounded-lg border text-left transition-all ${
                selectedPreset === key
                  ? 'bg-primary/20 border-primary/50 text-white'
                  : 'bg-warm-800 border-warm-700 text-warm-400 hover:border-warm-500'
              }`}
            >
              <div className="text-sm font-medium">{preset.label}</div>
              <div className="text-xs opacity-60">{preset.description}</div>
            </button>
          ))}
        </div>
      </div>
      
      {/* Advanced Toggle */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="text-sm text-primary hover:text-primary/80 transition-colors"
      >
        {isExpanded ? '▼ Hide' : '▶ Show'} Custom Ranges
      </button>
      
      {/* Custom Ranges */}
      {isExpanded && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="space-y-6"
        >
          {/* Sound Range */}
          <div className="bg-warm-800/50 rounded-xl p-4 border border-warm-700">
            <div className="flex items-center gap-2 mb-4">
              <Volume2 className="w-5 h-5 text-primary" />
              <span className="font-medium text-warm-100">Sound Level (dB)</span>
            </div>
            
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs text-warm-500 mb-1">Minimum</label>
                <input
                  type="number"
                  value={soundMin}
                  onChange={(e) => setSoundMin(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-warm-900 border border-warm-700 rounded-lg text-warm-100 text-center"
                  min={50}
                  max={90}
                />
              </div>
              <div>
                <label className="block text-xs text-warm-500 mb-1">Maximum</label>
                <input
                  type="number"
                  value={soundMax}
                  onChange={(e) => setSoundMax(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-warm-900 border border-warm-700 rounded-lg text-warm-100 text-center"
                  min={50}
                  max={95}
                />
              </div>
            </div>
            
            {/* Visual range indicator */}
            <div className="relative h-2 bg-warm-700 rounded-full">
              <div
                className="absolute h-2 bg-primary rounded-full"
                style={{
                  left: `${((soundMin - 50) / 45) * 100}%`,
                  right: `${100 - ((soundMax - 50) / 45) * 100}%`,
                }}
              />
            </div>
            <div className="flex justify-between text-xs text-warm-500 mt-1">
              <span>50 dB (quiet)</span>
              <span>95 dB (loud)</span>
            </div>
            
            <p className="text-xs text-warm-500 mt-3">
              Default for current time: {defaults.sound.min}-{defaults.sound.max} dB
            </p>
          </div>
          
          {/* Light Range */}
          <div className="bg-warm-800/50 rounded-xl p-4 border border-warm-700">
            <div className="flex items-center gap-2 mb-4">
              <Sun className="w-5 h-5 text-amber-400" />
              <span className="font-medium text-warm-100">Light Level (lux)</span>
            </div>
            
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs text-warm-500 mb-1">Minimum</label>
                <input
                  type="number"
                  value={lightMin}
                  onChange={(e) => setLightMin(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-warm-900 border border-warm-700 rounded-lg text-warm-100 text-center"
                  min={0}
                  max={500}
                />
              </div>
              <div>
                <label className="block text-xs text-warm-500 mb-1">Maximum</label>
                <input
                  type="number"
                  value={lightMax}
                  onChange={(e) => setLightMax(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-warm-900 border border-warm-700 rounded-lg text-warm-100 text-center"
                  min={0}
                  max={600}
                />
              </div>
            </div>
            
            {/* Visual range indicator */}
            <div className="relative h-2 bg-warm-700 rounded-full">
              <div
                className="absolute h-2 bg-amber-400 rounded-full"
                style={{
                  left: `${(lightMin / 600) * 100}%`,
                  right: `${100 - (lightMax / 600) * 100}%`,
                }}
              />
            </div>
            <div className="flex justify-between text-xs text-warm-500 mt-1">
              <span>0 lux (dark)</span>
              <span>600 lux (bright)</span>
            </div>
            
            <p className="text-xs text-warm-500 mt-3">
              Default for current time: {defaults.light.min}-{defaults.light.max} lux
            </p>
          </div>
        </motion.div>
      )}
      
      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={handleSave}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-primary hover:bg-primary/80 text-black font-semibold rounded-lg transition-colors"
        >
          {showSuccess ? (
            <>
              <Check className="w-4 h-4" />
              Saved!
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              Save Calibration
            </>
          )}
        </button>
        
        {calibration && (
          <button
            onClick={handleReset}
            className="px-4 py-3 bg-warm-700 hover:bg-warm-600 text-warm-300 rounded-lg transition-colors"
            title="Reset to defaults"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        )}
      </div>
      
      {/* Status */}
      {calibration && (
        <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-green-400" />
            <span className="text-sm text-green-400">
              Custom calibration active
              {calibration.venueType && calibration.venueType !== 'custom' && 
                ` (${VENUE_TYPE_PRESETS[calibration.venueType]?.label || calibration.venueType})`
              }
            </span>
          </div>
          <p className="text-xs text-green-300/70 mt-1">
            Updated {new Date(calibration.updatedAt).toLocaleDateString()}
          </p>
        </div>
      )}
      
      {!calibration && (
        <div className="p-3 bg-warm-700/50 border border-warm-700 rounded-lg">
          <p className="text-xs text-warm-500">
            Using time-aware defaults. Set custom ranges above to optimize for your venue.
          </p>
        </div>
      )}
    </div>
  );
}

export default CalibrationSettings;

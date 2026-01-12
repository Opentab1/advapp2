/**
 * Venue Calibration Service
 * 
 * Manages per-venue custom optimal ranges for sound and light.
 * Falls back to time-slot defaults if not customized.
 * 
 * Stored in localStorage for now, can be migrated to backend later.
 */

export interface VenueCalibration {
  venueId: string;
  // Custom overrides (null = use default)
  sound?: {
    min: number;
    max: number;
  };
  light?: {
    min: number;
    max: number;
  };
  temperature?: {
    min: number;
    max: number;
  };
  // Venue type preset
  venueType?: 'dive_bar' | 'cocktail_lounge' | 'sports_bar' | 'nightclub' | 'restaurant_bar' | 'custom';
  // When calibration was last updated
  updatedAt: string;
}

// Preset ranges by venue type
export const VENUE_TYPE_PRESETS: Record<string, {
  label: string;
  description: string;
  sound: { min: number; max: number };
  light: { min: number; max: number };
}> = {
  dive_bar: {
    label: 'Dive Bar',
    description: 'Casual, loud, low lighting',
    sound: { min: 72, max: 82 },
    light: { min: 30, max: 150 },
  },
  cocktail_lounge: {
    label: 'Cocktail Lounge',
    description: 'Upscale, conversational, ambient',
    sound: { min: 62, max: 72 },
    light: { min: 50, max: 200 },
  },
  sports_bar: {
    label: 'Sports Bar',
    description: 'Game nights can get loud',
    sound: { min: 70, max: 85 },
    light: { min: 100, max: 400 },
  },
  nightclub: {
    label: 'Nightclub',
    description: 'High energy, dark, loud',
    sound: { min: 78, max: 90 },
    light: { min: 20, max: 100 },
  },
  restaurant_bar: {
    label: 'Restaurant Bar',
    description: 'Dining-friendly, conversational',
    sound: { min: 58, max: 70 },
    light: { min: 150, max: 400 },
  },
};

const STORAGE_KEY = 'venue_calibration';

class VenueCalibrationService {
  /**
   * Get calibration for a venue
   */
  getCalibration(venueId: string): VenueCalibration | null {
    try {
      const stored = localStorage.getItem(`${STORAGE_KEY}_${venueId}`);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (error) {
      console.error('Error reading calibration:', error);
    }
    return null;
  }

  /**
   * Save calibration for a venue
   */
  saveCalibration(calibration: VenueCalibration): void {
    try {
      calibration.updatedAt = new Date().toISOString();
      localStorage.setItem(`${STORAGE_KEY}_${calibration.venueId}`, JSON.stringify(calibration));
    } catch (error) {
      console.error('Error saving calibration:', error);
    }
  }

  /**
   * Clear calibration for a venue (reset to defaults)
   */
  clearCalibration(venueId: string): void {
    try {
      localStorage.removeItem(`${STORAGE_KEY}_${venueId}`);
    } catch (error) {
      console.error('Error clearing calibration:', error);
    }
  }

  /**
   * Apply a venue type preset
   */
  applyPreset(venueId: string, venueType: keyof typeof VENUE_TYPE_PRESETS): VenueCalibration {
    const preset = VENUE_TYPE_PRESETS[venueType];
    const calibration: VenueCalibration = {
      venueId,
      venueType: venueType as VenueCalibration['venueType'],
      sound: preset.sound,
      light: preset.light,
      updatedAt: new Date().toISOString(),
    };
    this.saveCalibration(calibration);
    return calibration;
  }

  /**
   * Get effective ranges for a venue (custom or defaults)
   */
  getEffectiveRanges(venueId: string, defaultRanges: {
    sound: { min: number; max: number };
    light: { min: number; max: number };
  }): {
    sound: { min: number; max: number };
    light: { min: number; max: number };
    isCustom: boolean;
  } {
    const calibration = this.getCalibration(venueId);
    
    if (calibration) {
      return {
        sound: calibration.sound || defaultRanges.sound,
        light: calibration.light || defaultRanges.light,
        isCustom: true,
      };
    }
    
    return {
      ...defaultRanges,
      isCustom: false,
    };
  }
}

export const venueCalibrationService = new VenueCalibrationService();
export default venueCalibrationService;

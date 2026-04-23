/**
 * Venue Calibration Service
 *
 * Manages per-venue custom optimal ranges for sound and light.
 * Falls back to time-slot defaults if not customized.
 *
 * Persisted via venueSettings.service so any device the manager logs in on
 * shows the same calibration. The local synchronous methods still return
 * cached values for immediate rendering; `hydrate()` should be called once on
 * mount to pull the authoritative copy from DynamoDB.
 */
import {
  loadVenueSetting, saveVenueSetting, peekVenueSetting,
} from './venueSettings.service';

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

class VenueCalibrationService {
  /**
   * Synchronous read of the local cache. Returns whatever we last saw from
   * the server (or a fresh local edit). Call `hydrate(venueId)` once on mount
   * to ensure the cache reflects the latest server state.
   */
  getCalibration(venueId: string): VenueCalibration | null {
    return peekVenueSetting<VenueCalibration | null>('calibration', null, venueId);
  }

  /**
   * Fetch calibration from DynamoDB, populate the local cache, and return it.
   * UI components should call this in useEffect so cross-device changes show
   * up on first render.
   */
  async hydrate(venueId: string): Promise<VenueCalibration | null> {
    return loadVenueSetting<VenueCalibration | null>('calibration', null, venueId);
  }

  /**
   * Save calibration. Writes through to DynamoDB so other devices see the
   * update on their next hydrate().
   */
  saveCalibration(calibration: VenueCalibration): void {
    calibration.updatedAt = new Date().toISOString();
    // Fire-and-forget: venueSettings.saveVenueSetting populates the local
    // cache synchronously, so subsequent getCalibration() calls already
    // reflect the write even if the network request is still in flight.
    void saveVenueSetting('calibration', calibration, calibration.venueId);
  }

  /**
   * Clear calibration (reset to defaults). Writes null to the server so
   * every device stops seeing the override.
   */
  clearCalibration(venueId: string): void {
    void saveVenueSetting<VenueCalibration | null>('calibration', null, venueId);
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

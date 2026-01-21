/**
 * Venue Settings Service
 * 
 * Manages venue-specific settings like address and capacity
 * PRIMARY STORAGE: AWS (via API Gateway + DynamoDB)
 * SECONDARY STORAGE: localStorage (cache for offline/performance)
 * 
 * Settings persist across all devices for the same venue.
 */

import { isDemoAccount, DEMO_VENUE } from '../utils/demoData';

// Lazy-load Amplify client to avoid initialization issues
async function getAmplifyClient() {
  try {
    const { generateClient } = await import('aws-amplify/api');
    return generateClient();
  } catch (error) {
    console.warn('Could not load Amplify client:', error);
    return null;
  }
}

export interface VenueAddress {
  street: string;
  city: string;
  state: string;
  zipCode: string;
  country?: string;
}

export interface VenueSettings {
  address?: VenueAddress;
  capacity?: number;  // Max capacity of the venue
  lastUpdated?: string;
}

// API endpoint for venue settings (same pattern as display-settings)
const VENUE_SETTINGS_API = 'https://7ox6y1t1f1.execute-api.us-east-2.amazonaws.com/venue-settings';

// Demo account address
const DEMO_ADDRESS: VenueAddress = {
  street: '1521 S Howard Ave',
  city: 'Tampa',
  state: 'FL',
  zipCode: '33606',
  country: 'USA',
};

class VenueSettingsService {
  private readonly STORAGE_KEY = 'pulse_venue_settings';
  private cloudSettingsCache: Map<string, VenueSettings> = new Map();
  private loadingPromises: Map<string, Promise<VenueSettings | null>> = new Map();

  // ============ AWS CLOUD STORAGE METHODS ============

  /**
   * Load settings from AWS (primary source of truth)
   * Caches result in memory and localStorage for performance
   */
  async loadSettingsFromCloud(venueId: string): Promise<VenueSettings | null> {
    if (isDemoAccount(venueId)) {
      return {
        address: DEMO_ADDRESS,
        capacity: 150,
        lastUpdated: new Date().toISOString(),
      };
    }

    // Return existing promise if already loading
    if (this.loadingPromises.has(venueId)) {
      return this.loadingPromises.get(venueId)!;
    }

    const loadPromise = (async () => {
      try {
        console.log(`☁️ Loading venue settings from AWS for: ${venueId}`);
        const response = await fetch(`${VENUE_SETTINGS_API}/${venueId}`);
        
        if (response.ok) {
          const data = await response.json();
          console.log('✅ Venue settings loaded from AWS:', data);
          
          // Cache in memory
          this.cloudSettingsCache.set(venueId, data);
          
          // Cache in localStorage for offline access
          this.saveToLocalStorage(venueId, data);
          
          return data as VenueSettings;
        } else if (response.status === 404) {
          console.log('ℹ️ No venue settings found in AWS (new venue)');
          return null;
        } else {
          console.warn('⚠️ Failed to load venue settings from AWS:', response.status);
          // Fall back to localStorage
          return this.getFromLocalStorage(venueId);
        }
      } catch (error) {
        console.warn('⚠️ Error loading venue settings from AWS:', error);
        // Fall back to localStorage
        return this.getFromLocalStorage(venueId);
      } finally {
        this.loadingPromises.delete(venueId);
      }
    })();

    this.loadingPromises.set(venueId, loadPromise);
    return loadPromise;
  }

  /**
   * Save settings to AWS (primary storage)
   * Also updates local cache and localStorage
   */
  async saveSettingsToCloud(venueId: string, settings: VenueSettings): Promise<boolean> {
    if (isDemoAccount(venueId)) {
      console.log('📝 Demo account - not saving to cloud');
      return true;
    }

    const updatedSettings = {
      ...settings,
      lastUpdated: new Date().toISOString()
    };

    try {
      console.log(`☁️ Saving venue settings to AWS for: ${venueId}`);
      const response = await fetch(`${VENUE_SETTINGS_API}/${venueId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedSettings)
      });

      if (response.ok) {
        console.log('✅ Venue settings saved to AWS');
        // Update caches
        this.cloudSettingsCache.set(venueId, updatedSettings);
        this.saveToLocalStorage(venueId, updatedSettings);
        return true;
      } else {
        console.error('❌ Failed to save venue settings to AWS:', response.status);
        // Still save to localStorage as fallback
        this.saveToLocalStorage(venueId, updatedSettings);
        return false;
      }
    } catch (error) {
      console.error('❌ Error saving venue settings to AWS:', error);
      // Save to localStorage as fallback
      this.saveToLocalStorage(venueId, updatedSettings);
      return false;
    }
  }

  // ============ LOCAL STORAGE METHODS (CACHE) ============

  private saveToLocalStorage(venueId: string, settings: VenueSettings): void {
    try {
      const key = `${this.STORAGE_KEY}_${venueId}`;
      localStorage.setItem(key, JSON.stringify(settings));
    } catch (error) {
      console.warn('Could not save to localStorage:', error);
    }
  }

  private getFromLocalStorage(venueId: string): VenueSettings | null {
    try {
      const key = `${this.STORAGE_KEY}_${venueId}`;
      const stored = localStorage.getItem(key);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (error) {
      console.warn('Error loading from localStorage:', error);
    }
    return null;
  }

  // ============ PUBLIC API METHODS ============

  /**
   * Get the full formatted address string for weather API
   * Uses cached data first, loads from cloud if not available
   */
  getFormattedAddress(venueId: string): string | null {
    // Demo account - return Tampa address
    if (isDemoAccount(venueId)) {
      return DEMO_VENUE.address;
    }
    
    const settings = this.getSettings(venueId);
    if (!settings?.address) return null;
    
    const { street, city, state, zipCode, country } = settings.address;
    
    // Build address string
    const parts = [street, city, state, zipCode];
    if (country && country !== 'USA' && country !== 'US') {
      parts.push(country);
    }
    
    return parts.filter(p => p && p.trim()).join(', ');
  }

  /**
   * Get venue settings (sync - uses cache/localStorage)
   * For async cloud fetch, use loadSettingsFromCloud()
   */
  getSettings(venueId: string): VenueSettings | null {
    // Demo account - return preset settings
    if (isDemoAccount(venueId)) {
      return {
        address: DEMO_ADDRESS,
        capacity: 150,
        lastUpdated: new Date().toISOString(),
      };
    }
    
    // Check memory cache first
    if (this.cloudSettingsCache.has(venueId)) {
      return this.cloudSettingsCache.get(venueId)!;
    }
    
    // Fall back to localStorage
    return this.getFromLocalStorage(venueId);
  }

  /**
   * Save venue settings (legacy sync method - now saves to cloud)
   * @deprecated Use saveSettingsToCloud() for explicit async behavior
   */
  saveSettings(venueId: string, settings: VenueSettings): void {
    // Save to localStorage immediately for responsiveness
    this.saveToLocalStorage(venueId, settings);
    this.cloudSettingsCache.set(venueId, settings);
    
    // Also save to cloud (fire and forget)
    this.saveSettingsToCloud(venueId, settings).catch(err => {
      console.warn('Background cloud save failed:', err);
    });
  }

  /**
   * Save address to AWS (async, returns success status)
   */
  async saveAddressAsync(venueId: string, address: VenueAddress): Promise<boolean> {
    const existing = this.getSettings(venueId) || {};
    return this.saveSettingsToCloud(venueId, {
      ...existing,
      address
    });
  }

  /**
   * Save just the address (legacy sync method)
   * @deprecated Use saveAddressAsync() for explicit async behavior
   */
  saveAddress(venueId: string, address: VenueAddress): void {
    const existing = this.getSettings(venueId) || {};
    this.saveSettings(venueId, {
      ...existing,
      address
    });
  }

  /**
   * Get just the address (sync - uses cache)
   */
  getAddress(venueId: string): VenueAddress | null {
    const settings = this.getSettings(venueId);
    return settings?.address || null;
  }

  /**
   * Get address from cloud (async - ensures fresh data)
   */
  async getAddressFromCloud(venueId: string): Promise<VenueAddress | null> {
    const settings = await this.loadSettingsFromCloud(venueId);
    return settings?.address || null;
  }

  /**
   * Check if address is set
   */
  hasAddress(venueId: string): boolean {
    const address = this.getAddress(venueId);
    return !!(address?.city && address?.state);
  }

  /**
   * Validate address fields
   */
  validateAddress(address: Partial<VenueAddress>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!address.street?.trim()) {
      errors.push('Street address is required');
    }
    if (!address.city?.trim()) {
      errors.push('City is required');
    }
    if (!address.state?.trim()) {
      errors.push('State is required');
    }
    if (!address.zipCode?.trim()) {
      errors.push('ZIP code is required');
    } else if (!/^\d{5}(-\d{4})?$/.test(address.zipCode.trim())) {
      errors.push('Invalid ZIP code format (use 12345 or 12345-6789)');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Clear venue settings
   */
  clearSettings(venueId: string): void {
    try {
      const key = `${this.STORAGE_KEY}_${venueId}`;
      localStorage.removeItem(key);
    } catch (error) {
      console.error('Error clearing venue settings:', error);
    }
  }

  // ============ CAPACITY METHODS ============

  /**
   * Get venue capacity (sync - uses cache)
   */
  getCapacity(venueId: string): number | null {
    // Demo account - return demo capacity
    if (isDemoAccount(venueId)) {
      return 150;
    }
    
    const settings = this.getSettings(venueId);
    return settings?.capacity ?? null;
  }

  /**
   * Save venue capacity to AWS
   */
  async saveCapacity(venueId: string, capacity: number): Promise<boolean> {
    const existing = this.getSettings(venueId) || {};
    return this.saveSettingsToCloud(venueId, {
      ...existing,
      capacity
    });
  }

  /**
   * Load capacity from cloud
   */
  async loadCapacityFromCloud(venueId: string): Promise<number | null> {
    const settings = await this.loadSettingsFromCloud(venueId);
    return settings?.capacity ?? null;
  }

  // ============ INITIALIZATION ============

  /**
   * Initialize venue settings from cloud
   * Call this on app startup to sync settings from AWS
   */
  async initializeForVenue(venueId: string): Promise<VenueSettings | null> {
    if (!venueId || isDemoAccount(venueId)) {
      return this.getSettings(venueId);
    }

    console.log(`🚀 Initializing venue settings for: ${venueId}`);
    return this.loadSettingsFromCloud(venueId);
  }

  /**
   * Clear all cached settings (useful on logout)
   */
  clearCache(): void {
    this.cloudSettingsCache.clear();
    this.loadingPromises.clear();
  }
}

const venueSettingsService = new VenueSettingsService();
export default venueSettingsService;

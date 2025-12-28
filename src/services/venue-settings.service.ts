/**
 * Venue Settings Service
 * 
 * Manages venue-specific settings like address that can be updated by operators
 * Uses DynamoDB via userSettingsService for cross-device consistency
 */

import userSettingsService from './user-settings.service';

export interface VenueAddress {
  street: string;
  city: string;
  state: string;
  zipCode: string;
  country?: string;
}

export interface VenueSettings {
  address?: VenueAddress;
  lastUpdated?: string;
}

class VenueSettingsService {
  // In-memory cache for current session
  private settingsCache: Map<string, VenueSettings> = new Map();

  /**
   * Get the full formatted address string for weather API
   */
  getFormattedAddress(venueId: string): string | null {
    const settings = this.getSettingsSync(venueId);
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
   * Get venue settings from cache (sync version for quick access)
   */
  getSettingsSync(venueId: string): VenueSettings | null {
    return this.settingsCache.get(venueId) || null;
  }

  /**
   * Get venue settings - async version that fetches from DynamoDB
   */
  async getSettings(venueId: string): Promise<VenueSettings | null> {
    try {
      // Check cache first
      if (this.settingsCache.has(venueId)) {
        return this.settingsCache.get(venueId) || null;
      }

      // Fetch from DynamoDB
      const venueSettings = await userSettingsService.getVenueSettings(venueId);
      
      if (venueSettings.address) {
        const settings: VenueSettings = {
          address: venueSettings.address,
          lastUpdated: venueSettings.lastUpdated
        };
        this.settingsCache.set(venueId, settings);
        return settings;
      }
    } catch (error) {
      console.error('Error loading venue settings:', error);
    }
    return null;
  }

  /**
   * Save venue settings to DynamoDB
   */
  async saveSettings(venueId: string, settings: VenueSettings): Promise<void> {
    try {
      const updatedSettings = {
        ...settings,
        lastUpdated: new Date().toISOString()
      };

      // Save to DynamoDB
      const success = await userSettingsService.saveVenueSettings(venueId, {
        address: settings.address || null,
      });

      if (success) {
        // Update cache
        this.settingsCache.set(venueId, updatedSettings);
        console.log('✅ Venue settings saved to DynamoDB');
      } else {
        // Fallback: just cache locally for this session
        this.settingsCache.set(venueId, updatedSettings);
        console.log('⚠️ Venue settings cached locally (DynamoDB save pending backend update)');
      }
    } catch (error) {
      console.error('Error saving venue settings:', error);
      throw new Error('Failed to save venue settings');
    }
  }

  /**
   * Save just the address
   */
  async saveAddress(venueId: string, address: VenueAddress): Promise<void> {
    const existing = await this.getSettings(venueId) || {};
    await this.saveSettings(venueId, {
      ...existing,
      address
    });
  }

  /**
   * Get just the address (sync from cache)
   */
  getAddress(venueId: string): VenueAddress | null {
    const settings = this.getSettingsSync(venueId);
    return settings?.address || null;
  }

  /**
   * Get just the address (async from DynamoDB)
   */
  async getAddressAsync(venueId: string): Promise<VenueAddress | null> {
    const settings = await this.getSettings(venueId);
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
   * Clear venue settings cache
   */
  clearSettings(venueId: string): void {
    this.settingsCache.delete(venueId);
  }

  /**
   * Clear all caches
   */
  clearAllCache(): void {
    this.settingsCache.clear();
  }
}

const venueSettingsService = new VenueSettingsService();
export default venueSettingsService;

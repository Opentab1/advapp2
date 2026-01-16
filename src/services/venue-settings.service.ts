/**
 * Venue Settings Service
 * 
 * Manages venue-specific settings like address and capacity
 * Uses localStorage + DynamoDB for persistence across devices
 */

import { generateClient } from 'aws-amplify/api';
import { isDemoAccount, DEMO_VENUE } from '../utils/demoData';

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

  /**
   * Get the full formatted address string for weather API
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
   * Get venue settings from storage
   */
  getSettings(venueId: string): VenueSettings | null {
    // Demo account - return preset settings
    if (isDemoAccount(venueId)) {
      return {
        address: DEMO_ADDRESS,
        lastUpdated: new Date().toISOString(),
      };
    }
    
    try {
      const key = `${this.STORAGE_KEY}_${venueId}`;
      const stored = localStorage.getItem(key);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (error) {
      console.error('Error loading venue settings:', error);
    }
    return null;
  }

  /**
   * Save venue settings to storage
   */
  saveSettings(venueId: string, settings: VenueSettings): void {
    try {
      const key = `${this.STORAGE_KEY}_${venueId}`;
      const updatedSettings = {
        ...settings,
        lastUpdated: new Date().toISOString()
      };
      localStorage.setItem(key, JSON.stringify(updatedSettings));
      console.log('✅ Venue settings saved');
    } catch (error) {
      console.error('Error saving venue settings:', error);
      throw new Error('Failed to save venue settings');
    }
  }

  /**
   * Save just the address
   */
  saveAddress(venueId: string, address: VenueAddress): void {
    const existing = this.getSettings(venueId) || {};
    this.saveSettings(venueId, {
      ...existing,
      address
    });
  }

  /**
   * Get just the address
   */
  getAddress(venueId: string): VenueAddress | null {
    const settings = this.getSettings(venueId);
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
   * Get venue capacity
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
   * Save venue capacity (localStorage + DynamoDB)
   */
  async saveCapacity(venueId: string, capacity: number): Promise<boolean> {
    // Save to localStorage first (immediate)
    const existing = this.getSettings(venueId) || {};
    this.saveSettings(venueId, {
      ...existing,
      capacity
    });

    // Also save to DynamoDB for cross-device persistence
    try {
      const client = generateClient();
      
      const mutation = `
        mutation UpdateVenueCapacity($venueId: ID!, $capacity: Int!) {
          updateVenueCapacity(venueId: $venueId, capacity: $capacity) {
            success
            message
          }
        }
      `;

      const response = await client.graphql({
        query: mutation,
        variables: { venueId, capacity },
        authMode: 'userPool'
      }) as any;

      if (response?.data?.updateVenueCapacity?.success) {
        console.log('✅ Capacity saved to DynamoDB');
        return true;
      }
    } catch (error) {
      // If DynamoDB mutation doesn't exist yet, just use localStorage
      console.warn('⚠️ Could not save capacity to DynamoDB (mutation may not exist):', error);
      // Still return true since we saved to localStorage
    }

    return true;
  }

  /**
   * Load capacity from DynamoDB (for cross-device sync)
   */
  async loadCapacityFromCloud(venueId: string): Promise<number | null> {
    if (isDemoAccount(venueId)) {
      return 150;
    }

    try {
      const client = generateClient();
      
      const query = `
        query GetVenueCapacity($venueId: ID!) {
          getVenueConfig(venueId: $venueId, locationId: "mainfloor") {
            capacity
          }
        }
      `;

      const response = await client.graphql({
        query,
        variables: { venueId },
        authMode: 'userPool'
      }) as any;

      const cloudCapacity = response?.data?.getVenueConfig?.capacity;
      
      if (cloudCapacity) {
        // Update local storage with cloud value
        const existing = this.getSettings(venueId) || {};
        this.saveSettings(venueId, {
          ...existing,
          capacity: cloudCapacity
        });
        return cloudCapacity;
      }
    } catch (error) {
      console.warn('⚠️ Could not load capacity from DynamoDB:', error);
    }

    // Fall back to localStorage
    return this.getCapacity(venueId);
  }
}

const venueSettingsService = new VenueSettingsService();
export default venueSettingsService;

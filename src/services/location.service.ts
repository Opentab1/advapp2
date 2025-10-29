import type { Location } from '../types';

class LocationService {
  private storageKey = 'pulse_locations';
  private currentLocationKey = 'pulse_current_location';

  // Mock locations for demo - in production, fetch from API
  private defaultLocations: Location[] = [
    {
      id: 'location-1',
      name: 'Downtown Lounge',
      address: '123 Main St, City Center',
      timezone: 'America/New_York',
      deviceId: 'rpi5-downtown-001'
    },
    {
      id: 'location-2',
      name: 'Uptown Bar',
      address: '456 Park Ave, Uptown',
      timezone: 'America/New_York',
      deviceId: 'rpi5-uptown-002'
    },
    {
      id: 'location-3',
      name: 'Waterfront Club',
      address: '789 Harbor Blvd, Waterfront',
      timezone: 'America/New_York',
      deviceId: 'rpi5-waterfront-003'
    }
  ];

  getLocations(): Location[] {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (error) {
      console.error('Error loading locations:', error);
    }
    
    // Return default locations if none stored
    this.setLocations(this.defaultLocations);
    return this.defaultLocations;
  }

  setLocations(locations: Location[]): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(locations));
    } catch (error) {
      console.error('Error saving locations:', error);
    }
  }

  getCurrentLocationId(): string | null {
    return localStorage.getItem(this.currentLocationKey);
  }

  setCurrentLocationId(locationId: string): void {
    localStorage.setItem(this.currentLocationKey, locationId);
  }

  getCurrentLocation(): Location | null {
    const locationId = this.getCurrentLocationId();
    if (!locationId) return null;
    
    const locations = this.getLocations();
    return locations.find(l => l.id === locationId) || null;
  }

  addLocation(location: Location): void {
    const locations = this.getLocations();
    locations.push(location);
    this.setLocations(locations);
  }

  updateLocation(locationId: string, updates: Partial<Location>): void {
    const locations = this.getLocations();
    const index = locations.findIndex(l => l.id === locationId);
    
    if (index !== -1) {
      locations[index] = { ...locations[index], ...updates };
      this.setLocations(locations);
    }
  }

  deleteLocation(locationId: string): void {
    const locations = this.getLocations();
    const filtered = locations.filter(l => l.id !== locationId);
    this.setLocations(filtered);
    
    // If deleted current location, clear it
    if (this.getCurrentLocationId() === locationId) {
      localStorage.removeItem(this.currentLocationKey);
    }
  }
}

export default new LocationService();

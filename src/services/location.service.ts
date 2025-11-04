import type { Location } from '../types';
import { generateClient } from '@aws-amplify/api';
import { getCurrentUser, fetchAuthSession } from '@aws-amplify/auth';

const listVenueLocations = /* GraphQL */ `
  query ListVenueLocations($venueId: ID!) {
    listVenueLocations(venueId: $venueId) {
      items {
        locationId
        displayName
        locationName
        address
        timezone
        deviceId
        mqttTopic
      }
    }
  }
`;

class LocationService {
  private storageKey = 'pulse_locations';
  private currentLocationKey = 'pulse_current_location';
  private locationsCacheKey = 'pulse_locations_cache';
  private locationsCacheTimeKey = 'pulse_locations_cache_time';
  private cacheExpiryMs = 5 * 60 * 1000; // 5 minutes

  async fetchLocationsFromDynamoDB(): Promise<Location[]> {
    try {
      console.log('🔍 Fetching locations from DynamoDB VenueConfig...');
      
      // Get venueId from Cognito
      await getCurrentUser();
      const session = await fetchAuthSession();
      const payload = session.tokens?.idToken?.payload;
      const venueId = payload?.['custom:venueId'] as string;

      if (!venueId) {
        throw new Error('No venueId found in user attributes');
      }

      // Query DynamoDB for all locations for this venue
      const client = generateClient();
      const response = await client.graphql({
        query: listVenueLocations,
        variables: { venueId }
      }) as any;

      const items = response?.data?.listVenueLocations?.items || [];
      
      if (items.length === 0) {
        console.warn('⚠️ No locations found in VenueConfig for venueId:', venueId);
        throw new Error(`No locations configured for venue: ${venueId}`);
      }

      console.log(`📋 Raw items from DynamoDB:`, items.map((item: any) => ({
        locationId: item.locationId,
        displayName: item.displayName,
        locationName: item.locationName,
        address: item.address
      })));

      const locations: Location[] = items.map((item: any) => ({
        id: item.locationId,
        name: item.displayName || item.locationName,
        address: item.address || 'No address provided',
        timezone: item.timezone || 'America/New_York',
        deviceId: item.deviceId
      }));

      console.log(`✅ Loaded ${locations.length} locations from DynamoDB:`, locations.map(l => l.name));
      
      // Cache the locations
      this.setLocations(locations);
      localStorage.setItem(this.locationsCacheKey, JSON.stringify(locations));
      localStorage.setItem(this.locationsCacheTimeKey, Date.now().toString());
      
      return locations;
    } catch (error: any) {
      console.error('❌ Failed to fetch locations from DynamoDB:', error);
      throw new Error(`Failed to load locations: ${error.message}`);
    }
  }

  getLocations(): Location[] {
    try {
      // Check if we have cached locations and they're not expired
      const cachedTime = localStorage.getItem(this.locationsCacheTimeKey);
      const cached = localStorage.getItem(this.locationsCacheKey);
      
      if (cachedTime && cached) {
        const age = Date.now() - parseInt(cachedTime);
        if (age < this.cacheExpiryMs) {
          const cachedLocations = JSON.parse(cached);
          console.log(`📦 Using cached locations (${cachedLocations.length} locations, cached ${Math.round(age / 1000)}s ago)`);
          return cachedLocations;
        } else {
          console.log(`⏰ Cache expired (${Math.round(age / 1000)}s old), will fetch from DynamoDB`);
        }
      }

      // Try to get from regular storage
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        const storedLocations = JSON.parse(stored);
        console.log(`📦 Using stored locations (${storedLocations.length} locations from localStorage)`);
        return storedLocations;
      }
    } catch (error) {
      console.error('Error loading locations:', error);
    }
    
    // Return empty array - locations must be fetched from DynamoDB
    console.log('⚠️ No locations in cache/storage, must fetch from DynamoDB');
    return [];
  }

  private setLocations(locations: Location[]): void {
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

  clearCache(): void {
    localStorage.removeItem(this.locationsCacheKey);
    localStorage.removeItem(this.locationsCacheTimeKey);
    localStorage.removeItem(this.storageKey);
    localStorage.removeItem(this.currentLocationKey);
    console.log('✅ Locations cache cleared');
  }

  // Debug method to log current locations state
  debugLocations(): void {
    console.log('=== Location Service Debug ===');
    console.log('Cached locations:', localStorage.getItem(this.locationsCacheKey));
    console.log('Cached time:', localStorage.getItem(this.locationsCacheTimeKey));
    console.log('Stored locations:', localStorage.getItem(this.storageKey));
    console.log('Current location ID:', localStorage.getItem(this.currentLocationKey));
    console.log('getLocations() result:', this.getLocations());
  }
}

export default new LocationService();

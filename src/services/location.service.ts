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

      const locations: Location[] = items.map((item: any) => ({
        id: item.locationId,
        name: item.displayName || item.locationName,
        address: item.address || 'No address provided',
        timezone: item.timezone || 'America/New_York',
        deviceId: item.deviceId
      }));

      console.log(`✅ Loaded ${locations.length} locations from DynamoDB`);
      
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
          const locations = JSON.parse(cached);
          // Check for fake data and clear cache if detected
          const fakeLocationNames = ['Downtown Lounge', 'Uptown Bar', 'Waterfront Club'];
          const hasFakeData = locations.some((loc: Location) => 
            fakeLocationNames.some(fake => loc.name.includes(fake))
          );
          
          if (hasFakeData) {
            console.warn('⚠️ Detected fake cached location data, clearing cache...');
            this.clearCache();
            return [];
          }
          
          return locations;
        }
      }

      // Try to get from regular storage
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        const locations = JSON.parse(stored);
        // Check for fake data and clear cache if detected
        const fakeLocationNames = ['Downtown Lounge', 'Uptown Bar', 'Waterfront Club'];
        const hasFakeData = locations.some((loc: Location) => 
          fakeLocationNames.some(fake => loc.name.includes(fake))
        );
        
        if (hasFakeData) {
          console.warn('⚠️ Detected fake cached location data in storage, clearing cache...');
          this.clearCache();
          return [];
        }
        
        return locations;
      }
    } catch (error) {
      console.error('Error loading locations:', error);
    }
    
    // Return empty array - locations must be fetched from DynamoDB
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
    console.log('✅ Locations cache cleared');
  }
}

export default new LocationService();

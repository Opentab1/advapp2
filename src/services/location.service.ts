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

  constructor() {
    // Clear expired cache on initialization
    this.cleanupExpiredCache();
  }

  private cleanupExpiredCache(): void {
    const cachedTime = localStorage.getItem(this.locationsCacheTimeKey);
    if (cachedTime) {
      const age = Date.now() - parseInt(cachedTime);
      if (age >= this.cacheExpiryMs) {
        console.log('🧹 Clearing expired location cache...');
        this.clearCache();
      }
    }
  }

  /**
   * Check if GraphQL endpoint is configured
   */
  private checkGraphQLEndpoint(): void {
    const endpoint = import.meta.env.VITE_GRAPHQL_ENDPOINT;
    if (!endpoint || endpoint.trim() === '' || endpoint.includes('your-appsync-api')) {
      throw new Error(
        'GraphQL endpoint not configured. Please set VITE_GRAPHQL_ENDPOINT in your .env file. ' +
        'See DYNAMODB_SETUP.md for instructions on how to set up your AppSync API endpoint.'
      );
    }
  }

  /**
   * Extract error message from various error types
   */
  private extractErrorMessage(error: any): string {
    // Check for authentication/authorization errors specifically
    if (error?.message) {
      const msg = error.message.toLowerCase();
      if (msg.includes('unauthorized') || msg.includes('401') || msg.includes('403')) {
        return `Unauthorized: ${error.message}. Check that:\n` +
               `1. VITE_GRAPHQL_ENDPOINT is set correctly in .env\n` +
               `2. Your AppSync API is configured with Cognito User Pool authentication\n` +
               `3. Your Cognito user has proper permissions\n` +
               `4. You are logged in with a valid session`;
      }
      return error.message;
    }
    if (typeof error === 'string') {
      const msg = error.toLowerCase();
      if (msg.includes('unauthorized') || msg.includes('401') || msg.includes('403')) {
        return `Unauthorized: ${error}. Check VITE_GRAPHQL_ENDPOINT configuration and AppSync authentication settings.`;
      }
      return error;
    }
    if (error?.error?.message) {
      return error.error.message;
    }
    if (error?.errors && Array.isArray(error.errors) && error.errors.length > 0) {
      const errorMessages = error.errors.map((e: any) => {
        const msg = (e.message || e).toString().toLowerCase();
        if (msg.includes('unauthorized') || msg.includes('401') || msg.includes('403')) {
          return `Unauthorized: ${e.message || e}. Verify AppSync API authentication configuration.`;
        }
        return e.message || e;
      });
      return errorMessages.join(', ');
    }
    if (error?.data?.errors) {
      const errorMessages = error.data.errors.map((e: any) => {
        const msg = (e.message || e).toString().toLowerCase();
        if (msg.includes('unauthorized') || msg.includes('401') || msg.includes('403')) {
          return `Unauthorized: ${e.message || e}. Check AppSync API auth settings.`;
        }
        return e.message || e;
      });
      return errorMessages.join(', ');
    }
    // Check for HTTP status codes
    if (error?.statusCode === 401 || error?.statusCode === 403) {
      return `Unauthorized (${error.statusCode}): Check that VITE_GRAPHQL_ENDPOINT is correct and AppSync API uses Cognito User Pool authentication.`;
    }
    return error?.toString() || 'Unknown error occurred';
  }

  async fetchLocationsFromDynamoDB(): Promise<Location[]> {
    try {
      console.log('🔍 Fetching locations from DynamoDB VenueConfig...');
      
      // Check if GraphQL endpoint is configured
      this.checkGraphQLEndpoint();
      
      // Get venueId from Cognito
      await getCurrentUser();
      const session = await fetchAuthSession();
      
      if (!session.tokens) {
        throw new Error('Not authenticated. Please log in again.');
      }
      
      // Log auth info for debugging
      console.log('🔐 Auth session valid:', {
        hasIdToken: !!session.tokens?.idToken,
        hasAccessToken: !!session.tokens?.accessToken,
        endpoint: import.meta.env.VITE_GRAPHQL_ENDPOINT?.substring(0, 50) + '...'
      });
      
      const payload = session.tokens?.idToken?.payload;
      const venueId = payload?.['custom:venueId'] as string;

      if (!venueId) {
        throw new Error('No venueId found in user attributes. Please ensure your Cognito user has custom:venueId attribute.');
      }

      // Query DynamoDB for all locations for this venue
      const client = generateClient();
      const response = await client.graphql({
        query: listVenueLocations,
        variables: { venueId }
      }) as any;

      // Check for GraphQL errors in response
      if (response?.errors && response.errors.length > 0) {
        console.error('❌ GraphQL errors:', response.errors);
        const errorMessages = response.errors.map((e: any) => e.message || e).join(', ');
        throw new Error(`GraphQL error: ${errorMessages}`);
      }

      const items = response?.data?.listVenueLocations?.items || [];
      
      if (items.length === 0) {
        console.warn('⚠️ No locations found in VenueConfig for venueId:', venueId);
        throw new Error(`No locations configured for venue: ${venueId}. Please add locations to the VenueConfig table in DynamoDB.`);
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
      console.error('❌ Error details:', {
        message: error?.message,
        statusCode: error?.statusCode,
        errors: error?.errors,
        data: error?.data
      });
      const errorMessage = this.extractErrorMessage(error);
      throw new Error(`Failed to load locations: ${errorMessage}`);
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
          return JSON.parse(cached);
        }
      }

      // Try to get from regular storage
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        return JSON.parse(stored);
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
    // Also clear current location to force fresh selection
    localStorage.removeItem(this.currentLocationKey);
    console.log('✅ Locations cache cleared');
  }
}

export default new LocationService();

import type { Location } from '../types';
import { generateClient } from '@aws-amplify/api';
import { getCurrentUser, fetchAuthSession } from '@aws-amplify/auth';
import { isDemoAccount, generateDemoLocations } from '../utils/demoData';

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
    if (error?.message) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    if (error?.error?.message) {
      return error.error.message;
    }
    if (error?.errors && Array.isArray(error.errors) && error.errors.length > 0) {
      return error.errors.map((e: any) => e.message || e).join(', ');
    }
    if (error?.data?.errors) {
      return error.data.errors.map((e: any) => e.message || e).join(', ');
    }
    return error?.toString() || 'Unknown error occurred';
  }

  async fetchLocationsFromDynamoDB(providedVenueId?: string): Promise<Location[]> {
    try {
      console.log('🔍 Fetching locations from DynamoDB VenueConfig...');
      
      // Get venueId from parameter or from Cognito session
      let venueId = providedVenueId;
      
      if (!venueId) {
        console.log('📡 No venueId provided, fetching from Cognito session...');
        await getCurrentUser();
        const session = await fetchAuthSession();
        const payload = session.tokens?.idToken?.payload;
        venueId = payload?.['custom:venueId'] as string;

        console.log('🔐 Auth session details:', {
          hasTokens: !!session.tokens,
          hasIdToken: !!session.tokens?.idToken,
          hasAccessToken: !!session.tokens?.accessToken,
          tokenType: session.tokens?.idToken?.payload ? 'JWT' : 'none',
          venueId: venueId || 'NOT FOUND',
          userAttributes: payload ? Object.keys(payload).filter(k => k.startsWith('custom:')) : []
        });
      } else {
        console.log('✅ Using provided venueId:', venueId);
      }

      if (!venueId) {
        throw new Error('No venueId found in user attributes. Please ensure your Cognito user has custom:venueId attribute.');
      }

      // ✨ DEMO MODE: Return fake locations for demo account only
      if (isDemoAccount(venueId)) {
        console.log('🎭 Demo mode detected - returning generated locations');
        await new Promise(resolve => setTimeout(resolve, 200)); // Simulate network delay
        const locations = generateDemoLocations();
        this.setLocations(locations);
        localStorage.setItem(this.locationsCacheKey, JSON.stringify(locations));
        localStorage.setItem(this.locationsCacheTimeKey, Date.now().toString());
        return locations;
      }

      // Check if GraphQL endpoint is configured
      this.checkGraphQLEndpoint();

      const endpoint = import.meta.env.VITE_GRAPHQL_ENDPOINT;
      console.log('📡 GraphQL Request Details:', {
        endpoint: endpoint ? endpoint.substring(0, 50) + '...' : 'NOT SET',
        query: 'listVenueLocations',
        venueId,
        authMode: 'userPool'
      });

      // Query DynamoDB for all locations for this venue
      const client = generateClient();
      const response = await client.graphql({
        query: listVenueLocations,
        variables: { venueId },
        authMode: 'userPool'
      }) as any;

      // Check for GraphQL errors in response
      if (response?.errors && response.errors.length > 0) {
        console.error('❌ GraphQL Response Errors:', {
          errors: response.errors,
          fullResponse: JSON.stringify(response, null, 2)
        });
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
      console.error('❌ Failed to fetch locations from DynamoDB');
      console.error('🔍 Full Error Object:', {
        name: error?.name,
        message: error?.message,
        code: error?.code,
        statusCode: error?.statusCode,
        errorType: error?.errorType,
        errorInfo: error?.errorInfo,
        underlyingError: error?.underlyingError,
        errors: error?.errors,
        data: error?.data,
        stack: error?.stack,
        fullError: JSON.stringify(error, Object.getOwnPropertyNames(error), 2)
      });
      
      // Log network-level details if available
      if (error?.name === 'NetworkError' || error?.code === 'NETWORK_ERROR') {
        console.error('🌐 Network Error Details:', {
          endpoint: import.meta.env.VITE_GRAPHQL_ENDPOINT,
          message: error.message
        });
      }
      
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
    console.log('✅ Locations cache cleared');
  }
}

export default new LocationService();

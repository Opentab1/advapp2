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
    const endpointValue = endpoint?.trim() || '';
    
    // Check if endpoint is missing, empty, or contains placeholder
    if (!endpointValue || endpointValue === '' || endpointValue.includes('your-appsync-api')) {
      const envValue = import.meta.env.VITE_GRAPHQL_ENDPOINT;
      const diagnosticInfo = envValue === undefined 
        ? 'Environment variable is undefined. Make sure .env file exists in the project root.'
        : envValue === ''
        ? 'Environment variable is set but empty. Please add your AppSync endpoint URL.'
        : 'Environment variable contains placeholder value. Please replace with your actual AppSync endpoint URL.';
      
      throw new Error(
        `GraphQL endpoint not configured. ${diagnosticInfo}\n\n` +
        'To fix this:\n' +
        '1. Create or update your .env file in the project root\n' +
        '2. Add: VITE_GRAPHQL_ENDPOINT=https://your-api-id.appsync-api.us-east-2.amazonaws.com/graphql\n' +
        '3. Get your AppSync API endpoint from AWS Console > AppSync > Settings > API URL\n' +
        '4. Restart your dev server (npm run dev)\n\n' +
        'See DYNAMODB_SETUP.md for detailed setup instructions.'
      );
    }
    
    // Validate endpoint format
    if (!endpointValue.startsWith('https://') || !endpointValue.includes('.appsync-api.')) {
      throw new Error(
        `Invalid GraphQL endpoint format: "${endpointValue}"\n\n` +
        'The endpoint should look like: https://xxxxx.appsync-api.us-east-2.amazonaws.com/graphql\n' +
        'Please check your VITE_GRAPHQL_ENDPOINT value in .env file.'
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

  async fetchLocationsFromDynamoDB(): Promise<Location[]> {
    try {
      console.log('🔍 Fetching locations from DynamoDB VenueConfig...');
      
      // Check if GraphQL endpoint is configured
      this.checkGraphQLEndpoint();
      
      // Get venueId from Cognito
      await getCurrentUser();
      const session = await fetchAuthSession();
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

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
      const endpoint = import.meta.env.VITE_GRAPHQL_ENDPOINT;
      console.log('📡 GraphQL Endpoint:', endpoint ? endpoint.substring(0, 50) + '...' : 'NOT SET');
      
      // Get venueId from Cognito
      await getCurrentUser();
      const session = await fetchAuthSession();
      
      // Enhanced diagnostic logging
      console.log('🔐 Authentication Session:', {
        hasTokens: !!session.tokens,
        hasIdToken: !!session.tokens?.idToken,
        hasAccessToken: !!session.tokens?.accessToken,
        tokenExpiry: session.tokens?.idToken?.payload?.exp ? new Date(session.tokens.idToken.payload.exp * 1000).toISOString() : 'N/A',
        tokenIssuedAt: session.tokens?.idToken?.payload?.iat ? new Date(session.tokens.idToken.payload.iat * 1000).toISOString() : 'N/A',
        tokenIssuer: session.tokens?.idToken?.payload?.iss || 'N/A',
        userId: session.tokens?.idToken?.payload?.sub || 'N/A'
      });
      
      const payload = session.tokens?.idToken?.payload;
      const venueId = payload?.['custom:venueId'] as string;

      if (!venueId) {
        console.error('❌ Missing venueId in token payload. Available attributes:', Object.keys(payload || {}));
        throw new Error('No venueId found in user attributes. Please ensure your Cognito user has custom:venueId attribute.');
      }

      console.log('🏢 Using venueId:', venueId);

      // Query DynamoDB for all locations for this venue
      const client = generateClient();
      
      console.log('📤 Sending GraphQL request:', {
        query: 'listVenueLocations',
        variables: { venueId },
        authMode: 'userPool'
      });
      
      const response = await client.graphql({
        query: listVenueLocations,
        variables: { venueId },
        authMode: 'userPool'
      }) as any;

      // Enhanced error logging
      console.log('📥 GraphQL Response:', {
        hasData: !!response?.data,
        hasErrors: !!response?.errors,
        errorsCount: response?.errors?.length || 0,
        dataKeys: response?.data ? Object.keys(response.data) : [],
        responseKeys: Object.keys(response || {})
      });

      // Check for GraphQL errors in response
      if (response?.errors && response.errors.length > 0) {
        console.error('❌ GraphQL Errors:', response.errors);
        response.errors.forEach((err: any, idx: number) => {
          console.error(`  Error ${idx + 1}:`, {
            message: err.message,
            errorType: err.errorType,
            errorInfo: err.errorInfo,
            path: err.path,
            locations: err.locations,
            extensions: err.extensions,
            fullError: JSON.stringify(err, null, 2)
          });
        });
        const errorMessages = response.errors.map((e: any) => e.message || e).join(', ');
        throw new Error(`GraphQL error: ${errorMessages}`);
      }

      const items = response?.data?.listVenueLocations?.items || [];
      
      if (items.length === 0) {
        console.warn('⚠️ No locations found in VenueConfig for venueId:', venueId);
        console.warn('   Response data structure:', response?.data);
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
      console.error('   Error type:', error?.constructor?.name);
      console.error('   Error name:', error?.name);
      console.error('   Error code:', error?.code);
      console.error('   Error message:', error?.message);
      console.error('   Error stack:', error?.stack);
      console.error('   Full error object:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
      
      // Check for network errors
      if (error?.name === 'NetworkError' || error?.code === 'NETWORK_ERROR' || error?.message?.includes('fetch')) {
        console.error('🌐 Network Error Detected - Check:');
        console.error('   1. VITE_GRAPHQL_ENDPOINT is correct');
        console.error('   2. CORS is configured on AppSync API');
        console.error('   3. Network connectivity');
        console.error('   4. AppSync API is accessible');
      }
      
      // Check for authentication errors
      if (error?.message?.includes('Unauthorized') || error?.message?.includes('401') || error?.message?.includes('403')) {
        console.error('🔒 Authentication Error Detected - Check:');
        console.error('   1. JWT token is valid and not expired');
        console.error('   2. AppSync API uses Cognito User Pool authentication');
        console.error('   3. User has custom:venueId attribute in Cognito');
        console.error('   4. AppSync resolver authorization is configured correctly');
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

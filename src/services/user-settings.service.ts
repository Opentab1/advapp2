/**
 * User Settings Service
 * 
 * Stores and retrieves user settings from DynamoDB via GraphQL
 * This ensures settings are consistent across all devices for the same user
 */

import { generateClient } from '@aws-amplify/api';
import { fetchAuthSession } from '@aws-amplify/auth';
import authService from './auth.service';

// Settings stored per-user in DynamoDB
export interface UserSettings {
  // Display preferences
  theme: 'light' | 'dark' | 'auto';
  soundAlerts: boolean;
  refreshInterval: number;
  temperatureUnit: 'fahrenheit' | 'celsius';
  timezone: string;
  
  // Notification preferences
  notifications: boolean;
  emailNotifications: {
    dailySummary: boolean;
    highOccupancyAlerts: boolean;
    temperatureAlerts: boolean;
    weeklyReports: boolean;
    monthlyInsights: boolean;
    sensorOfflineAlerts: boolean;
  };
  
  // Terms acceptance
  termsAccepted: boolean;
  termsAcceptedDate: string | null;
}

// Settings stored per-venue in DynamoDB
export interface VenueSettings {
  // Address for weather
  address: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country?: string;
  } | null;
  
  // Toast POS credentials (encrypted in DynamoDB)
  toastPOS: {
    enabled: boolean;
    apiKey: string;
    restaurantGuid: string;
  } | null;
  
  lastUpdated: string;
}

const DEFAULT_USER_SETTINGS: UserSettings = {
  theme: 'dark',
  soundAlerts: true,
  refreshInterval: 5,
  temperatureUnit: 'fahrenheit',
  timezone: 'America/New_York',
  notifications: true,
  emailNotifications: {
    dailySummary: true,
    highOccupancyAlerts: true,
    temperatureAlerts: true,
    weeklyReports: false,
    monthlyInsights: false,
    sensorOfflineAlerts: true,
  },
  termsAccepted: false,
  termsAcceptedDate: null,
};

const DEFAULT_VENUE_SETTINGS: VenueSettings = {
  address: null,
  toastPOS: null,
  lastUpdated: new Date().toISOString(),
};

// GraphQL queries and mutations
const getUserSettingsQuery = /* GraphQL */ `
  query GetUserSettings($userId: ID!) {
    getUserSettings(userId: $userId) {
      userId
      theme
      soundAlerts
      refreshInterval
      temperatureUnit
      timezone
      notifications
      emailNotifications {
        dailySummary
        highOccupancyAlerts
        temperatureAlerts
        weeklyReports
        monthlyInsights
        sensorOfflineAlerts
      }
      termsAccepted
      termsAcceptedDate
    }
  }
`;

const saveUserSettingsMutation = /* GraphQL */ `
  mutation SaveUserSettings($input: UserSettingsInput!) {
    saveUserSettings(input: $input) {
      userId
      theme
      soundAlerts
      refreshInterval
      temperatureUnit
      timezone
      notifications
      termsAccepted
      termsAcceptedDate
    }
  }
`;

const getVenueSettingsQuery = /* GraphQL */ `
  query GetVenueSettings($venueId: ID!) {
    getVenueSettings(venueId: $venueId) {
      venueId
      address {
        street
        city
        state
        zipCode
        country
      }
      toastPOS {
        enabled
        apiKey
        restaurantGuid
      }
      lastUpdated
    }
  }
`;

const saveVenueSettingsMutation = /* GraphQL */ `
  mutation SaveVenueSettings($input: VenueSettingsInput!) {
    saveVenueSettings(input: $input) {
      venueId
      lastUpdated
    }
  }
`;

class UserSettingsService {
  private userSettingsCache: UserSettings | null = null;
  private venueSettingsCache: VenueSettings | null = null;
  private cacheUserId: string | null = null;
  private cacheVenueId: string | null = null;

  private getClient() {
    return generateClient();
  }

  /**
   * Get user settings from DynamoDB
   */
  async getUserSettings(): Promise<UserSettings> {
    const user = authService.getStoredUser();
    if (!user?.email) {
      console.warn('No user logged in, returning default settings');
      return DEFAULT_USER_SETTINGS;
    }

    // Return cached if same user
    if (this.userSettingsCache && this.cacheUserId === user.email) {
      return this.userSettingsCache;
    }

    try {
      const session = await fetchAuthSession();
      if (!session.tokens) {
        return DEFAULT_USER_SETTINGS;
      }

      const client = this.getClient();
      const response = await client.graphql({
        query: getUserSettingsQuery,
        variables: { userId: user.email },
        authMode: 'userPool'
      }) as any;

      if (response?.data?.getUserSettings) {
        const settings = this.mergeWithDefaults(response.data.getUserSettings);
        this.userSettingsCache = settings;
        this.cacheUserId = user.email;
        console.log('✅ User settings loaded from DynamoDB');
        return settings;
      }
    } catch (error: any) {
      // If the query doesn't exist yet (schema not updated), fall back gracefully
      if (error?.errors?.[0]?.message?.includes('Cannot query field')) {
        console.warn('⚠️ UserSettings GraphQL query not available yet. Using defaults.');
      } else {
        console.error('❌ Failed to load user settings:', error);
      }
    }

    return DEFAULT_USER_SETTINGS;
  }

  /**
   * Save user settings to DynamoDB
   */
  async saveUserSettings(settings: Partial<UserSettings>): Promise<boolean> {
    const user = authService.getStoredUser();
    if (!user?.email) {
      console.error('No user logged in');
      return false;
    }

    try {
      const session = await fetchAuthSession();
      if (!session.tokens) {
        return false;
      }

      const currentSettings = await this.getUserSettings();
      const updatedSettings = { ...currentSettings, ...settings };

      const client = this.getClient();
      await client.graphql({
        query: saveUserSettingsMutation,
        variables: {
          input: {
            userId: user.email,
            ...updatedSettings
          }
        },
        authMode: 'userPool'
      });

      // Update cache
      this.userSettingsCache = updatedSettings;
      this.cacheUserId = user.email;
      
      console.log('✅ User settings saved to DynamoDB');
      return true;
    } catch (error: any) {
      // If the mutation doesn't exist yet (schema not updated), fail gracefully
      if (error?.errors?.[0]?.message?.includes('Cannot query field')) {
        console.warn('⚠️ UserSettings GraphQL mutation not available yet.');
      } else {
        console.error('❌ Failed to save user settings:', error);
      }
      return false;
    }
  }

  /**
   * Get venue settings from DynamoDB
   */
  async getVenueSettings(venueId: string): Promise<VenueSettings> {
    if (!venueId) {
      return DEFAULT_VENUE_SETTINGS;
    }

    // Return cached if same venue
    if (this.venueSettingsCache && this.cacheVenueId === venueId) {
      return this.venueSettingsCache;
    }

    try {
      const session = await fetchAuthSession();
      if (!session.tokens) {
        return DEFAULT_VENUE_SETTINGS;
      }

      const client = this.getClient();
      const response = await client.graphql({
        query: getVenueSettingsQuery,
        variables: { venueId },
        authMode: 'userPool'
      }) as any;

      if (response?.data?.getVenueSettings) {
        const settings = { ...DEFAULT_VENUE_SETTINGS, ...response.data.getVenueSettings };
        this.venueSettingsCache = settings;
        this.cacheVenueId = venueId;
        console.log('✅ Venue settings loaded from DynamoDB');
        return settings;
      }
    } catch (error: any) {
      if (error?.errors?.[0]?.message?.includes('Cannot query field')) {
        console.warn('⚠️ VenueSettings GraphQL query not available yet. Using defaults.');
      } else {
        console.error('❌ Failed to load venue settings:', error);
      }
    }

    return DEFAULT_VENUE_SETTINGS;
  }

  /**
   * Save venue settings to DynamoDB
   */
  async saveVenueSettings(venueId: string, settings: Partial<VenueSettings>): Promise<boolean> {
    if (!venueId) {
      console.error('No venue ID provided');
      return false;
    }

    try {
      const session = await fetchAuthSession();
      if (!session.tokens) {
        return false;
      }

      const currentSettings = await this.getVenueSettings(venueId);
      const updatedSettings = {
        ...currentSettings,
        ...settings,
        lastUpdated: new Date().toISOString()
      };

      const client = this.getClient();
      await client.graphql({
        query: saveVenueSettingsMutation,
        variables: {
          input: {
            venueId,
            ...updatedSettings
          }
        },
        authMode: 'userPool'
      });

      // Update cache
      this.venueSettingsCache = updatedSettings;
      this.cacheVenueId = venueId;
      
      console.log('✅ Venue settings saved to DynamoDB');
      return true;
    } catch (error: any) {
      if (error?.errors?.[0]?.message?.includes('Cannot query field')) {
        console.warn('⚠️ VenueSettings GraphQL mutation not available yet.');
      } else {
        console.error('❌ Failed to save venue settings:', error);
      }
      return false;
    }
  }

  /**
   * Check if user has accepted terms
   */
  async hasAcceptedTerms(): Promise<boolean> {
    const settings = await this.getUserSettings();
    return settings.termsAccepted;
  }

  /**
   * Accept terms of service
   */
  async acceptTerms(): Promise<boolean> {
    return this.saveUserSettings({
      termsAccepted: true,
      termsAcceptedDate: new Date().toISOString()
    });
  }

  /**
   * Get Toast POS credentials from venue settings
   */
  async getToastCredentials(venueId: string): Promise<{ apiKey: string; restaurantGuid: string } | null> {
    const settings = await this.getVenueSettings(venueId);
    if (settings.toastPOS?.enabled && settings.toastPOS.apiKey) {
      return {
        apiKey: settings.toastPOS.apiKey,
        restaurantGuid: settings.toastPOS.restaurantGuid
      };
    }
    return null;
  }

  /**
   * Save Toast POS credentials to venue settings
   */
  async saveToastCredentials(venueId: string, apiKey: string, restaurantGuid: string): Promise<boolean> {
    return this.saveVenueSettings(venueId, {
      toastPOS: {
        enabled: true,
        apiKey,
        restaurantGuid
      }
    });
  }

  /**
   * Clear Toast POS credentials
   */
  async clearToastCredentials(venueId: string): Promise<boolean> {
    return this.saveVenueSettings(venueId, {
      toastPOS: null
    });
  }

  /**
   * Get venue address for weather
   */
  async getVenueAddress(venueId: string): Promise<VenueSettings['address']> {
    const settings = await this.getVenueSettings(venueId);
    return settings.address;
  }

  /**
   * Save venue address
   */
  async saveVenueAddress(venueId: string, address: NonNullable<VenueSettings['address']>): Promise<boolean> {
    return this.saveVenueSettings(venueId, { address });
  }

  /**
   * Clear caches (call on logout)
   */
  clearCache(): void {
    this.userSettingsCache = null;
    this.venueSettingsCache = null;
    this.cacheUserId = null;
    this.cacheVenueId = null;
  }

  /**
   * Merge loaded settings with defaults to ensure all fields exist
   */
  private mergeWithDefaults(loaded: Partial<UserSettings>): UserSettings {
    return {
      ...DEFAULT_USER_SETTINGS,
      ...loaded,
      emailNotifications: {
        ...DEFAULT_USER_SETTINGS.emailNotifications,
        ...(loaded.emailNotifications || {})
      }
    };
  }
}

export const userSettingsService = new UserSettingsService();
export default userSettingsService;

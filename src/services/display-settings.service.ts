/**
 * Display Settings Service
 * 
 * Provides display name overrides for venues throughout the app.
 * This is purely cosmetic - it doesn't affect data flow, just what's shown in the UI.
 * 
 * Admin sets display names via API, and this service applies them everywhere.
 */

// API endpoint for display settings (same as admin uses)
const DISPLAY_SETTINGS_API = 'https://7ox6y1t1f1.execute-api.us-east-2.amazonaws.com/display-settings';

// Cache for display settings
interface VenueDisplaySettings {
  displayName?: string;
  ownerName?: string;
  ownerEmail?: string;
}

class DisplaySettingsService {
  private cache: Record<string, VenueDisplaySettings> = {};
  private lastFetch: number = 0;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  private fetchPromise: Promise<void> | null = null;
  
  /**
   * Initialize and load display settings from API
   * Call this early in app startup
   */
  async initialize(): Promise<void> {
    // Avoid duplicate fetches
    if (this.fetchPromise) {
      return this.fetchPromise;
    }
    
    // Use cache if still valid
    if (Object.keys(this.cache).length > 0 && (Date.now() - this.lastFetch) < this.CACHE_TTL) {
      return;
    }
    
    this.fetchPromise = this.loadFromAPI();
    await this.fetchPromise;
    this.fetchPromise = null;
  }
  
  /**
   * Load display settings from AWS API
   */
  private async loadFromAPI(): Promise<void> {
    try {
      console.log('🏷️ Loading display settings from AWS...');
      const response = await fetch(DISPLAY_SETTINGS_API);
      
      if (response.ok) {
        const data = await response.json();
        this.cache = data;
        this.lastFetch = Date.now();
        console.log(`🏷️ Loaded display settings for ${Object.keys(data).length} venues`);
      } else {
        console.warn('⚠️ Failed to load display settings:', response.status);
      }
    } catch (error) {
      console.warn('⚠️ Error loading display settings:', error);
      // Use cached data if available
    }
  }
  
  /**
   * Get display name for a venue
   * Returns the custom display name if set, otherwise returns the fallback (usually venueId or venueName)
   */
  getDisplayName(venueId: string, fallback: string): string {
    const settings = this.cache[venueId];
    return settings?.displayName || fallback;
  }
  
  /**
   * Get owner name for a venue (display only)
   */
  getOwnerName(venueId: string, fallback?: string): string | undefined {
    const settings = this.cache[venueId];
    return settings?.ownerName || fallback;
  }
  
  /**
   * Get owner email for a venue (display only)
   */
  getOwnerEmail(venueId: string, fallback?: string): string | undefined {
    const settings = this.cache[venueId];
    return settings?.ownerEmail || fallback;
  }
  
  /**
   * Check if a venue has custom display settings
   */
  hasCustomSettings(venueId: string): boolean {
    return !!this.cache[venueId];
  }
  
  /**
   * Get all display settings for a venue
   */
  getSettings(venueId: string): VenueDisplaySettings | null {
    return this.cache[venueId] || null;
  }
  
  /**
   * Force refresh display settings from API
   */
  async refresh(): Promise<void> {
    this.lastFetch = 0;
    await this.initialize();
  }
  
  /**
   * Update local cache (for admin operations)
   */
  updateCache(venueId: string, settings: VenueDisplaySettings): void {
    this.cache[venueId] = settings;
  }
}

export const displaySettingsService = new DisplaySettingsService();
export default displaySettingsService;

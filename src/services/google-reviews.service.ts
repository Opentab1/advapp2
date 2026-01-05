/**
 * Google Reviews Service
 * 
 * Uses SerpAPI to fetch Google Reviews data
 * Free tier: 100 searches/month
 * We cache for 7 days to minimize API calls
 */

import { isDemoAccount, generateDemoGoogleReviews } from '../utils/demoData';

export interface GoogleReviewsData {
  name: string;
  rating: number;
  reviewCount: number;
  priceLevel?: string;
  address?: string;
  placeId?: string;
  url?: string;
  lastUpdated: string;
  recentReviews?: {
    rating: number;
    text: string;
    author: string;
    date: string;
  }[];
}

// Use Lambda proxy if configured, otherwise direct SerpAPI (will fail due to CORS)
const SERPAPI_PROXY_URL = import.meta.env.VITE_SERPAPI_PROXY_URL;
const SERPAPI_DIRECT = 'https://serpapi.com/search.json';
const CACHE_KEY_PREFIX = 'pulse_google_reviews_';
const CACHE_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

class GoogleReviewsService {
  private getApiKey(): string | null {
    return import.meta.env.VITE_SERPAPI_KEY || null;
  }

  /**
   * Check if service is configured
   */
  isConfigured(): boolean {
    console.log('🔍 Google Reviews: Checking configuration...');
    console.log('🔍 VITE_SERPAPI_PROXY_URL:', SERPAPI_PROXY_URL || 'NOT SET');
    console.log('🔍 VITE_SERPAPI_KEY:', this.getApiKey() ? 'SET (hidden)' : 'NOT SET');
    
    // Prefer proxy URL (Lambda), fallback to direct API key
    if (SERPAPI_PROXY_URL && SERPAPI_PROXY_URL.length > 10 && !SERPAPI_PROXY_URL.includes('xxxxx') && !SERPAPI_PROXY_URL.includes('your-')) {
      console.log('✅ Google Reviews: Using Lambda proxy');
      return true;
    }
    const key = this.getApiKey();
    if (key && key.length > 10 && !key.includes('your-api-key') && !key.includes('your-serpapi')) {
      console.log('✅ Google Reviews: Using direct SerpAPI key');
      return true;
    }
    
    console.warn('⚠️ Google Reviews: NOT CONFIGURED - need VITE_SERPAPI_PROXY_URL in Amplify environment');
    return false;
  }

  /**
   * Check if using proxy
   */
  private useProxy(): boolean {
    return !!(SERPAPI_PROXY_URL && !SERPAPI_PROXY_URL.includes('xxxxx'));
  }

  /**
   * Get cached reviews data
   */
  private getCachedData(venueId: string): GoogleReviewsData | null {
    try {
      const key = `${CACHE_KEY_PREFIX}${venueId}`;
      const cached = localStorage.getItem(key);
      if (!cached) return null;

      const data = JSON.parse(cached) as GoogleReviewsData;
      const cacheAge = Date.now() - new Date(data.lastUpdated).getTime();
      
      // Return cached data if less than 7 days old
      if (cacheAge < CACHE_DURATION_MS) {
        return data;
      }
    } catch (error) {
      console.error('Error reading cached reviews:', error);
    }
    return null;
  }

  /**
   * Cache reviews data
   */
  private cacheData(venueId: string, data: GoogleReviewsData): void {
    try {
      const key = `${CACHE_KEY_PREFIX}${venueId}`;
      localStorage.setItem(key, JSON.stringify(data));
    } catch (error) {
      console.error('Error caching reviews:', error);
    }
  }

  /**
   * Get cache age in days
   */
  getCacheAge(venueId: string): number | null {
    const cached = this.getCachedData(venueId);
    if (!cached) return null;
    
    const ageMs = Date.now() - new Date(cached.lastUpdated).getTime();
    return Math.floor(ageMs / (24 * 60 * 60 * 1000));
  }

  /**
   * Fetch Google Reviews for a venue
   */
  async getReviews(venueName: string, venueAddress: string, venueId: string): Promise<GoogleReviewsData | null> {
    console.log('🔍 getReviews called with:', { venueName, venueAddress, venueId });
    
    // Demo account - return realistic demo data
    if (isDemoAccount(venueId)) {
      console.log('✅ Demo account - returning demo Google Reviews');
      return generateDemoGoogleReviews();
    }
    
    // Check cache first
    const cached = this.getCachedData(venueId);
    if (cached) {
      console.log('📦 Using cached Google Reviews data');
      return cached;
    }

    // Check if API key is configured
    if (!this.isConfigured()) {
      console.warn('⚠️ SerpAPI key not configured. Key value:', this.getApiKey()?.substring(0, 10) + '...');
      return null;
    }

    // Check if we have venue info
    if (!venueName || venueName.trim() === '') {
      console.warn('⚠️ No venue name provided for Google Reviews');
      return null;
    }

    try {
      const query = venueAddress ? `${venueName} ${venueAddress}` : venueName;
      
      console.log('🔍 Fetching Google Reviews...');
      console.log('📍 Search query:', query);
      
      let url: string;
      
      if (this.useProxy()) {
        // Use Lambda proxy (recommended - no CORS issues)
        // The proxy URL should be the full path including route (e.g., https://xxx.execute-api.region.amazonaws.com/reviews)
        // If only the base URL is provided, append a default route
        let proxyBase = SERPAPI_PROXY_URL!.replace(/\/$/, ''); // Remove trailing slash
        
        // Check if URL already has a path segment (like /reviews or /serpapi)
        const urlParts = proxyBase.split('.amazonaws.com');
        if (urlParts.length === 2 && urlParts[1] === '') {
          // No route path provided, add default
          proxyBase += '/reviews';
          console.log('⚠️ No route in proxy URL, assuming /reviews');
        }
        
        url = `${proxyBase}?query=${encodeURIComponent(query)}`;
        console.log('🌐 Using Lambda proxy:', proxyBase);
      } else {
        // Direct SerpAPI call (will fail due to CORS in browser)
        const apiKey = this.getApiKey();
        const params = new URLSearchParams({
          engine: 'google_maps',
          q: query,
          type: 'search',
          api_key: apiKey!,
        });
        url = `${SERPAPI_DIRECT}?${params}`;
        console.log('🌐 Using direct SerpAPI (may fail due to CORS)');
      }
      
      console.log('🔗 Full request URL:', url);
      
      const response = await fetch(url);
      
      console.log('📡 Response status:', response.status);
      console.log('📡 Response headers:', Object.fromEntries(response.headers.entries()));
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ SerpAPI error response:', errorText);
        
        // Provide helpful error messages
        if (response.status === 404) {
          throw new Error('API route not found. Check API Gateway configuration.');
        } else if (response.status === 500) {
          throw new Error('Lambda error. Check CloudWatch logs.');
        }
        
        throw new Error(`SerpAPI returned ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      console.log('📦 SerpAPI response:', JSON.stringify(data).substring(0, 500) + '...');
      
      // Check for errors
      if (data.error) {
        console.error('❌ SerpAPI returned error:', data.error);
        throw new Error(data.error);
      }

      // Get the first local result (most relevant match)
      console.log('🔍 Looking for local_results in response...');
      console.log('📊 local_results:', data.local_results ? `Found ${data.local_results.length} results` : 'Not found');
      console.log('📊 place_results:', data.place_results ? 'Found' : 'Not found');
      
      const place = data.local_results?.[0] || data.place_results;
      
      if (!place) {
        console.warn('⚠️ No Google place found in response');
        console.log('📦 Full response keys:', Object.keys(data));
        return null;
      }

      console.log('✅ Found place:', place.title, '- Rating:', place.rating, '- Reviews:', place.reviews);

      const reviewsData: GoogleReviewsData = {
        name: place.title || venueName,
        rating: place.rating || 0,
        reviewCount: place.reviews || 0,
        priceLevel: place.price || undefined,
        address: place.address || venueAddress,
        placeId: place.place_id || undefined,
        url: place.link || place.place_id_search || undefined,
        lastUpdated: new Date().toISOString(),
        recentReviews: this.extractRecentReviews(place),
      };
      
      console.log('📊 Parsed reviews data:', reviewsData);

      // Cache the data
      this.cacheData(venueId, reviewsData);
      
      console.log('✅ Google Reviews fetched:', reviewsData.rating, 'stars,', reviewsData.reviewCount, 'reviews');
      return reviewsData;
    } catch (error: any) {
      console.error('❌ Error fetching Google Reviews:', error);
      
      // Return cached data even if expired, as fallback
      const staleCache = this.getCachedData(venueId);
      if (staleCache) {
        console.log('📦 Using stale cached data as fallback');
        return staleCache;
      }
      
      return null;
    }
  }

  /**
   * Extract recent reviews from place data
   */
  private extractRecentReviews(place: any): GoogleReviewsData['recentReviews'] {
    if (!place.reviews_link) return undefined;
    
    // SerpAPI includes some review snippets in certain responses
    // This is a simplified extraction
    return undefined; // Would need separate reviews API call
  }

  /**
   * Force refresh reviews (bypasses cache)
   */
  async refreshReviews(venueName: string, venueAddress: string, venueId: string): Promise<GoogleReviewsData | null> {
    // Clear cache
    const key = `${CACHE_KEY_PREFIX}${venueId}`;
    localStorage.removeItem(key);
    
    // Fetch fresh data
    return this.getReviews(venueName, venueAddress, venueId);
  }

  /**
   * Get the Google Maps URL for the venue
   */
  getGoogleMapsUrl(venueName: string, venueAddress: string): string {
    const query = encodeURIComponent(`${venueName} ${venueAddress}`);
    return `https://www.google.com/maps/search/${query}`;
  }

  /**
   * Get the Google Reviews URL for the venue
   */
  getGoogleReviewsUrl(venueName: string, venueAddress: string): string {
    const query = encodeURIComponent(`${venueName} ${venueAddress}`);
    return `https://www.google.com/maps/search/${query}`;
  }
}

export default new GoogleReviewsService();

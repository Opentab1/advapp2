/**
 * Weather Service
 * 
 * Fetches outdoor weather data using Open-Meteo API (free, no API key required)
 * Geocodes venue address to coordinates using Nominatim (OpenStreetMap)
 */

export interface WeatherData {
  temperature: number;      // °F
  feelsLike: number;        // °F
  humidity: number;         // %
  conditions: string;       // "Sunny", "Cloudy", etc.
  icon: string;             // Emoji icon
  windSpeed: number;        // mph
  isDay: boolean;
  lastUpdated: string;      // ISO timestamp
}

interface GeocodingResult {
  lat: number;
  lon: number;
}

interface CachedWeather {
  data: WeatherData;
  coordinates: GeocodingResult;
  fetchedAt: number;
}

class WeatherService {
  private cache: Map<string, CachedWeather> = new Map();
  private readonly CACHE_TTL = 90 * 60 * 1000; // 90 minutes in milliseconds
  private geocodeCache: Map<string, GeocodingResult> = new Map();

  /**
   * Get weather for a venue by address
   */
  async getWeatherByAddress(address: string): Promise<WeatherData | null> {
    if (!address || address.trim() === '') {
      console.warn('⛅ No address provided for weather lookup');
      return null;
    }

    const cacheKey = address.toLowerCase().trim();
    const now = Date.now();

    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && (now - cached.fetchedAt) < this.CACHE_TTL) {
      console.log('⛅ Using cached weather data');
      return cached.data;
    }

    try {
      // Step 1: Geocode address to coordinates
      const coordinates = await this.geocodeAddress(address);
      if (!coordinates) {
        console.warn('⛅ Could not geocode address:', address);
        return null;
      }

      // Step 2: Fetch weather from Open-Meteo
      const weather = await this.fetchWeather(coordinates.lat, coordinates.lon);
      if (!weather) {
        return null;
      }

      // Cache the result
      this.cache.set(cacheKey, {
        data: weather,
        coordinates,
        fetchedAt: now
      });

      console.log('⛅ Weather fetched successfully:', weather.temperature + '°F', weather.conditions);
      return weather;
    } catch (error) {
      console.error('⛅ Error fetching weather:', error);
      return null;
    }
  }

  /**
   * Geocode an address to lat/lng using Nominatim (OpenStreetMap)
   */
  private async geocodeAddress(address: string): Promise<GeocodingResult | null> {
    const cacheKey = address.toLowerCase().trim();
    
    // Check geocode cache (addresses don't change)
    const cached = this.geocodeCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const encodedAddress = encodeURIComponent(address);
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodedAddress}&limit=1`,
        {
          headers: {
            'User-Agent': 'PulseDashboard/1.0'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`Geocoding failed: ${response.status}`);
      }

      const results = await response.json();
      
      if (results.length === 0) {
        return null;
      }

      const result: GeocodingResult = {
        lat: parseFloat(results[0].lat),
        lon: parseFloat(results[0].lon)
      };

      // Cache the geocoding result (permanent - addresses don't move)
      this.geocodeCache.set(cacheKey, result);
      
      console.log('⛅ Geocoded address:', address, '→', result.lat, result.lon);
      return result;
    } catch (error) {
      console.error('⛅ Geocoding error:', error);
      return null;
    }
  }

  /**
   * Fetch weather from Open-Meteo API
   */
  private async fetchWeather(lat: number, lon: number): Promise<WeatherData | null> {
    try {
      // Open-Meteo API - free, no key required
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,is_day&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto`;
      
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Weather API failed: ${response.status}`);
      }

      const data = await response.json();
      
      if (!data.current) {
        return null;
      }

      const current = data.current;
      const weatherCode = current.weather_code;
      const isDay = current.is_day === 1;

      return {
        temperature: Math.round(current.temperature_2m),
        feelsLike: Math.round(current.apparent_temperature),
        humidity: Math.round(current.relative_humidity_2m),
        conditions: this.getConditionsFromCode(weatherCode),
        icon: this.getIconFromCode(weatherCode, isDay),
        windSpeed: Math.round(current.wind_speed_10m),
        isDay,
        lastUpdated: new Date().toISOString()
      };
    } catch (error) {
      console.error('⛅ Weather API error:', error);
      return null;
    }
  }

  /**
   * Convert WMO weather code to human-readable conditions
   * https://open-meteo.com/en/docs#weathervariables
   */
  private getConditionsFromCode(code: number): string {
    const conditions: Record<number, string> = {
      0: 'Clear',
      1: 'Mostly Clear',
      2: 'Partly Cloudy',
      3: 'Overcast',
      45: 'Foggy',
      48: 'Icy Fog',
      51: 'Light Drizzle',
      53: 'Drizzle',
      55: 'Heavy Drizzle',
      56: 'Freezing Drizzle',
      57: 'Heavy Freezing Drizzle',
      61: 'Light Rain',
      63: 'Rain',
      65: 'Heavy Rain',
      66: 'Freezing Rain',
      67: 'Heavy Freezing Rain',
      71: 'Light Snow',
      73: 'Snow',
      75: 'Heavy Snow',
      77: 'Snow Grains',
      80: 'Light Showers',
      81: 'Showers',
      82: 'Heavy Showers',
      85: 'Light Snow Showers',
      86: 'Snow Showers',
      95: 'Thunderstorm',
      96: 'Thunderstorm w/ Hail',
      99: 'Severe Thunderstorm'
    };

    return conditions[code] || 'Unknown';
  }

  /**
   * Get weather icon emoji from code
   */
  private getIconFromCode(code: number, isDay: boolean): string {
    // Clear
    if (code === 0) return isDay ? '☀️' : '🌙';
    if (code === 1) return isDay ? '🌤️' : '🌙';
    if (code === 2) return '⛅';
    if (code === 3) return '☁️';
    
    // Fog
    if (code === 45 || code === 48) return '🌫️';
    
    // Drizzle/Rain
    if (code >= 51 && code <= 67) return '🌧️';
    
    // Snow
    if (code >= 71 && code <= 77) return '❄️';
    if (code === 85 || code === 86) return '🌨️';
    
    // Showers
    if (code >= 80 && code <= 82) return '🌦️';
    
    // Thunderstorm
    if (code >= 95) return '⛈️';
    
    return '🌡️';
  }

  /**
   * Clear the cache (force refresh on next call)
   */
  clearCache(): void {
    this.cache.clear();
    console.log('⛅ Weather cache cleared');
  }

  /**
   * Get cache age in minutes
   */
  getCacheAge(address: string): number | null {
    const cacheKey = address.toLowerCase().trim();
    const cached = this.cache.get(cacheKey);
    if (!cached) return null;
    return Math.round((Date.now() - cached.fetchedAt) / 60000);
  }
}

const weatherService = new WeatherService();
export default weatherService;

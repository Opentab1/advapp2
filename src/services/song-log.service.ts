import type { SongLogEntry, SensorData } from '../types';
import dynamoDBService from './dynamodb.service';
import authService from './auth.service';

// Types for enhanced analytics
export interface PerformingSong {
  song: string;
  artist: string;
  plays: number;
  avgOccupancy: number;
  avgOccupancyChange: number;
  avgDwellExtension: number; // minutes gained during this song
  performanceScore: number;
  albumArt?: string;
  genre?: string;
}

export interface PlaylistSong {
  position: number;
  song: string;
  artist: string;
  plays: number;
  performanceScore: number;
  albumArt?: string;
  reason: string;
  genre?: string;
}

export interface GenreStats {
  genre: string;
  plays: number;
  avgDwellTime: number; // average dwell time during genre plays
  avgOccupancy: number;
  totalMinutes: number; // total playtime
  performanceScore: number;
}

export type AnalyticsTimeRange = '7d' | '14d' | '30d' | '90d';

// Simple genre detection based on common patterns
const GENRE_PATTERNS: { [key: string]: string[] } = {
  'Country': ['country', 'nashville', 'honky tonk', 'bluegrass', 'luke bryan', 'morgan wallen', 'zach bryan', 'chris stapleton', 'luke combs', 'jason aldean', 'kenny chesney', 'carrie underwood', 'blake shelton', 'dolly parton', 'johnny cash', 'willie nelson', 'reba mcentire', 'garth brooks'],
  'Hip Hop': ['hip hop', 'rap', 'trap', 'drake', 'kanye', 'kendrick', 'travis scott', 'j. cole', 'future', 'lil', 'young thug', 'migos', '21 savage', 'post malone', 'cardi b', 'nicki minaj', 'jay-z', 'eminem'],
  'Pop': ['pop', 'taylor swift', 'ariana grande', 'dua lipa', 'ed sheeran', 'justin bieber', 'the weeknd', 'bruno mars', 'billie eilish', 'olivia rodrigo', 'harry styles', 'shawn mendes', 'selena gomez', 'katy perry', 'lady gaga'],
  'Rock': ['rock', 'alternative', 'indie rock', 'foo fighters', 'imagine dragons', 'coldplay', 'arctic monkeys', 'the killers', 'muse', 'green day', 'linkin park', 'nirvana', 'red hot chili', 'queens of the stone age'],
  'Electronic': ['edm', 'house', 'techno', 'electronic', 'dj', 'dance', 'marshmello', 'calvin harris', 'david guetta', 'tiesto', 'avicii', 'deadmau5', 'skrillex', 'diplo', 'zedd', 'chainsmokers'],
  'R&B': ['r&b', 'rnb', 'soul', 'sza', 'daniel caesar', 'h.e.r.', 'frank ocean', 'chris brown', 'usher', 'beyoncé', 'rihanna', 'the weeknd', 'john legend', 'alicia keys'],
  'Latin': ['latin', 'reggaeton', 'bad bunny', 'j balvin', 'daddy yankee', 'ozuna', 'anuel', 'maluma', 'shakira', 'enrique iglesias', 'pitbull', 'bachata', 'salsa'],
  'Classic Rock': ['classic rock', 'led zeppelin', 'pink floyd', 'the beatles', 'rolling stones', 'queen', 'ac/dc', 'guns n roses', 'aerosmith', 'journey', 'bon jovi', 'def leppard', 'van halen']
};

class SongLogService {
  private songs: SongLogEntry[] = [];
  private readonly MAX_SONGS = 500;
  private dynamoDBSongs: SongLogEntry[] = [];
  private lastDynamoDBFetch: number = 0;
  private readonly DYNAMODB_CACHE_TTL = 60000; // 1 minute cache
  
  // Cache for different time ranges
  private analyticsCache: Map<AnalyticsTimeRange, {
    performingSongs: PerformingSong[];
    genreStats: GenreStats[];
    timestamp: number;
  }> = new Map();

  addSong(song: Omit<SongLogEntry, 'id'>) {
    this.loadSongs();

    // Check if this song was logged within the last 5 minutes (300 seconds)
    // If so, skip adding it (it's still the same play session)
    const DUPLICATE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes in milliseconds
    const now = new Date(song.timestamp).getTime();
    
    const isDuplicate = this.songs.some(existingSong => {
      const existingTime = new Date(existingSong.timestamp).getTime();
      const timeDiff = now - existingTime;
      
      // Same song within 5 minutes = duplicate
      return (
        existingSong.songName === song.songName &&
        existingSong.artist === song.artist &&
        timeDiff >= 0 &&
        timeDiff < DUPLICATE_THRESHOLD_MS
      );
    });

    if (isDuplicate) {
      console.log(`⏭️ Skipping duplicate song: ${song.songName} (detected within 5 minutes)`);
      return; // Don't add duplicate
    }

    const entry: SongLogEntry = {
      ...song,
      id: `song-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    };

    this.songs.unshift(entry);
    
    // Keep only the most recent MAX_SONGS
    if (this.songs.length > this.MAX_SONGS) {
      this.songs = this.songs.slice(0, this.MAX_SONGS);
    }

    // Persist to localStorage
    this.saveSongs();
  }

  getSongs(limit?: number): SongLogEntry[] {
    this.loadSongs();
    return limit ? this.songs.slice(0, limit) : this.songs;
  }

  getSongsByDateRange(startDate: Date, endDate: Date): SongLogEntry[] {
    this.loadSongs();
    return this.songs.filter(song => {
      const songDate = new Date(song.timestamp);
      return songDate >= startDate && songDate <= endDate;
    });
  }

  getTopSongs(limit: number = 10): Array<{ song: string; artist: string; plays: number }> {
    this.loadSongs();
    const songCounts = new Map<string, { artist: string; plays: number }>();

    this.songs.forEach(song => {
      const key = `${song.songName}|${song.artist}`;
      const current = songCounts.get(key) || { artist: song.artist, plays: 0 };
      songCounts.set(key, { artist: current.artist, plays: current.plays + 1 });
    });

    return Array.from(songCounts.entries())
      .map(([key, data]) => ({
        song: key.split('|')[0],
        artist: data.artist,
        plays: data.plays
      }))
      .sort((a, b) => b.plays - a.plays)
      .slice(0, limit);
  }

  getTopGenres(limit: number = 10): Array<{ genre: string; plays: number }> {
    this.loadSongs();
    
    // Count songs by genre
    const genreCounts = new Map<string, number>();

    this.songs.forEach(song => {
      const genre = song.genre || 'Unknown';
      genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1);
    });

    return Array.from(genreCounts.entries())
      .map(([genre, plays]) => ({ genre, plays }))
      .sort((a, b) => b.plays - a.plays)
      .slice(0, limit);
  }

  clearOldSongs(daysToKeep: number = 30) {
    this.loadSongs();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    this.songs = this.songs.filter(song => new Date(song.timestamp) >= cutoffDate);
    this.saveSongs();
  }

  private saveSongs() {
    try {
      localStorage.setItem('songLog', JSON.stringify(this.songs));
    } catch (error) {
      console.error('Error saving songs to localStorage:', error);
    }
  }

  private loadSongs() {
    try {
      const stored = localStorage.getItem('songLog');
      if (stored) {
        this.songs = JSON.parse(stored);
      }
    } catch (error) {
      console.error('Error loading songs from localStorage:', error);
      this.songs = [];
    }
  }

  /**
   * Fetch all songs from DynamoDB historical sensor data
   * This is the primary source of truth for song history
   * Fetches in 3-day chunks to get ALL data and avoid query limits
   */
  async fetchSongsFromDynamoDB(days: number = 90): Promise<SongLogEntry[]> {
    const nowTime = Date.now();
    
    // Use cache if valid
    if (this.dynamoDBSongs.length > 0 && (nowTime - this.lastDynamoDBFetch) < this.DYNAMODB_CACHE_TTL) {
      console.log('🎵 Using cached DynamoDB songs');
      return this.dynamoDBSongs;
    }
    
    try {
      const user = authService.getStoredUser();
      const venueId = user?.venueId;
      
      if (!venueId) {
        console.warn('⚠️ No venueId found, cannot fetch songs from DynamoDB');
        return [];
      }
      
      console.log(`🎵 Fetching ALL songs from DynamoDB for last ${days} days...`);
      
      // Fetch in 3-day chunks to ensure we get ALL data
      // With 15-second intervals, 3 days = ~17,280 readings, well under 50k limit
      const allSensorData: SensorData[] = [];
      const chunkSizeDays = 3;
      const now = new Date();
      
      // Calculate number of chunks needed
      const chunks = Math.ceil(days / chunkSizeDays);
      let totalReadings = 0;
      
      for (let i = 0; i < chunks; i++) {
        // Calculate the time window for this chunk
        // Chunk 0 = most recent 3 days, Chunk 1 = 3-6 days ago, etc.
        const chunkEndDaysAgo = i * chunkSizeDays;
        const chunkStartDaysAgo = Math.min((i + 1) * chunkSizeDays, days);
        
        const chunkEnd = new Date(now.getTime() - chunkEndDaysAgo * 24 * 60 * 60 * 1000);
        const chunkStart = new Date(now.getTime() - chunkStartDaysAgo * 24 * 60 * 60 * 1000);
        
        console.log(`🎵 Chunk ${i + 1}/${chunks}: ${chunkStart.toLocaleDateString()} to ${chunkEnd.toLocaleDateString()}`);
        
        try {
          // Use the new date range method with high limit
          const chunkData = await dynamoDBService.getSensorDataByDateRange(
            venueId, 
            chunkStart, 
            chunkEnd, 
            20000 // High limit per chunk
          );
          
          if (chunkData && chunkData.length > 0) {
            allSensorData.push(...chunkData);
            totalReadings += chunkData.length;
            console.log(`🎵 Chunk ${i + 1}: ${chunkData.length} readings (total: ${totalReadings})`);
          }
        } catch (chunkError) {
          console.warn(`⚠️ Error fetching chunk ${i + 1}:`, chunkError);
          // Continue with other chunks
        }
        
        // Small delay to avoid rate limiting
        if (i < chunks - 1) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
      
      if (allSensorData.length === 0) {
        console.log('🎵 No historical data found in DynamoDB');
        return [];
      }
      
      // Remove duplicates by timestamp
      const uniqueData = Array.from(
        new Map(allSensorData.map(d => [d.timestamp, d])).values()
      );
      
      // Sort by timestamp (newest first)
      uniqueData.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      
      // Extract songs from sensor data
      const songs = this.extractSongsFromSensorData(uniqueData);
      
      console.log(`🎵 Extracted ${songs.length} unique songs from ${uniqueData.length} sensor readings (${chunks} chunks, ${totalReadings} total fetched)`);
      
      // Cache the results
      this.dynamoDBSongs = songs;
      this.lastDynamoDBFetch = now;
      
      return songs;
    } catch (error) {
      console.error('❌ Error fetching songs from DynamoDB:', error);
      return [];
    }
  }
  
  /**
   * Extract unique songs from sensor data readings
   * Deduplicates consecutive plays of the same song
   */
  private extractSongsFromSensorData(sensorData: SensorData[]): SongLogEntry[] {
    const songs: SongLogEntry[] = [];
    let lastSongKey = '';
    
    // Sort by timestamp ascending
    const sorted = [...sensorData].sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    
    for (const reading of sorted) {
      if (!reading.currentSong) continue;
      
      // Create a unique key for this song
      const songKey = `${reading.currentSong}|${reading.artist || 'Unknown'}`;
      
      // Skip if it's the same song as the last one (still playing)
      if (songKey === lastSongKey) continue;
      
      lastSongKey = songKey;
      
      songs.push({
        id: `db-${reading.timestamp}-${Math.random().toString(36).substr(2, 5)}`,
        timestamp: reading.timestamp,
        songName: reading.currentSong,
        artist: reading.artist || 'Unknown Artist',
        albumArt: reading.albumArt,
        source: 'spotify',
        genre: undefined
      });
    }
    
    // Return in reverse chronological order (newest first)
    return songs.reverse();
  }
  
  /**
   * Get all songs - combines DynamoDB and localStorage
   * DynamoDB is the primary source, localStorage is supplementary
   */
  async getAllSongs(limit?: number): Promise<SongLogEntry[]> {
    // Fetch from DynamoDB
    const dynamoSongs = await this.fetchSongsFromDynamoDB(90);
    
    // Load localStorage songs
    this.loadSongs();
    
    // Combine and deduplicate
    const allSongs = [...dynamoSongs];
    
    // Add localStorage songs that aren't already in DynamoDB
    for (const localSong of this.songs) {
      const exists = allSongs.some(s => 
        s.songName === localSong.songName && 
        s.artist === localSong.artist &&
        Math.abs(new Date(s.timestamp).getTime() - new Date(localSong.timestamp).getTime()) < 5 * 60 * 1000
      );
      if (!exists) {
        allSongs.push(localSong);
      }
    }
    
    // Sort by timestamp descending (newest first)
    allSongs.sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    
    return limit ? allSongs.slice(0, limit) : allSongs;
  }
  
  /**
   * Get top songs from all sources
   */
  async getTopSongsFromAll(limit: number = 10): Promise<Array<{ song: string; artist: string; plays: number }>> {
    const allSongs = await this.getAllSongs();
    const songCounts = new Map<string, { artist: string; plays: number }>();

    allSongs.forEach(song => {
      const key = `${song.songName}|${song.artist}`;
      const current = songCounts.get(key) || { artist: song.artist, plays: 0 };
      songCounts.set(key, { artist: current.artist, plays: current.plays + 1 });
    });

    return Array.from(songCounts.entries())
      .map(([key, data]) => ({
        song: key.split('|')[0],
        artist: data.artist,
        plays: data.plays
      }))
      .sort((a, b) => b.plays - a.plays)
      .slice(0, limit);
  }
  
  /**
   * Clear the DynamoDB cache to force a refresh
   */
  clearCache(): void {
    this.dynamoDBSongs = [];
    this.lastDynamoDBFetch = 0;
    this.performingSongsCache = [];
    this.lastPerformanceCalc = 0;
    this.analyticsCache.clear();
  }
  
  /**
   * Detect genre based on song name and artist
   */
  detectGenre(songName: string, artist: string): string {
    const searchText = `${songName} ${artist}`.toLowerCase();
    
    for (const [genre, patterns] of Object.entries(GENRE_PATTERNS)) {
      for (const pattern of patterns) {
        if (searchText.includes(pattern.toLowerCase())) {
          return genre;
        }
      }
    }
    
    return 'Other';
  }
  
  /**
   * Get days for time range
   */
  private getDaysForRange(range: AnalyticsTimeRange): number {
    switch (range) {
      case '7d': return 7;
      case '14d': return 14;
      case '30d': return 30;
      case '90d': return 90;
      default: return 30;
    }
  }
  
  private performingSongsCache: PerformingSong[] = [];
  private lastPerformanceCalc: number = 0;
  private readonly PERFORMANCE_CACHE_TTL = 300000; // 5 minute cache
  
  /**
   * Get highest performing songs based on occupancy/dwell time correlation
   * "Best performing" = songs that correlate with stable/growing occupancy and longer dwell
   */
  async getHighestPerformingSongs(limit: number = 10, timeRange: AnalyticsTimeRange = '30d'): Promise<PerformingSong[]> {
    const now = Date.now();
    
    // Check analytics cache
    const cached = this.analyticsCache.get(timeRange);
    if (cached && (now - cached.timestamp) < this.PERFORMANCE_CACHE_TTL) {
      return cached.performingSongs.slice(0, limit);
    }
    
    try {
      const user = authService.getStoredUser();
      const venueId = user?.venueId;
      
      if (!venueId) {
        return [];
      }
      
      // Get sensor data for the specified time range
      const historicalData = await dynamoDBService.getHistoricalSensorData(venueId, timeRange);
      
      if (!historicalData?.data || historicalData.data.length === 0) {
        console.log(`🎵 No data available for ${timeRange}`);
        return [];
      }
      
      // Sort sensor data by timestamp
      const sensorData = [...historicalData.data].sort((a, b) => 
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
      
      console.log(`🎵 Analyzing ${sensorData.length} readings for song performance (${timeRange})`);
      
      // Build a map of song performances
      const songPerformance = new Map<string, {
        song: string;
        artist: string;
        plays: number;
        occupancyReadings: number[];
        occupancyChanges: number[];
        dwellExtensions: number[]; // estimated dwell time extension per play
        albumArt?: string;
        genre?: string;
        playDurations: number[]; // how long each play lasted in minutes
      }>();
      
      // Track when each song starts playing
      let currentSongStart: { song: string; startIndex: number; startTime: number } | null = null;
      
      // Analyze each sensor reading that has a song
      for (let i = 0; i < sensorData.length; i++) {
        const reading = sensorData[i];
        if (!reading.currentSong) continue;
        
        const key = `${reading.currentSong}|${reading.artist || 'Unknown'}`;
        const currentTime = new Date(reading.timestamp).getTime();
        
        // Initialize song entry if needed
        if (!songPerformance.has(key)) {
          const genre = this.detectGenre(reading.currentSong, reading.artist || '');
          songPerformance.set(key, {
            song: reading.currentSong,
            artist: reading.artist || 'Unknown',
            plays: 0,
            occupancyReadings: [],
            occupancyChanges: [],
            dwellExtensions: [],
            albumArt: reading.albumArt,
            genre,
            playDurations: []
          });
        }
        
        const perf = songPerformance.get(key)!;
        
        // Check if song changed (new play)
        const prevReading = i > 0 ? sensorData[i - 1] : null;
        const songChanged = !prevReading || prevReading.currentSong !== reading.currentSong;
        
        if (songChanged) {
          // If we were tracking a previous song, record its duration
          if (currentSongStart && currentSongStart.song !== key) {
            const prevPerf = songPerformance.get(currentSongStart.song);
            if (prevPerf) {
              const duration = (currentTime - currentSongStart.startTime) / 60000; // minutes
              if (duration > 0 && duration < 30) { // Sanity check: songs < 30 min
                prevPerf.playDurations.push(duration);
              }
            }
          }
          
          // Start tracking this song
          currentSongStart = { song: key, startIndex: i, startTime: currentTime };
          perf.plays++;
        }
        
        // Record occupancy during this song
        if (reading.occupancy?.current !== undefined) {
          perf.occupancyReadings.push(reading.occupancy.current);
        }
        
        // Calculate occupancy change (compare to reading ~5 min ago)
        if (reading.occupancy?.current !== undefined) {
          const fiveMinAgo = currentTime - 5 * 60 * 1000;
          for (let j = i - 1; j >= 0; j--) {
            const checkTime = new Date(sensorData[j].timestamp).getTime();
            if (checkTime <= fiveMinAgo && sensorData[j].occupancy?.current !== undefined) {
              const change = reading.occupancy.current - sensorData[j].occupancy!.current;
              perf.occupancyChanges.push(change);
              break;
            }
          }
        }
      }
      
      // Calculate dwell time extension for each song
      // Songs with high occupancy stability = longer dwell
      // We estimate dwell extension as: (avgOccupancy / maxOccupancy) * avgPlayDuration
      const maxOccupancy = Math.max(...Array.from(songPerformance.values())
        .flatMap(p => p.occupancyReadings)
        .filter(v => v > 0), 100);
      
      // Calculate performance scores
      const results: PerformingSong[] = [];
      
      songPerformance.forEach((perf) => {
        if (perf.plays < 1) return; // Need at least 1 play
        
        const avgOccupancy = perf.occupancyReadings.length > 0
          ? perf.occupancyReadings.reduce((a, b) => a + b, 0) / perf.occupancyReadings.length
          : 0;
          
        const avgChange = perf.occupancyChanges.length > 0
          ? perf.occupancyChanges.reduce((a, b) => a + b, 0) / perf.occupancyChanges.length
          : 0;
        
        const avgPlayDuration = perf.playDurations.length > 0
          ? perf.playDurations.reduce((a, b) => a + b, 0) / perf.playDurations.length
          : 3.5; // Default avg song ~3.5 min
        
        // Estimate dwell extension: positive occupancy change during song = people staying
        // Formula: avgChange * avgPlayDuration (capped at reasonable bounds)
        const dwellExtension = Math.max(-5, Math.min(10, avgChange * 0.5));
        
        // Performance score formula (0-100):
        // - Base score from average occupancy (normalized 0-40)
        // - Bonus for positive occupancy change (0-35)
        // - Bonus for play count (0-15)
        // - Bonus for dwell extension (0-10)
        const occupancyScore = Math.min(40, (avgOccupancy / maxOccupancy) * 40);
        const changeScore = Math.min(35, Math.max(0, (avgChange + 3) * 5)); // +3 offset so neutral = 15
        const playsScore = Math.min(15, Math.log2(perf.plays + 1) * 5);
        const dwellScore = Math.min(10, Math.max(0, (dwellExtension + 2) * 2));
        
        const performanceScore = Math.round(occupancyScore + changeScore + playsScore + dwellScore);
        
        results.push({
          song: perf.song,
          artist: perf.artist,
          plays: perf.plays,
          avgOccupancy: Math.round(avgOccupancy),
          avgOccupancyChange: Math.round(avgChange * 10) / 10,
          avgDwellExtension: Math.round(dwellExtension * 10) / 10,
          performanceScore: Math.min(100, performanceScore),
          albumArt: perf.albumArt,
          genre: perf.genre
        });
      });
      
      // Sort by performance score descending
      results.sort((a, b) => b.performanceScore - a.performanceScore);
      
      // Cache results (also compute genre stats while we have the data)
      const genreStats = this.computeGenreStats(songPerformance, maxOccupancy);
      
      this.analyticsCache.set(timeRange, {
        performingSongs: results,
        genreStats,
        timestamp: now
      });
      
      // Also update the legacy cache for backwards compatibility
      this.performingSongsCache = results;
      this.lastPerformanceCalc = now;
      
      console.log(`🎵 Calculated performance scores for ${results.length} songs (${timeRange})`);
      
      return results.slice(0, limit);
    } catch (error) {
      console.error('Error calculating song performance:', error);
      return [];
    }
  }
  
  /**
   * Compute genre statistics from song performance data
   */
  private computeGenreStats(
    songPerformance: Map<string, {
      song: string;
      artist: string;
      plays: number;
      occupancyReadings: number[];
      occupancyChanges: number[];
      dwellExtensions: number[];
      albumArt?: string;
      genre?: string;
      playDurations: number[];
    }>,
    maxOccupancy: number
  ): GenreStats[] {
    const genreMap = new Map<string, {
      plays: number;
      occupancySum: number;
      occupancyCount: number;
      changeSum: number;
      changeCount: number;
      totalDuration: number;
    }>();
    
    songPerformance.forEach((perf) => {
      const genre = perf.genre || 'Other';
      
      if (!genreMap.has(genre)) {
        genreMap.set(genre, {
          plays: 0,
          occupancySum: 0,
          occupancyCount: 0,
          changeSum: 0,
          changeCount: 0,
          totalDuration: 0
        });
      }
      
      const stats = genreMap.get(genre)!;
      stats.plays += perf.plays;
      
      perf.occupancyReadings.forEach(o => {
        stats.occupancySum += o;
        stats.occupancyCount++;
      });
      
      perf.occupancyChanges.forEach(c => {
        stats.changeSum += c;
        stats.changeCount++;
      });
      
      const songDuration = perf.playDurations.reduce((a, b) => a + b, 0);
      stats.totalDuration += songDuration || (perf.plays * 3.5); // Default 3.5 min per play
    });
    
    const results: GenreStats[] = [];
    
    genreMap.forEach((stats, genre) => {
      if (stats.plays < 1) return;
      
      const avgOccupancy = stats.occupancyCount > 0 
        ? stats.occupancySum / stats.occupancyCount 
        : 0;
      
      const avgChange = stats.changeCount > 0 
        ? stats.changeSum / stats.changeCount 
        : 0;
      
      // Estimate avg dwell time based on occupancy stability
      // Higher occupancy with positive change = longer dwell
      const avgDwellTime = Math.max(5, 15 + avgChange * 2); // 5-30 minute range
      
      // Performance score for genre
      const occupancyScore = Math.min(40, (avgOccupancy / maxOccupancy) * 40);
      const changeScore = Math.min(35, Math.max(0, (avgChange + 3) * 5));
      const playsScore = Math.min(25, Math.log10(stats.plays + 1) * 10);
      
      results.push({
        genre,
        plays: stats.plays,
        avgDwellTime: Math.round(avgDwellTime),
        avgOccupancy: Math.round(avgOccupancy),
        totalMinutes: Math.round(stats.totalDuration),
        performanceScore: Math.round(Math.min(100, occupancyScore + changeScore + playsScore))
      });
    });
    
    // Sort by plays descending
    results.sort((a, b) => b.plays - a.plays);
    
    return results;
  }
  
  /**
   * Get genre statistics for the specified time range
   */
  async getGenreStats(limit: number = 10, timeRange: AnalyticsTimeRange = '30d'): Promise<GenreStats[]> {
    // Ensure we have computed the analytics
    const cached = this.analyticsCache.get(timeRange);
    if (cached && (Date.now() - cached.timestamp) < this.PERFORMANCE_CACHE_TTL) {
      return cached.genreStats.slice(0, limit);
    }
    
    // Trigger computation by getting performing songs
    await this.getHighestPerformingSongs(10, timeRange);
    
    // Now get from cache
    const updated = this.analyticsCache.get(timeRange);
    return updated?.genreStats.slice(0, limit) || [];
  }
  
  /**
   * Generate a "Top Performers" playlist data
   * Returns songs formatted for playlist display/export
   */
  async getTopPerformersPlaylist(limit: number = 20, timeRange: AnalyticsTimeRange = '30d'): Promise<PlaylistSong[]> {
    const topSongs = await this.getHighestPerformingSongs(limit, timeRange);
    
    return topSongs.map((song, index) => ({
      position: index + 1,
      song: song.song,
      artist: song.artist,
      plays: song.plays,
      performanceScore: song.performanceScore,
      albumArt: song.albumArt,
      genre: song.genre,
      reason: song.avgDwellExtension >= 0 
        ? `+${song.avgDwellExtension} min dwell`
        : song.avgOccupancyChange >= 0 
          ? `+${song.avgOccupancyChange} people during plays`
          : `${song.plays} plays, avg ${song.avgOccupancy} people`
    }));
  }
  
  /**
   * Export playlist to various formats
   */
  async exportPlaylist(format: 'csv' | 'txt' | 'json' = 'csv', timeRange: AnalyticsTimeRange = '30d', venueName?: string): Promise<void> {
    const playlist = await this.getTopPerformersPlaylist(50, timeRange);
    
    if (playlist.length === 0) {
      console.warn('No playlist data to export');
      return;
    }
    
    let content: string;
    let filename: string;
    let mimeType: string;
    
    const venuePrefix = venueName ? venueName.toLowerCase().replace(/\s+/g, '-') : 'venue';
    const dateStr = new Date().toISOString().split('T')[0];
    
    switch (format) {
      case 'txt':
        // Simple text format for easy copy/paste
        content = `Top Performers Playlist (${timeRange})\n`;
        content += `Generated: ${new Date().toLocaleDateString()}\n\n`;
        playlist.forEach(song => {
          content += `${song.position}. ${song.song} - ${song.artist}\n`;
        });
        filename = `${venuePrefix}-playlist-${dateStr}.txt`;
        mimeType = 'text/plain;charset=utf-8;';
        break;
        
      case 'json':
        // JSON format for integrations
        content = JSON.stringify({
          name: `${venuePrefix} Top Performers`,
          description: `Auto-generated playlist based on ${timeRange} venue performance data`,
          generatedAt: new Date().toISOString(),
          tracks: playlist.map(song => ({
            name: song.song,
            artist: song.artist,
            performanceScore: song.performanceScore,
            genre: song.genre
          }))
        }, null, 2);
        filename = `${venuePrefix}-playlist-${dateStr}.json`;
        mimeType = 'application/json;charset=utf-8;';
        break;
        
      case 'csv':
      default:
        // CSV format
        const headers = ['Position', 'Song', 'Artist', 'Plays', 'Performance Score', 'Genre', 'Reason'];
        const rows = playlist.map(song => [
          song.position,
          song.song,
          song.artist,
          song.plays,
          song.performanceScore,
          song.genre || 'Unknown',
          song.reason
        ]);
        content = [
          headers.join(','),
          ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
        ].join('\n');
        filename = `${venuePrefix}-playlist-${dateStr}.csv`;
        mimeType = 'text/csv;charset=utf-8;';
        break;
    }
    
    // Download the file
    const blob = new Blob([content], { type: mimeType });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    console.log(`📥 Exported playlist as ${format}: ${filename}`);
  }
  
  exportToCSV(venueName?: string): void {
    this.loadSongs();
    const headers = ['Timestamp', 'Song', 'Artist', 'Source', 'Duration'];
    const rows = this.songs.map(song => [
      song.timestamp,
      song.songName,
      song.artist,
      song.source,
      song.duration ? `${song.duration}s` : 'N/A'
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const venuePrefix = venueName ? venueName.toLowerCase().replace(/\s+/g, '-') : 'song';
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', `${venuePrefix}-song-log-${new Date().toISOString()}.csv`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
  
  /**
   * Export all songs (including DynamoDB) to CSV
   */
  async exportAllToCSV(venueName?: string): Promise<void> {
    const allSongs = await this.getAllSongs();
    const headers = ['Timestamp', 'Song', 'Artist', 'Source', 'Album Art'];
    const rows = allSongs.map(song => [
      song.timestamp,
      song.songName,
      song.artist,
      song.source,
      song.albumArt || 'N/A'
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const venuePrefix = venueName ? venueName.toLowerCase().replace(/\s+/g, '-') : 'song';
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', `${venuePrefix}-all-songs-${new Date().toISOString()}.csv`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

export default new SongLogService();

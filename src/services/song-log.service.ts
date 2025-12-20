import type { SongLogEntry, SensorData } from '../types';
import dynamoDBService from './dynamodb.service';
import authService from './auth.service';

class SongLogService {
  private songs: SongLogEntry[] = [];
  private readonly MAX_SONGS = 500;
  private dynamoDBSongs: SongLogEntry[] = [];
  private lastDynamoDBFetch: number = 0;
  private readonly DYNAMODB_CACHE_TTL = 60000; // 1 minute cache

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

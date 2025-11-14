import type { SongLogEntry } from '../types';

class SongLogService {
  private songs: SongLogEntry[] = [];
  private readonly MAX_SONGS = 500;

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
}

export default new SongLogService();

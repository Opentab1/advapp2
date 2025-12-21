import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Music, Download, Clock, TrendingUp, RefreshCw, Star, Zap, ListMusic } from 'lucide-react';
import { format } from 'date-fns';
import songLogService from '../services/song-log.service';
import authService from '../services/auth.service';
import type { SongLogEntry } from '../types';

interface PerformingSong {
  song: string;
  artist: string;
  plays: number;
  avgOccupancy: number;
  avgOccupancyChange: number;
  performanceScore: number;
  albumArt?: string;
}

interface PlaylistSong {
  position: number;
  song: string;
  artist: string;
  performanceScore: number;
  albumArt?: string;
  reason: string;
}

export function SongLog() {
  const [songs, setSongs] = useState<SongLogEntry[]>([]);
  const [topSongs, setTopSongs] = useState<Array<{ song: string; artist: string; plays: number }>>([]);
  const [topGenres, setTopGenres] = useState<Array<{ genre: string; plays: number }>>([]);
  const [highestPerforming, setHighestPerforming] = useState<PerformingSong[]>([]);
  const [topPerformersPlaylist, setTopPerformersPlaylist] = useState<PlaylistSong[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalSongs, setTotalSongs] = useState(0);

  useEffect(() => {
    loadSongs();
  }, []);

  const loadSongs = async () => {
    setLoading(true);
    try {
      // Fetch all songs from DynamoDB + localStorage
      const allSongs = await songLogService.getAllSongs();
      setSongs(allSongs.slice(0, 200)); // Show first 200 in list
      setTotalSongs(allSongs.length);
      
      // Get top songs from all sources
      const top = await songLogService.getTopSongsFromAll(10);
      setTopSongs(top);
      
      // Top genres still from localStorage (genre detection not in DynamoDB)
      setTopGenres(songLogService.getTopGenres(10));
      
      // Get highest performing songs (by occupancy correlation)
      const performing = await songLogService.getHighestPerformingSongs(10);
      setHighestPerforming(performing);
      
      // Get top performers playlist
      const playlist = await songLogService.getTopPerformersPlaylist(20);
      setTopPerformersPlaylist(playlist);
      
      console.log(`🎵 Loaded ${allSongs.length} songs, ${performing.length} with performance data`);
    } catch (error) {
      console.error('Error loading songs:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = () => {
    songLogService.clearCache();
    loadSongs();
  };

  const handleExport = async () => {
    const user = authService.getStoredUser();
    const venueName = user?.venueName || user?.email?.split('@')[0] || undefined;
    await songLogService.exportAllToCSV(venueName);
  };

  return (
    <div className="max-w-7xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-3xl font-bold gradient-text">Song History</h2>
            <p className="text-sm text-gray-400 mt-1">
              {loading ? 'Loading songs from DynamoDB...' : `${totalSongs.toLocaleString()} songs tracked`}
            </p>
          </div>
          <div className="flex gap-3">
            <motion.button
              onClick={handleRefresh}
              disabled={loading}
              className="btn-secondary flex items-center gap-2"
              whileHover={{ scale: loading ? 1 : 1.05 }}
              whileTap={{ scale: loading ? 1 : 0.95 }}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </motion.button>
            <motion.button
              onClick={handleExport}
              disabled={loading}
              className="btn-primary flex items-center gap-2"
              whileHover={{ scale: loading ? 1 : 1.05 }}
              whileTap={{ scale: loading ? 1 : 0.95 }}
            >
              <Download className="w-4 h-4" />
              Export CSV
            </motion.button>
          </div>
        </div>

        {/* Highest Performing Songs Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Highest Performing Songs */}
          <motion.div
            className="glass-card p-6"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
          >
            <div className="flex items-center gap-3 mb-2">
              <Star className="w-6 h-6 text-yellow-400" />
              <h3 className="text-xl font-semibold text-white">Highest Performing Songs</h3>
            </div>
            <p className="text-xs text-gray-400 mb-4">Songs that keep people in your venue longer</p>

            <div className="space-y-3 max-h-[400px] overflow-y-auto custom-scrollbar">
              {highestPerforming.length > 0 ? highestPerforming.map((song, index) => (
                <motion.div
                  key={index}
                  className="flex items-center gap-3 p-3 rounded-lg bg-gradient-to-r from-yellow-500/10 to-orange-500/10 border border-yellow-500/20 hover:border-yellow-500/40 transition-colors"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1 + index * 0.05 }}
                >
                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-yellow-500/20 text-yellow-400 font-bold">
                    {index + 1}
                  </div>
                  {song.albumArt ? (
                    <img src={song.albumArt} alt={song.song} className="w-10 h-10 rounded-lg object-cover" />
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-yellow-500/20 flex items-center justify-center">
                      <Music className="w-5 h-5 text-yellow-400" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white truncate">{song.song}</div>
                    <div className="text-xs text-gray-400 truncate">{song.artist}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-yellow-400">{song.performanceScore}</div>
                    <div className="text-xs text-gray-400">score</div>
                  </div>
                </motion.div>
              )) : (
                <div className="text-center py-8 text-gray-400 text-sm">
                  {loading ? 'Analyzing song performance...' : 'Not enough data yet. Keep playing music!'}
                </div>
              )}
            </div>
          </motion.div>

          {/* Top Performers Playlist */}
          <motion.div
            className="glass-card p-6"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <div className="flex items-center gap-3 mb-2">
              <ListMusic className="w-6 h-6 text-green-400" />
              <h3 className="text-xl font-semibold text-white">Top Performers Playlist</h3>
            </div>
            <p className="text-xs text-gray-400 mb-4">Your venue's crowd-favorite tracks</p>

            <div className="space-y-2 max-h-[400px] overflow-y-auto custom-scrollbar">
              {topPerformersPlaylist.length > 0 ? topPerformersPlaylist.map((song, index) => (
                <motion.div
                  key={index}
                  className="flex items-center gap-3 p-2 rounded-lg bg-gradient-to-r from-green-500/10 to-emerald-500/10 hover:from-green-500/20 hover:to-emerald-500/20 transition-colors"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.15 + index * 0.03 }}
                >
                  <div className="w-6 text-center text-green-400 font-mono text-sm">{song.position}</div>
                  {song.albumArt ? (
                    <img src={song.albumArt} alt={song.song} className="w-8 h-8 rounded object-cover" />
                  ) : (
                    <div className="w-8 h-8 rounded bg-green-500/20 flex items-center justify-center">
                      <Music className="w-4 h-4 text-green-400" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white truncate">{song.song}</div>
                    <div className="text-xs text-gray-400 truncate">{song.artist}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Zap className="w-3 h-3 text-green-400" />
                    <span className="text-xs text-green-400">{song.reason}</span>
                  </div>
                </motion.div>
              )) : (
                <div className="text-center py-8 text-gray-400 text-sm">
                  {loading ? 'Building your playlist...' : 'Play more songs to generate your playlist!'}
                </div>
              )}
            </div>

            {topPerformersPlaylist.length > 0 && (
              <motion.div 
                className="mt-4 pt-4 border-t border-white/10"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
              >
                <div className="text-center text-xs text-gray-400">
                  <Zap className="w-4 h-4 inline-block mr-1 text-green-400" />
                  Based on {totalSongs.toLocaleString()} songs analyzed over 30 days
                </div>
              </motion.div>
            )}
          </motion.div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-6">
          {/* Top Songs */}
          <motion.div
            className="glass-card p-6"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
          >
            <div className="flex items-center gap-3 mb-4">
              <TrendingUp className="w-5 h-5 text-cyan" />
              <h3 className="text-xl font-semibold text-white">Most Played</h3>
            </div>

            <div className="space-y-3">
              {topSongs.length > 0 ? topSongs.map((song, index) => (
                <motion.div
                  key={index}
                  className="flex items-center justify-between p-3 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.2 + index * 0.05 }}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-cyan font-bold text-lg">{index + 1}</span>
                    <div>
                      <div className="text-sm font-medium text-white">{song.song}</div>
                      <div className="text-xs text-gray-400">{song.artist}</div>
                    </div>
                  </div>
                  <div className="text-cyan font-bold">{song.plays}x</div>
                </motion.div>
              )) : (
                <div className="text-center py-8 text-gray-400 text-sm">
                  No songs tracked yet
                </div>
              )}
            </div>
          </motion.div>

          {/* Top Genres */}
          <motion.div
            className="glass-card p-6"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
          >
            <div className="flex items-center gap-3 mb-4">
              <Music className="w-5 h-5 text-purple-400" />
              <h3 className="text-xl font-semibold text-white">Top Genres</h3>
            </div>

            <div className="space-y-3">
              {topGenres.length > 0 && topGenres[0].genre !== 'Unknown' ? topGenres.map((genre, index) => (
                <motion.div
                  key={index}
                  className="flex items-center justify-between p-3 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.25 + index * 0.05 }}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-purple-400 font-bold text-lg">{index + 1}</span>
                    <div className="text-sm font-medium text-white">{genre.genre}</div>
                  </div>
                  <div className="text-purple-400 font-bold">{genre.plays}</div>
                </motion.div>
              )) : (
                <div className="text-center py-8 text-gray-400 text-sm">
                  Genre tracking coming soon
                </div>
              )}
            </div>
          </motion.div>

          {/* Recent Songs */}
          <motion.div
            className="lg:col-span-2 glass-card p-6"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
          >
            <div className="flex items-center gap-3 mb-4">
              <Clock className="w-5 h-5 text-cyan" />
              <h3 className="text-xl font-semibold text-white">Recent Plays</h3>
            </div>

            <div className="space-y-2 max-h-[600px] overflow-y-auto custom-scrollbar">
              {songs.map((song, index) => (
                <motion.div
                  key={song.id}
                  className="flex items-center gap-4 p-3 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 + index * 0.02 }}
                >
                  {song.albumArt ? (
                    <img
                      src={song.albumArt}
                      alt={song.songName}
                      className="w-12 h-12 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-cyan/20 flex items-center justify-center">
                      <Music className="w-6 h-6 text-cyan" />
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white truncate">{song.songName}</div>
                    <div className="text-xs text-gray-400 truncate">{song.artist}</div>
                  </div>

                  <div className="text-right">
                    <div className="text-xs text-gray-400">
                      {format(new Date(song.timestamp), 'MMM d, h:mm a')}
                    </div>
                    <div className="text-xs text-cyan capitalize">{song.source}</div>
                  </div>
                </motion.div>
              ))}

              {loading && (
                <div className="text-center py-12">
                  <RefreshCw className="w-16 h-16 text-cyan animate-spin mx-auto mb-4" />
                  <p className="text-gray-400">Loading songs from DynamoDB...</p>
                </div>
              )}

              {!loading && songs.length === 0 && (
                <div className="text-center py-12">
                  <Music className="w-16 h-16 text-gray-600 mx-auto mb-4" />
                  <p className="text-gray-400">No songs played yet</p>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}

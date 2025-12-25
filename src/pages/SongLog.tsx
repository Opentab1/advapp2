import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Music, Download, Clock, TrendingUp, RefreshCw, Star, Zap, ListMusic, 
  Calendar, FileText, FileJson, Filter, ChevronDown, Award, Disc3,
  BarChart3, Timer, Users
} from 'lucide-react';
import { format } from 'date-fns';
import songLogService, { 
  PerformingSong, 
  PlaylistSong, 
  GenreStats, 
  AnalyticsTimeRange 
} from '../services/song-log.service';
import authService from '../services/auth.service';
import type { SongLogEntry } from '../types';

type ExportFormat = 'csv' | 'txt' | 'json';

export function SongLog() {
  const [songs, setSongs] = useState<SongLogEntry[]>([]);
  const [topSongs, setTopSongs] = useState<Array<{ song: string; artist: string; plays: number }>>([]);
  const [genreStats, setGenreStats] = useState<GenreStats[]>([]);
  const [highestPerforming, setHighestPerforming] = useState<PerformingSong[]>([]);
  const [topPerformersPlaylist, setTopPerformersPlaylist] = useState<PlaylistSong[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [totalSongs, setTotalSongs] = useState(0);
  const [timeRange, setTimeRange] = useState<AnalyticsTimeRange>('30d');
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(false);

  const loadSongs = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch all songs from DynamoDB + localStorage
      const allSongs = await songLogService.getAllSongs();
      setSongs(allSongs.slice(0, 200)); // Show first 200 in list
      setTotalSongs(allSongs.length);
      
      // Get top songs from all sources
      const top = await songLogService.getTopSongsFromAll(10);
      setTopSongs(top);
      
      setDataLoaded(true);
      console.log(`🎵 Loaded ${allSongs.length} songs`);
    } catch (error) {
      console.error('Error loading songs:', error);
      setDataLoaded(true); // Mark as loaded even on error to show empty state
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAnalytics = useCallback(async (range: AnalyticsTimeRange) => {
    setAnalyticsLoading(true);
    try {
      // Get highest performing songs with dwell time correlation
      const performing = await songLogService.getHighestPerformingSongs(10, range);
      setHighestPerforming(performing);
      
      // Get top performers playlist
      const playlist = await songLogService.getTopPerformersPlaylist(20, range);
      setTopPerformersPlaylist(playlist);
      
      // Get genre stats
      const genres = await songLogService.getGenreStats(10, range);
      setGenreStats(genres);
      
      console.log(`🎵 Analytics loaded for ${range}: ${performing.length} performing, ${genres.length} genres`);
    } catch (error) {
      console.error('Error loading analytics:', error);
    } finally {
      setAnalyticsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSongs();
  }, [loadSongs]);

  useEffect(() => {
    if (dataLoaded) {
      loadAnalytics(timeRange);
    }
  }, [timeRange, dataLoaded, loadAnalytics]);

  const handleRefresh = () => {
    songLogService.clearCache();
    setDataLoaded(false);
    loadSongs();
  };

  const handleExport = async () => {
    const user = authService.getStoredUser();
    const venueName = user?.venueName || user?.email?.split('@')[0] || undefined;
    await songLogService.exportAllToCSV(venueName);
  };

  const handleExportPlaylist = async (format: ExportFormat) => {
    const user = authService.getStoredUser();
    const venueName = user?.venueName || user?.email?.split('@')[0] || undefined;
    await songLogService.exportPlaylist(format, timeRange, venueName);
    setShowExportMenu(false);
  };

  const handleTimeRangeChange = (range: AnalyticsTimeRange) => {
    setTimeRange(range);
  };

  const getTimeRangeLabel = (range: AnalyticsTimeRange) => {
    switch (range) {
      case '7d': return 'Last 7 Days';
      case '14d': return 'Last 14 Days';
      case '30d': return 'Last 30 Days';
      case '90d': return 'Last 90 Days';
      default: return 'Last 30 Days';
    }
  };

  // Empty state component
  const EmptyState = ({ icon: Icon, title, message }: { icon: any; title: string; message: string }) => (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <Icon className="w-12 h-12 text-gray-600 mb-3" />
      <p className="text-gray-400 font-medium">{title}</p>
      <p className="text-sm text-gray-500 mt-1">{message}</p>
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-3xl font-bold gradient-text">Song Analytics</h2>
            <p className="text-sm text-gray-400 mt-1">
              {loading ? 'Loading songs...' : `${totalSongs.toLocaleString()} songs tracked`}
            </p>
          </div>
          
          <div className="flex flex-wrap items-center gap-3">
            {/* Time Range Selector */}
            <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1">
              {(['7d', '14d', '30d', '90d'] as AnalyticsTimeRange[]).map((range) => (
                <button
                  key={range}
                  onClick={() => handleTimeRangeChange(range)}
                  className={`px-3 py-1.5 text-sm rounded-md transition-all ${
                    timeRange === range
                      ? 'bg-cyan/20 text-cyan border border-cyan/30'
                      : 'text-gray-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {range}
                </button>
              ))}
            </div>

            <motion.button
              onClick={handleRefresh}
              disabled={loading || analyticsLoading}
              className="btn-secondary flex items-center gap-2"
              whileHover={{ scale: loading ? 1 : 1.05 }}
              whileTap={{ scale: loading ? 1 : 0.95 }}
            >
              <RefreshCw className={`w-4 h-4 ${(loading || analyticsLoading) ? 'animate-spin' : ''}`} />
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
              Export All
            </motion.button>
          </div>
        </div>

        {/* Analytics Time Range Indicator */}
        <div className="flex items-center gap-2 mb-6 text-sm text-gray-400">
          <Calendar className="w-4 h-4" />
          <span>Showing analytics for: <span className="text-cyan font-medium">{getTimeRangeLabel(timeRange)}</span></span>
          {analyticsLoading && <RefreshCw className="w-3 h-3 animate-spin ml-2" />}
        </div>

        {/* Highest Performing Songs & Top Performers Playlist */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Highest Performing Songs */}
          <motion.div
            className="glass-card p-6"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <Star className="w-6 h-6 text-yellow-400" />
                <h3 className="text-xl font-semibold text-white">Highest Performing Songs</h3>
              </div>
              <div className="flex items-center gap-1 text-xs text-gray-500">
                <Timer className="w-3 h-3" />
                <span>By dwell time</span>
              </div>
            </div>
            <p className="text-xs text-gray-400 mb-4">Songs that keep guests in your venue longer</p>

            <div className="space-y-3 max-h-[400px] overflow-y-auto custom-scrollbar">
              {analyticsLoading && !highestPerforming.length ? (
                <div className="text-center py-8">
                  <RefreshCw className="w-8 h-8 text-yellow-400 animate-spin mx-auto mb-3" />
                  <p className="text-sm text-gray-400">Analyzing song performance...</p>
                </div>
              ) : highestPerforming.length > 0 ? (
                highestPerforming.map((song, index) => (
                  <motion.div
                    key={`${song.song}-${song.artist}`}
                    className="flex items-center gap-3 p-3 rounded-lg bg-gradient-to-r from-yellow-500/10 to-orange-500/10 border border-yellow-500/20 hover:border-yellow-500/40 transition-colors"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 + index * 0.05 }}
                  >
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-yellow-500/20 text-yellow-400 font-bold text-sm">
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
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-yellow-400/70">{song.plays} plays</span>
                        {song.genre && (
                          <>
                            <span className="text-gray-600">•</span>
                            <span className="text-xs text-gray-500">{song.genre}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-yellow-400">{song.performanceScore}</div>
                      <div className="text-xs text-gray-500">score</div>
                      {song.avgDwellExtension > 0 && (
                        <div className="text-xs text-green-400 mt-1">
                          +{song.avgDwellExtension} min
                        </div>
                      )}
                    </div>
                  </motion.div>
                ))
              ) : (
                <EmptyState 
                  icon={Star}
                  title="No performance data yet"
                  message="Play more songs to see which ones keep guests longer"
                />
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
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <ListMusic className="w-6 h-6 text-green-400" />
                <h3 className="text-xl font-semibold text-white">Top Performers Playlist</h3>
              </div>
              
              {/* Export Dropdown */}
              <div className="relative">
                <button
                  onClick={() => setShowExportMenu(!showExportMenu)}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500/30 transition-colors"
                  disabled={topPerformersPlaylist.length === 0}
                >
                  <Download className="w-3 h-3" />
                  Export
                  <ChevronDown className="w-3 h-3" />
                </button>
                
                <AnimatePresence>
                  {showExportMenu && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="absolute right-0 top-full mt-1 bg-gray-800 border border-white/10 rounded-lg shadow-xl z-10 overflow-hidden"
                    >
                      <button
                        onClick={() => handleExportPlaylist('csv')}
                        className="flex items-center gap-2 px-4 py-2 text-sm text-white hover:bg-white/10 w-full"
                      >
                        <FileText className="w-4 h-4 text-green-400" />
                        Export as CSV
                      </button>
                      <button
                        onClick={() => handleExportPlaylist('txt')}
                        className="flex items-center gap-2 px-4 py-2 text-sm text-white hover:bg-white/10 w-full"
                      >
                        <FileText className="w-4 h-4 text-blue-400" />
                        Export as Text
                      </button>
                      <button
                        onClick={() => handleExportPlaylist('json')}
                        className="flex items-center gap-2 px-4 py-2 text-sm text-white hover:bg-white/10 w-full"
                      >
                        <FileJson className="w-4 h-4 text-purple-400" />
                        Export as JSON
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
            <p className="text-xs text-gray-400 mb-4">Your venue's crowd-favorite tracks, ready to export</p>

            <div className="space-y-2 max-h-[400px] overflow-y-auto custom-scrollbar">
              {analyticsLoading && !topPerformersPlaylist.length ? (
                <div className="text-center py-8">
                  <RefreshCw className="w-8 h-8 text-green-400 animate-spin mx-auto mb-3" />
                  <p className="text-sm text-gray-400">Building your playlist...</p>
                </div>
              ) : topPerformersPlaylist.length > 0 ? (
                topPerformersPlaylist.map((song, index) => (
                  <motion.div
                    key={`${song.song}-${song.artist}-${index}`}
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
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs text-gray-500">{song.plays}x</span>
                      <Zap className="w-3 h-3 text-green-400" />
                      <span className="text-xs text-green-400">{song.reason}</span>
                    </div>
                  </motion.div>
                ))
              ) : (
                <EmptyState 
                  icon={ListMusic}
                  title="No playlist data yet"
                  message="Play more songs to generate your playlist"
                />
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
                  Based on {totalSongs.toLocaleString()} songs analyzed over {timeRange}
                </div>
              </motion.div>
            )}
          </motion.div>
        </div>

        {/* Top Genres & Most Played */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          {/* Top Genres - Enhanced */}
          <motion.div
            className="glass-card p-6"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
          >
            <div className="flex items-center gap-3 mb-2">
              <Disc3 className="w-5 h-5 text-purple-400" />
              <h3 className="text-xl font-semibold text-white">Top Genres</h3>
            </div>
            <p className="text-xs text-gray-400 mb-4">Genre breakdown with dwell time impact</p>

            <div className="space-y-3 max-h-[350px] overflow-y-auto custom-scrollbar">
              {analyticsLoading && !genreStats.length ? (
                <div className="text-center py-8">
                  <RefreshCw className="w-6 h-6 text-purple-400 animate-spin mx-auto mb-2" />
                  <p className="text-xs text-gray-400">Analyzing genres...</p>
                </div>
              ) : genreStats.length > 0 && genreStats[0].genre !== 'Other' ? (
                genreStats.map((genre, index) => (
                  <motion.div
                    key={genre.genre}
                    className="p-3 rounded-lg bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/20 hover:border-purple-500/40 transition-colors"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.2 + index * 0.05 }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-purple-400 font-bold">{index + 1}</span>
                        <span className="text-sm font-medium text-white">{genre.genre}</span>
                      </div>
                      <span className="text-purple-400 font-bold">{genre.plays} plays</span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-gray-400">
                      <div className="flex items-center gap-1">
                        <Timer className="w-3 h-3" />
                        <span>~{genre.avgDwellTime} min dwell</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        <span>Avg {genre.avgOccupancy} people</span>
                      </div>
                    </div>
                    {/* Performance bar */}
                    <div className="mt-2 h-1.5 bg-purple-500/20 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-gradient-to-r from-purple-400 to-pink-400 rounded-full transition-all"
                        style={{ width: `${genre.performanceScore}%` }}
                      />
                    </div>
                  </motion.div>
                ))
              ) : (
                <EmptyState 
                  icon={Disc3}
                  title="No genre data yet"
                  message="Genre detection requires more song plays"
                />
              )}
            </div>
          </motion.div>

          {/* Most Played */}
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
              {topSongs.length > 0 ? topSongs.slice(0, 8).map((song, index) => (
                <motion.div
                  key={`${song.song}-${song.artist}`}
                  className="flex items-center justify-between p-3 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.2 + index * 0.05 }}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-cyan font-bold text-lg w-5">{index + 1}</span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-white truncate">{song.song}</div>
                      <div className="text-xs text-gray-400 truncate">{song.artist}</div>
                    </div>
                  </div>
                  <div className="text-cyan font-bold flex-shrink-0">{song.plays}x</div>
                </motion.div>
              )) : (
                <EmptyState 
                  icon={TrendingUp}
                  title="No songs tracked yet"
                  message="Songs will appear as they're detected"
                />
              )}
            </div>
          </motion.div>

          {/* Recent Songs */}
          <motion.div
            className="glass-card p-6"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
          >
            <div className="flex items-center gap-3 mb-4">
              <Clock className="w-5 h-5 text-cyan" />
              <h3 className="text-xl font-semibold text-white">Recent Plays</h3>
            </div>

            <div className="space-y-2 max-h-[350px] overflow-y-auto custom-scrollbar">
              {loading ? (
                <div className="text-center py-12">
                  <RefreshCw className="w-8 h-8 text-cyan animate-spin mx-auto mb-4" />
                  <p className="text-gray-400 text-sm">Loading songs...</p>
                </div>
              ) : songs.length > 0 ? (
                songs.slice(0, 15).map((song, index) => (
                  <motion.div
                    key={song.id}
                    className="flex items-center gap-3 p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 + index * 0.02 }}
                  >
                    {song.albumArt ? (
                      <img
                        src={song.albumArt}
                        alt={song.songName}
                        className="w-10 h-10 rounded-lg object-cover"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-cyan/20 flex items-center justify-center">
                        <Music className="w-5 h-5 text-cyan" />
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-white truncate">{song.songName}</div>
                      <div className="text-xs text-gray-400 truncate">{song.artist}</div>
                    </div>

                    <div className="text-right flex-shrink-0">
                      <div className="text-xs text-gray-400">
                        {format(new Date(song.timestamp), 'MMM d, h:mm a')}
                      </div>
                    </div>
                  </motion.div>
                ))
              ) : (
                <EmptyState 
                  icon={Music}
                  title="No songs played yet"
                  message="Songs will appear as they're detected"
                />
              )}
            </div>
          </motion.div>
        </div>

        {/* Stats Summary */}
        {totalSongs > 0 && (
          <motion.div
            className="glass-card p-6"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <div className="flex items-center gap-3 mb-4">
              <BarChart3 className="w-5 h-5 text-cyan" />
              <h3 className="text-lg font-semibold text-white">Summary Statistics</h3>
            </div>
            
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="p-4 rounded-lg bg-white/5">
                <div className="text-2xl font-bold text-cyan">{totalSongs.toLocaleString()}</div>
                <div className="text-sm text-gray-400">Total Songs Tracked</div>
              </div>
              <div className="p-4 rounded-lg bg-white/5">
                <div className="text-2xl font-bold text-purple-400">{genreStats.length}</div>
                <div className="text-sm text-gray-400">Genres Detected</div>
              </div>
              <div className="p-4 rounded-lg bg-white/5">
                <div className="text-2xl font-bold text-yellow-400">{highestPerforming.length}</div>
                <div className="text-sm text-gray-400">Songs Analyzed</div>
              </div>
              <div className="p-4 rounded-lg bg-white/5">
                <div className="text-2xl font-bold text-green-400">{topPerformersPlaylist.length}</div>
                <div className="text-sm text-gray-400">Playlist Songs</div>
              </div>
            </div>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}

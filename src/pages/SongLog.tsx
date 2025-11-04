import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Music, Download, Clock, TrendingUp } from 'lucide-react';
import { format } from 'date-fns';
import songLogService from '../services/song-log.service';
import authService from '../services/auth.service';
import type { SongLogEntry } from '../types';

export function SongLog() {
  const [songs, setSongs] = useState<SongLogEntry[]>([]);
  const [topSongs, setTopSongs] = useState<Array<{ song: string; artist: string; plays: number }>>([]);

  useEffect(() => {
    loadSongs();
  }, []);

  const loadSongs = () => {
    setSongs(songLogService.getSongs(100));
    setTopSongs(songLogService.getTopSongs(10));
  };

  const handleExport = () => {
    const user = authService.getStoredUser();
    const venueName = user?.venueName || user?.email?.split('@')[0] || undefined;
    songLogService.exportToCSV(venueName);
  };

  return (
    <div className="max-w-7xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-3xl font-bold gradient-text">Song History</h2>
          <motion.button
            onClick={handleExport}
            className="btn-primary flex items-center gap-2"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <Download className="w-4 h-4" />
            Export CSV
          </motion.button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          {/* Top Songs */}
          <motion.div
            className="glass-card p-6"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
          >
            <div className="flex items-center gap-3 mb-4">
              <TrendingUp className="w-5 h-5 text-cyan" />
              <h3 className="text-xl font-semibold text-white">Top 10 Songs</h3>
            </div>

            <div className="space-y-3">
              {topSongs.map((song, index) => (
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
                  <div className="text-cyan font-bold">{song.plays}</div>
                </motion.div>
              ))}
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

              {songs.length === 0 && (
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

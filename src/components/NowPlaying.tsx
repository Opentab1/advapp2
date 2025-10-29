import { motion } from 'framer-motion';
import { Music } from 'lucide-react';

interface NowPlayingProps {
  song?: string;
  albumArt?: string;
}

export function NowPlaying({ song, albumArt }: NowPlayingProps) {
  if (!song) return null;

  return (
    <motion.div
      className="glass-card p-4"
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div className="flex items-center gap-4">
        {/* Album Art */}
        <div className="relative">
          {albumArt ? (
            <motion.img
              src={albumArt}
              alt="Album art"
              className="w-16 h-16 rounded-lg object-cover"
              animate={{
                boxShadow: [
                  '0 0 20px rgba(0, 212, 255, 0.3)',
                  '0 0 30px rgba(0, 212, 255, 0.5)',
                  '0 0 20px rgba(0, 212, 255, 0.3)'
                ]
              }}
              transition={{ duration: 2, repeat: Infinity }}
            />
          ) : (
            <div className="w-16 h-16 rounded-lg bg-white/5 flex items-center justify-center">
              <Music className="w-8 h-8 text-cyan" />
            </div>
          )}
          
          {/* Animated equalizer bars */}
          <div className="absolute -right-2 -bottom-2 flex gap-0.5">
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                className="w-1 bg-cyan rounded-full"
                animate={{
                  height: ['8px', '16px', '8px']
                }}
                transition={{
                  duration: 0.8,
                  repeat: Infinity,
                  delay: i * 0.2
                }}
              />
            ))}
          </div>
        </div>

        {/* Song Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-2 h-2 rounded-full bg-cyan animate-pulse" />
            <span className="text-xs text-gray-400 uppercase tracking-wider font-medium">
              Now Playing
            </span>
          </div>
          <p className="text-sm font-semibold text-white truncate">
            {song}
          </p>
        </div>
      </div>
    </motion.div>
  );
}

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Trophy, Tv } from 'lucide-react';
import sportsService from '../services/sports.service';
import type { SportsGame } from '../types';

export function SportsWidget() {
  const [games, setGames] = useState<SportsGame[]>([]);

  useEffect(() => {
    loadGames();
    const interval = setInterval(loadGames, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, []);

  const loadGames = async () => {
    const liveGames = await sportsService.getGames();
    setGames(liveGames);
  };

  if (games.length === 0) return null;

  return (
    <motion.div
      className="glass-card p-6"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4 }}
    >
      <div className="flex items-center gap-2 mb-4">
        <Trophy className="w-5 h-5 text-cyan" />
        <h3 className="text-xl font-bold gradient-text">Live Sports</h3>
      </div>

      <div className="space-y-3">
        {games.map((game) => (
          <motion.div
            key={game.id}
            className="p-4 rounded-lg bg-white/5 border border-white/10 hover:border-cyan/30 transition-colors"
            whileHover={{ scale: 1.02 }}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-cyan">{game.sport}</span>
              {game.status === 'live' && (
                <span className="flex items-center gap-1 text-xs text-red-400">
                  <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
                  LIVE
                </span>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-white">{game.awayTeam}</span>
                <span className="text-lg font-bold text-white">{game.awayScore}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-white">{game.homeTeam}</span>
                <span className="text-lg font-bold text-white">{game.homeScore}</span>
              </div>
            </div>

            {game.network && (
              <div className="flex items-center gap-1 mt-2 text-xs text-gray-400">
                <Tv className="w-3 h-3" />
                {game.network}
              </div>
            )}
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

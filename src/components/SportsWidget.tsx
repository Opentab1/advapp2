import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trophy, Tv, ChevronDown } from 'lucide-react';
import sportsService from '../services/sports.service';
import type { SportsGame } from '../types';

export function SportsWidget() {
  const [games, setGames] = useState<SportsGame[]>([]);
  const [expanded, setExpanded] = useState(false);

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

  const liveCount = games.filter(g => g.status === 'live').length;
  const scheduledCount = games.filter(g => g.status === 'scheduled').length;

  return (
    <motion.div
      className="glass-card overflow-hidden"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4 }}
    >
      {/* Header - always visible, clickable to expand */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 flex items-center justify-between hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan/10 flex items-center justify-center">
            <Trophy className="w-5 h-5 text-cyan" />
          </div>
          <div className="text-left">
            <h3 className="text-base font-semibold text-white">Sports Today</h3>
            <p className="text-sm text-gray-400">
              {liveCount > 0 && <span className="text-red-400">{liveCount} live</span>}
              {liveCount > 0 && scheduledCount > 0 && ' · '}
              {scheduledCount > 0 && <span>{scheduledCount} scheduled</span>}
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <span className="text-2xl font-bold text-cyan">{games.length}</span>
          <ChevronDown 
            className={`w-5 h-5 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </div>
      </button>

      {/* Expanded game list */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-2 max-h-80 overflow-y-auto">
              {games.map((game) => (
                <div
                  key={game.id}
                  className="p-3 rounded-lg bg-white/5 border border-white/10"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-cyan">{game.sport}</span>
                    {game.status === 'live' ? (
                      <span className="flex items-center gap-1 text-xs text-red-400">
                        <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
                        LIVE
                      </span>
                    ) : (
                      <span className="text-xs text-gray-500">
                        {new Date(game.startTime).toLocaleTimeString('en-US', { 
                          hour: 'numeric', 
                          minute: '2-digit' 
                        })}
                      </span>
                    )}
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-white">{game.awayTeam}</span>
                      <span className="text-base font-bold text-white">{game.awayScore}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-white">{game.homeTeam}</span>
                      <span className="text-base font-bold text-white">{game.homeScore}</span>
                    </div>
                  </div>

                  {game.network && (
                    <div className="flex items-center gap-1 mt-2 text-xs text-gray-500">
                      <Tv className="w-3 h-3" />
                      {game.network}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

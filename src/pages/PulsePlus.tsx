import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  Zap, 
  Trophy, 
  Tv, 
  Clock, 
  Calendar,
  TrendingUp,
  Users,
  Star,
  AlertCircle,
  ChevronRight,
  Flame
} from 'lucide-react';
import sportsService from '../services/sports.service';
import type { SportsGame } from '../types';

// Big games that typically drive traffic
const BIG_GAME_KEYWORDS = [
  'super bowl', 'playoff', 'championship', 'finals', 'world series',
  'stanley cup', 'nba finals', 'conference', 'wild card', 'division'
];

// Rivalry games that drive traffic
const RIVALRY_TEAMS: { [key: string]: string[] } = {
  'NFL': ['Cowboys', 'Eagles', 'Patriots', 'Giants', 'Packers', 'Bears', 'Chiefs', 'Raiders', 'Steelers', 'Ravens', '49ers', 'Seahawks'],
  'NBA': ['Lakers', 'Celtics', 'Bulls', 'Knicks', 'Heat', 'Warriors', 'Nets'],
  'MLB': ['Yankees', 'Red Sox', 'Cubs', 'Cardinals', 'Dodgers', 'Giants'],
  'NHL': ['Bruins', 'Canadiens', 'Rangers', 'Penguins', 'Blackhawks', 'Red Wings'],
};

export function PulsePlus() {
  const [games, setGames] = useState<SportsGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSport, setSelectedSport] = useState<string>('all');

  useEffect(() => {
    loadGames();
    const interval = setInterval(loadGames, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, []);

  const loadGames = async () => {
    try {
      setLoading(true);
      const allGames = await sportsService.getGames();
      setGames(allGames);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Filter games by selected sport
  const filteredGames = selectedSport === 'all' 
    ? games 
    : games.filter(g => g.sport === selectedSport);

  // Separate live, upcoming, and finished games
  const now = new Date();
  const liveGames = filteredGames.filter(g => g.status === 'live');
  const upcomingGames = filteredGames.filter(g => g.status === 'scheduled' && new Date(g.startTime) > now);
  const recentGames = filteredGames.filter(g => g.status === 'final');

  // Get unique sports for filter
  const sports = ['all', ...new Set(games.map(g => g.sport))];

  // Check if a game is a "big game"
  const isBigGame = (game: SportsGame): boolean => {
    const gameName = `${game.homeTeam} ${game.awayTeam}`.toLowerCase();
    if (BIG_GAME_KEYWORDS.some(keyword => gameName.includes(keyword))) return true;
    
    // Check if it's a rivalry game
    const rivalryTeams = RIVALRY_TEAMS[game.sport] || [];
    const teamsInGame = rivalryTeams.filter(team => 
      game.homeTeam.includes(team) || game.awayTeam.includes(team)
    );
    return teamsInGame.length >= 2;
  };

  // Format time for display
  const formatGameTime = (isoTime: string): string => {
    const date = new Date(isoTime);
    const today = new Date();
    const isToday = date.toDateString() === today.toDateString();
    
    if (isToday) {
      return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    }
    return date.toLocaleDateString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
  };

  // Get time until game
  const getTimeUntil = (isoTime: string): string => {
    const gameTime = new Date(isoTime);
    const diff = gameTime.getTime() - now.getTime();
    
    if (diff < 0) return 'Started';
    
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    if (hours > 24) {
      const days = Math.floor(hours / 24);
      return `${days}d`;
    }
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  return (
    <div className="max-w-6xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-lg bg-gradient-to-br from-purple-500/20 to-cyan/20 border border-purple-500/30">
              <Zap className="w-6 h-6 text-purple-400" />
            </div>
            <h2 className="text-3xl font-bold gradient-text">Pulse Plus</h2>
          </div>
          <p className="text-lg text-gray-300 italic">
            "Know exactly why customers come, and what makes them stay"
          </p>
        </div>

        {/* Live Games Alert */}
        {liveGames.length > 0 && (
          <motion.div 
            className="glass-card p-4 mb-6 border-l-4 border-red-500 bg-red-500/5"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
          >
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
                <span className="text-red-400 font-bold">{liveGames.length} LIVE NOW</span>
              </div>
              <span className="text-gray-300">
                {liveGames.map(g => `${g.awayTeam} vs ${g.homeTeam}`).join(' • ')}
              </span>
            </div>
          </motion.div>
        )}

        {/* Sports Today Section */}
        <motion.div
          className="glass-card p-6 mb-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <Trophy className="w-6 h-6 text-yellow-400" />
              <h3 className="text-xl font-bold text-white">Sports Today</h3>
              <span className="text-sm text-gray-400">
                {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
              </span>
            </div>
            
            {/* Sport Filter */}
            <div className="flex gap-2">
              {sports.map(sport => (
                <button
                  key={sport}
                  onClick={() => setSelectedSport(sport)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                    selectedSport === sport
                      ? 'bg-cyan text-black'
                      : 'bg-white/10 text-gray-300 hover:bg-white/20'
                  }`}
                >
                  {sport === 'all' ? 'All' : sport}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan"></div>
            </div>
          ) : error ? (
            <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
              <AlertCircle className="w-5 h-5 text-red-400" />
              <span className="text-red-300">{error}</span>
            </div>
          ) : filteredGames.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <Trophy className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p>No games scheduled for today</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Live Games */}
              {liveGames.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-red-400 mb-3 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
                    LIVE NOW
                  </h4>
                  <div className="grid gap-3 md:grid-cols-2">
                    {liveGames.map(game => (
                      <GameCard key={game.id} game={game} isBig={isBigGame(game)} />
                    ))}
                  </div>
                </div>
              )}

              {/* Upcoming Games */}
              {upcomingGames.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-cyan mb-3 flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    COMING UP
                  </h4>
                  <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                    {upcomingGames.slice(0, 9).map(game => (
                      <GameCard 
                        key={game.id} 
                        game={game} 
                        isBig={isBigGame(game)} 
                        timeUntil={getTimeUntil(game.startTime)}
                        displayTime={formatGameTime(game.startTime)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Recent Results */}
              {recentGames.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    RECENT RESULTS
                  </h4>
                  <div className="grid gap-2 md:grid-cols-3 lg:grid-cols-4">
                    {recentGames.slice(0, 8).map(game => (
                      <GameCardCompact key={game.id} game={game} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </motion.div>

        {/* Traffic Prediction Based on Games */}
        <motion.div
          className="glass-card p-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <div className="flex items-center gap-3 mb-4">
            <TrendingUp className="w-5 h-5 text-green-400" />
            <h3 className="text-lg font-bold text-white">Tonight's Sports Impact</h3>
          </div>

          {liveGames.length > 0 || upcomingGames.filter(g => {
            const hours = (new Date(g.startTime).getTime() - now.getTime()) / (1000 * 60 * 60);
            return hours <= 6;
          }).length > 0 ? (
            <div className="grid gap-4 md:grid-cols-3">
              <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/30">
                <div className="flex items-center gap-2 mb-2">
                  <Users className="w-4 h-4 text-green-400" />
                  <span className="text-sm font-medium text-green-400">Expected Traffic</span>
                </div>
                <div className="text-2xl font-bold text-white">
                  {liveGames.some(g => isBigGame(g)) ? 'Very High' : 
                   liveGames.length > 2 ? 'High' : 
                   liveGames.length > 0 ? 'Above Average' : 'Average'}
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  {liveGames.length} live + {upcomingGames.filter(g => {
                    const hours = (new Date(g.startTime).getTime() - now.getTime()) / (1000 * 60 * 60);
                    return hours <= 6;
                  }).length} upcoming games
                </p>
              </div>

              <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
                <div className="flex items-center gap-2 mb-2">
                  <Star className="w-4 h-4 text-yellow-400" />
                  <span className="text-sm font-medium text-yellow-400">Big Games</span>
                </div>
                <div className="text-2xl font-bold text-white">
                  {[...liveGames, ...upcomingGames].filter(g => isBigGame(g)).length}
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  Playoffs, rivalries, championships
                </p>
              </div>

              <div className="p-4 rounded-lg bg-purple-500/10 border border-purple-500/30">
                <div className="flex items-center gap-2 mb-2">
                  <Tv className="w-4 h-4 text-purple-400" />
                  <span className="text-sm font-medium text-purple-400">Peak Time</span>
                </div>
                <div className="text-2xl font-bold text-white">
                  {upcomingGames.length > 0 
                    ? formatGameTime(upcomingGames[0].startTime)
                    : liveGames.length > 0 ? 'NOW' : 'N/A'}
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  {upcomingGames.length > 0 
                    ? `${upcomingGames[0].awayTeam} vs ${upcomingGames[0].homeTeam}`
                    : 'Next big game starts'}
                </p>
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-lg bg-white/5 border border-white/10 text-center">
              <p className="text-gray-400">No major games tonight - typical traffic expected</p>
            </div>
          )}
        </motion.div>

        {/* Coming Soon Teaser */}
        <motion.div
          className="mt-6 p-4 rounded-lg bg-gradient-to-r from-purple-500/10 to-cyan/10 border border-purple-500/20"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Flame className="w-5 h-5 text-orange-400" />
              <span className="text-gray-300">
                <strong className="text-white">Coming Soon:</strong> Google Reviews, Local Events, Holiday Calendar, Trending Music
              </span>
            </div>
            <ChevronRight className="w-5 h-5 text-gray-500" />
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}

// Game Card Component
function GameCard({ game, isBig, timeUntil, displayTime }: { 
  game: SportsGame; 
  isBig: boolean;
  timeUntil?: string;
  displayTime?: string;
}) {
  return (
    <motion.div
      className={`p-4 rounded-lg border transition-all ${
        isBig 
          ? 'bg-gradient-to-br from-yellow-500/10 to-orange-500/10 border-yellow-500/30' 
          : 'bg-white/5 border-white/10 hover:border-cyan/30'
      }`}
      whileHover={{ scale: 1.02 }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-bold px-2 py-0.5 rounded ${
            game.sport === 'NFL' ? 'bg-green-500/20 text-green-400' :
            game.sport === 'NBA' ? 'bg-orange-500/20 text-orange-400' :
            game.sport === 'MLB' ? 'bg-red-500/20 text-red-400' :
            game.sport === 'NHL' ? 'bg-blue-500/20 text-blue-400' :
            'bg-purple-500/20 text-purple-400'
          }`}>
            {game.sport}
          </span>
          {isBig && (
            <span className="flex items-center gap-1 text-xs text-yellow-400">
              <Star className="w-3 h-3 fill-yellow-400" />
              BIG GAME
            </span>
          )}
        </div>
        {game.status === 'live' ? (
          <span className="flex items-center gap-1 text-xs text-red-400 font-bold">
            <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
            LIVE
          </span>
        ) : timeUntil ? (
          <span className="text-xs text-cyan">{timeUntil}</span>
        ) : null}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm text-white font-medium">{game.awayTeam}</span>
          <span className="text-lg font-bold text-white">{game.awayScore || '-'}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-white font-medium">{game.homeTeam}</span>
          <span className="text-lg font-bold text-white">{game.homeScore || '-'}</span>
        </div>
      </div>

      {(displayTime || game.network) && (
        <div className="flex items-center justify-between mt-3 pt-2 border-t border-white/10">
          {displayTime && (
            <span className="text-xs text-gray-400 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {displayTime}
            </span>
          )}
          {game.network && (
            <span className="text-xs text-gray-400 flex items-center gap-1">
              <Tv className="w-3 h-3" />
              {game.network}
            </span>
          )}
        </div>
      )}
    </motion.div>
  );
}

// Compact Game Card for Recent Results
function GameCardCompact({ game }: { game: SportsGame }) {
  return (
    <div className="p-3 rounded-lg bg-white/5 border border-white/10">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-bold text-gray-500">{game.sport}</span>
        <span className="text-[10px] text-gray-500">FINAL</span>
      </div>
      <div className="text-xs">
        <div className="flex justify-between">
          <span className="text-gray-300 truncate">{game.awayTeam}</span>
          <span className={`font-bold ${game.awayScore > game.homeScore ? 'text-green-400' : 'text-white'}`}>
            {game.awayScore}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-300 truncate">{game.homeTeam}</span>
          <span className={`font-bold ${game.homeScore > game.awayScore ? 'text-green-400' : 'text-white'}`}>
            {game.homeScore}
          </span>
        </div>
      </div>
    </div>
  );
}

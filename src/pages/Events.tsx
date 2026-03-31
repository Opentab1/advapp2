import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles,
  Music,
  Calendar,
  Flame,
  ChevronRight,
  Star,
  Clock,
  RefreshCw,
  BarChart3,
  Tv,
} from 'lucide-react';
import { eventsService, EventSuggestion, VenueVibe } from '../services/events.service';
import { EventROITracker } from '../components/events/EventROITracker';
import authService from '../services/auth.service';
import sportsService from '../services/sports.service';
import type { SportsGame } from '../types';

type EventsTab = 'suggestions' | 'performance';

// ============ COMPONENTS ============

interface VibeProfileCardProps {
  vibe: VenueVibe;
}

function VibeProfileCard({ vibe }: VibeProfileCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-warm-800/60 rounded-2xl p-6 border border-teal/20"
    >
      <div className="flex items-center gap-3 mb-4">
        <div className="w-12 h-12 rounded-full bg-teal/10 flex items-center justify-center">
          <Music className="w-6 h-6 text-teal" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white">Your Vibe: {vibe.vibeName}</h2>
          <p className="text-sm text-warm-400">{vibe.vibeDescription}</p>
        </div>
      </div>

      {/* Genre breakdown */}
      <div className="space-y-3 mb-4">
        <div className="flex items-center gap-3">
          <span className="text-sm text-warm-400 w-20">{vibe.primary.genre}</span>
          <div className="flex-1 h-3 bg-warm-700 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${vibe.primary.percentage}%` }}
              transition={{ duration: 1, ease: 'easeOut' }}
              className="h-full bg-gradient-to-r from-teal to-teal-dark"
            />
          </div>
          <span className="text-sm font-medium text-white w-12 text-right">{vibe.primary.percentage}%</span>
        </div>

        {vibe.secondary && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-warm-400 w-20">{vibe.secondary.genre}</span>
            <div className="flex-1 h-3 bg-warm-700 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${vibe.secondary.percentage}%` }}
                transition={{ duration: 1, delay: 0.2, ease: 'easeOut' }}
                className="h-full bg-gradient-to-r from-strain to-strain-light"
              />
            </div>
            <span className="text-sm font-medium text-white w-12 text-right">{vibe.secondary.percentage}%</span>
          </div>
        )}

        {vibe.tertiary && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-warm-400 w-20">{vibe.tertiary.genre}</span>
            <div className="flex-1 h-3 bg-warm-700 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${vibe.tertiary.percentage}%` }}
                transition={{ duration: 1, delay: 0.4, ease: 'easeOut' }}
                className="h-full bg-gradient-to-r from-amber-500 to-orange-500"
              />
            </div>
            <span className="text-sm font-medium text-white w-12 text-right">{vibe.tertiary.percentage}%</span>
          </div>
        )}
      </div>

      {/* Top artists */}
      {vibe.topArtists.length > 0 && (
        <div className="pt-4 border-t border-warm-700/50">
          <p className="text-xs text-warm-500 mb-2">TOP ARTISTS</p>
          <div className="flex flex-wrap gap-2">
            {vibe.topArtists.map((artist, i) => (
              <span key={i} className="px-3 py-1 bg-warm-700/60 rounded-full text-xs text-warm-200">
                {artist}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 pt-4 border-t border-warm-700/50 flex items-center justify-between">
        <span className="text-xs text-warm-500">
          Based on {vibe.songsAnalyzed.toLocaleString()} song plays
        </span>
      </div>
    </motion.div>
  );
}

interface EventCardProps {
  event: EventSuggestion;
  index: number;
}

function EventCard({ event, index }: EventCardProps) {
  const [expanded, setExpanded] = useState(false);
  
  const difficultyColors = {
    Easy: 'text-green-400 bg-green-500/10 border-green-500/30',
    Medium: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
    Hard: 'text-red-400 bg-red-500/10 border-red-500/30',
  };
  
  const categoryLabels = {
    theme_night: { label: 'Theme Night', icon: Sparkles },
    special_event: { label: 'Special Event', icon: Star },
    recurring: { label: 'Recurring', icon: RefreshCw },
    promotion: { label: 'Promotion', icon: Flame },
  };
  
  const catInfo = categoryLabels[event.category];
  const CatIcon = catInfo.icon;
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1 }}
      className="bg-warm-800/60 rounded-xl border border-warm-700 hover:border-teal/40 transition-all duration-300 overflow-hidden"
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-5 text-left"
      >
        <div className="flex items-start gap-4">
          {/* Emoji */}
          <div className="w-14 h-14 rounded-xl bg-warm-700/60 flex items-center justify-center text-3xl flex-shrink-0">
            {event.emoji}
          </div>
          
          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-lg font-semibold text-white truncate">{event.name}</h3>
              <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`} />
            </div>
            
            <p className="text-sm text-warm-400 line-clamp-1">{event.description}</p>
            
            <div className="flex items-center gap-3 mt-3">
              <span className={`px-2 py-1 rounded-full text-xs border ${difficultyColors[event.difficulty]}`}>
                {event.difficulty}
              </span>
              <span className="flex items-center gap-1 text-xs text-warm-500">
                <CatIcon className="w-3 h-3" />
                {catInfo.label}
              </span>
              <span className="flex items-center gap-1 text-xs text-warm-500">
                <Calendar className="w-3 h-3" />
                Best: {event.bestNight}
              </span>
            </div>
          </div>
        </div>
      </button>
      
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="border-t border-warm-700"
          >
            <div className="p-5 pt-4 space-y-4">
              <div>
                <p className="text-xs text-teal font-medium mb-1">WHY IT FITS YOUR VENUE</p>
                <p className="text-sm text-warm-300">{event.whyItFits}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="bg-warm-800/50 rounded-lg p-3">
                  <p className="text-xs text-warm-500 mb-1">Best Night</p>
                  <p className="text-sm font-medium text-white flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-teal" />
                    {event.bestNight}
                  </p>
                </div>
                <div className="bg-warm-800/50 rounded-lg p-3">
                  <p className="text-xs text-warm-500 mb-1">Effort Level</p>
                  <p className="text-sm font-medium text-white flex items-center gap-2">
                    <Clock className="w-4 h-4 text-teal" />
                    {event.difficulty} Setup
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

interface QuickWinCardProps {
  event: EventSuggestion;
}

function QuickWinCard({ event }: QuickWinCardProps) {
  return (
    <div className="bg-gradient-to-br from-green-900/30 to-emerald-900/20 rounded-xl p-4 border border-green-500/20">
      <div className="flex items-center gap-3">
        <span className="text-2xl">{event.emoji}</span>
        <div>
          <h4 className="font-medium text-white text-sm">{event.name}</h4>
          <p className="text-xs text-gray-400">{event.bestNight}</p>
        </div>
      </div>
    </div>
  );
}

// ============ MAIN PAGE ============

export default function Events() {
  const user = authService.getStoredUser();
  const venueId = user?.venueId || 'theshowcaselounge';
  
  const [activeTab, setActiveTab] = useState<EventsTab>('suggestions');
  const [vibe, setVibe] = useState<VenueVibe | null>(null);
  const [suggestions, setSuggestions] = useState<EventSuggestion[]>([]);
  const [quickWins, setQuickWins] = useState<EventSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'theme_night' | 'special_event' | 'recurring'>('all');
  const [weekGames, setWeekGames] = useState<SportsGame[]>([]);
  
  // Fetch vibe and suggestions on mount
  useEffect(() => {
    async function loadData() {
      setIsLoading(true);
      try {
        console.log('🎵 Events: Loading vibe data for', venueId);
        const [vibeData, suggestionsData, quickWinsData] = await Promise.all([
          eventsService.getVenueVibe(venueId),
          eventsService.getEventSuggestions(venueId, 8),
          eventsService.getQuickWins(venueId),
        ]);
        setVibe(vibeData);
        setSuggestions(suggestionsData);
        setQuickWins(quickWinsData);
        console.log('🎵 Events: Loaded', vibeData.songsAnalyzed, 'songs analyzed');
      } catch (error) {
        console.error('❌ Events: Error loading data:', error);
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, [venueId]);
  
  useEffect(() => {
    sportsService.getGames().then(games => {
      const now = Date.now();
      const week = now + 7 * 24 * 60 * 60 * 1000;
      setWeekGames(
        games.filter(g => {
          const t = new Date(g.startTime).getTime();
          return t >= now - 3600000 && t <= week;
        }).slice(0, 5)
      );
    }).catch(() => {});
  }, []);

  const filteredSuggestions = filter === 'all'
    ? suggestions
    : suggestions.filter(e => e.category === filter);
  
  return (
    <div className="pb-20 space-y-0">
      {/* Header */}
      <div className="pb-4">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="w-5 h-5 text-teal" />
          <h1 className="text-2xl font-bold text-white">Events</h1>
          <span className="px-2 py-0.5 bg-teal/10 border border-teal/30 rounded-full text-[10px] font-semibold text-teal uppercase tracking-wide">
            Beta
          </span>
        </div>
        <p className="text-sm text-warm-400">Event ideas and performance tracking</p>
      </div>

      {/* Tab Navigation */}
      <div className="mb-4">
        <div className="flex gap-2">
          {[
            { id: 'suggestions' as const, label: 'Ideas', icon: Sparkles },
            { id: 'performance' as const, label: 'Past Events', icon: BarChart3 },
          ].map((tab) => (
            <motion.button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${
                activeTab === tab.id
                  ? 'bg-teal/10 border border-teal/50 text-white'
                  : 'bg-warm-800 border border-warm-700 text-warm-400 hover:text-white'
              }`}
              whileTap={{ scale: 0.95 }}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </motion.button>
          ))}
        </div>
      </div>

      {activeTab === 'performance' ? (
        <div>
          <EventROITracker />
        </div>
      ) : (
        <>
        {/* Suggestions Tab Content */}

      {/* This Week's Opportunities */}
      {weekGames.length > 0 && (
        <div className="mb-6 bg-whoop-panel border border-whoop-divider rounded-2xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-whoop-divider">
            <Tv className="w-4 h-4 text-teal" />
            <span className="text-sm font-semibold text-white">This Week's Opportunities</span>
            <span className="text-[10px] text-warm-500 ml-auto">Game nights drive traffic</span>
          </div>
          <div className="divide-y divide-whoop-divider">
            {weekGames.map(game => {
              const gameDate = new Date(game.startTime);
              const isToday = gameDate.toDateString() === new Date().toDateString();
              const isLive = game.status === 'live';
              return (
                <div key={game.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-white truncate">
                      {game.homeTeam} vs {game.awayTeam}
                    </div>
                    <div className="text-[10px] text-warm-500">
                      {game.sport} · {isToday ? 'Today' : gameDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                      {' · '}{gameDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    </div>
                  </div>
                  {isLive ? (
                    <span className="flex items-center gap-1 text-[10px] font-semibold text-red-400 bg-red-500/10 border border-red-500/20 rounded-full px-2 py-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                      LIVE
                    </span>
                  ) : (
                    <span className="text-[10px] text-warm-400 bg-warm-800 rounded px-2 py-0.5">
                      {isToday ? 'Tonight' : gameDate.toLocaleDateString('en-US', { weekday: 'short' })}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="px-4 py-3 bg-teal/5 border-t border-whoop-divider">
            <p className="text-[11px] text-warm-400">
              💡 Tip: Game nights typically drive 20–40% higher bar traffic. Consider extended hours or extra staff for these dates.
            </p>
          </div>
        </div>
      )}

      {/* Vibe Profile */}
      <div className="mb-6">
        {isLoading ? (
          <div className="bg-warm-800/60 rounded-2xl p-6 border border-warm-600 animate-pulse">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-teal/10"></div>
              <div className="flex-1">
                <div className="h-6 bg-warm-700/50 rounded w-48 mb-2"></div>
                <div className="h-4 bg-warm-700/30 rounded w-64"></div>
              </div>
            </div>
            <div className="space-y-3">
              <div className="h-3 bg-warm-700/30 rounded w-full"></div>
              <div className="h-3 bg-warm-700/30 rounded w-3/4"></div>
            </div>
            <p className="text-center text-sm text-teal mt-4">Analyzing your music...</p>
          </div>
        ) : vibe ? (
          <VibeProfileCard vibe={vibe} />
        ) : null}
      </div>

      {/* Quick Wins */}
      {quickWins.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Flame className="w-4 h-4 text-green-400" />
            <h3 className="text-sm font-medium text-white">Quick Wins</h3>
            <span className="text-xs text-warm-500">Low effort, high reward</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {quickWins.map((event) => (
              <QuickWinCard key={event.id} event={event} />
            ))}
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="mb-4">
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
          {[
            { key: 'all', label: 'All Ideas' },
            { key: 'theme_night', label: 'Theme Nights' },
            { key: 'recurring', label: 'Recurring' },
            { key: 'special_event', label: 'Special Events' },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key as typeof filter)}
              className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
                filter === key
                  ? 'bg-primary text-warm-900'
                  : 'bg-warm-800 text-warm-400 hover:bg-warm-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Event Suggestions */}
      <div className="space-y-3">
        <AnimatePresence mode="popLayout">
          {filteredSuggestions.map((event, index) => (
            <EventCard key={event.id} event={event} index={index} />
          ))}
        </AnimatePresence>

        {filteredSuggestions.length === 0 && (
          <div className="text-center py-12">
            <p className="text-warm-500">No events in this category</p>
          </div>
        )}
      </div>

      {/* Footer note */}
      <div className="mt-8 text-center space-y-2">
        <p className="text-xs text-warm-500">
          Suggestions refresh each session based on your venue's music data
        </p>
        <p className="text-xs text-warm-400">
          This feature is in beta — we're still refining the recommendations
        </p>
      </div>
        </>
      )}
    </div>
  );
}

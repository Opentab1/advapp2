import { useState, useMemo } from 'react';
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
} from 'lucide-react';
import { eventsService, EventSuggestion, VenueVibe } from '../services/events.service';
import authService from '../services/auth.service';

// ============ COMPONENTS ============

interface VibeProfileCardProps {
  vibe: VenueVibe;
}

function VibeProfileCard({ vibe }: VibeProfileCardProps) {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-gradient-to-br from-purple-900/40 to-indigo-900/30 rounded-2xl p-6 border border-purple-500/20"
    >
      <div className="flex items-center gap-3 mb-4">
        <div className="w-12 h-12 rounded-full bg-purple-500/20 flex items-center justify-center">
          <Music className="w-6 h-6 text-purple-400" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white">Your Vibe: {vibe.vibeName}</h2>
          <p className="text-sm text-gray-400">{vibe.vibeDescription}</p>
        </div>
      </div>
      
      {/* Genre breakdown */}
      <div className="space-y-3 mb-4">
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-400 w-20">{vibe.primary.genre}</span>
          <div className="flex-1 h-3 bg-gray-800 rounded-full overflow-hidden">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${vibe.primary.percentage}%` }}
              transition={{ duration: 1, ease: 'easeOut' }}
              className="h-full bg-gradient-to-r from-purple-500 to-pink-500"
            />
          </div>
          <span className="text-sm font-medium text-white w-12 text-right">{vibe.primary.percentage}%</span>
        </div>
        
        {vibe.secondary && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-400 w-20">{vibe.secondary.genre}</span>
            <div className="flex-1 h-3 bg-gray-800 rounded-full overflow-hidden">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: `${vibe.secondary.percentage}%` }}
                transition={{ duration: 1, delay: 0.2, ease: 'easeOut' }}
                className="h-full bg-gradient-to-r from-blue-500 to-cyan-500"
              />
            </div>
            <span className="text-sm font-medium text-white w-12 text-right">{vibe.secondary.percentage}%</span>
          </div>
        )}
        
        {vibe.tertiary && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-400 w-20">{vibe.tertiary.genre}</span>
            <div className="flex-1 h-3 bg-gray-800 rounded-full overflow-hidden">
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
        <div className="pt-4 border-t border-gray-700/50">
          <p className="text-xs text-gray-500 mb-2">TOP ARTISTS</p>
          <div className="flex flex-wrap gap-2">
            {vibe.topArtists.map((artist, i) => (
              <span key={i} className="px-3 py-1 bg-gray-800/60 rounded-full text-xs text-gray-300">
                {artist}
              </span>
            ))}
          </div>
        </div>
      )}
      
      <div className="mt-4 pt-4 border-t border-gray-700/50 flex items-center justify-between">
        <span className="text-xs text-gray-500">
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
      className="bg-gray-900/60 rounded-xl border border-gray-800 hover:border-purple-500/40 transition-all duration-300 overflow-hidden"
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-5 text-left"
      >
        <div className="flex items-start gap-4">
          {/* Emoji */}
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center text-3xl flex-shrink-0">
            {event.emoji}
          </div>
          
          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-lg font-semibold text-white truncate">{event.name}</h3>
              <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`} />
            </div>
            
            <p className="text-sm text-gray-400 line-clamp-1">{event.description}</p>
            
            <div className="flex items-center gap-3 mt-3">
              <span className={`px-2 py-1 rounded-full text-xs border ${difficultyColors[event.difficulty]}`}>
                {event.difficulty}
              </span>
              <span className="flex items-center gap-1 text-xs text-gray-500">
                <CatIcon className="w-3 h-3" />
                {catInfo.label}
              </span>
              <span className="flex items-center gap-1 text-xs text-gray-500">
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
            className="border-t border-gray-800"
          >
            <div className="p-5 pt-4 space-y-4">
              <div>
                <p className="text-xs text-purple-400 font-medium mb-1">WHY IT FITS YOUR VENUE</p>
                <p className="text-sm text-gray-300">{event.whyItFits}</p>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-800/50 rounded-lg p-3">
                  <p className="text-xs text-gray-500 mb-1">Best Night</p>
                  <p className="text-sm font-medium text-white flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-purple-400" />
                    {event.bestNight}
                  </p>
                </div>
                <div className="bg-gray-800/50 rounded-lg p-3">
                  <p className="text-xs text-gray-500 mb-1">Effort Level</p>
                  <p className="text-sm font-medium text-white flex items-center gap-2">
                    <Clock className="w-4 h-4 text-purple-400" />
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
  
  const vibe = useMemo(() => eventsService.getVenueVibe(venueId), [venueId]);
  const suggestions = useMemo(() => eventsService.getEventSuggestions(venueId, 8), [venueId]);
  const quickWins = useMemo(() => eventsService.getQuickWins(venueId), [venueId]);
  
  const [filter, setFilter] = useState<'all' | 'theme_night' | 'special_event' | 'recurring'>('all');
  
  const filteredSuggestions = filter === 'all' 
    ? suggestions 
    : suggestions.filter(e => e.category === filter);
  
  return (
    <div className="min-h-screen bg-gray-950 pb-24">
      {/* Header */}
      <div className="px-5 pt-6 pb-4">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="w-5 h-5 text-purple-400" />
          <h1 className="text-2xl font-bold text-white">Events</h1>
          <span className="px-2 py-0.5 bg-purple-500/20 border border-purple-500/40 rounded-full text-[10px] font-semibold text-purple-300 uppercase tracking-wide">
            Beta
          </span>
        </div>
        <p className="text-sm text-gray-400">Event ideas tailored to your venue's vibe</p>
      </div>
      
      {/* Vibe Profile */}
      <div className="px-5 mb-6">
        <VibeProfileCard vibe={vibe} />
      </div>
      
      {/* Quick Wins */}
      {quickWins.length > 0 && (
        <div className="px-5 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Flame className="w-4 h-4 text-green-400" />
            <h3 className="text-sm font-medium text-white">Quick Wins</h3>
            <span className="text-xs text-gray-500">Low effort, high reward</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {quickWins.map((event, i) => (
              <QuickWinCard key={event.id} event={event} />
            ))}
          </div>
        </div>
      )}
      
      {/* Filter tabs */}
      <div className="px-5 mb-4">
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
                  ? 'bg-purple-500 text-white' 
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      
      {/* Event Suggestions */}
      <div className="px-5 space-y-3">
        <AnimatePresence mode="popLayout">
          {filteredSuggestions.map((event, index) => (
            <EventCard key={event.id} event={event} index={index} />
          ))}
        </AnimatePresence>
        
        {filteredSuggestions.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-500">No events in this category</p>
          </div>
        )}
      </div>
      
      {/* Footer note */}
      <div className="px-5 mt-8 text-center space-y-2">
        <p className="text-xs text-gray-600">
          Suggestions refresh each session based on your venue's music data
        </p>
        <p className="text-xs text-purple-400/70">
          🚧 This feature is in beta — we're still refining the recommendations
        </p>
      </div>
    </div>
  );
}

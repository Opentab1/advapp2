import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Calendar,
  ChevronRight,
  BarChart3,
  Tv,
  Sparkles,
} from 'lucide-react';
import { generateCalendarEvents, type CalendarEventIdea } from '../services/events.service';
import { EventROITracker } from '../components/events/EventROITracker';
import authService from '../services/auth.service';
import sportsService from '../services/sports.service';
import venueSettingsService from '../services/venue-settings.service';
import type { SportsGame } from '../types';

type EventsTab = 'suggestions' | 'performance';

// ============ LOCAL TEAM DETECTION ============

const CITY_TEAM_KEYWORDS: Record<string, string[]> = {
  'Tampa': ['Tampa Bay', 'Buccaneers', 'Lightning', 'Rays'],
  'Baltimore': ['Baltimore', 'Ravens', 'Orioles'],
  'New York': ['New York', 'Yankees', 'Mets', 'Giants', 'Jets', 'Knicks', 'Nets', 'Rangers'],
  'Los Angeles': ['Los Angeles', 'Lakers', 'Clippers', 'Dodgers', 'Angels', 'Rams', 'Chargers', 'Kings'],
  'Chicago': ['Chicago', 'Bears', 'Bulls', 'Cubs', 'White Sox', 'Blackhawks', 'Fire'],
  'Houston': ['Houston', 'Texans', 'Rockets', 'Astros', 'Dynamo'],
  'Dallas': ['Dallas', 'Cowboys', 'Mavericks', 'Stars', 'Rangers', 'FC Dallas'],
  'Miami': ['Miami', 'Dolphins', 'Heat', 'Marlins', 'Inter Miami'],
  'Philadelphia': ['Philadelphia', 'Eagles', '76ers', 'Phillies', 'Flyers', 'Union'],
  'Boston': ['Boston', 'Patriots', 'Celtics', 'Red Sox', 'Bruins'],
  'Atlanta': ['Atlanta', 'Falcons', 'Hawks', 'Braves', 'United'],
  'Seattle': ['Seattle', 'Seahawks', 'Sounders', 'Mariners', 'Kraken'],
  'Denver': ['Denver', 'Broncos', 'Nuggets', 'Rockies', 'Avalanche'],
  'Phoenix': ['Phoenix', 'Cardinals', 'Suns', 'Mercury', 'Coyotes', 'Diamondbacks'],
  'Minneapolis': ['Minnesota', 'Vikings', 'Timberwolves', 'Twins', 'Wild', 'Lynx'],
  'Detroit': ['Detroit', 'Lions', 'Pistons', 'Tigers', 'Red Wings'],
  'Cleveland': ['Cleveland', 'Browns', 'Cavaliers', 'Guardians'],
  'New Orleans': ['New Orleans', 'Saints', 'Pelicans'],
  'Las Vegas': ['Las Vegas', 'Raiders', 'Golden Knights', 'Aces'],
  'Nashville': ['Nashville', 'Titans', 'Predators', 'SC Nashville'],
  'Charlotte': ['Charlotte', 'Panthers', 'Hornets', 'FC Charlotte'],
  'Indianapolis': ['Indianapolis', 'Colts', 'Pacers'],
  'Portland': ['Portland', 'Trail Blazers', 'Timbers', 'Thorns'],
  'Sacramento': ['Sacramento', 'Kings', 'Republic'],
  'San Francisco': ['San Francisco', '49ers', 'Warriors', 'Giants', "A's", 'Earthquakes'],
  'Pittsburgh': ['Pittsburgh', 'Steelers', 'Pirates', 'Penguins'],
  'Kansas City': ['Kansas City', 'Chiefs', 'Royals', 'Sporting'],
  'Cincinnati': ['Cincinnati', 'Bengals', 'Reds', 'FC Cincinnati'],
  'Buffalo': ['Buffalo', 'Bills', 'Sabres'],
  'Green Bay': ['Green Bay', 'Packers'],
  'Salt Lake City': ['Utah', 'Jazz', 'Real Salt Lake'],
  'Orlando': ['Orlando', 'Magic', 'City SC'],
  'Jacksonville': ['Jacksonville', 'Jaguars'],
  'San Antonio': ['San Antonio', 'Spurs'],
  'Oklahoma City': ['Oklahoma City', 'Thunder'],
  'Memphis': ['Memphis', 'Grizzlies'],
  'San Diego': ['San Diego', 'Padres'],
  'St. Louis': ['St. Louis', 'Blues', 'City SC'],
  'Columbus': ['Columbus', 'Blue Jackets', 'Crew'],
};

function isLocalTeamGame(game: SportsGame, city: string): boolean {
  if (!city) return false;
  const keywords = CITY_TEAM_KEYWORDS[city] || [city];
  const gameStr = `${game.homeTeam} ${game.awayTeam}`.toLowerCase();
  return keywords.some(k => gameStr.includes(k.toLowerCase()));
}

// ============ CALENDAR EVENT CARD ============

function CalendarEventCard({ event, index }: { event: CalendarEventIdea; index: number }) {
  const [expanded, setExpanded] = useState(false);

  const urgencyColor =
    event.daysUntil <= 7 ? 'text-red-400' :
    event.daysUntil <= 21 ? 'text-amber-400' : 'text-warm-500';

  const urgencyLabel =
    event.daysUntil === 0 ? 'Today!' :
    event.daysUntil === 1 ? 'Tomorrow' :
    event.daysUntil <= 7 ? `${event.daysUntil}d away` :
    event.daysUntil <= 30 ? `${Math.round(event.daysUntil / 7)}w away` :
    `${Math.round(event.daysUntil / 30)}mo away`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="bg-warm-800/60 rounded-xl border border-warm-700 hover:border-teal/40 transition-all overflow-hidden"
    >
      <button onClick={() => setExpanded(!expanded)} className="w-full p-4 text-left">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-xl bg-warm-700/60 flex items-center justify-center text-2xl flex-shrink-0">
            {event.emoji}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-base font-semibold text-white">{event.name}</h3>
              <span className={`text-[10px] font-semibold flex-shrink-0 ${urgencyColor}`}>{urgencyLabel}</span>
            </div>
            <p className="text-xs text-warm-400 mt-0.5 line-clamp-1">{event.description}</p>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className={`px-2 py-0.5 rounded-full text-[10px] border font-medium ${
                event.difficulty === 'Easy' ? 'text-green-400 bg-green-500/10 border-green-500/30' :
                event.difficulty === 'Medium' ? 'text-amber-400 bg-amber-500/10 border-amber-500/30' :
                'text-red-400 bg-red-500/10 border-red-500/30'
              }`}>{event.difficulty}</span>
              <span className="text-[10px] text-warm-500 flex items-center gap-1">
                <Calendar className="w-3 h-3" />{event.dateLabel}
              </span>
              <span className="text-[10px] text-warm-500 capitalize">{event.category}</span>
            </div>
          </div>
          <ChevronRight className={`w-4 h-4 text-warm-600 flex-shrink-0 mt-1 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-warm-700"
          >
            <div className="p-4 space-y-3">
              <div>
                <p className="text-[10px] text-teal font-semibold uppercase tracking-wider mb-1">HOW TO RUN IT</p>
                <p className="text-sm text-warm-300">{event.howTo}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-warm-800/50 rounded-lg p-3">
                  <p className="text-[10px] text-warm-500 mb-1">Expected Impact</p>
                  <p className="text-xs font-medium text-white">{event.expectedImpact}</p>
                </div>
                <div className="bg-warm-800/50 rounded-lg p-3">
                  <p className="text-[10px] text-warm-500 mb-1">Promote By</p>
                  <p className="text-xs font-medium text-white">
                    {event.leadTimeDays} days before
                    {event.daysUntil > event.leadTimeDays
                      ? ` — you have time`
                      : event.daysUntil > 0
                        ? ` — promote now!`
                        : ''}
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

// ============ SPORTS GAMES FALLBACK (for "This Week" when no calendar events) ============

interface SportsWeekFallbackProps {
  weekGames: SportsGame[];
  venueCity: string;
}

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function SportsWeekFallback({ weekGames, venueCity }: SportsWeekFallbackProps) {
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  const gamesByDate: Record<string, SportsGame[]> = {};
  weekGames.forEach(game => {
    const key = new Date(game.startTime).toISOString().slice(0, 10);
    if (!gamesByDate[key]) gamesByDate[key] = [];
    gamesByDate[key].push(game);
  });

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return d;
  });

  return (
    <div className="mb-6 bg-whoop-panel border border-whoop-divider rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-whoop-divider">
        <Tv className="w-4 h-4 text-teal" />
        <span className="text-sm font-semibold text-white">Sports This Week</span>
        <span className="text-[10px] text-warm-500 ml-auto">Game nights drive traffic</span>
      </div>

      <div className="divide-y divide-whoop-divider">
        {weekDays.map((date, i) => {
          const dateKey = date.toISOString().slice(0, 10);
          const dow = date.getDay();
          const dayGames = gamesByDate[dateKey] || [];
          const localGames = dayGames.filter(g => isLocalTeamGame(g, venueCity));
          const hasContent = dayGames.length > 0;
          const isExpanded = expandedDay === dateKey;
          const dayLabel = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : DOW_LABELS[dow];
          const dateLabel = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

          return (
            <div key={dateKey}>
              <button
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-warm-800/30 transition-colors text-left"
                onClick={() => hasContent ? setExpandedDay(isExpanded ? null : dateKey) : undefined}
              >
                <div className="w-16 flex-shrink-0">
                  <p className={`text-xs font-semibold ${i === 0 ? 'text-teal' : 'text-warm-300'}`}>{dayLabel}</p>
                  <p className="text-[10px] text-warm-600">{dateLabel}</p>
                </div>
                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                  {dayGames.length > 0 && (
                    <span className="flex items-center gap-1 text-[10px] text-warm-400 bg-warm-800 rounded px-1.5 py-0.5">
                      <Tv className="w-2.5 h-2.5" />
                      {dayGames.length} game{dayGames.length !== 1 ? 's' : ''}
                    </span>
                  )}
                  {localGames.length > 0 && (
                    <span className="text-[9px] font-bold text-teal bg-teal/10 border border-teal/30 rounded px-1.5 py-0.5">LOCAL</span>
                  )}
                  {!hasContent && (
                    <span className="text-[10px] text-warm-700">No games</span>
                  )}
                </div>
                {hasContent && (
                  <ChevronRight className={`w-3.5 h-3.5 text-warm-600 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                )}
              </button>

              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="overflow-hidden border-t border-whoop-divider bg-warm-900/40"
                  >
                    <div className="px-4 py-3 space-y-2">
                      {dayGames.map(game => {
                        const isLocal = isLocalTeamGame(game, venueCity);
                        const isLive = game.status === 'live';
                        const gameTime = new Date(game.startTime);
                        return (
                          <div key={game.id} className={`flex items-center gap-3 rounded-lg p-2 ${isLocal ? 'bg-teal/5 border border-teal/15' : 'bg-warm-800/40'}`}>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <p className="text-xs font-medium text-white truncate">
                                  {game.homeTeam} vs {game.awayTeam}
                                </p>
                                {isLocal && (
                                  <span className="text-[9px] font-bold text-teal bg-teal/10 border border-teal/30 rounded px-1 py-0.5 flex-shrink-0">LOCAL</span>
                                )}
                              </div>
                              <p className="text-[10px] text-warm-500">
                                {game.sport} · {gameTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                                {game.network ? ` · ${game.network}` : ''}
                              </p>
                            </div>
                            {isLive && (
                              <span className="flex items-center gap-1 text-[10px] font-semibold text-red-400 bg-red-500/10 border border-red-500/20 rounded-full px-2 py-0.5 flex-shrink-0">
                                <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                                LIVE
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      <div className="px-4 py-3 bg-teal/5 border-t border-whoop-divider">
        <p className="text-[11px] text-warm-400">
          Game nights typically drive 20–40% higher bar traffic. Consider extended hours or extra staff on these dates.
        </p>
      </div>
    </div>
  );
}

// ============ MAIN PAGE ============

export default function Events() {
  const user = authService.getStoredUser();
  const venueId = user?.venueId || 'theshowcaselounge';

  const [activeTab, setActiveTab] = useState<EventsTab>('suggestions');
  const [allEvents, setAllEvents] = useState<CalendarEventIdea[]>([]);
  const [filter, setFilter] = useState<'all' | 'holiday' | 'sports' | 'seasonal' | 'community'>('all');
  const [weekGames, setWeekGames] = useState<SportsGame[]>([]);
  const [venueCity, setVenueCity] = useState<string>('');

  // Load calendar events on mount
  useEffect(() => {
    const events = generateCalendarEvents(new Date(), 3);
    setAllEvents(events);
  }, []);

  // Load venue city
  useEffect(() => {
    const addr = venueSettingsService.getAddress(venueId);
    if (addr?.city) setVenueCity(addr.city);
    venueSettingsService.getAddressFromCloud(venueId).then(cloudAddr => {
      if (cloudAddr?.city) setVenueCity(cloudAddr.city);
    }).catch(() => {});
  }, [venueId]);

  // Load sports games for fallback
  useEffect(() => {
    sportsService.getGames().then(games => {
      const now = Date.now();
      const week = now + 7 * 24 * 60 * 60 * 1000;
      setWeekGames(
        games.filter(g => {
          const t = new Date(g.startTime).getTime();
          return t >= now - 3600000 && t <= week;
        })
      );
    }).catch(() => {});
  }, []);

  const filteredEvents = filter === 'all'
    ? allEvents
    : allEvents.filter(e => e.category === filter);

  const thisWeekEvents = allEvents.filter(e => e.isThisWeek);

  // Month-by-month grouping
  const today = new Date();
  const months = [0, 1, 2].map(offset => {
    const d = new Date(today.getFullYear(), today.getMonth() + offset, 1);
    return {
      label: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      monthKey: `${d.getFullYear()}-${d.getMonth()}`,
      events: filteredEvents.filter(e =>
        e.date.getFullYear() === d.getFullYear() && e.date.getMonth() === d.getMonth()
      ),
    };
  });

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
        <p className="text-sm text-warm-400">Calendar-driven event ideas — 3 months out</p>
      </div>

      {/* Tab Navigation */}
      <div className="mb-4">
        <div className="flex gap-2">
          {[
            { id: 'suggestions' as const, label: 'Ideas', icon: Calendar },
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
          {/* This Week's Opportunities */}
          {thisWeekEvents.length > 0 ? (
            <div className="mb-6 bg-whoop-panel border border-whoop-divider rounded-2xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-whoop-divider">
                <Calendar className="w-4 h-4 text-teal" />
                <span className="text-sm font-semibold text-white">This Week's Opportunities</span>
                <span className="text-[10px] text-red-400 font-semibold ml-auto">Act now</span>
              </div>
              <div className="p-3 space-y-2">
                {thisWeekEvents.map((event, i) => (
                  <CalendarEventCard key={event.id} event={event} index={i} />
                ))}
              </div>
            </div>
          ) : (
            <SportsWeekFallback weekGames={weekGames} venueCity={venueCity} />
          )}

          {/* Filter tabs */}
          <div className="mb-4">
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
              {[
                { key: 'all', label: 'All Events' },
                { key: 'holiday', label: 'Holidays' },
                { key: 'sports', label: 'Sports' },
                { key: 'seasonal', label: 'Seasonal' },
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

          {/* 3 Month Planner */}
          <div className="space-y-2">
            {months.map(month => (
              <div key={month.monthKey}>
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="text-sm font-semibold text-white">{month.label}</h3>
                  <span className="text-[10px] text-warm-500 bg-warm-800 px-2 py-0.5 rounded-full">
                    {month.events.length} event{month.events.length !== 1 ? 's' : ''}
                  </span>
                </div>
                {month.events.length === 0 ? (
                  <div className="text-xs text-warm-600 pl-2 mb-4">No major events this month</div>
                ) : (
                  <div className="space-y-2 mb-6">
                    {month.events.map((event, i) => (
                      <CalendarEventCard key={event.id} event={event} index={i} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Footer */}
          <p className="text-xs text-warm-500 text-center mt-6">
            Events projected 3 months out · Updated daily with national calendar
          </p>
        </>
      )}
    </div>
  );
}

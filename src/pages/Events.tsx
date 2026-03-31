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
import { eventsService, EventSuggestion, VenueVibe, buildHistoryContext, predictAttendance, type VenueHistoryContext } from '../services/events.service';
import { EventROITracker } from '../components/events/EventROITracker';
import authService from '../services/auth.service';
import sportsService from '../services/sports.service';
import venueScopeService from '../services/venuescope.service';
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

// ============ NATIONAL EVENTS ============

const NATIONAL_EVENTS: Array<{ date: string; name: string; emoji: string; trafficImpact: 'high' | 'medium'; tip: string }> = [
  { date: '01-01', name: "New Year's Day", emoji: '🎊', trafficImpact: 'high', tip: 'NYD crowds love brunch specials' },
  { date: '02-02', name: 'Super Bowl Sunday', emoji: '🏈', trafficImpact: 'high', tip: '#1 bar day of the year — order extra stock' },
  { date: '02-14', name: "Valentine's Day", emoji: '💝', trafficImpact: 'medium', tip: 'Couples night promotions work well' },
  { date: '03-14', name: 'Pi Day', emoji: '🥧', trafficImpact: 'medium', tip: 'Fun for trivia or food specials' },
  { date: '03-17', name: "St. Patrick's Day", emoji: '🍀', trafficImpact: 'high', tip: 'Start green beer specials at open' },
  { date: '04-01', name: 'April Fools Day', emoji: '🃏', trafficImpact: 'medium', tip: 'Fun theme night opportunity' },
  { date: '05-05', name: 'Cinco de Mayo', emoji: '🌮', trafficImpact: 'high', tip: 'Partner with a tequila brand' },
  { date: '05-12', name: "Mother's Day", emoji: '🌸', trafficImpact: 'medium', tip: 'Sunday brunch specials' },
  { date: '06-19', name: 'Juneteenth', emoji: '✊', trafficImpact: 'medium', tip: 'Community celebration opportunity' },
  { date: '07-04', name: 'Independence Day', emoji: '🎆', trafficImpact: 'high', tip: 'Start outdoor promotions in the afternoon' },
  { date: '09-01', name: 'Labor Day Weekend', emoji: '🌟', trafficImpact: 'high', tip: 'Full weekend crowd expected' },
  { date: '10-31', name: 'Halloween', emoji: '🎃', trafficImpact: 'high', tip: 'Costume contests drive massive foot traffic' },
  { date: '11-27', name: 'Thanksgiving Eve', emoji: '🦃', trafficImpact: 'high', tip: 'Biggest bar night of the year in many cities' },
  { date: '12-23', name: 'Holiday Weekend', emoji: '🎄', trafficImpact: 'medium', tip: 'Work parties and friend groups out' },
  { date: '12-31', name: "New Year's Eve", emoji: '🥂', trafficImpact: 'high', tip: 'Sell tickets in advance' },
];

function getDynamicNationalEvents(date: Date): Array<{ name: string; emoji: string; trafficImpact: 'high' | 'medium'; tip: string }> {
  const events: Array<{ name: string; emoji: string; trafficImpact: 'high' | 'medium'; tip: string }> = [];
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const dow = date.getDay();

  // March Madness (mid-March through first week of April)
  if ((month === 3 && day >= 14) || (month === 4 && day <= 7)) {
    if (dow === 0 || dow === 6 || dow === 4 || dow === 5) {
      events.push({ name: 'March Madness', emoji: '🏀', trafficImpact: 'high', tip: 'Set up bracket pools and TV specials' });
    }
  }

  // NFL Playoffs (January - wild card through conference championships)
  if (month === 1 && day <= 28) {
    if (dow === 0) {
      events.push({ name: 'NFL Playoffs', emoji: '🏈', trafficImpact: 'high', tip: 'NFL playoffs — game day specials' });
    }
  }

  // Super Bowl weekend (first or second Sunday of February)
  if (month === 2 && day <= 14 && dow === 0) {
    events.push({ name: 'Super Bowl Weekend', emoji: '🏆', trafficImpact: 'high', tip: '#1 bar day — maximize staffing' });
  }

  return events;
}

// ============ COMPONENTS ============

interface EventCardProps {
  event: EventSuggestion;
  index: number;
  history: VenueHistoryContext | null;
}

function EventCard({ event, index, history }: EventCardProps) {
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
                <p className="text-xs text-teal font-medium mb-1">ABOUT THIS EVENT</p>
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

              {/* Attendance Prediction */}
              {history && (() => {
                const pred = predictAttendance(event, history);
                if (!pred) return null;
                return (
                  <div className="bg-teal/5 border border-teal/20 rounded-lg p-3">
                    <p className="text-xs text-teal font-medium mb-1 flex items-center gap-1">
                      <BarChart3 className="w-3 h-3" /> ATTENDANCE PREDICTION
                    </p>
                    <p className="text-sm font-bold text-white">{pred.low}–{pred.high} guests</p>
                    <p className="text-xs text-warm-500 mt-0.5">{pred.basis} · +{event.attendanceBoostPct}% uplift typical for this event type</p>
                  </div>
                );
              })()}

              {/* Why it was suggested */}
              {event.signalReasons && event.signalReasons.length > 0 && (
                <div>
                  <p className="text-xs text-teal font-medium mb-1">WHY IT FITS YOUR VENUE</p>
                  <div className="flex flex-wrap gap-1.5">
                    {event.signalReasons.map((r, i) => (
                      <span key={i} className="text-[10px] text-warm-300 bg-warm-700/60 rounded-full px-2 py-0.5">{r}</span>
                    ))}
                  </div>
                </div>
              )}
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

// ============ 7-DAY CALENDAR ============

interface WeekCalendarProps {
  weekGames: SportsGame[];
  history: VenueHistoryContext | null;
  venueCity: string;
}

function WeekCalendar({ weekGames, history, venueCity }: WeekCalendarProps) {
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Group games by date key
  const gamesByDate: Record<string, SportsGame[]> = {};
  weekGames.forEach(game => {
    const key = new Date(game.startTime).toISOString().slice(0, 10);
    if (!gamesByDate[key]) gamesByDate[key] = [];
    gamesByDate[key].push(game);
  });

  // Generate 7 days starting from today
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return d;
  });

  return (
    <div className="mb-6 bg-whoop-panel border border-whoop-divider rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-whoop-divider">
        <Tv className="w-4 h-4 text-teal" />
        <span className="text-sm font-semibold text-white">This Week's Opportunities</span>
        <span className="text-[10px] text-warm-500 ml-auto">Game nights drive traffic</span>
      </div>

      <div className="divide-y divide-whoop-divider">
        {weekDays.map((date, i) => {
          const dateKey = date.toISOString().slice(0, 10);
          const mmdd = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
          const dow = date.getDay();
          const dayGames = gamesByDate[dateKey] || [];
          const nationalEvents = NATIONAL_EVENTS.filter(e => e.date === mmdd);
          const dynamicEvents = getDynamicNationalEvents(date);
          const allNationalEvents = [...nationalEvents, ...dynamicEvents];
          const localGames = dayGames.filter(g => isLocalTeamGame(g, venueCity));
          const hasContent = dayGames.length > 0 || allNationalEvents.length > 0;
          const isExpanded = expandedDay === dateKey;

          const dayLabel = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : DOW_LABELS[dow];
          const dateLabel = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

          // Traffic indicator from history
          let trafficDot = null;
          if (history && history.totalShiftsAnalyzed >= 3) {
            const avgGuests = history.avgGuestsByDow[dow] || 0;
            const allAvgs = Object.values(history.avgGuestsByDow).filter(v => v > 0);
            const maxAvg = allAvgs.length ? Math.max(...allAvgs) : 1;
            const ratio = avgGuests / maxAvg;
            const dotColor = ratio >= 0.7 ? 'bg-green-400' : ratio >= 0.4 ? 'bg-amber-400' : 'bg-red-400';
            const label = avgGuests > 0 ? `Avg ${avgGuests} guests` : 'No data';
            trafficDot = { dotColor, label };
          }

          return (
            <div key={dateKey}>
              <button
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-warm-800/30 transition-colors text-left"
                onClick={() => hasContent ? setExpandedDay(isExpanded ? null : dateKey) : undefined}
              >
                {/* Day name */}
                <div className="w-16 flex-shrink-0">
                  <p className={`text-xs font-semibold ${i === 0 ? 'text-teal' : 'text-warm-300'}`}>{dayLabel}</p>
                  <p className="text-[10px] text-warm-600">{dateLabel}</p>
                </div>

                {/* Event icons */}
                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                  {allNationalEvents.map((evt, idx) => (
                    <span key={idx} title={evt.name} className="text-base leading-none">{evt.emoji}</span>
                  ))}
                  {dayGames.length > 0 && (
                    <span className="flex items-center gap-1 text-[10px] text-warm-400 bg-warm-800 rounded px-1.5 py-0.5 ml-1">
                      <Tv className="w-2.5 h-2.5" />
                      {dayGames.length} game{dayGames.length !== 1 ? 's' : ''}
                    </span>
                  )}
                  {localGames.length > 0 && (
                    <span className="text-[9px] font-bold text-teal bg-teal/10 border border-teal/30 rounded px-1.5 py-0.5">
                      LOCAL
                    </span>
                  )}
                  {!hasContent && (
                    <span className="text-[10px] text-warm-700">No events</span>
                  )}
                </div>

                {/* Traffic indicator */}
                {trafficDot && (
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className={`w-1.5 h-1.5 rounded-full ${trafficDot.dotColor}`} />
                    <span className="text-[10px] text-warm-500 hidden sm:block">{trafficDot.label}</span>
                  </div>
                )}

                {/* Expand chevron */}
                {hasContent && (
                  <ChevronRight className={`w-3.5 h-3.5 text-warm-600 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                )}
              </button>

              {/* Expanded day details */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="overflow-hidden border-t border-whoop-divider bg-warm-900/40"
                  >
                    <div className="px-4 py-3 space-y-3">
                      {/* National events */}
                      {allNationalEvents.map((evt, idx) => (
                        <div key={idx} className="flex items-start gap-2">
                          <span className="text-lg leading-none mt-0.5">{evt.emoji}</span>
                          <div>
                            <p className="text-sm font-medium text-white">{evt.name}</p>
                            <p className="text-[10px] text-warm-500">{evt.tip}</p>
                            <span className={`inline-block mt-0.5 text-[9px] font-semibold rounded px-1.5 py-0.5 ${evt.trafficImpact === 'high' ? 'text-red-300 bg-red-500/10' : 'text-amber-300 bg-amber-500/10'}`}>
                              {evt.trafficImpact === 'high' ? 'HIGH TRAFFIC' : 'MODERATE TRAFFIC'}
                            </span>
                          </div>
                        </div>
                      ))}

                      {/* Games */}
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
  const [vibe, setVibe] = useState<VenueVibe | null>(null);
  const [suggestions, setSuggestions] = useState<EventSuggestion[]>([]);
  const [quickWins, setQuickWins] = useState<EventSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'theme_night' | 'special_event' | 'recurring'>('all');
  const [weekGames, setWeekGames] = useState<SportsGame[]>([]);
  const [history, setHistory] = useState<VenueHistoryContext | null>(null);
  const [venueCity, setVenueCity] = useState<string>('');

  // Load everything: history first, then suggestions
  useEffect(() => {
    async function loadAll() {
      setIsLoading(true);

      // Load history first so suggestions can use it
      try {
        const jobs = await venueScopeService.listJobs(venueId, 200);
        const nonLive = jobs.filter(j => !j.isLive);
        const hist = nonLive.length >= 3 ? buildHistoryContext(nonLive) : null;
        setHistory(hist);
      } catch {
        // history stays null
      }

      // Load address (sync from cache)
      const addr = venueSettingsService.getAddress(venueId);
      if (addr?.city) setVenueCity(addr.city);
      // Also load from cloud asynchronously
      venueSettingsService.getAddressFromCloud(venueId).then(cloudAddr => {
        if (cloudAddr?.city) setVenueCity(cloudAddr.city);
      }).catch(() => {});

      try {
        const hist = await (async () => {
          try {
            const jobs = await venueScopeService.listJobs(venueId, 200);
            const nonLive = jobs.filter(j => !j.isLive);
            return nonLive.length >= 3 ? buildHistoryContext(nonLive) : null;
          } catch {
            return null;
          }
        })();

        const [vibeData, suggestionsData, quickWinsData] = await Promise.all([
          eventsService.getVenueVibe(venueId),
          eventsService.getEventSuggestions(venueId, 8, hist ?? undefined),
          eventsService.getQuickWins(venueId),
        ]);
        setVibe(vibeData);
        setSuggestions(suggestionsData);
        setQuickWins(quickWinsData);
      } catch (e) {
        console.error('Events: Error loading data:', e);
      } finally {
        setIsLoading(false);
      }
    }
    loadAll();
  }, [venueId]);

  // Load sports games
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

          {/* Historical context banner */}
          {history && history.totalShiftsAnalyzed >= 3 && (
            <div className="flex items-center gap-3 px-4 py-2 bg-whoop-panel border border-whoop-divider rounded-xl text-xs text-warm-400 mb-4">
              <BarChart3 className="w-3.5 h-3.5 text-teal flex-shrink-0" />
              <span>Event ideas ranked using <strong className="text-white">{history.totalShiftsAnalyzed} nights</strong> of attendance history from your cameras</span>
            </div>
          )}

          {/* Music vibe compact strip */}
          {vibe && vibe.songsAnalyzed > 0 && (
            <div className="flex items-center gap-3 px-4 py-2 bg-whoop-panel border border-whoop-divider rounded-xl text-xs text-warm-400 mb-4">
              <Music className="w-3.5 h-3.5 text-teal flex-shrink-0" />
              <span>Music vibe: <strong className="text-white">{vibe.vibeName}</strong> ({vibe.primary.genre} {vibe.primary.percentage}%)</span>
              <span className="ml-auto text-warm-600">{vibe.songsAnalyzed.toLocaleString()} plays analyzed</span>
            </div>
          )}

          {/* This Week's Opportunities — 7-day calendar */}
          <WeekCalendar weekGames={weekGames} history={history} venueCity={venueCity} />

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
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="bg-warm-800/60 rounded-xl border border-warm-700 p-5 animate-pulse">
                  <div className="flex items-start gap-4">
                    <div className="w-14 h-14 rounded-xl bg-warm-700/60" />
                    <div className="flex-1 space-y-2">
                      <div className="h-5 bg-warm-700/50 rounded w-48" />
                      <div className="h-3 bg-warm-700/30 rounded w-64" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              <AnimatePresence mode="popLayout">
                {filteredSuggestions.map((event, index) => (
                  <EventCard key={event.id} event={event} index={index} history={history} />
                ))}
              </AnimatePresence>

              {filteredSuggestions.length === 0 && (
                <div className="text-center py-12">
                  <p className="text-warm-500">No events in this category</p>
                </div>
              )}
            </div>
          )}

          {/* Footer note */}
          <div className="mt-8 text-center space-y-2">
            <p className="text-xs text-warm-500">
              Suggestions refresh each session based on your venue's data
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

import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Calendar, TrendingUp, TrendingDown, Plus,
  X, Save, Trash2, Music, Mic, Trophy,
  Gamepad2, PartyPopper, Tag, RefreshCw, BarChart3
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import dynamoDBService from '../../services/dynamodb.service';
import authService from '../../services/auth.service';

// Events API endpoint
const EVENTS_API = 'https://4unsp74svc.execute-api.us-east-2.amazonaws.com/prod/events';

// Event types with icons
const EVENT_TYPES = [
  { id: 'dj', label: 'DJ Night', icon: Music, color: 'text-purple-400' },
  { id: 'live_band', label: 'Live Band', icon: Mic, color: 'text-pink-400' },
  { id: 'trivia', label: 'Trivia Night', icon: Gamepad2, color: 'text-cyan-400' },
  { id: 'karaoke', label: 'Karaoke', icon: Music, color: 'text-amber-400' },
  { id: 'sports', label: 'Sports Event', icon: Trophy, color: 'text-emerald-400' },
  { id: 'theme', label: 'Theme Night', icon: PartyPopper, color: 'text-orange-400' },
  { id: 'other', label: 'Other', icon: Tag, color: 'text-warm-400' },
];

interface LoggedEvent {
  id: string;
  date: string;
  name: string;
  type: string;
  notes?: string;
  // Calculated metrics
  guests?: number;
  avgGuests?: number; // For that day of week
  guestsDelta?: number;
  retention?: number;
  avgRetention?: number;
  retentionDelta?: number;
}

export function EventROITracker() {
  const [events, setEvents] = useState<LoggedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  
  const user = authService.getStoredUser();
  const venueId = user?.venueId;

  const loadEvents = useCallback(async () => {
    if (!venueId) return;
    setLoading(true);
    
    try {
      // Load events from API
      const response = await fetch(`${EVENTS_API}/${venueId}`);
      if (!response.ok) throw new Error('Failed to fetch events');
      
      const apiEvents = await response.json();
      
      // Map API response to LoggedEvent format
      const storedEvents: LoggedEvent[] = apiEvents.map((e: { eventId: string; date: string; name: string; type: string; notes?: string }) => ({
        id: e.eventId,
        date: e.date,
        name: e.name,
        type: e.type,
        notes: e.notes
      }));
      
      // Calculate ROI metrics for each event
      const eventsWithMetrics = await Promise.all(
        storedEvents.map(async (event) => {
          return await calculateEventROI(event);
        })
      );
      
      // Sort by date descending
      eventsWithMetrics.sort((a, b) => 
        new Date(b.date).getTime() - new Date(a.date).getTime()
      );
      
      setEvents(eventsWithMetrics);
    } catch (error) {
      console.error('Error loading events:', error);
    } finally {
      setLoading(false);
    }
  }, [venueId]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const calculateEventROI = async (event: LoggedEvent): Promise<LoggedEvent> => {
    if (!venueId) return event;
    
    try {
      const eventDate = parseISO(event.date);
      const dayOfWeek = eventDate.getDay();
      
      // Get data for the event date
      const startOfDay = new Date(eventDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(eventDate);
      endOfDay.setHours(23, 59, 59, 999);
      
      const eventDayData = await dynamoDBService.getSensorDataByDateRange(
        venueId, startOfDay, endOfDay, 5000
      );
      
      // Calculate guests for event day
      let guests = 0;
      if (eventDayData && eventDayData.length >= 2) {
        const sorted = eventDayData.sort((a, b) => 
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
        const withEntries = sorted.filter(d => d.occupancy?.entries !== undefined);
        if (withEntries.length >= 2) {
          guests = Math.max(0,
            (withEntries[withEntries.length - 1].occupancy?.entries || 0) -
            (withEntries[0].occupancy?.entries || 0)
          );
        }
      }
      
      // Get average for same day of week (last 4 weeks)
      const avgData = await getAverageForDayOfWeek(dayOfWeek, eventDate);
      
      // Calculate deltas
      const guestsDelta = avgData.avgGuests > 0 
        ? Math.round(((guests - avgData.avgGuests) / avgData.avgGuests) * 100)
        : 0;
      
      return {
        ...event,
        guests,
        avgGuests: avgData.avgGuests,
        guestsDelta,
        retention: avgData.retention,
        avgRetention: avgData.avgRetention,
        retentionDelta: avgData.retentionDelta,
      };
    } catch (error) {
      console.error('Error calculating ROI:', error);
      return event;
    }
  };

  const getAverageForDayOfWeek = async (dayOfWeek: number, excludeDate: Date): Promise<{
    avgGuests: number;
    retention: number;
    avgRetention: number;
    retentionDelta: number;
  }> => {
    if (!venueId) return { avgGuests: 0, retention: 0, avgRetention: 0, retentionDelta: 0 };
    
    try {
      // Get last 30 days of data
      const data = await dynamoDBService.getHistoricalSensorData(venueId, '30d');
      if (!data?.data?.length) return { avgGuests: 0, retention: 0, avgRetention: 0, retentionDelta: 0 };
      
      // Group by day
      const byDay = new Map<string, typeof data.data>();
      data.data.forEach(d => {
        const day = format(new Date(d.timestamp), 'yyyy-MM-dd');
        if (!byDay.has(day)) byDay.set(day, []);
        byDay.get(day)!.push(d);
      });
      
      // Find same day of week entries (excluding the event date)
      const excludeDateStr = format(excludeDate, 'yyyy-MM-dd');
      const sameDayData: number[] = [];
      
      byDay.forEach((dayData, dateStr) => {
        if (dateStr === excludeDateStr) return;
        const date = new Date(dateStr);
        if (date.getDay() === dayOfWeek) {
          const sorted = dayData.sort((a, b) => 
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          );
          const withEntries = sorted.filter(d => d.occupancy?.entries !== undefined);
          if (withEntries.length >= 2) {
            const guests = Math.max(0,
              (withEntries[withEntries.length - 1].occupancy?.entries || 0) -
              (withEntries[0].occupancy?.entries || 0)
            );
            sameDayData.push(guests);
          }
        }
      });
      
      const avgGuests = sameDayData.length > 0
        ? Math.round(sameDayData.reduce((a, b) => a + b, 0) / sameDayData.length)
        : 0;
      
      return { avgGuests, retention: 0, avgRetention: 0, retentionDelta: 0 };
    } catch {
      return { avgGuests: 0, retention: 0, avgRetention: 0, retentionDelta: 0 };
    }
  };

  const handleAddEvent = async (event: Omit<LoggedEvent, 'id'>) => {
    if (!venueId) return;
    
    try {
      const response = await fetch(`${EVENTS_API}/${venueId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: event.name,
          date: event.date,
          type: event.type,
          notes: event.notes
        })
      });
      
      if (!response.ok) throw new Error('Failed to create event');
      
      setShowAddModal(false);
      loadEvents();
    } catch (error) {
      console.error('Error creating event:', error);
      alert('Failed to save event. Please try again.');
    }
  };

  const handleDeleteEvent = async (eventId: string) => {
    if (!venueId) return;
    if (!confirm('Delete this event?')) return;
    
    try {
      const response = await fetch(`${EVENTS_API}/${venueId}/${eventId}`, {
        method: 'DELETE'
      });
      
      if (!response.ok) throw new Error('Failed to delete event');
      
      loadEvents();
    } catch (error) {
      console.error('Error deleting event:', error);
      alert('Failed to delete event. Please try again.');
    }
  };

  const filteredEvents = typeFilter === 'all' 
    ? events 
    : events.filter(e => e.type === typeFilter);

  // Calculate summary stats
  const eventTypeSummary = useMemo(() => {
    const summary = new Map<string, { count: number; totalDelta: number }>();
    
    events.forEach(e => {
      if (!summary.has(e.type)) {
        summary.set(e.type, { count: 0, totalDelta: 0 });
      }
      const s = summary.get(e.type)!;
      s.count++;
      s.totalDelta += e.guestsDelta || 0;
    });
    
    return Array.from(summary.entries()).map(([type, data]) => ({
      type,
      count: data.count,
      avgDelta: Math.round(data.totalDelta / data.count)
    })).sort((a, b) => b.avgDelta - a.avgDelta);
  }, [events]);

  const getEventTypeConfig = (type: string) => {
    return EVENT_TYPES.find(t => t.id === type) || EVENT_TYPES[EVENT_TYPES.length - 1];
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-primary" />
            Event Performance
          </h2>
          <p className="text-sm text-warm-400 mt-1">Track which events drive the most guests</p>
        </div>
        
        <motion.button
          onClick={() => setShowAddModal(true)}
          className="btn-primary flex items-center gap-2"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <Plus className="w-4 h-4" />
          Log Event
        </motion.button>
      </div>

      {/* Summary Cards */}
      {eventTypeSummary.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {eventTypeSummary.slice(0, 4).map((summary: { type: string; count: number; avgDelta: number }, i: number) => {
            const config = getEventTypeConfig(summary.type);
            const Icon = config.icon;
            return (
              <motion.div
                key={summary.type}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                className="glass-card p-4"
              >
                <div className="flex items-center gap-2 mb-2">
                  <Icon className={`w-4 h-4 ${config.color}`} />
                  <span className="text-xs text-warm-400">{config.label}</span>
                </div>
                <div className="flex items-end justify-between">
                  <div>
                    <div className="text-xl font-bold text-white">{summary.count}</div>
                    <div className="text-xs text-warm-500">events</div>
                  </div>
                  <div className={`text-sm font-medium ${summary.avgDelta >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {summary.avgDelta >= 0 ? '+' : ''}{summary.avgDelta}%
                    <div className="text-xs text-warm-500">vs normal</div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Type Filter */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        <button
          onClick={() => setTypeFilter('all')}
          className={`px-3 py-1.5 text-sm rounded-lg whitespace-nowrap transition-colors ${
            typeFilter === 'all'
              ? 'bg-primary/20 text-primary border border-primary/30'
              : 'bg-warm-800 text-warm-400 hover:text-white'
          }`}
        >
          All Events
        </button>
        {EVENT_TYPES.map(type => (
          <button
            key={type.id}
            onClick={() => setTypeFilter(type.id)}
            className={`px-3 py-1.5 text-sm rounded-lg whitespace-nowrap transition-colors flex items-center gap-1.5 ${
              typeFilter === type.id
                ? 'bg-primary/20 text-primary border border-primary/30'
                : 'bg-warm-800 text-warm-400 hover:text-white'
            }`}
          >
            <type.icon className="w-3 h-3" />
            {type.label}
          </button>
        ))}
      </div>

      {/* Events List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-8 h-8 text-primary animate-spin" />
        </div>
      ) : filteredEvents.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Calendar className="w-12 h-12 text-warm-600 mx-auto mb-3" />
          <p className="text-warm-400 mb-2">No events logged yet</p>
          <p className="text-sm text-warm-500 mb-4">Log your past events to see their ROI</p>
          <button
            onClick={() => setShowAddModal(true)}
            className="btn-primary inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Log Your First Event
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredEvents.map((event, i) => {
            const config = getEventTypeConfig(event.type);
            const Icon = config.icon;
            const isPositive = (event.guestsDelta || 0) >= 0;
            
            return (
              <motion.div
                key={event.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className="glass-card p-4 hover:bg-warm-800/50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-lg bg-warm-800 flex items-center justify-center ${config.color}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="font-medium text-white">{event.name}</div>
                      <div className="flex items-center gap-2 text-xs text-warm-400">
                        <span>{format(parseISO(event.date), 'EEE, MMM d, yyyy')}</span>
                        <span>•</span>
                        <span>{config.label}</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-6">
                    <div className="text-right">
                      <div className="text-lg font-bold text-white">{event.guests?.toLocaleString() || '—'}</div>
                      <div className="text-xs text-warm-500">guests</div>
                    </div>
                    
                    <div className="text-right min-w-[80px]">
                      <div className={`text-lg font-bold flex items-center gap-1 justify-end ${
                        isPositive ? 'text-emerald-400' : 'text-red-400'
                      }`}>
                        {isPositive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                        {event.guestsDelta !== undefined ? `${isPositive ? '+' : ''}${event.guestsDelta}%` : '—'}
                      </div>
                      <div className="text-xs text-warm-500">vs avg {event.avgGuests || '—'}</div>
                    </div>
                    
                    <button
                      onClick={() => handleDeleteEvent(event.id)}
                      className="text-warm-500 hover:text-red-400 transition-colors p-2"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Add Event Modal */}
      <AnimatePresence>
        {showAddModal && (
          <AddEventModal
            onClose={() => setShowAddModal(false)}
            onSave={handleAddEvent}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// Add Event Modal Component
function AddEventModal({ 
  onClose, 
  onSave 
}: { 
  onClose: () => void; 
  onSave: (event: Omit<LoggedEvent, 'id'>) => void;
}) {
  const [name, setName] = useState('');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [type, setType] = useState('dj');
  const [notes, setNotes] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    
    onSave({ name: name.trim(), date, type, notes: notes.trim() || undefined });
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="glass-card p-6 w-full max-w-md"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold text-white">Log Past Event</h3>
          <button onClick={onClose} className="text-warm-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-warm-400 mb-2">Event Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g., DJ Mike's Friday Night"
              className="w-full bg-warm-800 rounded-lg px-4 py-3 text-white placeholder-warm-500 focus:outline-none focus:ring-2 focus:ring-primary"
              required
            />
          </div>

          <div>
            <label className="block text-sm text-warm-400 mb-2">Date</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              max={format(new Date(), 'yyyy-MM-dd')}
              className="w-full bg-warm-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-primary"
              required
            />
          </div>

          <div>
            <label className="block text-sm text-warm-400 mb-2">Event Type</label>
            <div className="grid grid-cols-2 gap-2">
              {EVENT_TYPES.map(t => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setType(t.id)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
                      type === t.id
                        ? 'bg-primary/20 border border-primary/30 text-white'
                        : 'bg-warm-800 text-warm-400 hover:text-white'
                    }`}
                  >
                    <Icon className={`w-4 h-4 ${t.color}`} />
                    <span className="text-sm">{t.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-sm text-warm-400 mb-2">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Any additional details..."
              className="w-full bg-warm-800 rounded-lg px-4 py-3 text-white placeholder-warm-500 focus:outline-none focus:ring-2 focus:ring-primary resize-none h-20"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 btn-primary flex items-center justify-center gap-2"
            >
              <Save className="w-4 h-4" />
              Save Event
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

export default EventROITracker;

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users, Calendar, Clock, Plus, X, Save, Trash2,
  TrendingUp, RefreshCw, BarChart3, User, Upload,
  ChevronDown, ChevronRight, AlertTriangle, CheckCircle2, Camera,
  Sparkles, ChevronLeft, Zap,
} from 'lucide-react';
import { format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval,
         addMonths, subMonths, startOfWeek, endOfWeek, isSameMonth, isToday, getDay } from 'date-fns';
import authService from '../services/auth.service';
import venueScopeService from '../services/venuescope.service';
import type { VenueScopeJob } from '../services/venuescope.service';
import { loadVenueSetting, saveVenueSetting, peekVenueSetting } from '../services/venueSettings.service';
import venueSettingsService from '../services/venue-settings.service';
import { PullToRefresh } from '../components/common/PullToRefresh';
import { CSVImport } from '../components/common/CSVImport';
import { isDemoAccount, generateDemoCapacityModel } from '../utils/demoData';

// ── Types ──────────────────────────────────────────────────────────────────

interface BartenderCapModel {
  bartenders: Record<string, { dph_median: number; dph_p60: number; shifts: number }>;
  venue_dph: number;
  drinks_per_cover_per_hour: number;
  covers_per_bartender: number;
  shifts_analyzed?: number;
  source: 'learned' | 'no_data';
}

interface HourlyRates {
  bartender: number;
  server: number;
  door: number;
  manager: number;
}

interface StaffMember {
  id: string;
  name: string;
  role: 'bartender' | 'server' | 'door' | 'manager' | 'other';
  color: string;
}

interface Shift {
  id: string;
  staffId: string;
  staffName: string;
  role: string;
  date: string;
  startTime: string;
  endTime: string;
  suggested?: boolean;   // AI-generated, not yet confirmed
}

interface CamPerf {
  name: string;
  drinks: number;
  shifts: number;
  theftFlags: number;
  drinksPerShift: number;
  dph?: number;    // drinks per hour (from per_hour field)
}

// Per-day staffing recommendation from the forecast engine
interface DayStaffing {
  date: string;             // YYYY-MM-DD
  expectedPeople: number;
  bartenders: number;
  servers: number;
  door: number;
  barback: number;
  isWeekend: boolean;
}

// ── Constants ──────────────────────────────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  bartender: 'bg-purple-500',
  server:    'bg-cyan-500',
  door:      'bg-amber-500',
  manager:   'bg-emerald-500',
  other:     'bg-warm-500',
};

const ROLE_LABELS: Record<string, string> = {
  bartender: 'Bartender',
  server:    'Server',
  door:      'Door Staff',
  manager:   'Manager',
  other:     'Other',
};

const ROLE_TEXT: Record<string, string> = {
  bartender: 'text-purple-400',
  server:    'text-cyan-400',
  door:      'text-amber-400',
  manager:   'text-emerald-400',
  other:     'text-warm-400',
};

// ── Forecast engine (client-side) ─────────────────────────────────────────
// Mirrors the Python staffing_engine formula so the month view is consistent
// with the Prophet forecast when real data isn't available.

const DOW_MULT  = [0.40, 0.45, 0.50, 0.65, 1.00, 0.95, 0.55]; // Mon–Sun (date-fns: 0=Sun)
const MONTH_MULT = [0, 0.72, 0.78, 0.92, 0.88, 0.91, 0.96, 0.94, 0.93, 0.87, 0.97, 0.85, 1.12];
// Fallback only — the forecast should resolve through venue profile
// (slowDayCovers / busyDayCovers interpolated by DOW) or the server's
// stored prior. Hitting this constant means the owner never filled in a
// baseline, so we keep a sensible industry default so the schedule
// renders *something* instead of NaN.
const GENERIC_PEAK = 120;
const AVG_VISIT_SLOTS = 10; // 15-min slots per visit (2.5 hours)
const SLOT_SHAPE_SUM  = 6.60; // sum of hour shapes × 1 slot-per-hour

// Returns Monday-indexed DOW (Mon=0 .. Sun=6) from a JS Date
function mondayDOW(d: Date): number { return (getDay(d) + 6) % 7; }

function clientForecastForDate(
  d: Date,
  capacity: number,
  covers_per_bartender: number,
  door_threshold: number,
  // Venue's self-reported slow/busy night cover counts from onboarding
  // (null when not configured — we then fall back to GENERIC_PEAK * dow_mult).
  // These are the SAME inputs the server-side forecast uses, so the
  // Staffing schedule and Events → Tonight's Forecast now agree.
  slowDayCovers?: number | null,
  busyDayCovers?: number | null,
): DayStaffing {
  const dow   = mondayDOW(d);
  const month = d.getMonth() + 1;

  // Target total covers for this day — mirrors the server prior in
  // venuescope/core/prophet_forecast/forecast_service.py._resolve_prior_peak:
  //   slow_w = min(DOW_MULT), busy_w = max(DOW_MULT)
  //   t      = (dow_mult - slow_w) / (busy_w - slow_w)
  //   target = slow + t * (busy - slow)
  // If the venue hasn't supplied slow/busy numbers, fall back to the
  // legacy generic-peak calculation so existing deployments don't break.
  let target_covers: number;
  if (typeof slowDayCovers === 'number' && typeof busyDayCovers === 'number'
      && busyDayCovers > 0) {
    const slow_w = Math.min(...DOW_MULT);
    const busy_w = Math.max(...DOW_MULT);
    const raw    = (DOW_MULT[dow] - slow_w) / Math.max(1e-9, busy_w - slow_w);
    const t      = Math.max(0, Math.min(1, raw));
    target_covers = slowDayCovers + t * (busyDayCovers - slowDayCovers);
  } else {
    const concurrent_peak = GENERIC_PEAK * DOW_MULT[dow] * MONTH_MULT[month];
    target_covers = 4 * concurrent_peak * SLOT_SHAPE_SUM / AVG_VISIT_SLOTS;
  }

  // Hard-cap at physical capacity — no schedule should predict more
  // covers than the room actually fits. Matches the server's cap logic.
  if (capacity && capacity > 0) target_covers = Math.min(target_covers, capacity);

  const mid_covers = Math.max(1, Math.round(target_covers));

  // Derive concurrent peak from total covers for staffing headcount:
  //   peak ≈ covers × avg_visit_slots / (slots_per_hour × shape_integral)
  // This inverts the server's aggregation so bartenders/door scale with
  // the actual predicted crowd, not a fixed industry peak.
  const concurrent_peak = (mid_covers * AVG_VISIT_SLOTS)
                        / (SLOT_SHAPE_SUM * 4 || 1);

  const bartenders  = Math.max(1, Math.ceil(concurrent_peak / covers_per_bartender));
  const door        = concurrent_peak / Math.max(capacity, 1) >= door_threshold ? 1 : 0;
  const barback     = concurrent_peak / Math.max(capacity, 1) >= 0.40 ? 1 : 0;
  return {
    date:          format(d, 'yyyy-MM-dd'),
    expectedPeople: mid_covers,
    bartenders,
    servers: 0,
    door,
    barback,
    isWeekend: dow >= 4, // Thu/Fri/Sat count as "busy"
  };
}

// ── Persistence helpers ────────────────────────────────────────────────────

const API_BASE  = import.meta.env.VITE_STAFFING_API_URL || '';
const STAFF_API = API_BASE ? `${API_BASE}/staff`  : '';
const SHIFTS_API = API_BASE ? `${API_BASE}/shifts` : '';

// Staffing data is persisted in DynamoDB via venueSettings.service so
// managers see the same roster + shifts on every device. The sync helpers
// below read/write the local cache so existing synchronous call sites keep
// working; a useEffect on mount hydrates the cache from the server.

type _StaffingBlob = { staff: StaffMember[]; shifts: Shift[] };

function _lsGetStaff(venueId: string): StaffMember[] {
  return peekVenueSetting<_StaffingBlob>('staffing',
    { staff: [], shifts: [] }, venueId).staff;
}
function _lsGetShifts(venueId: string): Shift[] {
  return peekVenueSetting<_StaffingBlob>('staffing',
    { staff: [], shifts: [] }, venueId).shifts;
}
function _lsSaveStaff(venueId: string, data: StaffMember[]) {
  const prev = peekVenueSetting<_StaffingBlob>('staffing',
    { staff: [], shifts: [] }, venueId);
  // Fire-and-forget: write-through cache is already populated by save, so
  // even if the server is unreachable the next synchronous read succeeds.
  void saveVenueSetting('staffing', { ...prev, staff: data }, venueId);
}
function _lsSaveShifts(venueId: string, data: Shift[]) {
  const prev = peekVenueSetting<_StaffingBlob>('staffing',
    { staff: [], shifts: [] }, venueId);
  void saveVenueSetting('staffing', { ...prev, shifts: data }, venueId);
}

const _RATE_DEFAULTS: HourlyRates = { bartender: 18, server: 15, door: 16, manager: 22 };

// Shift hours (start → end, crossing midnight counted as 8 hrs default)
function shiftHours(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let h = (eh + (em / 60)) - (sh + (sm / 60));
  if (h <= 0) h += 24; // crosses midnight
  return Math.round(h * 10) / 10;
}

// ── Demo data ──────────────────────────────────────────────────────────────

const DEMO_STAFF: StaffMember[] = [
  { id: 'demo-1', name: 'Sabrina Martinez', role: 'bartender', color: 'bg-purple-500' },
  { id: 'demo-2', name: 'Jake Thompson',    role: 'bartender', color: 'bg-purple-500' },
  { id: 'demo-3', name: 'Ashley Chen',      role: 'server',    color: 'bg-cyan-500'   },
  { id: 'demo-4', name: 'Marcus Williams',  role: 'server',    color: 'bg-cyan-500'   },
  { id: 'demo-5', name: 'Tyler Johnson',    role: 'door',      color: 'bg-amber-500'  },
  { id: 'demo-6', name: 'Rachel Kim',       role: 'manager',   color: 'bg-emerald-500'},
];

const DEMO_CAM_PERF: CamPerf[] = [
  { name: 'Sabrina Martinez', drinks: 284, shifts: 12, theftFlags: 1, drinksPerShift: 23.7, dph: 24.2 },
  { name: 'Jake Thompson',    drinks: 241, shifts: 11, theftFlags: 0, drinksPerShift: 21.9, dph: 19.8 },
  { name: 'Rachel Kim',       drinks: 188, shifts:  8, theftFlags: 0, drinksPerShift: 23.5, dph: 21.1 },
];

function generateDemoShifts(): Shift[] {
  const today = new Date();
  const monthStart = startOfMonth(today);
  const monthEnd   = endOfMonth(today);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const shifts: Shift[] = [];
  days.forEach(day => {
    const dateStr  = format(day, 'yyyy-MM-dd');
    const dow      = mondayDOW(day);
    const isWeekend = dow >= 4;
    if (isWeekend) {
      shifts.push({ id: `d-${dateStr}-1`, staffId: 'demo-1', staffName: 'Sabrina Martinez', role: 'bartender', date: dateStr, startTime: '18:00', endTime: '02:00' });
      shifts.push({ id: `d-${dateStr}-2`, staffId: 'demo-2', staffName: 'Jake Thompson',    role: 'bartender', date: dateStr, startTime: '20:00', endTime: '02:00' });
      shifts.push({ id: `d-${dateStr}-5`, staffId: 'demo-5', staffName: 'Tyler Johnson',    role: 'door',      date: dateStr, startTime: '21:00', endTime: '02:00' });
    } else {
      shifts.push({ id: `d-${dateStr}-1`, staffId: 'demo-1', staffName: 'Sabrina Martinez', role: 'bartender', date: dateStr, startTime: '18:00', endTime: '02:00' });
    }
    if (dow >= 3) {
      shifts.push({ id: `d-${dateStr}-6`, staffId: 'demo-6', staffName: 'Rachel Kim', role: 'manager', date: dateStr, startTime: '18:00', endTime: '02:00' });
    }
  });
  return shifts;
}

// ── Camera Performance View ────────────────────────────────────────────────

function CameraPerformanceView({ camPerf, staff, shifts, jobs }: {
  camPerf: CamPerf[]; staff: StaffMember[]; shifts: Shift[]; jobs: VenueScopeJob[];
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const today = new Date();

  const nextShift = (name: string): Shift | undefined => {
    const todayStr = format(today, 'yyyy-MM-dd');
    return shifts
      .filter(s => s.staffName.toLowerCase() === name.toLowerCase() && s.date >= todayStr)
      .sort((a, b) => a.date.localeCompare(b.date))[0];
  };

  const jobsForPerson = (name: string): VenueScopeJob[] =>
    jobs.filter(j => {
      if (j.topBartender?.toLowerCase() === name.toLowerCase()) return true;
      if (j.bartenderBreakdown) {
        try {
          const bd = JSON.parse(j.bartenderBreakdown) as Record<string, unknown>;
          return Object.keys(bd).some(k => k.toLowerCase() === name.toLowerCase());
        } catch { return false; }
      }
      return false;
    }).slice(0, 8);

  const roleFor = (name: string) => {
    const m = staff.find(s => s.name.toLowerCase() === name.toLowerCase());
    return m ? ROLE_LABELS[m.role] || m.role : 'Bartender';
  };

  if (camPerf.length === 0) {
    return (
      <div className="glass-card p-12 text-center">
        <Camera className="w-12 h-12 text-warm-600 mx-auto mb-3" />
        <p className="text-warm-400 mb-1">No camera data yet</p>
        <p className="text-sm text-warm-500">Run VenueScope on a shift to see staff performance here</p>
      </div>
    );
  }

  const maxDrinks = Math.max(...camPerf.map(p => p.drinks), 1);

  return (
    <div className="space-y-3">
      {camPerf.map((perf, i) => {
        const isOpen  = expanded === perf.name;
        const ns      = nextShift(perf.name);
        const history = jobsForPerson(perf.name);
        return (
          <motion.div key={perf.name} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }} className="glass-card overflow-hidden">
            <button className="w-full flex items-center gap-4 p-4 text-left"
              onClick={() => setExpanded(isOpen ? null : perf.name)}>
              <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0 ${
                i === 0 ? 'bg-amber-500' : i === 1 ? 'bg-warm-500' : i === 2 ? 'bg-orange-700' : 'bg-warm-700'}`}>
                {i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-white truncate">{perf.name}</span>
                  <span className="text-[10px] text-warm-500 bg-warm-800 px-1.5 py-0.5 rounded flex-shrink-0">{roleFor(perf.name)}</span>
                  {perf.theftFlags > 0 && (
                    <span className="text-[10px] text-red-400 flex items-center gap-0.5 flex-shrink-0">
                      <AlertTriangle className="w-3 h-3" />{perf.theftFlags} flag{perf.theftFlags > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                <div className="w-full bg-warm-700 rounded-full h-1.5">
                  <div className="h-1.5 rounded-full bg-teal" style={{ width: `${(perf.drinks / maxDrinks) * 100}%` }} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4 text-center flex-shrink-0">
                <div>
                  <div className="text-lg font-bold text-white">{perf.drinks}</div>
                  <div className="text-[10px] text-warm-500">Drinks</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-white">{perf.shifts}</div>
                  <div className="text-[10px] text-warm-500">Shifts</div>
                </div>
                <div>
                  <div className={`text-lg font-bold ${perf.dph ? 'text-teal' : 'text-text-muted'}`}>
                    {perf.dph ? perf.dph.toFixed(1) : perf.drinksPerShift.toFixed(1)}
                  </div>
                  <div className="text-[10px] text-warm-500">{perf.dph ? 'Avg dph' : 'Avg/Shift'}</div>
                </div>
              </div>
              {isOpen ? <ChevronDown className="w-4 h-4 text-warm-500 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-warm-500 flex-shrink-0" />}
            </button>

            <AnimatePresence>
              {isOpen && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}
                  className="overflow-hidden border-t border-warm-700">
                  <div className="p-4 space-y-4">
                    <div>
                      <p className="text-xs text-warm-500 uppercase tracking-wider mb-2">Next Scheduled Shift</p>
                      {ns ? (
                        <div className="flex items-center gap-3 bg-warm-800 rounded-lg px-3 py-2">
                          <Calendar className="w-4 h-4 text-teal flex-shrink-0" />
                          <span className="text-white text-sm font-medium">{format(parseISO(ns.date), 'EEE, MMM d')}</span>
                          <span className="text-warm-400 text-sm">{ns.startTime}–{ns.endTime}</span>
                        </div>
                      ) : <p className="text-warm-500 text-sm">No upcoming shifts scheduled</p>}
                    </div>
                    {history.length > 0 && (
                      <div>
                        <p className="text-xs text-warm-500 uppercase tracking-wider mb-2">Recent Camera Sessions</p>
                        <div className="space-y-1.5">
                          {history.map(job => {
                            let drinks = job.totalDrinks ?? 0;
                            if (job.bartenderBreakdown) {
                              try {
                                const bd = JSON.parse(job.bartenderBreakdown) as Record<string, { drinks?: number }>;
                                const entry = Object.entries(bd).find(([k]) => k.toLowerCase() === perf.name.toLowerCase());
                                if (entry) drinks = entry[1].drinks ?? drinks;
                              } catch { /* use job total */ }
                            }
                            return (
                              <div key={job.jobId} className="flex items-center justify-between text-sm bg-warm-800/50 rounded px-3 py-1.5">
                                <span className="text-warm-400">{job.createdAt ? format(new Date(job.createdAt * 1000), 'EEE MMM d') : '—'}</span>
                                <span className="text-white font-medium">{drinks} drinks</span>
                                {job.hasTheftFlag
                                  ? <span className="text-red-400 text-xs flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> flagged</span>
                                  : <span className="text-emerald-400 text-xs flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> clean</span>}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        );
      })}
    </div>
  );
}

// ── Month Schedule View ────────────────────────────────────────────────────

function MonthScheduleView({
  staff,
  shifts,
  setShifts,
  venueId,
  bartenderStats,
  capacityModel,
  hourlyRates,
  venueCapacity,
  onAddStaff,
  onDeleteStaff,
  onAddShift,
  onDeleteShift,
  onConfirmSuggested,
  onImportCSV,
}: {
  staff: StaffMember[];
  shifts: Shift[];
  setShifts: React.Dispatch<React.SetStateAction<Shift[]>>;
  venueId: string;
  bartenderStats: Record<string, { drinks: number; shifts: number; theftFlags: number }>;
  capacityModel: BartenderCapModel | null;
  hourlyRates: HourlyRates;
  venueCapacity: number;
  onAddStaff: () => void;
  onDeleteStaff: (id: string) => void;
  onAddShift: (date: string) => void;
  onDeleteShift: (id: string) => void;
  onConfirmSuggested: (date?: string) => void;
  onImportCSV: () => void;
}) {
  const [viewMonth, setViewMonth] = useState(new Date());
  const [autoFilling, setAutoFilling] = useState(false);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  // Physics config — the capacity now comes from the venue's real profile
  // (not a 150 hardcode) so the schedule and Events → Tonight's Forecast
  // see the same cap. covers_per_bartender uses the learned model when
  // available, else a 35 fallback that ballparks most bars.
  const capacity             = venueCapacity;
  const covers_per_bartender = capacityModel?.source === 'learned' ? capacityModel.covers_per_bartender : 35;
  const door_threshold       = 0.55;

  // Build bartender dph ranking from capacity model (highest dph first = fastest bartenders)
  const bartenderDph = (name: string): number => {
    const entry = capacityModel?.bartenders?.[name];
    return entry?.dph_p60 ?? entry?.dph_median ?? 0;
  };

  // Build calendar grid: full weeks covering the month
  const monthStart = startOfMonth(viewMonth);
  const monthEnd   = endOfMonth(viewMonth);
  const calStart   = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calEnd     = endOfWeek(monthEnd,   { weekStartsOn: 1 });
  const calDays    = eachDayOfInterval({ start: calStart, end: calEnd });

  const getShiftsForDay = (dateStr: string) => shifts.filter(s => s.date === dateStr);

  const suggestedCount = shifts.filter(s => s.suggested).length;

  // Generate AI-suggested shifts for the entire displayed month
  const handleAutoFill = () => {
    if (!staff.length) { alert('Add staff members first.'); return; }
    setAutoFilling(true);

    const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
    const newShifts: Shift[] = [];

    // Round-robin indices per role
    const byRole = (role: string) => staff.filter(s => s.role === role);
    // Sort bartenders by dph descending (fastest first) for busy nights
    const sortedBartenders = byRole('bartender').sort((a, b) => bartenderDph(b.name) - bartenderDph(a.name));
    let bartIdx = 0, doorIdx = 0;

    days.forEach(day => {
      const dateStr  = format(day, 'yyyy-MM-dd');
      const existing = shifts.filter(s => s.date === dateStr && !s.suggested);
      if (existing.length > 0) return; // don't overwrite confirmed shifts

      const rec = clientForecastForDate(day, capacity, covers_per_bartender, door_threshold);

      // Bartenders — on busy nights (isWeekend), start from highest-dph; on slow nights rotate
      const bartenderPool = rec.isWeekend ? sortedBartenders : byRole('bartender');
      if (bartenderPool.length > 0) {
        for (let i = 0; i < Math.min(rec.bartenders, bartenderPool.length); i++) {
          const b = rec.isWeekend
            ? bartenderPool[i % bartenderPool.length]           // best bartenders on busy nights
            : bartenderPool[(bartIdx + i) % bartenderPool.length]; // rotate on slow nights
          const startHr = rec.isWeekend ? '18:00' : '20:00';
          newShifts.push({
            id: `auto-${dateStr}-bart-${i}`,
            staffId: b.id, staffName: b.name, role: 'bartender',
            date: dateStr, startTime: startHr, endTime: '02:00',
            suggested: true,
          });
        }
        if (!rec.isWeekend) bartIdx = (bartIdx + rec.bartenders) % Math.max(bartenderPool.length, 1);
      }

      // Door staff (if needed)
      if (rec.door > 0) {
        const doors = byRole('door');
        if (doors.length > 0) {
          const d = doors[doorIdx % doors.length];
          newShifts.push({
            id: `auto-${dateStr}-door-0`,
            staffId: d.id, staffName: d.name, role: 'door',
            date: dateStr, startTime: '21:00', endTime: '02:00',
            suggested: true,
          });
          doorIdx++;
        }
      }

      // Manager (always schedule one if available, on busy nights)
      if (rec.isWeekend) {
        const managers = byRole('manager');
        if (managers.length > 0) {
          const m = managers[0];
          newShifts.push({
            id: `auto-${dateStr}-mgr-0`,
            staffId: m.id, staffName: m.name, role: 'manager',
            date: dateStr, startTime: '18:00', endTime: '02:00',
            suggested: true,
          });
        }
      }
    });

    // Remove previous suggestions for this month, keep confirmed + other months
    const kept = shifts.filter(s => {
      if (!s.suggested) return true;
      const d = parseISO(s.date);
      return !isSameMonth(d, viewMonth);
    });

    const merged = [...kept, ...newShifts];
    setShifts(merged);
    _lsSaveShifts(venueId, merged);
    setAutoFilling(false);
  };

  const weekDayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  return (
    <div className="space-y-5">
      {/* Team Roster */}
      <div className="glass-card p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <User className="w-4 h-4 text-primary" />Team Members
          </h2>
          <div className="flex items-center gap-2">
            <button onClick={onImportCSV} className="btn-secondary text-sm flex items-center gap-1">
              <Upload className="w-4 h-4" />Import CSV
            </button>
            <button onClick={onAddStaff} className="btn-primary text-sm flex items-center gap-1">
              <Plus className="w-4 h-4" />Add Staff
            </button>
          </div>
        </div>
        {staff.length === 0 ? (
          <p className="text-warm-400 text-center py-4 text-sm">No staff yet. Add your team to start tracking schedules.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {staff.map(s => (
              <div key={s.id} className="flex items-center gap-2 px-3 py-2 bg-warm-800 rounded-lg group">
                <div className={`w-2.5 h-2.5 rounded-full ${ROLE_COLORS[s.role]}`} />
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-white text-sm">{s.name}</span>
                    <span className="text-xs text-warm-500">({ROLE_LABELS[s.role]})</span>
                  </div>
                  {bartenderStats[s.name] && (
                    <div className="text-[10px] text-teal mt-0.5">
                      {bartenderStats[s.name].drinks} drinks · {bartenderStats[s.name].shifts} shifts
                      {bartenderStats[s.name].theftFlags > 0 && (
                        <span className="text-red-400 ml-1">· {bartenderStats[s.name].theftFlags} flag{bartenderStats[s.name].theftFlags > 1 ? 's' : ''}</span>
                      )}
                    </div>
                  )}
                </div>
                <button onClick={() => onDeleteStaff(s.id)} className="opacity-0 group-hover:opacity-100 text-warm-500 hover:text-red-400 transition-all ml-1">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Month navigation + auto-fill */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setViewMonth(subMonths(viewMonth, 1))} className="btn-secondary p-2">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-white font-semibold min-w-[130px] text-center">
            {format(viewMonth, 'MMMM yyyy')}
          </span>
          <button onClick={() => setViewMonth(addMonths(viewMonth, 1))} className="btn-secondary p-2">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          {suggestedCount > 0 && (
            <button onClick={() => onConfirmSuggested()}
              className="text-sm px-3 py-2 rounded-lg bg-teal/20 border border-teal/40 text-teal hover:bg-teal/30 transition-colors flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" />
              Confirm all ({suggestedCount})
            </button>
          )}
          <div className="flex flex-col items-end gap-1">
            <button onClick={handleAutoFill} disabled={autoFilling}
              className="btn-primary text-sm flex items-center gap-2">
              {autoFilling ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              Auto-fill Month
            </button>
            {capacityModel?.source === 'learned' && (
              <span className="text-[9px] text-teal/70 flex items-center gap-0.5">
                <Zap className="w-2.5 h-2.5" />
                venue-learned · {capacityModel.shifts_analyzed ?? 0} shifts · {capacityModel.covers_per_bartender} guests/bartender
              </span>
            )}
          </div>
        </div>
      </div>

      {/* AI suggestion legend */}
      {suggestedCount > 0 && (
        <div className="flex items-center gap-3 text-xs text-warm-400 px-1">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded border-2 border-dashed border-teal/60 bg-teal/10" />
            <span>AI suggested — click shift to confirm or remove</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded bg-purple-500/30 border border-purple-500/50" />
            <span>Confirmed</span>
          </div>
        </div>
      )}

      {/* Month Calendar Grid */}
      <div>
        {/* DOW headers */}
        <div className="grid grid-cols-7 gap-1 mb-1">
          {weekDayLabels.map(d => (
            <div key={d} className="text-center text-[10px] text-warm-500 font-medium py-1">{d}</div>
          ))}
        </div>

        {/* Weeks */}
        <div className="grid grid-cols-7 gap-1">
          {calDays.map(day => {
            const dateStr      = format(day, 'yyyy-MM-dd');
            const inMonth      = isSameMonth(day, viewMonth);
            const today        = isToday(day);
            const dayShifts    = getShiftsForDay(dateStr);
            const confirmed    = dayShifts.filter(s => !s.suggested);
            const suggested    = dayShifts.filter(s => s.suggested);
            const rec          = inMonth ? clientForecastForDate(day, capacity, covers_per_bartender, door_threshold) : null;
            const isExpanded   = expandedDay === dateStr;

            return (
              <div key={dateStr}
                className={`relative rounded-lg border transition-colors cursor-pointer
                  ${inMonth ? 'bg-warm-800/60' : 'bg-warm-900/20 opacity-40'}
                  ${today ? 'border-primary ring-1 ring-primary/30' : 'border-warm-700/50'}
                  ${isExpanded ? 'ring-2 ring-teal/40' : ''}
                `}
                style={{ minHeight: '80px' }}
                onClick={() => inMonth && setExpandedDay(isExpanded ? null : dateStr)}
              >
                {/* Date number + forecast summary */}
                <div className="flex items-start justify-between p-2">
                  <span className={`text-sm font-bold leading-none ${today ? 'text-primary' : inMonth ? 'text-white' : 'text-warm-600'}`}>
                    {format(day, 'd')}
                  </span>
                  {rec && (
                    <div className="text-right">
                      <div className="text-[9px] text-warm-500 leading-none">{rec.expectedPeople}p</div>
                      <div className="flex items-center gap-0.5 justify-end mt-0.5">
                        <span className="text-[9px] text-purple-400">🍺{rec.bartenders}</span>
                        {rec.door > 0 && <span className="text-[9px] text-amber-400">🚪{rec.door}</span>}
                      </div>
                    </div>
                  )}
                </div>

                {/* Shift dots / names */}
                <div className="px-1.5 pb-1.5 space-y-0.5">
                  {/* Show first 2 confirmed */}
                  {confirmed.slice(0, 2).map(s => (
                    <div key={s.id}
                      className={`text-[9px] px-1 py-0.5 rounded truncate ${ROLE_COLORS[s.role]} bg-opacity-25 text-white`}
                      onClick={e => { e.stopPropagation(); onDeleteShift(s.id); }}>
                      {s.staffName.split(' ')[0]}
                    </div>
                  ))}
                  {/* Show suggested count */}
                  {suggested.length > 0 && (
                    <div className="text-[9px] px-1 py-0.5 rounded border border-dashed border-teal/50 text-teal bg-teal/5">
                      <Zap className="w-2 h-2 inline mr-0.5" />{suggested.length} suggested
                    </div>
                  )}
                  {/* Overflow */}
                  {confirmed.length > 2 && (
                    <div className="text-[9px] text-warm-500 px-1">+{confirmed.length - 2} more</div>
                  )}
                </div>

                {/* Add button */}
                {inMonth && (
                  <button
                    className="absolute top-1.5 right-1.5 opacity-0 hover:opacity-100 group-hover:opacity-100 text-warm-500 hover:text-primary transition-all"
                    onClick={e => { e.stopPropagation(); onAddShift(dateStr); }}
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Expanded day detail panel */}
      <AnimatePresence>
        {expandedDay && (() => {
          const day      = parseISO(expandedDay);
          const dayShifts = getShiftsForDay(expandedDay);
          const rec       = clientForecastForDate(day, capacity, covers_per_bartender, door_threshold);

          // Labor cost estimate
          const laborCost = dayShifts.reduce((sum, s) => {
            const hrs  = shiftHours(s.startTime, s.endTime);
            const rate = hourlyRates[s.role as keyof HourlyRates] ?? hourlyRates.bartender;
            return sum + hrs * rate;
          }, 0);
          const revEstimate = rec.expectedPeople * 28; // ~$28/head avg

          return (
            <motion.div key={expandedDay}
              initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              className="glass-card p-4">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-white font-bold text-base">{format(day, 'EEEE, MMMM d')}</h3>
                  <p className="text-warm-400 text-xs mt-0.5">
                    Forecast: ~{rec.expectedPeople} people · need {rec.bartenders} bartender{rec.bartenders !== 1 ? 's' : ''}
                    {rec.door > 0 ? ` · door` : ''}
                  </p>
                  {dayShifts.length > 0 && (
                    <div className="flex items-center gap-3 mt-1.5 text-xs">
                      <span className="text-warm-500">Labor est.</span>
                      <span className="text-amber-400 font-semibold">${Math.round(laborCost)}</span>
                      <span className="text-warm-600">vs</span>
                      <span className="text-green-400 font-semibold">${revEstimate.toLocaleString()} rev</span>
                      <span className={`font-semibold ${laborCost / revEstimate <= 0.30 ? 'text-green-400' : 'text-amber-400'}`}>
                        ({Math.round((laborCost / revEstimate) * 100)}% labor cost)
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => onAddShift(expandedDay)} className="btn-primary text-xs flex items-center gap-1 px-3 py-1.5">
                    <Plus className="w-3 h-3" />Add Shift
                  </button>
                  <button onClick={() => setExpandedDay(null)} className="text-warm-500 hover:text-white">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {dayShifts.length === 0 ? (
                <p className="text-warm-500 text-sm text-center py-4">No shifts yet. Click "Auto-fill Month" to generate suggestions.</p>
              ) : (
                <div className="space-y-2">
                  {dayShifts.map(s => (
                    <div key={s.id}
                      className={`flex items-center justify-between px-3 py-2 rounded-lg border
                        ${s.suggested
                          ? 'border-dashed border-teal/40 bg-teal/5'
                          : `${ROLE_COLORS[s.role]} bg-opacity-10 border-opacity-30`
                        }`}>
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${ROLE_COLORS[s.role]}`} />
                        <span className="text-white text-sm font-medium">{s.staffName}</span>
                        <span className="text-warm-500 text-xs">({ROLE_LABELS[s.role] ?? s.role})</span>
                        {s.suggested && (
                          <span className="text-[10px] text-teal flex items-center gap-0.5">
                            <Zap className="w-3 h-3" />AI
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-warm-400 text-sm">{s.startTime}–{s.endTime}</span>
                        {s.suggested && (
                          <button onClick={() => onConfirmSuggested(s.id)}
                            className="text-[10px] text-teal hover:text-white transition-colors">
                            Confirm
                          </button>
                        )}
                        <button onClick={() => onDeleteShift(s.id)} className="text-warm-600 hover:text-red-400 transition-colors">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          );
        })()}
      </AnimatePresence>
    </div>
  );
}

// ── Modals ─────────────────────────────────────────────────────────────────

function AddStaffModal({ onClose, onSave }: { onClose: () => void; onSave: (name: string, role: StaffMember['role']) => void }) {
  const [name, setName] = useState('');
  const [role, setRole] = useState<StaffMember['role']>('bartender');
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
        className="glass-card p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold text-white">Add Staff Member</h3>
          <button onClick={onClose} className="text-warm-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={e => { e.preventDefault(); if (name.trim()) { onSave(name.trim(), role); } }} className="space-y-4">
          <div>
            <label className="block text-sm text-warm-400 mb-2">Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g., Sarah Johnson"
              className="w-full bg-warm-800 rounded-lg px-4 py-3 text-white placeholder-warm-500 focus:outline-none focus:ring-2 focus:ring-primary"
              required autoFocus />
          </div>
          <div>
            <label className="block text-sm text-warm-400 mb-2">Role</label>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(ROLE_LABELS).map(([key, label]) => (
                <button key={key} type="button" onClick={() => setRole(key as StaffMember['role'])}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
                    role === key ? 'bg-primary/20 border border-primary/30 text-white' : 'bg-warm-800 text-warm-400 hover:text-white'}`}>
                  <div className={`w-3 h-3 rounded-full ${ROLE_COLORS[key]}`} />
                  <span className="text-sm">{label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 btn-secondary">Cancel</button>
            <button type="submit" className="flex-1 btn-primary flex items-center justify-center gap-2">
              <Save className="w-4 h-4" />Add Staff
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

function AddShiftModal({ date, staff, onClose, onSave }: {
  date: string; staff: StaffMember[];
  onClose: () => void;
  onSave: (staffId: string, date: string, startTime: string, endTime: string) => void;
}) {
  const [staffId,   setStaffId]   = useState(staff[0]?.id || '');
  const [startTime, setStartTime] = useState('18:00');
  const [endTime,   setEndTime]   = useState('02:00');
  if (staff.length === 0) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={onClose}>
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
          className="glass-card p-6 w-full max-w-md text-center" onClick={e => e.stopPropagation()}>
          <Users className="w-12 h-12 text-warm-600 mx-auto mb-3" />
          <p className="text-warm-400 mb-4">Add staff members first before creating shifts</p>
          <button onClick={onClose} className="btn-primary">Got it</button>
        </motion.div>
      </motion.div>
    );
  }
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
        className="glass-card p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold text-white">Add Shift</h3>
          <button onClick={onClose} className="text-warm-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-sm text-warm-400 mb-4">{format(parseISO(date), 'EEEE, MMMM d, yyyy')}</p>
        <form onSubmit={e => { e.preventDefault(); if (staffId) onSave(staffId, date, startTime, endTime); }} className="space-y-4">
          <div>
            <label className="block text-sm text-warm-400 mb-2">Staff Member</label>
            <select value={staffId} onChange={e => setStaffId(e.target.value)}
              className="w-full bg-warm-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-primary">
              {staff.map(s => <option key={s.id} value={s.id}>{s.name} ({ROLE_LABELS[s.role]})</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-warm-400 mb-2">Start</label>
              <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
                className="w-full bg-warm-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
            <div>
              <label className="block text-sm text-warm-400 mb-2">End</label>
              <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)}
                className="w-full bg-warm-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 btn-secondary">Cancel</button>
            <button type="submit" className="flex-1 btn-primary flex items-center justify-center gap-2">
              <Save className="w-4 h-4" />Add Shift
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function Staffing() {
  const [activeTab,      setActiveTab]      = useState<'performance' | 'schedule'>('performance');
  const [staff,          setStaff]          = useState<StaffMember[]>([]);
  const [shifts,         setShifts]         = useState<Shift[]>([]);
  const [camPerf,        setCamPerf]        = useState<CamPerf[]>([]);
  const [allJobs,        setAllJobs]        = useState<VenueScopeJob[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [showAddStaff,   setShowAddStaff]   = useState(false);
  const [showAddShift,   setShowAddShift]   = useState<string | null>(null);
  const [showCSVImport,  setShowCSVImport]  = useState(false);
  const [bartenderStats, setBartenderStats] = useState<Record<string, { drinks: number; shifts: number; theftFlags: number }>>({});
  const [capacityModel,  setCapacityModel]  = useState<BartenderCapModel | null>(null);
  const [hourlyRates,    setHourlyRates]    = useState<HourlyRates>({ bartender: 18, server: 15, door: 16, manager: 22 });
  // Venue capacity drives the schedule's "expectedPeople" hard cap so the
  // Month Schedule and Events → Tonight's Forecast don't disagree. Defaults
  // to 150 only as a last-resort fallback for venues that haven't onboarded
  // with a capacity value yet.
  const [venueCapacity, setVenueCapacity] = useState<number>(150);

  const user    = authService.getStoredUser();
  const venueId = user?.venueId ?? '';

  // Load venue capacity once per venue so the schedule's client forecast
  // uses the same hard-cap the server prior does.
  useEffect(() => {
    if (!venueId) return;
    venueSettingsService.loadSettingsFromCloud(venueId)
      .then(s => { if (s?.capacity && s.capacity > 0) setVenueCapacity(s.capacity); })
      .catch(() => { /* keep the 150 default */ });
  }, [venueId]);

  const loadData = useCallback(async () => {
    if (!venueId) return;
    setLoading(true);
    try {
      if (isDemoAccount(venueId)) {
        await new Promise(r => setTimeout(r, 400));
        setStaff(DEMO_STAFF);
        setShifts(generateDemoShifts());
        setCamPerf(DEMO_CAM_PERF);
        setAllJobs([]);
        setCapacityModel(generateDemoCapacityModel() as unknown as BartenderCapModel);
        setHourlyRates({ bartender: 22, server: 18, door: 18, manager: 28 });
        setLoading(false);
        return;
      }

      // Load staff + shifts
      let mappedStaff: StaffMember[] = [];
      let mappedShifts: Shift[] = [];
      if (API_BASE) {
        const [sr, shr] = await Promise.all([
          fetch(`${STAFF_API}/${venueId}`),
          fetch(`${SHIFTS_API}/${venueId}`),
        ]);
        const sd  = sr.ok  ? await sr.json()  : [];
        const shd = shr.ok ? await shr.json() : [];
        mappedStaff  = sd.map((s: { staffId: string; name: string; role: string; color?: string }) => ({
          id: s.staffId, name: s.name, role: s.role as StaffMember['role'], color: s.color || ROLE_COLORS[s.role] || ROLE_COLORS.other
        }));
        mappedShifts = shd.map((s: { shiftId: string; staffId: string; staffName: string; role: string; date: string; startTime: string; endTime: string; suggested?: boolean }) => ({
          id: s.shiftId, staffId: s.staffId, staffName: s.staffName, role: s.role,
          date: s.date, startTime: s.startTime, endTime: s.endTime, suggested: s.suggested,
        }));
      } else {
        // Pull from DynamoDB — falls back to the local cache if offline.
        const blob = await loadVenueSetting<_StaffingBlob>(
          'staffing', { staff: [], shifts: [] }, venueId,
        );
        mappedStaff  = blob.staff;
        mappedShifts = blob.shifts;
      }
      setStaff(mappedStaff);
      setShifts(mappedShifts);

      // Hydrate hourly rates from the server as well so a device that has
      // never seen this venue doesn't show stale defaults.
      try {
        const rates = await loadVenueSetting<Partial<HourlyRates>>(
          'hourlyRates', {}, venueId,
        );
        setHourlyRates({ ..._RATE_DEFAULTS, ...rates });
      } catch { /* cache fallback already applied below */ }

      // Load VenueScope jobs for camera performance
      const jobs = await venueScopeService.listJobs(venueId, 100);
      const relevantJobs = jobs.filter(j => j.status === 'done' || j.isLive);
      setAllJobs(relevantJobs);

      // Build camera perf aggregates
      const stats: Record<string, { drinks: number; shifts: number; theftFlags: number; dphs: number[] }> = {};
      relevantJobs.forEach(job => {
        if (job.bartenderBreakdown) {
          try {
            const bd = JSON.parse(job.bartenderBreakdown) as Record<string, { drinks?: number; per_hour?: number }>;
            Object.entries(bd).forEach(([name, data]) => {
              if (!stats[name]) stats[name] = { drinks: 0, shifts: 0, theftFlags: 0, dphs: [] };
              stats[name].drinks += data.drinks ?? 0;
              stats[name].shifts += 1;
              if (job.hasTheftFlag) stats[name].theftFlags += 1;
              if (data.per_hour && data.per_hour > 0 && data.per_hour <= 100) {
                stats[name].dphs.push(data.per_hour);
              }
            });
            return;
          } catch { /* fall through */ }
        }
        if (job.topBartender) {
          const n = job.topBartender;
          if (!stats[n]) stats[n] = { drinks: 0, shifts: 0, theftFlags: 0, dphs: [] };
          stats[n].drinks += job.totalDrinks ?? 0;
          stats[n].shifts += 1;
          if (job.hasTheftFlag) stats[n].theftFlags += 1;
        }
      });

      setBartenderStats(Object.fromEntries(
        Object.entries(stats).map(([n, s]) => [n, { drinks: s.drinks, shifts: s.shifts, theftFlags: s.theftFlags }])
      ));

      const perfArr: CamPerf[] = Object.entries(stats)
        .map(([name, s]) => {
          const dphs = [...s.dphs].sort((a, b) => a - b);
          const dph  = dphs.length > 0 ? dphs[Math.floor(dphs.length / 2)] : undefined;
          return {
            name, drinks: s.drinks, shifts: s.shifts, theftFlags: s.theftFlags,
            drinksPerShift: s.shifts > 0 ? s.drinks / s.shifts : 0,
            dph,
          };
        })
        .sort((a, b) => b.drinks - a.drinks);
      setCamPerf(perfArr);

      // Load capacity model (rates already pulled above via loadVenueSetting)
      venueScopeService.getCapacityModel(venueId).then(cm => {
        if (cm) setCapacityModel(cm as unknown as BartenderCapModel);
      }).catch(() => {});

    } catch (err) {
      console.error('Staff load error', err);
    } finally {
      setLoading(false);
    }
  }, [venueId]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Shift CRUD ──

  const handleAddStaff = async (name: string, role: StaffMember['role']) => {
    if (!venueId) return;
    if (API_BASE) {
      await fetch(`${STAFF_API}/${venueId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, role, color: ROLE_COLORS[role] }) });
    } else {
      const existing = _lsGetStaff(venueId);
      existing.push({ id: `staff-${Date.now()}`, name, role, color: ROLE_COLORS[role] });
      _lsSaveStaff(venueId, existing);
    }
    setShowAddStaff(false);
    loadData();
  };

  const handleDeleteStaff = async (staffId: string) => {
    if (!venueId) return;
    if (!confirm('Delete this staff member and all their shifts?')) return;
    if (API_BASE) {
      await fetch(`${STAFF_API}/${venueId}/${staffId}`, { method: 'DELETE' });
      const staffShifts = shifts.filter(s => s.staffId === staffId);
      await Promise.all(staffShifts.map(s => fetch(`${SHIFTS_API}/${venueId}/${s.id}`, { method: 'DELETE' })));
    } else {
      _lsSaveStaff(venueId, _lsGetStaff(venueId).filter(s => s.id !== staffId));
      _lsSaveShifts(venueId, _lsGetShifts(venueId).filter(s => s.staffId !== staffId));
    }
    loadData();
  };

  const handleAddShift = async (staffId: string, date: string, startTime: string, endTime: string) => {
    if (!venueId) return;
    const staffMember = staff.find(s => s.id === staffId);
    if (!staffMember) return;
    const newShift: Shift = {
      id: `shift-${Date.now()}`, staffId, staffName: staffMember.name,
      role: staffMember.role, date, startTime, endTime, suggested: false,
    };
    if (API_BASE) {
      await fetch(`${SHIFTS_API}/${venueId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newShift) });
    } else {
      const existing = _lsGetShifts(venueId);
      existing.push(newShift);
      _lsSaveShifts(venueId, existing);
    }
    setShowAddShift(null);
    loadData();
  };

  const handleDeleteShift = (shiftId: string) => {
    if (!venueId) return;
    const deleted = shifts.find(s => s.id === shiftId);
    // Log override when manager removes an AI-suggested shift
    if (deleted?.suggested) {
      venueScopeService.logStaffingOverride(venueId, deleted.date, {
        action: 'removed_suggestion',
        role: deleted.role,
        staffName: deleted.staffName,
        date: deleted.date,
      }).catch(() => {});
    }
    const updated = shifts.filter(s => s.id !== shiftId);
    setShifts(updated);
    _lsSaveShifts(venueId, updated);
    if (API_BASE) fetch(`${SHIFTS_API}/${venueId}/${shiftId}`, { method: 'DELETE' });
  };

  // Confirm one or all AI-suggested shifts
  const handleConfirmSuggested = (shiftIdOrAll?: string) => {
    const updated = shifts.map(s => {
      if (shiftIdOrAll === undefined || s.id === shiftIdOrAll) {
        return { ...s, suggested: false };
      }
      return s;
    });
    setShifts(updated);
    _lsSaveShifts(venueId, updated);
  };

  const handleCSVImport = async (data: Record<string, string>[]): Promise<{ success: number; failed: number }> => {
    if (!venueId) return { success: 0, failed: data.length };
    let success = 0, failed = 0;
    const lsStaff  = API_BASE ? null : _lsGetStaff(venueId);
    const lsShifts = API_BASE ? null : _lsGetShifts(venueId);
    for (const row of data) {
      try {
        if (row.name && row.role) {
          const role = row.role.toLowerCase();
          const validRole = (['bartender', 'server', 'door', 'manager', 'other'].includes(role) ? role : 'other') as StaffMember['role'];
          if (API_BASE) {
            await fetch(`${STAFF_API}/${venueId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: row.name, role: validRole, color: ROLE_COLORS[validRole] }) });
          } else {
            lsStaff!.push({ id: `staff-${Date.now()}-${Math.random()}`, name: row.name, role: validRole, color: ROLE_COLORS[validRole] });
          }
          success++;
        } else if (row.date && row.staffname && row.starttime && row.endtime) {
          let staffMember = (lsStaff || staff).find(s => s.name.toLowerCase() === row.staffname.toLowerCase());
          if (!staffMember) {
            const validRole = (['bartender', 'server', 'door', 'manager', 'other'].includes(row.role?.toLowerCase()) ? row.role.toLowerCase() : 'other') as StaffMember['role'];
            if (API_BASE) {
              const res = await fetch(`${STAFF_API}/${venueId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: row.staffname, role: validRole, color: ROLE_COLORS[validRole] }) });
              if (res.ok) { const ns = await res.json(); staffMember = { id: ns.staffId, name: ns.name, role: ns.role, color: ns.color }; }
            } else {
              const ns: StaffMember = { id: `staff-${Date.now()}-${Math.random()}`, name: row.staffname, role: validRole, color: ROLE_COLORS[validRole] };
              lsStaff!.push(ns); staffMember = ns;
            }
          }
          if (staffMember) {
            let formattedDate = row.date;
            if (row.date.includes('/')) {
              const parts = row.date.split('/');
              if (parts.length === 3) formattedDate = `${parts[2]}-${parts[0].padStart(2,'0')}-${parts[1].padStart(2,'0')}`;
            }
            const shift: Shift = { id: `shift-${Date.now()}-${Math.random()}`, staffId: staffMember.id, staffName: staffMember.name, role: staffMember.role, date: formattedDate, startTime: row.starttime, endTime: row.endtime };
            if (API_BASE) {
              await fetch(`${SHIFTS_API}/${venueId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(shift) });
            } else {
              lsShifts!.push(shift);
            }
            success++;
          } else { failed++; }
        } else { failed++; }
      } catch { failed++; }
    }
    if (!API_BASE && venueId) {
      if (lsStaff)  _lsSaveStaff(venueId, lsStaff);
      if (lsShifts) _lsSaveShifts(venueId, lsShifts);
    }
    await loadData();
    return { success, failed };
  };

  // ── Render ──

  return (
    <PullToRefresh onRefresh={loadData}>
      <div className="max-w-6xl mx-auto space-y-6 pb-20">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                <Users className="w-8 h-8 text-primary" />
                Staff
              </h1>
              <p className="text-warm-400 mt-1">Camera performance · forecast-driven schedule</p>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 mb-6">
            {[
              { id: 'performance' as const, label: 'Performance',  icon: Camera   },
              { id: 'schedule'    as const, label: 'Schedule',     icon: Calendar },
            ].map(tab => (
              <motion.button key={tab.id} onClick={() => setActiveTab(tab.id)} whileTap={{ scale: 0.95 }}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${
                  activeTab === tab.id
                    ? 'bg-primary/20 border border-primary/50 text-white'
                    : 'bg-warm-800 border border-warm-700 text-warm-400 hover:text-white'
                }`}>
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </motion.button>
            ))}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-24">
              <RefreshCw className="w-8 h-8 text-primary animate-spin" />
            </div>
          ) : activeTab === 'performance' ? (
            <CameraPerformanceView camPerf={camPerf} staff={staff} shifts={shifts} jobs={allJobs} />
          ) : (
            <MonthScheduleView
              staff={staff}
              shifts={shifts}
              setShifts={setShifts}
              venueId={venueId}
              bartenderStats={bartenderStats}
              capacityModel={capacityModel}
              hourlyRates={hourlyRates}
              venueCapacity={venueCapacity}
              onAddStaff={() => setShowAddStaff(true)}
              onDeleteStaff={handleDeleteStaff}
              onAddShift={date => setShowAddShift(date)}
              onDeleteShift={handleDeleteShift}
              onConfirmSuggested={handleConfirmSuggested}
              onImportCSV={() => setShowCSVImport(true)}
            />
          )}
        </motion.div>

        {/* Modals */}
        <AnimatePresence>
          {showAddStaff && <AddStaffModal onClose={() => setShowAddStaff(false)} onSave={handleAddStaff} />}
        </AnimatePresence>
        <AnimatePresence>
          {showAddShift && <AddShiftModal date={showAddShift} staff={staff} onClose={() => setShowAddShift(null)} onSave={handleAddShift} />}
        </AnimatePresence>
        <AnimatePresence>
          {showCSVImport && (
            <CSVImport
              title="Import Schedule"
              description="Upload a CSV with your staff schedule."
              templateColumns={['staffname', 'role', 'date', 'starttime', 'endtime']}
              templateExample={[
                ['Sarah Johnson', 'bartender', '2026-01-20', '18:00', '02:00'],
                ['Mike Smith',    'server',    '2026-01-20', '17:00', '23:00'],
              ]}
              onImport={handleCSVImport}
              onClose={() => setShowCSVImport(false)}
            />
          )}
        </AnimatePresence>
      </div>
    </PullToRefresh>
  );
}

export default Staffing;

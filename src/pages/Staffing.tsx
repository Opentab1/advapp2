import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users, Calendar, Clock, Plus, X, Save, Trash2,
  TrendingUp, TrendingDown, RefreshCw, BarChart3, User, Upload,
  ChevronDown, ChevronRight, AlertTriangle, CheckCircle2, Camera
} from 'lucide-react';
import { format, parseISO, startOfWeek, endOfWeek, eachDayOfInterval, addWeeks } from 'date-fns';
import dynamoDBService from '../services/dynamodb.service';
import authService from '../services/auth.service';
import venueScopeService from '../services/venuescope.service';
import type { VenueScopeJob } from '../services/venuescope.service';
import { PullToRefresh } from '../components/common/PullToRefresh';
import { CSVImport } from '../components/common/CSVImport';
import { isDemoAccount } from '../utils/demoData';

// ── Types ──────────────────────────────────────────────────────────────────

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
}

interface CamPerf {
  name: string;
  drinks: number;
  shifts: number;
  theftFlags: number;
  drinksPerShift: number;
}

// ── Constants ──────────────────────────────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  bartender: 'bg-purple-500',
  server: 'bg-cyan-500',
  door: 'bg-amber-500',
  manager: 'bg-emerald-500',
  other: 'bg-warm-500'
};

const ROLE_LABELS: Record<string, string> = {
  bartender: 'Bartender',
  server: 'Server',
  door: 'Door Staff',
  manager: 'Manager',
  other: 'Other'
};

// ── Persistence helpers ────────────────────────────────────────────────────

const API_BASE = import.meta.env.VITE_STAFFING_API_URL || '';
const STAFF_API = API_BASE ? `${API_BASE}/staff` : '';
const SHIFTS_API = API_BASE ? `${API_BASE}/shifts` : '';

const _lsKey = (venueId: string, type: 'staff' | 'shifts') => `vs_staffing_${type}_${venueId}`;
function _lsGetStaff(venueId: string): StaffMember[] {
  try { return JSON.parse(localStorage.getItem(_lsKey(venueId, 'staff')) || '[]'); } catch { return []; }
}
function _lsSaveStaff(venueId: string, data: StaffMember[]) {
  localStorage.setItem(_lsKey(venueId, 'staff'), JSON.stringify(data));
}
function _lsGetShifts(venueId: string): Shift[] {
  try { return JSON.parse(localStorage.getItem(_lsKey(venueId, 'shifts')) || '[]'); } catch { return []; }
}
function _lsSaveShifts(venueId: string, data: Shift[]) {
  localStorage.setItem(_lsKey(venueId, 'shifts'), JSON.stringify(data));
}

// ── Demo data ──────────────────────────────────────────────────────────────

const DEMO_STAFF: StaffMember[] = [
  { id: 'demo-1', name: 'Sabrina Martinez', role: 'bartender', color: 'bg-purple-500' },
  { id: 'demo-2', name: 'Jake Thompson', role: 'bartender', color: 'bg-purple-500' },
  { id: 'demo-3', name: 'Ashley Chen', role: 'server', color: 'bg-cyan-500' },
  { id: 'demo-4', name: 'Marcus Williams', role: 'server', color: 'bg-cyan-500' },
  { id: 'demo-5', name: 'Tyler Johnson', role: 'door', color: 'bg-amber-500' },
  { id: 'demo-6', name: 'Rachel Kim', role: 'manager', color: 'bg-emerald-500' },
];

const DEMO_CAM_PERF: CamPerf[] = [
  { name: 'Sabrina Martinez', drinks: 284, shifts: 12, theftFlags: 1, drinksPerShift: 23.7 },
  { name: 'Jake Thompson', drinks: 241, shifts: 11, theftFlags: 0, drinksPerShift: 21.9 },
  { name: 'Rachel Kim', drinks: 188, shifts: 8, theftFlags: 0, drinksPerShift: 23.5 },
];

const generateDemoShifts = (): Shift[] => {
  const shifts: Shift[] = [];
  const today = new Date();
  const weekStart = startOfWeek(today, { weekStartsOn: 1 });
  for (let weekOffset = -1; weekOffset <= 1; weekOffset++) {
    const week = addWeeks(weekStart, weekOffset);
    const days = eachDayOfInterval({ start: week, end: endOfWeek(week, { weekStartsOn: 1 }) });
    days.forEach((day, dayIndex) => {
      const dateStr = format(day, 'yyyy-MM-dd');
      const isWeekend = dayIndex >= 4;
      if (isWeekend) {
        shifts.push({ id: `s-${dateStr}-1`, staffId: 'demo-1', staffName: 'Sabrina Martinez', role: 'bartender', date: dateStr, startTime: '18:00', endTime: '02:00' });
        shifts.push({ id: `s-${dateStr}-2`, staffId: 'demo-2', staffName: 'Jake Thompson', role: 'bartender', date: dateStr, startTime: '20:00', endTime: '02:00' });
        shifts.push({ id: `s-${dateStr}-3`, staffId: 'demo-3', staffName: 'Ashley Chen', role: 'server', date: dateStr, startTime: '18:00', endTime: '01:00' });
        shifts.push({ id: `s-${dateStr}-5`, staffId: 'demo-5', staffName: 'Tyler Johnson', role: 'door', date: dateStr, startTime: '21:00', endTime: '02:00' });
      }
      if (dayIndex >= 4 && dayIndex <= 5) {
        shifts.push({ id: `s-${dateStr}-6`, staffId: 'demo-6', staffName: 'Rachel Kim', role: 'manager', date: dateStr, startTime: '18:00', endTime: '02:00' });
      }
    });
  }
  return shifts;
};

// ── Sub-components ─────────────────────────────────────────────────────────

function CameraPerformanceView({
  camPerf,
  staff,
  shifts,
  jobs,
}: {
  camPerf: CamPerf[];
  staff: StaffMember[];
  shifts: Shift[];
  jobs: VenueScopeJob[];
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const today = new Date();

  // Find next scheduled shift for a staff name
  const nextShift = (name: string): Shift | undefined => {
    const todayStr = format(today, 'yyyy-MM-dd');
    return shifts
      .filter(s => s.staffName.toLowerCase() === name.toLowerCase() && s.date >= todayStr)
      .sort((a, b) => a.date.localeCompare(b.date))[0];
  };

  // Get job history where this bartender appears
  const jobsForPerson = (name: string): VenueScopeJob[] => {
    return jobs.filter(j => {
      if (j.topBartender?.toLowerCase() === name.toLowerCase()) return true;
      if (j.bartenderBreakdown) {
        try {
          const bd = JSON.parse(j.bartenderBreakdown) as Record<string, unknown>;
          return Object.keys(bd).some(k => k.toLowerCase() === name.toLowerCase());
        } catch { return false; }
      }
      return false;
    }).slice(0, 8);
  };

  const roleFor = (name: string): string => {
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
        const isOpen = expanded === perf.name;
        const ns = nextShift(perf.name);
        const history = jobsForPerson(perf.name);

        return (
          <motion.div
            key={perf.name}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            className="glass-card overflow-hidden"
          >
            {/* Row */}
            <button
              className="w-full flex items-center gap-4 p-4 text-left"
              onClick={() => setExpanded(isOpen ? null : perf.name)}
            >
              {/* Rank */}
              <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0 ${
                i === 0 ? 'bg-amber-500' : i === 1 ? 'bg-warm-500' : i === 2 ? 'bg-orange-700' : 'bg-warm-700'
              }`}>
                {i + 1}
              </div>

              {/* Name + bar */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-white truncate">{perf.name}</span>
                  <span className="text-[10px] text-warm-500 bg-warm-800 px-1.5 py-0.5 rounded flex-shrink-0">
                    {roleFor(perf.name)}
                  </span>
                  {perf.theftFlags > 0 && (
                    <span className="text-[10px] text-red-400 flex items-center gap-0.5 flex-shrink-0">
                      <AlertTriangle className="w-3 h-3" />
                      {perf.theftFlags} flag{perf.theftFlags > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                <div className="w-full bg-warm-700 rounded-full h-1.5">
                  <div
                    className="h-1.5 rounded-full bg-teal"
                    style={{ width: `${(perf.drinks / maxDrinks) * 100}%` }}
                  />
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-4 text-center flex-shrink-0">
                <div>
                  <div className="text-lg font-bold text-white">{perf.drinks}</div>
                  <div className="text-[10px] text-warm-500">Total Drinks</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-white">{perf.shifts}</div>
                  <div className="text-[10px] text-warm-500">Shifts</div>
                </div>
                <div>
                  <div className={`text-lg font-bold ${perf.drinksPerShift > 0 ? 'text-teal' : 'text-text-muted'}`}>{perf.drinksPerShift.toFixed(1)}</div>
                  <div className="text-[10px] text-warm-500">Avg/Shift</div>
                </div>
              </div>

              {isOpen ? <ChevronDown className="w-4 h-4 text-warm-500 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-warm-500 flex-shrink-0" />}
            </button>

            {/* Expanded detail */}
            <AnimatePresence>
              {isOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden border-t border-warm-700"
                >
                  <div className="p-4 space-y-4">
                    {/* Next shift */}
                    <div>
                      <p className="text-xs text-warm-500 uppercase tracking-wider mb-2">Next Scheduled Shift</p>
                      {ns ? (
                        <div className="flex items-center gap-3 bg-warm-800 rounded-lg px-3 py-2">
                          <Calendar className="w-4 h-4 text-teal flex-shrink-0" />
                          <span className="text-white text-sm font-medium">
                            {format(parseISO(ns.date), 'EEE, MMM d')}
                          </span>
                          <span className="text-warm-400 text-sm">{ns.startTime}–{ns.endTime}</span>
                        </div>
                      ) : (
                        <p className="text-warm-500 text-sm">No upcoming shifts scheduled</p>
                      )}
                    </div>

                    {/* Shift history from camera */}
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
                                <span className="text-warm-400">
                                  {job.createdAt ? format(new Date(job.createdAt * 1000), 'EEE MMM d') : '—'}
                                </span>
                                <span className="text-white font-medium">{drinks} drinks</span>
                                {job.hasTheftFlag
                                  ? <span className="text-red-400 text-xs flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> flagged</span>
                                  : <span className="text-emerald-400 text-xs flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> clean</span>
                                }
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

function ScheduleView({
  staff,
  shifts,
  weekOffset,
  setWeekOffset,
  bartenderStats,
  onAddStaff,
  onDeleteStaff,
  onAddShift,
  onDeleteShift,
  onImportCSV,
}: {
  staff: StaffMember[];
  shifts: Shift[];
  weekOffset: number;
  setWeekOffset: React.Dispatch<React.SetStateAction<number>>;
  bartenderStats: Record<string, { drinks: number; shifts: number; theftFlags: number }>;
  onAddStaff: () => void;
  onDeleteStaff: (id: string) => void;
  onAddShift: (date: string) => void;
  onDeleteShift: (id: string) => void;
  onImportCSV: () => void;
}) {
  const currentWeekStart = startOfWeek(addWeeks(new Date(), weekOffset), { weekStartsOn: 1 });
  const currentWeekEnd = endOfWeek(currentWeekStart, { weekStartsOn: 1 });
  const weekDays = eachDayOfInterval({ start: currentWeekStart, end: currentWeekEnd });

  const getShiftsForDay = (day: Date) => {
    const dateStr = format(day, 'yyyy-MM-dd');
    return shifts.filter(s => s.date === dateStr);
  };

  return (
    <div className="space-y-6">
      {/* Team Roster */}
      <div className="glass-card p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <User className="w-4 h-4 text-primary" />
            Team Members
          </h2>
          <div className="flex items-center gap-2">
            <button onClick={onImportCSV} className="btn-secondary text-sm flex items-center gap-1">
              <Upload className="w-4 h-4" />
              Import CSV
            </button>
            <button onClick={onAddStaff} className="btn-primary text-sm flex items-center gap-1">
              <Plus className="w-4 h-4" />
              Add Staff
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

      {/* Week Navigation */}
      <div className="flex items-center justify-between">
        <button onClick={() => setWeekOffset(w => w - 1)} className="btn-secondary text-sm">← Prev</button>
        <span className="text-white font-medium text-sm">
          {format(currentWeekStart, 'MMM d')} – {format(currentWeekEnd, 'MMM d, yyyy')}
        </span>
        <button onClick={() => setWeekOffset(w => w + 1)} className="btn-secondary text-sm">Next →</button>
      </div>

      {/* Week Grid */}
      <div className="grid grid-cols-7 gap-2">
        {weekDays.map(day => {
          const dayShifts = getShiftsForDay(day);
          const isToday = format(day, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');
          const dateStr = format(day, 'yyyy-MM-dd');
          return (
            <div key={dateStr} className={`glass-card p-3 min-h-[150px] ${isToday ? 'ring-2 ring-primary' : ''}`}>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className={`text-xs ${isToday ? 'text-primary' : 'text-warm-400'}`}>{format(day, 'EEE')}</div>
                  <div className="text-lg font-bold text-white">{format(day, 'd')}</div>
                </div>
                <button onClick={() => onAddShift(dateStr)} className="text-warm-500 hover:text-primary transition-colors">
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-1">
                {dayShifts.map(shift => (
                  <div key={shift.id} className={`text-xs p-1.5 rounded ${ROLE_COLORS[shift.role]} bg-opacity-20 group relative`}>
                    <div className="font-medium text-white truncate">{shift.staffName}</div>
                    <div className="text-warm-300">{shift.startTime}–{shift.endTime}</div>
                    <button onClick={() => onDeleteShift(shift.id)} className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 text-red-400">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
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
                    role === key ? 'bg-primary/20 border border-primary/30 text-white' : 'bg-warm-800 text-warm-400 hover:text-white'
                  }`}>
                  <div className={`w-3 h-3 rounded-full ${ROLE_COLORS[key]}`} />
                  <span className="text-sm">{label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 btn-secondary">Cancel</button>
            <button type="submit" className="flex-1 btn-primary flex items-center justify-center gap-2">
              <Save className="w-4 h-4" /> Add Staff
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
  const [staffId, setStaffId] = useState(staff[0]?.id || '');
  const [startTime, setStartTime] = useState('18:00');
  const [endTime, setEndTime] = useState('02:00');

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
              <label className="block text-sm text-warm-400 mb-2">Start Time</label>
              <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
                className="w-full bg-warm-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
            <div>
              <label className="block text-sm text-warm-400 mb-2">End Time</label>
              <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)}
                className="w-full bg-warm-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 btn-secondary">Cancel</button>
            <button type="submit" className="flex-1 btn-primary flex items-center justify-center gap-2">
              <Save className="w-4 h-4" /> Add Shift
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function Staffing() {
  const [activeTab, setActiveTab] = useState<'performance' | 'schedule'>('performance');
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [camPerf, setCamPerf] = useState<CamPerf[]>([]);
  const [allJobs, setAllJobs] = useState<VenueScopeJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);
  const [showAddStaff, setShowAddStaff] = useState(false);
  const [showAddShift, setShowAddShift] = useState<string | null>(null);
  const [showCSVImport, setShowCSVImport] = useState(false);
  const [bartenderStats, setBartenderStats] = useState<Record<string, { drinks: number; shifts: number; theftFlags: number }>>({});

  const user = authService.getStoredUser();
  const venueId = user?.venueId;

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
        setLoading(false);
        return;
      }

      // Load staff + shifts
      let mappedStaff: StaffMember[] = [];
      let mappedShifts: Shift[] = [];
      if (API_BASE) {
        const [sr, shr] = await Promise.all([fetch(`${STAFF_API}/${venueId}`), fetch(`${SHIFTS_API}/${venueId}`)]);
        const sd = sr.ok ? await sr.json() : [];
        const shd = shr.ok ? await shr.json() : [];
        mappedStaff = sd.map((s: { staffId: string; name: string; role: string; color?: string }) => ({
          id: s.staffId, name: s.name, role: s.role as StaffMember['role'], color: s.color || ROLE_COLORS[s.role] || ROLE_COLORS.other
        }));
        mappedShifts = shd.map((s: { shiftId: string; staffId: string; staffName: string; role: string; date: string; startTime: string; endTime: string }) => ({
          id: s.shiftId, staffId: s.staffId, staffName: s.staffName, role: s.role, date: s.date, startTime: s.startTime, endTime: s.endTime
        }));
      } else {
        mappedStaff = _lsGetStaff(venueId);
        mappedShifts = _lsGetShifts(venueId);
      }
      setStaff(mappedStaff);
      setShifts(mappedShifts);

      // Load VenueScope jobs for camera performance
      const jobs = await venueScopeService.listJobs(venueId, 100);
      const relevantJobs = jobs.filter(j => j.status === 'done' || j.isLive);
      setAllJobs(relevantJobs);

      // Build camera performance aggregates
      const stats: Record<string, { drinks: number; shifts: number; theftFlags: number }> = {};
      relevantJobs.forEach(job => {
        if (job.bartenderBreakdown) {
          try {
            const bd = JSON.parse(job.bartenderBreakdown) as Record<string, { drinks?: number }>;
            Object.entries(bd).forEach(([name, data]) => {
              if (!stats[name]) stats[name] = { drinks: 0, shifts: 0, theftFlags: 0 };
              stats[name].drinks += data.drinks ?? 0;
              stats[name].shifts += 1;
              if (job.hasTheftFlag) stats[name].theftFlags += 1;
            });
            return;
          } catch { /* fall through */ }
        }
        if (job.topBartender) {
          const n = job.topBartender;
          if (!stats[n]) stats[n] = { drinks: 0, shifts: 0, theftFlags: 0 };
          stats[n].drinks += job.totalDrinks ?? 0;
          stats[n].shifts += 1;
          if (job.hasTheftFlag) stats[n].theftFlags += 1;
        }
      });
      setBartenderStats(stats);

      const perfArr: CamPerf[] = Object.entries(stats)
        .map(([name, s]) => ({
          name,
          drinks: s.drinks,
          shifts: s.shifts,
          theftFlags: s.theftFlags,
          drinksPerShift: s.shifts > 0 ? s.drinks / s.shifts : 0,
        }))
        .sort((a, b) => b.drinks - a.drinks);
      setCamPerf(perfArr);
    } catch (err) {
      console.error('Staff load error', err);
    } finally {
      setLoading(false);
    }
  }, [venueId]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Handlers ──

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
    if (API_BASE) {
      await fetch(`${SHIFTS_API}/${venueId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ staffId, staffName: staffMember.name, role: staffMember.role, date, startTime, endTime }) });
    } else {
      const existing = _lsGetShifts(venueId);
      existing.push({ id: `shift-${Date.now()}`, staffId, staffName: staffMember.name, role: staffMember.role, date, startTime, endTime });
      _lsSaveShifts(venueId, existing);
    }
    setShowAddShift(null);
    loadData();
  };

  const handleDeleteShift = async (shiftId: string) => {
    if (!venueId) return;
    if (API_BASE) {
      await fetch(`${SHIFTS_API}/${venueId}/${shiftId}`, { method: 'DELETE' });
    } else {
      _lsSaveShifts(venueId, _lsGetShifts(venueId).filter(s => s.id !== shiftId));
    }
    loadData();
  };

  const handleCSVImport = async (data: Record<string, string>[]): Promise<{ success: number; failed: number }> => {
    if (!venueId) return { success: 0, failed: data.length };
    let success = 0, failed = 0;
    const lsStaff = API_BASE ? null : _lsGetStaff(venueId);
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
            if (API_BASE) {
              await fetch(`${SHIFTS_API}/${venueId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ staffId: staffMember.id, staffName: staffMember.name, role: staffMember.role, date: formattedDate, startTime: row.starttime, endTime: row.endtime }) });
            } else {
              lsShifts!.push({ id: `shift-${Date.now()}-${Math.random()}`, staffId: staffMember.id, staffName: staffMember.name, role: staffMember.role, date: formattedDate, startTime: row.starttime, endTime: row.endtime });
            }
            success++;
          } else { failed++; }
        } else { failed++; }
      } catch { failed++; }
    }
    if (!API_BASE && venueId) {
      if (lsStaff) _lsSaveStaff(venueId, lsStaff);
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
              <p className="text-warm-400 mt-1">Camera performance + schedule — full picture</p>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 mb-6">
            {[
              { id: 'performance' as const, label: 'Performance', icon: Camera },
              { id: 'schedule' as const, label: 'Schedule', icon: Calendar },
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
            <CameraPerformanceView
              camPerf={camPerf}
              staff={staff}
              shifts={shifts}
              jobs={allJobs}
            />
          ) : (
            <ScheduleView
              staff={staff}
              shifts={shifts}
              weekOffset={weekOffset}
              setWeekOffset={setWeekOffset}
              bartenderStats={bartenderStats}
              onAddStaff={() => setShowAddStaff(true)}
              onDeleteStaff={handleDeleteStaff}
              onAddShift={date => setShowAddShift(date)}
              onDeleteShift={handleDeleteShift}
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
                ['Mike Smith', 'server', '2026-01-20', '17:00', '23:00'],
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

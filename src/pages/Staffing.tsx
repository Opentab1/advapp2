import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Users, Calendar, Clock, Plus, X, Save, Trash2,
  TrendingUp, TrendingDown, RefreshCw, BarChart3, User
} from 'lucide-react';
import { format, parseISO, startOfWeek, endOfWeek, eachDayOfInterval, addWeeks, subWeeks } from 'date-fns';
import dynamoDBService from '../services/dynamodb.service';
import authService from '../services/auth.service';
import { PullToRefresh } from '../components/common/PullToRefresh';

// API endpoints
const API_BASE = 'https://4unsp74svc.execute-api.us-east-2.amazonaws.com/prod';
const STAFF_API = `${API_BASE}/staff`;
const SHIFTS_API = `${API_BASE}/shifts`;

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

interface StaffPerformance {
  staffId: string;
  staffName: string;
  role: string;
  shiftsWorked: number;
  avgGuestsPerShift: number;
  avgStayTime: number; // minutes
  avgOccupancy: number;
  performanceScore: number; // 0-100
}

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

export function Staffing() {
  const [activeTab, setActiveTab] = useState<'schedule' | 'performance'>('schedule');
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [performance, setPerformance] = useState<StaffPerformance[]>([]);
  const [loading, setLoading] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);
  const [showAddStaff, setShowAddStaff] = useState(false);
  const [showAddShift, setShowAddShift] = useState<string | null>(null); // date string
  
  const user = authService.getStoredUser();
  const venueId = user?.venueId;

  // Calculate current week based on offset
  const currentWeekStart = startOfWeek(addWeeks(new Date(), weekOffset), { weekStartsOn: 1 });
  const currentWeekEnd = endOfWeek(currentWeekStart, { weekStartsOn: 1 });
  const weekDays = eachDayOfInterval({ start: currentWeekStart, end: currentWeekEnd });

  const loadData = useCallback(async () => {
    if (!venueId) return;
    setLoading(true);
    
    try {
      // Load staff and shifts from API
      const [staffRes, shiftsRes] = await Promise.all([
        fetch(`${STAFF_API}/${venueId}`),
        fetch(`${SHIFTS_API}/${venueId}`)
      ]);
      
      const staffData = staffRes.ok ? await staffRes.json() : [];
      const shiftsData = shiftsRes.ok ? await shiftsRes.json() : [];
      
      // Map API response to local format
      const mappedStaff: StaffMember[] = staffData.map((s: { staffId: string; name: string; role: string; color?: string }) => ({
        id: s.staffId,
        name: s.name,
        role: s.role as StaffMember['role'],
        color: s.color || ROLE_COLORS[s.role] || ROLE_COLORS.other
      }));
      
      const mappedShifts: Shift[] = shiftsData.map((s: { shiftId: string; staffId: string; staffName: string; role: string; date: string; startTime: string; endTime: string }) => ({
        id: s.shiftId,
        staffId: s.staffId,
        staffName: s.staffName,
        role: s.role,
        date: s.date,
        startTime: s.startTime,
        endTime: s.endTime
      }));
      
      setStaff(mappedStaff);
      setShifts(mappedShifts);
      
      // Calculate performance metrics
      await calculatePerformance(mappedStaff, mappedShifts);
    } catch (error) {
      console.error('Error loading staffing data:', error);
    } finally {
      setLoading(false);
    }
  }, [venueId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const calculatePerformance = async (staffList: StaffMember[], shiftList: Shift[]) => {
    if (!venueId || staffList.length === 0) {
      setPerformance([]);
      return;
    }

    try {
      // Get 30 days of sensor data
      const data = await dynamoDBService.getHistoricalSensorData(venueId, '30d');
      if (!data?.data?.length) {
        setPerformance([]);
        return;
      }

      const performanceMap = new Map<string, {
        shifts: number;
        totalGuests: number;
        totalStayTime: number;
        totalOccupancy: number;
        dataPoints: number;
      }>();

      // Initialize performance tracking for each staff member
      staffList.forEach(s => {
        performanceMap.set(s.id, {
          shifts: 0,
          totalGuests: 0,
          totalStayTime: 0,
          totalOccupancy: 0,
          dataPoints: 0
        });
      });

      // For each shift, find matching sensor data
      shiftList.forEach(shift => {
        const shiftDate = shift.date;
        const shiftStart = parseInt(shift.startTime.split(':')[0]);
        const shiftEnd = parseInt(shift.endTime.split(':')[0]);
        
        // Find sensor readings during this shift
        const shiftReadings = data.data.filter(d => {
          const readingDate = format(new Date(d.timestamp), 'yyyy-MM-dd');
          const readingHour = new Date(d.timestamp).getHours();
          return readingDate === shiftDate && readingHour >= shiftStart && readingHour < shiftEnd;
        });

        if (shiftReadings.length > 0 && performanceMap.has(shift.staffId)) {
          const perf = performanceMap.get(shift.staffId)!;
          perf.shifts++;
          
          // Calculate guests for shift
          const withEntries = shiftReadings.filter(d => d.occupancy?.entries !== undefined);
          if (withEntries.length >= 2) {
            const sorted = withEntries.sort((a, b) => 
              new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
            );
            const guests = Math.max(0,
              (sorted[sorted.length - 1].occupancy?.entries || 0) -
              (sorted[0].occupancy?.entries || 0)
            );
            perf.totalGuests += guests;
          }
          
          // Average occupancy during shift
          const avgOcc = shiftReadings.reduce((sum, d) => sum + (d.occupancy?.current || 0), 0) / shiftReadings.length;
          perf.totalOccupancy += avgOcc;
          perf.dataPoints++;
          
          // Estimate stay time (simplified)
          const maxOcc = Math.max(...shiftReadings.map(d => d.occupancy?.current || 0));
          if (maxOcc > 0 && perf.totalGuests > 0) {
            perf.totalStayTime += (avgOcc / maxOcc) * 60; // rough estimate in minutes
          }
        }
      });

      // Convert to performance array
      const perfArray: StaffPerformance[] = [];
      staffList.forEach(s => {
        const perf = performanceMap.get(s.id);
        if (perf && perf.shifts > 0) {
          const avgGuests = Math.round(perf.totalGuests / perf.shifts);
          const avgStay = Math.round(perf.totalStayTime / perf.shifts);
          const avgOcc = Math.round(perf.totalOccupancy / perf.dataPoints);
          
          // Performance score based on guests and occupancy
          const score = Math.min(100, Math.round((avgGuests / 100) * 50 + (avgOcc / 50) * 50));
          
          perfArray.push({
            staffId: s.id,
            staffName: s.name,
            role: s.role,
            shiftsWorked: perf.shifts,
            avgGuestsPerShift: avgGuests,
            avgStayTime: avgStay || 45, // default if can't calculate
            avgOccupancy: avgOcc,
            performanceScore: score
          });
        }
      });

      // Sort by performance score
      perfArray.sort((a, b) => b.performanceScore - a.performanceScore);
      setPerformance(perfArray);
      
    } catch (error) {
      console.error('Error calculating performance:', error);
    }
  };

  const handleAddStaff = async (name: string, role: StaffMember['role']) => {
    if (!venueId) return;
    
    try {
      const response = await fetch(`${STAFF_API}/${venueId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, role, color: ROLE_COLORS[role] })
      });
      
      if (!response.ok) throw new Error('Failed to add staff');
      
      setShowAddStaff(false);
      loadData();
    } catch (error) {
      console.error('Error adding staff:', error);
      alert('Failed to add staff member. Please try again.');
    }
  };

  const handleDeleteStaff = async (staffId: string) => {
    if (!venueId) return;
    if (!confirm('Delete this staff member and all their shifts?')) return;
    
    try {
      // Delete staff member
      await fetch(`${STAFF_API}/${venueId}/${staffId}`, { method: 'DELETE' });
      
      // Delete all their shifts
      const staffShifts = shifts.filter(s => s.staffId === staffId);
      await Promise.all(
        staffShifts.map(s => fetch(`${SHIFTS_API}/${venueId}/${s.id}`, { method: 'DELETE' }))
      );
      
      loadData();
    } catch (error) {
      console.error('Error deleting staff:', error);
      alert('Failed to delete staff member. Please try again.');
    }
  };

  const handleAddShift = async (staffId: string, date: string, startTime: string, endTime: string) => {
    if (!venueId) return;
    
    const staffMember = staff.find(s => s.id === staffId);
    if (!staffMember) return;
    
    try {
      const response = await fetch(`${SHIFTS_API}/${venueId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staffId,
          staffName: staffMember.name,
          role: staffMember.role,
          date,
          startTime,
          endTime
        })
      });
      
      if (!response.ok) throw new Error('Failed to add shift');
      
      setShowAddShift(null);
      loadData();
    } catch (error) {
      console.error('Error adding shift:', error);
      alert('Failed to add shift. Please try again.');
    }
  };

  const handleDeleteShift = async (shiftId: string) => {
    if (!venueId) return;
    
    try {
      await fetch(`${SHIFTS_API}/${venueId}/${shiftId}`, { method: 'DELETE' });
      loadData();
    } catch (error) {
      console.error('Error deleting shift:', error);
    }
  };

  const getShiftsForDay = (date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    return shifts.filter(s => s.date === dateStr);
  };

  const handleRefresh = async () => {
    await loadData();
  };

  return (
    <PullToRefresh onRefresh={handleRefresh}>
      <div className="max-w-6xl mx-auto space-y-6 pb-20">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                <Users className="w-8 h-8 text-primary" />
                Staffing
              </h1>
              <p className="text-warm-400 mt-1">Track schedules and measure staff impact</p>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 mb-6">
            {[
              { id: 'schedule' as const, label: 'Schedule', icon: Calendar },
              { id: 'performance' as const, label: 'Performance', icon: BarChart3 },
            ].map((tab) => (
              <motion.button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${
                  activeTab === tab.id
                    ? 'bg-primary/20 border border-primary/50 text-white'
                    : 'bg-warm-800 border border-warm-700 text-warm-400 hover:text-white'
                }`}
                whileTap={{ scale: 0.95 }}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </motion.button>
            ))}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-24">
              <RefreshCw className="w-8 h-8 text-primary animate-spin" />
            </div>
          ) : activeTab === 'schedule' ? (
            <>
              {/* Staff List */}
              <div className="glass-card p-4 mb-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                    <User className="w-5 h-5 text-primary" />
                    Team Members
                  </h2>
                  <motion.button
                    onClick={() => setShowAddStaff(true)}
                    className="btn-primary text-sm flex items-center gap-1"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <Plus className="w-4 h-4" />
                    Add Staff
                  </motion.button>
                </div>
                
                {staff.length === 0 ? (
                  <p className="text-warm-400 text-center py-4">No staff members yet. Add your team to start tracking.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {staff.map(s => (
                      <div
                        key={s.id}
                        className="flex items-center gap-2 px-3 py-2 bg-warm-800 rounded-lg group"
                      >
                        <div className={`w-3 h-3 rounded-full ${ROLE_COLORS[s.role]}`} />
                        <span className="text-white">{s.name}</span>
                        <span className="text-xs text-warm-400">({ROLE_LABELS[s.role]})</span>
                        <button
                          onClick={() => handleDeleteStaff(s.id)}
                          className="opacity-0 group-hover:opacity-100 text-warm-500 hover:text-red-400 transition-all"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Week Navigation */}
              <div className="flex items-center justify-between mb-4">
                <button
                  onClick={() => setWeekOffset(w => w - 1)}
                  className="btn-secondary text-sm"
                >
                  ← Previous Week
                </button>
                <div className="text-white font-medium">
                  {format(currentWeekStart, 'MMM d')} - {format(currentWeekEnd, 'MMM d, yyyy')}
                </div>
                <button
                  onClick={() => setWeekOffset(w => w + 1)}
                  className="btn-secondary text-sm"
                >
                  Next Week →
                </button>
              </div>

              {/* Week Schedule Grid */}
              <div className="grid grid-cols-7 gap-2">
                {weekDays.map(day => {
                  const dayShifts = getShiftsForDay(day);
                  const isToday = format(day, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');
                  const dateStr = format(day, 'yyyy-MM-dd');
                  
                  return (
                    <div
                      key={dateStr}
                      className={`glass-card p-3 min-h-[150px] ${isToday ? 'ring-2 ring-primary' : ''}`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <div className={`text-xs ${isToday ? 'text-primary' : 'text-warm-400'}`}>
                            {format(day, 'EEE')}
                          </div>
                          <div className="text-lg font-bold text-white">{format(day, 'd')}</div>
                        </div>
                        <button
                          onClick={() => setShowAddShift(dateStr)}
                          className="text-warm-500 hover:text-primary transition-colors"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                      
                      <div className="space-y-1">
                        {dayShifts.map(shift => (
                          <div
                            key={shift.id}
                            className={`text-xs p-1.5 rounded ${ROLE_COLORS[shift.role]} bg-opacity-20 group relative`}
                          >
                            <div className="font-medium text-white truncate">{shift.staffName}</div>
                            <div className="text-warm-300">{shift.startTime}-{shift.endTime}</div>
                            <button
                              onClick={() => handleDeleteShift(shift.id)}
                              className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 text-red-400"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            /* Performance Tab */
            <div className="space-y-4">
              {performance.length === 0 ? (
                <div className="glass-card p-12 text-center">
                  <BarChart3 className="w-12 h-12 text-warm-600 mx-auto mb-3" />
                  <p className="text-warm-400 mb-2">No performance data yet</p>
                  <p className="text-sm text-warm-500">Add staff and log their shifts to see performance metrics</p>
                </div>
              ) : (
                <>
                  <div className="glass-card p-4">
                    <h2 className="text-lg font-semibold text-white mb-4">Staff Performance Rankings</h2>
                    <p className="text-sm text-warm-400 mb-4">
                      Based on guest counts and occupancy during each staff member's shifts
                    </p>
                    
                    <div className="space-y-3">
                      {performance.map((perf, i) => (
                        <motion.div
                          key={perf.staffId}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.05 }}
                          className="flex items-center gap-4 p-4 bg-warm-800 rounded-xl"
                        >
                          <div className={`w-10 h-10 rounded-full ${ROLE_COLORS[perf.role]} flex items-center justify-center text-white font-bold`}>
                            {i + 1}
                          </div>
                          
                          <div className="flex-1">
                            <div className="font-medium text-white">{perf.staffName}</div>
                            <div className="text-xs text-warm-400">{ROLE_LABELS[perf.role]} • {perf.shiftsWorked} shifts</div>
                          </div>
                          
                          <div className="grid grid-cols-3 gap-6 text-center">
                            <div>
                              <div className="text-lg font-bold text-white">{perf.avgGuestsPerShift}</div>
                              <div className="text-xs text-warm-400">Avg Guests</div>
                            </div>
                            <div>
                              <div className="text-lg font-bold text-white">{perf.avgStayTime} min</div>
                              <div className="text-xs text-warm-400">Avg Stay</div>
                            </div>
                            <div>
                              <div className={`text-lg font-bold ${perf.performanceScore >= 70 ? 'text-emerald-400' : perf.performanceScore >= 40 ? 'text-amber-400' : 'text-red-400'}`}>
                                {perf.performanceScore}
                              </div>
                              <div className="text-xs text-warm-400">Score</div>
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                  
                  <div className="glass-card p-4 border-l-4 border-primary">
                    <p className="text-sm text-warm-400">
                      <strong className="text-white">How scores are calculated:</strong> Performance scores combine average guest counts and occupancy levels during each staff member's shifts. Higher scores indicate shifts with more guests and better crowd retention.
                    </p>
                  </div>
                </>
              )}
            </div>
          )}
        </motion.div>

        {/* Add Staff Modal */}
        <AnimatePresence>
          {showAddStaff && (
            <AddStaffModal
              onClose={() => setShowAddStaff(false)}
              onSave={handleAddStaff}
            />
          )}
        </AnimatePresence>

        {/* Add Shift Modal */}
        <AnimatePresence>
          {showAddShift && (
            <AddShiftModal
              date={showAddShift}
              staff={staff}
              onClose={() => setShowAddShift(null)}
              onSave={handleAddShift}
            />
          )}
        </AnimatePresence>
      </div>
    </PullToRefresh>
  );
}

// Add Staff Modal
function AddStaffModal({ onClose, onSave }: { onClose: () => void; onSave: (name: string, role: StaffMember['role']) => void }) {
  const [name, setName] = useState('');
  const [role, setRole] = useState<StaffMember['role']>('bartender');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave(name.trim(), role);
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
          <h3 className="text-xl font-bold text-white">Add Staff Member</h3>
          <button onClick={onClose} className="text-warm-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-warm-400 mb-2">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g., Sarah Johnson"
              className="w-full bg-warm-800 rounded-lg px-4 py-3 text-white placeholder-warm-500 focus:outline-none focus:ring-2 focus:ring-primary"
              required
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm text-warm-400 mb-2">Role</label>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(ROLE_LABELS).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setRole(key as StaffMember['role'])}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
                    role === key
                      ? 'bg-primary/20 border border-primary/30 text-white'
                      : 'bg-warm-800 text-warm-400 hover:text-white'
                  }`}
                >
                  <div className={`w-3 h-3 rounded-full ${ROLE_COLORS[key]}`} />
                  <span className="text-sm">{label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 btn-secondary">
              Cancel
            </button>
            <button type="submit" className="flex-1 btn-primary flex items-center justify-center gap-2">
              <Save className="w-4 h-4" />
              Add Staff
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

// Add Shift Modal
function AddShiftModal({ 
  date, 
  staff, 
  onClose, 
  onSave 
}: { 
  date: string; 
  staff: StaffMember[]; 
  onClose: () => void; 
  onSave: (staffId: string, date: string, startTime: string, endTime: string) => void;
}) {
  const [staffId, setStaffId] = useState(staff[0]?.id || '');
  const [startTime, setStartTime] = useState('18:00');
  const [endTime, setEndTime] = useState('02:00');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!staffId) return;
    onSave(staffId, date, startTime, endTime);
  };

  if (staff.length === 0) {
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
          className="glass-card p-6 w-full max-w-md text-center"
          onClick={e => e.stopPropagation()}
        >
          <Users className="w-12 h-12 text-warm-600 mx-auto mb-3" />
          <p className="text-warm-400 mb-4">Add staff members first before creating shifts</p>
          <button onClick={onClose} className="btn-primary">Got it</button>
        </motion.div>
      </motion.div>
    );
  }

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
          <h3 className="text-xl font-bold text-white">Add Shift</h3>
          <button onClick={onClose} className="text-warm-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-warm-400 mb-4">
          {format(parseISO(date), 'EEEE, MMMM d, yyyy')}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-warm-400 mb-2">Staff Member</label>
            <select
              value={staffId}
              onChange={e => setStaffId(e.target.value)}
              className="w-full bg-warm-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {staff.map(s => (
                <option key={s.id} value={s.id}>{s.name} ({ROLE_LABELS[s.role]})</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-warm-400 mb-2">Start Time</label>
              <input
                type="time"
                value={startTime}
                onChange={e => setStartTime(e.target.value)}
                className="w-full bg-warm-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-sm text-warm-400 mb-2">End Time</label>
              <input
                type="time"
                value={endTime}
                onChange={e => setEndTime(e.target.value)}
                className="w-full bg-warm-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 btn-secondary">
              Cancel
            </button>
            <button type="submit" className="flex-1 btn-primary flex items-center justify-center gap-2">
              <Save className="w-4 h-4" />
              Add Shift
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

export default Staffing;

/**
 * Staff Service - Manages staff roster and shift tracking
 * 
 * Stores:
 * - Staff roster (local storage for now)
 * - Active staff (who's working tonight)
 * - Shift history with performance data
 */

import authService from './auth.service';

// ============ TYPES ============

export interface StaffMember {
  id: string;
  name: string;
  role: 'manager' | 'bartender' | 'server' | 'host' | 'other';
  avatar?: string; // Optional photo URL
  createdAt: string;
}

export interface StaffShift {
  id: string;
  staffId: string;
  startTime: string;
  endTime?: string;
  avgPulseScore: number;
  peakOccupancy: number;
  actionsCompleted: number;
  // Snapshots taken during the shift
  pulseScores: number[];
}

export interface StaffPerformance {
  staffId: string;
  staffName: string;
  staffRole: string;
  avgPulseScore: number;
  totalShifts: number;
  avgDwellMinutes: number;
  totalActionsCompleted: number;
  bestShift: { date: string; score: number } | null;
  recentShifts: StaffShift[];
}

// ============ STORAGE KEYS ============

const getStorageKey = (venueId: string, key: string) => `pulse_staff_${venueId}_${key}`;

// ============ SERVICE ============

class StaffService {
  private getVenueId(): string {
    const user = authService.getStoredUser();
    return user?.venueId || 'default';
  }

  // ============ ROSTER MANAGEMENT ============

  getRoster(): StaffMember[] {
    const venueId = this.getVenueId();
    const key = getStorageKey(venueId, 'roster');
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : [];
  }

  addStaffMember(member: Omit<StaffMember, 'id' | 'createdAt'>): StaffMember {
    const roster = this.getRoster();
    const newMember: StaffMember = {
      ...member,
      id: `staff_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: new Date().toISOString(),
    };
    roster.push(newMember);
    this.saveRoster(roster);
    return newMember;
  }

  updateStaffMember(id: string, updates: Partial<StaffMember>): StaffMember | null {
    const roster = this.getRoster();
    const index = roster.findIndex(m => m.id === id);
    if (index === -1) return null;
    
    roster[index] = { ...roster[index], ...updates };
    this.saveRoster(roster);
    return roster[index];
  }

  removeStaffMember(id: string): boolean {
    const roster = this.getRoster();
    const filtered = roster.filter(m => m.id !== id);
    if (filtered.length === roster.length) return false;
    
    this.saveRoster(filtered);
    return true;
  }

  private saveRoster(roster: StaffMember[]): void {
    const venueId = this.getVenueId();
    const key = getStorageKey(venueId, 'roster');
    localStorage.setItem(key, JSON.stringify(roster));
  }

  // ============ ACTIVE STAFF ============

  getActiveStaff(): string[] {
    const venueId = this.getVenueId();
    const key = getStorageKey(venueId, 'active');
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : [];
  }

  setActiveStaff(staffIds: string[]): void {
    const venueId = this.getVenueId();
    const key = getStorageKey(venueId, 'active');
    localStorage.setItem(key, JSON.stringify(staffIds));
    
    // Start shifts for newly active staff
    const currentActive = this.getActiveStaff();
    const newlyActive = staffIds.filter(id => !currentActive.includes(id));
    newlyActive.forEach(id => this.startShift(id));
  }

  toggleStaffActive(staffId: string): boolean {
    const active = this.getActiveStaff();
    const isActive = active.includes(staffId);
    
    if (isActive) {
      // End shift and remove from active
      this.endShift(staffId);
      this.setActiveStaff(active.filter(id => id !== staffId));
      return false;
    } else {
      // Add to active and start shift
      this.setActiveStaff([...active, staffId]);
      return true;
    }
  }

  isStaffActive(staffId: string): boolean {
    return this.getActiveStaff().includes(staffId);
  }

  // ============ SHIFT TRACKING ============

  private getShifts(): StaffShift[] {
    const venueId = this.getVenueId();
    const key = getStorageKey(venueId, 'shifts');
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : [];
  }

  private saveShifts(shifts: StaffShift[]): void {
    const venueId = this.getVenueId();
    const key = getStorageKey(venueId, 'shifts');
    // Keep last 90 days of shifts
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const filtered = shifts.filter(s => new Date(s.startTime) > cutoff);
    localStorage.setItem(key, JSON.stringify(filtered));
  }

  startShift(staffId: string): StaffShift {
    const shifts = this.getShifts();
    const newShift: StaffShift = {
      id: `shift_${Date.now()}`,
      staffId,
      startTime: new Date().toISOString(),
      avgPulseScore: 0,
      peakOccupancy: 0,
      actionsCompleted: 0,
      pulseScores: [],
    };
    shifts.push(newShift);
    this.saveShifts(shifts);
    return newShift;
  }

  endShift(staffId: string): StaffShift | null {
    const shifts = this.getShifts();
    const activeShift = shifts.find(s => s.staffId === staffId && !s.endTime);
    if (!activeShift) return null;
    
    activeShift.endTime = new Date().toISOString();
    // Calculate average from collected scores
    if (activeShift.pulseScores.length > 0) {
      activeShift.avgPulseScore = Math.round(
        activeShift.pulseScores.reduce((sum, s) => sum + s, 0) / activeShift.pulseScores.length
      );
    }
    this.saveShifts(shifts);
    return activeShift;
  }

  recordPulseScore(pulseScore: number, occupancy: number): void {
    const activeStaff = this.getActiveStaff();
    if (activeStaff.length === 0) return;
    
    const shifts = this.getShifts();
    let updated = false;
    
    activeStaff.forEach(staffId => {
      const activeShift = shifts.find(s => s.staffId === staffId && !s.endTime);
      if (activeShift) {
        activeShift.pulseScores.push(pulseScore);
        if (occupancy > activeShift.peakOccupancy) {
          activeShift.peakOccupancy = occupancy;
        }
        updated = true;
      }
    });
    
    if (updated) {
      this.saveShifts(shifts);
    }
  }

  recordActionCompleted(): void {
    const activeStaff = this.getActiveStaff();
    if (activeStaff.length === 0) return;
    
    const shifts = this.getShifts();
    let updated = false;
    
    activeStaff.forEach(staffId => {
      const activeShift = shifts.find(s => s.staffId === staffId && !s.endTime);
      if (activeShift) {
        activeShift.actionsCompleted++;
        updated = true;
      }
    });
    
    if (updated) {
      this.saveShifts(shifts);
    }
  }

  getActiveShift(staffId: string): StaffShift | null {
    const shifts = this.getShifts();
    return shifts.find(s => s.staffId === staffId && !s.endTime) || null;
  }

  // ============ PERFORMANCE STATS ============

  getStaffPerformance(staffId: string): StaffPerformance | null {
    const roster = this.getRoster();
    const member = roster.find(m => m.id === staffId);
    if (!member) return null;
    
    const shifts = this.getShifts().filter(s => s.staffId === staffId && s.endTime);
    
    if (shifts.length === 0) {
      return {
        staffId,
        staffName: member.name,
        staffRole: member.role,
        avgPulseScore: 0,
        totalShifts: 0,
        avgDwellMinutes: 0,
        totalActionsCompleted: 0,
        bestShift: null,
        recentShifts: [],
      };
    }
    
    const totalScore = shifts.reduce((sum, s) => sum + s.avgPulseScore, 0);
    const totalActions = shifts.reduce((sum, s) => sum + s.actionsCompleted, 0);
    
    // Find best shift
    const bestShift = shifts.reduce((best, current) => 
      current.avgPulseScore > (best?.avgPulseScore || 0) ? current : best
    , shifts[0]);
    
    return {
      staffId,
      staffName: member.name,
      staffRole: member.role,
      avgPulseScore: Math.round(totalScore / shifts.length),
      totalShifts: shifts.length,
      avgDwellMinutes: 45, // Would need real data
      totalActionsCompleted: totalActions,
      bestShift: bestShift ? {
        date: bestShift.startTime,
        score: bestShift.avgPulseScore,
      } : null,
      recentShifts: shifts.slice(-10).reverse(),
    };
  }

  getLeaderboard(): StaffPerformance[] {
    const roster = this.getRoster();
    const performances = roster
      .map(member => this.getStaffPerformance(member.id))
      .filter((p): p is StaffPerformance => p !== null && p.totalShifts > 0);
    
    // Sort by avg pulse score descending
    return performances.sort((a, b) => b.avgPulseScore - a.avgPulseScore);
  }

  getTeamAverage(): number {
    const leaderboard = this.getLeaderboard();
    if (leaderboard.length === 0) return 0;
    
    const total = leaderboard.reduce((sum, p) => sum + p.avgPulseScore, 0);
    return Math.round(total / leaderboard.length);
  }
}

export const staffService = new StaffService();
export default staffService;

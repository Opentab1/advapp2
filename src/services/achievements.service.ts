/**
 * Achievements Service - Personal Records, Streaks, Goals, Insights
 * 
 * Tracks:
 * - Personal records (best Pulse, busiest night, etc.)
 * - Streaks (consecutive nights above threshold)
 * - Weekly goals and progress
 * - AI-style insights based on patterns
 */

import authService from './auth.service';
import staffService from './staff.service';
import {
  loadVenueSetting, saveVenueSetting, peekVenueSetting,
} from './venueSettings.service';

// ============ TYPES ============

export interface PersonalRecord {
  id: string;
  label: string;
  value: number;
  unit: string;
  date: string;
  previousValue?: number;
  previousDate?: string;
}

export interface Streak {
  current: number;
  best: number;
  threshold: number;
  lastDate: string | null;
  isActive: boolean;
}

export interface WeeklyGoal {
  target: number;
  currentAvg: number;
  daysTracked: number;
  dailyScores: { date: string; score: number }[];
  achieved: boolean;
  weekStart: string;
}

export interface Insight {
  id: string;
  type: 'staff' | 'time' | 'environment' | 'trend';
  icon: string;
  title: string;
  description: string;
  actionable?: string;
  confidence: number; // 0-1
}

export interface NewRecordEvent {
  record: PersonalRecord;
  isNew: boolean;
  improvement?: number;
}

// ============ STORAGE ============
//
// All three achievement sub-blobs (records, streak, weeklyGoal) live in one
// DDB blob under venue settings key 'achievements'. Keeping them together
// lets a single load/save cover the whole feature — and more importantly,
// lets a phone that logs in for the first time see the same streak and
// records the user set on their laptop.

interface _AchievementsBlob {
  records: PersonalRecord[];
  streak: Streak | null;
  weeklyGoal: WeeklyGoal | null;
}

const _EMPTY_BLOB: _AchievementsBlob = {
  records: [], streak: null, weeklyGoal: null,
};

// ============ SERVICE ============

class AchievementsService {
  private getVenueId(): string {
    const user = authService.getStoredUser();
    return user?.venueId || 'default';
  }

  /**
   * Pull the full achievements blob from DynamoDB into the local cache so the
   * synchronous getRecords/getStreak/getWeeklyGoal accessors below return
   * cross-device data. Call once when the achievements UI mounts.
   */
  async hydrate(): Promise<void> {
    const venueId = this.getVenueId();
    await loadVenueSetting<_AchievementsBlob>('achievements', _EMPTY_BLOB, venueId);
  }

  private readBlob(): _AchievementsBlob {
    const venueId = this.getVenueId();
    return peekVenueSetting<_AchievementsBlob>('achievements', _EMPTY_BLOB, venueId);
  }

  private writeBlob(blob: _AchievementsBlob): void {
    const venueId = this.getVenueId();
    // Fire-and-forget — cache is updated synchronously so subsequent reads
    // are already consistent even before the server round-trip completes.
    void saveVenueSetting('achievements', blob, venueId);
  }

  // ============ PERSONAL RECORDS ============

  getRecords(): PersonalRecord[] {
    return this.readBlob().records;
  }

  private saveRecords(records: PersonalRecord[]): void {
    this.writeBlob({ ...this.readBlob(), records });
  }

  checkAndUpdateRecord(
    id: string,
    label: string,
    value: number,
    unit: string
  ): NewRecordEvent | null {
    const records = this.getRecords();
    const existing = records.find(r => r.id === id);
    const today = new Date().toISOString();

    if (!existing) {
      // First record
      const newRecord: PersonalRecord = { id, label, value, unit, date: today };
      records.push(newRecord);
      this.saveRecords(records);
      return { record: newRecord, isNew: true };
    }

    if (value > existing.value) {
      // New record!
      const improvement = value - existing.value;
      const updatedRecord: PersonalRecord = {
        id,
        label,
        value,
        unit,
        date: today,
        previousValue: existing.value,
        previousDate: existing.date,
      };
      const index = records.findIndex(r => r.id === id);
      records[index] = updatedRecord;
      this.saveRecords(records);
      return { record: updatedRecord, isNew: true, improvement };
    }

    return null; // No new record
  }

  getRecord(id: string): PersonalRecord | null {
    const records = this.getRecords();
    return records.find(r => r.id === id) || null;
  }

  // ============ STREAKS ============

  getStreak(): Streak {
    return this.readBlob().streak ?? {
      current: 0,
      best: 0,
      threshold: 75,
      lastDate: null,
      isActive: false,
    };
  }

  private saveStreak(streak: Streak): void {
    this.writeBlob({ ...this.readBlob(), streak });
  }

  updateStreak(todayScore: number): { streakBroken: boolean; newMilestone: number | null } {
    const streak = this.getStreak();
    const today = new Date().toDateString();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toDateString();

    let streakBroken = false;
    let newMilestone: number | null = null;

    // Check if already recorded today
    if (streak.lastDate === today) {
      return { streakBroken: false, newMilestone: null };
    }

    if (todayScore >= streak.threshold) {
      // Check if continuing streak or starting new
      if (streak.lastDate === yesterdayStr || streak.current === 0) {
        streak.current++;
        streak.isActive = true;
        
        // Check for milestones
        if ([7, 14, 21, 30, 60, 90].includes(streak.current)) {
          newMilestone = streak.current;
        }
        
        // Update best
        if (streak.current > streak.best) {
          streak.best = streak.current;
        }
      } else {
        // Gap in days, but still above threshold - restart streak
        streak.current = 1;
        streak.isActive = true;
      }
    } else {
      // Below threshold - break streak
      if (streak.isActive) {
        streakBroken = true;
      }
      streak.current = 0;
      streak.isActive = false;
    }

    streak.lastDate = today;
    this.saveStreak(streak);

    return { streakBroken, newMilestone };
  }

  setStreakThreshold(threshold: number): void {
    const streak = this.getStreak();
    streak.threshold = threshold;
    this.saveStreak(streak);
  }

  // ============ WEEKLY GOALS ============

  getWeeklyGoal(): WeeklyGoal | null {
    const goal = this.readBlob().weeklyGoal;
    if (!goal) return null;

    // Check if it's a new week
    const currentWeekStart = this.getWeekStart(new Date());
    if (goal.weekStart !== currentWeekStart) {
      // New week - reset progress but keep target
      return {
        ...goal,
        currentAvg: 0,
        daysTracked: 0,
        dailyScores: [],
        achieved: false,
        weekStart: currentWeekStart,
      };
    }

    return goal;
  }

  setWeeklyGoalTarget(target: number): void {
    const existing = this.getWeeklyGoal();
    const weekStart = this.getWeekStart(new Date());
    
    const goal: WeeklyGoal = {
      target,
      currentAvg: existing?.currentAvg || 0,
      daysTracked: existing?.daysTracked || 0,
      dailyScores: existing?.dailyScores || [],
      achieved: existing?.achieved || false,
      weekStart,
    };
    
    this.saveWeeklyGoal(goal);
  }

  recordDailyScore(score: number): { goalAchieved: boolean } {
    let goal = this.getWeeklyGoal();
    if (!goal) {
      // No goal set
      return { goalAchieved: false };
    }

    const today = new Date().toDateString();
    
    // Check if already recorded today
    const existingIndex = goal.dailyScores.findIndex(d => d.date === today);
    if (existingIndex >= 0) {
      // Update existing
      goal.dailyScores[existingIndex].score = score;
    } else {
      // Add new
      goal.dailyScores.push({ date: today, score });
      goal.daysTracked++;
    }

    // Recalculate average
    const total = goal.dailyScores.reduce((sum, d) => sum + d.score, 0);
    goal.currentAvg = Math.round(total / goal.dailyScores.length);
    
    // Check if achieved
    const wasAchieved = goal.achieved;
    goal.achieved = goal.currentAvg >= goal.target && goal.daysTracked >= 3;
    
    this.saveWeeklyGoal(goal);
    
    return { goalAchieved: !wasAchieved && goal.achieved };
  }

  private saveWeeklyGoal(goal: WeeklyGoal): void {
    this.writeBlob({ ...this.readBlob(), weeklyGoal: goal });
  }

  private getWeekStart(date: Date): string {
    const d = new Date(date);
    const day = d.getDay();
    d.setDate(d.getDate() - day);
    d.setHours(0, 0, 0, 0);
    return d.toISOString().split('T')[0];
  }

  // ============ SMART INSIGHTS ============

  generateInsights(): Insight[] {
    const insights: Insight[] = [];

    // Staff insights
    const staffInsights = this.generateStaffInsights();
    insights.push(...staffInsights);

    // Time insights
    const timeInsights = this.generateTimeInsights();
    insights.push(...timeInsights);

    // Trend insights
    const trendInsights = this.generateTrendInsights();
    insights.push(...trendInsights);

    // Sort by confidence and return top 3
    return insights
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 3);
  }

  private generateStaffInsights(): Insight[] {
    const insights: Insight[] = [];
    const leaderboard = staffService.getLeaderboard();
    const teamAvg = staffService.getTeamAverage();

    if (leaderboard.length >= 2) {
      const top = leaderboard[0];
      const diff = top.avgPulseScore - teamAvg;
      
      if (diff >= 5 && top.totalShifts >= 3) {
        insights.push({
          id: 'staff-top-performer',
          type: 'staff',
          icon: '⭐',
          title: `${top.staffName} is your top performer`,
          description: `Their shifts average ${diff} points higher than team average.`,
          actionable: `Consider scheduling ${top.staffName.split(' ')[0]} on your busiest nights.`,
          confidence: Math.min(0.9, 0.5 + (top.totalShifts * 0.05)),
        });
      }

      const bottom = leaderboard[leaderboard.length - 1];
      const bottomDiff = teamAvg - bottom.avgPulseScore;
      
      if (bottomDiff >= 8 && bottom.totalShifts >= 3) {
        insights.push({
          id: 'staff-needs-coaching',
          type: 'staff',
          icon: '📈',
          title: `${bottom.staffName} could use support`,
          description: `Their shifts average ${bottomDiff} points below team average.`,
          actionable: `Pair them with ${top.staffName.split(' ')[0]} for a shift to share best practices.`,
          confidence: Math.min(0.85, 0.4 + (bottom.totalShifts * 0.05)),
        });
      }
    }

    return insights;
  }

  private generateTimeInsights(): Insight[] {
    const insights: Insight[] = [];
    const streak = this.getStreak();
    const goal = this.getWeeklyGoal();

    // Streak insight
    if (streak.current >= 3) {
      insights.push({
        id: 'streak-momentum',
        type: 'trend',
        icon: '🔥',
        title: `You're on a ${streak.current}-night streak!`,
        description: `Consistently hitting ${streak.threshold}+ Pulse Score.`,
        actionable: 'Keep the momentum going tonight.',
        confidence: 0.95,
      });
    }

    // Goal insight
    if (goal && goal.daysTracked >= 2 && !goal.achieved) {
      const needed = goal.target - goal.currentAvg;
      if (needed > 0 && needed <= 10) {
        insights.push({
          id: 'goal-close',
          type: 'trend',
          icon: '🎯',
          title: `You're ${needed} points from your weekly goal`,
          description: `Current avg: ${goal.currentAvg}, Target: ${goal.target}`,
          actionable: 'Focus on sound levels tonight to close the gap.',
          confidence: 0.9,
        });
      }
    }

    return insights;
  }

  private generateTrendInsights(): Insight[] {
    const insights: Insight[] = [];
    const records = this.getRecords();

    // Recent record insight
    const recentRecord = records.find(r => {
      const recordDate = new Date(r.date);
      const daysSince = (Date.now() - recordDate.getTime()) / (1000 * 60 * 60 * 24);
      return daysSince <= 7 && r.previousValue;
    });

    if (recentRecord && recentRecord.previousValue !== undefined) {
      const improvement = recentRecord.value - recentRecord.previousValue;
      if (improvement > 0) {
        insights.push({
          id: 'recent-record',
          type: 'trend',
          icon: '🏆',
          title: `You set a new ${recentRecord.label} record!`,
          description: `${recentRecord.value}${recentRecord.unit} — up ${improvement} from your previous best.`,
          confidence: 1,
        });
      }
    }

    // General improvement suggestion
    const pulseRecord = records.find(r => r.id === 'best-pulse');
    if (!pulseRecord || pulseRecord.value < 85) {
      insights.push({
        id: 'improvement-tip',
        type: 'environment',
        icon: '💡',
        title: 'Quick win: Check your sound levels',
        description: 'Keeping sound between 70-78 dB typically adds 5-10 points to Pulse Score.',
        actionable: 'Watch the Live Stats panel and adjust when it goes red.',
        confidence: 0.7,
      });
    }

    return insights;
  }
}

export const achievementsService = new AchievementsService();
export default achievementsService;

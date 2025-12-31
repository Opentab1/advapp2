/**
 * useSessionMemory - Tracks user sessions and provides "Since You Left" data
 * 
 * Addresses the "No Memory Across Sessions" problem:
 * - Stores session snapshots in localStorage
 * - Calculates deltas between last visit and now
 * - Enables "Welcome Back" experiences
 * - Tracks visit patterns over time
 */

import { useState, useEffect, useCallback, useRef } from 'react';

// ============ TYPES ============

export interface SessionSnapshot {
  timestamp: number;
  pulseScore: number | null;
  decibels: number | null;
  light: number | null;
  occupancy: number;
  dayOfWeek: number;
  hourOfDay: number;
}

export interface SessionDelta {
  pulseChange: number | null;
  decibelChange: number | null;
  lightChange: number | null;
  occupancyChange: number | null;
  timeSinceLastVisit: number; // in minutes
  lastVisitFormatted: string;
  isSameDay: boolean;
  isSameHour: boolean;
}

export interface SessionMemoryData {
  // Last session data
  lastSession: SessionSnapshot | null;
  
  // Current vs last session deltas
  delta: SessionDelta | null;
  
  // Visit history
  visitCount: number;
  lastVisitTimestamp: number | null;
  
  // Patterns
  averagePulseScore: number | null;
  bestPulseScore: number | null;
  typicalVisitHour: number | null;
}

export interface UseSessionMemoryOptions {
  venueId?: string;
  enabled?: boolean;
}

export interface UseSessionMemoryReturn extends SessionMemoryData {
  // Actions
  saveCurrentSession: (snapshot: Omit<SessionSnapshot, 'timestamp' | 'dayOfWeek' | 'hourOfDay'>) => void;
  clearHistory: () => void;
  
  // State
  isNewUser: boolean;
  isReturningUser: boolean;
  hasRecentVisit: boolean; // visited in last 24 hours
  showWelcomeBack: boolean;
  dismissWelcomeBack: () => void;
}

// ============ CONSTANTS ============

const STORAGE_KEY_PREFIX = 'pulse_session_';
const MAX_HISTORY_ITEMS = 30;
const WELCOME_BACK_THRESHOLD = 5 * 60 * 1000; // 5 minutes - show welcome back if away longer

// ============ HELPER FUNCTIONS ============

function getStorageKey(venueId: string): string {
  return `${STORAGE_KEY_PREFIX}${venueId}`;
}

function formatTimeSince(minutes: number): string {
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${Math.round(minutes)} min ago`;
  if (minutes < 120) return '1 hour ago';
  if (minutes < 1440) return `${Math.round(minutes / 60)} hours ago`;
  if (minutes < 2880) return 'Yesterday';
  return `${Math.round(minutes / 1440)} days ago`;
}

function isSameDayCheck(timestamp1: number, timestamp2: number): boolean {
  const d1 = new Date(timestamp1);
  const d2 = new Date(timestamp2);
  return d1.toDateString() === d2.toDateString();
}

// ============ MAIN HOOK ============

export function useSessionMemory(options: UseSessionMemoryOptions = {}): UseSessionMemoryReturn {
  const { venueId = 'default', enabled = true } = options;

  // State
  const [lastSession, setLastSession] = useState<SessionSnapshot | null>(null);
  const [sessionHistory, setSessionHistory] = useState<SessionSnapshot[]>([]);
  const [showWelcomeBack, setShowWelcomeBack] = useState(false);
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);

  const storageKey = getStorageKey(venueId);
  const initialLoadRef = useRef(false);

  // Load history from localStorage on mount
  useEffect(() => {
    if (!enabled || initialLoadRef.current) return;
    initialLoadRef.current = true;

    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const data = JSON.parse(stored);
        if (data.history && Array.isArray(data.history)) {
          setSessionHistory(data.history);
          if (data.history.length > 0) {
            const last = data.history[data.history.length - 1];
            setLastSession(last);
            
            // Determine if we should show welcome back
            const timeSinceLastVisit = Date.now() - last.timestamp;
            if (timeSinceLastVisit > WELCOME_BACK_THRESHOLD && !welcomeDismissed) {
              setShowWelcomeBack(true);
            }
          }
        }
      }
    } catch (e) {
      console.error('Failed to load session history:', e);
    }
  }, [enabled, storageKey, welcomeDismissed]);

  // Save current session snapshot
  const saveCurrentSession = useCallback((snapshot: Omit<SessionSnapshot, 'timestamp' | 'dayOfWeek' | 'hourOfDay'>) => {
    if (!enabled) return;

    const now = new Date();
    const fullSnapshot: SessionSnapshot = {
      ...snapshot,
      timestamp: Date.now(),
      dayOfWeek: now.getDay(),
      hourOfDay: now.getHours(),
    };

    setSessionHistory(prev => {
      // Don't save if last save was within 1 minute (prevent spam)
      if (prev.length > 0) {
        const lastSave = prev[prev.length - 1];
        if (Date.now() - lastSave.timestamp < 60000) {
          return prev;
        }
      }

      const updated = [...prev, fullSnapshot].slice(-MAX_HISTORY_ITEMS);
      
      // Persist to localStorage
      try {
        localStorage.setItem(storageKey, JSON.stringify({ history: updated }));
      } catch (e) {
        console.error('Failed to save session:', e);
      }
      
      return updated;
    });

    setLastSession(fullSnapshot);
  }, [enabled, storageKey]);

  // Clear all history
  const clearHistory = useCallback(() => {
    setSessionHistory([]);
    setLastSession(null);
    try {
      localStorage.removeItem(storageKey);
    } catch (e) {
      console.error('Failed to clear session history:', e);
    }
  }, [storageKey]);

  // Dismiss welcome back
  const dismissWelcomeBack = useCallback(() => {
    setShowWelcomeBack(false);
    setWelcomeDismissed(true);
  }, []);

  // Calculate delta between last session and now (reserved for future use)
  const _calculateDelta = useCallback((current: SessionSnapshot | null): SessionDelta | null => {
    if (!lastSession || !current) return null;

    const timeSinceLastVisit = (Date.now() - lastSession.timestamp) / 60000; // minutes

    return {
      pulseChange: current.pulseScore !== null && lastSession.pulseScore !== null
        ? current.pulseScore - lastSession.pulseScore
        : null,
      decibelChange: current.decibels !== null && lastSession.decibels !== null
        ? current.decibels - lastSession.decibels
        : null,
      lightChange: current.light !== null && lastSession.light !== null
        ? current.light - lastSession.light
        : null,
      occupancyChange: current.occupancy - lastSession.occupancy,
      timeSinceLastVisit,
      lastVisitFormatted: formatTimeSince(timeSinceLastVisit),
      isSameDay: isSameDayCheck(lastSession.timestamp, Date.now()),
      isSameHour: lastSession.hourOfDay === new Date().getHours(),
    };
  }, [lastSession]);

  // Compute derived values
  const visitCount = sessionHistory.length;
  const lastVisitTimestamp = lastSession?.timestamp ?? null;
  const isNewUser = visitCount === 0;
  const isReturningUser = visitCount > 0;
  const hasRecentVisit = lastVisitTimestamp !== null && 
    (Date.now() - lastVisitTimestamp) < 24 * 60 * 60 * 1000; // 24 hours

  // Calculate average and best pulse score
  const scoresWithData = sessionHistory.filter(s => s.pulseScore !== null);
  const averagePulseScore = scoresWithData.length > 0
    ? Math.round(scoresWithData.reduce((sum, s) => sum + (s.pulseScore ?? 0), 0) / scoresWithData.length)
    : null;
  const bestPulseScore = scoresWithData.length > 0
    ? Math.max(...scoresWithData.map(s => s.pulseScore ?? 0))
    : null;

  // Find typical visit hour (mode)
  const hourCounts = sessionHistory.reduce((acc, s) => {
    acc[s.hourOfDay] = (acc[s.hourOfDay] || 0) + 1;
    return acc;
  }, {} as Record<number, number>);
  const typicalVisitHour = Object.keys(hourCounts).length > 0
    ? parseInt(Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0][0])
    : null;

  return {
    // Session data
    lastSession,
    delta: null, // Will be calculated when current data is passed
    
    // Visit history
    visitCount,
    lastVisitTimestamp,
    
    // Patterns
    averagePulseScore,
    bestPulseScore,
    typicalVisitHour,
    
    // Actions
    saveCurrentSession,
    clearHistory,
    
    // State
    isNewUser,
    isReturningUser,
    hasRecentVisit,
    showWelcomeBack: showWelcomeBack && !welcomeDismissed,
    dismissWelcomeBack,
  };
}

// ============ UTILITY: Calculate delta with current data ============

export function calculateSessionDelta(
  lastSession: SessionSnapshot | null,
  current: {
    pulseScore: number | null;
    decibels: number | null;
    light: number | null;
    occupancy: number;
  }
): SessionDelta | null {
  if (!lastSession) return null;

  const timeSinceLastVisit = (Date.now() - lastSession.timestamp) / 60000; // minutes

  return {
    pulseChange: current.pulseScore !== null && lastSession.pulseScore !== null
      ? current.pulseScore - lastSession.pulseScore
      : null,
    decibelChange: current.decibels !== null && lastSession.decibels !== null
      ? current.decibels - lastSession.decibels
      : null,
    lightChange: current.light !== null && lastSession.light !== null
      ? current.light - lastSession.light
      : null,
    occupancyChange: current.occupancy - lastSession.occupancy,
    timeSinceLastVisit,
    lastVisitFormatted: formatTimeSince(timeSinceLastVisit),
    isSameDay: isSameDayCheck(lastSession.timestamp, Date.now()),
    isSameHour: lastSession.hourOfDay === new Date().getHours(),
  };
}

export default useSessionMemory;

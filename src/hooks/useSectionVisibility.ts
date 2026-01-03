/**
 * useSectionVisibility - Manage collapsible section states
 * 
 * Features:
 * - Persist collapsed state to localStorage
 * - Time-of-day based defaults
 * - User overrides remembered
 */

import { useState, useCallback, useEffect } from 'react';
import { getCurrentVenueMode, getVenueModeConfig, VenueMode } from '../utils/venueMode';

// All collapsible sections
export type SectionId = 
  | 'livestats'
  | 'pulse'
  | 'rings'
  | 'actions'
  | 'achievements'
  | 'predictions'
  | 'alerts';

interface SectionState {
  collapsed: boolean;
  userOverride: boolean; // User explicitly changed from default
}

type SectionStates = Record<SectionId, SectionState>;

const STORAGE_KEY = 'pulse-section-visibility';

// Default states per mode
function getDefaultStates(mode: VenueMode): SectionStates {
  const config = getVenueModeConfig(mode);
  
  const defaults: SectionStates = {
    livestats: { collapsed: false, userOverride: false },
    pulse: { collapsed: false, userOverride: false },
    rings: { collapsed: false, userOverride: false },
    actions: { collapsed: false, userOverride: false },
    achievements: { collapsed: false, userOverride: false },
    predictions: { collapsed: false, userOverride: false },
    alerts: { collapsed: false, userOverride: false },
  };
  
  // Apply mode-based defaults
  config.hiddenSections.forEach(section => {
    if (section in defaults) {
      defaults[section as SectionId].collapsed = true;
    }
  });
  
  return defaults;
}

function loadSavedStates(): Partial<SectionStates> | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.warn('Failed to load section visibility:', e);
  }
  return null;
}

function saveStates(states: SectionStates) {
  try {
    // Only save user overrides
    const toSave: Partial<SectionStates> = {};
    Object.entries(states).forEach(([key, state]) => {
      if (state.userOverride) {
        toSave[key as SectionId] = state;
      }
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch (e) {
    console.warn('Failed to save section visibility:', e);
  }
}

export function useSectionVisibility() {
  const [mode, setMode] = useState<VenueMode>(getCurrentVenueMode());
  const [states, setStates] = useState<SectionStates>(() => {
    const defaults = getDefaultStates(mode);
    const saved = loadSavedStates();
    
    // Merge saved overrides with defaults
    if (saved) {
      Object.entries(saved).forEach(([key, state]) => {
        if (key in defaults && state?.userOverride) {
          defaults[key as SectionId] = state;
        }
      });
    }
    
    return defaults;
  });
  
  // Update mode periodically
  useEffect(() => {
    const checkMode = () => {
      const newMode = getCurrentVenueMode();
      if (newMode !== mode) {
        setMode(newMode);
        // Re-apply defaults for non-overridden sections
        setStates(prev => {
          const newDefaults = getDefaultStates(newMode);
          const merged: SectionStates = { ...newDefaults };
          Object.entries(prev).forEach(([key, state]) => {
            if (state.userOverride) {
              merged[key as SectionId] = state;
            }
          });
          return merged;
        });
      }
    };
    
    const interval = setInterval(checkMode, 60000); // Check every minute
    return () => clearInterval(interval);
  }, [mode]);
  
  // Toggle a section
  const toggle = useCallback((section: SectionId) => {
    setStates(prev => {
      const current = prev[section];
      const updated = {
        ...prev,
        [section]: {
          collapsed: !current.collapsed,
          userOverride: true,
        },
      };
      saveStates(updated);
      return updated;
    });
  }, []);
  
  // Check if section is collapsed
  const isCollapsed = useCallback((section: SectionId): boolean => {
    return states[section]?.collapsed ?? false;
  }, [states]);
  
  // Check if section is visible (not collapsed)
  const isVisible = useCallback((section: SectionId): boolean => {
    return !isCollapsed(section);
  }, [isCollapsed]);
  
  // Reset all to mode defaults
  const resetToDefaults = useCallback(() => {
    const defaults = getDefaultStates(mode);
    setStates(defaults);
    localStorage.removeItem(STORAGE_KEY);
  }, [mode]);
  
  return {
    mode,
    states,
    toggle,
    isCollapsed,
    isVisible,
    resetToDefaults,
  };
}

export default useSectionVisibility;

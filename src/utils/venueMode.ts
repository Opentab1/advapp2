/**
 * Venue Mode - Determine current operational mode based on time
 * 
 * Modes:
 * - prep: Before open (typically 10am-4pm) - Focus on briefing & prep
 * - service: During service (typically 4pm-2am) - Focus on live stats & actions
 * - closed: After close (typically 2am-10am) - Focus on summary & rest
 */

export type VenueMode = 'prep' | 'service' | 'closed';

interface VenueModeConfig {
  mode: VenueMode;
  label: string;
  description: string;
  prioritySections: string[];
  hiddenSections: string[];
}

// Default bar hours (can be customized per venue later)
const DEFAULT_HOURS = {
  prepStart: 10,    // 10 AM - Venue starts prep
  serviceStart: 16, // 4 PM - Service begins
  serviceEnd: 2,    // 2 AM - Service ends (next day)
};

export function getCurrentVenueMode(customHours?: typeof DEFAULT_HOURS): VenueMode {
  const hours = customHours || DEFAULT_HOURS;
  const now = new Date();
  const currentHour = now.getHours();
  
  // Handle the wrap-around for late night (service ends after midnight)
  if (hours.serviceEnd < hours.serviceStart) {
    // Late night venue (e.g., closes at 2am)
    if (currentHour >= hours.serviceStart || currentHour < hours.serviceEnd) {
      return 'service';
    }
    if (currentHour >= hours.prepStart && currentHour < hours.serviceStart) {
      return 'prep';
    }
    return 'closed';
  }
  
  // Normal hours (closes before midnight)
  if (currentHour >= hours.serviceStart && currentHour < hours.serviceEnd) {
    return 'service';
  }
  if (currentHour >= hours.prepStart && currentHour < hours.serviceStart) {
    return 'prep';
  }
  return 'closed';
}

export function getVenueModeConfig(mode: VenueMode): VenueModeConfig {
  switch (mode) {
    case 'prep':
      return {
        mode: 'prep',
        label: 'Prep Mode',
        description: 'Focus on getting ready for tonight',
        prioritySections: ['briefing', 'predictions', 'achievements'],
        hiddenSections: [],
      };
    case 'service':
      return {
        mode: 'service',
        label: 'Live Mode',
        description: 'Focus on real-time metrics',
        prioritySections: ['livestats', 'pulse', 'actions', 'rings'],
        hiddenSections: [],
      };
    case 'closed':
      return {
        mode: 'closed',
        label: 'Closed',
        description: 'Review last night, rest up',
        prioritySections: ['achievements', 'predictions'],
        hiddenSections: ['actions'],
      };
  }
}

export function getModeGreeting(mode: VenueMode): string {
  const hour = new Date().getHours();
  
  switch (mode) {
    case 'prep':
      if (hour < 12) return 'Good morning';
      return 'Good afternoon';
    case 'service':
      if (hour < 20) return 'Good evening';
      return 'Tonight';
    case 'closed':
      if (hour < 6) return 'Late night';
      return 'Good morning';
  }
}

export function getModeIcon(mode: VenueMode): string {
  switch (mode) {
    case 'prep': return '☀️';
    case 'service': return '🔥';
    case 'closed': return '🌙';
  }
}

// Get suggested focus based on mode and time
export function getModeFocus(mode: VenueMode): string {
  switch (mode) {
    case 'prep':
      return 'Review predictions and prep for tonight';
    case 'service':
      return 'Monitor live metrics and respond to actions';
    case 'closed':
      return 'Great work! Review your performance and rest up';
  }
}

export default {
  getCurrentVenueMode,
  getVenueModeConfig,
  getModeGreeting,
  getModeIcon,
  getModeFocus,
};

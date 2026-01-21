/**
 * useDisplayName Hook
 * 
 * Returns the display name for a venue (custom name if set, otherwise venueId/venueName)
 * This is the "sticker" over the venueId - purely cosmetic, doesn't affect data flow.
 */

import { useState, useEffect } from 'react';
import displaySettingsService from '../services/display-settings.service';
import authService from '../services/auth.service';

interface UseDisplayNameResult {
  displayName: string;
  ownerName?: string;
  ownerEmail?: string;
  hasCustomName: boolean;
  loading: boolean;
}

/**
 * Get display name for the current user's venue
 */
export function useDisplayName(): UseDisplayNameResult {
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<UseDisplayNameResult>({
    displayName: '',
    hasCustomName: false,
    loading: true,
  });

  useEffect(() => {
    const loadDisplayName = async () => {
      try {
        // Ensure display settings are loaded
        await displaySettingsService.initialize();
        
        const user = authService.getStoredUser();
        const venueId = user?.venueId || '';
        const fallbackName = user?.venueName || venueId || 'Your Venue';
        
        // Get display name (custom if set, otherwise fallback)
        const displayName = displaySettingsService.getDisplayName(venueId, fallbackName);
        const ownerName = displaySettingsService.getOwnerName(venueId);
        const ownerEmail = displaySettingsService.getOwnerEmail(venueId);
        const hasCustomName = displaySettingsService.hasCustomSettings(venueId);
        
        setResult({
          displayName,
          ownerName,
          ownerEmail,
          hasCustomName,
          loading: false,
        });
      } catch (error) {
        console.warn('Error loading display name:', error);
        const user = authService.getStoredUser();
        setResult({
          displayName: user?.venueName || user?.venueId || 'Your Venue',
          hasCustomName: false,
          loading: false,
        });
      } finally {
        setLoading(false);
      }
    };

    loadDisplayName();
  }, []);

  return { ...result, loading };
}

/**
 * Get display name for a specific venue (for admin pages showing multiple venues)
 */
export function useVenueDisplayName(venueId: string, fallbackName: string): string {
  const [displayName, setDisplayName] = useState(fallbackName);

  useEffect(() => {
    const load = async () => {
      await displaySettingsService.initialize();
      const name = displaySettingsService.getDisplayName(venueId, fallbackName);
      setDisplayName(name);
    };
    load();
  }, [venueId, fallbackName]);

  return displayName;
}

export default useDisplayName;

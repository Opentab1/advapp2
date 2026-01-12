/**
 * useVenueLearning - Hook for venue-specific learning
 * 
 * Fetches historical data, triggers analysis, and provides:
 * - Learning progress (0-100%)
 * - Learned optimal ranges
 * - Discovered patterns
 * - Current confidence level
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import venueLearningService, { VenueLearning, DiscoveredPattern } from '../services/venue-learning.service';
import apiService from '../services/api.service';
import authService from '../services/auth.service';
import { getCurrentTimeSlot } from '../utils/scoring';
import type { TimeSlot } from '../utils/constants';

interface UseVenueLearningReturn {
  // Core learning state
  learning: VenueLearning | null;
  learningProgress: number;
  status: VenueLearning['status'];
  
  // Current optimal ranges (for this time slot)
  currentOptimalRanges: {
    sound: { min: number; max: number } | null;
    light: { min: number; max: number } | null;
    temperature: { min: number; max: number } | null;
  };
  
  // Dynamic weights based on what matters for this venue
  dynamicWeights: {
    sound: number;
    light: number;
    temperature: number;
    vibe: number;
  };
  
  // Patterns discovered
  patterns: DiscoveredPattern[];
  currentTimeSlotPatterns: DiscoveredPattern[];
  
  // Is data learned or using defaults?
  isLearned: boolean;
  
  // Loading/error state
  isLoading: boolean;
  isAnalyzing: boolean;
  error: string | null;
  
  // Actions
  refresh: () => Promise<void>;
}

export function useVenueLearning(): UseVenueLearningReturn {
  const user = authService.getStoredUser();
  const venueId = user?.venueId || '';
  
  const [learning, setLearning] = useState<VenueLearning | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Fetch historical data and analyze
  const analyze = useCallback(async () => {
    if (!venueId) {
      setIsLoading(false);
      return;
    }
    
    // First, check if we have recent cached learning
    const cached = venueLearningService.getLearning(venueId);
    if (cached) {
      const cacheAge = Date.now() - new Date(cached.lastAnalyzed).getTime();
      const cacheMaxAge = 30 * 60 * 1000; // 30 minutes
      
      if (cacheAge < cacheMaxAge) {
        setLearning(cached);
        setIsLoading(false);
        return;
      }
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      // Fetch historical data - need as much as possible for learning
      // Fetch 90 days if available
      setIsAnalyzing(true);
      
      const result = await apiService.getHistoricalData(venueId, '90d');
      
      if (result?.data && result.data.length > 0) {
        // Analyze the data
        const newLearning = venueLearningService.analyzeVenue(venueId, result.data);
        setLearning(newLearning);
      } else {
        // No data available
        setLearning(venueLearningService.analyzeVenue(venueId, []));
      }
    } catch (err: any) {
      console.error('Error analyzing venue:', err);
      setError(err.message || 'Failed to analyze venue data');
      
      // Fall back to cached if available
      if (cached) {
        setLearning(cached);
      }
    } finally {
      setIsLoading(false);
      setIsAnalyzing(false);
    }
  }, [venueId]);
  
  // Initial load
  useEffect(() => {
    analyze();
  }, [analyze]);
  
  // Get current time slot
  const currentTimeSlot = getCurrentTimeSlot();
  
  // Get optimal ranges for current time slot
  const currentOptimalRanges = useMemo(() => {
    if (!learning || !learning.timeSlots[currentTimeSlot]) {
      return {
        sound: null,
        light: null,
        temperature: null,
      };
    }
    
    const slotLearning = learning.timeSlots[currentTimeSlot]!;
    return {
      sound: slotLearning.sound ? { min: slotLearning.sound.min, max: slotLearning.sound.max } : null,
      light: slotLearning.light ? { min: slotLearning.light.min, max: slotLearning.light.max } : null,
      temperature: slotLearning.temperature ? { min: slotLearning.temperature.min, max: slotLearning.temperature.max } : null,
    };
  }, [learning, currentTimeSlot]);
  
  // Get dynamic weights
  const dynamicWeights = useMemo(() => {
    if (!learning || !learning.timeSlots[currentTimeSlot]) {
      // Default weights
      return { sound: 0.45, light: 0.30, temperature: 0.15, vibe: 0.10 };
    }
    
    const slotWeights = learning.timeSlots[currentTimeSlot]!.weights;
    return {
      sound: slotWeights.sound,
      light: slotWeights.light,
      temperature: slotWeights.temperature,
      vibe: 0.10, // Always keep vibe at 10%
    };
  }, [learning, currentTimeSlot]);
  
  // Get patterns for current time slot
  const currentTimeSlotPatterns = useMemo(() => {
    if (!learning) return [];
    return learning.patterns.filter(p => !p.timeSlot || p.timeSlot === currentTimeSlot);
  }, [learning, currentTimeSlot]);
  
  // Is this learned data or defaults?
  const isLearned = useMemo(() => {
    return learning !== null && 
           learning.status !== 'insufficient_data' && 
           Object.keys(learning.timeSlots).length > 0;
  }, [learning]);
  
  return {
    learning,
    learningProgress: learning?.learningProgress || 0,
    status: learning?.status || 'insufficient_data',
    currentOptimalRanges,
    dynamicWeights,
    patterns: learning?.patterns || [],
    currentTimeSlotPatterns,
    isLearned,
    isLoading,
    isAnalyzing,
    error,
    refresh: analyze,
  };
}

export default useVenueLearning;

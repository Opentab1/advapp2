/**
 * Haptic Feedback Utility
 * 
 * Provides native-feeling haptic feedback for touch interactions.
 * Uses Capacitor Haptics plugin when available, falls back to Web Vibration API.
 */

// Haptic patterns
export type HapticType = 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error' | 'selection';

// Pattern definitions (vibration duration in ms)
const PATTERNS: Record<HapticType, number | number[]> = {
  light: 10,
  medium: 20,
  heavy: 30,
  success: [10, 50, 20],
  warning: [20, 30, 20],
  error: [30, 50, 30, 50, 30],
  selection: 5,
};

/**
 * Trigger haptic feedback
 */
export function haptic(type: HapticType = 'light'): void {
  // Check if we're in a browser environment
  if (typeof window === 'undefined') return;
  
  // Check for native Capacitor Haptics
  const Capacitor = (window as any).Capacitor;
  if (Capacitor?.Plugins?.Haptics) {
    const { Haptics, ImpactStyle, NotificationType } = Capacitor.Plugins;
    
    switch (type) {
      case 'light':
        Haptics?.impact?.({ style: ImpactStyle.Light });
        break;
      case 'medium':
        Haptics?.impact?.({ style: ImpactStyle.Medium });
        break;
      case 'heavy':
        Haptics?.impact?.({ style: ImpactStyle.Heavy });
        break;
      case 'success':
        Haptics?.notification?.({ type: NotificationType.Success });
        break;
      case 'warning':
        Haptics?.notification?.({ type: NotificationType.Warning });
        break;
      case 'error':
        Haptics?.notification?.({ type: NotificationType.Error });
        break;
      case 'selection':
        Haptics?.selectionStart?.();
        break;
    }
    return;
  }
  
  // Fallback to Web Vibration API
  if ('vibrate' in navigator) {
    const pattern = PATTERNS[type];
    try {
      navigator.vibrate(pattern);
    } catch {
      // Ignore errors (some browsers block vibration)
    }
  }
}

/**
 * Hook for haptic on button press
 */
export function useHapticButton(type: HapticType = 'light') {
  return () => haptic(type);
}

/**
 * Trigger haptic on score change
 */
export function hapticForScore(score: number | null, previousScore: number | null): void {
  if (score === null || previousScore === null) return;
  
  const diff = score - previousScore;
  
  if (diff >= 10) {
    haptic('success');
  } else if (diff <= -10) {
    haptic('warning');
  } else if (Math.abs(diff) >= 5) {
    haptic('light');
  }
}

export default haptic;

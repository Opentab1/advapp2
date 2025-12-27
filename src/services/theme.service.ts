export type Theme = 'dark' | 'light' | 'auto';

const THEME_STORAGE_KEY = 'pulse_theme';

class ThemeService {
  private currentTheme: Theme = 'dark';
  private mediaQuery: MediaQueryList | null = null;
  private listeners: Set<(theme: Theme, appliedTheme: 'dark' | 'light') => void> = new Set();

  constructor() {
    // Initialize on first load
    this.loadTheme();
    this.setupSystemThemeListener();
  }

  /**
   * Load theme from localStorage and apply it
   */
  loadTheme(): void {
    const stored = localStorage.getItem(THEME_STORAGE_KEY) as Theme | null;
    this.currentTheme = stored || 'dark';
    this.applyTheme();
  }

  /**
   * Get the current theme setting
   */
  getTheme(): Theme {
    return this.currentTheme;
  }

  /**
   * Get the actually applied theme (resolves 'auto' to dark/light)
   */
  getAppliedTheme(): 'dark' | 'light' {
    if (this.currentTheme === 'auto') {
      return this.getSystemTheme();
    }
    return this.currentTheme;
  }

  /**
   * Set and apply a new theme
   */
  setTheme(theme: Theme): void {
    this.currentTheme = theme;
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    this.applyTheme();
    this.notifyListeners();
  }

  /**
   * Subscribe to theme changes
   */
  subscribe(callback: (theme: Theme, appliedTheme: 'dark' | 'light') => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Get the system preference (dark or light)
   */
  private getSystemTheme(): 'dark' | 'light' {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'dark'; // Default to dark if can't detect
  }

  /**
   * Setup listener for system theme changes (for 'auto' mode)
   */
  private setupSystemThemeListener(): void {
    if (typeof window !== 'undefined' && window.matchMedia) {
      this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      
      const handleChange = () => {
        if (this.currentTheme === 'auto') {
          this.applyTheme();
          this.notifyListeners();
        }
      };

      // Modern browsers
      if (this.mediaQuery.addEventListener) {
        this.mediaQuery.addEventListener('change', handleChange);
      } else {
        // Legacy support
        this.mediaQuery.addListener(handleChange);
      }
    }
  }

  /**
   * Apply the current theme to the document
   */
  private applyTheme(): void {
    const appliedTheme = this.getAppliedTheme();
    const root = document.documentElement;

    if (appliedTheme === 'light') {
      root.classList.remove('dark');
      root.classList.add('light');
    } else {
      root.classList.remove('light');
      root.classList.add('dark');
    }

    // Update meta theme-color for mobile browsers
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute(
        'content',
        appliedTheme === 'light' ? '#f8fafc' : '#0a192f'
      );
    }
  }

  /**
   * Notify all listeners of theme change
   */
  private notifyListeners(): void {
    const appliedTheme = this.getAppliedTheme();
    this.listeners.forEach(callback => callback(this.currentTheme, appliedTheme));
  }
}

// Export singleton instance
const themeService = new ThemeService();
export default themeService;

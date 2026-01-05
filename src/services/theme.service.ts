// WHOOP-style pure black theme
// Dark mode only - clean black design

class ThemeService {
  constructor() {
    // Always apply dark theme
    this.applyTheme();
  }

  /**
   * Load theme - always dark
   */
  loadTheme(): void {
    this.applyTheme();
  }

  /**
   * Get the current theme setting - always dark
   */
  getTheme(): 'dark' {
    return 'dark';
  }

  /**
   * Get the applied theme - always dark
   */
  getAppliedTheme(): 'dark' {
    return 'dark';
  }

  /**
   * Set theme - no-op since we're dark-only
   */
  setTheme(_theme: string): void {
    // Dark only - ignore theme changes
    this.applyTheme();
  }

  /**
   * Subscribe to theme changes - no-op since theme never changes
   */
  subscribe(_callback: (theme: string, appliedTheme: 'dark') => void): () => void {
    return () => {}; // No cleanup needed
  }

  /**
   * Apply dark theme to document
   */
  private applyTheme(): void {
    const root = document.documentElement;
    root.classList.remove('light');
    root.classList.add('dark');

    // Update meta theme-color for mobile browsers - pure black
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', '#000000');
    }
  }
}

// Export singleton instance
const themeService = new ThemeService();
export default themeService;

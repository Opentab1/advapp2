// Light-only theme (Toast-style warm professional)
// No dark mode toggle - clean light design only

class ThemeService {
  constructor() {
    // Always apply light theme
    this.applyTheme();
  }

  /**
   * Load theme - always light
   */
  loadTheme(): void {
    this.applyTheme();
  }

  /**
   * Get the current theme setting - always light
   */
  getTheme(): 'light' {
    return 'light';
  }

  /**
   * Get the applied theme - always light
   */
  getAppliedTheme(): 'light' {
    return 'light';
  }

  /**
   * Set theme - no-op since we're light-only
   */
  setTheme(_theme: string): void {
    // Light only - ignore theme changes
    this.applyTheme();
  }

  /**
   * Subscribe to theme changes - no-op since theme never changes
   */
  subscribe(_callback: (theme: string, appliedTheme: 'light') => void): () => void {
    return () => {}; // No cleanup needed
  }

  /**
   * Apply light theme to document
   */
  private applyTheme(): void {
    const root = document.documentElement;
    root.classList.remove('dark');
    root.classList.add('light');

    // Update meta theme-color for mobile browsers
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', '#FAFAFA');
    }
  }
}

// Export singleton instance
const themeService = new ThemeService();
export default themeService;

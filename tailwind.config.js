/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // ── Run-of-Show palette ─────────────────────────────────────────
        // Keys preserved for source-stability (we have hundreds of usages of
        // `bg-whoop-panel`, `text-text-primary`, `text-teal`, etc. across
        // the app), values remapped to the new palette.

        // Base / Structural
        whoop: {
          bg: '#0A0A0B',                 // Pure black — page background
          panel: '#13131A',              // Panel dark — card backgrounds
          'panel-secondary': '#13131A',  // Same panel dark, no second tier
          'panel-orange': '#2A1208',     // Highlighted panels (orange-tinted dark)
          divider: '#2A2A2D',            // Borders / outlines
        },

        // Text
        text: {
          primary: '#F5EFE6',            // Cream — headlines, primary text
          secondary: '#D4CFC4',          // Light gray — body text
          muted: '#A8A59E',              // Muted gray — secondary labels
          tertiary: '#888888',           // Mid gray — footer / tertiary
        },

        // Recovery (kept semantic — green/yellow/red are universal data colors)
        recovery: {
          high: '#4ade80',
          medium: '#FFDE00',
          low: '#FF0026',
        },

        // Strain / Activity (chart accents — kept blue for distinguishability)
        strain: {
          DEFAULT: '#0093E7',
          light: '#2FB8FF',
        },

        // Sleep (chart accent)
        sleep: {
          DEFAULT: '#7BA1BB',
          accent: '#9FC3DA',
        },

        // BRAND ACCENT — was teal, now burnt orange
        // The token name `teal` is preserved app-wide; only the value changes.
        teal: {
          DEFAULT: '#FF5A30',            // Burnt orange — primary brand accent
          dark: '#E54A20',               // Pressed / hover
        },

        // Burnt-orange aliases for clarity in new code (same value as teal.*)
        burnt: {
          DEFAULT: '#FF5A30',
          light:   '#FF7A50',
          dark:    '#E54A20',
        },

        // Cream / dark text shorthands
        cream: '#F5EFE6',

        // Charts
        chart: {
          baseline: '#1F2630',
          grid: '#2A2A2D',
          tooltip: '#13131A',
        },

        // Legacy warm scale — re-mapped to Run-of-Show grays + cream
        warm: {
          50:  '#F5EFE6',                // cream
          100: '#D4CFC4',                // light gray
          200: '#D4CFC4',
          300: '#A8A59E',                // muted gray
          400: '#A8A59E',
          500: '#666666',                // mid gray
          600: '#2A2A2D',                // border
          700: '#13131A',                // panel
          800: '#13131A',
          900: '#0A0A0B',                // bg
        },

        // Semantic
        success: '#4ade80',              // Used SPARINGLY per palette
        warning: '#FFDE00',
        error:   '#FF0026',

        // Primary CTA — now burnt orange
        primary: {
          DEFAULT: '#FF5A30',
          light:   '#FF7A50',
          dark:    '#E54A20',
          50:  '#FFF1ED',
          100: '#FFD7C8',
          500: '#FF5A30',
          600: '#E54A20',
        },

        // Legacy cyan alias kept (charts only)
        cyan: {
          DEFAULT: '#0093E7',
          light:   '#2FB8FF',
          dark:    '#0077B6',
        },
      },
      fontFamily: {
        sans: ['Proxima Nova', 'system-ui', '-apple-system', 'SF Pro', 'sans-serif'],
        display: ['DIN Pro', 'Proxima Nova', 'system-ui', 'sans-serif'],
        metric: ['DIN Pro', 'SF Pro Display', 'system-ui', 'sans-serif'],
      },
      letterSpacing: {
        'whoop': '0.08em',
        'whoop-wide': '0.12em',
      },
      boxShadow: {
        'soft': '0 1px 3px rgba(0, 0, 0, 0.3)',
        'card': '0 4px 12px rgba(0, 0, 0, 0.4)',
        'card-hover': '0 8px 24px rgba(0, 0, 0, 0.5)',
        'button': '0 2px 8px rgba(255, 90, 48, 0.25)',
        'button-hover': '0 4px 16px rgba(255, 90, 48, 0.35)',
        'teal-glow': '0 0 20px rgba(255, 90, 48, 0.3)',
      },
      borderRadius: {
        'xl': '12px',
        '2xl': '16px',
        '3xl': '24px',
      },
      animation: {
        'fade-in': 'fade-in 0.3s ease-out',
        'slide-up': 'slide-up 0.4s ease-out',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' }
        },
        'slide-up': {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' }
        }
      }
    }
  },
  plugins: [],
}

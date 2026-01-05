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
        // WHOOP Exact Color Palette
        
        // Base / Structural Colors
        whoop: {
          bg: '#000000',           // Primary Background - true black
          panel: '#0B0F14',        // Elevated Panels - cards, containers
          'panel-secondary': '#101518', // Secondary Panels - sub-cards, modals
          divider: '#1C222B',      // Divider / Grid Lines
        },
        
        // Text Colors
        text: {
          primary: '#FFFFFF',      // Headlines, key stats
          secondary: '#A6B0BF',    // Labels, captions
          muted: '#6C7684',        // Disabled / metadata
        },
        
        // Semantic / Performance Colors - Recovery
        recovery: {
          high: '#16EC06',         // 67-100% - Green
          medium: '#FFDE00',       // 34-66% - Yellow
          low: '#FF0026',          // 0-33% - Red
        },
        
        // Strain / Activity
        strain: {
          DEFAULT: '#0093E7',      // Strain Blue
          light: '#2FB8FF',        // Strain Gradient End
        },
        
        // Sleep
        sleep: {
          DEFAULT: '#7BA1BB',      // Sleep Primary
          accent: '#9FC3DA',       // Sleep Accent
        },
        
        // CTA / Highlight
        teal: {
          DEFAULT: '#00F19F',      // WHOOP Teal - Primary CTA
          dark: '#00C884',         // Teal Pressed / Dark
        },
        
        // Chart & Visualization
        chart: {
          baseline: '#1F2630',
          grid: '#2A3441',
          tooltip: '#0E131A',
        },
        
        // Legacy warm palette mapped to WHOOP colors
        warm: {
          50: '#FFFFFF',           // text-primary
          100: '#E5E5E5',
          200: '#A6B0BF',          // text-secondary
          300: '#8A94A3',
          400: '#6C7684',          // text-muted
          500: '#2A3441',          // chart-grid
          600: '#1C222B',          // divider
          700: '#101518',          // panel-secondary
          800: '#0B0F14',          // panel
          900: '#000000',          // bg
        },
        
        // Semantic colors
        success: '#16EC06',        // Recovery high green
        warning: '#FFDE00',        // Recovery medium yellow
        error: '#FF0026',          // Recovery low red
        
        // Primary accent (teal for CTAs)
        primary: {
          DEFAULT: '#00F19F',
          light: '#2FB8FF',
          dark: '#00C884',
          50: '#E6FFF6',
          100: '#B3FFE6',
          500: '#00F19F',
          600: '#00C884',
        },
        
        // Legacy cyan alias -> strain blue
        cyan: {
          DEFAULT: '#0093E7',
          light: '#2FB8FF',
          dark: '#0077B6'
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
        'button': '0 2px 8px rgba(0, 241, 159, 0.25)',
        'button-hover': '0 4px 16px rgba(0, 241, 159, 0.35)',
        'teal-glow': '0 0 20px rgba(0, 241, 159, 0.3)',
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

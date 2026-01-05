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
        // Ocean blue professional palette
        primary: {
          DEFAULT: '#0077B6',  // Ocean blue
          light: '#00A8E8',
          dark: '#005A8C',
          50: '#E6F4FA',
          100: '#CCE9F5',
          500: '#0077B6',
          600: '#005A8C',
        },
        // WHOOP-style pure blacks and grays
        warm: {
          50: '#FFFFFF',
          100: '#FAFAFA',
          200: '#E5E5E5',
          300: '#D4D4D4',
          400: '#A3A3A3',
          500: '#737373',
          600: '#525252',
          700: '#262626',
          800: '#171717',
          900: '#000000',
        },
        // Success, warning, error
        success: '#22C55E',
        warning: '#F59E0B',
        error: '#EF4444',
        // Legacy aliases for compatibility
        cyan: {
          DEFAULT: '#0077B6',
          light: '#00A8E8',
          dark: '#005A8C'
        },
        navy: {
          DEFAULT: '#FAFAFA',
          light: '#FFFFFF',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif']
      },
      boxShadow: {
        'soft': '0 1px 3px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.06)',
        'card': '0 4px 12px rgba(0, 0, 0, 0.08)',
        'card-hover': '0 8px 24px rgba(0, 0, 0, 0.12)',
        'button': '0 2px 8px rgba(0, 119, 182, 0.25)',
        'button-hover': '0 4px 16px rgba(0, 119, 182, 0.35)',
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

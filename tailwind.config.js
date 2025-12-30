/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Toast-inspired warm color palette
        primary: {
          DEFAULT: '#FF6B35',  // Warm orange (Toast-style)
          light: '#FF8B5E',
          dark: '#E55A2B',
          50: '#FFF5F0',
          100: '#FFE8DE',
          500: '#FF6B35',
          600: '#E55A2B',
        },
        // Warm grays with slight warmth
        warm: {
          50: '#FAFAFA',
          100: '#F5F5F4',
          200: '#E7E5E4',
          300: '#D6D3D1',
          400: '#A8A29E',
          500: '#78716C',
          600: '#57534E',
          700: '#44403C',
          800: '#292524',
          900: '#1C1917',
        },
        // Success, warning, error
        success: '#22C55E',
        warning: '#F59E0B',
        error: '#EF4444',
        // Legacy aliases for compatibility
        cyan: {
          DEFAULT: '#FF6B35',
          light: '#FF8B5E',
          dark: '#E55A2B'
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
        'button': '0 2px 8px rgba(255, 107, 53, 0.25)',
        'button-hover': '0 4px 16px rgba(255, 107, 53, 0.35)',
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

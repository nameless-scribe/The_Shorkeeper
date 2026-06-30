/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/renderer/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        keeper: {
          white: '#FFFFFF',
          ice: '#E1E9F0',
          iceDeep: '#89BBFE',
          navy: '#274690',
          navyDeep: '#0A1128',
          cyan: '#30BCED',
          cyanDim: '#00B4D8',
          silver: '#C0C0C0',
          silverLight: '#E8EEF5',
        },
      },
      fontFamily: {
        sans: ['"Segoe UI"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        cyan: '0 0 24px rgba(0, 212, 255, 0.35)',
        cyanSm: '0 0 12px rgba(0, 212, 255, 0.2)',
        glass: '0 8px 32px rgba(11, 16, 38, 0.45)',
      },
      backgroundImage: {
        'keeper-stars':
          'radial-gradient(1.5px 1.5px at 18% 22%, rgba(0,212,255,0.55) 0%, transparent 100%), radial-gradient(1px 1px at 72% 18%, rgba(255,255,255,0.45) 0%, transparent 100%), radial-gradient(1px 1px at 45% 65%, rgba(168,201,240,0.35) 0%, transparent 100%), radial-gradient(1.5px 1.5px at 85% 78%, rgba(0,212,255,0.3) 0%, transparent 100%), radial-gradient(1px 1px at 8% 88%, rgba(255,255,255,0.25) 0%, transparent 100%)',
        'keeper-user': 'linear-gradient(135deg, #274690 0%, #30BCED 55%, #89BBFE 100%)',
        'keeper-glass':
          'linear-gradient(145deg, rgba(39,70,144,0.75) 0%, rgba(10,17,40,0.85) 100%)',
      },
      animation: {
        twinkle: 'twinkle 4s ease-in-out infinite',
        drift: 'drift 20s ease-in-out infinite',
        'pulse-glow': 'pulseGlow 3s ease-in-out infinite',
        'spin-slow': 'spin 10s linear infinite',
      },
      keyframes: {
        twinkle: {
          '0%, 100%': { opacity: '0.6' },
          '50%': { opacity: '1' },
        },
        drift: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        pulseGlow: {
          '0%, 100%': { opacity: '0.55', transform: 'scale(1)' },
          '50%': { opacity: '1', transform: 'scale(1.04)' },
        },
      },
    },
  },
  plugins: [],
};

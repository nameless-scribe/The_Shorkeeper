/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/renderer/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        keeper: {
          white: '#FFFFFF',
          ice: 'rgb(var(--sk-ice-rgb) / <alpha-value>)',
          iceDeep: 'rgb(var(--sk-ice-deep-rgb) / <alpha-value>)',
          navy: 'rgb(var(--sk-navy-rgb) / <alpha-value>)',
          navyDeep: 'rgb(var(--sk-navy-deep-rgb) / <alpha-value>)',
          cyan: 'rgb(var(--sk-cyan-rgb) / <alpha-value>)',
          cyanDim: 'rgb(var(--sk-cyan-dim-rgb) / <alpha-value>)',
          silver: 'rgb(var(--sk-silver-rgb) / <alpha-value>)',
          silverLight: 'rgb(var(--sk-silver-light-rgb) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['"Segoe UI"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        cyan: '0 0 24px rgb(var(--sk-cyan-rgb) / 0.35)',
        cyanSm: '0 0 12px rgb(var(--sk-cyan-rgb) / 0.2)',
        glass: '0 8px 32px rgb(var(--sk-navy-deep-rgb) / 0.45)',
      },
      backgroundImage: {
        'keeper-stars': 'var(--sk-stars-image)',
        'keeper-user': 'var(--sk-user-bubble)',
        'keeper-glass': 'var(--sk-glass)',
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

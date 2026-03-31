/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}', '../ai/src/**/*.ts'],
  theme: {
    extend: {
      boxShadow: {
        glow: '0 24px 60px rgba(249, 115, 22, 0.18)',
      },
      fontFamily: {
        sans: ['"Satoshi"', '"Manrope"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}


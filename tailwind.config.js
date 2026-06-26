/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}', './index.html'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: '#0f1115',
          soft: '#161922',
          softer: '#1d212c'
        },
        line: '#262b38',
        ink: {
          DEFAULT: '#e6e8ee',
          soft: '#a6abbb',
          faint: '#6b7185'
        }
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'PingFang SC', 'Microsoft YaHei', 'sans-serif']
      }
    }
  },
  plugins: []
}

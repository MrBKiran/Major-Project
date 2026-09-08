export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#1e40af', light: '#3b82f6', dark: '#1e3a8a' },
        success: '#16a34a', warning: '#d97706', danger: '#dc2626',
      }
    }
  },
  plugins: [],
}

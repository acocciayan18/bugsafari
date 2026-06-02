/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
theme: {
    extend: { // <--- THIS EXTEND KEY IS MANDATORY
      colors: {
        primary: '#0F172A',   // Navy
        secondary: '#64748B', // Slate
        success: '#22C55E',
        warning: '#EAB308',
        error: '#EF4444',
        background: '#F8FAFC',
      },
      borderRadius: {
        'genesis': '8px',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(-4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.2s ease-out forwards',
      },
    },
  },
  plugins: [],
}
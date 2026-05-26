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
      }
    },
  },
  plugins: [],
}
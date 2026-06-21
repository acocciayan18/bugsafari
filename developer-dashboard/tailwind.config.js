/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: { // <--- THIS EXTEND KEY IS MANDATORY
      colors: {
        // Use CSS variables for theming (dynamic palette)
        primary: 'var(--color-primary)',
        secondary: 'var(--color-secondary)',
        tertiary: 'var(--color-tertiary)',
        quaternary: 'var(--color-quaternary)',
        surface: 'var(--color-surface)',
        background: 'var(--color-background)',
        'text-primary': 'var(--color-text-primary)',
        'text-muted': 'var(--color-text-muted)',
        border: 'var(--color-border)',
        // Fallback colors
        success: '#22C55E',
        warning: '#EAB308',
        error: '#EF4444',
      },
      borderRadius: {
        'genesis': '8px',
      },
      wordBreak: {
        'word': 'break-word',
        'all': 'break-all',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(-4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'marquee': {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.2s ease-out forwards',
        'marquee': 'marquee 20s linear infinite',
      },
    },
  },
  plugins: [],
}

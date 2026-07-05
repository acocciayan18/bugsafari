import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

export type ColorPalette = 'retro' | 'pastel';

// Color definitions — derived from the NovaSpark palette (src/DESIGN.md)
const PALETTES = {
    retro: {
        primary: '#2563EB',    // Nova Blue
        secondary: '#F97316', // Spark Orange
        tertiary: '#22C55E',  // Spark Green
        quaternary: '#60A5FA', // Nova Blue (light tint)
    },
    pastel: {
        primary: '#93C5FD',    // Nova Blue (pastel tint)
        secondary: '#FDBA74',  // Spark Orange (pastel tint)
        tertiary: '#86EFAC',   // Spark Green (pastel tint)
        quaternary: '#BFDBFE', // Nova Blue (lightest tint)
    },
};

interface ThemeContextType {
    colorPalette: ColorPalette;
    setColorPalette: (palette: ColorPalette) => void;
    theme: typeof PALETTES.retro;
    // RGB values for CSS filters/glows
    themeRGB: {
        primary: string;
        secondary: string;
        tertiary: string;
        quaternary: string;
    };
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// Helper to convert hex to RGB
function hexToRgb(hex: string): string {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) return '0, 0, 0';
    return `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
    const [colorPalette, setColorPalette] = useState<ColorPalette>('retro');

    // Set data-palette attribute on document when palette changes
    useEffect(() => {
        document.documentElement.setAttribute('data-palette', colorPalette);
    }, [colorPalette]);

    // Get current theme colors
    const theme = PALETTES[colorPalette];

    // Pre-compute RGB values for CSS usage
    const themeRGB = {
        primary: hexToRgb(theme.primary),
        secondary: hexToRgb(theme.secondary),
        tertiary: hexToRgb(theme.tertiary),
        quaternary: hexToRgb(theme.quaternary),
    };

    return (
        <ThemeContext.Provider value={{ colorPalette, setColorPalette, theme, themeRGB }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
}

// Export palette colors for direct CSS usage
export { PALETTES };

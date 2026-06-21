import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

export type ColorPalette = 'retro' | 'pastel';

// Color definitions
const PALETTES = {
    retro: {
        primary: '#ba5a5a',    // Brick Red
        secondary: '#f7e49b', // Pale Yellow
        tertiary: '#a4ce8b',    // Sage Green
        quaternary: '#86bcbd',   // Muted Blue
    },
    pastel: {
        primary: '#9fa1ff',    // Lavender
        secondary: '#b5baff',   // Periwinkle
        tertiary: '#aee2ff',   // Light Blue
        quaternary: '#d9f9df', // Pale Mint
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

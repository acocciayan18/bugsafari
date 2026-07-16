import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { loadGuestSettings } from '../utils/settingsStorage';
import type { ThemeMode } from '../types';

interface DarkModeContextValue {
    mode: ThemeMode;
    isDark: boolean;
    setMode: (mode: ThemeMode) => void;
}

const DarkModeContext = createContext<DarkModeContextValue | null>(null);

function resolveIsDark(mode: ThemeMode): boolean {
    if (mode === 'dark') return true;
    if (mode === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function DarkModeProvider({ children }: { children: ReactNode }) {
    // Synchronous init prevents flash-of-unstyled-content on page load
    const [mode, setMode] = useState<ThemeMode>(() => loadGuestSettings().theme);
    const [isDark, setIsDark] = useState<boolean>(() => resolveIsDark(mode));

    // Re-resolve isDark whenever mode changes, and live-track the OS preference
    // while (and only while) 'system' is selected.
    useEffect(() => {
        setIsDark(resolveIsDark(mode));

        if (mode !== 'system') return;

        const media = window.matchMedia('(prefers-color-scheme: dark)');
        const handleChange = (event: MediaQueryListEvent) => setIsDark(event.matches);
        media.addEventListener('change', handleChange);
        return () => media.removeEventListener('change', handleChange);
    }, [mode]);

    useEffect(() => {
        document.documentElement.classList.toggle('dark', isDark);
    }, [isDark]);

    return (
        <DarkModeContext.Provider value={{ mode, isDark, setMode }}>
            {children}
        </DarkModeContext.Provider>
    );
}

export function useDarkMode() {
    const ctx = useContext(DarkModeContext);
    if (!ctx) throw new Error('useDarkMode must be used within a DarkModeProvider');
    return ctx;
}

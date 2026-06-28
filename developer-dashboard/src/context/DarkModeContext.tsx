import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { loadGuestSettings } from '../utils/settingsStorage';

interface DarkModeContextValue {
    isDark: boolean;
    setIsDark: (dark: boolean) => void;
}

const DarkModeContext = createContext<DarkModeContextValue | null>(null);

export function DarkModeProvider({ children }: { children: ReactNode }) {
    // Synchronous init prevents flash-of-unstyled-content on page load
    const [isDark, setIsDark] = useState<boolean>(() => loadGuestSettings().theme === 'dark');

    useEffect(() => {
        document.documentElement.classList.toggle('dark', isDark);
    }, [isDark]);

    return (
        <DarkModeContext.Provider value={{ isDark, setIsDark }}>
            {children}
        </DarkModeContext.Provider>
    );
}

export function useDarkMode() {
    const ctx = useContext(DarkModeContext);
    if (!ctx) throw new Error('useDarkMode must be used within a DarkModeProvider');
    return ctx;
}

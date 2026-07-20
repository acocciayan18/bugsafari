import type { ReactNode } from 'react';
import { useThemeStore } from '../stores/themeStore';

// Compat shim — theme now lives in useThemeStore. Kept so existing consumers keep
// working; the provider is a pass-through because the store needs no React context.
export function DarkModeProvider({ children }: { children: ReactNode }) {
    return <>{children}</>;
}

export function useDarkMode() {
    const mode = useThemeStore((s) => s.mode);
    const isDark = useThemeStore((s) => s.isDark);
    const setMode = useThemeStore((s) => s.setMode);
    return { mode, isDark, setMode };
}

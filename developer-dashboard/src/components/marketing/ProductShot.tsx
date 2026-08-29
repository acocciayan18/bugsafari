import { memo } from 'react';
import { useDarkMode } from '../../context/DarkModeContext';

// Theme-aware product shot. Both variants ship; only the active theme's file paints.
export const ProductShot = memo(function ProductShot({ base, alt, className }: { base: string; alt: string; className?: string }) {
    const { isDark } = useDarkMode();
    const src = `/marketing/${base}-${isDark ? 'dark' : 'light'}.png`;
    return <img src={src} alt={alt} loading="lazy" decoding="async" className={className} />;
});

// Chrome-framed screenshot used across hero and feature splits.
export const BrowserFrame = memo(function BrowserFrame({ base, alt, label, className }: { base: string; alt: string; label: string; className?: string }) {
    return (
        <div className={`relative rounded-xl overflow-hidden border border-[var(--border-hairline)] bg-[var(--surface-panel)] shadow-xl ${className ?? ''}`}>
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border-hairline)] bg-[var(--surface-inset)]">
                <div className="flex gap-1.5" aria-hidden="true">
                    <span className="w-3 h-3 rounded-full border border-[var(--border-strong)] bg-[var(--surface-hover)]" />
                    <span className="w-3 h-3 rounded-full border border-[var(--border-strong)] bg-[var(--surface-hover)]" />
                    <span className="w-3 h-3 rounded-full border border-[var(--border-strong)] bg-[var(--surface-hover)]" />
                </div>
                <div className="flex-1 text-center font-mono text-sm font-semibold text-[var(--text-tertiary)] truncate">{label}</div>
            </div>
            <ProductShot base={base} alt={alt} className="w-full block" />
        </div>
    );
});

// Leveled client logger. Hot-path diagnostics ship to end-user consoles otherwise.
// debug/info are gated to DEV (or an explicit VITE_BUGSAFARI_DEBUG=1); warn/error always pass.

const DEBUG_ENABLED =
    import.meta.env.DEV || import.meta.env.VITE_BUGSAFARI_DEBUG === '1';

export const logger = {
    debug: (...args: unknown[]): void => {
        if (DEBUG_ENABLED) console.log(...args);
    },
    info: (...args: unknown[]): void => {
        if (DEBUG_ENABLED) console.info(...args);
    },
    warn: (...args: unknown[]): void => console.warn(...args),
    error: (...args: unknown[]): void => console.error(...args),
};

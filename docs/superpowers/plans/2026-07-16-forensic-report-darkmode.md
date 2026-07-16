# ForensicReport UI/UX + Dark Mode + Theme Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `ForensicReport.tsx` and every component it renders full light/dark mode coverage and a systemized typography pass, and add a Light/Dark/System theme toggle to Settings (full-stack: backend validation, shared types, `DarkModeContext`, Settings UI).

**Architecture:** Widen the existing binary `theme: 'light'|'dark'` contract to a tri-state `'light'|'dark'|'system'` across backend controller validation and frontend types, teach `DarkModeContext` to resolve `'system'` via `matchMedia` with a live subscription, then do a systematic `dark:` class + typography-token pass over `ForensicReport.tsx` and every component it imports, reusing colors/patterns already established in `Settings.tsx` and `AiInsightsPanel`.

**Tech Stack:** React 19 + Vite, Tailwind v4 (CSS-based `@theme` tokens in `index.css`), Express + Mongoose (schemaless `settings` field on `UserModel`), no new dependencies.

## Global Constraints

- No external libraries — reuse existing NovaSpark tokens (`index.css` `@theme` block), existing icon patterns (locally-defined inline SVG consts, same style as `Spinner` in `Settings.tsx` and `checkIcon`/`alertIcon` in `ForensicReport.tsx`), no new npm packages.
- No new typography scale — reuse `--text-h4`, `--text-body-sm` (= Tailwind's built-in `text-sm`, already 14px, no class change needed), `--text-caption` (`text-caption` utility, precedented in `LoginForm.tsx` as `text-h2`) from `index.css`. Weight tiers: 700 headings/stat values, 600 uppercase section labels, 500 medium labels, 400 body.
- No backend schema/DB migration — `settings` is an undeclared/dynamic field on the Mongoose `userSchema` (see `UserModel.ts`), so widening the accepted `theme` literal is a validation-layer change only, no migration.
- No structural/layout redesign — page structure stays: executive summary → AI insights → tabs (Findings/Network/Console) → finding cards → action timeline appendix. Only `dark:` classes and label/weight/token systemization.
- Dark-mode color mapping used throughout (reuse `Settings.tsx`'s existing convention, do not invent a new one): `bg-white` → `dark:bg-slate-900`; `bg-gray-50`/`bg-gray-100` (subtle panel) → `dark:bg-gray-800`; `border-gray-200` → `dark:border-gray-700`; `border-gray-100` (list divider) → `dark:border-gray-800`; `text-gray-900` → `dark:text-gray-100`; `text-gray-800` → `dark:text-gray-200`; `text-gray-700` → `dark:text-gray-300`; `text-gray-600` → `dark:text-gray-400`; `text-gray-500`/`text-gray-400` (muted labels) → `dark:text-gray-400`/`dark:text-gray-500`. Tinted status surfaces (`bg-{color}-50 border-{color}-200` / `text-{color}-700..900`) → `dark:bg-{color}-950/20..40 dark:border-{color}-800..900` / `dark:text-{color}-300..400`.
- Testing note (applies to every task below): this repo has no frontend test framework (`developer-dashboard` has zero `.test.tsx` files, no vitest/jest configured) and no backend controller-level test precedent (`testing-core`'s `*.test.ts` files, run via `node scripts/run-tests.mjs`, only cover pure domain/application logic — never an Express handler). Introducing a new test/mocking framework for additive CSS-class and type-widening changes would violate "no external libraries unless absolutely necessary." Verification is therefore: `tsc` typecheck (real compiler, already in the toolchain) + a scripted manual walkthrough with exact commands/clicks and exact expected result, in place of the write-test/run-test/implement/run-test cycle.

---

## Task 1: Widen `theme` to a tri-state contract (backend + frontend types)

**Files:**
- Modify: `testing-core/src/presentation/authentication/userSettingsController.ts:16`, `:284-291`
- Modify: `developer-dashboard/src/types.ts:243`, `:259`
- Modify: `developer-dashboard/src/utils/settingsStorage.ts:19`
- Modify: `developer-dashboard/src/hooks/useUserSettings.ts:25`

**Interfaces:**
- Produces: `UserSettings['theme']` and `ThemeMode` (frontend) become `'light' | 'dark' | 'system'`; backend `UserSettings['theme']` (controller-local interface) becomes `'light' | 'dark' | 'system'`; `PUT /api/settings` now accepts `theme: 'system'` without a 400.
- Consumed by: Task 2 (`DarkModeContext` reads `ThemeMode`), Task 3 (`Settings.tsx` reads/writes `settings.theme` as `ThemeMode`).

- [ ] **Step 1: Widen the backend controller type and validation**

In `testing-core/src/presentation/authentication/userSettingsController.ts`, change line 16:

```typescript
export interface UserSettings {
    theme: 'light' | 'dark' | 'system';
    notifications: boolean;
    autoSave: boolean;
}
```

Then change the theme-validation branch (originally lines 283-291):

```typescript
        // Theme validation
        if (theme !== undefined) {
            if (theme === 'light' || theme === 'dark' || theme === 'system') {
                updateData['settings.theme'] = theme;
            } else {
                errorResponse(res, 400, 'Theme must be "light", "dark", or "system"');
                return;
            }
        }
```

- [ ] **Step 2: Widen the frontend shared types**

In `developer-dashboard/src/types.ts`, change line 243:

```typescript
export interface UserSettings {
  theme: 'light' | 'dark' | 'system';
  notifications: boolean;
  autoSave: boolean;
}
```

And line 259:

```typescript
export type ThemeMode = 'light' | 'dark' | 'system';
```

- [ ] **Step 3: Widen the guest-settings storage guard**

In `developer-dashboard/src/utils/settingsStorage.ts`, change line 19 (inside `loadGuestSettings`):

```typescript
        return {
            theme: parsed.theme === 'light' || parsed.theme === 'dark' || parsed.theme === 'system' ? parsed.theme : DEFAULT_SETTINGS.theme,
            notifications: typeof parsed.notifications === 'boolean' ? parsed.notifications : DEFAULT_SETTINGS.notifications,
            autoSave: typeof parsed.autoSave === 'boolean' ? parsed.autoSave : DEFAULT_SETTINGS.autoSave,
        };
```

- [ ] **Step 4: Widen the `useUserSettings` response type**

In `developer-dashboard/src/hooks/useUserSettings.ts`, change line 25 (inside the local `SettingsResponse` interface):

```typescript
interface SettingsResponse {
    theme: 'light' | 'dark' | 'system';
    notifications: boolean;
    autoSave: boolean;
}
```

- [ ] **Step 5: Typecheck both packages**

Run: `cd testing-core && npm run typecheck`
Expected: exits 0, no TypeScript errors.

Run: `cd developer-dashboard && npx tsc -b`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add testing-core/src/presentation/authentication/userSettingsController.ts developer-dashboard/src/types.ts developer-dashboard/src/utils/settingsStorage.ts developer-dashboard/src/hooks/useUserSettings.ts
git commit -m "widen theme setting to support system mode"
```

---

## Task 2: Teach `DarkModeContext` to resolve and live-track `system` mode

**Files:**
- Modify: `developer-dashboard/src/context/DarkModeContext.tsx` (full rewrite, 31 lines)

**Interfaces:**
- Consumes: `ThemeMode` from `../types` (Task 1), `loadGuestSettings` from `../utils/settingsStorage` (unchanged signature).
- Produces: `useDarkMode()` returns `{ mode: ThemeMode, isDark: boolean, setMode: (mode: ThemeMode) => void }`. (Replaces the old `{ isDark, setIsDark }` shape — the only consumer today is `Settings.tsx`, updated in Task 3.)

- [ ] **Step 1: Rewrite `DarkModeContext.tsx`**

```tsx
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
```

- [ ] **Step 2: Typecheck**

Run: `cd developer-dashboard && npx tsc -b`
Expected: FAILS at this point — `Settings.tsx` still destructures `setIsDark` (removed). This is expected; Task 3 fixes it. Confirm the error is specifically about `setIsDark` not existing on `DarkModeContextValue`, nothing else.

- [ ] **Step 3: Commit**

```bash
git add developer-dashboard/src/context/DarkModeContext.tsx
git commit -m "add system theme mode resolution to DarkModeContext"
```

---

## Task 3: Settings page — Light/Dark/System segmented control

**Files:**
- Modify: `developer-dashboard/src/components/settings/Settings.tsx`

**Interfaces:**
- Consumes: `useDarkMode()` → `{ mode, isDark, setMode }` (Task 2), `ThemeMode` from `../../types` (Task 1).
- Produces: nothing consumed by later tasks — this is a leaf UI task.

- [ ] **Step 1: Add `ThemeMode` and `ReactNode` imports**

In `developer-dashboard/src/components/settings/Settings.tsx`, change the top imports (originally lines 9-15):

```tsx
import { useState, useEffect, memo, type ReactNode } from 'react';
import { toast } from 'sonner';

import { UserIcon, LockClosedIcon, EyeIcon, EyeSlashIcon } from '../icons';
import { useAuth } from '../../hooks/useAuth';
import { useUserSettings } from '../../hooks/useUserSettings';
import { useDarkMode } from '../../context/DarkModeContext';
import type { ThemeMode } from '../../types';
```

- [ ] **Step 2: Add Sun/Moon/Monitor icons and the segmented control, right after the `Spinner` component**

Insert this block immediately after the closing `}` of the `Spinner` function (originally line 28), before the `PasswordInputField` section comment:

```tsx
// ─────────────────────────────────────────────────────────────────────────────
// Theme mode icons + segmented control
// ─────────────────────────────────────────────────────────────────────────────

function SunIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path strokeLinecap="round" d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32l1.41-1.41" />
    </svg>
  );
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 1020.354 15.354z" />
    </svg>
  );
}

function MonitorIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
      <rect x="3" y="4" width="18" height="12" rx="1.5" />
      <path strokeLinecap="round" d="M8 20h8M12 16v4" />
    </svg>
  );
}

const THEME_OPTIONS: { mode: ThemeMode; label: string; icon: (className: string) => ReactNode }[] = [
  { mode: 'light', label: 'Light', icon: (c) => <SunIcon className={c} /> },
  { mode: 'dark', label: 'Dark', icon: (c) => <MoonIcon className={c} /> },
  { mode: 'system', label: 'System', icon: (c) => <MonitorIcon className={c} /> },
];

// Keyboard-accessible 3-way segmented control (role="radiogroup"/"radio")
function ThemeModeControl({ mode, onChange }: { mode: ThemeMode; onChange: (mode: ThemeMode) => void }) {
  return (
    <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-2 py-3">
      {THEME_OPTIONS.map((opt) => {
        const selected = mode === opt.mode;
        return (
          <button
            key={opt.mode}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.mode)}
            className={`flex min-h-[44px] flex-col items-center justify-center gap-1 rounded-lg border px-3 py-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nova-blue focus-visible:ring-offset-2 dark:focus-visible:ring-offset-nova-dark ${
              selected
                ? 'border-nova-blue bg-blue-50 text-nova-blue dark:bg-blue-950/40 dark:text-blue-300'
                : 'border-gray-200 text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700'
            }`}
          >
            {opt.icon('h-4 w-4')}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Wire `ApplicationSettingsSection` to `mode`/`setMode`**

Change the top of `ApplicationSettingsSection` (originally lines 144-158):

```tsx
function ApplicationSettingsSection() {
  const { settings, isSettingsLoading, updateSettings } = useUserSettings();
  const { setMode } = useDarkMode();

  // Sync stored theme to DarkModeContext whenever settings load from backend or localStorage
  useEffect(() => {
    if (!isSettingsLoading) {
      setMode(settings.theme);
    }
  }, [settings.theme, isSettingsLoading, setMode]);

  const handleThemeSelect = async (mode: ThemeMode) => {
    setMode(mode); // Immediate visual feedback — don't wait for the async save
    await updateSettings({ theme: mode });
  };
```

- [ ] **Step 4: Replace the binary toggle with the segmented control**

Change the Theme block inside `ApplicationSettingsSection`'s render (originally lines 182-191):

```tsx
      <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Theme</span>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Choose how BugSafari looks on this device.</p>
      </div>

      <ThemeModeControl mode={settings.theme} onChange={handleThemeSelect} />
```

- [ ] **Step 5: Typecheck**

Run: `cd developer-dashboard && npx tsc -b`
Expected: exits 0, no errors (this also confirms Task 2's `DarkModeContext` API is now fully consumed correctly).

- [ ] **Step 6: Manual verification — guest mode**

Run: `cd developer-dashboard && npm run dev`, open the printed local URL, navigate to Settings (skip/guest login if prompted), expand "Application Settings".

1. Click "Light" → page immediately renders light; open devtools console, run `localStorage.getItem('bugsafari_guest_settings')` → confirm it contains `"theme":"light"`.
2. Click "Dark" → page immediately renders dark; re-run the same `localStorage.getItem` → confirm `"theme":"dark"`; confirm `document.documentElement.className` contains `dark`.
3. Click "System" → re-run `localStorage.getItem` → confirm `"theme":"system"`. In devtools → Rendering tab → "Emulate CSS prefers-color-scheme", toggle between `dark` and `light` → confirm the page theme and `document.documentElement.className`'s `dark` presence follow the emulated OS setting live, without a reload.
4. Reload the page while mode is "System" → confirm no flash of the wrong theme (theme is correct on first paint).

- [ ] **Step 7: Commit**

```bash
git add developer-dashboard/src/components/settings/Settings.tsx
git commit -m "add Light/Dark/System theme toggle to Settings"
```

---

## Task 4: `Badge.tsx` — dark mode variants

**Files:**
- Modify: `developer-dashboard/src/components/ui/Badge.tsx:5-11`

**Interfaces:**
- Consumed by: `AttributionBadges` in `ForensicCardKit.tsx` (Task 7), and other existing Badge callers elsewhere in the app (unaffected — additive only).

- [ ] **Step 1: Add dark variants to every badge tone**

Change `VARIANT_CLASSES` in `developer-dashboard/src/components/ui/Badge.tsx`:

```tsx
const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  default: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  primary: 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300',
  success: 'bg-green-100 text-green-700 dark:bg-green-950/60 dark:text-green-300',
  warning: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
  danger: 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300',
};
```

- [ ] **Step 2: Typecheck**

Run: `cd developer-dashboard && npx tsc -b`
Expected: exits 0, no errors.

- [ ] **Step 3: Commit**

```bash
git add developer-dashboard/src/components/ui/Badge.tsx
git commit -m "add dark mode variants to Badge"
```

(Visual confirmation of Badge in dark mode happens as part of Task 9's walkthrough, where `AttributionBadges` renders inside a finding card.)

---

## Task 5: `CoverageProgressBar.tsx` — dark mode variants

**Files:**
- Modify: `developer-dashboard/src/components/history/CoverageProgressBar.tsx`

- [ ] **Step 1: Add dark variants to the coverage color bands**

Change `getCoverageBand` (originally lines 24-28):

```typescript
function getCoverageBand(percentage: number): CoverageBand {
  if (percentage <= 40) return { fill: 'bg-red-500', track: 'bg-red-100 dark:bg-red-950/50', text: 'text-red-500 dark:text-red-400' };
  if (percentage <= 70) return { fill: 'bg-amber-500', track: 'bg-amber-100 dark:bg-amber-950/50', text: 'text-amber-500 dark:text-amber-400' };
  return { fill: 'bg-green-500', track: 'bg-green-100 dark:bg-green-950/50', text: 'text-green-500 dark:text-green-400' };
}
```

- [ ] **Step 2: Add dark variant to the percentage label in `CoverageProgressBar`**

Change the label span (originally line 54):

```tsx
        <span className="font-mono text-xs text-gray-600 dark:text-gray-400 min-w-[3ch]">
```

- [ ] **Step 3: Typecheck**

Run: `cd developer-dashboard && npx tsc -b`
Expected: exits 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add developer-dashboard/src/components/history/CoverageProgressBar.tsx
git commit -m "add dark mode variants to CoverageProgressBar"
```

(Visual confirmation happens in Task 8's walkthrough — `CoverageDisplay` renders inside `ExecutiveSummary`'s stat grid.)

---

## Task 6: `ReproductionChecklist.tsx` — dark mode variants

**Files:**
- Modify: `developer-dashboard/src/components/telemetry/ReproductionChecklist.tsx`

- [ ] **Step 1: Add dark variants throughout**

Replace the return block (originally lines 24-55):

```tsx
  return (
    <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[11px] font-black uppercase tracking-wider text-amber-900 dark:text-amber-300">
          🧭 Reproduction Playbook
        </div>
        {steps.length > 0 && (
          <button
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-[10px] font-medium text-amber-800 transition-all hover:bg-amber-100 active:scale-95 dark:text-amber-300 dark:hover:bg-amber-900/40"
            title="Copy reproduction steps"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        )}
      </div>
      {steps.length > 0 ? (
        <ol className="space-y-1.5">
          {steps.map((step, idx) => (
            <li
              key={`${idx}-${step}`}
              className="rounded border border-amber-200 bg-white px-2.5 py-1.5 text-xs font-mono font-medium leading-relaxed text-gray-900 whitespace-pre-wrap break-words dark:border-amber-900 dark:bg-slate-900 dark:text-gray-100"
            >
              {step}
            </li>
          ))}
        </ol>
      ) : (
        <div className="text-xs italic text-gray-500 dark:text-gray-400">No reproduction steps available.</div>
      )}
    </div>
  );
```

- [ ] **Step 2: Typecheck**

Run: `cd developer-dashboard && npx tsc -b`
Expected: exits 0, no errors.

- [ ] **Step 3: Commit**

```bash
git add developer-dashboard/src/components/telemetry/ReproductionChecklist.tsx
git commit -m "add dark mode variants to ReproductionChecklist"
```

---

## Task 7: `ForensicCardKit.tsx` — dark mode variants

**Files:**
- Modify: `developer-dashboard/src/components/common/ForensicCardKit.tsx`

- [ ] **Step 1: Add dark variants to `CopyButton`**

Change the button className (originally line 37):

```tsx
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-all hover:bg-gray-100 active:scale-95 text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100"
```

- [ ] **Step 2: Add dark variants to `ExpandableCodeBlock`**

Change the toggle button className (originally line 69):

```tsx
        className="w-full flex items-center gap-2 px-4 py-3 text-gray-700 hover:bg-gray-100 transition-colors text-xs font-semibold border-b border-gray-200 dark:text-gray-300 dark:hover:bg-gray-800 dark:border-gray-700"
```

Change the expanded content wrapper (originally line 76):

```tsx
        <div className={`px-4 py-3 bg-gray-100 max-h-96 overflow-y-auto border border-gray-200 border-t-0 dark:bg-gray-800 dark:border-gray-700 ${className}`}>
```

Change the `<pre>` (originally line 77):

```tsx
          <pre className="text-xs font-mono whitespace-pre-wrap wrap-break-word text-gray-700 leading-relaxed p-3 bg-white rounded border border-gray-200 overflow-x-auto dark:text-gray-200 dark:bg-slate-900 dark:border-gray-700">
```

- [ ] **Step 3: Add dark variant to `SuggestedFixBlock`'s empty state**

Change the "no advisory" div (originally line 128):

```tsx
      <div className="rounded-md border border-gray-200 bg-gray-100 p-3 text-xs italic text-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-500">
```

(The advice-present branch — `bg-slate-900` with green text — is already dark-friendly; no change.)

- [ ] **Step 4: Typecheck**

Run: `cd developer-dashboard && npx tsc -b`
Expected: exits 0, no errors.

- [ ] **Step 5: Commit**

```bash
git add developer-dashboard/src/components/common/ForensicCardKit.tsx
git commit -m "add dark mode variants to ForensicCardKit"
```

---

## Task 8: `ForensicReport.tsx` — page chrome, Executive Summary, AI Insights

**Files:**
- Modify: `developer-dashboard/src/components/forensics/ForensicReport.tsx` (functions: `statusTheme`, `riskTheme`, `StatBlock`, `ExecutiveSummary`, `AiInsightsPanel`; plus the loading/error early returns and the outer `<div>`/`<header>`/`<footer>` chrome in the default export)

**Interfaces:**
- Consumes: `CoverageDisplay` from `../history/CoverageProgressBar` (Task 5, unchanged signature).
- Produces: `statusTheme`/`riskTheme`/`StatBlock` are used unchanged (same call signatures) by the rest of the file — no signature changes, class-string values only.

- [ ] **Step 1: Add dark variants to `statusTheme` and `riskTheme`**

Replace (originally lines 66-76):

```typescript
function statusTheme(status: string): { text: string; dot: string; bg: string; border: string } {
  if (status === 'CRASHED') return { text: 'text-red-700 dark:text-red-400', dot: 'bg-red-500', bg: 'bg-red-50 dark:bg-red-950/30', border: 'border-red-200 dark:border-red-900' };
  if (status === 'HALTED') return { text: 'text-amber-700 dark:text-amber-400', dot: 'bg-amber-500', bg: 'bg-amber-50 dark:bg-amber-950/30', border: 'border-amber-200 dark:border-amber-900' };
  return { text: 'text-green-700 dark:text-green-400', dot: 'bg-green-500', bg: 'bg-green-50 dark:bg-green-950/30', border: 'border-green-200 dark:border-green-900' };
}

function riskTheme(score: number): string {
  if (score >= 70) return 'text-red-600 dark:text-red-400';
  if (score >= 40) return 'text-amber-600 dark:text-amber-400';
  return 'text-green-600 dark:text-green-400';
}
```

- [ ] **Step 2: Systemize `StatBlock` typography + dark mode**

Replace (originally lines 83-90):

```tsx
function StatBlock({ label, value, valueClassName = 'text-gray-900 dark:text-gray-100' }: { label: string; value: ReactNode; valueClassName?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-caption font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{label}</div>
      <div className={`mt-0.5 text-sm font-bold tabular-nums ${valueClassName}`}>{value}</div>
    </div>
  );
}
```

- [ ] **Step 3: Add dark variants + fix the two inline `valueClassName` call sites in `ExecutiveSummary`, systemize the "Visited Routes" disclosure**

Replace the whole `ExecutiveSummary` return block (originally lines 104-150):

```tsx
  return (
    <section className={`rounded-xl border ${theme.border} ${theme.bg} p-5`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${theme.dot}`} />
            <span className={`text-sm font-bold uppercase tracking-wide ${theme.text}`}>{report.status || 'UNKNOWN'}</span>
          </div>
          <div className="mt-1 truncate text-sm font-medium text-gray-700 dark:text-gray-300" title={report.url}>{report.url || 'N/A'}</div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <span>Run {sessionId}</span>
            <span>•</span>
            <span>Started {formatDate(report.date)}</span>
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4 border-t border-gray-200/70 pt-4 sm:grid-cols-3 lg:grid-cols-6 dark:border-gray-700/70">
        <StatBlock label="Duration" value={formatDuration(report.duration)} />
        <StatBlock label="Actions" value={report.metrics?.totalActions ?? 0} />
        <StatBlock label="Findings" value={findingsTotal} valueClassName={findingsTotal > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'} />
        <StatBlock label="Pages" value={pagesVisited} />
        <StatBlock label="Risk Score" value={report.riskScore ?? 0} valueClassName={riskTheme(report.riskScore ?? 0)} />
        <StatBlock label="Coverage" value={<CoverageDisplay percentage={report.coverage ?? 0} />} />
      </div>

      {routes.length > 0 && (
        <div className="mt-4 border-t border-gray-200/70 pt-3 dark:border-gray-700/70">
          <button
            type="button"
            onClick={() => setShowRoutes((prev) => !prev)}
            className="flex items-center gap-1.5 text-caption font-semibold uppercase tracking-wider text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <span>{showRoutes ? '▼' : '▶'}</span>
            <span>Visited Routes ({routes.length})</span>
          </button>
          {showRoutes && (
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto font-mono text-[11px] text-gray-600 dark:text-gray-400">
              {routes.map((route, idx) => (
                <li key={idx} className="truncate border-b border-gray-100 py-1 last:border-0 dark:border-gray-800" title={route}>{route}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
```

- [ ] **Step 4: Fill remaining dark gaps in `AiInsightsPanel`**

Change the risk-level chip (originally lines 169-173):

```tsx
        {aiAnalysis.riskLevel && (
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
            {aiAnalysis.riskLevel} risk
          </span>
        )}
```

Change the recommendation arrow (originally line 182):

```tsx
              <span className="text-blue-500 dark:text-blue-400">→</span>
```

- [ ] **Step 5: Add dark variants to the loading/error early returns**

Replace the loading block (originally lines 911-919):

```tsx
  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-white dark:bg-slate-900">
        <div className="text-center">
          <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">Loading forensic report…</div>
          <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">Fetching the latest session details from the backend.</div>
        </div>
      </div>
    );
  }
```

Replace the error block (originally lines 922-930):

```tsx
  if (error || !report) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-white px-6 dark:bg-slate-900">
        <div className="max-w-md text-center">
          <div className="text-sm font-semibold text-red-600 dark:text-red-400">Failed to load report</div>
          <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">{error || 'No report data was returned for this session.'}</div>
        </div>
      </div>
    );
  }
```

- [ ] **Step 6: Add dark variants to the page shell (root/header/footer)**

Replace the opening of the default export's return (originally lines 933-951):

```tsx
  return (
    <div className="flex h-full w-full flex-col bg-gray-100 dark:bg-gray-900">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-700 dark:bg-slate-900">
        <div className="flex items-center">
          <span className="text-sm font-bold tracking-wide text-gray-900 dark:text-gray-100">BUGSAFARI</span>
          <span className="mx-3 text-gray-400 dark:text-gray-600">/</span>
          <span className="text-sm font-semibold text-gray-600 dark:text-gray-400">FORENSIC REPORT</span>
        </div>
        <button
          onClick={() => window.history.back()}
          className="flex items-center gap-2 rounded px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to History
        </button>
      </header>
```

Replace the footer (originally lines 995-1000):

```tsx
      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white px-6 py-4 dark:border-gray-700 dark:bg-slate-900">
        <div className="text-center">
          <span className="font-mono text-xs text-gray-400 dark:text-gray-600">END OF FORENSIC REPORT</span>
        </div>
      </footer>
```

- [ ] **Step 7: Typecheck**

Run: `cd developer-dashboard && npx tsc -b`
Expected: exits 0, no errors.

- [ ] **Step 8: Commit**

```bash
git add developer-dashboard/src/components/forensics/ForensicReport.tsx
git commit -m "systemize typography and add dark mode to ForensicReport chrome, ExecutiveSummary, AiInsightsPanel"
```

(Full visual walkthrough of this page happens once in Task 11, after Tasks 9-10 land — the page doesn't fully render its tab content without them.)

---

## Task 9: `ForensicReport.tsx` — FindingCard, Verify Fix control/modal, CleanRunCard

**Files:**
- Modify: `developer-dashboard/src/components/forensics/ForensicReport.tsx` (functions: `VERDICT_META`, `BASE_CARD`, `VerifyFixControl`, `ResultStat`, `ReproducedSignal`, `VerificationResultModal`, `FindingCard`, `CleanRunCard`)

**Interfaces:**
- Consumes: `AttributionBadges`, `CopyButton`, `ExpandableCodeBlock`, `SuggestedFixBlock` from `ForensicCardKit.tsx` (Task 7), `Badge` dark variants (Task 4, via `AttributionBadges`), `ReproductionChecklist` (Task 6), `Modal` (unchanged, already dark-complete).
- Produces: no signature changes — `VerdictMeta` fields still exist with the same names, just richer class-string values.

- [ ] **Step 1: Add dark variants to `VERDICT_META` and `BASE_CARD`**

Replace the `VERDICT_META` object (originally lines 289-329):

```typescript
const VERDICT_META: Record<RegressionVerdict, VerdictMeta> = {
  RESOLVED: {
    label: 'Resolved',
    badge: 'bg-green-600 text-white hover:bg-green-700',
    chip: 'bg-green-100 text-green-800 border border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-800',
    dot: 'bg-green-500',
    cardBorder: 'border-green-200 dark:border-green-800',
    cardHeaderBg: 'bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800',
    cardTitle: 'text-green-900 dark:text-green-300',
    cardSub: 'text-green-700 dark:text-green-400',
    numberBg: 'bg-green-600',
    modalBar: 'bg-green-600',
    icon: checkIcon,
  },
  STILL_ACTIVE: {
    label: 'Still Active',
    badge: 'bg-red-600 text-white hover:bg-red-700',
    chip: 'bg-red-100 text-red-800 border border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800',
    dot: 'bg-red-500',
    cardBorder: 'border-red-300 dark:border-red-800',
    cardHeaderBg: 'bg-red-50 border-red-300 dark:bg-red-950/30 dark:border-red-800',
    cardTitle: 'text-red-900 dark:text-red-300',
    cardSub: 'text-red-700 dark:text-red-400',
    numberBg: 'bg-red-600',
    modalBar: 'bg-red-600',
    icon: alertIcon,
  },
  INCONCLUSIVE: {
    label: 'Inconclusive',
    badge: 'bg-amber-500 text-white hover:bg-amber-600',
    chip: 'bg-amber-100 text-amber-800 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800',
    dot: 'bg-amber-500',
    cardBorder: 'border-amber-200 dark:border-amber-800',
    cardHeaderBg: 'bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800',
    cardTitle: 'text-amber-900 dark:text-amber-300',
    cardSub: 'text-amber-700 dark:text-amber-400',
    numberBg: 'bg-amber-500',
    modalBar: 'bg-amber-500',
    icon: questionIcon,
  },
};
```

Replace `BASE_CARD` (originally lines 331-338):

```typescript
const BASE_CARD = {
  cardBorder: 'border-red-200 dark:border-red-900',
  cardHeaderBg: 'bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-900',
  cardTitle: 'text-red-900 dark:text-red-300',
  cardSub: 'text-red-700 dark:text-red-400',
  numberBg: 'bg-red-600',
};
```

- [ ] **Step 2: Add dark variants to `VerifyFixControl`**

Replace the "running" pill (originally lines 364-377):

```tsx
  if (status.state === 'running') {
    return (
      <span
        className="inline-flex items-center gap-2 rounded-md bg-gray-100 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:bg-gray-800 dark:text-gray-400"
        aria-live="polite"
      >
        <svg className="h-3.5 w-3.5 animate-spin text-gray-400 dark:text-gray-500" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
        {phaseLabel(status)}
      </span>
    );
  }
```

Replace the idle "Verify Fix" button (originally lines 394-408):

```tsx
  return (
    <button
      type="button"
      onClick={onVerify}
      disabled={disabled}
      title={disabled ? disabledReason : 'Replay this finding to check whether it is fixed'}
      className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-slate-800 dark:text-gray-300 dark:hover:bg-gray-700"
    >
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M20 12a8 8 0 11-2.3-5.6M20 4v4h-4" />
      </svg>
      Verify Fix
    </button>
  );
```

- [ ] **Step 3: Add dark variants to `ResultStat` and `ReproducedSignal`**

Replace `ResultStat` (originally lines 417-424):

```tsx
function ResultStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">{label}</div>
      <div className="mt-0.5 truncate text-xs font-bold text-gray-900 dark:text-gray-100" title={value}>{value}</div>
    </div>
  );
}
```

Replace `ReproducedSignal` (originally lines 426-443):

```tsx
function ReproducedSignal({ signal }: { signal: RegressionSignal }) {
  return (
    <li className="rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/30">
      <div className="flex items-center gap-2">
        <span className="rounded bg-red-600 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
          {signal.faultType}
        </span>
        {typeof signal.statusCode === 'number' && (
          <span className="font-mono text-[11px] font-semibold text-red-700 dark:text-red-400">HTTP {signal.statusCode}</span>
        )}
      </div>
      <div className="mt-1 break-words text-xs text-gray-800 dark:text-gray-200">{signal.message}</div>
      {signal.url && (
        <div className="mt-1 truncate font-mono text-[10px] text-gray-500 dark:text-gray-400" title={signal.url}>{signal.url}</div>
      )}
    </li>
  );
}
```

- [ ] **Step 4: Add dark variants to `VerificationResultModal`**

Replace the content wrapper and its summary text (originally lines 468-469):

```tsx
      <div className="max-h-[70vh] overflow-y-auto bg-white px-5 py-4 dark:bg-nova-dark">
        <p className="text-sm leading-relaxed text-gray-800 dark:text-gray-200">{result.summary}</p>
```

Replace the "Reproduced Signals" label (originally lines 478-480):

```tsx
            <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              Reproduced Signals ({result.matchedSignals.length})
            </div>
```

Replace the RESOLVED note (originally lines 490-494):

```tsx
        {result.verdict === 'RESOLVED' && (
          <div className="mt-4 rounded-md border border-green-200 bg-green-50 p-3 text-xs text-green-800 dark:border-green-800 dark:bg-green-950/30 dark:text-green-300">
            The recorded reproduction timeline replayed cleanly — none of the original fault's signals recurred.
          </div>
        )}
```

Replace the INCONCLUSIVE note (originally lines 496-500):

```tsx
        {result.verdict === 'INCONCLUSIVE' && (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            {result.error || 'The replay could not run to completion, so this verdict is not trustworthy. Try again.'}
          </div>
        )}
```

Replace the footer and its two buttons (originally lines 503-522):

```tsx
      {/* Footer actions */}
      <div className="flex items-center justify-end gap-2 rounded-b-lg border-t border-gray-200 bg-white px-5 py-3 dark:border-gray-700 dark:bg-nova-dark">
        <button
          type="button"
          onClick={onReverify}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-600 dark:bg-slate-800 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M20 12a8 8 0 11-2.3-5.6M20 4v4h-4" />
          </svg>
          Re-verify
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-gray-700 dark:bg-gray-700 dark:hover:bg-gray-600"
        >
          Close
        </button>
      </div>
```

- [ ] **Step 5: Add dark variants + typography systemization to `FindingCard`**

Replace the card container opening (originally line 571):

```tsx
    <div className={`overflow-hidden rounded-lg border ${theme.cardBorder} bg-white shadow-sm dark:bg-slate-900`}>
```

Replace the Message/Selector/Payload grid (originally lines 616-632):

```tsx
      {/* Message / Selector / Payload grid */}
      <div className="grid grid-cols-1 gap-3 px-4 pt-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <div className="text-caption font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Message</div>
          <div className="mt-0.5 text-sm text-gray-800 dark:text-gray-200">{bug.message || 'No details provided'}</div>
        </div>
        <div className="min-w-0">
          <div className="text-caption font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Selector</div>
          <div className="mt-0.5 truncate font-mono text-xs text-gray-700 dark:text-gray-300" title={bug.selector}>{bug.selector || 'N/A'}</div>
        </div>
        {bug.payloadUsed && (
          <div className="min-w-0">
            <div className="text-caption font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Payload Used</div>
            <div className="mt-0.5 truncate font-mono text-xs text-gray-700 dark:text-gray-300" title={bug.payloadUsed}>{bug.payloadUsed}</div>
          </div>
        )}
      </div>
```

Replace the Reproduction Trace label and empty-state (originally lines 634-651):

```tsx
      {/* Reproduction steps — prefer the structured, replayable trace (same timeline
          Verify Fix replays); fall back to the prose checklist, then the empty message. */}
      <div className="px-4 pt-3">
        {bug.actionSteps && bug.actionSteps.length > 0 ? (
          <div>
            <div className="mb-2 text-caption font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              Reproduction Trace ({bug.actionSteps.length} steps)
            </div>
            <ActionStepList steps={bug.actionSteps} />
          </div>
        ) : bug.reproductionSteps && bug.reproductionSteps.length > 0 ? (
          <ReproductionChecklist steps={bug.reproductionSteps} />
        ) : (
          <div className="rounded-md border border-gray-200 bg-gray-100 p-3 text-xs italic text-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-500">
            No deterministic reproduction steps were recorded for this fault.
          </div>
        )}
      </div>
```

Replace the Suggested Fix label (originally lines 654-657):

```tsx
      {/* Suggested fix */}
      <div className="px-4 pt-3 pb-4">
        <div className="mb-2 text-caption font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Suggested Fix</div>
        <SuggestedFixBlock advice={bug.advice} />
      </div>
```

- [ ] **Step 6: Add dark variants to `ActionStepList`** (shared by `FindingCard` and the appendix)

Replace `ActionStepList` (originally lines 215-231):

```tsx
function ActionStepList({ steps }: { steps: ForensicActionStep[] }) {
  return (
    <ol className="max-h-96 space-y-1 overflow-y-auto font-mono text-xs text-gray-600 dark:text-gray-400">
      {steps.map((step) => (
        <li key={step.stepNumber} className="border-b border-gray-100 py-1 last:border-0 dark:border-gray-800">
          <span className="text-gray-400 dark:text-gray-500">#{step.stepNumber}</span>{' '}
          <span className="font-semibold text-gray-700 dark:text-gray-300">{step.actionType}</span>
          {step.payloadText ? <span> with "{step.payloadText}"</span> : null}
          {' on '}
          <span>{stepTarget(step)}</span>
          {typeof step.durationMs === 'number' && <span className="text-gray-400 dark:text-gray-500"> ({step.durationMs}ms)</span>}
          <span className="text-gray-400 dark:text-gray-500"> ({formatDate(step.timestamp)})</span>
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 7: Add dark variants to `CleanRunCard`**

Replace (originally lines 685-693):

```tsx
function CleanRunCard() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-6 py-10 text-center dark:border-green-900 dark:bg-green-950/20">
      <span className="text-2xl">✅</span>
      <div className="text-sm font-semibold text-green-800 dark:text-green-300">No findings were recorded for this session</div>
      <div className="text-xs text-green-700 dark:text-green-400">The autonomous run completed without confirming any bugs or vulnerabilities.</div>
    </div>
  );
}
```

- [ ] **Step 8: Typecheck**

Run: `cd developer-dashboard && npx tsc -b`
Expected: exits 0, no errors.

- [ ] **Step 9: Commit**

```bash
git add developer-dashboard/src/components/forensics/ForensicReport.tsx
git commit -m "add dark mode and typography systemization to FindingCard and Verify Fix flow"
```

---

## Task 10: `ForensicReport.tsx` — Tabs, Network/Console logs, Action Timeline appendix

**Files:**
- Modify: `developer-dashboard/src/components/forensics/ForensicReport.tsx` (functions: `TabCount`, `TabButton`, `EmptyTab`, `statusTint`, `NetworkLogList`, `CONSOLE_LEVEL_STYLES`, `ConsoleLogList`, `ActionTimelineAppendix`; plus the tab-bar wrapper `<section>` in the default export)

**Interfaces:**
- Consumes: `ForensicNetworkLog`, `ForensicConsoleLog` types (unchanged), `ActionStepList` (Task 9), `CopyButton` (Task 7).
- Produces: no signature changes.

- [ ] **Step 1: Add dark variants to `TabCount`, `TabButton`, `EmptyTab`**

Replace `TabCount` (originally lines 714-721):

```tsx
function TabCount({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-1.5 rounded-full bg-gray-200 px-1.5 py-0.5 font-mono text-[10px] leading-none text-gray-700 dark:bg-gray-700 dark:text-gray-300">
      {count > 999 ? '999+' : count}
    </span>
  );
}
```

Replace `TabButton` (originally lines 723-738):

```tsx
function TabButton({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center whitespace-nowrap border-b-2 px-3 py-2 text-xs font-semibold transition-colors ${
        active
          ? 'border-gray-900 text-gray-900 dark:border-gray-100 dark:text-gray-100'
          : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
      }`}
    >
      {label}
      <TabCount count={count} />
    </button>
  );
}
```

Replace `EmptyTab` (originally lines 740-746):

```tsx
function EmptyTab({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-8 text-center text-xs italic text-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-500">
      {message}
    </div>
  );
}
```

- [ ] **Step 2: Add dark variants to `statusTint` and `NetworkLogList`**

Replace `statusTint` (originally lines 749-754):

```typescript
function statusTint(row: ForensicNetworkLog): { border: string; bg: string; status: string } {
  const code = row.statusCode ?? 0;
  if (!row.ok || code >= 500) return { border: 'border-red-200 dark:border-red-900', bg: 'bg-red-50 dark:bg-red-950/30', status: 'text-red-700 dark:text-red-400' };
  if (code >= 400) return { border: 'border-amber-200 dark:border-amber-900', bg: 'bg-amber-50 dark:bg-amber-950/30', status: 'text-amber-700 dark:text-amber-400' };
  return { border: 'border-gray-200 dark:border-gray-700', bg: 'bg-white dark:bg-slate-900', status: 'text-green-700 dark:text-green-400' };
}
```

Replace `NetworkLogList` (originally lines 756-781):

```tsx
function NetworkLogList({ rows }: { rows: ForensicNetworkLog[] }) {
  if (!rows.length) return <EmptyTab message="No network requests were recorded for this session." />;
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row, i) => {
        const tint = statusTint(row);
        return (
          <li key={i} className={`rounded-md border ${tint.border} ${tint.bg} p-3`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-gray-800 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-white">{row.method}</span>
              <span className={`font-mono text-[11px] font-bold ${tint.status}`}>{row.ok || row.statusCode ? `HTTP ${row.statusCode ?? '—'}` : 'FAILED'}</span>
              {row.resourceType && (
                <span className="font-mono text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">{row.resourceType}</span>
              )}
              {row.repeatCount && row.repeatCount > 1 && (
                <span className="font-mono text-[10px] text-gray-500 dark:text-gray-400">×{row.repeatCount}</span>
              )}
            </div>
            <div className="mt-1 truncate font-mono text-[11px] text-gray-600 dark:text-gray-400" title={row.url}>{row.url}</div>
            {row.message && !row.ok && <div className="mt-1 break-words text-xs text-gray-800 dark:text-gray-200">{row.message}</div>}
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 3: Add dark variants to `CONSOLE_LEVEL_STYLES` and `ConsoleLogList`**

Replace `CONSOLE_LEVEL_STYLES` (originally lines 783-791):

```typescript
const CONSOLE_LEVEL_STYLES: Record<string, string> = {
  error: 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300',
  warning: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
  info: 'bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300',
  debug: 'bg-purple-100 text-purple-800 dark:bg-purple-950/50 dark:text-purple-300',
  trace: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  notice: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  log: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
};
```

Replace `ConsoleLogList` (originally lines 794-812):

```tsx
function ConsoleLogList({ rows }: { rows: ForensicConsoleLog[] }) {
  if (!rows.length) return <EmptyTab message="No console output was recorded for this session." />;
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row, i) => (
        <li key={i} className="rounded-md border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-slate-900">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase ${CONSOLE_LEVEL_STYLES[row.level] ?? CONSOLE_LEVEL_STYLES.log}`}>{row.level}</span>
            {row.url && <span className="truncate font-mono text-[10px] text-gray-400 dark:text-gray-500" title={row.url}>{row.url}</span>}
          </div>
          {row.message && <div className="mt-1 break-words font-mono text-[11px] text-gray-800 dark:text-gray-200">{row.message}</div>}
          {row.stackTrace && (
            <pre className="mt-2 max-h-40 overflow-auto rounded bg-gray-900 p-2 font-mono text-[10px] leading-relaxed text-gray-200">{row.stackTrace}</pre>
          )}
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Add dark variants to `ActionTimelineAppendix`**

Replace (originally lines 814-842):

```tsx
function ActionTimelineAppendix({ steps }: { steps: ForensicActionStep[] }) {
  const [isOpen, setIsOpen] = useState(false);

  if (!steps.length) return null;

  const timelineText = steps.map(stepLine).join('\n');

  return (
    <section className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-slate-900">
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
      >
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Full Action Timeline ({steps.length} steps) — reference
        </span>
        <span className="text-xs text-gray-400 dark:text-gray-500">{isOpen ? '▼ Collapse' : '▶ Expand'}</span>
      </button>
      {isOpen && (
        <div className="border-t border-gray-200 px-4 py-4 dark:border-gray-700">
          <div className="mb-3 flex justify-end">
            <CopyButton text={timelineText} label="Action Timeline" />
          </div>
          <ActionStepList steps={steps} />
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Add dark variant to the tab-bar wrapper in the default export**

Replace the tab bar container (originally line 962):

```tsx
            <div className="mb-4 flex flex-wrap items-center gap-1 border-b border-gray-200 dark:border-gray-700">
```

- [ ] **Step 6: Typecheck**

Run: `cd developer-dashboard && npx tsc -b`
Expected: exits 0, no errors.

- [ ] **Step 7: Commit**

```bash
git add developer-dashboard/src/components/forensics/ForensicReport.tsx
git commit -m "add dark mode to ForensicReport tabs, network/console logs, and action timeline"
```

---

## Task 11: Full end-to-end verification pass

**Files:** none (verification only — fix-forward if this task finds a gap, using the same file/class conventions established in Tasks 4-10)

**Interfaces:** N/A

- [ ] **Step 1: Build both packages**

Run: `cd testing-core && npm run build`
Expected: exits 0.

Run: `cd developer-dashboard && npm run build`
Expected: exits 0 (this runs `tsc -b && vite build`, so it also re-confirms every earlier typecheck).

- [ ] **Step 2: Start both dev servers**

Run: `cd testing-core && npm run dev` (background)
Run: `cd developer-dashboard && npm run dev` (background)

- [ ] **Step 3: Get to a real Forensic Report page**

Open the dashboard URL, run at least one exploration session to completion (or use an existing saved session from History if one exists), then open its Forensic Report page (`/forensics/report/:sessionId` or equivalent History → row click, per existing navigation).

- [ ] **Step 4: Visual pass — light mode**

With Settings → theme set to "Light": confirm on the Forensic Report page:
1. Executive summary stat grid renders with dark-gray numbers on a light tinted card matching session status (red/amber/green).
2. AI Insights panel (if the session has `aiAnalysis`) renders with a light-blue background and readable text.
3. Findings tab: each finding card header shows correct verdict-tinted background; attribution badges are legible; Message/Selector/Payload grid is legible; reproduction trace or amber "Reproduction Playbook" renders; Suggested Fix code block (dark slate/green) is visually intentional against the light card.
4. Network and Console tabs render legibly with correct status tinting.
5. Action Timeline appendix expands/collapses correctly.
6. Click "Verify Fix" on a finding with a `bugId` (if any) — confirm the running pill, then the result modal render correctly in light mode.

- [ ] **Step 5: Visual pass — dark mode**

Switch Settings → theme to "Dark". Repeat all six checks from Step 4. Specifically confirm:
1. No white/light "flash" boxes remain anywhere (every panel, card, list item, and modal has a dark background).
2. All text meets basic readability — no dark-gray-on-dark-background or light-gray-on-light-background combinations.
3. Status-tinted surfaces (red/amber/green/blue) read as desaturated dark-tinted panels, not the raw light-mode colors on a dark page.
4. Badges inside `AttributionBadges` are legible.
5. The Verify Fix result modal (all three verdict tones — trigger via different findings if available, or inspect each `VERDICT_META` branch in code review if only one verdict is reproducible live) renders correctly dark.

- [ ] **Step 6: Visual pass — system mode**

Switch Settings → theme to "System". Using devtools → Rendering → "Emulate CSS prefers-color-scheme", toggle dark/light and confirm the Forensic Report page updates live to match, with the same fidelity as Steps 4-5.

- [ ] **Step 7: Settings page dark mode spot-check**

With each of the three theme modes active, open Settings and confirm the new `ThemeModeControl` segmented control itself renders correctly (selected segment visually distinct in both light and dark) and that Account/Security sections (untouched by this plan) still render correctly — regression check only, no changes expected there.

- [ ] **Step 8: Report results**

If every check in Steps 4-7 passes: the feature is complete, no further commits needed for this plan.

If any check fails: fix the specific class(es) in the relevant file using the same mapping conventions from Global Constraints, re-run Step 1's typecheck, then commit with a message describing the specific gap fixed (e.g. `git commit -m "fix low-contrast text in dark ConsoleLogList timestamps"`).

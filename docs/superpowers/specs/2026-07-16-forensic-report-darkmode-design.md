# ForensicReport UI/UX + Dark Mode + Theme Toggle — Design

## Goal
Refactor `ForensicReport.tsx` and every component it renders for polished typography and full light/dark mode support. Add a Light/Dark/System theme toggle to Settings.

## Scope
- `developer-dashboard/src/components/forensics/ForensicReport.tsx` (all local subcomponents)
- `developer-dashboard/src/components/common/ForensicCardKit.tsx`
- `developer-dashboard/src/components/telemetry/ReproductionChecklist.tsx`
- `developer-dashboard/src/components/history/CoverageProgressBar.tsx`
- `developer-dashboard/src/components/ui/Badge.tsx`
- `developer-dashboard/src/components/ui/Modal.tsx` (verify only — already dark-complete)
- `developer-dashboard/src/context/DarkModeContext.tsx`
- `developer-dashboard/src/components/settings/Settings.tsx`
- `developer-dashboard/src/utils/settingsStorage.ts`
- `developer-dashboard/src/hooks/useUserSettings.ts`
- `developer-dashboard/src/types.ts`
- `testing-core/src/presentation/authentication/userSettingsController.ts`

Out of scope: no new external libraries, no Mongoose schema/migration (settings is a schemaless field already), no visual re-skin away from the existing NovaSpark design system.

## 1. Theme architecture — add "system" mode

Currently `theme` is `'light' | 'dark'` end to end (frontend types, localStorage, backend validation). Extending to a tri-state `'light' | 'dark' | 'system'`, full stack:

- `testing-core/.../userSettingsController.ts`: widen `UserSettings.theme` type and the `handleUpdateSettings` validation branch to accept `'system'`. Defaults stay `'light'`. No schema/DB change — `settings` is stored as an undeclared/dynamic field already.
- `developer-dashboard/src/types.ts`: widen `UserSettings['theme']` and `ThemeMode` to the tri-state union.
- `developer-dashboard/src/utils/settingsStorage.ts`: widen the parsed-value guard to accept `'system'`.
- `developer-dashboard/src/hooks/useUserSettings.ts`: widen the local `SettingsResponse.theme` type to match.
- `developer-dashboard/src/context/DarkModeContext.tsx`:
  - Store the raw selected `mode: 'light' | 'dark' | 'system'` (seeded synchronously from `loadGuestSettings()` to avoid flash-of-wrong-theme).
  - Derive `isDark` from `mode`: `'dark'` → true, `'light'` → false, `'system'` → `matchMedia('(prefers-color-scheme: dark)').matches`.
  - While `mode === 'system'`, subscribe to the `matchMedia` change event and update `isDark` live; unsubscribe on mode change/unmount.
  - Keep applying `.dark` class on `<html>` from the derived `isDark`, unchanged from today.
  - Expose `mode` and `setMode` (rename/extend the existing `isDark`/`setIsDark` API); `Settings.tsx` calls `setMode` instead of `setIsDark`.

## 2. Settings page — theme control

Replace the existing binary "Dark Mode" `ToggleSwitch` row in `ApplicationSettingsSection` with a 3-segment control: Light / Dark / System (icon + label per segment, `role="radiogroup"`/`radio` semantics, one 44px-min touch target per segment). Selecting a segment calls `updateSettings({ theme })` then `setMode(theme)` for immediate feedback (same optimistic-update pattern already used for the toggle). Sync effect (`settings.theme` → context) updates to pass `mode` through as-is (no `=== 'dark'` boolean collapse).

## 3. ForensicReport.tsx — typography + dark mode systemization

No new type scale — reuse the tokens already defined in `index.css` (`--text-h4`, `--text-body-sm`, `--text-caption`, existing font-mono/font-sans). Standardize weight tiers: 700 for headings/stat values, 600 for uppercase section labels, 500 for medium labels, 400 for body copy. Tabular numerals (`tabular-nums`) on stat values (duration/actions/findings/risk score) so digits don't jitter.

Dark mode pass, component by component:

- **Page chrome** (root div, header, main, footer): align to the same tokens `Settings.tsx` already uses — `dark:bg-slate-900`, `dark:border-gray-700`, `dark:text-gray-100` / `dark:text-gray-400` for secondary text, `dark:bg-gray-800` for the report body wrapper equivalent.
- **`ExecutiveSummary` / `StatBlock`**: `statusTheme()`/`riskTheme()` gain dark variants per tone (red/amber/green — desaturated tonal variants per dark-mode-pairing, not inverted). Labels use `--text-caption` at weight 600, values `--text-h4`-ish at weight 700.
- **`AiInsightsPanel`**: already has dark classes on most nodes — audit for any bare `text-gray-*` without a `dark:` pair and fill gaps.
- **`FindingCard`, `VERDICT_META`, `BASE_CARD`**: add dark `cardBorder`/`cardHeaderBg`/`cardTitle`/`cardSub`/`numberBg`-equivalent variants per verdict tone so the card still visibly re-themes to RESOLVED/STILL_ACTIVE/INCONCLUSIVE in dark mode.
- **`VerifyFixControl`, `VerificationResultModal`, `ResultStat`, `ReproducedSignal`**: dark surfaces/borders/text; modal shell already dark (`Modal.tsx`), extend the inner content backgrounds (`bg-white` → add `dark:bg-nova-dark` equivalent, `bg-gray-50` stat tiles → dark surface).
- **`NetworkLogList`, `ConsoleLogList`, `TabButton`, `TabCount`, `EmptyTab`, `ActionTimelineAppendix`, `ActionStepList`, `CleanRunCard`**: dark surfaces/borders throughout; console `<pre>` stack trace block is already dark (`bg-gray-900`) — leave as is.

## 4. Shared components used inside the report

- **`ForensicCardKit.tsx`** (`CopyButton`, `ExpandableCodeBlock`, `SuggestedFixBlock`): add dark hover/bg/border/text variants. `SuggestedFixBlock`'s green-on-slate code block is already dark-friendly — no change.
- **`ReproductionChecklist.tsx`**: amber playbook theme gets dark variants (amber-950/900-tier surfaces, amber-200/300 text).
- **`CoverageProgressBar.tsx`** (+ `CoverageDisplay`): track/fill colors get dark-tier variants (e.g. `dark:bg-red-950` track), percentage label gets `dark:text-gray-400`.
- **`Badge.tsx`**: add `dark:` variants for all 5 variants (default/primary/success/warning/danger). This is a shared primitive used beyond the forensic report — safe, additive, backward compatible.
- **`Modal.tsx`**: already fully dark-capable (`dark:bg-nova-dark dark:border-gray-700`) — verify only, no changes expected.

## Non-goals
- No structural/layout redesign (tabs, card grouping, executive-summary-then-tabs flow all stay as is).
- No new color palette or design system — stays within NovaSpark tokens already in `index.css`.
- No backend schema/migration work beyond widening the literal type + validation branch.

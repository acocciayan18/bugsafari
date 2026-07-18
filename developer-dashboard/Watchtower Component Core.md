# Watchtower Component Core
### Design system for BugSafari — portable spec

Autonomous, scriptless QA platform for SPAs. "Watchtower Component Core" = the black-box tracking lens turning automated web chaos into structured, explainable developer evidence. Primary audience: student developers and independent engineers needing fast signal before a demo or deployment.

**Sources:** local codebase (`testing-core/`, `developer-dashboard/`, `shared/`), GitHub [`acocciayan18/bugsafari`](https://github.com/acocciayan18/bugsafari). Re-explore both — this doc is a distillation, not a replacement.

> **Visual-direction note:** the live app's current frontend code is skinned as a generic, unbranded blue SaaS template (no BugSafari identity anywhere in it). This spec instead follows the brief's stated direction — elite, high-density industrial monochrome, sharp slate borders, terminal typography, amber/crimson reserved for verified real-time failures — applied on top of the app's real structure, copy, and component inventory. No logo file exists in source; a plain wordmark stands in for a mark until one is supplied.

---

## 1. Content fundamentals

- **Voice:** clinical, forensic, third-person-system. The product narrates itself as an instrument ("Session flagged for review", "Engine halted") rather than speaking conversationally.
- **Casing:** ALL CAPS + letter-spacing for labels, nav items, status pills (`TERMINAL ACCESS`, `STEP`, `SAVED EVALUATION SAFARIS`). Sentence case for prose.
- **Vocabulary:** a test run is a "Safari"/"Evaluation Safari"; findings are "Findings"/"Caught Bugs"; sessions are `CRASHED / HALTED / COMPLETED`; coverage is 0–100%. Use this vocabulary, not generic QA terms.
- **No emoji.**
- **Numbers over adjectives:** "3 CRITICAL", "91% coverage", "412 steps".
- **Real example strings:** `TERMINAL ACCESS`, `ADMIN_01`, `SAVED EVALUATION SAFARIS`, "Launch a test to start streaming actions, heuristic scores, and exceptions.", `END OF FORENSIC RECORD MANIFEST — V.8.2.19`.

## 2. Visual foundations

- **Palette:** monochrome-first, with a full light theme (`data-theme="light"`) alongside the default dark. Amber/crimson/green are semantic-only in both themes — never decorative.
- **Type:** **Poppins** (sans) is the primary UI voice — headings, buttons, nav, labels, body — chosen to read warmer and less generic/AI-templated than a default system sans. It is also for literal data/terminal content only: badges, timestamps, IDs, coverage %, the raw telemetry/log stream.
- **Spacing/grid:** strict 8px unit underlies all padding/gaps.
- **Radius:** sharp, 0–4px max; pill only for dots/progress bars, never buttons or cards.
- **Depth:** hairline borders (1px) are the primary structure tool; shadows are flat 1-line definition shadows, never soft blurred lifts.
- **Backgrounds:** flat only — no photography, illustration, gradients, patterns. 5 discrete surface elevation steps per theme.
- **Motion:** fast, linear — 100–160ms, `cubic-bezier(0.2,0,0,1)`. No springs/bounce/scale-pop. Fade is the only entrance animation.
- **Hover/press:** hover = one surface step brighter (bg or border); press = one step further. No hue shifts, no shrink/scale.
- **Transparency/blur:** none, anywhere — even the modal backdrop is solid.
- **Cards:** hairline border, near-zero radius, one surface step up, minimal shadow; `hoverable` only brightens the border.

## 3. Iconography

Hand-authored inline outline SVGs (Heroicons-outline style: 1.5–2px stroke, `currentColor`, no fill). A small SVG sprite covers auth/footer glyphs (user/lock/eye + GitHub/X/Discord/Bluesky). No icon font, no emoji, no unicode-character icons.

## 4. Design tokens

### Colors — dark (default)
```css
--wc-black:#08090b;       --wc-ink:#0d0f13;
--wc-graphite-950:#111318; --wc-graphite-900:#161920;
--wc-graphite-800:#1d212b; --wc-graphite-700:#262b37;
--wc-slate-600:#3a4150;   --wc-slate-500:#525a6b;
--wc-slate-400:#727b8e;   --wc-slate-300:#9aa2b2;
--wc-slate-200:#c2c8d3;   --wc-slate-100:#e2e5eb;
--wc-white:#f4f5f7;

--wc-amber:#f0a020;   --wc-amber-dim:#7a5518;   --wc-amber-bg:#241d0e;
--wc-crimson:#e5484d; --wc-crimson-dim:#7a2b2d; --wc-crimson-bg:#26100f;
--wc-signal-green:#3ecf7e; --wc-signal-green-dim:#1f6b45; --wc-signal-green-bg:#0e2019;

--surface-app:var(--wc-black);        --surface-panel:var(--wc-ink);
--surface-raised:var(--wc-graphite-900); --surface-inset:var(--wc-graphite-950);
--surface-hover:var(--wc-graphite-800);
--border-hairline:var(--wc-graphite-700); --border-strong:var(--wc-slate-600); --border-focus:var(--wc-slate-300);

--text-primary:var(--wc-white); --text-secondary:var(--wc-slate-300);
--text-tertiary:var(--wc-slate-500); --text-disabled:var(--wc-slate-600);

--surface-invert:var(--wc-white); --surface-invert-hover:var(--wc-slate-100);
--surface-invert-active:var(--wc-slate-200); --text-oninvert:var(--wc-black);

--status-warning-fg:var(--wc-amber);       --status-warning-bg:var(--wc-amber-bg);       --status-warning-border:var(--wc-amber-dim);
--status-critical-fg:var(--wc-crimson);    --status-critical-bg:var(--wc-crimson-bg);    --status-critical-border:var(--wc-crimson-dim);
--status-stable-fg:var(--wc-signal-green); --status-stable-bg:var(--wc-signal-green-bg); --status-stable-border:var(--wc-signal-green-dim);
--status-neutral-fg:var(--wc-slate-300);   --status-neutral-bg:var(--wc-graphite-800);   --status-neutral-border:var(--wc-slate-600);
```

### Colors — light theme (`[data-theme="light"]`)
```css
--surface-app:#f4f5f7;   --surface-panel:#ffffff; --surface-raised:#ffffff;
--surface-inset:#eceef1; --surface-hover:#e8eaee;
--border-hairline:#dde1e8; --border-strong:#b8bfcb; --border-focus:#4b5563;

--text-primary:#14161b; --text-secondary:#454b5c;
--text-tertiary:#767e8e; --text-disabled:#b8bfcb;

--surface-invert:#14161b; --surface-invert-hover:#2a2e38;
--surface-invert-active:#3a3f4b; --text-oninvert:#ffffff;

--status-warning-fg:#8a5a10;  --status-warning-bg:#fdf1db;  --status-warning-border:#e8b968;
--status-critical-fg:#b3282c; --status-critical-bg:#fbe4e4; --status-critical-border:#e79a9c;
--status-stable-fg:#1f7a4d;   --status-stable-bg:#e2f6ea;   --status-stable-border:#8fd6ac;
--status-neutral-fg:#454b5c;  --status-neutral-bg:#e9ebef;  --status-neutral-border:#c7cdd6;
```

### Typography
```css
--font-sans:'Poppins', ui-sans-serif, system-ui, sans-serif;

--text-display:40px/1.1;  --text-h1:28px/1.2;  --text-h2:20px/1.3;  --text-h3:15px/1.4;
--text-body:13px/1.55;    --text-small:12px/1.4;  --text-micro:10px/1.3;

--tracking-label:0.08em;  --tracking-wide:0.14em;
```

### Spacing
```css
--space-1:4px;  --space-2:8px;  --space-3:12px; --space-4:16px;
--space-5:20px; --space-6:24px; --space-8:32px; --space-10:40px; --space-12:48px; --space-16:64px;
--grid-unit:8px; --grid-gutter:16px;
--sidebar-width:220px; --sidebar-width-collapsed:56px;
```

### Effects
```css
--radius-none:0px; --radius-sm:2px; --radius-md:3px; --radius-lg:4px; --radius-pill:999px;
--border-width-hairline:1px; --border-width-strong:1.5px;
--shadow-sm:0 1px 0 rgba(0,0,0,0.4);
--shadow-panel:0 1px 0 rgba(0,0,0,0.5), 0 0 0 1px rgba(0,0,0,0.3);
--shadow-overlay:0 16px 40px rgba(0,0,0,0.55);
--ease-standard:cubic-bezier(0.2,0,0,1); --ease-out:cubic-bezier(0,0,0.2,1);
--duration-fast:100ms; --duration-base:160ms;
```

## 5. Components

Built from the dashboard's real `components/ui/` inventory (Button, Badge, Card, Input, Modal) plus two structural primitives pulled from real screens (Sidebar, coverage bar).

| Component | Variants / props | Notes |
|---|---|---|
| **Button** | `primary·secondary·ghost·destructive·link` × `sm·md·lg`, `isLoading` | Solid invert bg for primary; one CTA per screen |
| **Badge** | `neutral·stable·warning·critical`, `dot` | Status/severity pill, mono type |
| **Card** | `hoverable` | Flat bordered surface, border-only hover |
| **Input** | `inputSize: md·lg`, `error`, `hint`, `label` | Labeled text field |
| **Modal** | `isOpen`, `onClose`, `closeOnBackdrop` | Centered dialog, Escape + backdrop close, solid backdrop |
| **SidebarNav** | `items`, `activeKey`, `isCollapsed`, `footer` | Collapsible left nav shell, amber active indicator |
| **CoverageBar** | `percentage`, `width`, `height` | Red 0–40 / amber 41–70 / green 71–100 banding |

### Intentional additions
- `SidebarNav` is generalized (item list + footer slot) beyond the source's hardcoded 3-link version.
- `CoverageBar` reuses `CoverageProgressBar.tsx`'s exact band thresholds, decoupled from Tailwind.

## 6. UI kit

`ui_kits/developer-dashboard/` — click-through recreation: **Login**, **Dashboard** (live forensics terminal), **Forensic History** (filterable saved-safari list), with a light/dark theme toggle.

## 7. File index

```
styles.css                    — root stylesheet, imports every token file
tokens/                        — colors, typography, spacing, effects, fonts
components/core                — Button, Badge, Card, Input, Modal
components/navigation          — SidebarNav
components/data                — CoverageBar
guidelines/                    — foundation specimen cards
ui_kits/developer-dashboard/    — Login / Dashboard / History click-through kit
assets/icons/                  — auth-social-sprite.svg
```

---
*Generated from the Watchtower Component Core design system. For the live, browsable version (specimen cards, running components, click-through UI kit) see the project itself — this file is a static, portable reference.*

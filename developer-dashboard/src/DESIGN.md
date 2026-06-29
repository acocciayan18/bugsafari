# NovaSpark Design System

## Brand Identity

**Brand Name:** NovaSpark  
**Tagline:** *Ignite Your Ideas*  
**Industry:** SaaS / Productivity  

---

## Color Palette

### Primary Colors
| Name | Hex | Usage |
|------|-----|-------|
| Nova Blue | `#2563EB` | Primary actions, links, CTAs |
| Nova Dark | `#0F172A` | Backgrounds, headers |
| Nova Light | `#F8FAFC` | Page backgrounds, cards |

### Accent Colors
| Name | Hex | Usage |
|------|-----|-------|
| Spark Orange | `#F97316` | Highlights, badges, alerts |
| Spark Green | `#22C55E` | Success states, confirmations |
| Spark Red | `#EF4444` | Errors, destructive actions |

### Neutral Colors
| Name | Hex | Usage |
|------|-----|-------|
| Gray 900 | `#111827` | Primary text |
| Gray 600 | `#4B5563` | Secondary text |
| Gray 300 | `#D1D5DB` | Borders, dividers |
| Gray 100 | `#F3F4F6` | Subtle backgrounds |

---

## Typography

### Font Families
- **Headings:** `Inter` (Bold 700, Semibold 600)
- **Body:** `Inter` (Regular 400, Medium 500)
- **Code/Mono:** `JetBrains Mono`

### Type Scale
| Name | Size | Line Height | Weight | Usage |
|------|------|-------------|--------|-------|
| Display | 48px | 1.1 | 700 | Hero headings |
| H1 | 36px | 1.2 | 700 | Page titles |
| H2 | 28px | 1.3 | 600 | Section headings |
| H3 | 22px | 1.4 | 600 | Card headings |
| H4 | 18px | 1.4 | 600 | Sub-sections |
| Body LG | 18px | 1.6 | 400 | Lead text |
| Body | 16px | 1.6 | 400 | Default body |
| Body SM | 14px | 1.5 | 400 | Captions, labels |
| Caption | 12px | 1.4 | 500 | Metadata, tags |

---

## Spacing System

Based on a **4px base unit**.

| Token | Value | Usage |
|-------|-------|-------|
| `space-1` | 4px | Tight gaps |
| `space-2` | 8px | Icon padding |
| `space-3` | 12px | Small padding |
| `space-4` | 16px | Default padding |
| `space-6` | 24px | Card padding |
| `space-8` | 32px | Section gaps |
| `space-12` | 48px | Large sections |
| `space-16` | 64px | Page sections |
| `space-24` | 96px | Hero spacing |

---

## Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `radius-sm` | 4px | Inputs, small buttons |
| `radius-md` | 8px | Cards, buttons |
| `radius-lg` | 12px | Modals, panels |
| `radius-xl` | 16px | Feature cards |
| `radius-full` | 9999px | Pills, avatars |

---

## Shadows

| Token | Value | Usage |
|-------|-------|-------|
| `shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` | Subtle lift |
| `shadow-md` | `0 4px 6px rgba(0,0,0,0.07)` | Cards |
| `shadow-lg` | `0 10px 15px rgba(0,0,0,0.1)` | Dropdowns |
| `shadow-xl` | `0 20px 25px rgba(0,0,0,0.15)` | Modals |

---

## Components

### Buttons

#### Variants
- **Primary** — Filled, Nova Blue background
- **Secondary** — Outlined, Nova Blue border
- **Ghost** — No border, transparent background
- **Destructive** — Filled, Spark Red background
- **Link** — No background, underline on hover

#### Sizes
| Size | Height | Padding | Font Size |
|------|--------|---------|-----------|
| SM | 32px | 8px 12px | 14px |
| MD | 40px | 10px 16px | 15px |
| LG | 48px | 12px 24px | 16px |

#### States
- Default → Hover (10% darker) → Active (20% darker) → Disabled (40% opacity)
- Focus: 2px offset ring in Nova Blue

---

### Inputs

- Height: **40px** (MD), **48px** (LG)
- Border: `1px solid #D1D5DB`
- Focus border: `2px solid #2563EB`
- Border radius: `radius-md`
- Padding: `12px 16px`
- Placeholder color: `Gray 400`
- Error state: Red border + error message below

---

### Cards

- Background: `#FFFFFF`
- Border: `1px solid #E5E7EB`
- Border radius: `radius-lg`
- Padding: `space-6`
- Shadow: `shadow-md`
- Hover: `shadow-lg` + slight translateY(-2px)

---

### Badges / Tags

| Variant | Background | Text |
|---------|------------|------|
| Default | `#E5E7EB` | `#374151` |
| Primary | `#DBEAFE` | `#1D4ED8` |
| Success | `#DCFCE7` | `#15803D` |
| Warning | `#FEF3C7` | `#B45309` |
| Danger | `#FEE2E2` | `#B91C1C` |

---

### Navigation

- Sidebar width: **240px** (expanded), **64px** (collapsed)
- Top navbar height: **64px**
- Active item: Nova Blue left border (3px) + light blue background
- Item padding: `12px 16px`
- Icon size: `20px`

---

## Iconography

- **Library:** Lucide Icons
- **Default size:** 20px (inline), 24px (standalone)
- **Stroke width:** 1.5px
- **Color:** Inherits from text color

---

## Motion & Animation

| Token | Duration | Easing | Usage |
|-------|----------|--------|-------|
| `anim-fast` | 100ms | ease-out | Hover states |
| `anim-base` | 200ms | ease-in-out | Transitions |
| `anim-slow` | 350ms | ease-in-out | Modals, drawers |
| `anim-spring` | 400ms | cubic-bezier(0.34,1.56,0.64,1) | Scale-in effects |

---

## Grid & Layout

- **Max content width:** 1280px
- **Gutter:** 24px
- **Columns:** 12
- **Breakpoints:**

| Name | Width |
|------|-------|
| `sm` | 640px |
| `md` | 768px |
| `lg` | 1024px |
| `xl` | 1280px |
| `2xl` | 1536px |

---

## Dark Mode

| Light Token | Dark Equivalent |
|-------------|-----------------|
| `#FFFFFF` background | `#0F172A` |
| `#F3F4F6` subtle bg | `#1E293B` |
| `#111827` text | `#F1F5F9` |
| `#4B5563` muted text | `#94A3B8` |
| `#E5E7EB` border | `#334155` |

---

## Accessibility

- Minimum contrast ratio: **4.5:1** for body text, **3:1** for large text
- All interactive elements have visible focus rings
- Touch targets minimum: **44x44px**
- All icons paired with aria-labels or visible text
- Keyboard navigable: Tab, Enter, Escape, Arrow keys supported

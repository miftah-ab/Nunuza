# Nunuza — Brand Guide

**Status:** Logo approved. Tokens locked. Do not create alternate logos.
**Last updated:** 2026-10-27

---

## Logo assets

All assets live in `/public/brand/`. Use them by file reference — do not inline SVG strings in components; use the `<Logo>` component at `src/components/layout/Logo.tsx`.

| File | Use |
|------|-----|
| `logo-horizontal.svg` | Primary — header, light backgrounds, marketing |
| `logo-horizontal-dark.svg` | Dark backgrounds (forest green surface, inverted header) |
| `logo-icon.svg` | Icon-only mark — favicon, app switcher, small contexts |

**Rules:**
- Do not approximate the logo with text, an emoji, an arbitrary Lucide icon, or a CSS shape.
- Do not create new logo variants without explicit approval.
- If a logo file needs to change (correction, refinement), update the file and record the reason in `docs/DECISIONS.md`.
- The product name in all UI, metadata, email copy, and documentation is exactly **Nunuza** — capital N, all others lowercase.
- Do not use "powered by AI" as a brand idea. Emphasize workflow control and publishing operations.

---

## Colour palette

All tokens are defined in `tailwind.config.js` and `/src/app/globals.css`.
Components reference Tailwind class names (`bg-forest`, `text-ink-secondary`, etc.), not raw hex values.

| Token | Hex | Tailwind class | Usage |
|-------|-----|----------------|-------|
| Forest (primary) | `#174C3C` | `bg-forest` / `text-forest` | Primary buttons, links, brand mark |
| Forest hover | `#103B2F` | `hover:bg-forest-hover` | Button hover state |
| Forest light | `#EAF2EE` | `bg-forest-light` | Subtle tinted backgrounds, badges |
| Forest muted | `#C9DECE` | `text-forest-muted` | Light text on dark, dividers |
| Off-white | `#F8F8F5` | `bg-offwhite` | Page background, card fill, inputs |
| White | `#FFFFFF` | `bg-white` | Primary surface |
| Ink (primary text) | `#202522` | `text-ink` | Headings and body text |
| Ink secondary | `#68716C` | `text-ink-secondary` | Supporting copy, labels, meta |
| Border | `#E4E8E3` | `border-border` | Dividers, card outlines, inputs |
| Success | `#287A50` | `text-success` | Verified states, check icons |
| Success light | `#EAF5EF` | `bg-success-light` | Success badge background |
| Warning | `#A86412` | `text-warning` | Caution notices |
| Warning light | `#FDF3E3` | `bg-warning-light` | Warning badge background |
| Error | `#B93838` | `text-error` | Error states, destructive actions |
| Error light | `#FDEAEA` | `bg-error-light` | Error badge background |

**Contrast requirement:** All text on coloured backgrounds must meet WCAG 2.2 AA minimum contrast (4.5:1 for body, 3:1 for large text).

---

## Typography

| Role | Size | Weight | Class |
|------|------|--------|-------|
| Page title | 28–32px | 700 | `text-3xl font-bold` or `text-4xl font-bold` |
| Section title | 18–20px | 600 | `text-xl font-semibold` |
| Body | 15px | 400 | `text-body` (defined in globals.css) |
| Secondary / meta | 13–14px | 400 | `text-secondary text-ink-secondary` |
| Label / overline | 12px | 600 | `section-label` (defined in globals.css) |

- Font family: **Inter** — loaded via `next/font/google` in the root layout. Do not load it again in components.
- Line height: 1.6 for body; 1.2–1.3 for headings.
- Letter-spacing: `tracking-tight` (−0.01em) for headings larger than 20px.

---

## Icons

- Use **Lucide React** icons only, unless a specific approved asset is required.
- Sidebar/navigation icons: 18–20px.
- Inline/action icons: 16–18px.
- Icon-only interactive elements must have an accessible name via `aria-label` or `<title>`.
- Pair all navigation icons with visible text labels.
- Do not use emoji as icons.

---

## Component conventions

| Component class | File | Usage |
|----------------|------|-------|
| `btn-primary` | globals.css | Forest green primary action |
| `btn-secondary` | globals.css | White/bordered secondary action |
| `btn-ghost` | globals.css | Low-emphasis action |
| `card` | globals.css | Standard white card with border |
| `card-hover` | globals.css | Card with hover shadow |
| `input-field` | globals.css | Form text input |
| `section-label` | globals.css | Small caps section overline |
| `badge-draft-only` | globals.css | Green "Draft-only preview" badge |
| `badge-beta` | globals.css | Yellow "Beta" badge |
| `badge-active` | globals.css | Green "Active" badge |
| `badge-error` | globals.css | Red "Error" badge |

---

## Responsive breakpoints

| Breakpoint | Width | Usage |
|------------|-------|-------|
| Default (mobile) | 320–767px | Stacked layouts, compact typography |
| `md` | 768px | Two-column layouts, desktop nav visible |
| `lg` | 1024px | Three-column feature grids |
| `xl` | 1280px | Wider sidebar variants |

Test at: **320, 375, 390, 768, 1024, 1440** px widths. No horizontal page overflow at any width.

---

## Visual style rules

- **No** purple/blue gradients, neon colors, or glowing card effects.
- **No** decorative floating blobs, stock photos of people, or brain/robot imagery.
- **No** emoji as icons or brand elements.
- **No** fabricated dashboard metrics or decorative charts without real data.
- Shadows: use `shadow-card` for subtle depth, `shadow-card-hover` on hover. No heavy drop shadows.
- Border radius: `rounded-lg` (10px) for cards and inputs; `rounded-xl` for larger panels.
- Spacing: use Tailwind spacing scale (4 = 1rem base). Avoid arbitrary values; add new tokens to `tailwind.config.js` if needed.

---
name: KalingaCare
description: Care Beyond Borders — an online store for OFWs buying senior wellness products for family in the Philippines
colors:
  brand-blue: "#1778ad"
  blue-tint: "#e2f2fb"
  blue-deep: "#12628f"
  sky: "#67c8f7"
  sky-blue-text: "#0b5e83"
  page: "#f2f9ff"
  heart: "#e0475f"
  amber-bg: "#fff2cc"
  amber-text: "#916f00"
  cyan-bg: "#d9f3fd"
  green-bg: "#e6f4ea"
  green-text: "#1e7e34"
  red-bg: "#fde8e6"
  red-text: "#c0392b"
  ink: "#1e293b"
  slate: "#5c6b7f"
  cloud-line: "#dce8f0"
  paper: "#ffffff"
  mist: "#fafeff"
  harbor-navy: "#1e293b"
typography:
  display:
    fontFamily: "Poppins, sans-serif"
    fontSize: "clamp(2.5rem, 4.45vw, 4rem)"
    fontWeight: 700
    lineHeight: 1.1
  headline:
    fontFamily: "Poppins, sans-serif"
    fontSize: "clamp(1.6rem, 3vw, 2.4rem)"
    fontWeight: 700
    lineHeight: 1.2
  title:
    fontFamily: "Poppins, sans-serif"
    fontSize: "1.7rem"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: "Poppins, sans-serif"
    fontSize: "0.92rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Poppins, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 700
    letterSpacing: "0.4px"
rounded:
  pill: "999px"
  lg: "18px"
  md: "12px"
  sm: "10px"
  xs: "8px"
components:
  button-primary:
    backgroundColor: "{colors.brand-blue}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
    padding: "14px 34px"
  button-primary-hover:
    backgroundColor: "{colors.blue-deep}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "10px 26px"
  input-field:
    backgroundColor: "{colors.mist}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "12px 16px"
  card-product:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.lg}"
    padding: "18px"
  badge-status:
    rounded: "{rounded.pill}"
    padding: "3px 10px"
    typography: "{typography.label}"
  kpi-card:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.md}"
    padding: "22px"
  sidebar-nav-item:
    textColor: "{colors.slate}"
    padding: "12px 24px"
---

# Design System: KalingaCare

## Overview

**Creative North Star: "The Clear Sky Handoff"**

The system matches the mobile app: a flat pale-blue page, white cards and one deep brand blue (`#1778ad`) for every action. The mood is warm and reassuring, never clinical or corporate: rounded pill shapes and soft blue-tinted shadows instead of hard black ones. (Until Oct 16, 2026 the web used a sky-to-pink gradient; it was removed to match mobile.) Component feel throughout is soft and approachable — low-friction rounded surfaces, gentle hover lifts, nothing sharp or severe.

Admin surfaces share the same token vocabulary but dial the warmth down: flat bordered panels, no hover choreography, denser tables — the same blue language speaking in a calmer, task-focused register (see Modes note under Components).

Dark mode exists and is real (not a mobile-only aspiration): `[data-theme="dark"]` on the root swaps the neutral surface/text tokens while keeping `--primary` identical in both themes; only `--primary-text` lightens so blue text stays readable on dark surfaces.

**Key Characteristics:**
- Flat colors only, no gradients (same as the mobile app); one deep blue for every primary action, with white text
- Pill-shaped (999px) interactive elements everywhere: buttons, search bars, status badges, quantity steppers
- Soft, blue-tinted ambient shadows (never pure black) that appear mainly on hover, not at rest
- Single typeface (Poppins) carrying every role from hero display text down to uppercase micro-labels
- Real, working dark mode via `[data-theme="dark"]` token overrides

## Colors

**Changed Oct 16, 2026 (professor's feedback):** the web now uses the mobile app's palette. The pink and the sky-to-pink gradient are gone; one deep blue does every brand job, on a flat pale-blue page.

### Primary
- **Brand Blue** (`#1778ad`, token `--primary`): the brand color, same as the mobile app. Solid buttons (white text), the cart button, active states, step icons, the CTA banner, avatars and KPI icons. Passes WCAG AA both ways: as text on white (4.9:1) and under white text (4.9:1), so there is no separate "text blue" in light mode.
- **Brand Blue Text** (`--primary-text`): `#1778ad` in light mode, `#67c8f7` in dark mode. Use this, not `--primary`, for any text or icon colored in the brand blue, so dark mode stays readable.
- **Blue Tint** (`#e2f2fb`, token `--primary-light`; `#16324a` in dark mode): hover backgrounds, section tags, status/role badge backgrounds.
- **Blue Deep** (`#12628f`, token `--primary-dark`): hover/pressed fill for solid blue buttons.
- **Sky** (`#67c8f7`, token `--sky`): decorative accents only (footer icons, chart series, dark-mode text blue). Not used as a button fill anymore.
- **Sky Blue Text** (`#0b5e83`): kept for price text and blue badge text on tints.

### Page & Neutral
- **Page** (`#f2f9ff` light / `#0f172a` dark, token `--page-bg`): flat page background, same as the mobile screens. No radial washes.
- **Ink** (`#1e293b` light / `#e2e8f0` dark): primary text via `--dark`. Navy `#12283a` is used for the cart count badge.
- **Slate** (`#5c6b7f` light / `#94a3b8` dark): secondary text via `--gray`.
- **Cloud Line** (`#dce8f0` light / `#2a3441` dark): borders via `--line` (same as mobile).
- **Paper** (`#ffffff` light / `#1e293b` dark): cards and the navbar (solid, not translucent, since it stays pinned while scrolling).
- **Mist** (`#fafeff` light / `#16223a` dark): input background via `--input-bg`.
- **Harbor Navy** (`#1e293b` light / `#0b1220` dark): footer via `--footer-bg`.
- **Heart** (`#e0475f`, token `--heart`): active favorite hearts, same red as mobile.

### Semantic (Status & Role)
- **Amber** (bg `#fff2cc` / text `#916f00`): Pending status; Superadmin role; warning badges.
- **Cyan** (bg `#d9f3fd` / text `#0b5e83`): Shipped status.
- **Green** (bg `#e6f4ea` / text `#1e7e34`): Delivered status; User role; Digital Health product badge.
- **Red** (bg `#fde8e6` / text `#c0392b`): Cancelled status; errors.
- **Violet** (bg `#ede9fe` / text `#5b3fa8`): Admin role (replaced the old pink).
- Processing status and the Staff role use Blue Tint / Sky Blue Text.

### Named Rules
**The No-Gradient Rule.** Flat colors only, like the mobile app. `--gradient` still exists as a token name but holds solid `#1778ad`; don't reintroduce a multi-color gradient.

**The Footer Independence Rule.** `--footer-bg` never reads from `--dark`/`--ink`, so the footer keeps its dark navy in both themes.

**The Brand-Text Rule** (replaces the old Ink-Text Rule). Text on a solid `--primary` fill is white. Brand-blue text uses `--primary-text`. The old rule (never put text in a sky-blue shade) still holds for `#67c8f7` on light backgrounds.

## Typography

**Body & Display Font:** Poppins (weights 300–700), with `sans-serif` fallback. One family for the entire system — no secondary display or mono face.

**Character:** Rounded, geometric, friendly — Poppins' soft terminals match the pill-shaped components; weight does the hierarchy work more than size does, since most text sits in a narrow 0.75–1.7rem range outside the hero.

### Hierarchy
- **Display** (700, `clamp(2.5rem, 4.45vw, 4rem)`, line-height 1.1): the home hero headline only.
- **Headline** (700, `clamp(1.6rem, 3vw, 2.4rem)`, line-height 1.2): section titles ("Why Choose Us", "What Families Say", admin page `<h1>`).
- **Title** (700, `1.05–1.7rem`): card/panel/modal headings, auth form titles ("Welcome Back").
- **Body** (400–500, `0.85–0.95rem`, line-height 1.5–1.7, color Slate for secondary copy): paragraph copy, descriptions, table cells.
- **Label** (700, `0.72–0.78rem`, letter-spacing 0.4–0.5px, uppercase): table column headers, `.info-label`, section labels inside the admin order-detail panel, category tags.

### Named Rules
**The Weight-Over-Size Rule.** Below the hero, hierarchy is carried mostly by font-weight and color (Ink vs. Slate) rather than large size jumps — most UI text sits between 0.75rem and 1rem. Reach for a heavier weight or Ink-vs-Slate contrast before reaching for a bigger size.

## Layout

No formal spacing scale exists as CSS custom properties — spacing is authored ad hoc in rem/px per component, generally in a 8–24px rhythm. Section containers cap at `max-width: 1200px` / `width: 92%`, centered, with `5rem 0` vertical padding between homepage sections. The hero section is a full-bleed exception: it runs edge-to-edge with no outer container, `grid-template-columns: minmax(300px, 640px) 1fr` splitting text and a flush-right, mask-faded product image.

Admin layout is a fixed two-column shell (`250px` sidebar + fluid main content, both `height: 100vh` with independent scroll) rather than the storefront's stacked-section flow — a deliberate Operate-mode density shift from the storefront's Persuade-mode breathing room.

Responsive behavior collapses grids to fewer columns at three ad hoc breakpoints (992px / 900px / 768px, plus 850px for the auth split-panel and 560px for the smallest team grid) rather than a single systemized breakpoint scale.

## Elevation & Depth

Flat at rest, soft glow on interaction. Storefront cards (`.product-card`, `.review-card`, `.team-card`, `.mini-product-card`) sit on a thin 1px border with no shadow until hovered, at which point they lift (`translateY(-6px to -7px)`) and gain a soft, blue-tinted shadow — never pure black. Admin panels and KPI cards stay permanently flat (border only, no hover lift at all), matching Operate mode's calmer register. The one deliberately "lifted-at-rest" surface is the admin order-detail slide-over panel, which needs real separation from the page behind it.

### Shadow Vocabulary
- **Ambient** (`box-shadow: 0 8px 24px rgba(50, 116, 153, 0.08)`, token `--shadow-soft`): default resting shadow on cards, dropdowns, stat cards.
- **Hover Glow** (`box-shadow: 0 18px 35px rgba(50, 116, 153, 0.15)`, token `--shadow-hover`): the lifted state for hoverable cards.
- **Panel Cast** (`box-shadow: -12px 0 40px rgba(0, 0, 0, 0.15)`): the admin order-detail slide-over — the one place a true, non-tinted black shadow is used, because it needs to read as physically in front of the whole page, not just lifted off a card.

### Named Rules
**The Tinted Shadow Rule.** Every ambient/hover shadow is tinted toward the brand blue (`rgba(50, 116, 153, ...)`), never neutral gray or black. A default browser or Bootstrap black shadow anywhere on a card is a bug, not a stylistic choice.

## Shapes

**The Pill Rule.** Anything interactive and actionable — buttons, badges, the search input, quantity steppers, the settings toggle switch — is fully pilled at `999px`. Anything that's a *container* rather than an action — cards, panels, modals, form fields — uses a softened-rectangle radius instead, scaled to the element's size: `18px` for content cards, `12–14px` for compact containers (avatars aside, which are circular), `10px` for form fields and compact buttons, `8px` for small elements like table thumbnails and dropdown items. The distinction (pill = "tap me", rounded rect = "read me / type here") is consistent across every page examined.

## Components

Modes note: storefront/auth components (Persuade-adjacent — driving signup, purchase, trust) lean into hover motion; admin components (Operate mode) are calmer and denser, favoring flat borders and information density over expression.

### Buttons
- **Shape:** pill (`border-radius: 999px`) for every button variant without exception.
- **Primary (`.signup-btn`, `.btn-success`, `.add-product-btn`, `.btn-auth`, `.filters-apply-btn`, `.filter-tab.active`):** solid Brand Blue fill, white text (4.9:1), `font-weight: 600`; hover deepens to Blue Deep with a `translateY(-2px)` lift and a blue-tinted glow.
- **Hero (`.hero-btn-primary`, CTA banner button):** solid brand blue (white on the CTA banner), larger footprint (`height: clamp(46px, 7vh, 58px)`), white text, hover lifts `-4px` with a stronger glow.
- **Outline / Secondary (`.hero-btn-secondary`, `.btn-outline-success`):** transparent background, 1.5–2px Brand Blue border, Ink text; hover fills with Blue Tint.
- **Icon-only (`.icon-btn`, `.row-action-btn`):** no border/background at rest, Slate icon color, turns Sky Blue on hover (or Red for destructive `.icon-btn.danger`).

### Chips / Badges
- **Status badges (`.status-badge`):** pill shape, `3px 10px` padding, `700` weight, `0.75rem` — background/text drawn from the fixed Semantic palette above, one pair per order status.
- **Role badges (`.role-badge`):** same pill shape, uppercase with `0.4px` letter-spacing, reusing the same Semantic colors keyed to role rather than status.
- **Category badges (`.badge-mobility`/`.badge-wellness`/`.badge-digital`):** pill, smaller (`0.72rem`), same Semantic color logic — note the admin dashboard's category legend uses a *third*, distinct amber hex (`#f6b93b`) for the "digital" category that the storefront's `.badge-digital` does not share (it uses the Green pair instead); this is an existing inconsistency, not a documented rule.

### Cards / Containers
- **Corner style:** `18px` for storefront content cards, `16px` for admin KPI/panel cards.
- **Background:** Paper (`--surface`), themes correctly in dark mode.
- **Shadow strategy:** see Elevation & Depth — storefront cards animate in on hover, admin cards stay flat.
- **Border:** thin 1px, usually `#e4eef4` or `var(--line)`.
- **Internal padding:** `18–26px` depending on card density.

### Inputs / Fields
- **Style (`.form-field`, `.checkout-form .form-control`):** `1.5px` Cloud Line border, `10px` radius, Mist background, icon in Sky Blue when present (auth forms).
- **Focus:** border shifts to Sky Blue plus a soft `rgba(sky-blue, 0.15)` glow ring — no harsh browser default outline anywhere.
- **Error:** a dedicated `.auth-error` banner (Red bg/text, `8px` radius) rather than inline red borders on individual fields.

### Navigation
- **Storefront navbar:** translucent white (`rgba(255,255,255,0.92)`) with `blur(6px)` backdrop, Sky Blue active/hover state on links, an animated underline (`::after`) that grows from 0 to full width on hover/active.
- **Admin sidebar (`.admin-nav`):** fixed 250px rail, flat list, Slate text at rest; active/hover state gets a pale Sky Blue Light background plus a 3px Sky Blue left border rather than the storefront's underline treatment — the two navigation languages are intentionally different (rail vs. top bar) rather than restyled versions of the same component.

### Order Detail Panel (signature component)
A right-edge slide-over (`400px`, `right: -420px → 0` on `.open`) used in Admin Orders — the panel that also drives the New→Pending status auto-transition on open. Flat white surface, the one place using an untinted black shadow (`-12px 0 40px rgba(0,0,0,0.15)`) since it needs to visually separate from the whole page rather than just lift off it. Internally it reuses the same Label typography and Cloud Line dividers as the rest of the admin system — the signature is the slide mechanic and shadow treatment, not a departure in color or type.

## Do's and Don'ts

### Do:
- **Do** keep every interactive control (buttons, badges, search bars, steppers) fully pilled at `999px`.
- **Do** tint every shadow toward the brand blue (`rgba(50, 116, 153, ...)`); never use a neutral gray or pure-black shadow on a card.
- **Do** keep colors flat and use the brand blue `#1778ad` with white text for primary actions, matching the mobile app.
- **Do** keep `--footer-bg` independent from `--dark`/Ink even where the hex values currently coincide, so dark mode can't accidentally lighten the footer.
- **Do** carry the same Sky Blue value unchanged between light and dark mode; only neutral surface/text tokens are allowed to flip.

### Don't:
- **Don't** bring back pink or multi-color gradients.
- **Don't** introduce a second typeface; Poppins carries every role from hero to micro-label today.
- **Don't** give admin/Operate-mode cards a hover lift — that motion is a storefront/Persuade-mode signature, and admin panels stay deliberately flat and calm.
- **Don't** invent a new status or role color pair without checking the existing Semantic set first — five status colors and four role colors already exist and are reused verbatim across web and (via shared Firestore data) mobile.

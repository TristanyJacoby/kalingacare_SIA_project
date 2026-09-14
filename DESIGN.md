---
name: KalingaCare
description: Care Beyond Borders — an online store for OFWs buying senior wellness products for family in the Philippines
colors:
  sky-blue: "#67c8f7"
  sky-blue-light: "#beebff"
  sky-blue-deep: "#3fa8e0"
  sky-blue-text: "#0b5e83"
  blossom-pink: "#f8b4d9"
  blossom-pink-light: "#ffe5f2"
  plum-text: "#8d4c7b"
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
  gradient-handoff: "linear-gradient(135deg, #7dd3fc 0%, #a5f3fc 45%, #f8b4d9 100%)"
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
    backgroundColor: "{colors.sky-blue}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "14px 34px"
  button-primary-hover:
    backgroundColor: "{colors.sky-blue-deep}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
  button-gradient:
    backgroundColor: "{colors.gradient-handoff}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
    padding: "0 35px"
    height: "58px"
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

The system reads as an open sky-blue horizon warming into pink at the edges — a visual handoff, fitting a product whose entire premise is one person caring for another across a distance. The mood is warm and reassuring, never clinical or corporate: rounded pill shapes, soft blue-tinted shadows instead of hard black ones, and a single signature gradient reserved for a handful of "hero" moments (the main hero CTA, the closing CTA banner, avatars, KPI icons) rather than sprinkled everywhere. Component feel throughout is soft and approachable — low-friction rounded surfaces, gentle hover lifts, nothing sharp or severe.

Admin surfaces share the same token vocabulary but dial the warmth down: flat bordered panels, no hover choreography, denser tables — the same sky/pink language speaking in a calmer, task-focused register (see Modes note under Components).

Dark mode exists and is real (not a mobile-only aspiration): `[data-theme="dark"]` on the root swaps the neutral surface/text tokens while keeping `--primary` (sky-blue) and `--pink` identical in both themes, so the brand accent never shifts, only the canvas around it does.

**Key Characteristics:**
- One signature gradient (sky blue → cyan → pink), used sparingly as a deliberate highlight, never as the default button style
- Pill-shaped (999px) interactive elements everywhere: buttons, search bars, status badges, quantity steppers
- Soft, blue-tinted ambient shadows (never pure black) that appear mainly on hover, not at rest
- Single typeface (Poppins) carrying every role from hero display text down to uppercase micro-labels
- Real, working dark mode via `[data-theme="dark"]` token overrides

## Colors

Two-color brand palette (sky blue + blossom pink) plus a warm neutral scale, with a small fixed semantic vocabulary for order status and user role badges layered on top.

### Primary
- **Sky Blue** (`#67c8f7`): the brand color. Active nav state, primary button fills, form-field icons, focus rings. Identical value in light and dark mode — the one constant across themes. No shade of Sky Blue (including Sky Blue Deep) reaches 4.5:1 against white or near-white — use it for backgrounds, borders, and icons freely, but set button/link *text* in Ink, never in a Sky Blue shade, wherever the surface behind it is light. Price text specifically uses Sky Blue Text (`#0b5e83`), not raw Sky Blue — see the Ink-Text Rule.
- **Sky Blue Light** (`#beebff`): tints and hover backgrounds (outline-button hover, badge backgrounds, section tags).
- **Sky Blue Deep** (`#3fa8e0`): hover/pressed state for solid sky-blue buttons (background only — see the contrast note above).

### Secondary
- **Blossom Pink** (`#f8b4d9`): the gradient's warm end and the system's only other named hue. Appears in the signature gradient, admin-role badges, and small accent moments — never as a standalone button fill.
- **Blossom Pink Light** (`#ffe5f2`): tint background for pink-toned badges (e.g. the "digital" product badge, admin role).

### Neutral
- **Ink** (`#1e293b` light / `#e2e8f0` dark): primary text color; flips per theme via `--dark`.
- **Slate** (`#5c6b7f` light / `#94a3b8` dark): secondary/muted text via `--gray`. The light-mode value is deliberately a touch darker than a plain slate-500 — the body's soft radial-gradient wash lightens the effective background enough in places that the more obvious `#64748b` dropped to 4.2:1, just under WCAG AA.
- **Cloud Line** (`#dce8f0` light / `#2a3441` dark): borders and dividers via `--line`.
- **Paper** (`#ffffff` light / `#1e293b` dark): card and surface background via `--surface`.
- **Mist** (`#fafeff` light / `#16223a` dark): input field background via `--input-bg`.
- **Harbor Navy** (`#1e293b` light / `#0b1220` dark): footer background via `--footer-bg` — deliberately its own token, not an alias of Ink, specifically so the footer can stay a fixed dark navy in both themes without being dragged along when Ink flips to a light color for dark mode.

### Semantic (Status & Role)
Fixed background/text pairs, reused verbatim across order-status badges (profile + admin) and user-role badges:
- **Amber** (bg `#fff2cc` / text `#916f00`): Pending status; Superadmin role.
- **Cyan** (bg `#d9f3fd` / text `#0b5e83`): Shipped status. The original `#218bc2` text was only 3.3:1 on this background (fails WCAG AA); Shipped now reuses the same Sky Blue Text token as Processing/Staff rather than introducing a second, separately-tuned dark blue.
- **Green** (bg `#e6f4ea` / text `#1e7e34`): Delivered status; User role.
- **Red** (bg `#fde8e6` / text `#c0392b`): Cancelled status; form/auth error banners.
- Processing status and the Staff role both reuse Sky Blue Light / Sky Blue Text (`#0b5e83`) rather than a distinct hue.

### Named Rules
**The Gradient Reserve Rule.** The signature sky-to-pink gradient is a highlight, not a default. It appears only on the hero CTA, the closing CTA banner, avatars, and KPI icons — every other button, including every other primary action, is a solid Sky Blue fill. Diluting this to "gradient = important button" anywhere else breaks the rule's whole point: rarity is what makes it read as a deliberate signature rather than decoration.

**The Footer Independence Rule.** `--footer-bg` never reads from `--dark`/`--ink`, even though they hold the same hex value today. The footer is allowed to keep a fixed dark-navy identity in both light and dark mode; only the two theme-flipping neutral tokens (`--dark`, `--surface`) are allowed to swap.

**The Ink-Text Rule.** No shade of Sky Blue passes 4.5:1 as text on a white or near-white surface (`#67c8f7` is 1.9:1, `#3fa8e0` is only 2.7:1). Use Ink for any text or icon color that sits on a light background, and reserve Sky Blue itself for fills, borders, and icons on non-text elements — unless the text specifically needs to keep a blue brand identity (e.g. price text), in which case use Sky Blue Text (`#0b5e83`, the same accessible dark-blue token used for Processing/Shipped status text) instead of dropping to Ink.

Fixed under this rule (home/products/navbar/profile pass): `.signup-btn`/`.btn-success`, `.hero-btn-secondary`, and `.btn-outline-success` (→ Ink; the border/background carries the brand color instead of the text); `.nav-link.active`, `.login-btn:hover` (→ Ink, with the underline/pill-background hover treatment carrying the interactive feedback instead of a text-color change), and `.dropdown-item:hover`/`:focus` (→ Ink, background tint carries the feedback); `.filters-panel-reset` ("Clear All", shared between products.html and admin filter panels — was Sky Blue Deep at 2.66:1, → Ink); `.team-role` on the home page's team cards (→ Ink); `.mini-product-card p` (home page Featured Products price) and `.product-card .text-success` (products page price, all 45 cards) — both were raw Sky Blue at 1.88:1, → Sky Blue Text (`#0b5e83`) to keep price's blue accent while passing contrast.

Fixed under this rule (checkout/cart/admin pass): `.btn-auth` — the checkout "Place Order" button, login/register submit, and settings' Save buttons — existed as **two separate copies** of the same class in `shop.css` and `auth.css` that had drifted into an identical bug (white text on solid Sky Blue, 1.9:1); both fixed to Ink. `.cart-item-price` (cart page) — same raw-Sky-Blue price bug as the home/products cards, → Sky Blue Text. Across `admin.css`: `.admin-nav a:hover`/`.active` (sidebar nav text → Ink, background tint/left border already signal state), `.filters-btn:hover`/`.active` and `.filter-tab:hover` (→ Ink), `.filter-tab.active` and `.filters-apply-btn` and `.add-product-btn` (white-on-solid-Sky-Blue → Ink, same pattern as `.signup-btn`), `.notif-view-all` (→ Ink), `.tdm-item.active` and `.bulk-action-bar` (Sky Blue Deep on Sky Blue Light → Ink), and `.stock-inline-adjust-btn` (both its resting and `:hover` states → Ink).

A live browser contrast scan of the home and products pages (computed color vs. computed background on every text node) found zero remaining failures after the first pass. Checkout and admin required a different verification method since both gate on real Firebase auth this session had no credentials for: admin fixes were confirmed with an isolated HTML harness loading the actual `admin.css`/`style.css` against reconstructed markup for each fixed class (all render correctly); checkout/login/cart fixes were confirmed by adding a real item to cart and screenshotting login.html directly (both publicly reachable without auth). The scan/harness method also doesn't catch a class duplicated verbatim across two stylesheets that both need the same fix — `.btn-auth` in `shop.css` and `auth.css` is a real example of this from this pass — so a future contrast sweep should grep for the fixed selector across *all* CSS files, not just the one the current page happens to load.

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

Modes note: storefront/auth components (Persuade-adjacent — driving signup, purchase, trust) lean into hover motion and the gradient signature; admin components (Operate mode) are calmer and denser, favoring flat borders and information density over expression.

### Buttons
- **Shape:** pill (`border-radius: 999px`) for every button variant without exception.
- **Primary (`.signup-btn`, `.btn-success`, `.add-product-btn`, `.btn-auth`, `.filters-apply-btn`, `.filter-tab.active`):** solid Sky Blue fill, Ink text (fixed under the Ink-Text Rule — white text here is only 1.9:1), `font-weight: 600`; hover deepens to Sky Blue Deep with a `translateY(-2px)` lift and a Sky-Blue-tinted glow.
- **Gradient / Hero (`.hero-btn-primary`, CTA banner button):** the reserved gradient fill (see The Gradient Reserve Rule), larger footprint (`height: clamp(46px, 7vh, 58px)`), white text, hover lifts `-4px` with a stronger glow.
- **Outline / Secondary (`.hero-btn-secondary`, `.btn-outline-success`):** transparent background, 1.5–2px Sky Blue border, Ink text — both were originally Sky Blue text and fixed under the Ink-Text Rule (`.btn-outline-success`, used on profile.html, was the last one caught); hover fills with Sky Blue Light.
- **Icon-only (`.icon-btn`, `.row-action-btn`):** no border/background at rest, Slate icon color, turns Sky Blue on hover (or Red for destructive `.icon-btn.danger`).

### Chips / Badges
- **Status badges (`.status-badge`):** pill shape, `3px 10px` padding, `700` weight, `0.75rem` — background/text drawn from the fixed Semantic palette above, one pair per order status.
- **Role badges (`.role-badge`):** same pill shape, uppercase with `0.4px` letter-spacing, reusing the same Semantic colors keyed to role rather than status.
- **Category badges (`.badge-mobility`/`.badge-wellness`/`.badge-digital`):** pill, smaller (`0.72rem`), same Semantic color logic — note the admin dashboard's category legend uses a *third*, distinct amber hex (`#f6b93b`) for the "digital" category that the storefront's `.badge-digital` does not share (it uses Blossom Pink Light instead); this is an existing inconsistency in the codebase, not a documented rule — don't propagate it into new work without reconciling which hex is canonical.

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
- **Do** reserve the sky-to-pink gradient for hero-tier moments (main hero CTA, CTA banner, avatars, KPI icons) — one or two per screen at most.
- **Do** keep `--footer-bg` independent from `--dark`/Ink even where the hex values currently coincide, so dark mode can't accidentally lighten the footer.
- **Do** carry the same Sky Blue value unchanged between light and dark mode; only neutral surface/text tokens are allowed to flip.

### Don't:
- **Don't** use the gradient as a default/frequent button fill — that's what Sky Blue solid is for.
- **Don't** introduce a second typeface; Poppins carries every role from hero to micro-label today.
- **Don't** give admin/Operate-mode cards a hover lift — that motion is a storefront/Persuade-mode signature, and admin panels stay deliberately flat and calm.
- **Don't** invent a new status or role color pair without checking the existing Semantic set first — five status colors and four role colors already exist and are reused verbatim across web and (via shared Firestore data) mobile.

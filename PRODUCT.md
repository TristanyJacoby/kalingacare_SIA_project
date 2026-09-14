# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary users are OFWs (Overseas Filipino Workers) abroad, buying healthcare, mobility, and wellness products for elderly family members living in the Philippines. The buyer and the end recipient are different people: the OFW browses, orders, and pays from abroad; the elderly family member receives and uses the physical product but never touches the storefront themselves. A secondary user role is internal staff/admin (order fulfillment, product and user management) — admin is web-only, with no equivalent on the companion mobile app.

## Product Purpose

KalingaCare ("Care Beyond Borders") is an online store letting OFWs purchase senior wellness and mobility products for family back home, closing the gap created by physical distance from aging relatives. Success is a straightforward, trustworthy purchase flow: browse, order, track, and have the product reach the elderly recipient in the Philippines.

## Positioning

The distinct mechanism is the cross-border care use case itself — the customer and the beneficiary are in different countries, and the product exists specifically to serve that separation (OFW abroad caring for elderly parents/relatives at home), rather than being a generic elderly-care or general e-commerce storefront.

## Operating Context

- **Companion mobile app** (`kalingacare-mobile`, Ionic React + Capacitor, Android only) shares the same Firebase backend (project `kalingacare-e9873`) and covers the full customer flow, but has no admin capability — all admin/staff work happens on this web app.
- Two people besides the primary developer (Adrian, Robert) also commit code to the mobile app; this web repo has a single active developer (Tristan).
- This is a course deliverable for IT 009 — Systems Integration and Architecture 1 (TIP Quezon City), built by group **NexCode**, with a final presentation deadline of November 2026. Academic artifacts (SOA documentation, architecture diagrams, a combined prototype submission) run alongside feature work and share the same repo's context, though they are not part of the shipped product itself.
- Cash on Delivery is the only real payment method anywhere in the system today (web or mobile) — no payment gateway is integrated yet.
- Order lifecycle: orders start as `"New"` (unseen by staff) and auto-transition to `"Pending"` the moment staff open the order in Admin Orders; customers see `"New"` normalized to display as `"Pending"` on both platforms, since the New/Pending distinction is an internal staff-viewed concern only.

## Capabilities and Constraints

**Built and working (web):** storefront (home, products, cart, checkout, login/register with email+password and Google Sign-In, profile with order history/tracking/cancel, settings) and full admin (dashboard with charts, products CRUD, orders management with bulk actions and a slide-over detail panel, user management, settings).

**Not yet built (web):** real payment processing (PayMongo), currency conversion (Frankfurter API), email OTP at checkout (EmailJS), TOTP 2FA. Priority order when tackled: PayMongo first (most directly relevant to the SIA course), then currency conversion, then email OTP, then TOTP 2FA last.

**Constraints/terminology:**
- Web is plain HTML/CSS/vanilla JS with no build step and no framework; deployed on GitHub Pages.
- Web's order/cart records use the field name `qty`, not `quantity` (mobile maps its internal `quantity` to `qty` only at the Firestore write boundary, so admin displays orders correctly regardless of origin platform).
- Firebase web API keys are public/non-secret by design; Firestore security rules are the real access boundary.
- No senior-specific accessibility requirement — the elderly family members who receive products never use the storefront directly, only the OFW buyer does.

## Brand Commitments

- Name: **KalingaCare**. Slogan: **"Care Beyond Borders."**
- Logo asset exists at `assets/images/logo.png`.
- Honesty in the UI is a firm standing principle: no decorative/fake-functional buttons or claims not backed by real data (e.g. a notification bell that does nothing, a discount badge with no real discount behind it). Anything not real yet must be either clearly marked as a placeholder or left out entirely.

## Evidence on Hand

- Product catalog images exist at `assets/images/products/` (45 product photos as of this writing) — real product imagery, not placeholders.
- This is a course simulation: product data, pricing, and "business" details are realistic but fictional, built to demonstrate systems integration coursework rather than to operate a real company. No real supplier relationships, real testimonials, or real press exist and none should be fabricated.

## Product Principles

1. Design for the cross-border gap explicitly — the buyer (OFW) and the recipient (elderly family member in the Philippines) are different people in different countries; flows should stay legible to a remote purchaser who can't inspect the product or recipient in person.
2. Never present something as functional or real that isn't — no decorative UI that implies a capability the system doesn't actually have.
3. Web and mobile share one Firestore backend and must agree on schema/field names and status semantics; when in doubt, verify current field shapes in code rather than assuming.
4. Admin/staff capability is web-exclusive by deliberate decision — do not reintroduce admin surface area on mobile.
5. Cash on Delivery is the only real transaction path today; anything gateway-shaped in the UI must be honest about not processing real payment yet.

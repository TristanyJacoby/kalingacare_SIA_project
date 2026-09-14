# KalingaCare — Project Context for Claude Code

I'm continuing development of KalingaCare in this environment (terminal + VS Code extension) after working on it extensively in claude.ai chat. Please read this fully before touching any code — it captures a lot of hard-won context, decisions, and conventions that aren't necessarily obvious from the code alone.

## What this project is

- **Course**: IT 009 — Systems Integration and Architecture 1, TIP Quezon City, Section IT31S4
- **Group**: NexCode — Tristan Jacob Dela Pena (leader/solo developer), Cliff Jefferson Bautista, Adrian Carlo Quiambao, Trisha Anne Trinidad, Robert Gabriel Villar
- **Business concept**: KalingaCare — "Senior Wellness and OFW Support" online store, slogan "Care Beyond Borders." Lets OFWs buy healthcare/mobility/wellness products for elderly family in the Philippines.
- **Two apps, one shared Firebase backend** (project `kalingacare-e9873`, Auth + Firestore, Blaze plan):
  - **Web**: plain HTML/CSS/vanilla JS, no build step, no framework. Deployed on GitHub Pages.
  - **Mobile**: Ionic React + Capacitor + Vite + TypeScript. Android only, iOS not set up.
- **Mobile is user-only** — no admin side on mobile at all. This was deliberately decided and reversed after a brief exploration; admin work stays on web exclusively.
- **Two groupmates (Adrian, Robert) have also been actively pushing mobile code** — this isn't solo-dev-only anymore. Check `git log` before assuming you know the current state of any file.
- **Deadline**: final presentation in November 2026.

## Repos

- **Web**: `kalingacare_SIA_project` — https://github.com/TristanyJacoby/kalingacare_SIA_project (public, `main` branch)
- **Mobile**: `kalingacare-mobile` — https://github.com/TristanyJacoby/kalingacare-mobile (public, `main` branch)

Both repos are public, so if you ever need to check the deployed/canonical state of a file rather than what's on disk locally, `raw.githubusercontent.com/TristanyJacoby/<repo>/main/<path>` works without auth. Prefer this over guessing when in doubt about the "real" current state — local disk state and GitHub have drifted out of sync at least once before (see gotchas below).

Confirm the actual local folder paths on this machine before doing anything — they were `~/kalingacare-mobile` and `~/kalingacare_SIA_project` as of the last session, but verify.

## Current status — what's built and working

**Web**: Fully functional storefront (home, products, cart, checkout, login/register with working email/password *and* Google Sign-In, profile with order history/tracking/cancel, settings) plus a full admin side (dashboard with charts, products CRUD, orders management with bulk actions and a slide-over detail panel, user management, settings). PayMongo/real payment processing is **not** built — checkout only writes an order record, Cash on Delivery is the only real option anywhere in the whole system (web or mobile).

**Mobile**: Full customer flow — Login/Register, Home (landing page with a promo carousel and featured products), Categories (full catalog with search/filter), Product Detail (image gallery, description, reviews & ratings display + submission with optional photo, related products, favorite/wishlist button), Cart (per-item checkboxes for partial checkout, real promo codes, real shipping fee), Checkout (writes real orders matching web's schema), Order Confirmation. Profile menu: My Account, My Orders (with review-submission trigger on Delivered items), Saved Addresses, Favorites, Notifications, Help & Support, Log Out. Full custom UI redesign completed (floating pill tab bar, category-color-coded cards, tinted backgrounds, safe-area handling for notches/punch-holes).

**Order status workflow** (both platforms, recently added): orders start as `"New"` (staff hasn't viewed it) and auto-transition to `"Pending"` the moment staff opens the order detail panel in Admin Orders. Customers never see the word "New" anywhere — both web and mobile normalize it to display as "Pending" to them, since that distinction is purely an internal staff-viewed concern. New orders are cancellable, same as Pending/Processing.

**In progress right now**: mobile's "Continue with Google" button exists in the UI but isn't wired to anything real yet. Web's Google Sign-In was just confirmed working after fixing two separate Firebase Console misconfigurations (see gotchas). Next concrete step is finishing mobile's native Google Sign-In — needs a Capacitor auth plugin installed, the app's debug keystore SHA-1 registered in Firebase, `google-services.json` downloaded into `android/app/`, and the existing button wired up.

**Also in progress, on web (started this session, unrelated to the mobile Google Sign-In work above)**: a design pass on the web storefront using the Impeccable skill.
- `PRODUCT.md` and `DESIGN.md` now exist at the project root and are the durable source of truth for product context and the visual system (colors, typography, named rules like "The Gradient Reserve Rule" and "The Ink-Text Rule"). Read them before making UI changes — they capture real constraints (e.g. no Sky Blue shade passes WCAG contrast as text on a light background) that aren't obvious from the CSS alone.
- **Home page (`index.html`)**: went through a critique → fix cycle. Fixed: two false "pay in your local currency" claims (checkout is COD-only, copy now says so), two Featured Products cards that showed the wrong photo for their caption (crutches labeled as milk, a bath bench labeled as a BP monitor — verified against the real image files and corrected), the signature gradient being overused (was on 7 elements, now only the 2 "hero-tier" ones per DESIGN.md's Gradient Reserve Rule), a skipped-heading accessibility issue across every card title, and several real WCAG contrast failures (white text on Sky Blue buttons, sitewide — fixed to Ink; a cyan status/badge color at 3.3:1 — fixed to reuse an existing darker token; body text dropping under 4.5:1 under the page's decorative gradient wash — `--gray` darkened slightly).
- **Products page (`products.html`)**: rebuilt from a reference layout the user shared — replaced the old hero-banner + pill category buttons with a persistent left filter sidebar (Category checkboxes, Price-range radios, "Clear All") plus a toolbar (search, live product count, sort by name/price). Deliberately left out ratings/reviews/location/sold-count from the reference since web's product data doesn't have any of that (would have meant fabricating data, which conflicts with the project's honesty-in-the-UI principle below) — only real fields are shown. Cards are now 4-per-row, product titles are 2-line-clamped (not truncated to 1 line — real names vary too much in length) with a reserved min-height so the Add to Cart button always lands at the same position regardless of title length, and the page container was widened (1300px → 1600px max-width) to use more of the viewport.
- **Known, not yet fixed**: `.nav-link.active`, `.login-btn:hover`, and `.dropdown-item:hover` (the navbar's account dropdown) all use Sky Blue text on a near-white background — same contrast bug pattern fixed elsewhere on the home page, but sitewide (every page shares the navbar), so it needs its own dedicated pass rather than riding in on a page-scoped fix. Documented as "The Ink-Text Rule" in `DESIGN.md`.
- No browser automation was available in that session, so none of this was visually verified in a real rendered browser — only via a detector script and reasoning about the code/CSS. Worth an actual visual check before considering it done.

## Known unbuilt / deferred features

- **PayMongo real payments** — web only writes order records, no actual gateway integration anywhere
- **Multi-image product gallery on mobile** — the mobile UI is already built for a real `images[]` array and gracefully falls back to a single image today, but it's blocked on web's admin product uploader only supporting one image per product
- **Avatar upload on mobile** — Profile only displays an existing photo, no upload capability
- **Live order-tracking map** — deferred, no Google Maps SDK on mobile
- **Dark Mode on mobile** — attempted, then explicitly removed. Ionic's `dark.system.css` only follows OS-level preference, not a manual toggle, and nearly every screen uses hardcoded hex colors instead of theme-aware CSS variables — real dark mode needs dark-mode variants written per screen, never built
- Currency conversion (Frankfurter API), Email OTP at checkout (EmailJS), TOTP 2FA — all planned for web, none started, roughly in that priority order (TOTP lowest)

## Academic deliverables (don't let these slip)

- SOA documentation Part 2 rewrite, to match the final 14-service list
- Architecture diagram — still needs the Mobile App node added back
- Final Project Prototype — combined submission document not yet assembled

## Recurring gotchas — read before touching related code

- **`IonFooter` has its own separate background layer from the `IonToolbar` inside it.** Making the toolbar's background transparent alone isn't enough — target `IonFooter` itself too, or its default background shows through as a stray gray box. Bit us twice before being properly fixed.
- **Don't fight Ionic's internal `ion-tab-button` sizing.** Forcing `width: auto` / `flex: 0 0 auto` on individual tab buttons to make them "closer together" broke the tab bar entirely (buttons collapsed to invisible). The safe way to shrink a tab bar's footprint is constraining the *outer* `ion-tab-bar`'s `width`/`max-width` + `margin: 0 auto`, letting Ionic's own internal layout behave normally within that smaller space.
- **Web's order/cart items use `"qty"`, not `"quantity"`.** Mobile's `CartContext` uses `quantity` internally by convention — it's mapped to `qty` only at the Firestore write boundary in Checkout, so orders display correctly in Admin Orders/Dashboard regardless of which platform created them.
- **Capacitor native builds**: always run `npm run build && npx cap sync android` *before* opening/syncing in Android Studio, or Gradle sync fails looking for a missing `capacitor.settings.gradle` (it's auto-generated by `cap sync`).
- **Firestore composite indexes**: any query combining `where()` on one field with `orderBy()` on a different field needs one (e.g. reviews by `productId`+`createdAt`, related products by `category`+`name`). These are wrapped in try/catch in the code so missing indexes don't crash the app, but the affected section just silently shows empty until the index is created in Firebase Console.
- **Firebase web API keys are not secrets** — safe to be hardcoded and public in both repos. Firestore security rules are the actual access boundary.
- **The web repo had a real bug we found via a full rules audit**: the `reviews` collection had no Firestore rule at all (Firestore denies by default when nothing matches), meaning reviews silently failed to write/read for a while before being caught and fixed.
- **A whole batch of web changes (checkout.js, admin.js, admin.css, profile.js for the New/Pending status work) sat unpushed on GitHub for a while** despite being "delivered" — always confirm a push actually happened rather than assuming a described change is live. Compare `raw.githubusercontent.com` against local/expected state if something seems inconsistent.
- **Google Sign-In on web was broken by two separate, layered Firebase Console misconfigurations**, not a code bug: (1) the testing domain wasn't in Authorized Domains, and after fixing that, (2) Google wasn't actually toggled on as a sign-in provider at all (`auth/operation-not-allowed`). The lesson: the generic "Couldn't sign in" UI message hides the real Firebase error code — always check the browser console for the actual `err.code`, don't guess from the generic message alone. There's currently a temporary `console.error` diagnostic line in `js/auth.js`'s Google sign-in catch block — **please remove this now that it's served its purpose**, it was marked as temporary.
- **`.DS_Store` files got accidentally committed to the web repo at one point** — now gitignored, but worth double-checking mobile's `.gitignore` covers it too if you ever see it show up in `git status` there.

## Roadmap — current priority order

1. **Finish mobile Google Sign-In** (in progress) — plugin install, SHA-1/Firebase registration, `google-services.json`, wire the existing button
2. **Web UI/UX improvements** — now underway (see "Also in progress, on web" above): home page critique/fixes done, products page rebuilt with a filter-sidebar layout. Still needs: the sitewide nav/dropdown contrast fix (Ink-Text Rule), a real browser check of everything done so far (no browser automation was available while it was built), and a decision on whether to tackle other pages (checkout, admin) the same way.
3. **Academic deliverables** — don't let these slip while feature work continues; no hard deadline known to me, confirm with Tristan
4. **Web feature completion** — PayMongo (genuinely relevant to an SIA course specifically), then currency conversion, email OTP, TOTP 2FA; also the multi-image product uploader, which unblocks mobile's gallery
5. **Remaining mobile polish** — avatar upload, the multi-image gallery (once #4 unblocks it), live tracking map, Dark Mode
6. **Final demo prep** — build a real installable APK, full cross-platform end-to-end test, dry-run the actual demo

## How I like to work (habits from the chat sessions)

- Full-file replacement over patching when something breaks unexplainably — check the console/error first, then prefer a clean rewrite over incremental patches if things get confusing
- Before building any new feature, check what real data/schema already exists rather than assuming — several bugs this project hit came from two parts of the system disagreeing about a field name or shape (`qty` vs `quantity`, `savedAddress` vs `savedAddresses`)
- I care about honesty in the UI — no fake/decorative buttons that look functional but aren't (this came up multiple times: a notification bell that did nothing, a "10% off" badge with no real discount data behind it, etc.). If something can't be made real yet, either make it clearly a placeholder or leave it out.
- When in doubt about which of two competing implementations is "right" between web and mobile (or between what's committed vs. what I describe), verify against the actual repo content rather than assuming — this has caught real bugs before.

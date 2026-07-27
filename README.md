# KalingaCare — Front-End Fix Notes

## What changed and why

**1. `js/firebase.js` was broken and has been fixed.**
It imported from `"firebase/app"`, an npm-style specifier that only works with a
bundler. This project has no bundler (Bootstrap is loaded via CDN `<script>` tags),
so that import would fail immediately in a browser. It now imports from Firebase's
own CDN (same pattern used in the Arangkada project), and exports `app`, `db`, and
`auth` so `auth.js`, `products.js`, `cart.js`, `checkout.js`, and `admin.js` can all
`import { db, auth } from "./firebase.js";` when you build them.

**2. Design system split into `style.css` + page-specific files.**
Your file structure diagram already implied this (`style.css` separate from
`home.css`/`shop.css`), so `css/style.css` now holds everything shared across every
page: color variables, fonts, the navbar, and the footer. `home.css` and `shop.css`
(renamed from `products.css`) hold only the rules unique to each page. This is why
`index.html` and `products.html` now look like the same site — same navbar, same
buttons, same colors — instead of two different bootstrap themes.

**3. File paths fixed to match your diagram.**
- `products.css` → `css/shop.css`
- `products.js` → `js/products.js`
- Product images now point to `assets/images/products/` (see "Still needed" below)

**4. `script.js` was dropped.**
It was empty, and your file structure diagram doesn't include a root-level
`script.js` — only `js/firebase.js`, `auth.js`, `products.js`, `cart.js`,
`checkout.js`, `admin.js`. If you want home-page-specific interactivity later,
it'd make more sense as `js/home.js` to match the pattern.

**5. Cart wiring added ahead of `cart.js`.**
`products.js` now saves cart items to `localStorage` under `kalingacare_cart`
(id, name, price, qty) whenever "Add to Cart" is clicked. This isn't a full cart
system yet, but it means when you build `cart.html`/`cart.js` next, the data is
already there waiting to be read — no changes needed on the products side.

**6. `index.html` now has a footer and real navigation.**
Previously it only had a hero section with `href="#"` links. Nav links, "Shop Now",
and "Get Started" now point to the real pages in your file structure
(`products.html`, `login.html`, `register.html`).

## Round 2 updates

- **Navbar order unified** across `index.html`, `products.html`, `login.html`,
  `register.html`: Home → Products → Services → Contact → About → Login/Get
  Started. Same markup/classes on every page so it's a single find-and-replace
  if you need to change it again later.
- **Home page expanded** with About, Services ("How It Works" — Browse / Order
  & Pay / We Deliver), a Featured Products preview (3 cards, links to
  `products.html`), and a CTA banner before the footer — the typical
  multi-section scroll a landing page needs. All new sections live in
  `css/home.css` under the "ABOUT / SERVICES / FEATURED / CTA" comment block.
- **`login.html` and `register.html` are built**, using the same sliding
  two-panel layout as your Arangkada `signin.html` (`css/auth.css` +
  `js/auth.js`), re-themed to KalingaCare's blue/pink gradient and Poppins
  font. Both pages share identical markup — `login.html` opens on the Sign In
  panel, `register.html` opens on Create Account — and the "Create Account" /
  "Sign In" links inside the form slide between them without a page reload.
- **Real Firebase Auth wired in**, not just a visual mockup:
  `createUserWithEmailAndPassword` on signup (plus a mirrored profile doc in
  a Firestore `users` collection), `signInWithEmailAndPassword` on login,
  friendly error messages, and a redirect to `index.html` on success.

## Round 3 updates

- **Cart bug fixed.** `products.html` no longer shows a permanent Cart button.
  Every page now shares one pattern: `<div id="navAuthLinks">` (Login/Get
  Started) and `<div id="navCartWrap" class="d-none">` (Cart icon + live
  count). `firebase.js`'s `onAuthStateChanged` listener toggles between them
  on every page automatically — logged out shows Login/Get Started, logged in
  shows Cart. This is identical markup on `index.html`, `products.html`,
  `login.html`, `register.html`, `cart.html`, and `checkout.html`.
- **Page transitions added.** Clicking any internal link now fades the page
  out (0.28s ease) before navigating, instead of a hard cut. This lives in
  `firebase.js` (see the note in the file — there's no dedicated "shared JS"
  file in the plan, so it's bundled there since that script already loads
  everywhere; happy to split it into its own file later if you'd rather keep
  `firebase.js` strictly Firebase-only).
- **Login <-> Register now slides, even across a real page load.**
  Clicking "Get Started" from `login.html` (or "Login" from `register.html`)
  plays the existing slide animation first, then navigates — and since the
  destination page already opens in that slid-over position, it reads as one
  continuous motion instead of two separate pages. Regular navigation to
  login/register from other pages (home, products) still uses the plain fade,
  since there's no panel to slide from those pages.
- **`cart.html` and `checkout.html` are built.**
  - `cart.html` / `js/cart.js`: reads the cart from `localStorage`, quantity
    +/- steppers, remove button, live subtotal/shipping/total, empty state.
  - `checkout.html` / `js/checkout.js`: gated behind login (shows a "please
    log in" state if signed out), shipping form pre-filled with the user's
    name/email, and on submit writes a real order document to a Firestore
    `orders` collection (items, totals, shipping info, `userId`, status
    "Pending"), then clears the cart.
  - Both reuse `css/shop.css` rather than a new file, since the plan doesn't
    allocate a dedicated stylesheet for them.

## Round 4 updates

- **`firebase.js` split, as discussed.** It now contains only Firebase
  initialization. Everything else (navbar auth-gating, page transitions,
  cart storage helpers) moved to a new `js/site.js`, which imports `auth`
  from `firebase.js` for the one thing it actually needs from it. This file
  isn't in your original diagram, but the alternative was scattering shared
  code across `products.js`/`cart.js`/`checkout.js` or leaving it bloating
  `firebase.js` again — `site.js` was the more honest home for it.

- **4-tier role system.** Every Firestore `users` document now has a `role`
  field: `"user"` (default on signup), `"staff"`, `"admin"`, `"superadmin"`.
  There's no self-promotion path by design — new accounts always start as
  `"user"`. **Important:** since nobody starts as an admin, you'll need to
  manually set your own account's `role` field to `"superadmin"` in the
  Firebase Console (Firestore → `users` → your document) the first time, so
  someone can actually reach the admin dashboard and promote others from
  there afterward.

- **`profile.html` + `js/profile.js` built.** Editable name, read-only email,
  a role badge, member-since date, and real order history pulled from the
  `orders` collection (filtered by `userId`). Note: your file structure
  diagram listed `profile.html` but no matching script — I added `profile.js`
  to match the same 1:1 pattern as `products.html`/`products.js`,
  `cart.html`/`cart.js`, etc.

- **Admin panel built:** `admin/dashboard.html`, `admin/products.html`,
  `admin/orders.html`, sharing `css/admin.css` and `js/admin.js` (one shared
  script, DOM-guarded per page — same pattern as `auth.js` serving both
  login and register).
  - **Access control:** anyone below `"staff"` gets an access-denied screen,
    not the admin UI.
  - **Dashboard:** KPI cards (orders, revenue, users, pending orders) from
    live Firestore data, plus a **User Management table visible only to
    Super Admin** for changing anyone's role via a dropdown.
  - **Products:** full CRUD against a new Firestore `products` collection
    (add/edit/delete), with a "Seed Sample Products" button to load your
    original 9 products in one click. Staff can view the table; only
    Admin/Super Admin see the add/edit/delete controls.
  - **Orders:** live order list with a status dropdown (Pending → Processing
    → Shipped → Delivered/Cancelled) that updates Firestore directly.

- **One real gap to flag honestly:** `products.html` (the customer-facing
  page) still shows the original 9 hardcoded products, not the new Firestore
  `products` collection. So right now, adding/editing a product in the admin
  panel won't change what customers see on the storefront — the two aren't
  connected yet. Wiring `products.js` to read from Firestore instead of
  static HTML is the natural next step and isn't a big lift, but I didn't
  want to fold it silently into this already-large round of changes without
  flagging it.

## Round 5 updates

- **`products.html` now reads from Firestore, not hardcoded HTML.** This
  closes the gap flagged earlier — admin changes in `admin/products.html`
  now actually show up for customers, live, without a page refresh (it uses
  `onSnapshot`, a real-time listener). Search and category filtering both
  now run against the live product list instead of hidden/shown static
  cards, and "Add to Cart" uses event delegation since cards re-render on
  every Firestore update.
- **Catalog expanded from 9 to 30 products**, split evenly across your three
  categories (10 Mobility, 10 Wellness, 10 Digital Health), to meet the
  rubric's 30-product minimum. I generated these myself — your proposal's
  Google Drive product catalog link isn't scrapable (Drive folders are
  JS-rendered, no static listing to fetch), so these aren't from that
  source. Worth reviewing them against whatever your group actually put in
  that Drive folder and swapping in the real details/pricing/descriptions.
- **`admin/products.html`'s "Seed Sample Products" button now seeds all 30**,
  and it's smarter about re-runs: instead of refusing to seed if *any*
  product exists, it checks by name and only adds what's missing. So if you
  already clicked it once with the old 9-product list, clicking it again
  now will safely add the other 21 without creating duplicates.
- **Still no real image files.** All 30 products point to
  `assets/images/products/productN.<ext>` placeholders — none of those files
  exist yet, so every product will show a broken image icon until real
  photos are added there.

## Round 6 updates

- **Replaced the 30 made-up products with your actual 45-product catalog**
  from the proposal PDF: 3 categories × 3 subcategories × 5 products each,
  exactly as your group designed it (Walking Aids, Bathroom Safety, Bedroom
  Comfort & Safety under Mobility; Daily Hygiene, Nutrition, Support &
  Apparel under Wellness; Vital Signs Trackers, Physical Therapy & Rehab,
  Emergency Assistance under Digital Health).
- **Names simplified for easier data entry**, as asked — e.g. "4-Wheel
  Rollator with Padded Seat and Storage Basket" became "4-Wheel Rollator",
  "Custom Engraved Stainless Steel Medical Alert ID Bracelet" became
  "Medical Alert Bracelet". Full mapping is in the seed list in
  `js/admin.js` if you want to compare against the originals.
- **Added a `subcategory` field** to the product data model, matching your
  proposal's structure — it now shows as a small caption under the product
  name on `products.html`, and as a second line in the admin products table.
  The admin add/edit form has a new "Subcategory" text field too. Note: this
  is a free-text field, not a dropdown tied to the selected category — kept
  it simple on purpose so admins can type anything without a rigid list
  fighting them, but that also means typos won't be caught.
- **"Seed Catalog" button now loads all 45** — same safe-to-rerun behavior
  as before (checks by name, only adds what's missing).
- Category-level filtering (Mobility / Wellness / Digital Health) still
  works as before; there's no subcategory filter UI yet (e.g. a way to
  filter to just "Walking Aids"), even though the data now supports it —
  that'd be a reasonable next step if you want tighter browsing.

## Round 7 updates

- **Admin dashboard link added to the navbar.** Previously there was no way
  in except typing `admin/dashboard.html` directly — now every page shows a
  small speedometer icon next to the Profile/Cart icons, but *only* for
  logged-in users whose Firestore role is `staff`, `admin`, or
  `superadmin`. This required `site.js` to do a Firestore role lookup on
  every page load (it already checked login state; now it also checks role
  for this one purpose), which is a bit more work than before but keeps the
  "who am I" logic in one place rather than duplicating it into every page.

## Round 8 updates

- **Password show/hide toggle** added to every password field site-wide
  (login, both signup fields, and the new profile password-change form) —
  a small eye icon that toggles `type="password"`/`type="text"`. This lives
  in `site.js` since it's shared across multiple pages, using generic event
  delegation on `.toggle-password` buttons rather than being wired
  separately in `auth.js` and `profile.js`.
- **Confirm Password added to registration**, with mismatch validation
  before the account is even created.
- **Profile page: three new capabilities**, per your request:
  - **Change Password** — requires re-entering your current password
    first (Firebase requires a "recent" login for sensitive changes like
    this, so it re-authenticates before allowing the update).
  - **Profile photo** — click the camera icon on your avatar to upload one.
  - **Delivery Address** — save your loved one's name, address, and phone
    once; it now **auto-fills at checkout** instead of retyping every order.
- **On your API question about the photo upload — here's the honest
  answer:** the "normal" way to do this is Firebase Storage (upload the
  file, get back a URL, save the URL). I didn't use it, because as of
  February 2026 Firebase changed its policy — Cloud Storage now requires
  the paid Blaze plan just to create a bucket, even to stay within the free
  usage tier. Since this is a school project likely on the free Spark plan,
  I avoided it entirely. Instead, the photo is resized down to a small
  thumbnail in the browser (via canvas) and stored as a base64 text string
  directly in the user's Firestore document — completely free, no billing
  account needed. The trade-off: it's a low-res thumbnail, not an optimized/
  CDN-served image, and Firestore documents cap at 1MB total, so this only
  works for small profile pictures, not general file uploads. If your group
  later sets up Blaze billing (e.g. for the free class-project credits many
  cloud providers offer), migrating to real Firebase Storage would be a
  worthwhile upgrade — but isn't necessary for this to work today.

## Round 9 updates

- **Background seam, take two: fixed attachment.** Your idea was right —
  `background-attachment: fixed` pins the gradient to the viewport instead
  of scrolling with the page, so it stops looking "used up" by the time you
  scroll past the first section. Falls back to normal scrolling on touch
  devices (iOS Safari handles `fixed` backgrounds poorly).
- **Account dropdown, as you suggested.** The profile icon in the navbar is
  now a dropdown with **Account**, **Settings**, and **Log Out** — agreed
  this is the better call over a separate settings button; it's the
  standard pattern and won't force nav changes every time a new account
  page gets added. This appears on every customer-facing page now, not
  just profile.html.
- **New `settings.html` / `js/settings.js`.** Not in your original
  diagram, but the same "one page per concern" pattern as everything else —
  added rather than piling more into `profile.js`. Contains:
  - **Change Password** — moved here from the profile page, exact same logic
  - **Dark Mode toggle** — applies instantly (no reload), saved to
    `localStorage` so it works even logged out (e.g. on the login page), and
    mirrored to Firestore for logged-in users so it's remembered across
    devices
  - **Notification preferences** (Order Email Updates, Promotions & Offers)
    — these don't *do* anything yet since there's no email-sending API wired
    up, but the preference is saved to Firestore now so the EmailJS
    integration we discussed can respect it later instead of emailing
    everyone regardless of preference
- **Dark mode is scoped to customer-facing pages only** — `index.html`
  through `settings.html`, not the admin panel. `css/admin.css` is a
  separate, fully light-mode stylesheet; extending dark mode there would
  roughly double this round's CSS work, so admin pages currently ignore the
  theme preference entirely and always render light. Flag if you want that
  extended later.
- **Gradient usage reconsidered while in here**: functional buttons
  (Add to Cart, Save, Sign In/Up, Update Password, Place Order) are now a
  solid brand blue instead of the rainbow gradient, which is now reserved
  for the hero CTA and CTA banner only — see the prior round's notes for
  the full reasoning.

## Round 10 updates

- **Fixed: orders not showing in Order History.** Real bug, not a display
  issue — the query combined `where("userId","==",uid)` with
  `orderBy("createdAt","desc")` on different fields, which requires a
  Firestore composite index that never existed. It failed silently (no
  try/catch), so orders just never appeared with no error shown. Fixed by
  dropping the `orderBy` and sorting client-side instead — works without
  needing any manual index setup in the Firebase console.
- **Dark mode background bug fixed** — same root cause as the light-mode
  fix last round: the dark-mode override redefined the `background`
  shorthand without repeating `background-attachment: fixed`, silently
  resetting it. Both themes now stay fixed.
- **New Customer Reviews section** added to the home page, directly above
  Meet the Team as requested — three testimonial cards with star ratings.
  These are illustrative/fictional (there's no real review-collection
  system yet), and the section says so in small print at the bottom —
  didn't want fabricated quotes looking like real customer data.
- **Profile page restructured to read-only.** Name, email, and delivery
  address now just display as text — no more inline editing here. An
  "Edit Profile" button and a small pencil icon (next to Delivery Address)
  both link to Settings instead.
- **Settings page is now the single place to edit everything**: Profile
  Information (name), Delivery Address, Change Password, Appearance,
  Notifications. Rationale for choosing "redirect to Settings" over
  inline pencil-to-edit-in-place on the profile page itself: avoids having
  two separate places with their own save logic for the same data (profile
  page and settings page both touching `fullName`/`savedAddress` would mean
  keeping two code paths in sync every time either changes).
- **Order History is now its own card**, matching the visual style of the
  other profile panels instead of floating loose in the column.
- **Empty order history message updated** to match what you asked for:
  "You haven't ordered anything yet. Order one now!" with a Start Shopping
  button.

## Round 11 updates

- **Cancel Order added.** Order History cards now show a "Cancel Order"
  button, but only while status is `Pending` or `Processing` — hidden once
  an order is `Shipped`, `Delivered`, or already `Cancelled`, since
  cancelling after that point doesn't make sense. Confirms before
  cancelling, updates the order's status in Firestore, then refreshes the
  list.
- **Fixed order status colors while in there.** Order status badges
  ("Pending", "Cancelled", etc.) were reusing the role-badge color system
  (meant for User/Staff/Admin/Super Admin), which meant a cancelled order
  showed in blue instead of red — same color as "Staff." Moved the
  proper `.status-badge` colors (already built for `admin/orders.html`)
  into the shared `style.css` so `profile.html` can use the same,
  correctly-colored system instead.

## Round 12 updates

- **Seed Catalog button removed** from `admin/products.html` and
  `js/admin.js`, now that Firestore is populated with the real 45-product
  catalog.
- **Fixed:** the home page's "Get Started Today" CTA no longer sends
  logged-in users back to the registration form — it now checks auth state
  (via the same `onAuthStateChanged` listener `site.js` already runs on
  every page) and redirects to `products.html` with the label "Shop Now"
  instead.
- **Google Sign-In added** to both `login.html` and `register.html` — one
  shared handler in `auth.js` covers both buttons, since the flow is
  identical either way (Google's popup handles authentication; a Firestore
  profile doc only gets created if this is the account's first sign-in).
  **Needs Firebase Console setup**: Authentication → Sign-in method →
  enable Google, same place you enabled Email/Password earlier.
- **Google Maps address picker built into Settings.** Drag the marker,
  click anywhere on the map, or use the Places search box — any of the
  three reverse-geocodes into the address textarea and saves `lat`/`lng`
  alongside the text address in Firestore. Checkout now also carries those
  coordinates into each order's `shippingInfo` when it's placed.
- **Live parcel tracking added to Order History.** Each order card has a
  "Track Order" toggle revealing a status stepper (Pending → Processing →
  Shipped → Delivered, or a distinct red "Cancelled" state) plus a map
  showing **KalingaCare HQ (TIP Quezon City, 938 Aurora Blvd, Cubao)** as
  the origin and the order's saved delivery coordinates as the destination,
  connected by a line. Orders placed before this feature existed (or where
  the address was never pinned on a map) show a graceful "no saved
  location" message instead of a broken map.
- **Needs a Google Maps API key you'll have to get yourself** — I can't
  generate one for you. Steps:
  1. Go to [console.cloud.google.com](https://console.cloud.google.com) →
     create/select a project → **APIs & Services → Library**.
  2. Enable **Maps JavaScript API**, **Geocoding API**, and **Places API**.
  3. **APIs & Services → Credentials → Create Credentials → API Key.**
  4. Open `js/site.js`, find `GOOGLE_MAPS_API_KEY = "YOUR_GOOGLE_MAPS_API_KEY"`,
     replace with your real key.
  5. **Important — restrict the key** (Credentials → click your key →
     Application restrictions → HTTP referrers): add your local dev URL
     (e.g. `http://127.0.0.1:5500/*`) and your future GitHub Pages URL.
     Unlike the Firebase config, a Maps key is meant to be restricted —
     anyone using an unrestricted key burns through your quota.
  6. Google requires a **billing account on file** for Maps APIs, same as
     Cloud Storage — but the free tier is generous (~$200/month credit),
     and for a class project's traffic you'll very likely pay $0.
  Until you do this, the map picker and tracking map show a friendly
  placeholder message ("needs a Google Maps API key") instead of a broken
  page — the rest of the address form and order tracking still work fine
  without it.
- **One known limitation**: checkout's address fields are still separate
  text inputs pre-filled from your saved address — there's no map picker
  directly on the checkout page itself, only in Settings. If you edit the
  address text at checkout without re-picking on the Settings map, the
  saved `lat`/`lng` won't match what you typed. Worth flagging if this
  matters for your demo.

## Still needed (not done yet — deferred per your message)

- **Images**: `assets/images/hero2.2.png` (index.html) and
  `assets/images/products/product1.jpg` through `product9.webp` (products.html)
  aren't included since they weren't uploaded — the site will show broken image
  icons until you drop the real files into those paths.
- **The rest of the file structure**: `login.html`, `register.html`, `cart.html`,
  `checkout.html`, `profile.html`, `admin/`, `css/auth.css`, `css/admin.css`,
  `js/auth.js`, `js/cart.js`, `js/checkout.js`, `js/admin.js` — none of these exist
  yet. Ready to build these next, whenever you want to move forward.
- **Firestore integration for products**: `products.js` still lists products as
  static HTML (matches what you had). Wiring it to read from a `products`
  collection in Firestore (like the `cars` collection in your Arangkada project)
  is a natural next step, but I left it alone for now since you said we'd fill
  in the other files first.

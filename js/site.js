// js/site.js
// KalingaCare — shared behavior used across multiple pages.
//
// This isn't in the original file-structure diagram, but it earned its own
// file: it was previously stuffed inside firebase.js, which made that file
// do two unrelated jobs (Firebase setup + generic site UI). This file now
// owns everything that's shared across pages but ISN'T specific to Firebase
// init, auth forms, products, checkout, or admin:
//   1. Navbar auth-gating (Login/Get Started vs. Cart)
//   2. Page-to-page fade transitions
//   3. Cart storage helpers (localStorage) shared by products.js, cart.js,
//      and checkout.js, so those three files don't each keep their own copy.
//
// It imports `auth` from firebase.js because it needs to know whether
// someone's logged in — that's the only real overlap with Firebase.

import { auth, db } from "./firebase.js";
import {
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  doc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

/* ===== Toast notifications =====
   Small, auto-dismissing message that appears at the bottom of the screen —
   used e.g. by products.js before redirecting a guest to log in, so the
   redirect doesn't feel like a silent, unexplained jump. */
export function showToast(message, duration = 1800) {
  const toast = document.createElement("div");
  toast.className = "site-toast";
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add("show"));

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/* ===== Image resize + base64 encode =====
   No Firebase Storage on purpose: since Feb 2026, Cloud Storage for Firebase
   requires the paid Blaze plan just to create a bucket, even to stay within
   the free tier. Instead images are resized down client-side and stored as
   a base64 string directly on the Firestore doc — free, no billing account
   needed. Trade-off: capped to a modest size (not CDN-served like real image
   hosting), fine for avatars and product thumbnails, not for large photos.
   Originally lived only in profile.js (avatar upload); shared here so the
   admin product-image drop-zone reuses the same tested resize logic. */
export function resizeImageToDataUrl(file, maxSize = 300, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxSize) {
          height = Math.round(height * (maxSize / width));
          width = maxSize;
        } else if (height > maxSize) {
          width = Math.round(width * (maxSize / height));
          height = maxSize;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => reject(new Error("Couldn't read that image."));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.readAsDataURL(file);
  });
}

/* ===== Cart storage (shared by products.js / cart.js / checkout.js) ===== */

export const CART_KEY = "kalingacare_cart";
export const SHIPPING_FEE = 150;

export function loadCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY)) || [];
  } catch {
    return [];
  }
}

export function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateNavCartBadge();
}

export function clearCart() {
  localStorage.removeItem(CART_KEY);
  updateNavCartBadge();
}

/* ===== Navbar: Login/Get Started vs. Cart, based on auth state ===== */

// Every page that has a cart icon in its navbar wraps it in
// <div id="navCartWrap"> and wraps the Login/Get Started links in
// <div id="navAuthLinks">. We show one or the other based on auth state.
export function updateNavCartBadge() {
  const cartCountEl = document.getElementById("navCartCount");
  if (!cartCountEl) return;
  const cart = loadCart();
  cartCountEl.textContent = cart.reduce((sum, item) => sum + item.qty, 0);
}

onAuthStateChanged(auth, async (user) => {
  const authLinks = document.getElementById("navAuthLinks");
  const cartWrap = document.getElementById("navCartWrap");
  const adminLink = document.getElementById("navAdminLink");
  const ctaBtn = document.getElementById("ctaGetStartedBtn");

  if (authLinks) authLinks.classList.toggle("d-none", !!user);
  if (cartWrap) cartWrap.classList.toggle("d-none", !user);
  updateNavCartBadge();

  // The home page's "Get Started Today" CTA shouldn't send an already
  // logged-in user back to the registration form.
  if (ctaBtn) {
    if (user) {
      ctaBtn.href = "products.html";
      ctaBtn.textContent = "Shop Now";
    } else {
      ctaBtn.href = "register.html";
      ctaBtn.textContent = "Get Started Today";
    }
  }

  if (adminLink) {
    if (!user) {
      adminLink.classList.add("d-none");
      return;
    }
    const snap = await getDoc(doc(db, "users", user.uid));
    const role = snap.exists() ? snap.data().role : "user";
    adminLink.classList.toggle(
      "d-none",
      !["staff", "admin", "superadmin"].includes(role),
    );
  }
});

window.addEventListener("storage", (e) => {
  if (e.key === CART_KEY) updateNavCartBadge();
});

/* ===== Google Maps =====
   IMPORTANT: replace this with your own key from Google Cloud Console
   (enable "Maps JavaScript API" and "Geocoding API", then restrict the key
   to your domain under Application restrictions -> HTTP referrers). This
   project's Firebase key is safe to leave public because Firestore rules
   are what actually protect your data — a Google Maps key works
   differently and should be restricted, since anyone using it consumes
   your quota. Get one at: https://console.cloud.google.com/google/maps-apis */
export const GOOGLE_MAPS_API_KEY = "AIzaSyBBqPEJgekBOairKL01wi9ics8UilatFec";

// KalingaCare HQ — TIP Quezon City (938 Aurora Blvd, Cubao). Approximate
// coordinates for the campus; worth double-checking against Google Maps
// once you have your API key and nudging this if it's off.
export const HQ_LOCATION = {
  name: "KalingaCare HQ — TIP Quezon City",
  address: "938 Aurora Blvd, Cubao, Quezon City, Metro Manila, Philippines",
  lat: 14.6198,
  lng: 121.0535,
};

// DEMO_MAP_ID is Google's own sanctioned placeholder Map ID for testing/
// coursework — used directly in their official docs examples. AdvancedMarkerElement
// (see below) requires SOME Map ID to render at all; this avoids an extra
// Cloud Console setup step (Map Management) that isn't necessary for this
// project. Swappable for a real one later if you ever want it.
export const DEMO_MAP_ID = "DEMO_MAP_ID";

let googleMapsPromise = null;

// This is Google's own official bootstrap loader snippet (documented at
// developers.google.com/maps/documentation/javascript/load-maps-js-api),
// just wrapped in a function instead of pasted as an inline <script> tag.
// It's what actually DEFINES google.maps.importLibrary — a plain
// <script src="https://maps.googleapis.com/maps/api/js?..."> tag (what
// this function used to do) loads the API fine but never defines
// importLibrary at all, which is why calling it threw "not a function."
function installGoogleMapsBootstrap() {
  if (window.google?.maps?.importLibrary) return;
  ((g) => {
    let h, a, k, b;
    const p = "The Google Maps JavaScript API",
      c = "google",
      l = "importLibrary",
      q = "__ib__",
      m = document;
    b = window;
    b = b[c] || (b[c] = {});
    const d = b.maps || (b.maps = {}),
      r = new Set(),
      e = new URLSearchParams(),
      u = () =>
        h ||
        (h = new Promise(async (f, n) => {
          await (a = m.createElement("script"));
          e.set("libraries", [...r] + "");
          for (k in g)
            e.set(
              k.replace(/[A-Z]/g, (t) => "_" + t[0].toLowerCase()),
              g[k],
            );
          e.set("callback", c + ".maps." + q);
          a.src = `https://maps.${c}apis.com/maps/api/js?` + e;
          d[q] = f;
          a.onerror = () => (h = n(Error(p + " could not load.")));
          a.nonce = m.querySelector("script[nonce]")?.nonce || "";
          m.head.append(a);
        }));
    d[l]
      ? console.warn(p + " only loads once. Ignoring:", g)
      : (d[l] = (f, ...n) => r.add(f) && u().then(() => d[l](f, ...n)));
  })({
    key: GOOGLE_MAPS_API_KEY,
    v: "weekly",
  });
}

export async function loadGoogleMaps() {
  if (googleMapsPromise) return googleMapsPromise;

  googleMapsPromise = (async () => {
    installGoogleMapsBootstrap();
    // Requesting the "maps" library is what actually triggers the script
    // to load (see u() above) and populates google.maps.Map, LatLngBounds,
    // Polyline, etc. Callers that need marker/places/geocoding still
    // import those specifically themselves.
    await google.maps.importLibrary("maps");
    return google.maps;
  })();

  return googleMapsPromise;
}

/* ===== Log Out (nav dropdown) =====
   One handler here instead of duplicating signOut logic into every page,
   since the Account/Settings/Log Out dropdown is now in the shared navbar
   markup on every customer-facing page. */
document.addEventListener("click", async (e) => {
  const logoutLink = e.target.closest("#navLogoutLink");
  if (!logoutLink) return;
  e.preventDefault();
  await signOut(auth);
  window.location.href = "index.html";
});

/* ===== Password show/hide toggle =====
   Shared by login.html, register.html, and profile.html's change-password
   form. Markup: a <button class="toggle-password" data-target="inputId">
   sitting inside the same .form-field as the password <input>. */
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".toggle-password");
  if (!btn) return;

  const input = document.getElementById(btn.dataset.target);
  if (!input) return;

  const icon = btn.querySelector("i");
  const isHidden = input.type === "password";
  input.type = isHidden ? "text" : "password";
  if (icon) icon.className = isHidden ? "bi bi-eye-slash" : "bi bi-eye";
  btn.setAttribute("aria-label", isHidden ? "Hide password" : "Show password");
});

/* ===== Page transitions ===== */

// Smooth fade-out before any normal internal link navigates, so moving
// between pages doesn't feel like a hard cut. Links can opt out with
// class="no-transition" (used for the login<->register slide, which
// animates itself instead — see auth.js).
document.addEventListener("click", (e) => {
  const link = e.target.closest("a");
  if (!link || link.classList.contains("no-transition")) return;
  if (link.target === "_blank" || link.hasAttribute("download")) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

  const href = link.getAttribute("href");
  if (
    !href ||
    href.startsWith("#") ||
    href.startsWith("http") ||
    href.startsWith("mailto:") ||
    href.startsWith("tel:")
  )
    return;

  e.preventDefault();
  document.body.classList.add("page-leaving");
  setTimeout(() => {
    window.location.href = href;
  }, 280);
});

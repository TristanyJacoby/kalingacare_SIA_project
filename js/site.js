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
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

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

  if (authLinks) authLinks.classList.toggle("d-none", !!user);
  if (cartWrap) cartWrap.classList.toggle("d-none", !user);
  updateNavCartBadge();

  if (adminLink) {
    if (!user) {
      adminLink.classList.add("d-none");
      return;
    }
    const snap = await getDoc(doc(db, "users", user.uid));
    const role = snap.exists() ? snap.data().role : "user";
    adminLink.classList.toggle("d-none", !["staff", "admin", "superadmin"].includes(role));
  }
});

window.addEventListener("storage", (e) => {
  if (e.key === CART_KEY) updateNavCartBadge();
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

// js/email-verified.js
// KalingaCare — landing page for the signup verification link. If the
// customer is signed in in this browser, refresh their session so the
// verified status (and the Firestore rule that checks it) applies right
// away, then point them back to checkout or the shop.

import { auth } from "./firebase.js";
import { loadCart } from "./site.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const primary = document.getElementById("evPrimary");
const secondary = document.getElementById("evSecondary");

onAuthStateChanged(auth, async (user) => {
  if (!user) return; // keep "Log in" / "Browse products"

  try {
    await user.reload();
    if (auth.currentUser.emailVerified) await auth.currentUser.getIdToken(true);
  } catch {
    // Still fine: checkout refreshes again before ordering.
  }

  if (loadCart().length > 0) {
    primary.textContent = "Continue to checkout";
    primary.href = "checkout.html";
    secondary.textContent = "Keep shopping";
  } else {
    primary.textContent = "Start shopping";
    primary.href = "products.html";
    secondary.textContent = "Go to Home";
    secondary.href = "index.html";
  }
});

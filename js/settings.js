// js/settings.js
// KalingaCare — Settings page: password, dark mode, notification preferences.

import { auth, db } from "./firebase.js";
import {
  onAuthStateChanged,
  updateProfile,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { doc, getDoc, updateDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { initAddressPicker } from "./address-map.js";
import { COUNTRY_CURRENCY, populateCountrySelect } from "./currency.js";

const authGate = document.getElementById("authGate");
const settingsContent = document.getElementById("settingsContent");
const THEME_KEY = "kalingacare_theme";

function showMsg(el, message, isError = true) {
  el.textContent = message;
  el.classList.add("show");
  if (!isError) setTimeout(() => el.classList.remove("show"), 3000);
}

/* ===== Address map picker (js/address-map.js) =====
   The pin's coordinates are saved alongside the text address. */
let currentLat = null;
let currentLng = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    authGate.style.display = "block";
    settingsContent.style.display = "none";
    return;
  }

  authGate.style.display = "none";
  settingsContent.style.display = "block";

  const snap = await getDoc(doc(db, "users", user.uid));
  const userData = snap.exists() ? snap.data() : {};

  // Profile Information
  document.getElementById("profileName").value = user.displayName || userData.fullName || "";
  document.getElementById("profileEmail").value = user.email || "";
  populateCountrySelect(document.getElementById("profileCountry"), userData.country || "");

  // Delivery Address
  let savedLat = null;
  let savedLng = null;
  if (userData.savedAddress) {
    document.getElementById("addrRecipient").value = userData.savedAddress.recipient || "";
    document.getElementById("addrAddress").value = userData.savedAddress.address || "";
    document.getElementById("addrPhone").value = userData.savedAddress.phone || "";
    savedLat = userData.savedAddress.lat ?? null;
    savedLng = userData.savedAddress.lng ?? null;
  }
  currentLat = savedLat;
  currentLng = savedLng;
  initAddressPicker({
    mapEl: document.getElementById("addressMap"),
    searchContainer: document.getElementById("addressSearchBoxContainer"),
    addressInput: document.getElementById("addrAddress"),
    lat: savedLat,
    lng: savedLng,
    onChange: (pos) => {
      currentLat = pos.lat;
      currentLng = pos.lng;
    },
  });

  // Notification preferences (default: email on, promos off)
  const prefs = userData.preferences || {};
  document.getElementById("emailNotifToggle").checked = prefs.emailNotifications !== false;
  document.getElementById("promoNotifToggle").checked = !!prefs.promoNotifications;
});

/* ===== Profile Information (name) ===== */
document.getElementById("profileForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("profileError");
  const successEl = document.getElementById("profileSuccess");
  errorEl.classList.remove("show");
  successEl.classList.remove("show");

  const fullName = document.getElementById("profileName").value.trim();
  const country = document.getElementById("profileCountry").value;

  try {
    await updateProfile(auth.currentUser, { displayName: fullName });
    await updateDoc(doc(db, "users", auth.currentUser.uid), {
      fullName,
      country,
      currency: COUNTRY_CURRENCY[country] || "PHP",
    });
    showMsg(successEl, "Profile updated.", false);
  } catch (err) {
    showMsg(errorEl, "Couldn't save changes. Please try again.");
  }
});

/* ===== Delivery Address ===== */
document.getElementById("addressForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("addressError");
  const successEl = document.getElementById("addressSuccess");
  errorEl.classList.remove("show");
  successEl.classList.remove("show");

  const savedAddress = {
    recipient: document.getElementById("addrRecipient").value.trim(),
    address: document.getElementById("addrAddress").value.trim(),
    phone: document.getElementById("addrPhone").value.trim(),
    lat: currentLat,
    lng: currentLng,
  };

  try {
    await updateDoc(doc(db, "users", auth.currentUser.uid), { savedAddress });
    showMsg(successEl, "Address saved.", false);
  } catch (err) {
    showMsg(errorEl, "Couldn't save address. Please try again.");
  }
});

/* ===== Change password =====
   Firebase requires a "recent" login for sensitive account changes, so we
   re-authenticate with the current password first before updatePassword()
   is allowed to succeed. */
document.getElementById("passwordForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("passwordError");
  const successEl = document.getElementById("passwordSuccess");
  errorEl.classList.remove("show");
  successEl.classList.remove("show");

  const currentPassword = document.getElementById("currentPassword").value;
  const newPassword = document.getElementById("newPassword").value;
  const confirmNewPassword = document.getElementById("confirmNewPassword").value;
  const form = e.target;
  const submitBtn = form.querySelector(".btn-auth");

  if (newPassword !== confirmNewPassword) {
    showMsg(errorEl, "New passwords don't match.");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Updating...";

  try {
    const credential = EmailAuthProvider.credential(auth.currentUser.email, currentPassword);
    await reauthenticateWithCredential(auth.currentUser, credential);
    await updatePassword(auth.currentUser, newPassword);
    form.reset();
    showMsg(successEl, "Password updated.", false);
  } catch (err) {
    if (err.code === "auth/wrong-password" || err.code === "auth/invalid-credential") {
      showMsg(errorEl, "Current password is incorrect.");
    } else if (err.code === "auth/weak-password") {
      showMsg(errorEl, "New password should be at least 6 characters.");
    } else {
      showMsg(errorEl, "Couldn't update password. Please try again.");
    }
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Update Password";
  }
});

/* ===== Dark Mode =====
   Applied instantly via the data-theme attribute (no page reload needed),
   saved to localStorage so it works site-wide (including logged-out pages
   like login/register), and mirrored to Firestore so it's remembered if
   the user logs in on a different device. */
const darkModeToggle = document.getElementById("darkModeToggle");
darkModeToggle.checked = document.documentElement.getAttribute("data-theme") === "dark";

darkModeToggle.addEventListener("change", async () => {
  const isDark = darkModeToggle.checked;
  document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
  localStorage.setItem(THEME_KEY, isDark ? "dark" : "light");

  if (auth.currentUser) {
    try {
      await setDoc(doc(db, "users", auth.currentUser.uid), { preferences: { theme: isDark ? "dark" : "light" } }, { merge: true });
    } catch {
      // Non-critical — the toggle already applied locally either way.
    }
  }
});

/* ===== Notification preferences ===== */
async function savePreference(key, value) {
  if (!auth.currentUser) return;
  try {
    await setDoc(doc(db, "users", auth.currentUser.uid), { preferences: { [key]: value } }, { merge: true });
  } catch {
    // Non-critical for now — no error UI needed for a toggle flip.
  }
}

document.getElementById("emailNotifToggle").addEventListener("change", (e) => {
  savePreference("emailNotifications", e.target.checked);
});

document.getElementById("promoNotifToggle").addEventListener("change", (e) => {
  savePreference("promoNotifications", e.target.checked);
});

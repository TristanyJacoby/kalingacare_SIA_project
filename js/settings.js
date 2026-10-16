// js/settings.js
// KalingaCare — Settings page: password, dark mode, notification preferences.

import { auth, db } from "./firebase.js";
import {
  onAuthStateChanged,
  updateProfile,
  updatePassword,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  linkWithCredential,
  sendPasswordResetEmail,
  EmailAuthProvider,
  GoogleAuthProvider,
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

/* ===== Change password / Set a password =====
   Accounts created with Google have no password. For them the card turns
   into "Set a Password": the new password is linked to the same account,
   so they can sign in with Google OR email + password afterwards.
   Everyone else changes it the usual way. Firebase requires a recent
   login for both, so we re-authenticate first (current password, or the
   Google popup for Google-only accounts). */
function hasPassword(user) {
  return user.providerData.some((p) => p.providerId === "password");
}

function setPasswordMode(user) {
  const setMode = !hasPassword(user);
  document.getElementById("passwordTitle").textContent = setMode ? "Set a Password" : "Change Password";
  document.getElementById("setPasswordIntro").hidden = !setMode;
  document.getElementById("currentPasswordField").hidden = setMode;
  document.getElementById("currentPassword").required = !setMode;
  document.getElementById("passwordForgotRow").hidden = setMode;
  document.getElementById("passwordSubmit").textContent = setMode ? "Set Password" : "Update Password";
  return setMode;
}

onAuthStateChanged(auth, (user) => {
  if (user) setPasswordMode(user);
});

document.getElementById("passwordForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("passwordError");
  const successEl = document.getElementById("passwordSuccess");
  errorEl.classList.remove("show");
  successEl.classList.remove("show");

  const user = auth.currentUser;
  const setMode = !hasPassword(user);
  const currentPassword = document.getElementById("currentPassword").value;
  const newPassword = document.getElementById("newPassword").value;
  const confirmNewPassword = document.getElementById("confirmNewPassword").value;
  const form = e.target;
  const submitBtn = document.getElementById("passwordSubmit");
  const idleText = submitBtn.textContent;

  if (newPassword !== confirmNewPassword) {
    showMsg(errorEl, "New passwords don't match.");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = setMode ? "Setting..." : "Updating...";

  try {
    if (setMode) {
      const credential = EmailAuthProvider.credential(user.email, newPassword);
      try {
        await linkWithCredential(user, credential);
      } catch (err) {
        if (err.code !== "auth/requires-recent-login") throw err;
        // Signed in a while ago: confirm with Google, then try again.
        await reauthenticateWithPopup(user, new GoogleAuthProvider());
        await linkWithCredential(user, credential);
      }
      form.reset();
      setPasswordMode(auth.currentUser);
      showMsg(successEl, "Password set. You can now sign in with your email and this password, or with Google.", false);
    } else {
      const credential = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPassword);
      form.reset();
      showMsg(successEl, "Password updated.", false);
    }
  } catch (err) {
    if (err.code === "auth/wrong-password" || err.code === "auth/invalid-credential") {
      showMsg(errorEl, "Current password is incorrect.");
    } else if (err.code === "auth/weak-password") {
      showMsg(errorEl, "New password should be at least 6 characters.");
    } else if (err.code === "auth/popup-closed-by-user" || err.code === "auth/cancelled-popup-request") {
      showMsg(errorEl, "Please confirm with Google to set your password.");
    } else if (err.code === "auth/provider-already-linked" || err.code === "auth/credential-already-in-use") {
      setPasswordMode(auth.currentUser);
      showMsg(errorEl, "This account already has a password. Use Change Password instead.");
    } else {
      showMsg(errorEl, "Couldn't save the password. Please try again.");
    }
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = idleText;
  }
});

// Forgot the current password while signed in: email a reset link.
document.getElementById("sendResetLinkBtn").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  const errorEl = document.getElementById("passwordError");
  const successEl = document.getElementById("passwordSuccess");
  errorEl.classList.remove("show");
  successEl.classList.remove("show");
  btn.disabled = true;
  try {
    const returnUrl = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(window.location.origin)
      ? `${window.location.origin}/login.html`
      : "https://kalingacare-drab.vercel.app/login.html";
    await sendPasswordResetEmail(auth, auth.currentUser.email, { url: returnUrl });
    showMsg(successEl, `Reset link sent to ${auth.currentUser.email}.`, false);
  } catch (err) {
    showMsg(
      errorEl,
      err.code === "auth/too-many-requests"
        ? "Too many attempts. Please wait a few minutes and try again."
        : "Couldn't send the reset link. Please try again.",
    );
  } finally {
    btn.disabled = false;
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

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
import { loadGoogleMaps, GOOGLE_MAPS_API_KEY, DEMO_MAP_ID } from "./site.js";
import { COUNTRY_CURRENCY, populateCountrySelect } from "./currency.js";

const authGate = document.getElementById("authGate");
const settingsContent = document.getElementById("settingsContent");
const THEME_KEY = "kalingacare_theme";

function showMsg(el, message, isError = true) {
  el.textContent = message;
  el.classList.add("show");
  if (!isError) setTimeout(() => el.classList.remove("show"), 3000);
}

// AdvancedMarkerElement's .position can come back as either a plain
// {lat, lng} literal or a google.maps.LatLng-style object with lat()/lng()
// methods, depending on how it was set — this normalizes either shape.
function toLatLngLiteral(pos) {
  if (typeof pos.lat === "function") return { lat: pos.lat(), lng: pos.lng() };
  return { lat: pos.lat, lng: pos.lng };
}

/* ===== Address map picker =====
   Drag the marker or click anywhere on the map to set the exact delivery
   location; a search box on top uses the Places Autocomplete widget to
   jump straight to an address. Either action reverse-geocodes the pin's
   position into the address textarea and updates currentLat/currentLng,
   which get saved alongside the text address when the form is submitted.

   Uses AdvancedMarkerElement + PlaceAutocompleteElement (Google's current,
   non-deprecated APIs as of this writing) rather than the older Marker/
   Autocomplete classes — see the "marker" library import and Map ID below,
   both of which AdvancedMarkerElement specifically requires and the older
   Marker class didn't. */
let currentLat = null;
let currentLng = null;
let map = null;
let marker = null;
let geocoder = null;

async function initAddressMap(savedLat, savedLng) {
  const mapEl = document.getElementById("addressMap");

  if (!GOOGLE_MAPS_API_KEY || GOOGLE_MAPS_API_KEY === "YOUR_GOOGLE_MAPS_API_KEY") {
    mapEl.innerHTML = `
      <div class="map-placeholder">
        <i class="bi bi-map" style="font-size:1.8rem; margin-bottom:8px;"></i>
        Map picker needs a Google Maps API key.<br />
        Add one in <code>js/site.js</code> (GOOGLE_MAPS_API_KEY) to enable it.
      </div>`;
    return;
  }

  let googleMaps, AdvancedMarkerElement, PlaceAutocompleteElement, Geocoder;
  try {
    googleMaps = await loadGoogleMaps();
    ({ AdvancedMarkerElement } = await googleMaps.importLibrary("marker"));
    ({ PlaceAutocompleteElement } = await googleMaps.importLibrary("places"));
    ({ Geocoder } = await googleMaps.importLibrary("geocoding"));
  } catch (err) {
    console.error("KalingaCare Maps error:", err);
    mapEl.innerHTML = `<div class="map-placeholder">Couldn't load the map right now.</div>`;
    return;
  }

  // Default center: the saved pin if there is one, otherwise Metro Manila.
  const center = {
    lat: savedLat ?? 14.5995,
    lng: savedLng ?? 120.9842,
  };
  currentLat = savedLat ?? null;
  currentLng = savedLng ?? null;

  map = new googleMaps.Map(mapEl, {
    center,
    zoom: savedLat ? 16 : 11,
    mapId: DEMO_MAP_ID, // required for AdvancedMarkerElement to render at all
    streetViewControl: false,
    mapTypeControl: false,
  });

  marker = new AdvancedMarkerElement({
    position: center,
    map,
    gmpDraggable: true,
    title: "Drag to set the exact delivery location",
  });

  geocoder = new Geocoder();

  async function updateFromPosition(latLngLiteral) {
    currentLat = latLngLiteral.lat;
    currentLng = latLngLiteral.lng;
    try {
      const result = await geocoder.geocode({ location: latLngLiteral });
      if (result.results[0]) {
        document.getElementById("addrAddress").value = result.results[0].formatted_address;
      }
    } catch {
      // Reverse geocoding failing isn't critical — the pin position is
      // still saved even if we can't turn it into text.
    }
  }

  marker.addListener("dragend", () => updateFromPosition(toLatLngLiteral(marker.position)));

  map.addListener("click", (e) => {
    const pos = toLatLngLiteral(e.latLng);
    marker.position = pos;
    updateFromPosition(pos);
  });

  // Places Autocomplete widget — this is a custom <gmp-place-autocomplete>
  // element (not a plain <input> the old Autocomplete class attached to),
  // so it replaces the placeholder container in the HTML rather than
  // binding to an existing input.
  const placeAutocomplete = new PlaceAutocompleteElement({
    includedRegionCodes: ["ph"],
  });
  placeAutocomplete.id = "addressSearchBox";
  placeAutocomplete.className = "map-search-input";
  const searchContainer = document.getElementById("addressSearchBoxContainer");
  searchContainer.innerHTML = "";
  searchContainer.appendChild(placeAutocomplete);

  placeAutocomplete.addEventListener("gmp-select", async ({ placePrediction }) => {
    try {
      const place = placePrediction.toPlace();
      await place.fetchFields({ fields: ["location", "formattedAddress"] });
      if (!place.location) return;
      const pos = toLatLngLiteral(place.location);
      map.setCenter(pos);
      map.setZoom(16);
      marker.position = pos;
      currentLat = pos.lat;
      currentLng = pos.lng;
      if (place.formattedAddress) {
        document.getElementById("addrAddress").value = place.formattedAddress;
      }
    } catch {
      // If fetching the selected place's details fails, the map/marker
      // stay wherever they were — the user can still drag/click manually.
    }
  });
}

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
  initAddressMap(savedLat, savedLng);

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

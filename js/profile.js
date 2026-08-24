// js/profile.js
// KalingaCare — Profile page: read-only account info, avatar upload,
// read-only address display, order history. Editing name/email/address/
// password/preferences all happens on settings.html instead — see
// js/settings.js.

import { auth, db } from "./firebase.js";
import {
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  doc,
  getDoc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import {
  loadGoogleMaps,
  GOOGLE_MAPS_API_KEY,
  HQ_LOCATION,
  DEMO_MAP_ID,
  resizeImageToDataUrl,
} from "./site.js";

const authGate = document.getElementById("authGate");
const profileContent = document.getElementById("profileContent");

const ROLE_LABELS = {
  user: "User",
  staff: "Staff",
  admin: "Admin",
  superadmin: "Super Admin",
};

function peso(amount) {
  return "\u20B1" + amount.toLocaleString("en-PH");
}

function initials(name) {
  return (name || "?")
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function showMsg(el, message, isError = true) {
  el.textContent = message;
  el.classList.add("show");
  if (!isError) setTimeout(() => el.classList.remove("show"), 3000);
}

let currentPhotoBase64 = null;

function renderAvatar(name, photoBase64) {
  currentPhotoBase64 = photoBase64 || null;
  const img = document.getElementById("avatarImg");
  const initialsText = document.getElementById("avatarInitialsText");
  if (photoBase64) {
    img.src = photoBase64;
    img.classList.remove("d-none");
    initialsText.classList.add("d-none");
  } else {
    img.classList.add("d-none");
    initialsText.classList.remove("d-none");
    initialsText.textContent = initials(name);
  }
}

function renderAddress(savedAddress) {
  const el = document.getElementById("addressDisplay");
  if (!savedAddress || !savedAddress.address) {
    el.innerHTML = `
      <p class="text-muted mb-0" style="font-size:0.88rem;">
        No saved address yet. <a href="settings.html">Add one now</a> so checkout can fill it in automatically.
      </p>`;
    return;
  }
  el.innerHTML = `
    <div class="info-field">
      <span class="info-label">Recipient</span>
      <span class="info-value">${savedAddress.recipient || "—"}</span>
    </div>
    <div class="info-field">
      <span class="info-label">Address</span>
      <span class="info-value">${savedAddress.address}</span>
    </div>
    <div class="info-field">
      <span class="info-label">Contact Number</span>
      <span class="info-value">${savedAddress.phone || "—"}</span>
    </div>`;
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    authGate.style.display = "block";
    profileContent.style.display = "none";
    return;
  }

  authGate.style.display = "none";
  profileContent.style.display = "block";

  const userSnap = await getDoc(doc(db, "users", user.uid));
  const userData = userSnap.exists() ? userSnap.data() : {};
  const role = userData.role || "user";
  const fullName = user.displayName || userData.fullName || "";

  document.getElementById("displayName").textContent = fullName || "—";
  document.getElementById("displayEmail").textContent = user.email || "—";
  renderAvatar(fullName, userData.photoBase64);
  renderAddress(userData.savedAddress);

  const badge = document.getElementById("roleBadge");
  badge.textContent = ROLE_LABELS[role] || "User";
  badge.classList.add(`role-${role}`);

  if (userData.createdAt?.toDate) {
    const date = userData.createdAt.toDate();
    document.getElementById("memberSince").textContent =
      "Member since " +
      date.toLocaleDateString("en-PH", { year: "numeric", month: "long" });
  }

  loadOrderHistory(user.uid);
});

async function loadOrderHistory(uid) {
  const list = document.getElementById("orderHistoryList");
  const noOrders = document.getElementById("noOrders");

  try {
    // Filtering by userId only (no orderBy) deliberately avoids needing a
    // Firestore composite index — sorting happens client-side instead.
    // Previously this used where()+orderBy() together, which silently
    // failed without an index and made orders never show up here at all.
    const q = query(collection(db, "orders"), where("userId", "==", uid));
    const snap = await getDocs(q);

    if (snap.empty) {
      noOrders.classList.remove("d-none");
      return;
    }

    const orders = snap.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
      .sort(
        (a, b) =>
          (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0),
      );

    const CANCELLABLE = ["pending", "processing"];

    list.innerHTML = orders
      .map((order) => {
        const date = order.createdAt?.toDate
          ? order.createdAt.toDate().toLocaleDateString("en-PH")
          : "";
        const statusClass = (order.status || "Pending").toLowerCase();
        const canCancel = CANCELLABLE.includes(statusClass);
        return `
          <div class="cart-item" style="align-items:flex-start; flex-direction:column;">
            <div class="cart-item-info w-100">
              <div class="d-flex justify-content-between align-items-center mb-1">
                <h5 class="mb-0">Order #${order.id.slice(0, 8).toUpperCase()}</h5>
                <span class="status-badge status-${statusClass}">${order.status || "Pending"}</span>
              </div>
              <p class="text-muted mb-1" style="font-size:0.85rem;">${date} &middot; ${order.items.length} item${order.items.length > 1 ? "s" : ""}</p>
              <p class="cart-item-price mb-0">${peso(order.total)}</p>
              <div class="d-flex gap-3 mt-2">
                <button type="button" class="remove-item track-order-btn" data-id="${order.id}" style="color: var(--primary);">
                  <i class="bi bi-truck"></i> Track Order
                </button>
                ${canCancel ? `<button type="button" class="remove-item cancel-order-btn" data-id="${order.id}"><i class="bi bi-x-circle"></i> Cancel Order</button>` : ""}
              </div>
              <div class="tracking-panel d-none" id="tracking-${order.id}"></div>
            </div>
          </div>`;
      })
      .join("");

    window.__ordersById = Object.fromEntries(orders.map((o) => [o.id, o]));
  } catch (err) {
    list.innerHTML = `<p class="text-muted">Couldn't load order history right now. Please try again later.</p>`;
  }
}

const STATUS_STEPS = ["Pending", "Processing", "Shipped", "Delivered"];

function renderTrackerStepper(status) {
  if (status === "Cancelled") {
    return `<div class="tracker-cancelled"><i class="bi bi-x-circle"></i> This order was cancelled.</div>`;
  }
  const currentIndex = STATUS_STEPS.indexOf(status);
  return `
    <div class="tracker-steps">
      ${STATUS_STEPS.map((step, i) => {
        const state =
          i < currentIndex ? "done" : i === currentIndex ? "done current" : "";
        const icon =
          i === 0
            ? "bi-receipt"
            : i === 1
              ? "bi-box-seam"
              : i === 2
                ? "bi-truck"
                : "bi-house-check";
        return `
          <div class="tracker-step ${state}">
            <div class="tracker-dot"><i class="bi ${icon}"></i></div>
            <div class="tracker-label">${step}</div>
          </div>`;
      }).join("")}
    </div>`;
}

async function renderTrackingMap(containerId, destLat, destLng) {
  const el = document.getElementById(containerId);
  if (!el) return;

  if (
    !GOOGLE_MAPS_API_KEY ||
    GOOGLE_MAPS_API_KEY === "YOUR_GOOGLE_MAPS_API_KEY"
  ) {
    el.innerHTML = `<div class="map-placeholder">Map needs a Google Maps API key (see js/site.js).</div>`;
    return;
  }
  if (destLat == null || destLng == null) {
    el.innerHTML = `<div class="map-placeholder">No saved location for this order (placed before the address picker was added, or address wasn't pinned on a map).</div>`;
    return;
  }

  let googleMaps, AdvancedMarkerElement, PinElement;
  try {
    googleMaps = await loadGoogleMaps();
    ({ AdvancedMarkerElement, PinElement } =
      await googleMaps.importLibrary("marker"));
  } catch (err) {
    console.error("KalingaCare Maps error:", err);
    el.innerHTML = `<div class="map-placeholder">Couldn't load the map right now.</div>`;
    return;
  }

  const origin = { lat: HQ_LOCATION.lat, lng: HQ_LOCATION.lng };
  const destination = { lat: destLat, lng: destLng };

  const bounds = new googleMaps.LatLngBounds();
  bounds.extend(origin);
  bounds.extend(destination);

  const map = new googleMaps.Map(el, {
    mapId: DEMO_MAP_ID, // required for AdvancedMarkerElement to render at all
    streetViewControl: false,
    mapTypeControl: false,
  });
  map.fitBounds(bounds, 40);

  // Blue pin for HQ, so it's visually distinct from the (default red)
  // destination pin — AdvancedMarkerElement customizes color via a
  // PinElement passed as `content`, unlike the old icon-URL approach.
  const hqPin = new PinElement({
    background: "#4285F4",
    borderColor: "#1a5fb4",
    glyphColor: "#ffffff",
  });
  new AdvancedMarkerElement({
    position: origin,
    map,
    title: HQ_LOCATION.name,
    content: hqPin.element,
  });
  new AdvancedMarkerElement({
    position: destination,
    map,
    title: "Delivery destination",
  });

  new googleMaps.Polyline({
    path: [origin, destination],
    geodesic: true,
    strokeColor: "#67c8f7",
    strokeOpacity: 0.8,
    strokeWeight: 3,
    map,
  });
}

// Event delegation, since order cards are re-rendered on every load/cancel.
document
  .getElementById("orderHistoryList")
  .addEventListener("click", async (e) => {
    const trackBtn = e.target.closest(".track-order-btn");
    if (trackBtn) {
      const orderId = trackBtn.dataset.id;
      const panel = document.getElementById(`tracking-${orderId}`);
      const order = window.__ordersById?.[orderId];

      if (panel.classList.contains("d-none")) {
        panel.classList.remove("d-none");
        trackBtn.innerHTML = '<i class="bi bi-chevron-up"></i> Hide Tracking';
        if (!panel.dataset.loaded) {
          panel.dataset.loaded = "true";
          panel.innerHTML =
            renderTrackerStepper(order?.status || "Pending") +
            `<div class="tracking-map mt-3" id="trackmap-${orderId}"></div>`;
          renderTrackingMap(
            `trackmap-${orderId}`,
            order?.shippingInfo?.lat,
            order?.shippingInfo?.lng,
          );
        }
      } else {
        panel.classList.add("d-none");
        trackBtn.innerHTML = '<i class="bi bi-truck"></i> Track Order';
      }
      return;
    }

    const btn = e.target.closest(".cancel-order-btn");
    if (!btn) return;

    if (!confirm("Cancel this order? This can't be undone.")) return;

    btn.disabled = true;
    btn.textContent = "Cancelling...";

    try {
      await updateDoc(doc(db, "orders", btn.dataset.id), {
        status: "Cancelled",
      });
      loadOrderHistory(auth.currentUser.uid);
    } catch (err) {
      alert("Couldn't cancel this order. Please try again.");
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-x-circle"></i> Cancel Order';
    }
  });

/* ===== Avatar upload =====
   Uses the shared resizeImageToDataUrl from site.js (see that file for why
   this is base64-in-Firestore rather than Firebase Storage). */

document.getElementById("avatarEditBtn").addEventListener("click", () => {
  document.getElementById("avatarUpload").click();
});

document
  .getElementById("avatarUpload")
  .addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const errorEl = document.getElementById("profileError");
    errorEl.classList.remove("show");

    if (!file.type.startsWith("image/")) {
      showMsg(errorEl, "Please choose an image file.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      showMsg(errorEl, "Image is too large (max 8MB before resizing).");
      return;
    }

    try {
      const dataUrl = await resizeImageToDataUrl(file);
      await updateDoc(doc(db, "users", auth.currentUser.uid), {
        photoBase64: dataUrl,
      });
      renderAvatar(auth.currentUser.displayName, dataUrl);
    } catch (err) {
      showMsg(errorEl, err.message || "Couldn't update photo.");
    }
  });

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "index.html";
});

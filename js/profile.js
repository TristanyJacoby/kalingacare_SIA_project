// js/profile.js
// KalingaCare — Profile page: read-only account info, avatar upload,
// read-only address display, order history. Editing name/email/address/
// password/preferences all happens on settings.html instead — see
// js/settings.js.

import { auth, db } from "./firebase.js";
import { startOnlinePayment, updateOrder, manageReturn, PAYMENT_CHANNEL_LABELS } from "./payments.js";
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
  loadStoreSettings,
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
  document.getElementById("displayCountry").textContent = userData.country || "—";
  renderAvatar(fullName, userData.photoBase64);
  renderAddress(userData.savedAddress);

  const favoritesCount = (userData.favorites || []).length;
  document.getElementById("favoritesCountSummary").textContent =
    favoritesCount === 0
      ? "No saved items yet."
      : `${favoritesCount} saved item${favoritesCount === 1 ? "" : "s"}.`;

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

    // Which order+product combos this user has already reviewed — matches
    // mobile's MyOrders.tsx exactly, including the "orderId:productId" key
    // shape, since reviews are create-only (see firestore-reviews-schema)
    // and this client-side check is the only place a duplicate "Leave a
    // Review" gets prevented.
    const reviewsSnap = await getDocs(
      query(collection(db, "reviews"), where("userId", "==", uid)),
    );
    const reviewedKeys = new Set(
      reviewsSnap.docs.map((d) => `${d.data().orderId}:${d.data().productId}`),
    );

    const CANCELLABLE = ["new", "pending", "processing"];

    // Returns this customer has asked for, by order, and the return window.
    const returnsByOrder = {};
    try {
      const rs = await getDocs(query(collection(db, "returns"), where("userId", "==", uid)));
      rs.docs.forEach((d) => {
        const r = { id: d.id, ...d.data() };
        if (r.status !== "Cancelled") returnsByOrder[r.orderId] = r;
      });
    } catch (err) {
      console.warn("Couldn't load returns:", err);
    }
    const { returnWindowDays } = await loadStoreSettings();
    window.__returnsByOrder = returnsByOrder;

    list.innerHTML = orders
      .map((order) => {
        const date = order.createdAt?.toDate
          ? order.createdAt.toDate().toLocaleDateString("en-PH")
          : "";
        const statusClass = (order.status || "Pending").toLowerCase();
        // Online orders: unpaid ones can be paid from here; paid ones can't
        // be self-cancelled, since refunds go through the store.
        const isOnline = order.shippingInfo?.paymentMethod === "online";
        const isPaid = isOnline && order.paymentStatus === "paid";
        const canCancel = CANCELLABLE.includes(statusClass) && !isPaid;
        const canPay = isOnline && !isPaid && statusClass !== "cancelled";
        const channel = PAYMENT_CHANNEL_LABELS[order.payment?.channel];
        const paymentPill = !isOnline
          ? `<span class="payment-pill cod">Cash on Delivery</span>`
          : isPaid
            ? `<span class="payment-pill paid">Paid${channel ? ` · ${channel}` : ""}</span>`
            : statusClass === "cancelled"
              ? `<span class="payment-pill cod">Not paid</span>`
              : `<span class="payment-pill pending">Payment pending</span>`;
        // Customers see "Pending" even when the real status is "New" —
        // that distinction is purely about whether staff has opened the
        // order yet, which isn't something a customer needs to know.
        // Keeps this badge consistent with the tracker below it, which
        // does the same normalization.
        const isNew = statusClass === "new";
        const displayStatus = isNew ? "Pending" : order.status || "Pending";
        const displayClass = isNew ? "pending" : statusClass;
        const isDelivered = displayStatus === "Delivered";

        // Only shown for delivered orders — matches mobile's MyOrders,
        // where "Leave a Review" only ever appears per item once an order
        // reaches that status, since reviewing requires actually having
        // received the product.
        const itemRows = isDelivered
          ? `<div class="mt-2 pt-2" style="border-top: 1px solid var(--line)">
              ${order.items
                .map((item) => {
                  const reviewed = reviewedKeys.has(`${order.id}:${item.id}`);
                  return `
                  <div class="d-flex justify-content-between align-items-center mb-1" style="font-size: 0.85rem">
                    <span>${item.name} &times; ${item.qty}</span>
                    ${
                      reviewed
                        ? `<span class="text-muted"><i class="bi bi-check-circle"></i> Reviewed</span>`
                        : `<a href="review.html?orderId=${order.id}&productId=${item.id}" style="color: var(--primary-text); font-weight: 600; text-decoration: none;">Leave a Review</a>`
                    }
                  </div>`;
                })
                .join("")}
            </div>`
          : "";

        return `
          <div class="cart-item" style="align-items:flex-start; flex-direction:column;"
               data-order-card
               data-status="${displayClass}"
               data-date="${order.createdAt?.toDate ? localDay(order.createdAt.toDate()) : ""}"
               data-search="${escapeAttr(`${order.id} ${order.invoiceNo || ""} ${order.items.map((i) => i.name).join(" ")}`.toLowerCase())}">
            <div class="cart-item-info w-100">
              <div class="d-flex justify-content-between align-items-center mb-1">
                <h5 class="mb-0">Order #${order.id.slice(0, 8).toUpperCase()}${order.invoiceNo ? ` <small class="text-muted" style="font-size:0.75rem;font-weight:500">${order.invoiceNo}</small>` : ""}</h5>
                <span class="status-badge status-${displayClass}">${displayStatus}</span>
              </div>
              <p class="text-muted mb-1" style="font-size:0.85rem;">${date} &middot; ${order.items.length} item${order.items.length > 1 ? "s" : ""}</p>
              <p class="cart-item-price mb-0">${peso(order.total)} ${paymentPill}</p>
              <div class="d-flex gap-3 mt-2 flex-wrap">
                ${canPay ? `<button type="button" class="remove-item pay-order-btn" data-id="${order.id}" style="color: var(--dark); font-weight: 600;"><i class="bi bi-credit-card"></i> Pay now</button>` : ""}
                <button type="button" class="remove-item track-order-btn" data-id="${order.id}" style="color: var(--primary-text);">
                  <i class="bi bi-truck"></i> Track Order
                </button>
                <a class="remove-item" href="invoice.html?id=${order.id}" target="_blank" rel="noopener" style="color: var(--primary-text); text-decoration: none;">
                  <i class="bi bi-receipt"></i> Invoice
                </a>
                ${canCancel ? `<button type="button" class="remove-item cancel-order-btn" data-id="${order.id}"><i class="bi bi-x-circle"></i> Cancel Order</button>` : ""}
              </div>
              ${returnBlock(order, returnsByOrder[order.id], returnWindowDays)}
              <div class="tracking-panel d-none" id="tracking-${order.id}"></div>
              ${itemRows}
            </div>
          </div>`;
      })
      .join("");

    window.__ordersById = Object.fromEntries(orders.map((o) => [o.id, o]));
    document.getElementById("orderFilters").classList.remove("d-none");
    applyOrderFilters();
  } catch (err) {
    list.innerHTML = `<p class="text-muted">Couldn't load order history right now. Please try again later.</p>`;
  }
}

function localDay(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function escapeAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

// Search / status / date filters over the order cards already on the page.
function applyOrderFilters() {
  const term = document.getElementById("orderFilterSearch").value.trim().toLowerCase();
  const status = document.getElementById("orderFilterStatus").value;
  const from = document.getElementById("orderFilterFrom").value;
  const to = document.getElementById("orderFilterTo").value;
  const cards = [...document.querySelectorAll("#orderHistoryList [data-order-card]")];
  let shown = 0;
  cards.forEach((card) => {
    const date = card.dataset.date;
    const ok =
      (!term || card.dataset.search.includes(term)) &&
      (status === "all" || card.dataset.status === status) &&
      (!from || (date && date >= from)) &&
      (!to || (date && date <= to));
    card.classList.toggle("d-none", !ok);
    if (ok) shown += 1;
  });
  document.getElementById("orderFilterEmpty").classList.toggle("d-none", shown > 0 || cards.length === 0);
}

["orderFilterSearch", "orderFilterStatus", "orderFilterFrom", "orderFilterTo"].forEach((id) =>
  document.getElementById(id).addEventListener("input", applyOrderFilters),
);
document.getElementById("orderFilterClear").addEventListener("click", () => {
  document.getElementById("orderFilterSearch").value = "";
  document.getElementById("orderFilterStatus").value = "all";
  document.getElementById("orderFilterFrom").value = "";
  document.getElementById("orderFilterTo").value = "";
  applyOrderFilters();
});

/* ===== Returns and refunds =====
   A delivered order can be returned within the return window (Admin >
   Settings). The server enforces it; this only decides what to show. */
const RETURN_STATUS_TEXT = {
  Requested: ["Return requested", "We're reviewing your request. We'll email you."],
  Approved: ["Return approved", "We'll refund you once the items reach us."],
  Refunding: ["Refund in progress", "Your refund is being issued."],
  Rejected: ["Return declined", ""],
  Refunded: ["Refunded", ""],
};

function returnBlock(order, ret, windowDays) {
  const delivered = (order.status || "") === "Delivered";
  if (ret) {
    const [label, hint] = RETURN_STATUS_TEXT[ret.status] || [ret.status, ""];
    const detail =
      ret.status === "Refunded"
        ? `${peso(ret.refundAmount)} refunded${ret.refundMode === "paymongo" ? " to your original payment method" : ""}.`
        : ret.status === "Rejected"
          ? ret.staffNote || ""
          : hint;
    return `
      <div class="return-note return-${ret.status.toLowerCase()}">
        <strong><i class="bi bi-arrow-return-left"></i> ${label}</strong>
        ${detail ? `<span>${escapeAttr(detail)}</span>` : ""}
        ${ret.status === "Requested" ? `<button type="button" class="remove-item withdraw-return-btn" data-return="${ret.id}">Withdraw request</button>` : ""}
      </div>`;
  }
  if (!delivered || windowDays <= 0) return "";
  const since = (order.statusUpdatedAt || order.createdAt)?.toMillis?.();
  if (since && (Date.now() - since) / 86400000 > windowDays) return "";
  return `<div class="mt-2"><button type="button" class="remove-item request-return-btn" data-id="${order.id}" style="color: var(--primary-text);"><i class="bi bi-arrow-return-left"></i> Request a Return</button></div>`;
}

const returnModalEl = document.getElementById("returnModal");
const returnModal = returnModalEl ? new bootstrap.Modal(returnModalEl) : null;

document.getElementById("orderHistoryList").addEventListener("click", async (e) => {
  const openBtn = e.target.closest(".request-return-btn");
  if (openBtn) {
    const order = window.__ordersById?.[openBtn.dataset.id];
    if (!order) return;
    document.getElementById("rtOrderId").value = order.id;
    document.getElementById("rtItems").innerHTML = order.items
      .map(
        (i, n) => `
        <label class="d-flex gap-2 align-items-start mb-1" style="font-size:0.9rem">
          <input type="checkbox" class="rt-item" value="${escapeAttr(i.id)}" checked />
          <span>${escapeAttr(i.name)} &times; ${i.qty}</span>
        </label>`,
      )
      .join("");
    document.getElementById("rtReason").value = "";
    document.getElementById("rtNote").value = "";
    document.getElementById("rtError").classList.remove("show");
    returnModal.show();
    return;
  }
  const withdrawBtn = e.target.closest(".withdraw-return-btn");
  if (withdrawBtn) {
    if (!confirm("Withdraw your return request?")) return;
    withdrawBtn.disabled = true;
    try {
      await manageReturn({ action: "cancel", returnId: withdrawBtn.dataset.return });
      loadOrderHistory(auth.currentUser.uid);
    } catch (err) {
      alert(err.message);
      withdrawBtn.disabled = false;
    }
  }
});

document.getElementById("returnForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("rtError");
  errorEl.classList.remove("show");
  const itemIds = [...document.querySelectorAll(".rt-item:checked")].map((b) => b.value);
  if (!itemIds.length) {
    errorEl.textContent = "Choose at least one item to return.";
    errorEl.classList.add("show");
    return;
  }
  const btn = document.getElementById("rtSubmit");
  btn.disabled = true;
  btn.textContent = "Sending...";
  try {
    await manageReturn({
      action: "request",
      orderId: document.getElementById("rtOrderId").value,
      itemIds,
      reason: document.getElementById("rtReason").value,
      note: document.getElementById("rtNote").value.trim(),
    });
    returnModal.hide();
    loadOrderHistory(auth.currentUser.uid);
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.add("show");
  }
  btn.disabled = false;
  btn.textContent = "Send Return Request";
});

const STATUS_STEPS = ["Pending", "Processing", "Shipped", "Delivered"];

function renderTrackerStepper(status) {
  if (status === "Cancelled") {
    return `<div class="tracker-cancelled"><i class="bi bi-x-circle"></i> This order was cancelled.</div>`;
  }
  // "New" vs "Pending" is an internal staff-viewed/unviewed distinction —
  // the customer doesn't need to see that difference, so it's treated as
  // Pending here. Without this, a fresh order (status "New") would fall
  // through indexOf() to -1 and render a broken/blank tracker until staff
  // opens it in Admin Orders.
  const displayStatus = status === "New" ? "Pending" : status;
  const currentIndex = STATUS_STEPS.indexOf(displayStatus);
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

    const payBtn = e.target.closest(".pay-order-btn");
    if (payBtn) {
      payBtn.disabled = true;
      payBtn.textContent = "Opening secure payment...";
      try {
        await startOnlinePayment(payBtn.dataset.id);
      } catch (err) {
        alert(err.message);
        payBtn.disabled = false;
        payBtn.innerHTML = '<i class="bi bi-credit-card"></i> Pay now';
      }
      return;
    }

    const btn = e.target.closest(".cancel-order-btn");
    if (!btn) return;

    if (!confirm("Cancel this order? This can't be undone.")) return;

    btn.disabled = true;
    btn.textContent = "Cancelling...";

    try {
      await updateOrder(btn.dataset.id, "cancel");
      loadOrderHistory(auth.currentUser.uid);
    } catch (err) {
      alert(err.message || "Couldn't cancel this order. Please try again.");
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

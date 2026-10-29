// js/checkout.js
// KalingaCare — Checkout page: auth gate, order summary, places the order.

import { auth, db } from "./firebase.js";
import { loadCart, clearCart, SHIPPING_FEE, accountCartReady } from "./site.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  doc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import {
  getRates,
  convertAndFormat,
  populateCurrencySelect,
} from "./currency.js";
import { startOnlinePayment } from "./payments.js";
import { sendVerificationEmail, TooSoonError } from "./verification.js";
import { initAddressPicker } from "./address-map.js";
import { getSavedAddresses, defaultAddress } from "./site.js";

const authGate = document.getElementById("authGate");
const staffGate = document.getElementById("staffGate");
const emptyGate = document.getElementById("emptyGate");
const verifyGate = document.getElementById("verifyGate");
const successGate = document.getElementById("successGate");
const checkoutContent = document.getElementById("checkoutContent");

function peso(amount) {
  return "\u20B1" + amount.toLocaleString("en-PH");
}

function hideAllGates() {
  authGate.style.display = "none";
  staffGate.style.display = "none";
  emptyGate.style.display = "none";
  verifyGate.style.display = "none";
  successGate.style.display = "none";
  checkoutContent.style.display = "none";
}

let currentTotalPHP = 0;

function renderSummary(cart) {
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  document.getElementById("ckItemsSummary").innerHTML = cart
    .map(
      (item) => `
      <div class="summary-row">
        <span>${item.name} &times; ${item.qty}</span>
        <span>${peso(item.price * item.qty)}</span>
      </div>`,
    )
    .join("");
  document.getElementById("ckSubtotal").textContent = peso(subtotal);
  document.getElementById("ckShipping").textContent = peso(SHIPPING_FEE);
  currentTotalPHP = subtotal + SHIPPING_FEE;
  document.getElementById("ckTotal").textContent = peso(currentTotalPHP);
  updateConvertedDisplay();
  return subtotal;
}

// Display-only: converts currentTotalPHP into whatever currency is picked
// in #ckCurrency and shows it under the real (PHP) total. Never touches
// the actual order amount — see the note on #ckConvertedRow in checkout.html.
async function updateConvertedDisplay() {
  const currencySelect = document.getElementById("ckCurrency");
  const convertedRow = document.getElementById("ckConvertedRow");
  if (!currencySelect) return;

  const code = currencySelect.value;
  if (!code || code === "PHP") {
    convertedRow.style.display = "none";
    return;
  }

  document.getElementById("ckCurrencyLabel").textContent = code;
  convertedRow.style.display = "flex";
  document.getElementById("ckConvertedTotal").textContent = "…";

  const { rates, liveCodes } = await getRates();
  document.getElementById("ckConvertedTotal").textContent = convertAndFormat(
    currentTotalPHP,
    code,
    rates,
  );
  // Gulf currencies (SAR/AED/QAR/KWD/BHD/OMR) and a few others aren't
  // published by the live rate source at all — be upfront that those are
  // an estimate rather than implying every currency here is live.
  document.getElementById("ckRateNote").textContent = liveCodes.includes(code)
    ? "Live exchange rate."
    : "Estimated rate — live data isn't available for this currency.";
}

document
  .getElementById("ckCurrency")
  .addEventListener("change", updateConvertedDisplay);

let currentUser = null;
// Exact delivery pin for this order: starts from the saved address and
// changes whenever the buyer moves the pin on the checkout map.
let deliveryCoords = { lat: null, lng: null };

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  hideAllGates();

  if (!user) {
    authGate.style.display = "block";
    return;
  }

  // Internal accounts (staff/admin/superadmin) don't place real orders —
  // keeps sales data accurate to actual customers. Checked here, not just
  // on the Add to Cart button, so a cart built before a role change (or
  // direct navigation to this page) is still blocked at the actual
  // order-creating step.
  const roleSnap = await getDoc(doc(db, "users", user.uid));
  const role = roleSnap.exists() ? roleSnap.data().role || "user" : "user";
  if (["staff", "admin", "superadmin"].includes(role)) {
    staffGate.style.display = "block";
    return;
  }

  // The cart lives on the account (shared with the app); wait for it.
  await accountCartReady;
  const cart = loadCart();
  if (cart.length === 0) {
    emptyGate.style.display = "block";
    return;
  }

  // The link may have been opened in another tab since this page's
  // session started, so refresh before deciding.
  if (!user.emailVerified) {
    await user.reload().catch(() => {});
    // Just verified: get a fresh ID token so the Firestore rule that checks
    // email_verified sees it when the order is written.
    if (auth.currentUser.emailVerified)
      await auth.currentUser.getIdToken(true).catch(() => {});
  }
  if (!auth.currentUser.emailVerified) {
    document.getElementById("verifyEmail").textContent =
      user.email || "your email";
    verifyGate.style.display = "block";
    return;
  }

  checkoutContent.style.display = "block";

  // Default the "show total in" picker to the buyer's own currency (set at
  // registration or in Settings) rather than always starting on PHP —
  // that's the whole point of asking for their country up front.
  const userData = roleSnap.exists() ? roleSnap.data() : {};
  populateCurrencySelect(
    document.getElementById("ckCurrency"),
    userData.currency || "PHP",
  );

  renderSummary(cart);

  document.getElementById("ckName").value = user.displayName || "";
  document.getElementById("ckEmail").value = user.email || "";

  // Pre-fill from the default saved address (same list as the app). With
  // more than one, "Deliver to" switches between them. Editing the fields
  // changes only this order, not the saved addresses.
  const addresses = getSavedAddresses(userData);
  const fillFrom = (a) => {
    document.getElementById("ckRecipient").value = a?.recipient || "";
    document.getElementById("ckAddress").value = a?.address || "";
    document.getElementById("ckPhone").value = a?.phone || "";
    deliveryCoords = { lat: a?.lat ?? null, lng: a?.lng ?? null };
  };
  const startAddress = defaultAddress(addresses);
  if (startAddress) fillFrom(startAddress);

  // "Deliver to": any saved address, or "Someone else" to pick a spot on
  // the map for a recipient who isn't saved.
  const choice = document.getElementById("ckAddressChoice");
  const OTHER = "__other__";
  if (addresses.length > 0) {
    const esc = (t) =>
      String(t || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;");
    choice.innerHTML =
      addresses
        .map(
          (a) =>
            `<option value="${esc(a.id)}">${esc(a.label || "Address")}: ${esc(a.recipient)}</option>`,
        )
        .join("") +
      `<option value="${OTHER}">Others (pick on the map)</option>`;
    choice.value = startAddress.id;
    document.getElementById("ckAddressChoiceWrap").hidden = false;
    choice.onchange = () => {
      if (choice.value === OTHER) {
        fillFrom(null);
        document.getElementById("ckRecipient").focus();
        return;
      }
      const a = addresses.find((x) => x.id === choice.value);
      fillFrom(a);
      if (a?.lat != null) checkoutMap?.setPosition(a.lat, a.lng);
    };
  }

  let checkoutMap = null;
  initAddressPicker({
    mapEl: document.getElementById("ckAddressMap"),
    searchContainer: document.getElementById("ckAddressSearch"),
    addressInput: document.getElementById("ckAddress"),
    lat: deliveryCoords.lat,
    lng: deliveryCoords.lng,
    onChange: (pos) => {
      deliveryCoords = pos;
    },
  }).then((p) => {
    checkoutMap = p;
    // Without a working map there'd be no way to fill the address in.
    if (!p) document.getElementById("ckAddress").readOnly = false;
  });
});

/* ===== Email verification gate ===== */
const verifyError = document.getElementById("verifyError");
const verifyInfo = document.getElementById("verifyInfo");

document
  .getElementById("verifyCheckBtn")
  .addEventListener("click", async () => {
    const btn = document.getElementById("verifyCheckBtn");
    verifyError.classList.remove("show");
    verifyInfo.textContent = "";
    verifyInfo.classList.remove("show");
    btn.disabled = true;
    try {
      await auth.currentUser.reload();
      if (auth.currentUser.emailVerified) {
        // New ID token, so Firestore rules see email_verified = true.
        await auth.currentUser.getIdToken(true);
        window.location.reload();
        return;
      }
      verifyError.textContent =
        "Your email isn't verified yet. Open the link in the email we sent, then try again.";
      verifyError.classList.add("show");
    } catch {
      verifyError.textContent = "Couldn't check right now. Please try again.";
      verifyError.classList.add("show");
    }
    btn.disabled = false;
  });

document
  .getElementById("verifyResendBtn")
  .addEventListener("click", async () => {
    const btn = document.getElementById("verifyResendBtn");
    verifyError.classList.remove("show");
    verifyInfo.textContent = "";
    verifyInfo.classList.remove("show");
    btn.disabled = true;
    try {
      await sendVerificationEmail(auth.currentUser);
      verifyInfo.textContent = `New link sent to ${auth.currentUser.email}.`;
      verifyInfo.classList.add("show");
    } catch (err) {
      verifyError.textContent =
        err instanceof TooSoonError || err.code === "auth/too-many-requests"
          ? "A link was sent recently. Please wait a minute before asking for another."
          : "Couldn't send the email right now. Please try again.";
      verifyError.classList.add("show");
    }
    btn.disabled = false;
  });

// Shows the PayMongo / test-mode note only when paying online.
const paymentSelect = document.getElementById("ckPayment");
const paymentNote = document.getElementById("ckPaymentNote");
paymentSelect.addEventListener("change", () => {
  paymentNote.hidden = paymentSelect.value !== "online";
});

document
  .getElementById("checkoutForm")
  .addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentUser) return;

    const cart = loadCart();
    if (cart.length === 0) return;

    const errorBox0 = document.getElementById("checkoutError");
    if (!document.getElementById("ckAddress").value.trim()) {
      errorBox0.textContent = "Please pick the delivery location on the map.";
      errorBox0.classList.add("show");
      return;
    }

    const submitBtn = document.getElementById("placeOrderBtn");
    const errorBox = document.getElementById("checkoutError");
    errorBox.classList.remove("show");
    submitBtn.disabled = true;
    submitBtn.textContent = "Placing order...";

    // Record what currency the buyer was viewing at order time, purely
    // for admin/support context — the canonical subtotal/shippingFee/total
    // above stay PHP no matter what's picked here (see the note on
    // #ckConvertedRow in checkout.html: this is a display conversion,
    // not a real multi-currency charge).
    const displayCurrency = document.getElementById("ckCurrency").value;
    const paymentMethod = document.getElementById("ckPayment").value;
    const payOnline = paymentMethod === "online";
    let orderRef = null;
    let leavingPage = false;

    try {
      // The server creates the order and works out the prices and total
      // from the product records (api/place-order.js), so they can't be
      // changed in the browser. Only the server marks online orders paid.
      const res = await fetch("/api/place-order", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${await currentUser.getIdToken()}`,
        },
        body: JSON.stringify({
          items: cart.map((item) => ({ id: item.id, qty: item.qty })),
          paymentMethod,
          displayCurrency,
          shippingInfo: {
            fullName: document.getElementById("ckName").value.trim(),
            email: document.getElementById("ckEmail").value.trim(),
            recipient: document.getElementById("ckRecipient").value.trim(),
            address: document.getElementById("ckAddress").value.trim(),
            phone: document.getElementById("ckPhone").value.trim(),
            note: document.getElementById("ckNote").value.trim(),
            lat: deliveryCoords.lat,
            lng: deliveryCoords.lng,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "");
      orderRef = { id: data.orderId };

      clearCart();

      if (payOnline) {
        submitBtn.textContent = "Opening secure payment...";
        leavingPage = true;
        await startOnlinePayment(orderRef.id);
        return; // the browser is leaving for PayMongo's page
      }

      hideAllGates();
      successGate.style.display = "block";
    } catch (err) {
      if (orderRef && payOnline) {
        // The order exists but the payment page couldn't open. It stays
        // "Payment pending" and can be paid from My Orders.
        leavingPage = true;
        window.location.href = `payment-return.html?order=${orderRef.id}&failed=1`;
        return;
      }
      errorBox.textContent =
        (!(err instanceof TypeError) && err.message) ||
        "Something went wrong placing your order. Please try again.";
      errorBox.classList.add("show");
    } finally {
      if (!leavingPage) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Place Order";
      }
    }
  });

/* ===== Three steps: Shipping > Payment > Review ===== */
const checkoutForm = document.getElementById("checkoutForm");
let ckStep = 1;

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function showStep(n) {
  ckStep = n;
  checkoutForm.querySelectorAll(".ck-step").forEach((el) => {
    el.hidden = Number(el.dataset.step) !== n;
  });
  document.querySelectorAll("#ckStepper li").forEach((li) => {
    const i = Number(li.dataset.stepper);
    li.classList.toggle("active", i === n);
    li.classList.toggle("done", i < n);
    if (i === n) li.setAttribute("aria-current", "step");
    else li.removeAttribute("aria-current");
  });
  if (n === 3) renderReview();
  checkoutForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderReview() {
  const val = (id) => document.getElementById(id).value.trim();
  const online = document.getElementById("ckPayment").value === "online";
  const rows = [
    [1, "Billed to", `${escapeHtml(val("ckName"))}<br>${escapeHtml(val("ckEmail"))}`],
    [
      1,
      "Deliver to",
      `${escapeHtml(val("ckRecipient"))}<br>${escapeHtml(val("ckAddress"))}<br>${escapeHtml(val("ckPhone"))}` +
        (val("ckNote") ? `<br><em>Driver note: ${escapeHtml(val("ckNote"))}</em>` : ""),
    ],
    [2, "Payment", online ? "Pay online (card, GCash or Maya)" : "Cash on Delivery"],
  ];
  document.getElementById("ckReview").innerHTML = rows
    .map(
      ([step, label, html]) => `
      <div class="ck-review-row">
        <div><p class="ck-review-label">${label}</p><p>${html}</p></div>
        <button type="button" class="ck-edit-btn" data-ck-goto="${step}">Edit</button>
      </div>`,
    )
    .join("");
}

// Step 1 must be complete before moving on. The address box is read-only
// (filled from the map), so the browser's own check skips it.
function step1Valid() {
  const errorBox = document.getElementById("ckStep1Error");
  errorBox.classList.remove("show");
  const fields = checkoutForm.querySelectorAll('.ck-step[data-step="1"] [required]:not([readonly])');
  for (const field of fields) {
    if (field.offsetParent !== null && !field.reportValidity()) return false;
  }
  if (!document.getElementById("ckAddress").value.trim()) {
    errorBox.textContent = "Please pick the delivery location on the map.";
    errorBox.classList.add("show");
    return false;
  }
  return true;
}

checkoutForm.addEventListener("click", (e) => {
  if (e.target.closest("[data-ck-next]")) {
    if (ckStep === 1 && !step1Valid()) return;
    showStep(ckStep + 1);
  } else if (e.target.closest("[data-ck-back]")) {
    showStep(ckStep - 1);
  } else {
    const goto = e.target.closest("[data-ck-goto]");
    if (goto) showStep(Number(goto.dataset.ckGoto));
  }
});

// Enter inside an earlier step moves on instead of placing the order.
checkoutForm.addEventListener(
  "submit",
  (e) => {
    if (ckStep === 3) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (ckStep === 1 && !step1Valid()) return;
    showStep(ckStep + 1);
  },
  true,
);

// js/checkout.js
// KalingaCare — Checkout page: auth gate, order summary, places the order.

import { auth, db } from "./firebase.js";
import { loadCart, clearCart, SHIPPING_FEE } from "./site.js";
import {
  onAuthStateChanged,
  sendEmailVerification,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  collection,
  addDoc,
  doc,
  getDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getRates, convertAndFormat, populateCurrencySelect } from "./currency.js";
import { startOnlinePayment } from "./payments.js";

// Where the email-verification link returns to. Firebase only accepts
// authorized domains, so preview deployments fall back to the live site.
const VERIFY_RETURN_URL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(window.location.origin)
  ? `${window.location.origin}/email-verified.html`
  : "https://kalingacare-drab.vercel.app/email-verified.html";

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
let savedAddressCoords = { lat: null, lng: null };

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
    if (auth.currentUser.emailVerified) await auth.currentUser.getIdToken(true).catch(() => {});
  }
  if (!auth.currentUser.emailVerified) {
    document.getElementById("verifyEmail").textContent = user.email || "your email";
    verifyGate.style.display = "block";
    return;
  }

  checkoutContent.style.display = "block";

  // Default the "show total in" picker to the buyer's own currency (set at
  // registration or in Settings) rather than always starting on PHP —
  // that's the whole point of asking for their country up front.
  const userData = roleSnap.exists() ? roleSnap.data() : {};
  populateCurrencySelect(document.getElementById("ckCurrency"), userData.currency || "PHP");

  renderSummary(cart);

  document.getElementById("ckName").value = user.displayName || "";
  document.getElementById("ckEmail").value = user.email || "";

  // Pre-fill from the saved delivery address on the user's profile, if any.
  getDoc(doc(db, "users", user.uid)).then((snap) => {
    const savedAddress = snap.exists() ? snap.data().savedAddress : null;
    if (savedAddress) {
      document.getElementById("ckRecipient").value =
        savedAddress.recipient || "";
      document.getElementById("ckAddress").value = savedAddress.address || "";
      document.getElementById("ckPhone").value = savedAddress.phone || "";
      savedAddressCoords = {
        lat: savedAddress.lat ?? null,
        lng: savedAddress.lng ?? null,
      };
    }
  });
});

/* ===== Email verification gate ===== */
const verifyError = document.getElementById("verifyError");
const verifyInfo = document.getElementById("verifyInfo");

document.getElementById("verifyCheckBtn").addEventListener("click", async () => {
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

document.getElementById("verifyResendBtn").addEventListener("click", async () => {
  const btn = document.getElementById("verifyResendBtn");
  verifyError.classList.remove("show");
  verifyInfo.textContent = "";
  verifyInfo.classList.remove("show");
  btn.disabled = true;
  try {
    await sendEmailVerification(auth.currentUser, {
      url: VERIFY_RETURN_URL,
    });
    verifyInfo.textContent = `New link sent to ${auth.currentUser.email}.`;
    verifyInfo.classList.add("show");
  } catch (err) {
    verifyError.textContent =
      err.code === "auth/too-many-requests"
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

    const submitBtn = document.getElementById("placeOrderBtn");
    const errorBox = document.getElementById("checkoutError");
    errorBox.classList.remove("show");
    submitBtn.disabled = true;
    submitBtn.textContent = "Placing order...";

    const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);

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
      orderRef = await addDoc(collection(db, "orders"), {
        userId: currentUser.uid,
        items: cart,
        subtotal,
        shippingFee: SHIPPING_FEE,
        total: subtotal + SHIPPING_FEE,
        displayCurrency,
        status: "New",
        shippingInfo: {
          fullName: document.getElementById("ckName").value.trim(),
          email: document.getElementById("ckEmail").value.trim(),
          recipient: document.getElementById("ckRecipient").value.trim(),
          address: document.getElementById("ckAddress").value.trim(),
          phone: document.getElementById("ckPhone").value.trim(),
          paymentMethod,
          lat: savedAddressCoords.lat,
          lng: savedAddressCoords.lng,
        },
        // Online orders start unpaid; only the server marks them "paid"
        // after PayMongo confirms the payment.
        ...(payOnline ? { paymentStatus: "pending" } : {}),
        createdAt: serverTimestamp(),
      });

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
        "Something went wrong placing your order. Please try again.";
      errorBox.classList.add("show");
    } finally {
      if (!leavingPage) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Place Order";
      }
    }
  });

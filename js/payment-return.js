// js/payment-return.js
// KalingaCare — the page PayMongo sends customers back to. It never trusts
// the URL alone: an order is shown as paid only after the server has
// confirmed it with PayMongo (api/verify-payment.js) or the webhook already
// recorded it.

import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { startOnlinePayment, verifyPayment, PAYMENT_CHANNEL_LABELS } from "./payments.js";

const params = new URLSearchParams(window.location.search);
const orderId = params.get("order") || "";
const cancelled = params.has("cancelled");
const failedToOpen = params.has("failed");
const fromApp = params.has("app");

const $ = (id) => document.getElementById(id);

function show({ icon, title, message, pill, pillClass, canPay, tone }) {
  $("prChecking").classList.add("d-none");
  $("prResult").classList.remove("d-none");
  $("prIcon").className = `bi ${icon}`;
  $("prIconWrap").className = `status-card-icon ${tone || ""}`;
  $("prTitle").textContent = title;
  $("prMessage").textContent = message;
  $("prOrderId").textContent = orderId ? `#${orderId.slice(0, 8).toUpperCase()}` : "";
  $("prPill").textContent = pill || "";
  $("prPill").className = `payment-pill ${pillClass || ""}`;
  $("prPill").hidden = !pill;
  $("prPayBtn").classList.toggle("d-none", !canPay);
}

function showPaid(order) {
  const channel = PAYMENT_CHANNEL_LABELS[order?.payment?.channel];
  show({
    icon: "bi-check-circle",
    title: "Payment received",
    message: `Thank you! Your order is paid${channel ? ` by ${channel}` : ""} and we'll start preparing it.`,
    pill: "Paid",
    pillClass: "paid",
    tone: "success",
  });
}

function showPending() {
  show({
    icon: cancelled || failedToOpen ? "bi-exclamation-circle" : "bi-hourglass-split",
    title: failedToOpen
      ? "We couldn't open the payment page"
      : cancelled
        ? "Payment not completed"
        : "Payment not confirmed yet",
    message: failedToOpen
      ? "Your order was saved but not paid. You can try paying again now or later from My Orders."
      : cancelled
        ? "Your order was saved but not paid. You can pay now, or later from My Orders."
        : "We haven't received confirmation from PayMongo yet. If you finished paying, check My Orders again in a minute.",
    pill: "Payment pending",
    pillClass: "pending",
    canPay: true,
    tone: "warning",
  });
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The webhook usually lands within seconds, so check a few times before
// calling the payment "not confirmed".
async function confirmPayment() {
  const attempts = cancelled || failedToOpen ? 1 : 4;
  for (let i = 0; i < attempts; i++) {
    try {
      if ((await verifyPayment(orderId)) === "paid") return true;
    } catch (err) {
      console.error("verify-payment failed", err);
    }
    if (i < attempts - 1) await wait(2500);
  }
  return false;
}

async function loadOrder() {
  try {
    const snap = await getDoc(doc(db, "orders", orderId));
    return snap.exists() ? snap.data() : null;
  } catch {
    return null; // not this user's order, or it doesn't exist
  }
}

$("prPayBtn").addEventListener("click", async () => {
  const btn = $("prPayBtn");
  btn.disabled = true;
  btn.textContent = "Opening secure payment...";
  $("prError").classList.remove("show");
  try {
    await startOnlinePayment(orderId);
  } catch (err) {
    $("prError").textContent = err.message;
    $("prError").classList.add("show");
    btn.disabled = false;
    btn.textContent = "Pay now";
  }
});

if (fromApp) {
  // Paying from the mobile app: this browser isn't signed in, and the app
  // checks the payment itself once the customer goes back to it.
  show({
    icon: cancelled ? "bi-exclamation-circle" : "bi-phone",
    title: cancelled ? "Payment not completed" : "Return to the KalingaCare app",
    message: cancelled
      ? "Go back to the KalingaCare app. Your order is saved, and you can pay for it from My Orders."
      : "Go back to the KalingaCare app to see your payment confirmed.",
  });
  $("prAppNote").classList.remove("d-none");
} else if (!/^[A-Za-z0-9]{10,40}$/.test(orderId)) {
  show({
    icon: "bi-exclamation-circle",
    title: "Order not found",
    message: "This payment link is missing its order. Check My Orders for your latest orders.",
  });
} else {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      const here = `payment-return.html?order=${orderId}`;
      window.location.href = `login.html?redirect=${encodeURIComponent(here)}`;
      return;
    }
    let order = await loadOrder();
    if (!order) {
      show({
        icon: "bi-exclamation-circle",
        title: "Order not found",
        message: "We couldn't find this order on your account. Check My Orders.",
      });
      return;
    }
    if (order.paymentStatus !== "paid" && (await confirmPayment())) {
      order = (await loadOrder()) || order;
      order.paymentStatus = "paid";
    }
    if (order.paymentStatus === "paid") showPaid(order);
    else showPending();
  });
}

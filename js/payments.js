// js/payments.js
// KalingaCare — online payment (PayMongo, test mode) helpers shared by
// checkout, the payment return page and My Orders. The secret key and the
// "mark as paid" step live in the Vercel functions (api/create-checkout.js,
// api/verify-payment.js, api/paymongo-webhook.js); the browser only asks
// them to act on one of the signed-in customer's own orders.

import { auth } from "./firebase.js";

async function callPaymentApi(path, orderId) {
  const user = auth.currentUser;
  if (!user) throw new Error("Please log in again.");
  const token = await user.getIdToken();
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ orderId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Payment service is unavailable. Please try again.");
  return data;
}

// Sends the customer to PayMongo's hosted payment page for this order.
export async function startOnlinePayment(orderId) {
  const { checkoutUrl } = await callPaymentApi("/api/create-checkout", orderId);
  window.location.href = checkoutUrl;
}

// Asks the server to check with PayMongo. Resolves to "paid" or "pending".
export async function verifyPayment(orderId) {
  const { paymentStatus } = await callPaymentApi("/api/verify-payment", orderId);
  return paymentStatus;
}

export const PAYMENT_CHANNEL_LABELS = {
  card: "Card",
  gcash: "GCash",
  paymaya: "Maya",
  grab_pay: "GrabPay",
  qrph: "QR Ph",
};

// js/invoice.js
// KalingaCare — printable invoice for one order (?id=) or several (?ids=a,b,c,
// staff only in practice: Firestore rules let a customer read just their own
// orders). Add &print=1 to open the print dialog once it has loaded.

import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { PAYMENT_CHANNEL_LABELS } from "./payments.js";

const MAX_INVOICES = 30;

const params = new URLSearchParams(window.location.search);
const ids = [
  ...new Set(
    [params.get("id"), ...(params.get("ids") || "").split(",")]
      .map((s) => (s || "").trim())
      .filter((s) => /^[A-Za-z0-9]{10,40}$/.test(s)),
  ),
].slice(0, MAX_INVOICES);
const autoPrint = params.has("print");

const stage = document.getElementById("invoiceStage");
const printBtn = document.getElementById("invPrintBtn");

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function money(amount) {
  return (
    "₱" +
    (Number(amount) || 0).toLocaleString("en-PH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function longDate(ts) {
  const d = ts?.toDate ? ts.toDate() : null;
  return d
    ? d.toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" })
    : "—";
}

function message(text) {
  stage.innerHTML = `<p class="invoice-message">${escapeHtml(text)}</p>`;
  printBtn.disabled = true;
}

// How the customer pays, and where that payment stands.
function paymentRows(order) {
  const online = order.shippingInfo?.paymentMethod === "online";
  const cancelled = order.status === "Cancelled";
  const rows = [];

  if (online) {
    rows.push(["Payment method", "Online payment (PayMongo)"]);
    if (order.paymentStatus === "paid") {
      const channel = PAYMENT_CHANNEL_LABELS[order.payment?.channel];
      rows.push(["Payment status", `<span class="inv-paid">Paid</span>`]);
      if (channel) rows.push(["Paid with", escapeHtml(channel)]);
      rows.push(["Date paid", longDate(order.payment?.paidAt)]);
      if (order.payment?.paymentId) rows.push(["Reference", escapeHtml(order.payment.paymentId)]);
    } else {
      rows.push([
        "Payment status",
        cancelled
          ? `<span class="inv-unpaid">Not paid</span>`
          : `<span class="inv-unpaid">Awaiting payment</span>`,
      ]);
    }
  } else {
    rows.push(["Payment method", "Cash on Delivery"]);
    if (order.paymentStatus === "paid") {
      rows.push(["Payment status", `<span class="inv-paid">Cash collected</span>`]);
      rows.push(["Date paid", longDate(order.payment?.paidAt)]);
    } else {
      rows.push([
        "Payment status",
        cancelled
          ? `<span class="inv-unpaid">Not paid</span>`
          : `<span class="inv-unpaid">To be paid on delivery</span>`,
      ]);
    }
  }
  return rows;
}

function invoiceHtml(order) {
  const ship = order.shippingInfo || {};
  const shortId = order.id.slice(0, 8).toUpperCase();
  // Orders from before invoice numbers existed fall back to the order ID.
  const invoiceNo = order.invoiceNo || `#${shortId}`;
  const status = order.status === "New" ? "Pending" : order.status || "Pending";
  const items = Array.isArray(order.items) ? order.items : [];
  const discount = Number(order.discount) || 0;
  const subtotal =
    order.subtotal ?? items.reduce((sum, i) => sum + (Number(i.price) || 0) * (Number(i.qty) || 0), 0);
  // Old orders have no shippingFee field; derive it from the total.
  const shipping = order.shippingFee ?? Math.max(0, (Number(order.total) || 0) - subtotal + discount);

  const online = ship.paymentMethod === "online";
  const testNote =
    online && order.payment?.testMode
      ? " This was a test-mode payment: no real money moved."
      : "";

  return `
    <article class="invoice">
      ${status === "Cancelled" ? `<div class="inv-stamp">CANCELLED</div>` : ""}

      <div class="inv-head">
        <div class="inv-brand">
          <img src="assets/images/logo.png" alt="" />
          <div>
            <h1>KalingaCare</h1>
            <p>Care Beyond Borders</p>
            <p>938 Aurora Blvd, Cubao, Quezon City</p>
            <p>kalingacaresupport@gmail.com &middot; Mon&ndash;Sat, 9:00 AM&ndash;6:00 PM</p>
          </div>
        </div>
        <div class="inv-title">
          <h2>INVOICE</h2>
          <p>Invoice no. <strong>${escapeHtml(invoiceNo)}</strong></p>
          <p>Date <strong>${longDate(order.createdAt)}</strong></p>
          <p>Order <strong>#${shortId}</strong> &middot; ${escapeHtml(status)}</p>
        </div>
      </div>

      <div class="inv-parties">
        <div class="inv-party">
          <p class="inv-label">Billed to</p>
          <p class="inv-name">${escapeHtml(ship.fullName || "—")}</p>
          <p>${escapeHtml(ship.email || "")}</p>
        </div>
        <div class="inv-party">
          <p class="inv-label">Deliver to</p>
          <p class="inv-name">${escapeHtml(ship.recipient || "—")}</p>
          <p>${escapeHtml(ship.address || "")}</p>
          <p>${escapeHtml(ship.phone || "")}</p>
          ${ship.note ? `<p>Driver note: ${escapeHtml(ship.note)}</p>` : ""}
        </div>
      </div>

      <table class="inv-items">
        <thead>
          <tr>
            <th>Item</th>
            <th class="num">Unit price</th>
            <th class="num">Qty</th>
            <th class="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${items
            .map(
              (i) => `
            <tr>
              <td>${escapeHtml(i.name)}</td>
              <td class="num">${money(i.price)}</td>
              <td class="num">${Number(i.qty) || 0}</td>
              <td class="num">${money((Number(i.price) || 0) * (Number(i.qty) || 0))}</td>
            </tr>`,
            )
            .join("")}
        </tbody>
      </table>

      <div class="inv-bottom">
        <div class="inv-payment">
          <p class="inv-label">Payment</p>
          <dl>
            ${paymentRows(order)
              .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
              .join("")}
          </dl>
        </div>
        <table class="inv-totals">
          <tr><td>Subtotal</td><td>${money(subtotal)}</td></tr>
          <tr><td>Shipping</td><td>${money(shipping)}</td></tr>
          ${
            discount > 0
              ? `<tr><td>Discount${order.promoCode ? ` (${escapeHtml(order.promoCode)})` : ""}</td><td>&minus;${money(discount)}</td></tr>`
              : ""
          }
          <tr class="grand"><td>Total</td><td>${money(order.total)}</td></tr>
        </table>
      </div>

      <p class="inv-note">
        Thank you for caring for your family through KalingaCare. This is a
        computer-generated invoice and needs no signature.${testNote}
      </p>
    </article>`;
}

async function loadInvoices() {
  const orders = [];
  for (const id of ids) {
    try {
      const snap = await getDoc(doc(db, "orders", id));
      if (snap.exists()) orders.push({ id: snap.id, ...snap.data() });
    } catch {
      // Not yours (or missing): rules answer both the same way.
    }
  }
  if (!orders.length) {
    message("We couldn't find that invoice. It may belong to a different account.");
    return;
  }
  orders.sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));
  stage.innerHTML = orders.map(invoiceHtml).join("");
  document.title =
    orders.length === 1
      ? `Invoice ${orders[0].invoiceNo || orders[0].id.slice(0, 8).toUpperCase()}`
      : `${orders.length} invoices`;
  document.getElementById("invToolbarTitle").textContent = document.title;
  printBtn.disabled = false;
  if (autoPrint) setTimeout(() => window.print(), 400);
}

printBtn.addEventListener("click", () => window.print());
document.getElementById("invBackBtn").addEventListener("click", () => {
  if (window.history.length > 1) window.history.back();
  else window.location.href = "profile.html";
});

if (!ids.length) {
  message("There's no invoice to show here.");
} else {
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      const redirect = ids.length === 1 ? `?redirect=${encodeURIComponent(`invoice.html?id=${ids[0]}`)}` : "";
      window.location.href = `login.html${redirect}`;
      return;
    }
    loadInvoices();
  });
}

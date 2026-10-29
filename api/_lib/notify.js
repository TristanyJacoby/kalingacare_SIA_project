// api/_lib/notify.js — automated order emails (confirmation, shipped,
// delivered, cancelled), sent from the store's Gmail account. Each kind can
// be switched off in Admin > Settings. Emails go to the customer's ACCOUNT
// email (from Firebase Auth), never to an address typed into an order, so an
// order can't be used to send mail to someone else.
//
// Env vars (Vercel): GMAIL_USER, GMAIL_APP_PASSWORD. Without them nothing is
// sent (the order itself is never affected).

const nodemailer = require("nodemailer");
const { getStoreSettings } = require("./settings");

const PUBLIC_SITE_URL = (
  process.env.PUBLIC_SITE_URL || "https://kalingacare-drab.vercel.app"
).replace(/\/$/, "");

const SETTING_FOR = {
  confirmation: "emailOrderConfirmation",
  shipped: "emailShipped",
  delivered: "emailDelivered",
  cancelled: "emailCancelled",
};

const COPY = {
  confirmation: {
    subject: (o) => `We received your KalingaCare order ${o.ref}`,
    title: "Thank you for your order!",
    lead: "We've received your order and will start preparing it soon.",
  },
  shipped: {
    subject: (o) => `Your KalingaCare order ${o.ref} is on its way`,
    title: "Your order is on its way",
    lead: "Good news: your order has been shipped and is heading to your loved one.",
  },
  delivered: {
    subject: (o) => `Your KalingaCare order ${o.ref} was delivered`,
    title: "Your order was delivered",
    lead: "Your order has been delivered. We hope it brings comfort and care. You can now leave a review from My Orders.",
  },
  cancelled: {
    subject: (o) => `Your KalingaCare order ${o.ref} was cancelled`,
    title: "Your order was cancelled",
    lead: "This order has been cancelled and nothing more will be sent.",
  },
};

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = (n) =>
  "₱" + (Number(n) || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function transport() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;
  return { user, mailer: nodemailer.createTransport({ service: "gmail", auth: { user, pass: pass.replace(/\s+/g, "") } }) };
}

function build(kind, order) {
  const copy = COPY[kind];
  const ship = order.shippingInfo || {};
  const items = Array.isArray(order.items) ? order.items : [];
  const online = ship.paymentMethod === "online";
  const paid = order.paymentStatus === "paid";
  const payLine = online
    ? paid
      ? "Paid online"
      : "Online payment (awaiting payment)"
    : "Cash on Delivery (pay when it arrives)";
  const first = esc((ship.fullName || "").split(" ")[0] || "there");

  const rows = items
    .map(
      (i) => `<tr><td style="padding:6px 0;">${esc(i.name)} &times; ${Number(i.qty) || 0}</td><td align="right" style="padding:6px 0;">${money((Number(i.price) || 0) * (Number(i.qty) || 0))}</td></tr>`,
    )
    .join("");
  const discount = Number(order.discount) || 0;

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f2f9ff;font-family:Poppins,Arial,sans-serif;color:#1e293b;">
  <div style="max-width:540px;margin:0 auto;background:#fff;border:1px solid #dce8f0;border-radius:18px;padding:32px;">
    <div style="font-size:22px;font-weight:bold;color:#1778ad;">KalingaCare</div>
    <div style="font-size:13px;color:#5c6b7f;margin-bottom:18px;">Care Beyond Borders</div>
    <h1 style="font-size:20px;margin:0 0 8px;">${copy.title}</h1>
    <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">Hi ${first}, ${esc(copy.lead)}</p>
    <p style="font-size:13px;color:#5c6b7f;margin:0 0 12px;">Order <strong>${esc(order.ref)}</strong>${order.invoiceNo ? ` &middot; Invoice ${esc(order.invoiceNo)}` : ""}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;border-top:1px solid #dce8f0;border-bottom:1px solid #dce8f0;">${rows}</table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;margin-top:8px;">
      <tr><td style="padding:3px 0;">Subtotal</td><td align="right">${money(order.subtotal)}</td></tr>
      <tr><td style="padding:3px 0;">Shipping</td><td align="right">${Number(order.shippingFee) ? money(order.shippingFee) : "Free"}</td></tr>
      ${discount > 0 ? `<tr><td style="padding:3px 0;">Discount${order.promoCode ? ` (${esc(order.promoCode)})` : ""}</td><td align="right">&minus;${money(discount)}</td></tr>` : ""}
      <tr><td style="padding:8px 0;font-weight:bold;">Total</td><td align="right" style="font-weight:bold;">${money(order.total)}</td></tr>
    </table>
    <p style="font-size:13px;line-height:1.6;margin:14px 0 0;"><strong>Payment:</strong> ${esc(payLine)}<br>
    <strong>Deliver to:</strong> ${esc(ship.recipient || "")}, ${esc(ship.address || "")}</p>
    <p style="text-align:center;margin:24px 0 8px;"><a href="${PUBLIC_SITE_URL}/profile.html" style="background:#1778ad;color:#fff;text-decoration:none;font-weight:bold;padding:12px 30px;border-radius:999px;display:inline-block;">View my orders</a></p>
    <p style="font-size:12px;color:#5c6b7f;margin:16px 0 0;">Questions? Reply to this email or write to kalingacaresupport@gmail.com.</p>
  </div></body></html>`;

  const text = [
    `${copy.title}`,
    `Hi ${(ship.fullName || "").split(" ")[0] || "there"}, ${copy.lead}`,
    `Order ${order.ref}${order.invoiceNo ? ` (invoice ${order.invoiceNo})` : ""}`,
    ...items.map((i) => `- ${i.name} x ${Number(i.qty) || 0}: ${money((Number(i.price) || 0) * (Number(i.qty) || 0))}`),
    `Total: ${money(order.total)}`,
    `Payment: ${payLine}`,
    `Track it at ${PUBLIC_SITE_URL}/profile.html`,
  ].join("\n");

  return { subject: copy.subject(order), html, text };
}

async function deliver(to, kind, order) {
  const t = transport();
  if (!t) return false;
  const { subject, html, text } = build(kind, order);
  await t.mailer.sendMail({ from: `"KalingaCare" <${t.user}>`, to, subject, text, html });
  return true;
}

// Sends the email for an order event if that kind is switched on. Never
// throws: a failed email must not fail the order. `admin` is firebase-admin.
async function notifyOrder(admin, kind, orderId, order) {
  try {
    const settings = await getStoreSettings(admin.firestore());
    if (!settings[SETTING_FOR[kind]]) return false;
    if (!order.userId) return false;
    const account = await admin.auth().getUser(order.userId);
    if (!account.email) return false;
    // Race the mail server so a slow connection can't hold the order response.
    return await Promise.race([
      deliver(account.email, kind, { ...order, ref: `#${orderId.slice(0, 8).toUpperCase()}` }),
      new Promise((resolve) => setTimeout(() => resolve(false), 8000)),
    ]);
  } catch (err) {
    console.error(`Order ${kind} email failed:`, err);
    return false;
  }
}

// A made-up order, to check the email setup from Admin > Settings.
async function sendSampleEmail(to, name) {
  try {
    return await deliver(to, "confirmation", {
      ref: "#SAMPLE01",
      invoiceNo: "KC-0000-00000",
      items: [{ name: "Sample product", qty: 1, price: 1000 }],
      subtotal: 1000,
      shippingFee: 150,
      discount: 0,
      total: 1150,
      shippingInfo: { fullName: name || "Admin", recipient: "Sample Recipient", address: "938 Aurora Blvd, Cubao, Quezon City", paymentMethod: "cod" },
    });
  } catch (err) {
    console.error("Sample email failed:", err);
    return false;
  }
}

// Return and refund emails: requested, approved, rejected, refunded. They
// go to the account email, and can be switched off (emailReturns).
const RETURN_COPY = {
  requested: {
    subject: (r) => `We received your return request for ${r.ref}`,
    title: "We received your return request",
    lead: "Our team will review it and email you with a decision, usually within a few days.",
  },
  approved: {
    subject: (r) => `Your return for ${r.ref} was approved`,
    title: "Your return was approved",
    lead: "We approved your return. Please keep the items ready; we'll confirm once they reach us and your refund is issued.",
  },
  rejected: {
    subject: (r) => `Your return request for ${r.ref} was declined`,
    title: "Your return request was declined",
    lead: "We're sorry, we couldn't approve this return.",
  },
  refunded: {
    subject: (r) => `Your refund for ${r.ref} has been issued`,
    title: "Your refund has been issued",
    lead: "Your refund is on its way.",
  },
};

async function notifyReturn(admin, kind, ret) {
  try {
    const settings = await getStoreSettings(admin.firestore());
    if (!settings.emailReturns || !ret.userId) return false;
    const account = await admin.auth().getUser(ret.userId);
    const t = transport();
    if (!account.email || !t) return false;
    const copy = RETURN_COPY[kind];
    const r = { ...ret, ref: `#${String(ret.orderId).slice(0, 8).toUpperCase()}` };
    const items = (r.items || []).map((i) => `<tr><td style="padding:5px 0;">${esc(i.name)} &times; ${Number(i.qty) || 0}</td></tr>`).join("");
    const refundLine =
      kind === "refunded"
        ? `<p style="font-size:14px;"><strong>Refund:</strong> ${money(r.refundAmount)} ${r.refundMode === "paymongo" ? "back to your original payment method (it can take a few days to show)" : "arranged directly with the store"}.</p>`
        : kind === "approved" && r.refundAmount
          ? `<p style="font-size:14px;"><strong>Expected refund:</strong> ${money(r.refundAmount)} (shipping isn't refunded).</p>`
          : "";
    const noteLine = r.staffNote ? `<p style="font-size:14px;"><strong>Note from our team:</strong> ${esc(r.staffNote)}</p>` : "";
    const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f2f9ff;font-family:Poppins,Arial,sans-serif;color:#1e293b;">
  <div style="max-width:540px;margin:0 auto;background:#fff;border:1px solid #dce8f0;border-radius:18px;padding:32px;">
    <div style="font-size:22px;font-weight:bold;color:#1778ad;">KalingaCare</div>
    <h1 style="font-size:20px;margin:16px 0 8px;">${esc(copy.title)}</h1>
    <p style="font-size:15px;line-height:1.6;">${esc(copy.lead)}</p>
    <p style="font-size:13px;color:#5c6b7f;">Order <strong>${esc(r.ref)}</strong>${r.invoiceNo ? ` &middot; Invoice ${esc(r.invoiceNo)}` : ""}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;border-top:1px solid #dce8f0;border-bottom:1px solid #dce8f0;">${items}</table>
    ${refundLine}${noteLine}
    <p style="text-align:center;margin:24px 0 8px;"><a href="${PUBLIC_SITE_URL}/profile.html" style="background:#1778ad;color:#fff;text-decoration:none;font-weight:bold;padding:12px 30px;border-radius:999px;display:inline-block;">View my orders</a></p>
    <p style="font-size:12px;color:#5c6b7f;">Questions? Reply to this email or write to kalingacaresupport@gmail.com.</p>
  </div></body></html>`;
    const text = `${copy.title}\n${copy.lead}\nOrder ${r.ref}\n${(r.items || []).map((i) => `- ${i.name} x ${i.qty}`).join("\n")}${kind === "refunded" ? `\nRefund: ${money(r.refundAmount)}` : ""}${r.staffNote ? `\nNote: ${r.staffNote}` : ""}`;
    return await Promise.race([
      t.mailer.sendMail({ from: `"KalingaCare" <${t.user}>`, to: account.email, subject: copy.subject(r), text, html }).then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 8000)),
    ]);
  } catch (err) {
    console.error(`Return ${kind} email failed:`, err);
    return false;
  }
}

module.exports = { notifyOrder, notifyReturn, sendSampleEmail };

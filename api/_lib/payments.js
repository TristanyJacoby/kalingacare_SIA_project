// api/_lib/payments.js — shared helpers for the PayMongo functions.
// Files under api/_lib are not exposed as endpoints by Vercel.
//
// Secrets (Vercel env vars, never in the repo):
//   PAYMONGO_SECRET_KEY      sk_test_... (test mode: no real money moves)
//   PAYMONGO_WEBHOOK_SECRET  whsk_... from the webhook registered in PayMongo
//   FIREBASE_SERVICE_ACCOUNT the Firebase service account JSON (raw or base64)
// Optional:
//   PAYMONGO_METHODS         comma list, default "card,gcash,paymaya"
//   PUBLIC_SITE_URL          default https://kalingacare-drab.vercel.app

const admin = require("firebase-admin");
const { logAudit } = require("./audit");

const PAYMONGO_API = "https://api.paymongo.com/v1";
const SHIPPING_FEE = 150; // keep in sync with js/site.js and mobile Checkout.tsx
const PUBLIC_SITE_URL = (
  process.env.PUBLIC_SITE_URL || "https://kalingacare-drab.vercel.app"
).replace(/\/$/, "");


const ALLOWED_ORIGINS = [
  /^https?:\/\/localhost(:\d+)?$/, // includes the Android app (https://localhost)
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https:\/\/[a-z0-9-]+\.vercel\.app$/,
  /^capacitor:\/\/localhost$/,
];

// Origins that are real websites the customer can be sent back to after
// paying. The mobile app's origin isn't reachable from a browser, so it
// gets the public site instead.
const RETURNABLE_ORIGINS = [
  /^https?:\/\/localhost:\d+$/,
  /^https?:\/\/127\.0\.0\.1:\d+$/,
  /^https:\/\/[a-z0-9-]+\.vercel\.app$/,
];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function getAdmin() {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new HttpError(500, "Server is missing FIREBASE_SERVICE_ACCOUNT");
    const json = raw.trim().startsWith("{")
      ? raw
      : Buffer.from(raw, "base64").toString("utf8");
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(json)) });
  }
  return admin;
}

// CORS for the browser/app endpoints. Returns false when the request was
// fully handled (preflight or rejected origin).
function handleCors(req, res) {
  const origin = req.headers.origin || "";
  const originOk = ALLOWED_ORIGINS.some((re) => re.test(origin));
  if (originOk) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }
  if (req.method === "OPTIONS") {
    res.status(originOk ? 204 : 403).end();
    return false;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return false;
  }
  if (origin && !originOk) {
    res.status(403).json({ error: "Origin not allowed" });
    return false;
  }
  return true;
}

function returnBaseUrl(req) {
  const origin = req.headers.origin || "";
  return RETURNABLE_ORIGINS.some((re) => re.test(origin)) ? origin : PUBLIC_SITE_URL;
}

function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body) return JSON.parse(req.body);
  return {};
}

// Verifies the Firebase ID token the client sends as "Bearer <token>".
async function requireUser(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new HttpError(401, "Please log in again.");
  try {
    return await getAdmin().auth().verifyIdToken(token);
  } catch {
    throw new HttpError(401, "Please log in again.");
  }
}

// Loads an order the signed-in user owns and that is waiting for an online
// payment.
async function loadOwnOnlineOrder(orderId, uid) {
  if (typeof orderId !== "string" || !/^[A-Za-z0-9]{10,40}$/.test(orderId)) {
    throw new HttpError(400, "Invalid order.");
  }
  const ref = getAdmin().firestore().collection("orders").doc(orderId);
  const snap = await ref.get();
  if (!snap.exists || snap.get("userId") !== uid) {
    throw new HttpError(404, "Order not found.");
  }
  const order = snap.data();
  if (order.shippingInfo?.paymentMethod !== "online") {
    throw new HttpError(400, "This order is Cash on Delivery.");
  }
  return { ref, order };
}

// Recomputes what the order should cost from the current product prices,
// shipping fee and promo code. Throws if the stored total disagrees.
async function computeOrderTotal(orderId, order) {
  const db = getAdmin().firestore();
  const items = Array.isArray(order.items) ? order.items : [];
  if (items.length === 0) throw new HttpError(400, "This order has no items.");

  const productSnaps = await db.getAll(
    ...items.map((item) => db.collection("products").doc(String(item.id)))
  );

  let subtotal = 0;
  productSnaps.forEach((snap, i) => {
    const qty = Number(items[i].qty);
    const price = Number(snap.get("price"));
    if (!snap.exists || !Number.isFinite(price) || !Number.isInteger(qty) || qty < 1) {
      throw new HttpError(409, "An item in this order is no longer available.");
    }
    subtotal += price * qty;
  });

  // The discount was worked out and stored by place-order (promo codes are
  // managed in Admin > Promotions and may have changed or expired since), so
  // it is used as written, but never more than the items cost.
  const discount = Math.min(Math.max(Number(order.discount) || 0, 0), subtotal);

  // The shipping fee on the order itself (set by place-order from the store
  // settings at the time), so a later settings change can't invalidate it.
  const shippingFee = Number.isFinite(Number(order.shippingFee)) ? Number(order.shippingFee) : SHIPPING_FEE;
  const total = subtotal + shippingFee - discount;
  if (Math.abs(total - Number(order.total)) > 0.005) {
    throw new HttpError(409, "Prices changed since this order was placed. Please place a new order.");
  }
  return total;
}

async function paymongo(path, options = {}) {
  const key = process.env.PAYMONGO_SECRET_KEY;
  if (!key) throw new HttpError(500, "Server is missing PAYMONGO_SECRET_KEY");
  const res = await fetch(`${PAYMONGO_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = json.errors?.[0]?.detail || `PayMongo error ${res.status}`;
    console.error("PayMongo", path, res.status, JSON.stringify(json.errors || json));
    throw new HttpError(502, detail);
  }
  return json.data;
}

// Marks the order paid if the checkout session has a paid payment. Used by
// both the webhook and the return-page check, so either one is enough.
// Returns the order's paymentStatus afterwards.
async function syncPaymentFromSession(orderRef, session) {
  const attrs = session?.attributes || {};
  const paid = (attrs.payments || []).find((p) => p.attributes?.status === "paid");
  if (!paid) return null;

  const db = getAdmin().firestore();
  let newlyPaid = null;
  const status = await db.runTransaction(async (tx) => {
    newlyPaid = null;
    const snap = await tx.get(orderRef);
    if (!snap.exists) return null;
    if (snap.get("paymentStatus") === "paid") return "paid";

    const amountPaid = paid.attributes.amount / 100;
    if (Math.abs(amountPaid - Number(snap.get("total"))) > 0.005) {
      console.error("Paid amount mismatch", orderRef.id, amountPaid, snap.get("total"));
    }
    tx.update(orderRef, {
      paymentStatus: "paid",
      payment: {
        provider: "paymongo",
        testMode: attrs.livemode === false || paid.attributes.livemode === false,
        sessionId: session.id,
        paymentId: paid.id,
        channel: paid.attributes.source?.type || null,
        amount: amountPaid,
        paidAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    });
    newlyPaid = { amount: amountPaid, channel: paid.attributes.source?.type || "online", invoiceNo: snap.get("invoiceNo") || "" };
    return "paid";
  });
  if (newlyPaid) {
    await logAudit(admin, {
      actor: { id: "system", name: "PayMongo", role: "system" },
      action: "payment.paid",
      targetType: "order",
      targetId: orderRef.id,
      targetLabel: `Order #${orderRef.id.slice(0, 8).toUpperCase()}${newlyPaid.invoiceNo ? ` (${newlyPaid.invoiceNo})` : ""}`,
      summary: `Online payment of \u20B1${newlyPaid.amount} received (${newlyPaid.channel}).`,
    });
  }
  return status;
}

function sendError(res, err) {
  const status = err instanceof HttpError ? err.status : 500;
  if (status === 500) console.error(err);
  res.status(status).json({
    error: err instanceof HttpError ? err.message : "Something went wrong. Please try again.",
  });
}

module.exports = {
  SHIPPING_FEE,
  HttpError,
  getAdmin,
  handleCors,
  returnBaseUrl,
  readJsonBody,
  requireUser,
  loadOwnOnlineOrder,
  computeOrderTotal,
  paymongo,
  syncPaymentFromSession,
  sendError,
};

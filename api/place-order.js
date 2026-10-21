// api/place-order.js — creates every order (Cash on Delivery and online),
// for both the website and the mobile app. Clients can no longer write
// orders directly (Firestore rules), so prices can't be tampered with:
// item names and prices, the promo discount and the total are all worked
// out here from the product records.
//
// POST with "Authorization: Bearer <Firebase ID token>":
// {
//   items: [{ id, qty }],
//   promoCode?: string,
//   paymentMethod: "cod" | "online",
//   displayCurrency?: string,
//   shippingInfo: { fullName, email, recipient, address, phone, note?, lat?, lng? }
// }
// Returns { orderId, total }. For "online", the client then calls
// api/create-checkout.js with that orderId, as before.

const {
  handleCors,
  readJsonBody,
  requireUser,
  getAdmin,
  sendError,
  HttpError,
  SHIPPING_FEE,
  PROMO_CODES,
} = require("./_lib/payments");

const STAFF_ROLES = ["staff", "admin", "superadmin"];

function text(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

function coord(value) {
  const n = Number(value);
  return value === null || value === undefined || value === "" || !Number.isFinite(n) ? null : n;
}

module.exports = async function handler(req, res) {
  if (!handleCors(req, res)) return;
  try {
    const user = await requireUser(req);
    // Same as the old rule: only verified emails can order (Google
    // sign-ins count as verified).
    if (user.email_verified !== true) {
      throw new HttpError(403, "Please verify your email before placing an order.");
    }

    const admin = getAdmin();
    const db = admin.firestore();

    const profile = await db.collection("users").doc(user.uid).get();
    if (STAFF_ROLES.includes(profile.get("role"))) {
      throw new HttpError(403, "Staff accounts can't place orders.");
    }

    let body;
    try {
      body = readJsonBody(req);
    } catch {
      throw new HttpError(400, "Invalid request.");
    }

    // Items: merge duplicates, whole quantities 1-99, at most 50 products.
    const wanted = new Map();
    for (const raw of Array.isArray(body.items) ? body.items : []) {
      const id = text(raw?.id, 100);
      const qty = Number(raw?.qty);
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(id) || !Number.isInteger(qty) || qty < 1 || qty > 99) {
        throw new HttpError(400, "Invalid item in the order.");
      }
      wanted.set(id, Math.min(99, (wanted.get(id) || 0) + qty));
    }
    if (wanted.size === 0) throw new HttpError(400, "Your order has no items.");
    if (wanted.size > 50) throw new HttpError(400, "Too many different items in one order.");

    const ids = [...wanted.keys()];
    const snaps = await db.getAll(...ids.map((id) => db.collection("products").doc(id)));
    const items = snaps.map((snap, i) => {
      const price = Number(snap.get("price"));
      if (!snap.exists || !Number.isFinite(price) || price < 0) {
        throw new HttpError(409, "An item in your cart is no longer available. Please remove it and try again.");
      }
      const stock = snap.get("stock");
      if (typeof stock === "number" && stock <= 0) {
        throw new HttpError(409, `${snap.get("name") || "An item"} is out of stock.`);
      }
      return { id: ids[i], name: snap.get("name") || "Product", price, qty: wanted.get(ids[i]) };
    });
    const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);

    // Promo code (same rules as the apps and api/create-checkout.js).
    const promoCode = text(body.promoCode, 40).toUpperCase() || null;
    let discount = 0;
    if (promoCode) {
      const promo = PROMO_CODES[promoCode];
      if (!promo) throw new HttpError(400, "That promo code isn't valid.");
      if (promo.firstOrderOnly) {
        const earlier = await db.collection("orders").where("userId", "==", user.uid).limit(1).get();
        if (!earlier.empty) throw new HttpError(400, "That promo code is only for your first order.");
      }
      discount =
        promo.type === "percent"
          ? Math.round((subtotal * promo.value) / 100)
          : Math.min(promo.value, subtotal);
    }

    const paymentMethod = body.paymentMethod === "online" ? "online" : "cod";
    const info = body.shippingInfo || {};
    const shippingInfo = {
      fullName: text(info.fullName, 120),
      email: text(info.email, 254),
      recipient: text(info.recipient, 120),
      address: text(info.address, 500),
      phone: text(info.phone, 40),
      note: text(info.note, 300),
      paymentMethod,
      lat: coord(info.lat),
      lng: coord(info.lng),
    };
    if (!shippingInfo.recipient || !shippingInfo.address || !shippingInfo.phone) {
      throw new HttpError(400, "Please fill in the recipient, address and contact number.");
    }

    const total = subtotal + SHIPPING_FEE - discount;
    const ref = await db.collection("orders").add({
      userId: user.uid,
      items,
      subtotal,
      shippingFee: SHIPPING_FEE,
      promoCode,
      discount,
      total,
      status: "New",
      shippingInfo,
      displayCurrency: text(body.displayCurrency, 3).toUpperCase() || "PHP",
      ...(paymentMethod === "online" ? { paymentStatus: "pending" } : {}),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.status(200).json({ orderId: ref.id, total });
  } catch (err) {
    sendError(res, err);
  }
};

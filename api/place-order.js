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
} = require("./_lib/payments");
const { lookupPromo } = require("./_lib/promos");
const { getStoreSettings, shippingFor } = require("./_lib/settings");
const { notifyOrder } = require("./_lib/notify");
const { logAudit, actorFrom, shortOrder } = require("./_lib/audit");

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
    if (profile.get("disabled") === true) {
      throw new HttpError(403, "Your account is suspended. Please contact support.");
    }
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

    // Promo code (same rules as the apps and api/create-checkout.js).
    // Promo codes are managed in Admin > Promotions (Firestore collection promos).
    const promoCode = text(body.promoCode, 40).toUpperCase() || null;
    let promo = null;
    if (promoCode) {
      const found = await lookupPromo(db, promoCode);
      if (found.error) throw new HttpError(400, found.error);
      promo = found.promo;
      if (promo.firstOrderOnly) {
        const earlier = await db.collection("orders").where("userId", "==", user.uid).limit(1).get();
        if (!earlier.empty) throw new HttpError(400, "That promo code is only for your first order.");
      }
    }

    const paymentMethod = body.paymentMethod === "online" ? "online" : "cod";
    // Platform settings (Admin > Settings): shipping fee, free shipping and
    // which payment options are on.
    const settings = await getStoreSettings(db);
    if (paymentMethod === "cod" && !settings.codEnabled) {
      throw new HttpError(409, "Cash on Delivery isn't available right now. Please choose another payment option.");
    }
    if (paymentMethod === "online" && !settings.onlineEnabled) {
      throw new HttpError(409, "Online payment isn't available right now. Please choose another payment option.");
    }
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

    // One transaction: check stock, take it off the products, number the
    // invoice and create the order, so two customers can't both buy the
    // last unit.
    const orderRef = db.collection("orders").doc();
    const counterRef = db.collection("counters").doc("orders");
    const placed = await db.runTransaction(async (t) => {
      const snaps = await t.getAll(...ids.map((id) => db.collection("products").doc(id)));
      const counter = await t.get(counterRef);

      const items = snaps.map((snap, i) => {
        const price = Number(snap.get("price"));
        if (!snap.exists || !Number.isFinite(price) || price < 0) {
          throw new HttpError(409, "An item in your cart is no longer available. Please remove it and try again.");
        }
        if (snap.get("status") === "inactive") {
          throw new HttpError(409, `${snap.get("name") || "An item"} is no longer available. Please remove it and try again.`);
        }
        const qty = wanted.get(ids[i]);
        const stock = snap.get("stock");
        if (typeof stock === "number" && stock <= 0) {
          throw new HttpError(409, `${snap.get("name") || "An item"} is out of stock.`);
        }
        if (typeof stock === "number" && qty > stock) {
          throw new HttpError(
            409,
            `Only ${stock} of ${snap.get("name") || "an item"} ${stock === 1 ? "is" : "are"} left in stock. Please lower the quantity in your cart.`,
          );
        }
        return { id: ids[i], name: snap.get("name") || "Product", price, qty };
      });
      const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
      const discount = !promo
        ? 0
        : promo.type === "percent"
          ? Math.round((subtotal * promo.value) / 100)
          : Math.min(promo.value, subtotal);
      const shippingFee = shippingFor(subtotal, settings);
      const orderTotal = subtotal + shippingFee - discount;

      // Invoice numbers run KC-<year>-00001, 00002, ... in order placed.
      const seq = (counter.exists ? Number(counter.get("last")) || 0 : 0) + 1;
      const invoiceNo = `KC-${new Date().getFullYear()}-${String(seq).padStart(5, "0")}`;

      snaps.forEach((snap, i) => {
        const stock = snap.get("stock");
        const update = { soldCount: (Number(snap.get("soldCount")) || 0) + items[i].qty };
        if (typeof stock === "number") update.stock = stock - items[i].qty;
        t.update(snap.ref, update);
      });
      t.set(counterRef, { last: seq });
      const orderData = {
        userId: user.uid,
        invoiceNo,
        items,
        subtotal,
        shippingFee,
        promoCode,
        discount,
        total: orderTotal,
        status: "New",
        shippingInfo,
        displayCurrency: text(body.displayCurrency, 3).toUpperCase() || "PHP",
        // Stock was taken off the products; cancelling puts it back once.
        stockDeducted: true,
        ...(paymentMethod === "online" ? { paymentStatus: "pending" } : {}),
      };
      t.set(orderRef, { ...orderData, createdAt: admin.firestore.FieldValue.serverTimestamp() });
      return orderData;
    });

    // "Thank you" email (if switched on); a failure never affects the order.
    await notifyOrder(admin, "confirmation", orderRef.id, placed);
    await logAudit(admin, {
      actor: actorFrom(user.uid, user, profile),
      action: "order.place",
      targetType: "order",
      targetId: orderRef.id,
      targetLabel: `Order ${shortOrder(orderRef.id)} (${placed.invoiceNo})`,
      summary: `Placed order ${placed.invoiceNo}: \u20B1${placed.total} by ${paymentMethod === "online" ? "online payment" : "Cash on Delivery"}, ${placed.items.length} product${placed.items.length === 1 ? "" : "s"}.`,
      details: { total: placed.total, shippingFee: placed.shippingFee, discount: placed.discount, items: placed.items.map((i) => `${i.name} x${i.qty}`) },
    });

    res.status(200).json({ orderId: orderRef.id, total: placed.total });
  } catch (err) {
    sendError(res, err);
  }
};

// api/update-order.js — the only way an order's status changes, for the
// website, the admin pages and the mobile app (Firestore rules no longer
// let clients edit orders). Enforcing the order process here means it
// can't be skipped from a browser console or an old app.
//
// POST with "Authorization: Bearer <Firebase ID token>":
//   { orderId, action: "status", status: "Pending" | "Processing" | "Shipped" | "Delivered" }  (staff)
//   { orderId, action: "cancel" }                                                              (the customer or staff)
// Returns { status, paymentStatus? }.
//
// Rules:
//   - Statuses move one step at a time: New > Pending > Processing > Shipped > Delivered.
//   - An online order can't go past Pending until it has been paid.
//   - A Cash on Delivery order is marked paid (cash collected) when it is Delivered.
//   - Cancelling is allowed while New / Pending / Processing, and puts the
//     stock back once. Customers can't cancel an order that is already paid.

const { handleCors, readJsonBody, requireUser, getAdmin, sendError, HttpError } = require("./_lib/payments");

const STAFF_ROLES = ["staff", "admin", "superadmin"];
const CANCELLABLE = ["New", "Pending", "Processing"];
const NEXT_STATUS = {
  New: "Pending",
  Pending: "Processing",
  Processing: "Shipped",
  Shipped: "Delivered",
};

module.exports = async function handler(req, res) {
  if (!handleCors(req, res)) return;
  try {
    const user = await requireUser(req);
    const admin = getAdmin();
    const db = admin.firestore();
    const FieldValue = admin.firestore.FieldValue;

    let body;
    try {
      body = readJsonBody(req);
    } catch {
      throw new HttpError(400, "Invalid request.");
    }
    const orderId = body.orderId;
    if (typeof orderId !== "string" || !/^[A-Za-z0-9]{10,40}$/.test(orderId)) {
      throw new HttpError(400, "Invalid order.");
    }
    const action = body.action;
    if (action !== "status" && action !== "cancel") throw new HttpError(400, "Invalid request.");

    const profile = await db.collection("users").doc(user.uid).get();
    const isStaff = STAFF_ROLES.includes(profile.get("role"));

    const orderRef = db.collection("orders").doc(orderId);
    const result = await db.runTransaction(async (t) => {
      const snap = await t.get(orderRef);
      if (!snap.exists) throw new HttpError(404, "Order not found.");
      const order = snap.data();
      const isOwner = order.userId === user.uid;
      if (!isOwner && !isStaff) throw new HttpError(404, "Order not found.");

      const current = order.status || "Pending";
      if (current === "Cancelled") throw new HttpError(409, "This order is already cancelled.");
      if (current === "Delivered") throw new HttpError(409, "This order was already delivered.");

      const update = { statusUpdatedAt: FieldValue.serverTimestamp() };
      let paymentStatus = order.paymentStatus;

      if (action === "cancel") {
        if (!CANCELLABLE.includes(current)) {
          throw new HttpError(409, `An order that is ${current} can't be cancelled.`);
        }
        if (!isStaff && order.paymentStatus === "paid") {
          throw new HttpError(409, "This order is already paid. Please contact the store to cancel it.");
        }
        update.status = "Cancelled";
        update.cancelledBy = isStaff ? "staff" : "customer";

        // Put the stock back, once. Orders from before stock tracking
        // (no stockDeducted flag) never took any, so they give none back.
        if (order.stockDeducted === true && order.stockRestored !== true) {
          const items = Array.isArray(order.items) ? order.items : [];
          const productSnaps = items.length
            ? await t.getAll(...items.map((i) => db.collection("products").doc(i.id)))
            : [];
          productSnaps.forEach((p, i) => {
            if (!p.exists) return;
            const qty = Number(items[i].qty) || 0;
            const back = {};
            if (typeof p.get("stock") === "number") back.stock = p.get("stock") + qty;
            // The sale no longer counts towards "popular".
            if (typeof p.get("soldCount") === "number") back.soldCount = Math.max(0, p.get("soldCount") - qty);
            if (Object.keys(back).length) t.update(p.ref, back);
          });
          update.stockRestored = true;
        }
      } else {
        if (!isStaff) throw new HttpError(403, "Only staff can change an order's status.");
        const wanted = body.status;
        if (NEXT_STATUS[current] !== wanted) {
          throw new HttpError(
            409,
            NEXT_STATUS[current]
              ? `This order is ${current}; its next step is ${NEXT_STATUS[current]}.`
              : `This order is ${current} and can't move on.`,
          );
        }
        const method = order.shippingInfo?.paymentMethod === "online" ? "online" : "cod";
        if (method === "online" && order.paymentStatus !== "paid" && wanted !== "Pending") {
          throw new HttpError(409, "This order is waiting for its online payment, so it can't be processed or shipped yet.");
        }
        update.status = wanted;
        // Cash is collected at the door: record it when the order is delivered.
        if (wanted === "Delivered" && method === "cod") {
          update.paymentStatus = "paid";
          update.payment = {
            provider: "cod",
            amount: Number(order.total) || 0,
            paidAt: FieldValue.serverTimestamp(),
            collectedBy: user.uid,
          };
          paymentStatus = "paid";
        }
      }

      t.update(orderRef, update);
      return { status: update.status, paymentStatus };
    });

    res.status(200).json(result);
  } catch (err) {
    sendError(res, err);
  }
};

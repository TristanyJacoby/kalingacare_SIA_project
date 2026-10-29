// api/manage-return.js — returns and refunds. A customer asks to return
// items from a Delivered order (within the return window set in Admin >
// Settings); staff approve or reject; an admin issues the refund (online
// payments are refunded through PayMongo, cash orders are refunded directly
// by the store and marked here). Clients can't write returns (Firestore
// rules), so every rule is enforced in this file.
//
// POST with "Authorization: Bearer <Firebase ID token>":
//   { action: "request", orderId, itemIds?: [productId], reason, note? }     (the customer)
//   { action: "cancel",  returnId }                                          (the customer, while Requested)
//   { action: "decide",  returnId, decision: "approve" | "reject", staffNote? }   (staff and up)
//   { action: "refund",  returnId, restock: bool, manual?: bool, reference? }     (admin and up)
// Returns { id?, status, refundAmount? }.
//
// Flow: Requested > Approved > Refunded  (or Rejected, or Cancelled by the customer)

const { handleCors, readJsonBody, requireUser, getAdmin, sendError, HttpError, paymongo } = require("./_lib/payments");
const { getStoreSettings } = require("./_lib/settings");
const { notifyReturn } = require("./_lib/notify");
const { logAudit, actorFrom, shortOrder } = require("./_lib/audit");

const STAFF = ["staff", "admin", "superadmin"];
const ADMIN = ["admin", "superadmin"];
const REASONS = {
  damaged: "Arrived damaged",
  wrong_item: "Wrong item received",
  not_as_described: "Not as described",
  changed_mind: "Changed my mind",
  other: "Other",
};

const text = (v, max) => String(v ?? "").trim().slice(0, max);
const money = (n) => Math.round(Number(n) * 100) / 100;

// The part of the order's cost that belongs to the returned items, with the
// order's promo discount shared out in proportion. Shipping isn't refunded.
function refundFor(order, items) {
  const subtotal = Number(order.subtotal) || (order.items || []).reduce((s, i) => s + i.price * i.qty, 0);
  const picked = items.reduce((s, i) => s + i.price * i.qty, 0);
  const discount = Math.min(Number(order.discount) || 0, subtotal);
  return subtotal > 0 ? money(picked * (1 - discount / subtotal)) : 0;
}

module.exports = async function handler(req, res) {
  if (!handleCors(req, res)) return;
  try {
    const user = await requireUser(req);
    const admin = getAdmin();
    const db = admin.firestore();
    const FieldValue = admin.firestore.FieldValue;

    const profile = await db.collection("users").doc(user.uid).get();
    if (profile.get("disabled") === true) {
      throw new HttpError(403, "Your account is suspended. Please contact support.");
    }
    const role = profile.get("role") || "user";
    const actor = actorFrom(user.uid, user, profile);

    let body;
    try {
      body = readJsonBody(req);
    } catch {
      throw new HttpError(400, "Invalid request.");
    }
    const audit = (action, ret, summary, details) =>
      logAudit(admin, {
        actor,
        action,
        targetType: "return",
        targetId: ret.id,
        targetLabel: `Return for order ${shortOrder(ret.orderId)}${ret.invoiceNo ? ` (${ret.invoiceNo})` : ""}`,
        summary,
        details,
      });

    /* ---------- the customer asks for a return ---------- */
    if (body.action === "request") {
      const orderId = String(body.orderId || "");
      if (!/^[A-Za-z0-9]{10,40}$/.test(orderId)) throw new HttpError(400, "Invalid order.");
      const reason = String(body.reason || "");
      if (!REASONS[reason]) throw new HttpError(400, "Please choose a reason for the return.");
      const note = text(body.note, 500);
      if (reason === "other" && note.length < 5) throw new HttpError(400, "Please tell us a little more about the problem.");

      const settings = await getStoreSettings(db);
      if (settings.returnWindowDays <= 0) throw new HttpError(409, "Returns aren't being accepted right now. Please contact support.");

      const orderRef = db.collection("orders").doc(orderId);
      const retRef = db.collection("returns").doc();
      const created = await db.runTransaction(async (t) => {
        const snap = await t.get(orderRef);
        if (!snap.exists || snap.get("userId") !== user.uid) throw new HttpError(404, "Order not found.");
        const order = snap.data();
        if (order.status !== "Delivered") throw new HttpError(409, "You can ask for a return once the order has been delivered.");

        const deliveredAt = (order.statusUpdatedAt || order.createdAt)?.toMillis?.() || 0;
        const daysSince = (Date.now() - deliveredAt) / 86400000;
        if (deliveredAt && daysSince > settings.returnWindowDays) {
          throw new HttpError(409, `Returns are accepted within ${settings.returnWindowDays} days of delivery, and this order was delivered longer ago.`);
        }

        const existing = await t.get(db.collection("returns").where("orderId", "==", orderId));
        if (existing.docs.some((d) => d.get("status") !== "Cancelled")) {
          throw new HttpError(409, "This order already has a return request.");
        }

        const wanted = Array.isArray(body.itemIds) && body.itemIds.length ? new Set(body.itemIds.map(String)) : null;
        const items = (order.items || [])
          .filter((i) => !wanted || wanted.has(String(i.id)))
          .map((i) => ({ id: i.id, name: i.name, qty: i.qty, price: i.price }));
        if (!items.length || (wanted && items.length !== wanted.size)) throw new HttpError(400, "Choose at least one item from this order.");

        const ret = {
          orderId,
          userId: user.uid,
          invoiceNo: order.invoiceNo || "",
          customerName: order.shippingInfo?.fullName || profile.get("fullName") || "",
          items,
          reason,
          reasonLabel: REASONS[reason],
          note,
          status: "Requested",
          refundAmount: refundFor(order, items),
          paymentMethod: order.shippingInfo?.paymentMethod === "online" ? "online" : "cod",
          paid: order.paymentStatus === "paid",
          requestedAt: FieldValue.serverTimestamp(),
        };
        t.set(retRef, ret);
        t.update(orderRef, { returnStatus: "Requested", returnId: retRef.id });
        return ret;
      });
      const ret = { ...created, id: retRef.id };
      await audit("return.request", ret, `Asked to return ${ret.items.length} item${ret.items.length === 1 ? "" : "s"} from order ${shortOrder(orderId)} (${REASONS[reason]}); expected refund ₱${ret.refundAmount}.`, { reason, items: ret.items.map((i) => `${i.name} x${i.qty}`) });
      await notifyReturn(admin, "requested", ret);
      return res.status(200).json({ id: ret.id, status: "Requested", refundAmount: ret.refundAmount });
    }

    /* ---------- everything else acts on an existing return ---------- */
    const returnId = String(body.returnId || "");
    if (!/^[A-Za-z0-9]{10,40}$/.test(returnId)) throw new HttpError(400, "Invalid return.");
    const retRef = db.collection("returns").doc(returnId);

    if (body.action === "cancel") {
      const result = await db.runTransaction(async (t) => {
        const snap = await t.get(retRef);
        if (!snap.exists || snap.get("userId") !== user.uid) throw new HttpError(404, "Return not found.");
        if (snap.get("status") !== "Requested") throw new HttpError(409, "Only a request that hasn't been reviewed yet can be withdrawn.");
        t.update(retRef, { status: "Cancelled", decidedAt: FieldValue.serverTimestamp() });
        t.update(db.collection("orders").doc(snap.get("orderId")), { returnStatus: FieldValue.delete(), returnId: FieldValue.delete() });
        return { id: returnId, ...snap.data() };
      });
      await audit("return.cancel", result, `Withdrew the return request for order ${shortOrder(result.orderId)}.`);
      return res.status(200).json({ status: "Cancelled" });
    }

    if (body.action === "decide") {
      if (!STAFF.includes(role)) throw new HttpError(403, "Only staff can review returns.");
      const approve = body.decision === "approve";
      if (!approve && body.decision !== "reject") throw new HttpError(400, "Invalid decision.");
      const staffNote = text(body.staffNote, 500);
      if (!approve && staffNote.length < 3) throw new HttpError(400, "Please give the customer a reason for declining.");
      const status = approve ? "Approved" : "Rejected";

      const ret = await db.runTransaction(async (t) => {
        const snap = await t.get(retRef);
        if (!snap.exists) throw new HttpError(404, "Return not found.");
        if (snap.get("status") !== "Requested") throw new HttpError(409, `This return is already ${snap.get("status")}.`);
        t.update(retRef, { status, staffNote, decidedAt: FieldValue.serverTimestamp(), decidedBy: user.uid, decidedByName: actor.name });
        t.update(db.collection("orders").doc(snap.get("orderId")), { returnStatus: status });
        return { id: returnId, ...snap.data(), status, staffNote };
      });
      await audit(approve ? "return.approve" : "return.reject", ret, `${approve ? "Approved" : "Declined"} the return for order ${shortOrder(ret.orderId)}${staffNote ? `: "${staffNote.slice(0, 80)}"` : ""}.`);
      await notifyReturn(admin, approve ? "approved" : "rejected", ret);
      return res.status(200).json({ status });
    }

    if (body.action === "refund") {
      if (!ADMIN.includes(role)) throw new HttpError(403, "Only an Admin or Super Admin can issue refunds.");
      const restock = body.restock === true;
      const manual = body.manual === true;
      const reference = text(body.reference, 120);

      // Lock the return first so a double click can't refund twice.
      const ret = await db.runTransaction(async (t) => {
        const snap = await t.get(retRef);
        if (!snap.exists) throw new HttpError(404, "Return not found.");
        if (snap.get("status") !== "Approved") throw new HttpError(409, snap.get("status") === "Refunded" ? "This return was already refunded." : "Approve the return before refunding it.");
        t.update(retRef, { status: "Refunding" });
        return { id: returnId, ...snap.data() };
      });

      const orderRef = db.collection("orders").doc(ret.orderId);
      const unlock = () => retRef.update({ status: "Approved" }).catch(() => {});
      let mode = "manual";
      let refundId = "";
      try {
        const orderSnap = await orderRef.get();
        const order = orderSnap.data() || {};
        const paymentId = order.payment?.paymentId;
        const online = order.shippingInfo?.paymentMethod === "online" && order.paymentStatus === "paid" && paymentId;
        if (online && !manual) {
          const created = await paymongo("/refunds", {
            method: "POST",
            body: JSON.stringify({
              data: {
                attributes: {
                  amount: Math.round(Number(ret.refundAmount) * 100),
                  payment_id: paymentId,
                  reason: "requested_by_customer",
                  notes: `Return for order ${shortOrder(ret.orderId)}`.slice(0, 255),
                },
              },
            }),
          });
          mode = "paymongo";
          refundId = created?.id || "";
        } else if (!online && !manual && order.shippingInfo?.paymentMethod === "online") {
          throw new HttpError(409, "This online order was never marked paid, so there is nothing to refund through PayMongo.");
        }
      } catch (err) {
        await unlock();
        if (err instanceof HttpError && err.status === 502) {
          throw new HttpError(502, `PayMongo couldn't issue the refund (${err.message}). If you refunded the customer another way, mark it refunded manually.`);
        }
        throw err;
      }

      try {
        await db.runTransaction(async (t) => {
          // Reads first: the returned products, then the writes.
          const prods = restock
            ? await t.getAll(...ret.items.map((i) => db.collection("products").doc(String(i.id))))
            : [];
          prods.forEach((p, idx) => {
            if (!p.exists) return;
            const qty = Number(ret.items[idx].qty) || 0;
            const back = {};
            if (typeof p.get("stock") === "number") back.stock = p.get("stock") + qty;
            if (typeof p.get("soldCount") === "number") back.soldCount = Math.max(0, p.get("soldCount") - qty);
            if (Object.keys(back).length) t.update(p.ref, back);
          });
          t.update(retRef, {
            status: "Refunded",
            refundedAt: FieldValue.serverTimestamp(),
            refundedBy: user.uid,
            refundedByName: actor.name,
            refundMode: mode,
            refundId,
            refundReference: reference,
            restocked: restock,
          });
          t.update(orderRef, { returnStatus: "Refunded", refundedAmount: Number(ret.refundAmount) });
        });
      } catch (err) {
        // The money has moved but the records didn't update: say so loudly.
        console.error("Refund issued but the records failed to update:", returnId, mode, refundId, err);
        await retRef.update({ status: "Refunded", refundMode: mode, refundId, refundReference: reference, restocked: false }).catch(() => {});
        throw new HttpError(500, "The refund was issued, but saving it hit a problem. Check the return before doing anything else.");
      }

      const done = { ...ret, status: "Refunded", refundMode: mode };
      await audit("return.refund", done, `Refunded ₱${ret.refundAmount} for order ${shortOrder(ret.orderId)} (${mode === "paymongo" ? "through PayMongo" : "manually"}${reference ? `, ref ${reference}` : ""})${restock ? "; items back in stock" : ""}.`, { amount: ret.refundAmount, mode, refundId, restock });
      await notifyReturn(admin, "refunded", done);
      return res.status(200).json({ status: "Refunded", refundAmount: ret.refundAmount, mode });
    }

    throw new HttpError(400, "Invalid request.");
  } catch (err) {
    sendError(res, err);
  }
};

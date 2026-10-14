// api/verify-payment.js — asks PayMongo whether an order's checkout was paid.
//
// POST { orderId } with "Authorization: Bearer <Firebase ID token>".
// Called by the return page and the mobile app when the customer comes back
// from PayMongo. The webhook normally marks the order paid first; this is
// the backup so a delayed or missed webhook doesn't leave a paid order
// looking unpaid. Returns { paymentStatus }.

const {
  handleCors,
  readJsonBody,
  requireUser,
  loadOwnOnlineOrder,
  paymongo,
  syncPaymentFromSession,
  sendError,
} = require("./_lib/payments");

module.exports = async function handler(req, res) {
  if (!handleCors(req, res)) return;
  try {
    const user = await requireUser(req);
    const { orderId } = readJsonBody(req);
    const { ref, order } = await loadOwnOnlineOrder(orderId, user.uid);

    if (order.paymentStatus === "paid") return res.status(200).json({ paymentStatus: "paid" });
    if (!order.paymentSessionId) return res.status(200).json({ paymentStatus: "pending" });

    const session = await paymongo(`/checkout_sessions/${encodeURIComponent(order.paymentSessionId)}`);
    const status = await syncPaymentFromSession(ref, session);
    res.status(200).json({ paymentStatus: status || "pending" });
  } catch (err) {
    sendError(res, err);
  }
};

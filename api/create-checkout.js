// api/create-checkout.js — starts a PayMongo hosted checkout for an order.
//
// POST { orderId } with "Authorization: Bearer <Firebase ID token>".
// The order must already exist (written by the client with
// paymentMethod "online" and paymentStatus "pending"). The amount charged is
// recomputed here from Firestore product prices, never taken from the client.
// Returns { checkoutUrl }.

const {
  handleCors,
  readJsonBody,
  requireUser,
  loadOwnOnlineOrder,
  computeOrderTotal,
  paymongo,
  returnBaseUrl,
  sendError,
  HttpError,
} = require("./_lib/payments");

const METHODS = (process.env.PAYMONGO_METHODS || "card,gcash,paymaya")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

module.exports = async function handler(req, res) {
  if (!handleCors(req, res)) return;
  try {
    const user = await requireUser(req);
    const { orderId } = readJsonBody(req);
    const { ref, order } = await loadOwnOnlineOrder(orderId, user.uid);

    if (order.paymentStatus === "paid") throw new HttpError(409, "This order is already paid.");
    if (order.status === "Cancelled") throw new HttpError(409, "This order was cancelled.");

    const total = await computeOrderTotal(orderId, order);
    const itemSummary = order.items
      .map((item) => `${item.qty} × ${item.name}`)
      .join(", ")
      .slice(0, 255);
    const base = returnBaseUrl(req);
    // Customers paying from the mobile app land on the public site, where
    // they aren't signed in; the page then just tells them to go back to
    // the app, which confirms the payment itself.
    const fromApp = base !== (req.headers.origin || "") ? "&app=1" : "";
    const info = order.shippingInfo || {};

    const session = await paymongo("/checkout_sessions", {
      method: "POST",
      body: JSON.stringify({
        data: {
          attributes: {
            // One line for the whole order: PayMongo has no discount lines,
            // and this keeps the charged amount equal to the order total.
            line_items: [
              {
                name: `KalingaCare order ${orderId.slice(0, 8).toUpperCase()}`,
                description: itemSummary,
                amount: Math.round(total * 100), // centavos
                currency: "PHP",
                quantity: 1,
              },
            ],
            payment_method_types: METHODS,
            reference_number: orderId,
            description: "KalingaCare order",
            success_url: `${base}/payment-return.html?order=${orderId}${fromApp}`,
            cancel_url: `${base}/payment-return.html?order=${orderId}&cancelled=1${fromApp}`,
            billing: {
              name: info.fullName || undefined,
              email: info.email || undefined,
              phone: info.phone || undefined,
            },
            metadata: { orderId, userId: user.uid },
          },
        },
      }),
    });

    await ref.update({ paymentSessionId: session.id });
    res.status(200).json({ checkoutUrl: session.attributes.checkout_url });
  } catch (err) {
    sendError(res, err);
  }
};

// api/paymongo-webhook.js — receives PayMongo events.
//
// Register this URL in the PayMongo dashboard (Developers → Webhooks) for the
// event checkout_session.payment.paid, and put the webhook's secret in the
// PAYMONGO_WEBHOOK_SECRET env var. Every request's signature is checked
// against the raw body before anything else happens.

const crypto = require("crypto");
const { getAdmin, syncPaymentFromSession } = require("./_lib/payments");

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function safeEqual(a, b) {
  const ab = Buffer.from(a || "", "utf8");
  const bb = Buffer.from(b || "", "utf8");
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function hmac(secret, text) {
  return crypto.createHmac("sha256", secret).update(text).digest("hex");
}

// PayMongo's header looks like "t=<timestamp>,te=<test sig>,li=<live sig>",
// signing "<timestamp>.<raw body>". A bare signature over the raw body is
// also accepted.
function signatureValid(header, rawBody, secret) {
  const parts = Object.fromEntries(
    String(header || "")
      .split(",")
      .map((p) => p.trim().split("="))
      .filter((kv) => kv.length === 2)
  );
  if (parts.t) {
    const expected = hmac(secret, `${parts.t}.${rawBody}`);
    return safeEqual(expected, parts.te) || safeEqual(expected, parts.li);
  }
  return safeEqual(hmac(secret, rawBody), String(header || "").trim());
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const secret = process.env.PAYMONGO_WEBHOOK_SECRET;
  if (!secret) return res.status(500).json({ error: "Server is missing PAYMONGO_WEBHOOK_SECRET" });

  const rawBody = await readRawBody(req);
  const header = req.headers["paymongo-signature"] || req.headers["x-paymongo-signature"];
  if (!signatureValid(header, rawBody, secret)) {
    console.error("PayMongo webhook: bad signature");
    return res.status(401).json({ error: "Invalid signature" });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  const type = event?.data?.attributes?.type;
  if (type !== "checkout_session.payment.paid") return res.status(200).json({ ignored: type });

  try {
    const session = event.data.attributes.data;
    const orderId = session?.attributes?.reference_number || session?.attributes?.metadata?.orderId;
    if (!orderId) return res.status(200).json({ ignored: "no order reference" });

    const ref = getAdmin().firestore().collection("orders").doc(String(orderId));
    const status = await syncPaymentFromSession(ref, session);
    res.status(200).json({ orderId, paymentStatus: status });
  } catch (err) {
    // A non-200 makes PayMongo retry the delivery later.
    console.error("PayMongo webhook failed", err);
    res.status(500).json({ error: "Could not record payment" });
  }
};

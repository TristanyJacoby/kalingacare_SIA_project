// api/_lib/promos.js — promo codes. They live in the Firestore collection
// promos (one document per code, managed on Admin > Promotions through
// api/manage-content.js). Until a code has been managed there, the two
// original codes below keep working so nothing breaks; the first change in
// Admin copies them into Firestore and sets settings/promos { seeded: true },
// after which Firestore is the only source (so deleting a code really removes it).

const DEFAULT_PROMOS = {
  WELCOME10: { type: "percent", value: 10, firstOrderOnly: true, label: "10% off your first order", active: true },
  CARE50: { type: "flat", value: 50, firstOrderOnly: false, label: "₱50 off your order", active: true },
};

const CODE_RE = /^[A-Z0-9]{3,20}$/;

async function isSeeded(db) {
  const snap = await db.collection("settings").doc("promos").get();
  return snap.exists && snap.get("seeded") === true;
}

// Copies the original codes into Firestore the first time (idempotent).
async function seedPromos(admin) {
  const db = admin.firestore();
  if (await isSeeded(db)) return false;
  const batch = db.batch();
  for (const [code, p] of Object.entries(DEFAULT_PROMOS)) {
    const ref = db.collection("promos").doc(code);
    if (!(await ref.get()).exists) {
      batch.set(ref, { code, ...p, expiresAt: null, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    }
  }
  batch.set(db.collection("settings").doc("promos"), { seeded: true });
  await batch.commit();
  return true;
}

// Returns { code, type, value, firstOrderOnly, label } or throws a
// { status, message } for the caller to turn into an HttpError.
async function lookupPromo(db, rawCode) {
  const code = String(rawCode || "").trim().toUpperCase();
  if (!CODE_RE.test(code)) return { error: "That promo code isn't valid." };
  let promo = null;
  const snap = await db.collection("promos").doc(code).get();
  if (snap.exists) {
    promo = snap.data();
  } else if (!(await isSeeded(db))) {
    promo = DEFAULT_PROMOS[code] || null;
  }
  if (!promo || promo.active === false) return { error: "That promo code isn't valid." };
  const expires = promo.expiresAt?.toMillis ? promo.expiresAt.toMillis() : null;
  if (expires && expires < Date.now()) return { error: "That promo code has expired." };
  return {
    promo: {
      code,
      type: promo.type === "percent" ? "percent" : "flat",
      value: Number(promo.value) || 0,
      firstOrderOnly: promo.firstOrderOnly === true,
      label: promo.label || "",
    },
  };
}

module.exports = { DEFAULT_PROMOS, CODE_RE, lookupPromo, seedPromos, isSeeded };

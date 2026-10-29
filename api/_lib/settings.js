// api/_lib/settings.js — the store's platform settings (Firestore doc
// settings/store, edited on Admin > Settings through api/manage-content.js).
// Clients read the same doc to show the shipping fee and payment options,
// but the server is what actually applies them to an order.

const DEFAULT_SETTINGS = {
  shippingFee: 150, // PHP per order
  freeShippingOver: 0, // PHP; 0 = shipping is never free
  codEnabled: true,
  onlineEnabled: true,
  emailOrderConfirmation: true,
  emailShipped: true,
  emailDelivered: true,
  emailCancelled: true,
  returnWindowDays: 7, // days after delivery a customer can ask for a return; 0 = returns off
  emailReturns: true,
};

function num(value, fallback, min, max) {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

// Anything missing or out of range falls back to the default, so a bad
// document can never break ordering.
function sanitizeSettings(raw) {
  const d = DEFAULT_SETTINGS;
  const s = raw || {};
  const bool = (key) => (typeof s[key] === "boolean" ? s[key] : d[key]);
  const settings = {
    shippingFee: num(s.shippingFee, d.shippingFee, 0, 10000),
    freeShippingOver: num(s.freeShippingOver, d.freeShippingOver, 0, 1000000),
    codEnabled: bool("codEnabled"),
    onlineEnabled: bool("onlineEnabled"),
    emailOrderConfirmation: bool("emailOrderConfirmation"),
    emailShipped: bool("emailShipped"),
    emailDelivered: bool("emailDelivered"),
    emailCancelled: bool("emailCancelled"),
    returnWindowDays: Number.isInteger(Number(s.returnWindowDays)) ? num(s.returnWindowDays, d.returnWindowDays, 0, 60) : d.returnWindowDays,
    emailReturns: bool("emailReturns"),
  };
  // Customers must always have a way to pay.
  if (!settings.codEnabled && !settings.onlineEnabled) settings.codEnabled = true;
  return settings;
}

let cache = { at: 0, value: DEFAULT_SETTINGS };

async function getStoreSettings(db) {
  if (Date.now() - cache.at < 15 * 1000) return cache.value;
  try {
    const snap = await db.collection("settings").doc("store").get();
    cache = { at: Date.now(), value: sanitizeSettings(snap.exists ? snap.data() : null) };
  } catch (err) {
    console.error("Couldn't read store settings, using defaults:", err);
    cache = { at: Date.now(), value: DEFAULT_SETTINGS };
  }
  return cache.value;
}

function clearSettingsCache() {
  cache = { at: 0, value: DEFAULT_SETTINGS };
}

// Shipping for an order whose items add up to `subtotal` (before any promo).
function shippingFor(subtotal, settings) {
  return settings.freeShippingOver > 0 && subtotal >= settings.freeShippingOver ? 0 : settings.shippingFee;
}

module.exports = { DEFAULT_SETTINGS, sanitizeSettings, getStoreSettings, clearSettingsCache, shippingFor };

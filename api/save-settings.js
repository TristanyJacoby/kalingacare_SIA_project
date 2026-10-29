// api/save-settings.js — saves the store's platform settings (Admin >
// Settings). Admins and Super Admins only; clients can't write the
// settings document themselves (Firestore rules), so values are checked here.
//
// POST with "Authorization: Bearer <Firebase ID token>":
//   { action: "save", settings: { shippingFee, freeShippingOver, codEnabled, onlineEnabled,
//                                 emailOrderConfirmation, emailShipped, emailDelivered, emailCancelled,
//                                 returnWindowDays, emailReturns } }
//   { action: "testEmail" }   sends a sample order confirmation to the signed-in admin
// Returns { settings } or { sent }.

const { handleCors, readJsonBody, requireUser, getAdmin, sendError, HttpError } = require("./_lib/payments");
const { DEFAULT_SETTINGS, sanitizeSettings, clearSettingsCache } = require("./_lib/settings");
const { sendSampleEmail } = require("./_lib/notify");
const { logAudit, actorFrom } = require("./_lib/audit");

module.exports = async function handler(req, res) {
  if (!handleCors(req, res)) return;
  try {
    const caller = await requireUser(req);
    const admin = getAdmin();
    const db = admin.firestore();

    const profile = await db.collection("users").doc(caller.uid).get();
    if (!["admin", "superadmin"].includes(profile.get("role"))) {
      throw new HttpError(403, "Only an Admin or Super Admin can change store settings.");
    }

    let body;
    try {
      body = readJsonBody(req);
    } catch {
      throw new HttpError(400, "Invalid request.");
    }

    if (body.action === "testEmail") {
      if (!caller.email) throw new HttpError(400, "Your account has no email address.");
      const sent = await sendSampleEmail(caller.email, profile.get("fullName") || "");
      if (!sent) throw new HttpError(503, "The email couldn't be sent. Check the Gmail settings on the server.");
      return res.status(200).json({ sent: true });
    }

    if (body.action !== "save") throw new HttpError(400, "Invalid request.");
    const input = body.settings || {};

    const fee = Number(input.shippingFee);
    if (!Number.isFinite(fee) || fee < 0 || fee > 10000) {
      throw new HttpError(400, "The shipping fee must be between 0 and 10,000.");
    }
    const free = Number(input.freeShippingOver || 0);
    if (!Number.isFinite(free) || free < 0 || free > 1000000) {
      throw new HttpError(400, "The free-shipping amount must be 0 (off) or more.");
    }
    const windowDays = Number(input.returnWindowDays ?? 7);
    if (!Number.isInteger(windowDays) || windowDays < 0 || windowDays > 60) {
      throw new HttpError(400, "The return window must be a whole number of days from 0 (no returns) to 60.");
    }
    if (input.codEnabled !== true && input.onlineEnabled !== true) {
      throw new HttpError(400, "Keep at least one payment option turned on.");
    }

    const settings = sanitizeSettings({ ...DEFAULT_SETTINGS, ...input, shippingFee: fee, freeShippingOver: free, returnWindowDays: windowDays });
    const before = sanitizeSettings((await db.collection("settings").doc("store").get()).data());
    const changes = Object.keys(settings)
      .filter((k) => settings[k] !== before[k])
      .map((k) => `${k}: ${before[k]} \u2192 ${settings[k]}`);
    await db.collection("settings").doc("store").set({
      ...settings,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: caller.uid,
    });
    clearSettingsCache();
    if (changes.length) {
      await logAudit(admin, {
        actor: actorFrom(caller.uid, caller, profile, "admin"),
        action: "settings.update",
        targetType: "settings",
        targetId: "store",
        targetLabel: "Store settings",
        summary: `Changed store settings: ${changes.join(", ")}.`,
        details: { changes },
      });
    }
    res.status(200).json({ settings });
  } catch (err) {
    sendError(res, err);
  }
};

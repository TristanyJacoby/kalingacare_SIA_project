// api/_lib/audit.js — the audit trail. Every important change is recorded in
// the auditLogs collection: who did it, what, to what, and when. Server
// functions write these with the Admin SDK (so they can't be forged from a
// browser); only Admins and Super Admins can read them (Admin > Audit Trail),
// and nobody can edit or delete an entry (Firestore rules).
//
// An entry:
//   { at, actorId, actorName, actorEmail, actorRole,
//     action, targetType, targetId, targetLabel, summary, details? }
// actorRole is "customer", "staff", "admin", "superadmin" or "system".

const clip = (v, n) => String(v ?? "").slice(0, n);

// Never throws: a failed log must not break the action it describes.
async function logAudit(admin, { actor, action, targetType, targetId, targetLabel, summary, details }) {
  try {
    const entry = {
      at: admin.firestore.FieldValue.serverTimestamp(),
      actorId: clip(actor?.id || "system", 128),
      actorName: clip(actor?.name || actor?.email || "System", 120),
      actorEmail: clip(actor?.email || "", 254),
      actorRole: clip(actor?.role || "system", 20),
      action: clip(action, 40),
      targetType: clip(targetType, 20),
      targetId: clip(targetId, 128),
      targetLabel: clip(targetLabel, 160),
      summary: clip(summary, 400),
    };
    if (details && JSON.stringify(details).length <= 2000) entry.details = details;
    await admin.firestore().collection("auditLogs").add(entry);
  } catch (err) {
    console.error("Couldn't write the audit log:", err);
  }
}

// Staff-side actor from a Firestore profile snapshot + the verified token.
function actorFrom(uid, token, profile, fallbackRole = "customer") {
  return {
    id: uid,
    name: profile?.get?.("fullName") || token?.name || token?.email || "",
    email: token?.email || profile?.get?.("email") || "",
    role: profile?.get?.("role") && profile.get("role") !== "user" ? profile.get("role") : fallbackRole,
  };
}

const shortOrder = (id) => `#${String(id).slice(0, 8).toUpperCase()}`;

module.exports = { logAudit, actorFrom, shortOrder };

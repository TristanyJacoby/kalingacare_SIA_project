// api/manage-user.js — user management for Super Admins: add staff/admin
// accounts, edit details, change roles, suspend/reactivate and delete.
// Everything that touches a login (Firebase Auth) has to happen on the
// server, so the Users page calls this instead of writing to Firestore.
//
// POST with "Authorization: Bearer <Firebase ID token>" (caller must be a
// superadmin in Firestore):
//   { action: "create",       email, fullName, role: "staff" | "admin" }
//   { action: "update",       uid, fullName?, country?, currency? }
//   { action: "setRole",      uid, role }
//   { action: "setSuspended", uid, suspended: true | false }
//   { action: "delete",       uid }                    (staff/admin accounts only)
//
// Env vars (Vercel): GMAIL_USER, GMAIL_APP_PASSWORD for the invitation email.

const nodemailer = require("nodemailer");
const crypto = require("crypto");
const { handleCors, readJsonBody, requireUser, getAdmin, sendError, HttpError } = require("./_lib/payments");
const { logAudit, actorFrom } = require("./_lib/audit");

const PUBLIC_SITE_URL = (
  process.env.PUBLIC_SITE_URL || "https://kalingacare-drab.vercel.app"
).replace(/\/$/, "");
const ROLES = ["user", "staff", "admin", "superadmin"];
const INVITE_ROLES = ["staff", "admin"];
const ROLE_LABEL = { staff: "Staff", admin: "Admin" };

const text = (v, max) => String(v ?? "").trim().slice(0, max);
const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

async function sendInvite({ to, name, role, link }) {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return false;
  const first = escapeHtml(name.split(" ")[0] || "there");
  const label = ROLE_LABEL[role] || role;
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f2f9ff;font-family:Poppins,Arial,sans-serif;color:#1e293b;">
    <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #dce8f0;border-radius:18px;padding:32px;">
      <div style="font-size:22px;font-weight:bold;color:#1778ad;">KalingaCare</div>
      <p style="font-size:15px;line-height:1.6;">Hi ${first},</p>
      <p style="font-size:15px;line-height:1.6;">You've been added to the KalingaCare team as <strong>${escapeHtml(label)}</strong>. Set your password to sign in:</p>
      <p style="text-align:center;margin:28px 0;"><a href="${escapeHtml(link)}" style="background:#1778ad;color:#fff;text-decoration:none;font-weight:bold;padding:14px 34px;border-radius:999px;display:inline-block;">Set my password</a></p>
      <p style="font-size:13px;color:#5c6b7f;line-height:1.6;">After that, sign in at ${PUBLIC_SITE_URL}/login.html with this email address. If you weren't expecting this, you can ignore the message.</p>
    </div></body></html>`;
  const plain = `Hi ${name.split(" ")[0] || "there"},\n\nYou've been added to the KalingaCare team as ${label}. Set your password here:\n${link}\n\nThen sign in at ${PUBLIC_SITE_URL}/login.html with this email address.`;
  const transport = nodemailer.createTransport({ service: "gmail", auth: { user, pass: pass.replace(/\s+/g, "") } });
  await transport.sendMail({
    from: `"KalingaCare" <${user}>`,
    to,
    subject: "You've been added to KalingaCare",
    text: plain,
    html,
  });
  return true;
}

module.exports = async function handler(req, res) {
  if (!handleCors(req, res)) return;
  try {
    const caller = await requireUser(req);
    const admin = getAdmin();
    const db = admin.firestore();
    const FieldValue = admin.firestore.FieldValue;

    const callerSnap = await db.collection("users").doc(caller.uid).get();
    if (callerSnap.get("role") !== "superadmin") {
      throw new HttpError(403, "Only a Super Admin can manage users.");
    }

    let body;
    try {
      body = readJsonBody(req);
    } catch {
      throw new HttpError(400, "Invalid request.");
    }

    const action = body.action;
    const actor = actorFrom(caller.uid, caller, callerSnap, "superadmin");
    const audit = (a, targetId, targetLabel, summary, details) =>
      logAudit(admin, { actor, action: a, targetType: "user", targetId, targetLabel, summary, details });

    if (action === "create") {
      const email = text(body.email, 254).toLowerCase();
      const fullName = text(body.fullName, 120);
      const role = body.role;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Enter a valid email address.");
      if (!fullName) throw new HttpError(400, "Enter the person's name.");
      if (!INVITE_ROLES.includes(role)) throw new HttpError(400, "Role must be Staff or Admin.");

      let created;
      try {
        created = await admin.auth().createUser({
          email,
          displayName: fullName,
          // Nobody knows this password: they set their own from the invitation link.
          password: crypto.randomBytes(24).toString("base64url"),
          emailVerified: true,
        });
      } catch (err) {
        if (err.code === "auth/email-already-exists") {
          throw new HttpError(409, "An account with that email already exists. Change its role from the list instead.");
        }
        throw err;
      }
      await db.collection("users").doc(created.uid).set({
        fullName,
        email,
        role,
        country: "",
        currency: "PHP",
        createdAt: FieldValue.serverTimestamp(),
        createdBy: caller.uid,
      });

      const link = await admin.auth().generatePasswordResetLink(email, { url: `${PUBLIC_SITE_URL}/login.html` });
      let emailSent = false;
      try {
        emailSent = await sendInvite({ to: email, name: fullName, role, link });
      } catch (err) {
        console.error("Invitation email failed:", err);
      }
      await audit("user.create", created.uid, `${fullName} (${email})`, `Added ${ROLE_LABEL[role]} account for ${fullName} (${email}); invitation ${emailSent ? "emailed" : "not emailed"}.`, { role, emailSent });
      // If the email couldn't go out, hand the link to the Super Admin to share.
      return res.status(200).json({ uid: created.uid, emailSent, ...(emailSent ? {} : { inviteLink: link }) });
    }

    // The rest act on an existing account.
    const uid = text(body.uid, 128);
    if (!uid) throw new HttpError(400, "Choose an account.");
    const targetRef = db.collection("users").doc(uid);
    const targetSnap = await targetRef.get();
    if (!targetSnap.exists) throw new HttpError(404, "Account not found.");
    const targetRole = targetSnap.get("role") || "user";
    const isSelf = uid === caller.uid;

    if (action === "update") {
      const update = {};
      if (body.fullName !== undefined) {
        const fullName = text(body.fullName, 120);
        if (!fullName) throw new HttpError(400, "The name can't be empty.");
        update.fullName = fullName;
      }
      if (body.country !== undefined) update.country = text(body.country, 80);
      if (body.currency !== undefined) {
        const currency = text(body.currency, 3).toUpperCase();
        if (!/^[A-Z]{3}$/.test(currency)) throw new HttpError(400, "Invalid currency.");
        update.currency = currency;
      }
      if (!Object.keys(update).length) throw new HttpError(400, "Nothing to change.");
      await targetRef.update(update);
      if (update.fullName) await admin.auth().updateUser(uid, { displayName: update.fullName }).catch(() => {});
      const label = `${update.fullName || targetSnap.get("fullName") || ""} (${targetSnap.get("email") || uid})`;
      const changes = [
        update.fullName !== undefined && update.fullName !== targetSnap.get("fullName") ? `name "${targetSnap.get("fullName") || ""}" \u2192 "${update.fullName}"` : "",
        update.country !== undefined && update.country !== (targetSnap.get("country") || "") ? `country "${targetSnap.get("country") || ""}" \u2192 "${update.country}"` : "",
      ].filter(Boolean);
      await audit("user.update", uid, label, `Edited ${label}: ${changes.join(", ") || "no visible change"}.`, update);
      return res.status(200).json({ ok: true });
    }

    if (action === "setRole") {
      const role = body.role;
      if (!ROLES.includes(role)) throw new HttpError(400, "Invalid role.");
      if (isSelf) throw new HttpError(409, "You can't change your own role.");
      if (targetRole === "superadmin" && role !== "superadmin") {
        const others = await db.collection("users").where("role", "==", "superadmin").limit(2).get();
        if (others.docs.filter((d) => d.id !== uid).length === 0) {
          throw new HttpError(409, "There must be at least one Super Admin.");
        }
      }
      await targetRef.update({ role });
      const label = `${targetSnap.get("fullName") || ""} (${targetSnap.get("email") || uid})`;
      await audit("user.role", uid, label, `Changed the role of ${label}: ${targetRole} \u2192 ${role}.`, { from: targetRole, to: role });
      return res.status(200).json({ ok: true });
    }

    if (action === "setSuspended") {
      const suspended = body.suspended === true;
      if (isSelf) throw new HttpError(409, "You can't suspend your own account.");
      if (targetRole === "superadmin") throw new HttpError(409, "Change a Super Admin's role before suspending them.");
      // Disabled in Firebase Auth: they can't sign in, and refresh tokens
      // stop working (a token already issued lasts up to an hour, which the
      // order functions and the apps also check against this flag).
      await admin.auth().updateUser(uid, { disabled: suspended });
      if (suspended) await admin.auth().revokeRefreshTokens(uid);
      await targetRef.update(
        suspended
          ? { disabled: true, suspendedAt: FieldValue.serverTimestamp(), suspendedBy: caller.uid }
          : { disabled: false, suspendedAt: FieldValue.delete(), suspendedBy: FieldValue.delete() },
      );
      const label = `${targetSnap.get("fullName") || ""} (${targetSnap.get("email") || uid})`;
      await audit(suspended ? "user.suspend" : "user.reactivate", uid, label, `${suspended ? "Suspended" : "Reactivated"} ${label}.`, { role: targetRole });
      return res.status(200).json({ ok: true });
    }

    if (action === "delete") {
      if (isSelf) throw new HttpError(409, "You can't delete your own account.");
      if (!INVITE_ROLES.includes(targetRole)) {
        throw new HttpError(409, "Only staff and admin accounts can be deleted. Suspend a customer instead, so their orders keep their history.");
      }
      await admin.auth().deleteUser(uid).catch((err) => {
        if (err.code !== "auth/user-not-found") throw err;
      });
      await targetRef.delete();
      const label = `${targetSnap.get("fullName") || ""} (${targetSnap.get("email") || uid})`;
      await audit("user.delete", uid, label, `Deleted the ${targetRole} account of ${label}.`, { role: targetRole });
      return res.status(200).json({ ok: true });
    }

    throw new HttpError(400, "Invalid request.");
  } catch (err) {
    sendError(res, err);
  }
};

// api/reply-message.js — Admin → Messages "Reply" box. Emails a staff
// member's reply to the customer who sent a Contact Us message, and saves
// it on that message (contactMessages/{id}.replies) so other staff can see
// it was answered.
//
// POST { messageId, reply } with "Authorization: Bearer <Firebase ID token>".
// Only staff, admins and super admins may call it, and the recipient is
// always the original sender of that message: the endpoint can't be used
// to email anyone else.
// Env vars (Vercel): GMAIL_USER, GMAIL_APP_PASSWORD (same as the other
// emails). Optional SUPPORT_EMAIL, default kalingacaresupport@gmail.com,
// used as Reply-To so the customer's answer reaches the support inbox.

const nodemailer = require("nodemailer");
const { handleCors, readJsonBody, requireUser, getAdmin, sendError, HttpError } = require("./_lib/payments");

const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || "kalingacaresupport@gmail.com";
const STAFF_ROLES = ["staff", "admin", "superadmin"];
const MAX_REPLIES = 20;

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function oneLine(value, max) {
  return String(value || "").replace(/[\r\n]+/g, " ").trim().slice(0, max);
}

module.exports = async function handler(req, res) {
  if (!handleCors(req, res)) return;
  try {
    const decoded = await requireUser(req);
    const admin = getAdmin();
    const db = admin.firestore();

    const staffSnap = await db.collection("users").doc(decoded.uid).get();
    const role = staffSnap.get("role") || "user";
    if (!STAFF_ROLES.includes(role)) throw new HttpError(403, "Only KalingaCare staff can reply to messages.");

    let body;
    try {
      body = readJsonBody(req);
    } catch {
      throw new HttpError(400, "Invalid request.");
    }
    const messageId = String(body.messageId || "");
    const reply = String(body.reply || "").trim();
    if (!/^[A-Za-z0-9]{1,64}$/.test(messageId)) throw new HttpError(400, "Invalid message.");
    if (reply.length < 2) throw new HttpError(400, "Please write a reply.");
    if (reply.length > 4000) throw new HttpError(400, "Please keep the reply under 4000 characters.");

    const ref = db.collection("contactMessages").doc(messageId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpError(404, "That message no longer exists.");
    const msg = snap.data();
    if ((msg.replies || []).length >= MAX_REPLIES) throw new HttpError(429, "This message already has many replies.");

    const gmailUser = process.env.GMAIL_USER;
    const gmailPass = process.env.GMAIL_APP_PASSWORD;
    if (!gmailUser || !gmailPass) throw new HttpError(500, "Server is missing GMAIL_USER / GMAIL_APP_PASSWORD");

    const staffName = staffSnap.get("fullName") || decoded.name || "KalingaCare Support";
    const customerName = oneLine(msg.name, 80) || "there";
    const originalSubject = oneLine(msg.subject, 120) || "Your message to KalingaCare";
    const subject = /^re:/i.test(originalSubject) ? originalSubject : `Re: ${originalSubject}`;

    const text = `Hi ${customerName.split(" ")[0]},

${reply}

${staffName}
KalingaCare Support

---
Your message:
${msg.message || ""}`;

    const html = `<div style="font-family:Poppins,Arial,Helvetica,sans-serif;color:#1e293b;font-size:15px;line-height:1.6;max-width:560px;">
  <p style="margin:0 0 12px;">Hi ${escapeHtml(customerName.split(" ")[0])},</p>
  <div style="white-space:pre-wrap;margin:0 0 16px;">${escapeHtml(reply)}</div>
  <p style="margin:0 0 20px;">${escapeHtml(staffName)}<br><span style="color:#5c6b7f;">KalingaCare Support</span></p>
  <div style="border-top:1px solid #dce8f0;padding-top:12px;color:#5c6b7f;font-size:13px;">
    <p style="margin:0 0 6px;">Your message:</p>
    <div style="white-space:pre-wrap;background:#f2f9ff;border:1px solid #dce8f0;border-radius:12px;padding:12px;">${escapeHtml(msg.message || "")}</div>
  </div>
</div>`;

    const transport = nodemailer.createTransport({
      service: "gmail",
      auth: { user: gmailUser, pass: gmailPass.replace(/\s+/g, "") },
    });
    await transport.sendMail({
      from: `"KalingaCare Support" <${gmailUser}>`,
      to: { name: customerName, address: msg.email },
      replyTo: SUPPORT_EMAIL,
      subject,
      text,
      html,
    });

    const entry = {
      text: reply,
      by: decoded.uid,
      byName: staffName,
      at: admin.firestore.Timestamp.now(),
    };
    await ref.update({
      replies: admin.firestore.FieldValue.arrayUnion(entry),
      repliedAt: admin.firestore.FieldValue.serverTimestamp(),
      read: true,
    });

    res.status(200).json({ sent: true });
  } catch (err) {
    sendError(res, err);
  }
};

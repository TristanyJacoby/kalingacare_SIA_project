// api/send-verification-email.js — sends KalingaCare's own "verify your
// email" message (branded HTML with a button) instead of Firebase's plain
// built-in one, whose body can't be edited.
//
// POST with "Authorization: Bearer <Firebase ID token>". Firebase still
// creates the actual verification link (Admin SDK); this only delivers it.
// Env vars (Vercel): GMAIL_USER, GMAIL_APP_PASSWORD (a Google App Password,
// not the account password). Clients fall back to Firebase's own email if
// this fails, so verification never depends on it.

const nodemailer = require("nodemailer");
const { handleCors, requireUser, getAdmin, sendError, HttpError } = require("./_lib/payments");

const PUBLIC_SITE_URL = (
  process.env.PUBLIC_SITE_URL || "https://kalingacare-drab.vercel.app"
).replace(/\/$/, "");
const COOLDOWN_MS = 60 * 1000;

// Only authorized Firebase domains can be the link's return address, so
// previews fall back to the live site; local development keeps localhost.
function returnUrl(req) {
  const origin = req.headers.origin || "";
  const base = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : PUBLIC_SITE_URL;
  return `${base}/email-verified.html`;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function buildEmail(name, link) {
  const greeting = name ? `Hi ${escapeHtml(name.split(" ")[0])},` : "Hi,";
  const safeLink = escapeHtml(link);
  const html = `<!doctype html>
<html>
  <head><meta charset="utf-8"></head>
  <body style="margin:0;padding:0;background:#f2f9ff;font-family:Poppins,Arial,Helvetica,sans-serif;color:#1e293b;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f9ff;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #dce8f0;border-radius:18px;">
            <tr>
              <td align="center" style="padding:32px 32px 8px;">
                <img src="${PUBLIC_SITE_URL}/assets/images/logo.png" width="56" height="56" alt="" style="display:block;border:0;">
                <div style="margin-top:8px;font-size:22px;font-weight:bold;color:#1778ad;">KalingaCare</div>
                <div style="font-size:13px;color:#5c6b7f;">Care Beyond Borders</div>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 8px;font-size:15px;line-height:1.6;">
                <p style="margin:0 0 12px;">${greeting}</p>
                <p style="margin:0 0 12px;">Thanks for creating a KalingaCare account. Please confirm your email address so you can start placing orders for your loved ones.</p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:8px 32px 24px;">
                <a href="${safeLink}" style="display:inline-block;background:#1778ad;color:#ffffff;font-size:16px;font-weight:bold;text-decoration:none;padding:14px 34px;border-radius:999px;">Verify my email</a>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 24px;font-size:13px;line-height:1.6;color:#5c6b7f;">
                <p style="margin:0 0 8px;">Button not working? Copy this link into your browser:</p>
                <p style="margin:0 0 16px;word-break:break-all;"><a href="${safeLink}" style="color:#0b5e83;">${safeLink}</a></p>
                <p style="margin:0;">If you didn't create a KalingaCare account, you can ignore this email.</p>
              </td>
            </tr>
          </table>
          <div style="max-width:520px;padding:16px 12px;font-size:12px;color:#5c6b7f;text-align:center;">
            KalingaCare &middot; Senior wellness and OFW support &middot; Cubao, Quezon City, Philippines
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  const text = `${greeting}

Thanks for creating a KalingaCare account. Confirm your email address to start placing orders:

${link}

If you didn't create a KalingaCare account, you can ignore this email.

KalingaCare - Care Beyond Borders`;
  return { html, text };
}

module.exports = async function handler(req, res) {
  if (!handleCors(req, res)) return;
  try {
    const decoded = await requireUser(req);
    const admin = getAdmin();
    const user = await admin.auth().getUser(decoded.uid);
    if (!user.email) throw new HttpError(400, "This account has no email address.");
    if (user.emailVerified) return res.status(200).json({ alreadyVerified: true });

    const gmailUser = process.env.GMAIL_USER;
    const gmailPass = process.env.GMAIL_APP_PASSWORD;
    if (!gmailUser || !gmailPass) throw new HttpError(500, "Server is missing GMAIL_USER / GMAIL_APP_PASSWORD");

    // One email per minute per account. Stored server-side; clients can't
    // read or write this collection (no Firestore rule allows it).
    const ref = admin.firestore().collection("emailVerificationSends").doc(user.uid);
    const last = (await ref.get()).get("lastSentAt");
    if (last && Date.now() - last.toMillis() < COOLDOWN_MS) {
      throw new HttpError(429, "A link was sent recently. Please wait a minute before asking for another.");
    }

    const link = await admin.auth().generateEmailVerificationLink(user.email, { url: returnUrl(req) });
    const { html, text } = buildEmail(user.displayName || "", link);

    const transport = nodemailer.createTransport({
      service: "gmail",
      auth: { user: gmailUser, pass: gmailPass.replace(/\s+/g, "") },
    });
    await transport.sendMail({
      from: `"KalingaCare" <${gmailUser}>`,
      to: user.email,
      subject: "Verify your email for KalingaCare",
      text,
      html,
    });

    await ref.set({ lastSentAt: admin.firestore.FieldValue.serverTimestamp() });
    res.status(200).json({ sent: true });
  } catch (err) {
    sendError(res, err);
  }
};

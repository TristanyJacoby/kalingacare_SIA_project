// api/contact.js — the "Contact Us" form on the website and the mobile app.
// Emails the customer's message to the KalingaCare support inbox, with
// Reply-To set to the customer so support can answer straight from Gmail,
// and saves a copy in the staff-only Firestore collection `contactMessages`
// for the Admin → Messages page.
//
// POST { name, email, subject?, message, website? } — "website" is a hidden
// honeypot field real people leave empty. Signing in is not required; if an
// "Authorization: Bearer <Firebase ID token>" header is sent, the email notes
// the account it came from.
// Env vars (Vercel): GMAIL_USER, GMAIL_APP_PASSWORD (same as the verification
// email). Optional SUPPORT_EMAIL, default kalingacaresupport@gmail.com.
// The recipient is fixed on the server, so the form can't be used to send
// mail to anyone else.

const crypto = require("crypto");
const nodemailer = require("nodemailer");
const { handleCors, readJsonBody, getAdmin, sendError, HttpError } = require("./_lib/payments");

const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || "kalingacaresupport@gmail.com";
const LIMIT = { max: 5, windowMs: 60 * 60 * 1000 }; // per IP
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function oneLine(value, max) {
  return String(value || "").replace(/[\r\n]+/g, " ").trim().slice(0, max);
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
}

// Rate limit kept in Firestore (admin-only collection: no client rule
// allows it) so it holds across serverless instances. IPs are hashed.
async function checkRateLimit(admin, ip) {
  const id = crypto.createHash("sha256").update(ip).digest("hex").slice(0, 32);
  const ref = admin.firestore().collection("contactSends").doc(id);
  const now = Date.now();
  await admin.firestore().runTransaction(async (tx) => {
    const recent = ((await tx.get(ref)).get("sentAt") || []).filter((t) => now - t < LIMIT.windowMs);
    if (recent.length >= LIMIT.max) {
      throw new HttpError(429, "You've sent several messages already. Please try again in an hour.");
    }
    tx.set(ref, { sentAt: [...recent, now] });
  });
}

async function optionalUser(admin, req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return null;
  try {
    return await admin.auth().verifyIdToken(header.slice(7));
  } catch {
    return null;
  }
}

module.exports = async function handler(req, res) {
  if (!handleCors(req, res)) return;
  try {
    let body;
    try {
      body = readJsonBody(req);
    } catch {
      throw new HttpError(400, "Invalid request.");
    }
    // Bots fill every field; pretend it worked so they don't retry.
    if (body.website) return res.status(200).json({ sent: true });

    const name = oneLine(body.name, 80);
    const email = oneLine(body.email, 254);
    const subject = oneLine(body.subject, 120) || "Message from the contact form";
    const message = String(body.message || "").trim();
    const source = body.source === "app" ? "mobile app" : "website";

    if (!name) throw new HttpError(400, "Please enter your name.");
    if (!EMAIL_RE.test(email)) throw new HttpError(400, "Please enter a valid email address.");
    if (message.length < 10) throw new HttpError(400, "Please write a message of at least 10 characters.");
    if (message.length > 2000) throw new HttpError(400, "Please keep your message under 2000 characters.");

    const gmailUser = process.env.GMAIL_USER;
    const gmailPass = process.env.GMAIL_APP_PASSWORD;

    const admin = getAdmin();
    await checkRateLimit(admin, clientIp(req));
    const user = await optionalUser(admin, req);
    const account = user ? `${user.email || "no email"} (UID ${user.uid})` : "not signed in";

    // Saved first, so the message reaches staff in Admin → Messages even
    // if the email can't be sent. Clients can't read or write this
    // collection directly; only staff (Firestore rules) and this function.
    const saved = await admin.firestore().collection("contactMessages").add({
      name,
      email,
      subject,
      message,
      source,
      userId: user?.uid || null,
      accountEmail: user?.email || null,
      read: false,
      emailSent: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const text = `New message from the KalingaCare ${source}.

Name: ${name}
Email: ${email}
Account: ${account}
Subject: ${subject}

${message}

Reply to this email to answer ${name} directly.`;

    const html = `<div style="font-family:Poppins,Arial,Helvetica,sans-serif;color:#1e293b;font-size:14px;line-height:1.6;">
  <p style="margin:0 0 12px;">New message from the KalingaCare ${source}.</p>
  <table cellpadding="4" cellspacing="0" style="margin:0 0 16px;font-size:14px;">
    <tr><td style="color:#5c6b7f;">Name</td><td>${escapeHtml(name)}</td></tr>
    <tr><td style="color:#5c6b7f;">Email</td><td>${escapeHtml(email)}</td></tr>
    <tr><td style="color:#5c6b7f;">Account</td><td>${escapeHtml(account)}</td></tr>
    <tr><td style="color:#5c6b7f;">Subject</td><td>${escapeHtml(subject)}</td></tr>
  </table>
  <div style="white-space:pre-wrap;background:#f2f9ff;border:1px solid #dce8f0;border-radius:12px;padding:16px;">${escapeHtml(message)}</div>
  <p style="margin:16px 0 0;color:#5c6b7f;font-size:12px;">Reply to this email to answer ${escapeHtml(name)} directly.</p>
</div>`;

    // The message is already saved, so an email problem doesn't fail the
    // request: it's logged, and the Messages page shows it wasn't emailed.
    try {
      if (!gmailUser || !gmailPass) throw new Error("Missing GMAIL_USER / GMAIL_APP_PASSWORD");
      const transport = nodemailer.createTransport({
        service: "gmail",
        auth: { user: gmailUser, pass: gmailPass.replace(/\s+/g, "") },
      });
      await transport.sendMail({
        from: `"KalingaCare Contact Form" <${gmailUser}>`,
        to: SUPPORT_EMAIL,
        replyTo: { name, address: email },
        subject: `[Contact] ${subject}`,
        text,
        html,
      });
      await saved.update({ emailSent: true });
    } catch (mailErr) {
      console.error("Contact email not sent (message saved):", mailErr);
    }

    res.status(200).json({ sent: true });
  } catch (err) {
    sendError(res, err);
  }
};

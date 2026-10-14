// js/verification.js
// KalingaCare — sends the "verify your email" message. Prefers our own
// branded email (api/send-verification-email.js, with a button); if that
// service is unavailable, falls back to Firebase's built-in plain email so
// verification never breaks. Both contain the same kind of Firebase link.

import { sendEmailVerification } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// Where the link returns to. Firebase only accepts authorized domains, so
// preview deployments fall back to the live site.
const VERIFY_RETURN_URL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(window.location.origin)
  ? `${window.location.origin}/email-verified.html`
  : "https://kalingacare-drab.vercel.app/email-verified.html";

export class TooSoonError extends Error {}

export async function sendVerificationEmail(user) {
  try {
    const res = await fetch("/api/send-verification-email", {
      method: "POST",
      headers: { Authorization: `Bearer ${await user.getIdToken()}` },
    });
    if (res.status === 429) {
      const data = await res.json().catch(() => ({}));
      throw new TooSoonError(data.error || "Please wait a minute before asking for another link.");
    }
    if (res.ok) return;
    console.warn("Branded verification email failed, using Firebase's:", res.status);
  } catch (err) {
    if (err instanceof TooSoonError) throw err;
    console.warn("Branded verification email unavailable, using Firebase's:", err);
  }
  await sendEmailVerification(user, { url: VERIFY_RETURN_URL });
}

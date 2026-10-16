// js/contact.js
// KalingaCare — the home page "Contact Us" form. Sends the message to
// api/contact.js, which emails it to kalingacaresupport@gmail.com with
// Reply-To set to the customer. Signed-in users get their name and email
// filled in, and their ID token is sent so support can see the account.

import { auth } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const SUPPORT_EMAIL = "kalingacaresupport@gmail.com";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const form = document.getElementById("contactForm");
const statusEl = document.getElementById("contactStatus");
const submitBtn = document.getElementById("contactSubmit");
const nameInput = document.getElementById("contactName");
const emailInput = document.getElementById("contactEmail");
const subjectInput = document.getElementById("contactSubject");
const messageInput = document.getElementById("contactMessage");

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = `contact-status${kind ? ` is-${kind}` : ""}`;
}

onAuthStateChanged(auth, (user) => {
  if (!user) return;
  if (!nameInput.value && user.displayName) nameInput.value = user.displayName;
  if (!emailInput.value && user.email) emailInput.value = user.email;
});

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = nameInput.value.trim();
  const email = emailInput.value.trim();
  const message = messageInput.value.trim();

  const problem = !name
    ? [nameInput, "Please enter your name."]
    : !EMAIL_RE.test(email)
      ? [emailInput, "Please enter a valid email address."]
      : message.length < 10
        ? [messageInput, "Please write a message of at least 10 characters."]
        : null;
  if (problem) {
    setStatus(problem[1], "error");
    problem[0].focus();
    return;
  }

  submitBtn.disabled = true;
  setStatus("Sending your message...", "");
  try {
    const headers = { "Content-Type": "application/json" };
    if (auth.currentUser) headers.Authorization = `Bearer ${await auth.currentUser.getIdToken()}`;
    const res = await fetch("/api/contact", {
      method: "POST",
      headers,
      body: JSON.stringify({
        name,
        email,
        subject: subjectInput.value.trim(),
        message,
        website: document.getElementById("contactWebsite").value,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "");

    subjectInput.value = "";
    messageInput.value = "";
    setStatus(`Thanks, ${name.split(" ")[0]}! Your message was sent. We'll reply to ${email}.`, "success");
  } catch (err) {
    setStatus(
      err.message || `We couldn't send your message right now. Please email us at ${SUPPORT_EMAIL}.`,
      "error",
    );
  } finally {
    submitBtn.disabled = false;
  }
});

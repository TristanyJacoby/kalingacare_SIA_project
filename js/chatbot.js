// js/chatbot.js
// KalingaCare — "Kali" shopping assistant, a floating chat widget.
//
// Talks to our own /api/chat serverless function (api/chat.js on Vercel),
// which holds the Gemini key and the system prompt. Nothing secret lives in
// the browser. Setup steps: CHATBOT.md.
//
// Phase 1 scope: FAQ + product help only. It is deliberately NOT given the
// user's orders/addresses — the free tier may use prompts to improve Google's
// products, so no personal data goes through it.

import { db } from "./firebase.js";
import {
  collection,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Same-origin on Vercel. For a static host without the function (e.g. GitHub
// Pages) or the mobile app, point this at the full deployed URL instead.
const CHAT_API_URL = "/api/chat";
const MAX_USER_MESSAGES = 30; // per page load, to protect the free-tier quota
const MIN_GAP_MS = 1500;
const MAX_CATALOG_ITEMS = 80;

const GREETING =
  "Hi! I'm Kali, KalingaCare's shopping assistant. I can help you find products for your loved ones, or explain how ordering, shipping and reviews work. What do you need?";

const STARTERS = [
  "What products do you have for mobility?",
  "How does ordering work?",
  "Can I cancel an order?",
];

let userMessageCount = 0;
let lastSentAt = 0;
let busy = false;

async function loadCatalog() {
  try {
    const snap = await getDocs(collection(db, "products"));
    return snap.docs
      .slice(0, MAX_CATALOG_ITEMS)
      .map((d) => {
        const p = d.data();
        return `${d.id} | ${p.name} | ${p.category} | ${p.price}`;
      })
      .join("\n");
  } catch (err) {
    console.warn("Chatbot: couldn't load catalogue", err);
    return "";
  }
}

let catalog = null;
const history = []; // [{ role: "user" | "model", text }]

async function ask(text) {
  if (catalog === null) catalog = await loadCatalog();

  history.push({ role: "user", text });
  let res;
  try {
    res = await fetch(CHAT_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history.slice(-12), catalog }),
    });
  } catch (err) {
    history.pop();
    throw err;
  }
  if (!res.ok) {
    history.pop();
    throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  const { reply } = await res.json();
  if (!reply) {
    history.pop();
    throw new Error("Empty response");
  }
  history.push({ role: "model", text: reply });
  return reply;
}

/* ===== UI ===== */
function escapeHtml(s) {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}

// Escape first, then only turn our own product links + **bold** into markup.
function renderBotText(text) {
  return escapeHtml(text)
    .replace(
      /product\.html\?id=([A-Za-z0-9_-]+)/g,
      '<a href="product.html?id=$1">view product</a>',
    )
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
}

function addMessage(log, who, text) {
  const el = document.createElement("div");
  el.className = `kali-msg kali-msg-${who}`;
  if (who === "bot") el.innerHTML = renderBotText(text);
  else el.textContent = text;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  return el;
}

function friendlyError(err) {
  const msg = String(err?.message || err);
  if (
    /\b403\b|API key|PERMISSION_DENIED|not enabled|has not been used|disabled|App Check/i.test(
      msg,
    )
  )
    return "The assistant isn't available right now. Please try again later or visit Help & Support.";
  if (/\b429\b|\b503\b|quota|RESOURCE_EXHAUSTED|UNAVAILABLE|too many requests/i.test(msg))
    return "I'm a bit busy right now. Please try again in a minute.";
  return "Sorry, I couldn't answer that. Please try again.";
}

function mount() {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "css/chatbot.css";
  document.head.appendChild(link);

  const root = document.createElement("div");
  root.className = "kali-root";
  root.innerHTML = `
    <button type="button" class="kali-fab" aria-label="Chat with Kali, the shopping assistant" aria-expanded="false" aria-controls="kaliPanel">
      <i class="bi bi-chat-heart-fill" aria-hidden="true"></i>
    </button>
    <section class="kali-panel" id="kaliPanel" role="dialog" aria-label="Kali shopping assistant" hidden>
      <header class="kali-header">
        <div><strong>Kali</strong><span>KalingaCare assistant</span></div>
        <button type="button" class="kali-close" aria-label="Close chat"><i class="bi bi-x-lg" aria-hidden="true"></i></button>
      </header>
      <div class="kali-log" role="log" aria-live="polite"></div>
      <div class="kali-starters"></div>
      <form class="kali-form">
        <input type="text" class="kali-input" placeholder="Ask about products or ordering…" maxlength="400" aria-label="Your message" autocomplete="off" />
        <button type="submit" class="kali-send" aria-label="Send message"><i class="bi bi-send-fill" aria-hidden="true"></i></button>
      </form>
      <p class="kali-note">AI assistant — may make mistakes. Not medical advice.</p>
    </section>`;
  document.body.appendChild(root);

  const fab = root.querySelector(".kali-fab");
  const panel = root.querySelector(".kali-panel");
  const log = root.querySelector(".kali-log");
  const starters = root.querySelector(".kali-starters");
  const form = root.querySelector(".kali-form");
  const input = root.querySelector(".kali-input");

  addMessage(log, "bot", GREETING);
  STARTERS.forEach((s) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "kali-starter";
    b.textContent = s;
    b.addEventListener("click", () => send(s));
    starters.appendChild(b);
  });

  function setOpen(open) {
    panel.hidden = !open;
    fab.setAttribute("aria-expanded", String(open));
    if (open) input.focus();
    else fab.focus();
  }
  fab.addEventListener("click", () => setOpen(panel.hidden));
  root
    .querySelector(".kali-close")
    .addEventListener("click", () => setOpen(false));
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setOpen(false);
  });

  async function send(text) {
    text = text.trim();
    if (!text || busy) return;
    if (userMessageCount >= MAX_USER_MESSAGES) {
      addMessage(
        log,
        "bot",
        "You've reached the chat limit for this visit. Please refresh the page to start again.",
      );
      return;
    }
    if (Date.now() - lastSentAt < MIN_GAP_MS) return;

    busy = true;
    lastSentAt = Date.now();
    userMessageCount++;
    starters.hidden = true;
    input.value = "";
    addMessage(log, "user", text);
    const pending = addMessage(log, "bot", "…");
    pending.classList.add("kali-typing");
    form.querySelector(".kali-send").disabled = true;

    try {
      const reply = await ask(text);
      pending.classList.remove("kali-typing");
      pending.innerHTML = renderBotText(reply);
    } catch (err) {
      console.error("Chatbot error:", err);
      pending.classList.remove("kali-typing");
      pending.textContent = friendlyError(err);
    } finally {
      busy = false;
      form.querySelector(".kali-send").disabled = false;
      log.scrollTop = log.scrollHeight;
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    send(input.value);
  });
}

mount();

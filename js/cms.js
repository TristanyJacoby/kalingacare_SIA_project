// js/cms.js
// KalingaCare — editable content (Admin > Content): static pages, and the
// homepage content (announcement bar, headline, featured products). Pages
// have built-in default text so they work before anyone edits them; once an
// admin saves a page, their version (Firestore pages/{slug}) is shown.

import { db } from "./firebase.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

export const PAGE_NAMES = {
  about: "About Us",
  contact: "Contact",
  faqs: "FAQs",
  privacy: "Privacy Policy",
  terms: "Terms & Conditions",
};

export const DEFAULT_PAGES = {
  about: {
    title: "About KalingaCare",
    body: `## Caregiving doesn't need a plane ticket
Millions of OFWs send money home for their parents' medical needs, but it doesn't always reach its purpose. KalingaCare lets you buy healthcare products directly for your loved ones: a "remittance-in-kind" that goes straight to what matters.

## What we do
- Curated senior wellness and medical products
- Delivered directly to your family in the Philippines
- Cash on Delivery or online payment, priced fairly in PHP
- Prices shown in your own currency too, so you know what you're spending

## Our promise
Care Beyond Borders: whatever the distance, your family gets the care you meant to send.

Read [our story](index.html#history) or [meet the team](index.html#team).`,
  },
  contact: {
    title: "Contact Us",
    body: `## We're happy to help
- **Email:** kalingacaresupport@gmail.com
- **Office:** 938 Aurora Blvd, Cubao, Quezon City, Metro Manila, Philippines
- **Hours:** Monday to Saturday, 9:00 AM to 6:00 PM (Philippine time)

## Send us a message
Use the [message form on our home page](index.html#contact) and we'll reply by email. For questions about an order, include the order number from Profile > My Orders.

You can also ask Kali, our shopping assistant, using the "Ask Kali" button on any page.`,
  },
  faqs: {
    title: "Frequently Asked Questions",
    body: `## How does KalingaCare work?
You order healthcare, mobility and wellness products online, from anywhere in the world. We deliver them to your loved ones in the Philippines.

## Where do you deliver?
Within the Philippines. You enter your family member's name, address and phone number at checkout, and can pin the exact spot on a map.

## How much is shipping?
The shipping fee is shown in your cart and again at checkout, before you pay. Some orders may qualify for free shipping.

## How can I pay?
Cash on Delivery (your family pays when the order arrives), or online with card, GCash or Maya. Online payments are currently in test mode, so no real money is charged.

## Can I cancel an order?
Yes, while it is Pending or Processing: go to Profile > My Orders and choose Cancel Order. If you already paid online, please contact us about a refund.

## How do I track my order?
Go to Profile > My Orders and choose Track Order to see its status and route. You'll also get emails when the order is placed, shipped and delivered.

## Can I return something?
Yes. Within 7 days of delivery, open Profile > My Orders and choose Request a Return. Tell us what's wrong and which items, and our team will review it. If it's approved and you paid online, the refund goes back to your original payment method; for Cash on Delivery orders we arrange it with you directly. Shipping isn't refunded.

## Can I leave a review?
Yes, once an order is marked Delivered. Open Profile > My Orders and choose Leave a Review. A review can be written once and cannot be edited afterwards.

## Which currency are prices in?
Prices are in Philippine Peso (PHP), which is what you are charged. We also show an approximate amount in your own currency, based on the country in your account.

## How do I use a promo code?
Enter it in your cart in the mobile app. The discount is applied when you check out.

## How do I contact support?
Email kalingacaresupport@gmail.com or use the message form on our [Contact page](page.html?p=contact). We reply Monday to Saturday, 9:00 AM to 6:00 PM (Philippine time).`,
  },
  privacy: {
    title: "Privacy Policy",
    body: `## What we collect
- **Your account:** name, email address, country, and a profile photo if you add one.
- **Your orders:** the items, delivery name, address, map location and phone number you enter, any note for the driver, and your order history.
- **Your activity:** favorites, your cart, reviews you write, and messages you send us.

We do not store your card number. Online payments are handled on the payment provider's own secure page.

## How we use it
We use your information to deliver your orders, show your order history and tracking, send order emails, answer your messages, and keep the store secure.

## Who helps us run the store
We use trusted services to do this: Google Firebase (accounts and database), PayMongo (online payments), Google Maps (address search and maps), Gmail (emails we send you), and a currency-rate service (exchange rates). They receive only what they need to do their part.

## What we don't do
We don't sell your personal information.

## Your choices
You can change your name, country, address and password in Settings. To ask us to correct or delete your information, email kalingacaresupport@gmail.com.

## Security
Your account is protected by your password (or your Google sign-in). Only KalingaCare staff can see customer orders, and changes to orders and accounts are recorded.

## Changes to this policy
We may update this page. The date it was last changed is shown at the top.`,
  },
  terms: {
    title: "Terms & Conditions",
    body: `## Using KalingaCare
By creating an account or placing an order, you agree to these terms. Please give accurate details, keep your password private, and use the store only for lawful purposes.

## Orders and prices
Prices are in Philippine Peso (PHP) and may change. The price you pay is the one shown at checkout. We may cancel an order if a product is unavailable.

## Payment
You can pay by Cash on Delivery or online (card, GCash or Maya). Online payments are currently in test mode and no real money is charged.

## Delivery
We deliver within the Philippines. Delivery times depend on the address and the carrier. Please make sure someone can receive the order.

## Cancellations and refunds
You can cancel an order while it is Pending or Processing. Once an order has shipped it can no longer be cancelled. If you paid online and need a refund, contact us.

## Returns
You can ask to return items within 7 days of delivery from Profile > My Orders. We review each request, and approved returns are refunded for the price of the returned items (any promo discount is shared out in proportion). Shipping isn't refunded.

## Reviews
Only customers who received a product can review it. Reviews must be honest and respectful, and we may remove reviews that are not.

## Health products
Our products are for general wellness and mobility support and are not medical advice. Please talk to a healthcare professional about medical needs.

## Contact
Questions about these terms? Email kalingacaresupport@gmail.com.`,
  },
};

const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Only https links, or pages on this site (no "javascript:" and the like).
function safeHref(url) {
  if (/^https:\/\/[^\s"<>]+$/i.test(url)) return url;
  if (/^[a-zA-Z0-9_\-./]+(\?[a-zA-Z0-9_\-=&%.]*)?(#[a-zA-Z0-9_\-]*)?$/.test(url) && !url.startsWith("//") && !url.includes(":")) return url;
  return "";
}

function inline(escaped) {
  return escaped
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
      const href = safeHref(url.replace(/&amp;/g, "&"));
      return href ? `<a href="${escapeHtml(href)}"${href.startsWith("http") ? ' target="_blank" rel="noopener"' : ""}>${label}</a>` : label;
    });
}

// A small, safe text format for editable pages: "## Heading", "### Subheading",
// "- bullet", blank lines between paragraphs, **bold** and [text](link).
// Everything is escaped first, so page text can never inject HTML.
export function renderRichText(text) {
  const out = [];
  let list = [];
  let para = [];
  const flushList = () => {
    if (list.length) out.push(`<ul>${list.map((li) => `<li>${inline(escapeHtml(li))}</li>`).join("")}</ul>`);
    list = [];
  };
  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(escapeHtml(para.join(" ")))}</p>`);
    para = [];
  };
  for (const raw of String(text || "").split("\n")) {
    const line = raw.trim();
    if (!line) {
      flushList();
      flushPara();
    } else if (line.startsWith("### ")) {
      flushList();
      flushPara();
      out.push(`<h3>${inline(escapeHtml(line.slice(4)))}</h3>`);
    } else if (line.startsWith("## ")) {
      flushList();
      flushPara();
      out.push(`<h2>${inline(escapeHtml(line.slice(3)))}</h2>`);
    } else if (line.startsWith("- ")) {
      flushPara();
      list.push(line.slice(2));
    } else {
      flushList();
      para.push(line);
    }
  }
  flushList();
  flushPara();
  return out.join("");
}

// The saved version of a page, or the built-in default.
export async function loadPage(slug) {
  if (!DEFAULT_PAGES[slug]) return null;
  try {
    const snap = await getDoc(doc(db, "pages", slug));
    if (snap.exists() && snap.data().body) {
      const d = snap.data();
      return { title: d.title || DEFAULT_PAGES[slug].title, body: d.body, updatedAt: d.updatedAt?.toDate?.() || null };
    }
  } catch {
    // Fall back to the default text.
  }
  return { ...DEFAULT_PAGES[slug], updatedAt: null };
}

// Homepage content (announcement bar, headline, app banners, featured
// products). Resolves to {} when nothing has been set.
let homePromise = null;
export function loadHomeContent() {
  if (!homePromise) {
    homePromise = getDoc(doc(db, "content", "home"))
      .then((snap) => (snap.exists() ? snap.data() : {}))
      .catch(() => ({}));
  }
  return homePromise;
}

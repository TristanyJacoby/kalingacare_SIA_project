// js/home.js
// KalingaCare — home page content managed in Admin > Content: the headline
// and the featured products. When nothing has been set, the built-in
// content in index.html stays as it is.

import { db } from "./firebase.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { loadHomeContent } from "./cms.js";
import { CATEGORY_LABELS, isActive } from "./product-constants.js";

const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

(async () => {
  const content = await loadHomeContent();

  const hero = content.hero || {};
  const h1 = document.querySelector(".hero-content h1");
  if (h1 && (hero.title || hero.accent)) {
    const accent = h1.querySelector("span");
    if (hero.title) h1.firstChild.textContent = `${hero.title} `;
    if (hero.accent && accent) accent.textContent = hero.accent;
  }
  const lead = document.querySelector(".hero-content > p");
  if (lead && hero.text) lead.textContent = hero.text;

  const ids = Array.isArray(content.featuredIds) ? content.featuredIds : [];
  const grid = document.querySelector(".featured-grid");
  if (!grid || !ids.length) return;
  try {
    const snaps = await Promise.all(ids.map((id) => getDoc(doc(db, "products", id))));
    const products = snaps.filter((s) => s.exists()).map((s) => ({ id: s.id, ...s.data() })).filter(isActive);
    if (!products.length) return;
    grid.innerHTML = products
      .map(
        (p) => `
      <a href="product.html?id=${encodeURIComponent(p.id)}" class="mini-product-card d-block">
        <img src="${escapeHtml(p.imgBase64 || p.img || "assets/images/products/placeholder.jpg")}" alt="${escapeHtml(p.name)}" />
        <span class="badge-mini badge-${escapeHtml(p.category)}">${escapeHtml(CATEGORY_LABELS[p.category] || p.category)}</span>
        <h3>${escapeHtml(p.name)}</h3>
        <p>&#8369;${Number(p.price).toLocaleString("en-PH")}</p>
      </a>`,
      )
      .join("");
  } catch (err) {
    console.warn("Couldn't load the featured products:", err);
  }
})();

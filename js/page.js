// js/page.js
// KalingaCare — shows an editable page (page.html?p=faqs|privacy|terms|about|contact).

import { PAGE_NAMES, loadPage, renderRichText } from "./cms.js";

const slug = new URLSearchParams(window.location.search).get("p") || "";
const article = document.getElementById("cmsArticle");

const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

(async () => {
  const page = Object.keys(PAGE_NAMES).includes(slug) ? await loadPage(slug) : null;
  if (!page) {
    document.title = "KalingaCare | Page not found";
    article.innerHTML = `<h1>Page not found</h1><p>That page doesn't exist. Try the <a href="index.html">home page</a>.</p>`;
    return;
  }
  document.title = `KalingaCare | ${page.title}`;
  article.innerHTML = `
    <h1>${escapeHtml(page.title)}</h1>
    ${page.updatedAt ? `<p class="cms-updated">Last updated ${page.updatedAt.toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" })}</p>` : ""}
    <div class="cms-body">${renderRichText(page.body)}</div>`;
})();

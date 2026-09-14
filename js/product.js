// js/product.js
// KalingaCare — Product detail page: full info, reviews/ratings (read-only —
// writing a review happens from My Orders, see js/review.js), favorites,
// related products. Reached from products.html by clicking a card.

import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  limit,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { loadCart, saveCart, showToast, toggleFavorite } from "./site.js";
import { getRates, formatCurrency } from "./currency.js";
import { CATEGORY_LABELS, CATEGORY_BADGE_CLASS } from "./product-constants.js";

const productId = new URLSearchParams(window.location.search).get("id");

const loadingEl = document.getElementById("pdLoading");
const notFoundEl = document.getElementById("pdNotFound");
const contentEl = document.getElementById("pdContent");

function peso(amount) {
  return "₱" + amount.toLocaleString("en-PH");
}

let product = null;
let currentUserRole = null;
let currentUserCurrency = null;
let currentRates = null;
let isFavorited = false;
let qty = 1;

if (!productId) {
  showNotFound();
} else {
  init();
}

function showNotFound() {
  loadingEl.classList.add("d-none");
  notFoundEl.classList.remove("d-none");
}

async function init() {
  const snap = await getDoc(doc(db, "products", productId));
  if (!snap.exists()) {
    showNotFound();
    return;
  }
  product = { id: snap.id, ...snap.data() };

  renderProduct();
  loadingEl.classList.add("d-none");
  contentEl.classList.remove("d-none");

  loadReviews();
  loadRelated();
}

/* ===== Image gallery — auto-advances every 5s with more than one photo,
   matching the mobile app's gallery interval exactly (ProductDetail.tsx).
   Falls back to a single static image when `images[]` isn't set (older
   products that only ever had one photo). ===== */
let galleryImages = [];
let galleryIndex = 0;
let galleryTimer = null;

function setGalleryImage(index) {
  galleryIndex = index;
  document.getElementById("pdImage").src = galleryImages[index];
  document
    .querySelectorAll("#pdGalleryDots button")
    .forEach((dot, i) => dot.classList.toggle("active", i === index));
}

function startGalleryAutoAdvance() {
  if (galleryTimer) clearInterval(galleryTimer);
  if (galleryImages.length <= 1) return;
  galleryTimer = setInterval(() => {
    setGalleryImage((galleryIndex + 1) % galleryImages.length);
  }, 5000);
}

function initGallery() {
  galleryImages =
    product.images && product.images.length > 0
      ? product.images
      : [product.imgBase64 || product.img || "assets/images/products/placeholder.jpg"];

  document.getElementById("pdImage").alt = product.name;

  const dotsWrap = document.getElementById("pdGalleryDots");
  if (galleryImages.length > 1) {
    dotsWrap.classList.remove("d-none");
    dotsWrap.innerHTML = galleryImages
      .map((_, i) => `<button type="button" aria-label="Photo ${i + 1}"></button>`)
      .join("");
    dotsWrap.querySelectorAll("button").forEach((dot, i) => {
      dot.addEventListener("click", () => {
        setGalleryImage(i);
        startGalleryAutoAdvance(); // restart the timer so a manual pick doesn't get immediately overridden
      });
    });
  } else {
    dotsWrap.classList.add("d-none");
    dotsWrap.innerHTML = "";
  }

  setGalleryImage(0);
  startGalleryAutoAdvance();
}

function renderProduct() {
  document.title = `KalingaCare | ${product.name}`;

  initGallery();

  const badge = document.getElementById("pdCategoryBadge");
  badge.textContent = CATEGORY_LABELS[product.category] || product.category;
  badge.className = `badge mb-2 ${CATEGORY_BADGE_CLASS[product.category] || "bg-secondary"}`;

  document.getElementById("pdName").textContent = product.name;

  const subEl = document.getElementById("pdSubcategory");
  if (product.subcategory) {
    subEl.textContent = product.subcategory;
  } else {
    subEl.classList.add("d-none");
  }

  renderPrice();

  const stockEl = document.getElementById("pdStock");
  const stock = product.stock ?? null;
  const addBtn = document.getElementById("pdAddToCartBtn");
  if (stock === null) {
    stockEl.textContent = "";
  } else if (stock <= 0) {
    stockEl.textContent = "Out of stock";
    stockEl.classList.add("pd-out-of-stock");
    addBtn.disabled = true;
    addBtn.innerHTML = "Out of Stock";
  } else if (stock <= 5) {
    stockEl.textContent = `Only ${stock} left in stock`;
    stockEl.classList.add("pd-low-stock");
  } else {
    stockEl.textContent = "In stock";
    stockEl.classList.add("pd-in-stock");
  }

  const descEl = document.getElementById("pdDescription");
  if (product.description) {
    descEl.textContent = product.description;
  } else {
    descEl.classList.add("d-none");
  }
}

function renderPrice() {
  const priceEl = document.getElementById("pdPrice");
  const phpEl = document.getElementById("pdPricePhp");
  if (currentUserCurrency && currentRates) {
    priceEl.textContent = formatCurrency(
      product.price * (currentRates[currentUserCurrency] ?? 1),
      currentUserCurrency,
    );
    phpEl.textContent = peso(product.price);
    phpEl.classList.remove("d-none");
  } else {
    priceEl.textContent = peso(product.price);
    phpEl.classList.add("d-none");
  }
}

/* ===== Auth-dependent state: role, currency, favorites ===== */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    currentUserRole = null;
    currentUserCurrency = null;
    currentRates = null;
    isFavorited = false;
    updateFavoriteButton();
    return;
  }

  const snap = await getDoc(doc(db, "users", user.uid));
  const userData = snap.exists() ? snap.data() : {};
  currentUserRole = userData.role || "user";

  const favorites = new Set(userData.favorites || []);
  isFavorited = productId ? favorites.has(productId) : false;
  updateFavoriteButton();

  const currency = userData.currency;
  if (currency && currency !== "PHP" && product) {
    currentUserCurrency = currency;
    const { rates } = await getRates();
    currentRates = rates;
    renderPrice();
  }
});

/* ===== Favorite button ===== */
function updateFavoriteButton() {
  const btn = document.getElementById("pdFavoriteBtn");
  const icon = btn.querySelector("i");
  btn.classList.toggle("active", isFavorited);
  icon.className = isFavorited ? "bi bi-heart-fill" : "bi bi-heart";
  btn.setAttribute(
    "aria-label",
    isFavorited ? "Remove from favorites" : "Add to favorites",
  );
}

document.getElementById("pdFavoriteBtn").addEventListener("click", () => {
  if (!auth.currentUser) {
    showToast("Please log in to save favorites.");
    setTimeout(() => {
      window.location.href = `login.html?redirect=${encodeURIComponent("product.html?id=" + productId)}`;
    }, 1200);
    return;
  }
  const wasFavorited = isFavorited;
  isFavorited = !wasFavorited;
  updateFavoriteButton();
  toggleFavorite(auth.currentUser.uid, productId, wasFavorited);
});

/* ===== Quantity stepper + Add to Cart ===== */
document.getElementById("pdQtyMinus").addEventListener("click", () => {
  if (qty > 1) qty -= 1;
  document.getElementById("pdQty").textContent = qty;
});
document.getElementById("pdQtyPlus").addEventListener("click", () => {
  if (product?.stock != null && qty >= product.stock) return;
  qty += 1;
  document.getElementById("pdQty").textContent = qty;
});

document.getElementById("pdAddToCartBtn").addEventListener("click", () => {
  if (!auth.currentUser) {
    showToast("Please log in to add items to your cart.");
    setTimeout(() => {
      window.location.href = `login.html?redirect=${encodeURIComponent("product.html?id=" + productId)}`;
    }, 1200);
    return;
  }
  if (["staff", "admin", "superadmin"].includes(currentUserRole)) {
    showToast(
      "Staff accounts can't add items to cart. Use a customer account to shop.",
    );
    return;
  }

  const cart = loadCart();
  const existing = cart.find((item) => item.id === product.id);
  if (existing) {
    existing.qty += qty;
  } else {
    cart.push({
      id: product.id,
      name: product.name,
      price: product.price,
      img: product.img,
      imgBase64: product.imgBase64 || null,
      qty,
    });
  }
  saveCart(cart);

  const btn = document.getElementById("pdAddToCartBtn");
  const original = btn.innerHTML;
  btn.innerHTML = '<i class="bi bi-check2"></i> Added';
  setTimeout(() => (btn.innerHTML = original), 1200);
});

/* ===== Reviews (read-only — writing happens from My Orders) ===== */

// Review text and reviewer name are user-submitted and rendered via
// innerHTML below — escape them first so a review can't inject a stored
// XSS payload into every other visitor's page.
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function renderStars(container, rating, size = "") {
  const full = Math.round(rating);
  container.className = `pd-stars ${size}`;
  container.innerHTML = Array.from({ length: 5 }, (_, i) =>
    i < full
      ? '<i class="bi bi-star-fill"></i>'
      : '<i class="bi bi-star"></i>',
  ).join("");
}

async function loadReviews() {
  // where() only, no orderBy — a single-field equality filter needs no
  // composite index (unlike where()+orderBy() on different fields), so
  // this works immediately with no manual Firebase Console step. Sorting
  // newest-first happens client-side instead.
  let reviews = [];
  try {
    const snap = await getDocs(
      query(collection(db, "reviews"), where("productId", "==", productId)),
    );
    reviews = snap.docs.map((d) => d.data());
  } catch (err) {
    console.warn("Couldn't load reviews.", err);
  }

  reviews.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));

  const avgEl = document.getElementById("pdAverageNumber");
  const countEl = document.getElementById("pdReviewCount");
  const summaryStars = document.getElementById("pdStarsSummary");
  const bigStars = document.getElementById("pdStarsBig");
  const ratingTextEl = document.getElementById("pdRatingText");

  if (reviews.length === 0) {
    avgEl.textContent = "—";
    countEl.textContent = "No reviews yet";
    ratingTextEl.textContent = "No reviews yet";
    renderStars(summaryStars, 0);
    renderStars(bigStars, 0, "pd-stars-lg");
    document.getElementById("pdNoReviews").classList.remove("d-none");
    document.getElementById("pdReviewsList").innerHTML = "";
  } else {
    document.getElementById("pdNoReviews").classList.add("d-none");
    const avg = reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / reviews.length;
    avgEl.textContent = avg.toFixed(1);
    countEl.textContent = `Based on ${reviews.length} review${reviews.length === 1 ? "" : "s"}`;
    ratingTextEl.textContent = `${avg.toFixed(1)} (${reviews.length})`;
    renderStars(summaryStars, avg);
    renderStars(bigStars, avg, "pd-stars-lg");

    document.getElementById("pdReviewsList").innerHTML = reviews
      .map((r) => {
        const date = r.createdAt?.toDate ? r.createdAt.toDate().toLocaleDateString() : "";
        const safeName = escapeHtml(r.userName || "Anonymous");
        const initial = safeName.charAt(0).toUpperCase();
        return `
        <div class="pd-review-card">
          <div class="pd-review-header">
            <div class="pd-review-avatar">${initial}</div>
            <div>
              <div class="pd-review-name">${safeName}</div>
              <div class="pd-stars pd-stars-sm">${"<i class=\"bi bi-star-fill\"></i>".repeat(r.rating)}${"<i class=\"bi bi-star\"></i>".repeat(5 - r.rating)}</div>
            </div>
            <span class="text-muted pd-review-date">${date}</span>
          </div>
          <p class="pd-review-text">${escapeHtml(r.text)}</p>
          ${
            r.photoBase64 && r.photoBase64.startsWith("data:image")
              ? `<a href="${r.photoBase64}" target="_blank" rel="noopener"><img class="pd-review-photo" src="${r.photoBase64}" alt="Photo from ${safeName}'s review" /></a>`
              : ""
          }
        </div>`;
      })
      .join("");
  }
}

/* ===== Related products (same category) ===== */
async function loadRelated() {
  try {
    const snap = await getDocs(
      query(
        collection(db, "products"),
        where("category", "==", product.category),
        limit(5),
      ),
    );
    const related = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((p) => p.id !== product.id)
      .slice(0, 4);

    const section = document.getElementById("pdRelatedSection");
    if (related.length === 0) {
      section.classList.add("d-none");
      return;
    }

    document.getElementById("pdRelatedGrid").innerHTML = related
      .map(
        (p) => `
      <div class="col-lg-3 col-md-6">
        <a href="product.html?id=${p.id}" class="mini-product-card d-block">
          <img src="${p.imgBase64 || p.img || "assets/images/products/placeholder.jpg"}" alt="${p.name}" />
          <span class="badge-mini badge-${p.category}">${CATEGORY_LABELS[p.category] || p.category}</span>
          <h3>${p.name}</h3>
          <p>${peso(p.price)}</p>
        </a>
      </div>`,
      )
      .join("");
  } catch (err) {
    console.warn("Couldn't load related products.", err);
    document.getElementById("pdRelatedSection").classList.add("d-none");
  }
}

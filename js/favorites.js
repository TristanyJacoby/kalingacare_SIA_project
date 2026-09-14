// js/favorites.js
// KalingaCare — My Favorites page: shows every product the user has
// hearted, reusing the same card markup/behavior as products.js.

import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  doc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { loadCart, saveCart, showToast, toggleFavorite } from "./site.js";
import { getRates, formatCurrency } from "./currency.js";
import { CATEGORY_LABELS, CATEGORY_BADGE_CLASS } from "./product-constants.js";

const grid = document.getElementById("favoritesGrid");
const countEl = document.getElementById("favoritesCount");
const authGateEl = document.getElementById("favoritesAuthGate");
const emptyEl = document.getElementById("favoritesEmpty");

function peso(amount) {
  return "₱" + amount.toLocaleString("en-PH");
}

let favoriteProducts = [];
let currentUserRole = null;
let currentUserCurrency = null;
let currentRates = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    countEl.classList.add("d-none");
    authGateEl.classList.remove("d-none");
    return;
  }
  authGateEl.classList.add("d-none");

  const snap = await getDoc(doc(db, "users", user.uid));
  const userData = snap.exists() ? snap.data() : {};
  currentUserRole = userData.role || "user";

  const favoriteIds = userData.favorites || [];
  if (favoriteIds.length === 0) {
    favoriteProducts = [];
    render();
    return;
  }

  const results = await Promise.all(
    favoriteIds.map((id) => getDoc(doc(db, "products", id))),
  );
  // A favorited product may have since been deleted by admin — skip those
  // rather than rendering a broken card.
  favoriteProducts = results
    .filter((s) => s.exists())
    .map((s) => ({ id: s.id, ...s.data() }));
  render();

  const currency = userData.currency;
  if (currency && currency !== "PHP") {
    currentUserCurrency = currency;
    const { rates } = await getRates();
    currentRates = rates;
    render();
  }
});

function render() {
  countEl.classList.remove("d-none");
  countEl.textContent = `${favoriteProducts.length} saved item${favoriteProducts.length === 1 ? "" : "s"}`;

  if (favoriteProducts.length === 0) {
    grid.innerHTML = "";
    emptyEl.classList.remove("d-none");
    return;
  }
  emptyEl.classList.add("d-none");

  grid.innerHTML = favoriteProducts
    .map(
      (p) => `
    <div class="col-lg-3 col-md-4 col-6">
      <div class="card product-card h-100" data-id="${p.id}">
        <button class="favorite-btn active" data-id="${p.id}" aria-label="Remove from favorites">
          <i class="bi bi-heart-fill"></i>
        </button>
        <img src="${p.imgBase64 || p.img || "assets/images/products/placeholder.jpg"}" class="card-img-top" alt="${p.name}" />
        <div class="card-body">
          <span class="badge ${CATEGORY_BADGE_CLASS[p.category] || "bg-secondary"} mb-2">${CATEGORY_LABELS[p.category] || p.category}</span>
          <h3 class="product-card-title" title="${p.name}">${p.name}</h3>
          ${p.subcategory ? `<p class="text-muted mb-1 product-card-subcategory">${p.subcategory}</p>` : ""}
          ${
            currentUserCurrency && currentRates
              ? `<p class="text-success product-card-price mb-0">${formatCurrency(p.price * (currentRates[currentUserCurrency] ?? 1), currentUserCurrency)}</p>
                 <p class="text-muted product-card-price-php">${peso(p.price)}</p>`
              : `<p class="text-success product-card-price">${peso(p.price)}</p>`
          }
          <button class="btn btn-success w-100 add-to-cart-btn" data-id="${p.id}">
            <i class="bi bi-cart-plus"></i> Add to Cart
          </button>
        </div>
      </div>
    </div>`,
    )
    .join("");
}

// Same delegation pattern as products.js: favorite/cart clicks handled and
// returned early, anything else on the card navigates to its detail page.
grid.addEventListener("click", (e) => {
  const favoriteBtn = e.target.closest(".favorite-btn");
  if (favoriteBtn) {
    const productId = favoriteBtn.dataset.id;
    toggleFavorite(auth.currentUser.uid, productId, true); // always true here — everything on this page starts favorited
    favoriteProducts = favoriteProducts.filter((p) => p.id !== productId);
    render();
    return;
  }

  const card = e.target.closest(".product-card");
  if (card && !e.target.closest(".add-to-cart-btn")) {
    window.location.href = `product.html?id=${card.dataset.id}`;
    return;
  }

  const button = e.target.closest(".add-to-cart-btn");
  if (!button) return;

  if (["staff", "admin", "superadmin"].includes(currentUserRole)) {
    showToast("Staff accounts can't add items to cart. Use a customer account to shop.");
    return;
  }

  const product = favoriteProducts.find((p) => p.id === button.dataset.id);
  if (!product) return;

  const cart = loadCart();
  const existing = cart.find((item) => item.id === product.id);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({
      id: product.id,
      name: product.name,
      price: product.price,
      img: product.img,
      imgBase64: product.imgBase64 || null,
      qty: 1,
    });
  }
  saveCart(cart);

  button.innerHTML = '<i class="bi bi-check2"></i> Added';
  setTimeout(() => {
    button.innerHTML = '<i class="bi bi-cart-plus"></i> Add to Cart';
  }, 1200);
});

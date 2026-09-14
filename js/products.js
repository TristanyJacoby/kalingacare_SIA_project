// js/products.js
// KalingaCare — Products page logic.
//
// Previously this page rendered 9 hardcoded product cards straight in the
// HTML. It now fetches live from the Firestore "products" collection (the
// same collection admin/admin-products.html manages), so adding/editing/
// deleting a product in the admin panel actually shows up here.

import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  doc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { loadCart, saveCart, showToast } from "./site.js";
import { getRates, formatCurrency } from "./currency.js";

const grid = document.getElementById("productsGrid");
const loadingEl = document.getElementById("productsLoading");
const emptyEl = document.getElementById("productsEmpty");
const searchInput = document.getElementById("searchInput");
const countEl = document.getElementById("productsCount");
const sortSelect = document.getElementById("sortSelect");
const clearFiltersBtn = document.getElementById("clearFiltersBtn");
const categoryCheckboxes = document.querySelectorAll(
  ".category-filter-checkbox",
);
const priceRadios = document.querySelectorAll('input[name="priceRange"]');

const CATEGORY_LABELS = {
  mobility: "Mobility",
  wellness: "Wellness",
  digital: "Digital Health",
};
const CATEGORY_BADGE_CLASS = {
  mobility: "bg-success",
  wellness: "bg-primary",
  digital: "bg-warning text-dark",
};

let allProducts = [];
let currentUserRole = null;

// Prices are always priced/stored in PHP — these two just control what
// gets shown ABOVE the PHP price on each card. Stay null/PHP for guests
// (no profile to read a currency from) and for PHP-currency accounts, so
// the common case still renders the single-line price it always has.
let currentUserCurrency = null;
let currentRates = null;

// Staff/admin/superadmin are internal accounts — they shouldn't be able to
// shop through the storefront (keeps sales data accurate to real customers).
// Fetched once here rather than per-click, and re-checked at checkout too
// in case a cart was built before a role change.
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    currentUserRole = null;
    currentUserCurrency = null;
    currentRates = null;
    renderProducts();
    return;
  }
  const snap = await getDoc(doc(db, "users", user.uid));
  const userData = snap.exists() ? snap.data() : {};
  currentUserRole = userData.role || "user";

  const currency = userData.currency;
  if (currency && currency !== "PHP") {
    currentUserCurrency = currency;
    // Rendered once already (PHP-only) before this resolves — re-render
    // adds the converted line on top once rates are in, same "upgrade
    // after load" pattern as checkout's converted-total row.
    const { rates, liveCodes } = await getRates();
    currentRates = rates;

    const note = document.getElementById("productsCurrencyNote");
    if (note) {
      note.textContent = liveCodes.includes(currency)
        ? `Prices above also shown in ${currency} at live exchange rates. You're always charged in Philippine Peso (₱) on delivery.`
        : `Prices above also shown in ${currency} (estimated — live rates aren't available for this currency). You're always charged in Philippine Peso (₱) on delivery.`;
      note.classList.remove("d-none");
    }

    renderProducts();
  }
});

function peso(amount) {
  return "\u20B1" + amount.toLocaleString("en-PH");
}

function matchesPriceRange(price, range) {
  const [minStr, maxStr] = range.split("-");
  const min = Number(minStr);
  const max = maxStr === "" ? Infinity : Number(maxStr);
  return price >= min && price < max;
}

function renderProducts() {
  const activeCategories = Array.from(categoryCheckboxes)
    .filter((cb) => cb.checked)
    .map((cb) => cb.value);
  const activePriceRange = document.querySelector(
    'input[name="priceRange"]:checked',
  )?.value;
  const keyword = (searchInput.value || "").toLowerCase();
  const sortBy = sortSelect?.value || "name-asc";

  let visible = allProducts.filter((p) => {
    const matchesCategory =
      activeCategories.length === 0 || activeCategories.includes(p.category);
    const matchesPrice =
      !activePriceRange || matchesPriceRange(p.price, activePriceRange);
    const matchesKeyword = p.name.toLowerCase().includes(keyword);
    return matchesCategory && matchesPrice && matchesKeyword;
  });

  visible = visible.sort((a, b) => {
    if (sortBy === "price-asc") return a.price - b.price;
    if (sortBy === "price-desc") return b.price - a.price;
    return a.name.localeCompare(b.name);
  });

  if (allProducts.length === 0) {
    grid.innerHTML = "";
    emptyEl.classList.remove("d-none");
    if (countEl) countEl.textContent = "Showing 0 products";
    return;
  }
  emptyEl.classList.add("d-none");

  if (countEl) {
    countEl.textContent = `Showing ${visible.length} of ${allProducts.length} product${allProducts.length === 1 ? "" : "s"}`;
  }

  if (visible.length === 0) {
    grid.innerHTML = `<div class="col-12 text-center text-muted py-5">No products match your search.</div>`;
    return;
  }

  grid.innerHTML = visible
    .map(
      (p) => `
    <div class="col-lg-3 col-md-4 col-6 product-item" data-category="${p.category}">
      <div class="card product-card h-100">
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

// Live subscription — the grid updates automatically when admin adds/edits/
// deletes a product, no page refresh needed.
onSnapshot(query(collection(db, "products"), orderBy("name")), (snap) => {
  loadingEl.remove(); // only relevant on first load; harmless if already gone
  allProducts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderProducts();
});

searchInput.addEventListener("input", renderProducts);
sortSelect?.addEventListener("change", renderProducts);
categoryCheckboxes.forEach((cb) =>
  cb.addEventListener("change", renderProducts),
);
priceRadios.forEach((radio) =>
  radio.addEventListener("change", renderProducts),
);

clearFiltersBtn?.addEventListener("click", () => {
  categoryCheckboxes.forEach((cb) => (cb.checked = false));
  priceRadios.forEach((radio) => (radio.checked = false));
  searchInput.value = "";
  renderProducts();
});

// Event delegation for Add to Cart, since cards are re-rendered on every
// Firestore update — listeners attached directly to buttons would be lost.
grid.addEventListener("click", (e) => {
  const button = e.target.closest(".add-to-cart-btn");
  if (!button) return;

  // Guests get sent to log in first, rather than silently building a cart
  // that isn't tied to any account. A brief toast explains why instead of
  // an unexplained jump, and ?redirect=products.html sends them back here
  // (rather than the homepage) once they're logged in.
  if (!auth.currentUser) {
    showToast("Please log in to add items to your cart.");
    setTimeout(() => {
      window.location.href = "login.html?redirect=products.html";
    }, 1200);
    return;
  }

  if (["staff", "admin", "superadmin"].includes(currentUserRole)) {
    showToast(
      "Staff accounts can't add items to cart. Use a customer account to shop.",
    );
    return;
  }

  const product = allProducts.find((p) => p.id === button.dataset.id);
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

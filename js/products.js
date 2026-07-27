// js/products.js
// KalingaCare — Products page logic.
//
// Previously this page rendered 9 hardcoded product cards straight in the
// HTML. It now fetches live from the Firestore "products" collection (the
// same collection admin/products.html manages), so adding/editing/deleting
// a product in the admin panel actually shows up here.

import { auth, db } from "./firebase.js";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { loadCart, saveCart, showToast } from "./site.js";

const grid = document.getElementById("productsGrid");
const loadingEl = document.getElementById("productsLoading");
const emptyEl = document.getElementById("productsEmpty");
const searchInput = document.getElementById("searchInput");
const categoryButtons = document.querySelectorAll(".category-btn");

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

function peso(amount) {
  return "\u20B1" + amount.toLocaleString("en-PH");
}

function renderProducts() {
  const activeFilter =
    document.querySelector(".category-btn.btn-success")?.dataset.filter ||
    "all";
  const keyword = (searchInput.value || "").toLowerCase();

  const visible = allProducts.filter((p) => {
    const matchesFilter = activeFilter === "all" || p.category === activeFilter;
    const matchesKeyword = p.name.toLowerCase().includes(keyword);
    return matchesFilter && matchesKeyword;
  });

  if (allProducts.length === 0) {
    grid.innerHTML = "";
    emptyEl.classList.remove("d-none");
    return;
  }
  emptyEl.classList.add("d-none");

  if (visible.length === 0) {
    grid.innerHTML = `<div class="col-12 text-center text-muted py-5">No products match your search.</div>`;
    return;
  }

  grid.innerHTML = visible
    .map(
      (p) => `
    <div class="col-lg-4 col-md-6 product-item" data-category="${p.category}">
      <div class="card product-card h-100">
        <img src="${p.img || "assets/images/products/placeholder.jpg"}" class="card-img-top" alt="${p.name}" />
        <div class="card-body">
          <span class="badge ${CATEGORY_BADGE_CLASS[p.category] || "bg-secondary"} mb-2">${CATEGORY_LABELS[p.category] || p.category}</span>
          <h5>${p.name}</h5>
          ${p.subcategory ? `<p class="text-muted mb-1" style="font-size:0.8rem;">${p.subcategory}</p>` : ""}
          <h4 class="text-success">${peso(p.price)}</h4>
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

categoryButtons.forEach((button) =>
  button.addEventListener("click", () => {
    categoryButtons.forEach((btn) => {
      btn.classList.remove("btn-success");
      btn.classList.add("btn-outline-success");
    });
    button.classList.replace("btn-outline-success", "btn-success");
    renderProducts();
  }),
);

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
      qty: 1,
    });
  }
  saveCart(cart);

  button.innerHTML = '<i class="bi bi-check2"></i> Added';
  setTimeout(() => {
    button.innerHTML = '<i class="bi bi-cart-plus"></i> Add to Cart';
  }, 1200);
});

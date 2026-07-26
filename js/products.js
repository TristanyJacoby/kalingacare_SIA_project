// js/products.js
// KalingaCare — Products page logic (search, filter, add-to-cart)
//
// Note: products are still hardcoded in products.html for now, same as before.
// When we wire up Firestore, this is the file that will fetch the "products"
// collection instead — the cart logic below already writes to localStorage so
// cart.html/cart.js can pick it up without any changes on this end.

const searchInput = document.getElementById("searchInput");
const products = document.querySelectorAll(".product-item");
const categoryButtons = document.querySelectorAll(".category-btn");
const cartBadge = document.querySelector(".badge.rounded-pill");

const CART_KEY = "kalingacare_cart";

function loadCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY)) || [];
  } catch {
    return [];
  }
}

function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
}

function cartCount(cart) {
  return cart.reduce((sum, item) => sum + item.qty, 0);
}

function updateCartBadge() {
  if (cartBadge) cartBadge.textContent = cartCount(loadCart());
}

function addToCart(product) {
  const cart = loadCart();
  const existing = cart.find((item) => item.id === product.id);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({ ...product, qty: 1 });
  }
  saveCart(cart);
  updateCartBadge();
}

function showProducts(filter = "all", keyword = "") {
  products.forEach((product) => {
    const matched = filter === "all" || product.dataset.category === filter;
    const matchesKeyword = product.innerText
      .toLowerCase()
      .includes(keyword.toLowerCase());
    product.style.display = matched && matchesKeyword ? "block" : "none";
  });
}

searchInput.addEventListener("input", () =>
  showProducts(
    document.querySelector(".category-btn.btn-success")?.dataset.filter,
    searchInput.value,
  ),
);

categoryButtons.forEach((button) =>
  button.addEventListener("click", () => {
    categoryButtons.forEach((btn) => {
      btn.classList.remove("btn-success");
      btn.classList.add("btn-outline-success");
    });
    button.classList.replace("btn-outline-success", "btn-success");
    showProducts(button.dataset.filter, searchInput.value);
  }),
);

document.querySelectorAll(".product-card .btn-success").forEach((button) => {
  button.addEventListener("click", () => {
    const card = button.closest(".product-item");
    addToCart({
      id: card.dataset.id,
      name: card.dataset.name,
      price: Number(card.dataset.price),
      img: card.dataset.img,
    });

    button.innerHTML = '<i class="bi bi-check2"></i> Added';
    setTimeout(() => {
      button.innerHTML = '<i class="bi bi-cart-plus"></i> Add to Cart';
    }, 1200);
  });
});

updateCartBadge();

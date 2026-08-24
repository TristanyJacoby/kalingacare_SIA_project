// js/cart.js
// KalingaCare — Cart page: render, update quantity, remove, live totals.

import { loadCart, saveCart, SHIPPING_FEE } from "./site.js";

const cartLoaded = document.getElementById("cartLoaded");
const cartEmpty = document.getElementById("cartEmpty");
const itemsList = document.getElementById("cartItemsList");
const checkoutBtn = document.getElementById("checkoutBtn");

function peso(amount) {
  return "\u20B1" + amount.toLocaleString("en-PH");
}

function render() {
  const cart = loadCart();

  if (cart.length === 0) {
    cartLoaded.classList.add("d-none");
    cartEmpty.classList.remove("d-none");
    return;
  }

  cartLoaded.classList.remove("d-none");
  cartEmpty.classList.add("d-none");

  itemsList.innerHTML = cart
    .map(
      (item, index) => `
    <div class="cart-item">
      <img src="${item.imgBase64 || item.img || "assets/images/products/placeholder.jpg"}" alt="${item.name}" />
      <div class="cart-item-info">
        <h5>${item.name}</h5>
        <p class="cart-item-price">${peso(item.price)}</p>
        <div class="qty-stepper">
          <button type="button" data-action="decrease" data-index="${index}">&minus;</button>
          <span>${item.qty}</span>
          <button type="button" data-action="increase" data-index="${index}">+</button>
        </div>
        <button type="button" class="remove-item" data-action="remove" data-index="${index}">
          <i class="bi bi-trash3"></i> Remove
        </button>
      </div>
      <div class="fw-bold">${peso(item.price * item.qty)}</div>
    </div>
  `,
    )
    .join("");

  const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  document.getElementById("summarySubtotal").textContent = peso(subtotal);
  document.getElementById("summaryShipping").textContent = peso(SHIPPING_FEE);
  document.getElementById("summaryTotal").textContent = peso(
    subtotal + SHIPPING_FEE,
  );
}

itemsList?.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;

  const cart = loadCart();
  const index = Number(btn.dataset.index);
  const action = btn.dataset.action;

  if (action === "increase") {
    cart[index].qty += 1;
  } else if (action === "decrease") {
    cart[index].qty -= 1;
    if (cart[index].qty <= 0) cart.splice(index, 1);
  } else if (action === "remove") {
    cart.splice(index, 1);
  }

  saveCart(cart);
  render();
});

render();

// js/cart.js
// KalingaCare — Cart page: render, update quantity, remove, live totals.

import { auth, db } from "./firebase.js";
import { loadCart, saveCart, SHIPPING_FEE } from "./site.js";
import { getRates, formatCurrency } from "./currency.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const cartLoaded = document.getElementById("cartLoaded");
const cartEmpty = document.getElementById("cartEmpty");
const itemsList = document.getElementById("cartItemsList");
const checkoutBtn = document.getElementById("checkoutBtn");

function peso(amount) {
  return "\u20B1" + amount.toLocaleString("en-PH");
}

// The buyer's own currency (from their Country in Settings), shown next to
// PHP the same way the products page and checkout do. Display only: orders
// are always charged in PHP. Stays null for guests and PHP accounts.
let userCurrency = null;
let userRates = null;
let userRateIsLive = false;

function local(phpAmount) {
  return formatCurrency(phpAmount * (userRates[userCurrency] ?? 1), userCurrency);
}

// Local currency first with PHP underneath, or just PHP.
function priceHtml(phpAmount, className) {
  if (!userCurrency || !userRates) return `<span class="${className}">${peso(phpAmount)}</span>`;
  return `<span class="${className}">${local(phpAmount)}</span>
          <span class="cart-price-php">${peso(phpAmount)}</span>`;
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
        <p class="cart-item-price-wrap">${priceHtml(item.price, "cart-item-price")}</p>
        <div class="qty-stepper">
          <button type="button" data-action="decrease" data-index="${index}">&minus;</button>
          <span>${item.qty}</span>
          <button type="button" data-action="increase" data-index="${index}">+</button>
        </div>
        <button type="button" class="remove-item" data-action="remove" data-index="${index}">
          <i class="bi bi-trash3"></i> Remove
        </button>
      </div>
      <div class="fw-bold cart-line-total">${priceHtml(item.price * item.qty, "cart-line-amount")}</div>
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

  const convertedRow = document.getElementById("summaryConvertedRow");
  const rateNote = document.getElementById("summaryRateNote");
  if (userCurrency && userRates) {
    document.getElementById("summaryCurrencyLabel").textContent = userCurrency;
    document.getElementById("summaryConvertedTotal").textContent = local(subtotal + SHIPPING_FEE);
    rateNote.textContent = `${userRateIsLive ? "Live exchange rate" : "Estimated rate (live data isn't available for this currency)"}. You're always charged in Philippine Peso (\u20B1).`;
    convertedRow.style.display = "flex";
    rateNote.style.display = "block";
  } else {
    convertedRow.style.display = "none";
    rateNote.style.display = "none";
  }
}

onAuthStateChanged(auth, async (user) => {
  userCurrency = null;
  userRates = null;
  if (user) {
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      const currency = snap.exists() ? snap.data().currency : null;
      if (currency && currency !== "PHP") {
        const { rates, liveCodes } = await getRates();
        userCurrency = currency;
        userRates = rates;
        userRateIsLive = liveCodes.includes(currency);
      }
    } catch {
      // No currency info: the cart just shows PHP, as for guests.
    }
  }
  render();
});

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

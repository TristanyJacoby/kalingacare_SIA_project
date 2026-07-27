// js/checkout.js
// KalingaCare — Checkout page: auth gate, order summary, places the order.

import { auth, db } from "./firebase.js";
import { loadCart, clearCart, SHIPPING_FEE } from "./site.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  collection,
  addDoc,
  doc,
  getDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const authGate = document.getElementById("authGate");
const emptyGate = document.getElementById("emptyGate");
const successGate = document.getElementById("successGate");
const checkoutContent = document.getElementById("checkoutContent");

function peso(amount) {
  return "\u20B1" + amount.toLocaleString("en-PH");
}

function hideAllGates() {
  authGate.style.display = "none";
  emptyGate.style.display = "none";
  successGate.style.display = "none";
  checkoutContent.style.display = "none";
}

function renderSummary(cart) {
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  document.getElementById("ckItemsSummary").innerHTML = cart
    .map(
      (item) => `
      <div class="summary-row">
        <span>${item.name} &times; ${item.qty}</span>
        <span>${peso(item.price * item.qty)}</span>
      </div>`,
    )
    .join("");
  document.getElementById("ckSubtotal").textContent = peso(subtotal);
  document.getElementById("ckShipping").textContent = peso(SHIPPING_FEE);
  document.getElementById("ckTotal").textContent = peso(subtotal + SHIPPING_FEE);
  return subtotal;
}

let currentUser = null;
let savedAddressCoords = { lat: null, lng: null };

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  hideAllGates();

  if (!user) {
    authGate.style.display = "block";
    return;
  }

  const cart = loadCart();
  if (cart.length === 0) {
    emptyGate.style.display = "block";
    return;
  }

  checkoutContent.style.display = "block";
  renderSummary(cart);

  document.getElementById("ckName").value = user.displayName || "";
  document.getElementById("ckEmail").value = user.email || "";

  // Pre-fill from the saved delivery address on the user's profile, if any.
  getDoc(doc(db, "users", user.uid)).then((snap) => {
    const savedAddress = snap.exists() ? snap.data().savedAddress : null;
    if (savedAddress) {
      document.getElementById("ckRecipient").value = savedAddress.recipient || "";
      document.getElementById("ckAddress").value = savedAddress.address || "";
      document.getElementById("ckPhone").value = savedAddress.phone || "";
      savedAddressCoords = { lat: savedAddress.lat ?? null, lng: savedAddress.lng ?? null };
    }
  });
});

document.getElementById("checkoutForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentUser) return;

  const cart = loadCart();
  if (cart.length === 0) return;

  const submitBtn = document.getElementById("placeOrderBtn");
  const errorBox = document.getElementById("checkoutError");
  errorBox.classList.remove("show");
  submitBtn.disabled = true;
  submitBtn.textContent = "Placing order...";

  const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);

  try {
    await addDoc(collection(db, "orders"), {
      userId: currentUser.uid,
      items: cart,
      subtotal,
      shippingFee: SHIPPING_FEE,
      total: subtotal + SHIPPING_FEE,
      status: "Pending",
      shippingInfo: {
        fullName: document.getElementById("ckName").value.trim(),
        email: document.getElementById("ckEmail").value.trim(),
        recipient: document.getElementById("ckRecipient").value.trim(),
        address: document.getElementById("ckAddress").value.trim(),
        phone: document.getElementById("ckPhone").value.trim(),
        paymentMethod: document.getElementById("ckPayment").value,
        lat: savedAddressCoords.lat,
        lng: savedAddressCoords.lng,
      },
      createdAt: serverTimestamp(),
    });

    clearCart();

    hideAllGates();
    successGate.style.display = "block";
  } catch (err) {
    errorBox.textContent = "Something went wrong placing your order. Please try again.";
    errorBox.classList.add("show");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Place Order";
  }
});

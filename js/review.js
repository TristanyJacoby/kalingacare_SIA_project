// js/review.js
// KalingaCare — Write a Review page (review.html?orderId=X&productId=Y).
// Reached only from My Orders on a delivered item — matches the mobile
// app's model: reviews are gated to something you actually bought and
// received, not open from the product page to anyone. See the
// web-vs-mobile-review-model note for why this replaced the earlier
// open-from-product-page design.

import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  addDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { showToast, resizeImageToDataUrl } from "./site.js";

const params = new URLSearchParams(window.location.search);
const orderId = params.get("orderId");
const productId = params.get("productId");

const loadingEl = document.getElementById("rvLoading");
const notEligibleEl = document.getElementById("rvNotEligible");
const alreadyReviewedEl = document.getElementById("rvAlreadyReviewed");
const contentEl = document.getElementById("rvContent");

let product = null;
let selectedRating = 0;
let selectedPhoto = null;

function showState(el) {
  [loadingEl, notEligibleEl, alreadyReviewedEl, contentEl].forEach((e) =>
    e.classList.add("d-none"),
  );
  el.classList.remove("d-none");
}

function notEligible(reason) {
  document.getElementById("rvNotEligibleReason").textContent = reason;
  showState(notEligibleEl);
}

if (!orderId || !productId) {
  notEligible("This review link is missing some information.");
} else {
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      // encodeURIComponent is required here: the redirect *value* itself
      // contains "&" and "=" (orderId/productId), which would otherwise be
      // parsed as separate top-level query params on the login.html URL
      // instead of staying part of this one value.
      const destination = `review.html?orderId=${orderId}&productId=${productId}`;
      window.location.href = `login.html?redirect=${encodeURIComponent(destination)}`;
      return;
    }
    init(user);
  });
}

async function init(user) {
  // A nonexistent or not-your-own order doc isn't just "not found" here —
  // Firestore's security rules evaluate against `resource` before this
  // code ever sees a result, so both cases surface as a thrown
  // permission-denied rather than a snap with exists()===false. Catch it
  // the same way as an actual missing/foreign order.
  let orderSnap;
  try {
    orderSnap = await getDoc(doc(db, "orders", orderId));
  } catch (err) {
    notEligible("That order couldn't be found on your account.");
    return;
  }
  if (!orderSnap.exists() || orderSnap.data().userId !== user.uid) {
    notEligible("That order couldn't be found on your account.");
    return;
  }

  const order = orderSnap.data();
  if (order.status !== "Delivered") {
    notEligible(
      "Reviews can only be written once an order has been delivered.",
    );
    return;
  }

  const orderedItem = (order.items || []).find((item) => item.id === productId);
  if (!orderedItem) {
    notEligible("That item isn't part of this order.");
    return;
  }

  // Mobile's model, matched here: a "reviewedKeys" check (orderId+productId
  // for this user) rather than a deterministic doc ID, since a review is
  // create-only once written (see firestore-reviews-schema) — this is the
  // only place duplicate submission gets prevented.
  const existingSnap = await getDocs(
    query(collection(db, "reviews"), where("userId", "==", user.uid)),
  );
  const alreadyReviewed = existingSnap.docs.some((d) => {
    const data = d.data();
    return data.orderId === orderId && data.productId === productId;
  });
  if (alreadyReviewed) {
    showState(alreadyReviewedEl);
    return;
  }

  const productSnap = await getDoc(doc(db, "products", productId));
  product = productSnap.exists()
    ? { id: productSnap.id, ...productSnap.data() }
    : { id: productId, name: orderedItem.name, price: orderedItem.price };

  document.getElementById("rvProductImage").src =
    product.imgBase64 || product.img || "assets/images/products/placeholder.jpg";
  document.getElementById("rvProductName").textContent = product.name;
  document.getElementById("rvOrderIdShort").textContent = orderId.slice(0, 8).toUpperCase();

  showState(contentEl);
}

/* ===== Star input ===== */
function setStarInputValue(value) {
  selectedRating = value;
  document.querySelectorAll("#rvStarInput i").forEach((star) => {
    const starValue = Number(star.dataset.value);
    star.className = starValue <= value ? "bi bi-star-fill" : "bi bi-star";
  });
}
document.querySelectorAll("#rvStarInput i").forEach((star) => {
  star.addEventListener("click", () => setStarInputValue(Number(star.dataset.value)));
});

/* ===== Photo upload ===== */
function setPhoto(dataUrl) {
  selectedPhoto = dataUrl;
  const wrap = document.getElementById("rvPhotoPreviewWrap");
  const img = document.getElementById("rvPhotoPreview");
  const addBtn = document.getElementById("rvPhotoBtn");
  if (dataUrl) {
    img.src = dataUrl;
    wrap.classList.remove("d-none");
    addBtn.classList.add("d-none");
  } else {
    img.src = "";
    wrap.classList.add("d-none");
    addBtn.classList.remove("d-none");
  }
}

document.getElementById("rvPhotoBtn").addEventListener("click", () => {
  document.getElementById("rvPhotoInput").click();
});

document.getElementById("rvPhotoInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const errorEl = document.getElementById("rvError");
  errorEl.classList.remove("show");

  if (!file.type.startsWith("image/")) {
    errorEl.textContent = "Please choose an image file.";
    errorEl.classList.add("show");
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    errorEl.textContent = "Image is too large (max 8MB before resizing).";
    errorEl.classList.add("show");
    return;
  }

  try {
    // Matches mobile's review-photo sizing (src/utils/imageResize.ts:
    // maxDimension 800, quality 0.7) rather than the smaller default used
    // for avatars/product thumbnails.
    const dataUrl = await resizeImageToDataUrl(file, 800, 0.7);
    setPhoto(dataUrl);
  } catch (err) {
    errorEl.textContent = err.message || "Couldn't process that image.";
    errorEl.classList.add("show");
  }
});

document.getElementById("rvPhotoRemove").addEventListener("click", () => {
  setPhoto(null);
  document.getElementById("rvPhotoInput").value = "";
});

/* ===== Submit ===== */
document.getElementById("rvSubmitBtn").addEventListener("click", async () => {
  const errorEl = document.getElementById("rvError");
  errorEl.classList.remove("show");

  const text = document.getElementById("rvReviewText").value.trim();
  if (selectedRating === 0) {
    errorEl.textContent = "Please select a star rating.";
    errorEl.classList.add("show");
    return;
  }
  if (!text) {
    errorEl.textContent = "Please write a short review.";
    errorEl.classList.add("show");
    return;
  }

  const btn = document.getElementById("rvSubmitBtn");
  btn.disabled = true;

  try {
    await addDoc(collection(db, "reviews"), {
      productId,
      orderId,
      productName: product.name,
      userId: auth.currentUser.uid,
      userName: auth.currentUser.displayName || "Customer",
      rating: selectedRating,
      text,
      ...(selectedPhoto ? { photoBase64: selectedPhoto } : {}),
      createdAt: serverTimestamp(),
    });

    showToast("Thanks for your review!");
    window.location.href = "profile.html";
  } catch (err) {
    errorEl.textContent = "Couldn't submit your review. Please try again.";
    errorEl.classList.add("show");
    btn.disabled = false;
  }
});

// js/profile.js
// KalingaCare — Profile page: account info, avatar, password, address, order history.

import { auth, db } from "./firebase.js";
import {
  onAuthStateChanged,
  updateProfile,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  doc,
  getDoc,
  updateDoc,
  collection,
  query,
  where,
  orderBy,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const authGate = document.getElementById("authGate");
const profileContent = document.getElementById("profileContent");

const ROLE_LABELS = {
  user: "User",
  staff: "Staff",
  admin: "Admin",
  superadmin: "Super Admin",
};

function peso(amount) {
  return "\u20B1" + amount.toLocaleString("en-PH");
}

function initials(name) {
  return (name || "?")
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function showMsg(el, message, isError = true) {
  el.textContent = message;
  el.classList.add("show");
  if (!isError) setTimeout(() => el.classList.remove("show"), 3000);
}

let currentPhotoBase64 = null;

function renderAvatar(name, photoBase64) {
  currentPhotoBase64 = photoBase64 || null;
  const img = document.getElementById("avatarImg");
  const initialsText = document.getElementById("avatarInitialsText");
  if (photoBase64) {
    img.src = photoBase64;
    img.classList.remove("d-none");
    initialsText.classList.add("d-none");
  } else {
    img.classList.add("d-none");
    initialsText.classList.remove("d-none");
    initialsText.textContent = initials(name);
  }
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    authGate.style.display = "block";
    profileContent.style.display = "none";
    return;
  }

  authGate.style.display = "none";
  profileContent.style.display = "block";

  const userSnap = await getDoc(doc(db, "users", user.uid));
  const userData = userSnap.exists() ? userSnap.data() : {};
  const role = userData.role || "user";

  document.getElementById("profileName").value = user.displayName || userData.fullName || "";
  document.getElementById("profileEmail").value = user.email || "";
  renderAvatar(user.displayName || userData.fullName, userData.photoBase64);

  const badge = document.getElementById("roleBadge");
  badge.textContent = ROLE_LABELS[role] || "User";
  badge.classList.add(`role-${role}`);

  if (userData.createdAt?.toDate) {
    const date = userData.createdAt.toDate();
    document.getElementById("memberSince").textContent =
      "Member since " + date.toLocaleDateString("en-PH", { year: "numeric", month: "long" });
  }

  // Pre-fill saved delivery address, if any.
  if (userData.savedAddress) {
    document.getElementById("addrRecipient").value = userData.savedAddress.recipient || "";
    document.getElementById("addrAddress").value = userData.savedAddress.address || "";
    document.getElementById("addrPhone").value = userData.savedAddress.phone || "";
  }

  loadOrderHistory(user.uid);
});

async function loadOrderHistory(uid) {
  const list = document.getElementById("orderHistoryList");
  const noOrders = document.getElementById("noOrders");

  const q = query(collection(db, "orders"), where("userId", "==", uid), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);

  if (snap.empty) {
    noOrders.classList.remove("d-none");
    return;
  }

  list.innerHTML = snap.docs
    .map((docSnap) => {
      const order = docSnap.data();
      const date = order.createdAt?.toDate ? order.createdAt.toDate().toLocaleDateString("en-PH") : "";
      const statusClass = (order.status || "Pending").toLowerCase();
      return `
        <div class="cart-item" style="align-items:flex-start;">
          <div class="cart-item-info">
            <div class="d-flex justify-content-between align-items-center mb-1">
              <h5 class="mb-0">Order #${docSnap.id.slice(0, 8).toUpperCase()}</h5>
              <span class="role-badge role-${statusClass === "pending" ? "user" : "staff"}">${order.status || "Pending"}</span>
            </div>
            <p class="text-muted mb-1" style="font-size:0.85rem;">${date} &middot; ${order.items.length} item${order.items.length > 1 ? "s" : ""}</p>
            <p class="cart-item-price mb-0">${peso(order.total)}</p>
          </div>
        </div>`;
    })
    .join("");
}

/* ===== Save name ===== */
document.getElementById("profileForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("profileError");
  const successEl = document.getElementById("profileSuccess");
  errorEl.classList.remove("show");
  successEl.classList.remove("show");

  const fullName = document.getElementById("profileName").value.trim();

  try {
    await updateProfile(auth.currentUser, { displayName: fullName });
    await updateDoc(doc(db, "users", auth.currentUser.uid), { fullName });
    renderAvatar(fullName, currentPhotoBase64);
    showMsg(successEl, "Profile updated.", false);
  } catch (err) {
    showMsg(errorEl, "Couldn't save changes. Please try again.");
  }
});

/* ===== Avatar upload =====
   No Firebase Storage here on purpose: since Feb 2026, Cloud Storage for
   Firebase requires the paid Blaze plan just to create a bucket, even to
   stay within the free tier. Instead we resize the image down client-side
   and store it as a base64 string directly on the user's Firestore doc —
   free, no billing account needed. Trade-off: capped to a small thumbnail
   size (photos aren't optimized/CDN-served like real image hosting would
   give you), fine for a profile picture, not something to reuse for large
   images. */
function resizeImageToDataUrl(file, maxSize = 300, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxSize) {
          height = Math.round(height * (maxSize / width));
          width = maxSize;
        } else if (height > maxSize) {
          width = Math.round(width * (maxSize / height));
          height = maxSize;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => reject(new Error("Couldn't read that image."));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.readAsDataURL(file);
  });
}

document.getElementById("avatarEditBtn").addEventListener("click", () => {
  document.getElementById("avatarUpload").click();
});

document.getElementById("avatarUpload").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const errorEl = document.getElementById("profileError");
  const successEl = document.getElementById("profileSuccess");
  errorEl.classList.remove("show");

  if (!file.type.startsWith("image/")) {
    showMsg(errorEl, "Please choose an image file.");
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    showMsg(errorEl, "Image is too large (max 8MB before resizing).");
    return;
  }

  try {
    const dataUrl = await resizeImageToDataUrl(file);
    await updateDoc(doc(db, "users", auth.currentUser.uid), { photoBase64: dataUrl });
    renderAvatar(auth.currentUser.displayName, dataUrl);
    showMsg(successEl, "Photo updated.", false);
  } catch (err) {
    showMsg(errorEl, err.message || "Couldn't update photo.");
  }
});

/* ===== Change password =====
   Firebase requires a "recent" login for sensitive account changes, so we
   re-authenticate with the current password first before updatePassword()
   is allowed to succeed. */
document.getElementById("passwordForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("passwordError");
  const successEl = document.getElementById("passwordSuccess");
  errorEl.classList.remove("show");
  successEl.classList.remove("show");

  const currentPassword = document.getElementById("currentPassword").value;
  const newPassword = document.getElementById("newPassword").value;
  const confirmNewPassword = document.getElementById("confirmNewPassword").value;
  const form = e.target;
  const submitBtn = form.querySelector(".btn-auth");

  if (newPassword !== confirmNewPassword) {
    showMsg(errorEl, "New passwords don't match.");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Updating...";

  try {
    const credential = EmailAuthProvider.credential(auth.currentUser.email, currentPassword);
    await reauthenticateWithCredential(auth.currentUser, credential);
    await updatePassword(auth.currentUser, newPassword);
    form.reset();
    showMsg(successEl, "Password updated.", false);
  } catch (err) {
    if (err.code === "auth/wrong-password" || err.code === "auth/invalid-credential") {
      showMsg(errorEl, "Current password is incorrect.");
    } else if (err.code === "auth/weak-password") {
      showMsg(errorEl, "New password should be at least 6 characters.");
    } else {
      showMsg(errorEl, "Couldn't update password. Please try again.");
    }
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Update Password";
  }
});

/* ===== Delivery address ===== */
document.getElementById("addressForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("addressError");
  const successEl = document.getElementById("addressSuccess");
  errorEl.classList.remove("show");
  successEl.classList.remove("show");

  const savedAddress = {
    recipient: document.getElementById("addrRecipient").value.trim(),
    address: document.getElementById("addrAddress").value.trim(),
    phone: document.getElementById("addrPhone").value.trim(),
  };

  try {
    await updateDoc(doc(db, "users", auth.currentUser.uid), { savedAddress });
    showMsg(successEl, "Address saved.", false);
  } catch (err) {
    showMsg(errorEl, "Couldn't save address. Please try again.");
  }
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "index.html";
});

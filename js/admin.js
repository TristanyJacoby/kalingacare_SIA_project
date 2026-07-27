// js/admin.js
// KalingaCare — Admin panel logic, shared by admin/dashboard.html,
// admin/products.html, and admin/orders.html (same pattern as auth.js
// serving both login.html and register.html: one file, DOM-guarded
// sections so each page only runs the code its own elements need).
//
// Role system: every "users" doc in Firestore has a `role` field, one of
// "user" | "staff" | "admin" | "superadmin". Access to /admin/* requires
// at least "staff". Only "superadmin" can see the User Management table
// and change other people's roles.

import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  setDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const ROLE_RANK = { user: 0, staff: 1, admin: 2, superadmin: 3 };
const MIN_ROLE = "staff"; // minimum role to enter any /admin/ page

function initials(name) {
  return (name || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}

function peso(amount) {
  return "\u20B1" + (amount || 0).toLocaleString("en-PH");
}

/* ===== Access control — runs on every admin page ===== */
onAuthStateChanged(auth, async (user) => {
  const denied = document.getElementById("accessDenied");
  const shell = document.getElementById("adminShell");

  if (!user) {
    window.location.href = "../login.html";
    return;
  }

  const snap = await getDoc(doc(db, "users", user.uid));
  const userData = snap.exists() ? snap.data() : {};
  const role = userData.role || "user";

  if ((ROLE_RANK[role] ?? 0) < ROLE_RANK[MIN_ROLE]) {
    if (denied) denied.style.display = "block";
    if (shell) shell.style.display = "none";
    return;
  }

  if (shell) shell.style.display = "flex";
  if (denied) denied.style.display = "none";

  const chipAvatar = document.getElementById("adminAvatar");
  const chipName = document.getElementById("adminName");
  const chipRole = document.getElementById("adminRole");
  if (chipAvatar) chipAvatar.textContent = initials(user.displayName || userData.fullName);
  if (chipName) chipName.textContent = user.displayName || userData.fullName || user.email;
  if (chipRole) {
    chipRole.textContent = role;
    chipRole.className = `role-badge role-${role}`;
  }

  // Only superadmin sees the User Management panel on the dashboard.
  const userMgmt = document.getElementById("userMgmtSection");
  if (userMgmt) userMgmt.classList.toggle("d-none", role !== "superadmin");

  // Only admin/superadmin can add/edit/delete products; staff can view only.
  const productControls = document.querySelectorAll(".product-edit-only");
  productControls.forEach((el) => el.classList.toggle("d-none", !["admin", "superadmin"].includes(role)));

  initPageFor(role);
});

const logoutBtn = document.getElementById("adminLogoutBtn");
if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    await signOut(auth);
    window.location.href = "../index.html";
  });
}

function initPageFor(role) {
  if (document.getElementById("kpiOrders")) initDashboard(role);
  if (document.getElementById("adminProductsTable")) initProducts(role);
  if (document.getElementById("adminOrdersTable")) initOrders(role);
}

/* =====================================================
   DASHBOARD
===================================================== */
async function initDashboard() {
  const ordersSnap = await getDocs(collection(db, "orders"));
  const usersSnap = await getDocs(collection(db, "users"));

  let revenue = 0;
  let pending = 0;
  ordersSnap.forEach((d) => {
    const o = d.data();
    revenue += o.total || 0;
    if ((o.status || "Pending") === "Pending") pending += 1;
  });

  document.getElementById("kpiOrders").textContent = ordersSnap.size;
  document.getElementById("kpiRevenue").textContent = peso(revenue);
  document.getElementById("kpiUsers").textContent = usersSnap.size;
  document.getElementById("kpiPending").textContent = pending;

  // User Management table (superadmin only — hidden for everyone else above)
  const tbody = document.getElementById("userMgmtBody");
  if (!tbody) return;

  tbody.innerHTML = usersSnap.docs
    .map((d) => {
      const u = d.data();
      const roles = ["user", "staff", "admin", "superadmin"];
      const options = roles
        .map((r) => `<option value="${r}" ${u.role === r ? "selected" : ""}>${r}</option>`)
        .join("");
      return `
        <tr>
          <td>${u.fullName || "—"}</td>
          <td>${u.email || "—"}</td>
          <td><select data-uid="${d.id}" class="role-select">${options}</select></td>
        </tr>`;
    })
    .join("");

  tbody.querySelectorAll(".role-select").forEach((select) => {
    select.addEventListener("change", async () => {
      await updateDoc(doc(db, "users", select.dataset.uid), { role: select.value });
    });
  });
}

/* =====================================================
   PRODUCTS
===================================================== */
function initProducts(role) {
  const tbody = document.querySelector("#adminProductsTable tbody");
  const form = document.getElementById("productForm");
  const editingIdField = document.getElementById("productEditingId");
  const formTitle = document.getElementById("productFormTitle");
  const cancelEditBtn = document.getElementById("cancelEditBtn");

  const productsRef = collection(db, "products");

  onSnapshot(query(productsRef, orderBy("name")), (snap) => {
    if (snap.empty) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">No products yet — add one using the form.</td></tr>`;
      return;
    }
    tbody.innerHTML = snap.docs
      .map((d) => {
        const p = d.data();
        const editable = ["admin", "superadmin"].includes(role);
        return `
          <tr>
            <td><img src="../${p.img || "assets/images/products/placeholder.jpg"}" alt="${p.name}" /></td>
            <td>${p.name}</td>
            <td>${p.category}<br><span class="text-muted" style="font-size:0.78rem;">${p.subcategory || ""}</span></td>
            <td>${peso(p.price)}</td>
            <td>${p.stock ?? "—"}</td>
            <td>
              ${
                editable
                  ? `<button class="icon-btn edit-product" data-id="${d.id}"><i class="bi bi-pencil"></i></button>
                     <button class="icon-btn danger delete-product" data-id="${d.id}"><i class="bi bi-trash3"></i></button>`
                  : ""
              }
            </td>
          </tr>`;
      })
      .join("");

    tbody.querySelectorAll(".edit-product").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const snap2 = await getDoc(doc(db, "products", btn.dataset.id));
        if (!snap2.exists()) return;
        const p = snap2.data();
        editingIdField.value = btn.dataset.id;
        document.getElementById("pName").value = p.name;
        document.getElementById("pCategory").value = p.category;
        document.getElementById("pSubcategory").value = p.subcategory || "";
        document.getElementById("pPrice").value = p.price;
        document.getElementById("pStock").value = p.stock ?? "";
        document.getElementById("pImg").value = p.img || "";
        formTitle.textContent = "Edit Product";
        cancelEditBtn.classList.remove("d-none");
        form.scrollIntoView({ behavior: "smooth" });
      }),
    );

    tbody.querySelectorAll(".delete-product").forEach((btn) =>
      btn.addEventListener("click", async () => {
        if (confirm("Delete this product?")) {
          await deleteDoc(doc(db, "products", btn.dataset.id));
        }
      }),
    );
  });

  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = {
        name: document.getElementById("pName").value.trim(),
        category: document.getElementById("pCategory").value,
        subcategory: document.getElementById("pSubcategory").value.trim(),
        price: Number(document.getElementById("pPrice").value),
        stock: Number(document.getElementById("pStock").value) || 0,
        img: document.getElementById("pImg").value.trim(),
      };

      if (editingIdField.value) {
        await updateDoc(doc(db, "products", editingIdField.value), data);
      } else {
        await addDoc(productsRef, { ...data, createdAt: serverTimestamp() });
      }

      form.reset();
      editingIdField.value = "";
      formTitle.textContent = "Add Product";
      cancelEditBtn.classList.add("d-none");
    });
  }

  if (cancelEditBtn) {
    cancelEditBtn.addEventListener("click", () => {
      form.reset();
      editingIdField.value = "";
      formTitle.textContent = "Add Product";
      cancelEditBtn.classList.add("d-none");
    });
  }
}

/* =====================================================
   ORDERS
===================================================== */
function initOrders() {
  const tbody = document.querySelector("#adminOrdersTable tbody");
  const statuses = ["Pending", "Processing", "Shipped", "Delivered", "Cancelled"];

  onSnapshot(query(collection(db, "orders"), orderBy("createdAt", "desc")), (snap) => {
    if (snap.empty) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">No orders yet.</td></tr>`;
      return;
    }
    tbody.innerHTML = snap.docs
      .map((d) => {
        const o = d.data();
        const date = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleDateString("en-PH") : "—";
        const options = statuses
          .map((s) => `<option value="${s}" ${o.status === s ? "selected" : ""}>${s}</option>`)
          .join("");
        return `
          <tr>
            <td>#${d.id.slice(0, 8).toUpperCase()}</td>
            <td>${o.shippingInfo?.fullName || "—"}<br><span class="text-muted" style="font-size:0.8rem;">${o.shippingInfo?.email || ""}</span></td>
            <td>${o.items?.length || 0} item${(o.items?.length || 0) > 1 ? "s" : ""}</td>
            <td>${peso(o.total)}</td>
            <td>${date}</td>
            <td><select data-id="${d.id}" class="status-select">${options}</select></td>
          </tr>`;
      })
      .join("");

    tbody.querySelectorAll(".status-select").forEach((select) => {
      select.addEventListener("change", async () => {
        await updateDoc(doc(db, "orders", select.dataset.id), { status: select.value });
      });
    });
  });
}

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
  const seedBtn = document.getElementById("seedProductsBtn");
  const editingIdField = document.getElementById("productEditingId");
  const formTitle = document.getElementById("productFormTitle");
  const cancelEditBtn = document.getElementById("cancelEditBtn");

  const productsRef = collection(db, "products");

  onSnapshot(query(productsRef, orderBy("name")), (snap) => {
    if (snap.empty) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">No products yet — use "Seed Sample Products" to get started.</td></tr>`;
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

  if (seedBtn) {
    seedBtn.addEventListener("click", async () => {
      const sample = [
        // ===== Category 1: Mobility & Home Safety =====
        // Walking Aids
        { name: "Folding Walker", category: "mobility", subcategory: "Walking Aids", price: 2950, stock: 20, img: "assets/images/products/product1.jpg" },
        { name: "Quad Cane", category: "mobility", subcategory: "Walking Aids", price: 1450, stock: 25, img: "assets/images/products/product2.jpg" },
        { name: "4-Wheel Rollator", category: "mobility", subcategory: "Walking Aids", price: 5200, stock: 12, img: "assets/images/products/product3.jpg" },
        { name: "Manual Wheelchair", category: "mobility", subcategory: "Walking Aids", price: 6500, stock: 8, img: "assets/images/products/product4.jpg" },
        { name: "Underarm Crutches", category: "mobility", subcategory: "Walking Aids", price: 1200, stock: 22, img: "assets/images/products/product5.jpg" },
        // Bathroom Safety
        { name: "Suction Grab Bar", category: "mobility", subcategory: "Bathroom Safety", price: 850, stock: 30, img: "assets/images/products/product6.jpg" },
        { name: "Shower Bench", category: "mobility", subcategory: "Bathroom Safety", price: 2350, stock: 15, img: "assets/images/products/product7.jpg" },
        { name: "Elevated Toilet Seat", category: "mobility", subcategory: "Bathroom Safety", price: 1650, stock: 18, img: "assets/images/products/product8.jpg" },
        { name: "Anti-Skid Bath Mat", category: "mobility", subcategory: "Bathroom Safety", price: 650, stock: 35, img: "assets/images/products/product9.jpg" },
        { name: "Bedside Commode Chair", category: "mobility", subcategory: "Bathroom Safety", price: 3200, stock: 10, img: "assets/images/products/product10.jpg" },
        // Bedroom Comfort & Safety
        { name: "Ripple Mattress", category: "mobility", subcategory: "Bedroom Comfort & Safety", price: 4800, stock: 10, img: "assets/images/products/product11.jpg" },
        { name: "Bed Assist Rail", category: "mobility", subcategory: "Bedroom Comfort & Safety", price: 1850, stock: 18, img: "assets/images/products/product12.jpg" },
        { name: "Donut Seat Cushion", category: "mobility", subcategory: "Bedroom Comfort & Safety", price: 950, stock: 25, img: "assets/images/products/product13.jpg" },
        { name: "Overbed Table", category: "mobility", subcategory: "Bedroom Comfort & Safety", price: 3600, stock: 9, img: "assets/images/products/product14.jpg" },
        { name: "LED Night Lights", category: "mobility", subcategory: "Bedroom Comfort & Safety", price: 780, stock: 40, img: "assets/images/products/product15.jpg" },

        // ===== Category 2: Wellness & Daily Medical Care =====
        // Daily Hygiene & Incontinence
        { name: "Adult Diapers", category: "wellness", subcategory: "Daily Hygiene & Incontinence", price: 780, stock: 50, img: "assets/images/products/product16.jpg" },
        { name: "Disposable Underpads", category: "wellness", subcategory: "Daily Hygiene & Incontinence", price: 650, stock: 40, img: "assets/images/products/product17.jpg" },
        { name: "Adult Wet Wipes", category: "wellness", subcategory: "Daily Hygiene & Incontinence", price: 420, stock: 60, img: "assets/images/products/product18.jpg" },
        { name: "Waterless Body Wash", category: "wellness", subcategory: "Daily Hygiene & Incontinence", price: 580, stock: 35, img: "assets/images/products/product19.jpg" },
        { name: "Skin Barrier Cream", category: "wellness", subcategory: "Daily Hygiene & Incontinence", price: 380, stock: 45, img: "assets/images/products/product20.jpg" },
        // Specialized Nutrition & Supplementation
        { name: "Ensure Gold Milk", category: "wellness", subcategory: "Specialized Nutrition & Supplementation", price: 1250, stock: 40, img: "assets/images/products/product21.jpg" },
        { name: "Glucerna Milk", category: "wellness", subcategory: "Specialized Nutrition & Supplementation", price: 1450, stock: 30, img: "assets/images/products/product22.jpg" },
        { name: "Food Thickener Powder", category: "wellness", subcategory: "Specialized Nutrition & Supplementation", price: 850, stock: 25, img: "assets/images/products/product23.jpg" },
        { name: "Smart Pill Organizer", category: "wellness", subcategory: "Specialized Nutrition & Supplementation", price: 780, stock: 28, img: "assets/images/products/product24.jpg" },
        { name: "Pill Crusher & Cutter", category: "wellness", subcategory: "Specialized Nutrition & Supplementation", price: 450, stock: 32, img: "assets/images/products/product25.jpg" },
        // Support & Apparel
        { name: "Compression Socks", category: "wellness", subcategory: "Support & Apparel", price: 550, stock: 35, img: "assets/images/products/product26.jpg" },
        { name: "Adaptive Dressing Gown", category: "wellness", subcategory: "Support & Apparel", price: 890, stock: 20, img: "assets/images/products/product27.jpg" },
        { name: "Cervical Pillow", category: "wellness", subcategory: "Support & Apparel", price: 980, stock: 25, img: "assets/images/products/product28.jpg" },
        { name: "Magnetic Knee Brace", category: "wellness", subcategory: "Support & Apparel", price: 750, stock: 22, img: "assets/images/products/product29.jpg" },
        { name: "Arm Sling", category: "wellness", subcategory: "Support & Apparel", price: 620, stock: 24, img: "assets/images/products/product30.jpg" },

        // ===== Category 3: Digital Health & Monitoring =====
        // Vital Signs Trackers
        { name: "Blood Pressure Monitor", category: "digital", subcategory: "Vital Signs Trackers", price: 1650, stock: 18, img: "assets/images/products/product31.jpg" },
        { name: "Pulse Oximeter", category: "digital", subcategory: "Vital Signs Trackers", price: 950, stock: 22, img: "assets/images/products/product32.jpg" },
        { name: "Infrared Thermometer", category: "digital", subcategory: "Vital Signs Trackers", price: 890, stock: 28, img: "assets/images/products/product33.jpg" },
        { name: "Glucometer Kit", category: "digital", subcategory: "Vital Signs Trackers", price: 1450, stock: 20, img: "assets/images/products/product34.jpg" },
        { name: "Smart Watch", category: "digital", subcategory: "Vital Signs Trackers", price: 2800, stock: 12, img: "assets/images/products/product35.jpg" },
        // Physical Therapy & Rehab
        { name: "Pedal Exerciser", category: "digital", subcategory: "Physical Therapy & Rehab", price: 1850, stock: 15, img: "assets/images/products/product36.jpg" },
        { name: "Resistance Bands Set", category: "digital", subcategory: "Physical Therapy & Rehab", price: 650, stock: 30, img: "assets/images/products/product37.jpg" },
        { name: "Hand Grip Strengthener", category: "digital", subcategory: "Physical Therapy & Rehab", price: 480, stock: 35, img: "assets/images/products/product38.jpg" },
        { name: "Hot & Cold Gel Pack", category: "digital", subcategory: "Physical Therapy & Rehab", price: 550, stock: 30, img: "assets/images/products/product39.jpg" },
        { name: "TENS Machine", category: "digital", subcategory: "Physical Therapy & Rehab", price: 2200, stock: 10, img: "assets/images/products/product40.jpg" },
        // Emergency Assistance
        { name: "Caregiver Pager System", category: "digital", subcategory: "Emergency Assistance", price: 2450, stock: 14, img: "assets/images/products/product41.jpg" },
        { name: "Emergency Siren Alarm", category: "digital", subcategory: "Emergency Assistance", price: 650, stock: 28, img: "assets/images/products/product42.jpg" },
        { name: "Oxygen Concentrator", category: "digital", subcategory: "Emergency Assistance", price: 8500, stock: 5, img: "assets/images/products/product43.jpg" },
        { name: "Medical Alert Bracelet", category: "digital", subcategory: "Emergency Assistance", price: 1200, stock: 20, img: "assets/images/products/product44.jpg" },
        { name: "First Aid Kit", category: "digital", subcategory: "Emergency Assistance", price: 1250, stock: 30, img: "assets/images/products/product45.jpg" },
      ];

      const existing = await getDocs(productsRef);
      const existingNames = new Set(existing.docs.map((d) => d.data().name));
      const toAdd = sample.filter((p) => !existingNames.has(p.name));

      if (toAdd.length === 0) {
        alert("All 45 catalog products are already in Firestore — nothing to add.");
        return;
      }

      for (const p of toAdd) {
        await addDoc(productsRef, { ...p, createdAt: serverTimestamp() });
      }
      alert(`Added ${toAdd.length} product(s).`);
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

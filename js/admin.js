// js/admin.js
// KalingaCare — Admin panel logic, shared by admin/admin-dashboard.html,
// admin/admin-products.html, admin/admin-orders.html, admin/admin-users.html,
// and admin/admin-settings.html (same pattern as auth.js
// serving both login.html and register.html: one file, DOM-guarded
// sections so each page only runs the code its own elements need).
//
// Role system: every "users" doc in Firestore has a `role` field, one of
// "user" | "staff" | "admin" | "superadmin". Access to /admin/* requires
// at least "staff". Only "superadmin" can see the User Management table
// and change other people's roles.

import { auth, db } from "./firebase.js";
import { showToast, resizeImageToDataUrl } from "./site.js";
import {
  onAuthStateChanged,
  signOut,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
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
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const ROLE_RANK = { user: 0, staff: 1, admin: 2, superadmin: 3 };
const MIN_ROLE = "staff"; // minimum role to enter any /admin/ page

function initials(name) {
  return (name || "?")
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
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

  const displayName = user.displayName || userData.fullName || user.email;

  const greeting = document.getElementById("headerGreeting");
  if (greeting)
    greeting.textContent = `Welcome back, ${(displayName || "").split(" ")[0]}!`;

  const headerAvatar = document.getElementById("headerAvatar");
  const headerName = document.getElementById("headerName");
  const headerRole = document.getElementById("headerRole");
  if (headerAvatar) headerAvatar.textContent = initials(displayName);
  if (headerName) headerName.textContent = displayName;
  if (headerRole) {
    headerRole.textContent = role;
    headerRole.className = `role-badge role-${role}`;
  }

  // Only superadmin sees the User Management panel on the dashboard.
  const userMgmt = document.getElementById("userMgmtSection");
  if (userMgmt) userMgmt.classList.toggle("d-none", role !== "superadmin");

  // Only admin/superadmin can add/edit/delete products; staff can view only.
  const productControls = document.querySelectorAll(".product-edit-only");
  productControls.forEach((el) =>
    el.classList.toggle("d-none", !["admin", "superadmin"].includes(role)),
  );

  initHeaderDropdowns();
  initNotifBell();
  initPageFor(role);
});

/* ===== Header user dropdown (top-right avatar) ===== */
function initHeaderDropdowns() {
  const userBtn = document.getElementById("headerUserBtn");
  const userDropdown = document.getElementById("headerUserDropdown");
  const logoutBtn = document.getElementById("headerLogoutBtn");

  if (userBtn && userDropdown) {
    userBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      userDropdown.classList.toggle("d-none");
    });
    document.addEventListener("click", (e) => {
      if (
        !userDropdown.classList.contains("d-none") &&
        !userDropdown.contains(e.target) &&
        !userBtn.contains(e.target)
      ) {
        userDropdown.classList.add("d-none");
      }
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await signOut(auth);
      window.location.href = "../index.html";
    });
  }
}

/* ===== Notification bell — real data: currently Pending orders =====
   Runs on every admin page (not just Orders), so a staff member sees it
   the moment they land on Dashboard or Products too. */
async function initNotifBell() {
  const bellBtn = document.getElementById("notifBellBtn");
  const dropdown = document.getElementById("notifDropdown");
  const dot = document.getElementById("notifDot");
  const list = document.getElementById("notifList");
  if (!bellBtn || !dropdown) return;

  const snap = await getDocs(
    query(collection(db, "orders"), where("status", "in", ["New", "Pending"])),
  );
  const pending = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort(
      (a, b) =>
        (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0),
    );

  // Recent reviews, most recent first — capped at 5, same as orders below.
  // Unlike orders (which naturally drop out of "Pending" once handled),
  // a review never resolves out of "recent" on its own, so the DOT only
  // reacts to reviews from the last 48h (see recentReviews filter below)
  // — otherwise it would stay lit forever after the very first review.
  let reviews = [];
  try {
    const reviewsSnap = await getDocs(
      query(collection(db, "reviews"), orderBy("createdAt", "desc"), limit(5)),
    );
    reviews = await Promise.all(
      reviewsSnap.docs.map(async (d) => {
        const r = { id: d.id, ...d.data() };
        const productSnap = await getDoc(doc(db, "products", r.productId));
        r.productName = productSnap.exists()
          ? productSnap.data().name
          : "a product";
        return r;
      }),
    );
  } catch (err) {
    // Composite index (createdAt) may not exist yet — fail quietly, same
    // approach used on the mobile side for this same query shape.
    console.error("Couldn't load recent reviews for notif bell:", err);
  }

  const TWO_DAYS_MS = 48 * 60 * 60 * 1000;
  const now = Date.now();
  const recentReviews = reviews.filter((r) => {
    const t = r.createdAt?.toMillis?.() || 0;
    return now - t < TWO_DAYS_MS;
  });

  if (pending.length > 0 || recentReviews.length > 0) {
    dot.classList.remove("d-none");
  } else {
    dot.classList.add("d-none");
  }

  const ordersHtml =
    pending.length > 0
      ? pending
          .slice(0, 5)
          .map(
            (o) => `
        <a href="orders.html" class="notif-item">
          <div class="notif-item-title">#${o.id.slice(0, 8).toUpperCase()} — ${o.shippingInfo?.fullName || "—"}</div>
          <div class="notif-item-sub">${peso(o.total)} · awaiting processing</div>
        </a>`,
          )
          .join("")
      : `<p class="notif-empty">No pending orders right now.</p>`;

  const reviewsHtml =
    reviews.length > 0
      ? reviews
          .map(
            (r) => `
        <a href="admin-products.html" class="notif-item">
          <div class="notif-item-title">${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)} on ${r.productName}</div>
          <div class="notif-item-sub">${r.userName || "A customer"}${r.text ? " · " + r.text.slice(0, 40) + (r.text.length > 40 ? "…" : "") : ""}</div>
        </a>`,
          )
          .join("")
      : `<p class="notif-empty">No reviews yet.</p>`;

  list.innerHTML = `
    <div class="notif-section-title">Orders</div>
    ${ordersHtml}
    <div class="notif-section-title">Recent Reviews</div>
    ${reviewsHtml}
  `;

  bellBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    dropdown.classList.toggle("d-none");
  });
  document.addEventListener("click", (e) => {
    if (
      !dropdown.classList.contains("d-none") &&
      !dropdown.contains(e.target) &&
      !bellBtn.contains(e.target)
    ) {
      dropdown.classList.add("d-none");
    }
  });
}

function initPageFor(role) {
  if (document.getElementById("kpiOrders")) initDashboard(role);
  if (document.getElementById("adminProductsTable")) initProducts(role);
  if (document.getElementById("adminOrdersTable")) initOrders(role);
  if (document.getElementById("staffMgmtBody")) initUsers(role);
  if (document.getElementById("adminNameForm")) initSettings();
}

/* =====================================================
   DASHBOARD
===================================================== */
const CATEGORY_LABELS = {
  mobility: "Mobility",
  wellness: "Wellness",
  digital: "Digital Health",
};
const CATEGORY_COLORS = {
  mobility: "#67c8f7",
  wellness: "#f8b4d9",
  digital: "#f6b93b",
};
const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function pctChange(current, previous) {
  if (previous === 0)
    return current === 0
      ? { label: "No change", cls: "neutral" }
      : { label: "New", cls: "positive" };
  const pct = ((current - previous) / previous) * 100;
  const rounded = Math.abs(pct) < 0.1 ? 0 : Math.round(pct * 10) / 10;
  if (rounded === 0) return { label: "No change", cls: "neutral" };
  return {
    label: `${rounded > 0 ? "+" : ""}${rounded}%`,
    cls: rounded > 0 ? "positive" : "negative",
  };
}

function renderKpiChange(elId, current, previous) {
  const el = document.getElementById(elId);
  if (!el) return;
  const { label, cls } = pctChange(current, previous);
  el.textContent = label;
  el.className = `kpi-change ${cls}`;
}

/* Comparing "all of this month so far" against "all of last month" always
   looks catastrophic in the first few weeks of a new month, since a 14-day-old
   month is compared against a full 30-day one. This instead compares matching
   date ranges: day 1 through today, this month vs. the same cutoff last month —
   shared by Dashboard and Products KPI cards so both use the identical fix. */
function getMonthToDateRanges() {
  const now = new Date();
  const daysInMonth = (year, monthIndex) =>
    new Date(year, monthIndex + 1, 0).getDate();

  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const thisCutoffDay = now.getDate();

  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthStart = new Date(
    lastMonthDate.getFullYear(),
    lastMonthDate.getMonth(),
    1,
  );
  const lastCutoffDay = Math.min(
    thisCutoffDay,
    daysInMonth(lastMonthDate.getFullYear(), lastMonthDate.getMonth()),
  );
  const lastMonthCutoff = new Date(
    lastMonthDate.getFullYear(),
    lastMonthDate.getMonth(),
    lastCutoffDay,
    23,
    59,
    59,
    999,
  );

  return {
    now,
    inThisMonthToDate: (d) => d >= thisMonthStart && d <= now,
    inLastMonthToDate: (d) => d >= lastMonthStart && d <= lastMonthCutoff,
  };
}

async function initDashboard(role) {
  const [ordersSnap, usersSnap, productsSnap] = await Promise.all([
    getDocs(collection(db, "orders")),
    getDocs(collection(db, "users")),
    getDocs(collection(db, "products")),
  ]);

  const orders = ordersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const users = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const products = productsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const productCategoryOf = Object.fromEntries(
    products.map((p) => [p.id, p.category]),
  );

  const { inThisMonthToDate, inLastMonthToDate } = getMonthToDateRanges();

  let revenue = 0;
  let pending = 0;
  let ordersThisMonth = 0;
  let ordersLastMonth = 0;
  let revenueThisMonth = 0;
  let revenueLastMonth = 0;

  orders.forEach((o) => {
    revenue += o.total || 0;
    if (["New", "Pending"].includes(o.status || "Pending")) pending += 1;
    const d = o.createdAt?.toDate ? o.createdAt.toDate() : null;
    if (!d) return;
    if (inThisMonthToDate(d)) {
      ordersThisMonth += 1;
      revenueThisMonth += o.total || 0;
    } else if (inLastMonthToDate(d)) {
      ordersLastMonth += 1;
      revenueLastMonth += o.total || 0;
    }
  });

  let usersThisMonth = 0;
  let usersLastMonth = 0;
  users.forEach((u) => {
    const d = u.createdAt?.toDate ? u.createdAt.toDate() : null;
    if (!d) return;
    if (inThisMonthToDate(d)) usersThisMonth += 1;
    else if (inLastMonthToDate(d)) usersLastMonth += 1;
  });

  document.getElementById("kpiOrders").textContent = orders.length;
  document.getElementById("kpiRevenue").textContent = peso(revenue);
  document.getElementById("kpiUsers").textContent = users.length;
  document.getElementById("kpiPending").textContent = pending;

  renderKpiChange("kpiOrdersChange", ordersThisMonth, ordersLastMonth);
  renderKpiChange("kpiRevenueChange", revenueThisMonth, revenueLastMonth);
  renderKpiChange("kpiUsersChange", usersThisMonth, usersLastMonth);

  /* ---- Charts (only if Chart.js + canvases are present, i.e. Dashboard page) ---- */
  if (
    typeof Chart !== "undefined" &&
    document.getElementById("ordersMonthChart")
  ) {
    renderDashboardCharts(orders, products, productCategoryOf);
  }
}

/* =====================================================
   USERS — dedicated page, grouped into Staff & Admins vs. Customers.
   Restricted to superadmin; staff/admin see a restricted-access notice.
===================================================== */
async function initUsers(role) {
  const restrictedNotice = document.getElementById("usersRestrictedNotice");
  const content = document.getElementById("usersContent");

  if (role !== "superadmin") {
    if (restrictedNotice) restrictedNotice.classList.remove("d-none");
    if (content) content.classList.add("d-none");
    return;
  }
  if (restrictedNotice) restrictedNotice.classList.add("d-none");
  if (content) content.classList.remove("d-none");

  const usersSnap = await getDocs(collection(db, "users"));
  const allUsers = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const staffBody = document.getElementById("staffMgmtBody");
  const customerBody = document.getElementById("customerMgmtBody");

  function roleOptions(u) {
    const roles = ["user", "staff", "admin", "superadmin"];
    return roles
      .map(
        (r) =>
          `<option value="${r}" ${u.role === r ? "selected" : ""}>${r}</option>`,
      )
      .join("");
  }

  function renderGroup(tbody, list, emptyMsg) {
    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="3" class="text-center text-muted py-4">${emptyMsg}</td></tr>`;
      return;
    }
    tbody.innerHTML = list
      .map(
        (u) => `
        <tr>
          <td>${u.fullName || "—"}</td>
          <td>${u.email || "—"}</td>
          <td><select data-uid="${u.id}" class="role-select">${roleOptions(u)}</select></td>
        </tr>`,
      )
      .join("");

    tbody.querySelectorAll(".role-select").forEach((select) => {
      select.addEventListener("change", async () => {
        try {
          await updateDoc(doc(db, "users", select.dataset.uid), {
            role: select.value,
          });
          showToast("Role updated.");
        } catch (err) {
          console.error(err);
          showToast("Couldn't update role — see console for details.");
        }
      });
    });
  }

  function renderAll(list) {
    const staff = list.filter((u) =>
      ["staff", "admin", "superadmin"].includes(u.role),
    );
    const customers = list.filter((u) => (u.role || "user") === "user");
    renderGroup(
      staffBody,
      staff,
      "No staff or admin accounts match that search.",
    );
    renderGroup(
      customerBody,
      customers,
      "No customer accounts match that search.",
    );
  }

  renderAll(allUsers);

  const searchInput = document.getElementById("userMgmtSearch");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      const term = searchInput.value.trim().toLowerCase();
      const filtered = term
        ? allUsers.filter(
            (u) =>
              (u.fullName || "").toLowerCase().includes(term) ||
              (u.email || "").toLowerCase().includes(term),
          )
        : allUsers;
      renderAll(filtered);
    });
  }
}

/* =====================================================
   SETTINGS — the logged-in admin's own name + photo.
===================================================== */
function initSettings() {
  const nameInput = document.getElementById("settingsFullName");
  const roleBadge = document.getElementById("settingsRoleBadge");
  const emailEl = document.getElementById("settingsEmail");
  const avatarImg = document.getElementById("avatarImg");
  const avatarInitialsText = document.getElementById("avatarInitialsText");
  const errorEl = document.getElementById("settingsError");
  const successEl = document.getElementById("settingsSuccess");

  function renderAvatar(name, photoBase64) {
    if (photoBase64) {
      avatarImg.src = photoBase64;
      avatarImg.classList.remove("d-none");
      avatarInitialsText.classList.add("d-none");
    } else {
      avatarImg.classList.add("d-none");
      avatarInitialsText.classList.remove("d-none");
      avatarInitialsText.textContent = initials(name);
    }
  }

  onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    const snap = await getDoc(doc(db, "users", user.uid));
    const userData = snap.exists() ? snap.data() : {};
    const role = userData.role || "user";

    nameInput.value = user.displayName || userData.fullName || "";
    emailEl.textContent = user.email || "—";
    roleBadge.textContent = role;
    roleBadge.className = `role-badge role-${role}`;
    renderAvatar(nameInput.value, userData.photoBase64);
  });

  function showMsg(el, text) {
    successEl.classList.add("d-none");
    errorEl.textContent = text;
    errorEl.classList.add("show");
  }

  document
    .getElementById("adminNameForm")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      errorEl.classList.remove("show");
      successEl.classList.add("d-none");
      const fullName = nameInput.value.trim();
      if (!fullName) return;

      try {
        await updateDoc(doc(db, "users", auth.currentUser.uid), { fullName });
        await updateProfile(auth.currentUser, { displayName: fullName });
        successEl.classList.remove("d-none");
        document.getElementById("headerName").textContent = fullName;
        document.getElementById("headerAvatar").textContent =
          initials(fullName);
      } catch (err) {
        showMsg(errorEl, "Couldn't save name — please try again.");
      }
    });

  document.getElementById("avatarEditBtn").addEventListener("click", () => {
    document.getElementById("avatarUpload").click();
  });

  document
    .getElementById("avatarUpload")
    .addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;

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
        await updateDoc(doc(db, "users", auth.currentUser.uid), {
          photoBase64: dataUrl,
        });
        renderAvatar(nameInput.value, dataUrl);
        document.getElementById("headerAvatar").innerHTML =
          `<img src="${dataUrl}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`;
      } catch (err) {
        showMsg(errorEl, err.message || "Couldn't update photo.");
      }
    });
}

/* ---- Chart builders — all data is real, derived from orders/products above ---- */
function renderDashboardCharts(orders, products, productCategoryOf) {
  const gridColor = "rgba(100, 116, 139, 0.08)";
  const textColor = "#64748b";
  Chart.defaults.font.family = "Poppins, sans-serif";

  /* Orders per month — last 6 calendar months, oldest to newest */
  const now = new Date();
  const monthBuckets = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthBuckets.push({ key: monthKey(d), label: MONTH_LABELS[d.getMonth()] });
  }
  const monthCounts = monthBuckets.map(
    (b) =>
      orders.filter(
        (o) => o.createdAt?.toDate && monthKey(o.createdAt.toDate()) === b.key,
      ).length,
  );

  new Chart(document.getElementById("ordersMonthChart"), {
    type: "bar",
    data: {
      labels: monthBuckets.map((b) => b.label),
      datasets: [
        {
          data: monthCounts,
          backgroundColor: "#67c8f7",
          borderRadius: 8,
          maxBarThickness: 38,
        },
      ],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { precision: 0, color: textColor },
          grid: { color: gridColor },
        },
        x: { ticks: { color: textColor }, grid: { display: false } },
      },
    },
  });

  /* Orders by day of week — across all-time orders */
  const dowCounts = [0, 0, 0, 0, 0, 0, 0];
  orders.forEach((o) => {
    const d = o.createdAt?.toDate ? o.createdAt.toDate() : null;
    if (d) dowCounts[d.getDay()] += 1;
  });

  new Chart(document.getElementById("ordersDowChart"), {
    type: "bar",
    data: {
      labels: DOW_LABELS,
      datasets: [
        {
          data: dowCounts,
          backgroundColor: "#f8b4d9",
          borderRadius: 8,
          maxBarThickness: 38,
        },
      ],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { precision: 0, color: textColor },
          grid: { color: gridColor },
        },
        x: { ticks: { color: textColor }, grid: { display: false } },
      },
    },
  });

  /* Top categories — by units sold across all order items, resolved via live product catalog */
  const categoryQty = { mobility: 0, wellness: 0, digital: 0 };
  orders.forEach((o) => {
    (o.items || []).forEach((item) => {
      const cat = productCategoryOf[item.id];
      if (cat && categoryQty[cat] !== undefined)
        categoryQty[cat] += item.qty || 0;
    });
  });
  const categoryTotal = Object.values(categoryQty).reduce((a, b) => a + b, 0);
  const categoryKeys = Object.keys(categoryQty);

  new Chart(document.getElementById("categoryDonutChart"), {
    type: "doughnut",
    data: {
      labels: categoryKeys.map((k) => CATEGORY_LABELS[k]),
      datasets: [
        {
          data: categoryKeys.map((k) => categoryQty[k]),
          backgroundColor: categoryKeys.map((k) => CATEGORY_COLORS[k]),
          borderWidth: 0,
        },
      ],
    },
    options: { plugins: { legend: { display: false } }, cutout: "68%" },
  });

  const legendEl = document.getElementById("categoryLegend");
  if (legendEl) {
    legendEl.innerHTML = categoryKeys
      .map((k) => {
        const pct =
          categoryTotal > 0
            ? Math.round((categoryQty[k] / categoryTotal) * 100)
            : 0;
        return `
          <div class="category-legend-item">
            <span class="category-legend-label"><span class="category-legend-swatch" style="background:${CATEGORY_COLORS[k]}"></span>${CATEGORY_LABELS[k]}</span>
            <span class="category-legend-pct">${categoryTotal > 0 ? pct + "%" : "—"}</span>
          </div>`;
      })
      .join("");
  }

  /* Top selling products — aggregate units sold + revenue across all order items */
  const productAgg = {};
  orders.forEach((o) => {
    (o.items || []).forEach((item) => {
      if (!productAgg[item.id])
        productAgg[item.id] = { name: item.name, qty: 0, revenue: 0 };
      productAgg[item.id].qty += item.qty || 0;
      productAgg[item.id].revenue += (item.price || 0) * (item.qty || 0);
    });
  });
  const topProducts = Object.entries(productAgg)
    .sort((a, b) => b[1].qty - a[1].qty)
    .slice(0, 5);

  const topTbody = document.querySelector("#topProductsTable tbody");
  if (topTbody) {
    if (topProducts.length === 0) {
      topTbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted py-4">No sales yet.</td></tr>`;
    } else {
      topTbody.innerHTML = topProducts
        .map(([productId, agg]) => {
          const cat = productCategoryOf[productId];
          return `
            <tr>
              <td>${agg.name}</td>
              <td>${cat ? CATEGORY_LABELS[cat] : "—"}</td>
              <td>${agg.qty}</td>
              <td>${peso(agg.revenue)}</td>
            </tr>`;
        })
        .join("");
    }
  }
}

/* =====================================================
   PRODUCTS
===================================================== */
// Stock at or below this (but above 0) shows as "Low Stock". Adjust here if
// the group wants a different cutoff — it's the only place this lives.
const LOW_STOCK_THRESHOLD = 10;

function stockStatusOf(stock) {
  const s = stock ?? 0;
  if (s === 0) return "out";
  if (s <= LOW_STOCK_THRESHOLD) return "low";
  return "instock";
}

function stockBadge(status) {
  const labels = { instock: "In Stock", low: "Low Stock", out: "Out of Stock" };
  return `<span class="status-badge status-${status}">${labels[status]}</span>`;
}

function initProducts(role) {
  const tbody = document.querySelector("#adminProductsTable tbody");
  const form = document.getElementById("productForm");
  const editingIdField = document.getElementById("productEditingId");
  const formTitle = document.getElementById("productFormTitle");
  const editable = ["admin", "superadmin"].includes(role);

  const productsRef = collection(db, "products");

  /* ---- KPI cards: Total Orders / Monthly Revenue / Out of Stock ----
     Same month-to-date comparison fix used on Dashboard, so the two pages
     never disagree on what "this month" means. */
  (async () => {
    const ordersSnap = await getDocs(collection(db, "orders"));
    const orders = ordersSnap.docs.map((d) => d.data());
    const { inThisMonthToDate, inLastMonthToDate } = getMonthToDateRanges();

    let ordersThisMonth = 0;
    let ordersLastMonth = 0;
    let revenueThisMonth = 0;
    let revenueLastMonth = 0;

    orders.forEach((o) => {
      const d = o.createdAt?.toDate ? o.createdAt.toDate() : null;
      if (!d) return;
      if (inThisMonthToDate(d)) {
        ordersThisMonth += 1;
        revenueThisMonth += o.total || 0;
      } else if (inLastMonthToDate(d)) {
        ordersLastMonth += 1;
        revenueLastMonth += o.total || 0;
      }
    });

    document.getElementById("prodKpiOrders").textContent = orders.length;
    document.getElementById("prodKpiRevenue").textContent =
      peso(revenueThisMonth);
    renderKpiChange("prodKpiOrdersChange", ordersThisMonth, ordersLastMonth);
    renderKpiChange("prodKpiRevenueChange", revenueThisMonth, revenueLastMonth);
  })();

  // Cached locally so search/tabs/filters can re-render instantly without
  // re-querying Firestore — onSnapshot only needs to refresh this cache.
  let allProducts = [];
  let searchTerm = "";
  let stockFilter = new Set(["instock", "low", "out"]);
  let categoryFilter = new Set(["mobility", "wellness", "digital"]);
  let dateFilterValue = ""; // "" = no filter, else "YYYY-MM-DD"

  function localDateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function matchesFilters(p) {
    if (!stockFilter.has(stockStatusOf(p.stock))) return false;
    if (!categoryFilter.has(p.category)) return false;
    if (dateFilterValue) {
      const d = p.updatedAt?.toDate ? p.updatedAt.toDate() : null;
      if (!d || localDateKey(d) !== dateFilterValue) return false;
    }
    if (searchTerm) {
      const haystack =
        `${p.name} ${p.category} ${p.subcategory || ""}`.toLowerCase();
      if (!haystack.includes(searchTerm)) return false;
    }
    return true;
  }

  function renderRows() {
    const filtered = allProducts.filter(matchesFilters);

    document.getElementById("prodKpiOutOfStock").textContent =
      allProducts.filter((p) => stockStatusOf(p.stock) === "out").length;

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-4">No products match these filters.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered
      .map((p) => {
        const status = stockStatusOf(p.stock);
        const updated = p.updatedAt?.toDate
          ? p.updatedAt.toDate().toLocaleDateString("en-PH")
          : "—";
        const thumb =
          p.imgBase64 ||
          `../${p.img || "assets/images/products/placeholder.jpg"}`;
        return `
          <tr>
            <td><img src="${thumb}" alt="${p.name}" /></td>
            <td>${p.name}</td>
            <td>${p.category}<br><span class="text-muted" style="font-size:0.78rem;">${p.subcategory || ""}</span></td>
            <td>${peso(p.price)}</td>
            <td>${p.stock ?? "—"}</td>
            <td>${stockBadge(status)}</td>
            <td class="text-muted" style="font-size:0.85rem;">${updated}</td>
            <td>
              ${
                editable
                  ? `<button class="icon-btn edit-product" data-id="${p.id}"><i class="bi bi-pencil"></i></button>
                     <button class="icon-btn danger delete-product" data-id="${p.id}"><i class="bi bi-trash3"></i></button>`
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
        document.getElementById("pDescription").value = p.description || "";
        document.getElementById("pPrice").value = p.price;
        document.getElementById("pStock").value = p.stock ?? "";
        document.getElementById("pStock").disabled = true;
        document
          .getElementById("stockInlineAdjustWrap")
          .classList.remove("d-none");
        document.getElementById("stockInlineAdjustBtn").dataset.id =
          btn.dataset.id;

        // Older products only ever had one image (img/imgBase64, no images[]
        // array yet) — fall back to that single photo as a one-item gallery
        // so editing an old product doesn't look like it lost its picture.
        currentImages =
          p.images && p.images.length > 0
            ? [...p.images]
            : p.imgBase64 || p.img
              ? [p.imgBase64 || `../${p.img}`]
              : [];
        renderImageGrid();

        formTitle.textContent = "Edit Product";
        productModalInstance.show();
      }),
    );

    tbody.querySelectorAll(".delete-product").forEach((btn) =>
      btn.addEventListener("click", async () => {
        if (confirm("Delete this product?")) {
          await deleteDoc(doc(db, "products", btn.dataset.id));
        }
      }),
    );
  }

  onSnapshot(query(productsRef, orderBy("name")), (snap) => {
    allProducts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    document.getElementById("prodKpiOutOfStock").textContent =
      allProducts.filter((p) => stockStatusOf(p.stock) === "out").length;
    if (allProducts.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-4">No products yet — add one using the "Add Product" button.</td></tr>`;
      return;
    }
    renderRows();
  });

  /* ---- Search ---- */
  const searchInput = document.getElementById("productSearch");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      searchTerm = searchInput.value.trim().toLowerCase();
      renderRows();
    });
  }

  /* ---- Select Date filter (filters by Last Updated) ----
     A real <input type="date"> hidden behind a pill button, so it gets the
     browser's native calendar picker without hand-building one. */
  const dateBtn = document.getElementById("dateFilterBtn");
  const dateInput = document.getElementById("stockDateInput");
  const dateLabel = document.getElementById("selectDateLabel");
  const dateClearBtn = document.getElementById("dateFilterClear");

  if (dateBtn && dateInput) {
    dateBtn.addEventListener("click", () => {
      if (typeof dateInput.showPicker === "function") {
        try {
          dateInput.showPicker();
        } catch {
          dateInput.focus();
        }
      } else {
        dateInput.focus();
      }
    });

    dateInput.addEventListener("change", () => {
      dateFilterValue = dateInput.value;
      if (dateFilterValue) {
        const [y, m, d] = dateFilterValue.split("-").map(Number);
        dateLabel.textContent = new Date(y, m - 1, d).toLocaleDateString(
          "en-PH",
          { month: "short", day: "numeric", year: "numeric" },
        );
        dateClearBtn.classList.remove("d-none");
      } else {
        dateLabel.textContent = "Select Date";
        dateClearBtn.classList.add("d-none");
      }
      renderRows();
    });

    dateClearBtn.addEventListener("click", () => {
      dateInput.value = "";
      dateFilterValue = "";
      dateLabel.textContent = "Select Date";
      dateClearBtn.classList.add("d-none");
      renderRows();
    });
  }

  /* ---- Quick-filter tabs (kept in sync with the checkbox panel below) ---- */
  const tabsWrap = document.getElementById("productFilterTabs");
  const stockCheckboxes = document.querySelectorAll(".pf-stock");
  const categoryCheckboxes = document.querySelectorAll(".pf-category");

  function setActiveTab(tab) {
    tabsWrap
      .querySelectorAll(".filter-tab")
      .forEach((btn) =>
        btn.classList.toggle("active", btn.dataset.tab === tab),
      );
    stockFilter =
      tab === "all" ? new Set(["instock", "low", "out"]) : new Set([tab]);
    stockCheckboxes.forEach((cb) => (cb.checked = stockFilter.has(cb.value)));
    renderRows();
  }

  if (tabsWrap) {
    tabsWrap.querySelectorAll(".filter-tab").forEach((btn) => {
      btn.addEventListener("click", () => setActiveTab(btn.dataset.tab));
    });
  }

  /* ---- Filters flyout panel (Stock Status + Category, multi-select) ---- */
  const filtersBtn = document.getElementById("productFiltersBtn");
  const filtersPanel = document.getElementById("productFiltersPanel");

  if (filtersBtn && filtersPanel) {
    filtersBtn.addEventListener("click", () => {
      filtersPanel.classList.toggle("d-none");
      filtersBtn.classList.toggle(
        "active",
        !filtersPanel.classList.contains("d-none"),
      );
    });

    document.addEventListener("click", (e) => {
      if (
        !filtersPanel.classList.contains("d-none") &&
        !filtersPanel.contains(e.target) &&
        !filtersBtn.contains(e.target)
      ) {
        filtersPanel.classList.add("d-none");
        filtersBtn.classList.remove("active");
      }
    });

    document
      .getElementById("productFiltersApply")
      .addEventListener("click", () => {
        stockFilter = new Set(
          Array.from(stockCheckboxes)
            .filter((cb) => cb.checked)
            .map((cb) => cb.value),
        );
        categoryFilter = new Set(
          Array.from(categoryCheckboxes)
            .filter((cb) => cb.checked)
            .map((cb) => cb.value),
        );
        // A custom multi-select doesn't map to one tab, so only "All Stock" stays
        // highlighted, and only when the panel's selection happens to equal it.
        const isAll = stockFilter.size === 3;
        tabsWrap
          .querySelectorAll(".filter-tab")
          .forEach((btn) =>
            btn.classList.toggle("active", isAll && btn.dataset.tab === "all"),
          );
        filtersPanel.classList.add("d-none");
        filtersBtn.classList.remove("active");
        renderRows();
      });

    document
      .getElementById("productFiltersCancel")
      .addEventListener("click", () => {
        // Discard unapplied checkbox edits, reverting to the last applied filter.
        stockCheckboxes.forEach(
          (cb) => (cb.checked = stockFilter.has(cb.value)),
        );
        categoryCheckboxes.forEach(
          (cb) => (cb.checked = categoryFilter.has(cb.value)),
        );
        filtersPanel.classList.add("d-none");
        filtersBtn.classList.remove("active");
      });

    document
      .getElementById("productFiltersReset")
      .addEventListener("click", () => {
        stockCheckboxes.forEach((cb) => (cb.checked = true));
        categoryCheckboxes.forEach((cb) => (cb.checked = true));
        categoryFilter = new Set(["mobility", "wellness", "digital"]);
        setActiveTab("all");
      });
  }

  /* ---- Add / Edit Product modal ---- */
  const productModalEl = document.getElementById("productModal");
  const productModalInstance = new bootstrap.Modal(productModalEl);

  const addProductBtn = document.getElementById("addProductBtn");
  if (addProductBtn) {
    addProductBtn.addEventListener("click", () => {
      formTitle.textContent = "Add Product";
      productModalInstance.show();
    });
  }

  /* ---- Image drag-and-drop, up to 4 photos (images[]) ----
     Resizes each client-side via the shared resizeImageToDataUrl (same
     approach as avatar uploads) and stores the array as `images` on the
     product doc, mirroring the first photo into the older `imgBase64`
     field so every other page (cards, cart, checkout, admin table) that
     still reads a single image keeps working unchanged. No Firebase
     Storage needed — consistent with the rest of the app. Mobile's
     gallery already reads `images[]` if present (see ProductDetail.tsx),
     so this is the write side of a schema mobile was already built for. */
  const MAX_PRODUCT_IMAGES = 4;
  const dropZone = document.getElementById("imageDropZone");
  const fileInput = document.getElementById("imageFileInput");
  const gridPreview = document.getElementById("imageGridPreview");
  const pImgBase64Field = document.getElementById("pImgBase64");
  let currentImages = []; // array of data URLs (or a legacy `../path` string on first load)

  function renderImageGrid() {
    gridPreview.innerHTML = currentImages
      .map(
        (src, i) => `
        <div class="image-grid-item${i === 0 ? " is-cover" : ""}">
          <img src="${src}" alt="" />
          ${i === 0 ? '<span class="image-grid-cover-tag">Cover</span>' : ""}
          <button type="button" class="remove-image-btn" data-index="${i}" title="Remove photo">
            <i class="bi bi-x"></i>
          </button>
        </div>`,
      )
      .join("");
    dropZone.classList.toggle("d-none", currentImages.length >= MAX_PRODUCT_IMAGES);
  }

  async function handleImageFiles(fileList) {
    const files = Array.from(fileList || []);
    const room = MAX_PRODUCT_IMAGES - currentImages.length;
    if (files.length > room) {
      showToast(
        room > 0
          ? `Only ${room} more photo${room === 1 ? "" : "s"} allowed (max ${MAX_PRODUCT_IMAGES}).`
          : `Maximum ${MAX_PRODUCT_IMAGES} photos per product.`,
      );
    }
    for (const file of files.slice(0, room)) {
      if (!file.type.startsWith("image/")) {
        showToast("Please choose an image file.");
        continue;
      }
      if (file.size > 8 * 1024 * 1024) {
        showToast("Image is too large (max 8MB before resizing).");
        continue;
      }
      try {
        const dataUrl = await resizeImageToDataUrl(file, 500, 0.75);
        currentImages.push(dataUrl);
      } catch (err) {
        showToast(err.message || "Couldn't read that image.");
      }
    }
    renderImageGrid();
  }

  if (dropZone) {
    dropZone.addEventListener("click", () => fileInput.click());
    dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropZone.classList.add("dragover");
    });
    dropZone.addEventListener("dragleave", () =>
      dropZone.classList.remove("dragover"),
    );
    dropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropZone.classList.remove("dragover");
      handleImageFiles(e.dataTransfer.files);
    });
    fileInput.addEventListener("change", (e) => {
      handleImageFiles(e.target.files);
      fileInput.value = ""; // allow re-selecting the same file later
    });
  }

  gridPreview.addEventListener("click", (e) => {
    const btn = e.target.closest(".remove-image-btn");
    if (!btn) return;
    currentImages.splice(Number(btn.dataset.index), 1);
    renderImageGrid();
  });

  /* ---- Adjust Stock, triggered from inside the edit modal ----
     Stacks on top of the product modal: hide this one, open the stock
     modal for the same product. Nothing needs to reopen afterward — the
     table refreshes live via onSnapshot once the stock change is confirmed. */
  const stockInlineAdjustBtn = document.getElementById("stockInlineAdjustBtn");
  if (stockInlineAdjustBtn) {
    stockInlineAdjustBtn.addEventListener("click", async () => {
      const productId = stockInlineAdjustBtn.dataset.id;
      if (!productId) return;
      const snap2 = await getDoc(doc(db, "products", productId));
      if (!snap2.exists()) return;
      productModalInstance.hide();
      openStockModal(productId, snap2.data());
    });
  }

  // Always reset to a clean "Add" state when the modal closes, whether that's
  // from a successful save, the × button, backdrop click, or Esc — one place
  // to keep the form from ever reopening stale.
  productModalEl.addEventListener("hidden.bs.modal", () => {
    form.reset();
    editingIdField.value = "";
    document.getElementById("pStock").disabled = false;
    document.getElementById("stockInlineAdjustWrap").classList.add("d-none");
    currentImages = [];
    fileInput.value = "";
    renderImageGrid();
    formTitle.textContent = "Add Product";
  });

  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      // "../assets/..." is only how a legacy path-based image is prefixed
      // to display correctly from inside /admin/ — it must never be saved
      // back to Firestore that way, since every other page (products.js,
      // cart, checkout) resolves `img` relative to the site root instead.
      const canonicalImages = currentImages.map((src) =>
        src.startsWith("../") ? src.slice(3) : src,
      );
      // Cover image (index 0) also mirrors into the older img/imgBase64
      // fields so every page that predates the images[] array — product
      // cards, cart, checkout, the admin table — keeps showing a photo
      // without needing its own update.
      const cover = canonicalImages[0] || "";
      const data = {
        name: document.getElementById("pName").value.trim(),
        category: document.getElementById("pCategory").value,
        subcategory: document.getElementById("pSubcategory").value.trim(),
        description: document.getElementById("pDescription").value.trim(),
        price: Number(document.getElementById("pPrice").value),
        stock: Number(document.getElementById("pStock").value) || 0,
        images: canonicalImages,
        img: cover.startsWith("data:") ? "" : cover,
        imgBase64: cover.startsWith("data:") ? cover : null,
        updatedAt: serverTimestamp(),
      };

      try {
        if (editingIdField.value) {
          await updateDoc(doc(db, "products", editingIdField.value), data);
          showToast(`${data.name} updated.`);
        } else {
          await addDoc(productsRef, { ...data, createdAt: serverTimestamp() });
          showToast(`${data.name} added.`);
        }
        productModalInstance.hide();
      } catch (err) {
        console.error(err);
        showToast("Couldn't save — see console for details.");
      }
    });
  }

  wireStockModal();
}

/* =====================================================
   STOCK ADJUSTMENT MODAL
   Two-step confirm for the one path that can silently zero out or drastically
   change a product's stock: edit → new quantity → explicit "are you sure"
   showing old → new before anything writes to Firestore.
===================================================== */
let stockModalEl, stockModalInstance;
let currentStockProductId = null;
let currentStockName = "";
let currentStockOldQty = 0;

function openStockModal(productId, product) {
  currentStockProductId = productId;
  currentStockName = product.name;
  currentStockOldQty = product.stock ?? 0;

  document.getElementById("stockProductName").textContent = currentStockName;
  document.getElementById("stockCurrentQty").textContent = currentStockOldQty;
  document.getElementById("stockNewQty").value = currentStockOldQty;

  showStockStep("edit");
  stockModalInstance.show();
}

function showStockStep(step) {
  document
    .getElementById("stockStepEdit")
    .classList.toggle("d-none", step !== "edit");
  document
    .getElementById("stockStepConfirm")
    .classList.toggle("d-none", step !== "confirm");
  document
    .getElementById("stockBackBtn")
    .classList.toggle("d-none", step !== "confirm");
  document
    .getElementById("stockConfirmBtn")
    .classList.toggle("d-none", step !== "confirm");
  document
    .getElementById("stockContinueBtn")
    .classList.toggle("d-none", step !== "edit");
}

function wireStockModal() {
  stockModalEl = document.getElementById("stockModal");
  if (!stockModalEl || stockModalInstance) return; // already wired, or not on this page

  stockModalInstance = new bootstrap.Modal(stockModalEl);
  const newQtyInput = document.getElementById("stockNewQty");

  document.getElementById("stockContinueBtn").addEventListener("click", () => {
    const newQty = Number(newQtyInput.value);
    if (Number.isNaN(newQty) || newQty < 0) {
      newQtyInput.focus();
      return;
    }

    document.getElementById("confirmProductName").textContent =
      currentStockName;
    document.getElementById("confirmOldQty").textContent = currentStockOldQty;
    document.getElementById("confirmNewQty").textContent = newQty;

    const warning = document.getElementById("confirmWarning");
    const drop = currentStockOldQty - newQty;
    if (newQty === 0 && currentStockOldQty > 0) {
      warning.textContent = "This will take the product out of stock.";
      warning.classList.remove("d-none");
    } else if (currentStockOldQty > 0 && drop / currentStockOldQty >= 0.5) {
      warning.textContent = `This is a ${Math.round((drop / currentStockOldQty) * 100)}% reduction from the current stock.`;
      warning.classList.remove("d-none");
    } else {
      warning.classList.add("d-none");
    }

    showStockStep("confirm");
  });

  document.getElementById("stockBackBtn").addEventListener("click", () => {
    showStockStep("edit");
  });

  document
    .getElementById("stockConfirmBtn")
    .addEventListener("click", async () => {
      const newQty = Number(newQtyInput.value);
      await updateDoc(doc(db, "products", currentStockProductId), {
        stock: newQty,
        updatedAt: serverTimestamp(),
      });
      stockModalInstance.hide();
      showToast(
        `Stock updated — ${currentStockName} now has ${newQty} in stock.`,
      );
    });

  // Reset to step 1 whenever the modal closes, so it doesn't reopen mid-confirm next time.
  stockModalEl.addEventListener("hidden.bs.modal", () => {
    showStockStep("edit");
    currentStockProductId = null;
  });
}

/* =====================================================
   ORDERS
===================================================== */
const PAYMENT_LABELS = {
  cod: "Cash on Delivery",
  card: "Card",
  paypal: "PayPal",
};
// Matches the customer-side rule in profile.js exactly (CANCELLABLE = ["new","pending","processing"]) —
// once an order is Shipped or Delivered, neither the customer nor an admin can cancel it here.
const CANCELLABLE_STATUSES = ["New", "Pending", "Processing"];

function wireToolbarDropdown(btnId, menuId, labelId, onSelect) {
  const btn = document.getElementById(btnId);
  const menu = document.getElementById(menuId);
  const label = document.getElementById(labelId);
  if (!btn || !menu) return;

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    document.querySelectorAll(".toolbar-dropdown-menu").forEach((m) => {
      if (m !== menu) m.classList.add("d-none");
    });
    menu.classList.toggle("d-none");
  });

  menu.querySelectorAll(".tdm-item").forEach((item) => {
    item.addEventListener("click", () => {
      menu
        .querySelectorAll(".tdm-item")
        .forEach((i) => i.classList.remove("active"));
      item.classList.add("active");
      if (label) label.textContent = item.textContent.trim();
      menu.classList.add("d-none");
      onSelect(item.dataset.value);
    });
  });

  document.addEventListener("click", (e) => {
    if (
      !menu.classList.contains("d-none") &&
      !menu.contains(e.target) &&
      !btn.contains(e.target)
    ) {
      menu.classList.add("d-none");
    }
  });
}

function initOrders() {
  const tbody = document.querySelector("#adminOrdersTable tbody");
  const statuses = [
    "New",
    "Pending",
    "Processing",
    "Shipped",
    "Delivered",
    "Cancelled",
  ];

  let allOrders = [];
  let searchTerm = "";
  let statusFilterValue = "all";
  let paymentFilterValue = "all";
  let sortValue = "date-desc";
  const selectedIds = new Set();

  function matchesFilters(o) {
    const status = o.status || "Pending";
    if (statusFilterValue !== "all" && status !== statusFilterValue)
      return false;
    if (
      paymentFilterValue !== "all" &&
      o.shippingInfo?.paymentMethod !== paymentFilterValue
    )
      return false;
    if (searchTerm) {
      const haystack =
        `${o.id} ${o.shippingInfo?.fullName || ""} ${o.shippingInfo?.email || ""}`.toLowerCase();
      if (!haystack.includes(searchTerm)) return false;
    }
    return true;
  }

  function sortOrders(list) {
    const sorted = [...list];
    if (sortValue === "date-desc")
      sorted.sort(
        (a, b) =>
          (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0),
      );
    else if (sortValue === "date-asc")
      sorted.sort(
        (a, b) =>
          (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0),
      );
    else if (sortValue === "total-desc")
      sorted.sort((a, b) => (b.total || 0) - (a.total || 0));
    else if (sortValue === "total-asc")
      sorted.sort((a, b) => (a.total || 0) - (b.total || 0));
    return sorted;
  }

  function updateBulkBar() {
    const bar = document.getElementById("bulkActionBar");
    const countEl = document.getElementById("bulkSelectedCount");
    if (selectedIds.size > 0) {
      bar.classList.remove("d-none");
      countEl.textContent = `${selectedIds.size} selected`;
    } else {
      bar.classList.add("d-none");
    }
    const selectAll = document.getElementById("selectAllOrders");
    if (selectAll) {
      const visibleIds = allOrders.filter(matchesFilters).map((o) => o.id);
      const allChecked =
        visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
      selectAll.checked = allChecked;
      selectAll.indeterminate =
        !allChecked && visibleIds.some((id) => selectedIds.has(id));
    }
  }

  function renderRows() {
    const filtered = sortOrders(allOrders.filter(matchesFilters));

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted py-4">No orders match these filters.</td></tr>`;
      updateBulkBar();
      return;
    }

    tbody.innerHTML = filtered
      .map((o) => {
        const date = o.createdAt?.toDate
          ? o.createdAt.toDate().toLocaleDateString("en-PH")
          : "—";
        const status = o.status || "Pending";
        const payment = PAYMENT_LABELS[o.shippingInfo?.paymentMethod] || "—";
        const options = statuses
          .map(
            (s) =>
              `<option value="${s}" ${status === s ? "selected" : ""}>${s}</option>`,
          )
          .join("");
        return `
          <tr data-order-row="${o.id}">
            <td><input type="checkbox" class="order-row-check" data-id="${o.id}" ${selectedIds.has(o.id) ? "checked" : ""} /></td>
            <td>#${o.id.slice(0, 8).toUpperCase()}</td>
            <td>
              <div class="order-customer-cell">
                <div class="avatar avatar-sm">${initials(o.shippingInfo?.fullName)}</div>
                <div>
                  <div class="order-customer-name">${o.shippingInfo?.fullName || "—"}</div>
                  <span class="text-muted" style="font-size:0.78rem;">${o.shippingInfo?.email || ""}</span>
                </div>
              </div>
            </td>
            <td>${o.items?.length || 0} item${(o.items?.length || 0) > 1 ? "s" : ""}</td>
            <td>${peso(o.total)}</td>
            <td>${payment}</td>
            <td>${date}</td>
            <td>
              ${
                status === "Cancelled"
                  ? `<span class="status-badge status-cancelled">Cancelled</span>`
                  : `<select data-id="${o.id}" class="status-select status-${status.toLowerCase()}">${options}</select>`
              }
            </td>
            <td>
              <div class="row-action-wrap">
                <button type="button" class="row-action-btn" data-id="${o.id}"><i class="bi bi-three-dots"></i></button>
                <div class="row-action-menu d-none">
                  <button type="button" class="row-view-details" data-id="${o.id}"><i class="bi bi-eye"></i> View Details</button>
                  ${CANCELLABLE_STATUSES.includes(status) ? `<button type="button" class="row-cancel-order danger" data-id="${o.id}"><i class="bi bi-x-circle"></i> Cancel Order</button>` : ""}
                </div>
              </div>
            </td>
          </tr>`;
      })
      .join("");

    tbody.querySelectorAll(".order-row-check").forEach((cb) => {
      cb.addEventListener("click", (e) => e.stopPropagation());
      cb.addEventListener("change", () => {
        if (cb.checked) selectedIds.add(cb.dataset.id);
        else selectedIds.delete(cb.dataset.id);
        updateBulkBar();
      });
    });

    tbody.querySelectorAll(".status-select").forEach((select) => {
      select.addEventListener("click", (e) => e.stopPropagation());
      select.addEventListener("change", async () => {
        const previousClass = select.className;
        const newStatus = select.value;
        select.className = `status-select status-${newStatus.toLowerCase()}`;
        try {
          await updateDoc(doc(db, "orders", select.dataset.id), {
            status: newStatus,
          });
        } catch (err) {
          console.error(err);
          select.className = previousClass; // revert visual change since the write failed
          showToast("Couldn't update status — see console for details.");
        }
      });
    });

    tbody.querySelectorAll(".row-action-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const menu = btn.nextElementSibling;
        document.querySelectorAll(".row-action-menu").forEach((m) => {
          if (m !== menu) m.classList.add("d-none");
        });
        menu.classList.toggle("d-none");
      });
    });

    tbody.querySelectorAll(".row-view-details").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        btn.closest(".row-action-menu").classList.add("d-none");
        openOrderDetail(btn.dataset.id);
      });
    });

    tbody.querySelectorAll(".row-cancel-order").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        btn.closest(".row-action-menu").classList.add("d-none");
        if (!confirm("Cancel this order?")) return;
        try {
          await updateDoc(doc(db, "orders", btn.dataset.id), {
            status: "Cancelled",
          });
          showToast("Order cancelled.");
        } catch (err) {
          console.error(err);
          showToast("Couldn't cancel this order — see console for details.");
        }
      });
    });

    tbody.querySelectorAll("tr[data-order-row]").forEach((tr) => {
      tr.addEventListener("click", () => openOrderDetail(tr.dataset.orderRow));
    });

    updateBulkBar();
  }

  onSnapshot(
    query(collection(db, "orders"), orderBy("createdAt", "desc")),
    (snap) => {
      allOrders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (allOrders.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted py-4">No orders yet.</td></tr>`;
        return;
      }
      renderRows();
    },
  );

  // Close any open row action menu on outside click (button clicks stopPropagation, so this
  // only fires for genuine "elsewhere" clicks).
  document.addEventListener("click", () => {
    document
      .querySelectorAll(".row-action-menu")
      .forEach((m) => m.classList.add("d-none"));
  });

  /* ---- Search ---- */
  const searchInput = document.getElementById("orderSearch");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      searchTerm = searchInput.value.trim().toLowerCase();
      renderRows();
    });
  }

  /* ---- Toolbar dropdowns: Status / Payment / Sort ---- */
  wireToolbarDropdown(
    "statusFilterBtn",
    "statusFilterMenu",
    "statusFilterLabel",
    (val) => {
      statusFilterValue = val;
      renderRows();
    },
  );
  wireToolbarDropdown(
    "paymentFilterBtn",
    "paymentFilterMenu",
    "paymentFilterLabel",
    (val) => {
      paymentFilterValue = val;
      renderRows();
    },
  );
  wireToolbarDropdown("sortByBtn", "sortByMenu", "sortByLabel", (val) => {
    sortValue = val;
    renderRows();
  });

  /* ---- Select all + bulk cancel ---- */
  const selectAllCb = document.getElementById("selectAllOrders");
  if (selectAllCb) {
    selectAllCb.addEventListener("change", () => {
      const visibleIds = allOrders.filter(matchesFilters).map((o) => o.id);
      if (selectAllCb.checked) visibleIds.forEach((id) => selectedIds.add(id));
      else visibleIds.forEach((id) => selectedIds.delete(id));
      renderRows();
    });
  }

  const bulkCancelBtn = document.getElementById("bulkCancelBtn");
  if (bulkCancelBtn) {
    bulkCancelBtn.addEventListener("click", async () => {
      if (selectedIds.size === 0) return;

      const selectedOrders = allOrders.filter((o) => selectedIds.has(o.id));
      const cancellable = selectedOrders.filter((o) =>
        CANCELLABLE_STATUSES.includes(o.status || "Pending"),
      );
      const skipped = selectedOrders.length - cancellable.length;

      if (cancellable.length === 0) {
        showToast(
          "None of the selected orders can be cancelled (already Shipped/Delivered/Cancelled).",
        );
        return;
      }
      const skipNote =
        skipped > 0
          ? ` (${skipped} already Shipped/Delivered will be skipped)`
          : "";
      if (
        !confirm(`Cancel ${cancellable.length} selected order(s)?${skipNote}`)
      )
        return;

      try {
        await Promise.all(
          cancellable.map((o) =>
            updateDoc(doc(db, "orders", o.id), { status: "Cancelled" }),
          ),
        );
        selectedIds.clear();
        showToast(
          skipped > 0
            ? `${cancellable.length} order(s) cancelled, ${skipped} skipped.`
            : "Selected orders cancelled.",
        );
      } catch (err) {
        console.error(err);
        showToast(
          "Some orders couldn't be cancelled — see console for details.",
        );
      }
    });
  }

  /* ---- Order detail slide-over panel ---- */
  const detailPanel = document.getElementById("orderDetailPanel");
  const detailBackdrop = document.getElementById("orderPanelBackdrop");

  function closeOrderDetail() {
    detailPanel.classList.remove("open");
    detailBackdrop.classList.add("d-none");
  }

  async function openOrderDetail(orderId) {
    const o = allOrders.find((x) => x.id === orderId);
    if (!o) return;
    let status = o.status || "Pending";

    // Staff has now viewed this order — a "New" order becomes "Pending"
    // right here, the moment its detail panel opens. This is the one and
    // only place that transition happens; nothing else in the app writes
    // it. Local state is updated optimistically so the panel and table
    // reflect it immediately, matching the pattern used by the status
    // dropdown elsewhere in this file.
    if (status === "New") {
      status = "Pending";
      o.status = "Pending";
      try {
        await updateDoc(doc(db, "orders", orderId), { status: "Pending" });
      } catch (err) {
        console.error("Couldn't mark order as viewed:", err);
        showToast(
          "Couldn't update this order's status — see console for details.",
        );
      }
    }

    document.getElementById("odOrderId").textContent =
      `#${o.id.slice(0, 8).toUpperCase()}`;
    const badge = document.getElementById("odStatusBadge");
    badge.textContent = status;
    badge.className = `status-badge status-${status.toLowerCase()}`;

    const placedDate = o.createdAt?.toDate
      ? o.createdAt
          .toDate()
          .toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })
      : "—";
    document.getElementById("odPlacedDate").textContent =
      `Placed on ${placedDate}`;

    document.getElementById("odCustomerAvatar").textContent = initials(
      o.shippingInfo?.fullName,
    );
    document.getElementById("odCustomerName").textContent =
      o.shippingInfo?.fullName || "—";
    document.getElementById("odCustomerEmail").textContent =
      o.shippingInfo?.email || "—";

    const itemsList = document.getElementById("odItemsList");
    itemsList.innerHTML = (o.items || [])
      .map(
        (item) => `
        <div class="od-item-row">
          <img src="${item.imgBase64 || `../${item.img || "assets/images/products/placeholder.jpg"}`}" alt="${item.name}" />
          <div>
            <div class="od-item-name">${item.name}</div>
            <div class="od-item-qty">Qty: ${item.qty}</div>
          </div>
          <div class="od-item-price">${peso(item.price * item.qty)}</div>
        </div>`,
      )
      .join("");

    document.getElementById("odTotal").textContent = peso(o.total);

    const statusUpdateWrap = document.getElementById("odStatusUpdateWrap");
    const terminalNote = document.getElementById("odTerminalNote");
    const statusSelect = document.getElementById("odStatusSelect");

    if (status === "Cancelled") {
      statusUpdateWrap.classList.add("d-none");
      terminalNote.classList.remove("d-none");
    } else {
      statusUpdateWrap.classList.remove("d-none");
      terminalNote.classList.add("d-none");
      statusSelect.innerHTML = statuses
        .map(
          (s) =>
            `<option value="${s}" ${status === s ? "selected" : ""}>${s}</option>`,
        )
        .join("");
      statusSelect.className = `status-select status-${status.toLowerCase()}`;
      statusSelect.dataset.id = o.id;
    }

    const cancelBtn = document.getElementById("odCancelOrderBtn");
    cancelBtn.classList.toggle(
      "d-none",
      !CANCELLABLE_STATUSES.includes(status),
    );
    cancelBtn.dataset.id = o.id;

    detailPanel.classList.add("open");
    detailBackdrop.classList.remove("d-none");
  }

  document
    .getElementById("odCloseBtn")
    .addEventListener("click", closeOrderDetail);
  detailBackdrop.addEventListener("click", closeOrderDetail);

  document
    .getElementById("odStatusSelect")
    .addEventListener("change", async (e) => {
      const previousClass = e.target.className;
      const newStatus = e.target.value;
      e.target.className = `status-select status-${newStatus.toLowerCase()}`;
      try {
        await updateDoc(doc(db, "orders", e.target.dataset.id), {
          status: newStatus,
        });
        const badge = document.getElementById("odStatusBadge");
        badge.textContent = newStatus;
        badge.className = `status-badge status-${newStatus.toLowerCase()}`;
        document
          .getElementById("odCancelOrderBtn")
          .classList.toggle(
            "d-none",
            !CANCELLABLE_STATUSES.includes(newStatus),
          );

        // Selecting "Cancelled" directly from the dropdown is just as terminal
        // as using the Cancel Order button — lock the control immediately so
        // it can't be un-cancelled from here either.
        if (newStatus === "Cancelled") {
          document.getElementById("odStatusUpdateWrap").classList.add("d-none");
          document.getElementById("odTerminalNote").classList.remove("d-none");
        }
      } catch (err) {
        console.error(err);
        e.target.className = previousClass;
        showToast("Couldn't update status — see console for details.");
      }
    });

  document
    .getElementById("odCancelOrderBtn")
    .addEventListener("click", async (e) => {
      if (!confirm("Cancel this order?")) return;
      try {
        await updateDoc(doc(db, "orders", e.target.dataset.id), {
          status: "Cancelled",
        });
        showToast("Order cancelled.");
        closeOrderDetail();
      } catch (err) {
        console.error(err);
        showToast("Couldn't cancel this order — see console for details.");
      }
    });
}

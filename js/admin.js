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
import { updateOrder, manageUser, manageContent, manageReturn } from "./payments.js";
import { DEFAULT_PAGES } from "./cms.js";
import { COUNTRY_CURRENCY, populateCountrySelect } from "./currency.js";
import { isActive, splitList, parseSpecs, specsToText, youtubeId } from "./product-constants.js";
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
  startAfter,
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

// For anything a customer typed (names, reviews, contact messages) before
// it goes into innerHTML, so it shows as text and can't inject markup.
function escapeHtml(text) {
  return String(text ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
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
  initUnreadMessagesCount();
  initLowStockCount();
  initOpenReturnsCount();
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

  // Unread Contact Us messages (Admin → Messages).
  let unreadMessages = [];
  try {
    const msgSnap = await getDocs(
      query(collection(db, "contactMessages"), where("read", "==", false)),
    );
    unreadMessages = msgSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
  } catch (err) {
    console.error("Couldn't load messages for notif bell:", err);
  }

  const TWO_DAYS_MS = 48 * 60 * 60 * 1000;
  const now = Date.now();
  const recentReviews = reviews.filter((r) => {
    const t = r.createdAt?.toMillis?.() || 0;
    return now - t < TWO_DAYS_MS;
  });

  if (pending.length > 0 || recentReviews.length > 0 || unreadMessages.length > 0) {
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
        <a href="admin-orders.html" class="notif-item">
          <div class="notif-item-title">#${o.id.slice(0, 8).toUpperCase()} — ${escapeHtml(o.shippingInfo?.fullName || "—")}</div>
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
          <div class="notif-item-title">${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)} on ${escapeHtml(r.productName)}</div>
          <div class="notif-item-sub">${escapeHtml(r.userName || "A customer")}${r.text ? " · " + escapeHtml(r.text.slice(0, 40)) + (r.text.length > 40 ? "…" : "") : ""}</div>
        </a>`,
          )
          .join("")
      : `<p class="notif-empty">No reviews yet.</p>`;

  const messagesHtml =
    unreadMessages.length > 0
      ? unreadMessages
          .slice(0, 5)
          .map(
            (m) => `
        <a href="admin-messages.html" class="notif-item">
          <div class="notif-item-title">${escapeHtml(m.name)} — ${escapeHtml(m.subject)}</div>
          <div class="notif-item-sub">${escapeHtml((m.message || "").slice(0, 50))}${(m.message || "").length > 50 ? "…" : ""}</div>
        </a>`,
          )
          .join("")
      : `<p class="notif-empty">No new messages.</p>`;

  list.innerHTML = `
    <div class="notif-section-title">Messages</div>
    ${messagesHtml}
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
  if (document.getElementById("storeSettingsForm")) initStoreSettings(role);
  if (document.getElementById("auditBody")) initAudit(role);
  if (document.getElementById("promoBody")) initPromos(role);
  if (document.getElementById("returnBody")) initReturns(role);
  if (document.getElementById("announceForm")) initContent(role);
  if (document.getElementById("messagesList")) initMessages();
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
  mobility: "#1778ad",
  wellness: "#67c8f7",
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

/* Products that are running out (active ones only, lowest stock first). */
function renderStockAlerts(products) {
  const el = document.getElementById("lowStockList");
  if (!el) return;
  const low = products
    .filter((p) => isActive(p) && stockStatusOf(p.stock) !== "instock")
    .sort((a, b) => (a.stock ?? 0) - (b.stock ?? 0));
  if (!low.length) {
    el.innerHTML = `<p class="text-muted mb-0"><i class="bi bi-check-circle"></i> Every product has more than ${LOW_STOCK_THRESHOLD} in stock.</p>`;
    return;
  }
  const shown = low.slice(0, 8);
  el.innerHTML =
    shown
      .map(
        (p) => `
        <div class="alert-row">
          <span>${escapeHtml(p.name)}</span>
          <span>${p.stock ?? 0} left ${stockBadge(stockStatusOf(p.stock))}</span>
        </div>`,
      )
      .join("") +
    (low.length > shown.length
      ? `<p class="text-muted mb-0 mt-2" style="font-size:0.82rem">and ${low.length - shown.length} more.</p>`
      : "");
}

/* Who the customers are and how they buy, from real users and orders. */
function renderCustomerInsights(users, orders) {
  const el = document.getElementById("customerInsights");
  if (!el) return;
  const customers = users.filter((u) => (u.role || "user") === "user");
  const dayAgo30 = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const newCustomers = customers.filter((u) => (u.createdAt?.toMillis?.() || 0) >= dayAgo30).length;

  const byUser = {};
  orders.forEach((o) => {
    if (!o.userId) return;
    const entry = (byUser[o.userId] ||= { count: 0, spent: 0 });
    entry.count += 1;
    entry.spent += o.total || 0;
  });
  const buyers = Object.entries(byUser);
  const repeat = buyers.filter(([, v]) => v.count >= 2).length;
  const revenue = orders.reduce((sum, o) => sum + (o.total || 0), 0);
  const avgOrder = orders.length ? revenue / orders.length : 0;

  const countries = {};
  customers.forEach((u) => {
    const c = u.country || "Not set";
    countries[c] = (countries[c] || 0) + 1;
  });
  const topCountries = Object.entries(countries).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxCountry = topCountries[0]?.[1] || 1;

  const nameOf = Object.fromEntries(users.map((u) => [u.id, u.fullName || u.email || "Customer"]));
  const topSpenders = buyers.sort((a, b) => b[1].spent - a[1].spent).slice(0, 5);

  el.innerHTML = `
    <div class="insight-stats">
      <div class="insight-stat"><strong>${customers.length}</strong><span>Customers</span></div>
      <div class="insight-stat"><strong>${newCustomers}</strong><span>New in the last 30 days</span></div>
      <div class="insight-stat"><strong>${buyers.length ? Math.round((repeat / buyers.length) * 100) : 0}%</strong><span>Repeat buyers (${repeat} of ${buyers.length})</span></div>
      <div class="insight-stat"><strong>${peso(Math.round(avgOrder))}</strong><span>Average order</span></div>
    </div>
    <p class="insight-title">Customers by country</p>
    ${
      topCountries.length
        ? topCountries
            .map(
              ([c, n]) => `
          <div class="insight-bar">
            <span>${escapeHtml(c)}</span>
            <span class="insight-bar-track"><i style="width:${Math.round((n / maxCountry) * 100)}%"></i></span>
            <span>${n}</span>
          </div>`,
            )
            .join("")
        : `<p class="text-muted mb-0">No customers yet.</p>`
    }
    <p class="insight-title">Top customers by spend</p>
    ${
      topSpenders.length
        ? topSpenders
            .map(
              ([uid, v]) => `
          <div class="alert-row"><span>${escapeHtml(nameOf[uid] || "Customer")} <span class="text-muted">(${v.count} order${v.count === 1 ? "" : "s"})</span></span><strong>${peso(v.spent)}</strong></div>`,
            )
            .join("")
        : `<p class="text-muted mb-0">No orders yet.</p>`
    }`;
}

async function initDashboard(role) {
  const [ordersSnap, usersSnap, productsSnap] = await Promise.all([
    getDocs(collection(db, "orders")),
    getDocs(collection(db, "users")),
    getDocs(collection(db, "products")),
  ]);

  // Cancelled orders aren't sales: leave them out of orders, revenue and charts.
  const orders = ordersSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((o) => o.status !== "Cancelled");
  const users = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const products = productsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderStockAlerts(products);
  renderCustomerInsights(users, orders);
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
    // Money refunded for returns isn't revenue.
    const netTotal = (o.total || 0) - (o.refundedAmount || 0);
    revenue += netTotal;
    if (["New", "Pending"].includes(o.status || "Pending")) pending += 1;
    const d = o.createdAt?.toDate ? o.createdAt.toDate() : null;
    if (!d) return;
    if (inThisMonthToDate(d)) {
      ordersThisMonth += 1;
      revenueThisMonth += netTotal;
    } else if (inLastMonthToDate(d)) {
      ordersLastMonth += 1;
      revenueLastMonth += netTotal;
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
      tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">${emptyMsg}</td></tr>`;
      return;
    }
    tbody.innerHTML = list
      .map(
        (u) => {
          const isSelf = u.id === auth.currentUser?.uid;
          const isSuper = u.role === "superadmin";
          const canDelete = !isSelf && ["staff", "admin"].includes(u.role);
          const canSuspend = !isSelf && !isSuper;
          return `
        <tr class="${u.disabled ? "user-suspended" : ""}">
          <td>${escapeHtml(u.fullName || "—")}${isSelf ? ` <span class="text-muted">(you)</span>` : ""}</td>
          <td>${escapeHtml(u.email || "—")}</td>
          <td>${escapeHtml(u.country || "—")}</td>
          <td>${u.createdAt?.toDate ? u.createdAt.toDate().toLocaleDateString("en-PH") : "—"}</td>
          <td>${u.disabled ? `<span class="status-badge status-cancelled">Suspended</span>` : `<span class="status-badge status-delivered">Active</span>`}</td>
          <td><select data-uid="${u.id}" class="role-select" ${isSelf ? "disabled title=\"You can't change your own role\"" : ""}>${roleOptions(u)}</select></td>
          <td class="user-actions">
            <button class="icon-btn edit-user" data-uid="${u.id}" title="Edit details"><i class="bi bi-pencil"></i></button>
            ${canSuspend ? `<button class="icon-btn toggle-suspend ${u.disabled ? "" : "danger"}" data-uid="${u.id}" title="${u.disabled ? "Reactivate" : "Suspend"}"><i class="bi ${u.disabled ? "bi-person-check" : "bi-person-slash"}"></i></button>` : ""}
            ${canDelete ? `<button class="icon-btn danger delete-user" data-uid="${u.id}" title="Delete account"><i class="bi bi-trash3"></i></button>` : ""}
          </td>
        </tr>`;
        },
      )
      .join("");

    tbody.querySelectorAll(".role-select").forEach((select) => {
      select.addEventListener("change", async () => {
        const changed = allUsers.find((u) => u.id === select.dataset.uid);
        try {
          await manageUser({ action: "setRole", uid: select.dataset.uid, role: select.value });
          if (changed) changed.role = select.value; // so later filtering uses the new role
          showToast("Role updated.");
          applyUserFilters(); // it may now belong in the other table
        } catch (err) {
          console.error(err);
          select.value = changed?.role || "user";
          showToast(err.message || "Couldn't update role.");
        }
      });
    });

    tbody.querySelectorAll(".edit-user").forEach((btn) =>
      btn.addEventListener("click", () => openEditUser(btn.dataset.uid)),
    );

    tbody.querySelectorAll(".toggle-suspend").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const u = allUsers.find((x) => x.id === btn.dataset.uid);
        if (!u) return;
        const suspend = !u.disabled;
        const who = u.fullName || u.email;
        if (
          !confirm(
            suspend
              ? `Suspend ${who}? They'll be signed out and can't log in or order until you reactivate them.`
              : `Reactivate ${who}?`,
          )
        )
          return;
        btn.disabled = true;
        try {
          await manageUser({ action: "setSuspended", uid: u.id, suspended: suspend });
          u.disabled = suspend;
          showToast(suspend ? `${who} suspended.` : `${who} reactivated.`);
          applyUserFilters();
        } catch (err) {
          console.error(err);
          btn.disabled = false;
          showToast(err.message || "Couldn't update that account.");
        }
      }),
    );

    tbody.querySelectorAll(".delete-user").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const u = allUsers.find((x) => x.id === btn.dataset.uid);
        if (!u) return;
        if (!confirm(`Delete ${u.fullName || u.email}'s account? This can't be undone.`)) return;
        btn.disabled = true;
        try {
          await manageUser({ action: "delete", uid: u.id });
          allUsers.splice(allUsers.indexOf(u), 1);
          showToast("Account deleted.");
          applyUserFilters();
        } catch (err) {
          console.error(err);
          btn.disabled = false;
          showToast(err.message || "Couldn't delete that account.");
        }
      }),
    );
  }

  /* ---- Edit details ---- */
  const editModal = new bootstrap.Modal(document.getElementById("editUserModal"));
  populateCountrySelect(document.getElementById("euCountry"), "");
  const euError = document.getElementById("euError");

  function openEditUser(uid) {
    const u = allUsers.find((x) => x.id === uid);
    if (!u) return;
    document.getElementById("euUid").value = uid;
    document.getElementById("euEmail").textContent = u.email || "";
    document.getElementById("euName").value = u.fullName || "";
    const country = document.getElementById("euCountry");
    // A country not in the list (or blank) shows as the first entry; only
    // send it back if the person picked one.
    country.value = u.country && COUNTRY_CURRENCY[u.country] ? u.country : "";
    euError.style.display = "none";
    editModal.show();
  }

  document.getElementById("editUserForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const uid = document.getElementById("euUid").value;
    const u = allUsers.find((x) => x.id === uid);
    const submit = document.getElementById("euSubmit");
    const fullName = document.getElementById("euName").value.trim();
    const country = document.getElementById("euCountry").value;
    const body = { action: "update", uid, fullName };
    if (country && country !== (u?.country || "")) {
      body.country = country;
      body.currency = COUNTRY_CURRENCY[country] || "PHP";
    }
    submit.disabled = true;
    euError.style.display = "none";
    try {
      await manageUser(body);
      if (u) Object.assign(u, { fullName }, body.country ? { country: body.country, currency: body.currency } : {});
      editModal.hide();
      showToast("Account updated.");
      applyUserFilters();
    } catch (err) {
      euError.textContent = err.message;
      euError.style.display = "block";
    }
    submit.disabled = false;
  });

  /* ---- Add staff / admin ---- */
  const addModal = new bootstrap.Modal(document.getElementById("addUserModal"));
  const auError = document.getElementById("auError");
  document.getElementById("addUserBtn").addEventListener("click", () => {
    document.getElementById("addUserForm").reset();
    auError.style.display = "none";
    addModal.show();
  });

  document.getElementById("addUserForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const submit = document.getElementById("auSubmit");
    submit.disabled = true;
    submit.textContent = "Sending...";
    auError.style.display = "none";
    try {
      const result = await manageUser({
        action: "create",
        fullName: document.getElementById("auName").value.trim(),
        email: document.getElementById("auEmail").value.trim(),
        role: document.getElementById("auRole").value,
      });
      allUsers.push({
        id: result.uid,
        fullName: document.getElementById("auName").value.trim(),
        email: document.getElementById("auEmail").value.trim().toLowerCase(),
        role: document.getElementById("auRole").value,
        country: "",
        createdAt: { toDate: () => new Date(), toMillis: () => Date.now() },
      });
      addModal.hide();
      applyUserFilters();
      if (result.emailSent) {
        showToast("Invitation sent.");
      } else {
        // Email isn't set up or failed: let the Super Admin pass the link on.
        window.prompt("The account was created, but the email couldn't be sent. Copy this link and send it to them:", result.inviteLink);
      }
    } catch (err) {
      auError.textContent = err.message;
      auError.style.display = "block";
    }
    submit.disabled = false;
    submit.textContent = "Send Invitation";
  });

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

  const searchInput = document.getElementById("userMgmtSearch");
  const roleSelect = document.getElementById("userRoleFilter");
  const countrySelect = document.getElementById("userCountryFilter");
  const fromInput = document.getElementById("userJoinedFrom");
  const toInput = document.getElementById("userJoinedTo");
  const clearBtn = document.getElementById("userFiltersClear");
  const countEl = document.getElementById("usersResultCount");

  // Countries that actually appear in the data.
  [...new Set(allUsers.map((u) => u.country).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b))
    .forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      countrySelect.appendChild(opt);
    });

  const dayKey = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  function applyUserFilters() {
    const term = searchInput.value.trim().toLowerCase();
    const role = roleSelect.value;
    const country = countrySelect.value;
    const from = fromInput.value;
    const to = toInput.value;
    const filtered = allUsers.filter((u) => {
      if (role !== "all" && (u.role || "user") !== role) return false;
      if (country !== "all" && (u.country || "") !== country) return false;
      if (from || to) {
        const d = u.createdAt?.toDate ? u.createdAt.toDate() : null;
        if (!d) return false;
        if (from && dayKey(d) < from) return false;
        if (to && dayKey(d) > to) return false;
      }
      return (
        !term ||
        (u.fullName || "").toLowerCase().includes(term) ||
        (u.email || "").toLowerCase().includes(term)
      );
    });
    const active = term || role !== "all" || country !== "all" || from || to;
    clearBtn.classList.toggle("d-none", !active);
    countEl.textContent = `Showing ${filtered.length} of ${allUsers.length} accounts`;
    renderAll(filtered);
  }

  [searchInput, fromInput, toInput].forEach((el) => el.addEventListener("input", applyUserFilters));
  [roleSelect, countrySelect].forEach((el) => el.addEventListener("change", applyUserFilters));
  clearBtn.addEventListener("click", () => {
    searchInput.value = "";
    roleSelect.value = countrySelect.value = "all";
    fromInput.value = toInput.value = "";
    applyUserFilters();
  });

  applyUserFilters();
}

/* =====================================================
   SETTINGS — the logged-in admin's own name + photo.
===================================================== */
/* =====================================================
   RETURNS & REFUNDS — staff review requests, admins issue refunds
   (everything is saved by api/manage-return.js)
===================================================== */
const RETURN_STATUS_BADGE = {
  Requested: ["Waiting", "status-pending"],
  Approved: ["Approved", "status-processing"],
  Refunding: ["Refunding", "status-processing"],
  Refunded: ["Refunded", "status-delivered"],
  Rejected: ["Declined", "status-cancelled"],
  Cancelled: ["Withdrawn", "status-cancelled"],
};

function initReturns(role) {
  const content = document.getElementById("returnsContent");
  content.classList.remove("d-none");
  const isAdminRole = ["admin", "superadmin"].includes(role);
  const $ = (id) => document.getElementById(id);
  const modal = new bootstrap.Modal($("returnDetailModal"));
  let returns = [];
  let tab = "all";
  let openId = null;

  const when = (ts) => (ts?.toDate ? ts.toDate().toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" }) : "—");

  function rows() {
    const term = $("returnSearch").value.trim().toLowerCase();
    return returns
      .filter((r) => r.status !== "Cancelled")
      .filter((r) => tab === "all" || r.status === tab || (tab === "Approved" && r.status === "Refunding"))
      .filter((r) => {
        if (!term) return true;
        return [r.orderId, r.invoiceNo, r.customerName, r.reasonLabel, ...(r.items || []).map((i) => i.name)].join(" ").toLowerCase().includes(term);
      });
  }

  function render() {
    const waiting = returns.filter((r) => r.status === "Requested").length;
    $("rtCountRequested").textContent = waiting ? `(${waiting})` : "";
    const list = rows();
    if (!list.length) {
      $("returnBody").innerHTML = `<tr><td colspan="8" class="text-center text-muted py-4">${returns.length ? "No returns match." : "No return requests yet."}</td></tr>`;
      return;
    }
    $("returnBody").innerHTML = list
      .map((r) => {
        const [label, cls] = RETURN_STATUS_BADGE[r.status] || [r.status, ""];
        return `
        <tr>
          <td class="audit-when">${when(r.requestedAt)}</td>
          <td>#${escapeHtml(r.orderId.slice(0, 8).toUpperCase())}${r.invoiceNo ? `<br><span class="text-muted" style="font-size:0.78rem">${escapeHtml(r.invoiceNo)}</span>` : ""}</td>
          <td>${escapeHtml(r.customerName || "—")}</td>
          <td>${(r.items || []).map((i) => `${escapeHtml(i.name)} &times; ${i.qty}`).join("<br>")}</td>
          <td>${escapeHtml(r.reasonLabel || "")}</td>
          <td>${peso(r.refundAmount)}</td>
          <td><span class="status-badge ${cls}">${label}</span></td>
          <td><button type="button" class="icon-btn return-open" data-id="${r.id}" title="Review"><i class="bi bi-eye"></i></button></td>
        </tr>`;
      })
      .join("");
  }

  function detail(r) {
    const online = r.paymentMethod === "online";
    const [label, cls] = RETURN_STATUS_BADGE[r.status] || [r.status, ""];
    let actions = "";
    if (r.status === "Requested") {
      actions = `
        <label class="stock-modal-label" for="rdNote">Note to the customer ${"(required if you decline)"}</label>
        <textarea id="rdNote" rows="2" maxlength="500" class="form-control mb-2"></textarea>
        <div class="d-flex gap-2 flex-wrap">
          <button type="button" class="btn-success" id="rdApprove">Approve return</button>
          <button type="button" class="stock-modal-btn-secondary" id="rdReject">Decline</button>
        </div>`;
    } else if (r.status === "Approved") {
      actions = isAdminRole
        ? `
        <p class="mb-2" style="font-size:0.9rem">${
          online && r.paid
            ? `The customer paid online, so <strong>${peso(r.refundAmount)}</strong> goes back to their original payment method through PayMongo.`
            : `Refund <strong>${peso(r.refundAmount)}</strong> to the customer yourself (cash or bank transfer), then mark it refunded here.`
        }</p>
        <label class="settings-check mb-2"><input type="checkbox" id="rdRestock" checked /> Put the returned items back in stock</label>
        ${online && r.paid ? "" : `<input type="text" id="rdRef" class="form-control mb-2" maxlength="120" placeholder="Reference, e.g. GCash ref no. (optional)" />`}
        <div class="d-flex gap-2 flex-wrap align-items-center">
          <button type="button" class="btn-success" id="rdRefund">${online && r.paid ? "Refund through PayMongo" : "Mark as refunded"}</button>
          ${online && r.paid ? `<button type="button" class="toolbar-link" id="rdManual">I refunded it another way</button>` : ""}
        </div>`
        : `<p class="text-muted mb-0">Only an Admin can issue the refund.</p>`;
    }
    $("rdTitle").textContent = `Return for order #${r.orderId.slice(0, 8).toUpperCase()}`;
    $("rdBody").innerHTML = `
      <div class="d-flex flex-wrap gap-3 mb-3 align-items-center">
        <span class="status-badge ${cls}">${label}</span>
        <span class="text-muted" style="font-size:0.85rem">Requested ${when(r.requestedAt)} by ${escapeHtml(r.customerName || "the customer")}</span>
      </div>
      <p class="insight-title" style="margin-top:0">Items to return</p>
      ${(r.items || []).map((i) => `<div class="alert-row"><span>${escapeHtml(i.name)} &times; ${i.qty}</span><span>${peso(i.price * i.qty)}</span></div>`).join("")}
      <div class="alert-row"><strong>Refund (shipping isn't refunded)</strong><strong>${peso(r.refundAmount)}</strong></div>
      <p class="insight-title">Why</p>
      <p class="mb-1">${escapeHtml(r.reasonLabel || "")}</p>
      ${r.note ? `<p class="text-muted" style="font-size:0.9rem">"${escapeHtml(r.note)}"</p>` : ""}
      <p class="insight-title">Payment</p>
      <p class="mb-3">${online ? (r.paid ? "Paid online (PayMongo)" : "Online payment, not marked paid") : "Cash on Delivery"}</p>
      ${r.decidedAt ? `<p class="text-muted" style="font-size:0.85rem">${r.status === "Rejected" ? "Declined" : "Approved"} by ${escapeHtml(r.decidedByName || "staff")} on ${when(r.decidedAt)}${r.staffNote ? `: "${escapeHtml(r.staffNote)}"` : ""}</p>` : ""}
      ${r.refundedAt ? `<p class="text-muted" style="font-size:0.85rem">Refunded ${peso(r.refundAmount)} by ${escapeHtml(r.refundedByName || "an admin")} on ${when(r.refundedAt)} (${r.refundMode === "paymongo" ? "through PayMongo" : "manually"}${r.refundReference ? `, ref ${escapeHtml(r.refundReference)}` : ""})${r.restocked ? "; items back in stock" : ""}.</p>` : ""}
      <p class="auth-error" id="rdError" style="display:none"></p>
      ${actions}`;

    const run = async (body, button, okMessage) => {
      const err = $("rdError");
      err.style.display = "none";
      document.querySelectorAll("#rdBody button").forEach((b) => (b.disabled = true));
      try {
        await manageReturn({ returnId: r.id, ...body });
        showToast(okMessage);
        modal.hide();
      } catch (e) {
        err.textContent = e.message;
        err.style.display = "block";
        document.querySelectorAll("#rdBody button").forEach((b) => (b.disabled = false));
      }
    };
    $("rdApprove")?.addEventListener("click", () => run({ action: "decide", decision: "approve", staffNote: $("rdNote").value }, null, "Return approved."));
    $("rdReject")?.addEventListener("click", () => run({ action: "decide", decision: "reject", staffNote: $("rdNote").value }, null, "Return declined."));
    $("rdRefund")?.addEventListener("click", () => {
      if (!confirm(`Issue a refund of ${peso(r.refundAmount)}? This can't be undone.`)) return;
      run({ action: "refund", restock: $("rdRestock").checked, reference: $("rdRef")?.value || "" }, null, "Refund issued.");
    });
    $("rdManual")?.addEventListener("click", () => {
      if (!confirm("Mark this refunded without sending money through PayMongo? Only do this if you already refunded the customer another way.")) return;
      run({ action: "refund", manual: true, restock: $("rdRestock").checked }, null, "Marked as refunded.");
    });
  }

  $("returnBody").addEventListener("click", (e) => {
    const btn = e.target.closest(".return-open");
    if (!btn) return;
    openId = btn.dataset.id;
    detail(returns.find((r) => r.id === openId));
    modal.show();
  });
  $("returnTabs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-rt]");
    if (!b) return;
    tab = b.dataset.rt;
    document.querySelectorAll("#returnTabs .filter-tab").forEach((t) => t.classList.toggle("active", t === b));
    render();
  });
  $("returnSearch").addEventListener("input", render);

  onSnapshot(
    query(collection(db, "returns"), orderBy("requestedAt", "desc"), limit(200)),
    (snap) => {
      returns = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
      // Keep an open review in step with changes made by someone else.
      if (openId && $("returnDetailModal").classList.contains("show")) {
        const r = returns.find((x) => x.id === openId);
        if (r && document.activeElement?.id !== "rdNote" && document.activeElement?.id !== "rdRef") detail(r);
      }
    },
    (err) => {
      console.error("Couldn't load returns:", err);
      $("returnBody").innerHTML = `<tr><td colspan="8" class="text-center text-muted py-4">Couldn't load the returns.</td></tr>`;
    },
  );
}

/* =====================================================
   PROMOTIONS — promo codes (Firestore promos, saved by api/manage-content.js)
===================================================== */
async function initPromos(role) {
  if (!["admin", "superadmin"].includes(role)) {
    document.getElementById("promoRestricted").classList.remove("d-none");
    return;
  }
  document.getElementById("promoContent").classList.remove("d-none");

  const $ = (id) => document.getElementById(id);
  const modal = new bootstrap.Modal($("promoModal"));
  let promos = [];

  const money = (n) => "\u20B1" + Number(n).toLocaleString("en-PH");
  const isExpired = (p) => p.expiresAt?.toMillis && p.expiresAt.toMillis() < Date.now();
  const expiryKey = (p) => {
    const d = p.expiresAt?.toDate ? p.expiresAt.toDate() : null;
    if (!d) return "";
    // Shown and edited as a Philippine date.
    return new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  };

  async function load(seedIfEmpty = true) {
    try {
      const snap = await getDocs(collection(db, "promos"));
      promos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (!promos.length && seedIfEmpty) {
        // First visit: the original codes (WELCOME10, CARE50) move into the database.
        await manageContent({ action: "seedPromos" });
        return load(false);
      }
    } catch (err) {
      console.error(err);
      $("promoBody").innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">Couldn't load the promo codes.</td></tr>`;
      return;
    }
    render();
  }

  function render() {
    $("promoCount").textContent = `${promos.length} promo code${promos.length === 1 ? "" : "s"}`;
    if (!promos.length) {
      $("promoBody").innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">No promo codes yet.</td></tr>`;
      return;
    }
    $("promoBody").innerHTML = promos
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((p) => {
        const expired = isExpired(p);
        const status = p.active === false ? `<span class="status-badge status-cancelled">Inactive</span>` : expired ? `<span class="status-badge status-cancelled">Expired</span>` : `<span class="status-badge status-delivered">Active</span>`;
        return `
        <tr>
          <td><strong>${escapeHtml(p.code)}</strong></td>
          <td>${p.type === "percent" ? `${p.value}% off` : `${money(p.value)} off`}<br><span class="text-muted" style="font-size:0.78rem">${escapeHtml(p.label || "")}</span></td>
          <td>${p.firstOrderOnly ? "First order only" : "Any order"}</td>
          <td>${expiryKey(p) || "Never"}</td>
          <td>${status}</td>
          <td class="user-actions">
            <button class="icon-btn promo-edit" data-code="${escapeHtml(p.code)}" title="Edit"><i class="bi bi-pencil"></i></button>
            <button class="icon-btn promo-toggle" data-code="${escapeHtml(p.code)}" title="${p.active === false ? "Turn on" : "Turn off"}"><i class="bi ${p.active === false ? "bi-toggle-off" : "bi-toggle-on"}"></i></button>
            <button class="icon-btn danger promo-delete" data-code="${escapeHtml(p.code)}" title="Delete"><i class="bi bi-trash3"></i></button>
          </td>
        </tr>`;
      })
      .join("");
  }

  function syncTypeLabel() {
    const percent = $("pmType").value === "percent";
    $("pmValueLabel").textContent = percent ? "Percent off (1-100)" : "Pesos off (whole number)";
    $("pmValue").max = percent ? 100 : 100000;
  }
  $("pmType").addEventListener("change", syncTypeLabel);

  function openForm(p) {
    $("pmEditing").value = p?.code || "";
    $("promoModalTitle").textContent = p ? `Edit ${p.code}` : "New Promo Code";
    $("pmCode").value = p?.code || "";
    $("pmCode").readOnly = !!p; // the code is its identity; make a new one to rename
    $("pmType").value = p?.type || "percent";
    $("pmValue").value = p?.value || "";
    $("pmLabel").value = p?.label || "";
    $("pmExpires").value = p ? expiryKey(p) : "";
    $("pmFirst").checked = !!p?.firstOrderOnly;
    $("pmActive").checked = p ? p.active !== false : true;
    $("pmError").style.display = "none";
    syncTypeLabel();
    modal.show();
  }
  $("addPromoBtn").addEventListener("click", () => openForm(null));

  async function save(body, errorEl) {
    try {
      await manageContent({ action: "savePromo", ...body });
      return true;
    } catch (err) {
      if (errorEl) {
        errorEl.textContent = err.message;
        errorEl.style.display = "block";
      } else {
        showToast(err.message);
      }
      return false;
    }
  }

  $("promoForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("pmSave").disabled = true;
    const ok = await save(
      {
        code: $("pmCode").value.trim().toUpperCase(),
        type: $("pmType").value,
        value: Number($("pmValue").value),
        label: $("pmLabel").value.trim(),
        expiresOn: $("pmExpires").value,
        firstOrderOnly: $("pmFirst").checked,
        active: $("pmActive").checked,
      },
      $("pmError"),
    );
    $("pmSave").disabled = false;
    if (ok) {
      modal.hide();
      showToast("Promo code saved.");
      load(false);
    }
  });

  $("promoBody").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-code]");
    if (!btn) return;
    const p = promos.find((x) => x.code === btn.dataset.code);
    if (!p) return;
    if (btn.classList.contains("promo-edit")) {
      openForm(p);
    } else if (btn.classList.contains("promo-toggle")) {
      btn.disabled = true;
      const ok = await save({
        code: p.code,
        type: p.type,
        value: p.value,
        label: p.label,
        expiresOn: expiryKey(p),
        firstOrderOnly: !!p.firstOrderOnly,
        active: p.active === false,
      });
      if (ok) load(false);
      else btn.disabled = false;
    } else if (btn.classList.contains("promo-delete")) {
      if (!confirm(`Delete ${p.code}? Customers won't be able to use it any more.`)) return;
      btn.disabled = true;
      try {
        await manageContent({ action: "deletePromo", code: p.code });
        showToast(`${p.code} deleted.`);
        load(false);
      } catch (err) {
        btn.disabled = false;
        showToast(err.message);
      }
    }
  });

  load();
}

/* =====================================================
   CONTENT — announcement bar, homepage headline, featured products, app
   banners and the editable pages (saved by api/manage-content.js)
===================================================== */
async function initContent(role) {
  if (!["admin", "superadmin"].includes(role)) {
    document.getElementById("contentRestricted").classList.remove("d-none");
    return;
  }
  document.getElementById("contentContent").classList.remove("d-none");

  const $ = (id) => document.getElementById(id);
  const MAX_FEATURED = 6;
  let featured = []; // product ids, in the order they'll show

  /* ---- Homepage, banners, featured ---- */
  let home = {};
  try {
    const snap = await getDoc(doc(db, "content", "home"));
    home = snap.exists() ? snap.data() : {};
  } catch (err) {
    console.error(err);
  }
  const a = home.announcement || {};
  $("anEnabled").checked = a.enabled === true;
  $("anText").value = a.text || "";
  $("anLinkLabel").value = a.linkLabel || "";
  $("anLinkUrl").value = a.linkUrl || "";
  const hero = home.hero || {};
  $("heroTitle").value = hero.title || "";
  $("heroAccent").value = hero.accent || "";
  $("heroText").value = hero.text || "";
  featured = Array.isArray(home.featuredIds) ? [...home.featuredIds] : [];

  const banners = Array.isArray(home.banners) ? home.banners : [];
  $("bannerRows").innerHTML = [0, 1, 2, 3]
    .map((i) => {
      const b = banners[i] || {};
      return `
      <div class="banner-row">
        <input type="text" class="bn-title" maxlength="60" placeholder="Banner ${i + 1} title" value="${escapeHtml(b.title || "")}" />
        <input type="text" class="bn-subtitle" maxlength="140" placeholder="Short text under the title" value="${escapeHtml(b.subtitle || "")}" />
        <input type="text" class="bn-code" maxlength="20" placeholder="Promo code (optional)" value="${escapeHtml(b.code || "")}" style="text-transform: uppercase" />
      </div>`;
    })
    .join("");

  try {
    const snap = await getDocs(query(collection(db, "products"), orderBy("name")));
    const products = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter(isActive);
    // Products that were deleted or made inactive since can't be picked: drop them.
    featured = featured.filter((id) => products.some((p) => p.id === id));
    $("featuredList").innerHTML = products.length
      ? products
          .map(
            (p) => `
        <label class="settings-check">
          <input type="checkbox" value="${escapeHtml(p.id)}" ${featured.includes(p.id) ? "checked" : ""} />
          <span>${escapeHtml(p.name)} <span class="text-muted">&middot; ${peso(p.price)}</span></span>
        </label>`,
          )
          .join("")
      : `<p class="text-muted mb-0">No active products yet.</p>`;
    $("featuredList").addEventListener("change", (e) => {
      const box = e.target.closest("input[type=checkbox]");
      if (!box) return;
      if (box.checked) {
        if (featured.length >= MAX_FEATURED) {
          box.checked = false;
          showToast(`Pick up to ${MAX_FEATURED} featured products.`);
          return;
        }
        featured.push(box.value);
      } else {
        featured = featured.filter((id) => id !== box.value);
      }
    });
  } catch (err) {
    console.error(err);
    $("featuredList").innerHTML = `<p class="text-muted mb-0">Couldn't load the products.</p>`;
  }

  $("saveHomeBtn").addEventListener("click", async () => {
    const btn = $("saveHomeBtn");
    const errorEl = $("homeError");
    errorEl.style.display = "none";
    btn.disabled = true;
    try {
      await manageContent({
        action: "saveHome",
        announcement: {
          enabled: $("anEnabled").checked,
          text: $("anText").value,
          linkLabel: $("anLinkLabel").value,
          linkUrl: $("anLinkUrl").value,
        },
        hero: { title: $("heroTitle").value, accent: $("heroAccent").value, text: $("heroText").value },
        banners: [...document.querySelectorAll(".banner-row")].map((row) => ({
          title: row.querySelector(".bn-title").value,
          subtitle: row.querySelector(".bn-subtitle").value,
          code: row.querySelector(".bn-code").value,
        })),
        featuredIds: featured,
      });
      $("homeSaved").textContent = "Saved just now.";
      showToast("Homepage content saved.");
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = "block";
      errorEl.scrollIntoView({ block: "center" });
    }
    btn.disabled = false;
  });

  /* ---- Pages ---- */
  async function loadPageIntoForm() {
    const slug = $("pgSelect").value;
    $("pgSaved").textContent = "";
    $("pgError").style.display = "none";
    $("pgView").href = `../page.html?p=${slug}`;
    let page = null;
    try {
      const snap = await getDoc(doc(db, "pages", slug));
      if (snap.exists() && snap.data().body) page = snap.data();
    } catch (err) {
      console.error(err);
    }
    const shown = page || DEFAULT_PAGES[slug];
    $("pgTitle").value = shown.title;
    $("pgBody").value = shown.body;
    if (!page) $("pgSaved").textContent = "Showing the starter text (not edited yet).";
  }
  $("pgSelect").addEventListener("change", loadPageIntoForm);
  $("pgReset").addEventListener("click", () => {
    const d = DEFAULT_PAGES[$("pgSelect").value];
    $("pgTitle").value = d.title;
    $("pgBody").value = d.body;
    $("pgSaved").textContent = "Starter text restored. Press Save Page to use it.";
  });
  $("pageForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("pgSave");
    btn.disabled = true;
    $("pgError").style.display = "none";
    try {
      await manageContent({ action: "savePage", slug: $("pgSelect").value, title: $("pgTitle").value, body: $("pgBody").value });
      $("pgSaved").textContent = "Saved just now.";
      showToast("Page saved.");
    } catch (err) {
      $("pgError").textContent = err.message;
      $("pgError").style.display = "block";
    }
    btn.disabled = false;
  });
  loadPageIntoForm();
}

/* =====================================================
   AUDIT TRAIL — who did what, and when (Admin and Super Admin).
   Entries are written by the server (and, for products, by the admin
   page); nothing here can edit or delete them.
===================================================== */
const AUDIT_ACTIONS = {
  "order.place": "Order placed",
  "order.status": "Order status",
  "order.cancel": "Order cancelled",
  "payment.paid": "Payment received",
  "product.create": "Product added",
  "product.update": "Product edited",
  "product.stock": "Stock adjusted",
  "product.delete": "Product deleted",
  "user.create": "Account added",
  "user.update": "Account edited",
  "user.role": "Role changed",
  "user.suspend": "Account suspended",
  "user.reactivate": "Account reactivated",
  "user.delete": "Account deleted",
  "settings.update": "Settings changed",
  "message.reply": "Message reply",
  "return.request": "Return requested",
  "return.cancel": "Return withdrawn",
  "return.approve": "Return approved",
  "return.reject": "Return declined",
  "return.refund": "Refund issued",
  "content.page": "Page edited",
  "content.home": "Homepage edited",
  "promo.save": "Promo code saved",
  "promo.delete": "Promo code deleted",
};

function initAudit(role) {
  const restricted = document.getElementById("auditRestrictedNotice");
  const content = document.getElementById("auditContent");
  if (!["admin", "superadmin"].includes(role)) {
    restricted.classList.remove("d-none");
    return;
  }
  content.classList.remove("d-none");

  const PAGE = 100;
  const $ = (id) => document.getElementById(id);
  const byId = new Map(); // id -> entry
  let lastOlderDoc = null;
  let hasMore = false;
  let olderLoaded = false;

  const dayKey = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const millis = (e) => e.at?.toMillis?.() || 0;

  function filtered() {
    const term = $("auditSearch").value.trim().toLowerCase();
    const area = $("auditArea").value;
    const actor = $("auditActor").value;
    const from = $("auditFrom").value;
    const to = $("auditTo").value;
    return [...byId.values()]
      .sort((a, b) => millis(b) - millis(a))
      .filter((e) => {
        if (area !== "all" && !String(e.action).startsWith(area + ".")) return false;
        if (actor !== "all" && e.actorId !== actor) return false;
        if (from || to) {
          const d = e.at?.toDate ? e.at.toDate() : null;
          if (!d) return false;
          if (from && dayKey(d) < from) return false;
          if (to && dayKey(d) > to) return false;
        }
        if (!term) return true;
        return [e.summary, e.actorName, e.actorEmail, e.targetLabel, e.action].join(" ").toLowerCase().includes(term);
      });
  }

  function refreshActorOptions() {
    const select = $("auditActor");
    const current = select.value;
    const people = new Map();
    byId.forEach((e) => people.set(e.actorId, e.actorName || e.actorEmail || e.actorId));
    select.innerHTML =
      `<option value="all">Everyone</option>` +
      [...people]
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([id, name]) => `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`)
        .join("");
    select.value = people.has(current) ? current : "all";
  }

  function render() {
    const rows = filtered();
    const active =
      $("auditSearch").value || $("auditArea").value !== "all" || $("auditActor").value !== "all" || $("auditFrom").value || $("auditTo").value;
    $("auditClear").classList.toggle("d-none", !active);
    $("auditCount").textContent = `Showing ${rows.length} of ${byId.size} loaded entr${byId.size === 1 ? "y" : "ies"}`;
    $("auditMore").classList.toggle("d-none", !hasMore);
    if (!rows.length) {
      $("auditBody").innerHTML = `<tr><td colspan="4" class="text-center text-muted py-4">${byId.size ? "No entries match these filters." : "Nothing has been recorded yet."}</td></tr>`;
      return;
    }
    $("auditBody").innerHTML = rows
      .map((e) => {
        const d = e.at?.toDate ? e.at.toDate() : null;
        return `
        <tr>
          <td class="audit-when">${d ? `${d.toLocaleDateString("en-PH")}<br><span class="text-muted">${d.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}</span>` : "—"}</td>
          <td>${escapeHtml(e.actorName || "—")}<br><span class="audit-role">${escapeHtml(e.actorRole || "")}</span></td>
          <td><span class="audit-action audit-${escapeHtml(String(e.action).split(".")[0])}">${escapeHtml(AUDIT_ACTIONS[e.action] || e.action)}</span></td>
          <td>${escapeHtml(e.summary || "")}${e.targetLabel ? `<br><span class="text-muted audit-target">${escapeHtml(e.targetLabel)}</span>` : ""}</td>
        </tr>`;
      })
      .join("");
  }

  function addDocs(docs) {
    docs.forEach((d) => byId.set(d.id, { id: d.id, ...d.data() }));
    refreshActorOptions();
    render();
  }

  // Newest entries stream in live; older ones load on request.
  onSnapshot(
    query(collection(db, "auditLogs"), orderBy("at", "desc"), limit(PAGE)),
    (snap) => {
      if (!olderLoaded) {
        lastOlderDoc = snap.docs[snap.docs.length - 1] || null;
        hasMore = snap.size === PAGE;
      }
      addDocs(snap.docs);
    },
    (err) => {
      console.error("Couldn't load the audit trail:", err);
      $("auditBody").innerHTML = `<tr><td colspan="4" class="text-center text-muted py-4">Couldn't load the audit trail.</td></tr>`;
    },
  );

  $("auditMore").addEventListener("click", async () => {
    if (!lastOlderDoc) return;
    const btn = $("auditMore");
    btn.disabled = true;
    try {
      const snap = await getDocs(
        query(collection(db, "auditLogs"), orderBy("at", "desc"), startAfter(lastOlderDoc), limit(PAGE)),
      );
      olderLoaded = true;
      lastOlderDoc = snap.docs[snap.docs.length - 1] || lastOlderDoc;
      hasMore = snap.size === PAGE;
      addDocs(snap.docs);
    } catch (err) {
      console.error(err);
      showToast("Couldn't load older entries.");
    }
    btn.disabled = false;
  });

  ["auditSearch", "auditFrom", "auditTo"].forEach((id) => $(id).addEventListener("input", render));
  ["auditArea", "auditActor"].forEach((id) => $(id).addEventListener("change", render));
  $("auditClear").addEventListener("click", () => {
    $("auditSearch").value = "";
    $("auditArea").value = "all";
    $("auditActor").value = "all";
    $("auditFrom").value = $("auditTo").value = "";
    render();
  });

  // Spreadsheet formulas in typed text (=, @) are defused, as in the orders export.
  const csvCell = (v) => {
    let s = String(v ?? "");
    if (/^[=@\t\r]/.test(s) || /^[+-][^\d\s().-]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  $("auditExport").addEventListener("click", () => {
    const rows = filtered();
    if (!rows.length) {
      showToast("Nothing to export.");
      return;
    }
    const header = ["Date and time", "Who", "Email", "Role", "Action", "Target", "What happened"];
    const lines = rows.map((e) =>
      [
        e.at?.toDate ? e.at.toDate().toLocaleString("en-PH") : "",
        e.actorName,
        e.actorEmail,
        e.actorRole,
        AUDIT_ACTIONS[e.action] || e.action,
        e.targetLabel,
        e.summary,
      ]
        .map(csvCell)
        .join(","),
    );
    const blob = new Blob(["\uFEFF" + [header.map(csvCell).join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `kalingacare-audit-trail-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  });
}

/* Platform settings (shipping, payment options, emails): Admin and Super Admin. */
async function initStoreSettings(role) {
  if (!["admin", "superadmin"].includes(role)) return;
  const panel = document.getElementById("storeSettingsPanel");
  panel.classList.remove("d-none");

  const $ = (id) => document.getElementById(id);
  const errorEl = $("ssError");

  function fill(s) {
    $("ssShippingFee").value = s.shippingFee ?? 150;
    $("ssFreeShipping").value = s.freeShippingOver ?? 0;
    $("ssCod").checked = s.codEnabled !== false;
    $("ssOnline").checked = s.onlineEnabled !== false;
    $("ssEmailConfirm").checked = s.emailOrderConfirmation !== false;
    $("ssEmailShipped").checked = s.emailShipped !== false;
    $("ssEmailDelivered").checked = s.emailDelivered !== false;
    $("ssEmailCancelled").checked = s.emailCancelled !== false;
    $("ssEmailReturns").checked = s.emailReturns !== false;
    $("ssReturnDays").value = s.returnWindowDays ?? 7;
    $("ssUpdated").textContent = s.updatedAt?.toDate
      ? `Last saved ${s.updatedAt.toDate().toLocaleString("en-PH")}.`
      : "";
  }

  try {
    const snap = await getDoc(doc(db, "settings", "store"));
    fill(snap.exists() ? snap.data() : {});
  } catch (err) {
    console.error("Couldn't load store settings:", err);
    fill({});
  }

  async function call(body) {
    const res = await fetch("/api/save-settings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${await auth.currentUser.getIdToken()}`,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Couldn't complete that. Please try again.");
    return data;
  }

  $("storeSettingsForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.style.display = "none";
    if (!$("ssCod").checked && !$("ssOnline").checked) {
      errorEl.textContent = "Keep at least one payment option turned on.";
      errorEl.style.display = "block";
      return;
    }
    const btn = $("ssSave");
    btn.disabled = true;
    try {
      const { settings } = await call({
        action: "save",
        settings: {
          shippingFee: Number($("ssShippingFee").value),
          freeShippingOver: Number($("ssFreeShipping").value || 0),
          codEnabled: $("ssCod").checked,
          onlineEnabled: $("ssOnline").checked,
          emailOrderConfirmation: $("ssEmailConfirm").checked,
          emailShipped: $("ssEmailShipped").checked,
          emailDelivered: $("ssEmailDelivered").checked,
          emailCancelled: $("ssEmailCancelled").checked,
          emailReturns: $("ssEmailReturns").checked,
          returnWindowDays: Number($("ssReturnDays").value === "" ? 7 : $("ssReturnDays").value),
        },
      });
      fill(settings);
      $("ssUpdated").textContent = "Saved just now.";
      showToast("Store settings saved.");
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = "block";
    }
    btn.disabled = false;
  });

  $("ssTestEmail").addEventListener("click", async () => {
    const btn = $("ssTestEmail");
    btn.disabled = true;
    errorEl.style.display = "none";
    try {
      await call({ action: "testEmail" });
      showToast(`Test email sent to ${auth.currentUser.email}.`);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = "block";
    }
    btn.disabled = false;
  });
}

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
          backgroundColor: "#1778ad",
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

/* Audit trail for product changes. Orders, users and settings are logged by
   the server; products are edited straight from this page, so the entry is
   written here (the Firestore rules only let an admin write entries under their
   own name, and nobody can edit or delete one afterwards). */
async function logProductAudit(action, productId, label, summary, details) {
  try {
    const user = auth.currentUser;
    const profile = await getDoc(doc(db, "users", user.uid));
    await addDoc(collection(db, "auditLogs"), {
      at: serverTimestamp(),
      actorId: user.uid,
      actorName: profile.get("fullName") || user.displayName || user.email || "",
      actorEmail: user.email || "",
      actorRole: profile.get("role") || "admin",
      action,
      targetType: "product",
      targetId: productId,
      targetLabel: String(label || "").slice(0, 160),
      summary: String(summary || "").slice(0, 400),
      ...(details ? { details } : {}),
    });
  } catch (err) {
    console.warn("Couldn't write the audit log:", err);
  }
}

// "price 2950 → 3100, status active → inactive" for the audit trail.
function describeProductChanges(before, after) {
  const plain = (v) => (Array.isArray(v) ? v.join(", ") : v && typeof v === "object" ? JSON.stringify(v) : String(v ?? ""));
  const changes = [];
  [
    ["name", "name"],
    ["category", "category"],
    ["subcategory", "subcategory"],
    ["price", "price"],
    ["status", "status"],
    ["sizes", "sizes"],
    ["colors", "colors"],
    ["videoUrl", "video"],
  ].forEach(([key, label]) => {
    const a = key === "status" ? before.status || "active" : before[key];
    const b = after[key];
    if (plain(a) !== plain(b)) changes.push(`${label} ${plain(a) || "(none)"} \u2192 ${plain(b) || "(none)"}`);
  });
  if ((before.description || "") !== (after.description || "")) changes.push("description edited");
  if (plain(before.specs) !== plain(after.specs)) changes.push("specifications edited");
  const photosBefore = (before.images || []).length || (before.imgBase64 || before.img ? 1 : 0);
  if (photosBefore !== (after.images || []).length) changes.push(`photos ${photosBefore} \u2192 ${(after.images || []).length}`);
  return changes;
}

function initProducts(role) {
  const tbody = document.querySelector("#adminProductsTable tbody");
  const form = document.getElementById("productForm");
  const editingIdField = document.getElementById("productEditingId");
  let editingOriginal = null; // the product as it was when the edit form opened
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
            <td>${p.name}${isActive(p) ? "" : ` <span class="status-badge status-cancelled" title="Hidden from the store">Inactive</span>`}</td>
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
        editingOriginal = p;
        editingIdField.value = btn.dataset.id;
        document.getElementById("pName").value = p.name;
        document.getElementById("pCategory").value = p.category;
        document.getElementById("pSubcategory").value = p.subcategory || "";
        document.getElementById("pDescription").value = p.description || "";
        document.getElementById("pPrice").value = p.price;
        document.getElementById("pStock").value = p.stock ?? "";
        document.getElementById("pStatus").value = isActive(p) ? "active" : "inactive";
        document.getElementById("pSizes").value = (p.sizes || []).join(", ");
        document.getElementById("pColors").value = (p.colors || []).join(", ");
        document.getElementById("pSpecs").value = specsToText(p.specs);
        document.getElementById("pVideo").value = p.videoUrl || "";
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
          const gone = allProducts.find((p) => p.id === btn.dataset.id);
          await deleteDoc(doc(db, "products", btn.dataset.id));
          logProductAudit("product.delete", btn.dataset.id, gone?.name || btn.dataset.id, `Deleted product ${gone?.name || btn.dataset.id}.`);
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
      const videoUrl = document.getElementById("pVideo").value.trim();
      if (videoUrl && !youtubeId(videoUrl)) {
        showToast("The video link must be a YouTube link.");
        return;
      }
      const data = {
        name: document.getElementById("pName").value.trim(),
        category: document.getElementById("pCategory").value,
        subcategory: document.getElementById("pSubcategory").value.trim(),
        description: document.getElementById("pDescription").value.trim(),
        price: Number(document.getElementById("pPrice").value),
        stock: Number(document.getElementById("pStock").value) || 0,
        status: document.getElementById("pStatus").value === "inactive" ? "inactive" : "active",
        sizes: splitList(document.getElementById("pSizes").value),
        colors: splitList(document.getElementById("pColors").value),
        specs: parseSpecs(document.getElementById("pSpecs").value),
        videoUrl: videoUrl,
        images: canonicalImages,
        img: cover.startsWith("data:") ? "" : cover,
        imgBase64: cover.startsWith("data:") ? cover : null,
        updatedAt: serverTimestamp(),
      };

      try {
        if (editingIdField.value) {
          await updateDoc(doc(db, "products", editingIdField.value), data);
          showToast(`${data.name} updated.`);
          const changes = editingOriginal ? describeProductChanges(editingOriginal, data) : [];
          logProductAudit("product.update", editingIdField.value, data.name, `Edited ${data.name}: ${changes.join(", ") || "saved with no visible change"}.`, { changes });
        } else {
          const created = await addDoc(productsRef, { ...data, soldCount: 0, createdAt: serverTimestamp() });
          showToast(`${data.name} added.`);
          logProductAudit("product.create", created.id, data.name, `Added product ${data.name} (\u20B1${data.price}, ${data.stock} in stock, ${data.status}).`);
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
      logProductAudit(
        "product.stock",
        currentStockProductId,
        currentStockName,
        `Stock of ${currentStockName}: ${currentStockOldQty} \u2192 ${newQty}.`,
        { from: currentStockOldQty, to: newQty },
      );
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
  online: "Online (PayMongo)",
  // Older web orders, from before online payments were real
  card: "Card (not processed)",
  paypal: "PayPal (not processed)",
};
// Orders store a short code ("cod", "card", ...). Mobile orders placed
// before Oct 14, 2026 stored the label "Cash on Delivery" instead, so map
// that back to its code for both the Payment column and the filter.
function paymentCode(order) {
  const method = order.shippingInfo?.paymentMethod;
  return method === "Cash on Delivery" ? "cod" : method;
}
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
  // The order process is enforced by the server (api/update-order.js):
  // statuses move one step at a time and Cancelled is a separate action.
  const NEXT_STATUS = {
    New: "Pending",
    Pending: "Processing",
    Processing: "Shipped",
    Shipped: "Delivered",
  };

  function statusOptionsHtml(status) {
    const choices = [status];
    if (NEXT_STATUS[status]) choices.push(NEXT_STATUS[status]);
    if (CANCELLABLE_STATUSES.includes(status)) choices.push("Cancelled");
    return choices
      .map((s) => `<option value="${s}" ${status === s ? "selected" : ""}>${s}</option>`)
      .join("");
  }

  function changeOrderStatus(orderId, newStatus) {
    return newStatus === "Cancelled"
      ? updateOrder(orderId, "cancel")
      : updateOrder(orderId, "status", newStatus);
  }

  let allOrders = [];
  let searchTerm = "";
  let statusFilterValue = "all";
  let paymentFilterValue = "all";
  let paidFilterValue = "all";
  let dateFrom = ""; // "YYYY-MM-DD" or ""
  let dateTo = "";
  let sortValue = "date-desc";
  const selectedIds = new Set();

  function matchesFilters(o) {
    const status = o.status || "Pending";
    if (statusFilterValue !== "all" && status !== statusFilterValue)
      return false;
    if (
      paymentFilterValue !== "all" &&
      paymentCode(o) !== paymentFilterValue
    )
      return false;
    if (paidFilterValue === "paid" && o.paymentStatus !== "paid") return false;
    if (paidFilterValue === "unpaid" && (o.paymentStatus === "paid" || status === "Cancelled"))
      return false;
    if (dateFrom || dateTo) {
      const d = o.createdAt?.toDate ? o.createdAt.toDate() : null;
      if (!d) return false;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (dateFrom && key < dateFrom) return false;
      if (dateTo && key > dateTo) return false;
    }
    if (searchTerm) {
      const ship = o.shippingInfo || {};
      const haystack = [
        o.id,
        o.invoiceNo,
        ship.fullName,
        ship.email,
        ship.recipient,
        ship.phone,
        ...(o.items || []).map((i) => i.name),
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(searchTerm)) return false;
    }
    return true;
  }

  function filtersActive() {
    return (
      searchTerm ||
      statusFilterValue !== "all" ||
      paymentFilterValue !== "all" ||
      paidFilterValue !== "all" ||
      dateFrom ||
      dateTo
    );
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
    document.getElementById("ordersResultCount").textContent =
      `Showing ${filtered.length} of ${allOrders.length} order${allOrders.length === 1 ? "" : "s"}`;
    document.getElementById("orderFiltersClear").classList.toggle("d-none", !filtersActive());

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
        const code = paymentCode(o);
        // Online orders show whether PayMongo confirmed the payment, so
        // staff don't ship an unpaid order.
        const payment =
          code === "online"
            ? `${PAYMENT_LABELS.online}<br><span class="payment-state ${o.paymentStatus === "paid" ? "paid" : "pending"}">${o.paymentStatus === "paid" ? "Paid" : "Awaiting payment"}</span>`
            : code === "cod"
              ? `${PAYMENT_LABELS.cod}<br><span class="payment-state ${o.paymentStatus === "paid" ? "paid" : "pending"}">${o.paymentStatus === "paid" ? "Cash collected" : "To collect"}</span>`
              : PAYMENT_LABELS[code] || "—";
        const options = statusOptionsHtml(status);
        return `
          <tr data-order-row="${o.id}">
            <td><input type="checkbox" class="order-row-check" data-id="${o.id}" ${selectedIds.has(o.id) ? "checked" : ""} /></td>
            <td>#${o.id.slice(0, 8).toUpperCase()}</td>
            <td>
              <div class="order-customer-cell">
                <div class="avatar avatar-sm">${escapeHtml(initials(o.shippingInfo?.fullName))}</div>
                <div>
                  <div class="order-customer-name">${escapeHtml(o.shippingInfo?.fullName || "—")}</div>
                  <span class="text-muted" style="font-size:0.78rem;">${escapeHtml(o.shippingInfo?.email || "")}</span>
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
                  <button type="button" class="row-print-invoice" data-id="${o.id}"><i class="bi bi-printer"></i> Print Invoice</button>
                  <button type="button" class="row-print-packing" data-id="${o.id}"><i class="bi bi-box-seam"></i> Print Packing Slip</button>
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
          await changeOrderStatus(select.dataset.id, newStatus);
        } catch (err) {
          console.error(err);
          select.className = previousClass;
          showToast(err.message || "Couldn't update status.");
          renderRows(); // put the dropdown back to the real status
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
        // Fixed to the window, under the button, so the table panel's
        // sideways scrolling can't cut the menu off.
        if (!menu.classList.contains("d-none")) {
          const r = btn.getBoundingClientRect();
          menu.style.position = "fixed";
          menu.style.top = `${r.bottom + 4}px`;
          menu.style.right = `${window.innerWidth - r.right}px`;
          menu.style.left = "auto";
          // Open upward if it would run past the bottom of the window.
          const h = menu.offsetHeight;
          if (r.bottom + 4 + h > window.innerHeight) {
            menu.style.top = `${Math.max(8, r.top - 4 - h)}px`;
          }
        }
      });
    });

    tbody.querySelectorAll(".row-view-details").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        btn.closest(".row-action-menu").classList.add("d-none");
        openOrderDetail(btn.dataset.id);
      });
    });

    tbody.querySelectorAll(".row-print-invoice").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        btn.closest(".row-action-menu").classList.add("d-none");
        openInvoices([btn.dataset.id]);
      });
    });

    tbody.querySelectorAll(".row-print-packing").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        btn.closest(".row-action-menu").classList.add("d-none");
        openInvoices([btn.dataset.id], "packing");
      });
    });

    tbody.querySelectorAll(".row-cancel-order").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        btn.closest(".row-action-menu").classList.add("d-none");
        if (!confirm("Cancel this order?")) return;
        try {
          await updateOrder(btn.dataset.id, "cancel");
          showToast("Order cancelled.");
        } catch (err) {
          console.error(err);
          showToast(err.message || "Couldn't cancel this order.");
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
  const closeRowMenus = () =>
    document
      .querySelectorAll(".row-action-menu")
      .forEach((m) => m.classList.add("d-none"));
  document.addEventListener("click", closeRowMenus);
  // A fixed-position menu would drift away from its row on scroll/resize.
  document.querySelector(".admin-main")?.addEventListener("scroll", closeRowMenus, { passive: true });
  document.querySelector("#adminOrdersTable")?.closest(".admin-panel")?.addEventListener("scroll", closeRowMenus, { passive: true });
  window.addEventListener("resize", closeRowMenus);

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
  wireToolbarDropdown("paidFilterBtn", "paidFilterMenu", "paidFilterLabel", (val) => {
    paidFilterValue = val;
    renderRows();
  });

  /* ---- Date range, clear filters, CSV export ---- */
  const fromInput = document.getElementById("orderDateFrom");
  const toInput = document.getElementById("orderDateTo");
  fromInput.addEventListener("change", () => {
    dateFrom = fromInput.value;
    renderRows();
  });
  toInput.addEventListener("change", () => {
    dateTo = toInput.value;
    renderRows();
  });

  document.getElementById("orderFiltersClear").addEventListener("click", () => {
    searchTerm = "";
    statusFilterValue = paymentFilterValue = paidFilterValue = "all";
    dateFrom = dateTo = "";
    if (searchInput) searchInput.value = "";
    fromInput.value = toInput.value = "";
    [
      ["statusFilterMenu", "statusFilterLabel"],
      ["paymentFilterMenu", "paymentFilterLabel"],
      ["paidFilterMenu", "paidFilterLabel"],
    ].forEach(([menuId, labelId]) => {
      document.querySelectorAll(`#${menuId} .tdm-item`).forEach((i, n) => i.classList.toggle("active", n === 0));
      document.getElementById(labelId).textContent = "All";
    });
    renderRows();
  });

  // Spreadsheet formulas in customer-typed text (=, +, -, @) are defused.
  const csvCell = (v) => {
    let s = String(v ?? "");
    if (/^[=@\t\r]/.test(s) || /^[+-][^\d\s().-]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };

  document.getElementById("exportOrdersCsv").addEventListener("click", () => {
    const rows = sortOrders(allOrders.filter(matchesFilters));
    if (!rows.length) {
      showToast("No orders to export.");
      return;
    }
    const header = [
      "Invoice no.", "Order ID", "Date placed", "Customer", "Email", "Recipient", "Address", "Phone",
      "Items", "Subtotal", "Shipping", "Discount", "Total", "Payment method", "Payment status", "Order status",
    ];
    const lines = rows.map((o) => {
      const ship = o.shippingInfo || {};
      const code = paymentCode(o);
      const d = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString("en-PH") : "";
      const payState =
        o.paymentStatus === "paid"
          ? code === "cod" ? "Cash collected" : "Paid"
          : o.status === "Cancelled" ? "Not paid" : code === "cod" ? "To collect" : "Awaiting payment";
      return [
        o.invoiceNo || "",
        o.id,
        d,
        ship.fullName,
        ship.email,
        ship.recipient,
        ship.address,
        ship.phone,
        (o.items || []).map((i) => `${i.name} x${i.qty}`).join("; "),
        o.subtotal ?? "",
        o.shippingFee ?? "",
        o.discount ?? 0,
        o.total,
        PAYMENT_LABELS[code] || code || "",
        payState,
        o.status === "New" ? "Pending" : o.status || "Pending",
      ]
        .map(csvCell)
        .join(",");
    });
    // BOM so Excel reads the peso text and names as UTF-8.
    const blob = new Blob(["\uFEFF" + [header.map(csvCell).join(","), ...lines].join("\r\n")], {
      type: "text/csv;charset=utf-8",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `kalingacare-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
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

  // Opens the printable invoice page (one tab, one invoice per page).
  function openInvoices(orderIds, type = "invoice") {
    const q = orderIds.length === 1 ? `id=${orderIds[0]}` : `ids=${orderIds.join(",")}`;
    window.open(`../invoice.html?${q}&print=1${type === "packing" ? "&type=packing" : ""}`, "_blank");
  }

  document.getElementById("bulkPackingBtn")?.addEventListener("click", () => {
    const chosen = allOrders.filter((o) => selectedIds.has(o.id)).map((o) => o.id);
    if (!chosen.length) return;
    if (chosen.length > 30) {
      showToast("Select up to 30 orders to print at once.");
      return;
    }
    openInvoices(chosen, "packing");
  });

  document.getElementById("odPackingBtn")?.addEventListener("click", () => {
    const id = document.getElementById("odCancelOrderBtn").dataset.id;
    if (id) openInvoices([id], "packing");
  });

  document.getElementById("bulkPrintBtn")?.addEventListener("click", () => {
    const chosen = allOrders.filter((o) => selectedIds.has(o.id)).map((o) => o.id);
    if (!chosen.length) return;
    if (chosen.length > 30) {
      showToast("Select up to 30 orders to print at once.");
      return;
    }
    openInvoices(chosen);
  });

  document.getElementById("odPrintBtn")?.addEventListener("click", () => {
    const id = document.getElementById("odCancelOrderBtn").dataset.id;
    if (id) openInvoices([id]);
  });

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
        await Promise.all(cancellable.map((o) => updateOrder(o.id, "cancel")));
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
        await updateOrder(orderId, "status", "Pending");
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

    const returnLine = document.getElementById("odReturn");
    returnLine.classList.toggle("d-none", !o.returnStatus);
    if (o.returnStatus) {
      returnLine.innerHTML = `Return: <strong>${escapeHtml(o.returnStatus)}</strong>${o.refundedAmount ? ` (${peso(o.refundedAmount)} refunded)` : ""} &middot; <a href="admin-returns.html">Open Returns</a>`;
    }

    document.getElementById("odCustomerAvatar").textContent = initials(
      o.shippingInfo?.fullName,
    );
    document.getElementById("odCustomerName").textContent =
      o.shippingInfo?.fullName || "—";
    document.getElementById("odCustomerEmail").textContent =
      o.shippingInfo?.email || "—";

    const ship = o.shippingInfo || {};
    const deliveryRows = [
      ["Recipient", ship.recipient],
      ["Phone", ship.phone],
      ["Address", ship.address],
      ["Driver note", ship.note],
    ].filter(([, v]) => v);
    document.getElementById("odDelivery").innerHTML = deliveryRows.length
      ? deliveryRows
          .map(([k, v]) => `<div><strong>${k}:</strong> ${escapeHtml(v)}</div>`)
          .join("")
      : "—";

    const itemsList = document.getElementById("odItemsList");
    itemsList.innerHTML = (o.items || [])
      .map(
        (item) => `
        <div class="od-item-row">
          <img src="${item.imgBase64 || `../${item.img || "assets/images/products/placeholder.jpg"}`}" alt="${escapeHtml(item.name)}" ${item.imgBase64 || item.img ? "" : `data-product-photo="${escapeHtml(item.id)}"`} />
          <div>
            <div class="od-item-name">${escapeHtml(item.name)}</div>
            <div class="od-item-qty">Qty: ${item.qty}</div>
          </div>
          <div class="od-item-price">${peso(item.price * item.qty)}</div>
        </div>`,
      )
      .join("");

    // Orders placed by the server (and by the app) don't copy product
    // photos; show the product's own photo instead.
    itemsList.querySelectorAll("[data-product-photo]").forEach(async (img) => {
      try {
        const snap = await getDoc(doc(db, "products", img.dataset.productPhoto));
        const photo = snap.exists() ? snap.data().imgBase64 || (snap.data().img ? `../${snap.data().img}` : "") : "";
        if (photo) img.src = photo;
      } catch {
        // Keep the placeholder.
      }
    });

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
      statusSelect.innerHTML = statusOptionsHtml(status);
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
        await changeOrderStatus(e.target.dataset.id, newStatus);
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
        e.target.value = (allOrders.find((x) => x.id === e.target.dataset.id)?.status) || "Pending";
        showToast(err.message || "Couldn't update status.");
      }
    });

  document
    .getElementById("odCancelOrderBtn")
    .addEventListener("click", async (e) => {
      if (!confirm("Cancel this order?")) return;
      try {
        await updateOrder(e.target.dataset.id, "cancel");
        showToast("Order cancelled.");
        closeOrderDetail();
      } catch (err) {
        console.error(err);
        showToast(err.message || "Couldn't cancel this order.");
      }
    });
}

/* =====================================================
   MESSAGES (Contact Us form, saved by api/contact.js)
===================================================== */

// Unread count next to "Messages" in the sidebar, live on every admin page.
// Return requests waiting for review, next to "Returns" in the sidebar.
function initOpenReturnsCount() {
  const badges = document.querySelectorAll("[data-open-returns]");
  if (!badges.length) return;
  onSnapshot(
    query(collection(db, "returns"), where("status", "==", "Requested")),
    (snap) => {
      badges.forEach((b) => {
        b.textContent = snap.size > 99 ? "99+" : String(snap.size);
        b.classList.toggle("d-none", snap.size === 0);
      });
    },
    (err) => console.error("Couldn't load the open returns count:", err),
  );
}

// Number of products at or below the low-stock level, next to "Products"
// in the sidebar on every admin page.
function initLowStockCount() {
  const badges = document.querySelectorAll("[data-low-stock]");
  if (!badges.length) return;
  onSnapshot(
    collection(db, "products"),
    (snap) => {
      const n = snap.docs.filter((d) => isActive(d.data()) && stockStatusOf(d.data().stock) !== "instock").length;
      badges.forEach((b) => {
        b.textContent = n > 99 ? "99+" : String(n);
        b.classList.toggle("d-none", n === 0);
      });
    },
    (err) => console.error("Couldn't load low stock count:", err),
  );
}

function initUnreadMessagesCount() {
  const badges = document.querySelectorAll("[data-unread-messages]");
  if (!badges.length) return;
  onSnapshot(
    query(collection(db, "contactMessages"), where("read", "==", false)),
    (snap) => {
      badges.forEach((b) => {
        b.textContent = snap.size > 99 ? "99+" : String(snap.size);
        b.classList.toggle("d-none", snap.size === 0);
      });
    },
    (err) => console.error("Couldn't load unread messages count:", err),
  );
}

function initMessages() {
  const listEl = document.getElementById("messagesList");
  const unreadCountEl = document.getElementById("msgUnreadCount");
  let messages = [];
  let filter = "all";

  const when = (m) => {
    const d = m.createdAt?.toDate?.();
    return d
      ? d.toLocaleString("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
      : "Just now";
  };

  function render() {
    const unread = messages.filter((m) => !m.read).length;
    unreadCountEl.textContent = unread ? `(${unread})` : "";
    const shown = messages.filter((m) =>
      filter === "unread" ? !m.read : filter === "read" ? m.read : true,
    );
    if (!shown.length) {
      listEl.innerHTML = `<div class="admin-panel messages-empty">
        <i class="bi bi-envelope-open"></i>
        <p>${filter === "unread" ? "No unread messages." : filter === "read" ? "No read messages yet." : "No messages yet. Messages from the Contact Us form will appear here."}</p>
      </div>`;
      return;
    }
    listEl.innerHTML = shown
      .map((m) => {
        const replySubject = encodeURIComponent(`Re: ${m.subject || "Your message to KalingaCare"}`);
        const mailto = `mailto:${encodeURIComponent(m.email)}?subject=${replySubject}`;
        return `
        <article class="message-card ${m.read ? "" : "unread"}" data-id="${m.id}">
          <div class="message-head">
            <div class="avatar avatar-sm">${escapeHtml(initials(m.name))}</div>
            <div class="message-from">
              <div class="message-name">${escapeHtml(m.name)} ${m.read ? "" : '<span class="message-new">New</span>'}</div>
              <div class="message-meta">
                ${escapeHtml(m.email)} · ${m.source === "mobile app" ? "Mobile app" : "Website"}
                ${m.userId ? " · has an account" : " · guest"}
              </div>
            </div>
            <time class="message-time">${when(m)}</time>
          </div>
          <h2 class="message-subject">${escapeHtml(m.subject)}</h2>
          <p class="message-body">${escapeHtml(m.message)}</p>
          ${m.emailSent === false ? '<p class="message-warning"><i class="bi bi-exclamation-triangle"></i> This one could not be emailed to the support inbox; it is only here.</p>' : ""}
          ${(m.replies || [])
            .map(
              (r) => `
          <div class="message-reply">
            <div class="message-reply-head">
              <i class="bi bi-reply-fill"></i> ${escapeHtml(r.byName || "Staff")} replied
              <span>${r.at?.toDate ? r.at.toDate().toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""}</span>
            </div>
            <p>${escapeHtml(r.text)}</p>
          </div>`,
            )
            .join("")}
          <form class="message-reply-form d-none" data-reply-form="${m.id}">
            <label class="visually-hidden" for="reply-${m.id}">Reply to ${escapeHtml(m.name)}</label>
            <textarea id="reply-${m.id}" rows="4" maxlength="4000" placeholder="Write your reply to ${escapeHtml(m.name)}…" required></textarea>
            <p class="message-reply-note">Sent by email to ${escapeHtml(m.email)} from the KalingaCare account. Their answer comes back to kalingacaresupport@gmail.com.</p>
            <p class="message-reply-error d-none" role="alert"></p>
            <div class="message-actions">
              <button type="submit" class="msg-btn msg-btn-primary"><i class="bi bi-send"></i> Send reply</button>
              <button type="button" class="msg-btn" data-reply-cancel="${m.id}">Cancel</button>
            </div>
          </form>
          <div class="message-actions" data-actions="${m.id}">
            <button type="button" class="msg-btn msg-btn-primary" data-reply-open="${m.id}">
              <i class="bi bi-reply"></i> ${(m.replies || []).length ? "Reply again" : "Reply"}
            </button>
            <a class="msg-btn" href="${mailto}" data-reply="${m.id}" title="Open in your email app instead">
              <i class="bi bi-envelope"></i> Email app
            </a>
            <button type="button" class="msg-btn" data-toggle-read="${m.id}">
              <i class="bi ${m.read ? "bi-envelope" : "bi-envelope-open"}"></i>
              ${m.read ? "Mark as unread" : "Mark as read"}
            </button>
          </div>
        </article>`;
      })
      .join("");
  }

  // Live updates re-render the list; keep any reply being typed.
  function renderKeepingDrafts() {
    const drafts = {};
    openReplies.forEach((id) => {
      const t = listEl.querySelector(`[data-reply-form="${id}"] textarea`);
      if (t) drafts[id] = t.value;
    });
    render();
    openReplies.forEach((id) => {
      const form = listEl.querySelector(`[data-reply-form="${id}"]`);
      const actions = listEl.querySelector(`[data-actions="${id}"]`);
      if (!form || !actions) return;
      form.classList.remove("d-none");
      actions.classList.add("d-none");
      form.querySelector("textarea").value = drafts[id] || "";
    });
  }

  async function setRead(id, read) {
    try {
      await updateDoc(doc(db, "contactMessages", id), {
        read,
        readAt: read ? serverTimestamp() : null,
        readBy: read ? auth.currentUser?.uid || null : null,
      });
    } catch (err) {
      console.error("Couldn't update message:", err);
      showToast("Couldn't update the message. Please try again.");
    }
  }

  // Inline reply: emailed to the customer by api/reply-message.js.
  const openReplies = new Set();
  function showReplyForm(id, show) {
    const form = listEl.querySelector(`[data-reply-form="${id}"]`);
    const actions = listEl.querySelector(`[data-actions="${id}"]`);
    if (!form || !actions) return;
    form.classList.toggle("d-none", !show);
    actions.classList.toggle("d-none", show);
    if (show) {
      openReplies.add(id);
      form.querySelector("textarea").focus();
    } else {
      openReplies.delete(id);
    }
  }

  listEl.addEventListener("submit", async (e) => {
    const form = e.target.closest("[data-reply-form]");
    if (!form) return;
    e.preventDefault();
    const id = form.dataset.replyForm;
    const textarea = form.querySelector("textarea");
    const errorEl = form.querySelector(".message-reply-error");
    const sendBtn = form.querySelector('button[type="submit"]');
    const reply = textarea.value.trim();
    errorEl.classList.add("d-none");
    if (reply.length < 2) {
      errorEl.textContent = "Please write a reply.";
      errorEl.classList.remove("d-none");
      return;
    }
    sendBtn.disabled = true;
    sendBtn.innerHTML = '<i class="bi bi-send"></i> Sending...';
    try {
      const res = await fetch("/api/reply-message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${await auth.currentUser.getIdToken()}`,
        },
        body: JSON.stringify({ messageId: id, reply }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't send the reply.");
      openReplies.delete(id);
      showToast("Reply sent.");
      // The live list re-renders with the saved reply.
    } catch (err) {
      errorEl.textContent = err.message || "Couldn't send the reply. Please try again.";
      errorEl.classList.remove("d-none");
      sendBtn.disabled = false;
      sendBtn.innerHTML = '<i class="bi bi-send"></i> Send reply';
    }
  });

  listEl.addEventListener("click", (e) => {
    const openBtn = e.target.closest("[data-reply-open]");
    if (openBtn) {
      showReplyForm(openBtn.dataset.replyOpen, true);
      return;
    }
    const cancelBtn = e.target.closest("[data-reply-cancel]");
    if (cancelBtn) {
      showReplyForm(cancelBtn.dataset.replyCancel, false);
      return;
    }
    const toggle = e.target.closest("[data-toggle-read]");
    if (toggle) {
      const m = messages.find((x) => x.id === toggle.dataset.toggleRead);
      if (m) setRead(m.id, !m.read);
      return;
    }
    // Replying counts as reading it.
    const reply = e.target.closest("[data-reply]");
    if (reply) {
      const m = messages.find((x) => x.id === reply.dataset.reply);
      if (m && !m.read) setRead(m.id, true);
    }
  });

  document.querySelectorAll("[data-msg-filter]").forEach((btn) =>
    btn.addEventListener("click", () => {
      filter = btn.dataset.msgFilter;
      document
        .querySelectorAll("[data-msg-filter]")
        .forEach((b) => b.classList.toggle("active", b === btn));
      renderKeepingDrafts();
    }),
  );

  onSnapshot(
    query(collection(db, "contactMessages"), orderBy("createdAt", "desc"), limit(200)),
    (snap) => {
      messages = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderKeepingDrafts();
    },
    (err) => {
      console.error("Couldn't load messages:", err);
      listEl.innerHTML = `<div class="admin-panel messages-empty">
        <i class="bi bi-exclamation-circle"></i>
        <p>Couldn't load messages. If this is new, the Firestore rules for
        <code>contactMessages</code> may not be published yet.</p>
      </div>`;
    },
  );
}

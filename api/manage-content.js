// api/manage-content.js — the store's editable content (Admin > Content and
// Admin > Promotions): static pages, the announcement bar, homepage text,
// app banners, featured products and promo codes. Admins and Super Admins
// only; clients can't write these collections (Firestore rules), so every
// value is checked here, and each change is recorded in the audit trail.
//
// POST with "Authorization: Bearer <Firebase ID token>":
//   { action: "savePage",   slug, title, body }
//   { action: "saveHome",   announcement, hero, banners, featuredIds }
//   { action: "savePromo",  code, type, value, label, firstOrderOnly, active, expiresOn }
//   { action: "deletePromo", code }
//   { action: "seedPromos" }
// Returns { ok: true } (or what was saved).

const { handleCors, readJsonBody, requireUser, getAdmin, sendError, HttpError } = require("./_lib/payments");
const { logAudit, actorFrom } = require("./_lib/audit");
const { CODE_RE, seedPromos } = require("./_lib/promos");

const PAGE_SLUGS = ["about", "contact", "faqs", "privacy", "terms"];
const PAGE_NAMES = { about: "About Us", contact: "Contact", faqs: "FAQs", privacy: "Privacy Policy", terms: "Terms & Conditions" };

const text = (v, max) => String(v ?? "").trim().slice(0, max);
const bool = (v) => v === true;

// A link that is either a page on this site or an https address.
function safeLink(raw) {
  const url = text(raw, 200);
  if (!url) return "";
  if (/^https:\/\/[^\s]+$/i.test(url)) return url;
  if (/^[a-zA-Z0-9_\-./]+(\?[a-zA-Z0-9_\-=&%.]*)?(#[a-zA-Z0-9_\-]*)?$/.test(url) && !url.startsWith("//") && !url.includes(":")) return url;
  throw new HttpError(400, "A link must be a page on this site (like products.html) or start with https://");
}

module.exports = async function handler(req, res) {
  if (!handleCors(req, res)) return;
  try {
    const caller = await requireUser(req);
    const admin = getAdmin();
    const db = admin.firestore();
    const FieldValue = admin.firestore.FieldValue;

    const profile = await db.collection("users").doc(caller.uid).get();
    if (!["admin", "superadmin"].includes(profile.get("role"))) {
      throw new HttpError(403, "Only an Admin or Super Admin can change the store's content.");
    }
    const actor = actorFrom(caller.uid, caller, profile, "admin");

    let body;
    try {
      body = readJsonBody(req);
    } catch {
      throw new HttpError(400, "Invalid request.");
    }

    switch (body.action) {
      case "savePage": {
        const slug = String(body.slug || "");
        if (!PAGE_SLUGS.includes(slug)) throw new HttpError(400, "Unknown page.");
        const title = text(body.title, 80);
        const content = String(body.body ?? "").slice(0, 20000);
        if (!title) throw new HttpError(400, "The page needs a title.");
        if (content.trim().length < 10) throw new HttpError(400, "The page needs some text.");
        await db.collection("pages").doc(slug).set({
          title,
          body: content,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: caller.uid,
        });
        await logAudit(admin, {
          actor,
          action: "content.page",
          targetType: "content",
          targetId: slug,
          targetLabel: `Page: ${PAGE_NAMES[slug]}`,
          summary: `Edited the ${PAGE_NAMES[slug]} page ("${title}", ${content.length} characters).`,
        });
        return res.status(200).json({ ok: true });
      }

      case "saveHome": {
        const a = body.announcement || {};
        const h = body.hero || {};
        const announcement = {
          enabled: bool(a.enabled),
          text: text(a.text, 160),
          linkLabel: text(a.linkLabel, 30),
          linkUrl: safeLink(a.linkUrl),
        };
        if (announcement.enabled && !announcement.text) throw new HttpError(400, "Write the announcement text, or turn it off.");
        const hero = { title: text(h.title, 80), accent: text(h.accent, 80), text: text(h.text, 300) };
        const banners = (Array.isArray(body.banners) ? body.banners : [])
          .slice(0, 4)
          .map((b) => ({
            title: text(b?.title, 60),
            subtitle: text(b?.subtitle, 140),
            code: text(b?.code, 20).toUpperCase(),
          }))
          .filter((b) => b.title);
        for (const b of banners) {
          if (b.code && !CODE_RE.test(b.code)) throw new HttpError(400, `"${b.code}" isn't a valid promo code (3-20 letters or numbers).`);
        }
        const featuredIds = [...new Set((Array.isArray(body.featuredIds) ? body.featuredIds : []).map(String))]
          .filter((id) => /^[A-Za-z0-9_-]{1,100}$/.test(id))
          .slice(0, 6);
        await db.collection("content").doc("home").set({
          announcement,
          hero,
          banners,
          featuredIds,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: caller.uid,
        });
        await logAudit(admin, {
          actor,
          action: "content.home",
          targetType: "content",
          targetId: "home",
          targetLabel: "Homepage content",
          summary: `Updated the homepage: announcement ${announcement.enabled ? "on" : "off"}, ${banners.length} app banner${banners.length === 1 ? "" : "s"}, ${featuredIds.length} featured product${featuredIds.length === 1 ? "" : "s"}${hero.title ? ", custom headline" : ""}.`,
        });
        return res.status(200).json({ ok: true });
      }

      case "seedPromos": {
        await seedPromos(admin);
        return res.status(200).json({ ok: true });
      }

      case "savePromo": {
        const code = text(body.code, 20).toUpperCase();
        if (!CODE_RE.test(code)) throw new HttpError(400, "The code must be 3-20 letters or numbers, with no spaces.");
        const type = body.type === "percent" ? "percent" : "flat";
        const value = Number(body.value);
        if (!Number.isInteger(value) || value < 1 || (type === "percent" ? value > 100 : value > 100000)) {
          throw new HttpError(400, type === "percent" ? "A percentage must be a whole number from 1 to 100." : "The amount off must be a whole number of pesos (1 or more).");
        }
        let expiresAt = null;
        if (body.expiresOn) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.expiresOn))) throw new HttpError(400, "Invalid expiry date.");
          // Valid through the end of that day, Philippine time.
          const d = new Date(`${body.expiresOn}T23:59:59+08:00`);
          if (Number.isNaN(d.getTime())) throw new HttpError(400, "Invalid expiry date.");
          expiresAt = admin.firestore.Timestamp.fromDate(d);
        }
        const label = text(body.label, 60) || (type === "percent" ? `${value}% off your order` : `₱${value} off your order`);

        await seedPromos(admin);
        const ref = db.collection("promos").doc(code);
        const existed = (await ref.get()).exists;
        await ref.set(
          {
            code,
            type,
            value,
            label,
            firstOrderOnly: bool(body.firstOrderOnly),
            active: body.active !== false,
            expiresAt,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: false },
        );
        await logAudit(admin, {
          actor,
          action: "promo.save",
          targetType: "promo",
          targetId: code,
          targetLabel: `Promo code ${code}`,
          summary: `${existed ? "Updated" : "Created"} promo code ${code}: ${type === "percent" ? `${value}% off` : `₱${value} off`}${bool(body.firstOrderOnly) ? ", first order only" : ""}${expiresAt ? `, until ${body.expiresOn}` : ""}, ${body.active === false ? "inactive" : "active"}.`,
        });
        return res.status(200).json({ ok: true });
      }

      case "deletePromo": {
        const code = text(body.code, 20).toUpperCase();
        if (!CODE_RE.test(code)) throw new HttpError(400, "Invalid code.");
        await seedPromos(admin);
        await db.collection("promos").doc(code).delete();
        await logAudit(admin, {
          actor,
          action: "promo.delete",
          targetType: "promo",
          targetId: code,
          targetLabel: `Promo code ${code}`,
          summary: `Deleted promo code ${code}.`,
        });
        return res.status(200).json({ ok: true });
      }

      default:
        throw new HttpError(400, "Invalid request.");
    }
  } catch (err) {
    sendError(res, err);
  }
};

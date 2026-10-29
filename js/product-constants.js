// js/product-constants.js
// KalingaCare — shared product category labels/badges.
// Pulled out of products.js so product.js (detail page) and favorites.js
// don't each keep their own copy that could drift out of sync.

export const CATEGORY_LABELS = {
  mobility: "Mobility",
  wellness: "Wellness",
  digital: "Digital Health",
};

export const CATEGORY_BADGE_CLASS = {
  mobility: "bg-success",
  wellness: "bg-primary",
  digital: "bg-warning text-dark",
};

// A product is shown in the store unless staff marked it inactive.
export function isActive(product) {
  return product?.status !== "inactive";
}

// "S, M, , L" -> ["S", "M", "L"] (for the optional size/color options).
export function splitList(text, max = 12) {
  const seen = new Set();
  const out = [];
  for (const raw of String(text || "").split(",")) {
    const item = raw.trim().slice(0, 30);
    if (item && !seen.has(item.toLowerCase())) {
      seen.add(item.toLowerCase());
      out.push(item);
    }
  }
  return out.slice(0, max);
}

// One "Label: Value" per line -> [{ label, value }].
export function parseSpecs(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((line) => {
      const i = line.indexOf(":");
      return i === -1
        ? { label: "", value: line.slice(0, 200) }
        : { label: line.slice(0, i).trim().slice(0, 80), value: line.slice(i + 1).trim().slice(0, 200) };
    });
}

export function specsToText(specs) {
  return (Array.isArray(specs) ? specs : [])
    .map((s) => (s.label ? `${s.label}: ${s.value}` : s.value))
    .join("\n");
}

// The 11-character id of a YouTube link (watch, youtu.be, embed, shorts), or "".
export function youtubeId(url) {
  const m = String(url || "")
    .trim()
    .match(/^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})(?:[&?#/].*)?$/);
  return m ? m[1] : "";
}

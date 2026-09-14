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

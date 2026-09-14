// js/currency.js
// KalingaCare — country -> currency mapping and live PHP conversion.
//
// The buyer's country is set once at registration (or later in Settings)
// and drives a default display currency at checkout. This is a DISPLAY
// conversion only: the canonical order amount stored in Firestore is
// always PHP (Cash on Delivery, priced in PHP, is the only real payment
// path this project has) — converting it is purely so an OFW browsing
// from abroad can see roughly what they're spending in their own currency.

// Keyed by country name (stored verbatim on the user doc) so the
// registration/settings <select> and this map never drift out of sync —
// populate those <select> elements from Object.keys(COUNTRY_CURRENCY)
// rather than hand-typing a parallel list of <option> tags.
export const COUNTRY_CURRENCY = {
  Philippines: "PHP",
  "Saudi Arabia": "SAR",
  "United Arab Emirates": "AED",
  Qatar: "QAR",
  Kuwait: "KWD",
  Bahrain: "BHD",
  Oman: "OMR",
  "Hong Kong": "HKD",
  Singapore: "SGD",
  Japan: "JPY",
  "South Korea": "KRW",
  Taiwan: "TWD",
  Malaysia: "MYR",
  "United States": "USD",
  Canada: "CAD",
  "United Kingdom": "GBP",
  Australia: "AUD",
  "New Zealand": "NZD",
  Germany: "EUR",
  Italy: "EUR",
  Spain: "EUR",
  "Other / Not Listed": "USD",
};

// Approximate PHP -> currency rates, only used if the live Frankfurter API
// is unreachable (offline demo venue, flaky wifi, etc.) so the conversion
// feature still visibly works rather than silently breaking. Not kept
// precisely up to date on purpose — this is a fallback, not the source
// of truth; getRates() always tries the live API first.
const FALLBACK_RATES = {
  PHP: 1,
  SAR: 0.064,
  AED: 0.063,
  QAR: 0.062,
  KWD: 0.0053,
  BHD: 0.0065,
  OMR: 0.0066,
  HKD: 0.134,
  SGD: 0.023,
  JPY: 2.5,
  KRW: 23.5,
  TWD: 0.55,
  MYR: 0.08,
  USD: 0.017,
  CAD: 0.024,
  GBP: 0.013,
  AUD: 0.026,
  NZD: 0.028,
  EUR: 0.016,
};

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour — rates don't need to be
// fetched more often than that for a display-only conversion.
let rateCache = null; // { timestamp, rates, live, liveCodes }

// Frankfurter's rates come from the European Central Bank, which simply
// doesn't publish reference rates for every currency in COUNTRY_CURRENCY —
// notably the Gulf currencies (SAR, AED, QAR, KWD, BHD, OMR) and TWD are
// never available from it, live or not. Requesting them isn't an error;
// the API just omits them from its response. So every currency always
// gets *some* rate (falling back per-currency, not all-or-nothing), and
// `liveCodes` tells the UI which ones are actually live right now.
//
// Fetches PHP -> every other listed currency in one call. Returns
// { rates, live, liveCodes }: `live` is true if the API call itself
// succeeded at all; `liveCodes` is the subset of currencies it actually
// returned a live rate for (everything else in `rates` came from the
// fallback table above).
export async function getRates() {
  if (rateCache && Date.now() - rateCache.timestamp < CACHE_TTL_MS) {
    return rateCache;
  }

  const symbols = [...new Set(Object.values(COUNTRY_CURRENCY))]
    .filter((code) => code !== "PHP")
    .join(",");

  try {
    const res = await fetch(
      `https://api.frankfurter.dev/v1/latest?from=PHP&to=${symbols}`,
    );
    if (!res.ok) throw new Error(`Frankfurter API returned ${res.status}`);
    const data = await res.json();
    rateCache = {
      timestamp: Date.now(),
      rates: { PHP: 1, ...FALLBACK_RATES, ...data.rates },
      live: true,
      liveCodes: Object.keys(data.rates || {}),
    };
  } catch (err) {
    console.warn(
      "Currency conversion: live rates unavailable, using fallback table.",
      err,
    );
    rateCache = {
      timestamp: Date.now(),
      rates: { PHP: 1, ...FALLBACK_RATES },
      live: false,
      liveCodes: [],
    };
  }

  return rateCache;
}

// Formats a PHP amount converted into `currencyCode` using Intl's own
// locale-correct currency formatting (symbol placement, decimal rules,
// grouping) instead of hand-rolling those per currency.
export function formatCurrency(amountInTargetCurrency, currencyCode) {
  if (currencyCode === "PHP") {
    return (
      "₱" +
      amountInTargetCurrency.toLocaleString("en-PH", {
        maximumFractionDigits: 2,
      })
    );
  }
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currencyCode,
      maximumFractionDigits: currencyCode === "JPY" || currencyCode === "KRW" ? 0 : 2,
    }).format(amountInTargetCurrency);
  } catch {
    return `${currencyCode} ${amountInTargetCurrency.toFixed(2)}`;
  }
}

// Converts a PHP amount to `currencyCode` given a rates object from
// getRates(), and formats it in one step.
export function convertAndFormat(phpAmount, currencyCode, rates) {
  const rate = rates[currencyCode] ?? 1;
  return formatCurrency(phpAmount * rate, currencyCode);
}

// Populates a <select> with one <option> per country, sorted so the most
// common OFW destinations aren't buried alphabetically under "Australia".
const PRIORITY_COUNTRIES = [
  "Saudi Arabia",
  "United Arab Emirates",
  "Qatar",
  "Kuwait",
  "Hong Kong",
  "Singapore",
  "United States",
  "Philippines",
];

export function populateCountrySelect(selectEl, selectedValue = "") {
  const countries = Object.keys(COUNTRY_CURRENCY);
  const ordered = [
    ...PRIORITY_COUNTRIES,
    ...countries
      .filter((c) => !PRIORITY_COUNTRIES.includes(c))
      .sort((a, b) => a.localeCompare(b)),
  ];

  selectEl.innerHTML = ordered
    .map((country) => `<option value="${country}">${country}</option>`)
    .join("");

  if (selectedValue && countries.includes(selectedValue)) {
    selectEl.value = selectedValue;
  }
}

const PRIORITY_CURRENCIES = ["PHP", "USD", "SAR", "AED", "QAR", "KWD", "HKD", "SGD"];

// Populates a <select> with one <option> per distinct currency code (not
// per country — several countries share a currency, e.g. every Eurozone
// entry above maps to EUR) for the checkout "show total in" picker.
export function populateCurrencySelect(selectEl, selectedValue = "PHP") {
  const codes = [...new Set(Object.values(COUNTRY_CURRENCY))];
  const ordered = [
    ...PRIORITY_CURRENCIES,
    ...codes.filter((c) => !PRIORITY_CURRENCIES.includes(c)).sort(),
  ];

  selectEl.innerHTML = ordered
    .map((code) => `<option value="${code}">${code}</option>`)
    .join("");

  if (codes.includes(selectedValue)) {
    selectEl.value = selectedValue;
  }
}

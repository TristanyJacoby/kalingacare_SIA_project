// js/firebase.js
// KalingaCare — Firebase initialization
//
// This project has no build step (Bootstrap etc. are loaded via CDN <script> tags,
// not npm), so we can't use bare specifiers like "firebase/app" — the browser has
// no idea what that means. Instead we import straight from Firebase's own CDN,
// the same way the rest of the site loads its dependencies.
//
// Every other page script (auth.js, products.js, cart.js, checkout.js, admin.js)
// should import what it needs from this file, e.g.:
//   import { db, auth } from "./firebase.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getAnalytics,
  isSupported as analyticsIsSupported,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-analytics.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBlllS1Me8vFN1Og7bdE9VuT-c2ZKCkt0s",
  authDomain: "kalingacare-e9873.firebaseapp.com",
  projectId: "kalingacare-e9873",
  storageBucket: "kalingacare-e9873.firebasestorage.app",
  messagingSenderId: "668022432666",
  appId: "1:668022432666:web:27c2ed7d121fff8f6e5023",
  measurementId: "G-BTYTJW52W0",
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// Analytics only works over http(s), not from a local file:// double-click,
// and can throw in unsupported environments — so we guard it instead of
// calling getAnalytics(app) directly like the original file did.
analyticsIsSupported().then((supported) => {
  if (supported) getAnalytics(app);
});

console.log("KalingaCare Firebase is connected.");

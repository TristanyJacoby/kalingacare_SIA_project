// js/auth.js
// KalingaCare — Login / Register page logic
// Handles the slide toggle between panels AND real Firebase Authentication.

import { auth, db } from "./firebase.js";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  doc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const stage = document.getElementById("stage");
const loginSection = document.getElementById("loginSection");
const signupSection = document.getElementById("signupSection");
const brandTitle = document.getElementById("brandTitle");
const brandText = document.getElementById("brandText");

const COPY = {
  login: {
    title: "Welcome Back!",
    text: "Log in to keep caring for your loved ones, wherever you are.",
  },
  signup: {
    title: "Join KalingaCare!",
    text: "Create an account and start sending care that truly gets there.",
  },
};

// Toggle between the login and signup panels (used on both pages so a user
// can switch modes without a full page reload).
window.toggleMode = function () {
  stage.classList.toggle("signup-active");

  setTimeout(() => {
    const isSignup = stage.classList.contains("signup-active");
    loginSection.classList.toggle("hidden", isSignup);
    signupSection.classList.toggle("hidden", !isSignup);
    brandTitle.innerText = isSignup ? COPY.signup.title : COPY.login.title;
    brandText.innerText = isSignup ? COPY.signup.text : COPY.login.text;
  }, 350);
};

// If this page loaded already in "signup" mode (register.html), sync the
// visible panel/copy on load without animating.
function initMode() {
  const isSignup = stage.classList.contains("signup-active");
  loginSection.classList.toggle("hidden", isSignup);
  signupSection.classList.toggle("hidden", !isSignup);
  brandTitle.innerText = isSignup ? COPY.signup.title : COPY.login.title;
  brandText.innerText = isSignup ? COPY.signup.text : COPY.login.text;
}
initMode();

function showError(el, message) {
  el.textContent = message;
  el.classList.add("show");
}
function clearError(el) {
  el.textContent = "";
  el.classList.remove("show");
}

/* ===== LOGIN ===== */
const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError(loginError);

  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const submitBtn = loginForm.querySelector(".btn-auth");

  submitBtn.disabled = true;
  submitBtn.textContent = "Signing in...";

  try {
    await signInWithEmailAndPassword(auth, email, password);
    window.location.href = "index.html";
  } catch (err) {
    showError(loginError, friendlyAuthError(err.code));
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Sign In";
  }
});

/* ===== REGISTER ===== */
const signupForm = document.getElementById("signupForm");
const signupError = document.getElementById("signupError");

signupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError(signupError);

  const fullName = document.getElementById("signupName").value.trim();
  const email = document.getElementById("signupEmail").value.trim();
  const password = document.getElementById("signupPassword").value;
  const confirmPassword = document.getElementById("signupConfirmPassword").value;
  const submitBtn = signupForm.querySelector(".btn-auth");

  if (password !== confirmPassword) {
    showError(signupError, "Passwords don't match.");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Creating account...";

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: fullName });

    // Mirror the account into Firestore so admin/products/orders pages can
    // reference user profiles later. Every new signup starts as a plain
    // "user" — the other three tiers (staff, admin, superadmin) are granted
    // manually by a Super Admin from the admin dashboard's User Management
    // table, never self-assigned at signup.
    await setDoc(doc(db, "users", cred.user.uid), {
      fullName,
      email,
      role: "user",
      createdAt: serverTimestamp(),
    });

    window.location.href = "index.html";
  } catch (err) {
    showError(signupError, friendlyAuthError(err.code));
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Sign Up";
  }
});

/* ===== Slide-then-navigate between login.html and register.html =====
   The in-form "Create Account" / "Sign In" links just call toggleMode()
   directly since they stay on the same page. But the navbar's Login /
   Get Started buttons are real links to a *different* file. To make that
   feel like one continuous slide instead of a hard page cut, we play the
   slide animation first, then navigate — and since the destination page
   already opens in that same slid-over state, it reads as seamless. */
const switchLink = document.getElementById("navSwitchAuth");
if (switchLink) {
  switchLink.addEventListener("click", (e) => {
    e.preventDefault();
    const destination = switchLink.getAttribute("href");
    toggleMode();
    setTimeout(() => {
      window.location.href = destination;
    }, 900); // matches --slide-speed in auth.css
  });
}

function friendlyAuthError(code) {
  switch (code) {
    case "auth/invalid-email":
      return "That email address doesn't look right.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Incorrect email or password.";
    case "auth/email-already-in-use":
      return "An account already exists with this email.";
    case "auth/weak-password":
      return "Password should be at least 6 characters.";
    default:
      return "Something went wrong. Please try again.";
  }
}

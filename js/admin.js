import { auth } from './firebase.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// Restrict access to admin pages
onAuthStateChanged(auth, (user) => {
  if (!user) {
    // User is not logged in, redirect to login page
    window.location.href = "../login.html";
  } else {
    // Check if user has admin privileges (e.g., custom claims or specific user role/email)
    const isAdmin = user.email.endsWith("@admin.com"); // Adjust check based on your logic
    if (!isAdmin) {
      alert("Access Denied: Admins Only");
      window.location.href = "../index.html";
    }
  }
});
// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBlllS1Me8vFN1Og7bdE9VuT-c2ZKCkt0s",
  authDomain: "kalingacare-e9873.firebaseapp.com",
  projectId: "kalingacare-e9873",
  storageBucket: "kalingacare-e9873.firebasestorage.app",
  messagingSenderId: "668022432666",
  appId: "1:668022432666:web:27c2ed7d121fff8f6e5023",
  measurementId: "G-BTYTJW52W0"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
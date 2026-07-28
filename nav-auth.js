// Hides the "Queue" nav link site-wide unless someone is logged in
// (player or admin) — Queue is a members-only tool, so it shouldn't be
// advertised in the public nav. Reuses an existing Firebase app instance
// if the page already initialized one, to avoid "app already exists" errors.
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBQYKgSchzlmtIGsIhf68e8OYt7Y8kY7Vo",
  authDomain: "ocpc-website-faf5e.firebaseapp.com",
  projectId: "ocpc-website-faf5e",
  storageBucket: "ocpc-website-faf5e.firebasestorage.app",
  messagingSenderId: "15833259684",
  appId: "1:15833259684:web:0f2f4400f9995517ae5031"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);

onAuthStateChanged(auth, (user) => {
  document.querySelectorAll('a[href="queue.html"]').forEach(el => {
    el.style.display = user ? '' : 'none';
  });
});

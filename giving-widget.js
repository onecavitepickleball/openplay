// Floating "Support Our Fundraiser" widget, shown on every page except the
// /giving/ pages themselves. Controlled by settings/fundraiser.floatingWidgetEnabled
// (admin.html's Fundraiser tab) so it can be switched off once the campaign ends.
// Dismissal is remembered per browser via localStorage.
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBQYKgSchzlmtIGsIhf68e8OYt7Y8kY7Vo",
  authDomain: "ocpc-website-faf5e.firebaseapp.com",
  projectId: "ocpc-website-faf5e",
  storageBucket: "ocpc-website-faf5e.firebasestorage.app",
  messagingSenderId: "15833259684",
  appId: "1:15833259684:web:0f2f4400f9995517ae5031"
};

const DISMISS_KEY = 'ocpc-giving-widget-dismissed';

async function initGivingWidget(){
  if (window.location.pathname.startsWith('/giving/')) return;
  if (localStorage.getItem(DISMISS_KEY)) return;

  try {
    const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
    const db = getFirestore(app);
    const snap = await getDoc(doc(db, 'settings', 'fundraiser'));
    if (!snap.exists() || !snap.data().floatingWidgetEnabled) return;
  } catch (err) {
    return;
  }

  const el = document.createElement('div');
  el.id = 'givingFloatWidget';
  el.innerHTML = `
    <button id="givingFloatClose" aria-label="Close">&times;</button>
    <div class="gfw-icon">🤝</div>
    <div>
      <div class="gfw-title">Support Our October Fundraiser</div>
      <p class="gfw-text">Help OCPC give back to the community this October.</p>
      <a class="gfw-btn" href="/giving/">Learn More →</a>
    </div>
  `;
  document.body.appendChild(el);

  document.getElementById('givingFloatClose').addEventListener('click', () => {
    el.remove();
    localStorage.setItem(DISMISS_KEY, '1');
  });
}

initGivingWidget();

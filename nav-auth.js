// Shared nav logic that needs Firebase: auth-aware Queue link visibility,
// the Join OCPC / My Profile account pill, and the notification bell
// (upcoming birthdays from the roster + hand-edited club announcements).
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { getFirestore, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

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
const db = getFirestore(app);

onAuthStateChanged(auth, (user) => {
  document.querySelectorAll('a[href="queue.html"]').forEach(el => {
    el.style.display = user ? '' : 'none';
  });
  renderAccountPill(user);
});

// ---- Join OCPC / My Profile account pill ----
function renderAccountPill(user){
  const btn = document.getElementById('navAccountBtn');
  const label = document.getElementById('navAccountLabel');
  const panel = document.getElementById('navAccountPanel');
  if (!btn || !label || !panel) return;

  if (user) {
    btn.classList.add('is-loggedin');
    label.textContent = 'My Profile';
    panel.innerHTML = `
      <a class="nav-account-opt" href="/profile/">
        <div class="o-title">My Profile</div>
        <div class="o-desc">View and update your player info</div>
      </a>
      <a class="nav-account-opt is-signout" href="#" id="navSignOutBtn">
        <div class="o-title">Sign Out</div>
        <div class="o-desc">Log out of your OCPC account</div>
      </a>
    `;
    const signOutBtn = document.getElementById('navSignOutBtn');
    if (signOutBtn) {
      signOutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        signOut(auth).then(() => window.location.href = '/');
      });
    }
  } else {
    btn.classList.remove('is-loggedin');
    label.textContent = 'Join OCPC';
    panel.innerHTML = `
      <a class="nav-account-opt" href="/profile/">
        <div class="o-title">Sign In</div>
        <div class="o-desc">Log in to manage your profile</div>
      </a>
      <a class="nav-account-opt" href="/join/">
        <div class="o-title">Sign Up</div>
        <div class="o-desc">New here? Create your player profile</div>
      </a>
    `;
  }
}

// ---- Notification bell ----
// Hand-edit this list as new things happen — each item needs a stable id,
// an ISO date (used both for sorting and for the "is this new" check), a
// short title/desc, and a link. Birthdays in the next 7 days are merged in
// automatically from the roster below.
const ANNOUNCEMENTS = [
  { id: 'ann-tshirt-v1', date: '2026-07-29', icon: '🛍️', title: 'OCPC T-Shirt v1 just dropped', desc: 'Heat press, ₱400, 8 colors — check the Shop.', url: '/merch/' },
  { id: 'ann-zambales-recap', date: '2026-07-27', icon: '📸', title: 'Zambales trip recap is up', desc: 'Photos and highlights from The Highgrounds Compound.', url: '/events/' },
];

function toTitleCase(str){
  return String(str || '').replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

function nextBirthdayDate(birthMonth, birthDay){
  const now = new Date();
  const year = now.getFullYear();
  let d = new Date(year, birthMonth - 1, birthDay);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (d < today) d = new Date(year + 1, birthMonth - 1, birthDay);
  return d;
}

async function loadNotifications(){
  const list = document.getElementById('navNotifList');
  const dot = document.getElementById('navNotifDot');
  if (!list) return;

  let items = ANNOUNCEMENTS.map(a => ({ ...a, sortDate: a.date }));

  try {
    const snap = await getDocs(collection(db, 'roster'));
    const now = new Date();
    const in7 = new Date(now.getTime() + 7 * 86400000);
    snap.docs.map(d => d.data()).forEach(p => {
      if (!p.birthMonth || !p.birthDay) return;
      const next = nextBirthdayDate(p.birthMonth, p.birthDay);
      if (next <= in7) {
        const isToday = next.toDateString() === now.toDateString();
        const name = `${toTitleCase(p.firstName)} ${toTitleCase(p.lastName)}`.trim();
        items.push({
          id: 'bday-' + name.toLowerCase().replace(/\s+/g, '-'),
          date: next.toISOString().slice(0, 10),
          sortDate: next.toISOString().slice(0, 10),
          icon: '🎂',
          title: isToday ? `It's ${name}'s birthday today!` : `${name}'s birthday is coming up`,
          desc: isToday ? 'Wish them a happy birthday on court.' : `${next.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — say happy birthday when you see them.`,
          url: '/birthdays/'
        });
      }
    });
  } catch (err) { /* roster not reachable — announcements still show */ }

  items.sort((a, b) => b.sortDate.localeCompare(a.sortDate));

  list.innerHTML = items.length
    ? items.map(n => `
        <a class="nav-notif-item" href="${n.url}">
          <span class="nav-notif-icon">${n.icon}</span>
          <span class="nav-notif-body">
            <span class="n-title">${n.title}</span>
            <span class="n-desc">${n.desc}</span>
          </span>
        </a>
      `).join('')
    : `<div class="nav-notif-empty">You're all caught up.</div>`;

  if (dot) {
    let seen = '';
    try { seen = localStorage.getItem('ocpc_notif_seen') || ''; } catch (err) {}
    const hasNew = items.some(n => n.sortDate > seen);
    dot.hidden = !hasNew;
  }
}

loadNotifications();

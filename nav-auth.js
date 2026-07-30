// Shared nav logic that needs Firebase: auth-aware Queue link visibility,
// the Join OCPC / My Profile account pill, and the notification bell
// (upcoming birthdays from the roster + hand-edited club announcements).
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { getFirestore, collection, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

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

onAuthStateChanged(auth, async (user) => {
  document.querySelectorAll('a[href="queue.html"]').forEach(el => {
    el.style.display = user ? '' : 'none';
  });

  let firstName = '';
  if (user) {
    try {
      const snap = await getDoc(doc(db, 'players', user.uid));
      if (snap.exists() && snap.data().firstName) firstName = toTitleCase(snap.data().firstName);
    } catch (err) { /* fall back to generic greeting */ }
  }
  renderAccountPill(user, firstName);
});

// ---- Join OCPC / My Profile account pill ----
function renderAccountPill(user, firstName){
  const btn = document.getElementById('navAccountBtn');
  const label = document.getElementById('navAccountLabel');
  const panel = document.getElementById('navAccountPanel');
  if (!btn || !label || !panel) return;

  if (user) {
    btn.classList.add('is-loggedin');
    label.textContent = 'My Profile';
    panel.innerHTML = `
      <div class="nav-account-promo">
        <span class="nav-account-promo-tag">Member</span>
        <h4>${firstName ? `Welcome Back, ${firstName}` : 'Welcome Back'}</h4>
        <p>Manage your player profile, check your stats, and see what's new with the club.</p>
        <a class="btn-promo" href="/profile/">View Profile</a>
      </div>
      <div class="nav-account-links">
        <a class="nav-account-link" href="/profile/">My Profile</a>
        <a class="nav-account-link" href="/leaderboard/">Leaderboard</a>
        <a class="nav-account-link is-signout" href="#" id="navSignOutBtn">Sign Out</a>
      </div>
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
      <div class="nav-account-promo">
        <span class="nav-account-promo-tag">Free</span>
        <h4>Join OCPC Free</h4>
        <p>Get on Meet the Club, birthday shoutouts, and your own player profile — sign up in a couple minutes.</p>
        <a class="btn-promo" href="/join/">Join For Free</a>
      </div>
      <div class="nav-account-links">
        <a class="nav-account-link" href="/profile/">Sign In</a>
        <a class="nav-account-link" href="/join/">Join For Free</a>
        <a class="nav-account-link" href="/meet-the-club/">About OCPC</a>
      </div>
    `;
  }
}

// ---- Notification bell ----
// Hand-edit this list as new things happen — each item needs a stable id,
// an ISO date (used both for sorting and for the "is this new" check), a
// short title/desc, and a link. Birthdays in the next 7 days are merged in
// automatically from the roster below.
const ANNOUNCEMENTS = [
  { id: 'ann-shop-refresh', date: '2026-07-30', icon: '🛍️', title: 'New gear just dropped in the Shop', desc: 'OCPC T-Shirt V2, Cap, Mug, and Tumbler are up — cart and checkout in one flow.', url: '/merch/' },
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

// Dismissals are kept in memory only (not localStorage) — clearing a
// notification hides it for this page session on this device, but it
// comes back for everyone (including the same person) on their next
// visit or refresh. Nothing is shared across users.
let allNotifItems = [];
const dismissedNotifIds = new Set();

function renderNotifList(){
  const list = document.getElementById('navNotifList');
  const dot = document.getElementById('navNotifDot');
  const clearBtn = document.getElementById('navNotifClear');
  if (!list) return;

  const visible = allNotifItems.filter(n => !dismissedNotifIds.has(n.id));

  list.innerHTML = visible.length
    ? visible.map(n => `
        <div class="nav-notif-item">
          <a class="nav-notif-item-link" href="${n.url}">
            <span class="nav-notif-icon">${n.icon}</span>
            <span class="nav-notif-body">
              <span class="n-title">${n.title}</span>
              <span class="n-desc">${n.desc}</span>
            </span>
          </a>
          <button class="nav-notif-dismiss" data-id="${n.id}" aria-label="Dismiss notification">&times;</button>
        </div>
      `).join('')
    : `<div class="nav-notif-empty">You're all caught up.</div>`;

  list.querySelectorAll('.nav-notif-dismiss').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dismissedNotifIds.add(btn.dataset.id);
      renderNotifList();
    });
  });

  if (dot) {
    dot.textContent = String(visible.length);
    dot.hidden = visible.length === 0;
  }
  if (clearBtn) {
    clearBtn.hidden = visible.length === 0;
  }
}

async function loadNotifications(){
  const list = document.getElementById('navNotifList');
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
  allNotifItems = items;
  renderNotifList();

  const clearBtn = document.getElementById('navNotifClear');
  if (clearBtn) {
    clearBtn.addEventListener('click', (e) => {
      e.preventDefault();
      allNotifItems.forEach(n => dismissedNotifIds.add(n.id));
      renderNotifList();
    });
  }
}

loadNotifications();

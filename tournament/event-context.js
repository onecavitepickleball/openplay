const SDK_VERSION = '10.13.2';
import(`./cache-refresh.js?boot=${Date.now()}`).catch(()=>{});
const LEGACY_EVENT_ID = 'ocpc-rally-rebels-dual-meet-2026';

function waitForAuth(auth, onAuthStateChanged) {
  return new Promise(resolve => {
    let settled = false, stop = () => {}, timeout = setTimeout(() => finish(null), 5000);
    const finish = user => { if (settled) return; settled = true; clearTimeout(timeout); stop(); resolve(user); };
    stop = onAuthStateChanged(auth, finish, () => finish(null));
  });
}

function absoluteLogo(value) {
  if (!value) return `${location.origin}/assets/logo-2026.png`;
  try { return new URL(value, `${location.origin}/tournament/`).href; } catch (_) { return `${location.origin}/assets/logo-2026.png`; }
}

function absoluteClubLogo(value) {
  if (!String(value || '').trim()) return '';
  try { return new URL(String(value).trim(), `${location.origin}/tournament/`).href; } catch (_) { return ''; }
}

export function currentEventId() {
  return new URLSearchParams(location.search).get('event') || sessionStorage.getItem('matchday.currentEvent') || LEGACY_EVENT_ID;
}

export function eventUrl(path, extra = {}) {
  const url = new URL(path, location.href);
  url.searchParams.set('event', currentEventId());
  Object.entries(extra).forEach(([key, value]) => value === null ? url.searchParams.delete(key) : url.searchParams.set(key, value));
  return url.href;
}

function portalUrl(extra = {}) { const url = new URL('./', import.meta.url); Object.entries(extra).forEach(([key,value])=>value===null?url.searchParams.delete(key):url.searchParams.set(key,value)); return url.href; }

export async function loadTournamentContext() {
  await import('./config.js');
  const fallback = structuredClone(window.TOURNAMENT_CONFIG);
  const eventId = currentEventId();
  sessionStorage.setItem('matchday.currentEvent', eventId);

  const [{ initializeApp, getApps, getApp }, { getAuth, onAuthStateChanged }, { getFirestore, doc, getDoc }] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-firestore.js`)
  ]);
  const firebaseConfig = { apiKey:'AIzaSyBQYKgSchzlmtIGsIhf68e8OYt7Y8kY7Vo',authDomain:'ocpc-website-faf5e.firebaseapp.com',projectId:'ocpc-website-faf5e',storageBucket:'ocpc-website-faf5e.firebasestorage.app',messagingSenderId:'15833259684',appId:'1:15833259684:web:0f2f4400f9995517ae5031' };
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig), auth = getAuth(app), user = auth.currentUser || await waitForAuth(auth, onAuthStateChanged);
  if (!user) { location.replace(portalUrl({ return:location.pathname + location.search })); return new Promise(() => {}); }
  let snapshot;
  try { snapshot = await getDoc(doc(getFirestore(app), 'tournamentEvents', eventId)); }
  catch (_) { location.replace(portalUrl({ denied:'1' })); return new Promise(() => {}); }
  if (!snapshot.exists() && eventId !== LEGACY_EVENT_ID) { location.replace(portalUrl({ missing:'1' })); return new Promise(() => {}); }
  const saved = snapshot.exists() ? snapshot.data().config : null;
  const config = { ...fallback, ...(saved || {}), brand:{...fallback.brand,...(saved?.brand || {})}, event:{...fallback.event,...(saved?.event || {})}, scoring:{...fallback.scoring,...(saved?.scoring || {})}, clubs:Array.isArray(saved?.clubs) ? saved.clubs : fallback.clubs, categories:Array.isArray(saved?.categories) ? saved.categories : fallback.categories, pairsPerCategory:saved?.pairsPerCategory || fallback.pairsPerCategory };
  config.firebaseEventId = eventId;
  config.storageKey = `matchday.${eventId}`;
  config.brand.logo = absoluteLogo(config.brand.logo);
  config.clubs = config.clubs.map(club => ({ ...club, logo:absoluteClubLogo(club.logo) }));
  config.affiliations = (Array.isArray(config.affiliations) ? config.affiliations : config.clubs).map(item => ({ ...item, logo:absoluteClubLogo(item.logo || item.logoUrl) }));
  if (Array.isArray(config.clubs) && Array.isArray(config.affiliations) && config.clubs.length === config.affiliations.length) {
    config.clubs = config.clubs.map((club, index) => ({ ...club, logo: config.affiliations[index]?.logo || club.logo }));
  }
  window.TOURNAMENT_CONFIG = config;
  window.MATCHDAY_EVENT_ID = eventId;
  window.MATCHDAY_EVENT_URL = eventUrl;
  return config;
}

export { LEGACY_EVENT_ID };

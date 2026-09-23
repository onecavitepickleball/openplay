import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, setPersistence, browserLocalPersistence } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, collection, onSnapshot, setDoc, addDoc, updateDoc, getDoc, getDocs, writeBatch, deleteDoc, serverTimestamp, arrayUnion, arrayRemove, runTransaction } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';
import { createSessionLock } from './session-lock.js?v=portal-recovery-20260923';

const firebaseConfig = {
  apiKey: 'AIzaSyBQYKgSchzlmtIGsIhf68e8OYt7Y8kY7Vo', authDomain: 'ocpc-website-faf5e.firebaseapp.com', projectId: 'ocpc-website-faf5e', storageBucket: 'ocpc-website-faf5e.firebasestorage.app', messagingSenderId: '15833259684', appId: '1:15833259684:web:0f2f4400f9995517ae5031'
};
// The main OCPC site keeps uploaded portraits in Cloudinary and writes only
// their durable HTTPS URL to Firestore.  Tournament images use that same
// path: browser data URLs are only suitable for a temporary preview and can
// make an event document exceed Firestore's document-size limit.
const CLOUDINARY_CLOUD_NAME = 'spakpfuj';
const CLOUDINARY_UPLOAD_PRESET = 'ocpc_player_photos';
const eventId = window.TOURNAMENT_CONFIG.firebaseEventId;
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
let db;
try { db = initializeFirestore(app, { localCache:persistentLocalCache({ tabManager:persistentMultipleTabManager() }) }); }
catch (_) { db = getFirestore(app); }
const auth = getAuth(app), controlRef = doc(db, 'tournamentEvents', eventId), membersRef = collection(controlRef, 'members'), refereeBoardRef = doc(db, 'tournamentRefereeBoards', eventId), matchesRef = collection(db, 'tournamentEvents', eventId, 'matches'), registrationsRef = collection(db, 'tournamentEvents', eventId, 'registrations'), checkinsRef = collection(db, 'tournamentEvents', eventId, 'checkins');
const sessionLock = createSessionLock({ db, auth, doc, onSnapshot, runTransaction, setDoc, deleteDoc, serverTimestamp, signOut });
const LEGACY_EVENT_ID = 'ocpc-rally-rebels-dual-meet-2026';
const SUPER_ADMIN_EMAILS = ['ocpc.pickleball@gmail.com', 'jamescastillo37@gmail.com'];
const EVENT_ROLES = ['owner', 'tournament_admin', 'match_control', 'tournament_registration', 'tournament_checkin', 'tournament_score_desk', 'tournament_referee'];
const CONTROL_ROLES = ['owner', 'tournament_admin', 'match_control'];
const CONTROL_WRITE_DELAY = 35;
const MATCH_WRITE_DELAY = 35;
const controlWriteState = { timer: null, pending: null, waiters: [] };
const matchWriteStates = new Map();
const pendingWrites = new Set();
let pendingSequence = 0;
const roleList = value => [...new Set(Array.isArray(value?.roles) ? value.roles : (value?.role ? [value.role] : []))];
const primaryRole = roles => EVENT_ROLES.find(role => roles.includes(role)) || 'staff';

function stableValue(value, seen = new WeakSet()) {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return `[${value.map(item => stableValue(item, seen)).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableValue(value[key], seen)}`).join(',')}}`;
}

function updateTime(value) {
  if (!value || typeof value !== 'object') return 0;
  const own = typeof value.updatedAt?.toMillis === 'function' ? value.updatedAt.toMillis() : Date.parse(value.updatedAt || '') || Number(value.updatedAt) || 0;
  return Math.max(own, ...Object.values(value).map(updateTime));
}

function watchCollection(ref, onData, onError, mapSnapshot, ignoreStale = false) {
  let lastKey = '', lastUpdateTime = 0;
  const metadataId = `firestore:${ref.path || 'query'}`;
  return onSnapshot(ref, { includeMetadataChanges:true }, snapshot => {
    if (snapshot.metadata?.hasPendingWrites) pendingWrites.add(metadataId); else pendingWrites.delete(metadataId);
    emitSyncState();
    const value = mapSnapshot(snapshot);
    const key = stableValue(value);
    // Firestore can replay an identical local/server snapshot; suppressing it
    // keeps a replay from causing a full tournament render.
    if (key === lastKey) return;
    const nextUpdateTime = updateTime(value);
    // Single-document feeds can briefly deliver an older cached snapshot after
    // a server acknowledgement; do not let it replace newer optimistic state.
    if (ignoreStale && nextUpdateTime && nextUpdateTime < lastUpdateTime) return;
    lastKey = key;
    lastUpdateTime = Math.max(lastUpdateTime, nextUpdateTime);
    onData(value);
  }, onError);
}

function emitSyncState(error = '') {
  const detail = { online:navigator.onLine !== false, pending:pendingWrites.size, error, label:navigator.onLine === false ? `${pendingWrites.size} change${pendingWrites.size===1?'':'s'} waiting to sync` : pendingWrites.size ? `Syncing ${pendingWrites.size} change${pendingWrites.size===1?'':'s'}…` : 'All changes synced' };
  window.dispatchEvent(new CustomEvent('matchday-sync-state', { detail }));
  const banner = document.getElementById('offlineBanner');
  if (banner) {
    banner.hidden = detail.online && !detail.pending && !error;
    banner.classList.toggle('is-syncing', detail.online && detail.pending > 0);
    const heading = banner.querySelector('b');
    if (heading) heading.textContent = detail.online ? (error ? 'Sync needs attention' : 'Synchronizing match data') : 'Offline emergency mode';
    const copy = banner.querySelector('span');
    if (copy) copy.textContent = error ? `Sync needs attention: ${error}` : detail.label;
  }
}

function trackWrite(promise, kind = 'change') {
  const id = `${Date.now()}-${++pendingSequence}-${kind}`;
  pendingWrites.add(id); emitSyncState();
  promise.then(() => { pendingWrites.delete(id); emitSyncState(); }, error => { pendingWrites.delete(id); emitSyncState(error?.message || 'Cloud write failed'); });
  // Firestore retains an offline write in IndexedDB. Resolve the UI action
  // immediately while offline; the tracked promise clears after server ack.
  return navigator.onLine === false ? Promise.resolve({ queued:true }) : promise;
}

window.addEventListener('offline', () => emitSyncState());
window.addEventListener('online', () => emitSyncState());
queueMicrotask(() => {
  emitSyncState();
  navigator.serviceWorker?.register('/sw.js').catch(() => {});
});

function settleWaiters(state, error) {
  const waiters = state.waiters.splice(0);
  waiters.forEach(({ resolve, reject }) => error ? reject(error) : resolve());
}

function flushControlWrite() {
  const state = controlWriteState, pending = state.pending;
  state.pending = null; state.timer = null;
  if (!pending) return;
  const writes = { state: pending };
  writeControlNow(writes).then(() => settleWaiters(state), error => settleWaiters(state, error));
}

async function writeControlNow({ state }) {
  const safe = structuredClone(state); delete safe.liveScoring;
  Object.values(safe.checkins || {}).forEach(player => {
    delete player.photo;
    if (String(player.photoThumb || '').startsWith('data:')) delete player.photoThumb;
    if (!player.photoURL && player.photoThumb) player.photoURL = player.photoThumb;
  });
  Object.values(safe.scores || {}).forEach(score => { if (score.confirmation) { delete score.confirmation.ocpcSignature; delete score.confirmation.rebelsSignature; } });
  const refereeState = { matches:safe.matches || [], pairs:safe.pairs || {}, courts:safe.courts || {}, scores:safe.scores || {}, matchSettings:safe.matchSettings || {}, refereeAssignments:safe.refereeAssignments || {}, updatedAt:safe.updatedAt || new Date().toISOString() };
  const sessionDeviceId=sessionLock.deviceId(),batch=writeBatch(db);batch.set(controlRef,{state:safe,refereeEmails:[...new Set(Object.values(state.refereeAssignments||{}))],sessionDeviceId,updatedAt:serverTimestamp()},{merge:true});batch.set(refereeBoardRef,{state:refereeState,sessionDeviceId,updatedAt:serverTimestamp()},{merge:true});
  const write=batch.commit().catch(()=>setDoc(controlRef,{state:safe,refereeEmails:[...new Set(Object.values(state.refereeAssignments||{}))],sessionDeviceId,updatedAt:serverTimestamp()},{merge:true}));
  await trackWrite(write,'control');
}

export function watchAuth(callback) { return onAuthStateChanged(auth, async user => { if (!user) return callback(null); let allowed=false; try { allowed=await sessionLock.claim(user); } catch (_) { allowed=Boolean(sessionLock.localSession(user)) && navigator.onLine===false; } if (allowed) callback(user); }); }
export async function login(email, password) { await setPersistence(auth, browserLocalPersistence); return signInWithEmailAndPassword(auth, email, password); }
export async function createAccount(email, password, displayName = '') { const credential = await createUserWithEmailAndPassword(auth, email, password), normalizedEmail = String(email).trim().toLowerCase(), name = String(displayName || normalizedEmail.split('@')[0].replace(/[._-]+/g,' ')).trim(); await setDoc(doc(db,'tournamentUsers',credential.user.uid), { uid:credential.user.uid, displayName:name, email:normalizedEmail, accountStatus:'active', platformRole:'user', organizerStatus:'none', createdAt:serverTimestamp(), updatedAt:serverTimestamp() }); await setDoc(doc(db,'tournamentAccountDirectory',normalizedEmail), { uid:credential.user.uid,email:normalizedEmail,name,updatedAt:serverTimestamp() }); return credential; }
export async function logout() { await sessionLock.release(); return signOut(auth); }
export function watchSyncStatus(callback) { const listener=event=>callback(event.detail); window.addEventListener('matchday-sync-state',listener); callback({online:navigator.onLine!==false,pending:pendingWrites.size,label:navigator.onLine===false?`${pendingWrites.size} changes waiting to sync`:pendingWrites.size?`Syncing ${pendingWrites.size} changes…`:'All changes synced'}); return()=>window.removeEventListener('matchday-sync-state',listener); }
export async function uploadTournamentImage(file, kind = 'matchday') {
  if (!(file instanceof Blob) || !file.size) throw new Error('IMAGE_REQUIRED');
  if (file.size > 12 * 1024 * 1024) throw new Error('IMAGE_TOO_LARGE');
  const formData = new FormData();
  formData.append('file', file, `matchday-${kind}-${Date.now()}.${file.type.includes('webp') ? 'webp' : 'jpg'}`);
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
  formData.append('folder', `tournament-assets/${eventId}/${kind}`);
  formData.append('tags', `matchday,tournament,${eventId},${kind}`);
  const response = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, { method: 'POST', body: formData });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `IMAGE_UPLOAD_FAILED_${response.status}`);
  if (!payload?.secure_url) throw new Error('IMAGE_URL_MISSING');
  return payload.secure_url;
}
export async function updateEventConfiguration(config) {
  const [members, current] = await Promise.all([getDocs(membersRef), getDoc(controlRef)]), prior = current.data()?.metadata || {};
  const metadata = { ...prior, name:config.event.name, date:config.event.date, venue:config.event.venue, location:config.event.location, status:prior.status || 'private', archived:Boolean(prior.archived), primary:config.brand.primary, competitionType:config.competitionType || 'dual-meet' }, batch = writeBatch(db);
  batch.set(controlRef, { config:structuredClone(config), metadata, sessionDeviceId:sessionLock.deviceId(), updatedAt:serverTimestamp() }, { merge:true });
  members.docs.forEach(member => { const roles = roleList(member.data()).filter(role => EVENT_ROLES.includes(role)); batch.set(doc(db,'tournamentAccess',member.id,'events',eventId), { eventId, ...metadata, roles, role:primaryRole(roles), updatedAt:serverTimestamp() }, { merge:true }); });
  await batch.commit();
}
export async function setEventArchived(archived) {
  const [eventSnapshot, members] = await Promise.all([getDoc(controlRef), getDocs(membersRef)]);
  if (!eventSnapshot.exists()) throw new Error('EVENT_NOT_FOUND');
  const event = eventSnapshot.data(), date = event.config?.event?.date || event.metadata?.date || '', today = new Date().toISOString().slice(0,10), status = archived ? 'archived' : (date && date >= today ? 'upcoming' : 'completed');
  const metadata = { ...(event.metadata || {}), status, archived:Boolean(archived), archivedAt:archived ? new Date().toISOString() : null, competitionType:event.config?.competitionType || 'dual-meet' }, batch = writeBatch(db);
  batch.set(controlRef, { metadata, sessionDeviceId:sessionLock.deviceId(), updatedAt:serverTimestamp() }, { merge:true });
  members.docs.forEach(member => batch.set(doc(db,'tournamentAccess',member.id,'events',eventId), { eventId, status, archived:Boolean(archived), archivedAt:metadata.archivedAt, competitionType:metadata.competitionType, updatedAt:serverTimestamp() }, { merge:true }));
  await batch.commit();
  return metadata;
}
export async function getCurrentProfile(user) {
  if (!user) return null;
  const [profileSnapshot, tournamentSnapshot, membershipSnapshot] = await Promise.all([
    getDoc(doc(db, 'players', user.uid)),
    getDoc(doc(db, 'tournamentUsers', user.uid)).catch(() => null),
    getDoc(doc(membersRef, user.uid)).catch(() => null)
  ]);
  const legacyProfile = profileSnapshot.exists() ? profileSnapshot.data() : {}, tournamentProfile = tournamentSnapshot?.exists() ? tournamentSnapshot.data() : {}, profile = { ...legacyProfile, ...tournamentProfile };
  const membership = membershipSnapshot?.exists() ? membershipSnapshot.data() : {};
  const siteRoles = roleList(legacyProfile);
  const membershipRoles = roleList(membership).filter(role => EVENT_ROLES.includes(role));
  const legacyRoles = eventId === LEGACY_EVENT_ID ? siteRoles.filter(role => EVENT_ROLES.includes(role)) : [];
  const eventRoles = [...new Set([...membershipRoles, ...legacyRoles])];
  const isSiteAdmin = SUPER_ADMIN_EMAILS.includes(String(user.email || '').toLowerCase()) || siteRoles.includes('admin');
  const roles = [...new Set([...(isSiteAdmin ? ['admin'] : []), ...eventRoles])];
  return { id:user.uid, ...profile, eventMembership:membership, siteRoles, eventRoles, isSiteAdmin, roles, role:isSiteAdmin ? 'admin' : eventRoles[0] || tournamentProfile.platformRole || 'member' };
}
export async function authorizeTournamentTool(user, toolRoles = []) {
  const profile = await getCurrentProfile(user);
  const eventRoles = new Set(profile?.eventRoles || []);
  const allowed = Boolean(profile?.isSiteAdmin) || CONTROL_ROLES.some(role => eventRoles.has(role)) || toolRoles.some(role => eventRoles.has(role));
  return { allowed, profile, eventRoles };
}
export function watchControl(onData, onError) { return watchCollection(controlRef, onData, onError, snapshot => snapshot.exists() ? snapshot.data().state : null, true); }
export function watchMembership(userId, onData, onError) { return watchCollection(doc(membersRef,userId), onData, onError, snapshot => snapshot.exists() ? snapshot.data() : null, true); }
export function watchRefereeBoard(onData, onError) { return watchCollection(refereeBoardRef, onData, onError, snapshot => snapshot.exists() ? snapshot.data().state : null, true); }
export function watchMatches(onData, onError) { return watchCollection(matchesRef, onData, onError, snapshot => snapshot.docs.map(item => ({ id: item.id, ...item.data() })).filter(item=>!item.deleted)); }
export function watchRegistrations(onData, onError) { return watchCollection(registrationsRef, onData, onError, snapshot => snapshot.docs.map(item => ({ id: item.id, ...item.data() })).filter(item=>!item.deleted)); }
export function watchCheckins(onData, onError) { return watchCollection(checkinsRef, onData, onError, snapshot => snapshot.docs.map(item => ({ id: item.id, ...item.data() })).filter(item=>!item.deleted)); }
export function publishCheckin(id, data) {
  const safe = structuredClone(data);
  // Legacy base64 thumbnails are intentionally never written again. Existing
  // records remain readable as a fallback while new captures use photoURL.
  if (String(safe.photoThumb || '').startsWith('data:')) delete safe.photoThumb;
  if (!safe.photoURL && safe.photoThumb) safe.photoURL = safe.photoThumb;
  return trackWrite(setDoc(doc(checkinsRef, id), { ...safe, deleted:false, sessionDeviceId:sessionLock.deviceId(), updatedAt: serverTimestamp() }, { merge: true }), 'checkin');
}
export function deleteCheckin(id) { return trackWrite(setDoc(doc(checkinsRef, id), { deleted:true, sessionDeviceId:sessionLock.deviceId(), deletedAt:serverTimestamp(), updatedAt:serverTimestamp() }, { merge:true }), 'checkin-delete'); }
export function createRegistration(data) { const ref=doc(registrationsRef); return trackWrite(setDoc(ref, { ...structuredClone(data), sessionDeviceId:sessionLock.deviceId(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() }), 'registration').then(()=>ref); }
export function updateRegistration(id, data) { return trackWrite(setDoc(doc(registrationsRef, id), { ...structuredClone(data), deleted:false, sessionDeviceId:sessionLock.deviceId(), updatedAt: serverTimestamp() }, { merge:true }), 'registration'); }
export function deleteRegistration(id) { return trackWrite(setDoc(doc(registrationsRef, id), { deleted:true, status:'withdrawn', sessionDeviceId:sessionLock.deviceId(), deletedAt:serverTimestamp(), updatedAt:serverTimestamp() }, { merge:true }), 'registration-delete'); }
export async function listTournamentStaff() {
  const snapshot = await getDocs(membersRef);
  return snapshot.docs.map(item => ({ id:item.id, ...item.data(), firstName:item.data().firstName || item.data().name || '', lastName:item.data().lastName || '' }));
}
export async function changeTournamentStaffRole(email, role, enabled) {
  email = String(email || '').trim().toLowerCase();
  const [directorySnap,eventSnap] = await Promise.all([getDoc(doc(db,'tournamentAccountDirectory',email)),getDoc(controlRef)]);
  if (!directorySnap.exists()) throw new Error('NO_ACCOUNT');
  const person = directorySnap.data(), targetRef = doc(membersRef,person.uid), accessRef = doc(db,'tournamentAccess',person.uid,'events',eventId), targetSnap = await getDoc(targetRef), roles = new Set(roleList(targetSnap.exists() ? targetSnap.data() : {}).filter(item => EVENT_ROLES.includes(item))), event = eventSnap.data();
  enabled ? roles.add(role) : roles.delete(role);
  const batch = writeBatch(db), metadata = event.metadata || {};
  if (roles.size) {
    batch.set(targetRef,{uid:person.uid,email,name:person.name||email,firstName:person.firstName||'',lastName:person.lastName||'',roles:[...roles],updatedAt:serverTimestamp()},{merge:true});
    const roleValues = [...roles];
    batch.set(accessRef,{eventId,name:metadata.name||event.config?.event?.name||eventId,date:metadata.date||event.config?.event?.date||'',venue:metadata.venue||event.config?.event?.venue||'',location:metadata.location||event.config?.event?.location||'',status:metadata.status||'private',primary:event.config?.brand?.primary||'#06658c',roles:roleValues,role:primaryRole(roleValues),updatedAt:serverTimestamp()},{merge:true});
    batch.update(controlRef,{memberIds:arrayUnion(person.uid),sessionDeviceId:sessionLock.deviceId(),updatedAt:serverTimestamp(),...(role==='tournament_referee'?{refereeEmails:enabled?arrayUnion(email):arrayRemove(email)}:{})});
  } else {
    batch.delete(targetRef); batch.delete(accessRef); batch.update(controlRef,{memberIds:arrayRemove(person.uid),refereeEmails:arrayRemove(email),sessionDeviceId:sessionLock.deviceId(),updatedAt:serverTimestamp()});
  }
  await batch.commit(); return {ok:true,uid:person.uid,roles:[...roles]};
}
export async function publishControl(state) {
  return new Promise((resolve, reject) => {
    controlWriteState.pending = structuredClone(state);
    controlWriteState.waiters.push({ resolve, reject });
    // Coalesce same-turn control changes without delaying a normal interaction.
    clearTimeout(controlWriteState.timer);
    controlWriteState.timer = setTimeout(flushControlWrite, CONTROL_WRITE_DELAY);
  });
}
export async function publishMatch(matchId, live, score) {
  const safeScore = score ? structuredClone(score) : null;
  if (safeScore?.confirmation) { safeScore.confirmation.ocpcSigned = Boolean(safeScore.confirmation.ocpcSignature); safeScore.confirmation.rebelsSigned = Boolean(safeScore.confirmation.rebelsSignature); delete safeScore.confirmation.ocpcSignature; delete safeScore.confirmation.rebelsSignature; }
  let state = matchWriteStates.get(matchId);
  if (!state) { state = { timer:null, pending:null, waiters:[] }; matchWriteStates.set(matchId, state); }
  return new Promise((resolve, reject) => {
    state.pending = { live: structuredClone(live), score: safeScore };
    state.waiters.push({ resolve, reject });
    clearTimeout(state.timer);
    state.timer = setTimeout(async () => {
      const pending = state.pending; state.pending = null; state.timer = null;
      try {
        await trackWrite(setDoc(doc(matchesRef, matchId), { ...pending, deleted:false, sessionDeviceId:sessionLock.deviceId(), updatedAt: serverTimestamp() }, { merge: true }), 'match');
        settleWaiters(state);
      } catch (error) { settleWaiters(state, error); }
      if (!state.pending && !state.waiters.length) matchWriteStates.delete(matchId);
    }, MATCH_WRITE_DELAY);
  });
}
export function publishPublicView(token, payload) { const sanitized=JSON.parse(JSON.stringify(payload)); return trackWrite(setDoc(doc(db,'tournamentPublicViews',token), { ...sanitized, eventId, active:true, revoked:false, updatedAt:serverTimestamp() }), 'public-view'); }
export function revokePublicView(token) { return token ? updateDoc(doc(db,'tournamentPublicViews',token), { active:false, revoked:true, revokedAt:serverTimestamp() }) : Promise.resolve(); }
export function requestMatchPromotion(matchId, courtNo, refereeEmail) {
  return trackWrite(setDoc(doc(matchesRef, matchId), { promotionRequest: { courtNo: Number(courtNo), refereeEmail: String(refereeEmail || '').trim().toLowerCase(), requestedAt: serverTimestamp() }, deleted:false, sessionDeviceId:sessionLock.deviceId(), updatedAt:serverTimestamp() }, { merge:true }), 'promotion');
}
export function clearMatchPromotion(matchId) {
  return trackWrite(updateDoc(doc(matchesRef, matchId), { promotionRequest: null, sessionDeviceId:sessionLock.deviceId(), updatedAt: serverTimestamp() }), 'promotion-clear');
}
export function deleteMatch(matchId) { return trackWrite(setDoc(doc(matchesRef, matchId), { deleted:true, live:null, score:null, promotionRequest:null, sessionDeviceId:sessionLock.deviceId(), deletedAt:serverTimestamp(), updatedAt:serverTimestamp() }, { merge:true }), 'match-delete'); }
export async function clearMatches() {
  const snapshot = await getDocs(matchesRef);
  for (let offset = 0; offset < snapshot.docs.length; offset += 450) {
    const batch = writeBatch(db);
    snapshot.docs.slice(offset, offset + 450).forEach(item => batch.set(item.ref,{deleted:true,live:null,score:null,promotionRequest:null,sessionDeviceId:sessionLock.deviceId(),deletedAt:serverTimestamp(),updatedAt:serverTimestamp()},{merge:true}));
    await trackWrite(batch.commit(),'matches-clear');
  }
}
export async function clearCheckins() {
  const snapshot = await getDocs(checkinsRef), batch = writeBatch(db); snapshot.docs.forEach(item => batch.set(item.ref,{deleted:true,sessionDeviceId:sessionLock.deviceId(),deletedAt:serverTimestamp(),updatedAt:serverTimestamp()},{merge:true})); if (!snapshot.empty) await trackWrite(batch.commit(),'checkins-clear');
}

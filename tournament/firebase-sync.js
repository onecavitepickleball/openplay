import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, setPersistence, browserLocalPersistence } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';
import { getFirestore, doc, collection, query, where, onSnapshot, setDoc, addDoc, updateDoc, getDoc, getDocs, writeBatch, deleteDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyBQYKgSchzlmtIGsIhf68e8OYt7Y8kY7Vo', authDomain: 'ocpc-website-faf5e.firebaseapp.com', projectId: 'ocpc-website-faf5e', storageBucket: 'ocpc-website-faf5e.firebasestorage.app', messagingSenderId: '15833259684', appId: '1:15833259684:web:0f2f4400f9995517ae5031'
};
const eventId = window.TOURNAMENT_CONFIG.firebaseEventId;
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app), db = getFirestore(app), controlRef = doc(db, 'tournamentEvents', eventId), refereeBoardRef = doc(db, 'tournamentRefereeBoards', eventId), matchesRef = collection(db, 'tournamentEvents', eventId, 'matches'), registrationsRef = collection(db, 'tournamentEvents', eventId, 'registrations'), checkinsRef = collection(db, 'tournamentEvents', eventId, 'checkins');

export function watchAuth(callback) { return onAuthStateChanged(auth, callback); }
export async function login(email, password) { await setPersistence(auth, browserLocalPersistence); return signInWithEmailAndPassword(auth, email, password); }
export async function createAccount(email, password) { const credential = await createUserWithEmailAndPassword(auth, email, password); const local = String(email).split('@')[0].replace(/[._-]+/g,' ').trim().split(/\s+/); await setDoc(doc(db,'players',credential.user.uid), { firstName: local[0] || 'Tournament', lastName: local.slice(1).join(' ') || 'Referee', email: String(email).trim().toLowerCase(), status: 'pending', sessionsAttended: 0, createdAt: serverTimestamp() }); return credential; }
export function logout() { return signOut(auth); }
export async function getCurrentProfile(user) { if (!user) return null; const snapshot = await getDoc(doc(db, 'players', user.uid)); return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null; }
export function watchControl(onData, onError) { return onSnapshot(controlRef, snapshot => onData(snapshot.exists() ? snapshot.data().state : null), onError); }
export function watchRefereeBoard(onData, onError) { return onSnapshot(refereeBoardRef, snapshot => onData(snapshot.exists() ? snapshot.data().state : null), onError); }
export function watchMatches(onData, onError) { return onSnapshot(matchesRef, snapshot => onData(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))), onError); }
export function watchRegistrations(onData, onError) { return onSnapshot(registrationsRef, snapshot => onData(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))), onError); }
export function watchCheckins(onData, onError) { return onSnapshot(checkinsRef, snapshot => onData(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))), onError); }
export function publishCheckin(id, data) { return setDoc(doc(checkinsRef, id), { ...structuredClone(data), updatedAt: serverTimestamp() }, { merge: true }); }
export function deleteCheckin(id) { return deleteDoc(doc(checkinsRef, id)); }
export function createRegistration(data) { return addDoc(registrationsRef, { ...structuredClone(data), createdAt: serverTimestamp(), updatedAt: serverTimestamp() }); }
export function updateRegistration(id, data) { return updateDoc(doc(registrationsRef, id), { ...structuredClone(data), updatedAt: serverTimestamp() }); }
export function deleteRegistration(id) { return deleteDoc(doc(registrationsRef, id)); }
export async function listTournamentStaff() {
  const snapshot = await getDocs(collection(db, 'players'));
  const allowed = ['match_control', 'tournament_registration', 'tournament_checkin', 'tournament_score_desk', 'tournament_referee'];
  return snapshot.docs.map(item => ({ id: item.id, ...item.data() })).filter(player => (Array.isArray(player.roles) ? player.roles : [player.role].filter(Boolean)).some(role => allowed.includes(role)));
}
export async function changeTournamentStaffRole(email, role, enabled) {
  const normalized = String(email || '').trim().toLowerCase();
  const snapshot = await getDocs(query(collection(db, 'players'), where('email', '==', normalized)));
  if (snapshot.empty) throw new Error('NO_ACCOUNT');
  const player = snapshot.docs[0], data = player.data(), roles = new Set(Array.isArray(data.roles) ? data.roles : [data.role].filter(Boolean));
  enabled ? roles.add(role) : roles.delete(role);
  await updateDoc(player.ref, { roles: [...roles], role: roles.has('admin') ? 'admin' : [...roles][0] || 'member' });
}
export async function publishControl(state) {
  const safe = structuredClone(state); delete safe.liveScoring;
  Object.values(safe.checkins || {}).forEach(player => delete player.photo);
  Object.values(safe.scores || {}).forEach(score => { if (score.confirmation) { delete score.confirmation.ocpcSignature; delete score.confirmation.rebelsSignature; } });
  const refereeState = { matches:safe.matches || [], pairs:safe.pairs || {}, courts:safe.courts || {}, scores:safe.scores || {}, matchSettings:safe.matchSettings || {}, refereeAssignments:safe.refereeAssignments || {}, updatedAt:safe.updatedAt || new Date().toISOString() };
  await setDoc(controlRef, { state: safe, refereeEmails: [...new Set(Object.values(state.refereeAssignments || {}))], updatedAt: serverTimestamp() }, { merge: true });
  try { await setDoc(refereeBoardRef, { state: refereeState, updatedAt: serverTimestamp() }, { merge: true }); } catch (_) { /* Limited desks may update their permitted event fields without publishing the referee overview. */ }
}
export async function publishMatch(matchId, live, score) {
  const safeScore = score ? structuredClone(score) : null;
  if (safeScore?.confirmation) { safeScore.confirmation.ocpcSigned = Boolean(safeScore.confirmation.ocpcSignature); safeScore.confirmation.rebelsSigned = Boolean(safeScore.confirmation.rebelsSignature); delete safeScore.confirmation.ocpcSignature; delete safeScore.confirmation.rebelsSignature; }
  await setDoc(doc(matchesRef, matchId), { live: structuredClone(live), score: safeScore, updatedAt: serverTimestamp() }, { merge: true });
}
export function deleteMatch(matchId) { return deleteDoc(doc(matchesRef, matchId)); }
export async function clearMatches() {
  const snapshot = await getDocs(matchesRef);
  for (let offset = 0; offset < snapshot.docs.length; offset += 450) {
    const batch = writeBatch(db);
    snapshot.docs.slice(offset, offset + 450).forEach(item => batch.delete(item.ref));
    await batch.commit();
  }
}
export async function clearCheckins() {
  const snapshot = await getDocs(checkinsRef), batch = writeBatch(db); snapshot.docs.forEach(item => batch.delete(item.ref)); if (!snapshot.empty) await batch.commit();
}

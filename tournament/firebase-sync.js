import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';
import { getFirestore, doc, collection, onSnapshot, setDoc, getDocs, writeBatch, deleteDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyBQYKgSchzlmtIGsIhf68e8OYt7Y8kY7Vo', authDomain: 'ocpc-website-faf5e.firebaseapp.com', projectId: 'ocpc-website-faf5e', storageBucket: 'ocpc-website-faf5e.firebasestorage.app', messagingSenderId: '15833259684', appId: '1:15833259684:web:0f2f4400f9995517ae5031'
};
const eventId = window.TOURNAMENT_CONFIG.firebaseEventId;
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app), db = getFirestore(app), controlRef = doc(db, 'tournamentEvents', eventId), matchesRef = collection(db, 'tournamentEvents', eventId, 'matches');

export function watchAuth(callback) { return onAuthStateChanged(auth, callback); }
export function login(email, password) { return signInWithEmailAndPassword(auth, email, password); }
export function logout() { return signOut(auth); }
export function watchControl(onData, onError) { return onSnapshot(controlRef, snapshot => onData(snapshot.exists() ? snapshot.data().state : null), onError); }
export function watchMatches(onData, onError) { return onSnapshot(matchesRef, snapshot => onData(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))), onError); }
export async function publishControl(state) {
  const safe = structuredClone(state); delete safe.liveScoring;
  Object.values(safe.checkins || {}).forEach(player => delete player.photo);
  Object.values(safe.scores || {}).forEach(score => { if (score.confirmation) { delete score.confirmation.ocpcSignature; delete score.confirmation.rebelsSignature; } });
  await setDoc(controlRef, { state: safe, refereeEmails: [...new Set(Object.values(state.refereeAssignments || {}))], updatedAt: serverTimestamp() }, { merge: true });
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

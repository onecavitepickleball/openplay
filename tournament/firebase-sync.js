import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, setPersistence, browserLocalPersistence } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';
import { getFirestore, doc, collection, onSnapshot, setDoc, addDoc, updateDoc, getDoc, getDocs, writeBatch, deleteDoc, serverTimestamp, arrayUnion, arrayRemove } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyBQYKgSchzlmtIGsIhf68e8OYt7Y8kY7Vo', authDomain: 'ocpc-website-faf5e.firebaseapp.com', projectId: 'ocpc-website-faf5e', storageBucket: 'ocpc-website-faf5e.firebasestorage.app', messagingSenderId: '15833259684', appId: '1:15833259684:web:0f2f4400f9995517ae5031'
};
const eventId = window.TOURNAMENT_CONFIG.firebaseEventId;
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app), db = getFirestore(app), controlRef = doc(db, 'tournamentEvents', eventId), membersRef = collection(controlRef, 'members'), refereeBoardRef = doc(db, 'tournamentRefereeBoards', eventId), matchesRef = collection(db, 'tournamentEvents', eventId, 'matches'), registrationsRef = collection(db, 'tournamentEvents', eventId, 'registrations'), checkinsRef = collection(db, 'tournamentEvents', eventId, 'checkins');

export function watchAuth(callback) { return onAuthStateChanged(auth, callback); }
export async function login(email, password) { await setPersistence(auth, browserLocalPersistence); return signInWithEmailAndPassword(auth, email, password); }
export async function createAccount(email, password) { const credential = await createUserWithEmailAndPassword(auth, email, password); const local = String(email).split('@')[0].replace(/[._-]+/g,' ').trim().split(/\s+/); await setDoc(doc(db,'players',credential.user.uid), { firstName: local[0] || 'Tournament', lastName: local.slice(1).join(' ') || 'Referee', email: String(email).trim().toLowerCase(), status: 'pending', sessionsAttended: 0, createdAt: serverTimestamp() }); return credential; }
export function logout() { return signOut(auth); }
export async function updateEventConfiguration(config) { const metadata = { name:config.event.name, date:config.event.date, venue:config.event.venue, location:config.event.location, status:'private', primary:config.brand.primary }, members = await getDocs(membersRef), batch = writeBatch(db); batch.set(controlRef, { config:structuredClone(config), metadata, updatedAt:serverTimestamp() }, { merge:true }); members.docs.forEach(member => batch.set(doc(db,'tournamentAccess',member.id,'events',eventId), { eventId, ...metadata, role:(member.data().roles || [])[0] || 'staff', updatedAt:serverTimestamp() }, { merge:true })); await batch.commit(); }
export async function getCurrentProfile(user) { if (!user) return null; const [profileSnapshot, membershipSnapshot] = await Promise.all([getDoc(doc(db, 'players', user.uid)), getDoc(doc(membersRef, user.uid)).catch(() => null)]), profile = profileSnapshot.exists() ? profileSnapshot.data() : {}, membership = membershipSnapshot?.exists() ? membershipSnapshot.data() : {}, roles = [...new Set([...(Array.isArray(profile.roles) ? profile.roles : [profile.role].filter(Boolean)), ...(Array.isArray(membership.roles) ? membership.roles : [membership.role].filter(Boolean))])]; return { id:user.uid, ...profile, eventMembership:membership, roles, role:roles.includes('admin') ? 'admin' : roles[0] || 'member' }; }
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
  const snapshot = await getDocs(membersRef);
  return snapshot.docs.map(item => ({ id:item.id, ...item.data(), firstName:item.data().firstName || item.data().name || '', lastName:item.data().lastName || '' }));
}
export async function changeTournamentStaffRole(email, role, enabled) {
  email = String(email || '').trim().toLowerCase();
  const [directorySnap,eventSnap] = await Promise.all([getDoc(doc(db,'tournamentAccountDirectory',email)),getDoc(controlRef)]);
  if (!directorySnap.exists()) throw new Error('NO_ACCOUNT');
  const person = directorySnap.data(), targetRef = doc(membersRef,person.uid), accessRef = doc(db,'tournamentAccess',person.uid,'events',eventId), targetSnap = await getDoc(targetRef), roles = new Set(targetSnap.exists() ? targetSnap.data().roles || [] : []), event = eventSnap.data();
  enabled ? roles.add(role) : roles.delete(role);
  const batch = writeBatch(db), metadata = event.metadata || {};
  if (roles.size) {
    batch.set(targetRef,{uid:person.uid,email,name:person.name||email,firstName:person.firstName||'',lastName:person.lastName||'',roles:[...roles],updatedAt:serverTimestamp()},{merge:true});
    batch.set(accessRef,{eventId,name:metadata.name||event.config?.event?.name||eventId,date:metadata.date||event.config?.event?.date||'',venue:metadata.venue||event.config?.event?.venue||'',location:metadata.location||event.config?.event?.location||'',status:metadata.status||'private',primary:event.config?.brand?.primary||'#06658c',role:[...roles][0],updatedAt:serverTimestamp()},{merge:true});
    batch.update(controlRef,{memberIds:arrayUnion(person.uid),updatedAt:serverTimestamp(),...(role==='tournament_referee'?{refereeEmails:enabled?arrayUnion(email):arrayRemove(email)}:{})});
  } else {
    batch.delete(targetRef); batch.delete(accessRef); batch.update(controlRef,{memberIds:arrayRemove(person.uid),refereeEmails:arrayRemove(email),updatedAt:serverTimestamp()});
  }
  await batch.commit(); return {ok:true,uid:person.uid,roles:[...roles]};
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
export function requestMatchPromotion(matchId, courtNo, refereeEmail) {
  return setDoc(doc(matchesRef, matchId), { promotionRequest: { courtNo: Number(courtNo), refereeEmail: String(refereeEmail || '').trim().toLowerCase(), requestedAt: serverTimestamp() }, updatedAt: serverTimestamp() }, { merge: true });
}
export function clearMatchPromotion(matchId) {
  return updateDoc(doc(matchesRef, matchId), { promotionRequest: null, updatedAt: serverTimestamp() });
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

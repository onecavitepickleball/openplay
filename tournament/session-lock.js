const DEVICE_KEY = 'matchday.deviceId';
const SESSION_KEY = 'matchday.activeSession';
const LEASE_MS = 12 * 60 * 60 * 1000;
const HEARTBEAT_MS = 30 * 1000;
const CLAIM_TIMEOUT_MS = 10000;

function deviceId() {
  let value = localStorage.getItem(DEVICE_KEY);
  if (!value) {
    value = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(DEVICE_KEY, value);
  }
  return value;
}

function deviceLabel() {
  const platform = navigator.userAgentData?.platform || navigator.platform || 'Device';
  const mobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? 'Mobile' : 'Computer';
  return `${platform} ${mobile}`.trim();
}

function localSession(user) {
  try {
    const value = JSON.parse(localStorage.getItem(SESSION_KEY));
    return value?.uid === user?.uid && value?.deviceId === deviceId() ? value : null;
  } catch (_) { return null; }
}

function saveLocal(user) {
  const value = { uid:user.uid, deviceId:deviceId(), deviceLabel:deviceLabel(), claimedAt:Date.now() };
  localStorage.setItem(SESSION_KEY, JSON.stringify(value));
  return value;
}

function overlay() {
  let root = document.getElementById('matchdaySessionLock');
  if (root) return root;
  root = document.createElement('div');
  root.id = 'matchdaySessionLock';
  root.hidden = true;
  root.innerHTML = `<section role="dialog" aria-modal="true" aria-labelledby="matchdaySessionTitle"><span>MATCHDAY DEVICE SECURITY</span><h2 id="matchdaySessionTitle">This account is active on another device.</h2><p id="matchdaySessionMessage"></p><div><button type="button" data-session-takeover>Take over on this device</button><button type="button" class="quiet" data-session-signout>Sign out</button></div><small>Taking over makes the previous online device read-only. Unsynced work on an offline device is retained for recovery and is not silently overwritten.</small></section>`;
  const style = document.createElement('style');
  style.textContent = `#matchdaySessionLock{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:24px;background:rgba(3,27,40,.82);backdrop-filter:blur(10px)}#matchdaySessionLock[hidden]{display:none}#matchdaySessionLock section{width:min(520px,100%);padding:30px;border-radius:24px;background:#fff;color:#09283a;box-shadow:0 24px 80px #00131faa;border-top:7px solid #0a75a8;font-family:Inter,system-ui,sans-serif}#matchdaySessionLock span{font:800 11px/1.2 monospace;letter-spacing:.12em;color:#0874a7}#matchdaySessionLock h2{margin:10px 0;font-size:28px;line-height:1.05}#matchdaySessionLock p,#matchdaySessionLock small{color:#607480;line-height:1.55}#matchdaySessionLock div{display:flex;gap:10px;margin:22px 0 14px}#matchdaySessionLock button{flex:1;border:0;border-radius:11px;padding:13px;background:#086593;color:#fff;font-weight:850;cursor:pointer}#matchdaySessionLock button.quiet{background:#eaf1f4;color:#173a4d}`;
  document.head.appendChild(style);
  document.body.appendChild(root);
  return root;
}

export function createSessionLock({ db, auth, doc, onSnapshot, runTransaction, setDoc, deleteDoc, serverTimestamp, signOut }) {
  let stop = null, heartbeat = null, user = null, lost = false;
  const refFor = current => doc(db, 'tournamentUserSessions', current.uid);
  const payload = current => ({ uid:current.uid, email:String(current.email || '').toLowerCase(), deviceId:deviceId(), deviceLabel:deviceLabel(), active:true, leaseUntilMs:Date.now() + LEASE_MS, lastSeenAt:serverTimestamp(), updatedAt:serverTimestamp() });

  async function claim(current, force = false) {
    let timeout;
    const attempt = { expired:false };
    try {
      return await Promise.race([
        claimDevice(current, force, attempt),
        new Promise((_, reject) => { timeout=setTimeout(() => {
          attempt.expired=true;
          reject(new Error('SESSION_CHECK_TIMEOUT'));
        }, CLAIM_TIMEOUT_MS); })
      ]);
    } catch (error) {
      console.error('Matchday device verification failed.', error);
      // A lease check is an additional safeguard, not an authentication
      // requirement. Firestore can briefly be unavailable while Auth has
      // already completed successfully. Keep a valid signed-in user moving
      // into the app, while preserving the hard block returned by an actual
      // active-device conflict below.
      if (navigator.onLine !== false) {
        saveLocal(current);
        return true;
      }
      showUnavailable(error);
      return false;
    } finally { clearTimeout(timeout); }
  }

  async function claimDevice(current, force, attempt) {
    user = current;
    if (navigator.onLine === false) {
      if (localSession(current)) { beginWatch(); return true; }
      const root=overlay();
      root.querySelector('#matchdaySessionTitle').textContent='Connect once before using Matchday offline.';
      root.querySelector('#matchdaySessionMessage').textContent='This device has not yet been authorized as the active Matchday device for this account. Reconnect, open the Tournament Portal once, then this device can reopen cached tournaments offline.';
      const retry=root.querySelector('[data-session-takeover]');retry.textContent='Retry connection';retry.onclick=()=>{if(navigator.onLine!==false)location.reload()};
      root.querySelector('[data-session-signout]').onclick=async()=>{await signOut(auth);location.href='/tournament/'};
      root.hidden=false;
      return false;
    }
    const ref = refFor(current);
    const result = await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(ref), existing = snapshot.exists() ? snapshot.data() : null;
      if (attempt.expired) throw new Error('SESSION_CHECK_TIMEOUT');
      const activeElsewhere = existing?.deviceId && existing.deviceId !== deviceId() && Number(existing.leaseUntilMs || 0) > Date.now();
      if (activeElsewhere && !force) return { allowed:false, existing };
      transaction.set(ref, payload(current), { merge:true });
      return { allowed:true, existing };
    });
    if (attempt.expired) throw new Error('SESSION_CHECK_TIMEOUT');
    if (!result.allowed) return showConflict(current, result.existing);
    saveLocal(current); lost = false; overlay().hidden = true; beginWatch(); return true;
  }

  function beginWatch() {
    clearInterval(heartbeat); stop?.();
    if (!user) return;
    stop = onSnapshot(refFor(user), snapshot => {
      const value = snapshot.data();
      if (value?.deviceId && value.deviceId !== deviceId()) {
        lost = true;
        showLost(value);
        window.dispatchEvent(new CustomEvent('matchday-session-lost', { detail:value }));
      }
    }, error => {
      // Do not freeze a live tournament simply because the passive device
      // watcher reconnects. Operational reads/writes retain their normal
      // Firestore error handling and the next signed-in load reclaims the
      // lease.
      console.warn('Matchday device watcher deferred.', error);
    });
    heartbeat = setInterval(() => {
      if (!user || lost || navigator.onLine === false) return;
      runTransaction(db,async transaction=>{const ref=refFor(user),snapshot=await transaction.get(ref),current=snapshot.data();if(current?.deviceId&&current.deviceId!==deviceId())throw Object.assign(new Error('SESSION_TAKEN_OVER'),{current});transaction.set(ref,payload(user),{merge:true})}).catch(error=>{if(error?.message==='SESSION_TAKEN_OVER'){lost=true;showLost(error.current);window.dispatchEvent(new CustomEvent('matchday-session-lost',{detail:error.current}))}});
    }, HEARTBEAT_MS);
  }

  function showUnavailable(error) {
    const root=overlay();
    root.querySelector('#matchdaySessionTitle').textContent='Your sign-in succeeded. Device access needs a retry.';
    root.querySelector('#matchdaySessionMessage').textContent=error?.code==='permission-denied'
      ? 'We could not verify your device access. Retry, or return to My Tournaments. Your tournament data has not been changed.'
      : 'The connection interrupted device verification. Retry when connected, or return to My Tournaments.';
    const retry=root.querySelector('[data-session-takeover]');
    retry.disabled=false; retry.textContent='Retry device access'; retry.onclick=()=>location.reload();
    const back=root.querySelector('[data-session-signout]');
    back.textContent='My Tournaments'; back.onclick=()=>{location.href='/tournament/'};
    root.hidden=false;
  }

  function showLost(existing) {
    const root = overlay();
    root.querySelector('#matchdaySessionTitle').textContent = 'This device is now read-only.';
    root.querySelector('#matchdaySessionMessage').textContent = `${existing?.deviceLabel || 'Another device'} took control of this account. Take control back only if that device is no longer being used.`;
    bindButtons(root);
    root.hidden = false;
  }

  function showConflict(current, existing) {
    const root = overlay();
    root.querySelector('#matchdaySessionTitle').textContent = 'This account is active on another device.';
    root.querySelector('#matchdaySessionMessage').textContent = `${existing?.deviceLabel || 'Another device'} currently owns this Matchday session. You may take over, but first confirm that device is no longer recording tournament activity.`;
    bindButtons(root, current);
    root.hidden = false;
    return false;
  }

  function bindButtons(root, current = user) {
    const takeover=root.querySelector('[data-session-takeover]');
    takeover.disabled=false; takeover.textContent='Take over on this device';
    root.querySelector('[data-session-signout]').textContent='Sign out';
    root.querySelector('[data-session-takeover]').onclick = async () => {
      const button = root.querySelector('[data-session-takeover]');
      button.disabled = true; button.textContent = 'Taking control…';
      try { if (await claim(current, true)) location.reload(); }
      catch (_) { button.disabled = false; button.textContent = 'Try takeover again'; }
    };
    root.querySelector('[data-session-signout]').onclick = async () => { await release(false); await signOut(auth); location.href = new URL('./', location.origin + '/tournament/').href; };
  }

  async function release(removeRemote = true) {
    clearInterval(heartbeat); stop?.(); heartbeat = null; stop = null;
    user = user || auth.currentUser;
    const local = user && localSession(user);
    localStorage.removeItem(SESSION_KEY);
    if (removeRemote && user && local && navigator.onLine !== false) {
      try {
        await runTransaction(db, async transaction => {
          const ref = refFor(user), snapshot = await transaction.get(ref);
          if (snapshot.data()?.deviceId === deviceId()) transaction.set(ref, { ...payload(user), active:false, leaseUntilMs:0, releasedAt:serverTimestamp() }, { merge:true });
        });
      } catch (_) { /* The lease will expire naturally. */ }
    }
  }

  return { claim, release, deviceId, localSession };
}

// Push notification opt-in. Called from the profile page when a signed-in
// member clicks "Enable Notifications". Requests browser permission, grabs
// an FCM token, and stores it on the player's own doc so admin.html can
// send to it later via the sendPush Cloud Function.
//
// NOTE: replace VAPID_KEY below with the real "Web Push certificate" key
// from Firebase Console -> Project Settings -> Cloud Messaging -> Web
// configuration -> Generate key pair. Push won't work until that's set.
const VAPID_KEY = 'REPLACE_WITH_FIREBASE_WEB_PUSH_VAPID_KEY';

window.OCPCPush = (function () {
  async function subscribe(app, db, uid) {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      return { ok: false, reason: 'unsupported' };
    }
    if (VAPID_KEY.startsWith('REPLACE_WITH')) {
      return { ok: false, reason: 'not_configured' };
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return { ok: false, reason: 'denied' };

    try {
      const { getMessaging, getToken } = await import('https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging.js');
      const { doc, updateDoc, arrayUnion } = await import('https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js');

      const registration = await navigator.serviceWorker.register('/sw.js');
      const messaging = getMessaging(app);
      const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
      if (!token) return { ok: false, reason: 'no_token' };

      await updateDoc(doc(db, 'players', uid), { fcmTokens: arrayUnion(token) });
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: 'error', error: err };
    }
  }

  return { subscribe };
})();

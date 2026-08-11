// Callable Cloud Function so admin.html can trigger a push notification.
// Requires the Blaze (pay-as-you-go) plan to deploy; see the deploy notes
// in the project README / commit message for setup steps.
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

admin.initializeApp();

const SUPER_ADMIN_EMAILS = ["ocpc.pickleball@gmail.com", "jamescastillo37@gmail.com"];

async function callerIsAdmin(auth) {
  if (!auth) return false;
  if (SUPER_ADMIN_EMAILS.includes(auth.token.email)) return true;
  const snap = await admin.firestore().doc(`players/${auth.uid}`).get();
  if (!snap.exists) return false;
  const data = snap.data();
  const roles = Array.isArray(data.roles) ? data.roles : (data.role ? [data.role] : []);
  return roles.includes("admin");
}

exports.sendPush = onCall(async (request) => {
  const isAdmin = await callerIsAdmin(request.auth);
  if (!isAdmin) {
    throw new HttpsError("permission-denied", "Admin access required.");
  }

  const title = String(request.data.title || "").trim();
  const body = String(request.data.body || "").trim();
  const url = String(request.data.url || "/").trim();
  if (!title || !body) {
    throw new HttpsError("invalid-argument", "Title and body are required.");
  }

  const playersSnap = await admin.firestore().collection("players").get();
  const tokens = [];
  playersSnap.forEach((doc) => {
    const t = doc.data().fcmTokens;
    if (Array.isArray(t)) tokens.push(...t);
  });

  if (tokens.length === 0) {
    return { sent: 0, failed: 0, invalidTokens: 0 };
  }

  const response = await admin.messaging().sendEachForMulticast({
    tokens,
    notification: { title, body },
    data: { url },
  });

  // Clean up tokens that are no longer valid (uninstalled, permission
  // revoked, etc.) so the token list doesn't grow stale forever.
  const invalidTokens = [];
  response.responses.forEach((r, i) => {
    if (!r.success && ["messaging/registration-token-not-registered", "messaging/invalid-registration-token"].includes(r.error && r.error.code)) {
      invalidTokens.push(tokens[i]);
    }
  });
  if (invalidTokens.length) {
    const batch = admin.firestore().batch();
    playersSnap.forEach((doc) => {
      const t = doc.data().fcmTokens || [];
      const remaining = t.filter((tok) => !invalidTokens.includes(tok));
      if (remaining.length !== t.length) {
        batch.update(doc.ref, { fcmTokens: remaining });
      }
    });
    await batch.commit();
  }

  return { sent: response.successCount, failed: response.failureCount, invalidTokens: invalidTokens.length };
});

// Callable Cloud Function so admin.html can trigger a push notification.
// Requires the Blaze (pay-as-you-go) plan to deploy; see the deploy notes
// in the project README / commit message for setup steps.
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const { google } = require("googleapis");

admin.initializeApp();

const SUPER_ADMIN_EMAILS = ["ocpc.pickleball@gmail.com", "jamescastillo37@gmail.com"];
const TOURNAMENT_EVENT_ID = "ocpc-rally-rebels-dual-meet-2026";
const TOURNAMENT_SHEET_ID = "1ZWQ2kf2PJnVhSkriRgdB5mYfFcsW3M0QAEmJSG0F1Ec";
const BACKUP_SHEETS = ["Sync Control", "Live Schedule", "Pair Setup", "Standings", "Medal Matches", "Check-ins", "Referees"];

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

function pairName(state, category, code) {
  const pair = (state.pairs || {})[`${category}|${code}`] || {};
  return [pair.player1, pair.player2].filter(Boolean).join(" / ") || "Players not assigned";
}

function standingsFor(state, category, clubId) {
  const prefix = clubId === "ocpc" ? "O" : "R";
  const count = Number((state.pairCounts || {})[category]) || 0;
  return Array.from({ length: count }, (_, index) => {
    const code = `${prefix}${index + 1}`;
    let played = 0, wins = 0, pointsFor = 0, pointsAgainst = 0;
    (state.matches || []).filter(match => match.category === category && (clubId === "ocpc" ? match.a === code : match.b === code)).forEach(match => {
      const score = (state.scores || {})[match.id];
      if (!score || score.a === "" || score.b === "") return;
      const own = Number(clubId === "ocpc" ? score.a : score.b), against = Number(clubId === "ocpc" ? score.b : score.a);
      played++; pointsFor += own; pointsAgainst += against; if (own > against) wins++;
    });
    return { code, names: pairName(state, category, code), played, wins, losses: played - wins, pointsFor, pointsAgainst, diff: pointsFor - pointsAgainst };
  }).sort((a, b) => b.wins - a.wins || b.diff - a.diff || b.pointsFor - a.pointsFor || a.code.localeCompare(b.code));
}

function backupTables(state, matchesById) {
  const categories = Object.keys(state.pairCounts || {});
  const schedule = [["Match ID", "Planned time", "Planned court", "Current court", "Category", "OCPC pair", "OCPC players", "OCPC score", "Rally Rebels score", "Rally Rebels pair", "Rally Rebels players", "Status", "Referee"]];
  (state.matches || []).forEach(match => {
    const score = (state.scores || {})[match.id] || {}, live = matchesById[match.id]?.live || {};
    const currentCourt = Object.entries(state.courts || {}).find(([, court]) => court.matchId === match.id)?.[0] || "";
    const complete = score.a !== undefined && score.a !== "" && score.b !== undefined && score.b !== "";
    schedule.push([match.id, match.time || "", match.court || "", currentCourt, match.category, match.a, pairName(state, match.category, match.a), score.a ?? "", score.b ?? "", match.b, pairName(state, match.category, match.b), complete ? "Complete" : currentCourt ? (live.running ? "Playing" : "On court") : "Queued", (state.refereeAssignments || {})[match.id] || ""]);
  });

  const pairs = [["Category", "Club", "Pair", "Player 1", "Player 2"]];
  categories.forEach(category => ["O", "R"].forEach(prefix => {
    for (let index = 1; index <= Number(state.pairCounts[category]); index++) {
      const code = `${prefix}${index}`, pair = (state.pairs || {})[`${category}|${code}`] || {};
      pairs.push([category, prefix === "O" ? "OCPC" : "Rally Rebels", code, pair.player1 || "", pair.player2 || ""]);
    }
  }));

  const standings = [["Category", "Club", "Rank", "Pair", "Players", "Played", "Wins", "Losses", "Point diff", "Points for", "Points against"]];
  categories.forEach(category => ["ocpc", "rebels"].forEach(club => standingsFor(state, category, club).forEach((row, index) => standings.push([category, club === "ocpc" ? "OCPC" : "Rally Rebels", index + 1, row.code, row.names, row.played, row.wins, row.losses, row.diff, row.pointsFor, row.pointsAgainst]))));

  const medals = [["Category", "Round", "Side A", "Side A players", "Score A", "Score B", "Side B", "Side B players"]];
  categories.forEach(category => Object.entries((state.medals || {})[category] || {}).filter(([key]) => ["sf1", "sf2", "bronze", "final"].includes(key)).forEach(([round, match]) => medals.push([category, round.toUpperCase(), match.a || "TBD", match.a ? pairName(state, category, match.a) : "", match.scoreA ?? "", match.scoreB ?? "", match.b || "TBD", match.b ? pairName(state, category, match.b) : ""])));

  const checkins = [["Record", "Player", "Email", "Club", "Category", "Pair", "Payment", "Shirt size", "Waiver signed"]];
  Object.entries(state.checkins || {}).forEach(([id, item]) => checkins.push([id, item.name || item.playerName || "", item.email || "", item.club || "", item.category || "", item.pair || item.pairNumber || "", item.paymentStatus || item.payment || "", item.shirtSize || "", item.waiverSigned ? "Yes" : "No"]));

  const referees = [["Match ID", "Referee email"]];
  Object.entries(state.refereeAssignments || {}).forEach(([matchId, email]) => referees.push([matchId, email]));
  return { "Live Schedule": schedule, "Pair Setup": pairs, Standings: standings, "Medal Matches": medals, "Check-ins": checkins, Referees: referees };
}

async function ensureBackupSheets(sheets) {
  const metadata = await sheets.spreadsheets.get({ spreadsheetId: TOURNAMENT_SHEET_ID, fields: "sheets.properties.title" });
  const existing = new Set((metadata.data.sheets || []).map(sheet => sheet.properties.title));
  const requests = BACKUP_SHEETS.filter(title => !existing.has(title)).map(title => ({ addSheet: { properties: { title, frozenRowCount: 1 } } }));
  if (requests.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId: TOURNAMENT_SHEET_ID, requestBody: { requests } });
}

exports.syncTournamentBackup = onSchedule({ schedule: "every 1 minutes", timeZone: "Asia/Manila", region: "asia-southeast1", memory: "256MiB", timeoutSeconds: 60 }, async () => {
  const auth = new google.auth.GoogleAuth({ scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  const sheets = google.sheets({ version: "v4", auth });
  await ensureBackupSheets(sheets);
  const modeResponse = await sheets.spreadsheets.values.get({ spreadsheetId: TOURNAMENT_SHEET_ID, range: "'Sync Control'!B2" });
  const mode = String(modeResponse.data.values?.[0]?.[0] || "LIVE_SYNC").trim().toUpperCase();
  if (mode === "MANUAL_FAILOVER") return;

  const eventRef = admin.firestore().doc(`tournamentEvents/${TOURNAMENT_EVENT_ID}`);
  const [eventSnapshot, matchSnapshot] = await Promise.all([eventRef.get(), eventRef.collection("matches").get()]);
  if (!eventSnapshot.exists || !eventSnapshot.data().state) throw new Error("Tournament event state is missing.");
  const state = eventSnapshot.data().state;
  const matchesById = Object.fromEntries(matchSnapshot.docs.map(doc => [doc.id, doc.data()]));
  const tables = backupTables(state, matchesById);
  const timestamp = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Manila" }).format(new Date());

  await sheets.spreadsheets.values.batchClear({ spreadsheetId: TOURNAMENT_SHEET_ID, requestBody: { ranges: Object.keys(tables).map(title => `'${title}'!A:Z`) } });
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: TOURNAMENT_SHEET_ID, requestBody: { valueInputOption: "RAW", data: [
    { range: "'Sync Control'!A1:B5", values: [["Tournament backup control", "Value"], ["Mode", "LIVE_SYNC"], ["Last successful sync", timestamp], ["Firebase event", TOURNAMENT_EVENT_ID], ["Failover instruction", "Change B2 to MANUAL_FAILOVER before entering scores here."]] },
    ...Object.entries(tables).map(([title, values]) => ({ range: `'${title}'!A1`, values }))
  ] } });
});

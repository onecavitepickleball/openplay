import { loadTournamentContext, eventUrl } from '../event-context.js';

const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const timeLabel = value => { const minutes = Number(value); if (!Number.isFinite(minutes)) return 'TBD'; const hour = Math.floor(minutes / 60) % 24, minute = minutes % 60, suffix = hour >= 12 ? 'PM' : 'AM', clock = hour % 12 || 12; return `${clock}:${String(minute).padStart(2,'0')} ${suffix}`; };
const names = (state, category, code) => { const pair = state.pairs?.[`${category}|${code}`] || state.pairs?.[code] || {}; return [pair.player1, pair.player2].filter(Boolean).join(' / ') || 'Players pending'; };
const pairLabel = (state, category, code) => { const pair = state.pairs?.[`${category}|${code}`] || state.pairs?.[code] || {}; return pair.pairCode || 'PAIR'; };
const pairClub = (config, code, category = '', state = {}) => {
  const pair = state.pairs?.[`${category}|${code}`] || state.pairs?.[category]?.[code] || state.pairs?.[code] || {};
  const id = pair.affiliationId || pair.club;
  return config.clubs.find(club => club.id === id) || config.affiliations?.find(club => club.id === id) || config.clubs.find(club => club.pairPrefix && String(code || '').startsWith(club.pairPrefix)) || {};
};
const matchLabel = (state, match) => `${names(state,match.category,match.a)} vs ${names(state,match.category,match.b)}`;

let config, state = {}, liveMatches = [], checkins = [];

function finalScore(matchId) { return liveMatches.find(match => match.id === matchId)?.score || state.scores?.[matchId] || null; }
function checkedIn(category, code, clubId, index) { return checkins.some(record => record.category === category && record.pair === code && record.club === clubId && Number(record.playerIndex) === index); }
function renderSchedules() {
  const courts = Number(config.event.courts) || 1;
  $('#courtSchedules').innerHTML = Array.from({ length:courts }, (_, index) => index + 1).map(court => {
    const matches = (state.matches || []).filter(match => Number(match.court) === court).sort((a,b) => Number(a.startMinutes) - Number(b.startMinutes));
    return `<article class="court-card"><h3>Court ${court}</h3>${matches.length ? `<table><thead><tr><th>Time</th><th>Match</th><th>Stage</th></tr></thead><tbody>${matches.map(match => `<tr><td>${escapeHtml(timeLabel(match.startMinutes))}</td><td><span class="pair">${escapeHtml(names(state,match.category,match.a))}</span><br>vs<br><span class="pair">${escapeHtml(names(state,match.category,match.b))}</span><br><small>${escapeHtml(match.category)}</small></td><td class="match-stage">${escapeHtml(match.stage === 'medal' ? (match.medalKey === 'bronze' ? 'Bronze' : 'Gold / Silver') : 'Round robin')}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No matches assigned.</div>'}</article>`;
  }).join('');
}
function renderRoster() {
  const rows = (state.matches || []).flatMap(match => ['a','b'].flatMap(side => { const code = match[side], pair = state.pairs?.[`${match.category}|${code}`] || state.pairs?.[code] || {}, clubId = match[`${side}AffiliationId`] || pair.affiliationId || pair.club || pairClub(config, code, match.category, state).id; return [0,1].map(index => { const name = pair[index ? 'player2' : 'player1']; if (!name) return null; return { category:match.category, code, clubId, name, checked:checkedIn(match.category,code,clubId,index) }; }); })).filter(Boolean);
  const unique = [...new Map(rows.map(row => [`${row.category}|${row.clubId}|${row.code}|${row.name}`,row])).values()].sort((a,b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  $('#checkinRoster').innerHTML = unique.length ? `<table><thead><tr><th>Check-in</th><th>Player</th><th>Pair</th><th>Category</th><th>Club</th><th>Waiver / notes</th></tr></thead><tbody>${unique.map(row => `<tr><td class="check">${row.checked ? '✓' : '□'}</td><td><b>${escapeHtml(row.name)}</b></td><td>${escapeHtml(pairLabel(state,row.category,row.code))}</td><td>${escapeHtml(row.category)}</td><td>${escapeHtml(pairClub(config,row.code,row.category,state).short || row.clubId)}</td><td>________________________________</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Roster is not yet populated.</div>';
}
function renderOfficials() {
  const assigned = Object.entries(state.refereeAssignments || {}).map(([id,email]) => ({ match:(state.matches || []).find(item => item.id === id), email })).filter(item => item.match).sort((a,b) => a.match.startMinutes - b.match.startMinutes);
  $('#refereeAssignments').innerHTML = assigned.length ? `<table><thead><tr><th>Time</th><th>Court</th><th>Match</th><th>Category</th><th>Referee</th><th>Sign-in</th></tr></thead><tbody>${assigned.map(({match,email}) => `<tr><td>${escapeHtml(timeLabel(match.startMinutes))}</td><td>Court ${escapeHtml(match.court)}</td><td><b>${escapeHtml(matchLabel(state,match))}</b></td><td>${escapeHtml(match.category)}</td><td>${escapeHtml(email)}</td><td>□ Present</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No referee assignments yet.</div>';
}
function scoreSheet(match) {
  const stage = match.stage === 'medal' ? (match.medalKey === 'bronze' ? 'Bronze medal match' : 'Gold / Silver medal match') : 'Round robin';
  return `<article class="score-sheet"><div class="sheet-meta"><span>${escapeHtml(stage)} · ${escapeHtml(match.category)}</span><span>Court ${escapeHtml(match.court || 'TBD')} · ${escapeHtml(timeLabel(match.startMinutes))}</span></div><div class="versus"><div class="team-box">${escapeHtml(names(state,match.category,match.a))}<br><small>${escapeHtml(pairClub(config,match.a,match.category,state).short || '')} · ${escapeHtml(pairLabel(state,match.category,match.a))}</small></div><div class="score-box">VS</div><div class="team-box">${escapeHtml(names(state,match.category,match.b))}<br><small>${escapeHtml(pairClub(config,match.b,match.category,state).short || '')} · ${escapeHtml(pairLabel(state,match.category,match.b))}</small></div></div><div class="score-lines"><div class="line-block">Final score: ______<br>Timeouts: ______<br>Notes: __________________<br>________________________</div><div class="line-block">Winner: __________________<br>Referee: _________________<br>Start: ______ End: ______<br>________________________</div></div><div class="signature"><span>Side A confirmation</span><span>Side B confirmation</span></div></article>`;
}
function renderScoreSheets() { const pending = (state.matches || []).filter(match => !finalScore(match.id)); $('#scoreSheets').innerHTML = pending.length ? pending.map(scoreSheet).join('') : '<div class="empty">All scheduled matches have recorded scores.</div>'; }
function renderMedals() {
  const cards = (state.matches || []).filter(match => match.stage === 'medal').sort((a,b) => a.category.localeCompare(b.category) || a.round - b.round).map(match => {
    const score = finalScore(match.id), label = match.medalKey === 'bronze' ? 'Bronze / 4th place' : 'Gold / Silver';
    return `<article class="medal-card"><span class="title">${escapeHtml(match.category)} · ${label}</span><div class="medal-match"><div>${escapeHtml(names(state,match.category,match.a))}</div><hr><div>${escapeHtml(names(state,match.category,match.b))}</div></div><p>Court ${escapeHtml(match.court || 'TBD')} · ${escapeHtml(timeLabel(match.startMinutes))}</p><p><b>Score:</b> ${score ? `${escapeHtml(score.a)} – ${escapeHtml(score.b)}` : '__________'}</p><p><b>Winner:</b> <span class="blank">____________________________</span></p></article>`;
  });
  $('#medalSheets').innerHTML = cards.length ? cards.join('') : '<div class="empty">Medal matches appear here once seeds are set and the round robin is complete.</div>';
}
function renderPublicAccess() { const target = $('#publicAccessQr'), token = state.publicShare?.token; if (!target) return; target.innerHTML = ''; if (!token) { target.innerHTML = '<span class="qr-empty">Link not generated yet</span>'; return; } const url = new URL('../public/', location.href); url.searchParams.set('event', config.firebaseEventId); url.searchParams.set('token', token); if (window.QRCode) new QRCode(target, { text:url.href, width:190, height:190, colorDark:'#082a3e', colorLight:'#ffffff', correctLevel:QRCode.CorrectLevel.M }); target.dataset.url = url.href; }
function renderAll() { renderSchedules(); renderRoster(); renderOfficials(); renderScoreSheets(); renderMedals(); renderPublicAccess(); $('#generatedAt').textContent = `Last refreshed ${new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date())}`; }
function wirePrintButtons() { $('#printAll').onclick = () => window.print(); document.querySelectorAll('[data-print-section]').forEach(button => button.onclick = () => { const target = document.getElementById(button.dataset.printSection); document.body.dataset.printSection = button.dataset.printSection; target.scrollIntoView(); window.print(); delete document.body.dataset.printSection; }); }

async function start() {
  config = await loadTournamentContext();
  $('#brandLogo').src = config.brand.logo; $('#brandLogo').alt = config.brand.shortName || config.brand.organizer; $('#controlLink').href = eventUrl('../'); $('#eventName').textContent = config.event.name; $('#eventMeta').textContent = `${config.event.displayDate || config.event.date} · ${config.event.venue}${config.event.location ? ` · ${config.event.location}` : ''}`;
  const [{ initializeApp, getApps, getApp }, { getFirestore, doc, collection, onSnapshot }] = await Promise.all([import('https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js'), import('https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js')]);
  const firebaseConfig = { apiKey:'AIzaSyBQYKgSchzlmtIGsIhf68e8OYt7Y8kY7Vo',authDomain:'ocpc-website-faf5e.firebaseapp.com',projectId:'ocpc-website-faf5e',storageBucket:'ocpc-website-faf5e.firebasestorage.app',messagingSenderId:'15833259684',appId:'1:15833259684:web:0f2f4400f9995517ae5031' };
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig), db = getFirestore(app), eventId = config.firebaseEventId;
  onSnapshot(doc(db,'tournamentEvents',eventId), snapshot => { state = snapshot.data()?.state || {}; renderAll(); $('#status').textContent = 'Live data connected. This pack is read-only and refreshes as match control updates.'; }, () => { $('#status').textContent = 'Unable to load tournament data. Confirm your tournament access and retry.'; });
  onSnapshot(collection(db,'tournamentEvents',eventId,'matches'), snapshot => { liveMatches = snapshot.docs.map(item => ({id:item.id,...item.data()})); renderAll(); });
  onSnapshot(collection(db,'tournamentEvents',eventId,'checkins'), snapshot => { checkins = snapshot.docs.map(item => ({id:item.id,...item.data()})); renderAll(); });
}

wirePrintButtons(); start().catch(error => { console.error(error); $('#status').textContent = 'Unable to open the operations pack. Return to My Tournaments and confirm your access.'; });

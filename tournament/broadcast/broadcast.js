const revision = new URL(import.meta.url).searchParams.get('v') || 'dev';
const { loadTournamentContext } = await import(`../event-context.js?v=${encodeURIComponent(revision)}`);
await loadTournamentContext();
const { watchAuth, watchControl, watchMatches, watchCheckins } = await import(`../firebase-sync.js?v=${encodeURIComponent(revision)}`);

(() => {
  const c = window.TOURNAMENT_CONFIG, $ = selector => document.querySelector(selector), $$ = selector => [...document.querySelectorAll(selector)], params = new URLSearchParams(location.search), esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
  let state = null, latestMatchItems = [], view = params.get('view') || 'arena', focus = Number(params.get('court')) || 1, cast = params.get('cast') === '1', demo = params.get('demo') === '1', soundEnabled = localStorage.getItem('matchday.broadcast.sound') === '1', seenLiveCalls = new Set(), receivedState = false, lastAnnouncement = '', lastCompleted = 0;
  const standard = () => c.competitionType === 'standard' || c.capabilities?.clubChampionship === false;
  const affiliations = () => c.affiliations || c.clubs || [];
  const pairRecord = (category, code) => state?.pairs?.[`${category}|${code}`] || state?.pairs?.[category]?.[code] || {};
  const pair = (category, code) => { const item = pairRecord(category, code); return item.names ? [item.names] : [item.player1 || `${code} Player 1`, item.player2 || `${code} Player 2`]; };
  const defaultNoPlayer = value => { const parts = String(value || '').split('/').map(part => part.trim()).filter(Boolean); return parts.length > 0 && parts.every(part => /^\[?\s*DEFAULT NO PLAYER(?:\]|\b)/i.test(part)); };
  const defaultSide = (match, side) => pair(match.category, match[side]).filter(Boolean).every(defaultNoPlayer);
  const administrativeMatch = match => match?.administrative || (defaultSide(match, 'a') && defaultSide(match, 'b') ? 'null' : defaultSide(match, 'a') || defaultSide(match, 'b') ? 'walkover' : '');
  const playableMatches = () => (state?.matches || []).filter(match => !administrativeMatch(match) && match.status !== 'bye');
  const affiliationId = (match, side) => { const item = pairRecord(match.category, match[side]); return match?.[`${side}AffiliationId`] ?? item.affiliationId ?? item.club ?? (side === 'a' ? 'ocpc' : 'rebels'); };
  const affiliation = (match, side) => { const id = affiliationId(match, side); return affiliations().find(item => item.id === id) || { id, short:id || `Side ${side.toUpperCase()}`, name:id || `Side ${side.toUpperCase()}` }; };
  const affiliationName = (match, side) => { const item = affiliation(match, side); return item.short || item.name; };
  const logo = item => { const src = item?.logo || item?.logoUrl || item?.badge || '', label = item?.short || item?.name || ''; return src ? `<img class="broadcast-club-logo" src="${esc(src)}" alt="${esc(label)} logo">` : `<span class="broadcast-club-logo fallback">${esc(label.slice(0, 2) || '•')}</span>`; };
  const categoryClass = category => category === 'Novice' ? 'novice' : category === 'Low Intermediate' ? 'low' : 'high';
  const prefix = category => category === 'Novice' ? 'NOV' : category === 'Low Intermediate' ? 'LOW' : category === 'High Intermediate' ? 'HIGH' : String(category).replace(/[^a-z0-9 ]/gi, '').split(/\s+/).filter(Boolean).map(word => word[0]).join('').slice(0, 4).toUpperCase() || 'CAT';
  const elapsed = live => (live?.elapsed || 0) + (live?.running && live.startedAt ? Math.max(0, Math.floor((Date.now() - live.startedAt) / 1000)) : 0);
  const timer = seconds => { const target = Number(state?.standardScheduling?.matchMinutes) * 60 || Number(c.scoring?.targetSeconds) || 1080, over = seconds > target, shown = over ? seconds - target : seconds; return `${over ? '+' : ''}${String(Math.floor(shown / 60)).padStart(2, '0')}:${String(shown % 60).padStart(2, '0')}`; };
  const timeLabel = value => { const minutes = Number(value); if (!Number.isFinite(minutes)) return 'TBD'; const hour = Math.floor(minutes / 60) % 24; return `${hour % 12 || 12}:${String(minutes % 60).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`; };
  const completedCount = () => playableMatches().filter(match => state.scores?.[match.id]).length;
  function showFeedMessage(title, detail) {
    $('#broadcastPulse').innerHTML = '';
    $('#broadcastClubStandings').innerHTML = '';
    $('#broadcastPairStandings').innerHTML = '';
    $('#broadcastGrid').innerHTML = `<article class="modern-court vacant broadcast-feed-message"><div class="vacant-message"><i aria-hidden="true">↻</i><strong>${esc(title)}</strong><small>${esc(detail)}</small></div></article>`;
    $('#broadcastTicker').innerHTML = '<span>Waiting for Match Control</span>';
  }
  function photo(category, code, id, index) { const checkin = Object.values(state?.checkins || {}).find(item => item.category === category && item.pair === code && item.club === id && Number(item.playerIndex) === index); return checkin?.photoURL || checkin?.photoThumb || ''; }
  function playerMarkup(match, side, live) { const code = match[side], id = affiliationId(match, side); return pair(match.category, code).map((name, index) => { const image = photo(match.category, code, id, index), serving = live?.serving === side && Number(live.serverPlayer || 0) === index; return `<span class="broadcast-player ${serving ? 'serving' : ''}">${image ? `<img src="${esc(image)}" alt="${esc(name)}">` : '<i aria-hidden="true"><span>👤</span></i>'}<b>${esc(name)}</b>${serving ? '<em>Serving</em>' : ''}</span>`; }).join(''); }
  function liveCalls() { return Array.from({ length:Number(c.event.courts) || 1 }, (_, index) => index + 1).map(no => { const match = state?.matches?.find(item => item.id === state?.courts?.[no]?.matchId); if (!match || administrativeMatch(match) || state?.scores?.[match.id]) return null; return { no, match, live:state?.liveScoring?.[match.id] || state?.courts?.[no] || {} }; }).filter(Boolean); }
  function announcement() { const raw = state?.broadcastAnnouncement ?? state?.announcement ?? state?.announcements?.active ?? ''; return typeof raw === 'string' ? raw.trim() : String(raw?.message ?? raw?.text ?? '').trim(); }
  function renderAnnouncement() { const message = announcement(), node = $('#broadcastAnnouncement'); node.hidden = !message; node.innerHTML = message ? `<span>Match Control notice</span><div><b>${esc(message)}</b></div>` : ''; }
  function playCue() { if (!soundEnabled) return; try { const audio = new AudioContext(), now = audio.currentTime; [660, 880].forEach((frequency, index) => { const oscillator = audio.createOscillator(), gain = audio.createGain(), at = now + index * .16; oscillator.frequency.value = frequency; gain.gain.setValueAtTime(.0001, at); gain.gain.exponentialRampToValueAtTime(.08, at + .015); gain.gain.exponentialRampToValueAtTime(.0001, at + .13); oscillator.connect(gain).connect(audio.destination); oscillator.start(at); oscillator.stop(at + .14); }); setTimeout(() => audio.close(), 550); } catch (_) {} }
  function renderCalls() { const calls = liveCalls().filter(({ live }) => live.running || (!live.elapsed && Date.now() - new Date(live.calledAt || Date.now()).valueOf() < 30000)), node = $('#broadcastCalls'); node.hidden = !calls.length; node.innerHTML = calls.map(({ no, match, live }) => `<article class="broadcast-call ${live.running ? 'in-play' : 'reporting'}"><span>${live.running ? 'NOW PLAYING' : 'REPORT TO COURT'}</span><b>Court ${no}</b><p><strong>${esc(pair(match.category, match.a).join(' / '))}</strong><i>vs</i><strong>${esc(pair(match.category, match.b).join(' / '))}</strong></p><small>${esc(match.category)}${live.running ? ' · Match in progress' : ' · Please report now'}</small></article>`).join(''); }
  function scheduledForCourt(no) { const active = new Set(Object.values(state?.courts || {}).map(item => item?.matchId).filter(Boolean)), ids = state?.courtSchedules?.[no] || state?.matches?.filter(match => Number(match.court) === no).map(match => match.id) || []; return ids.map(id => state.matches?.find(match => match.id === id)).filter(match => match && !administrativeMatch(match) && !state.scores?.[match.id] && !active.has(match.id)).sort((a, b) => Number(a.startMinutes) - Number(b.startMinutes)).slice(0, 3); }
  function nextMatches(no) { const matches = scheduledForCourt(no); return `<section class="court-up-next"><header><b>Up next</b><span>${matches.length ? `${matches.length} queued` : 'Court clear'}</span></header>${matches.length ? matches.map((match, index) => `<div class="next-match"><time>${timeLabel(match.startMinutes)}</time><span><b>${esc(pair(match.category, match.a).join(' / '))}</b><i>vs</i><b>${esc(pair(match.category, match.b).join(' / '))}</b></span><em>${index + 1}</em></div>`).join('') : '<p>No remaining scheduled matches.</p>'}</section>`; }
  function courtCard(no) { const court = state?.courts?.[no] || {}, found = state?.matches?.find(item => item.id === court.matchId), match = found && !administrativeMatch(found) ? found : null, upNext = nextMatches(no); if (!match) return `<article class="modern-court vacant"><header><span>COURT ${no}</span><b>AVAILABLE</b><small>Ready for play</small></header><div class="vacant-message"><i>✓</i><strong>Open court</strong><small>Waiting for Match Control</small></div>${upNext}</article>`; const live = state.liveScoring?.[match.id] || court, score = state.scores?.[match.id] || live, complete = Boolean(state.scores?.[match.id]), winner = complete && Number(score?.a) !== Number(score?.b) ? Number(score.a) > Number(score.b) ? 'a' : 'b' : '', official = state.refereeAssignments?.[match.id], seconds = elapsed(live), interruption = live.interruption?.active ? String(live.interruption.type || '').toLowerCase() : '', interruptionClass = interruption === 'team' || interruption.startsWith('timeout-') ? 'broadcast-timeout-team' : interruption === 'medical' ? 'broadcast-timeout-danger' : interruption === 'technical' || interruption === 'referee' || interruption === 'equipment' ? 'broadcast-timeout-warning' : '', status = complete ? 'FINAL' : live.interruption?.active ? String(live.interruption.label || 'TIMEOUT').toUpperCase() : live.running ? 'LIVE' : seconds ? 'PAUSED' : 'READY'; const side = key => { const item = affiliation(match, key); return `<div class="broadcast-side ${esc(key)} ${winner === key ? 'winner' : ''}">${winner === key ? '<span class="broadcast-winner-label">WINNER</span>' : ''}<div class="club-lockup">${logo(item)}<small>${esc(affiliationName(match, key))}<i>${prefix(match.category)}-${esc(match[key])}</i></small></div><div class="broadcast-players">${playerMarkup(match, key, live)}</div></div>`; }; return `<article class="modern-court ${categoryClass(match.category)} status-${complete ? 'final' : live.running ? 'live' : 'ready'} ${live.running ? 'is-live' : ''} ${interruptionClass}"><header><span>COURT ${no}</span><b>${esc(status)}</b><small>${esc(match.category)} · ${esc(match.id)}</small></header><div class="broadcast-match-id">${official ? `OFFICIATED BY ${esc(official.split('@')[0])}` : 'PLAYER-REPORTED SCORING'}</div><section class="broadcast-versus">${side('a')}<div class="broadcast-score"><b>${score?.a ?? 0}</b><span><i>VS</i><small>${complete ? 'FINAL' : live.serving ? `${esc(affiliationName(match, live.serving))} SERVES` : 'LIVE SCORE'}</small></span><b>${score?.b ?? 0}</b></div>${side('b')}</section><footer><span>${live.interruption?.active ? esc(status) : live.serving ? `${esc(affiliationName(match, live.serving))} SERVING` : 'MATCH TIMER'}</span><b>${timer(seconds)}</b></footer>${upNext}</article>`; }
  function pairRows(category) { const rows = new Map(); (state?.matches || []).filter(match => match.category === category && !['null','no-contest'].includes(administrativeMatch(match))).forEach(match => ['a', 'b'].filter(side => !defaultSide(match, side)).forEach(side => { const code = match[side], row = rows.get(code) || { code, names:pair(category, code).join(' / '), affiliation:affiliationName(match, side), played:0, wins:0, pointsFor:0, pointsAgainst:0 }, score = state.scores?.[match.id]; if (score) { const other = side === 'a' ? 'b' : 'a', own = Number(score[side]) || 0, against = Number(score[other]) || 0; row.played++; row.pointsFor += own; row.pointsAgainst += against; if (own > against) row.wins++; } rows.set(code, row); })); return [...rows.values()].map(row => ({ ...row, losses:row.played - row.wins, diff:row.pointsFor - row.pointsAgainst })).sort((a, b) => b.wins - a.wins || b.diff - a.diff || String(a.code).localeCompare(String(b.code))); }
  function bracketRows() { const source = state?.dynamicBracket || state?.bracket || state?.brackets || state?.competition?.bracket, matches = Array.isArray(source) ? source : Array.isArray(source?.matches) ? source.matches : []; return matches.map(match => `<div><b>${esc(match.label || match.round || 'Bracket')}</b><span>${esc(match.a || match.participants?.a || 'TBD')} vs ${esc(match.b || match.participants?.b || 'TBD')}</span></div>`).join(''); }
  function renderStandings() { const clubBoard = $('#broadcastClubStandings'), pairBoard = $('#broadcastPairStandings'); clubBoard.hidden = standard(); if (standard()) { const brackets = bracketRows(); pairBoard.innerHTML = `<header><div><span>Live category standings</span><h2>${brackets ? 'Pools and bracket' : 'Category leaders'}</h2></div><small>Wins · Points For · Differential</small></header><div class="pair-standing-grid">${(c.categories || []).map(category => { const rows = pairRows(category).slice(0, 6); return `<article class="pair-standing-card ${categoryClass(category)}"><h3>${esc(category)}</h3>${rows.length ? rows.map((row, index) => `<div><em>${index + 1}</em><span><b>${esc(row.names)}</b><small>${esc(row.code)}${row.affiliation ? ` · ${esc(row.affiliation)}` : ''} · ${row.played} played</small></span><strong>${row.wins}W<small>${row.pointsFor} PF · ${row.diff > 0 ? '+' : ''}${row.diff}</small></strong></div>`).join('') : '<p>No completed matches yet.</p>'}</article>`; }).join('')}</div>${brackets ? `<section class="pair-standing-grid"><article class="pair-standing-card"><h3>Elimination bracket</h3>${brackets}</article></section>` : ''}`; return; } const totals = new Map(); (state?.matches || []).forEach(match => { const score = state.scores?.[match.id]; if (!score) return; ['a', 'b'].forEach(side => { const id = affiliationId(match, side), row = totals.get(id) || { id, wins:0, losses:0 }, other = side === 'a' ? 'b' : 'a'; if (Number(score[side]) > Number(score[other])) row.wins++; else if (Number(score[side]) < Number(score[other])) row.losses++; totals.set(id, row); }); }); clubBoard.innerHTML = `<header><span>Live club standings</span></header><div>${[...totals.values()].map(row => { const item = affiliations().find(entry => entry.id === row.id) || { short:row.id }; return `<article>${logo(item)}<span><small>${esc(item.short || item.name)}</small><strong>${row.wins}<i>wins</i></strong></span><dl><div><dt>W-L</dt><dd>${row.wins}-${row.losses}</dd></div></dl></article>`; }).join('')}</div>`; pairBoard.innerHTML = ''; }
  function render() { if (!state) return; state.matches ||= []; state.courts ||= {}; state.queue ||= []; state.scores ||= {}; state.liveScoring ||= {}; document.body.classList.toggle('cast-mode', cast); document.body.dataset.view = view; const courts = Array.from({ length:Number(c.event.courts) || 1 }, (_, index) => index + 1), visible = view === 'focus' ? [focus] : courts; renderAnnouncement(); renderCalls(); const calls = new Set(liveCalls().map(call => `${call.no}:${call.match.id}`)); if (receivedState && ([...calls].some(call => !seenLiveCalls.has(call)) || completedCount() > lastCompleted || announcement() !== lastAnnouncement)) playCue(); seenLiveCalls = calls; lastCompleted = completedCount(); lastAnnouncement = announcement(); receivedState = true; $('#broadcastGrid').innerHTML = visible.map(courtCard).join(''); $('#broadcastPulse').innerHTML = `<div><span>Courts active</span><b>${courts.filter(no => { const match = state.matches.find(item => item.id === state.courts?.[no]?.matchId); return match && !administrativeMatch(match); }).length}/${courts.length}</b></div><div><span>Court matches complete</span><b>${completedCount()}/${playableMatches().length}</b></div>`; renderStandings(); const queued = state.queue.filter(id => !state.scores[id]).map(id => state.matches.find(match => match.id === id)).filter(match => match && !administrativeMatch(match)).slice(0, 8); $('#broadcastTicker').innerHTML = queued.length ? queued.map(match => `<span><b>${esc(pair(match.category, match.a).join(' / '))}</b> vs <b>${esc(pair(match.category, match.b).join(' / '))}</b> · ${esc(match.category)}</span>`).join('') : '<span>No court matches waiting</span>'; $$('[data-broadcast-view]').forEach(button => button.classList.toggle('active', button.dataset.broadcastView === view)); $('#focusCourt').value = String(focus); $('#broadcastSound').textContent = `Sound: ${soundEnabled ? 'on' : 'off'}`; }
  function updateClock() { $('#broadcastClock').textContent = new Intl.DateTimeFormat('en-PH', { timeZone:'Asia/Manila', hour:'numeric', minute:'2-digit', second:'2-digit' }).format(new Date()); }
  function applyMatchFeed(items = latestMatchItems) {
    latestMatchItems = Array.isArray(items) ? items : [];
    if (!state) return;
    const liveScoring = {}, scores = { ...(state.scores || {}) };
    latestMatchItems.forEach(item => {
      if (item.live) liveScoring[item.id] = item.live;
      if (Object.prototype.hasOwnProperty.call(item, 'score')) {
        if (item.score) scores[item.id] = item.score;
        else delete scores[item.id];
      }
    });
    state.liveScoring = liveScoring;
    state.scores = scores;
  }
  $('#eventName').textContent = c.event.name; $('#eventMeta').textContent = [c.event.displayDate, c.event.venue, c.event.location].filter(Boolean).join(' · '); document.querySelector('.broadcast-hero h1').textContent = standard() ? c.event.name : affiliations().slice(0, 2).map(item => item.short || item.name).join(' × '); document.querySelector('.field-brand img').src = c.brand.logo; document.querySelector('.field-brand img').alt = `${c.brand?.organizer || c.event?.name || 'Tournament'} logo`; $('#focusCourt').innerHTML = Array.from({ length:Number(c.event.courts) || 1 }, (_, index) => `<option value="${index + 1}">Court ${index + 1}</option>`).join(''); document.querySelector('.broadcast-gate a').href = window.MATCHDAY_EVENT_URL('../control.html'); $$('[data-broadcast-view]').forEach(button => button.onclick = () => { view = button.dataset.broadcastView; render(); }); $('#focusCourt').onchange = event => { focus = Number(event.target.value); view = 'focus'; render(); }; $('#broadcastSound').onclick = () => { soundEnabled = !soundEnabled; localStorage.setItem('matchday.broadcast.sound', soundEnabled ? '1' : '0'); render(); if (soundEnabled) playCue(); }; $('#fullscreenBroadcast').onclick = () => document.documentElement.requestFullscreen?.(); $('#openCast').onclick = () => window.open(window.MATCHDAY_EVENT_URL(location.pathname, { cast:'1', view, court:focus }), 'matchday-live-cast', 'noopener'); if (cast) $('#broadcastControl').hidden = true;
  function startDemoFeed() {
    try { state = JSON.parse(localStorage.getItem(`${c.storageKey}.demo`)); }
    catch (_) { state = null; }
    $('#broadcastGate').hidden = true;
    if (state) render();
    else showFeedMessage('Demo data unavailable', 'Open Demo Mode from this tournament before opening its broadcast.');
    window.addEventListener('storage', event => {
      if (event.key !== `${c.storageKey}.demo` || !event.newValue) return;
      state = JSON.parse(event.newValue);
      render();
    });
  }

  function startLiveFeed() {
    let subscribed = false;
    watchAuth(user => {
      if (!user) {
        $('#broadcastGate').hidden = false;
        return;
      }
      $('#broadcastGate').hidden = true;
      if (subscribed) return;
      subscribed = true;
      watchControl(incoming => {
        if (!incoming) {
          showFeedMessage('Match Control is not initialized', 'Open Match Control for this tournament once to create its live schedule.');
          return;
        }
        state = {
          ...incoming,
          liveScoring: state?.liveScoring || {},
          checkins: state?.checkins || {}
        };
        applyMatchFeed();
        try { render(); }
        catch (error) {
          console.error('Broadcast render failed', error);
          showFeedMessage('Broadcast display needs attention', error?.message || 'Reload this page and try again.');
        }
      }, error => {
        console.error('Broadcast control feed failed', error);
        showFeedMessage('Live feed unavailable', 'Check your connection and tournament access, then reload this page.');
      });
      watchMatches(items => {
        applyMatchFeed(items);
        if (state) render();
      }, error => {
        console.error('Broadcast score feed failed', error);
        showFeedMessage('Score feed unavailable', 'The court display could not read live match updates.');
      });
      watchCheckins(items => {
        if (!state) return;
        state.checkins = Object.fromEntries(items.map(item => [item.id, item]));
        render();
      }, error => console.error('Broadcast check-in feed failed', error));
    });
  }

  showFeedMessage('Connecting to live courts', 'Loading this tournament schedule, scores, and court activity.');
  if (demo) startDemoFeed();
  else startLiveFeed();
  setInterval(() => {
    updateClock();
    if (state) render();
  }, 1000);
  updateClock();
})();

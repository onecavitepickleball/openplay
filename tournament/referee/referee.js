const revision = new URL(import.meta.url).searchParams.get('v') || 'dev';
const { watchAuth, login, watchControl, watchMatches, publishMatch } = await import(`../firebase-sync.js?v=${encodeURIComponent(revision)}`);

(() => {
  'use strict';
  const config = window.TOURNAMENT_CONFIG;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  let state, email = '', activeId = null, tick, cloudUser = null;

  function load() { try { return JSON.parse(localStorage.getItem(config.storageKey)); } catch (_) { return null; } }
  function save() { state.updatedAt = new Date().toISOString(); localStorage.setItem(config.storageKey, JSON.stringify(state)); if (cloudUser && activeId) publishMatch(activeId, state.liveScoring?.[activeId], state.scores?.[activeId] || null).catch(() => toast('Saved locally. Cloud sync failed.')); }
  function players(category, code) { const p = state.pairs[`${category}|${code}`] || {}; return [p.player1 || `${code} Player 1`, p.player2 || `${code} Player 2`]; }
  function playerPhoto(category, code, clubId, index) { return Object.values(state.checkins || {}).find(item => item.category === category && item.pair === code && item.club === clubId && Number(item.playerIndex) === index)?.photoThumb || ''; }
  function names(category, code) { return players(category, code).join(' / '); }
  function prefix(category) { return category === 'Novice' ? 'NOV' : category === 'Low Intermediate' ? 'LOW' : 'HIGH'; }
  function toast(message) { const el = $('#officialToast'); el.textContent = message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 1800); }
  function clock(seconds) { return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }
  function elapsed(live) { return (live.elapsed || 0) + (live.running && live.startedAt ? Math.max(0, Math.floor((Date.now() - live.startedAt) / 1000)) : 0); }
  function defaultLive() { return { a: 0, b: 0, serving: 'a', server: 2, serverPlayer: 0, basePlayer: 0, timeouts: { a: 0, b: 0 }, medical: 0, refereeTimeouts: 0, equipmentTimeouts: 0, running: false, startedAt: null, elapsed: 0, complete: false, pregame: { complete: false, caller: 'a', call: 'heads', result: '', winner: '', firstChoice: 'serve', courtEnd: 'North / Court A', otherChoice: 'receive', finalChoice: 'serve' }, log: [], history: [] }; }
  function liveFor(match) { state.liveScoring ||= {}; return state.liveScoring[match.id] ||= defaultLive(); }
  function addLog(live, text) { live.log.unshift({ at: new Date().toISOString(), text }); live.log = live.log.slice(0, 30); }
  function activeMatch() { return state.matches.find(match => match.id === activeId); }

  function renderAssignments() {
    state = load(); if (!state) return;
    const matches = state.matches.filter(match => state.refereeAssignments?.[match.id] === email);
    $('#matchList').innerHTML = matches.length ? matches.map(match => {
      const live = state.liveScoring?.[match.id], final = state.scores[match.id];
      const status = final ? `Final ${final.a}-${final.b}` : live ? `Live ${live.a}-${live.b}` : 'Ready';
      return `<article class="official-match assignment-card"><div><div class="match-meta">${match.id} · ${esc(match.category)} · planned wave ${match.wave}</div><div class="match-pairs"><div><strong>${prefix(match.category)}-${match.a}</strong><small>${esc(names(match.category, match.a))}</small></div><b>VS</b><div><strong>${prefix(match.category)}-${match.b}</strong><small>${esc(names(match.category, match.b))}</small></div></div></div><div class="assignment-action"><span class="live-status">${status}</span><button class="action" data-open-match="${match.id}">${final ? 'Review match' : 'Open scorekeeper'}</button></div></article>`;
    }).join('') : '<section class="field-card"><p>No matches are assigned to this email yet.</p></section>';
    $$('[data-open-match]').forEach(button => button.onclick = () => openMatch(button.dataset.openMatch));
  }

  function openMatch(id) { activeId = id; $('#assignmentView').hidden = true; $('#scorekeeperView').hidden = false; renderScorekeeper(); clearInterval(tick); tick = setInterval(updateClock, 1000); }
  function closeMatch() { activeId = null; clearInterval(tick); $('#scorekeeperView').hidden = true; $('#assignmentView').hidden = false; renderAssignments(); }
  function teamPanel(side, club, code, playerNames, live, category) {
    const serving = live.serving === side;
    const clubId = side === 'a' ? 'ocpc' : 'rebels';
    return `<article class="score-team ${serving ? 'serving' : ''}"><div class="team-heading"><span>${club}</span><b>${prefix(category)}-${code}</b></div><strong class="giant-score">${live[side]}</strong><div class="player-tags">${playerNames.map((name,index) => { const image = playerPhoto(category,code,clubId,index); return `<span class="${serving && live.serverPlayer === index ? 'server' : ''}">${image ? `<img src="${image}" alt="">` : '<i class="photo-placeholder"></i>'}<b>${esc(name)}</b></span>`; }).join('')}</div><button class="point-button" data-point="${side}" ${serving && !live.complete ? '' : 'disabled'}>+ Point</button></article>`;
  }
  function teamName(side) { return side === 'a' ? 'OCPC' : 'Rally Rebels'; }
  function renderPregame(match, live) {
    const pregame = live.pregame ||= defaultLive().pregame, loser = pregame.winner === 'a' ? 'b' : 'a';
    $('#scorekeeperView').innerHTML = `<div class="pregame-shell"><button class="back-button pregame-back" id="backToMatches">← Assigned matches</button><span class="eyebrow">${match.id} · ${esc(match.category)}</span><h1>Pre-match setup</h1><p class="sub">USA Pickleball 2026 procedure: use a fair method to award first choice of serve, receive, starting end, or defer.</p>
      <section class="coin-card"><div class="coin ${pregame.result ? 'flipped' : ''}">${pregame.result ? (pregame.result === 'heads' ? 'H' : 'T') : '?'}</div><div class="coin-controls"><label>Calling team<select id="coinCaller"><option value="a" ${pregame.caller === 'a' ? 'selected' : ''}>OCPC</option><option value="b" ${pregame.caller === 'b' ? 'selected' : ''}>Rally Rebels</option></select></label><label>Call<select id="coinCall"><option value="heads" ${pregame.call === 'heads' ? 'selected' : ''}>Heads</option><option value="tails" ${pregame.call === 'tails' ? 'selected' : ''}>Tails</option></select></label><button class="action" id="flipCoin">Flip coin</button></div></section>
      ${pregame.result ? `<section class="choice-card"><span class="choice-winner">${teamName(pregame.winner)} won the toss</span><h2>Record the choices</h2><label>Winner's first choice<select id="firstChoice"><option value="serve" ${pregame.firstChoice === 'serve' ? 'selected' : ''}>Serve first</option><option value="receive" ${pregame.firstChoice === 'receive' ? 'selected' : ''}>Receive first</option><option value="end" ${pregame.firstChoice === 'end' ? 'selected' : ''}>Choose starting end</option><option value="defer" ${pregame.firstChoice === 'defer' ? 'selected' : ''}>Defer first choice</option></select></label>${choiceFields(pregame, loser)}<button class="finish-match" id="confirmPregame">Confirm setup and open scorekeeper</button></section>` : ''}
      <aside class="rules-note"><b>Event scoring notice</b><p>Side-out scoring to 11 is standard. This event's sudden-death point at 10-10 and 15-minute operational target are tournament-specific modifications.</p></aside></div>`;
    $('#backToMatches').onclick = closeMatch; $('#coinCaller').onchange = event => { pregame.caller = event.target.value; save(); }; $('#coinCall').onchange = event => { pregame.call = event.target.value; save(); }; $('#flipCoin').onclick = flipCoin;
    if (pregame.result) { $('#firstChoice').onchange = event => { pregame.firstChoice = event.target.value; save(); renderPregame(match, live); }; $$('[data-pregame-field]').forEach(input => input.onchange = () => { pregame[input.dataset.pregameField] = input.value; save(); if (input.dataset.rerender) renderPregame(match, live); }); $('#confirmPregame').onclick = confirmPregame; }
  }
  function choiceFields(pregame, loser) {
    const endField = `<label>Starting court end<select data-pregame-field="courtEnd"><option ${pregame.courtEnd === 'North / Court A' ? 'selected' : ''}>North / Court A</option><option ${pregame.courtEnd === 'South / Court B' ? 'selected' : ''}>South / Court B</option></select></label>`;
    if (pregame.firstChoice === 'serve' || pregame.firstChoice === 'receive') return `<p>${teamName(loser)} receives the remaining choice of starting end.</p>${endField}`;
    if (pregame.firstChoice === 'end') return `${endField}<label>${teamName(loser)} chooses<select data-pregame-field="otherChoice"><option value="serve" ${pregame.otherChoice === 'serve' ? 'selected' : ''}>Serve first</option><option value="receive" ${pregame.otherChoice === 'receive' ? 'selected' : ''}>Receive first</option></select></label>`;
    return `<label>${teamName(loser)} receives first choice<select data-pregame-field="otherChoice" data-rerender="true"><option value="serve" ${pregame.otherChoice === 'serve' ? 'selected' : ''}>Serve first</option><option value="receive" ${pregame.otherChoice === 'receive' ? 'selected' : ''}>Receive first</option><option value="end" ${pregame.otherChoice === 'end' ? 'selected' : ''}>Choose starting end</option></select></label>${endField}${pregame.otherChoice === 'end' ? `<label>${teamName(pregame.winner)} then chooses<select data-pregame-field="finalChoice"><option value="serve" ${pregame.finalChoice === 'serve' ? 'selected' : ''}>Serve first</option><option value="receive" ${pregame.finalChoice === 'receive' ? 'selected' : ''}>Receive first</option></select></label>` : ''}`;
  }
  function flipCoin() { const live = liveFor(activeMatch()), pregame = live.pregame; pregame.result = crypto.getRandomValues(new Uint8Array(1))[0] % 2 ? 'heads' : 'tails'; pregame.winner = pregame.result === pregame.call ? pregame.caller : (pregame.caller === 'a' ? 'b' : 'a'); addLog(live, `${teamName(pregame.caller)} called ${pregame.call}; ${pregame.result} won. ${teamName(pregame.winner)} has first choice.`); save(); renderPregame(activeMatch(), live); }
  function confirmPregame() {
    const live = liveFor(activeMatch()), pregame = live.pregame, loser = pregame.winner === 'a' ? 'b' : 'a';
    if (pregame.firstChoice === 'serve') live.serving = pregame.winner;
    else if (pregame.firstChoice === 'receive') live.serving = loser;
    else if (pregame.firstChoice === 'end') live.serving = pregame.otherChoice === 'serve' ? loser : pregame.winner;
    else if (pregame.otherChoice === 'serve') live.serving = loser;
    else if (pregame.otherChoice === 'receive') live.serving = pregame.winner;
    else live.serving = pregame.finalChoice === 'serve' ? pregame.winner : loser;
    live.server = 2; live.serverPlayer = 0; live.basePlayer = 0; pregame.complete = true;
    addLog(live, `Pre-match choices confirmed. ${teamName(live.serving)} serves first; opening call 0-0-2.`); save(); renderScorekeeper();
  }
  function renderScorekeeper() {
    state = load(); const match = activeMatch(); if (!match) return closeMatch();
    const live = liveFor(match);
    if (!live.pregame?.complete) return renderPregame(match, live);
    const aPlayers = players(match.category, match.a), bPlayers = players(match.category, match.b), servingPlayers = live.serving === 'a' ? aPlayers : bPlayers, receivingPlayers = live.serving === 'a' ? bPlayers : aPlayers, final = state.scores[match.id];
    $('#scorekeeperView').innerHTML = `
      <div class="scorekeeper-top"><button class="back-button" id="backToMatches">← Matches</button><div><span>${match.id} · ${esc(match.category)}</span><b>${final ? 'Match complete' : 'Live scorekeeper'}</b></div><button class="timer-button ${live.running ? 'running' : ''}" id="timerToggle"><small>${live.running ? 'Pause match' : elapsed(live) ? 'Resume match' : 'Start match'}</small><strong id="officialClock">${clock(elapsed(live))}</strong></button></div>
      <div class="serve-call"><span>Call the score</span><strong>${live.serving === 'a' ? live.a : live.b} - ${live.serving === 'a' ? live.b : live.a} - ${live.server}</strong><small>${esc(servingPlayers[live.serverPlayer])} serving for ${live.serving === 'a' ? 'OCPC' : 'Rally Rebels'}</small></div>
      <div class="live-scoreboard">${teamPanel('a', 'OCPC', match.a, aPlayers, live, match.category)}${teamPanel('b', 'Rally Rebels', match.b, bPlayers, live, match.category)}</div>
      <div class="official-controls"><button class="control-button fault" id="faultButton"><span>✕</span><b>Fault / next server</b><small>${live.server === 1 ? 'Moves to server 2' : 'Awards side out'}</small></button><button class="control-button sideout" id="sideoutButton"><span>⇄</span><b>Side out</b><small>Change serving team</small></button><button class="control-button undo" id="undoButton"><span>↶</span><b>Undo last action</b><small>Correct the previous tap</small></button></div>
      <div class="match-tools"><section><h3>Serving player</h3><div class="segmented"><button data-server-player="0" class="${live.serverPlayer === 0 ? 'active' : ''}">${esc(servingPlayers[0])}</button><button data-server-player="1" class="${live.serverPlayer === 1 ? 'active' : ''}">${esc(servingPlayers[1])}</button></div><h3 style="margin-top:16px">Receiving / base player</h3><div class="segmented"><button data-base-player="0" class="${live.basePlayer === 0 ? 'active' : ''}">${esc(receivingPlayers[0])}</button><button data-base-player="1" class="${live.basePlayer === 1 ? 'active' : ''}">${esc(receivingPlayers[1])}</button></div></section><section><h3>Match interruptions</h3><div class="tool-buttons"><button data-timeout="a">OCPC timeout <b>${live.timeouts.a}/2</b></button><button data-timeout="b">Rebels timeout <b>${live.timeouts.b}/2</b></button><button id="medicalButton">Medical <b>${live.medical}</b></button><button id="refereeTimeoutButton">Referee timeout <b>${live.refereeTimeouts || 0}</b></button><button id="equipmentTimeoutButton">Equipment timeout <b>${live.equipmentTimeouts || 0}</b></button></div></section></div>
      <section class="rally-log"><h3>Match log</h3>${live.log.map(item => `<div><time>${new Date(item.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time><span>${esc(item.text)}</span></div>`).join('')}</section>
      <button class="finish-match" id="finishButton" ${final ? 'disabled' : ''}>${final ? `Submitted final: ${final.a}-${final.b}` : 'Finish match and confirm result'}</button><div id="confirmationSheet" hidden></div>`;
    bindScorekeeper();
  }

  function snapshot(live) { return { a: live.a, b: live.b, serving: live.serving, server: live.server, serverPlayer: live.serverPlayer, basePlayer: live.basePlayer, timeouts: { ...live.timeouts }, medical: live.medical, refereeTimeouts: live.refereeTimeouts, equipmentTimeouts: live.equipmentTimeouts }; }
  function transact(label, change) { const live = liveFor(activeMatch()); live.history.push(snapshot(live)); change(live); addLog(live, label); save(); renderScorekeeper(); }
  function sideOut(live) { live.serving = live.serving === 'a' ? 'b' : 'a'; live.server = 1; live.serverPlayer = 0; }
  function bindScorekeeper() {
    $('#backToMatches').onclick = closeMatch; $('#timerToggle').onclick = toggleTimer;
    $$('[data-point]').forEach(button => button.onclick = () => transact(`${button.dataset.point === 'a' ? 'OCPC' : 'Rally Rebels'} scored`, live => { if (live.serving === button.dataset.point && live[button.dataset.point] < 11) live[button.dataset.point]++; }));
    $('#faultButton').onclick = () => transact('Fault called', live => { if (live.server === 1) { live.server = 2; live.serverPlayer = live.serverPlayer ? 0 : 1; } else sideOut(live); });
    $('#sideoutButton').onclick = () => transact('Side out called', sideOut); $('#undoButton').onclick = undo;
    $$('[data-server-player]').forEach(button => button.onclick = () => transact(`Server changed to ${button.textContent}`, live => live.serverPlayer = Number(button.dataset.serverPlayer)));
    $$('[data-base-player]').forEach(button => button.onclick = () => transact(`Receiving base changed to ${button.textContent}`, live => live.basePlayer = Number(button.dataset.basePlayer)));
    $$('[data-timeout]').forEach(button => button.onclick = () => { const side = button.dataset.timeout; transact(`${side === 'a' ? 'OCPC' : 'Rally Rebels'} timeout`, live => { if (live.timeouts[side] < 2) live.timeouts[side]++; }); });
    $('#medicalButton').onclick = () => transact('Medical timeout granted (15-minute maximum)', live => live.medical++); $('#refereeTimeoutButton').onclick = () => transact('Referee timeout', live => live.refereeTimeouts++); $('#equipmentTimeoutButton').onclick = () => transact('Equipment timeout', live => live.equipmentTimeouts++); $('#finishButton').onclick = showConfirmation;
  }
  function toggleTimer() { const live = liveFor(activeMatch()); if (live.running) { live.elapsed = elapsed(live); live.running = false; live.startedAt = null; addLog(live, 'Match timer paused'); } else { live.running = true; live.startedAt = Date.now(); addLog(live, live.elapsed ? 'Match timer resumed' : 'Match timer started'); } save(); renderScorekeeper(); }
  function updateClock() { if (!activeId) return; state = load(); const match = activeMatch(), el = $('#officialClock'); if (match && el) el.textContent = clock(elapsed(liveFor(match))); }
  function undo() { const live = liveFor(activeMatch()), prior = live.history.pop(); if (!prior) return toast('Nothing to undo.'); Object.assign(live, prior); addLog(live, 'Previous action undone'); save(); renderScorekeeper(); }
  function setupCanvas(canvas) { const ctx = canvas.getContext('2d'); ctx.lineWidth = 2; ctx.lineCap = 'round'; let drawing = false; const position = event => { const rect = canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height }; }; canvas.onpointerdown = event => { drawing = true; const p = position(event); ctx.beginPath(); ctx.moveTo(p.x, p.y); }; canvas.onpointermove = event => { if (!drawing) return; const p = position(event); ctx.lineTo(p.x, p.y); ctx.stroke(); }; canvas.onpointerup = canvas.onpointerleave = () => drawing = false; }
  function showConfirmation() {
    const live = liveFor(activeMatch()); if (live.a === live.b || Math.max(live.a, live.b) !== 11) return toast('A winning team must reach 11.'); if (live.running) toggleTimer();
    const sheet = $('#confirmationSheet'); sheet.hidden = false; sheet.innerHTML = `<div class="confirm-backdrop"><section class="confirm-card"><button class="confirm-close" id="closeConfirmation">×</button><span class="eyebrow">Player confirmation</span><h2>Final score ${live.a}-${live.b}</h2><p>Both pairs review the result, then sign below.</p><div class="signature-grid"><div class="signature-box"><label>OCPC pair signature</label><canvas width="320" height="120"></canvas><button data-clear-signature>Clear</button></div><div class="signature-box"><label>Rally Rebels pair signature</label><canvas width="320" height="120"></canvas><button data-clear-signature>Clear</button></div></div><button class="finish-match" id="submitResult">Submit confirmed result</button></section></div>`;
    $$('canvas', sheet).forEach(setupCanvas); $$('[data-clear-signature]', sheet).forEach(button => button.onclick = () => { const canvas = $('canvas', button.parentElement); canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height); }); $('#closeConfirmation').onclick = () => sheet.hidden = true; $('#submitResult').onclick = submitResult;
  }
  function hasInk(canvas) { return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some(value => value); }
  function submitResult() {
    const match = activeMatch(), live = liveFor(match), canvases = $$('#confirmationSheet canvas'); if (!canvases.every(hasInk)) return toast('Both pairs must sign first.'); const prior = state.scores[match.id];
    state.scores[match.id] = { a: live.a, b: live.b, confirmation: { referee: email, submittedAt: new Date().toISOString(), ocpcSignature: canvases[0].toDataURL('image/png'), rebelsSignature: canvases[1].toDataURL('image/png') } }; live.complete = true; live.running = false; live.startedAt = null; addLog(live, `Final result submitted: ${live.a}-${live.b}`); state.scoreAudit ||= []; state.scoreAudit.push({ matchId: match.id, previous: prior || null, revised: state.scores[match.id], source: `referee:${email}`, revisedAt: new Date().toISOString() }); save(); $('#confirmationSheet').hidden = true; renderScorekeeper(); toast('Confirmed result sent to Match Control.');
  }
  $('#officialLogin').onclick = async () => { $('#loginError').textContent = 'Signing in…'; try { await login($('#officialEmail').value.trim(), $('#officialPassword').value); } catch (_) { $('#loginError').textContent = 'Sign-in failed. Check the assigned email and password.'; } };
  watchAuth(user => {
    cloudUser = user;
    if (!user) return;
    email = user.email.toLowerCase(); $('#officialEmail').value = email; $('#loginError').textContent = '';
    watchControl(incoming => { if (!incoming) return; const local = load(); state = { ...incoming, liveScoring: local?.liveScoring || {} }; localStorage.setItem(config.storageKey, JSON.stringify(state)); activeId ? renderScorekeeper() : renderAssignments(); }, () => { $('#loginError').textContent = 'This account cannot access the private tournament.'; });
    watchMatches(items => { state ||= load(); state.liveScoring = {}; items.forEach(item => { if (item.live) state.liveScoring[item.id] = item.live; if (item.score) state.scores[item.id] = item.score; }); localStorage.setItem(config.storageKey, JSON.stringify(state)); activeId ? renderScorekeeper() : renderAssignments(); }, () => toast('Live match sync unavailable.'));
  });
  window.addEventListener('storage', () => { if (!email) return; activeId ? renderScorekeeper() : renderAssignments(); });
})();

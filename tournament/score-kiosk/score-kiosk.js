const revision = new URL(import.meta.url).searchParams.get('v') || 'dev';
const { loadTournamentContext } = await import(`../event-context.js?v=${encodeURIComponent(revision)}`);
await loadTournamentContext();
const { watchAuth, authorizeTournamentTool, watchControl, watchMatches, publishMatch } = await import(`../firebase-sync.js?v=${encodeURIComponent(revision)}`);

(() => {
  const config = window.TOURNAMENT_CONFIG, $ = selector => document.querySelector(selector), $$ = selector => [...document.querySelectorAll(selector)], esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
  document.querySelector('.field-brand img').src = config.brand.logo; const controlLink = document.querySelector('.field-header a'); if (controlLink) controlLink.href = window.MATCHDAY_EVENT_URL('../control.html');
  let state = null, user = null, selectedMatchId = '', matchesReady = false;
  const names = (category, code) => { const pair = state?.pairs?.[`${category}|${code}`] || {}; return [pair.player1, pair.player2].filter(Boolean).join(' / ') || 'Players not assigned'; };
  const display = (category, code) => `${category === 'Novice' ? 'NOV' : category === 'Low Intermediate' ? 'LOW' : category === 'High Intermediate' ? 'HIGH' : String(category).replace(/[^a-z0-9 ]/gi,'').split(/\s+/).filter(Boolean).map(word=>word[0]).join('').slice(0,4).toUpperCase() || 'CAT'}-${code}`;
  const pairRecord = (category, code) => state?.pairs?.[`${category}|${code}`] || state?.pairs?.[category]?.[code] || {};
  const affiliationId = (match, side) => { const pair = pairRecord(match.category, match[side]); return match?.[`${side}AffiliationId`] ?? pair.affiliationId ?? pair.club ?? (side === 'a' ? 'ocpc' : 'rebels'); };
  const affiliation = (match, side) => { const id = affiliationId(match, side); return (config.affiliations || config.clubs || []).find(item => item.id === id) || { id, short:id || (side === 'a' ? 'Side A' : 'Side B') }; };
  const clubName = (match, side) => affiliation(match, side).short || affiliation(match, side).name;
  const toast = message => { const element = $('#officialToast'); element.textContent = message; element.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => element.classList.remove('show'), 1800); };
  const scoreComplete = id => { const score = state?.scores?.[id]; return score && score.a !== '' && score.b !== ''; };

  function courtMatch(courtNo) { const id = state?.courts?.[courtNo]?.matchId; return id ? state.matches?.find(match => match.id === id) : null; }
  function renderCourts() {
    if (!state) return;
    $('#kioskCourts').innerHTML = Array.from({ length: config.event.courts }, (_, index) => {
      const courtNo = index + 1, match = courtMatch(courtNo), officiated = match && Boolean(state.refereeAssignments?.[match.id]), complete = match && scoreComplete(match.id);
      if (!match) return `<article class="kiosk-court vacant"><header><b>Court ${courtNo}</b><span>Vacant</span></header><div><strong>No active match</strong><small>Wait for Match Control to place the next match on court.</small></div></article>`;
      return `<article class="kiosk-court ${officiated ? 'officiated' : ''} ${complete ? 'reported' : ''}"><header><b>Court ${courtNo}</b><span>${officiated ? 'Referee scoring' : complete ? 'Score submitted' : 'Ready to report'}</span></header><div><small>${esc(match.category)} · ${esc(match.id)}</small><section><b>${esc(names(match.category, match.a))}</b><em>vs</em><b>${esc(names(match.category, match.b))}</b></section><button class="action ${officiated || complete ? 'alt' : 'lime'}" data-report-match="${match.id}" ${officiated || complete ? 'disabled' : ''}>${officiated ? 'Report through referee' : complete ? `${state.scores[match.id].a}-${state.scores[match.id].b} recorded` : `Report Court ${courtNo} score`}</button></div></article>`;
    }).join('');
    $$('[data-report-match]').forEach(button => button.onclick = () => openScoreSheet(button.dataset.reportMatch));
  }

  function setupCanvas(canvas) {
    const context = canvas.getContext('2d'); context.lineWidth = 3; context.lineCap = 'round'; context.strokeStyle = '#0b2436'; let drawing = false;
    const position = event => { const rect = canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height }; };
    canvas.onpointerdown = event => { drawing = true; canvas.setPointerCapture?.(event.pointerId); const point = position(event); context.beginPath(); context.moveTo(point.x, point.y); };
    canvas.onpointermove = event => { if (!drawing) return; const point = position(event); context.lineTo(point.x, point.y); context.stroke(); canvas.dataset.signed = '1'; };
    canvas.onpointerup = canvas.onpointercancel = () => { drawing = false; };
  }
  function clearSignature(id) { const canvas = $(`#${id}`); canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height); delete canvas.dataset.signed; }
  function closeScoreSheet() { $('#kioskScoreSheet').hidden = true; selectedMatchId = ''; $('#scoreFormError').textContent = ''; }
  function openScoreSheet(matchId) {
    const match = state.matches.find(item => item.id === matchId); if (!match) return;
    selectedMatchId = matchId; $('#kioskMatchMeta').textContent = `Court ${match.court} · ${match.category} · ${match.id}`;
    $('#kioskMatchup').innerHTML = `<article><span>${esc(clubName(match, 'a'))} · ${display(match.category, match.a)}</span><b>${esc(names(match.category, match.a))}</b></article><strong>VS</strong><article><span>${esc(clubName(match, 'b'))} · ${display(match.category, match.b)}</span><b>${esc(names(match.category, match.b))}</b></article>`;
    $('#kioskScoreALabel').textContent = `${clubName(match, 'a')} score`; $('#kioskScoreBLabel').textContent = `${clubName(match, 'b')} score`;
    $('#signatureALabel').textContent = `${names(match.category, match.a)} signature`; $('#signatureBLabel').textContent = `${names(match.category, match.b)} signature`;
    $('#kioskScoreA').value = ''; $('#kioskScoreB').value = ''; clearSignature('signatureA'); clearSignature('signatureB'); $('#scoreFormError').textContent = ''; $('#kioskScoreSheet').hidden = false;
  }

  setupCanvas($('#signatureA')); setupCanvas($('#signatureB')); $$('[data-clear-signature]').forEach(button => button.onclick = () => clearSignature(button.dataset.clearSignature)); $('#closeKioskScore').onclick = closeScoreSheet; $('#kioskScoreSheet').onclick = event => { if (event.target === $('#kioskScoreSheet')) closeScoreSheet(); };
  $('#scoreReportForm').onsubmit = async event => {
    event.preventDefault(); const match = state.matches.find(item => item.id === selectedMatchId); if (!match) return;
    const a = Number($('#kioskScoreA').value), b = Number($('#kioskScoreB').value), signatureA = $('#signatureA'), signatureB = $('#signatureB'), rules = state.matchSettings?.[match.id] || { target:11, suddenDeathAt:10 }, maximum = Math.max(Number(rules.target)||11, Number(rules.suddenDeathAt||10)+1);
    if (!signatureA.dataset.signed || !signatureB.dataset.signed) return $('#scoreFormError').textContent = 'Both pair representatives must sign before submission.';
    if (!Number.isInteger(a) || !Number.isInteger(b) || a === b || Math.max(a, b) > maximum || Math.min(a, b) < 0) return $('#scoreFormError').textContent = `Enter whole-number scores from 0 to ${maximum}. A timed match may finish below its target, but it cannot end tied.`;
    const prior = state.scores?.[match.id]; if (prior && !confirm(`A result already exists: ${prior.a}-${prior.b}. Send a replacement report?`)) return;
    const live = { ...(state.liveScoring?.[match.id] || {}), a, b, running:false, startedAt:null, complete:true }, submittedAt = new Date().toISOString();
    const score = { a, b, resultType:'player-reported', completedAt: prior?.completedAt || submittedAt, confirmation: { source:'player-kiosk', submittedBy:user.email, submittedAt, aSignature:signatureA.toDataURL(), bSignature:signatureB.toDataURL() } };
    try { await publishMatch(match.id, live, score); state.scores ||= {}; state.scores[match.id] = score; renderCourts(); toast('Both signatures confirmed. Score sent to Match Control.'); closeScoreSheet(); } catch (_) { $('#scoreFormError').textContent = 'Score could not be sent. Ask Match Control to enter it manually.'; }
  };
  watchAuth(async account => {
    user = account; $('#kioskGate').hidden = Boolean(account);
    if (!account) { $('#kioskWorkspace').hidden = true; return; }
    let access; try { access = await authorizeTournamentTool(account, ['tournament_score_desk']); } catch (_) {}
    if (!access?.allowed) { $('#kioskWorkspace').hidden = true; $('#kioskGate').hidden = false; $('#formError').textContent = 'This account does not have Score Desk access for this tournament.'; return; }
    $('#kioskWorkspace').hidden = false;
    watchControl(incoming => { if (!incoming) return; const liveScoring = state?.liveScoring || {}, scores = matchesReady ? (state?.scores || {}) : { ...(incoming.scores || {}), ...(state?.scores || {}) }; state = { ...incoming, liveScoring, scores }; renderCourts(); }, () => $('#formError').textContent = 'Tournament access denied.');
    watchMatches(items => { if (!state) return; const liveScoring = {}, scores = { ...(state.scores || {}) }; items.forEach(item => { if (item.live) liveScoring[item.id] = item.live; if (item.score) scores[item.id] = item.score; }); state.liveScoring = liveScoring; state.scores = scores; matchesReady = true; renderCourts(); }, () => $('#formError').textContent = 'Live courts are unavailable.');
  });
})();

const revision = new URL(import.meta.url).searchParams.get('v') || 'dev';
const { watchAuth, login, logout, watchControl, watchMatches, publishMatch } = await import(`../firebase-sync.js?v=${encodeURIComponent(revision)}`);

(() => {
  const config = window.TOURNAMENT_CONFIG, $ = selector => document.querySelector(selector), $$ = selector => [...document.querySelectorAll(selector)], esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
  let state = null, user = null, selectedMatchId = '';
  const names = (category, code) => { const pair = state?.pairs?.[`${category}|${code}`] || {}; return [pair.player1, pair.player2].filter(Boolean).join(' / ') || 'Players not assigned'; };
  const display = (category, code) => `${category === 'Novice' ? 'NOV' : category === 'Low Intermediate' ? 'LOW' : 'HIGH'}-${code}`;
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
    $('#kioskMatchup').innerHTML = `<article><span>OCPC · ${display(match.category, match.a)}</span><b>${esc(names(match.category, match.a))}</b></article><strong>VS</strong><article><span>Rally Rebels · ${display(match.category, match.b)}</span><b>${esc(names(match.category, match.b))}</b></article>`;
    $('#signatureALabel').textContent = `${names(match.category, match.a)} signature`; $('#signatureBLabel').textContent = `${names(match.category, match.b)} signature`;
    $('#kioskScoreA').value = ''; $('#kioskScoreB').value = ''; clearSignature('signatureA'); clearSignature('signatureB'); $('#scoreFormError').textContent = ''; $('#kioskScoreSheet').hidden = false;
  }

  $('#staffLogin').onclick = async () => { $('#loginError').textContent = 'Signing in…'; try { await login($('#staffEmail').value.trim(), $('#staffPassword').value); } catch (_) { $('#loginError').textContent = 'Sign-in failed or this account lacks score-desk access.'; } };
  setupCanvas($('#signatureA')); setupCanvas($('#signatureB')); $$('[data-clear-signature]').forEach(button => button.onclick = () => clearSignature(button.dataset.clearSignature)); $('#closeKioskScore').onclick = closeScoreSheet; $('#kioskScoreSheet').onclick = event => { if (event.target === $('#kioskScoreSheet')) closeScoreSheet(); };
  $('#scoreReportForm').onsubmit = async event => {
    event.preventDefault(); const match = state.matches.find(item => item.id === selectedMatchId); if (!match) return;
    const a = Number($('#kioskScoreA').value), b = Number($('#kioskScoreB').value), signatureA = $('#signatureA'), signatureB = $('#signatureB');
    if (!signatureA.dataset.signed || !signatureB.dataset.signed) return $('#scoreFormError').textContent = 'Both pair representatives must sign before submission.';
    if (a === b || Math.max(a, b) !== 11 || Math.min(a, b) < 0) return $('#scoreFormError').textContent = 'Enter a valid final score. The winner must reach 11 and the match cannot end tied.';
    const prior = state.scores?.[match.id]; if (prior && !confirm(`A result already exists: ${prior.a}-${prior.b}. Send a replacement report?`)) return;
    const live = { ...(state.liveScoring?.[match.id] || {}), a, b, running:false, startedAt:null, complete:true }, submittedAt = new Date().toISOString();
    const score = { a, b, completedAt: prior?.completedAt || submittedAt, confirmation: { source:'player-kiosk', submittedBy:user.email, submittedAt, ocpcSignature:signatureA.toDataURL(), rebelsSignature:signatureB.toDataURL() } };
    try { await publishMatch(match.id, live, score); toast('Both signatures confirmed. Score sent to Match Control.'); closeScoreSheet(); } catch (_) { $('#scoreFormError').textContent = 'Score could not be sent. Ask Match Control to enter it manually.'; }
  };
  watchAuth(account => {
    user = account; if (!account) { $('#kioskWorkspace').hidden = true; return; }
    $('#staffEmail').value = account.email; $('#kioskLogin').innerHTML = `<div class="session-row"><div><span class="eyebrow">Score desk signed in</span><b>${esc(account.email)}</b></div><button class="action alt" id="staffLogout">Sign out</button></div>`; $('#staffLogout').onclick = logout; $('#kioskWorkspace').hidden = false;
    watchControl(incoming => { state = { ...incoming, liveScoring:state?.liveScoring || {}, scores:{ ...(incoming.scores || {}), ...(state?.scores || {}) } }; renderCourts(); }, () => $('#formError').textContent = 'Tournament access denied.');
    watchMatches(items => { if (!state) return; state.liveScoring = {}; items.forEach(item => { if (item.live) state.liveScoring[item.id] = item.live; if (item.score) state.scores[item.id] = item.score; }); renderCourts(); }, () => $('#formError').textContent = 'Live courts are unavailable.');
  });
})();

const revision = new URL(import.meta.url).searchParams.get('v') || 'dev';
const { watchAuth, login, logout, watchControl, watchMatches, publishControl, publishMatch, deleteMatch, clearMatches, listTournamentStaff, changeTournamentStaffRole } = await import(`./firebase-sync.js?v=${encodeURIComponent(revision)}`);

(() => {
  'use strict';
  const config = window.TOURNAMENT_CONFIG;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const slug = value => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  document.documentElement.style.setProperty('--brand', config.brand.primary);
  document.documentElement.style.setProperty('--brand-dark', config.brand.primaryDark);
  document.documentElement.style.setProperty('--accent', config.brand.accent);
  document.documentElement.style.setProperty('--lime', config.brand.highlight);
  document.documentElement.style.setProperty('--gold', config.brand.gold);

  function seededRandom(seed) {
    let value = seed >>> 0;
    return () => ((value = (value * 1664525 + 1013904223) >>> 0) / 4294967296);
  }
  function timeLabel(totalMinutes) {
    const h24 = Math.floor(totalMinutes / 60), minutes = totalMinutes % 60;
    return `${h24 % 12 || 12}:${String(minutes).padStart(2, '0')} ${h24 >= 12 ? 'PM' : 'AM'}`;
  }
  function defaultPairCounts() { return Object.fromEntries(config.categories.map(category => [category, config.pairsPerCategory[category] || 6])); }
  function pairCount(category, counts = state?.pairCounts || defaultPairCounts()) { return Number(counts[category]) || 1; }
  function totalMatchCount(counts = state?.pairCounts || defaultPairCounts()) { return config.categories.reduce((total, category) => total + pairCount(category, counts) ** 2, 0); }
  function generateMatches(pairCounts) {
    const all = [];
    config.categories.forEach(category => {
      const count = pairCount(category, pairCounts);
      for (let round = 0; round < count; round++) {
        for (let a = 0; a < count; a++) {
          const b = (a + round) % count;
          all.push({ category, round: round + 1, a: `O${a + 1}`, b: `R${b + 1}`, players: [`${category}|O${a + 1}`, `${category}|R${b + 1}`] });
        }
      }
    });
    return all;
  }
  function generateSchedule(pairCounts) {
    const total = totalMatchCount(pairCounts), fullWaves = Math.floor(total / config.event.courts), remainder = total % config.event.courts;
    const capacities = [...Array(fullWaves).fill(config.event.courts), ...(remainder ? [remainder] : [])];
    const source = generateMatches(pairCounts);
    for (let attempt = 1; attempt <= 20000; attempt++) {
      const random = seededRandom(20260919 + attempt * 7919), remaining = [...source], waves = [];
      let previous = new Set(), failed = false;
      for (let w = 0; w < capacities.length; w++) {
        const selected = [], used = new Set(), counts = Object.fromEntries(config.categories.map(c => [c, 0]));
        while (selected.length < capacities[w]) {
          const candidates = remaining.filter(m => !m.players.some(p => used.has(p) || previous.has(p)));
          if (!candidates.length) { failed = true; break; }
          candidates.sort((x, y) => {
            const xs = remaining.filter(m => m.category === x.category).length * 8 - counts[x.category] * 14 + random() * 12;
            const ys = remaining.filter(m => m.category === y.category).length * 8 - counts[y.category] * 14 + random() * 12;
            return ys - xs;
          });
          const match = candidates[0];
          selected.push(match); counts[match.category]++; match.players.forEach(p => used.add(p));
          remaining.splice(remaining.indexOf(match), 1);
        }
        if (failed) break;
        waves.push(selected); previous = new Set(selected.flatMap(m => m.players));
      }
      if (!failed && !remaining.length) {
        let number = 0;
        return waves.flatMap((wave, waveIndex) => wave.map((match, courtIndex) => {
          const start = config.event.roundRobinStartMinutes + waveIndex * config.event.slotMinutes;
          number++;
          return { ...match, id: `RR-${String(number).padStart(3, '0')}`, wave: waveIndex + 1, court: courtIndex + 1, time: `${timeLabel(start)}-${timeLabel(start + config.event.slotMinutes)}` };
        }));
      }
    }
    throw new Error('Unable to generate the tournament draw.');
  }

  function emptyPairs(pairCounts) {
    const pairs = {};
    config.categories.forEach(category => {
      config.clubs.forEach(club => {
        for (let i = 1; i <= pairCount(category, pairCounts); i++) pairs[`${category}|${club.pairPrefix}${i}`] = { player1: '', player2: '' };
      });
    });
    return pairs;
  }
  function blankMedals() {
    return Object.fromEntries(config.categories.map(category => [category, {
      seeded: false,
      sf1: { a: '', b: '', scoreA: '', scoreB: '' },
      sf2: { a: '', b: '', scoreA: '', scoreB: '' },
      bronze: { scoreA: '', scoreB: '' }, final: { scoreA: '', scoreB: '' }
    }]));
  }
  function emptyCourts() { return Object.fromEntries(Array.from({ length: config.event.courts }, (_, i) => [i + 1, { matchId: '', running: false, startedAt: null, elapsed: 0 }])); }
  function freshState(pairCounts = defaultPairCounts()) {
    const matches = generateSchedule(pairCounts);
    return { version: 3, pairCounts, currentWave: 1, matches, queue: matches.map(m => m.id), courts: emptyCourts(), scores: {}, scoreAudit: [], refereeAssignments: {}, checkins: {}, pairs: emptyPairs(pairCounts), medals: blankMedals(), updatedAt: new Date().toISOString() };
  }
  function normalizeState(incoming) {
    const normalized = { ...freshState(incoming?.pairCounts || defaultPairCounts()), ...(incoming || {}) };
    normalized.courts = { ...emptyCourts(), ...(normalized.courts || {}) }; normalized.scores ||= {}; normalized.scoreAudit ||= []; normalized.refereeAssignments ||= {}; normalized.checkins ||= {}; normalized.pairs = { ...emptyPairs(normalized.pairCounts), ...(normalized.pairs || {}) }; normalized.medals = { ...blankMedals(), ...(normalized.medals || {}) };
    const validIds = new Set(normalized.matches.map(match => match.id)), assigned = new Set(Object.values(normalized.courts).map(court => court.matchId).filter(Boolean));
    const preserved = Array.isArray(normalized.queue) ? normalized.queue.filter((id, index, list) => validIds.has(id) && list.indexOf(id) === index && !assigned.has(id) && !(normalized.scores[id]?.a !== '' && normalized.scores[id]?.a !== undefined && normalized.scores[id]?.b !== '' && normalized.scores[id]?.b !== undefined)) : [];
    const missing = normalized.matches.filter(match => !preserved.includes(match.id) && !assigned.has(match.id) && !(normalized.scores[match.id]?.a !== '' && normalized.scores[match.id]?.a !== undefined && normalized.scores[match.id]?.b !== '' && normalized.scores[match.id]?.b !== undefined)).map(match => match.id);
    normalized.queue = [...preserved, ...missing]; normalized.version = 4;
    return normalized;
  }
  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(config.storageKey));
      if (saved?.pairCounts && saved?.matches?.length === totalMatchCount(saved.pairCounts) && saved.pairs && saved.scores) {
        saved.queue ||= saved.matches.filter(m => !saved.scores[m.id]).map(m => m.id);
        saved.courts ||= emptyCourts(); saved.scoreAudit ||= []; saved.refereeAssignments ||= {}; saved.checkins ||= {}; saved.version = 3;
        return normalizeState(saved);
      }
    } catch (_) {}
    return freshState();
  }
  let state = loadState(), activeView = 'overview', standingsCategory = config.categories[0], teamCategory = config.categories[0], medalCategory = config.categories[0], activeMatchId = null, cloudUser = null, cloudApplying = false, cloudSaveTimer;
  function saveState() { state.updatedAt = new Date().toISOString(); localStorage.setItem(config.storageKey, JSON.stringify(state)); if (cloudUser && !cloudApplying) { clearTimeout(cloudSaveTimer); cloudSaveTimer = setTimeout(() => publishControl(state).catch(() => toast('Cloud sync failed. Check Firebase access.')), 180); } }
  function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2200); }
  function pairData(category, code) { return state.pairs[`${category}|${code}`] || { player1: '', player2: '' }; }
  function pairNames(category, code) { const p = pairData(category, code); return [p.player1, p.player2].filter(Boolean).join(' / ') || 'Players not assigned'; }
  function categoryPrefix(category) { return category === 'Novice' ? 'NOV' : category === 'Low Intermediate' ? 'LOW' : 'HIGH'; }
  function displayPair(category, code) { return `${categoryPrefix(category)}-${code}`; }
  function scoreFor(id) { return state.scores[id] || { a: '', b: '' }; }
  function isComplete(id) { const s = scoreFor(id); return s.a !== '' && s.b !== ''; }
  function winnerCode(match) { const score = scoreFor(match.id); if (!isComplete(match.id) || Number(score.a) === Number(score.b)) return ''; return Number(score.a) > Number(score.b) ? match.a : match.b; }

  function standingsFor(category, clubId) {
    const club = config.clubs.find(c => c.id === clubId), opponentPrefix = clubId === 'ocpc' ? 'R' : 'O';
    const rows = Array.from({ length: pairCount(category) }, (_, index) => {
      const code = `${club.pairPrefix}${index + 1}`;
      const relevant = state.matches.filter(m => m.category === category && (clubId === 'ocpc' ? m.a === code : m.b === code));
      let played = 0, wins = 0, pointsFor = 0, pointsAgainst = 0;
      relevant.forEach(match => {
        if (!isComplete(match.id)) return;
        played++;
        const score = scoreFor(match.id), own = Number(clubId === 'ocpc' ? score.a : score.b), against = Number(clubId === 'ocpc' ? score.b : score.a);
        pointsFor += own; pointsAgainst += against;
        if (winnerCode(match) === code && !code.startsWith(opponentPrefix)) wins++;
      });
      return { code, names: pairNames(category, code), played, wins, losses: played - wins, pointsFor, pointsAgainst, diff: pointsFor - pointsAgainst };
    });
    return rows.sort((a, b) => b.wins - a.wins || b.diff - a.diff || b.pointsFor - a.pointsFor || a.code.localeCompare(b.code)).map((row, index) => ({ ...row, rank: index + 1 }));
  }

  function setBrandContent() {
    $('#brandLogo').src = config.brand.logo; $('#brandLogo').alt = `${config.brand.organizer} logo`;
    $('#appName').textContent = config.appName; $('#brandName').textContent = config.brand.shortName;
    $('#eventMiniName').textContent = config.event.name;
    $('#eventMiniMeta').textContent = `${config.event.displayDate} · ${config.event.venue}`;
    $('#eventName').textContent = config.event.name;
    $('#eventDetails').textContent = `${config.event.displayDate} · ${config.event.startTime}-${config.event.endTime} · ${config.event.venue}, ${config.event.location}`;
    $('#scoringNote').textContent = config.scoring.note;
    document.title = `${config.event.name} · ${config.appName}`;
  }
  function metricMarkup() {
    const done = Object.keys(state.scores).filter(id => isComplete(id)).length;
    const matchesTotal = totalMatchCount(), totalPairs = config.categories.reduce((sum, category) => sum + pairCount(category) * config.clubs.length, 0);
    return [
      ['Completed', `${done}/${matchesTotal}`, `${Math.round(done / matchesTotal * 100)}% of round robin`],
      ['Waiting queue', state.queue.filter(id => !isComplete(id)).length, `Rolling next-court dispatch`],
      ['Pairs', totalPairs, `Three competitive categories`],
      ['Medal matches', 12, `Six medals per category`]
    ].map(([label, value, note]) => `<div class="metric"><span>${label}</span><strong>${value}</strong><small>${note}</small></div>`).join('');
  }
  function miniMatchMarkup(match) {
    const score = scoreFor(match.id), done = isComplete(match.id);
    return `<div class="mini-match"><span class="court-pill">Next</span><div class="pair"><b>${displayPair(match.category, match.a)}</b><small>${esc(pairNames(match.category, match.a))}</small></div><span class="vs">vs</span><div class="pair"><b>${displayPair(match.category, match.b)}</b><small>${esc(pairNames(match.category, match.b))}</small></div><button class="score-chip ${done ? 'done' : ''}" data-score-id="${match.id}">${done ? `${score.a}-${score.b}` : 'Add score'}</button></div>`;
  }
  function renderOverview() {
    $('#metricGrid').innerHTML = metricMarkup();
    $('#overviewWave').innerHTML = state.queue.filter(id => !isComplete(id)).slice(0, 5).map(id => state.matches.find(m => m.id === id)).filter(Boolean).map(miniMatchMarkup).join('');
    $('#leaderList').innerHTML = config.categories.map(category => {
      const a = standingsFor(category, 'ocpc')[0], b = standingsFor(category, 'rebels')[0];
      const leader = [a, b].sort((x, y) => y.wins - x.wins || y.diff - x.diff)[0];
      return `<div class="leader-item"><div class="leader-rank">1</div><div><b>${esc(category)} · ${leader.code}</b><small>${esc(leader.names)}</small></div><div class="leader-wins">${leader.wins} W</div></div>`;
    }).join('');
    bindScoreButtons();
  }
  function elapsedSeconds(court) { return (court.elapsed || 0) + (court.running && court.startedAt ? Math.max(0, Math.floor((Date.now() - court.startedAt) / 1000)) : 0); }
  function timerText(seconds) { const sign = seconds > config.scoring.targetSeconds ? '+' : ''; const value = seconds > config.scoring.targetSeconds ? seconds - config.scoring.targetSeconds : seconds; return `${sign}${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`; }
  function timerClass(seconds) { return seconds >= config.scoring.dangerSeconds ? 'timer-danger' : seconds >= config.scoring.warningSeconds ? 'timer-warning' : ''; }
  function waitingIds() { const assigned = new Set(Object.values(state.courts).map(c => c.matchId).filter(Boolean)); return state.queue.filter(id => !isComplete(id) && !assigned.has(id)); }
  function renderCourts() {
    $('#courtGrid').innerHTML = Array.from({ length: config.event.courts }, (_, index) => {
      const courtNo = index + 1, court = state.courts[courtNo], match = state.matches.find(m => m.id === court.matchId);
      if (!match) return `<article class="court-card empty-court"><div><b>Court ${courtNo} available</b><p>Dispatch the next scheduled match.</p><button class="btn btn-primary" data-assign-next="${courtNo}">Send next match</button></div></article>`;
      const live = state.liveScoring?.[match.id], timerSource = live || court, seconds = elapsedSeconds(timerSource), score = live && !isComplete(match.id) ? live : scoreFor(match.id), done = isComplete(match.id), running = Boolean(timerSource.running);
      return `<article class="court-card ${timerClass(seconds)}"><div class="court-head"><b>Court ${courtNo}</b><span class="category-badge">${esc(match.category)}</span></div><div class="court-timer"><span>${running ? 'Match timer · live' : seconds ? 'Timer paused' : 'Ready to start'}</span><strong data-timer-court="${courtNo}">${timerText(seconds)}</strong></div><div class="court-body"><div class="court-pair"><span>OCPC · ${displayPair(match.category, match.a)}</span><strong>${esc(pairNames(match.category, match.a))}</strong></div><div class="court-vs">${live ? `${live.a} · ${live.b}` : 'VS'}</div><div class="court-pair"><span>Rally Rebels · ${displayPair(match.category, match.b)}</span><strong>${esc(pairNames(match.category, match.b))}</strong></div><div class="court-actions"><button class="btn btn-quiet" data-timer-toggle="${courtNo}">${running ? 'Pause' : seconds ? 'Resume' : 'Start timer'}</button><button class="btn btn-quiet" data-release-court="${courtNo}">Return to queue</button><button class="btn ${done ? 'btn-lime' : 'btn-primary'} court-score" data-score-id="${match.id}">${done ? `Result ${score.a}-${score.b}` : 'Finish & enter score'}</button></div></div></article>`;
    }).join('');
    const queued = waitingIds(); $('#queueCount').textContent = `${queued.length} waiting`;
    $('#dispatchQueue').innerHTML = queued.map((id, index) => { const match = state.matches.find(m => m.id === id); return `<div class="queue-match"><span class="queue-order">${index + 1}</span><div><b>${displayPair(match.category, match.a)} vs ${displayPair(match.category, match.b)}</b><small>${esc(match.category)} · planned wave ${match.wave}</small></div><div class="queue-actions"><button data-queue-move="up" data-match-id="${id}" aria-label="Move up">↑</button><button data-queue-move="down" data-match-id="${id}" aria-label="Move down">↓</button><button class="send-court" data-send-match="${id}">Send</button></div></div>`; }).join('');
    bindScoreButtons();
    $$('[data-assign-next]').forEach(btn => btn.onclick = () => assignNext(Number(btn.dataset.assignNext)));
    $$('[data-timer-toggle]').forEach(btn => btn.onclick = () => toggleTimer(Number(btn.dataset.timerToggle)));
    $$('[data-release-court]').forEach(btn => btn.onclick = () => releaseCourt(Number(btn.dataset.releaseCourt)));
    $$('[data-queue-move]').forEach(btn => btn.onclick = () => moveQueue(btn.dataset.matchId, btn.dataset.queueMove === 'up' ? -1 : 1));
    $$('[data-send-match]').forEach(btn => btn.onclick = () => sendMatchToFreeCourt(btn.dataset.sendMatch));
  }
  function assignMatch(courtNo, matchId) { if (!state.courts[courtNo] || state.courts[courtNo].matchId) return false; state.courts[courtNo] = { matchId, running: false, startedAt: null, elapsed: 0 }; state.queue = state.queue.filter(id => id !== matchId); saveState(); renderAll(); return true; }
  function assignNext(courtNo) { const id = waitingIds()[0]; if (!id) return toast('No waiting matches.'); assignMatch(courtNo, id); }
  function sendMatchToFreeCourt(id) { const free = Object.keys(state.courts).find(no => !state.courts[no].matchId); if (!free) return toast('No court is currently available.'); assignMatch(Number(free), id); }
  function fillCourts() { Object.keys(state.courts).forEach(no => { if (!state.courts[no].matchId) { const id = waitingIds()[0]; if (id) state.courts[no] = { matchId: id, running: false, startedAt: null, elapsed: 0 }; } }); state.queue = state.queue.filter(id => !Object.values(state.courts).some(c => c.matchId === id)); saveState(); renderAll(); }
  function toggleTimer(courtNo) { const court = state.courts[courtNo]; if (!court?.matchId) return; const timer = state.liveScoring?.[court.matchId] || court; if (timer.running) { timer.elapsed = elapsedSeconds(timer); timer.running = false; timer.startedAt = null; } else { timer.running = true; timer.startedAt = Date.now(); } saveState(); if (cloudUser && timer !== court) publishMatch(court.matchId, timer, state.scores[court.matchId] || null); renderCourts(); }
  function releaseCourt(courtNo) {
    const court = state.courts[courtNo];
    if (!court?.matchId) return;
    const seconds = elapsedSeconds(state.liveScoring?.[court.matchId] || court);
    const timerWarning = seconds > 0 ? ` The court timer is at ${timerText(seconds)} and will be reset.` : '';
    if (!confirm(`Return ${court.matchId} from Court ${courtNo} to the queue?${timerWarning}`)) return;
    const releasedId = court.matchId;
    if (!isComplete(releasedId)) state.queue.unshift(releasedId);
    delete state.liveScoring?.[releasedId];
    if (cloudUser) deleteMatch(releasedId).catch(() => toast('Returned locally, but cloud timer cleanup failed.'));
    state.courts[courtNo] = { matchId: '', running: false, startedAt: null, elapsed: 0 };
    saveState(); renderAll();
  }
  function moveQueue(id, direction) { const index = state.queue.indexOf(id), next = Math.max(0, Math.min(state.queue.length - 1, index + direction)); if (index < 0 || index === next) return; [state.queue[index], state.queue[next]] = [state.queue[next], state.queue[index]]; saveState(); renderAll(); }
  function renderSchedule() {
    const category = $('#scheduleCategory').value || 'all', status = $('#scheduleStatus').value || 'all', search = $('#scheduleSearch').value.trim().toLowerCase();
    const rows = state.matches.filter(match => {
      const done = isComplete(match.id), haystack = `${match.id} ${match.a} ${match.b} ${pairNames(match.category, match.a)} ${pairNames(match.category, match.b)}`.toLowerCase();
      return (category === 'all' || match.category === category) && (status === 'all' || (status === 'complete') === done) && (!search || haystack.includes(search));
    });
    $('#scheduleBody').innerHTML = rows.map(match => {
      const score = scoreFor(match.id), done = isComplete(match.id);
      const queueIndex = state.queue.indexOf(match.id);
      return `<tr><td>${match.id}</td><td><b>${match.time}</b><small class="table-priority">${queueIndex >= 0 ? `Queue priority ${queueIndex + 1}` : done ? 'Completed' : 'On court'}</small></td><td>${match.court}</td><td>${esc(match.category)}</td><td class="table-pair"><b>${displayPair(match.category, match.a)}</b><small>${esc(pairNames(match.category, match.a))}</small></td><td><button class="score-link ${done ? 'done' : ''}" data-score-id="${match.id}">${done ? `${score.a}-${score.b}` : '— : —'}</button></td><td class="table-pair"><b>${displayPair(match.category, match.b)}</b><small>${esc(pairNames(match.category, match.b))}</small></td><td><span class="status ${done ? 'complete' : ''}">${done ? 'Complete' : 'Pending'}</span></td></tr>`;
    }).join('') || `<tr><td colspan="8">No matches found.</td></tr>`;
    bindScoreButtons();
  }
  function renderStandings() {
    $('#standingsTabs').innerHTML = config.categories.map(category => `<button class="category-tab ${category === standingsCategory ? 'active' : ''}" data-standing-category="${esc(category)}">${esc(category)}</button>`).join('');
    $('#standingsGrid').innerHTML = config.clubs.map(club => {
      const rows = standingsFor(standingsCategory, club.id);
      return `<article class="standing-card"><div class="card-title"><h2>${esc(club.name)}</h2><span>Top 2 advance</span></div><div class="standing-row header"><span>#</span><span>Pair</span><span class="num">P</span><span class="num">W</span><span class="num">L</span><span class="num">+/-</span><span class="num">PF</span></div>${rows.map(r => `<div class="standing-row"><span class="rank">${r.rank}</span><span class="team-name"><b>${r.code}</b><small>${esc(r.names)}</small></span><span class="num">${r.played}</span><span class="num">${r.wins}</span><span class="num">${r.losses}</span><span class="num">${r.diff > 0 ? '+' : ''}${r.diff}</span><span class="num">${r.pointsFor}</span></div>`).join('')}</article>`;
    }).join('');
    $$('[data-standing-category]').forEach(btn => btn.onclick = () => { standingsCategory = btn.dataset.standingCategory; renderStandings(); });
  }
  function renderTeams() {
    $('#teamTabs').innerHTML = config.categories.map(category => `<button class="category-tab ${category === teamCategory ? 'active' : ''}" data-team-category="${esc(category)}">${esc(category)}</button>`).join('');
    const count = pairCount(teamCategory);
    $('#teamGrid').innerHTML = config.clubs.map(club => `<article class="team-card"><div class="card-title"><h2>${esc(club.name)}</h2><span>${count} pairs</span></div>${Array.from({ length: count }, (_, i) => {
      const code = `${club.pairPrefix}${i + 1}`, key = `${teamCategory}|${code}`, pair = state.pairs[key];
      return `<div class="team-row"><label>${code}</label><input value="${esc(pair.player1)}" placeholder="Awaiting registration" readonly><input value="${esc(pair.player2)}" placeholder="Awaiting registration" readonly></div>`;
    }).join('')}</article>`).join('');
    $$('[data-team-category]').forEach(btn => btn.onclick = () => { captureTeamInputs(); teamCategory = btn.dataset.teamCategory; renderTeams(); });
  }
  function captureTeamInputs() { $$('[data-pair-key]').forEach(input => { if (state.pairs[input.dataset.pairKey]) state.pairs[input.dataset.pairKey][input.dataset.field] = input.value.trim(); }); }

  function medalResult(match) {
    if (match.scoreA === '' || match.scoreB === '' || Number(match.scoreA) === Number(match.scoreB)) return { winner: '', loser: '' };
    return Number(match.scoreA) > Number(match.scoreB) ? { winner: match.a, loser: match.b } : { winner: match.b, loser: match.a };
  }
  function seedMedals() {
    const incomplete = state.matches.filter(match => !isComplete(match.id)).length;
    if (incomplete && !confirm(`${incomplete} round-robin matches still have no result. Seed the medal round using the current standings anyway?`)) return;
    config.categories.forEach(category => {
      const ocpc = standingsFor(category, 'ocpc'), rebels = standingsFor(category, 'rebels'), medal = state.medals[category];
      medal.seeded = true; medal.sf1 = { a: ocpc[0].code, b: rebels[1].code, scoreA: '', scoreB: '' }; medal.sf2 = { a: rebels[0].code, b: ocpc[1].code, scoreA: '', scoreB: '' }; medal.bronze = { scoreA: '', scoreB: '' }; medal.final = { scoreA: '', scoreB: '' };
    }); saveState(); renderMedals(); toast('Medal brackets seeded from current standings.');
  }
  function bracketMatch(category, key, label, time, court, a, b, scores) {
    const result = medalResult({ a, b, scoreA: scores.scoreA, scoreB: scores.scoreB });
    const side = (code, score, scoreKey) => `<label class="bracket-side ${result.winner === code && code ? 'winner' : ''}"><span><b>${esc(code || 'TBD')}</b><small>${code ? esc(pairNames(category, code)) : 'Awaiting semifinal'}</small></span><input type="number" min="0" max="17" data-medal-category="${esc(category)}" data-medal-match="${key}" data-medal-side="${scoreKey}" value="${score}"></label>`;
    return `<article class="playoff-match"><div class="bracket-meta"><span>${label}</span><span>${time} · Court ${court}</span></div><div class="bracket-match">${side(a, scores.scoreA, 'scoreA')}${side(b, scores.scoreB, 'scoreB')}</div></article>`;
  }
  function renderMedals() {
    const category = medalCategory, index = config.categories.indexOf(category), medal = state.medals[category], sf1 = medalResult(medal.sf1), sf2 = medalResult(medal.sf2), high = index === 2;
    const bronzeA = sf1.loser, bronzeB = sf2.loser, finalA = sf1.winner, finalB = sf2.winner;
    const finalResult = medalResult({ a: finalA, b: finalB, scoreA: medal.final.scoreA, scoreB: medal.final.scoreB }), bronzeResult = medalResult({ a: bronzeA, b: bronzeB, scoreA: medal.bronze.scoreA, scoreB: medal.bronze.scoreB });
    const podium = (place, code, tone) => `<div class="podium-card ${tone}"><span>${place}</span><strong>${esc(code || 'TBD')}</strong><small>${code ? esc(pairNames(category, code)) : 'Awaiting medal results'}</small></div>`;
    $('#medalBoard').innerHTML = `<article class="playoff-bracket"><header><div><span class="section-label">Championship pathway</span><h2>${esc(category)}</h2><p>Cross-club semifinals feed the championship and battle for third.</p></div><div class="bracket-key"><span>Semifinals</span><b>→</b><span>Medal matches</span></div></header><div class="podium-preview">${podium('Silver', finalResult.loser, 'silver')}${podium('Champion', finalResult.winner, 'gold')}${podium('Bronze', bronzeResult.winner, 'bronze')}</div><div class="playoff-grid"><section class="playoff-stage"><h3>Semifinals</h3>${bracketMatch(category, 'sf1', 'Semifinal 1', '3:30 PM', index * 2 + 1, medal.sf1.a, medal.sf1.b, medal.sf1)}${bracketMatch(category, 'sf2', 'Semifinal 2', high ? '3:45 PM' : '3:30 PM', high ? 1 : index * 2 + 2, medal.sf2.a, medal.sf2.b, medal.sf2)}</section><div class="bracket-connector" aria-hidden="true"></div><section class="playoff-stage medal-stage"><h3>Medal matches</h3>${bracketMatch(category, 'final', 'Championship', high ? '4:15 PM' : '4:00 PM', index * 2 + 2 > 5 ? 2 : index * 2 + 2, finalA, finalB, medal.final)}<span class="bronze-label">Battle for third</span>${bracketMatch(category, 'bronze', 'Bronze medal', high ? '4:15 PM' : '4:00 PM', index * 2 + 1 > 5 ? 1 : index * 2 + 1, bronzeA, bronzeB, medal.bronze)}</section></div></article>`;
    $$('[data-medal-category]').forEach(input => input.onchange = () => { const match = state.medals[input.dataset.medalCategory][input.dataset.medalMatch]; match[input.dataset.medalSide] = input.value === '' ? '' : Number(input.value); saveState(); renderMedals(); });
  }
  async function renderTournamentStaff() {
    const list = $('#tournamentStaffList'); if (!list) return;
    try { const staff = await listTournamentStaff(); list.innerHTML = staff.length ? staff.map(person => { const roles = Array.isArray(person.roles) ? person.roles : [person.role].filter(Boolean); return `<div class="config-row"><span>${esc(person.email || `${person.firstName || ''} ${person.lastName || ''}`)}</span><b>${roles.filter(role => role.startsWith('tournament_') || role === 'match_control').map(role => ({match_control:'Match Control',tournament_registration:'Registration',tournament_checkin:'Check-In',tournament_score_desk:'Score Kiosk'}[role])).filter(Boolean).join(', ')}</b></div>`; }).join('') : '<div class="config-row"><span>No tournament staff assigned</span></div>'; }
    catch (_) { list.innerHTML = '<div class="config-row"><span>Only an administrator can view and change staff access.</span></div>'; }
  }
  function renderSettings() {
    $('#configList').innerHTML = [['Organizer', config.brand.organizer], ['Event', config.event.name], ['Venue', `${config.event.venue}, ${config.event.location}`], ['Courts', config.event.courts], ['Categories', config.categories.join(', ')], ['Storage', 'Firebase live sync with local cache']].map(([a, b]) => `<div class="config-row"><span>${esc(a)}</span><b>${esc(b)}</b></div>`).join('');
    const assignedIds = Object.keys(state.refereeAssignments);
    $('#refereeMatch').innerHTML = state.matches.filter(m => !isComplete(m.id)).map(m => `<option value="${m.id}">${m.id} · ${displayPair(m.category,m.a)} vs ${displayPair(m.category,m.b)}</option>`).join('');
    $('#refereeList').innerHTML = assignedIds.length ? assignedIds.map(id => `<div class="config-row"><span>${id}</span><b>${esc(state.refereeAssignments[id])}</b></div>`).join('') : '<div class="config-row"><span>No referees assigned yet</span></div>';
    $('#pairCountSettings').innerHTML = config.categories.map(category => `<label>${esc(category)}<input type="number" min="2" max="12" value="${pairCount(category)}" data-pair-count="${esc(category)}"></label>`).join('');
    renderTournamentStaff();
  }
  function renderAll() { const total = totalMatchCount(); $('#heroMatchCount').textContent = total; $('#scheduleMatchCount').textContent = `All ${total} matches`; renderOverview(); renderCourts(); renderSchedule(); renderStandings(); renderTeams(); renderMedals(); renderSettings(); }
  function changeWave(delta) { const waves = Math.ceil(totalMatchCount() / config.event.courts); state.currentWave = Math.max(1, Math.min(waves, state.currentWave + delta)); saveState(); renderOverview(); renderCourts(); }
  function showView(name) {
    activeView = name; $$('.view').forEach(view => view.classList.toggle('active', view.id === `view-${name}`)); $$('.nav-item').forEach(btn => btn.classList.toggle('active', btn.dataset.view === name)); $('#sidebar').classList.remove('open');
    if (name === 'schedule') renderSchedule(); if (name === 'standings') renderStandings(); if (name === 'medals') renderMedals();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function bindScoreButtons() { $$('[data-score-id]').forEach(button => button.onclick = () => openScore(button.dataset.scoreId)); }
  function openScore(id) {
    const match = state.matches.find(m => m.id === id); if (!match) return;
    activeMatchId = id; const score = scoreFor(id);
    $('#scoreMeta').textContent = `${match.id} · Wave ${match.wave} · Court ${match.court} · ${match.category}`;
    $('#scoreTitle').textContent = match.time; $('#sideALabel').textContent = `OCPC · ${match.a}`; $('#sideBLabel').textContent = `Rally Rebels · ${match.b}`;
    $('#sideAName').textContent = pairNames(match.category, match.a); $('#sideBName').textContent = pairNames(match.category, match.b);
    $('#scoreA').value = score.a; $('#scoreB').value = score.b; $('#scoreMessage').textContent = ''; $('#scoreModal').hidden = false; setTimeout(() => $('#scoreA').focus(), 30);
  }
  function closeScore() { $('#scoreModal').hidden = true; activeMatchId = null; }
  function saveScore() {
    const a = $('#scoreA').value, b = $('#scoreB').value;
    if (a === '' || b === '') { $('#scoreMessage').textContent = 'Enter both scores, or choose Clear score.'; return; }
    const na = Number(a), nb = Number(b);
    if (na === nb) { $('#scoreMessage').textContent = 'Matches need a winner. Play one deciding rally.'; return; }
    if (na < 0 || nb < 0 || na > config.scoring.hardCap || nb > config.scoring.hardCap) { $('#scoreMessage').textContent = `Scores must be between 0 and ${config.scoring.hardCap}.`; return; }
    if (Math.max(na, nb) !== config.scoring.target) { $('#scoreMessage').textContent = `The winning score must be ${config.scoring.target}. At 10-10, the next point wins 11-10.`; return; }
    const prior = state.scores[activeMatchId];
    if (prior && (Number(prior.a) !== na || Number(prior.b) !== nb) && !confirm(`Warning: this revises a recorded result from ${prior.a}-${prior.b} to ${na}-${nb}. Continue?`)) return;
    if (prior) state.scoreAudit.push({ matchId: activeMatchId, previous: prior, revised: { a: na, b: nb }, revisedAt: new Date().toISOString(), source: 'match-control' });
    state.scores[activeMatchId] = { a: na, b: nb };
    if (cloudUser) publishMatch(activeMatchId, state.liveScoring?.[activeMatchId] || { a: na, b: nb, complete: true }, state.scores[activeMatchId]).catch(() => toast('Result saved locally; cloud sync failed.'));
    const courtNo = Object.keys(state.courts).find(no => state.courts[no].matchId === activeMatchId);
    if (courtNo) { state.courts[courtNo] = { matchId: '', running: false, startedAt: null, elapsed: 0 }; const nextId = waitingIds()[0]; if (nextId) state.courts[courtNo] = { matchId: nextId, running: false, startedAt: null, elapsed: 0 }; state.queue = state.queue.filter(id => id !== nextId); }
    saveState(); closeScore(); renderAll(); toast('Result saved. The next match is ready.');
  }
  function clearScore() { if (activeMatchId) delete state.scores[activeMatchId]; saveState(); closeScore(); renderAll(); toast('Score cleared.'); }
  function exportBackup() {
    const blob = new Blob([JSON.stringify({ configSnapshot: config, state }, null, 2)], { type: 'application/json' }), link = document.createElement('a');
    link.href = URL.createObjectURL(blob); link.download = `${slug(config.event.name)}-backup.json`; link.click(); URL.revokeObjectURL(link.href);
  }
  async function importBackup(file) {
    try { const data = JSON.parse(await file.text()), incoming = data.state || data; if (!incoming.matches || !incoming.pairs || !incoming.scores) throw new Error(); state = incoming; saveState(); renderAll(); toast('Tournament backup restored.'); }
    catch (_) { alert('That file is not a valid Matchday tournament backup.'); }
  }
  function applyPairCounts() {
    const counts = Object.fromEntries($$('[data-pair-count]').map(input => [input.dataset.pairCount, Math.max(2, Math.min(12, Number(input.value) || 2))]));
    const summary = config.categories.map(category => `${category}: ${counts[category]}`).join('\n');
    if (!confirm(`Regenerate the full round-robin draw with these pair counts?\n\n${summary}\n\nThis clears current rosters, scores, court assignments, referee assignments, and check-ins.`)) return;
    state = freshState(counts); saveState(); renderAll(); showView('settings'); toast(`Draw regenerated with ${totalMatchCount()} matches.`);
  }
  function showCloudGate(message = '') {
    let gate = $('#cloudGate');
    if (!gate) { document.body.insertAdjacentHTML('beforeend', `<div class="cloud-gate" id="cloudGate"><form class="cloud-login" id="cloudLogin"><img src="${config.brand.logo}" alt=""><span class="brand-product">Private tournament desk</span><h2>Match Control sign in</h2><p>This unlisted event workspace requires an authorized Firebase account.</p><input id="cloudEmail" type="email" placeholder="Admin email" required><input id="cloudPassword" type="password" placeholder="Password" required><button class="btn btn-primary">Sign in</button><small id="cloudError"></small></form></div>`); gate = $('#cloudGate'); $('#cloudLogin').onsubmit = async event => { event.preventDefault(); $('#cloudError').textContent = 'Signing in…'; try { await login($('#cloudEmail').value.trim(), $('#cloudPassword').value); } catch (_) { $('#cloudError').textContent = 'Sign-in failed or this account is not authorized.'; } }; }
    $('#cloudError').textContent = message;
  }
  function startCloud() {
    watchAuth(user => {
      cloudUser = user;
      if (!user) return showCloudGate();
      $('#cloudGate')?.remove();
      watchControl(incoming => { if (!incoming) { publishControl(state).catch(() => showCloudGate('Your account cannot initialize this event.')); return; } cloudApplying = true; state = { ...normalizeState(incoming), liveScoring: state.liveScoring || {} }; localStorage.setItem(config.storageKey, JSON.stringify(state)); renderAll(); cloudApplying = false; }, () => showCloudGate('Your account does not have Match Control access.'));
      $('#cloudSessionBtn').textContent = 'Sign out'; $('#cloudSessionBtn').title = `Signed in as ${user.email}`;
      watchMatches(items => { cloudApplying = true; state.liveScoring = {}; items.forEach(item => { if (item.live) state.liveScoring[item.id] = item.live; if (item.score) state.scores[item.id] = item.score; }); localStorage.setItem(config.storageKey, JSON.stringify(state)); renderAll(); cloudApplying = false; }, () => toast('Live match feed unavailable.'));
    });
  }

  setBrandContent();
  config.categories.forEach(category => $('#scheduleCategory').insertAdjacentHTML('beforeend', `<option value="${esc(category)}">${esc(category)}</option>`));
  config.categories.forEach(category => $('#medalCategorySelect').insertAdjacentHTML('beforeend', `<option value="${esc(category)}">${esc(category)}</option>`));
  $$('.nav-item').forEach(button => button.onclick = () => showView(button.dataset.view)); $$('[data-go]').forEach(button => button.onclick = () => showView(button.dataset.go));
  $('#menuBtn').onclick = () => $('#sidebar').classList.toggle('open');
  $('#fillCourtsBtn').onclick = fillCourts;
  $('#scheduleCategory').onchange = renderSchedule; $('#scheduleStatus').onchange = renderSchedule; $('#scheduleSearch').oninput = renderSchedule;
  $('#quickScoreBtn').onclick = () => { const next = state.matches.find(m => m.wave === state.currentWave && !isComplete(m.id)) || state.matches.find(m => !isComplete(m.id)); next ? openScore(next.id) : toast('All round-robin results are complete.'); };
  $('#seedMedalsBtn').onclick = seedMedals; $('#printBtn').onclick = () => window.print(); $('#exportBtn').onclick = exportBackup; $('#importInput').onchange = event => { if (event.target.files[0]) importBackup(event.target.files[0]); event.target.value = ''; };
  $('#medalCategorySelect').onchange = event => { medalCategory = event.target.value; renderMedals(); };
  $('#assignRefereeBtn').onclick = () => { const email = $('#refereeEmail').value.trim().toLowerCase(), matchId = $('#refereeMatch').value; if (!email || !matchId) return toast('Choose a match and enter a referee email.'); state.refereeAssignments[matchId] = email; saveState(); renderSettings(); toast('Referee assigned.'); };
  $('#staffAccessBtn').onclick = async () => { const email = $('#staffAccessEmail').value.trim().toLowerCase(), role = $('#staffAccessRole').value, enabled = $('#staffAccessAction').value === 'grant'; if (!email) return toast('Enter the staff member’s website account email.'); $('#staffAccessBtn').disabled = true; try { await changeTournamentStaffRole(email, role, enabled); $('#staffAccessEmail').value = ''; await renderTournamentStaff(); toast(enabled ? 'Tournament access granted.' : 'Tournament access removed.'); } catch (error) { alert(error.message === 'NO_ACCOUNT' ? 'No OCPC website account uses that email yet. The staff member must create an account first.' : 'Only a site administrator can change tournament staff access.'); } finally { $('#staffAccessBtn').disabled = false; } };
  $('#applyPairCountsBtn').onclick = applyPairCounts;
  $('#cloudSessionBtn').onclick = () => logout();
  $('#resetBtn').onclick = async () => { if (!confirm('Permanently reset every roster, score, timer, queue position, court assignment, referee assignment, check-in, standing, and medal result for this event?')) return; $('#resetBtn').disabled = true; try { if (cloudUser) await clearMatches(); state = freshState(); localStorage.removeItem(config.storageKey); saveState(); if (cloudUser) await publishControl(state); renderAll(); toast('Tournament and all cloud match data reset.'); } catch (_) { alert('The reset did not fully complete. Check your connection and try again.'); } finally { $('#resetBtn').disabled = false; } };
  $('#modalClose').onclick = closeScore; $('#scoreModal').onclick = event => { if (event.target === $('#scoreModal')) closeScore(); }; $('#saveScoreBtn').onclick = saveScore; $('#clearScoreBtn').onclick = clearScore;
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('#scoreModal').hidden) closeScore(); });
  window.addEventListener('storage', event => { if (event.key !== config.storageKey || !event.newValue) return; try { state = JSON.parse(event.newValue); renderAll(); } catch (_) {} });
  setInterval(() => { if (activeView === 'courts' && Object.values(state.courts).some(c => c.running)) renderCourts(); }, 1000);
  renderAll(); showView(activeView); startCloud();
})();

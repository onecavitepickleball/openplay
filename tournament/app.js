const revision = new URL(import.meta.url).searchParams.get('v') || 'dev';
const { watchAuth, login, logout, watchControl, watchMatches, watchRegistrations, watchCheckins, publishControl, publishMatch, deleteMatch, clearMatches, clearCheckins, listTournamentStaff, changeTournamentStaffRole } = await import(`./firebase-sync.js?v=${encodeURIComponent(revision)}`);

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
    const categoryTotals = Object.fromEntries(config.categories.map(category => [category, pairCount(category, pairCounts) ** 2]));
    for (let attempt = 1; attempt <= 50000; attempt++) {
      const random = seededRandom(20260919 + attempt * 7919), remaining = [...source], waves = [];
      const lastPlayed = new Map(), appearances = new Map(), completedByCategory = Object.fromEntries(config.categories.map(category => [category, 0]));
      let previous = new Set(), failed = false;
      for (let w = 0; w < capacities.length; w++) {
        const selected = [], used = new Set(), counts = Object.fromEntries(config.categories.map(c => [c, 0]));
        while (selected.length < capacities[w]) {
          const eligible = remaining.filter(m => !m.players.some(p => used.has(p) || previous.has(p))), preferredCategories = w === 0 ? ['Novice'] : w === 1 ? ['Low Intermediate'] : w < 4 ? ['Novice', 'Low Intermediate'] : config.categories;
          const preferred = eligible.filter(match => preferredCategories.includes(match.category)), candidates = preferred.length >= capacities[w] - selected.length ? preferred : eligible;
          if (!candidates.length) { failed = true; break; }
          candidates.sort((x, y) => {
            const phase = w < 8 ? 'Novice' : w < 17 ? 'Low Intermediate' : 'High Intermediate';
            const score = match => {
              const playerWait = Math.max(...match.players.map(player => lastPlayed.has(player) ? w - lastPlayed.get(player) : 5));
              const playerLoad = match.players.reduce((sum, player) => sum + (appearances.get(player) || 0), 0);
              const phaseBonus = match.category === phase ? 88 : config.categories.indexOf(match.category) === config.categories.indexOf(phase) + 1 ? 28 : 8;
              const completionRatio = completedByCategory[match.category] / categoryTotals[match.category];
              return phaseBonus + playerWait * 36 - playerLoad * 7 - counts[match.category] * 10 - completionRatio * 35 + random() * 8;
            };
            const xs = score(x), ys = score(y);
            return ys - xs;
          });
          const match = candidates[0];
          selected.push(match); counts[match.category]++; match.players.forEach(p => used.add(p));
          remaining.splice(remaining.indexOf(match), 1);
        }
        if (failed) break;
        waves.push(selected); previous = new Set(selected.flatMap(m => m.players));
        selected.forEach(match => { completedByCategory[match.category]++; match.players.forEach(player => { lastPlayed.set(player, w); appearances.set(player, (appearances.get(player) || 0) + 1); }); });
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
  function blankDreamBreaker() { return { enabled: false, target: 52, scores: { ocpc: 0, rebels: 0 }, history: [] }; }
  function emptyCourts() { return Object.fromEntries(Array.from({ length: config.event.courts }, (_, i) => [i + 1, { matchId: '', running: false, startedAt: null, elapsed: 0 }])); }
  function initialCourtSchedules(matches) { return Object.fromEntries(Array.from({ length: config.event.courts }, (_, i) => [i + 1, matches.filter(match => match.court === i + 1).sort((a, b) => a.wave - b.wave).map(match => match.id)])); }
  function freshState(pairCounts = defaultPairCounts()) {
    const matches = generateSchedule(pairCounts);
    return { version: 7, schedulerVersion: 2, pairCounts, currentWave: 1, matches, queue: matches.map(m => m.id), courtSchedules: initialCourtSchedules(matches), courts: emptyCourts(), matchSettings: {}, scores: {}, scoreAudit: [], refereeAssignments: {}, checkins: {}, pairs: emptyPairs(pairCounts), medals: blankMedals(), dreamBreaker: blankDreamBreaker(), updatedAt: new Date().toISOString() };
  }
  function normalizeState(incoming) {
    const normalized = { ...freshState(incoming?.pairCounts || defaultPairCounts()), ...(incoming || {}) };
    const safeToReschedule = !Object.keys(incoming?.scores || {}).length && !Object.values(incoming?.courts || {}).some(court => court?.matchId);
    if (incoming?.schedulerVersion !== 2 && safeToReschedule) { const matches = generateSchedule(normalized.pairCounts); normalized.matches = matches; normalized.queue = matches.map(match => match.id); normalized.courtSchedules = initialCourtSchedules(matches); normalized.courts = emptyCourts(); normalized.schedulerVersion = 2; }
    normalized.courts = { ...emptyCourts(), ...(normalized.courts || {}) }; normalized.matchSettings ||= {}; normalized.scores ||= {}; normalized.scoreAudit ||= []; normalized.refereeAssignments ||= {}; normalized.checkins ||= {}; normalized.pairs = { ...emptyPairs(normalized.pairCounts), ...(normalized.pairs || {}) }; normalized.medals = { ...blankMedals(), ...(normalized.medals || {}) }; normalized.dreamBreaker = { ...blankDreamBreaker(), ...(normalized.dreamBreaker || {}), scores: { ...blankDreamBreaker().scores, ...(normalized.dreamBreaker?.scores || {}) }, history: normalized.dreamBreaker?.history || [] };
    normalized.courtSchedules ||= initialCourtSchedules(normalized.matches);
    const scheduled = new Set();
    Object.keys(normalized.courtSchedules).forEach(no => { normalized.courtSchedules[no] = (normalized.courtSchedules[no] || []).filter(id => validMatch(normalized, id) && !scheduled.has(id) && (scheduled.add(id) || true)); });
    normalized.matches.forEach(match => { if (!scheduled.has(match.id)) (normalized.courtSchedules[match.court] ||= []).push(match.id); });
    const validIds = new Set(normalized.matches.map(match => match.id)), assigned = new Set(Object.values(normalized.courts).map(court => court.matchId).filter(Boolean));
    const preserved = Array.isArray(normalized.queue) ? normalized.queue.filter((id, index, list) => validIds.has(id) && list.indexOf(id) === index && !assigned.has(id) && !(normalized.scores[id]?.a !== '' && normalized.scores[id]?.a !== undefined && normalized.scores[id]?.b !== '' && normalized.scores[id]?.b !== undefined)) : [];
    const missing = normalized.matches.filter(match => !preserved.includes(match.id) && !assigned.has(match.id) && !(normalized.scores[match.id]?.a !== '' && normalized.scores[match.id]?.a !== undefined && normalized.scores[match.id]?.b !== '' && normalized.scores[match.id]?.b !== undefined)).map(match => match.id);
    normalized.queue = [...preserved, ...missing]; normalized.version = 7;
    return normalized;
  }
  function validMatch(target, id) { return target.matches.some(match => match.id === id); }
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
  let state = loadState(), registrations = [], controlReady = false, activeView = 'overview', standingsCategory = config.categories[0], teamCategory = config.categories[0], medalCategory = config.categories[0], activeMatchId = null, cloudUser = null, cloudApplying = false, cloudSaveTimer;
  function saveState() { state.updatedAt = new Date().toISOString(); localStorage.setItem(config.storageKey, JSON.stringify(state)); if (cloudUser && !cloudApplying) { clearTimeout(cloudSaveTimer); cloudSaveTimer = setTimeout(() => publishControl(state).catch(() => toast('Cloud sync failed. Check Firebase access.')), 180); } }
  function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2200); }
  function pairData(category, code) { return state.pairs[`${category}|${code}`] || { player1: '', player2: '' }; }
  function pairNames(category, code) { const p = pairData(category, code); return [p.player1, p.player2].filter(Boolean).join(' / ') || 'Players not assigned'; }
  function categoryPrefix(category) { return category === 'Novice' ? 'NOV' : category === 'Low Intermediate' ? 'LOW' : 'HIGH'; }
  function displayPair(category, code) { return `${categoryPrefix(category)}-${code}`; }
  function categoryClass(category) { return `category-${slug(category)}`; }
  function scoreFor(id) { return state.scores[id] || { a: '', b: '' }; }
  function isComplete(id) { const s = scoreFor(id); return s.a !== '' && s.b !== ''; }
  function winnerCode(match) { const score = scoreFor(match.id); if (!isComplete(match.id) || Number(score.a) === Number(score.b)) return ''; return Number(score.a) > Number(score.b) ? match.a : match.b; }
  function hydrateRegisteredTeams(shouldSave = true) {
    if (!controlReady) return false;
    const pairs = emptyPairs(state.pairCounts);
    registrations.filter(item => item.status === 'confirmed' && item.category && item.pairCode && item.players?.length >= 2).forEach(item => { const key = `${item.category}|${item.pairCode}`; if (pairs[key]) pairs[key] = { player1: item.players[0].fullName || '', player2: item.players[1].fullName || '', registrationId: item.id }; });
    if (JSON.stringify(pairs) === JSON.stringify(state.pairs)) return false;
    state.pairs = pairs; if (shouldSave) saveState(); return true;
  }

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
  function scheduledWaiting(courtNo) { const waiting = new Set(waitingIds()); return (state.courtSchedules?.[courtNo] || []).filter(id => waiting.has(id)); }
  function nextForCourt(courtNo) { return scheduledWaiting(courtNo)[0] || waitingIds()[0]; }
  function syncQueueFromCourtSchedules() {
    const waiting = new Set(waitingIds()), ordered = [];
    const longest = Math.max(0, ...Object.values(state.courtSchedules).map(ids => ids.length));
    for (let row = 0; row < longest; row++) for (let court = 1; court <= config.event.courts; court++) { const id = state.courtSchedules[court]?.[row]; if (id && waiting.has(id)) { ordered.push(id); waiting.delete(id); } }
    state.queue = [...ordered, ...waiting];
  }
  function slotMinutesFor(courtNo, id) { const index = (state.courtSchedules[courtNo] || []).indexOf(id); return config.event.roundRobinStartMinutes + Math.max(0, index) * config.event.slotMinutes; }
  function plannedLabel(courtNo, id) { const start = slotMinutesFor(courtNo, id); return `${timeLabel(start)}-${timeLabel(start + config.event.slotMinutes)}`; }
  function matchPlayers(id) { return state.matches.find(match => match.id === id)?.players || []; }
  function checkinPhoto(category, code, clubId, index) { return Object.values(state.checkins || {}).find(item => item.category === category && item.pair === code && item.club === clubId && Number(item.playerIndex) === index)?.photoThumb || ''; }
  function playerPortraits(match, side) { const code = side === 'a' ? match.a : match.b, clubId = side === 'a' ? 'ocpc' : 'rebels', pair = pairData(match.category, code); return [pair.player1, pair.player2].map((name, index) => { const photo = checkinPhoto(match.category, code, clubId, index); return `<span>${photo ? `<img src="${photo}" alt="">` : '<i class="court-photo-placeholder"></i>'}<b>${esc(name || 'Player pending')}</b></span>`; }).join(''); }
  function defaultMatchRules(mode = 'round-robin') { return mode === 'gold-final' ? { mode, label: 'Gold / Silver', scoring: 'side-out', target: 15, suddenDeathAt: 19, timer: false } : mode === 'custom' ? { mode, label: 'Custom', scoring: 'side-out', target: 11, suddenDeathAt: 10, timer: true } : { mode: 'round-robin', label: 'Round Robin', scoring: 'side-out', target: 11, suddenDeathAt: 10, timer: true }; }
  function rulesFor(id) { return state.matchSettings[id] ||= defaultMatchRules(); }
  function conflictsFor(id, courtNo) {
    const players = matchPlayers(id), conflicts = [], schedule = state.courtSchedules[courtNo] || [], index = schedule.indexOf(id), slot = slotMinutesFor(courtNo, id);
    const eventDate = new Date(`${config.event.date}T00:00:00`), now = new Date(), current = now.getHours() * 60 + now.getMinutes(), operationallyNear = now.toDateString() === eventDate.toDateString() && Math.abs(slot - current) <= 30;
    if (operationallyNear) {
      Object.entries(state.courts).forEach(([otherCourt, active]) => { if (Number(otherCourt) !== Number(courtNo) && active.matchId && matchPlayers(active.matchId).some(player => players.includes(player))) conflicts.push(`Player currently active on Court ${otherCourt}`); });
      state.matches.filter(match => match.id !== id && isComplete(match.id) && matchPlayers(match.id).some(player => players.includes(player))).forEach(match => { const finished = Date.parse(scoreFor(match.id).completedAt || ''); if (Number.isFinite(finished) && Date.now() - finished < config.event.slotMinutes * 60000) conflicts.push('Player just finished and needs a rest slot'); });
      Object.entries(state.courtSchedules).forEach(([otherCourt, ids]) => ids.forEach(otherId => { if (otherId === id || isComplete(otherId)) return; if (slotMinutesFor(Number(otherCourt), otherId) === slot && matchPlayers(otherId).some(player => players.includes(player))) conflicts.push(`Player also scheduled on Court ${otherCourt} at ${timeLabel(slot)}`); }));
      [schedule[index - 1], schedule[index + 1]].filter(Boolean).forEach(otherId => { if (matchPlayers(otherId).some(player => players.includes(player))) conflicts.push('Back-to-back match with no rest slot'); });
    }
    return [...new Set(conflicts)];
  }
  function courtScheduleStatus(courtNo) {
    const next = scheduledWaiting(courtNo)[0]; if (!next) return { tone: 'safe', text: 'Schedule complete', minutes: 0 };
    const eventDate = new Date(`${config.event.date}T00:00:00`), now = new Date();
    if (now.toDateString() !== eventDate.toDateString()) return { tone: 'safe', text: 'On schedule', minutes: 0 };
    const current = now.getHours() * 60 + now.getMinutes(), delta = current - slotMinutesFor(courtNo, next);
    return delta > 4 ? { tone: delta >= 15 ? 'danger' : 'warn', text: `${delta} min delayed`, minutes: delta } : delta < -4 ? { tone: 'safe', text: `${Math.abs(delta)} min ahead`, minutes: delta } : { tone: 'safe', text: 'On schedule', minutes: delta };
  }
  function renderCourtTimeline() {
    const rows = Math.max(0, ...Object.values(state.courtSchedules).map(ids => ids.length)), start = config.event.roundRobinStartMinutes;
    const headers = `<div class="calendar-corner">Time</div>${Array.from({ length: config.event.courts }, (_, i) => { const courtNo = i + 1, status = courtScheduleStatus(courtNo); return `<header class="timeline-head ${status.tone}"><div><b>Court ${courtNo}</b><small>${scheduledWaiting(courtNo).length} scheduled</small></div><strong>${status.text}</strong></header>`; }).join('')}`;
    const liveRow = `<div class="calendar-live-label">LIVE<br>COURT</div>${Array.from({ length: config.event.courts }, (_, i) => activeCourtMarkup(i + 1)).join('')}`;
    const scheduleRows = Array.from({ length: rows }, (_, row) => `<div class="calendar-time">${timeLabel(start + row * config.event.slotMinutes)}</div>${Array.from({ length: config.event.courts }, (_, i) => scheduleCellMarkup(i + 1, row)).join('')}`).join('');
    const eventDate = new Date(`${config.event.date}T00:00:00`), now = new Date(), minute = now.getHours() * 60 + now.getMinutes(), showNeedle = now.toDateString() === eventDate.toDateString() && minute >= start && minute <= start + rows * config.event.slotMinutes;
    $('#courtTimeline').innerHTML = `${headers}${liveRow}${scheduleRows}${showNeedle ? `<div class="current-time-needle" style="--needle-row:${(minute - start) / config.event.slotMinutes}"><span>${timeLabel(minute)}</span></div>` : ''}`;
    $$('[data-drag-match]').forEach(card => card.ondragstart = event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', card.dataset.dragMatch); card.classList.add('dragging'); });
    $$('[data-drag-match]').forEach(card => card.ondragend = () => card.classList.remove('dragging'));
    $$('[data-drop-court]').forEach(cell => { cell.ondragover = event => { event.preventDefault(); cell.classList.add('drag-over'); }; cell.ondragleave = () => cell.classList.remove('drag-over'); cell.ondrop = event => { event.preventDefault(); cell.classList.remove('drag-over'); moveScheduledMatch(event.dataTransfer.getData('text/plain'), Number(cell.dataset.dropCourt), Number(cell.dataset.dropIndex)); }; });
    bindCourtControls();
  }
  function scheduleCellMarkup(courtNo, row) {
    const id = state.courtSchedules[courtNo]?.[row], match = state.matches.find(item => item.id === id), active = Object.values(state.courts).some(court => court.matchId === id), done = id && isComplete(id), conflicts = id ? conflictsFor(id, courtNo) : [];
    if (!match) return `<div class="calendar-cell empty" data-drop-court="${courtNo}" data-drop-index="${row}"></div>`;
    return `<div class="calendar-cell" data-drop-court="${courtNo}" data-drop-index="${row}"><article class="timeline-match ${categoryClass(match.category)} ${conflicts.length ? 'has-conflict' : ''} ${active ? 'on-court' : ''} ${done ? 'completed' : ''}" draggable="${!active && !done}" data-drag-match="${id}" title="${esc(conflicts.join(' · '))}"><div class="timeline-pairs"><small>${match.id} · ${esc(match.category)}</small><b>${esc(pairNames(match.category, match.a))}</b><span>vs</span><b>${esc(pairNames(match.category, match.b))}</b>${active ? '<em>Currently on court</em>' : done ? `<em>Final ${scoreFor(id).a}-${scoreFor(id).b}</em>` : conflicts.length ? `<em>${esc(conflicts[0])}</em>` : ''}</div>${conflicts.length ? '<span class="conflict-mark">!</span>' : ''}</article></div>`;
  }
  function activeCourtMarkup(courtNo) {
    const court = state.courts[courtNo], match = state.matches.find(item => item.id === court.matchId), next = nextForCourt(courtNo);
    if (!match) return `<section class="active-court empty"><b>Court vacant</b><small>${next ? `${next} is next at ${plannedLabel(courtNo, next).split('-')[0]}` : 'Schedule complete'}</small>${next ? `<button class="btn btn-primary" data-promote-court="${courtNo}">Promote next match</button>` : ''}</section>`;
    const live = state.liveScoring?.[match.id] || court, rules = rulesFor(match.id), seconds = elapsedSeconds(live), done = isComplete(match.id), started = seconds > 0 || live.running || Number(live.a) > 0 || Number(live.b) > 0;
    return `<section class="active-court ${categoryClass(match.category)} ${timerClass(seconds)}"><div class="active-court-top"><span>${match.id} · ${esc(match.category)}</span><b>${live.running ? 'LIVE' : done ? 'FINAL' : 'READY'}</b></div><div class="active-score"><div class="active-team"><div>${playerPortraits(match, 'a')}</div><strong>${esc(pairNames(match.category, match.a))}</strong></div><b>${live.a ?? 0}<small>–</small>${live.b ?? 0}</b><div class="active-team"><div>${playerPortraits(match, 'b')}</div><strong>${esc(pairNames(match.category, match.b))}</strong></div></div><div class="court-rule-bar"><select data-rule-mode="${courtNo}" ${started ? 'disabled' : ''}><option value="round-robin" ${rules.mode === 'round-robin' ? 'selected' : ''}>Round Robin</option><option value="gold-final" ${rules.mode === 'gold-final' ? 'selected' : ''}>Gold / Silver</option><option value="custom" ${rules.mode === 'custom' ? 'selected' : ''}>Custom</option></select><select data-rule-scoring="${courtNo}" ${rules.mode !== 'custom' || started ? 'disabled' : ''}><option value="side-out" ${rules.scoring === 'side-out' ? 'selected' : ''}>Side-out</option><option value="rally" ${rules.scoring === 'rally' ? 'selected' : ''}>Rally</option></select><label>To <input data-rule-target="${courtNo}" type="number" min="1" max="30" value="${rules.target}" ${rules.mode !== 'custom' || started ? 'disabled' : ''}></label><label>Sudden death <input data-rule-sudden="${courtNo}" type="number" min="1" max="30" value="${rules.suddenDeathAt}" ${rules.mode !== 'custom' || started ? 'disabled' : ''}></label><label><input data-rule-timer="${courtNo}" type="checkbox" ${rules.timer ? 'checked' : ''} ${started ? 'disabled' : ''}> Timer</label></div><div class="active-actions">${rules.timer ? `<button data-timer-toggle="${courtNo}">${live.running ? 'Pause' : seconds ? 'Resume' : 'Start'} · ${timerText(seconds)}</button>` : '<span class="no-timer">No match timer</span>'}<button data-score-id="${match.id}">${done ? 'Override score' : 'Enter score'}</button><button data-court-tools="${courtNo}">Match tools</button><button class="vacate" data-vacate-court="${courtNo}">${done ? 'Confirm court vacant' : 'Remove from court'}</button></div></section>`;
  }
  function moveScheduledMatch(id, courtNo, targetIndex) {
    if (!id || isComplete(id) || Object.values(state.courts).some(court => court.matchId === id)) return toast('Only waiting matches can be moved.');
    Object.keys(state.courtSchedules).forEach(no => state.courtSchedules[no] = state.courtSchedules[no].filter(item => item !== id));
    const target = state.courtSchedules[courtNo] ||= []; target.splice(Math.max(0, Math.min(target.length, targetIndex)), 0, id);
    Object.entries(state.courtSchedules).forEach(([no, ids]) => ids.forEach((matchId, index) => { const match = state.matches.find(item => item.id === matchId); if (match) { const start = config.event.roundRobinStartMinutes + index * config.event.slotMinutes; match.court = Number(no); match.wave = index + 1; match.time = `${timeLabel(start)}-${timeLabel(start + config.event.slotMinutes)}`; } }));
    syncQueueFromCourtSchedules(); const conflicts = conflictsFor(id, courtNo); saveState(); renderAll();
    toast(conflicts.length ? `Moved with warning: ${conflicts[0]}` : `Moved ${id} to Court ${courtNo}.`);
  }
  function renderCourts() {
    renderCourtTimeline();
  }
  function bindCourtControls() {
    bindScoreButtons();
    $$('[data-promote-court]').forEach(button => button.onclick = () => assignNext(Number(button.dataset.promoteCourt)));
    $$('[data-timer-toggle]').forEach(button => button.onclick = () => toggleTimer(Number(button.dataset.timerToggle)));
    $$('[data-vacate-court]').forEach(button => button.onclick = () => vacateCourt(Number(button.dataset.vacateCourt)));
    $$('[data-court-tools]').forEach(button => button.onclick = () => showCourtTools(Number(button.dataset.courtTools)));
    $$('[data-rule-mode]').forEach(select => select.onchange = () => { const courtNo = Number(select.dataset.ruleMode), matchId = state.courts[courtNo]?.matchId; if (!matchId) return; state.matchSettings[matchId] = defaultMatchRules(select.value); saveState(); renderCourts(); });
    $$('[data-rule-scoring]').forEach(select => select.onchange = () => { const matchId = state.courts[Number(select.dataset.ruleScoring)]?.matchId; if (matchId) { rulesFor(matchId).scoring = select.value; saveState(); renderCourts(); } });
    $$('[data-rule-target]').forEach(input => input.onchange = () => updateCustomRule(Number(input.dataset.ruleTarget), 'target', input.value));
    $$('[data-rule-sudden]').forEach(input => input.onchange = () => updateCustomRule(Number(input.dataset.ruleSudden), 'suddenDeathAt', input.value));
    $$('[data-rule-timer]').forEach(input => input.onchange = () => { const matchId = state.courts[Number(input.dataset.ruleTimer)]?.matchId; if (matchId) { rulesFor(matchId).timer = input.checked; saveState(); renderCourts(); } });
  }
  function updateCustomRule(courtNo, field, value) { const matchId = state.courts[courtNo]?.matchId; if (!matchId) return; rulesFor(matchId)[field] = Math.max(1, Math.min(30, Number(value) || 1)); saveState(); renderCourts(); }
  function vacateCourt(courtNo) {
    const court = state.courts[courtNo]; if (!court?.matchId) return; const id = court.matchId, done = isComplete(id);
    if (!confirm(done ? `Confirm Court ${courtNo} is vacant after ${id}? The next match will remain scheduled until you promote it.` : `Remove ${id} from Court ${courtNo} before it is complete? Its live timer and scoring progress will be reset.`)) return;
    if (!done) { if (!state.queue.includes(id)) state.queue.unshift(id); delete state.liveScoring?.[id]; if (cloudUser) deleteMatch(id).catch(() => toast('Court cleared locally, but cloud cleanup failed.')); }
    state.courts[courtNo] = { matchId: '', running: false, startedAt: null, elapsed: 0 }; saveState(); renderAll(); toast(`Court ${courtNo} is vacant.`);
  }
  function showCourtTools(courtNo) {
    const court = state.courts[courtNo], match = state.matches.find(item => item.id === court?.matchId); if (!match) return;
    state.liveScoring ||= {}; const live = state.liveScoring[match.id] ||= { a: 0, b: 0, timeouts: { a: 0, b: 0 }, medical: 0, technicalTimeouts: 0, refereeTimeouts: 0, equipmentTimeouts: 0, log: [], running: false, startedAt: null, elapsed: 0 };
    document.body.insertAdjacentHTML('beforeend', `<div class="court-tools-backdrop" id="courtToolsModal"><section><button class="modal-close" data-close-tools>×</button><span class="section-label">Court ${courtNo} · ${match.id}</span><h2>Guarded match tools</h2><p>Every interruption requires confirmation to prevent accidental taps.</p><div class="guarded-tools"><button data-guarded-tool="timeout-a">OCPC timeout <b>${live.timeouts?.a || 0}/2</b></button><button data-guarded-tool="timeout-b">Rally Rebels timeout <b>${live.timeouts?.b || 0}/2</b></button><button data-guarded-tool="medical">Medical timeout <b>${live.medical || 0}</b></button><button data-guarded-tool="technical">Technical timeout <b>${live.technicalTimeouts || 0}</b></button><button data-guarded-tool="referee">Referee timeout <b>${live.refereeTimeouts || 0}</b></button><button data-guarded-tool="equipment">Equipment timeout <b>${live.equipmentTimeouts || 0}</b></button></div></section></div>`);
    $('#courtToolsModal').onclick = event => { if (event.target.id === 'courtToolsModal' || event.target.closest('[data-close-tools]')) $('#courtToolsModal').remove(); };
    $$('[data-guarded-tool]', $('#courtToolsModal')).forEach(button => button.onclick = () => applyGuardedTool(courtNo, button.dataset.guardedTool));
  }
  function applyGuardedTool(courtNo, type) {
    const id = state.courts[courtNo]?.matchId, live = state.liveScoring[id]; if (!id || !live) return; const labels = { 'timeout-a': 'OCPC timeout', 'timeout-b': 'Rally Rebels timeout', medical: 'medical timeout', technical: 'technical timeout', referee: 'referee timeout', equipment: 'equipment timeout' }, label = labels[type];
    if (!confirm(`Record ${label} for ${id} on Court ${courtNo}?`)) return;
    live.timeouts ||= { a: 0, b: 0 }; if (type === 'timeout-a' && live.timeouts.a < 2) live.timeouts.a++; else if (type === 'timeout-b' && live.timeouts.b < 2) live.timeouts.b++; else if (type === 'medical') live.medical = (live.medical || 0) + 1; else if (type === 'technical') live.technicalTimeouts = (live.technicalTimeouts || 0) + 1; else if (type === 'referee') live.refereeTimeouts = (live.refereeTimeouts || 0) + 1; else if (type === 'equipment') live.equipmentTimeouts = (live.equipmentTimeouts || 0) + 1;
    live.log ||= []; live.log.unshift({ at: new Date().toISOString(), text: `${label} recorded by Match Control` }); saveState(); if (cloudUser) publishMatch(id, live, state.scores[id] || null); $('#courtToolsModal')?.remove(); renderCourts(); toast(`${label} recorded.`);
  }
  function assignMatch(courtNo, matchId) { if (!state.courts[courtNo] || state.courts[courtNo].matchId) return false; state.courts[courtNo] = { matchId, running: false, startedAt: null, elapsed: 0 }; state.queue = state.queue.filter(id => id !== matchId); saveState(); renderAll(); return true; }
  function assignNext(courtNo) { const id = nextForCourt(courtNo); if (!id) return toast('No waiting matches.'); assignMatch(courtNo, id); }
  function sendMatchToFreeCourt(id) { const free = Object.keys(state.courts).find(no => !state.courts[no].matchId); if (!free) return toast('No court is currently available.'); assignMatch(Number(free), id); }
  function fillCourts() { Object.keys(state.courts).forEach(no => { if (!state.courts[no].matchId) { const id = nextForCourt(Number(no)); if (id) state.courts[no] = { matchId: id, running: false, startedAt: null, elapsed: 0 }; } }); state.queue = state.queue.filter(id => !Object.values(state.courts).some(c => c.matchId === id)); saveState(); renderAll(); }
  function toggleTimer(courtNo) { const court = state.courts[courtNo]; if (!court?.matchId) return; state.liveScoring ||= {}; const timer = state.liveScoring[court.matchId] ||= { a: 0, b: 0, timeouts: { a: 0, b: 0 }, medical: 0, technicalTimeouts: 0, refereeTimeouts: 0, equipmentTimeouts: 0, log: [], running: false, startedAt: null, elapsed: 0 }; if (timer.running) { timer.elapsed = elapsedSeconds(timer); timer.running = false; timer.startedAt = null; } else { timer.running = true; timer.startedAt = Date.now(); } saveState(); if (cloudUser) publishMatch(court.matchId, timer, state.scores[court.matchId] || null); renderCourts(); }
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
    renderClubStandings();
    $('#standingsTabs').innerHTML = config.categories.map(category => `<button class="category-tab ${category === standingsCategory ? 'active' : ''}" data-standing-category="${esc(category)}">${esc(category)}</button>`).join('');
    $('#standingsGrid').innerHTML = config.clubs.map(club => {
      const rows = standingsFor(standingsCategory, club.id);
      return `<article class="standing-card"><div class="card-title"><h2>${esc(club.name)}</h2><span>Top 2 advance</span></div><div class="standing-row header"><span>#</span><span>Pair</span><span class="num">P</span><span class="num">W</span><span class="num">L</span><span class="num">+/-</span><span class="num">PF</span></div>${rows.map(r => `<div class="standing-row"><span class="rank">${r.rank}</span><span class="team-name"><b>${r.code}</b><small>${esc(r.names)}</small></span><span class="num">${r.played}</span><span class="num">${r.wins}</span><span class="num">${r.losses}</span><span class="num">${r.diff > 0 ? '+' : ''}${r.diff}</span><span class="num">${r.pointsFor}</span></div>`).join('')}</article>`;
    }).join('');
    $$('[data-standing-category]').forEach(btn => btn.onclick = () => { standingsCategory = btn.dataset.standingCategory; renderStandings(); });
  }
  function clubTotals() {
    const wins = { ocpc: 0, rebels: 0 };
    state.matches.forEach(match => { const winner = winnerCode(match); if (winner.startsWith('O')) wins.ocpc++; if (winner.startsWith('R')) wins.rebels++; });
    const dream = state.dreamBreaker.enabled ? state.dreamBreaker.scores : { ocpc: 0, rebels: 0 };
    return config.clubs.map(club => ({ ...club, matchWins: wins[club.id], dreamPoints: Number(dream[club.id]) || 0, total: wins[club.id] + (Number(dream[club.id]) || 0) })).sort((a, b) => b.total - a.total || b.matchWins - a.matchWins);
  }
  function renderClubStandings() {
    const totals = clubTotals(), leader = totals[0], tied = totals.length > 1 && totals[0].total === totals[1].total;
    $('#clubStandings').innerHTML = `<section class="club-scoreboard"><div class="club-scoreboard-title"><div><span class="section-label">Club championship</span><h2>Overall club standings</h2></div><strong>${tied ? 'Currently tied' : `${esc(leader.short)} leads`}</strong></div><div class="club-rank-grid">${totals.map((club, index) => `<article class="club-rank-card ${index === 0 && !tied ? 'leading' : ''}"><span>${index + 1}</span><div><h3>${esc(club.name)}</h3><small>${club.matchWins} match wins${state.dreamBreaker.enabled ? ` + ${club.dreamPoints} Dream Breaker points` : ''}</small></div><b>${club.total}<small>club points</small></b></article>`).join('')}</div><p>The club with the most combined club points is awarded Champion Club.</p></section>`;
    $('#dreamBreakerSummary').innerHTML = `<section class="dream-summary"><div><span class="section-label">Dream Breaker</span><b>${state.dreamBreaker.enabled ? `${state.dreamBreaker.scores.ocpc}-${state.dreamBreaker.scores.rebels} · first to ${state.dreamBreaker.target}` : 'Optional · currently disabled'}</b></div><button class="btn btn-quiet" data-open-dream>Open scoring desk</button></section>`;
    $('[data-open-dream]').onclick = () => showView('dream');
  }
  function rosterPlayers(clubId) { const prefix = config.clubs.find(club => club.id === clubId)?.pairPrefix; return Object.entries(state.pairs).filter(([key]) => key.split('|')[1]?.startsWith(prefix)).flatMap(([, pair]) => [pair.player1, pair.player2]).filter(Boolean).filter((name, index, all) => all.indexOf(name) === index); }
  function playerOptions(clubId, selected) { return `<option value="">Select player</option>${rosterPlayers(clubId).map(name => `<option ${name === selected ? 'selected' : ''}>${esc(name)}</option>`).join('')}`; }
  function renderDreamBreakerBoard() {
    const board = $('#dreamBreakerBoard'), dream = state.dreamBreaker;
    if (!dream.enabled) { board.innerHTML = `<section class="dream-board disabled"><span class="section-label">Optional tiebreaker</span><h2>Dream Breaker is not enabled</h2><p>Match Control can activate it in Settings if tournament time permits.</p></section>`; return; }
    const totalRallies = Number(dream.scores.ocpc) + Number(dream.scores.rebels), remainder = totalRallies % 4, nextSwitch = remainder ? 4 - remainder : 4, switchNow = totalRallies > 0 && remainder === 0, winner = Number(dream.scores.ocpc) >= dream.target ? 'ocpc' : Number(dream.scores.rebels) >= dream.target ? 'rebels' : '';
    board.innerHTML = `<section class="dream-board scoring"><div class="club-scoreboard-title"><div><span class="section-label">Rally-scoring desk</span><h2>Dream Breaker · First to ${dream.target}</h2></div><strong class="${switchNow && !winner ? 'switch-alert' : ''}">${winner ? `${esc(config.clubs.find(club => club.id === winner).short)} wins` : switchNow ? 'Switch players now' : `Switch in ${nextSwitch} rallies`}</strong></div><div class="dream-live-score">${config.clubs.map(club => `<article class="${winner === club.id ? 'winner' : ''}"><span>${esc(club.name)}</span><b>${dream.scores[club.id]}</b><button data-dream-point="${club.id}" ${winner ? 'disabled' : ''}>+1 rally</button></article>`).join('')}</div><div class="dream-progress"><span style="width:${Math.min(100, totalRallies / Math.max(1, dream.target * 2) * 100)}%"></span></div><p>${totalRallies} total rallies logged. Both clubs switch to their next captain-selected players after every fourth rally.</p><div class="stack-actions"><button class="btn btn-quiet" id="undoDreamPoint" ${dream.history?.length ? '' : 'disabled'}>Undo last rally</button><button class="btn btn-danger" id="resetDreamScore">Reset Dream Breaker score</button></div></section>`;
    $$('[data-dream-point]').forEach(button => button.onclick = () => { const clubId = button.dataset.dreamPoint; dream.history ||= []; dream.history.push({ ...dream.scores }); dream.scores[clubId] = Math.min(dream.target, Number(dream.scores[clubId]) + 1); saveState(); renderAll(); const rallies = dream.scores.ocpc + dream.scores.rebels; if (rallies % 4 === 0 && dream.scores[clubId] < dream.target) alert('Four rallies completed. Switch players for both clubs before the next serve.'); });
    $('#undoDreamPoint').onclick = () => { const prior = dream.history?.pop(); if (!prior) return; dream.scores = prior; saveState(); renderAll(); toast('Last Dream Breaker rally undone.'); };
    $('#resetDreamScore').onclick = () => { if (!confirm('Reset both Dream Breaker scores to zero?')) return; dream.scores = { ocpc: 0, rebels: 0 }; dream.history = []; saveState(); renderAll(); };
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
  function renderDreamBreakerSettings() {
    const dream = state.dreamBreaker; $('#dreamBreakerEnabled').checked = dream.enabled; $('#dreamBreakerTarget').value = dream.target;
  }
  function saveDreamBreakerSetup() {
    state.dreamBreaker.enabled = $('#dreamBreakerEnabled').checked; state.dreamBreaker.target = Math.max(1, Math.min(200, Number($('#dreamBreakerTarget').value) || 52));
    state.dreamBreaker.scores.ocpc = Math.min(state.dreamBreaker.scores.ocpc, state.dreamBreaker.target); state.dreamBreaker.scores.rebels = Math.min(state.dreamBreaker.scores.rebels, state.dreamBreaker.target); saveState(); renderAll(); toast('Dream Breaker setup saved.');
  }
  function renderSettings() {
    $('#configList').innerHTML = [['Organizer', config.brand.organizer], ['Event', config.event.name], ['Venue', `${config.event.venue}, ${config.event.location}`], ['Courts', config.event.courts], ['Categories', config.categories.join(', ')], ['Storage', 'Firebase live sync with local cache']].map(([a, b]) => `<div class="config-row"><span>${esc(a)}</span><b>${esc(b)}</b></div>`).join('');
    const assignedIds = Object.keys(state.refereeAssignments);
    $('#refereeMatch').innerHTML = state.matches.filter(m => !isComplete(m.id)).map(m => `<option value="${m.id}">${m.id} · ${displayPair(m.category,m.a)} vs ${displayPair(m.category,m.b)}</option>`).join('');
    $('#refereeList').innerHTML = assignedIds.length ? assignedIds.map(id => `<div class="config-row"><span>${id}</span><b>${esc(state.refereeAssignments[id])}</b></div>`).join('') : '<div class="config-row"><span>No referees assigned yet</span></div>';
    $('#pairCountSettings').innerHTML = config.categories.map(category => `<label>${esc(category)}<input type="number" min="2" max="12" value="${pairCount(category)}" data-pair-count="${esc(category)}"></label>`).join('');
    renderDreamBreakerSettings();
    renderTournamentStaff();
  }
  function renderAll() { const total = totalMatchCount(); $('#heroMatchCount').textContent = total; $('#scheduleMatchCount').textContent = `All ${total} matches`; renderOverview(); renderCourts(); renderSchedule(); renderStandings(); renderDreamBreakerBoard(); renderTeams(); renderMedals(); renderSettings(); }
  function changeWave(delta) { const waves = Math.ceil(totalMatchCount() / config.event.courts); state.currentWave = Math.max(1, Math.min(waves, state.currentWave + delta)); saveState(); renderOverview(); renderCourts(); }
  function showView(name) {
    activeView = name; $$('.view').forEach(view => view.classList.toggle('active', view.id === `view-${name}`)); $$('.nav-item').forEach(btn => btn.classList.toggle('active', btn.dataset.view === name)); $('#sidebar').classList.remove('open');
    if (name === 'schedule') renderSchedule(); if (name === 'standings') renderStandings(); if (name === 'dream') renderDreamBreakerBoard(); if (name === 'medals') renderMedals();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function bindScoreButtons() { $$('[data-score-id]').forEach(button => button.onclick = () => openScore(button.dataset.scoreId)); }
  function openScore(id) {
    const match = state.matches.find(m => m.id === id); if (!match) return;
    activeMatchId = id; const score = scoreFor(id), rules = rulesFor(id), maximum = rules.suddenDeathAt + 1;
    $('#scoreMeta').textContent = `${match.id} · Wave ${match.wave} · Court ${match.court} · ${match.category}`;
    $('#scoreTitle').textContent = match.time; $('#sideALabel').textContent = `OCPC · ${match.a}`; $('#sideBLabel').textContent = `Rally Rebels · ${match.b}`;
    $('#sideAName').textContent = pairNames(match.category, match.a); $('#sideBName').textContent = pairNames(match.category, match.b);
    $('#scoreA').max = maximum; $('#scoreB').max = maximum; $('#scoreA').value = score.a; $('#scoreB').value = score.b; $('#scoreMessage').textContent = `${rules.label}: first to ${rules.target}, win by 2; sudden death at ${rules.suddenDeathAt}-${rules.suddenDeathAt}.`; $('#scoreModal').hidden = false; setTimeout(() => $('#scoreA').focus(), 30);
  }
  function closeScore() { $('#scoreModal').hidden = true; activeMatchId = null; }
  function saveScore() {
    const a = $('#scoreA').value, b = $('#scoreB').value;
    if (a === '' || b === '') { $('#scoreMessage').textContent = 'Enter both scores, or choose Clear score.'; return; }
    const na = Number(a), nb = Number(b);
    if (na === nb) { $('#scoreMessage').textContent = 'Matches need a winner. Play one deciding rally.'; return; }
    const rules = rulesFor(activeMatchId), high = Math.max(na, nb), low = Math.min(na, nb), maximum = rules.suddenDeathAt + 1, validSuddenDeath = high === maximum && low === rules.suddenDeathAt, validRegular = high >= rules.target && high <= rules.suddenDeathAt && high - low >= 2;
    if (na < 0 || nb < 0 || high > maximum) { $('#scoreMessage').textContent = `Scores must be between 0 and ${maximum}.`; return; }
    if (!validRegular && !validSuddenDeath) { $('#scoreMessage').textContent = `First to ${rules.target}, win by 2. At ${rules.suddenDeathAt}-${rules.suddenDeathAt}, the next rally wins ${maximum}-${rules.suddenDeathAt}.`; return; }
    const prior = state.scores[activeMatchId];
    if (prior && (Number(prior.a) !== na || Number(prior.b) !== nb) && !confirm(`Warning: this revises a recorded result from ${prior.a}-${prior.b} to ${na}-${nb}. Continue?`)) return;
    if (prior) state.scoreAudit.push({ matchId: activeMatchId, previous: prior, revised: { a: na, b: nb }, revisedAt: new Date().toISOString(), source: 'match-control' });
    state.scores[activeMatchId] = { a: na, b: nb, completedAt: prior?.completedAt || new Date().toISOString() };
    if (cloudUser) publishMatch(activeMatchId, state.liveScoring?.[activeMatchId] || { a: na, b: nb, complete: true }, state.scores[activeMatchId]).catch(() => toast('Result saved locally; cloud sync failed.'));
    saveState(); closeScore(); renderAll(); toast('Result saved. Confirm the court is vacant when players have cleared it.');
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
      watchControl(incoming => { if (!incoming) { publishControl(state).catch(() => showCloudGate('Your account cannot initialize this event.')); return; } cloudApplying = true; const localCheckins = state.checkins || {}, normalized = normalizeState(incoming); state = { ...normalized, checkins: { ...normalized.checkins, ...localCheckins }, liveScoring: state.liveScoring || {} }; controlReady = true; hydrateRegisteredTeams(false); localStorage.setItem(config.storageKey, JSON.stringify(state)); renderAll(); cloudApplying = false; }, () => showCloudGate('Your account does not have Match Control access.'));
      watchRegistrations(items => { registrations = items; if (hydrateRegisteredTeams()) renderAll(); }, () => toast('Player registrations could not be loaded.'));
      watchCheckins(items => { state.checkins = Object.fromEntries(items.map(item => [item.id, item])); localStorage.setItem(config.storageKey, JSON.stringify(state)); renderCourts(); }, () => toast('Player photos could not be loaded.'));
      $('#cloudSessionBtn').textContent = 'Sign out'; $('#cloudSessionBtn').title = `Signed in as ${user.email}`;
      watchMatches(items => { cloudApplying = true; state.liveScoring = {}; items.forEach(item => { if (item.live) state.liveScoring[item.id] = item.live; if (item.score) state.scores[item.id] = item.score; }); localStorage.setItem(config.storageKey, JSON.stringify(state)); renderAll(); cloudApplying = false; }, () => toast('Live match feed unavailable.'));
    });
  }

  setBrandContent();
  config.categories.forEach(category => $('#scheduleCategory').insertAdjacentHTML('beforeend', `<option value="${esc(category)}">${esc(category)}</option>`));
  config.categories.forEach(category => $('#medalCategorySelect').insertAdjacentHTML('beforeend', `<option value="${esc(category)}">${esc(category)}</option>`));
  $$('.nav-item').forEach(button => button.onclick = () => showView(button.dataset.view)); $$('[data-go]').forEach(button => button.onclick = () => showView(button.dataset.go));
  $('#menuBtn').onclick = () => $('#sidebar').classList.toggle('open');
  $('#scheduleCategory').onchange = renderSchedule; $('#scheduleStatus').onchange = renderSchedule; $('#scheduleSearch').oninput = renderSchedule;
  $('#quickScoreBtn').onclick = () => { const next = state.matches.find(m => m.wave === state.currentWave && !isComplete(m.id)) || state.matches.find(m => !isComplete(m.id)); next ? openScore(next.id) : toast('All round-robin results are complete.'); };
  $('#seedMedalsBtn').onclick = seedMedals; $('#printBtn').onclick = () => window.print(); $('#exportBtn').onclick = exportBackup; $('#importInput').onchange = event => { if (event.target.files[0]) importBackup(event.target.files[0]); event.target.value = ''; };
  $('#medalCategorySelect').onchange = event => { medalCategory = event.target.value; renderMedals(); };
  $('#assignRefereeBtn').onclick = () => { const email = $('#refereeEmail').value.trim().toLowerCase(), matchId = $('#refereeMatch').value; if (!email || !matchId) return toast('Choose a match and enter a referee email.'); state.refereeAssignments[matchId] = email; saveState(); renderSettings(); toast('Referee assigned.'); };
  $('#staffAccessBtn').onclick = async () => { const email = $('#staffAccessEmail').value.trim().toLowerCase(), role = $('#staffAccessRole').value, enabled = $('#staffAccessAction').value === 'grant'; if (!email) return toast('Enter the staff member’s website account email.'); $('#staffAccessBtn').disabled = true; try { await changeTournamentStaffRole(email, role, enabled); $('#staffAccessEmail').value = ''; await renderTournamentStaff(); toast(enabled ? 'Tournament access granted.' : 'Tournament access removed.'); } catch (error) { alert(error.message === 'NO_ACCOUNT' ? 'No OCPC website account uses that email yet. The staff member must create an account first.' : 'Only a site administrator can change tournament staff access.'); } finally { $('#staffAccessBtn').disabled = false; } };
  $('#applyPairCountsBtn').onclick = applyPairCounts;
  $('#saveDreamBreakerBtn').onclick = saveDreamBreakerSetup;
  $('#cloudSessionBtn').onclick = () => logout();
  $('#resetBtn').onclick = async () => { if (!confirm('Reset all match-day results, timers, queues, court assignments, officials, check-ins, standings, medal results, and Dream Breaker data? Retained player registrations will stay saved and repopulate Teams.')) return; $('#resetBtn').disabled = true; try { if (cloudUser) await Promise.all([clearMatches(), clearCheckins()]); state = freshState(); hydrateRegisteredTeams(false); localStorage.removeItem(config.storageKey); saveState(); if (cloudUser) await publishControl(state); renderAll(); toast('Event data reset. Registered teams restored.'); } catch (_) { alert('The reset did not fully complete. Check your connection and try again.'); } finally { $('#resetBtn').disabled = false; } };
  $('#modalClose').onclick = closeScore; $('#scoreModal').onclick = event => { if (event.target === $('#scoreModal')) closeScore(); }; $('#saveScoreBtn').onclick = saveScore; $('#clearScoreBtn').onclick = clearScore;
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('#scoreModal').hidden) closeScore(); });
  window.addEventListener('storage', event => { if (event.key !== config.storageKey || !event.newValue) return; try { state = JSON.parse(event.newValue); renderAll(); } catch (_) {} });
  setInterval(() => { if (activeView === 'courts' && Object.values(state.courts).some(c => c.running)) renderCourts(); }, 1000);
  renderAll(); showView(activeView); startCloud();
})();

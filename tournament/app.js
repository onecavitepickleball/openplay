const revision = new URL(import.meta.url).searchParams.get('v') || 'dev';
const { watchAuth, login, logout, getCurrentProfile, watchControl, watchMatches, watchRegistrations, watchCheckins, publishControl, publishMatch, deleteMatch, clearMatches, clearCheckins, listTournamentStaff, changeTournamentStaffRole } = await import(`./firebase-sync.js?v=${encodeURIComponent(revision)}`);

(() => {
  'use strict';
  const config = window.TOURNAMENT_CONFIG;
  const demoMode = new URLSearchParams(location.search).get('demo') === '1', storageKey = demoMode ? `${config.storageKey}.demo` : config.storageKey;
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
  function defaultPairCounts() { return Object.fromEntries(config.categories.map(category => { const configured = config.pairsPerCategory[category] || 6; return [category, typeof configured === 'object' ? { ocpc: Number(configured.ocpc) || 6, rebels: Number(configured.rebels) || 6 } : { ocpc: Number(configured) || 6, rebels: Number(configured) || 6 }]; })); }
  function normalizedPairCounts(counts = defaultPairCounts()) { const defaults = defaultPairCounts(); return Object.fromEntries(config.categories.map(category => { const value = counts?.[category] ?? defaults[category]; return [category, typeof value === 'object' ? { ocpc: Number(value.ocpc) || 1, rebels: Number(value.rebels) || 1 } : { ...defaults[category] }]; })); }
  function pairCount(category, clubId = 'ocpc', counts = state?.pairCounts || defaultPairCounts()) { const value = counts?.[category]; return Number(typeof value === 'object' ? value?.[clubId] : value) || 1; }
  function categoryMatchCount(category, counts = state?.pairCounts || defaultPairCounts()) { const ocpc = pairCount(category, 'ocpc', counts), rebels = pairCount(category, 'rebels', counts); return Math.max(ocpc, rebels) * Math.min(5, Math.min(ocpc, rebels)); }
  function totalMatchCount(counts = state?.pairCounts || defaultPairCounts()) { return config.categories.reduce((total, category) => total + categoryMatchCount(category, counts), 0); }
  function secureRandomIndex(maxExclusive) { const ceiling = Math.floor(0x100000000 / maxExclusive) * maxExclusive; let value; do value = crypto.getRandomValues(new Uint32Array(1))[0]; while (value >= ceiling); return value % maxExclusive; }
  function shuffledCodes(prefix, count) { const values = Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`); for (let i = values.length - 1; i > 0; i--) { const j = secureRandomIndex(i + 1); [values[i], values[j]] = [values[j], values[i]]; } return values; }
  function createOpponentDraw(pairCounts) { return { id: [...crypto.getRandomValues(new Uint8Array(6))].map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase(), createdAt: new Date().toISOString(), locked: true, categories: Object.fromEntries(config.categories.map(category => [category, { ocpc: shuffledCodes('O', pairCount(category, 'ocpc', pairCounts)), rebels: shuffledCodes('R', pairCount(category, 'rebels', pairCounts)) }])) }; }
  function categoryDrawMatches(category, order, counts = state?.pairCounts || defaultPairCounts()) {
    const ocpcCount = pairCount(category, 'ocpc', counts), rebelsCount = pairCount(category, 'rebels', counts), matches = [], opponentLimit = Math.min(5, Math.min(ocpcCount, rebelsCount));
    if (rebelsCount >= ocpcCount) {
      const loads = Array(ocpcCount).fill(0);
      for (let index = 0; index < rebelsCount; index++) [...Array(ocpcCount).keys()].sort((a, b) => loads[a] - loads[b] || ((a - index + ocpcCount) % ocpcCount) - ((b - index + ocpcCount) % ocpcCount)).slice(0, opponentLimit).forEach((opponent, round) => { loads[opponent]++; matches.push({ category, round: round + 1, a: order.ocpc[opponent], b: order.rebels[index] }); });
    } else {
      const loads = Array(rebelsCount).fill(0);
      for (let index = 0; index < ocpcCount; index++) [...Array(rebelsCount).keys()].sort((a, b) => loads[a] - loads[b] || ((a - index + rebelsCount) % rebelsCount) - ((b - index + rebelsCount) % rebelsCount)).slice(0, opponentLimit).forEach((opponent, round) => { loads[opponent]++; matches.push({ category, round: round + 1, a: order.ocpc[index], b: order.rebels[opponent] }); });
    }
    return matches;
  }
  function generateMatches(pairCounts, opponentDraw) {
    return config.categories.flatMap(category => categoryDrawMatches(category, opponentDraw.categories[category], pairCounts).map(match => ({ ...match, players: [`${category}|${match.a}`, `${category}|${match.b}`] })));
  }
  function generateSchedule(pairCounts, opponentDraw) {
    const total = totalMatchCount(pairCounts), fullWaves = Math.floor(total / config.event.courts), remainder = total % config.event.courts;
    const capacities = [...Array(fullWaves).fill(config.event.courts), ...(remainder ? [remainder] : [])];
    const remaining = generateMatches(pairCounts, opponentDraw), waves = [], random = seededRandom(20260919), lastPlayed = new Map(), appearances = new Map(); let previous = new Set();
    capacities.forEach((capacity, waveIndex) => { const selected = [], used = new Set(); while (selected.length < capacity && remaining.length) { const rested = remaining.filter(match => !match.players.some(player => used.has(player) || previous.has(player))), available = rested.length ? rested : remaining.filter(match => !match.players.some(player => used.has(player))), candidates = available.length ? available : remaining; candidates.sort((a, b) => { const score = match => { const wait = Math.min(...match.players.map(player => lastPlayed.has(player) ? waveIndex - lastPlayed.get(player) : 6)), load = match.players.reduce((sum, player) => sum + (appearances.get(player) || 0), 0), phase = waveIndex < 6 ? 'Novice' : waveIndex < 13 ? 'Low Intermediate' : 'High Intermediate', phaseBonus = match.category === phase ? 70 : 0; return wait * 45 + phaseBonus - load * 8 + random() * 5; }; return score(b) - score(a); }); const match = candidates[0]; selected.push(match); match.players.forEach(player => used.add(player)); remaining.splice(remaining.indexOf(match), 1); } waves.push(selected); previous = new Set(selected.flatMap(match => match.players)); selected.forEach(match => match.players.forEach(player => { lastPlayed.set(player, waveIndex); appearances.set(player, (appearances.get(player) || 0) + 1); })); });
    let number = 0; return waves.flatMap((wave, waveIndex) => wave.map((match, courtIndex) => { const start = config.event.roundRobinStartMinutes + waveIndex * config.event.slotMinutes; number++; return { ...match, id: `RR-${String(number).padStart(3, '0')}`, wave: waveIndex + 1, court: courtIndex + 1, startMinutes: start, time: `${timeLabel(start)}-${timeLabel(start + config.event.slotMinutes)}` }; }));
  }

  function emptyPairs(pairCounts) {
    const pairs = {};
    config.categories.forEach(category => {
      config.clubs.forEach(club => {
        for (let i = 1; i <= pairCount(category, club.id, pairCounts); i++) pairs[`${category}|${club.pairPrefix}${i}`] = { player1: '', player2: '' };
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
  function blankDreamBreaker() { return { enabled: false, target: 52, scores: { ocpc: 0, rebels: 0 }, history: [], serving: '', tossResult: '', tossWinner: '', tossChoice: '', acknowledgedSwitchAt: 0, endsChanged: false }; }
  function emptyCourts() { return Object.fromEntries(Array.from({ length: config.event.courts }, (_, i) => [i + 1, { matchId: '', running: false, startedAt: null, elapsed: 0 }])); }
  function initialCourtSchedules(matches) { return Object.fromEntries(Array.from({ length: config.event.courts }, (_, i) => [i + 1, matches.filter(match => match.court === i + 1).sort((a, b) => a.wave - b.wave).map(match => match.id)])); }
  function freshState(pairCounts = defaultPairCounts(), retainedDraw = null) {
    pairCounts = normalizedPairCounts(pairCounts);
    const opponentDraw = retainedDraw || createOpponentDraw(pairCounts), matches = generateSchedule(pairCounts, opponentDraw);
    return { version: 11, schedulerVersion: 7, scheduleBaselineStartMinutes: config.event.roundRobinStartMinutes, pairCounts, opponentDraw, currentWave: 1, matches, queue: matches.map(m => m.id), courtSchedules: initialCourtSchedules(matches), scheduleHistory: [], courts: emptyCourts(), matchSettings: {}, scores: {}, scoreAudit: [], refereeAssignments: {}, checkins: {}, pairs: emptyPairs(pairCounts), medals: blankMedals(), dreamBreaker: blankDreamBreaker(), updatedAt: new Date().toISOString() };
  }
  function demoAvatar(name, hue) { const initials = name.split(' ').map(part => part[0]).join('').slice(0, 2), svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" rx="64" fill="hsl(${hue} 65% 42%)"/><circle cx="64" cy="48" r="23" fill="white" opacity=".9"/><path d="M24 118c5-29 23-43 40-43s35 14 40 43" fill="white" opacity=".9"/><text x="64" y="121" text-anchor="middle" font-family="Arial" font-weight="700" font-size="14" fill="hsl(${hue} 65% 27%)">${initials}</text></svg>`; return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; }
  function freshDemoState() { const demo = freshState(), first = ['Alex','Mika','Paolo','Bea','Carlo','Nina','Marco','Aya','Jules','Sam','Enzo','Lia','Theo','Mara','Nico','Dani','Luis','Gia','Rafa','Toni'], last = ['Santos','Reyes','Cruz','Garcia','Mendoza','Flores','Castillo','Ramos','Navarro','Aquino','Villanueva','Torres','Diaz','Rivera','Lim','Tan','Bautista','Domingo','Salazar','Valdez']; let number = 0; Object.entries(demo.pairs).forEach(([key, pair]) => { const [category, code] = key.split('|'), club = code.startsWith('O') ? 'ocpc' : 'rebels', clubName = config.clubs.find(item => item.id === club).name; [0,1].forEach(index => { const name = `${first[number % first.length]} ${last[(number * 7 + index) % last.length]}`, id = `demo:${category}:${code}:${index}`; pair[index ? 'player2' : 'player1'] = name; demo.checkins[id] = { category, pair: code, club, clubName, playerIndex: index, name, shirtSize: ['S','M','L','XL'][number % 4], payment: 'paid', waiverSigned: true, photoThumb: demoAvatar(name, (number * 43) % 360), checkedInAt: new Date(Date.now() - number * 60000).toISOString() }; number++; }); }); demo.matches.slice(0, 10).forEach((match, index) => demo.scores[match.id] = { a: index % 3 ? 11 : 8, b: index % 3 ? 7 + index % 3 : 11, completedAt: new Date(Date.now() - (20 - index) * 60000).toISOString() }); demo.queue = demo.matches.filter(match => !demo.scores[match.id]).map(match => match.id); for (let courtNo = 1; courtNo <= config.event.courts; courtNo++) { const matchId = demo.queue.shift(); demo.courts[courtNo] = { matchId, running: false, startedAt: null, elapsed: 0 }; demo.liveScoring ||= {}; demo.liveScoring[matchId] = { a: 0, b: 0, serving: 'a', server: 2, timeouts: { a: 0, b: 0 }, running: false, startedAt: null, elapsed: 0, log: [] }; } demo.dreamBreaker.enabled = true; demo.demo = true; return demo; }
  function normalizeState(incoming) {
    const normalized = { ...freshState(incoming?.pairCounts || defaultPairCounts()), ...(incoming || {}) };
    normalized.pairCounts = normalizedPairCounts(normalized.pairCounts);
    if (incoming?.schedulerVersion !== 7) { normalized.opponentDraw = createOpponentDraw(normalized.pairCounts); const matches = generateSchedule(normalized.pairCounts, normalized.opponentDraw); normalized.matches = matches; normalized.queue = matches.map(match => match.id); normalized.courtSchedules = initialCourtSchedules(matches); normalized.courts = emptyCourts(); normalized.scores = {}; normalized.matchSettings = {}; normalized.scoreAudit = []; normalized.refereeAssignments = {}; normalized.medals = blankMedals(); normalized.dreamBreaker = blankDreamBreaker(); normalized.drawCeremonyDraft = null; normalized.schedulerVersion = 7; normalized.scheduleBaselineStartMinutes = config.event.roundRobinStartMinutes; }
    else { const storedBaseline = Number(incoming?.scheduleBaselineStartMinutes), inferredBaseline = Math.min(...(incoming?.matches || []).map(match => Number(match.startMinutes)).filter(Number.isFinite)), baseline = Number.isFinite(storedBaseline) ? storedBaseline : inferredBaseline; if (Number.isFinite(baseline) && baseline !== config.event.roundRobinStartMinutes) { const shift = config.event.roundRobinStartMinutes - baseline; normalized.matches.forEach(match => { match.startMinutes = Math.max(0, Math.min(1435, Number(match.startMinutes) + shift)); }); } normalized.scheduleBaselineStartMinutes = config.event.roundRobinStartMinutes; }
    normalized.courts = { ...emptyCourts(), ...(normalized.courts || {}) }; normalized.matchSettings ||= {}; normalized.scores ||= {}; normalized.scoreAudit ||= []; normalized.scheduleHistory ||= []; normalized.refereeAssignments ||= {}; normalized.checkins ||= {}; normalized.pairs = { ...emptyPairs(normalized.pairCounts), ...(normalized.pairs || {}) }; normalized.medals = { ...blankMedals(), ...(normalized.medals || {}) }; normalized.dreamBreaker = { ...blankDreamBreaker(), ...(normalized.dreamBreaker || {}), scores: { ...blankDreamBreaker().scores, ...(normalized.dreamBreaker?.scores || {}) }, history: normalized.dreamBreaker?.history || [] };
    normalized.matches.forEach(match => { match.startMinutes = Number.isFinite(Number(match.startMinutes)) ? Number(match.startMinutes) : config.event.roundRobinStartMinutes + (Math.max(1, Number(match.wave) || 1) - 1) * config.event.slotMinutes; match.time = `${timeLabel(match.startMinutes)}-${timeLabel(match.startMinutes + config.event.slotMinutes)}`; });
    normalized.courtSchedules ||= initialCourtSchedules(normalized.matches);
    const scheduled = new Set();
    Object.keys(normalized.courtSchedules).forEach(no => { normalized.courtSchedules[no] = (normalized.courtSchedules[no] || []).filter(id => validMatch(normalized, id) && !scheduled.has(id) && (scheduled.add(id) || true)); });
    normalized.matches.forEach(match => { if (!scheduled.has(match.id)) (normalized.courtSchedules[match.court] ||= []).push(match.id); });
    const validIds = new Set(normalized.matches.map(match => match.id)), assigned = new Set(Object.values(normalized.courts).map(court => court.matchId).filter(Boolean));
    const preserved = Array.isArray(normalized.queue) ? normalized.queue.filter((id, index, list) => validIds.has(id) && list.indexOf(id) === index && !assigned.has(id) && !(normalized.scores[id]?.a !== '' && normalized.scores[id]?.a !== undefined && normalized.scores[id]?.b !== '' && normalized.scores[id]?.b !== undefined)) : [];
    const missing = normalized.matches.filter(match => !preserved.includes(match.id) && !assigned.has(match.id) && !(normalized.scores[match.id]?.a !== '' && normalized.scores[match.id]?.a !== undefined && normalized.scores[match.id]?.b !== '' && normalized.scores[match.id]?.b !== undefined)).map(match => match.id);
    normalized.queue = [...preserved, ...missing]; normalized.version = 11;
    return normalized;
  }
  function validMatch(target, id) { return target.matches.some(match => match.id === id); }
  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      if (saved?.pairCounts && saved?.matches?.length === totalMatchCount(saved.pairCounts) && saved.pairs && saved.scores) {
        saved.queue ||= saved.matches.filter(m => !saved.scores[m.id]).map(m => m.id);
        saved.courts ||= emptyCourts(); saved.scoreAudit ||= []; saved.refereeAssignments ||= {}; saved.checkins ||= {}; saved.version = 3;
        return normalizeState(saved);
      }
    } catch (_) {}
    return demoMode ? freshDemoState() : freshState();
  }
  let state = loadState(), registrations = [], refereeDirectory = [], controlReady = false, refereeBoardPublished = false, activeView = 'overview', standingsCategory = config.categories[0], teamCategory = config.categories[0], medalCategory = config.categories[0], activeMatchId = null, cloudUser = null, cloudApplying = false, cloudSaveTimer, dreamTossDismissed = false, demoClockMinutes = 600, demoClockStartedAt = Date.now();
  function operationalClock() {
    if (demoMode) return { dateKey: config.event.date, minute: demoClockMinutes + (Date.now() - demoClockStartedAt) / 60000 };
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
    return { dateKey: `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`, minute: parts.hour * 60 + parts.minute + parts.second / 60 };
  }
  function clockLabel(totalMinutes) { const seconds = Math.floor(totalMinutes * 60) % 60, minutes = Math.floor(totalMinutes) % 60, hours24 = Math.floor(totalMinutes / 60) % 24, hours = hours24 % 12 || 12; return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')} ${hours24 >= 12 ? 'PM' : 'AM'}`; }
  function setDemoClock(minute) { demoClockMinutes = Math.max(0, Math.min(1439, minute)); demoClockStartedAt = Date.now(); renderCourtTimeline(); }
  function saveState() { state.updatedAt = new Date().toISOString(); localStorage.setItem(storageKey, JSON.stringify(state)); if (!demoMode && cloudUser && !cloudApplying) { const pendingState = structuredClone(state); clearTimeout(cloudSaveTimer); cloudSaveTimer = setTimeout(() => publishControl(pendingState).catch(() => toast('Cloud sync failed. Check Firebase access.')), 180); } }
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
    const rows = Array.from({ length: pairCount(category, clubId) }, (_, index) => {
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
      return { code, names: pairNames(category, code), played, wins, losses: played - wins, winRate: played ? wins / played : 0, pointsFor, pointsAgainst, diff: pointsFor - pointsAgainst, diffPerMatch: played ? (pointsFor - pointsAgainst) / played : 0, pointsPerMatch: played ? pointsFor / played : 0 };
    });
    return rows.sort((a, b) => b.winRate - a.winRate || b.diffPerMatch - a.diffPerMatch || b.pointsPerMatch - a.pointsPerMatch || b.wins - a.wins || a.code.localeCompare(b.code)).map((row, index) => ({ ...row, rank: index + 1 }));
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
    const matchesTotal = totalMatchCount(), totalPairs = config.categories.reduce((sum, category) => sum + config.clubs.reduce((clubTotal, club) => clubTotal + pairCount(category, club.id), 0), 0);
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
  function clockText(seconds) { return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }
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
  function slotMinutesFor(courtNo, id) { const match = state.matches.find(item => item.id === id); return Number.isFinite(Number(match?.startMinutes)) ? Number(match.startMinutes) : config.event.roundRobinStartMinutes; }
  function plannedLabel(courtNo, id) { const start = slotMinutesFor(courtNo, id); return `${timeLabel(start)}-${timeLabel(start + config.event.slotMinutes)}`; }
  function registrationForPair(category, clubId, code) { return registrations.find(item => item.status === 'confirmed' && item.category === category && item.club === clubId && item.pairCode === code); }
  function playerIdentity(category, clubId, code, playerIndex) {
    const registration = registrationForPair(category, clubId, code), player = registration?.players?.[playerIndex], dupr = String(player?.dupr || '').trim().toLowerCase(), email = String(player?.email || '').trim().toLowerCase();
    if (dupr) return `dupr:${dupr}`;
    if (email) return `email:${email}`;
    if (registration?.id) return `registration:${registration.id}:${playerIndex}`;
    return `slot:${category}|${clubId}|${code}|${playerIndex}`;
  }
  function matchPlayers(id) { const match = state.matches.find(item => item.id === id); if (!match) return []; return [['ocpc', match.a], ['rebels', match.b]].flatMap(([clubId, code]) => [0, 1].map(index => playerIdentity(match.category, clubId, code, index))); }
  function checkinPhoto(category, code, clubId, index) { return Object.values(state.checkins || {}).find(item => item.category === category && item.pair === code && item.club === clubId && Number(item.playerIndex) === index)?.photoThumb || ''; }
  function playerPortraits(match, side) { const code = side === 'a' ? match.a : match.b, clubId = side === 'a' ? 'ocpc' : 'rebels', pair = pairData(match.category, code); return [pair.player1, pair.player2].map((name, index) => { const photo = checkinPhoto(match.category, code, clubId, index); return `<span>${photo ? `<img src="${photo}" alt="">` : '<i class="court-photo-placeholder"></i>'}<b>${esc(name || 'Player pending')}</b></span>`; }).join(''); }
  function defaultMatchRules(mode = 'round-robin') { return mode === 'gold-final' ? { mode, label: 'Gold / Silver', scoring: 'side-out', target: 15, suddenDeathAt: 19, timer: false } : mode === 'custom' ? { mode, label: 'Custom', scoring: 'side-out', target: 11, suddenDeathAt: 10, timer: true } : { mode: 'round-robin', label: 'Round Robin', scoring: 'side-out', target: 11, suddenDeathAt: 10, timer: true }; }
  function rulesFor(id) { return state.matchSettings[id] ||= defaultMatchRules(); }
  function conflictsFor(id, courtNo) {
    const players = matchPlayers(id), conflicts = [], slot = slotMinutesFor(courtNo, id), schedule = state.courtSchedules[courtNo] || [];
    schedule.filter(otherId => otherId !== id && !isComplete(otherId) && Math.abs(slotMinutesFor(courtNo, otherId) - slot) < config.event.slotMinutes).forEach(() => conflicts.push(`Overlapping match on Court ${courtNo}`));
    state.matches.filter(other => other.id !== id && matchPlayers(other.id).some(player => players.includes(player))).forEach(other => { const gap = Math.abs(Number(other.startMinutes) - slot); if (gap === 0) conflicts.push(`Same player scheduled on Court ${other.court} at ${timeLabel(slot)}`); else if (gap <= config.event.slotMinutes) conflicts.push(`B2B player warning: also in ${other.id} at ${timeLabel(other.startMinutes)} on Court ${other.court}`); });
    return [...new Set(conflicts)];
  }
  function courtScheduleStatus(courtNo) {
    const next = scheduledWaiting(courtNo)[0]; if (!next) return { tone: 'safe', text: 'Schedule complete', minutes: 0 };
    const now = operationalClock();
    if (now.dateKey !== config.event.date) return { tone: 'safe', text: 'On schedule', minutes: 0 };
    const current = Math.floor(now.minute), delta = current - slotMinutesFor(courtNo, next);
    return delta > 4 ? { tone: delta >= 15 ? 'danger' : 'warn', text: `${delta} min delayed`, minutes: delta } : delta < -4 ? { tone: 'safe', text: `${Math.abs(delta)} min ahead`, minutes: delta } : { tone: 'safe', text: 'On schedule', minutes: delta };
  }
  function renderCourtTimeline() {
    const scheduledMinutes = state.matches.map(match => Number(match.startMinutes)).filter(Number.isFinite), firstScheduled = scheduledMinutes.length ? Math.max(0, Math.floor(Math.min(...scheduledMinutes) / 5) * 5) : 0, start = demoMode ? Math.min(firstScheduled, 600) : firstScheduled, end = 24 * 60, rows = Math.max(1, Math.ceil((end - start) / 5) + 1);
    const headers = `<div class="calendar-corner">Time</div>${Array.from({ length: config.event.courts }, (_, i) => { const courtNo = i + 1, status = courtScheduleStatus(courtNo); return `<header class="timeline-head ${status.tone}" data-court-schedule-status="${courtNo}"><div><b>Court ${courtNo}</b><small>${scheduledWaiting(courtNo).length} scheduled</small></div><strong>${status.text}</strong></header>`; }).join('')}`;
    const liveRow = `<div class="calendar-live-label">LIVE<br>COURT</div>${Array.from({ length: config.event.courts }, (_, i) => activeCourtMarkup(i + 1)).join('')}`;
    const scheduleRows = Array.from({ length: rows }, (_, row) => { const minute = start + row * 5; return `<div class="calendar-time ${minute % 60 === 0 ? 'hour' : ''}" data-calendar-minute="${minute}">${minute % 15 === 0 ? timeLabel(minute) : ''}</div>${Array.from({ length: config.event.courts }, (_, i) => scheduleCellMarkup(i + 1, minute)).join('')}`; }).join('');
    const minute = operationalClock().minute, showNeedle = minute >= start && minute < end;
    const needleKey = `<div class="time-needle-key"><i></i><span>Live time needle</span></div>`;
    $('#courtTimeline').dataset.calendarStart = start; $('#courtTimeline').innerHTML = `${headers}${liveRow}${scheduleRows}${showNeedle ? `<div class="current-time-needle"><span>${clockLabel(minute)}</span></div>` : ''}${needleKey}`; positionTimeNeedle($('#courtTimeline'), minute, start);
    $$('[data-drag-match]').forEach(card => card.ondragstart = event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', card.dataset.dragMatch); card.classList.add('dragging'); });
    $$('[data-drag-match]').forEach(card => card.ondragend = () => card.classList.remove('dragging'));
    $$('[data-drop-court]').forEach(cell => { cell.ondragover = event => { event.preventDefault(); cell.classList.add('drag-over'); }; cell.ondragleave = () => cell.classList.remove('drag-over'); cell.ondrop = event => { event.preventDefault(); cell.classList.remove('drag-over'); moveScheduledMatch(event.dataTransfer.getData('text/plain'), Number(cell.dataset.dropCourt), Number(cell.dataset.dropMinute)); }; cell.oncontextmenu = event => { event.preventDefault(); showScheduleContextMenu(event.clientX, event.clientY, Number(cell.dataset.dropCourt), Number(cell.dataset.dropMinute)); }; });
    bindCourtControls();
  }
  function scheduleCellMarkup(courtNo, minute) {
    const matches = (state.courtSchedules[courtNo] || []).map(id => state.matches.find(item => item.id === id)).filter(match => match && Number(match.startMinutes) === minute), match = matches[0], id = match?.id, active = Object.values(state.courts).some(court => court.matchId === id), done = id && isComplete(id), conflicts = id ? conflictsFor(id, courtNo) : [];
    if (!match) return `<div class="calendar-cell empty" data-drop-court="${courtNo}" data-drop-minute="${minute}"></div>`;
    const official = state.refereeAssignments?.[id];
    return `<div class="calendar-cell occupied" data-drop-court="${courtNo}" data-drop-minute="${minute}"><article class="timeline-match ${categoryClass(match.category)} ${conflicts.length || matches.length > 1 ? 'has-conflict' : ''} ${active ? 'on-court' : ''} ${done ? 'completed' : ''}" draggable="${!active && !done}" data-drag-match="${id}" title="${esc(conflicts.join(' · '))}"><div class="timeline-pairs"><small>${match.id} · ${esc(match.category)} · ${timeLabel(minute)}</small>${calendarPairLine(match, 'a', active)}<span>vs</span>${calendarPairLine(match, 'b', active)}${active ? '<em>Currently on court</em>' : done ? `<em>Final ${scoreFor(id).a}-${scoreFor(id).b}</em>` : conflicts.length ? `<em>${esc(conflicts[0])}</em>` : ''}</div>${done ? '' : `<button class="calendar-referee ${official ? 'assigned' : ''}" data-assign-official="${id}" data-assignment-court="${courtNo}" type="button" draggable="false">${official ? `Ref · ${esc(official.split('@')[0])}` : 'Assign ref'}</button>`}${conflicts.length || matches.length > 1 ? '<span class="conflict-mark">!</span>' : ''}</article></div>`;
  }
  function calendarPairLine(match, side, active) { const code = side === 'a' ? match.a : match.b, pair = pairData(match.category, code), names = [pair.player1, pair.player2].filter(Boolean), live = state.liveScoring?.[match.id], showServer = active && !!state.refereeAssignments?.[match.id] && live?.serving === side, serverIndex = Number(live?.serverPlayer) || 0; return `<b>${(names.length ? names : ['Players not assigned']).map((name, index) => `${showServer && index === serverIndex ? '<i class="serving-ball" title="Currently serving"></i>' : ''}${esc(name)}`).join(' / ')}</b>`; }
  function positionTimeNeedle(timeline, minute, start) {
    const needle = timeline ? $('.current-time-needle', timeline) : null;
    const rows = timeline ? $$('.calendar-time', timeline) : [];
    if (!needle || !rows.length || !Number.isFinite(start)) return;

    const exactRow = Math.max(0, Math.min(rows.length - 1, (minute - start) / 5));
    const lowerIndex = Math.floor(exactRow);
    const upperIndex = Math.min(rows.length - 1, lowerIndex + 1);
    const lowerTop = rows[lowerIndex].offsetTop;
    const upperTop = rows[upperIndex].offsetTop;
    const fraction = exactRow - lowerIndex;

    // Anchor to the surrounding rendered rows instead of projecting the first
    // row's height across the day. Grid rows can differ by a pixel, and that
    // difference otherwise accumulates into a large late-evening drift.
    needle.style.top = `${lowerTop + (upperTop - lowerTop) * fraction}px`;
    if (!needle.classList.contains('is-live')) requestAnimationFrame(() => needle.classList.add('is-live'));
  }
  function activeCourtMarkup(courtNo) {
    const court = state.courts[courtNo], match = state.matches.find(item => item.id === court.matchId), next = nextForCourt(courtNo);
    if (!match) return `<section class="active-court empty"><b>Court vacant</b><small>${next ? `${next} is next at ${plannedLabel(courtNo, next).split('-')[0]}` : 'Schedule complete'}</small>${next ? `<button class="btn btn-primary" data-promote-court="${courtNo}">Promote next match</button>` : ''}</section>`;
    const live = state.liveScoring?.[match.id] || court, rules = rulesFor(match.id), seconds = elapsedSeconds(live), done = isComplete(match.id), winner = done ? (Number(scoreFor(match.id).a) > Number(scoreFor(match.id).b) ? 'a' : 'b') : '', interruption = live.interruption?.active ? live.interruption : null, interruptionSeconds = interruption ? elapsedSeconds(interruption) : 0, interruptionTone = interruption && ['medical','technical'].includes(interruption.type) ? 'interruption-danger' : interruption && interruption.type.startsWith('timeout-') ? 'interruption-warning' : interruption ? 'interruption-danger' : '', status = courtStatusText(live, done, seconds);
    const official = state.refereeAssignments?.[match.id];
    return `<section class="active-court ${categoryClass(match.category)} ${timerClass(seconds)} ${interruptionTone}" data-active-court="${courtNo}"><div class="active-court-top"><span>${match.id} · ${esc(match.category)}</span><b data-court-status="${courtNo}">${status}</b></div>${interruption ? `<div class="court-interruption"><span>${esc(interruption.label)}</span><b data-interruption-clock="${courtNo}">${clockText(interruptionSeconds)}</b><button data-end-interruption="${courtNo}">End</button></div>` : ''}<div class="active-score"><div class="active-team ${winner === 'a' ? 'winner' : ''}"><div>${playerPortraits(match, 'a')}</div><strong>${winner === 'a' ? '🏆 ' : ''}${esc(pairNames(match.category, match.a))}</strong></div><b>${done ? scoreFor(match.id).a : live.a ?? 0}<small>–</small>${done ? scoreFor(match.id).b : live.b ?? 0}</b><div class="active-team ${winner === 'b' ? 'winner' : ''}"><div>${playerPortraits(match, 'b')}</div><strong>${winner === 'b' ? '🏆 ' : ''}${esc(pairNames(match.category, match.b))}</strong></div></div><div class="court-official"><span>Referee</span><b>${official ? esc(official) : 'Unassigned'}</b><button data-assign-official="${match.id}" data-assignment-court="${courtNo}">${official ? 'Swap' : 'Assign'}</button></div><div class="court-rule-summary"><b>${esc(rules.label)}</b><span>${rules.scoring === 'rally' ? 'Rally scoring' : 'Side-out'} · to ${rules.target} · ${rules.timer ? 'timed' : 'no timer'}</span></div><div class="active-actions">${rules.timer ? `<button class="court-timer-control" data-timer-toggle="${courtNo}"><span>${live.running ? 'Pause' : seconds ? 'Resume' : 'Start'}</span><b data-court-clock="${courtNo}">${timerText(seconds)}</b></button>` : '<span class="no-timer">No match timer</span>'}<button data-score-id="${match.id}">${done ? 'Override score' : 'Enter score'}</button><button data-court-settings="${courtNo}">Scoring settings</button><button data-court-tools="${courtNo}">Match tools</button><button class="vacate" data-vacate-court="${courtNo}">${done ? 'Confirm court vacant' : 'Remove from court'}</button></div></section>`;
  }
  function courtStatusText(live, done, seconds = elapsedSeconds(live)) { if (done) return 'FINAL'; if (live.interruption?.active) return ({ 'timeout-a': 'OCPC TEAM TIMEOUT', 'timeout-b': 'RALLY REBELS TEAM TIMEOUT', medical: 'MEDICAL TIMEOUT', technical: 'TECHNICAL TIMEOUT', referee: 'REFEREE TIMEOUT', equipment: 'EQUIPMENT TIMEOUT' })[live.interruption.type] || String(live.interruption.label || 'INTERRUPTION').toUpperCase(); if (live.running) return 'LIVE'; return seconds > 0 ? 'PAUSED' : 'READY'; }
  function matchHasStarted(matchId) { const live = state.liveScoring?.[matchId]; return Boolean(state.scores?.[matchId] || live && (live.running || live.startedAt || Number(live.elapsed) > 0 || Number(live.a) > 0 || Number(live.b) > 0 || live.pregame?.complete)); }
  function pushScheduleHistory(label) { state.scheduleHistory ||= []; state.scheduleHistory.push({ label, matches: state.matches.map(match => ({ id: match.id, court: match.court, startMinutes: match.startMinutes })) }); if (state.scheduleHistory.length > 20) state.scheduleHistory.shift(); }
  function rebuildCourtSchedules() { state.courtSchedules = Object.fromEntries(Array.from({ length: config.event.courts }, (_, index) => { const court = index + 1; return [court, state.matches.filter(match => Number(match.court) === court).sort((a, b) => a.startMinutes - b.startMinutes || a.id.localeCompare(b.id)).map(match => match.id)]; })); syncQueueFromCourtSchedules(); }
  function moveScheduledMatch(id, courtNo, targetMinute) {
    if (!id || isComplete(id) || Object.values(state.courts).some(court => court.matchId === id)) return toast('Only waiting matches can be moved.');
    const match = state.matches.find(item => item.id === id), oldCourt = Number(match.court), oldMinute = Number(match.startMinutes), snappedMinute = Math.max(0, Math.min(1435, Math.round(targetMinute / 5) * 5));
    if (oldCourt === Number(courtNo) && oldMinute === snappedMinute) return;
    const occupying = state.matches.filter(other => other.id !== id && Number(other.court) === Number(courtNo) && Math.abs(Number(other.startMinutes) - snappedMinute) < config.event.slotMinutes);
    if (occupying.length > 1) return toast('This area already has multiple overlapping matches. Resolve it before swapping.');
    const target = occupying[0], targetOldMinute = Number(target?.startMinutes);
    if (target && (isComplete(target.id) || Object.values(state.courts).some(court => court.matchId === target.id))) return toast('An active or completed match cannot be swapped.');
    pushScheduleHistory(target ? `Swap ${id} with ${target.id}` : `Move ${id}`);
    if (target) { target.court = oldCourt; target.startMinutes = oldMinute; target.time = `${timeLabel(oldMinute)}-${timeLabel(oldMinute + config.event.slotMinutes)}`; match.court = Number(courtNo); match.startMinutes = targetOldMinute; }
    else { match.court = Number(courtNo); match.startMinutes = snappedMinute; }
    match.time = `${timeLabel(match.startMinutes)}-${timeLabel(match.startMinutes + config.event.slotMinutes)}`; rebuildCourtSchedules(); const conflicts = conflictsFor(id, Number(match.court)); saveState(); renderAll();
    toast(target ? `Swapped ${id} with ${target.id}.` : conflicts.length ? `Moved with warning: ${conflicts[0]}` : `Moved ${id} to Court ${courtNo}.`);
  }
  function showScheduleContextMenu(x, y, courtNo, fromMinute) {
    $('#scheduleContextMenu')?.remove(); document.body.insertAdjacentHTML('beforeend', `<div class="schedule-context" id="scheduleContextMenu" style="left:${Math.min(x, innerWidth - 300)}px;top:${Math.min(y, innerHeight - 280)}px"><b>Court ${courtNo} · ${timeLabel(fromMinute)}</b><small>Move this court's remaining schedule in 5-minute steps.</small><label>Minutes<input id="bumpMinutes" type="number" step="5" value="5"></label><label>Apply to<select id="bumpScope"><option value="remaining">Matches from ${timeLabel(fromMinute)}</option><option value="all">All matches on Court ${courtNo}</option></select></label><div><button class="btn btn-primary" id="applyScheduleBump">Bump matches</button><button class="btn btn-quiet" id="undoScheduleBump" ${state.scheduleHistory?.length ? '' : 'disabled'}>Undo last change</button></div></div>`);
    const menu = $('#scheduleContextMenu'); const close = event => { if (!menu.contains(event.target)) { menu.remove(); document.removeEventListener('pointerdown', close); } }; setTimeout(() => document.addEventListener('pointerdown', close), 0);
    $('#applyScheduleBump').onclick = () => { const amount = Math.round((Number($('#bumpMinutes').value) || 0) / 5) * 5, scope = $('#bumpScope').value; if (!amount) return toast('Enter a non-zero number of minutes.'); pushScheduleHistory(`Bump Court ${courtNo} by ${amount} minutes`); state.matches.filter(match => Number(match.court) === courtNo && (scope === 'all' || match.startMinutes >= fromMinute)).forEach(match => { match.startMinutes = Math.max(0, Math.min(1435, match.startMinutes + amount)); match.time = `${timeLabel(match.startMinutes)}-${timeLabel(match.startMinutes + config.event.slotMinutes)}`; }); rebuildCourtSchedules(); saveState(); menu.remove(); renderAll(); toast(`Court ${courtNo} schedule moved ${amount > 0 ? 'forward' : 'back'} ${Math.abs(amount)} minutes.`); };
    $('#undoScheduleBump').onclick = undoScheduleChange;
  }
  function undoScheduleChange() { const snapshot = state.scheduleHistory?.pop(); if (!snapshot) return toast('No schedule change to undo.'); snapshot.matches.forEach(saved => { const match = state.matches.find(item => item.id === saved.id); if (match) { match.court = saved.court; match.startMinutes = saved.startMinutes; match.time = `${timeLabel(match.startMinutes)}-${timeLabel(match.startMinutes + config.event.slotMinutes)}`; } }); rebuildCourtSchedules(); saveState(); $('#scheduleContextMenu')?.remove(); renderAll(); toast(`Undid: ${snapshot.label}.`); }
  function renderCourts() {
    renderCourtTimeline();
  }
  function bindCourtControls() {
    bindScoreButtons();
    $$('[data-promote-court]').forEach(button => button.onclick = () => assignNext(Number(button.dataset.promoteCourt)));
    $$('[data-timer-toggle]').forEach(button => button.onclick = () => toggleTimer(Number(button.dataset.timerToggle)));
    $$('[data-vacate-court]').forEach(button => button.onclick = () => vacateCourt(Number(button.dataset.vacateCourt)));
    $$('[data-court-tools]').forEach(button => button.onclick = () => showCourtTools(Number(button.dataset.courtTools)));
    $$('[data-court-settings]').forEach(button => button.onclick = () => showCourtSettings(Number(button.dataset.courtSettings)));
    $$('[data-end-interruption]').forEach(button => button.onclick = () => endInterruption(Number(button.dataset.endInterruption)));
    $$('[data-assign-official]').forEach(button => { const matchId = button.dataset.assignOfficial, locked = matchHasStarted(matchId) && !state.refereeAssignments?.[matchId]; if (locked) { button.disabled = true; button.textContent = 'Assignment locked'; button.title = 'This match started without a referee.'; } button.onclick = event => { event.preventDefault(); event.stopPropagation(); if (!locked) showRefereeAssignment(matchId, Number(button.dataset.assignmentCourt)); }; button.onpointerdown = event => event.stopPropagation(); button.ondragstart = event => event.preventDefault(); });
  }
  function showRefereeAssignment(matchId, courtNo) {
    const match = state.matches.find(item => item.id === matchId); if (!match) return;
    const current = state.refereeAssignments?.[matchId] || '', known = [...new Set([...refereeDirectory.map(person => person.email), ...Object.values(state.refereeAssignments || {})].filter(Boolean))].sort();
    if (matchHasStarted(matchId) && !current) return showNotice('This match has already started without an assigned referee. A referee can no longer be added.', 'Referee assignment locked');
    $('#refereeAssignmentModal')?.remove(); document.body.insertAdjacentHTML('beforeend', `<div class="court-tools-backdrop" id="refereeAssignmentModal"><section class="referee-assignment-modal"><button class="modal-close contrast-close" data-close-referee>×</button><span class="section-label">${courtNo ? `Court ${courtNo} · ` : ''}${match.id} · ${timeLabel(match.startMinutes)}</span><h2>${current ? 'Change referee' : 'Assign referee'}</h2><div class="assignment-matchup"><div><small>OCPC</small><b>${esc(pairNames(match.category, match.a))}</b></div><span>VS</span><div><small>Rally Rebels</small><b>${esc(pairNames(match.category, match.b))}</b></div></div><label class="official-picker">Available referee<select id="assignmentRefereeEmail"><option value="">Select a referee</option>${known.map(email => { const person = refereeDirectory.find(item => item.email === email), name = person ? [person.firstName,person.lastName].filter(Boolean).join(' ') : ''; return `<option value="${esc(email)}" ${email === current ? 'selected' : ''}>${esc(name ? `${name} · ${email}` : email)}</option>`; }).join('')}</select></label>${known.length ? '' : '<p class="empty-officials">No referees are available yet. Grant Referee access in Settings first.</p>'}<p>Changes take effect immediately, including during a live match.</p><div class="form-actions"><button class="btn btn-primary" id="saveRefereeAssignment" ${known.length ? '' : 'disabled'}>${current ? 'Save referee change' : 'Assign referee'}</button>${current ? '<button class="btn btn-danger" id="removeRefereeAssignment">Remove referee</button>' : ''}</div></section></div>`);
    const modal = $('#refereeAssignmentModal'), close = () => modal.remove(); modal.onclick = event => { if (event.target === modal || event.target.closest('[data-close-referee]')) close(); };
    $('#saveRefereeAssignment').onclick = () => { const email = $('#assignmentRefereeEmail').value.trim().toLowerCase(); if (!email) return toast('Choose an available referee.'); state.refereeAssignments[matchId] = email; saveState(); close(); renderAll(); toast(`${email} assigned to ${match.id}.`); };
    if ($('#removeRefereeAssignment')) { if (matchHasStarted(matchId)) $('#removeRefereeAssignment').remove(); else $('#removeRefereeAssignment').onclick = () => { delete state.refereeAssignments[matchId]; saveState(); close(); renderAll(); toast(`Referee removed from ${match.id}.`); }; }
  }
  function showCourtSettings(courtNo) {
    const matchId = state.courts[courtNo]?.matchId; if (!matchId) return;
    const live = state.liveScoring?.[matchId] || {}, rules = rulesFor(matchId), started = elapsedSeconds(live) > 0 || live.running || Number(live.a) > 0 || Number(live.b) > 0;
    document.body.insertAdjacentHTML('beforeend', `<div class="court-tools-backdrop" id="courtSettingsModal"><section><button class="modal-close" data-close-settings>×</button><span class="section-label">Court ${courtNo} · ${matchId}</span><h2>Scoring settings</h2><p>${started ? 'Settings are locked because play has started.' : 'Choose the format before starting the match.'}</p><div class="court-settings-form"><label>Match mode<select id="courtMode" ${started ? 'disabled' : ''}><option value="round-robin" ${rules.mode === 'round-robin' ? 'selected' : ''}>Round Robin</option><option value="gold-final" ${rules.mode === 'gold-final' ? 'selected' : ''}>Gold / Silver</option><option value="custom" ${rules.mode === 'custom' ? 'selected' : ''}>Custom</option></select></label><label>Scoring<select id="courtScoring" ${rules.mode !== 'custom' || started ? 'disabled' : ''}><option value="side-out" ${rules.scoring === 'side-out' ? 'selected' : ''}>Side-out</option><option value="rally" ${rules.scoring === 'rally' ? 'selected' : ''}>Rally</option></select></label><label>Play to<input id="courtTarget" type="number" min="1" max="30" value="${rules.target}" ${rules.mode !== 'custom' || started ? 'disabled' : ''}></label><label>Sudden death at<input id="courtSudden" type="number" min="1" max="30" value="${rules.suddenDeathAt}" ${rules.mode !== 'custom' || started ? 'disabled' : ''}></label><label class="setting-check"><input id="courtTimer" type="checkbox" ${rules.timer ? 'checked' : ''} ${started ? 'disabled' : ''}> Use court timer</label></div><button class="btn btn-primary" id="saveCourtSettings" ${started ? 'disabled' : ''}>Save settings</button></section></div>`);
    const modal = $('#courtSettingsModal'); modal.onclick = event => { if (event.target.id === 'courtSettingsModal' || event.target.closest('[data-close-settings]')) modal.remove(); };
    $('#courtMode').onchange = event => { const next = defaultMatchRules(event.target.value); $('#courtScoring').value = next.scoring; $('#courtTarget').value = next.target; $('#courtSudden').value = next.suddenDeathAt; $('#courtTimer').checked = next.timer; const custom = event.target.value === 'custom'; $('#courtScoring').disabled = !custom; $('#courtTarget').disabled = !custom; $('#courtSudden').disabled = !custom; };
    $('#saveCourtSettings').onclick = () => { const mode = $('#courtMode').value, next = defaultMatchRules(mode); if (mode === 'custom') { next.scoring = $('#courtScoring').value; next.target = Math.max(1, Math.min(30, Number($('#courtTarget').value) || 11)); next.suddenDeathAt = Math.max(next.target, Math.min(30, Number($('#courtSudden').value) || next.target)); next.timer = $('#courtTimer').checked; } state.matchSettings[matchId] = next; saveState(); modal.remove(); renderCourts(); toast('Court scoring settings saved.'); };
  }
  function vacateCourt(courtNo) {
    const court = state.courts[courtNo]; if (!court?.matchId) return; const id = court.matchId, done = isComplete(id);
    if (!confirm(done ? `Confirm Court ${courtNo} is vacant after ${id}? The next match will remain scheduled until you promote it.` : `Remove ${id} from Court ${courtNo} before it is complete? Its live timer and scoring progress will be reset.`)) return;
    if (!done) { if (!state.queue.includes(id)) state.queue.unshift(id); delete state.liveScoring?.[id]; if (cloudUser) deleteMatch(id).catch(() => toast('Court cleared locally, but cloud cleanup failed.')); }
    state.courts[courtNo] = { matchId: '', running: false, startedAt: null, elapsed: 0 }; saveState(); renderAll(); toast(`Court ${courtNo} is vacant.`);
  }
  function showCourtTools(courtNo) {
    const court = state.courts[courtNo], match = state.matches.find(item => item.id === court?.matchId); if (!match) return;
    state.liveScoring ||= {}; const live = state.liveScoring[match.id] ||= { a: 0, b: 0, timeouts: { a: 0, b: 0 }, medical: 0, technicalTimeouts: 0, refereeTimeouts: 0, equipmentTimeouts: 0, log: [], running: false, startedAt: null, elapsed: 0 };
    const current = live.interruption?.active ? `<div class="tools-current"><span>Active now</span><b>${esc(live.interruption.label)}</b><strong>${clockText(elapsedSeconds(live.interruption))}</strong><button class="btn btn-primary" data-end-interruption="${courtNo}">End interruption</button></div>` : '';
    const teamTimeoutsAllowed = rulesFor(match.id).mode !== 'round-robin', timeoutHelp = teamTimeoutsAllowed ? 'One 60-second timeout is available to each club.' : 'Team timeouts are not allowed during round robin.';
    document.body.insertAdjacentHTML('beforeend', `<div class="court-tools-backdrop" id="courtToolsModal"><section><button class="modal-close" data-close-tools>×</button><span class="section-label">Court ${courtNo} · ${match.id}</span><h2>Match interruptions</h2><p>Choose an interruption, review it in this panel, then confirm. ${timeoutHelp}</p>${current}<div class="guarded-tools"><button data-guarded-tool="timeout-a" ${!teamTimeoutsAllowed || (live.timeouts?.a || 0) >= 1 ? 'disabled' : ''}>OCPC timeout <b>${teamTimeoutsAllowed ? `${live.timeouts?.a || 0}/1 · 60 sec` : 'Not allowed'}</b></button><button data-guarded-tool="timeout-b" ${!teamTimeoutsAllowed || (live.timeouts?.b || 0) >= 1 ? 'disabled' : ''}>Rally Rebels timeout <b>${teamTimeoutsAllowed ? `${live.timeouts?.b || 0}/1 · 60 sec` : 'Not allowed'}</b></button><button data-guarded-tool="medical">Medical timeout <b>${live.medical || 0}</b></button><button data-guarded-tool="technical">Technical timeout <b>${live.technicalTimeouts || 0}</b></button><button data-guarded-tool="referee">Referee timeout <b>${live.refereeTimeouts || 0}</b></button><button data-guarded-tool="equipment">Equipment timeout <b>${live.equipmentTimeouts || 0}</b></button></div><div id="toolConfirmation"></div></section></div>`);
    $('#courtToolsModal').onclick = event => { if (event.target.id === 'courtToolsModal' || event.target.closest('[data-close-tools]')) $('#courtToolsModal').remove(); };
    $$('[data-guarded-tool]', $('#courtToolsModal')).forEach(button => button.onclick = () => armGuardedTool(courtNo, button.dataset.guardedTool)); $$('[data-end-interruption]', $('#courtToolsModal')).forEach(button => button.onclick = () => endInterruption(courtNo));
  }
  function armGuardedTool(courtNo, type) { const labels = { 'timeout-a': 'OCPC timeout', 'timeout-b': 'Rally Rebels timeout', medical: 'Medical timeout', technical: 'Technical timeout', referee: 'Referee timeout', equipment: 'Equipment timeout' }, panel = $('#toolConfirmation'); panel.innerHTML = `<div class="tool-confirm"><span>Confirm interruption</span><b>${esc(labels[type])}</b><p>The interruption timer begins immediately after confirmation.</p><div><button class="btn btn-primary" id="confirmGuardedTool">Confirm and start timer</button><button class="btn btn-quiet" id="cancelGuardedTool">Cancel</button></div></div>`; $('#confirmGuardedTool').onclick = () => applyGuardedTool(courtNo, type); $('#cancelGuardedTool').onclick = () => panel.innerHTML = ''; }
  function applyGuardedTool(courtNo, type) {
    const id = state.courts[courtNo]?.matchId, live = state.liveScoring[id]; if (!id || !live) return; const labels = { 'timeout-a': 'OCPC timeout', 'timeout-b': 'Rally Rebels timeout', medical: 'medical timeout', technical: 'technical timeout', referee: 'referee timeout', equipment: 'equipment timeout' }, label = labels[type];
    if (live.interruption?.active) return toast('End the current interruption before starting another.');
    const teamTimeout = type === 'timeout-a' || type === 'timeout-b'; if (teamTimeout && rulesFor(id).mode === 'round-robin') return toast('Team timeouts are not allowed during round robin.');
    if (teamTimeout && (live.timeouts?.[type.slice(-1)] || 0) >= 1) return toast('That club has already used its one timeout.');
    live.timeouts ||= { a: 0, b: 0 }; if (type === 'timeout-a') live.timeouts.a++; else if (type === 'timeout-b') live.timeouts.b++; else if (type === 'medical') live.medical = (live.medical || 0) + 1; else if (type === 'technical') live.technicalTimeouts = (live.technicalTimeouts || 0) + 1; else if (type === 'referee') live.refereeTimeouts = (live.refereeTimeouts || 0) + 1; else if (type === 'equipment') live.equipmentTimeouts = (live.equipmentTimeouts || 0) + 1;
    const resumeMatchOnEnd = Boolean(live.running); if (resumeMatchOnEnd) { live.elapsed = elapsedSeconds(live); live.running = false; live.startedAt = null; }
    live.interruption = { type, label, active: true, running: true, startedAt: Date.now(), elapsed: 0, resumeMatchOnEnd }; live.log ||= []; live.log.unshift({ at: new Date().toISOString(), text: `${label} started; match timer ${resumeMatchOnEnd ? 'paused automatically' : 'was already paused'}` }); saveState(); if (cloudUser) publishMatch(id, live, state.scores[id] || null); $('#courtToolsModal')?.remove(); renderCourts(); toast(`${label} started. Match timer paused.`);
  }
  function endInterruption(courtNo) { const id = state.courts[courtNo]?.matchId, live = state.liveScoring?.[id]; if (!live?.interruption?.active) return; const resumeMatch = Boolean(live.interruption.resumeMatchOnEnd) && !live.complete && !state.scores[id]; live.interruption.elapsed = elapsedSeconds(live.interruption); live.interruption.running = false; live.interruption.active = false; live.interruption.resumeMatchOnEnd = false; if (resumeMatch) { live.running = true; live.startedAt = Date.now(); } live.log ||= []; live.log.unshift({ at: new Date().toISOString(), text: `${live.interruption.label} ended after ${clockText(live.interruption.elapsed)}; match timer ${resumeMatch ? 'resumed automatically' : 'remained paused'}` }); saveState(); if (cloudUser) publishMatch(id, live, state.scores[id] || null); $('#courtToolsModal')?.remove(); renderCourts(); toast(`Interruption ended. Match timer ${resumeMatch ? 'resumed' : 'remains paused'}.`); }
  function activePlayerCourtConflicts(matchId) { const players = matchPlayers(matchId); return Object.entries(state.courts).filter(([, court]) => court.matchId && court.matchId !== matchId && matchPlayers(court.matchId).some(player => players.includes(player))).map(([courtNo, court]) => ({ courtNo: Number(courtNo), matchId: court.matchId })); }
  function showDispatchWarning(courtNo, matchId, conflicts) { $('#dispatchWarning')?.remove(); document.body.insertAdjacentHTML('beforeend', `<div class="dispatch-warning" id="dispatchWarning"><section><span class="section-label">Active player conflict</span><h2>Player already on court</h2><p>${esc(matchId)} includes a player currently active in ${conflicts.map(item => `${item.matchId} on Court ${item.courtNo}`).join(', ')}. Sending this match to Court ${courtNo} would place that player on two courts at once.</p><div><button class="btn btn-danger" id="confirmConflictDispatch">Send anyway</button><button class="btn btn-quiet" id="cancelConflictDispatch">Keep in schedule</button></div></section></div>`); $('#confirmConflictDispatch').onclick = () => { $('#dispatchWarning').remove(); assignMatch(courtNo, matchId, true); }; $('#cancelConflictDispatch').onclick = () => $('#dispatchWarning').remove(); }
  function assignMatch(courtNo, matchId, override = false) { if (!state.courts[courtNo] || state.courts[courtNo].matchId) return false; const conflicts = activePlayerCourtConflicts(matchId); if (conflicts.length && !override) { showDispatchWarning(courtNo, matchId, conflicts); return false; } state.courts[courtNo] = { matchId, running: false, startedAt: null, elapsed: 0 }; state.queue = state.queue.filter(id => id !== matchId); saveState(); renderAll(); return true; }
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
      return `<article class="standing-card"><div class="card-title"><h2>${esc(club.name)}</h2><span>Top 2 advance</span></div><div class="standing-method">Ranked by win percentage, average point differential, then average points scored.</div><div class="standing-row header"><span>#</span><span>Pair</span><span class="num">P</span><span class="num">W-L</span><span class="num">Win%</span><span class="num">Avg +/-</span><span class="num">Avg PF</span></div>${rows.map(r => `<div class="standing-row"><span class="rank">${r.rank}</span><span class="team-name"><b>${r.code}</b><small>${esc(r.names)}</small></span><span class="num">${r.played}</span><span class="num">${r.wins}-${r.losses}</span><span class="num">${Math.round(r.winRate * 100)}%</span><span class="num">${r.diffPerMatch > 0 ? '+' : ''}${r.diffPerMatch.toFixed(1)}</span><span class="num">${r.pointsPerMatch.toFixed(1)}</span></div>`).join('')}</article>`;
    }).join('');
    $$('[data-standing-category]').forEach(btn => btn.onclick = () => { standingsCategory = btn.dataset.standingCategory; renderStandings(); });
  }
  function clubTotals() {
    const stats = Object.fromEntries(config.clubs.map(club => [club.id, { wins: 0, losses: 0, played: 0, pointsFor: 0, pointsAgainst: 0, recentWins: [] }]));
    state.matches.forEach(match => { const score = scoreFor(match.id); if (!isComplete(match.id)) return; const winner = Number(score.a) > Number(score.b) ? 'ocpc' : 'rebels', loser = winner === 'ocpc' ? 'rebels' : 'ocpc'; stats[winner].wins++; stats[winner].played++; stats[loser].losses++; stats[loser].played++; stats.ocpc.pointsFor += Number(score.a); stats.ocpc.pointsAgainst += Number(score.b); stats.rebels.pointsFor += Number(score.b); stats.rebels.pointsAgainst += Number(score.a); const winningCode = winner === 'ocpc' ? match.a : match.b, losingCode = winner === 'ocpc' ? match.b : match.a; stats[winner].recentWins.push({ completedAt: score.completedAt || '', category: match.category, names: pairNames(match.category, winningCode), opponent: pairNames(match.category, losingCode), score: winner === 'ocpc' ? `${score.a}-${score.b}` : `${score.b}-${score.a}` }); });
    const dream = state.dreamBreaker.enabled ? state.dreamBreaker.scores : { ocpc: 0, rebels: 0 };
    return config.clubs.map(club => { const s = stats[club.id], dreamPoints = Number(dream[club.id]) || 0; return { ...club, ...s, matchWins: s.wins, dreamPoints, total: s.wins + dreamPoints, winRate: s.played ? s.wins / s.played : 0, differential: s.pointsFor - s.pointsAgainst, recentWins: s.recentWins.sort((a,b) => String(b.completedAt).localeCompare(String(a.completedAt))).slice(0, 3) }; }).sort((a, b) => b.total - a.total || b.matchWins - a.matchWins);
  }
  function renderClubStandings() {
    const totals = clubTotals(), leader = totals[0], tied = totals.length > 1 && totals[0].total === totals[1].total;
    $('#clubStandings').innerHTML = `<section class="club-scoreboard club-scoreboard-expanded"><div class="club-scoreboard-title"><div><span class="section-label">Club championship</span><h2>Overall club standings</h2><p>Every completed match contributes one win to the club total. Dream Breaker points are included only when enabled.</p></div><strong>${tied ? 'Currently tied' : `${esc(leader.short)} leads`}</strong></div><div class="club-rank-grid">${totals.map((club, index) => `<article class="club-rank-card club-dashboard-card ${index === 0 && !tied ? 'leading' : ''}"><header><span>${index + 1}</span><div><small>${index === 0 && !tied ? 'Current leader' : 'Club standing'}</small><h3>${esc(club.name)}</h3></div><b>${club.total}<small>club points</small></b></header><div class="club-stat-grid"><span><b>${club.wins}-${club.losses}</b><small>Win-loss</small></span><span><b>${Math.round(club.winRate * 100)}%</b><small>Win rate</small></span><span><b>${club.pointsFor}</b><small>Points for</small></span><span><b>${club.pointsAgainst}</b><small>Points against</small></span><span><b class="${club.differential >= 0 ? 'positive' : 'negative'}">${club.differential > 0 ? '+' : ''}${club.differential}</b><small>Point diff.</small></span><span><b>${club.dreamPoints}</b><small>Dream Breaker</small></span></div><section class="club-recent"><h4>Recent winning contributors</h4>${club.recentWins.length ? club.recentWins.map(win => `<div><span><b>${esc(win.names)}</b><small>${esc(win.category)} · defeated ${esc(win.opponent)}</small></span><strong>${win.score}</strong></div>`).join('') : '<p>No completed wins yet.</p>'}</section></article>`).join('')}</div><p class="club-scoring-note">Club points: match wins${state.dreamBreaker.enabled ? ' plus current Dream Breaker points' : ''}. The highest total earns Champion Club.</p></section>`;
    $('#dreamBreakerSummary').innerHTML = `<section class="dream-summary"><div><span class="section-label">Dream Breaker</span><b>${state.dreamBreaker.enabled ? `${state.dreamBreaker.scores.ocpc}-${state.dreamBreaker.scores.rebels} · first to ${state.dreamBreaker.target}` : 'Optional · currently disabled'}</b></div><button class="btn btn-quiet" data-open-dream>Open scoring desk</button></section>`;
    $('[data-open-dream]').onclick = () => showView('dream');
  }
  function rosterPlayers(clubId) { const prefix = config.clubs.find(club => club.id === clubId)?.pairPrefix; return Object.entries(state.pairs).filter(([key]) => key.split('|')[1]?.startsWith(prefix)).flatMap(([, pair]) => [pair.player1, pair.player2]).filter(Boolean).filter((name, index, all) => all.indexOf(name) === index); }
  function playerOptions(clubId, selected) { return `<option value="">Select player</option>${rosterPlayers(clubId).map(name => `<option ${name === selected ? 'selected' : ''}>${esc(name)}</option>`).join('')}`; }
  function renderDreamBreakerBoard() {
    const board = $('#dreamBreakerBoard'), dream = state.dreamBreaker;
    if (!dream.enabled) { board.innerHTML = `<section class="dream-board disabled"><span class="section-label">Optional tiebreaker</span><h2>Dream Breaker is not enabled</h2><p>Match Control can activate it in Settings if tournament time permits.</p></section>`; return; }
    const totalRallies = Number(dream.scores.ocpc) + Number(dream.scores.rebels), remainder = totalRallies % 4, nextSwitch = remainder ? 4 - remainder : 4, switchDue = totalRallies > 0 && remainder === 0 && dream.acknowledgedSwitchAt !== totalRallies, endsDue = Math.max(dream.scores.ocpc, dream.scores.rebels) >= 26 && !dream.endsChanged, winner = Number(dream.scores.ocpc) >= dream.target ? 'ocpc' : Number(dream.scores.rebels) >= dream.target ? 'rebels' : '', servingClub = config.clubs.find(club => club.id === dream.serving), servingScore = dream.serving ? Number(dream.scores[dream.serving]) : 0, servingSide = servingScore % 2 === 0 ? 'RIGHT' : 'LEFT';
    const tossPanel = dream.serving ? `<div class="dream-serve-status"><span>Serving now</span><b>${esc(servingClub?.name || '')}</b><strong>${servingSide} side</strong><small>${servingScore} is ${servingScore % 2 === 0 ? 'even' : 'odd'}</small></div>` : '';
    const tossOverlay = dream.serving || dreamTossDismissed ? '' : `<div class="dream-coin-overlay"><section><span class="section-label">Dream Breaker toss</span><h2>Coin Toss</h2><div class="peso-coin ${dream.tossResult || 'obverse'} ${dream.tossResult ? 'flipped' : ''}"></div>${!dream.tossResult ? `<p>Toss the coin, then record the club that won.</p><button id="flipDreamCoin">Toss coin</button>` : !dream.tossWinner ? `<p>Who won the toss?</p><div class="dream-toss-options">${config.clubs.map(club => `<button data-dream-toss-winner="${club.id}">${esc(club.short)} won</button>`).join('')}</div>` : `<p>${esc(config.clubs.find(club => club.id === dream.tossWinner).short)} won. Record their choice.</p><div class="dream-toss-options"><button data-dream-toss-choice="serve">Serve first</button><button data-dream-toss-choice="receive">Receive first</button><button data-dream-toss-choice="side">Choose court side</button></div>`}<button class="dream-toss-exit" id="exitDreamToss">Exit coin toss</button></section></div>`;
    const overlay = winner ? '' : endsDue ? `<div class="dream-interruption"><div><span>CHANGE ENDS</span><h2>First club reached 26</h2><p>Pause play and confirm both clubs have changed court ends.</p><button id="confirmDreamEnds">Teams changed ends · Continue play</button></div></div>` : switchDue ? `<div class="dream-interruption"><div><span>PLAYER SWITCH</span><h2>Four rallies completed</h2><p>Both clubs must send in their next captain-selected players before the next serve.</p><button id="confirmDreamSwitch">Players switched · Continue play</button></div></div>` : '';
    board.innerHTML = `<section class="dream-board scoring"><div class="club-scoreboard-title"><div><span class="section-label">Rally-scoring desk</span><h2>Dream Breaker · First to ${dream.target}</h2></div><strong>${winner ? `${esc(config.clubs.find(club => club.id === winner).short)} wins` : dream.serving ? `Switch in ${nextSwitch} rallies` : 'Toss required'}</strong></div>${tossPanel}<div class="dream-live-score">${config.clubs.map(club => `<article class="${winner === club.id ? 'winner' : ''} ${dream.serving === club.id ? 'serving' : ''}"><span>${esc(club.name)}</span><b>${dream.scores[club.id]}</b><button data-dream-point="${club.id}" ${winner || !dream.serving ? 'disabled' : ''}>+1 rally</button></article>`).join('')}</div>${dream.serving && !winner ? `<button class="dream-sideout" id="dreamSideout">Serving team fault · Point and side out to ${esc(config.clubs.find(club => club.id !== dream.serving)?.short || '')}</button>` : ''}<div class="dream-progress"><span style="width:${Math.min(100, totalRallies / Math.max(1, dream.target * 2) * 100)}%"></span></div><p>${totalRallies} total rallies logged. Rally scoring has no first or second server. Serving side follows the serving club's score: even on the right, odd on the left.</p><div class="stack-actions">${!dream.serving ? '<button class="btn btn-primary" id="openDreamToss">Open coin toss</button>' : ''}<button class="btn btn-quiet" id="undoDreamPoint" ${dream.history?.length ? '' : 'disabled'}>Undo last action</button><button class="btn btn-danger" id="resetDreamScore">Reset Dream Breaker</button></div>${overlay}${tossOverlay}</section>`;
    $('#exitDreamToss')?.addEventListener('click', () => { dreamTossDismissed = true; renderDreamBreakerBoard(); });
    $('#openDreamToss')?.addEventListener('click', () => { dreamTossDismissed = false; renderDreamBreakerBoard(); });
    $('#flipDreamCoin')?.addEventListener('click', () => { dream.tossResult = crypto.getRandomValues(new Uint32Array(1))[0] % 2 ? 'obverse' : 'reverse'; saveState(); renderAll(); });
    $$('[data-dream-toss-winner]').forEach(button => button.onclick = () => { dream.tossWinner = button.dataset.dreamTossWinner; saveState(); renderAll(); });
    $$('[data-dream-toss-choice]').forEach(button => button.onclick = () => { dream.tossChoice = button.dataset.dreamTossChoice; dream.serving = dream.tossChoice === 'serve' ? dream.tossWinner : config.clubs.find(club => club.id !== dream.tossWinner).id; saveState(); renderAll(); toast(`${config.clubs.find(club => club.id === dream.tossWinner).short} chose ${dream.tossChoice === 'side' ? 'court side' : dream.tossChoice}.`); });
    $$('[data-dream-point]').forEach(button => button.onclick = () => { const clubId = button.dataset.dreamPoint; dream.history ||= []; dream.history.push({ scores: { ...dream.scores }, serving: dream.serving, acknowledgedSwitchAt: dream.acknowledgedSwitchAt, endsChanged: dream.endsChanged }); dream.scores[clubId] = Math.min(dream.target, Number(dream.scores[clubId]) + 1); dream.serving = clubId; saveState(); renderAll(); });
    $('#dreamSideout')?.addEventListener('click', () => { dream.history ||= []; dream.history.push({ scores: { ...dream.scores }, serving: dream.serving, acknowledgedSwitchAt: dream.acknowledgedSwitchAt, endsChanged: dream.endsChanged }); const receiver = config.clubs.find(club => club.id !== dream.serving).id; dream.scores[receiver] = Math.min(dream.target, Number(dream.scores[receiver]) + 1); dream.serving = receiver; saveState(); renderAll(); toast('Fault recorded: point and serve awarded to receiving club.'); });
    $('#confirmDreamSwitch')?.addEventListener('click', () => { dream.acknowledgedSwitchAt = totalRallies; saveState(); renderAll(); });
    $('#confirmDreamEnds')?.addEventListener('click', () => { dream.endsChanged = true; saveState(); renderAll(); toast('Change of ends confirmed.'); });
    $('#undoDreamPoint').onclick = () => { const prior = dream.history?.pop(); if (!prior) return; if (prior.scores) { dream.scores = prior.scores; dream.serving = prior.serving; dream.acknowledgedSwitchAt = prior.acknowledgedSwitchAt || 0; dream.endsChanged = !!prior.endsChanged; } else dream.scores = prior; saveState(); renderAll(); toast('Last Dream Breaker action undone.'); };
    $('#resetDreamScore').onclick = () => { if (!confirm('Reset scores, serving team, toss, switches, and change of ends?')) return; Object.assign(dream, { scores: { ocpc: 0, rebels: 0 }, history: [], serving: '', tossResult: '', tossWinner: '', tossChoice: '', acknowledgedSwitchAt: 0, endsChanged: false }); saveState(); renderAll(); };
  }
  function renderTeams() {
    $('#teamTabs').innerHTML = config.categories.map(category => `<button class="category-tab ${category === teamCategory ? 'active' : ''}" data-team-category="${esc(category)}">${esc(category)}</button>`).join('');
    $('#teamGrid').innerHTML = config.clubs.map(club => { const count = pairCount(teamCategory, club.id); return `<article class="team-card"><div class="card-title"><h2>${esc(club.name)}</h2><span>${count} pairs</span></div>${Array.from({ length: count }, (_, i) => {
      const code = `${club.pairPrefix}${i + 1}`, key = `${teamCategory}|${code}`, pair = state.pairs[key];
      return `<div class="team-row"><label>${code}</label><input value="${esc(pair.player1)}" placeholder="Awaiting registration" readonly><input value="${esc(pair.player2)}" placeholder="Awaiting registration" readonly></div>`;
    }).join('')}</article>`; }).join('');
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
    try { const staff = await listTournamentStaff(), roleLabels = { tournament_referee:'Referees', tournament_registration:'Registration Desk', tournament_checkin:'Player Check-In', tournament_score_desk:'Score Kiosk', match_control:'Full Match Control' }; refereeDirectory = staff.filter(person => (Array.isArray(person.roles) ? person.roles : [person.role]).includes('tournament_referee') && person.email); $('#refereeEmail').innerHTML = '<option value="">Select available referee</option>' + refereeDirectory.map(person => `<option value="${esc(person.email)}">${esc([person.firstName, person.lastName].filter(Boolean).join(' ') || person.email)} · ${esc(person.email)}</option>`).join(''); list.innerHTML = Object.entries(roleLabels).map(([role,label]) => { const people = staff.filter(person => (Array.isArray(person.roles) ? person.roles : [person.role]).includes(role)); return `<section class="staff-role-group"><header><b>${label}</b><span>${people.length}</span></header>${people.length ? people.map(person => `<div class="staff-access-row"><span><b>${esc([person.firstName,person.lastName].filter(Boolean).join(' ') || person.email)}</b><small>${esc(person.email)}</small></span><button data-remove-staff="${esc(person.email)}" data-remove-role="${role}" aria-label="Remove ${esc(label)} access">×</button></div>`).join('') : '<p>No one assigned.</p>'}</section>`; }).join(''); $$('[data-remove-staff]').forEach(button => button.onclick = () => confirmStaffRemoval(button.dataset.removeStaff, button.dataset.removeRole, roleLabels[button.dataset.removeRole])); }
    catch (_) { list.innerHTML = '<div class="config-row"><span>Only an administrator can view and change staff access.</span></div>'; }
    const availableEmails = [...new Set([...refereeDirectory.map(person => person.email), ...Object.values(state.refereeAssignments || {})].filter(Boolean))]; $('#refereeEmail').innerHTML = '<option value="">Select available referee</option>' + availableEmails.map(email => { const person = refereeDirectory.find(item => item.email === email), name = person && [person.firstName,person.lastName].filter(Boolean).join(' '); return `<option value="${esc(email)}">${esc(name ? `${name} · ${email}` : email)}</option>`; }).join('');
  }
  function confirmStaffRemoval(email, role, label) { $('#staffRemovalModal')?.remove(); document.body.insertAdjacentHTML('beforeend', `<div class="court-tools-backdrop" id="staffRemovalModal"><section class="staff-removal-modal"><button class="modal-close contrast-close" data-close-staff>×</button><span class="section-label">Remove staff access</span><h2>Remove ${esc(label)} access?</h2><p><b>${esc(email)}</b> will immediately lose ${esc(label)} permission. Other roles assigned to this account will remain unchanged.</p><div class="form-actions"><button class="btn btn-quiet" data-close-staff>Keep access</button><button class="btn btn-danger" id="confirmStaffRemoval">Remove access</button></div></section></div>`); const modal = $('#staffRemovalModal'), close = () => modal.remove(); modal.onclick = event => { if (event.target === modal || event.target.closest('[data-close-staff]')) close(); }; $('#confirmStaffRemoval').onclick = async () => { const button = $('#confirmStaffRemoval'); button.disabled = true; try { await changeTournamentStaffRole(email,role,false); close(); await renderTournamentStaff(); toast('Staff access removed.'); } catch (_) { button.disabled = false; toast('Only an administrator can remove staff access.'); } }; }
  function showNotice(message, title = 'Notice') { $('#appNoticeModal')?.remove(); document.body.insertAdjacentHTML('beforeend', `<div class="court-tools-backdrop" id="appNoticeModal"><section><button class="modal-close contrast-close" data-close-notice>×</button><span class="section-label">Match Control</span><h2>${esc(title)}</h2><p>${esc(message)}</p><button class="btn btn-primary" data-close-notice>Okay</button></section></div>`); const modal = $('#appNoticeModal'); modal.onclick = event => { if (event.target === modal || event.target.closest('[data-close-notice]')) modal.remove(); }; }
  function renderDreamBreakerSettings() {
    const dream = state.dreamBreaker; $('#dreamBreakerEnabled').checked = dream.enabled; $('#dreamBreakerTarget').value = dream.target;
  }
  function renderOpponentDraw() {
    const panel = $('#opponentDrawPanel'); if (!panel) return; const draw = state.opponentDraw;
    const mode = state.drawCeremonyDraft?.mode || 'crypto', modeInput = $(`[name="drawMode"][value="${mode}"]`); if (modeInput) modeInput.checked = true;
    if (!draw) { panel.innerHTML = '<p>No opponent draw is available.</p>'; return; }
    const rows = config.categories.map(category => { const codes = [...draw.categories[category].ocpc, ...draw.categories[category].rebels], exclusions = codes.map(code => { const opponents = state.matches.filter(match => match.category === category && (match.a === code || match.b === code)).map(match => code.startsWith('O') ? match.b : match.a), opponentClub = code.startsWith('O') ? config.clubs.find(club => club.id === 'rebels') : config.clubs.find(club => club.id === 'ocpc'), omitted = Array.from({ length: pairCount(category, opponentClub.id) }, (_, index) => `${opponentClub.pairPrefix}${index + 1}`).filter(other => !opponents.includes(other)); return `<div><b>${esc(displayPair(category, code))}</b><span>${omitted.length ? `Does not play ${omitted.map(other => esc(displayPair(category, other))).join(', ')}` : 'Plays every opposing pair'}</span></div>`; }).join(''); return `<section class="draw-category"><h3>${esc(category)} · ${pairCount(category, 'ocpc')} OCPC / ${pairCount(category, 'rebels')} Rally Rebels · ${categoryMatchCount(category)} matches</h3>${exclusions}</section>`; }).join('');
    panel.innerHTML = `<div class="draw-lock"><b>Draw ID ${esc(draw.id)}</b><span>Locked ${new Date(draw.lockedAt || draw.createdAt).toLocaleString()}</span></div><div class="draw-actions"><button class="btn btn-primary" id="presentOpponentDraw">${state.drawCeremonyDraft ? 'Resume draw ceremony' : 'Start new draw ceremony'}</button><span>${state.opponentDrawHistory?.length || 0} prior draw${state.opponentDrawHistory?.length === 1 ? '' : 's'} retained in audit history</span></div>${rows}`;
    $('#presentOpponentDraw').onclick = () => openOpponentDrawCeremony();
  }
  function selectedDrawMode() { return $('[name="drawMode"]:checked')?.value || state.drawCeremonyDraft?.mode || 'crypto'; }
  function newDrawCeremonyDraft() { return { id: [...crypto.getRandomValues(new Uint8Array(6))].map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase(), mode: selectedDrawMode(), startedAt: new Date().toISOString(), categories: {}, log: [] }; }
  function startDrawCategory(category) {
    state.drawCeremonyDraft ||= newDrawCeremonyDraft();
    if (state.drawCeremonyDraft.categories[category]) return;
    state.drawCeremonyDraft.categories[category] = { ocpc: shuffledCodes('O', pairCount(category, 'ocpc')), rebels: shuffledCodes('R', pairCount(category, 'rebels')), revealed: 0, startedAt: new Date().toISOString() };
    state.drawCeremonyDraft.log.push({ action: 'category-started', category, at: new Date().toISOString() });
    saveState(); openOpponentDrawCeremony(category);
  }
  function revealNextDraw(category, wheelConfirmed = false) {
    const draft = state.drawCeremonyDraft?.categories?.[category]; if (!draft) return;
    const count = pairCount(category, 'ocpc'); if (draft.revealed >= count) return;
    if (state.drawCeremonyDraft.mode === 'wheel' && !wheelConfirmed) return showDrawWheel(category);
    const code = draft.ocpc[draft.revealed], opponents = categoryDrawMatches(category, draft).filter(match => match.a === code).map(match => match.b);
    draft.revealed++; draft.completedAt = draft.revealed === count ? new Date().toISOString() : null;
    state.drawCeremonyDraft.log.push({ action: 'pair-drawn', category, pair: code, opponents, drawNumber: draft.revealed, at: new Date().toISOString() });
    saveState(); openOpponentDrawCeremony(category);
  }
  function showDrawWheel(category) { const categoryDraft = state.drawCeremonyDraft?.categories?.[category]; if (!categoryDraft) return; const code = categoryDraft.ocpc[categoryDraft.revealed], played = categoryDrawMatches(category, categoryDraft).filter(match => match.a === code).map(match => match.b), omitted = categoryDraft.rebels.filter(other => !played.includes(other)), slices = categoryDraft.rebels.length, colors = ['#4fb6ff','#b6ff3c','#ffc94d','#b783ff','#ff6c63','#54dab1','#ff8bc3']; $('#drawWheelOverlay')?.remove(); document.body.insertAdjacentHTML('beforeend', `<div class="draw-wheel-overlay" id="drawWheelOverlay"><section><button class="modal-close contrast-close" id="closeDrawWheel">×</button><span class="section-label">${esc(category)} · ${esc(displayPair(category,code))}</span><h2>Spin for excluded opponent${omitted.length > 1 ? 's' : ''}</h2><p>${esc(pairNames(category,code))} will not be scheduled against the pair${omitted.length > 1 ? 's' : ''} selected by this wheel.</p><div class="draw-wheel-wrap"><i class="wheel-pointer"></i><div class="draw-wheel" id="drawWheel" style="background:conic-gradient(${categoryDraft.rebels.map((_,i)=>`${colors[i%colors.length]} ${i/slices*100}% ${(i+1)/slices*100}%`).join(',')})">${categoryDraft.rebels.map((pairCode,i)=>`<span style="--angle:${i*360/slices+180/slices}deg">${esc(displayPair(category,pairCode))}</span>`).join('')}</div></div><button class="btn btn-primary wheel-spin-button" id="spinDrawWheel">Spin the wheel</button><div class="wheel-result" id="wheelResult" hidden><span>Not scheduled against</span>${omitted.map(pairCode=>`<b>${esc(displayPair(category,pairCode))} · ${esc(pairNames(category,pairCode))}</b>`).join('')}<button class="btn btn-primary" id="confirmWheelResult">Record result and continue</button></div></section></div>`); const overlay=$('#drawWheelOverlay'); $('#closeDrawWheel').onclick=()=>overlay.remove(); $('#spinDrawWheel').onclick=()=>{ const wheel=$('#drawWheel'); wheel.classList.add('spinning'); $('#spinDrawWheel').disabled=true; setTimeout(()=>{$('#wheelResult').hidden=false;$('#confirmWheelResult').onclick=()=>{overlay.remove();revealNextDraw(category,true)}},2600); }; }
  function lockOpponentDrawCeremony() {
    const draft = state.drawCeremonyDraft;
    if (!draft || !config.categories.every(category => draft.categories[category]?.revealed === pairCount(category, 'ocpc'))) return toast('Complete every category before locking the draw.');
    if (!confirm('Officially lock this opponent draw? This will rebuild the schedule and clear any match-day scores, court assignments, and referee assignments.')) return;
    const lockedAt = new Date().toISOString(), draw = { id: draft.id, createdAt: draft.startedAt, lockedAt, locked: true, categories: Object.fromEntries(config.categories.map(category => [category, { ocpc: draft.categories[category].ocpc, rebels: draft.categories[category].rebels }])), ceremonyLog: [...draft.log, { action: 'draw-locked', at: lockedAt }] };
    const priorDraws = [...(state.opponentDrawHistory || []), state.opponentDraw].filter(Boolean), retainedPairs = state.pairs, retainedCheckins = state.checkins;
    state = freshState(state.pairCounts, draw); state.opponentDrawHistory = priorDraws; state.pairs = { ...state.pairs, ...retainedPairs }; state.checkins = retainedCheckins; state.drawCeremonyDraft = null;
    saveState(); $('#opponentDrawCeremony')?.remove(); renderAll(); showView('settings'); toast(`Draw ${draw.id} officially locked and recorded.`);
  }
  function openOpponentDrawCeremony(selectedCategory = config.categories[0]) {
    state.drawCeremonyDraft ||= newDrawCeremonyDraft();
    const ceremony = state.drawCeremonyDraft, category = selectedCategory, count = pairCount(category, 'ocpc'), order = ceremony.categories[category], rounds = Math.ceil(categoryMatchCount(category) / count), revealed = order?.revealed || 0;
    $('#opponentDrawCeremony')?.remove();
    const pairChip = code => `<span class="draw-ball"><b>${esc(displayPair(category, code))}</b><small>${esc(pairNames(category, code))}</small></span>`;
    const rows = order ? order.ocpc.map((ocpc, index) => { const visible = index < revealed, played = categoryDrawMatches(category, order).filter(match => match.a === ocpc).map(match => match.b), omitted = order.rebels.filter(code => !played.includes(code)); return `<div class="draw-matrix-row ${visible ? 'is-revealed' : 'is-pending'}"><div>${visible ? pairChip(ocpc) : '<span class="draw-placeholder">Awaiting draw</span>'}</div>${Array.from({ length: rounds }, (_, round) => `<div class="${visible && played[round] ? 'draw-result' : ''}">${visible && played[round] ? `<small>R${round + 1}</small>${pairChip(played[round])}` : '<span class="draw-placeholder">Empty</span>'}</div>`).join('')}<div class="${visible ? 'draw-omission' : ''}">${visible ? (omitted.map(pairChip).join('') || '<span>None</span>') : '<span class="draw-placeholder">Pending</span>'}</div></div>`; }).join('') : '';
    const allComplete = config.categories.every(item => ceremony.categories[item]?.revealed === pairCount(item, 'ocpc'));
    document.body.insertAdjacentHTML('beforeend', `<div class="draw-ceremony" id="opponentDrawCeremony"><section><header><div><span class="section-label">Transparent opponent randomizer</span><h2>Opponent Draw Ceremony</h2><p>Pending Draw ID <b>${esc(ceremony.id)}</b> · nothing changes in the official schedule until this draw is locked.</p></div><button id="closeOpponentDraw" aria-label="Close">×</button></header><div class="draw-method"><b>Live ceremony workflow</b><ol><li>Select one category and start its draw.</li><li>Both club orders are shuffled once using the browser's cryptographic random generator.</li><li>Reveal one OCPC pair's assigned opponents with each draw.</li><li>Review all categories, then officially lock and record the result.</li></ol><p>The larger roster receives five matches per pair. When rosters are unequal, the smaller roster fairly shares the additional appearances. Closing this screen keeps the ceremony draft so it can be resumed.</p></div><nav>${config.categories.map(item => { const categoryDraft = ceremony.categories[item], required = pairCount(item, 'ocpc'), status = !categoryDraft ? 'Not started' : categoryDraft.revealed === required ? 'Complete' : `${categoryDraft.revealed}/${required}`; return `<button class="${item === category ? 'active' : ''}" data-draw-category="${esc(item)}">${esc(item)} <small>${status}</small></button>`; }).join('')}</nav>${order ? `<div class="draw-order"><article><span>OCPC sealed order · ${order.ocpc.length} pairs</span><div>${order.ocpc.map((code, index) => index < revealed ? pairChip(code) : '<span class="draw-ball concealed"><b>Sealed</b><small>Awaiting draw</small></span>').join('')}</div></article><article><span>Rally Rebels sealed order · ${order.rebels.length} pairs</span><div>${order.rebels.map(pairChip).join('')}</div></article></div><div class="draw-progress"><b>${esc(category)}</b><span>${revealed} of ${count} OCPC pair assignments revealed</span><i><u style="width:${revealed / count * 100}%"></u></i></div><div class="draw-matrix" style="--draw-cols:${rounds + 2}"><div class="draw-matrix-head"><b>OCPC pair</b>${Array.from({ length: rounds }, (_, index) => `<b>Opponent ${index + 1}</b>`).join('')}<b>Not scheduled</b></div>${rows}</div>` : `<div class="draw-blank"><span>Category not started</span><h3>${esc(category)}</h3><p>${pairCount(category, 'ocpc')} OCPC pairs and ${pairCount(category, 'rebels')} Rally Rebels pairs. The board begins blank until both clubs are ready.</p><button class="btn btn-primary" id="startDrawCategory">Start ${esc(category)} draw</button></div>`}<footer><div>${order && revealed < count ? `<button class="btn btn-primary" id="revealNextDraw">Draw next pair assignment</button>` : order ? '<span class="draw-complete">Category draw complete</span>' : ''}</div><button class="btn ${allComplete ? 'btn-primary' : 'btn-quiet'}" id="lockOpponentDraw" ${allComplete ? '' : 'disabled'}>Officially lock and record draw</button></footer></section></div>`);
    $('#closeOpponentDraw').onclick = () => { saveState(); $('#opponentDrawCeremony').remove(); renderOpponentDraw(); }; $('#opponentDrawCeremony').onclick = event => { if (event.target.id === 'opponentDrawCeremony') { saveState(); event.currentTarget.remove(); renderOpponentDraw(); } }; $$('[data-draw-category]').forEach(button => button.onclick = () => openOpponentDrawCeremony(button.dataset.drawCategory)); if ($('#startDrawCategory')) $('#startDrawCategory').onclick = () => startDrawCategory(category); if ($('#revealNextDraw')) $('#revealNextDraw').onclick = () => revealNextDraw(category); $('#lockOpponentDraw').onclick = lockOpponentDrawCeremony;
  }
  function saveDreamBreakerSetup() {
    state.dreamBreaker.enabled = $('#dreamBreakerEnabled').checked; state.dreamBreaker.target = Math.max(1, Math.min(200, Number($('#dreamBreakerTarget').value) || 52));
    state.dreamBreaker.scores.ocpc = Math.min(state.dreamBreaker.scores.ocpc, state.dreamBreaker.target); state.dreamBreaker.scores.rebels = Math.min(state.dreamBreaker.scores.rebels, state.dreamBreaker.target); saveState(); renderAll(); toast('Dream Breaker setup saved.');
  }
  function renderSettings() {
    $('#configList').innerHTML = [['Organizer', config.brand.organizer], ['Event', config.event.name], ['Venue', `${config.event.venue}, ${config.event.location}`], ['Courts', config.event.courts], ['Categories', config.categories.join(', ')], ['Storage', 'Firebase live sync with local cache']].map(([a, b]) => `<div class="config-row"><span>${esc(a)}</span><b>${esc(b)}</b></div>`).join('');
    const assignedIds = Object.keys(state.refereeAssignments);
    $('#refereeMatch').innerHTML = state.matches.filter(m => !isComplete(m.id) && (!matchHasStarted(m.id) || state.refereeAssignments?.[m.id])).map(m => `<option value="${m.id}">${m.id} · ${timeLabel(m.startMinutes)} · ${pairNames(m.category,m.a)} vs ${pairNames(m.category,m.b)}</option>`).join('');
    $('#refereeList').innerHTML = assignedIds.length ? assignedIds.map(id => { const match = state.matches.find(item => item.id === id); if (!match) return ''; return `<div class="referee-assignment-row"><div><span>${id} · ${esc(match.category)} · ${timeLabel(match.startMinutes)} · Court ${match.court}</span><b>${esc(pairNames(match.category,match.a))} vs ${esc(pairNames(match.category,match.b))}</b><small>${esc(state.refereeAssignments[id])}</small></div><button class="btn btn-quiet" data-settings-referee="${id}">Change</button></div>`; }).join('') : '<div class="config-row"><span>No referees assigned yet</span></div>';
    $$('[data-settings-referee]').forEach(button => button.onclick = () => showRefereeAssignment(button.dataset.settingsReferee));
    $('#pairCountSettings').innerHTML = config.categories.map(category => `<fieldset class="pair-count-group"><legend>${esc(category)}</legend>${config.clubs.map(club => `<label>${esc(club.short)}<input type="number" min="1" max="12" value="${pairCount(category, club.id)}" data-pair-count-category="${esc(category)}" data-pair-count-club="${club.id}"></label>`).join('')}</fieldset>`).join('');
    renderDreamBreakerSettings();
    renderOpponentDraw();
    renderTournamentStaff();
  }
  function renderAll() { const total = totalMatchCount(); $('#heroMatchCount').textContent = total; $('#scheduleMatchCount').textContent = `All ${total} matches`; renderOverview(); renderCourts(); renderSchedule(); renderStandings(); renderDreamBreakerBoard(); renderTeams(); renderMedals(); renderSettings(); }
  function changeWave(delta) { const waves = Math.ceil(totalMatchCount() / config.event.courts); state.currentWave = Math.max(1, Math.min(waves, state.currentWave + delta)); saveState(); renderOverview(); renderCourts(); }
  function showView(name) {
    activeView = name; $$('.view').forEach(view => view.classList.toggle('active', view.id === `view-${name}`)); $$('.nav-item').forEach(btn => btn.classList.toggle('active', btn.dataset.view === name)); $('#sidebar').classList.remove('open');
    if (name === 'courts') renderCourts(); if (name === 'schedule') renderSchedule(); if (name === 'standings') renderStandings(); if (name === 'dream') renderDreamBreakerBoard(); if (name === 'medals') renderMedals();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function bindScoreButtons() { $$('[data-score-id]').forEach(button => button.onclick = () => openScore(button.dataset.scoreId)); }
  function openScore(id) {
    const match = state.matches.find(m => m.id === id); if (!match) return;
    activeMatchId = id; const score = scoreFor(id), rules = rulesFor(id), maximum = Math.max(rules.target, rules.suddenDeathAt + 1);
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
    const rules = rulesFor(activeMatchId), high = Math.max(na, nb), low = Math.min(na, nb), maximum = Math.max(rules.target, rules.suddenDeathAt + 1), validSuddenDeath = high === rules.suddenDeathAt + 1 && low === rules.suddenDeathAt, validRegular = high >= rules.target && high <= Math.max(rules.target, rules.suddenDeathAt) && high - low >= 2;
    if (na < 0 || nb < 0 || high > maximum) { $('#scoreMessage').textContent = `Scores must be between 0 and ${maximum}.`; return; }
    if (!validRegular && !validSuddenDeath) { $('#scoreMessage').textContent = `First to ${rules.target}, win by 2. At ${rules.suddenDeathAt}-${rules.suddenDeathAt}, the next rally wins ${maximum}-${rules.suddenDeathAt}.`; return; }
    const prior = state.scores[activeMatchId];
    if (prior && (Number(prior.a) !== na || Number(prior.b) !== nb) && !confirm(`Warning: this revises a recorded result from ${prior.a}-${prior.b} to ${na}-${nb}. Continue?`)) return;
    if (prior) state.scoreAudit.push({ matchId: activeMatchId, previous: prior, revised: { a: na, b: nb }, revisedAt: new Date().toISOString(), source: 'match-control' });
    state.scores[activeMatchId] = { a: na, b: nb, completedAt: prior?.completedAt || new Date().toISOString() };
    state.liveScoring ||= {}; const live = state.liveScoring[activeMatchId] ||= { elapsed: 0, startedAt: null, running: false, log: [] }; if (live.running) live.elapsed = elapsedSeconds(live); Object.assign(live, { a: na, b: nb, complete: true, running: false, startedAt: null }); live.log ||= []; live.log.unshift({ at: new Date().toISOString(), text: `Final result recorded by Match Control: ${na}-${nb}` });
    if (cloudUser) publishMatch(activeMatchId, live, state.scores[activeMatchId]).catch(() => toast('Result saved locally; cloud sync failed.'));
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
  function tickLiveDisplay() {
    Object.entries(state.courts).forEach(([courtNo, court]) => { const live = state.liveScoring?.[court.matchId] || court, seconds = elapsedSeconds(live), clock = $(`[data-court-clock="${courtNo}"]`), card = $(`[data-active-court="${courtNo}"]`); if (clock) clock.textContent = timerText(seconds); if (card) { card.classList.toggle('timer-warning', seconds >= config.scoring.warningSeconds && seconds < config.scoring.dangerSeconds); card.classList.toggle('timer-danger', seconds >= config.scoring.dangerSeconds); } const interruptionClock = $(`[data-interruption-clock="${courtNo}"]`); if (interruptionClock && live.interruption?.active) { const interruptionSeconds = elapsedSeconds(live.interruption); interruptionClock.textContent = clockText(interruptionSeconds); if (String(live.interruption.type).startsWith('timeout-') && interruptionSeconds >= 60) endInterruption(Number(courtNo)); } });
    const timeline = $('#courtTimeline'), start = Number(timeline?.dataset.calendarStart), minute = operationalClock().minute, needle = timeline ? $('.current-time-needle', timeline) : null; if (needle && Number.isFinite(start)) { positionTimeNeedle(timeline, minute, start); const label = $('span', needle); if (label) label.textContent = clockLabel(minute); } $$('[data-court-schedule-status]').forEach(header => { const status = courtScheduleStatus(Number(header.dataset.courtScheduleStatus)); header.classList.remove('safe', 'warn', 'danger'); header.classList.add(status.tone); const label = $('strong', header); if (label) label.textContent = status.text; }); const demoClock = $('#demoClockValue'); if (demoClock) demoClock.textContent = clockLabel(minute);
  }
  function applyPairCounts() {
    const counts = Object.fromEntries(config.categories.map(category => [category, Object.fromEntries(config.clubs.map(club => { const input = $(`[data-pair-count-category="${category}"][data-pair-count-club="${club.id}"]`); return [club.id, Math.max(1, Math.min(12, Number(input?.value) || 1))]; }))]));
    if (config.categories.every(category => config.clubs.every(club => counts[category][club.id] === pairCount(category, club.id)))) return toast('Pair counts are unchanged.');
    const summary = config.categories.map(category => `${category}: OCPC ${counts[category].ocpc}, Rally Rebels ${counts[category].rebels}`).join('\n');
    if (!confirm(`Apply these club-specific pair counts and regenerate the schedule?\n\n${summary}\n\nThis clears current rosters, scores, court assignments, referee assignments, and check-ins.`)) return;
    const priorDraws = [...(state.opponentDrawHistory || []), state.opponentDraw].filter(Boolean); state = freshState(counts); state.opponentDrawHistory = priorDraws; saveState(); renderAll(); showView('settings'); toast(`New locked draw created with ${totalMatchCount()} matches. Prior Draw ID retained.`);
  }
  function showCloudGate(message = '') {
    let gate = $('#cloudGate');
    if (!gate) { document.body.insertAdjacentHTML('beforeend', `<div class="cloud-gate" id="cloudGate"><form class="cloud-login" id="cloudLogin"><img src="${config.brand.logo}" alt=""><span class="brand-product">Private tournament desk</span><h2>Match Control sign in</h2><p>This unlisted event workspace requires an authorized Firebase account.</p><input id="cloudEmail" type="email" placeholder="Admin email" required><input id="cloudPassword" type="password" placeholder="Password" required><button class="btn btn-primary">Sign in</button><small id="cloudError"></small></form></div>`); gate = $('#cloudGate'); $('#cloudLogin').onsubmit = async event => { event.preventDefault(); $('#cloudError').textContent = 'Signing in…'; try { await login($('#cloudEmail').value.trim(), $('#cloudPassword').value); } catch (_) { $('#cloudError').textContent = 'Sign-in failed or this account is not authorized.'; } }; }
    $('#cloudError').textContent = message;
  }
  function profileRoles(user, profile) { const superAdmin = ['ocpc.pickleball@gmail.com','jamescastillo37@gmail.com'].includes(String(user?.email || '').toLowerCase()); return new Set([...(Array.isArray(profile?.roles) ? profile.roles : []), ...(profile?.role ? [profile.role] : []), ...(superAdmin ? ['admin','match_control'] : [])]); }
  function showStaffPortal(user, roles) {
    const tools = [
      { role:'tournament_referee', href:'referee/', icon:'⚑', title:'Referee App', text:'Open assigned matches and score live.' },
      { role:'tournament_registration', href:'registration/', icon:'＋', title:'Registration Desk', text:'Register pairs and maintain player information.' },
      { role:'tournament_checkin', href:'check-in/', icon:'✓', title:'Player Check-In', text:'Capture photos and verify signed waivers.' },
      { role:'tournament_score_desk', href:'score-kiosk/', icon:'#', title:'Score Kiosk', text:'Receive signed scores from unofficiated courts.' }
    ].filter(tool => roles.has(tool.role));
    $('.app-shell').hidden = true; $('#staffPortal').hidden = false; $('#staffPortalIdentity').textContent = `Signed in as ${user.email}`; $('#staffToolGrid').innerHTML = tools.length ? tools.map(tool => `<a class="staff-tool-card" href="${tool.href}"><span>${tool.icon}</span><div><h2>${tool.title}</h2><p>${tool.text}</p></div><b>Open →</b></a>`).join('') : '<div class="staff-no-tools"><h2>No tournament tools assigned</h2><p>Your OCPC account works, but an administrator has not granted a tournament staff role yet.</p></div>'; $('#staffPortalLogout').onclick = logout;
  }
  function startCloud() {
    if (demoMode) { document.body.insertAdjacentHTML('afterbegin', '<div class="demo-mode-banner"><b>DEMO MODE</b><span>Simulated time: <strong id="demoClockValue">10:00:00 AM</strong></span><button id="demoTimeBack" title="Move simulated time back 5 minutes">−5m</button><button id="demoTimeForward" title="Move simulated time forward 5 minutes">+5m</button><button id="demoTimeReset">Reset 10:00</button></div>'); $('#demoTimeBack').onclick = () => setDemoClock(operationalClock().minute - 5); $('#demoTimeForward').onclick = () => setDemoClock(operationalClock().minute + 5); $('#demoTimeReset').onclick = () => setDemoClock(600); $('#cloudSessionBtn').textContent = 'Reset demo'; $('#cloudSessionBtn').title = 'Clear and rebuild fictional demo data'; return; }
    watchAuth(async user => {
      cloudUser = user;
      if (!user) { $('#staffPortal').hidden = true; $('.app-shell').hidden = false; return showCloudGate(); }
      $('#cloudGate')?.remove();
      let profile = null; try { profile = await getCurrentProfile(user); } catch (_) {}
      const roles = profileRoles(user, profile), fullControl = roles.has('admin') || roles.has('match_control') || roles.has('court_manager');
      if (!fullControl) return showStaffPortal(user, roles);
      $('#staffPortal').hidden = true; $('.app-shell').hidden = false;
      watchControl(incoming => { if (!incoming) { publishControl(state).catch(() => showCloudGate('Your account cannot initialize this event.')); return; } const formatChanged = incoming.schedulerVersion !== 7, scheduleChanged = Number(incoming.scheduleBaselineStartMinutes) !== config.event.roundRobinStartMinutes; cloudApplying = true; const localCheckins = state.checkins || {}, normalized = normalizeState(incoming); state = { ...normalized, checkins: { ...normalized.checkins, ...localCheckins }, liveScoring: formatChanged ? {} : state.liveScoring || {} }; controlReady = true; hydrateRegisteredTeams(false); localStorage.setItem(storageKey, JSON.stringify(state)); renderAll(); cloudApplying = false; if (formatChanged) clearMatches().then(() => publishControl(state)).then(() => toast('95-match format and normalized standings applied. Previous test match data cleared.')).catch(() => toast('Format updated locally; cloud cleanup needs another try.')); else if (scheduleChanged) publishControl(state).then(() => toast('Tournament start moved to 10:30 AM.')).catch(() => toast('Schedule updated locally; cloud sync needs another try.')); else if (!refereeBoardPublished) { refereeBoardPublished = true; publishControl(state).catch(() => { refereeBoardPublished = false; }); } }, () => showCloudGate('Your account does not have Match Control access.'));
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
  $$('[name="drawMode"]').forEach(input => input.onchange = () => { if (state.drawCeremonyDraft && Object.keys(state.drawCeremonyDraft.categories || {}).length) { const current = state.drawCeremonyDraft.mode || 'crypto'; $(`[name="drawMode"][value="${current}"]`).checked = true; return showNotice('Finish or lock the current ceremony before changing its reveal mode.', 'Draw mode is locked'); } if (state.drawCeremonyDraft) { state.drawCeremonyDraft.mode = input.value; saveState(); } toast(input.value === 'wheel' ? 'Spin-the-wheel draw selected.' : 'Cryptographic reveal selected.'); });
  $('#menuBtn').onclick = () => $('#sidebar').classList.toggle('open');
  const setSidebarCollapsed = collapsed => { document.querySelector('.app-shell').classList.toggle('sidebar-collapsed', collapsed); $('#sidebarCollapse').textContent = collapsed ? '›' : '‹'; $('#sidebarCollapse').setAttribute('aria-label', collapsed ? 'Expand side menu' : 'Collapse side menu'); localStorage.setItem('matchday.sidebarCollapsed', collapsed ? '1' : '0'); };
  $('#sidebarCollapse').onclick = () => setSidebarCollapsed(!document.querySelector('.app-shell').classList.contains('sidebar-collapsed')); setSidebarCollapsed(localStorage.getItem('matchday.sidebarCollapsed') === '1');
  $('#scheduleCategory').onchange = renderSchedule; $('#scheduleStatus').onchange = renderSchedule; $('#scheduleSearch').oninput = renderSchedule;
  $('#seedMedalsBtn').onclick = seedMedals; $('#exportBtn').onclick = exportBackup; $('#importInput').onchange = event => { if (event.target.files[0]) importBackup(event.target.files[0]); event.target.value = ''; };
  $('#medalCategorySelect').onchange = event => { medalCategory = event.target.value; renderMedals(); };
  $('#assignRefereeBtn').onclick = () => { const email = $('#refereeEmail').value.trim().toLowerCase(), matchId = $('#refereeMatch').value; if (!email || !matchId) return toast('Choose a match and an available referee.'); if (matchHasStarted(matchId) && !state.refereeAssignments?.[matchId]) return showNotice('This match started without a referee, so assignment is now locked.', 'Referee assignment locked'); state.refereeAssignments[matchId] = email; $('#refereeEmail').value = ''; saveState(); renderSettings(); renderCourts(); toast(matchHasStarted(matchId) ? 'Referee swapped during live play.' : 'Referee assigned.'); };
  $('#staffAccessBtn').onclick = async () => { const email = $('#staffAccessEmail').value.trim().toLowerCase(), role = $('#staffAccessRole').value; if (!email) return toast('Enter the staff member’s website account email.'); $('#staffAccessBtn').disabled = true; try { await changeTournamentStaffRole(email, role, true); $('#staffAccessEmail').value = ''; await renderTournamentStaff(); toast('Tournament access granted.'); } catch (error) { showNotice(error.message === 'NO_ACCOUNT' ? 'No OCPC website account uses that email yet. Ask the staff member to create an account first.' : 'Only a site administrator can change tournament staff access.', 'Access could not be granted'); } finally { $('#staffAccessBtn').disabled = false; } };
  $('#applyPairCountsBtn').onclick = applyPairCounts;
  $('#saveDreamBreakerBtn').onclick = saveDreamBreakerSetup;
  const resetDemo = () => { localStorage.removeItem(`${config.storageKey}.demo`); if (demoMode) { demoClockMinutes = 600; demoClockStartedAt = Date.now(); state = freshDemoState(); saveState(); renderAll(); toast('Demo simulation reset.'); } else toast('Saved demo data cleared. The next demo opens fresh.'); };
  $('#launchDemoBtn').onclick = () => window.open(`${location.pathname}?demo=1`, '_blank', 'noopener'); $('#resetDemoBtn').onclick = resetDemo;
  $('#cloudSessionBtn').onclick = () => demoMode ? resetDemo() : logout();
  $('#resetBtn').onclick = async () => { if (demoMode) return resetDemo(); if (!confirm('Reset all match-day results, timers, queues, court assignments, officials, check-ins, standings, medal results, and Dream Breaker data? Retained player registrations and the locked opponent draw will remain.')) return; $('#resetBtn').disabled = true; try { if (cloudUser) await Promise.all([clearMatches(), clearCheckins()]); const drawHistory = state.opponentDrawHistory || []; state = freshState(state.pairCounts, state.opponentDraw); state.opponentDrawHistory = drawHistory; hydrateRegisteredTeams(false); localStorage.removeItem(storageKey); saveState(); if (cloudUser) await publishControl(state); renderAll(); toast('Event data reset. Registered teams and locked opponent draw restored.'); } catch (_) { alert('The reset did not fully complete. Check your connection and try again.'); } finally { $('#resetBtn').disabled = false; } };
  $('#modalClose').onclick = closeScore; $('#scoreModal').onclick = event => { if (event.target === $('#scoreModal')) closeScore(); }; $('#saveScoreBtn').onclick = saveScore; $('#clearScoreBtn').onclick = clearScore;
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('#scoreModal').hidden) closeScore(); });
  window.addEventListener('storage', event => { if (event.key !== storageKey || !event.newValue) return; try { state = JSON.parse(event.newValue); renderAll(); } catch (_) {} });
  setInterval(() => { if (activeView === 'courts') tickLiveDisplay(); }, 1000);
  renderAll(); showView(activeView); startCloud();
})();

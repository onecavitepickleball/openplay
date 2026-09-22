const CONTROL_ROLES = new Set(['admin', 'owner', 'tournament_admin', 'match_control']);
const ADMIN_ROLES = new Set(['admin', 'owner', 'tournament_admin']);
const FORMAT_LABELS = {
  'cross-affiliation-round-robin': 'Cross-team round robin',
  'cross-affiliation-round-robin-elimination': 'Cross-team round robin → elimination',
  'affiliation-round-robin': 'Cross-team round robin',
  'full-round-robin': 'Full round robin',
  'round-robin-elimination': 'Round robin → elimination',
  'round-robin-to-elimination': 'Round robin → elimination',
  'pools-elimination': 'Pools → elimination',
  'pools-to-elimination': 'Pools → elimination',
  'single-elimination': 'Single elimination',
  'round-robin': 'Full round robin',
  pools: 'Pools → elimination'
};
const TIEBREAK_LABELS = {
  wins: 'Wins', standingPoints: 'Standing points', headToHead: 'Head to head',
  pointDifferential: 'Point differential', pointsFor: 'Points for',
  pointsAgainst: 'Points against', seed: 'Seed'
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[character]));
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const clean = value => String(value ?? '').trim();
const slug = value => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'division';
const numericScore = value => clean(value) !== '' && Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const roleSet = value => new Set([
  ...(Array.isArray(value?.roles) ? value.roles : []),
  ...(Array.isArray(value?.eventRoles) ? value.eventRoles : []),
  ...(value?.role ? [value.role] : [])
]);

function addStylesheet() {
  if ($('link[data-standard-tournament-styles]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('./standard-app.css', import.meta.url).href;
  link.dataset.standardTournamentStyles = 'true';
  document.head.append(link);
}

function publicMatchId(engineMatchId) {
  return `STD-${encodeURIComponent(engineMatchId)}`;
}

function parseClock(value, fallback = 480) {
  const match = clean(value).match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
  if (!match) return fallback;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (minute > 59) return fallback;
  if (match[3]) {
    hour %= 12;
    if (match[3].toUpperCase() === 'PM') hour += 12;
  }
  return hour >= 0 && hour < 24 ? hour * 60 + minute : fallback;
}

function timeLabel(totalMinutes) {
  const value = Math.max(0, Number(totalMinutes) || 0);
  const hour = Math.floor(value / 60) % 24;
  return `${hour % 12 || 12}:${String(Math.floor(value % 60)).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

function playerNames(registration) {
  const players = Array.isArray(registration?.players) ? registration.players : [];
  return players.map(player => clean(player?.fullName || player?.name)).filter(Boolean);
}

function isDefaultNoPlayer(value) {
  const parts = clean(value).split('/').map(part => part.trim().replace(/^\[|\]$/g, '').trim().toUpperCase()).filter(Boolean);
  return parts.length > 0 && parts.every(part => part === 'DEFAULT NO PLAYER');
}

function isDefaultEntry(entry) {
  if (!entry) return false;
  const players = Array.isArray(entry.players) ? entry.players
    .map(player => clean(player?.fullName || player?.name)).filter(Boolean) : [];
  return isDefaultNoPlayer(entry.name) || isDefaultNoPlayer(entry.pairCode)
    || (players.length > 0 && players.every(isDefaultNoPlayer));
}

function configuredAffiliations(config, registrations) {
  const source = Array.isArray(config.affiliations) && config.affiliations.length
    ? config.affiliations : (Array.isArray(config.clubs) ? config.clubs : []);
  const affiliations = new Map();
  source.forEach((item, index) => {
    const id = clean(item?.id) || `affiliation-${index + 1}`;
    affiliations.set(id, {
      id,
      name: clean(item?.name || item?.short) || id,
      short: clean(item?.short || item?.name) || id,
      color: clean(item?.color),
      logo: clean(item?.logo || item?.logoUrl)
    });
  });
  registrations.forEach(item => {
    const id = clean(item.affiliationId || item.club);
    if (!id || affiliations.has(id)) return;
    affiliations.set(id, {
      id,
      name: clean(item.affiliationName || item.clubName) || id,
      short: clean(item.affiliationShort || item.clubName) || id,
      color: clean(item.affiliationColor),
      logo: clean(item.affiliationLogo)
    });
  });
  return [...affiliations.values()];
}

function divisionConfigs(config) {
  if (Array.isArray(config.divisions) && config.divisions.length) {
    return config.divisions.map((division, index) => ({
      ...division,
      id: clean(division.id) || `division-${index + 1}-${slug(division.name || division.category)}`,
      name: clean(division.name || division.category) || `Division ${index + 1}`,
      category: clean(division.category || division.name) || `Division ${index + 1}`
    }));
  }
  return (config.categories || []).map((category, index) => ({
    id: `division-${index + 1}-${slug(category)}`,
    name: category,
    category,
    format: config.standardFormat || 'full-round-robin',
    qualifiers: config.qualifiers || 0,
    poolCount: config.poolCount || 2
  }));
}

function registrationDivision(registration, divisions) {
  const explicit = clean(registration.divisionId);
  if (explicit) return divisions.find(division => division.id === explicit);
  const category = clean(registration.category || registration.division);
  return divisions.find(division => division.category === category || division.name === category);
}

function normalizedFormat(division, entryCount, warnings) {
  const configured = clean(division.format) || 'full-round-robin';
  if (!['cross-affiliation-round-robin', 'cross-affiliation-round-robin-elimination', 'affiliation-round-robin',
    'full-round-robin', 'round-robin', 'round-robin-elimination', 'round-robin-to-elimination',
    'pools-elimination', 'pools-to-elimination', 'pools', 'single-elimination'].includes(configured)) {
    throw new Error(`${division.name} has an unsupported format: ${configured}`);
  }
  const order = Array.isArray(division.standings?.order)
    ? division.standings.order
    : (Array.isArray(division.tiebreakOrder) ? division.tiebreakOrder : undefined);
  const standings = {
    ...(order?.length ? { order } : {}),
    allowDraws: division.standings?.allowDraws === true,
    ...(division.standings?.points ? { points: division.standings.points } : {})
  };
  if (configured === 'single-elimination') return { format: configured, standings };
  if (configured === 'cross-affiliation-round-robin'
    || (configured === 'affiliation-round-robin' && !division.qualifiers)) {
    return { format: 'affiliation-round-robin', standings };
  }
  if (configured === 'full-round-robin' || (configured === 'round-robin' && !division.qualifiers)) {
    return { format: 'round-robin', standings };
  }
  if (['pools-elimination', 'pools-to-elimination', 'pools'].includes(configured)) {
    if (!entryCount) {
      warnings.push(`${division.name}: pools will be generated after the first confirmed entry.`);
      return { format: 'round-robin', standings, configuredFormat: configured };
    }
    const poolCount = Math.max(1, Math.min(entryCount, Number(division.poolCount) || 2));
    const requested = Math.max(0, Math.min(entryCount, Number(division.qualifiers?.count ?? division.qualifiers) || 0));
    let perPool = Number(division.qualifiers?.perPool);
    let wildcards = Number(division.qualifiers?.wildcards);
    if (!Number.isSafeInteger(perPool) || perPool < 0) {
      perPool = Math.floor(requested / poolCount);
      wildcards = requested % poolCount;
    }
    perPool = Math.max(0, Math.min(Math.floor(entryCount / poolCount), perPool));
    wildcards = Number.isSafeInteger(wildcards) && wildcards > 0 ? wildcards : 0;
    const equalPools = entryCount % poolCount === 0;
    if (wildcards && !equalPools) {
      warnings.push(`${division.name}: wildcard places were omitted because its pools are not equal-sized.`);
      wildcards = 0;
    }
    return {
      format: 'pools', poolCount, standings,
      qualifiers: { perPool, wildcards }
    };
  }
  const count = Math.max(0, Math.min(entryCount, Number(division.qualifiers?.count ?? division.qualifiers) || 0));
  return {
    format: ['cross-affiliation-round-robin-elimination', 'affiliation-round-robin'].includes(configured)
      ? 'affiliation-round-robin' : 'round-robin',
    standings,
    qualifiers: { count }
  };
}

function buildDefinition(config, registrations) {
  const warnings = [];
  const divisions = divisionConfigs(config);
  const affiliations = configuredAffiliations(config, registrations);
  const affiliationIds = new Set(affiliations.map(item => item.id));
  const confirmed = registrations.filter(item => clean(item.status || 'confirmed').toLowerCase() === 'confirmed');
  const entries = [];
  const entryDivision = new Map();
  confirmed.forEach((registration, index) => {
    const division = registrationDivision(registration, divisions);
    if (!division) {
      warnings.push(`Registration ${registration.id || index + 1} does not match a configured division.`);
      return;
    }
    const id = clean(registration.entryId || registration.stableEntryId || registration.id);
    if (!id) {
      warnings.push(`A registration in ${division.name} has no stable ID and was skipped.`);
      return;
    }
    if (entryDivision.has(id)) {
      warnings.push(`Duplicate entry ID ${id} was skipped.`);
      return;
    }
    const names = playerNames(registration);
    const displayName = clean(registration.entryName || registration.teamName) || names.join(' / ') || clean(registration.pairCode) || id;
    const affiliationId = clean(registration.affiliationId || registration.club) || null;
    const seed = Number(registration.seed);
    entries.push({
      id,
      name: displayName,
      affiliationId: affiliationId && affiliationIds.has(affiliationId) ? affiliationId : null,
      eligibleForAdvancement: !isDefaultNoPlayer(displayName)
        && !isDefaultNoPlayer(registration.pairCode)
        && !(names.length && names.every(isDefaultNoPlayer)),
      seed: Number.isSafeInteger(seed) && seed > 0 ? seed : null,
      registrationId: clean(registration.id) || id,
      pairCode: clean(registration.pairCode) || id,
      players: clone(registration.players || []),
      metadata: clone(registration.metadata || {})
    });
    entryDivision.set(id, division.id);
  });
  const definitionDivisions = divisions.map(division => {
    const entryIds = entries.filter(entry => entryDivision.get(entry.id) === division.id).map(entry => entry.id);
    return {
      id: division.id,
      name: division.name,
      category: division.category,
      entryIds,
      configuredFormat: division.format || 'full-round-robin',
      ...normalizedFormat(division, entryIds.length, warnings)
    };
  });
  return {
    definition: {
      id: clean(config.firebaseEventId) || clean(config.event?.name) || 'standard-tournament',
      mode: 'standard', affiliations, entries, divisions: definitionDivisions
    },
    warnings
  };
}

function allEngineMatches(engineState) {
  return (engineState?.divisions || []).flatMap(division =>
    division.stages.flatMap(stage => stage.matches.map(match => ({ division, stage, match }))));
}

function retainResults(engine, definition, priorState) {
  const fresh = engine.createCompetition(definition);
  if (!priorState?.definition || !Array.isArray(priorState.divisions)) return fresh;
  const prior = new Map(allEngineMatches(priorState).filter(item => item.match.result).map(item => [item.match.id, item.match]));
  let next = fresh;
  for (const division of fresh.divisions) {
    for (const stage of division.stages) {
      for (const original of stage.matches) {
        const old = prior.get(original.id);
        if (!old?.result) continue;
        const current = allEngineMatches(next).find(item => item.match.id === original.id)?.match;
        if (!current || !['ready', 'complete'].includes(current.status)) continue;
        if (current.participants.a !== old.participants.a || current.participants.b !== old.participants.b) continue;
        try { next = engine.recordResult(next, current.id, old.result); } catch (_) { /* Invalidated results stay cleared. */ }
      }
    }
  }
  return next;
}

function entryLookup(engineState) {
  return new Map((engineState?.definition?.entries || []).map(entry => [entry.id, entry]));
}

function divisionLookup(engineState) {
  const definitions = new Map((engineState?.definition?.divisions || []).map(division => [division.id, division]));
  return new Map((engineState?.divisions || []).map(division => [division.id, {
    ...definitions.get(division.id), ...division
  }]));
}

function buildPairs(engineState) {
  const divisions = divisionLookup(engineState);
  const affiliations = new Map(engineState.definition.affiliations.map(item => [item.id, item]));
  const result = {};
  engineState.definition.entries.forEach(entry => {
    const division = [...divisions.values()].find(item => item.entryIds.includes(entry.id));
    const category = division?.category || division?.name || division?.id || '';
    const names = (entry.players || []).map(player => clean(player.fullName || player.name)).filter(Boolean);
    const affiliation = affiliations.get(entry.affiliationId);
    const value = {
      entryId: entry.id,
      registrationId: entry.registrationId || entry.id,
      name: entry.name,
      player1: names[0] || entry.name || '',
      player2: names[1] || '',
      players: clone(entry.players || []),
      seed: entry.seed,
      affiliationId: entry.affiliationId,
      affiliationName: affiliation?.name || '',
      pairCode: entry.pairCode || entry.id
    };
    result[`${category}|${entry.id}`] = value;
    result[entry.id] = value;
  });
  return result;
}

function scheduleProjection(engineState, previousMatches, config) {
  const previous = new Map((previousMatches || []).map(match => [match.engineMatchId || match.id, match]));
  const divisions = divisionLookup(engineState);
  const courts = Math.max(1, Number(config.event?.courts) || 1);
  const slotMinutes = Math.max(5, Number(config.event?.slotMinutes) || 15);
  const start = Number(config.event?.roundRobinStartMinutes) || parseClock(config.event?.startTime, 480);
  const source = allEngineMatches(engineState);
  const entries = entryLookup(engineState);
  const administrativeType = match => {
    const defaults = [match.participants.a, match.participants.b].filter(entryId => isDefaultEntry(entries.get(entryId))).length;
    return defaults === 2 ? 'no-contest' : defaults === 1 ? 'walkover' : '';
  };
  const automaticSlots = new Map();
  let nextWave = 0;
  let previousPlayers = new Set();
  const groups = [...new Set(source.filter(item => item.match.status !== 'bye' && !administrativeType(item.match)).map(item =>
    `${item.stage.type === 'single-elimination' ? 1 : 0}|${item.match.round}`))].sort((a, b) => {
      const [aStage, aRound] = a.split('|').map(Number), [bStage, bRound] = b.split('|').map(Number);
      return aStage - bStage || aRound - bRound;
    });
  groups.forEach(group => {
    const [stageFlag, round] = group.split('|').map(Number);
    const remaining = source.filter(item => item.match.status !== 'bye' && !administrativeType(item.match)
      && (item.stage.type === 'single-elimination' ? 1 : 0) === stageFlag && item.match.round === round).slice();
    while (remaining.length) {
      const waveMatches = [], usedPlayers = new Set();
      while (waveMatches.length < courts && remaining.length) {
        const safe = remaining.filter(item => [item.match.participants.a, item.match.participants.b]
          .filter(Boolean).every(entryId => !usedPlayers.has(entryId)));
        if (!safe.length) break;
        const rested = safe.filter(item => [item.match.participants.a, item.match.participants.b]
          .filter(Boolean).every(entryId => !previousPlayers.has(entryId)));
        const selected = (rested.length ? rested : safe)[0];
        waveMatches.push(selected);
        [selected.match.participants.a, selected.match.participants.b].filter(Boolean)
          .forEach(entryId => usedPlayers.add(entryId));
        remaining.splice(remaining.indexOf(selected), 1);
      }
      if (!waveMatches.length) break;
      waveMatches.forEach((item, courtIndex) => automaticSlots.set(item.match.id, {
        court: courtIndex + 1,
        wave: nextWave + 1,
        startMinutes: start + nextWave * slotMinutes
      }));
      previousPlayers = usedPlayers;
      nextWave += 1;
    }
  });
  return source.map(({ division, stage, match }) => {
    const old = previous.get(match.id);
    const administrative = administrativeType(match);
    const schedulable = match.status !== 'bye' && !administrative;
    const automatic = automaticSlots.get(match.id);
    const court = schedulable ? old?.court || automatic?.court || null : null;
    const wave = schedulable ? old?.wave || automatic?.wave || null : null;
    const startMinutes = schedulable && Number.isFinite(Number(old?.startMinutes))
      ? Number(old.startMinutes) : (schedulable ? automatic?.startMinutes ?? null : null);
    const definition = divisions.get(division.id) || {};
    return {
      id: publicMatchId(match.id),
      engineMatchId: match.id,
      divisionId: division.id,
      category: definition.category || definition.name || division.id,
      divisionName: definition.name || definition.category || division.id,
      stage: stage.type === 'single-elimination' ? 'elimination' : stage.type,
      stageId: stage.id,
      poolId: match.poolId,
      round: match.round,
      a: match.participants.a,
      b: match.participants.b,
      aSlot: clone(match.a),
      bSlot: clone(match.b),
      status: match.status,
      winnerId: match.winnerId,
      loserId: match.loserId,
      result: clone(match.result),
      administrative,
      court,
      wave,
      startMinutes,
      time: administrative === 'walkover' ? 'Automatic walkover'
        : administrative === 'no-contest' ? 'No contest'
          : startMinutes == null ? 'TBD' : `${timeLabel(startMinutes)}-${timeLabel(startMinutes + slotMinutes)}`
    };
  });
}

function projectState(engineState, previous, config, warnings) {
  const matches = scheduleProjection(engineState, previous?.matches, config);
  const validIds = new Set(matches.map(match => match.id));
  const scores = {};
  matches.forEach(match => {
    if (!match.result) return;
    const old = previous?.scores?.[match.id] || {};
    scores[match.id] = { ...old, a: match.result.a, b: match.result.b };
  });
  const courtCount = Math.max(1, Number(config.event?.courts) || 1);
  const courts = Object.fromEntries(Array.from({ length: courtCount }, (_, index) => {
    const number = index + 1;
    const prior = previous?.courts?.[number] || {};
    return [number, {
      matchId: validIds.has(prior.matchId) ? prior.matchId : '',
      running: Boolean(prior.running),
      startedAt: prior.startedAt || null,
      elapsed: Number(prior.elapsed) || 0,
      calledAt: prior.calledAt || null
    }];
  }));
  const active = new Set(Object.values(courts).map(court => court.matchId).filter(Boolean));
  const queue = matches.filter(match => match.status === 'ready' && !scores[match.id] && !active.has(match.id))
    .sort((a, b) => Number(a.startMinutes) - Number(b.startMinutes) || Number(a.court) - Number(b.court))
    .map(match => match.id);
  const courtSchedules = Object.fromEntries(Array.from({ length: courtCount }, (_, index) => {
    const number = index + 1;
    return [number, matches.filter(match => Number(match.court) === number && match.status !== 'bye')
      .sort((a, b) => Number(a.startMinutes) - Number(b.startMinutes)).map(match => match.id)];
  }));
  return {
    ...(previous || {}),
    version: 14,
    schemaVersion: 14,
    competitionType: 'standard',
    standardState: engineState,
    standardWarnings: warnings,
    pairs: buildPairs(engineState),
    matches,
    courts,
    courtSchedules,
    queue,
    scores,
    checkins: previous?.checkins || {},
    refereeAssignments: Object.fromEntries(Object.entries(previous?.refereeAssignments || {}).filter(([id]) => validIds.has(id))),
    liveScoring: Object.fromEntries(Object.entries(previous?.liveScoring || {}).filter(([id]) => validIds.has(id))),
    announcement: previous?.announcement || { enabled: false, text: '', updatedAt: null },
    activityLog: previous?.activityLog || [],
    updatedAt: new Date().toISOString()
  };
}

function elapsedSeconds(value) {
  return (Number(value?.elapsed) || 0) + (value?.running && value.startedAt
    ? Math.max(0, Math.floor((Date.now() - Number(value.startedAt)) / 1000)) : 0);
}

function timerLabel(seconds) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function validateServices(services) {
  const required = ['watchAuth', 'login', 'logout', 'watchControl', 'watchRegistrations', 'publishControl'];
  const missing = required.filter(name => typeof services?.[name] !== 'function');
  if (missing.length) throw new Error(`Standard Match Control requires service functions: ${missing.join(', ')}`);
}

/**
 * Start Standard Tournament Match Control.
 * @param {object} services firebase-sync functions (see README-style contract in the delivery notes).
 * @returns {{destroy: Function, getState: Function}}
 */
export function initializeStandardTournamentApp(services) {
  validateServices(services);
  const config = window.TOURNAMENT_CONFIG;
  if (config?.competitionType !== 'standard') throw new Error('Standard Match Control requires competitionType "standard".');
  const engine = window.StandardTournamentEngine;
  if (!engine || engine.mode !== 'standard' || typeof engine.createCompetition !== 'function') {
    throw new Error('window.StandardTournamentEngine must be loaded before Standard Match Control.');
  }
  if (window.__standardTournamentController?.destroy) window.__standardTournamentController.destroy();
  addStylesheet();

  let state = null;
  let registrations = [];
  let currentUser = null;
  let profile = null;
  let canAdmin = false;
  let activeView = 'overview';
  let activeDivision = '';
  let activeMatchId = '';
  let draggedScheduleMatchId = '';
  let applyingCloud = false;
  let controlReady = false;
  let registrationsReady = false;
  let incomingControlState = null;
  let pendingControlWrite = Promise.resolve();
  let destroyed = false;
  let refereeDirectory = [];
  let staffDirectory = [];
  let latestMatchDocuments = [];
  const cleanups = [];
  const sessionCleanups = [];
  let authGeneration = 0;
  const storageKey = `${config.storageKey || `matchday.${config.firebaseEventId}`}.standard`;

  function toast(message) {
    const target = $('#toast');
    if (!target) return;
    target.textContent = message;
    target.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => target.classList.remove('show'), 2200);
  }

  function recordActivity(text, matchId = '') {
    state.activityLog ||= [];
    state.activityLog.unshift({ at: new Date().toISOString(), text, matchId, type: 'standard' });
    state.activityLog.length = Math.min(state.activityLog.length, 60);
  }

  function persistLocal() {
    try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch (_) { /* Storage is a convenience only. */ }
  }

  function publicUrl(token) {
    const url = new URL(window.MATCHDAY_EVENT_URL('public/'));
    url.searchParams.set('token', token);
    return url.href;
  }

  function standardPublicProjection() {
    const divisions = divisionLookup(state.standardState);
    const pairStandings = {};
    state.standardState.divisions.forEach(division => {
      const definition = divisions.get(division.id) || {};
      const preliminary = division.stages.find(stage => stage.type !== 'single-elimination');
      const rows = preliminary?.tables?.flatMap(table => table.rows || []) || [];
      pairStandings[definition.category || definition.name || division.id] = rows.map(row => {
        const item = entry(row.entryId) || {};
        return {
          ...row,
          code: item.pairCode || row.entryId,
          pairCode: item.pairCode || row.entryId,
          names: item.name || entryName(row.entryId),
          clubId: item.affiliationId || null,
          affiliationId: item.affiliationId || null
        };
      });
    });
    const publicCheckins = Object.fromEntries(Object.entries(state.checkins || {}).map(([id, item]) => [id, {
      category: item.category, pair: item.pair, club: item.club, playerIndex: item.playerIndex,
      photoURL: item.photoURL || item.photoThumb || '', checkedInAt: item.checkedInAt || item.updatedAt || null
    }]));
    return {
      version: 4,
      sourceUpdatedAt: state.updatedAt || new Date().toISOString(),
      competitionType: 'standard',
      event: { name: config.event.name, date: config.event.date, displayDate: config.event.displayDate, venue: config.event.venue, location: config.event.location },
      brand: { organizer: config.brand.organizer, logo: config.brand.logo, primary: config.brand.primary, primaryDark: config.brand.primaryDark, accent: config.brand.accent, highlight: config.brand.highlight },
      clubs: (config.affiliations || config.clubs || []).map(item => ({ id: item.id, name: item.name, short: item.short, logo: item.logo || '', color: item.color || config.brand.primary })),
      categories: config.categories || [],
      announcement: clone(state.announcement || {}),
      pairs: clone(state.pairs || {}),
      pairStandings,
      clubStandings: [],
      checkins: publicCheckins,
      playerPortal: {
        matches: state.matches.map(match => ({ id: match.id, category: match.category, a: match.a, b: match.b, court: match.court || null, startMinutes: match.startMinutes ?? null, time: match.time || '', wave: match.wave || null })),
        courtSchedules: clone(state.courtSchedules || {}), courts: clone(state.courts || {}), scores: clone(state.scores || {})
      }
    };
  }

  async function publishPublicState() {
    if (!state?.publicShare?.token || typeof services.publishPublicView !== 'function') return;
    await services.publishPublicView(state.publicShare.token, standardPublicProjection());
  }

  function publishState() {
    if (!currentUser || applyingCloud || !state) return Promise.resolve();
    state.updatedAt = new Date().toISOString();
    persistLocal();
    const snapshot = clone(state);
    pendingControlWrite = pendingControlWrite.catch(() => {}).then(() => services.publishControl(snapshot));
    if (state.publicShare?.token) pendingControlWrite = pendingControlWrite.then(() => publishPublicState());
    return pendingControlWrite.catch(() => toast('Cloud sync failed. Check the connection and try again.'));
  }

  function applyAdministrativeDefaults(engineState) {
    let next = engineState, changed = true;
    while (changed) {
      changed = false;
      const entries = entryLookup(next);
      for (const { division, match } of allEngineMatches(next)) {
        if (match.status !== 'ready' || match.result) continue;
        const aDefault = isDefaultEntry(entries.get(match.participants.a));
        const bDefault = isDefaultEntry(entries.get(match.participants.b));
        if (!aDefault && !bDefault) continue;
        if (aDefault && bDefault) {
          next = engine.recordResult(next, match.id, { void:true, reason:'Both entries defaulted' });
        } else {
          const definition = next.definition.divisions.find(item => item.id === division.id);
          const target = Math.max(1, Number(definition?.scoring?.target || config.scoring?.target) || 11);
          next = engine.recordResult(next, match.id, aDefault ? { a:0, b:target } : { a:target, b:0 });
        }
        changed = true;
        break;
      }
    }
    return next;
  }

  function rebuild(prior = state) {
    const built = buildDefinition(config, registrations);
    let priorEngine = prior?.standardState;
    if (!priorEngine) {
      try {
        const local = JSON.parse(localStorage.getItem(storageKey));
        priorEngine = local?.standardState;
      } catch (_) { /* Ignore a malformed local fallback. */ }
    }
    const engineState = applyAdministrativeDefaults(retainResults(engine, built.definition, priorEngine));
    state = projectState(engineState, prior, config, built.warnings);
    activeDivision ||= state.standardState.divisions[0]?.id || '';
    applyMatchDocuments(latestMatchDocuments, false);
    persistLocal();
  }

  function engineMatch(publicId, source = state.standardState) {
    const projected = state.matches.find(match => match.id === publicId);
    return projected ? allEngineMatches(source).find(item => item.match.id === projected.engineMatchId)?.match : null;
  }

  function entry(id) { return entryLookup(state.standardState).get(id); }
  function pair(id) { return state.pairs[id] || {}; }
  function entryName(id) { return id ? pair(id).name || entry(id)?.name || id : 'TBD'; }
  function affiliationName(id) {
    const target = entry(id);
    return state.standardState.definition.affiliations.find(item => item.id === target?.affiliationId)?.name || 'Unaffiliated';
  }
  function scoreFor(id) { return state.scores[id] || null; }
  function isComplete(id) { return Boolean(scoreFor(id)); }

  function syncProjection() {
    state = projectState(state.standardState, state, config, state.standardWarnings || []);
    persistLocal();
  }

  function applyResult(matchId, result, shouldPublish = true) {
    const projected = state.matches.find(match => match.id === matchId);
    if (!projected) throw new Error('Match not found.');
    const priorScores = { ...state.scores };
    state.standardState = result === null
      ? engine.clearResult(state.standardState, projected.engineMatchId)
      : engine.recordResult(state.standardState, projected.engineMatchId, result);
    state.standardState = applyAdministrativeDefaults(state.standardState);
    syncProjection();
    if (result) recordActivity(`${projected.divisionName}: ${entryName(projected.a)} ${result.a}-${result.b} ${entryName(projected.b)}`, matchId);
    else recordActivity(`Result cleared for ${projected.divisionName}`, matchId);
    renderAll();
    if (shouldPublish) {
      publishState();
      if (typeof services.publishMatch === 'function') {
        services.publishMatch(matchId, clone(state.liveScoring?.[matchId] || null), clone(state.scores[matchId] || null))
          .catch(() => toast('The match result was saved to control state, but its live feed needs another try.'));
        Object.keys(priorScores).filter(id => id !== matchId && !state.scores[id]).forEach(id => {
          services.publishMatch(id, clone(state.liveScoring?.[id] || null), null).catch(() => {});
        });
      }
    }
  }

  function applyMatchDocuments(items, rerender = true) {
    latestMatchDocuments = Array.isArray(items) ? items : [];
    if (!state) return;
    let changed = false;
    const priorScores = { ...state.scores };
    for (const item of latestMatchDocuments) {
      const projected = state.matches.find(match => match.id === item.id);
      if (!projected) continue;
      if (Object.prototype.hasOwnProperty.call(item, 'live')) {
        state.liveScoring ||= {};
        if (item.live) state.liveScoring[item.id] = clone(item.live);
        else delete state.liveScoring[item.id];
      }
      if (!Object.prototype.hasOwnProperty.call(item, 'score')) continue;
      const current = engineMatch(item.id);
      const incoming = item.score && numericScore(item.score.a) !== null && numericScore(item.score.b) !== null
        ? { a: numericScore(item.score.a), b: numericScore(item.score.b) } : null;
      const same = incoming && current?.result && incoming.a === current.result.a && incoming.b === current.result.b;
      if (same || (!incoming && !current?.result)) continue;
      try {
        state.standardState = incoming
          ? engine.recordResult(state.standardState, projected.engineMatchId, incoming)
          : engine.clearResult(state.standardState, projected.engineMatchId);
        changed = true;
      } catch (_) { /* Ignore stale scores for unresolved descendants. */ }
    }
    if (changed) {
      state.standardState = applyAdministrativeDefaults(state.standardState);
      syncProjection();
      if (rerender) {
        publishState();
        if (typeof services.publishMatch === 'function') Object.keys(priorScores).filter(id => !state.scores[id]).forEach(id => {
          services.publishMatch(id, clone(state.liveScoring?.[id] || null), null).catch(() => {});
        });
      }
    }
    if (rerender) renderAll();
  }

  function configurePage() {
    document.body.classList.add('standard-tournament-control');
    document.documentElement.style.setProperty('--brand', config.brand?.primary || '#06658c');
    document.documentElement.style.setProperty('--brand-dark', config.brand?.primaryDark || '#06364d');
    document.documentElement.style.setProperty('--accent', config.brand?.accent || '#4fb6ff');
    document.documentElement.style.setProperty('--lime', config.brand?.highlight || '#b6ff3c');
    document.documentElement.style.setProperty('--gold', config.brand?.gold || '#ffc24b');
    const content = {
      '#appName': config.appName || 'Matchday', '#brandName': config.brand?.shortName || config.brand?.organizer || '',
      '#eventMiniName': config.event?.name || '', '#eventName': config.event?.name || ''
    };
    Object.entries(content).forEach(([selector, value]) => { const node = $(selector); if (node) node.textContent = value; });
    const logo = $('#brandLogo');
    if (logo) { logo.src = config.brand?.logo || '../assets/logo-2026.png'; logo.alt = `${config.brand?.organizer || 'Tournament'} logo`; }
    if ($('#eventMiniMeta')) $('#eventMiniMeta').textContent = `${config.event?.displayDate || config.event?.date || ''} · ${config.event?.venue || ''}`;
    if ($('#eventDetails')) $('#eventDetails').textContent = [config.event?.displayDate || config.event?.date, config.event?.venue, config.event?.location].filter(Boolean).join(' · ');
    if ($('#scoringNote')) $('#scoringNote').textContent = config.scoring?.note || 'Record the final score for each match.';
    document.title = `${config.event?.name || 'Tournament'} · ${config.appName || 'Matchday'}`;

    const navChanges = {
      teams: ['06', 'Entries'], medals: ['07', 'Bracket']
    };
    Object.entries(navChanges).forEach(([view, label]) => {
      const button = $(`.nav-item[data-view="${view}"]`);
      if (button) button.innerHTML = `<span>${label[0]}</span>${label[1]}`;
    });
    ['dream', 'draw'].forEach(view => {
      const nav = $(`.nav-item[data-view="${view}"]`);
      const panel = $(`#view-${view}`);
      if (nav) nav.hidden = true;
      if (panel) panel.hidden = true;
    });
    $('#dreamBreakerSummary')?.remove();
    if ($('#clubStandings')) $('#clubStandings').hidden = true;
    const medalHead = $('#view-medals .page-head');
    if (medalHead) medalHead.innerHTML = '<div><span class="eyebrow dark">Knockout stages</span><h1>Dynamic Bracket</h1><p>Qualifiers populate automatically when preliminary standings are complete and unambiguous.</p></div>';
    const teamHead = $('#view-teams .page-head');
    if (teamHead) teamHead.innerHTML = '<div><span class="eyebrow dark">Stable registration roster</span><h1>Entries</h1><p>Confirmed entries retain their identity when names, seeds, or affiliations change.</p></div><a class="btn btn-primary" href="registration/">Open registration desk</a>';
    const standingsHead = $('#view-standings .page-head');
    if (standingsHead) standingsHead.innerHTML = '<div><span class="eyebrow dark">Live calculations</span><h1>Division & Pool Standings</h1><p>Standings and advancement are calculated by the Standard Tournament Engine.</p></div>';
    const courtsHead = $('#view-courts .page-head');
    if (courtsHead) courtsHead.innerHTML = '<div><span class="eyebrow dark">Matchday operations</span><h1>Live Courts & Pre-Schedule</h1><p>Run active courts while keeping every upcoming match visible in its planned court and time slot.</p></div><button class="btn btn-quiet" id="standardRebuildSchedule" type="button">Rebuild pre-schedule</button>';
    const calendarHead = $('#view-courts .court-timeline-panel .panel-head');
    if (calendarHead) calendarHead.innerHTML = '<div><span class="section-label">Court plan</span><h2>Pre-Scheduled Match Calendar</h2><p>Drag an upcoming match onto another slot to move it or swap it with the match already there.</p></div><div class="standard-calendar-key"><span><i class="ready"></i>Ready</span><span><i class="pending"></i>Awaiting bracket</span><span><i class="complete"></i>Complete</span></div>';
    const scheduleHead = $('#view-schedule .page-head');
    if (scheduleHead) scheduleHead.innerHTML = '<div><span class="eyebrow dark" id="scheduleMatchCount">Tournament draw</span><h1>Schedule & Results</h1><p>Review every court assignment, find an entry, and record or correct match results.</p></div>';
    const scheduleHeaders = $$('#view-schedule thead th');
    if (scheduleHeaders[4]) scheduleHeaders[4].textContent = 'Entry A';
    if (scheduleHeaders[6]) scheduleHeaders[6].textContent = 'Entry B';
    const publicPanel = $('.public-share-panel');
    if (publicPanel) publicPanel.hidden = false;
  }

  function showView(view) {
    if (['dream', 'draw'].includes(view)) view = 'overview';
    activeView = view;
    $$('.view').forEach(panel => panel.classList.toggle('active', panel.id === `view-${view}`));
    $$('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === view));
    $('#sidebar')?.classList.remove('open');
  }

  function metrics() {
    const playable = state.matches.filter(match => match.status !== 'bye');
    const completed = playable.filter(match => isComplete(match.id)).length;
    const live = Object.values(state.courts).filter(court => court.matchId).length;
    return [
      ['Completed', `${completed}/${playable.length}`, playable.length ? `${Math.round(completed / playable.length * 100)}% of all matches` : 'Waiting for entries'],
      ['Confirmed entries', state.standardState.definition.entries.length, `${state.standardState.definition.affiliations.length} affiliations represented`],
      ['Live courts', `${live}/${Object.keys(state.courts).length}`, `${state.queue.length} ready in queue`],
      ['Divisions', state.standardState.divisions.length, `${state.matches.filter(match => match.stage === 'elimination').length} bracket slots`]
    ];
  }

  function matchCard(match, compact = false) {
    const score = scoreFor(match.id);
    const status = match.administrative === 'no-contest' ? 'No contest'
      : match.administrative === 'walkover' ? `Walkover · ${score?.a ?? 0}-${score?.b ?? 0}`
        : score ? `${score.a}-${score.b}` : match.status === 'pending' ? 'Waiting for qualifiers' : match.status === 'bye' ? 'Bye' : 'Add score';
    return `<article class="standard-match-card ${compact ? 'compact' : ''} status-${esc(match.status)}">
      <header><span>${esc(match.divisionName)}${match.poolId ? ` · ${esc(match.poolId.split('/').pop())}` : ''}</span><b>R${match.round}</b></header>
      <div><span><b>${esc(entryName(match.a))}</b><small>${esc(affiliationName(match.a))}</small></span><em>vs</em><span><b>${esc(entryName(match.b))}</b><small>${esc(affiliationName(match.b))}</small></span></div>
      <button class="score-chip ${score ? 'done' : ''}" data-score-id="${esc(match.id)}" ${['pending', 'bye'].includes(match.status) ? 'disabled' : ''}>${esc(status)}</button>
    </article>`;
  }

  function renderOverview() {
    if (!state) return;
    const playable = state.matches.filter(match => match.status !== 'bye');
    if ($('#heroMatchCount')) $('#heroMatchCount').textContent = playable.length;
    const clock = $('.match-clock');
    if (clock) clock.querySelector('span').textContent = 'Standard tournament';
    if (clock?.querySelector('small')) clock.querySelector('small').textContent = 'engine-managed matches';
    if ($('#metricGrid')) $('#metricGrid').innerHTML = metrics().map(([label, value, note]) => `<div class="metric"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></div>`).join('');
    const upcoming = state.queue.slice(0, 5).map(id => state.matches.find(match => match.id === id)).filter(Boolean);
    if ($('#overviewWave')) $('#overviewWave').innerHTML = upcoming.length ? upcoming.map(match => matchCard(match, true)).join('') : '<p class="empty">No matches are currently ready for dispatch.</p>';
    const leaders = [];
    state.standardState.divisions.forEach(division => {
      division.stages.filter(stage => stage.type !== 'single-elimination').forEach(stage => stage.tables.forEach(table => {
        const row = table.rows[0];
        if (row) leaders.push({ division, stage, table, row });
      }));
    });
    if ($('#leaderList')) $('#leaderList').innerHTML = leaders.length ? leaders.map(item => `<div class="leader-item"><div class="leader-rank">${item.row.rank}</div><div><b>${esc(entryName(item.row.entryId))}</b><small>${esc(divisionLookup(state.standardState).get(item.division.id)?.name || item.division.id)}${item.table.poolId ? ` · ${esc(item.table.poolId.split('/').pop())}` : ''}</small></div><div class="leader-wins">${item.row.wins} W</div></div>`).join('') : '<p class="empty">Leaders appear after entries are registered.</p>';
    const activity = state.activityLog.slice(0, 5);
    if ($('#activityLog')) $('#activityLog').innerHTML = activity.length ? activity.map(item => `<div class="leader-item"><div class="leader-rank">•</div><div><b>${esc(item.text)}</b><small>${new Date(item.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</small></div></div>`).join('') : '<p class="empty">Score and court activity will appear here.</p>';
    if ($('#courtReadiness')) $('#courtReadiness').innerHTML = Object.entries(state.courts).map(([number, court]) => {
      const active = state.matches.find(match => match.id === court.matchId);
      const next = state.matches.find(match => match.id === state.queue.find(id => state.matches.find(item => item.id === id)?.court === Number(number)));
      return `<div class="leader-item"><div class="leader-rank">${number}</div><div><b>${active ? entryName(active.a) + ' vs ' + entryName(active.b) : 'Court available'}</b><small>${active ? (isComplete(active.id) ? 'Final score recorded' : 'Match on court') : next ? `${next.divisionName} ready` : 'No ready match'}</small></div></div>`;
    }).join('');
    if ($('#courtUtilization')) $('#courtUtilization').innerHTML = Object.keys(state.courts).map(number => {
      const assigned = state.matches.filter(match => Number(match.court) === Number(number) && match.status !== 'bye');
      const complete = assigned.filter(match => isComplete(match.id)).length;
      return `<div class="leader-item"><div class="leader-rank">${number}</div><div><b>Court ${number} · ${complete}/${assigned.length} complete</b><small>${assigned.length - complete} scheduled matches remain</small></div></div>`;
    }).join('');
    bindScoreButtons();
  }

  function renderCourts() {
    const target = $('#courtTimeline');
    if (!target || !state) return;
    const activeMarkup = `<section class="standard-active-section"><div class="standard-section-heading"><div><span>Live operations</span><h2>Active Courts</h2></div><small>Timers and score controls stay connected to the scheduled match below.</small></div><div class="standard-court-grid">${Object.entries(state.courts).map(([number, court]) => {
      const match = state.matches.find(item => item.id === court.matchId);
      const live = match ? state.liveScoring?.[match.id] || court : court;
      const nextId = state.queue.find(id => {
        const candidate = state.matches.find(item => item.id === id);
        return Number(candidate?.court) === Number(number);
      }) || state.queue[0];
      const next = state.matches.find(item => item.id === nextId);
      if (!match) return `<article class="standard-court-card vacant"><header><div><small>COURT</small><b>${number}</b></div><span>Available</span></header><div class="court-empty"><strong>${next ? `${entryName(next.a)} vs ${entryName(next.b)}` : 'Court is ready'}</strong><small>${next ? `${next.divisionName} · planned ${next.time.split('-')[0]}` : 'No eligible match is waiting.'}</small></div><button class="btn btn-primary" data-promote-court="${number}" ${next ? '' : 'disabled'}>${next ? 'Call scheduled match' : 'No match ready'}</button></article>`;
      const score = scoreFor(match.id);
      const elapsed = elapsedSeconds(live);
      return `<article class="standard-court-card ${live.running ? 'running' : ''} ${score ? 'complete' : ''}"><header><div><small>COURT</small><b>${number}</b></div><span>${score ? 'Finished' : live.running ? 'Match live' : elapsed ? 'Paused' : 'Called'}</span></header>${matchCard(match, true)}<div class="court-clock" data-court-clock="${number}">${timerLabel(elapsed)}</div><div class="standard-court-actions"><button class="btn ${live.running ? 'btn-warning' : 'btn-quiet'}" data-toggle-court="${number}" ${score ? 'disabled' : ''}>${live.running ? 'Pause timer' : elapsed ? 'Resume timer' : 'Start match'}</button><button class="btn btn-primary" data-score-id="${esc(match.id)}">${score ? 'Review result' : 'Record result'}</button><button class="btn btn-quiet" data-vacate-court="${number}" ${score ? '' : 'disabled'}>Clear court</button></div></article>`;
    }).join('')}</div></section>`;
    const playable = state.matches.filter(match => match.status !== 'bye' && Number.isFinite(Number(match.startMinutes)));
    const minutes = [...new Set(playable.map(match => Number(match.startMinutes)))].sort((a, b) => a - b);
    const calendar = minutes.length ? `<section class="standard-calendar-section"><div class="standard-calendar-grid" style="--standard-courts:${Object.keys(state.courts).length}"><div class="standard-calendar-corner">Time</div>${Object.keys(state.courts).map(number => `<div class="standard-calendar-court">Court ${number}</div>`).join('')}${minutes.map(minute => `<div class="standard-calendar-time"><b>${timeLabel(minute)}</b><small>${timeLabel(minute + (Number(config.event?.slotMinutes) || 15))}</small></div>${Object.keys(state.courts).map(number => {
      const slotMatches = playable.filter(match => Number(match.court) === Number(number) && Number(match.startMinutes) === minute);
      return `<div class="standard-calendar-cell ${slotMatches.length ? 'occupied' : ''}" data-standard-drop-court="${number}" data-standard-drop-minute="${minute}">${slotMatches.map(match => {
        const active = state.courts[number]?.matchId === match.id;
        const complete = isComplete(match.id);
        const canCall = !active && !complete && match.status === 'ready' && !state.courts[number]?.matchId;
        const draggable = !active && !complete && match.status === 'ready';
        return `<article class="standard-calendar-match status-${esc(complete ? 'complete' : active ? 'live' : match.status)}" draggable="${draggable}" data-standard-drag-match="${esc(match.id)}"><header><span>${esc(match.divisionName)}</span><b>${match.poolId ? esc(match.poolId.split('/').pop()) : `R${match.round}`}</b></header><div><strong>${esc(entryName(match.a))}</strong><small>${esc(affiliationName(match.a))}</small><em>vs</em><strong>${esc(entryName(match.b))}</strong><small>${esc(affiliationName(match.b))}</small></div><footer><span>${complete ? `Final ${scoreFor(match.id).a}-${scoreFor(match.id).b}` : active ? 'On court now' : match.status === 'pending' ? 'Awaiting qualifiers' : 'Pre-scheduled'}</span>${canCall ? `<button type="button" data-call-match="${esc(match.id)}" data-call-court="${number}">Call to court</button>` : ''}</footer></article>`;
      }).join('')}</div>`;
    }).join('')}`).join('')}</div></section>` : '<div class="standard-calendar-empty"><b>No matches scheduled yet</b><p>Confirmed registrations will automatically populate this calendar with court and time assignments.</p></div>';
    target.innerHTML = `${activeMarkup}${calendar}`;
    const note = $('.queue-help');
    if (note) note.textContent = 'The calendar is prepared automatically from confirmed registrations. Drag ready matches to adjust the plan; dropping onto an occupied slot swaps the two matches.';
    bindScoreButtons();
    $$('[data-promote-court]').forEach(button => button.onclick = () => promoteMatch(Number(button.dataset.promoteCourt)));
    $$('[data-call-match]').forEach(button => button.onclick = () => promoteSpecificMatch(button.dataset.callMatch, Number(button.dataset.callCourt)));
    $$('[data-toggle-court]').forEach(button => button.onclick = () => toggleCourt(Number(button.dataset.toggleCourt)));
    $$('[data-vacate-court]').forEach(button => button.onclick = () => vacateCourt(Number(button.dataset.vacateCourt)));
    $$('[data-standard-drag-match]').forEach(card => {
      card.ondragstart = () => { draggedScheduleMatchId = card.dataset.standardDragMatch; card.classList.add('dragging'); };
      card.ondragend = () => { draggedScheduleMatchId = ''; card.classList.remove('dragging'); $$('.standard-calendar-cell.drag-over').forEach(cell => cell.classList.remove('drag-over')); };
    });
    $$('[data-standard-drop-court]').forEach(cell => {
      cell.ondragover = event => { if (!draggedScheduleMatchId) return; event.preventDefault(); cell.classList.add('drag-over'); };
      cell.ondragleave = () => cell.classList.remove('drag-over');
      cell.ondrop = event => { event.preventDefault(); cell.classList.remove('drag-over'); moveScheduledMatch(draggedScheduleMatchId, Number(cell.dataset.standardDropCourt), Number(cell.dataset.standardDropMinute)); draggedScheduleMatchId = ''; };
    });
    const rebuildButton = $('#standardRebuildSchedule');
    if (rebuildButton) {
      rebuildButton.disabled = Object.values(state.courts).some(court => court.matchId);
      rebuildButton.onclick = rebuildPreSchedule;
    }
    renderOfficials();
  }

  function refreshScheduleCollections() {
    const active = new Set(Object.values(state.courts).map(court => court.matchId).filter(Boolean));
    state.courtSchedules = Object.fromEntries(Object.keys(state.courts).map(number => [number, state.matches
      .filter(match => Number(match.court) === Number(number) && match.status !== 'bye')
      .sort((a, b) => Number(a.startMinutes) - Number(b.startMinutes)).map(match => match.id)]));
    state.queue = state.matches.filter(match => match.status === 'ready' && !isComplete(match.id) && !active.has(match.id))
      .sort((a, b) => Number(a.startMinutes) - Number(b.startMinutes) || Number(a.court) - Number(b.court))
      .map(match => match.id);
  }

  function moveScheduledMatch(matchId, courtNumber, startMinutes) {
    const source = state.matches.find(match => match.id === matchId);
    if (!source || isComplete(matchId) || Object.values(state.courts).some(court => court.matchId === matchId)) return toast('A live or completed match cannot be moved.');
    const target = state.matches.find(match => match.id !== matchId && Number(match.court) === courtNumber && Number(match.startMinutes) === startMinutes);
    if (target && (isComplete(target.id) || Object.values(state.courts).some(court => court.matchId === target.id))) return toast('That slot contains a live or completed match.');
    const original = { court: source.court, startMinutes: source.startMinutes, wave: source.wave };
    const slotMinutes = Number(config.event?.slotMinutes) || 15;
    if (target) {
      target.court = original.court; target.startMinutes = original.startMinutes; target.wave = original.wave;
      target.time = `${timeLabel(target.startMinutes)}-${timeLabel(target.startMinutes + slotMinutes)}`;
    }
    source.court = courtNumber;
    source.startMinutes = startMinutes;
    source.wave = Math.max(1, Math.floor((startMinutes - (Number(config.event?.roundRobinStartMinutes) || parseClock(config.event?.startTime, 480))) / slotMinutes) + 1);
    source.time = `${timeLabel(startMinutes)}-${timeLabel(startMinutes + slotMinutes)}`;
    refreshScheduleCollections();
    recordActivity(`${target ? 'Swapped' : 'Moved'} ${source.divisionName} match to Court ${courtNumber} at ${timeLabel(startMinutes)}`, source.id);
    publishState();
    renderAll();
    toast(target ? 'Scheduled matches swapped.' : 'Match moved to the new court slot.');
  }

  function rebuildPreSchedule() {
    if (Object.values(state.courts).some(court => court.matchId)) return toast('Clear active courts before rebuilding the schedule.');
    const prior = { ...state, matches: [] };
    state = projectState(state.standardState, prior, config, state.standardWarnings || []);
    recordActivity('Pre-scheduled court calendar rebuilt');
    publishState();
    renderAll();
    toast('Pre-scheduled court calendar rebuilt.');
  }

  function promoteMatch(courtNumber) {
    const court = state.courts[courtNumber];
    if (!court || court.matchId) return;
    const nextId = state.queue.find(id => Number(state.matches.find(match => match.id === id)?.court) === courtNumber) || state.queue[0];
    if (!nextId) return toast('No match is ready for this court.');
    promoteSpecificMatch(nextId, courtNumber);
  }

  function promoteSpecificMatch(nextId, courtNumber) {
    const court = state.courts[courtNumber];
    const match = state.matches.find(item => item.id === nextId);
    if (!court || court.matchId) return toast(`Court ${courtNumber} is not vacant.`);
    if (!match || match.status !== 'ready' || isComplete(nextId)) return toast('That match is not ready to be called.');
    state.courts[courtNumber] = { matchId: nextId, running: false, startedAt: null, elapsed: 0, calledAt: new Date().toISOString() };
    state.liveScoring[nextId] = { ...(state.liveScoring[nextId] || {}), running: false, startedAt: null, elapsed: 0, calledAt: new Date().toISOString() };
    recordActivity(`Called ${nextId} to Court ${courtNumber}`, nextId);
    syncProjection();
    publishState();
    if (typeof services.publishMatch === 'function') services.publishMatch(nextId, clone(state.liveScoring[nextId]), clone(state.scores[nextId] || null)).catch(() => {});
    renderAll();
  }

  function toggleCourt(courtNumber) {
    const court = state.courts[courtNumber];
    if (!court?.matchId || isComplete(court.matchId)) return;
    const live = state.liveScoring[court.matchId] || { elapsed: 0, startedAt: null, running: false };
    if (live.running) {
      live.elapsed = elapsedSeconds(live);
      live.running = false;
      live.startedAt = null;
    } else {
      live.running = true;
      live.startedAt = Date.now();
    }
    state.liveScoring[court.matchId] = live;
    Object.assign(court, { running: live.running, startedAt: live.startedAt, elapsed: live.elapsed });
    publishState();
    if (typeof services.publishMatch === 'function') services.publishMatch(court.matchId, clone(live), clone(state.scores[court.matchId] || null)).catch(() => {});
    renderCourts();
  }

  function vacateCourt(courtNumber) {
    const court = state.courts[courtNumber];
    if (!court?.matchId || !isComplete(court.matchId)) return;
    const matchId = court.matchId;
    state.courts[courtNumber] = { matchId: '', running: false, startedAt: null, elapsed: 0, calledAt: null };
    recordActivity(`Court ${courtNumber} vacated after ${matchId}`, matchId);
    publishState();
    renderAll();
  }

  function renderSchedule() {
    if (!state) return;
    const category = $('#scheduleCategory')?.value || 'all';
    const status = $('#scheduleStatus')?.value || 'all';
    const query = clean($('#scheduleSearch')?.value).toLowerCase();
    const matches = state.matches.filter(match => {
      const matchStatus = isComplete(match.id) ? 'complete' : 'pending';
      const haystack = `${match.id} ${match.divisionName} ${entryName(match.a)} ${entryName(match.b)} ${affiliationName(match.a)} ${affiliationName(match.b)}`.toLowerCase();
      return (category === 'all' || match.divisionId === category) && (status === 'all' || status === matchStatus) && (!query || haystack.includes(query));
    });
    if ($('#scheduleMatchCount')) $('#scheduleMatchCount').textContent = `${matches.length} matches shown`;
    if ($('#scheduleBody')) $('#scheduleBody').innerHTML = matches.length ? matches.map(match => {
      const score = scoreFor(match.id);
      const outcome = match.administrative === 'no-contest' ? 'No contest'
        : match.administrative === 'walkover' ? `W/O ${score?.a ?? 0}-${score?.b ?? 0}`
          : score ? `${score.a}-${score.b}` : match.status === 'bye' ? 'BYE' : match.status === 'pending' ? 'TBD' : 'Score';
      const statusLabel = match.administrative === 'no-contest' ? 'No contest'
        : match.administrative === 'walkover' ? 'Walkover' : score ? 'Complete' : match.status;
      return `<tr class="${match.administrative ? 'administrative-match' : ''}"><td><code>${esc(match.id.replace(/^STD-/, '').slice(-18))}</code></td><td>${esc(match.time)}</td><td>${match.court || '—'}</td><td>${esc(match.divisionName)}${match.poolId ? `<small class="table-sub">${esc(match.poolId.split('/').pop())} · R${match.round}</small>` : `<small class="table-sub">${esc(match.stage)} · R${match.round}</small>`}</td><td><b>${esc(entryName(match.a))}</b><small class="table-sub">${esc(affiliationName(match.a))}</small></td><td><button class="score-chip ${score ? 'done' : ''}" data-score-id="${esc(match.id)}" ${match.administrative || ['pending', 'bye'].includes(match.status) ? 'disabled' : ''}>${esc(outcome)}</button></td><td><b>${esc(entryName(match.b))}</b><small class="table-sub">${esc(affiliationName(match.b))}</small></td><td><span class="standard-status status-${esc(match.status)}">${esc(statusLabel)}</span></td></tr>`;
    }).join('') : '<tr><td colspan="8" class="empty">No matches match these filters.</td></tr>';
    bindScoreButtons();
  }

  function standingsTable(rows) {
    return `<div class="table-wrap"><table class="standard-standings-table"><thead><tr><th>#</th><th>Entry</th><th>P</th><th>W</th><th>L</th><th>D</th><th>PF</th><th>PA</th><th>+/-</th><th>Pts</th></tr></thead><tbody>${rows.map(row => `<tr class="${row.tied ? 'is-tied' : ''}"><td>${row.rank}${row.tied ? '=' : ''}</td><td><b>${esc(entryName(row.entryId))}</b><small class="table-sub">${esc(affiliationName(row.entryId))}${row.seed ? ` · Seed ${row.seed}` : ''}</small></td><td>${row.played}</td><td>${row.wins}</td><td>${row.losses}</td><td>${row.draws}</td><td>${row.pointsFor}</td><td>${row.pointsAgainst}</td><td>${row.pointDifferential > 0 ? '+' : ''}${row.pointDifferential}</td><td>${row.standingPoints}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function renderStandings() {
    const tabs = $('#standingsTabs');
    const grid = $('#standingsGrid');
    if (!tabs || !grid || !state) return;
    const definitions = divisionLookup(state.standardState);
    activeDivision = definitions.has(activeDivision) ? activeDivision : state.standardState.divisions[0]?.id || '';
    tabs.innerHTML = state.standardState.divisions.map(division => `<button class="${division.id === activeDivision ? 'active' : ''}" data-standing-division="${esc(division.id)}">${esc(definitions.get(division.id)?.name || division.id)}</button>`).join('');
    const division = state.standardState.divisions.find(item => item.id === activeDivision);
    if (!division) { grid.innerHTML = '<p class="empty">No divisions are configured.</p>'; return; }
    const preliminary = division.stages.find(stage => stage.type !== 'single-elimination');
    if (!preliminary) {
      grid.innerHTML = '<article class="panel standard-summary"><h2>Single elimination</h2><p>This division is decided entirely by its bracket; no standings table is required.</p></article>';
    } else {
      grid.innerHTML = preliminary.tables.map((table, index) => `<article class="panel standard-table-panel"><header><div><span class="section-label">${esc(preliminary.type === 'pools' ? `Pool ${index + 1}` : 'Division table')}</span><h2>${esc(definitions.get(division.id)?.name || division.id)}</h2></div><span class="standard-status ${preliminary.complete ? 'status-complete' : 'status-ready'}">${preliminary.complete ? 'Complete' : 'In progress'}</span></header>${standingsTable(table.rows)}</article>`).join('');
    }
    $$('[data-standing-division]').forEach(button => button.onclick = () => { activeDivision = button.dataset.standingDivision; renderStandings(); });
  }

  function renderEntries() {
    const tabs = $('#teamTabs');
    const grid = $('#teamGrid');
    if (!tabs || !grid || !state) return;
    const definitions = divisionLookup(state.standardState);
    activeDivision = definitions.has(activeDivision) ? activeDivision : state.standardState.divisions[0]?.id || '';
    tabs.innerHTML = state.standardState.divisions.map(division => `<button class="${division.id === activeDivision ? 'active' : ''}" data-entry-division="${esc(division.id)}">${esc(definitions.get(division.id)?.name || division.id)}</button>`).join('');
    const division = definitions.get(activeDivision);
    const entries = (division?.entryIds || []).map(entry);
    grid.innerHTML = entries.length ? entries.map(item => {
      const names = (item.players || []).map(player => clean(player.fullName || player.name)).filter(Boolean);
      return `<article class="standard-entry-card"><header><span>${item.seed ? `Seed ${item.seed}` : 'Unseeded'}</span><b>${esc(item.pairCode || item.id)}</b></header><h2>${esc(item.name)}</h2><p>${esc(names.join(' · ') || 'Player details not supplied')}</p><footer><span>${esc(affiliationName(item.id))}</span><code>${esc(item.id)}</code></footer></article>`;
    }).join('') : '<p class="empty">No confirmed entries are registered in this division.</p>';
    $$('[data-entry-division]').forEach(button => button.onclick = () => { activeDivision = button.dataset.entryDivision; renderEntries(); });
  }

  function slotLabel(slot, participant) {
    if (participant) return entryName(participant);
    if (!slot) return 'TBD';
    if (slot.type === 'bye') return 'Bye';
    if (slot.type === 'winner') return `Winner of ${publicMatchId(slot.matchId).replace(/^STD-/, '').slice(-12)}`;
    if (slot.type === 'qualifier') return `${slot.poolId ? `${slot.poolId.split('/').pop()} ` : ''}Rank ${slot.rank}`;
    if (slot.type === 'wildcard') return `Wildcard ${slot.rank}`;
    return 'TBD';
  }

  function renderBracket() {
    const board = $('#medalBoard');
    if (!board || !state) return;
    const definitions = divisionLookup(state.standardState);
    const brackets = state.standardState.divisions.flatMap(division => division.stages.filter(stage => stage.type === 'single-elimination').map(stage => ({ division, stage })));
    board.innerHTML = brackets.length ? brackets.map(({ division, stage }) => {
      const rounds = [...new Set(stage.matches.map(match => match.round))];
      return `<section class="panel standard-bracket"><header><div><span class="section-label">${stage.complete ? 'Complete' : 'Live bracket'}</span><h2>${esc(definitions.get(division.id)?.name || division.id)}</h2></div><strong>${stage.championId ? `Champion: ${esc(entryName(stage.championId))}` : `${stage.entryCount} entrants`}</strong></header><div class="standard-bracket-scroll">${rounds.map(round => `<div class="standard-bracket-round"><h3>${round === rounds.length ? 'Final' : `Round ${round}`}</h3>${stage.matches.filter(match => match.round === round).map(match => {
        const id = publicMatchId(match.id), score = scoreFor(id);
        return `<article class="standard-bracket-match ${match.status}"><span><b>${esc(slotLabel(match.a, match.participants.a))}</b><strong>${score ? score.a : ''}</strong></span><span><b>${esc(slotLabel(match.b, match.participants.b))}</b><strong>${score ? score.b : ''}</strong></span><button data-score-id="${esc(id)}" ${['pending', 'bye'].includes(match.status) ? 'disabled' : ''}>${match.status === 'bye' ? 'Bye' : match.status === 'pending' ? 'Pending' : score ? 'Edit' : 'Score'}</button></article>`;
      }).join('')}</div>`).join('')}</div></section>`;
    }).join('') : '<article class="panel standard-summary"><h2>No elimination bracket configured</h2><p>Full round-robin divisions finish in their standings table.</p></article>';
    bindScoreButtons();
  }

  function renderSettings() {
    if (!state) return;
    const configList = $('#configList');
    if (configList) configList.innerHTML = [
      ['Competition', 'Standard tournament'], ['Entries', state.standardState.definition.entries.length],
      ['Divisions', state.standardState.divisions.length], ['Courts', Object.keys(state.courts).length],
      ['Engine', `Standard v${engine.version}`]
    ].map(([label, value]) => `<div><span>${esc(label)}</span><b>${esc(value)}</b></div>`).join('');
    const formatPanel = $('[data-settings-panel="format"]');
    if (formatPanel) {
      const definitions = divisionLookup(state.standardState);
      formatPanel.innerHTML = `<header><span class="section-label">Rules & advancement</span><h2>Competition Format</h2><p>Formats are configured per division and generated by the deterministic standard engine.</p></header><div class="settings-grid">${state.standardState.divisions.map(division => {
        const definition = definitions.get(division.id), configured = definition.configuredFormat || definition.format;
        return `<article class="panel standard-summary"><span class="section-label">${esc(definition.name || division.id)}</span><h2>${esc(FORMAT_LABELS[configured] || FORMAT_LABELS[definition.format] || configured)}</h2><dl><div><dt>Entries</dt><dd>${division.entryIds.length}</dd></div><div><dt>Estimated matches</dt><dd>${division.estimate.total}</dd></div><div><dt>Preliminary</dt><dd>${division.estimate.preliminary}</dd></div><div><dt>Elimination</dt><dd>${division.estimate.elimination}</dd></div>${division.estimate.poolSizes.length ? `<div><dt>Pool sizes</dt><dd>${division.estimate.poolSizes.join(' / ')}</dd></div>` : ''}<div><dt>Tiebreak order</dt><dd>${definition.standings.order.map(item => TIEBREAK_LABELS[item] || item).join(' → ')}</dd></div></dl></article>`;
      }).join('')}</div>`;
    }
    const eventPanel = $('[data-settings-panel="event"] .settings-grid');
    if (eventPanel) eventPanel.querySelector('.white-label-panel')?.setAttribute('hidden', '');
    const scheduleSummary = $('#scheduleOptimizerSummary');
    if (scheduleSummary) scheduleSummary.innerHTML = `<div class="optimizer-summary"><span><b>${state.matches.filter(match => match.status !== 'bye' && !match.administrative).length}</b> scheduled court matches</span><span><b>${state.matches.filter(match => match.administrative === 'walkover').length}</b> automatic walkovers</span><span><b>${state.matches.filter(match => match.administrative === 'no-contest').length}</b> no contests</span><span><b>${config.event?.slotMinutes || 15} min</b> default slot length</span><span><b>${Object.keys(state.courts).length}</b> live courts</span></div>`;
    const optimize = $('#optimizeScheduleBtn');
    if (optimize) optimize.disabled = true;
    $('#pairCountSettings')?.closest('article')?.setAttribute('hidden', '');
    $('.qualification-panel')?.setAttribute('hidden', '');
    $('.settings-guidance')?.setAttribute('hidden', '');
    $('#launchDemoBtn')?.closest('article')?.setAttribute('hidden', '');
    if ($('#tournamentResetPanel')) $('#tournamentResetPanel').hidden = !canAdmin;
    const dataGrid = $('[data-settings-panel="data"] .settings-grid');
    if (dataGrid && !$('#standardArchiveButton')) dataGrid.insertAdjacentHTML('beforeend', '<article class="panel" id="standardArchivePanel"><span class="section-label">Tournament lifecycle</span><h2>Archive tournament</h2><p>Move this completed event to the portal archive while preserving its registrations, results, and public recap.</p><button class="btn btn-danger" id="standardArchiveButton">Archive tournament</button></article>');
    const archiveButton = $('#standardArchiveButton');
    if (archiveButton) {
      archiveButton.disabled = !canAdmin || typeof services.setEventArchived !== 'function';
      archiveButton.onclick = async () => {
        if (!canAdmin || !confirm('Archive this tournament? It can be restored from My Tournaments later.')) return;
        archiveButton.disabled = true;
        try { await services.setEventArchived(true); toast('Tournament archived. Return to My Tournaments to reopen it.'); }
        catch (_) { archiveButton.disabled = false; toast('The tournament could not be archived.'); }
      };
    }
    renderStaffSettings();
    renderWarnings();
  }

  function renderStaffSettings() {
    const form = $('#staffAccessForm');
    const help = $('#staffAccessHelp');
    const list = $('#tournamentStaffList');
    const writable = canAdmin && typeof services.changeTournamentStaffRole === 'function';
    if (form) form.hidden = !writable;
    if (help) help.textContent = writable
      ? 'Grant an event-specific desk role to an existing Tournament Portal account.'
      : 'Staff access is read-only. Owner or Full Match Control permission is required to change roles.';
    if (!list) return;
    const rows = staffDirectory.flatMap(person => [...roleSet(person)]
      .filter(role => role.startsWith('tournament_') || role === 'match_control' || role === 'owner')
      .map(role => ({ person, role })));
    list.innerHTML = rows.length ? rows.map(({ person, role }) => `<div class="standard-staff-row"><span><b>${esc([person.firstName, person.lastName].filter(Boolean).join(' ') || person.name || person.email)}</b><small>${esc(role.replaceAll('_', ' '))}</small></span><code>${esc(person.email || '')}</code>${writable && role !== 'owner' ? `<button data-remove-staff-email="${esc(person.email || '')}" data-remove-staff-role="${esc(role)}" aria-label="Remove ${esc(role)}">×</button>` : ''}</div>`).join('') : '<p class="empty">No event staff records were returned.</p>';
    $$('[data-remove-staff-email]').forEach(button => button.onclick = async () => {
      button.disabled = true;
      try {
        await services.changeTournamentStaffRole(button.dataset.removeStaffEmail, button.dataset.removeStaffRole, false);
        await loadStaff();
        toast('Staff role removed.');
      } catch (_) { toast('The staff role could not be removed.'); }
    });
  }

  async function loadStaff() {
    if (typeof services.listTournamentStaff !== 'function') return;
    staffDirectory = await services.listTournamentStaff();
    refereeDirectory = staffDirectory.filter(item => roleSet(item).has('tournament_referee'));
    renderOfficials();
    renderStaffSettings();
  }

  function setSettingsSection(section) {
    $$('[data-settings-section]').forEach(button => button.classList.toggle('active', button.dataset.settingsSection === section));
    $$('[data-settings-panel]').forEach(panel => panel.classList.toggle('active', panel.dataset.settingsPanel === section));
    try { localStorage.setItem('matchday.standard.settingsSection', section); } catch (_) {}
  }

  function renderWarnings() {
    let panel = $('#standardWarnings');
    if (!panel) {
      const settings = $('[data-settings-panel="data"] .settings-grid');
      if (!settings) return;
      settings.insertAdjacentHTML('afterbegin', '<article class="panel standard-warning-panel" id="standardWarnings"></article>');
      panel = $('#standardWarnings');
    }
    const warnings = state.standardWarnings || [];
    panel.innerHTML = `<span class="section-label">Validation</span><h2>${warnings.length ? `${warnings.length} setup notice${warnings.length === 1 ? '' : 's'}` : 'Competition definition valid'}</h2>${warnings.length ? `<ul>${warnings.map(item => `<li>${esc(item)}</li>`).join('')}</ul>` : '<p>Stable entry references, affiliations, divisions, formats, qualifier limits, and generated matches passed engine validation.</p>'}`;
  }

  function renderOfficials() {
    const email = $('#refereeEmail');
    const match = $('#refereeMatch');
    const list = $('#refereeList');
    if (!email || !match || !list || !state) return;
    email.innerHTML = '<option value="">Select available referee</option>' + refereeDirectory.map(person => `<option value="${esc(person.email)}">${esc([person.firstName, person.lastName].filter(Boolean).join(' ') || person.name || person.email)}</option>`).join('');
    match.innerHTML = '<option value="">Select ready match</option>' + state.matches.filter(item => item.status === 'ready' && !isComplete(item.id)).map(item => `<option value="${esc(item.id)}">${esc(item.divisionName)} · ${esc(entryName(item.a))} vs ${esc(entryName(item.b))}</option>`).join('');
    list.innerHTML = Object.entries(state.refereeAssignments).length ? Object.entries(state.refereeAssignments).map(([id, assigned]) => `<div><span>${esc(state.matches.find(item => item.id === id)?.divisionName || id)}</span><b>${esc(assigned)}</b><button data-remove-referee="${esc(id)}">×</button></div>`).join('') : '<p class="empty">No referees assigned.</p>';
    $$('[data-remove-referee]').forEach(button => button.onclick = () => { delete state.refereeAssignments[button.dataset.removeReferee]; publishState(); renderOfficials(); });
  }

  function renderAnnouncements() {
    if ($('#announcementText')) $('#announcementText').value = state.announcement?.text || '';
    if ($('#announcementEnabled')) $('#announcementEnabled').checked = state.announcement?.enabled === true;
    if ($('#announcementPreview')) $('#announcementPreview').innerHTML = state.announcement?.text ? `<div class="standard-announcement-preview"><span>${state.announcement.enabled ? 'Live' : 'Hidden'}</span><b>${esc(state.announcement.text)}</b></div>` : '<p class="empty">No announcement is set.</p>';
  }

  function renderArchive() {
    const nav = $('.nav-item[data-view="archive"]');
    const button = $('#createArchive');
    if (nav) nav.hidden = true;
    if (button) {
      button.textContent = 'Archive tournament';
      button.disabled = !(canAdmin && typeof services.setEventArchived === 'function');
    }
    if ($('#archiveStatus')) $('#archiveStatus').innerHTML = '<p>Archiving updates the event lifecycle while preserving the standard engine state and all results.</p>';
    if ($('#openArchive')) $('#openArchive').hidden = true;
  }

  function renderPublicShare() {
    const link = $('#publicStandingsLink'), copy = $('#copyPublicLink'), qr = $('#publicStandingsQr'), button = $('#generatePublicLink');
    if (!link || !qr) return;
    const token = state?.publicShare?.token;
    qr.innerHTML = '';
    if (!token) {
      link.textContent = 'No public link generated yet.';
      link.removeAttribute('href');
      if (copy) copy.hidden = true;
      if (button) button.textContent = 'Generate secure link';
      return;
    }
    const url = publicUrl(token);
    link.href = url;
    link.textContent = url;
    if (copy) copy.hidden = false;
    if (button) button.textContent = 'Regenerate secure link';
    if (window.QRCode) new QRCode(qr, { text: url, width: 148, height: 148, colorDark: '#09283a', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
  }

  function renderAll() {
    if (!state || destroyed) return;
    renderOverview();
    renderCourts();
    renderSchedule();
    renderStandings();
    renderEntries();
    renderBracket();
    renderSettings();
    renderAnnouncements();
    renderArchive();
    renderPublicShare();
  }

  function bindScoreButtons() {
    $$('[data-score-id]').forEach(button => { button.onclick = () => openScore(button.dataset.scoreId); });
  }

  function openScore(id) {
    const match = state.matches.find(item => item.id === id);
    if (!match || ['pending', 'bye'].includes(match.status)) return;
    activeMatchId = id;
    const current = scoreFor(id);
    if ($('#scoreMeta')) $('#scoreMeta').textContent = `${match.divisionName} · ${match.stage} · Round ${match.round}`;
    if ($('#scoreTitle')) $('#scoreTitle').textContent = 'Enter final score';
    if ($('#sideALabel')) $('#sideALabel').textContent = affiliationName(match.a);
    if ($('#sideBLabel')) $('#sideBLabel').textContent = affiliationName(match.b);
    if ($('#sideAName')) $('#sideAName').textContent = entryName(match.a);
    if ($('#sideBName')) $('#sideBName').textContent = entryName(match.b);
    if ($('#scoreA')) $('#scoreA').value = current?.a ?? '';
    if ($('#scoreB')) $('#scoreB').value = current?.b ?? '';
    if ($('#scoreMessage')) $('#scoreMessage').textContent = match.stage === 'elimination' ? 'Elimination matches require a decisive score.' : '';
    if ($('#scoreModal')) $('#scoreModal').hidden = false;
  }

  function closeScore() {
    activeMatchId = '';
    if ($('#scoreModal')) $('#scoreModal').hidden = true;
    if ($('#scoreMessage')) $('#scoreMessage').textContent = '';
  }

  function saveScore() {
    if (!activeMatchId) return;
    const a = numericScore($('#scoreA')?.value), b = numericScore($('#scoreB')?.value);
    if (a === null || b === null) return void ($('#scoreMessage').textContent = 'Enter whole-number scores of zero or higher.');
    try {
      applyResult(activeMatchId, { a, b });
      closeScore();
      toast('Result saved; standings and bracket updated.');
    } catch (error) { $('#scoreMessage').textContent = error.message; }
  }

  function clearScore() {
    if (!activeMatchId || !scoreFor(activeMatchId)) return closeScore();
    if (!confirm('Clear this result? Dependent bracket results may also be invalidated.')) return;
    try {
      const id = activeMatchId;
      applyResult(id, null);
      if (typeof services.publishMatch === 'function') services.publishMatch(id, clone(state.liveScoring?.[id] || null), null).catch(() => {});
      closeScore();
      toast('Result cleared and advancement recalculated.');
    } catch (error) { $('#scoreMessage').textContent = error.message; }
  }

  function showGate(message = '') {
    $('.app-shell').hidden = false;
    $('#staffPortal').hidden = true;
    let gate = $('#standardCloudGate');
    if (!gate) {
      document.body.insertAdjacentHTML('beforeend', `<div class="cloud-gate" id="standardCloudGate"><form class="cloud-login" id="standardCloudLogin"><img src="${esc(config.brand?.logo || '../assets/logo-2026.png')}" alt=""><span class="brand-product">Private tournament desk</span><h2>Standard Match Control sign in</h2><p>An authorized event account is required.</p><input id="standardCloudEmail" type="email" placeholder="Email" required><input id="standardCloudPassword" type="password" placeholder="Password" required><button class="btn btn-primary">Sign in</button><small id="standardCloudError"></small></form></div>`);
      gate = $('#standardCloudGate');
      $('#standardCloudLogin').onsubmit = async event => {
        event.preventDefault();
        $('#standardCloudError').textContent = 'Signing in…';
        try { await services.login(clean($('#standardCloudEmail').value), $('#standardCloudPassword').value); }
        catch (_) { $('#standardCloudError').textContent = 'Sign-in failed or this account is not authorized.'; }
      };
    }
    $('#standardCloudError').textContent = message;
  }

  async function authorize(user) {
    if (typeof services.authorizeTournamentTool === 'function') {
      const access = await services.authorizeTournamentTool(user);
      return { allowed: access?.allowed === true, profile: access?.profile || null };
    }
    if (typeof services.getCurrentProfile !== 'function') throw new Error('Authorization service is unavailable.');
    const currentProfile = await services.getCurrentProfile(user);
    const roles = roleSet(currentProfile);
    return { allowed: [...roles].some(role => CONTROL_ROLES.has(role)), profile: currentProfile };
  }

  function bindStaticEvents() {
    $$('.nav-item').forEach(button => { if (!button.hidden) button.onclick = () => showView(button.dataset.view); });
    $$('[data-go]').forEach(button => button.onclick = () => showView(button.dataset.go));
    if ($('#menuBtn')) $('#menuBtn').onclick = () => $('#sidebar')?.classList.toggle('open');
    if ($('#sidebarCollapse')) $('#sidebarCollapse').onclick = () => $('.app-shell')?.classList.toggle('sidebar-collapsed');
    if ($('#scheduleCategory')) $('#scheduleCategory').onchange = renderSchedule;
    if ($('#scheduleStatus')) $('#scheduleStatus').onchange = renderSchedule;
    if ($('#scheduleSearch')) $('#scheduleSearch').oninput = renderSchedule;
    $$('[data-settings-section]').forEach(button => button.onclick = () => setSettingsSection(button.dataset.settingsSection));
    if ($('#modalClose')) $('#modalClose').onclick = closeScore;
    if ($('#scoreModal')) $('#scoreModal').onclick = event => { if (event.target === $('#scoreModal')) closeScore(); };
    if ($('#saveScoreBtn')) $('#saveScoreBtn').onclick = saveScore;
    if ($('#clearScoreBtn')) $('#clearScoreBtn').onclick = clearScore;
    if ($('#cloudSessionBtn')) $('#cloudSessionBtn').onclick = () => services.logout();
    if ($('#assignRefereeBtn')) $('#assignRefereeBtn').onclick = () => {
      const email = clean($('#refereeEmail')?.value).toLowerCase();
      const match = clean($('#refereeMatch')?.value);
      if (!email || !match) return toast('Choose a referee and a ready match.');
      state.refereeAssignments[match] = email;
      publishState();
      renderOfficials();
      toast('Referee assigned.');
    };
    if ($('#staffAccessBtn')) $('#staffAccessBtn').onclick = async () => {
      if (!canAdmin || typeof services.changeTournamentStaffRole !== 'function') return toast('Only a tournament administrator can change staff access.');
      const email = clean($('#staffAccessEmail')?.value).toLowerCase();
      const role = clean($('#staffAccessRole')?.value);
      if (!email || !role) return toast('Enter an account email and choose a role.');
      $('#staffAccessBtn').disabled = true;
      try {
        await services.changeTournamentStaffRole(email, role, true);
        $('#staffAccessEmail').value = '';
        await loadStaff();
        toast('Tournament access granted.');
      } catch (error) { toast(error?.message === 'NO_ACCOUNT' ? 'That account must sign in to the Tournament Portal first.' : 'Tournament access could not be changed.'); }
      finally { $('#staffAccessBtn').disabled = false; }
    };
    if ($('#publishAnnouncement')) $('#publishAnnouncement').onclick = () => {
      state.announcement = { enabled: $('#announcementEnabled')?.checked === true, text: clean($('#announcementText')?.value).slice(0, 180), updatedAt: new Date().toISOString() };
      publishState(); renderAnnouncements(); toast(state.announcement.enabled ? 'Announcement published.' : 'Announcement saved as hidden.');
    };
    if ($('#clearAnnouncement')) $('#clearAnnouncement').onclick = () => { state.announcement = { enabled: false, text: '', updatedAt: new Date().toISOString() }; publishState(); renderAnnouncements(); };
    if ($('#generatePublicLink')) $('#generatePublicLink').onclick = async () => {
      const button = $('#generatePublicLink'), old = state.publicShare?.token;
      const token = [...crypto.getRandomValues(new Uint8Array(18))].map(value => value.toString(16).padStart(2, '0')).join('');
      button.disabled = true;
      try {
        if (old && typeof services.revokePublicView === 'function') await services.revokePublicView(old);
        state.publicShare = { token, generatedAt: new Date().toISOString() };
        await services.publishPublicView(token, standardPublicProjection());
        await publishState();
        renderPublicShare();
        toast(old ? 'New live standings link created.' : 'Live standings link created.');
      } catch (error) { console.error(error); toast(`Public link failed: ${error?.message || 'check Firebase rules'}`); }
      finally { button.disabled = false; }
    };
    if ($('#copyPublicLink')) $('#copyPublicLink').onclick = async () => {
      if (!state.publicShare?.token) return;
      await navigator.clipboard?.writeText(publicUrl(state.publicShare.token));
      toast('Public standings link copied.');
    };
    if ($('#createArchive')) $('#createArchive').onclick = async () => {
      if (!canAdmin || typeof services.setEventArchived !== 'function') return toast('Only a tournament administrator can archive this event.');
      if (!confirm('Archive this tournament? Results and registrations will be preserved.')) return;
      $('#createArchive').disabled = true;
      try { await services.setEventArchived(true); $('#archiveStatus').innerHTML = '<p class="standard-success">Tournament archived successfully.</p>'; toast('Tournament archived.'); }
      catch (_) { toast('The tournament could not be archived.'); }
      finally { $('#createArchive').disabled = false; }
    };
    if ($('#exportBtn')) $('#exportBtn').onclick = () => {
      const blob = new Blob([JSON.stringify({ configSnapshot: config, state }, null, 2)], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${slug(config.event?.name)}-standard-backup.json`;
      link.click();
      URL.revokeObjectURL(link.href);
    };
    if ($('#importInput')) $('#importInput').onchange = async event => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file || !canAdmin) return;
      try {
        const parsed = JSON.parse(await file.text());
        const imported = parsed.state || parsed;
        if (imported.competitionType !== 'standard' || !imported.standardState) throw new Error('Not a standard tournament backup.');
        state = projectState(engine.resolveAdvancement(imported.standardState), imported, config, imported.standardWarnings || []);
        await publishState(); renderAll(); toast('Standard tournament backup restored.');
      } catch (error) { alert(error.message || 'That backup could not be imported.'); }
    };
    if ($('#resetBtn')) $('#resetBtn').onclick = async () => {
      if (!canAdmin || !confirm('Clear all match results, court activity, check-ins, and referee assignments? Registrations and format settings will remain.')) return;
      if (typeof services.clearMatches === 'function') await services.clearMatches();
      if (typeof services.clearCheckins === 'function') await services.clearCheckins();
      const built = buildDefinition(config, registrations);
      state = projectState(engine.createCompetition(built.definition), null, config, built.warnings);
      await publishState(); renderAll(); toast('Match-day state reset; entries retained.');
    };
    if ($('#appLauncherBtn')) $('#appLauncherBtn').onclick = event => { event.stopPropagation(); $('#appLauncher').hidden = !$('#appLauncher').hidden; };
    if ($('#appLauncherClose')) $('#appLauncherClose').onclick = () => { $('#appLauncher').hidden = true; };
    document.addEventListener('keydown', onKeydown);
  }

  function onKeydown(event) { if (event.key === 'Escape') { closeScore(); if ($('#appLauncher')) $('#appLauncher').hidden = true; } }

  function startSubscriptions() {
    const authStop = services.watchAuth(async user => {
      if (destroyed) return;
      const generation = ++authGeneration;
      sessionCleanups.splice(0).forEach(stop => { try { if (typeof stop === 'function') stop(); } catch (_) {} });
      controlReady = false;
      registrationsReady = false;
      incomingControlState = null;
      latestMatchDocuments = [];
      currentUser = user || null;
      if (!user) { state = null; showGate(); return; }
      let access;
      try { access = await authorize(user); }
      catch (_) { showGate('Authorization could not be verified.'); return; }
      if (generation !== authGeneration || destroyed) return;
      if (!access.allowed) { showGate('Signed in, but this account does not have Match Control access.'); return; }
      profile = access.profile;
      const roles = roleSet(profile);
      canAdmin = Boolean(profile?.isSiteAdmin) || [...roles].some(role => ADMIN_ROLES.has(role));
      $('#standardCloudGate')?.remove();
      if ($('#cloudSessionBtn')) { $('#cloudSessionBtn').textContent = 'Sign out'; $('#cloudSessionBtn').title = `Signed in as ${user.email || ''}`; }

      sessionCleanups.push(services.watchControl(incoming => {
        if (destroyed) return;
        controlReady = true;
        incomingControlState = incoming;
        if (!registrationsReady) return;
        applyingCloud = true;
        const prior = incoming?.competitionType === 'standard' || incoming?.standardState ? incoming : state;
        try { rebuild(prior); renderAll(); }
        catch (error) { console.error('Standard tournament state rejected.', error); toast(`Tournament state is invalid: ${error.message}`); }
        finally { applyingCloud = false; }
        if (!incoming && state) publishState();
      }, () => showGate('This account cannot read Match Control data.')));

      sessionCleanups.push(services.watchRegistrations(items => {
        registrations = Array.isArray(items) ? items : [];
        registrationsReady = true;
        if (!controlReady) return;
        try {
          const before = JSON.stringify(state?.standardState?.definition || null);
          rebuild(state || incomingControlState);
          renderAll();
          if (state && before !== JSON.stringify(state.standardState.definition)) publishState();
        } catch (error) { console.error('Standard registration validation failed.', error); toast(`Registration validation failed: ${error.message}`); }
      }, () => toast('Registrations could not be loaded.')));

      if (typeof services.watchMatches === 'function') sessionCleanups.push(services.watchMatches(items => applyMatchDocuments(items), () => toast('Live match updates are unavailable.')));
      if (typeof services.watchCheckins === 'function') sessionCleanups.push(services.watchCheckins(items => {
        if (!state) return;
        state.checkins = Object.fromEntries((items || []).map(item => [item.id, item]));
        persistLocal(); renderCourts();
      }, () => toast('Check-in status is unavailable.')));
      loadStaff().catch(() => {});
    });
    cleanups.push(authStop);
  }

  configurePage();
  bindStaticEvents();
  setSettingsSection(localStorage.getItem('matchday.standard.settingsSection') || 'event');
  divisionConfigs(config).forEach(division => $('#scheduleCategory')?.insertAdjacentHTML('beforeend', `<option value="${esc(division.id)}">${esc(division.name)}</option>`));
  const timer = setInterval(() => {
    if (activeView !== 'courts' || !state) return;
    Object.entries(state.courts).forEach(([number, court]) => {
      const target = $(`[data-court-clock="${number}"]`);
      if (target) target.textContent = timerLabel(elapsedSeconds(state.liveScoring?.[court.matchId] || court));
    });
  }, 1000);
  cleanups.push(() => clearInterval(timer));
  showView(activeView);
  startSubscriptions();

  const controller = {
    getState: () => clone(state),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cleanups.splice(0).forEach(stop => { try { if (typeof stop === 'function') stop(); } catch (_) {} });
      sessionCleanups.splice(0).forEach(stop => { try { if (typeof stop === 'function') stop(); } catch (_) {} });
      document.removeEventListener('keydown', onKeydown);
      document.body.classList.remove('standard-tournament-control');
      if (window.__standardTournamentController === controller) delete window.__standardTournamentController;
    }
  };
  window.__standardTournamentController = controller;
  return controller;
}

export default initializeStandardTournamentApp;

if (typeof window === 'object') window.initializeStandardTournamentApp = initializeStandardTournamentApp;

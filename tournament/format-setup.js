// Pure setup helpers shared by the portal and Match Control. No DOM or storage.
const POOLS = new Set(['pools', 'pools-elimination', 'pools-to-elimination']);
const FORMATS = new Set(['single-elimination', 'full-round-robin', 'round-robin',
  'round-robin-elimination', 'round-robin-to-elimination', 'cross-affiliation-round-robin',
  'cross-affiliation-round-robin-elimination', 'affiliation-round-robin', ...POOLS]);

function integer(value, fallback, min, max, label) {
  const number = value === undefined || value === null || value === '' ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new Error(`${label} must be a whole number from ${min} to ${max}.`);
  }
  return number;
}

/** Returns a persisted division config (not an engine definition). Extra fields survive.
 * Pools default to TWO, never an inferred count. Explicit per-pool qualification wins
 * over a legacy total; otherwise the total is split into automatic places + wildcards.
 * expectedPairs/entryLimit=0 means not specified; no placeholder registrations are made.
 */
export function buildStandardDivision(options = {}) {
  const format = options.format || 'full-round-robin';
  if (!FORMATS.has(format)) throw new Error(`Unsupported format: ${format}`);
  const expectedPairs = integer(options.expectedPairs ?? options.entryLimit, 0, 0, 128, 'Expected pairs');
  const result = { ...options, format, expectedPairs, entryLimit: expectedPairs, bronzeMatch:options.bronzeMatch === true };
  const raw = options.qualifiers;
  if (POOLS.has(format)) {
    const poolCount = integer(options.poolCount, 2, 1, Math.min(expectedPairs || 32, 32), 'Pool count');
    const smallest = expectedPairs ? Math.floor(expectedPairs / poolCount) : 128;
    const total = integer(raw?.count ?? (typeof raw === 'number' || typeof raw === 'string' ? raw : undefined), 0, 0, expectedPairs || 128, 'Qualifiers');
    const perPool = integer(options.qualifiersPerPool ?? raw?.perPool, Math.floor(total / poolCount), 0, smallest, 'Qualifiers per pool');
    const explicitPerPool = options.qualifiersPerPool != null || raw?.perPool != null;
    const wildcards = integer(raw?.wildcards, explicitPerPool ? 0 : total % poolCount, 0,
      expectedPairs ? expectedPairs - poolCount * perPool : 128, 'Wildcards');
    if (expectedPairs && wildcards && expectedPairs % poolCount) throw new Error('Wildcards require equal-sized pools.');
    result.poolCount = poolCount;
    result.qualifiers = { perPool, wildcards };
  } else if (format === 'single-elimination' || ['full-round-robin', 'cross-affiliation-round-robin'].includes(format)) {
    result.qualifiers = null;
  } else {
    result.qualifiers = { count:integer(raw?.count ?? raw, 0, 0, expectedPairs || 128, 'Qualifiers'),
      distinctAffiliations:format.startsWith('cross-affiliation') || raw?.distinctAffiliations === true };
  }
  // Keep one authoritative representation, so subsequent edits cannot use stale aliases.
  delete result.qualifiersPerPool;
  return result;
}

/** Engine-safe fields for the CURRENT roster, without changing the saved plan. */
export function standardEngineFormat(division, entryCount) {
  integer(entryCount, 0, 0, Number.MAX_SAFE_INTEGER, 'Entry count');
  const configured = division.format || 'full-round-robin';
  if (POOLS.has(configured)) {
    const plannedPools = Number(division.poolCount) || 2;
    // Until enough pairs exist to form the requested pools, show an empty setup.
    if (!entryCount) return { format:'round-robin', qualifiers:null };
    const poolCount = Math.min(entryCount, plannedPools);
    const total = Number(division.qualifiers?.count ?? division.qualifiers) || 0;
    const perPool = Math.min(Math.floor(entryCount / poolCount), Number(division.qualifiers?.perPool ?? division.qualifiersPerPool ?? Math.floor(total / plannedPools)));
    const requestedWildcards = Number(division.qualifiers?.wildcards ?? (division.qualifiers?.perPool != null || division.qualifiersPerPool != null ? 0 : total % plannedPools));
    const wildcards = entryCount % poolCount ? 0 : Math.min(requestedWildcards, entryCount - perPool * poolCount);
    return { format:'pools', poolCount, qualifiers:{ perPool, wildcards } };
  }
  if (configured === 'single-elimination') return { format:configured, qualifiers:null };
  const format = configured.startsWith('cross-affiliation') || configured === 'affiliation-round-robin' ? 'affiliation-round-robin' : 'round-robin';
  const plain = ['full-round-robin', 'cross-affiliation-round-robin'].includes(configured) || !division.qualifiers;
  if (plain) return { format, qualifiers:null };
  return { format, qualifiers:{ count:Math.min(entryCount, Number(division.qualifiers?.count ?? division.qualifiers) || 0),
    distinctAffiliations:format === 'affiliation-round-robin' || division.qualifiers?.distinctAffiliations === true } };
}

/** Explicit timed-rally events opt in; existing Sportsfest defaults stay unchanged. */
export function standardScoringRules({ scoring = {}, scheduling = {}, match = {} } = {}) {
  const medal = match.medal === 'gold' || match.medal === 'bronze';
  const timed = scoring.mode === 'timed-rally' || /timed.*rally|rally.*timed/i.test(scoring.type || '');
  if (timed) {
    const minutes = integer(medal ? scheduling.medalMinutes ?? scoring.medalMinutes : scheduling.matchMinutes ?? scoring.matchMinutes, medal ? 10 : 8, 1, 180, 'Match timer');
    return { mode:'timed-rally', label:medal ? 'Medal match' : match.stage === 'elimination' ? 'Semifinal' : 'Preliminary',
      scoring:'rally', twoServes:false, target:null, winBy:1, hardCap:null, suddenDeathAt:null, timer:true, timerSeconds:minutes * 60,
      teamTimeouts:false, changeEndsAt:null };
  }
  return match.medal === 'gold'
    ? { mode:'championship', label:'Championship Final', scoring:'side-out', twoServes:true, target:11, winBy:2, hardCap:15, suddenDeathAt:null, timer:false, timerSeconds:0 }
    : { mode:'preliminary', label:'Preliminary', scoring:'side-out', twoServes:true, target:11, winBy:2, hardCap:11, suddenDeathAt:10, timer:true, timerSeconds:(scheduling.matchMinutes || 18) * 60 };
}

export function validTimedRallyScore(live, rules, elapsedSeconds) {
  return rules.mode === 'timed-rally' && [live.a, live.b].every(value => Number.isSafeInteger(Number(value)) && Number(value) >= 0)
    && Number(live.a) !== Number(live.b) && elapsedSeconds >= rules.timerSeconds;
}

export function hasStandardPlayStarted(state) {
  return Object.values(state?.scores || {}).some(Boolean)
    || Object.values(state?.courts || {}).some(court => Boolean(court.matchId))
    || Object.values(state?.liveScoring || {}).some(live => live.running || live.startedAt || live.elapsed > 0 || live.a > 0 || live.b > 0)
    || (state?.standardState?.divisions || []).some(division => division.stages.some(stage => stage.matches.some(match => Boolean(match.result))));
}

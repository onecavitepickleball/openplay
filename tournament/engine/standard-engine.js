/* Standalone, deterministic competition rules. No DOM, storage, clock or network. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StandardTournamentEngine = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  const FORMATS = ['round-robin', 'affiliation-round-robin', 'pools', 'single-elimination'];
  const CRITERIA = ['wins', 'standingPoints', 'headToHead', 'pointDifferential',
    'pointsFor', 'pointsAgainst', 'seed'];
  const DEFAULT_ORDER = ['wins', 'headToHead', 'pointDifferential', 'pointsFor', 'pointsAgainst'];
  const copy = value => JSON.parse(JSON.stringify(value));
  const lexical = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const part = value => encodeURIComponent(value);
  const entrySlot = entryId => ({ type: 'entry', entryId });
  const byeSlot = () => ({ type: 'bye' });
  const roundRobinFormat = format => format === 'round-robin' || format === 'affiliation-round-robin';

  function check(condition, message) {
    if (!condition) throw new Error(message);
  }

  function id(value, label = 'ID') {
    check(typeof value === 'string' && value.trim().length > 0, `${label} must be a nonempty string`);
    return value;
  }

  function integer(value, minimum, label) {
    check(Number.isSafeInteger(value) && value >= minimum, `${label} must be an integer >= ${minimum}`);
    return value;
  }

  function uniqueIds(values, label = 'Entry IDs') {
    check(Array.isArray(values), `${label} must be an array`);
    values.forEach(value => id(value, label));
    check(new Set(values).size === values.length, `${label} must be unique`);
    return values.slice();
  }

  function capabilities(mode = 'standard') {
    check(mode === 'standard' || mode === 'dual-meet', `Unknown competition mode: ${mode}`);
    const standard = mode === 'standard';
    return {
      mode, externalAdapter: !standard, stableEntries: standard, affiliations: standard,
      divisions: standard, fullRoundRobin: standard, pools: standard,
      singleElimination: standard, qualifiers: standard, standings: standard,
      advancementPlaceholders: standard, matchCountEstimates: standard,
      formats: standard ? FORMATS.slice() : []
    };
  }

  function standingsOptions(value = {}) {
    const order = value.order === undefined ? DEFAULT_ORDER.slice() : value.order;
    check(Array.isArray(order) && order.length > 0, 'Tiebreak order must not be empty');
    check(new Set(order).size === order.length && order.every(item => CRITERIA.includes(item)),
      'Tiebreak order contains duplicate or unknown criteria');
    check(value.allowDraws === undefined || typeof value.allowDraws === 'boolean', 'allowDraws must be boolean');
    const points = { win: 3, draw: 1, loss: 0, ...value.points };
    Object.values(points).forEach(value => check(Number.isFinite(value), 'Standing points must be finite'));
    return { order: order.slice(), allowDraws: value.allowDraws === true, points };
  }

  function poolSizes(count, poolCount) {
    integer(count, 0, 'Entry count');
    integer(poolCount, 1, 'Pool count');
    check(poolCount <= count, 'Pool count cannot exceed entry count');
    return Array.from({ length: poolCount }, (_, i) => Math.floor(count / poolCount) + (i < count % poolCount ? 1 : 0));
  }

  function qualification(format, value, sizes) {
    if (value === undefined || value === null) return null;
    check(format !== 'single-elimination', 'A single-elimination division cannot have qualifiers');
    check(value && typeof value === 'object' && !Array.isArray(value), 'Qualifiers must be an object');
    if (roundRobinFormat(format)) {
      check(Object.keys(value).every(key => ['count', 'distinctAffiliations'].includes(key)), 'Round-robin qualifiers accept only count and distinctAffiliations');
      const count = integer(value.count, 0, 'Qualifier count');
      check(count <= sizes[0], 'Qualifier count exceeds entry count');
      check(value.distinctAffiliations === undefined || typeof value.distinctAffiliations === 'boolean', 'distinctAffiliations must be boolean');
      return { count, distinctAffiliations: value.distinctAffiliations === true };
    }
    check(Object.keys(value).every(key => ['perPool', 'wildcards'].includes(key)),
      'Pool qualifiers accept only perPool and wildcards');
    const perPool = integer(value.perPool, 0, 'Qualifiers per pool');
    const wildcards = integer(value.wildcards === undefined ? 0 : value.wildcards, 0, 'Wildcard count');
    check(sizes.every(size => perPool <= size), 'Qualifiers per pool exceed the smallest pool');
    check(wildcards <= sizes.reduce((sum, size) => sum + size - perPool, 0), 'Too many wildcards');
    // Raw cross-pool standings are comparable only when every entrant has the same schedule size.
    check(!wildcards || sizes.every(size => size === sizes[0]), 'Wildcards require equal-sized pools');
    return { perPool, wildcards };
  }

  function normalizeCompetition(input) {
    check(input && typeof input === 'object', 'Competition is required');
    check((input.mode || 'standard') === 'standard', 'dual-meet must use an external legacy adapter');
    id(input.id, 'Competition ID');
    const affiliations = (input.affiliations || []).map(item => ({ ...copy(item), id: id(item.id, 'Affiliation ID') }));
    uniqueIds(affiliations.map(item => item.id), 'Affiliation IDs');
    const affiliationIds = new Set(affiliations.map(item => item.id));
    check(Array.isArray(input.entries) && Array.isArray(input.divisions), 'Entries and divisions must be arrays');
    const entries = input.entries.map(item => {
      id(item.id, 'Entry ID');
      const affiliationId = item.affiliationId === undefined ? null : item.affiliationId;
      check(affiliationId === null || affiliationIds.has(affiliationId), `Unknown affiliation for ${item.id}`);
      if (item.seed !== undefined && item.seed !== null) integer(item.seed, 1, 'Seed');
      return { ...copy(item), affiliationId, seed: item.seed == null ? null : item.seed };
    });
    uniqueIds(entries.map(item => item.id), 'Entry IDs');
    const entryIds = new Set(entries.map(item => item.id));
    const divisions = input.divisions.map(item => {
      id(item.id, 'Division ID');
      const ids = uniqueIds(item.entryIds);
      ids.forEach(entryId => check(entryIds.has(entryId), `Unknown entry ${entryId} in ${item.id}`));
      const format = item.format || 'round-robin';
      check(FORMATS.includes(format), `Unknown format: ${format}`);
      const sizes = format === 'pools' ? poolSizes(ids.length, item.poolCount) : [ids.length];
      return { ...copy(item), format, entryIds: ids, standings: standingsOptions(item.standings),
        qualifiers: qualification(format, item.qualifiers, sizes) };
    });
    uniqueIds(divisions.map(item => item.id), 'Division IDs');
    return { id: input.id, mode: 'standard', affiliations, entries, divisions };
  }

  function matchRecord(matchId, stageId, divisionId, round, a, b, poolId = null) {
    return { id: matchId, stageId, divisionId, poolId, round, a, b,
      participants: { a: null, b: null }, status: 'pending', result: null, winnerId: null, loserId: null };
  }

  function generateRoundRobin(entryIds, options = {}) {
    const ids = uniqueIds(entryIds).sort(lexical);
    const stageId = id(options.id || 'round-robin', 'Stage ID');
    if (ids.length < 2) return [];
    const rotation = ids.slice();
    if (rotation.length % 2) rotation.push(null);
    const matches = [];
    for (let round = 1; round < rotation.length; round += 1) {
      for (let i = 0; i < rotation.length / 2; i += 1) {
        let a = rotation[i], b = rotation[rotation.length - 1 - i];
        if (a === null || b === null) continue;
        const pair = [a, b].sort(lexical);
        if (round % 2 === 0) [a, b] = [b, a];
        const match = matchRecord(`${stageId}/match/${part(pair[0])}/${part(pair[1])}`,
          stageId, options.divisionId || null, round, entrySlot(a), entrySlot(b), options.poolId || null);
        match.participants = { a, b };
        match.status = 'ready';
        matches.push(match);
      }
      rotation.splice(1, 0, rotation.pop());
    }
    return matches;
  }

  function generateAffiliationRoundRobin(entryIds, entries, options = {}) {
    const lookup = entries instanceof Map ? entries : new Map((entries || []).map(entry => [entry.id, entry]));
    uniqueIds(entryIds).forEach(entryId => check(lookup.has(entryId), `Unknown entry ${entryId} in affiliation round robin`));
    return generateRoundRobin(entryIds, options).filter(match => {
      const a = lookup.get(match.participants.a)?.affiliationId || null;
      const b = lookup.get(match.participants.b)?.affiliationId || null;
      return a === null || b === null || a !== b;
    });
  }

  function generatePools(entryIds, options = {}) {
    const ids = uniqueIds(entryIds);
    poolSizes(ids.length, options.poolCount);
    const stageId = id(options.id || 'pools', 'Stage ID');
    const pools = Array.from({ length: options.poolCount }, (_, i) => ({
      id: `${stageId}/pool/${i + 1}`, name: `Pool ${i + 1}`, entryIds: [], matches: []
    }));
    ids.forEach((entryId, i) => {
      const row = Math.floor(i / pools.length), column = i % pools.length;
      pools[row % 2 === 0 ? column : pools.length - 1 - column].entryIds.push(entryId);
    });
    pools.forEach(pool => {
      pool.matches = generateRoundRobin(pool.entryIds, { id: pool.id,
        divisionId: options.divisionId, poolId: pool.id });
      pool.matches.forEach(match => { match.stageId = stageId; });
    });
    return pools;
  }

  function bracketSize(count) {
    integer(count, 0, 'Entry count');
    if (count === 0) return 0;
    return 2 ** Math.ceil(Math.log2(count));
  }

  function validateSlot(slot) {
    check(slot && typeof slot === 'object', 'Invalid bracket slot');
    if (slot.type === 'entry') id(slot.entryId, 'Entry ID');
    else if (slot.type === 'winner' || slot.type === 'loser') id(slot.matchId, 'Match ID');
    else if (slot.type === 'qualifier' || slot.type === 'wildcard') {
      id(slot.stageId, 'Stage ID');
      integer(slot.rank, 1, 'Qualifier rank');
      if (slot.type === 'qualifier' && slot.poolId != null) id(slot.poolId, 'Pool ID');
    } else check(slot.type === 'bye', `Unknown slot type: ${slot.type}`);
    return copy(slot);
  }

  function generateBracket(entrants, options = {}) {
    check(Array.isArray(entrants), 'Bracket entrants must be an array');
    const slots = entrants.map(value => validateSlot(typeof value === 'string' ? entrySlot(value) : value));
    check(slots.every(slot => slot.type !== 'bye'), 'Supply entrants only; bracket byes are automatic');
    const keys = slots.map(slot => slot.type === 'entry' ? `entry:${slot.entryId}` :
      ['winner', 'loser'].includes(slot.type) ? `${slot.type}:${slot.matchId}` : JSON.stringify([slot.type, slot.stageId, slot.poolId || null, slot.rank]));
    check(new Set(keys).size === keys.length, 'Bracket entrants must be unique');
    const stageId = id(options.id || 'bracket', 'Stage ID');
    const size = bracketSize(slots.length);
    let seeds = [1];
    for (let width = 2; width <= size; width *= 2) seeds = seeds.flatMap(seed => [seed, width + 1 - seed]);
    let current = size ? seeds.map(seed => slots[seed - 1] || byeSlot()) : [];
    const matches = [];
    for (let round = 1; current.length > 1; round += 1) {
      const next = [];
      for (let i = 0; i < current.length; i += 2) {
        const matchId = `${stageId}/round/${round}/match/${i / 2 + 1}`;
        matches.push(matchRecord(matchId, stageId, options.divisionId || null, round, current[i], current[i + 1]));
        next.push({ type: 'winner', matchId });
      }
      current = next;
    }
    const finalMatch = matches[matches.length - 1];
    if (finalMatch) finalMatch.medal = 'gold';
    let bronzeMatchId = null;
    if (options.bronzeMatch === true && slots.length >= 4) {
      const finalRound = finalMatch.round;
      const semifinals = matches.filter(match => match.round === finalRound - 1);
      if (semifinals.length === 2) {
        bronzeMatchId = `${stageId}/bronze`;
        const bronze = matchRecord(bronzeMatchId, stageId, options.divisionId || null, finalRound,
          { type: 'loser', matchId: semifinals[0].id }, { type: 'loser', matchId: semifinals[1].id });
        bronze.medal = 'bronze';
        matches.push(bronze);
      }
    }
    const stage = { id: stageId, type: 'single-elimination', entryCount: slots.length,
      size, byes: size - slots.length, matches, champion: current[0] || null, bronzeMatchId };
    resolveBracketInPlace(stage, () => ({ known: false, entryId: null }));
    return stage;
  }

  function validateResult(result, allowDraws) {
    check(result && typeof result === 'object', 'Result is required');
    if (result.void === true) return { a: 0, b: 0, void: true, countsAsPlayed:result.countsAsPlayed === true, reason: String(result.reason || 'No contest') };
    integer(result.a, 0, 'Score a');
    integer(result.b, 0, 'Score b');
    check(allowDraws || result.a !== result.b, 'A decisive result is required');
    return { a: result.a, b: result.b };
  }

  function addResult(a, b, result, points) {
    a.played += 1; b.played += 1;
    a.pointsFor += result.a; a.pointsAgainst += result.b;
    b.pointsFor += result.b; b.pointsAgainst += result.a;
    if (result.a === result.b) {
      a.draws += 1; b.draws += 1;
      a.standingPoints += points.draw; b.standingPoints += points.draw;
    } else {
      const winner = result.a > result.b ? a : b, loser = winner === a ? b : a;
      winner.wins += 1; loser.losses += 1;
      winner.standingPoints += points.win; loser.standingPoints += points.loss;
    }
    a.pointDifferential = a.pointsFor - a.pointsAgainst;
    b.pointDifferential = b.pointsFor - b.pointsAgainst;
  }

  function blankRow(entry) {
    return { entryId: entry.id, seed: entry.seed == null ? null : entry.seed,
      played: 0, wins: 0, losses: 0, draws: 0, pointsFor: 0, pointsAgainst: 0,
      pointDifferential: 0, standingPoints: 0 };
  }

  function metric(row, criterion) {
    if (criterion === 'pointsAgainst') return -row.pointsAgainst;
    if (criterion === 'seed') return row.seed === null ? -Infinity : -row.seed;
    return row[criterion];
  }

  // Partition entire tied groups instead of using a non-transitive pairwise H2H comparator.
  function rankRows(rows, completed, options) {
    function split(group, index) {
      if (group.length < 2 || index === options.order.length) return [group];
      const criterion = options.order[index];
      let values;
      if (criterion === 'headToHead') {
        const members = new Set(group.map(row => row.entryId));
        const internal = completed.filter(match => members.has(match.a) && members.has(match.b));
        const pairs = new Set(internal.map(match => JSON.stringify([match.a, match.b].sort(lexical))));
        // Skip incomplete mini-tables and cross-pool comparisons.
        if (pairs.size !== group.length * (group.length - 1) / 2) return split(group, index + 1);
        values = new Map(group.map(row => [row.entryId, 0]));
        internal.forEach(match => {
          const { a, b, result } = match;
          values.set(a, values.get(a) + (result.a === result.b ? options.points.draw : result.a > result.b ? options.points.win : options.points.loss));
          values.set(b, values.get(b) + (result.a === result.b ? options.points.draw : result.b > result.a ? options.points.win : options.points.loss));
        });
      } else values = new Map(group.map(row => [row.entryId, metric(row, criterion)]));
      const buckets = new Map();
      group.forEach(row => {
        const value = values.get(row.entryId);
        if (!buckets.has(value)) buckets.set(value, []);
        buckets.get(value).push(row);
      });
      return [...buckets.keys()].sort((a, b) => a === b ? 0 : a > b ? -1 : 1)
        .flatMap(key => split(buckets.get(key), index + 1));
    }
    let position = 0;
    return split(rows, 0).flatMap(group => {
      const rank = position + 1;
      const tiedEntryIds = group.length > 1 ? group.map(row => row.entryId).sort(lexical) : [];
      return group.slice().sort((a, b) => lexical(a.entryId, b.entryId)).map(row => ({
        ...row, rank, position: ++position, tied: group.length > 1, tiedEntryIds: tiedEntryIds.slice()
      }));
    });
  }

  function getStandings(entries, matches, settings = {}) {
    const options = standingsOptions(settings);
    const normalized = entries.map(entry => typeof entry === 'string' ? { id: entry } : entry);
    uniqueIds(normalized.map(entry => entry.id));
    normalized.forEach(entry => { if (entry.seed != null) integer(entry.seed, 1, 'Seed'); });
    const rows = new Map(normalized.map(entry => [entry.id, blankRow(entry)]));
    uniqueIds(matches.map(match => match.id), 'Match IDs');
    const completed = [];
    matches.forEach(match => {
      if (match.status !== 'complete' || !match.result) return;
      const a = match.participants ? match.participants.a : match.a.entryId;
      const b = match.participants ? match.participants.b : match.b.entryId;
      check(a !== b && rows.has(a) && rows.has(b), `Invalid standings participants in ${match.id}`);
      const result = validateResult(match.result, options.allowDraws);
      if (result.void) {
        if (result.countsAsPlayed) {
          rows.get(a).played += 1;
          rows.get(b).played += 1;
        }
        return;
      }
      addResult(rows.get(a), rows.get(b), result, options.points);
      completed.push({ a, b, result });
    });
    return rankRows([...rows.values()], completed, options);
  }

  function estimateMatches(options) {
    const count = integer(options.entryCount, 0, 'Entry count');
    const format = options.format || 'round-robin';
    check(FORMATS.includes(format), `Unknown format: ${format}`);
    const sizes = format === 'pools' ? poolSizes(count, options.poolCount) : [count];
    const qualifiers = qualification(format, options.qualifiers, sizes);
    const qualifierCount = !qualifiers ? 0 : format === 'pools'
      ? qualifiers.perPool * sizes.length + qualifiers.wildcards : qualifiers.count;
    let preliminary = format === 'single-elimination' ? 0 : sizes.reduce((sum, n) => sum + n * (n - 1) / 2, 0);
    if (format === 'affiliation-round-robin') {
      const counts = options.affiliationCounts || [];
      check(Array.isArray(counts) && counts.every(value => Number.isSafeInteger(value) && value >= 0),
        'Affiliation counts must be nonnegative integers');
      check(counts.reduce((sum, value) => sum + value, 0) <= count, 'Affiliation counts exceed entry count');
      preliminary -= counts.reduce((sum, value) => sum + value * (value - 1) / 2, 0);
    }
    const bracketEntries = format === 'single-elimination' ? count : qualifierCount;
    const bronze = options.bronzeMatch === true && bracketEntries >= 4 ? 1 : 0;
    const elimination = Math.max(0, bracketEntries - 1) + bronze;
    const size = bracketSize(bracketEntries);
    const total = preliminary + elimination;
    check(Number.isSafeInteger(total), 'Match count exceeds safe integer range');
    return { preliminary, elimination, total, qualifierCount, poolSizes: format === 'pools' ? sizes : [],
      bracketSize: size, byes: size - bracketEntries, bracketSlots: Math.max(0, size - 1) };
  }

  function qualifierSlots(stage) {
    const slots = [], qualifiers = stage.qualifiers;
    if (!qualifiers) return slots;
    if (stage.type === 'round-robin') {
      for (let rank = 1; rank <= qualifiers.count; rank += 1) slots.push({ type: 'qualifier', stageId: stage.id, poolId: null, rank });
    } else {
      for (let rank = 1; rank <= qualifiers.perPool; rank += 1) {
        stage.pools.forEach(pool => slots.push({ type: 'qualifier', stageId: stage.id, poolId: pool.id, rank }));
      }
      for (let rank = 1; rank <= qualifiers.wildcards; rank += 1) slots.push({ type: 'wildcard', stageId: stage.id, rank });
    }
    return slots;
  }

  function createCompetition(input) {
    const definition = normalizeCompetition(input);
    const entries = new Map(definition.entries.map(entry => [entry.id, entry]));
    const divisions = definition.divisions.map(division => {
      const ordered = division.entryIds.slice().sort((a, b) => {
        const first = entries.get(a).seed, second = entries.get(b).seed;
        return (first == null ? Infinity : first) - (second == null ? Infinity : second) || lexical(a, b);
      });
      const prefix = `${part(definition.id)}/division/${part(division.id)}`;
      const stages = [];
      if (division.format === 'single-elimination') {
        stages.push(generateBracket(ordered, { id: `${prefix}/bracket`, divisionId: division.id, bronzeMatch:division.bronzeMatch === true }));
      } else {
        const stageId = `${prefix}/${division.format}`;
        const pools = division.format === 'pools' ? generatePools(ordered,
          { id: stageId, poolCount: division.poolCount, divisionId: division.id }) : [];
        const stageType = roundRobinFormat(division.format) ? 'round-robin' : division.format;
        const stage = { id: stageId, type: stageType, matchPolicy: division.format === 'affiliation-round-robin' ? 'cross-affiliation' : 'all-entries', entryIds: ordered, qualifiers: division.qualifiers,
          pools: pools.map(({ matches, ...pool }) => pool),
          matches: division.format === 'pools' ? pools.flatMap(pool => pool.matches)
            : division.format === 'affiliation-round-robin'
              ? generateAffiliationRoundRobin(ordered, entries, { id: stageId, divisionId: division.id })
              : generateRoundRobin(ordered, { id: stageId, divisionId: division.id }) };
        stages.push(stage);
        const slots = qualifierSlots(stage);
        if (slots.length) stages.push(generateBracket(slots, { id: `${prefix}/playoff`, divisionId: division.id, bronzeMatch:division.bronzeMatch === true }));
      }
      const affiliationCounts = [...new Set(ordered.map(entryId => entries.get(entryId).affiliationId).filter(Boolean))]
        .map(affiliationId => ordered.filter(entryId => entries.get(entryId).affiliationId === affiliationId).length);
      return { id: division.id, entryIds: ordered, standings: division.standings, stages,
        estimate: estimateMatches({ ...division, entryCount: ordered.length, affiliationCounts }) };
    });
    return resolveAdvancement({ version: 1, definition, divisions });
  }

  function applyOutcome(match, allowDraws) {
    match.winnerId = null; match.loserId = null;
    if (!match.result) { match.status = 'ready'; return; }
    match.result = validateResult(match.result, allowDraws);
    match.status = 'complete';
    if (match.result.void) return;
    if (match.result.a !== match.result.b) {
      const aWon = match.result.a > match.result.b;
      match.winnerId = match.participants[aWon ? 'a' : 'b'];
      match.loserId = match.participants[aWon ? 'b' : 'a'];
    }
  }

  function resolveBracketInPlace(stage, resolveQualifier) {
    const byId = new Map();
    function resolve(slot) {
      if (slot.type === 'entry') return { known: true, entryId: slot.entryId };
      if (slot.type === 'bye') return { known: true, entryId: null };
      if (slot.type === 'winner') {
        const source = byId.get(slot.matchId);
        return { known: !!source && ['complete', 'bye'].includes(source.status), entryId: source ? source.winnerId : null };
      }
      if (slot.type === 'loser') {
        const source = byId.get(slot.matchId);
        return { known: !!source && source.status === 'complete', entryId: source ? source.loserId : null };
      }
      return resolveQualifier(slot);
    }
    stage.matches.forEach(match => {
      const a = resolve(match.a), b = resolve(match.b);
      const participants = { a: a.entryId, b: b.entryId };
      if (match.participants.a !== participants.a || match.participants.b !== participants.b) match.result = null;
      match.participants = participants;
      match.winnerId = null; match.loserId = null;
      if (!a.known || !b.known) {
        match.status = 'pending'; match.result = null;
      } else if (a.entryId === null || b.entryId === null) {
        match.status = 'bye'; match.result = null; match.winnerId = a.entryId || b.entryId;
      } else {
        check(a.entryId !== b.entryId, 'An entry cannot play itself');
        applyOutcome(match, false);
      }
      byId.set(match.id, match);
    });
    const champion = stage.champion ? resolve(stage.champion) : { known: true, entryId: null };
    stage.championId = champion.known ? champion.entryId : null;
    const bronze = stage.bronzeMatchId ? byId.get(stage.bronzeMatchId) : null;
    stage.complete = champion.known && (!bronze || ['complete', 'bye'].includes(bronze.status));
  }

  function resolveAdvancement(input) {
    const state = copy(input);
    const entries = new Map(state.definition.entries.map(entry => [entry.id, entry]));
    const eligibleRows = rows => rows.filter(row => entries.get(row.entryId)?.eligibleForAdvancement !== false).map(row => {
      const tiedEntryIds = row.tiedEntryIds.filter(entryId => entries.get(entryId)?.eligibleForAdvancement !== false);
      return { ...row, tied:tiedEntryIds.length > 0, tiedEntryIds };
    });
    // A standard tournament may require the final to represent two different
    // affiliations. In that case qualifier rank is the *eligible qualifier
    // order*, not necessarily the raw table rank: after the leader, skip
    // teammates until the next distinct affiliation is found.
    const distinctAffiliationRows = rows => {
      const selected = [], seen = new Set();
      for (const row of rows) {
        const affiliationId = entries.get(row.entryId)?.affiliationId || `entry:${row.entryId}`;
        if (seen.has(affiliationId)) continue;
        selected.push(row);
        seen.add(affiliationId);
      }
      return selected;
    };
    state.divisions.forEach(division => {
      const sources = new Map();
      division.stages.forEach(stage => {
        if (stage.type !== 'single-elimination') {
          stage.matches.forEach(match => applyOutcome(match, division.standings.allowDraws));
          stage.complete = stage.matches.every(match => match.status === 'complete');
          stage.tables = (stage.type === 'pools' ? stage.pools : [{ id: null, entryIds: stage.entryIds }]).map(pool => ({
            poolId: pool.id,
            rows: getStandings(pool.entryIds.map(entryId => entries.get(entryId)),
              stage.matches.filter(match => match.poolId === pool.id), division.standings)
          }));
          sources.set(stage.id, stage);
        } else {
          resolveBracketInPlace(stage, slot => {
            const source = sources.get(slot.stageId);
            const pending = { known: false, entryId: null };
            if (!source || !source.complete) return pending;
            let rows;
            if (slot.type === 'qualifier') {
              const table = source.tables.find(table => table.poolId === slot.poolId);
              rows = table ? eligibleRows(table.rows) : [];
              if (source.qualifiers?.distinctAffiliations === true && slot.poolId === null) rows = distinctAffiliationRows(rows);
            } else {
              // Do not pick wildcards until all automatic qualification boundaries are unambiguous.
              const cutoff = source.qualifiers.perPool;
              const eligibleTables = source.tables.map(table => eligibleRows(table.rows));
              if (eligibleTables.some(rows => rows.some(row => row.rank <= cutoff && row.rank + row.tiedEntryIds.length - 1 > cutoff))) return pending;
              rows = eligibleTables.flatMap(rows => rows.slice(cutoff));
              rows = rankRows(rows, [], division.standings);
            }
            const row = rows[slot.rank - 1];
            return row && !row.tied ? { known: true, entryId: row.entryId } : pending;
          });
        }
      });
    });
    return state;
  }

  function changeResult(input, matchId, result) {
    const state = resolveAdvancement(input);
    let target, rules, elimination;
    state.divisions.forEach(division => division.stages.forEach(stage => stage.matches.forEach(match => {
      if (match.id === matchId) { target = match; rules = division.standings; elimination = stage.type === 'single-elimination'; }
    })));
    check(target, `Unknown match: ${matchId}`);
    check(target.status === 'ready' || target.status === 'complete', 'Cannot score an unresolved match or a bye');
    target.result = result === null ? null : validateResult(result, !elimination && rules.allowDraws);
    return resolveAdvancement(state);
  }

  function recordResult(state, matchId, result) {
    check(result !== null, 'Use clearResult to remove a result');
    return changeResult(state, matchId, result);
  }

  function clearResult(state, matchId) { return changeResult(state, matchId, null); }

  // No legacy rules are duplicated here. The host owns and explicitly supplies its adapter.
  function createEngine(options = {}) {
    const mode = options.mode || 'standard';
    const supported = capabilities(mode);
    if (mode === 'standard') return api;
    const adapter = options.legacyAdapter;
    check(adapter && typeof adapter === 'object', 'dual-meet requires an external legacyAdapter');
    const methods = ['createCompetition', 'recordResult', 'clearResult', 'resolveAdvancement', 'getStandings', 'estimateMatches'];
    const facade = { mode, capabilities: () => ({ ...supported, formats: [] }) };
    methods.forEach(method => {
      facade[method] = (...args) => {
        check(typeof adapter[method] === 'function', `Legacy adapter does not implement ${method}`);
        return adapter[method](...args);
      };
    });
    return Object.freeze(facade);
  }

  const api = Object.freeze({ version: 1, mode: 'standard', capabilities, createEngine,
    normalizeCompetition, generateRoundRobin, generateAffiliationRoundRobin, generatePools, generateBracket,
    getStandings, estimateMatches, createCompetition, resolveAdvancement, recordResult, clearResult });
  return api;
});

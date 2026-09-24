'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const engine = require('../standard-engine.js');

const ids = n => Array.from({ length: n }, (_, i) => `entry-${String(i + 1).padStart(2, '0')}`);
function definition(n, settings = {}) {
  return {
    id: 'test-event', mode: 'standard',
    affiliations: [{ id: 'club', name: 'Same club' }],
    entries: ids(n).map((id, i) => ({ id, name: `Player ${i + 1}`, affiliationId: 'club', seed: i + 1 })),
    divisions: [{ id: 'open', name: 'Open', entryIds: ids(n), format: 'round-robin', ...settings }]
  };
}
const allMatches = state => state.divisions.flatMap(division => division.stages.flatMap(stage => stage.matches));
const stage = (state, index = 0) => state.divisions[0].stages[index];
function finishPreliminary(state, tied = false) {
  const matches = stage(state).matches;
  for (const match of matches) {
    const aWins = match.participants.a < match.participants.b;
    state = engine.recordResult(state, match.id, tied ? { a: 5, b: 5 } : { a: aWins ? 11 : 3, b: aWins ? 3 : 11 });
  }
  return state;
}
function finishBracket(state) {
  let match;
  while ((match = allMatches(state).find(match => match.status === 'ready'))) {
    state = engine.recordResult(state, match.id, { a: 11, b: 2 });
  }
  return state;
}
function scored(a, b, scoreA, scoreB, index) {
  return { id: `m${index}`, status: 'complete', participants: { a, b }, result: { a: scoreA, b: scoreB } };
}
function deepFreeze(value) {
  Object.freeze(value);
  Object.values(value).forEach(child => { if (child && typeof child === 'object' && !Object.isFrozen(child)) deepFreeze(child); });
  return value;
}

test('classic browser script exposes the same API without DOM or CommonJS', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../standard-engine.js'), 'utf8'), context);
  const api = context.StandardTournamentEngine;
  assert.equal(api.mode, 'standard');
  assert.equal(api.estimateMatches({ entryCount: 5 }).total, 10);
  assert.equal(api.createCompetition(definition(3)).divisions[0].stages[0].matches.length, 3);
  assert.deepEqual(Object.keys(context), ['StandardTournamentEngine']);
});

test('mode capabilities are isolated copies; standard engine is a frozen facade', () => {
  assert.equal(engine.createEngine(), engine);
  assert.ok(Object.isFrozen(engine));
  const caps = engine.capabilities();
  caps.formats.pop();
  assert.equal(engine.capabilities().formats.length, 4);
  assert.equal(engine.capabilities('dual-meet').externalAdapter, true);
  assert.equal(engine.capabilities('dual-meet').fullRoundRobin, false);
  assert.throws(() => engine.capabilities('mystery'), /Unknown competition mode/);
});

test('dual-meet is delegated only to the explicitly supplied legacy adapter', () => {
  assert.throws(() => engine.createEngine({ mode: 'dual-meet' }), /external legacyAdapter/);
  assert.throws(() => engine.createCompetition({ ...definition(2), mode: 'dual-meet' }), /external legacy adapter/);
  const payload = { legacy: true };
  const adapter = { payload, createCompetition(value) { assert.equal(this, adapter); return [this.payload, value]; } };
  const legacy = engine.createEngine({ mode: 'dual-meet', legacyAdapter: adapter });
  assert.deepEqual(legacy.createCompetition('input'), [payload, 'input']);
  assert.throws(() => legacy.estimateMatches({}), /does not implement estimateMatches/);
  assert.equal(legacy.generateRoundRobin, undefined);
});

test('stable IDs survive renaming, metadata changes and reordering; affiliation is not a competitor', () => {
  const first = definition(5, { qualifiers: { count: 3 } });
  const second = structuredClone(first);
  second.entries.reverse().forEach(entry => { entry.name = 'Renamed'; });
  second.affiliations[0].name = 'Renamed club';
  second.divisions[0].name = 'Renamed division';
  second.divisions[0].entryIds.reverse();
  const a = engine.createCompetition(first), b = engine.createCompetition(second);
  assert.deepEqual(a.divisions, b.divisions);
  assert.equal(stage(a).matches.length, 10); // Same-affiliation opponents ARE included.
  assert.equal(a.definition.affiliations.length, 1);
});

test('entries can be unaffiliated or shared across divisions without match-ID collisions', () => {
  const input = definition(3);
  delete input.entries[0].affiliationId;
  input.divisions.push({ id: 'another/open', entryIds: ids(3), format: 'single-elimination' });
  const state = engine.createCompetition(input);
  assert.equal(state.definition.entries[0].affiliationId, null);
  assert.equal(new Set(allMatches(state).map(match => match.id)).size, allMatches(state).length);
});

test('input definitions and persisted states are never mutated', () => {
  const input = deepFreeze(definition(3));
  const state = deepFreeze(engine.createCompetition(input));
  const next = engine.recordResult(state, stage(state).matches[0].id, { a: 11, b: 0 });
  assert.equal(stage(state).matches[0].result, null);
  assert.equal(stage(next).matches[0].status, 'complete');
  assert.deepEqual(engine.resolveAdvancement(next), next);
  assert.deepEqual(engine.resolveAdvancement(JSON.parse(JSON.stringify(next))), next);
});

test('normalization rejects dangling references, duplicate IDs, invalid modes and seeds', () => {
  const invalid = [
    input => { input.entries[0].id = input.entries[1].id; },
    input => { input.entries[0].affiliationId = 'missing'; },
    input => { input.divisions[0].entryIds.push('missing'); },
    input => { input.divisions[0].entryIds.push(input.entries[0].id); },
    input => { input.divisions.push(input.divisions[0]); },
    input => { input.affiliations.push(input.affiliations[0]); },
    input => { input.divisions[0].format = 'double-elimination'; },
    input => { input.entries[0].seed = 0; },
    input => { input.id = ''; }
  ];
  invalid.forEach(mutate => { const input = definition(3); mutate(input); assert.throws(() => engine.createCompetition(input)); });
});

test('full round robin exhaustively covers each pair exactly once with no round conflicts (0–32 entries)', () => {
  for (let n = 0; n <= 32; n += 1) {
    const matches = engine.generateRoundRobin(ids(n));
    assert.equal(matches.length, Math.max(0, n * (n - 1) / 2));
    const pairs = new Set(), rounds = new Map();
    for (const match of matches) {
      const { a, b } = match.participants;
      assert.notEqual(a, b);
      pairs.add([a, b].sort().join(':'));
      if (!rounds.has(match.round)) rounds.set(match.round, []);
      rounds.get(match.round).push(a, b);
    }
    assert.equal(pairs.size, matches.length);
    for (const participants of rounds.values()) assert.equal(new Set(participants).size, participants.length);
    if (n >= 2) assert.equal(rounds.size, n % 2 ? n : n - 1);
    assert.deepEqual(matches, engine.generateRoundRobin(ids(n).reverse()));
  }
});

test('affiliation round robin excludes teammates and gives three teams of three exactly six matches per pair', () => {
  const affiliations = ['team-a', 'team-b', 'team-c'];
  const entries = affiliations.flatMap((affiliationId, teamIndex) => Array.from({ length: 3 }, (_, pairIndex) => ({
    id: `${affiliationId}-pair-${pairIndex + 1}`,
    name: `Team ${teamIndex + 1} Pair ${pairIndex + 1}`,
    affiliationId
  })));
  const input = {
    id: 'sportsfest', mode: 'standard',
    affiliations: affiliations.map(id => ({ id, name: id })),
    entries,
    divisions: [{ id: 'novice', name: 'Novice', entryIds: entries.map(entry => entry.id), format: 'affiliation-round-robin' }]
  };
  const state = engine.createCompetition(input), matches = stage(state).matches;
  assert.equal(matches.length, 27);
  const appearances = new Map(entries.map(entry => [entry.id, 0]));
  matches.forEach(match => {
    const a = entries.find(entry => entry.id === match.participants.a);
    const b = entries.find(entry => entry.id === match.participants.b);
    assert.notEqual(a.affiliationId, b.affiliationId);
    appearances.set(a.id, appearances.get(a.id) + 1);
    appearances.set(b.id, appearances.get(b.id) + 1);
  });
  assert.deepEqual([...appearances.values()], Array(9).fill(6));
  assert.equal(state.divisions[0].estimate.preliminary, 27);
  assert.equal(stage(state).matchPolicy, 'cross-affiliation');
});

test('affiliation round robin can feed an elimination bracket through qualifiers', () => {
  const affiliations = ['one', 'two', 'three'];
  const entries = affiliations.flatMap(id => [1, 2].map(number => ({ id: `${id}-${number}`, affiliationId:id })))
    .map((entry, index) => ({ ...entry, seed:index + 1 }));
  let state = engine.createCompetition({
    id:'sportsfest-playoff', mode:'standard', affiliations:affiliations.map(id => ({ id })), entries,
    divisions:[{ id:'open', entryIds:entries.map(entry => entry.id), format:'affiliation-round-robin', qualifiers:{ count:4 }, standings:{ order:['wins','pointDifferential','pointsFor','seed'] } }]
  });
  assert.equal(stage(state).matches.length, 12);
  state = finishPreliminary(state);
  assert.equal(stage(state, 1).matches.filter(match => match.status === 'ready').length, 2);
});

test('distinct-affiliation qualifiers skip a same-team second place for the Championship Final', () => {
  const entries = [
    { id:'meralco-1', affiliationId:'meralco', seed:1 }, { id:'meralco-2', affiliationId:'meralco', seed:2 },
    { id:'mgen-1', affiliationId:'mgen', seed:3 }, { id:'mpower-1', affiliationId:'mpower', seed:4 }
  ];
  let state = engine.createCompetition({
    id:'different-finalists', mode:'standard', affiliations:['meralco','mgen','mpower'].map(id => ({ id })), entries,
    divisions:[{ id:'open', entryIds:entries.map(entry => entry.id), format:'round-robin', qualifiers:{ count:2, distinctAffiliations:true }, standings:{ order:['wins','pointDifferential','pointsFor','seed'] } }]
  });
  // Meralco-1 finishes first, Meralco-2 second, then MGen-1. The qualifier
  // selector must promote MGen-1 as the eligible opposing finalist.
  for (const match of stage(state).matches) {
    const a = match.participants.a, b = match.participants.b;
    const winner = a === 'meralco-1' || (a === 'meralco-2' && b !== 'meralco-1') ? a : b === 'meralco-1' || b === 'meralco-2' ? b : a;
    state = engine.recordResult(state, match.id, winner === a ? { a:11, b:4 } : { a:4, b:11 });
  }
  const final = stage(state, 1).matches.find(match => match.medal === 'gold');
  assert.equal(final.status, 'ready');
  assert.deepEqual(new Set(Object.values(final.participants)), new Set(['meralco-1', 'mgen-1']));
});

test('four qualifiers produce semifinals plus Gold/Silver and Bronze medal matches', () => {
  let state = engine.createCompetition(definition(9, {
    qualifiers:{ count:4 }, bronzeMatch:true,
    standings:{ order:['wins','pointDifferential','pointsFor','seed'] }
  }));
  assert.equal(state.divisions[0].estimate.preliminary, 36);
  assert.equal(state.divisions[0].estimate.elimination, 4);
  state = finishPreliminary(state);
  const playoff = stage(state, 1);
  const semifinals = playoff.matches.filter(match => match.round === 1);
  const gold = playoff.matches.find(match => match.medal === 'gold');
  const bronze = playoff.matches.find(match => match.medal === 'bronze');
  assert.equal(semifinals.length, 2);
  assert.equal(gold.status, 'pending');
  assert.equal(bronze.status, 'pending');
  state = engine.recordResult(state, semifinals[0].id, { a:11, b:5 });
  state = engine.recordResult(state, semifinals[1].id, { a:7, b:11 });
  assert.deepEqual(stage(state, 1).matches.find(match => match.medal === 'gold').participants,
    { a:semifinals[0].participants.a, b:semifinals[1].participants.b });
  assert.deepEqual(stage(state, 1).matches.find(match => match.medal === 'bronze').participants,
    { a:semifinals[0].participants.b, b:semifinals[1].participants.a });
  state = engine.recordResult(state, gold.id, { a:15, b:12 });
  assert.equal(stage(state, 1).complete, false);
  state = engine.recordResult(state, bronze.id, { a:15, b:9 });
  assert.equal(stage(state, 1).complete, true);
});

test('entries marked ineligible never advance even when their results rank first', () => {
  const entries = [
    { id:'pair-a', seed:1 },
    { id:'pair-b', seed:2 },
    { id:'default-entry', seed:3, eligibleForAdvancement:false }
  ];
  let state = engine.createCompetition({
    id:'walkover-qualification', mode:'standard', entries,
    divisions:[{ id:'open', entryIds:entries.map(entry => entry.id), format:'round-robin', qualifiers:{ count:2 }, standings:{ order:['wins','pointDifferential','seed'] } }]
  });
  for (const match of stage(state).matches) {
    const defaultOnA = match.participants.a === 'default-entry';
    const defaultOnB = match.participants.b === 'default-entry';
    state = engine.recordResult(state, match.id, defaultOnA ? { a:11, b:0 } : defaultOnB ? { a:0, b:11 } : { a:0, b:11 });
  }
  const playoff = stage(state, 1);
  assert.equal(playoff.matches.some(match => Object.values(match.participants).includes('default-entry')), false);
  assert.deepEqual(new Set(playoff.matches.flatMap(match => Object.values(match.participants).filter(Boolean))), new Set(['pair-a','pair-b']));
});

test('generated IDs handle delimiters, Unicode, and object-prototype names', () => {
  const values = ['a/b', 'a', 'b/c', 'c', '__proto__', 'constructor', 'ñ~'];
  const matches = engine.generateRoundRobin(values);
  assert.equal(new Set(matches.map(match => match.id)).size, 21);
  const tables = engine.getStandings(values, []);
  assert.equal(tables.length, values.length);
  assert.throws(() => engine.generateRoundRobin(['x', 'x']), /unique/);
});

test('pools use deterministic snake seeding and contain only intra-pool matches', () => {
  const pools = engine.generatePools(ids(10), { poolCount: 3 });
  assert.deepEqual(pools.map(pool => pool.entryIds), [
    ['entry-01', 'entry-06', 'entry-07'], ['entry-02', 'entry-05', 'entry-08'],
    ['entry-03', 'entry-04', 'entry-09', 'entry-10']
  ]);
  for (const pool of pools) for (const match of pool.matches) {
    assert.ok(pool.entryIds.includes(match.participants.a));
    assert.ok(pool.entryIds.includes(match.participants.b));
    assert.equal(match.poolId, pool.id);
  }
});

test('pool estimates match generated balanced snake pools for every 1–20 entry/pool count', () => {
  for (let n = 1; n <= 20; n += 1) for (let k = 1; k <= n; k += 1) {
    const pools = engine.generatePools(ids(n), { poolCount: k });
    const estimate = engine.estimateMatches({ format: 'pools', entryCount: n, poolCount: k });
    assert.equal(pools.flatMap(pool => pool.matches).length, estimate.total);
    assert.deepEqual(pools.map(pool => pool.entryIds.length).sort((a, b) => a - b), estimate.poolSizes.slice().sort((a, b) => a - b));
    assert.equal(new Set(pools.flatMap(pool => pool.entryIds)).size, n);
  }
});

test('invalid pool counts and qualifier configurations fail early', () => {
  for (const poolCount of [0, -1, 2.5, 5, undefined]) assert.throws(() => engine.generatePools(ids(4), { poolCount }));
  for (const options of [
    { qualifiers: { count: 5 } }, { qualifiers: { count: -1 } }, { qualifiers: { count: 1.1 } },
    { qualifiers: { perPool: 1 } },
    { format: 'pools', poolCount: 2, qualifiers: { perPool: 3 } },
    { format: 'pools', poolCount: 2, qualifiers: { perPool: 1, wildcards: 3 } },
    { format: 'single-elimination', qualifiers: { count: 2 } }
  ]) assert.throws(() => engine.createCompetition(definition(4, options)));
  assert.throws(() => engine.createCompetition(definition(5, { format: 'pools', poolCount: 2,
    qualifiers: { perPool: 1, wildcards: 1 } })), /equal-sized pools/);
});

test('standard bracket seed placement gives highest seeds the byes', () => {
  const bracket = engine.generateBracket(ids(5));
  assert.equal(bracket.size, 8);
  assert.equal(bracket.byes, 3);
  assert.deepEqual(bracket.matches.filter(match => match.status === 'bye').map(match => match.winnerId).sort(), ids(3));
  assert.equal(bracket.matches.filter(match => match.round === 1 && match.status === 'ready').length, 1);
  const eight = engine.generateBracket(ids(8));
  assert.deepEqual(eight.matches.filter(match => match.round === 1).map(match => [match.participants.a, match.participants.b]), [
    ['entry-01', 'entry-08'], ['entry-04', 'entry-05'], ['entry-02', 'entry-07'], ['entry-03', 'entry-06']
  ]);
});

test('elimination brackets play n−1 real matches, never score byes, and resolve champions (0–33)', () => {
  for (let n = 0; n <= 33; n += 1) {
    const state = finishBracket(engine.createCompetition(definition(n, { format: 'single-elimination' })));
    const bracket = stage(state);
    const estimate = state.divisions[0].estimate;
    assert.equal(bracket.matches.filter(match => match.status === 'complete').length, Math.max(0, n - 1));
    assert.equal(bracket.matches.filter(match => match.status === 'bye').length, estimate.byes);
    assert.equal(bracket.matches.length, estimate.bracketSlots);
    assert.equal(bracket.complete, true);
    assert.equal(bracket.championId, n ? 'entry-01' : null);
  }
});

test('unresolved qualifier plus bye stays pending, not a free pass for an unknown entrant', () => {
  let state = engine.createCompetition(definition(5, { qualifiers: { count: 3 } }));
  const bracket = stage(state, 1);
  assert.equal(bracket.matches.length, 3);
  assert.ok(bracket.matches.every(match => match.status === 'pending'));
  assert.throws(() => engine.recordResult(state, bracket.matches[0].id, { a: 11, b: 2 }), /unresolved/);
  state = finishPreliminary(state);
  assert.equal(stage(state, 1).matches[0].status, 'bye');
  assert.equal(stage(state, 1).matches[0].winnerId, 'entry-01');
  assert.throws(() => engine.recordResult(state, stage(state, 1).matches[0].id, { a: 11, b: 2 }), /bye/);
});

test('round-robin qualifiers wait for the whole source stage, then seed the playoff', () => {
  let state = engine.createCompetition(definition(4, { qualifiers: { count: 2 } }));
  const matches = stage(state).matches;
  for (const match of matches.slice(0, -1)) state = engine.recordResult(state, match.id, { a: 11, b: 0 });
  assert.equal(stage(state, 1).matches[0].status, 'pending');
  state = finishPreliminary(state);
  assert.deepEqual(stage(state, 1).matches[0].participants, { a: 'entry-01', b: 'entry-02' });
  state = finishBracket(state);
  assert.equal(stage(state, 1).championId, 'entry-01');
  assert.deepEqual(state.divisions[0].estimate, {
    preliminary: 6, elimination: 1, total: 7, qualifierCount: 2, poolSizes: [], bracketSize: 2, byes: 0, bracketSlots: 1
  });
});

test('per-pool qualifiers interleave pool rank; equal-sized pools support wildcards', () => {
  let state = engine.createCompetition(definition(8, { format: 'pools', poolCount: 2,
    qualifiers: { perPool: 1, wildcards: 2 }, standings: { order: ['wins', 'pointDifferential', 'seed'] } }));
  state = finishPreliminary(state);
  const matches = stage(state, 1).matches.filter(match => match.round === 1);
  assert.deepEqual(matches.map(match => match.participants), [
    { a: 'entry-01', b: 'entry-04' }, { a: 'entry-02', b: 'entry-03' }
  ]);
  assert.equal(state.divisions[0].estimate.total, 15);
  const direct = finishPreliminary(engine.createCompetition(definition(8, {
    format: 'pools', poolCount: 2, qualifiers: { perPool: 2 }
  })));
  assert.deepEqual(stage(direct, 1).matches.filter(match => match.round === 1).map(match => match.participants), [
    { a: 'entry-01', b: 'entry-03' }, { a: 'entry-02', b: 'entry-04' }
  ]);
});

test('zero and one qualifier, empty divisions, and singleton pools have explicit outcomes', () => {
  assert.equal(engine.createCompetition(definition(0)).divisions[0].stages.length, 1);
  assert.equal(engine.createCompetition(definition(3, { qualifiers: { count: 0 } })).divisions[0].stages.length, 1);
  const one = engine.createCompetition(definition(1, { qualifiers: { count: 1 } }));
  assert.equal(stage(one, 1).championId, 'entry-01');
  const pools = engine.createCompetition(definition(3, { format: 'pools', poolCount: 3, qualifiers: { perPool: 1 } }));
  assert.equal(stage(pools).complete, true);
  assert.equal(stage(pools, 1).matches.filter(match => match.status === 'bye').length, 1);
  assert.equal(stage(pools, 1).matches.filter(match => match.status === 'ready').length, 1);
});

test('standings count only completed results, preserve zero scores, and ignore pending/live scores', () => {
  const matches = [scored('a', 'b', 11, 0, 1), scored('a', 'c', 2, 11, 2),
    { ...scored('b', 'c', 100, 0, 3), status: 'ready' }];
  const rows = engine.getStandings(['a', 'b', 'c'], matches);
  assert.deepEqual(rows.map(row => row.entryId), ['c', 'a', 'b']);
  const a = rows.find(row => row.entryId === 'a');
  assert.equal(a.played, 2); assert.equal(a.wins, 1); assert.equal(a.losses, 1);
  assert.equal(a.pointsFor, 13); assert.equal(a.pointsAgainst, 11); assert.equal(a.pointDifferential, 2);
  assert.equal(a.standingPoints, 3);
});

test('a no-contest result resolves a match without awarding standings statistics', () => {
  let state = engine.createCompetition({
    id:'defaults', mode:'standard', entries:ids(2).map(id => ({ id })),
    divisions:[{ id:'open', entryIds:ids(2), format:'round-robin' }]
  });
  const match = stage(state).matches[0];
  state = engine.recordResult(state, match.id, { void:true, reason:'Both entries defaulted' });
  const resolved = stage(state);
  assert.equal(resolved.complete, true);
  assert.equal(resolved.matches[0].status, 'complete');
  assert.equal(resolved.matches[0].winnerId, null);
  assert.deepEqual(resolved.tables[0].rows.map(row => ({ played:row.played, wins:row.wins, losses:row.losses, pointsFor:row.pointsFor })), [
    { played:0, wins:0, losses:0, pointsFor:0 },
    { played:0, wins:0, losses:0, pointsFor:0 }
  ]);
});

test('an administrative null can count as played without awarding any result statistics', () => {
  let state = engine.createCompetition({
    id:'counted-defaults', mode:'standard', entries:ids(2).map(id => ({ id })),
    divisions:[{ id:'open', entryIds:ids(2), format:'round-robin' }]
  });
  const match = stage(state).matches[0];
  state = engine.recordResult(state, match.id, { void:true, countsAsPlayed:true, reason:'Both entries defaulted' });
  assert.deepEqual(stage(state).tables[0].rows.map(row => ({
    played:row.played, wins:row.wins, losses:row.losses, draws:row.draws,
    pointsFor:row.pointsFor, pointsAgainst:row.pointsAgainst, differential:row.pointDifferential
  })), [
    { played:1, wins:0, losses:0, draws:0, pointsFor:0, pointsAgainst:0, differential:0 },
    { played:1, wins:0, losses:0, draws:0, pointsFor:0, pointsAgainst:0, differential:0 }
  ]);
});

test('draws and standing points are opt-in, configurable, and forbidden in elimination', () => {
  let state = engine.createCompetition(definition(2, {
    standings: { allowDraws: true, order: ['standingPoints'], points: { win: 2, draw: 0.5, loss: -1 } }
  }));
  state = engine.recordResult(state, stage(state).matches[0].id, { a: 0, b: 0 });
  assert.equal(stage(state).matches[0].winnerId, null);
  assert.ok(stage(state).tables[0].rows.every(row => row.draws === 1 && row.standingPoints === 0.5 && row.tied));
  const bracket = engine.createCompetition(definition(2, { format: 'single-elimination', standings: { allowDraws: true } }));
  assert.throws(() => engine.recordResult(bracket, stage(bracket).matches[0].id, { a: 1, b: 1 }), /decisive/);
});

test('two-way head-to-head precedes overall differential when configured', () => {
  const matches = [scored('a', 'b', 11, 10, 1), scored('b', 'c', 11, 0, 2), scored('c', 'a', 11, 0, 3)];
  const rows = engine.getStandings(['a', 'b'], [matches[0]], { order: ['headToHead'] });
  assert.deepEqual(rows.map(row => row.entryId), ['a', 'b']);
  assert.equal(rows[0].tied, false);
});

test('three-way cyclic head-to-head uses a tied mini-table and deterministic fallback, not pairwise sorting', () => {
  const matches = [scored('a', 'b', 11, 10, 1), scored('b', 'c', 11, 10, 2), scored('c', 'a', 11, 10, 3)];
  for (const entries of [['a', 'b', 'c'], ['c', 'b', 'a'], ['b', 'a', 'c']]) {
    const rows = engine.getStandings(entries, matches);
    assert.deepEqual(rows.map(row => row.entryId), ['a', 'b', 'c']);
    assert.deepEqual(rows.map(row => row.rank), [1, 1, 1]);
    assert.ok(rows.every(row => row.tied));
  }
});

test('head-to-head mini-table uses only tied entries, skips incomplete tables, and honors criterion order', () => {
  const matches = [scored('a', 'b', 11, 9, 1), scored('a', 'c', 11, 9, 2), scored('a', 'd', 0, 11, 3),
    scored('b', 'c', 11, 0, 4), scored('b', 'd', 11, 0, 5), scored('c', 'd', 11, 0, 6)];
  assert.deepEqual(engine.getStandings(['a', 'b', 'c', 'd'], matches).map(row => row.entryId), ['a', 'b', 'c', 'd']);
  assert.deepEqual(engine.getStandings(['a', 'b', 'c', 'd'], matches, { order: ['wins', 'pointDifferential'] }).map(row => row.entryId), ['b', 'a', 'c', 'd']);
  const incomplete = engine.getStandings(['a', 'b', 'c'], [scored('b', 'a', 11, 0, 1)], { order: ['headToHead'] });
  assert.ok(incomplete.every(row => row.tied));
});

test('unresolved sporting ties never silently qualify by lexical ID; an explicit seed tiebreak can resolve them', () => {
  const config = { qualifiers: { count: 2 }, standings: { allowDraws: true } };
  const tied = finishPreliminary(engine.createCompetition(definition(3, config)), true);
  assert.ok(stage(tied).tables[0].rows.every(row => row.tied));
  assert.equal(stage(tied, 1).matches[0].status, 'pending');
  const resolved = finishPreliminary(engine.createCompetition(definition(3, {
    ...config, standings: { allowDraws: true, order: ['wins', 'seed'] }
  })), true);
  assert.deepEqual(stage(resolved, 1).matches[0].participants, { a: 'entry-01', b: 'entry-02' });
  const rows = engine.getStandings([{ id: 'a' }, { id: 'b' }], [], { order: ['seed'] });
  assert.ok(rows.every(row => row.tied));
});

test('wildcards stay unresolved if automatic qualification has a boundary tie', () => {
  const state = finishPreliminary(engine.createCompetition(definition(4, {
    format: 'pools', poolCount: 2, qualifiers: { perPool: 1, wildcards: 1 }, standings: { allowDraws: true }
  })), true);
  assert.ok(stage(state, 1).matches.every(match => match.status === 'pending'));
});

test('score correction invalidates affected descendants while retaining an unaffected branch', () => {
  let state = finishBracket(engine.createCompetition(definition(8, { format: 'single-elimination' })));
  const before = structuredClone(stage(state).matches);
  const first = before[0];
  state = engine.recordResult(state, first.id, { a: 0, b: 11 });
  const matches = stage(state).matches;
  assert.deepEqual(matches[1].result, before[1].result);
  assert.deepEqual(matches[5].result, before[5].result); // Unaffected semifinal.
  assert.equal(matches[4].result, null);
  assert.equal(matches[4].participants.a, 'entry-08');
  assert.equal(matches[6].result, null);
  assert.equal(matches[6].status, 'pending');
  assert.equal(stage(state).championId, null);
  const sameWinner = engine.recordResult(state, first.id, { a: 2, b: 11 });
  assert.deepEqual(stage(sameWinner).matches.slice(1), matches.slice(1));
});

test('clearing a prerequisite resets qualifier and downstream results without changing match IDs', () => {
  let state = finishBracket(finishPreliminary(engine.createCompetition(definition(4, { qualifiers: { count: 4 } }))));
  const previousIds = allMatches(state).map(match => match.id);
  state = engine.clearResult(state, stage(state).matches[0].id);
  assert.equal(stage(state).complete, false);
  assert.ok(stage(state, 1).matches.every(match => match.status === 'pending' && match.result === null));
  assert.deepEqual(allMatches(state).map(match => match.id), previousIds);
});

test('invalid scores, unknown matches, duplicate standings matches and malformed rules fail loudly', () => {
  const state = engine.createCompetition(definition(2));
  const matchId = stage(state).matches[0].id;
  for (const result of [{ a: -1, b: 0 }, { a: '11', b: 0 }, { a: Infinity, b: 0 }, { a: 1.5, b: 0 },
    { a: 0, b: 0 }, { a: NaN, b: 2 }, null, {}]) assert.throws(() => engine.recordResult(state, matchId, result));
  assert.throws(() => engine.recordResult(state, 'missing', { a: 11, b: 0 }), /Unknown match/);
  assert.throws(() => engine.getStandings(['a', 'b'], [scored('a', 'b', 11, 0, 1), scored('a', 'b', 11, 0, 1)]), /unique/);
  for (const order of [[], ['wins', 'wins'], ['unknown']]) assert.throws(() => engine.getStandings([], [], { order }));
  assert.throws(() => engine.getStandings([], [], { points: { win: NaN } }), /finite/);
  assert.throws(() => engine.generateBracket(['a', 'a']), /unique/);
  assert.throws(() => engine.generateBracket([{ type: 'bye' }]), /automatic/);
  assert.throws(() => engine.generateBracket([{ type: 'qualifier', stageId: 'stage', rank: 0 }]), /rank/);
});

test('every preliminary/playoff estimate equals completed real matches across small qualifier configurations', () => {
  for (let n = 2; n <= 9; n += 1) {
    const configurations = [];
    for (let count = 0; count <= n; count += 1) configurations.push({ qualifiers: { count } });
    for (let poolCount = 1; poolCount <= n; poolCount += 1) {
      for (let perPool = 0; perPool <= Math.floor(n / poolCount); perPool += 1) {
        configurations.push({ format: 'pools', poolCount, qualifiers: { perPool } });
      }
    }
    for (const config of configurations) {
      const state = finishBracket(finishPreliminary(engine.createCompetition(definition(n, config))));
      const estimate = state.divisions[0].estimate;
      assert.equal(allMatches(state).filter(match => match.status === 'complete').length, estimate.total);
      assert.ok(state.divisions[0].stages.every(stage => stage.complete));
      if (state.divisions[0].stages.length > 1) assert.equal(stage(state, 1).championId, 'entry-01');
    }
  }
});

test('a final preliminary score correction reseeds the playoff and discards the old final result', () => {
  let state = finishBracket(finishPreliminary(engine.createCompetition(definition(3, { qualifiers: { count: 2 } }))));
  const match = stage(state).matches.find(match => [match.participants.a, match.participants.b].sort().join() === 'entry-01,entry-02');
  state = engine.recordResult(state, match.id, {
    a: match.participants.a === 'entry-02' ? 11 : 0,
    b: match.participants.b === 'entry-02' ? 11 : 0
  });
  assert.equal(stage(state).complete, true);
  assert.deepEqual(stage(state, 1).matches[0].participants, { a: 'entry-02', b: 'entry-01' });
  assert.equal(stage(state, 1).matches[0].result, null);
  assert.equal(stage(state, 1).matches[0].status, 'ready');
  assert.equal(stage(state, 1).championId, null);
});

test('numeric tiebreak directions, explicit seed order, and shared rank gaps are correct', () => {
  const matches = [scored('a', 'b', 11, 3, 1), scored('a', 'c', 1, 11, 2)];
  assert.deepEqual(engine.getStandings(['a', 'b', 'c'], matches, { order: ['pointsAgainst'] }).map(row => row.entryId), ['c', 'b', 'a']);
  assert.deepEqual(engine.getStandings(['a', 'b', 'c'], matches, { order: ['pointsFor'] }).map(row => row.entryId), ['a', 'c', 'b']);
  assert.deepEqual(engine.getStandings(['a', 'b', 'c'], matches, { order: ['wins'] }).map(row => row.rank), [1, 1, 3]);
  const seeded = engine.getStandings([{ id: 'a', seed: 3 }, { id: 'b', seed: 1 }, { id: 'c' }], [], { order: ['seed'] });
  assert.deepEqual(seeded.map(row => row.entryId), ['b', 'a', 'c']);
  assert.ok(seeded.every(row => !row.tied));
});

test('wildcard-only qualification and ambiguous wildcard ranking do not duplicate or invent entrants', () => {
  const config = { format: 'pools', poolCount: 2, qualifiers: { perPool: 0, wildcards: 2 } };
  const ambiguous = finishPreliminary(engine.createCompetition(definition(4, config)));
  assert.equal(stage(ambiguous, 1).matches[0].status, 'pending');
  const state = finishPreliminary(engine.createCompetition(definition(4, {
    ...config, standings: { order: ['wins', 'seed'] }
  })));
  assert.deepEqual(stage(state, 1).matches[0].participants, { a: 'entry-01', b: 'entry-02' });
});

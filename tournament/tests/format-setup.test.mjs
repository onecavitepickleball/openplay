import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import * as setup from '../format-setup.js';

const engine = createRequire(import.meta.url)('../engine/standard-engine.js');
const birthday = () => setup.buildStandardDivision({ id:'birthday', name:'Birthday', category:'Open',
  format:'pools-elimination', expectedPairs:12, poolCount:4, qualifiersPerPool:1, bronzeMatch:true,
  scoring:{ mode:'timed-rally' } });
const scheduling = { startMinutes:1200, endMinutes:1320, matchMinutes:8, medalMinutes:10, slotMinutes:10, turnoverMinutes:2 };
const appSource = readFileSync(new URL('../standard-app.js', import.meta.url), 'utf8');
function appFunctions() {
  const context = { ...setup, URL };
  vm.createContext(context);
  vm.runInContext(appSource.replace(/^import .*?;\n/m, '').replaceAll('import.meta.url', JSON.stringify(import.meta.url))
    .replace('export function initializeStandardTournamentApp', 'function initializeStandardTournamentApp')
    .replace('export default initializeStandardTournamentApp;', ''), context);
  return context;
}
const config = () => ({ competitionType:'standard', firebaseEventId:'birthday-test', event:{ courts:2 },
  divisions:[birthday()], scoring:{ mode:'timed-rally' }, standardScheduling:scheduling });
const registrations = count => Array.from({ length:count }, (_, i) => ({ id:`pair-${i + 1}`, divisionId:'birthday', category:'Open', name:`Pair ${i + 1}` }));

test('birthday is four pools of three, two semifinals and bronze/gold: 16 matches', () => {
  const division = birthday();
  assert.deepEqual(division.qualifiers, { perPool:1, wildcards:0 });
  const estimate = engine.estimateMatches({ entryCount:12, ...setup.standardEngineFormat(division, 12), bronzeMatch:division.bronzeMatch });
  assert.deepEqual(estimate.poolSizes, [3, 3, 3, 3]);
  assert.equal(estimate.preliminary, 12);
  assert.equal(estimate.elimination, 4);
  assert.equal(estimate.total, 16);
});

test('saved plan survives empty and partial registrations; app definitions always validate', () => {
  const app = appFunctions();
  for (let count = 0; count <= 12; count++) {
    const built = app.buildDefinition(config(), registrations(count));
    const state = engine.createCompetition(built.definition);
    assert.equal(state.definition.entries.length, count);
    assert.equal(state.definition.divisions[0].setup.poolCount, 4);
    assert.equal(state.definition.divisions[0].setup.qualifiers.perPool, 1);
  }
});

test('birthday projects 8-minute preliminaries/semis, 10-minute medals and two-minute turnover', () => {
  const app = appFunctions(), cfg = config();
  const state = engine.createCompetition(app.buildDefinition(cfg, registrations(12)).definition);
  const matches = app.scheduleProjection(state, [], cfg, {});
  assert.equal(matches.length, 16);
  assert.equal(matches.filter(match => match.medal).length, 2);
  assert.equal(Math.max(...matches.map(match => match.startMinutes + match.durationMinutes)), 1282);
  assert.equal(matches.filter(match => !match.medal).every(match => match.durationMinutes === 10), true);
  assert.equal(matches.filter(match => match.medal).every(match => match.durationMinutes === 12), true);
  assert.equal(matches.every(match => match.scoring.mode === 'timed-rally'), true);
});

test('bounded input rejects fractions, overfull pools, bad advancement and unequal wildcards', () => {
  for (const invalid of [{ poolCount:13 }, { poolCount:2.5 }, { poolCount:0 }, { expectedPairs:129 },
    { qualifiersPerPool:4 }, { expectedPairs:11, qualifiers:{ perPool:1, wildcards:1 } }]) {
    assert.throws(() => setup.buildStandardDivision({ ...birthday(), ...invalid }));
  }
  assert.equal(setup.buildStandardDivision({ format:'pools-elimination', expectedPairs:12, qualifiers:4 }).poolCount, 2);
  assert.deepEqual(setup.buildStandardDivision({ format:'pools-elimination', expectedPairs:12, poolCount:4, qualifiers:4 }).qualifiers, { perPool:1, wildcards:0 });
});

test('birthday advances each pool winner, resolves both medals and retains results on rebuild', () => {
  const app = appFunctions(), cfg = config(), built = app.buildDefinition(cfg, registrations(12));
  let state = engine.createCompetition(built.definition);
  let recorded = 0;
  for (;;) {
    const ready = app.allEngineMatches(state).find(item => item.match.status === 'ready')?.match;
    if (!ready) break;
    const aWins = ready.participants.a < ready.participants.b;
    state = engine.recordResult(state, ready.id, {a:aWins ? 23 : 17,b:aWins ? 17 : 23});
    recorded++;
  }
  assert.equal(recorded, 16);
  const bracket = state.divisions[0].stages.find(stage => stage.type === 'single-elimination');
  assert.equal(bracket.entryCount, 4);
  assert.ok(bracket.matches.find(match => match.medal === 'gold').winnerId);
  assert.ok(bracket.matches.find(match => match.medal === 'bronze').winnerId);
  const restored = app.retainResults(engine, built.definition, state);
  assert.equal(app.allEngineMatches(restored).filter(item => item.match.result).length, 16);
});

test('timed scoring is uncapped, expires at the correct phase and needs a decisive result', () => {
  for (const [match, seconds] of [[{}, 480], [{stage:'elimination'}, 480], [{medal:'gold'}, 600], [{medal:'bronze'}, 600]]) {
    const rules = setup.standardScoringRules({ scoring:{mode:'timed-rally'}, scheduling, match });
    assert.equal(rules.timerSeconds, seconds);
    assert.equal(rules.hardCap, null);
    assert.equal(rules.teamTimeouts, false);
    assert.equal(rules.changeEndsAt, null);
    assert.equal(setup.validTimedRallyScore({a:30,b:29}, rules, seconds - 1), false);
    assert.equal(setup.validTimedRallyScore({a:30,b:29}, rules, seconds), true);
    assert.equal(setup.validTimedRallyScore({a:30,b:30}, rules, seconds), false);
    assert.equal(setup.validTimedRallyScore({a:-1,b:0}, rules, seconds), false);
  }
});

test('Sportsfest retains side-out, 11-point preliminary cap and untimed 15-point final cap', () => {
  const preliminary = setup.standardScoringRules({ scheduling:{ matchMinutes:18 } });
  const final = setup.standardScoringRules({ match:{medal:'gold'} });
  assert.equal(preliminary.scoring, 'side-out');
  assert.equal(preliminary.hardCap, 11);
  assert.equal(preliminary.timerSeconds, 1080);
  assert.equal(final.hardCap, 15);
  assert.equal(final.timer, false);
  const app = appFunctions();
  const saved = app.standardScheduling(config(), { standardScheduling:{...scheduling, matchMinutes:9} });
  assert.equal(saved.matchMinutes, 9);
  assert.equal(saved.medalMinutes, 10);
  assert.equal(saved.startMinutes, 1200);
  assert.equal(saved.endMinutes, 1320);
  assert.equal(saved.turnoverMinutes, 2);
});

test('format locks for a result, a called court or live scoring, not empty setup', () => {
  assert.equal(setup.hasStandardPlayStarted({}), false);
  for (const state of [{scores:{one:{a:1,b:0}}}, {courts:{1:{matchId:'one'}}}, {liveScoring:{one:{running:true}}},
    {standardState:{divisions:[{stages:[{matches:[{result:{a:1,b:0}}]}]}]}}]) assert.equal(setup.hasStandardPlayStarted(state), true);
});

test('active-view rendering does not rebuild hidden pages and navigation renders its target', () => {
  const names = ['Overview','Courts','Schedule','Standings','Entries','Bracket','Settings','Officials','Announcements','Archive','PublicShare'];
  const calls = [];
  const context = { state:{}, destroyed:false, activeView:'courts', ...Object.fromEntries(names.map(name => [`render${name}`, () => calls.push(name)])) };
  const source = appSource.slice(appSource.indexOf('  function renderAll()'), appSource.indexOf('  function bindScoreButtons()'));
  vm.runInNewContext(source, context);
  context.renderAll();
  assert.deepEqual(calls, ['Courts']);
  context.activeView = 'teams'; context.renderAll();
  assert.deepEqual(calls, ['Courts', 'Entries']);
  context.activeView = 'settings'; context.renderAll();
  assert.deepEqual(calls.slice(-2), ['Settings', 'PublicShare']);
  assert.match(appSource.slice(appSource.indexOf('  function showView('), appSource.indexOf('  function metrics(')), /renderAll\(\)/);
});

test('dirty settings preserve the DOM while a remote result locks format fields', () => {
  const fieldset = {}, context = { state:{scores:{one:{a:1,b:0}}}, settingsRendered:true, settingsDirty:true,
    hasStandardPlayStarted:setup.hasStandardPlayStarted, $$:() => [fieldset] };
  vm.runInNewContext(appSource.slice(appSource.indexOf('  function renderSettings()'), appSource.indexOf('  function renderStaffSettings()')), context);
  context.renderSettings();
  assert.equal(fieldset.disabled, true);
});

test('referee uses shared rules, no zero-cap scoring, no timed score-based end change', () => {
  const source = readFileSync(new URL('../referee/referee.js', import.meta.url), 'utf8');
  const context = { ...setup, state:{competitionType:'standard',standardScheduling:scheduling}, config:config(), elapsed:live => live.elapsed };
  vm.runInNewContext(source.slice(source.indexOf('  function matchRules('), source.indexOf('  function activeCourtFor(')), context);
  const rules = context.matchRules({divisionId:'birthday',medal:'bronze'});
  assert.equal(rules.timerSeconds, 600);
  assert.equal(context.validFinalScore({a:34,b:29,elapsed:599}, rules), false);
  assert.equal(context.validFinalScore({a:34,b:29,elapsed:600}, rules), true);
  assert.equal(context.endsChangeScore(rules), Infinity);
  assert.match(source, /maximum = rules.mode === 'timed-rally' \? Infinity/);
  context.state.competitionType = 'dual-meet'; context.config = {competitionType:'dual-meet'};
  assert.equal(context.matchRules({id:'legacy'}).mode, 'round-robin');
});

test('referee hydrates promoted timer records and settles a timed leader, but allows one rally for a tie', () => {
  const source = readFileSync(new URL('../referee/referee.js', import.meta.url), 'utf8');
  let saves = 0;
  const context = { state:{competitionType:'standard',liveScoring:{one:{elapsed:200,running:true,startedAt:123}}}, config:config(),
    elapsed:live => live.elapsed, addLog:()=>{}, save:()=>{ saves++; }, toast:()=>{} };
  vm.runInNewContext(source.slice(source.indexOf('  function defaultLive()'), source.indexOf('  function addLog(')), context);
  const live = context.liveFor({id:'one'});
  assert.equal(live.elapsed, 200);
  assert.equal(live.running, true);
  assert.equal(live.startedAt, 123);
  assert.equal(live.a, 0);
  assert.equal(live.timeouts.a, 0);
  vm.runInNewContext(source.slice(source.indexOf('  function settleTimedMatch('), source.indexOf('  function updateClock(')), context);
  const rules = setup.standardScoringRules({scoring:{mode:'timed-rally'},scheduling});
  const tied = {a:19,b:19,elapsed:480,running:true};
  assert.equal(context.settleTimedMatch(tied,rules), true);
  assert.equal(tied.running, true);
  assert.equal(context.settleTimedMatch(tied,rules), false);
  tied.a++;
  assert.equal(context.settleTimedMatch(tied,rules), true);
  assert.equal(tied.running, false);
  assert.equal(saves, 2);
});

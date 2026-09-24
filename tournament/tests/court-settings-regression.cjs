const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
function loadFunction(file, name, next, context) {
  const text = source(file);
  const start = text.indexOf(`function ${name}(`);
  const end = text.indexOf(`function ${next}(`, start);
  assert.ok(start >= 0 && end > start);
  vm.runInNewContext(text.slice(start, end), context);
  return context[name];
}

test('adding courts preserves the active match, results and queue', () => {
  const state = { courts:{ 1:{ matchId:'M1', running:true, elapsed:120 }, 2:{ matchId:'' } }, courtSchedules:{1:['M1'],2:['M2']}, scores:{M0:{a:11,b:4}}, queue:['M2'] };
  const nodes = { '#standardCourtSettings':{}, '#standardCourtCount':{value:'3'}, '#addStandardCourts':{} };
  let saved = 0;
  const context = { state, $:selector => nodes[selector] || {}, recordActivity:()=>{}, publishState:()=>saved++, renderAll:()=>{}, toast:()=>{} };
  const render = loadFunction('standard-app.js', 'renderCourtSettings', 'renderSettings', context);
  render();
  nodes['#addStandardCourts'].onclick();
  assert.equal(saved, 1);
  assert.equal(state.courtCount, 3);
  assert.equal(state.courts[3].matchId, '');
  assert.equal(state.courts[1].elapsed, 120);
  assert.equal(state.courts[1].running, true);
  assert.deepEqual(state.scores, {M0:{a:11,b:4}});
  assert.deepEqual(state.queue, ['M2']);
  assert.equal(state.courtSchedules[3].length, 0);
  render();
  for (const invalid of ['2', '3.5', '21', '']) {
    nodes['#standardCourtCount'].value = invalid;
    nodes['#addStandardCourts'].onclick();
  }
  assert.equal(saved, 1, 'invalid totals must not change the tournament');
});

test('projection keeps added courts after reload and retires old closure flags', () => {
  const matches = [{id:'M1',status:'ready',scheduleNumber:1,court:1}];
  const previous = {courtCount:3,courts:{1:{matchId:'M1',elapsed:120,running:true},2:{},3:{}},courtAvailability:{1:false,3:false}};
  const context = { standardScheduling:()=>({}), scheduleProjection:()=>matches, buildPairs:()=>({}), buildTeamStandings:()=>[] };
  const project = loadFunction('standard-app.js','projectState','elapsedSeconds',context);
  const result = project({}, previous, {event:{courts:2}}, []);
  assert.equal(Object.keys(result.courts).length, 3);
  assert.equal(result.courts[1].matchId, 'M1');
  assert.equal(result.courts[1].elapsed, 120);
  assert.ok(Object.values(result.courtAvailability).every(Boolean));
  const reset = project({}, {courtCount:3}, {event:{courts:2}}, []);
  assert.equal(Object.keys(reset.courts).length, 3);
});

test('a newly added court can receive the next referee match in sequence', () => {
  const state = {courts:{1:{matchId:'M1'},2:{matchId:'M2'},3:{matchId:''}},standardScheduling:{dispatchMode:'fixed-sequence'},queue:['M3','M4'],scores:{},matches:[{id:'M3',status:'ready',court:1},{id:'M4',status:'ready',court:2}]};
  const context = {state};
  const next = loadFunction('referee/referee.js','nextForCourt','eligibleCourtFor',context);
  assert.equal(next(3),'M3');
  assert.equal(next(1),'');
  assert.equal(next(4),'');
  state.standardScheduling.dispatchMode = 'pre-scheduled';
  assert.equal(next(3),'', 'pre-scheduled matches retain their existing assignments');
});

test('ordinary pending saves never show the synchronizing banner', () => {
  const banner = {hidden:false,classList:{remove(){}},querySelector:()=>({})};
  const context = {navigator:{onLine:true},pendingWrites:new Set(['pending']),window:{dispatchEvent(){}},CustomEvent:function(type,details){Object.assign(this,details);},document:{getElementById:()=>banner}};
  const emit = loadFunction('firebase-sync.js','emitSyncState','trackWrite',context);
  emit();
  assert.equal(banner.hidden,true);
  context.navigator.onLine = false;
  emit();
  assert.equal(banner.hidden,false);
  context.navigator.onLine = true;
  emit('Save failed');
  assert.equal(banner.hidden,false);
});

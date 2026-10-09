const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const root = join(__dirname, '..', '..');
const portal = readFileSync(join(root, 'tournament', 'portal.js'), 'utf8');
const rules = readFileSync(join(root, 'firestore.rules'), 'utf8');

function cardRenderer() {
  const start = portal.indexOf('function eventCard(');
  const end = portal.indexOf('function render()', start);
  const context = {
    LEGACY_ID:'ocpc-rally-rebels-dual-meet-2026',
    toolsFor:() => [],
    renderTool:() => '',
    canManageEvent:event => event.roles.includes('owner'),
    esc:value => String(value ?? '')
  };
  vm.runInNewContext(portal.slice(start, end), context);
  return context.eventCard;
}

test('only manageable archived tournaments show permanent deletion', () => {
  const render = cardRenderer();
  const owner = { id:'social-2026', name:'Social', roles:['owner'], status:'archived', archived:true, competitionType:'standard' };
  assert.match(render(owner), /data-delete-event="social-2026"/);
  assert.match(render(owner), /Delete permanently/);
  assert.doesNotMatch(render({ ...owner, status:'draft', archived:false }), /data-delete-event/);
  assert.doesNotMatch(render({ ...owner, roles:['tournament_referee'] }), /data-delete-event/);
  assert.doesNotMatch(render({ ...owner, id:'ocpc-rally-rebels-dual-meet-2026' }), /data-delete-event/);
});

test('deletion requires typed confirmation and cleans dependent records first', () => {
  const start = portal.indexOf('async function deleteArchivedEvent(');
  const end = portal.indexOf('async function renderPlatformAdmin(', start);
  const deletion = portal.slice(start, end);
  assert.match(deletion, /answer!==['"]DELETE['"]/);
  assert.match(deletion, /collection\(eventRef,'matches'\)/);
  assert.match(deletion, /collection\(eventRef,'registrations'\)/);
  assert.match(deletion, /collection\(eventRef,'checkins'\)/);
  assert.match(deletion, /tournamentAccess/);
  assert.match(deletion, /tournamentPublicViews/);
  assert.match(deletion, /tournamentRefereeBoards/);
  assert.ok(deletion.indexOf('await deleteRefs(cleanup)') < deletion.indexOf('await deleteDoc(eventRef)'));
  assert.ok(deletion.indexOf('await deleteDoc(eventRef)') < deletion.indexOf('await deleteDoc(currentMember.ref)'));
});

test('confirmed deletion removes every known event record and leaves the event document until last', async () => {
  const start = portal.indexOf('async function deleteRefs(');
  const end = portal.indexOf('async function renderPlatformAdmin(', start);
  const deleted = [];
  const ref = path => ({ path, id:path.split('/').at(-1) });
  const docs = paths => paths.map(path => ({ id:path.split('/').at(-1), ref:ref(path) }));
  const context = {
    LEGACY_ID:'ocpc-rally-rebels-dual-meet-2026',
    events:[{ id:'social-2026', name:'Social', status:'archived', archived:true }],
    user:{ uid:'owner' },
    prompt:() => 'DELETE',
    alert:message => assert.fail(message),
    render:() => {},
    doc:(base, ...parts) => ref(parts.length ? parts.join('/') : base.path),
    collection:(base, name) => ref(`${base.path}/${name}`),
    getDoc:async item => item.path === 'tournamentEvents/social-2026'
      ? { exists:() => true, data:() => ({ metadata:{ archived:true }, memberIds:['owner','staff'], state:{ publicShare:{ token:'public-token' } } }) }
      : { exists:() => true, ref:item },
    getDocs:async item => ({ docs:{
      'tournamentEvents/social-2026/members':docs(['tournamentEvents/social-2026/members/owner','tournamentEvents/social-2026/members/staff']),
      'tournamentEvents/social-2026/matches':docs(['tournamentEvents/social-2026/matches/m1']),
      'tournamentEvents/social-2026/registrations':docs(['tournamentEvents/social-2026/registrations/r1']),
      'tournamentEvents/social-2026/checkins':docs(['tournamentEvents/social-2026/checkins/c1'])
    }[item.path] || [] }),
    writeBatch:() => ({ delete:item => deleted.push(item.path), commit:async() => {} }),
    deleteDoc:async item => deleted.push(item.path),
    db:'db'
  };
  vm.runInNewContext(portal.slice(start, end), context);
  const button = { disabled:false, textContent:'Delete permanently' };
  await context.deleteArchivedEvent('social-2026', button);
  for (const path of [
    'tournamentEvents/social-2026/matches/m1',
    'tournamentEvents/social-2026/registrations/r1',
    'tournamentEvents/social-2026/checkins/c1',
    'tournamentEvents/social-2026/members/staff',
    'tournamentAccess/owner/events/social-2026',
    'tournamentAccess/staff/events/social-2026',
    'tournamentPublicViews/public-token',
    'tournamentRefereeBoards/social-2026'
  ]) assert.ok(deleted.includes(path), `missing ${path}`);
  assert.deepEqual(deleted.slice(-2), ['tournamentEvents/social-2026','tournamentEvents/social-2026/members/owner']);
  assert.equal(context.events.length, 0);
});

test('Firestore rules restrict event and referee-board deletion to archived tournaments', () => {
  assert.match(rules, /allow delete: if managesTournament\(eventId\) && \(resource\.data\.metadata\.archived == true \|\| resource\.data\.metadata\.status == 'archived'\);/);
  assert.match(rules, /match \/tournamentRefereeBoards\/\{eventId\}[\s\S]*allow delete: if managesTournament\(eventId\)[\s\S]*metadata\.archived == true/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const tournament = join(__dirname, '..');

test('creation markup always exposes both registration models', () => {
  const html = readFileSync(join(tournament, 'index.html'), 'utf8');
  assert.match(html, /id="newPairingMode"/);
  assert.match(html, /value="fixed-pairs"/);
  assert.match(html, /value="random-partners"/);
  assert.match(html, /draw fixed partners on event day/);
  assert.match(html, /One draw creates fixed pairs for the entire tournament/);
});

test('random-partner registrations become schedule entries only after lock', () => {
  const source = readFileSync(join(tournament, 'standard-app.js'), 'utf8');
  const start = source.indexOf('function randomPairRegistrations(');
  const end = source.indexOf('function buildDefinition(', start);
  const context = {
    clean: value => String(value ?? '').trim(),
    clone: value => structuredClone(value)
  };
  vm.runInNewContext(source.slice(start, end), context);

  const config = { pairing:{ mode:'random-partners' } };
  const registrations = [
    { id:'player-a', category:'Open', registrationUnit:'individual', players:[{ fullName:'Alex' }] },
    { id:'player-b', category:'Open', registrationUnit:'individual', players:[{ fullName:'Blair' }] }
  ];
  const assignments = { Open:[{ pairCode:'PAIR-1', registrationIds:['player-a', 'player-b'] }] };

  assert.equal(context.randomPairRegistrations(config, registrations, { status:'preview', assignments }).length, 0);
  const locked = context.randomPairRegistrations(config, registrations, { status:'locked', assignments });
  assert.equal(locked.length, 1);
  assert.equal(locked[0].pairCode, 'PAIR-1');
  assert.equal(locked[0].pairingStatus, 'locked');
  assert.deepEqual(Array.from(locked[0].pairingRegistrationIds), ['player-a', 'player-b']);
  assert.deepEqual(Array.from(locked[0].players, player => player.fullName), ['Alex', 'Blair']);
});

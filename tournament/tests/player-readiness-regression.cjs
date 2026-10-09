const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('registration fields start blank and preserve missing values', () => {
  const html = read('registration/index.html');
  const script = read('registration/registration.js');
  assert.match(html, /id="p1Shirt"><option value="" selected>Not set<\/option>/);
  assert.match(html, /id="p1Payment"><option value="" selected>Not set<\/option>/);
  assert.match(script, /player\.shirtSize \|\| ''/);
  assert.match(script, /player\.payment \|\| ''/);
  assert.doesNotMatch(script, /player\.payment \|\| 'pending'/);
});

test('birthday preset disables check-in while other tournaments remain opt-in', () => {
  const portal = read('portal.js');
  assert.match(portal, /id="newRequireCheckIn" checked/);
  assert.match(portal, /checkIn:\{required:\$\('#newRequireCheckIn'\)\?\.checked!==false\}/);
  assert.match(portal, /\$\('#newRequireCheckIn'\)\.checked=false/);
  assert.match(portal, /tool\.id==='checkin'&&event\.checkInRequired===false/);
});

test('optional check-in removes warnings and is saved to tournament access metadata', () => {
  const app = read('standard-app.js');
  const context = read('event-context.js');
  const sync = read('firebase-sync.js');
  assert.match(app, /if \(config\.checkIn\?\.required === false\) return '';/);
  assert.match(app, /Players can play without checking in/);
  assert.match(app, /dataset\.eventApp\.startsWith\('check-in\/'\)/);
  assert.match(context, /checkIn:\{required:true/);
  assert.match(sync, /checkInRequired:config\.checkIn\?\.required !== false/);
});

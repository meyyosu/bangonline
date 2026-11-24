'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Game } = require('../game');

function setup() {
  const g = new Game(['Alice', 'Bobby', 'Carol', 'David'], { rng: () => .4 });
  while (g.pending) g.timeout();
  for (const p of g.players) { p.char = 'Willy the Kid'; p.hp = p.maxHp = 4; }
  return g;
}

function give(g, p, name) {
  const piles = [g.deck, g.discard, ...g.players.map((q) => q.hand)];
  const pile = piles.find((cards) => cards.some((c) => c.name === name));
  const [card] = pile.splice(pile.findIndex((c) => c.name === name), 1);
  p.hand.push(card);
  return card;
}

test('turn cues stay private; Bang alternates clips and successful dodges are public', () => {
  const g = setup(), p = g.players[g.turn], target = g.players[g.nextAlive(g.turn)];
  assert.ok(g.viewFor(p.name).sounds.some((cue) => cue.files.includes('yourturn1')));
  for (const viewer of [target.name, null]) assert.ok(g.viewFor(viewer).sounds.every((cue) => !cue.files.includes('yourturn1')));
  for (const clip of ['bangsound1', 'bangsound2']) {
    const bang = give(g, p, 'Bang');
    g.act(p.name, { type: 'play', cardId: bang.id, target: target.name });
    assert.deepEqual(g.viewFor(null).sounds.at(-1).files, [clip]);
    const missed = give(g, target, 'Missed');
    g.act(target.name, { type: 'respond', cardId: missed.id });
    assert.deepEqual(g.viewFor(null).sounds.at(-1).files, ['missedsound1']);
  }
});

test('Store, Indians, Gatling and equipment publish main sound cues', () => {
  const g = setup(), p = g.players[g.turn];
  for (const [name, clip] of [['General Store', 'generalstore1'], ['Indians', 'indian1'], ['Gatling', 'gatling'], ['Mustang', 'mustang1'], ['Scope', 'equipment1']]) {
    const card = give(g, p, name);
    g.act(p.name, { type: 'play', cardId: card.id });
    assert.deepEqual(g.viewFor(null).sounds.at(-1).files, [clip]);
    while (g.pending) g.timeout();
  }
});

test('room sound delivery plays new cues once and skips old snapshots and other rooms', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const start = source.indexOf('function showRoomSounds(');
  const end = source.indexOf('// Ô trò chuyện thu gọn được', start);
  const played = [], c = { gameAudio: { play: (...files) => played.push(files) } };
  vm.createContext(c);
  vm.runInContext(source.slice(start, end), c);
  const before = { code: 'TEST', players: ['Alice'], game: { soundSeq: 4 } };
  const after = { code: 'TEST', players: ['Alice', 'Bobby'], game: { soundSeq: 5, sounds: [{ seq: 3, files: ['old'] }, { seq: 5, files: ['gatling'] }] } };
  c.showRoomSounds(after, null);
  c.showRoomSounds({ ...after, code: 'OTHER' }, before);
  assert.deepEqual(played, []);
  c.showRoomSounds(after, before);
  assert.deepEqual(played, [['playerjoin'], ['gatling']]);
  c.showRoomSounds(after, after);
  assert.equal(played.length, 2);
});

'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Game } = require('../game');
const { tickBots } = require('../room-bots');
const { pauseAction } = require('../room-pause');

for (const dodgeCity of [false, true]) test(`bots finish games, preserve cards and private views (Dodge City: ${dodgeCity})`, () => {
  for (let seed = 1; seed <= 30; seed++) {
    let state = seed;
    const rng = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
    const bots = Array.from({ length: 4 + seed % (dodgeCity ? 5 : 4) }, (_, i) => `Bot ${i + 1}`);
    const game = new Game(bots, { rng, characterChoices: 3, dodgeCity });
    const room = { game, bots, players: bots, status: 'playing', turnSeconds: 0, characterSeconds: 0, chat: [] };
    let moves = 0;
    for (let now = 0; !game.winner; now += 1000) {
      assert.ok(++moves < 20000, `stuck game ${seed}`);
      tickBots(room, now);
      const count = game.deck.length + game.discard.length
        + game.players.reduce((n, p) => n + p.hand.length + p.eq.length, 0)
        + (game.pending?.cards?.length || 0) + game.queue.reduce((n, q) => n + (q.cards?.length || 0), 0);
      assert.equal(count, dodgeCity ? 114 : 80);
      assert.ok(game.viewFor(null).players.every((p) => !('hand' in p)));
    }
  }
});

test('bots accept pauses, remain frozen, and never play a human turn', () => {
  const players = ['Human', 'Bot 1', 'Bot 2', 'Bot 3'];
  const game = new Game(players, { characterChoices: 3 });
  const room = { game, players, bots: players.slice(1), status: 'playing', chat: [] };
  const pending = game.pending;
  pending.player = game.idx('Human');
  assert.equal(tickBots(room, 0), false);
  assert.equal(tickBots(room, 10000), false);
  assert.equal(game.pending, pending);
  pauseAction(room, 'Human', { type: 'request' }, 10000);
  assert.equal(tickBots(room, 10250), true);
  assert.equal(room.pause.phase, 'paused');
  assert.equal(tickBots(room, 12000), false);
  assert.equal(game.pending, pending);
});

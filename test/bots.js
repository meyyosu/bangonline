'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Game } = require('../game');
const { tickBots } = require('../room-bots');
const { pauseAction } = require('../room-pause');

for (const [dodgeCity, valleyOfShadow] of [[false, false], [true, false], [false, true], [true, true]]) test(`25 bot games conserve cards and finish (Dodge City: ${dodgeCity}, Valley of Shadow: ${valleyOfShadow})`, () => {
  for (let seed = 1; seed <= 25; seed++) {
    let state = seed;
    const rng = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
    const bots = Array.from({ length: 4 + seed % (dodgeCity ? 5 : 4) }, (_, i) => `Bot ${i + 1}`);
    const game = new Game(bots, { rng, characterChoices: 3, dodgeCity, valleyOfShadow });
    const room = { game, bots, players: bots, status: 'playing', turnSeconds: 0, characterSeconds: 0, chat: [] };
    let moves = 0;
    for (let now = 0; !game.winner; now += 2000) {
      assert.ok(++moves < 20000, `stuck game ${seed}`);
      tickBots(room, now);
      const count = game.deck.length + game.discard.length
        + game.players.reduce((n, p) => n + p.hand.length + p.eq.length, 0)
        + (game.pending?.cards?.length || 0) + game.queue.reduce((n, q) => n + (q.cards?.length || 0), 0);
      assert.equal(count, game.fullDeck.length);
      assert.ok(game.viewFor(null).players.every((p) => !('hand' in p)));
    }
  }
});

function targetingGame(roles, options) {
  const names = roles.map((_, i) => `Player ${i + 1}`);
  const game = new Game(names, { valleyOfShadow: true, rng: () => 0.4, ...options });
  for (const [i, player] of game.players.entries()) {
    player.role = roles[i];
    player.char = 'Willy the Kid';
    game.toDiscard(...player.hand);
    player.hand = [];
  }
  game.turn = 0;
  game.phase = 'play';
  game.pending = null;
  game.bangsPlayed = 0;
  const room = { game, status: 'playing', bots: [game.players[game.turn].name], botNextAt: 0 };
  return { game, room };
}

function deal(game, player, name) {
  const pile = [game.deck, game.discard].find((cards) => cards.some((c) => c.name === name));
  assert.ok(pile, `Missing ${name}`);
  const [card] = pile.splice(pile.findIndex((c) => c.name === name), 1);
  player.hand.push(card);
  return card;
}

function revive(game, player, target) {
  game.kill(game.idx(target.name), null);
  const card = deal(game, player, 'Ghost');
  game.act(player.name, { type: 'play', cardId: card.id, target: target.name });
  return card;
}

test('a bot shoots a living target even when it could reach a Ghost first', () => {
  const { game, room } = targetingGame(['Sheriff', 'Outlaw', 'Renegade', 'Outlaw']);
  const [bot, ghost, , other] = game.players;
  revive(game, bot, ghost);
  deal(game, bot, 'Bang');
  assert.equal(tickBots(room, 0), true);
  assert.equal(game.pending.type, 'bang');
  assert.equal(game.players[game.pending.player], other);
});

test('a bot using Fanning prefers a living secondary target over Ghost', () => {
  const { game, room } = targetingGame(['Sheriff', 'Outlaw', 'Outlaw', 'Renegade', 'Deputy']);
  const [bot, first, ghost, second] = game.players;
  first.char = 'Rose Doolan';
  revive(game, bot, ghost);
  deal(game, bot, 'Fanning');
  assert.equal(tickBots(room, 0), true);
  assert.equal(game.players[game.pending.player], first);
  game.act(first.name, { type: 'take' });
  assert.equal(game.players[game.pending.player], second);
});

test('a Renegade attacks the third player and waits for the final duel to attack Sheriff', () => {
  const { game, room } = targetingGame(['Renegade', 'Sheriff', 'Outlaw', 'Outlaw']);
  const [bot, sheriff, other] = game.players;
  game.kill(3, null);
  other.hp = 1;
  const fanning = deal(game, bot, 'Fanning');
  const gatling = deal(game, bot, 'Gatling');
  deal(game, bot, 'Bang');
  assert.equal(tickBots(room, 0), true);
  assert.equal(game.pending.type, 'bang');
  assert.equal(game.players[game.pending.player], other);
  assert.ok(bot.hand.includes(fanning) && bot.hand.includes(gatling));
  game.act(other.name, { type: 'take' });
  assert.equal(tickBots(room, 2000), true);
  assert.equal(game.pending.type, 'bang');
  assert.equal(game.players[game.pending.player], sheriff);
});

test('a Renegade holds the shot when only Sheriff is in range with three players left', () => {
  const { game, room } = targetingGame(['Renegade', 'Sheriff', 'Outlaw', 'Outlaw']);
  const [bot, , other] = game.players;
  game.kill(3, null);
  other.char = 'Paul Regret';
  const bang = deal(game, bot, 'Bang');
  assert.equal(tickBots(room, 0), true);
  assert.ok(bot.hand.includes(bang));
  assert.equal(game.combatEffects.length, 0);
  assert.notEqual(game.turn, 0);
});

test('a Renegade removes the third player’s Ghost equipment before shooting Sheriff', () => {
  const { game, room } = targetingGame(['Renegade', 'Sheriff', 'Outlaw', 'Outlaw']);
  const [bot, sheriff, third] = game.players;
  game.kill(3, null);
  const ghost = revive(game, bot, third);
  deal(game, third, 'Missed');
  const bang = deal(game, bot, 'Bang');
  deal(game, bot, 'Cat Balou');
  assert.equal(tickBots(room, 0), true);
  assert.equal(third.alive, false);
  assert.ok(game.discard.includes(ghost));
  assert.ok(bot.hand.includes(bang));
  assert.equal(tickBots(room, 2000), true);
  assert.equal(game.pending.type, 'bang');
  assert.equal(game.players[game.pending.player], sheriff);
});

test('bots hold a lone Missed! against Slab unless a Barrel check supplies the other dodge', () => {
  for (const suit of [null, 'S', 'H']) {
    const { game, room } = targetingGame(['Outlaw', 'Sheriff', 'Renegade', 'Outlaw']);
    const [slab, bot] = game.players;
    room.bots = [bot.name];
    slab.char = 'Slab the Killer';
    const missed = deal(game, bot, 'Missed');
    if (suit) {
      const barrel = deal(game, bot, 'Barrel');
      bot.eq.push(game.takeFromHand(bot, barrel.id));
      game.deck.push(...game.deck.splice(game.deck.findIndex((card) => card.suit === suit), 1));
    }
    const hp = bot.hp;
    const bang = deal(game, slab, 'Bang');
    game.act(slab.name, { type: 'play', cardId: bang.id, target: bot.name });
    assert.equal(game.pending.need, 2);
    assert.equal(tickBots(room, 0), true);
    if (suit) {
      assert.equal(game.pending.kind, 'Barrel');
      assert.equal(tickBots(room, 2000), true);
      assert.equal(tickBots(room, 4000), true);
    }
    assert.equal(game.pending, null);
    assert.equal(bot.hand.includes(missed), suit !== 'H');
    assert.equal(bot.hp, suit === 'H' ? hp : hp - 1);
  }
});

test('a bot can spend two dodges to avoid Slab’s Bang!', () => {
  const { game, room } = targetingGame(['Outlaw', 'Sheriff', 'Renegade', 'Outlaw']);
  const [slab, bot] = game.players;
  room.bots = [bot.name];
  slab.char = 'Slab the Killer';
  const bang = deal(game, slab, 'Bang');
  const misses = [deal(game, bot, 'Missed'), deal(game, bot, 'Missed')];
  const hp = bot.hp;
  game.act(slab.name, { type: 'play', cardId: bang.id, target: bot.name });
  assert.equal(tickBots(room, 0), true);
  assert.equal(game.pending.got, 1);
  assert.equal(tickBots(room, 2000), true);
  assert.equal(game.pending, null);
  assert.equal(bot.hp, hp);
  assert.ok(misses.every((card) => game.discard.includes(card)));
});

test('a Sheriff at one life plays Saloon before a shot', () => {
  const { game, room } = targetingGame(['Sheriff', 'Outlaw', 'Renegade', 'Outlaw']);
  const bot = game.players[0];
  bot.hp = 1;
  const bang = deal(game, bot, 'Bang');
  const saloon = deal(game, bot, 'Saloon');
  assert.equal(tickBots(room, 0), true);
  assert.equal(bot.hp, 2);
  assert.ok(bot.hand.includes(bang));
  assert.ok(game.discard.includes(saloon));
});

test('a Sheriff at one life discards an attack card before a dodge', () => {
  const { game, room } = targetingGame(['Sheriff', 'Outlaw', 'Renegade', 'Outlaw']);
  const [bot, ...others] = game.players;
  for (const other of others) other.char = 'Paul Regret';
  bot.hp = 1;
  const missed = deal(game, bot, 'Missed');
  const bang = deal(game, bot, 'Bang');
  assert.equal(tickBots(room, 0), true);
  assert.deepEqual(bot.hand, [missed]);
  assert.ok(game.discard.includes(bang));
});

test('a Sheriff at one life pays for Springfield with a spare attack card', () => {
  const { game, room } = targetingGame(['Sheriff', 'Outlaw', 'Renegade', 'Outlaw'], { dodgeCity: true });
  const bot = game.players[0];
  bot.hp = 1;
  deal(game, bot, 'Springfield');
  const missed = deal(game, bot, 'Missed');
  const bang = deal(game, bot, 'Bang');
  assert.equal(tickBots(room, 0), true);
  assert.equal(game.pending.type, 'bang');
  assert.deepEqual(bot.hand, [missed]);
  assert.ok(game.discard.includes(bang));
});

test('bots wait two seconds between gameplay actions unless Faster Bots is enabled', () => {
  for (const fasterBots of [false, true]) {
    const { game, room } = targetingGame(['Renegade', 'Sheriff', 'Outlaw', 'Outlaw']);
    const bot = game.players[0];
    room.fasterBots = fasterBots;
    room.botNextAt = null;
    bot.hp = 1;
    const misses = [deal(game, bot, 'Missed'), deal(game, bot, 'Missed')];
    const delay = 2000;
    const first = fasterBots ? 0 : delay;
    if (!fasterBots) {
      assert.equal(tickBots(room, 0), false);
      assert.equal(tickBots(room, first - 1), false);
      assert.deepEqual(bot.hand, misses);
    }
    assert.equal(tickBots(room, first), true);
    assert.equal(bot.hand.length, 1);
    assert.equal(game.turn, 0);
    if (!fasterBots) assert.equal(tickBots(room, first + delay - 1), false);
    assert.equal(tickBots(room, first + (fasterBots ? 250 : delay)), true);
    assert.notEqual(game.turn, 0);
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

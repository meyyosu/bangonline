'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const { Game, CARD_INFO, CHAR_INFO } = require('../game');

const names = ['Alice', 'Bobby', 'Carol', 'David', 'Elena', 'Frank'];

function setup() {
  const game = new Game(names, { dodgeCity: true, valleyOfShadow: true, rng: () => 0.4 });
  for (const p of game.players) {
    p.char = 'Kit Carlson';
    game.toDiscard(...p.hand);
    p.hand = [];
  }
  const actor = game.players[game.turn];
  const target = game.players[game.nextAlive(game.turn)];
  game.pending = null;
  game.phase = 'play';
  return { game, actor, target };
}

function deal(game, player, name, suit) {
  const match = (c) => c.name === name && (!suit || c.suit === suit);
  const pile = [game.deck, game.discard].find((cards) => cards.some(match));
  assert.ok(pile, `Missing ${name}`);
  const [card] = pile.splice(pile.findIndex(match), 1);
  player.hand.push(card);
  return card;
}

function play(game, player, name, target, opts) {
  const card = deal(game, player, name);
  game.act(player.name, { type: 'play', cardId: card.id, target: target?.name, ...opts });
  return card;
}

function advanceTo(game, p) {
  for (let k = 0; game.turn !== game.idx(p.name) && k < 50; k++) game.timeout();
  assert.equal(game.turn, game.idx(p.name));
}

function drawCheck(game, p, suit) {
  const index = game.deck.findIndex((c) => c.suit === suit);
  assert.notEqual(index, -1);
  game.deck.push(...game.deck.splice(index, 1));
  game.act(p.name, { type: 'checkDraw' });
}

function assertConservation(game) {
  const cards = [...game.deck, ...game.discard, ...game.players.flatMap((p) => [...p.hand, ...p.eq]), ...(game.pending?.cards || [])];
  assert.equal(cards.length, game.fullDeck.length);
  assert.equal(new Set(cards.map((c) => c.id)).size, cards.length);
}

test('Valley appends all 16 ranked copies and gates the eight characters by room setting', () => {
  const base = new Game(names, { characterChoices: 3 });
  const valley = new Game(names, { valleyOfShadow: true, characterChoices: 3 });
  const both = new Game(names, { dodgeCity: true, valleyOfShadow: true, characterChoices: 3 });
  assert.deepEqual(valley.fullDeck.slice(0, 80), base.fullDeck);
  assert.deepEqual(valley.fullDeck.slice(80).map(({ name, rank, suit }) => `${name} ${rank}${suit}`), [
    'Bounty 9C', 'Ghost 9S', 'Ghost 10S', 'LeMat 4D', 'Rattlesnake 7H', 'Shotgun KS', 'Aim 6C',
    'Backfire QC', 'Bandidos QD', 'Escape 3H', 'Fanning 2S', 'Last Call 8D', 'Poker JH', 'Saved! 5H', 'Tomahawk AD', 'Tornado AC',
  ]);
  assert.equal(both.fullDeck.length, 130);
  assert.equal(base.characterPool.length, 16);
  assert.equal(valley.characterPool.length, 24);
  assert.equal(both.characterPool.length, 39);
  assert.equal(CHAR_INFO['Tuco Franziskaner'].hp, 5);
  assert.equal(CARD_INFO.Bible.type, 'green');
});

test('Ghost can equip a gun plus blue and green cards and clears them at end of turn', () => {
  const { game, actor, target } = setup();
  const ti = game.idx(target.name);
  game.kill(ti, null);
  target.char = 'Black Flower';
  const ghost = play(game, actor, 'Ghost', target);
  assert.equal(game.viewFor(actor.name).players[ti].ghost, true);
  assert.equal(target.hp, 0);
  advanceTo(game, target);
  game.timeout();
  const gear = ['LeMat', 'Barrel', 'Bible'].map((name) => play(game, target, name));
  assert.equal(game.hasLeMat(target), true);
  assert.ok(target.coolingGreen.has(gear[2].id));
  const beer = deal(game, target, 'Beer');
  assert.throws(() => game.act(target.name, { type: 'play', cardId: beer.id }), /không thể hồi máu/);
  game.damage(ti, 3, game.idx(actor.name));
  assert.equal(target.hp, 0);
  assert.equal(target.alive, true);
  game.act(target.name, { type: 'endTurn' });
  assert.deepEqual(target.eq, [ghost]);
  assert.equal(target.hand.length, 0);
  assert.equal(target.coolingGreen.size, 0);
  assert.ok(gear.every((c) => game.discard.includes(c)));
  assertConservation(game);
});

test('Ghost can be jailed, loses the turn on failure and exits when its card is removed', () => {
  const { game, actor, target } = setup();
  const ti = game.idx(target.name);
  game.kill(ti, null);
  const ghost = play(game, actor, 'Ghost', target);
  const jail = play(game, actor, 'Jail', target);
  const held = deal(game, target, 'Beer');
  advanceTo(game, target);
  assert.equal(game.pending.kind, 'Jail');
  drawCheck(game, target, 'S');
  assert.notEqual(game.turn, ti);
  assert.equal(target.alive, true);
  assert.deepEqual(target.eq, [ghost]);
  assert.equal(target.jailed, 0);
  assert.ok(game.discard.includes(jail) && game.discard.includes(held));
  advanceTo(game, actor);
  game.pending = null;
  game.phase = 'play';
  const kills = game.stats[game.turn].kills;
  play(game, actor, 'Cat Balou', target, { targetCard: ghost.id });
  assert.equal(target.alive, false);
  assert.equal(game.stats[game.turn].kills, kills);
  assert.ok(game.discard.includes(ghost));
  game.forfeit(target.name);
  assert.equal(game.viewFor(actor.name).players[ti].revivable, false);
  const secondGhost = deal(game, actor, 'Ghost');
  assert.throws(() => game.act(actor.name, { type: 'play', cardId: secondGhost.id, target: target.name }), /còn ở trong phòng/);
  assertConservation(game);
});

test('Saved! played by a third player ends the Bang response immediately and logs the rescue', () => {
  const { game, actor, target } = setup();
  const saver = game.players.find((p) => p !== actor && p !== target);
  const saved = deal(game, saver, 'Saved!');
  const missed = deal(game, target, 'Missed');
  const hp = target.hp;
  play(game, actor, 'Bang', target);
  assert.equal(game.viewFor(actor.name).pending.savedReaction, undefined);
  const view = game.viewFor(saver.name);
  assert.deepEqual(view.pending.savedReaction, { target: game.idx(target.name) });
  const source = readFileSync(join(__dirname, '../public/app.js'), 'utf8');
  const render = source.slice(source.indexOf('function actionsHTML('), source.indexOf('function winnerHTML('));
  const controls = vm.runInNewContext(`${render}\nactionsHTML(view, player, false)`, {
    view, player: view.players[view.me.index], esc: (text) => text, abilityOf: (p) => p.ability,
  });
  assert.match(controls, new RegExp(`data-act="saved" data-card-id="${saved.id}" data-from="deck" data-owner="${target.name}"`));
  game.act(saver.name, { type: 'saved', cardId: saved.id, target: target.name, from: 'deck' });
  assert.equal(game.pending, null);
  assert.equal(target.hp, hp);
  assert.deepEqual(target.hand, [missed]);
  assert.equal(saver.hand.length, 2);
  assert.ok(game.discard.includes(saved));
  const message = `${saver.name} vừa cứu ${target.name} khỏi một pha đấu súng!`;
  assert.ok(game.log.includes(message));
  assert.ok(game.timeline.at(-1).log.includes(message));
  assert.throws(() => game.act(target.name, { type: 'respond', cardId: missed.id }), /Chưa đến lượt/);
  assertConservation(game);
});

test('Saved! can interrupt the Barrel check and Aim still deals one remaining damage', () => {
  const { game, actor, target } = setup();
  const saver = game.players.find((p) => p !== actor && p !== target);
  const saved = deal(game, saver, 'Saved!');
  const barrel = deal(game, target, 'Barrel');
  target.eq.push(game.takeFromHand(target, barrel.id));
  const bang = deal(game, actor, 'Bang');
  const hp = target.hp;
  play(game, actor, 'Aim', target, { bangCardId: bang.id });
  assert.equal(game.pending.need, 1);
  game.act(target.name, { type: 'barrel' });
  assert.equal(game.pending.kind, 'Barrel');
  game.act(saver.name, { type: 'saved', cardId: saved.id, target: target.name, from: 'deck' });
  assert.equal(game.pending, null);
  assert.equal(game.lastCheck, undefined);
  assert.equal(target.hp, hp - 1);
  assert.equal(saver.hand.length, 2);
  assertConservation(game);
});

test('Rattlesnake follows Jail and remains on the board after a failed check', () => {
  const { game, actor, target } = setup();
  const snake = play(game, actor, 'Rattlesnake', target);
  assert.deepEqual(game.viewFor(null).sounds.at(-1).files, ['rattlesnake']);
  play(game, actor, 'Jail', target);
  advanceTo(game, target);
  assert.equal(game.pending.kind, 'Jail');
  drawCheck(game, target, 'H');
  assert.equal(game.pending.kind, 'Rattlesnake');
  const hp = target.hp;
  drawCheck(game, target, 'S');
  assert.equal(target.hp, hp - 1);
  assert.deepEqual(game.viewFor(null).sounds.at(-1).files, ['rattlesnake_hurt']);
  assert.equal(game.pending.type, 'draw');
  assert.deepEqual(target.eq, [snake]);
  assertConservation(game);
});

test('a safe Rattlesnake check or a successful Saved! does not play the bite sound', () => {
  for (const suit of ['H', 'S']) {
    const { game, actor, target } = setup();
    play(game, actor, 'Rattlesnake', target);
    const saver = game.players.find((p) => p !== actor && p !== target);
    const saved = suit === 'S' ? deal(game, saver, 'Saved!') : null;
    advanceTo(game, target);
    const hp = target.hp;
    drawCheck(game, target, suit);
    if (saved) {
      assert.equal(game.pending.type, 'saved');
      game.act(saver.name, { type: 'saved', cardId: saved.id, from: 'deck' });
    }
    assert.equal(target.hp, hp);
    assert.ok(!game.viewFor(null).sounds.some((cue) => cue.files.includes('rattlesnake_hurt')));
    assertConservation(game);
  }
});

test('LeMat conversions count as Bang and a Shotgun hit collects Bounty and forces a chosen discard', () => {
  const { game, actor, target } = setup();
  const targetCard = deal(game, target, 'Beer');
  play(game, actor, 'LeMat');
  play(game, actor, 'Missed', target, { asBang: true });
  assert.deepEqual(game.viewFor(null).sounds.at(-1).files, ['bangsound_lemat']);
  assert.equal(game.bangsPlayed, 1);
  assert.equal(game.pending.trueBang, true);
  game.act(target.name, { type: 'take' });
  game.bangsPlayed = 0;
  play(game, actor, 'Shotgun');
  play(game, actor, 'Bounty', target);
  assert.deepEqual(game.viewFor(null).sounds.at(-1).files, ['bounty']);
  assert.ok(!game.viewFor(null).sounds.some((cue) => cue.files.includes('bounty_earned')));
  play(game, actor, 'Bang', target);
  assert.deepEqual(game.viewFor(null).sounds.at(-1).files, ['bangsound_shotgun']);
  const before = actor.hand.length;
  game.act(target.name, { type: 'take' });
  assert.equal(actor.hand.length, before + 1);
  assert.deepEqual(game.viewFor(null).sounds.at(-1).files, ['bounty_earned']);
  assert.equal(game.pending.name, 'Shotgun');
  game.act(target.name, { type: 'valleyDiscard', cardIds: [targetCard.id] });
  assert.equal(target.hand.length, 0);
  assertConservation(game);
});

test('Fanning still attacks the second target after Escape and Backfire retaliates once', () => {
  const { game, actor, target } = setup();
  const [secondIndex] = game.fanningTargets(game.turn, game.idx(target.name));
  const second = game.players[secondIndex];
  const escape = deal(game, target, 'Escape');
  const backfire = deal(game, second, 'Backfire');
  play(game, actor, 'Fanning', target, { secondTarget: second.name });
  assert.deepEqual(game.viewFor(null).sounds.at(-1).files, ['fanning']);
  game.act(target.name, { type: 'escape', cardId: escape.id });
  assert.deepEqual(game.viewFor(null).sounds.at(-1).files, ['escape']);
  assert.equal(game.pending.player, secondIndex);
  game.act(second.name, { type: 'respond', cardId: backfire.id });
  assert.deepEqual(game.viewFor(null).sounds.at(-1).files, ['backfired']);
  assert.equal(game.pending.player, game.turn);
  assert.equal(game.pending.source, secondIndex);
  game.act(actor.name, { type: 'take' });
  assert.equal(game.pending, null);
  assert.equal(game.bangsPlayed, 1);
  assertConservation(game);
});

test('the Escape-only response hides the responder from other players and spectators', () => {
  const { game, actor, target } = setup();
  const escape = deal(game, target, 'Escape');
  play(game, actor, 'Cat Balou', target, { targetCard: 'hand' });
  assert.equal(game.pending.type, 'avoid');
  for (const viewer of [null, ...names.filter((name) => name !== target.name)]) {
    assert.deepEqual(game.viewFor(viewer).pending, { type: 'avoid', player: null });
  }
  const view = game.viewFor(target.name);
  assert.equal(view.pending.player, view.me.index);
  assert.equal(view.pending.name, 'Cat Balou');
  assert.deepEqual(view.pending.escapeIds, [escape.id]);
  game.act(target.name, { type: 'escape', cardId: escape.id });
  assert.ok(game.discard.includes(escape));
  assert.equal(game.pending, null);
  assertConservation(game);
});

test('the Bandidos caster can select the required cards from their hand and discard without losing health', async () => {
  const source = readFileSync(join(__dirname, '../public/app.js'), 'utf8');
  const client = source.slice(source.indexOf('function isClickable('), source.indexOf('function actionsHTML('))
    + source.slice(source.indexOf('function bindGame('), source.indexOf('function chooseTargetCard('));
  for (const count of [2, 1]) {
    const { game, actor, target } = setup();
    const hand = Array.from({ length: count }, () => deal(game, actor, 'Missed'));
    const picks = hand.map((card) => ({ dataset: { card: String(card.id) } }));
    const confirm = { dataset: { act: 'valleyDiscard' } };
    const main = {
      querySelector: () => null,
      querySelectorAll: (selector) => selector === '#hand .card' ? picks : selector === '[data-act]' ? [confirm] : [],
    };
    const hp = actor.hp;
    play(game, actor, 'Bandidos');
    assert.deepEqual(game.viewFor(null).sounds.at(-1).files, ['bandidos']);
    const view = game.viewFor(actor.name);
    assert.equal(view.pending.player, view.me.index);
    assert.equal(view.pending.count, count);
    const context = vm.createContext({
      view, $: (id) => id === '#mainArea' ? main : null, esc: (value) => value, run: (fn) => fn,
      ui: { mode: { kind: 'valleyDiscard' }, selected: [] }, renderGame() {},
      sendAction: (action) => game.act(actor.name, action),
      toast: (message) => assert.fail(message),
    });
    vm.runInContext(`${client}\nbindGame(view, view.me.index, view.players[view.me.index], false, true)`, context);
    const prompt = () => vm.runInContext('promptHTML(view, view.me.index, view.players[view.me.index])', context);
    assert.match(prompt(), /data-act="valleyDiscard" disabled/);
    for (const card of picks) await card.onclick();
    assert.match(prompt(), new RegExp(`Đã chọn ${count}/${count}`));
    assert.doesNotMatch(prompt(), /data-act="valleyDiscard" disabled/);
    await confirm.onclick();
    assert.equal(actor.hp, hp);
    assert.equal(actor.hand.length, 0);
    assert.ok(hand.every((card) => game.discard.includes(card)));
    assert.equal(game.pending.player, game.idx(target.name));
    assertConservation(game);
  }
});

test('Poker keeps discards hidden until everyone chooses and then lets the caster take two', () => {
  const { game, actor, target } = setup();
  const other = game.players[game.nextAlive(game.idx(target.name))];
  const beer = deal(game, target, 'Beer');
  const missed = deal(game, other, 'Missed');
  play(game, actor, 'Poker');
  assert.deepEqual(game.viewFor(null).sounds.at(-1).files, ['poker']);
  game.act(target.name, { type: 'valleyDiscard', cardIds: [beer.id] });
  assert.equal(game.viewFor(other.name).discardTop.name, 'Poker');
  assert.ok(!game.viewFor(other.name).plays.some((event) => event.card.id === beer.id));
  game.act(other.name, { type: 'valleyDiscard', cardIds: [missed.id] });
  assert.deepEqual(game.viewFor(actor.name).pending.cards, [beer, missed]);
  const before = game.soundSeq;
  game.act(actor.name, { type: 'poker', cardIds: [beer.id, missed.id] });
  assert.deepEqual(actor.hand, [beer, missed]);
  assert.deepEqual(game.viewFor(actor.name).sounds.filter((cue) => cue.seq > before).flatMap((cue) => cue.files), ['drawcard']);
  assertConservation(game);
});

test('Henry Block responds before a card leaves his table, including a Ghost anchor', () => {
  const { game, actor, target } = setup();
  game.kill(game.idx(target.name), null);
  target.char = 'Henry Block';
  const ghost = play(game, actor, 'Ghost', target);
  play(game, actor, 'Cat Balou', target, { targetCard: ghost.id });
  assert.deepEqual(target.eq, [ghost]);
  assert.equal(game.pending.source, game.idx(target.name));
  assert.equal(game.pending.player, game.turn);
  game.act(actor.name, { type: 'take' });
  assert.equal(target.alive, false);
  assert.ok(game.discard.includes(ghost));
  assertConservation(game);
});

function evelynGame() {
  const { game, actor, target } = setup();
  actor.char = 'Evelyn Shebang';
  target.hp = 4;
  game.beginDraw();
  return { game, actor, target, shot: { type: 'drawChoice', from: 'evelyn', target: target.name } };
}

test('Evelyn can fire her two draw-phase shots at the same target', () => {
  const { game, actor, target, shot } = evelynGame();
  assert.equal(game.viewFor(actor.name).pending.remaining, 2);
  assert.throws(() => game.act(actor.name, { ...shot, target: actor.name }), /trong tầm súng/);
  for (let i = 0; i < 2; i++) {
    game.act(actor.name, shot);
    assert.equal(game.phase, 'play');
    assert.equal(game.pending.type, 'bang');
    assert.equal(game.players[game.pending.player], target);
    game.act(target.name, { type: 'take' });
    if (i === 0) assert.equal(game.viewFor(actor.name).pending.remaining, 1);
  }
  assert.equal(target.hp, 2);
  assert.equal(actor.hand.length, 0);
  assert.equal(game.bangsPlayed, 0);
  assert.equal(game.pending, null);
  assertConservation(game);
});

test('Evelyn can draw two at once or mix a one-card draw with a shot', () => {
  const drawOne = { type: 'drawChoice', from: 'deckOne' };
  const drawAll = { type: 'drawChoice', from: 'deck' };
  const first = evelynGame();
  first.game.act(first.actor.name, drawAll);
  assert.equal(first.actor.hand.length, 2);
  assert.equal(first.game.pending, null);
  assertConservation(first.game);

  const { game, actor, target, shot } = evelynGame();
  game.act(actor.name, drawOne);
  assert.equal(actor.hand.length, 1);
  assert.equal(game.pending.remaining, 1);
  game.act(actor.name, shot);
  game.act(target.name, { type: 'take' });
  assert.equal(actor.hand.length, 1);
  assert.equal(target.hp, 3);
  assert.equal(game.pending, null);
  assertConservation(game);
});

test('Evelyn finishes a Backfire counter before spending her remaining draw choice', () => {
  const { game, actor, target, shot } = evelynGame();
  const backfire = deal(game, target, 'Backfire');
  game.act(actor.name, shot);
  game.act(target.name, { type: 'respond', cardId: backfire.id });
  assert.equal(game.pending.type, 'bang');
  assert.equal(game.players[game.pending.player], actor);
  game.act(actor.name, { type: 'take' });
  assert.equal(game.phase, 'draw');
  assert.equal(game.pending.remaining, 1);
  game.timeout();
  assert.equal(actor.hand.length, 1);
  assert.equal(game.pending, null);
  assertConservation(game);
});

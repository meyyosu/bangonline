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

test('Annie Versary is an optional four-life character who does not change the deck', () => {
  const base = new Game(names, { characterChoices: 3 });
  const promo = new Game(names, { characterChoices: 3, annieVersary: true });
  assert.ok(!base.characterPool.includes('Annie Versary'));
  assert.equal(CHAR_INFO['Annie Versary'].hp, 4);
  assert.equal(promo.characterPool.filter((name) => name === 'Annie Versary').length, 1);
  assert.equal(promo.characterPool.length, base.characterPool.length + 1);
  assert.deepEqual(promo.fullDeck, base.fullDeck);
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

test('a safe Dynamite passes over consecutive Ghosts', () => {
  const { game, actor, target } = setup();
  const second = game.players[game.nextAlive(game.idx(target.name))];
  const recipient = game.players[game.nextAlive(game.idx(second.name))];
  for (const ghost of [target, second]) {
    game.kill(game.idx(ghost.name), null);
    play(game, actor, 'Ghost', ghost);
  }
  const dynamite = play(game, actor, 'Dynamite');
  game.startTurn();
  drawCheck(game, actor, 'H');
  assert.ok(recipient.eq.includes(dynamite));
  assert.ok(!target.eq.includes(dynamite) && !second.eq.includes(dynamite));
  assertConservation(game);
});

test('Ghosts do not increase range between players and can still be shot at directly', () => {
  const { game, actor, target } = setup();
  const ghostIndex = game.idx(target.name);
  const otherIndex = game.nextAlive(ghostIndex);
  const other = game.players[otherIndex];
  assert.equal(game.distance(game.turn, otherIndex), 2);
  game.kill(ghostIndex, null);
  play(game, actor, 'Ghost', target);
  actor.char = 'Willy the Kid';
  assert.equal(game.distance(otherIndex, game.turn), 1);
  assert.equal(game.viewFor(actor.name).players[otherIndex].distance, 1);
  assert.equal(game.distance(game.turn, ghostIndex), 1);
  assert.equal(game.distance(ghostIndex, game.turn), 1);
  play(game, actor, 'Bang', other);
  assert.equal(game.pending.player, otherIndex);
  game.act(other.name, { type: 'take' });
  play(game, actor, 'Bang', target);
  game.act(target.name, { type: 'take' });
  assert.equal(target.alive, true);
  assert.equal(target.hp, 0);
  assertConservation(game);
});

test('General Store skips Ghosts even when a Ghost opens the store', () => {
  const { game, actor, target } = setup();
  const ghostIndex = game.idx(target.name);
  game.kill(ghostIndex, null);
  play(game, actor, 'Ghost', target);
  target.char = 'Willy the Kid';
  const recipient = game.nextAlive(ghostIndex);
  advanceTo(game, target);
  game.timeout();
  const hand = [...target.hand];
  play(game, target, 'General Store');
  const view = game.viewFor(target.name);
  assert.equal(view.pending.player, recipient);
  assert.equal(view.store.revealed.length, game.players.length - 1);
  assert.ok(!view.store.order.includes(ghostIndex));
  for (let i = 0; i < game.players.length - 1; i++) game.timeout();
  assert.deepEqual(target.hand, hand);
  assert.equal(game.store.picks.length, game.players.length - 1);
  assert.equal(game.pending, null);
  assertConservation(game);
});

test('shared discards and attacks skip Ghosts without taking any cards from them', () => {
  for (const name of ['Indians', 'Gatling', 'Howitzer', 'Tornado', 'Bandidos', 'Poker', 'Brawl']) {
    const { game, actor, target } = setup();
    const ghostIndex = game.idx(target.name);
    const other = game.players[game.nextAlive(ghostIndex)];
    game.kill(ghostIndex, null);
    const anchor = play(game, actor, 'Ghost', target);
    const privateCard = deal(game, target, 'Escape');
    const otherCard = deal(game, other, 'Missed');
    const costCardId = name === 'Brawl' ? deal(game, actor, 'Bang').id : undefined;
    if (name === 'Howitzer') {
      const howitzer = deal(game, actor, name);
      actor.eq.push(game.takeFromHand(actor, howitzer.id));
      game.act(actor.name, { type: 'activate', cardId: howitzer.id });
    } else {
      play(game, actor, name, undefined, { costCardId, targets: [{ target: other.name, targetCard: 'hand' }] });
    }
    if (name === 'Brawl') assert.ok(game.discard.includes(otherCard));
    else assert.ok(!game.viewFor(null).mass.targets.some(({ i }) => i === ghostIndex));
    for (let i = 0; game.pending && i < game.players.length + 1; i++) {
      assert.notEqual(game.pending.player, ghostIndex, name);
      game.timeout();
    }
    assert.equal(game.pending, null, name);
    assert.deepEqual(target.hand, [privateCard], name);
    assert.deepEqual(target.eq, [anchor], name);
    assertConservation(game);
  }
});

test('Brawl reveals Escape only after it is played and waits for Henry Block before reporting his discard', () => {
  const { game, actor, target } = setup();
  const henry = game.players[game.nextAlive(game.idx(target.name))];
  henry.char = 'Henry Block';
  const escape = deal(game, target, 'Escape');
  const held = deal(game, henry, 'Beer');
  const missed = deal(game, actor, 'Missed');
  const cost = deal(game, actor, 'Bang');
  play(game, actor, 'Brawl', undefined, {
    costCardId: cost.id,
    targets: [target, henry].map((p) => ({ target: p.name, targetCard: 'hand' })),
  });
  assert.equal(game.viewFor(null).pending.player, null);
  assert.ok(game.viewFor(null).mass.targets.every(({ res }) => res === null));
  game.act(target.name, { type: 'escape', cardId: escape.id });
  assert.equal(game.pending.type, 'bang');
  assert.deepEqual(game.viewFor(null).mass.targets.map(({ res }) => res), [{ card: escape }, null]);
  game.act(actor.name, { type: 'respond', cardId: missed.id });
  const { mass } = game.viewFor(null);
  assert.deepEqual(mass.targets[1].res, { discarded: [held] });
  assert.ok(mass.targets[1].revealAt - mass.targets[0].revealAt >= 500);
  assert.equal(game.pending, null);
  assertConservation(game);
});

test('a Ghost who plays Tornado, Bandidos or Poker has no discard, draw or pickup of their own', () => {
  for (const name of ['Tornado', 'Bandidos', 'Poker']) {
    const { game, actor, target } = setup();
    const ghostIndex = game.idx(target.name);
    game.kill(ghostIndex, null);
    play(game, actor, 'Ghost', target);
    target.char = 'Willy the Kid';
    advanceTo(game, target);
    game.timeout();
    const next = game.players[game.nextAlive(ghostIndex)];
    const beer = deal(game, next, 'Beer');
    const hand = [...target.hand];
    play(game, target, name);
    assert.equal(game.pending.player, game.idx(next.name), name);
    assert.ok(!game.viewFor(null).mass.targets.some(({ i }) => i === ghostIndex));
    game.act(next.name, { type: 'valleyDiscard', cardIds: [beer.id] });
    for (let i = 0; game.pending && i < game.players.length; i++) game.timeout();
    assert.equal(game.pending, null, name);
    assert.deepEqual(target.hand, hand, name);
    assertConservation(game);
  }
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

test('Aim can be chosen first and shares the Bang limit in either play order', () => {
  for (const aimFirst of [true, false]) {
    const { game, actor, target } = setup();
    const aim = deal(game, actor, 'Aim');
    const payment = deal(game, actor, 'Bang');
    const bang = deal(game, actor, 'Bang');
    const aimed = { type: 'play', cardId: aim.id, bangCardId: payment.id, target: target.name };
    const normal = { type: 'play', cardId: bang.id, target: target.name };
    if (aimFirst) {
      assert.throws(() => game.act(actor.name, { ...aimed, bangCardId: aim.id }), /Chọn một lá Bang!/);
      assert.equal(game.bangsPlayed, 0);
    }
    game.act(actor.name, aimFirst ? aimed : normal);
    assert.equal(game.bangsPlayed, 1);
    assert.deepEqual(actor.hand, aimFirst ? [bang] : [aim, payment]);
    const missed = deal(game, target, 'Missed');
    game.act(target.name, { type: 'respond', cardId: missed.id });
    assert.throws(() => game.act(actor.name, aimFirst ? normal : aimed), /Mỗi lượt chỉ được dùng 1 Bang!/);
    assert.deepEqual(actor.hand, aimFirst ? [bang] : [aim, payment]);
    assertConservation(game);
  }
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

test('the pending Saved! offer keeps both names private until the card is played', () => {
  const { game, actor, target } = setup();
  const saver = game.players.find((p) => p !== actor && p !== target);
  const saved = deal(game, saver, 'Saved!');
  const hp = target.hp;
  play(game, actor, 'Bang', target);
  game.act(target.name, { type: 'take' });
  const privateView = game.viewFor(saver.name);
  assert.deepEqual(privateView.pending, {
    type: 'saved', player: privateView.me.index, target: game.idx(target.name), amount: 1,
  });
  for (const viewer of [null, ...names.filter((name) => name !== saver.name)]) {
    assert.deepEqual(game.viewFor(viewer).pending, { type: 'saved', player: null });
  }
  game.act(saver.name, { type: 'saved', cardId: saved.id, from: 'deck' });
  assert.equal(target.hp, hp);
  assert.ok(game.log.includes(`${saver.name} vừa cứu ${target.name} khỏi một pha đấu súng!`));
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
  const bounty = play(game, actor, 'Bounty', target);
  assert.deepEqual(game.viewFor(null).sounds.at(-1).files, ['bounty']);
  play(game, actor, 'Missed', target, { asBang: true });
  assert.deepEqual(game.viewFor(null).sounds.at(-1).files, ['bangsound_lemat']);
  assert.equal(game.bangsPlayed, 1);
  assert.equal(game.pending.trueBang, true);
  assert.ok(!game.viewFor(null).sounds.some((cue) => cue.files.includes('bounty_earned')));
  const reward = game.deck.at(-1);
  game.act(target.name, { type: 'take' });
  assert.deepEqual(actor.hand, [reward]);
  assert.ok(target.eq.includes(bounty));
  game.bangsPlayed = 0;
  play(game, actor, 'Shotgun');
  play(game, actor, 'Bang', target);
  assert.deepEqual(game.viewFor(null).sounds.at(-1).files, ['bangsound_shotgun']);
  const before = actor.hand.length;
  game.act(target.name, { type: 'take' });
  assert.equal(actor.hand.length, before + 1);
  assert.deepEqual(game.viewFor(null).sounds.at(-1).files, ['bounty_earned']);
  assert.equal(game.pending.name, 'Shotgun');
  game.act(target.name, { type: 'valleyDiscard', cardIds: [targetCard.id] });
  assert.equal(target.hand.length, 0);
  assert.ok(target.eq.includes(bounty));
  assertConservation(game);
});

test('Calamity Janet collects Bounty when playing Missed as Bang and can take the Bounty with Panic', () => {
  const { game, actor, target } = setup();
  actor.char = 'Calamity Janet';
  const bounty = play(game, actor, 'Bounty', target);
  play(game, actor, 'Missed', target);
  const reward = game.deck.at(-1);
  game.act(target.name, { type: 'take' });
  assert.deepEqual(actor.hand, [reward]);
  assert.ok(target.eq.includes(bounty));
  play(game, actor, 'Panic', target, { targetCard: bounty.id });
  assert.ok(actor.hand.includes(bounty));
  assert.ok(!target.eq.includes(bounty));
  assertConservation(game);
});

test('a card Annie plays as Bang uses her regular shot and earns Bounty only if it hits', () => {
  for (const hits of [true, false]) {
    const { game, actor, target } = setup();
    actor.char = 'Annie Versary';
    const bounty = play(game, actor, 'Bounty', target);
    const convertible = deal(game, actor, 'Stagecoach');
    const other = deal(game, actor, 'Missed');
    const dodge = hits ? null : deal(game, target, 'Missed');
    game.act(actor.name, { type: 'play', cardId: convertible.id, target: target.name, asBang: true });
    assert.ok(game.discard.includes(convertible));
    assert.equal(game.pending.countsTowardBangLimit, true);
    assert.equal(game.bangsPlayed, 1);
    assert.deepEqual(actor.hand, [other]);
    const reward = game.deck.at(-1);
    game.act(target.name, dodge ? { type: 'respond', cardId: dodge.id } : { type: 'take' });
    assert.deepEqual(actor.hand, hits ? [other, reward] : [other]);
    assert.equal(game.viewFor(null).sounds.filter((cue) => cue.files.includes('bounty_earned')).length, Number(hits));
    assert.ok(target.eq.includes(bounty));
    assert.throws(() => game.act(actor.name, { type: 'play', cardId: other.id, target: target.name, asBang: true }), /Mỗi lượt chỉ được dùng 1 Bang!/);
    assertConservation(game);
  }
});

test('Annie can answer Duel or Indians with any hand card without firing a shot', () => {
  for (const attack of ['Duel', 'Indians']) {
    const { game, actor, target } = setup();
    target.char = 'Annie Versary';
    const response = deal(game, target, 'Mustang');
    const hp = target.hp;
    play(game, actor, attack, target);
    assert.deepEqual(game.viewFor(target.name).pending.responseCardIds, [response.id]);
    assert.equal(game.viewFor(null).pending.responseCardIds, undefined);
    game.act(target.name, { type: 'respond', cardId: response.id });
    assert.equal(target.hp, hp);
    assert.equal(game.bangsPlayed, 0);
    assert.ok(game.discard.includes(response));
    assertConservation(game);
  }
});

test('Bounty rejects self-placement and pays the shooter on a final hit', () => {
  const { game, actor: sheriff, target: shooter } = setup();
  game.turn = game.idx(shooter.name);
  const bounty = deal(game, shooter, 'Bounty');
  const place = { type: 'play', cardId: bounty.id, target: shooter.name };
  assert.throws(() => game.act(shooter.name, place), /Không thể tự đặt Bounty/);
  assert.deepEqual(shooter.hand, [bounty]);
  assert.deepEqual(shooter.eq, []);
  game.act(shooter.name, { ...place, target: sheriff.name });
  assert.deepEqual(sheriff.eq, [bounty]);
  sheriff.hp = 1;
  play(game, shooter, 'Bang', sheriff);
  const reward = game.deck.at(-1);
  game.act(sheriff.name, { type: 'take' });
  assert.equal(sheriff.alive, false);
  assert.ok(game.winner);
  assert.deepEqual(shooter.hand, [reward]);
  assert.ok(game.discard.includes(bounty));
  assert.equal(game.viewFor(null).sounds.filter((cue) => cue.files.includes('bounty_earned')).length, 1);
  assertConservation(game);
});

test('Bounty skips extra shots, non-card Bang effects, prevention, and attacks by Belle Star', () => {
  for (const name of ['Punch', 'Gatling', 'Fanning', 'Doc Holyday', 'Black Flower', 'Missed', 'Saved!', 'Belle Star']) {
    const { game, actor, target } = setup();
    if (['Belle Star', 'Doc Holyday', 'Black Flower'].includes(name)) actor.char = name;
    const bounty = play(game, actor, 'Bounty', target);
    if (name === 'Doc Holyday') {
      const cards = [deal(game, actor, 'Bang'), deal(game, actor, 'Missed')];
      game.act(actor.name, { type: 'skill', cardIds: cards.map((c) => c.id), target: target.name });
    } else if (name === 'Black Flower') {
      const club = deal(game, actor, 'Cat Balou', 'C');
      game.act(actor.name, { type: 'skill', cardIds: [club.id], target: target.name });
      assert.equal(game.bangsPlayed, 0);
    } else if (name === 'Fanning') {
      const [second] = game.fanningTargets(game.turn, game.idx(target.name));
      play(game, actor, name, target, { secondTarget: game.players[second].name });
    } else {
      play(game, actor, ['Punch', 'Gatling'].includes(name) ? name : 'Bang', target);
    }
    const hp = target.hp;
    if (name === 'Saved!') {
      const saver = game.players.find((p) => p !== actor && p !== target);
      const saved = deal(game, saver, name);
      game.act(saver.name, { type: 'saved', cardId: saved.id, target: target.name, from: 'deck' });
    } else if (name === 'Missed') {
      const defense = deal(game, target, name);
      game.act(target.name, { type: 'respond', cardId: defense.id });
    } else game.act(target.name, { type: 'take' });
    assert.equal(target.hp, hp - (['Missed', 'Saved!'].includes(name) ? 0 : 1), name);
    assert.ok(target.eq.includes(bounty), name);
    assert.equal(actor.hand.length, 0, name);
    assert.ok(!game.viewFor(null).sounds.some((cue) => cue.files.includes('bounty_earned')), name);
    assertConservation(game);
  }
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
    const actorIndex = game.idx(actor.name);
    const targetIndex = game.idx(target.name);
    assert.equal(game.pending.player, targetIndex);
    const actorResult = game.viewFor(null).mass.targets.find(({ i }) => i === actorIndex).res;
    assert.deepEqual([...actorResult.discarded], hand);
    game.act(target.name, { type: 'take' });
    assert.deepEqual(game.viewFor(null).mass.targets.find(({ i }) => i === targetIndex).res, { hurt: 1 });
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
  const hidden = game.viewFor(other.name);
  assert.equal(hidden.discardTop.name, 'Poker');
  assert.ok(!hidden.plays.some((event) => event.card.id === beer.id));
  assert.deepEqual(hidden.mass.targets.slice(0, 2).map((entry) => entry.res), [{ faceDown: true }, null]);
  game.act(other.name, { type: 'valleyDiscard', cardIds: [missed.id] });
  assert.deepEqual(game.viewFor(actor.name).pending.cards, [beer, missed]);
  const revealed = game.viewFor(null).mass;
  assert.deepEqual(revealed.targets.slice(0, 2).map((entry) => entry.res), [{ discarded: [beer] }, { discarded: [missed] }]);
  assert.equal(revealed.ace, false);
  const before = game.soundSeq;
  game.act(actor.name, { type: 'poker', cardIds: [beer.id, missed.id] });
  assert.deepEqual(actor.hand, [beer, missed]);
  assert.deepEqual(game.viewFor(null).mass.picks, [beer.id, missed.id]);
  assert.deepEqual(game.viewFor(actor.name).sounds.filter((cue) => cue.seq > before).flatMap((cue) => cue.files), ['drawcard']);
  assertConservation(game);
});

test('Tornado shows the discarded cards and draw counts while keeping Escape private until played', () => {
  const { game, actor, target } = setup();
  const beer = deal(game, actor, 'Beer');
  const escape = deal(game, target, 'Escape');
  play(game, actor, 'Tornado');
  game.act(actor.name, { type: 'valleyDiscard', cardIds: [beer.id] });
  assert.equal(game.viewFor(null).pending.player, null);
  assert.equal(game.viewFor(null).mass.targets[1].res, null);
  game.act(target.name, { type: 'escape', cardId: escape.id });
  const { mass } = game.viewFor(null);
  assert.deepEqual(mass.targets[0].res, { discarded: [beer], drawn: 2 });
  assert.deepEqual(mass.targets[1].res, { card: escape });
  assert.ok(mass.targets.slice(2).every(({ res }) => res.discarded.length === 0 && res.drawn === 2));
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

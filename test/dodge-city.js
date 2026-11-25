'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');

delete process.env.BANG_DODGE_CITY_FILE;
delete process.env.BANG_GREEN_CARDS_FILE;
const { Game, GameError, CARD_INFO, CHAR_INFO } = require('../game');
const { syncTimer, tickTimer } = require('../room-timer');

const names = ['Alice', 'Bobby', 'Carol', 'David', 'Elena'];
const makeGame = (opts) => new Game(names, { rng: () => 0.4, dodgeCity: true, ...opts });

test('only Dodge City accepts eight players and only the surviving Renegade wins', () => {
  const eight = [...names, 'Frank', 'Grace', 'Henry'];
  assert.throws(() => new Game(eight), /4–7/);
  assert.throws(() => new Game([...eight, 'Irene'], { dodgeCity: true }), /4–8/);
  const g = new Game(eight, { dodgeCity: true, characterChoices: 4 });
  while (g.phase === 'character') g.timeout();
  assert.equal(new Set(g.players.map((p) => p.char)).size, 8);
  assert.deepEqual(g.players.reduce((counts, p) => {
    counts[p.role] = (counts[p.role] || 0) + 1;
    return counts;
  }, {}), { Sheriff: 1, Deputy: 2, Outlaw: 3, Renegade: 2 });
  assertDeck(g);
  const renegades = g.players.filter((p) => p.role === 'Renegade');
  for (const p of g.players) p.alive = renegades.includes(p);
  g.checkWin();
  assert.equal(g.winner, 'Outlaw');
  renegades[0].alive = false;
  g.checkWin();
  assert.equal(g.winner, 'Renegade');
  assert.equal(g.isWinner(renegades[0]), false);
  assert.equal(g.isWinner(renegades[1]), true);
});

function setup(skill) {
  const g = makeGame();
  for (const player of g.players) player.char = 'Willy the Kid';
  const p = g.players[g.turn];
  p.char = skill;
  p.hp = p.maxHp = CHAR_INFO[skill].hp + 1;
  g.startTurn();
  const adjacent = g.players[g.nextAlive(g.turn)];
  const distant = g.players[g.nextAlive(g.idx(adjacent.name))];
  return { g, p, adjacent, distant };
}

function deal(g, p, name, suit) {
  const matches = (c) => c.name === name && (!suit || c.suit === suit);
  const pile = [g.deck, g.discard, ...g.players.map((q) => q.hand)].find((cards) => cards.some(matches));
  assert.ok(pile, `Missing ${name} ${suit || ''}`);
  const [card] = pile.splice(pile.findIndex(matches), 1);
  p.hand.push(card);
  return card;
}

function equip(g, p, name) {
  const c = deal(g, p, name);
  p.eq.push(g.takeFromHand(p, c.id));
  return c;
}

function play(g, p, name, target, suit) {
  const c = deal(g, p, name, suit);
  g.act(p.name, { type: 'play', cardId: c.id, target: target?.name });
  return c;
}

function assertDeck(g) {
  const cards = [...g.deck, ...g.discard, ...g.players.flatMap((p) => [...p.hand, ...p.eq]),
    ...(g.pending?.cards || []), ...g.queue.flatMap((step) => step.cards || [])];
  assert.equal(cards.length, 114);
  assert.equal(new Set(cards.map((c) => c.id)).size, 114);
}

test('Dodge City adds 15 characters only to the expansion pool', () => {
  const regular = makeGame({ dodgeCity: false, characterChoices: 4 });
  const expansion = makeGame({ characterChoices: 4 });
  assert.equal(regular.characterPool.length, 17);
  assert.equal(regular.deck.length, 80);
  assert.equal(expansion.characterPool.length, 32);
  assert.equal(expansion.deck.length, 114);
  assert.ok(expansion.characterPool.includes('Vera Custer'));
  assert.ok(expansion.characterPool.includes('Apache Kid'));
  assert.ok(!regular.characterPool.includes('Vera Custer'));
  while (expansion.phase === 'character') expansion.timeout();
  assert.equal(new Set(expansion.players.map((p) => p.char)).size, names.length);
  for (const p of expansion.players) assert.equal(p.hp, CHAR_INFO[p.char].hp + Number(p.role === 'Sheriff'));
  assertDeck(expansion);
});

test('Dodge City appends distinct name, rank and suit copies without changing the base deck', () => {
  const base = makeGame({ dodgeCity: false, characterChoices: 4 }).fullDeck;
  const expanded = makeGame({ characterChoices: 4 }).fullDeck;
  assert.deepEqual(expanded.slice(0, 80), base);
  const extra = expanded.slice(80);
  const actual = extra.filter((c) => CARD_INFO[c.name].type !== 'green').map((c) => `${c.name} ${c.rank}${c.suit}`).sort();
  assert.deepEqual(actual, [
    'Bang 8S', 'Barrel AC', 'Binocular 10D', 'Brawl JS', 'Cat Balou 8C', 'Dodge 7D', 'Dodge KH', 'Dynamite 10C',
    'General Store AS', 'Hideout KD', 'Indians 5D', 'Missed 8D', 'Mustang 5H', 'Punch 10S', 'Rag Time 9H',
    'Remington 6D', 'Rev. Carabine 5S', 'Springfield KS', 'Tequila 9C', 'Whisky QH',
  ].sort());
  const key = (c) => `${c.name} ${c.rank}${c.suit}`;
  assert.equal(new Set(extra.map(key)).size, 34);
  assert.ok(extra.every((c) => !base.some((b) => key(b) === key(c))));
  assert.equal(extra.filter((c) => c.name === 'Bible' && c.rank === '10' && c.suit === 'H').length, 1);
  assert.deepEqual(extra.filter((c) => c.name === 'Iron Plate').map(key).sort(), ['Iron Plate AD', 'Iron Plate QS']);
});

test('Rag Time and Springfield require a distinct hand cost and reach across the table', (t) => {
  const { g, p, distant } = setup('Slab the Killer');
  g.timeout();
  const barrel = equip(g, distant, 'Barrel');
  const rag = deal(g, p, 'Rag Time');
  const rifle = deal(g, p, 'Springfield');
  const cost = deal(g, p, 'Beer');
  const ragAction = { type: 'play', cardId: rag.id, target: distant.name, targetCard: barrel.id };
  const beforeSound = g.soundSeq;
  assert.throws(() => g.act(p.name, { ...ragAction, costCardId: rag.id }), GameError);
  assert.throws(() => g.act(p.name, { ...ragAction, costCardId: cost.id, targetCard: -1 }), GameError);
  assert.ok(p.hand.includes(rag) && p.hand.includes(cost));
  assert.equal(g.soundSeq, beforeSound);
  t.mock.method(Math, 'random', () => 0.99);
  g.act(p.name, { ...ragAction, costCardId: cost.id });
  assert.deepEqual(g.viewFor(distant.name).sounds.at(-1), { seq: beforeSound + 1, files: ['cardswap2'] });
  assert.ok(p.hand.includes(barrel));
  assert.ok(!distant.eq.includes(barrel));
  g.bangsPlayed = 1;
  g.act(p.name, { type: 'play', cardId: rifle.id, costCardId: barrel.id, target: distant.name });
  assert.equal(g.pending.player, g.idx(distant.name));
  assert.equal(g.pending.need, 1);
  assert.equal(g.bangsPlayed, 1);
  assertDeck(g);
});

test('Cat Balou audio requires another player to discard a card', () => {
  const { g, p, adjacent } = setup('Willy the Kid');
  adjacent.char = 'Apache Kid';
  g.timeout();
  const barrel = equip(g, adjacent, 'Barrel');
  const cat = deal(g, p, 'Cat Balou', 'D');
  const before = g.soundSeq;
  g.act(p.name, { type: 'play', cardId: cat.id, target: adjacent.name, targetCard: barrel.id });
  assert.equal(g.soundSeq, before);
  assert.ok(adjacent.eq.includes(barrel));

  const canCan = play(g, p, 'Can Can');
  assert.deepEqual(g.viewFor(adjacent.name).sounds.at(-1).files, ['equipment1']);
  g.startTurn();
  g.timeout();
  g.act(p.name, { type: 'activate', cardId: canCan.id, target: adjacent.name, targetCard: barrel.id });
  assert.deepEqual(g.viewFor(adjacent.name).sounds.at(-1).files, ['catbalou1']);
  assert.ok(g.discard.includes(barrel));
  assertDeck(g);
});

test('Brawl validates all choices before consuming cards and skips a player with no cards', () => {
  const { g, p, adjacent, distant } = setup('Willy the Kid');
  g.timeout();
  const brawl = deal(g, p, 'Brawl');
  const cost = deal(g, p, 'Beer');
  const barrel = equip(g, adjacent, 'Barrel');
  const empty = g.players.find((q) => q !== p && q !== adjacent && q !== distant);
  g.deck.push(...empty.hand.splice(0));
  const targets = g.players.filter((q) => q !== p && q !== empty).map((q) => ({ target: q.name, targetCard: q === adjacent ? barrel.id : 'hand' }));
  const action = { type: 'play', cardId: brawl.id, costCardId: cost.id, targets };
  const before = g.players.map((q) => q.hand.length + q.eq.length);
  const soundBefore = g.soundSeq;
  assert.throws(() => g.act(p.name, { ...action, targets: [targets[0], ...targets.slice(0, -1)] }), GameError);
  assert.deepEqual(g.players.map((q) => q.hand.length + q.eq.length), before);
  assert.equal(g.soundSeq, soundBefore);
  g.act(p.name, action);
  const view = g.viewFor(null);
  assert.deepEqual(view.sounds.filter((cue) => cue.seq > soundBefore).flatMap((cue) => cue.files), ['brawl']);
  assert.equal(view.mass.card.id, brawl.id);
  assert.deepEqual(view.mass.targets[0].res, { discarded: [barrel] });
  assert.equal(view.mass.targets.length, targets.length);
  let previousReveal = view.mass.t0;
  for (const { i, res, revealAt } of view.mass.targets) {
    assert.notEqual(g.players[i], empty);
    assert.ok(g.discard.includes(res.discarded[0]));
    assert.ok(revealAt - previousReveal >= 500);
    previousReveal = revealAt;
  }
  assert.ok(g.discard.includes(barrel));
  assert.deepEqual(g.players.map((q, i) => before[i] - q.hand.length - q.eq.length), g.players.map((q) => q === p ? 2 : q === empty ? 0 : 1));
  assertDeck(g);
});

test('Dodge draws after the shot and Molly cannot use the draw to finish the same defense', () => {
  const { g, p, adjacent: molly } = setup('Slab the Killer');
  molly.char = 'Molly Stark';
  g.timeout();
  const dodge = deal(g, molly, 'Dodge', 'D');
  const second = deal(g, molly, 'Dodge', 'H');
  const top = deal(g, p, 'Missed');
  g.deck.push(g.takeFromHand(p, top.id));
  play(g, p, 'Bang', molly, 'C');
  const before = molly.hand.length;
  g.act(molly.name, { type: 'respond', cardId: dodge.id });
  assert.equal(molly.hand.length, before - 1);
  assert.equal(g.viewFor(null).pending.directAttack, true);
  assert.ok(!g.viewFor(molly.name).pending.responseCardIds.includes(top.id));
  g.act(molly.name, { type: 'respond', cardId: second.id });
  assert.equal(g.pending, null);
  assert.equal(molly.hand.length, before + 2);
  assertDeck(g);
});

test('Tequila heals someone else and Whisky heals its owner without exceeding max HP', (t) => {
  const { g, p, distant } = setup('Tequila Joe');
  g.timeout();
  const tequila = deal(g, p, 'Tequila');
  const whisky = deal(g, p, 'Whisky');
  const cost = [deal(g, p, 'Bang', 'C'), deal(g, p, 'Bang', 'D')];
  p.hp = p.maxHp - 1;
  distant.hp = distant.maxHp - 2;
  const heal = { type: 'play', cardId: tequila.id, costCardId: cost[0].id };
  assert.throws(() => g.act(p.name, { ...heal, target: p.name }), GameError);
  g.act(p.name, { ...heal, target: distant.name });
  assert.equal(distant.hp, distant.maxHp - 1);
  t.mock.method(Math, 'random', () => 0);
  g.act(p.name, { type: 'play', cardId: whisky.id, costCardId: cost[1].id });
  assert.equal(p.hp, p.maxHp);
  assert.deepEqual(g.viewFor(distant.name).sounds.at(-1).files, ['whiskey1']);
  assertDeck(g);
});

test('Punch uses distance one and existing defenses, and distance equipment stacks', () => {
  const { g, p, adjacent, distant } = setup('Slab the Killer');
  g.timeout();
  const punch = deal(g, p, 'Punch');
  const missed = deal(g, adjacent, 'Missed');
  equip(g, adjacent, 'Barrel');
  assert.throws(() => g.act(p.name, { type: 'play', cardId: punch.id, target: distant.name }), GameError);
  g.act(p.name, { type: 'play', cardId: punch.id, target: adjacent.name });
  assert.equal(g.viewFor(null).combatEffects.at(-1).projectile, 'fist');
  assert.equal(g.pending.need, 1);
  assert.equal(g.pending.barrels, 1);
  g.act(adjacent.name, { type: 'respond', cardId: missed.id });
  assert.equal(g.bangsPlayed, 0);
  equip(g, distant, 'Hideout');
  equip(g, distant, 'Mustang');
  assert.equal(g.distance(g.turn, g.idx(distant.name)), 4);
  equip(g, p, 'Binocular');
  equip(g, p, 'Scope');
  assert.equal(g.distance(g.turn, g.idx(distant.name)), 2);
  assertDeck(g);
});

test('Knife uses its sound and projectile for a valid activation and only reports damage on hit', () => {
  const { g, p, adjacent, distant } = setup('Willy the Kid');
  g.timeout();
  const knife = play(g, p, 'Knife');
  const activate = { type: 'activate', cardId: knife.id, target: adjacent.name };
  assert.deepEqual(g.viewFor(adjacent.name).sounds.at(-1).files, ['equipment1']);
  assert.deepEqual(g.viewFor(null).combatEffects, []);
  const equippedAt = g.soundSeq;
  assert.throws(() => g.act(p.name, activate), GameError);
  assert.equal(g.soundSeq, equippedAt);

  g.startTurn();
  g.timeout();
  const readyAt = g.soundSeq;
  assert.throws(() => g.act(p.name, { ...activate, target: distant.name }), GameError);
  assert.equal(g.soundSeq, readyAt);
  g.act(p.name, activate);
  assert.deepEqual(g.viewFor(adjacent.name).sounds.at(-1), { seq: readyAt + 1, files: ['bangsound_knife'] });
  const target = g.idx(adjacent.name);
  assert.equal(g.pending.player, target);
  assert.equal(g.viewFor(null).pending.directAttack, true);
  const shot = { seq: 1, type: 'shot', source: g.idx(p.name), target, projectile: 'knife' };
  assert.deepEqual(g.viewFor(null).combatEffects, [shot]);
  g.act(adjacent.name, { type: 'take' });
  assert.equal(g.viewFor(null).pending, null);
  assert.deepEqual(g.viewFor(null).combatEffects, [shot, { seq: 2, type: 'damage', player: target, amount: 1 }]);
  assertDeck(g);
});

test('Gatling and Howitzer report damage without a projectile', () => {
  for (const name of ['Gatling', 'Howitzer']) {
    const { g, p, adjacent } = setup('Willy the Kid');
    g.timeout();
    if (name === 'Howitzer') {
      const card = equip(g, p, name);
      g.act(p.name, { type: 'activate', cardId: card.id });
    } else play(g, p, name);
    assert.deepEqual(g.viewFor(null).combatEffects, []);
    assert.equal(g.viewFor(null).pending.directAttack, undefined);
    g.act(adjacent.name, { type: 'take' });
    assert.deepEqual(g.viewFor(null).combatEffects, [{ seq: 1, type: 'damage', player: g.idx(adjacent.name), amount: 1 }]);
    assertDeck(g);
  }
});

test('a safe Dynamite passes over a player who already has one', () => {
  const { g, p, adjacent, distant } = setup('Willy the Kid');
  g.timeout();
  const original = play(g, p, 'Dynamite');
  assert.deepEqual(g.viewFor(adjacent.name).sounds.at(-1).files, ['dynamite_start.wav']);
  const second = equip(g, adjacent, 'Dynamite');
  const heart = deal(g, p, 'Bang', 'H');
  g.deck.push(g.takeFromHand(p, heart.id));
  g.startTurn();
  assert.equal(g.pending.kind, 'Dynamite');
  g.timeout();
  assert.ok(!p.eq.includes(original));
  assert.deepEqual(adjacent.eq, [second]);
  assert.ok(distant.eq.includes(original));
  assert.equal(g.pending.type, 'draw');
  assert.deepEqual(g.viewFor(p.name).sounds.at(-1).files, ['dynamite_start.wav']);
  assertDeck(g);
});

test('a failed Dynamite check uses the explosion WAV', () => {
  const { g, p, adjacent } = setup('Willy the Kid');
  const dynamite = equip(g, p, 'Dynamite');
  const spade = deal(g, p, 'Missed', 'S');
  g.deck.push(g.takeFromHand(p, spade.id));
  g.startTurn();
  const before = g.soundSeq;
  g.timeout();
  assert.equal(p.hp, p.maxHp - 3);
  assert.ok(g.discard.includes(dynamite));
  assert.deepEqual(g.viewFor(null).combatEffects, [{ seq: 1, type: 'damage', player: g.idx(p.name), amount: 3 }]);
  const cues = g.viewFor(adjacent.name).sounds.filter((cue) => cue.seq > before);
  assert.deepEqual(cues[0].files, ['dynamite_explode.wav']);
  assert.match(cues[1].files[0], /^hurt_m[1-4]$/);
  assertDeck(g);
});

test('confirmed Bang attacks sample default and equipped gun sounds and turn audio stays private', (t) => {
  const rng = t.mock.method(Math, 'random', () => 0.99);
  const { g, p, adjacent } = setup('Willy the Kid');
  assert.deepEqual(g.viewFor(p.name).sounds.at(-1).files, ['yourturn1']);
  assert.ok(!g.viewFor(adjacent.name).sounds.some((cue) => cue.files.includes('yourturn1')));
  g.timeout();
  const first = deal(g, p, 'Bang', 'C');
  const second = deal(g, p, 'Bang', 'H');
  const missed = deal(g, adjacent, 'Missed');
  const before = g.soundSeq;
  assert.throws(() => g.act(p.name, { type: 'play', cardId: first.id, target: p.name }), GameError);
  assert.equal(g.soundSeq, before);
  g.act(p.name, { type: 'play', cardId: first.id, target: adjacent.name });
  rng.mock.mockImplementation(() => 0);
  g.act(adjacent.name, { type: 'respond', cardId: missed.id });
  equip(g, p, 'Remington');
  g.act(p.name, { type: 'play', cardId: second.id, target: adjacent.name });
  assert.deepEqual(g.viewFor(adjacent.name).sounds.map((cue) => cue.files), [
    ['bangsound7'], ['missedsound1'], ['bangsound_remington1'],
  ]);
  assert.deepEqual(g.viewFor(null).combatEffects.map((event) => event.type), ['shot', 'shot']);
  assert.ok(g.viewFor(null).combatEffects.every((event) => event.projectile === 'bullet'));
  assertDeck(g);
});

test('Barrel and Iron Plate use their own defense sounds', () => {
  const { g, p, adjacent } = setup('Willy the Kid');
  g.timeout();
  equip(g, adjacent, 'Barrel');
  const ironPlate = equip(g, adjacent, 'Iron Plate');
  const heart = deal(g, p, 'Bang', 'H');
  g.deck.push(g.takeFromHand(p, heart.id));
  play(g, p, 'Bang', adjacent, 'C');
  g.act(adjacent.name, { type: 'barrel' });
  assert.equal(g.viewFor(null).pending.directAttack, true);
  g.timeout();
  assert.equal(g.viewFor(null).pending, null);
  assert.deepEqual(g.viewFor(p.name).sounds.at(-1).files, ['missedsound_barrel']);

  play(g, p, 'Bang', adjacent, 'D');
  g.act(adjacent.name, { type: 'respond', cardId: ironPlate.id });
  assert.match(g.viewFor(p.name).sounds.at(-1).files[0], /^missedsound_ironplate[2-4]?$/);
  assertDeck(g);
});

test('Indians plays one sound for everyone as the Bang responses begin', () => {
  const { g, p, adjacent, distant } = setup('Willy the Kid');
  g.timeout();
  const response = deal(g, adjacent, 'Bang');
  const before = g.soundSeq;
  play(g, p, 'Indians');
  assert.equal(g.pending.type, 'indians');
  assert.equal(g.pending.player, g.idx(adjacent.name));
  assert.equal(g.soundSeq, before + 1);

  g.act(adjacent.name, { type: 'respond', cardId: response.id });
  assert.equal(g.pending.player, g.idx(distant.name));
  g.act(distant.name, { type: 'take' });
  for (const player of g.players) {
    const cues = g.viewFor(player.name).sounds.filter((cue) => cue.seq > before);
    assert.equal(cues.length, 2);
    assert.deepEqual(cues[0], { seq: before + 1, files: ['indian1'] });
    assert.match(cues[1].files[0], /^hurt_m[1-4]$/);
  }
  assertDeck(g);
});

test('an Outlaw bounty groups the elimination and payout sounds in one cue', () => {
  for (const rewarded of [true, false]) {
    const { g, p } = setup('Willy the Kid');
    const outlaw = g.players.find((q) => q.role === 'Outlaw');
    const before = p.hand.length;
    g.kill(g.idx(outlaw.name), rewarded ? g.idx(p.name) : null);
    assert.equal(p.hand.length - before, rewarded ? 3 : 0);
    assert.deepEqual(g.viewFor(p.name).sounds.at(-1).files, rewarded ? ['playereliminated', 'outlawkilled1'] : ['playereliminated']);
    assertDeck(g);
  }
});

test('the end of the match sends each player a private victory or defeat sound', () => {
  const { g, p } = setup('Willy the Kid');
  const [eliminated, survivor] = g.players.filter((player) => player.role === 'Outlaw');
  const resultsFor = (name) => g.viewFor(name).sounds.flatMap((cue) =>
    cue.files.filter((file) => file === 'victory' || file === 'defeat'));

  g.kill(g.idx(eliminated.name), null);
  for (const player of g.players) assert.deepEqual(resultsFor(player.name), []);

  g.kill(g.idx(p.name), g.idx(survivor.name));
  assert.equal(g.winner, 'Outlaw');
  for (const player of g.players) {
    assert.deepEqual(resultsFor(player.name), [player.role === 'Outlaw' ? 'victory' : 'defeat']);
  }
  assert.deepEqual(resultsFor(null), []);
  assertDeck(g);
});

test('Apache Kid ignores diamonds aimed at him, including group attacks, except Duel', () => {
  const { g, p, adjacent } = setup('Willy the Kid');
  adjacent.char = 'Apache Kid';
  g.timeout();
  play(g, p, 'Bang', adjacent, 'D');
  assert.equal(g.pending, null);
  play(g, p, 'Indians');
  assert.ok([g.pending, ...g.queue].every((r) => r.player !== g.idx(adjacent.name)));
  while (g.pending) g.timeout();
  play(g, p, 'Duel', adjacent, 'D');
  assert.equal(g.pending.type, 'duel');
  assert.equal(g.pending.player, g.idx(adjacent.name));
  assertDeck(g);
});

test('Belle Star suppresses equipment while preserving the native Barrel skill', () => {
  const { g, p, adjacent } = setup('Belle Star');
  adjacent.char = 'Jourdonnais';
  equip(g, adjacent, 'Mustang');
  equip(g, adjacent, 'Barrel');
  const green = equip(g, adjacent, 'Bible');
  g.timeout();
  assert.equal(g.distance(g.turn, g.idx(adjacent.name)), 1);
  play(g, p, 'Bang', adjacent, 'C');
  assert.equal(g.pending.barrels, 1);
  assert.ok(!g.viewFor(adjacent.name).pending.responseCardIds.includes(green.id));
  assert.ok(g.viewFor(adjacent.name).players[g.idx(adjacent.name)].eq.every((c) => c.disabled));
  assert.equal(adjacent.eq.length, 3);
  g.timeout();
  g.timeout();
  assert.equal(g.barrelCount(adjacent), 2);
  assertDeck(g);
});

test('Bill Noface counts missing Sheriff health and Pixie Pete draws three', () => {
  for (const [skill, missing, expected] of [['Bill Noface', 0, 1], ['Bill Noface', 2, 3], ['Pixie Pete', 0, 3]]) {
    const { g, p } = setup(skill);
    p.hp -= missing;
    const before = p.hand.length;
    g.timeout();
    assert.equal(p.hand.length - before, expected);
    assertDeck(g);
  }
});

test('Chuck Wengam can draw repeatedly but cannot spend his last life', () => {
  const { g, p } = setup('Chuck Wengam');
  g.timeout();
  p.hp = 3;
  const before = p.hand.length;
  g.act(p.name, { type: 'skill' });
  g.act(p.name, { type: 'skill' });
  assert.equal(p.hp, 1);
  assert.equal(p.hand.length - before, 4);
  assert.throws(() => g.act(p.name, { type: 'skill' }), GameError);
  assertDeck(g);
});

test('Doc Holyday pays two distinct cards once per turn and respects range and immunity', () => {
  const { g, p, adjacent, distant } = setup('Doc Holyday');
  g.timeout();
  const cards = [deal(g, p, 'Bang', 'H'), deal(g, p, 'Bang', 'D')];
  const cardIds = cards.map((c) => c.id);
  assert.throws(() => g.act(p.name, { type: 'skill', cardIds, target: distant.name }), GameError);
  assert.throws(() => g.act(p.name, { type: 'skill', cardIds: [cardIds[0], cardIds[0]], target: adjacent.name }), GameError);
  assert.ok(cards.every((c) => p.hand.includes(c)));
  adjacent.char = 'Apache Kid';
  g.bangsPlayed = 1;
  g.act(p.name, { type: 'skill', cardIds, target: adjacent.name });
  assert.equal(g.pending.need, 1);
  g.timeout();
  assert.equal(g.bangsPlayed, 1);
  assert.throws(() => g.act(p.name, { type: 'skill', cardIds, target: adjacent.name }), GameError);
  g.startTurn();
  g.timeout();
  const diamonds = p.hand.filter((c) => c.suit === 'D');
  if (diamonds.length < 2) {
    for (const name of ['Panic', 'Cat Balou']) diamonds.push(deal(g, p, name, 'D'));
  }
  g.act(p.name, { type: 'skill', cardIds: diamonds.slice(0, 2).map((c) => c.id), target: adjacent.name });
  assert.equal(g.pending, null);
  assertDeck(g);
});

test('Elena Fuente counts any hand card as one dodge', () => {
  const { g, p, adjacent } = setup('Slab the Killer');
  adjacent.char = 'Elena Fuente';
  g.timeout();
  play(g, p, 'Bang', adjacent, 'C');
  const green = deal(g, adjacent, 'Bible');
  const normal = deal(g, adjacent, 'Beer');
  g.act(adjacent.name, { type: 'respond', cardId: green.id });
  assert.equal(g.pending.got, 1);
  g.act(adjacent.name, { type: 'respond', cardId: normal.id });
  assert.equal(g.pending, null);
  assert.ok(g.discard.includes(green));
  assertDeck(g);
});

test('Greg Digger heals and Herb Hunter adds his draw to the Outlaw bounty', () => {
  const { g, p } = setup('Herb Hunter');
  const victim = g.players.find((q) => q.role === 'Outlaw');
  const greg = g.players.find((q) => q !== p && q !== victim);
  greg.char = 'Greg Digger';
  greg.hp = greg.maxHp - 1;
  const before = p.hand.length;
  g.kill(g.idx(victim.name), g.idx(p.name));
  assert.equal(greg.hp, greg.maxHp);
  assert.equal(p.hand.length - before, 5);
  assertDeck(g);
});

test('José Delgado accepts blue equipment from hand and resets after two uses', () => {
  const { g, p } = setup('José Delgado');
  g.timeout();
  const green = deal(g, p, 'Canteen');
  const spend = (c) => g.act(p.name, { type: 'skill', cardIds: [c.id] });
  const barrel = deal(g, p, 'Barrel');
  const gun = deal(g, p, 'Winchester');
  const mustang = deal(g, p, 'Mustang');
  assert.equal(CARD_INFO[gun.name].type, 'gun');
  assert.throws(() => spend(green), GameError);
  const before = p.hand.length;
  spend(barrel);
  spend(gun);
  assert.equal(p.hand.length - before, 2);
  assert.throws(() => spend(mustang), GameError);
  g.startTurn();
  g.timeout();
  spend(mustang);
  assertDeck(g);
});

test('Molly Stark draws for a dodge, defers Duel draw, and does not draw for forced discard', () => {
  const { g, p, adjacent } = setup('Willy the Kid');
  adjacent.char = 'Molly Stark';
  g.timeout();
  const defend = deal(g, adjacent, 'Missed');
  let before = adjacent.hand.length;
  play(g, p, 'Bang', adjacent, 'C');
  g.act(adjacent.name, { type: 'respond', cardId: defend.id });
  assert.equal(adjacent.hand.length, before);
  play(g, p, 'Duel', adjacent);
  const shot = deal(g, adjacent, 'Bang');
  before = adjacent.hand.length;
  g.act(adjacent.name, { type: 'respond', cardId: shot.id });
  assert.equal(adjacent.hand.length, before - 1);
  g.timeout();
  assert.equal(adjacent.hand.length, before);
  const cat = deal(g, p, 'Cat Balou');
  g.act(p.name, { type: 'play', cardId: cat.id, target: adjacent.name, targetCard: 'hand' });
  assert.equal(adjacent.hand.length, before - 1);
  assertDeck(g);
});

test('Molly Stark gets no replacement until both dodges against Slab are resolved', () => {
  for (const outcome of ['second dodge', 'Barrel', 'take damage', 'Beer']) {
    const { g, p, adjacent: molly } = setup('Slab the Killer');
    molly.char = 'Molly Stark';
    g.timeout();
    const first = deal(g, molly, 'Missed');
    const second = outcome === 'second dodge' ? deal(g, molly, 'Missed') : null;
    const onTop = deal(g, p, 'Missed');
    g.deck.push(g.takeFromHand(p, onTop.id));
    if (outcome === 'Barrel') {
      equip(g, molly, 'Barrel');
      const heart = deal(g, p, 'Bang', 'H');
      g.deck.push(g.takeFromHand(p, heart.id));
    }
    if (outcome === 'Beer') { molly.hp = 1; deal(g, molly, 'Beer'); }
    const before = molly.hand.length;
    const hp = molly.hp;

    play(g, p, 'Bang', molly, 'C');
    const respond = (card) => g.act(molly.name, { type: 'respond', cardId: card.id });
    respond(first);
    assert.equal(g.pending.got, 1, outcome);
    assert.equal(molly.hand.length, before - 1, outcome);
    assert.ok(!g.viewFor(molly.name).pending.responseCardIds.includes(onTop.id), outcome);
    assert.throws(() => respond(onTop), GameError);

    if (second) respond(second);
    else if (outcome === 'Barrel') { g.act(molly.name, { type: 'barrel' }); g.timeout(); }
    else g.act(molly.name, { type: 'take' });

    assert.equal(g.pending, null, outcome);
    assert.equal(molly.hand.length, before, outcome);
    assert.ok(molly.hand.includes(onTop), outcome);
    assert.equal(molly.hp, outcome === 'take damage' ? hp - 1 : hp, outcome);
    assert.equal(g.stats[g.idx(molly.name)].dodged, second || outcome === 'Barrel' ? 2 : 1, outcome);
    assertDeck(g);
  }
});

test('Pat Brennan takes equipment from any seat including his own', () => {
  for (const own of [true, false]) {
    const { g, p, distant } = setup('Pat Brennan');
    const target = own ? p : distant;
    const card = equip(g, target, own ? 'Schofield' : 'Bible');
    g.startTurn();
    assert.ok(g.pending.options.includes('equipment'));
    const before = p.hand.length;
    const beforeSound = g.soundSeq;
    g.act(p.name, { type: 'drawChoice', from: 'equipment', target: target.name, cardId: card.id });
    assert.equal(g.soundSeq - beforeSound, 1);
    const cue = g.viewFor(p.name).sounds.at(-1);
    if (own) {
      assert.deepEqual(cue.files, ['drawcard']);
      assert.ok(g.viewFor(null).sounds.every((sound) => sound.seq !== cue.seq));
    } else assert.match(cue.files[0], /^cardswap2?$/);
    assert.equal(g.phase, 'play');
    assert.equal(p.hand.length, before + 1);
    assert.ok(p.hand.includes(card));
    assert.equal(target.eq.length, 0);
    assert.throws(() => g.act(p.name, { type: 'drawChoice', from: 'deck' }), GameError);
    assertDeck(g);
  }
});

test('Pat Brennan can draw two from the deck even when equipment is available', () => {
  const { g, p, distant } = setup('Pat Brennan');
  const card = equip(g, distant, 'Barrel');
  g.startTurn();
  assert.deepEqual(g.pending.options, ['deck', 'equipment']);
  const before = p.hand.length;
  g.act(p.name, { type: 'drawChoice', from: 'deck' });
  assert.equal(p.hand.length, before + 2);
  assert.ok(distant.eq.includes(card));
  assert.equal(g.phase, 'play');
  assertDeck(g);
});

test('Sean Mallory can keep 10 at end of turn, including on timeout', () => {
  const { g, p } = setup('Sean Mallory');
  g.timeout();
  g.give(p, 11 - p.hand.length);
  assert.equal(g.viewFor(p.name).me.handLimit, 10);
  assert.throws(() => g.act(p.name, { type: 'endTurn' }), GameError);
  g.timeout();
  assert.equal(p.hand.length, 10);
  assert.notEqual(g.turn, g.idx(p.name));
  assertDeck(g);
});

test('Tequila Joe uses +2 Beer both normally and in lethal damage', () => {
  const { g, p, adjacent } = setup('Tequila Joe');
  g.timeout();
  p.hp = 1;
  play(g, p, 'Beer');
  assert.equal(p.hp, 3);
  p.hp = 1;
  deal(g, p, 'Beer');
  g.damage(g.idx(p.name), 1, g.idx(adjacent.name));
  assert.equal(p.hp, 2);
  assert.equal(g.stats[g.idx(p.name)].healed, 4);
  assertDeck(g);
});

test('Vera Custer copies before drawing, uses copied abilities and can time out', () => {
  const { g, p, adjacent } = setup('Vera Custer');
  adjacent.char = 'Pixie Pete';
  assert.equal(g.pending.type, 'copyAbility');
  assert.throws(() => g.act(p.name, { type: 'copyAbility', target: p.name }), GameError);
  const room = { game: g, turnSeconds: 60 };
  syncTimer(room, 100);
  assert.equal(room.clock.seconds, 20);
  g.act(p.name, { type: 'copyAbility', target: adjacent.name });
  assert.equal(g.viewFor(p.name).players[g.turn].ability, 'Pixie Pete');
  const before = p.hand.length;
  g.timeout();
  assert.equal(p.hand.length - before, 3);
  g.startTurn();
  assert.equal(g.ability(p), null);
  syncTimer(room, 1000);
  assert.equal(tickTimer(room, 21000), true);
  assert.equal(g.pending.type, 'draw');
  assert.ok(g.ability(p));
  assertDeck(g);
});

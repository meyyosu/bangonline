'use strict';
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { test } = require('node:test');

process.env.BANG_GREEN_CARDS_FILE = join(__dirname, '..', 'green-cards.json');
const { Game, GameError, CARD_INFO, CHAR_INFO } = require('../game');
const { syncTimer, tickTimer } = require('../room-timer');

const names = ['Alice', 'Bobby', 'Carol', 'David', 'Elena'];
const makeGame = (opts) => new Game(names, { rng: () => 0.4, dodgeCity: true, ...opts });

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
  assert.equal(cards.length, 94);
  assert.equal(new Set(cards.map((c) => c.id)).size, 94);
}

test('Dodge City adds 15 characters only to the expansion pool', () => {
  const regular = makeGame({ dodgeCity: false, characterChoices: 4 });
  const expansion = makeGame({ characterChoices: 4 });
  assert.equal(regular.characterPool.length, 16);
  assert.equal(regular.deck.length, 80);
  assert.equal(expansion.characterPool.length, 31);
  assert.equal(expansion.deck.length, 94);
  assert.ok(expansion.characterPool.includes('Vera Custer'));
  assert.ok(expansion.characterPool.includes('Apache Kid'));
  assert.ok(!regular.characterPool.includes('Vera Custer'));
  while (expansion.phase === 'character') expansion.timeout();
  assert.equal(new Set(expansion.players.map((p) => p.char)).size, names.length);
  for (const p of expansion.players) assert.equal(p.hp, CHAR_INFO[p.char].hp + Number(p.role === 'Sheriff'));
  assertDeck(expansion);
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
    g.act(p.name, { type: 'drawChoice', from: 'equipment', target: target.name, cardId: card.id });
    assert.equal(g.phase, 'play');
    assert.equal(p.hand.length, before + 1);
    assert.ok(p.hand.includes(card));
    assert.equal(target.eq.length, 0);
    assertDeck(g);
  }
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

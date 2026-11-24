'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { Game } = require('../game');
const { syncTimer, tickTimer } = require('../room-timer');

const names = ['Alice', 'Bobby', 'Carol', 'David'];
function game() { return new Game(names, { rng: () => 0.4 }); }
function count(g) {
  return g.deck.length + g.discard.length + g.players.reduce((n, p) => n + p.hand.length + p.eq.length, 0)
    + (g.pending?.cards?.length || 0) + g.queue.reduce((n, q) => n + (q.cards?.length || 0), 0);
}

test('character selection offers 2–4 choices, validates actions, and keeps seven characters unique', () => {
  for (const choices of [2, 3, 4]) {
    const g = new Game([...names, 'Elena', 'Frank', 'Grace'], { characterChoices: choices, rng: () => 0.4 });
    assert.equal(g.phase, 'character');
    assert.equal(g.deck.length, 80);
    assert.equal(g.turnNumber, undefined);
    for (let i = 0; i < 7; i++) {
      const player = g.players[i].name;
      const options = g.viewFor(player).pending.options;
      assert.equal(options.length, choices);
      assert.equal(new Set(options).size, choices);
      assert.ok(!g.viewFor(g.players[(i + 1) % 7].name).pending.options);
      assert.throws(() => g.act(player, { type: 'endTurn' }));
      assert.throws(() => g.act(player, { type: 'chooseCharacter', character: 'invalid' }));
      assert.throws(() => g.act(g.players[(i + 1) % 7].name, { type: 'chooseCharacter', character: options[0] }));
      assert.ok(options.every((c) => !g.players.some((p) => p.char === c)));
      g.act(player, { type: 'chooseCharacter', character: options[0] });
      assert.equal(count(g), 80);
    }
    assert.notEqual(g.phase, 'character');
    assert.equal(new Set(g.players.map((p) => p.char)).size, 7);
    assert.ok(g.players.every((p) => p.hand.length >= p.hp));
    assert.equal(g.turnNumber, 1);
  }
});

test('character clock runs independently and transitions to a fresh turn clock', () => {
  for (const turnSeconds of [0, 20]) {
    const g = new Game(names, { characterChoices: 4, rng: () => 0.4 });
    const r = { game: g, turnSeconds, characterSeconds: 10 };
    syncTimer(r, 1000);
    assert.equal(r.clock.character, true);
    syncTimer(r, 4000);
    assert.equal(r.clock.deadline, 11000);
    assert.equal(tickTimer(r, 10999), false);
    for (let i = 0; i < 4; i++) {
      assert.equal(tickTimer(r, 11000 + i * 10000), true);
      assert.equal(count(g), 80);
    }
    assert.notEqual(g.phase, 'character');
    assert.equal(r.clock.draw, true);
    assert.equal(r.clock.deadline, 46000);
    assert.equal(tickTimer(r, 46000), true);
    if (turnSeconds) assert.equal(r.clock.deadline, 66000);
    else assert.equal(r.clock, null);
  }
  const g = new Game(names, { characterChoices: 2 });
  const r = { game: g, turnSeconds: 10, characterSeconds: 0 };
  assert.equal(tickTimer(r, 100000), false);
  assert.equal(r.clock, null);
  assert.equal(g.pending.player, 0);
});

test('turn timer expires, preserves 80 cards, and starts the next turn', () => {
  const g = game();
  while (g.pending) g.timeout();
  const r = { game: g, turnSeconds: 10 };
  const turn = g.turnNumber;
  syncTimer(r, 1000);
  assert.equal(tickTimer(r, 10999), false);
  assert.equal(tickTimer(r, 11000), true);
  assert.ok(g.turnNumber > turn);
  assert.equal(r.clock.deadline, 16000);
  assert.equal(r.clock.draw, true);
  assert.equal(count(g), 80);
  r.turnSeconds = 0;
  assert.equal(tickTimer(r, 16000), true);
  assert.equal(tickTimer(r, 50000), false);
  assert.equal(r.clock, null);
});

test('manual draw waits, rejects other players, and starts a full turn clock', () => {
  const g = game();
  g.players[g.turn].char = 'Willy the Kid';
  const p = g.players[g.turn];
  const before = p.hand.length;
  const r = { game: g, turnSeconds: 20 };
  syncTimer(r, 1000);
  assert.equal(g.phase, 'draw');
  assert.equal(r.clock.deadline, 6000);
  assert.equal(p.hand.length, before);
  syncTimer(r, 3000);
  assert.equal(r.clock.deadline, 6000);
  assert.throws(() => g.act(g.players[(g.turn + 1) % 4].name, { type: 'drawChoice', from: 'deck' }));
  assert.throws(() => g.act(p.name, { type: 'endTurn' }));
  g.act(p.name, { type: 'drawChoice', from: 'deck' });
  syncTimer(r, 4000);
  assert.equal(p.hand.length, before + 2);
  assert.equal(g.phase, 'play');
  assert.equal(r.clock.deadline, 24000);
  assert.equal(count(g), 80);
});

test('auto draw fires at five seconds; Kit then gets twenty seconds to choose', () => {
  for (const character of ['Willy the Kid', 'Kit Carlson']) {
    for (const turnSeconds of [0, 20]) {
      const g = game();
      const p = g.players[g.turn];
      p.char = character;
      const before = p.hand.length;
      const r = { game: g, turnSeconds };
      syncTimer(r, 1000);
      assert.equal(tickTimer(r, 5999), false);
      assert.equal(tickTimer(r, 6000), true);
      let completedAt = 6000;
      if (character === 'Kit Carlson') {
        assert.equal(g.pending.type, 'kit');
        assert.equal(r.clock.deadline, 26000);
        assert.equal(tickTimer(r, 25999), false);
        assert.equal(tickTimer(r, 26000), true);
        completedAt = 26000;
      }
      assert.equal(g.phase, 'play');
      assert.equal(g.pending, null);
      assert.equal(p.hand.length, before + 2);
      if (turnSeconds) assert.equal(r.clock.deadline, completedAt + 20000);
      else assert.equal(r.clock, null);
      assert.equal(count(g), 80);
    }
  }
});

test('Panic and Cat Balou publish transfers from hands and equipment without exposing stolen hands', () => {
  for (const name of ['Panic', 'Cat Balou']) {
    for (const zone of ['hand', 'eq']) {
      const g = game();
      while (g.pending) g.timeout();
      for (const player of g.players) player.char = 'Willy the Kid';
      const pi = g.turn, p = g.players[pi], ti = g.nextAlive(pi), target = g.players[ti];
      const piles = [g.deck, g.discard, ...g.players.map((player) => player.hand)];
      const pile = piles.find((cards) => cards.some((c) => c.name === name));
      const [card] = pile.splice(pile.findIndex((c) => c.name === name), 1);
      p.hand.push(card);
      if (zone === 'eq') {
        const equipmentPile = piles.find((cards) => cards.some((c) => c.name === 'Barrel'));
        target.eq.push(equipmentPile.splice(equipmentPile.findIndex((c) => c.name === 'Barrel'), 1)[0]);
      }
      const equipment = target.eq[0];
      const before = g.transferSeq || 0;
      g.act(p.name, { type: 'play', cardId: card.id, target: target.name, targetCard: zone === 'hand' ? 'hand' : equipment.id });
      const event = g.viewFor(p.name).transfers.at(-1);
      assert.ok(event.seq > before);
      assert.equal(event.from, ti);
      assert.equal(event.to, name === 'Panic' ? pi : 'discard');
      assert.equal(event.sourceZone, zone);
      const moved = event.cards[0];
      assert.ok(moved);
      assert.ok((name === 'Panic' ? p.hand : g.discard).some((c) => c.id === moved.id));
      assert.ok(![...target.hand, ...target.eq].some((c) => c.id === moved.id));
      for (const viewer of [...names, null]) {
        const visible = g.viewFor(viewer).transfers.at(-1).cards[0];
        assert.equal(visible?.id ?? null, name === 'Panic' && zone === 'hand' && viewer !== p.name ? null : moved.id);
      }
      assert.equal(count(g), 80);
    }
  }
});

test('draw transfers preserve source and keep hidden card identities private', () => {
  for (const source of ['deck', 'player', 'discard']) {
    const g = game();
    const pi = g.turn, p = g.players[pi], ti = (pi + 1) % 4;
    p.char = source === 'player' ? 'Jesse Jones' : source === 'discard' ? 'Pedro Ramirez' : 'Willy the Kid';
    if (source === 'discard') g.toDiscard(g.deck.pop());
    g.beginDraw();
    const before = p.hand.length, targetBefore = g.players[ti].hand.length;
    g.act(p.name, { type: 'drawChoice', from: source, target: g.players[ti].name });
    assert.equal(p.hand.length, before + 2);
    const own = g.viewFor(p.name).transfers;
    const other = g.viewFor(g.players[ti].name).transfers;
    assert.equal(own.reduce((n, e) => n + e.cards.length, 0), 2);
    assert.ok(own.every((e) => e.cards.every(Boolean)));
    assert.equal(own[0].from, source === 'player' ? ti : source);
    assert.equal(g.players[ti].hand.length, targetBefore - (source === 'player' ? 1 : 0));
    for (const event of other) assert.ok(event.cards.every((c) => event.from === 'discard' ? !!c : c === null));
    assert.equal(count(g), 80);
  }
});

test('successful plays and responses publish the same public animation event to every player', () => {
  const g = game();
  while (g.pending) g.timeout();
  const pi = g.turn, p = g.players[pi], ti = g.nextAlive(pi), target = g.players[ti];
  const deal = (name, recipient) => {
    const index = g.deck.findIndex((c) => c.name === name);
    assert.ok(index >= 0);
    const card = g.deck.splice(index, 1)[0];
    recipient.hand.push(card);
    return card;
  };
  const gun = deal('Remington', p);
  const bang = deal('Bang', p);
  const missed = deal('Missed', target);
  g.act(p.name, { type: 'play', cardId: gun.id });
  assert.equal(g.plays[0].recipient, pi);
  assert.throws(() => g.act(p.name, { type: 'play', cardId: gun.id }));
  assert.equal(g.plays.length, 1);
  g.act(p.name, { type: 'play', cardId: bang.id, target: target.name });
  g.act(target.name, { type: 'respond', cardId: missed.id });
  assert.deepEqual(g.plays.map((e) => [e.seq, e.player, e.card.id, e.recipient]), [
    [1, pi, gun.id, pi], [2, pi, bang.id, null], [3, ti, missed.id, null],
  ]);
  for (const player of g.players) {
    const view = g.viewFor(player.name);
    assert.deepEqual(view.plays, g.plays);
    assert.ok(view.players.every((other) => !('hand' in other)));
  }
  assert.equal(count(g), 80);
});

test('manual and timed-out end-of-turn discards publish every card, including guns, to the discard pile', () => {
  for (const automatic of [false, true]) {
    const g = game();
    while (g.pending) g.timeout();
    const pi = g.turn, p = g.players[pi];
    const index = g.deck.findIndex((c) => c.name === 'Remington');
    assert.ok(index >= 0);
    const gun = g.deck.splice(index, 1)[0];
    p.hand.unshift(gun);
    const before = p.hand.map((c) => c.id);
    const ids = before.slice(0, p.hand.length - p.hp);
    assert.ok(ids.length > 1);
    assert.throws(() => g.act(p.name, { type: 'discard', cardIds: [gun.id, gun.id] }));
    assert.deepEqual(p.hand.map((c) => c.id), before);
    assert.equal(g.plays?.length || 0, 0);
    if (automatic) g.timeout();
    else {
      g.act(p.name, { type: 'discard', cardIds: ids });
      g.act(p.name, { type: 'endTurn' });
    }
    assert.deepEqual(g.plays.map((event) => event.card.id), ids);
    assert.ok(g.plays.every((event) => event.kind === 'discard' && event.recipient === null && event.player === pi));
    for (const other of g.players) assert.deepEqual(g.viewFor(other.name).plays, g.plays);
    assert.equal(count(g), 80);
  }
});

test('Black Jack reveals the second card publicly for three seconds before drawing the red bonus', () => {
  const g = game(), p = g.players[g.turn];
  p.char = 'Black Jack';
  const redIndex = g.deck.findIndex((c) => ['H', 'D'].includes(c.suit));
  const red = g.deck.splice(redIndex, 1)[0];
  g.deck.splice(g.deck.length - 1, 0, red);
  const before = p.hand.length;
  const r = { game: g, turnSeconds: 20 };
  g.act(p.name, { type: 'drawChoice', from: 'deck' });
  assert.equal(g.pending.type, 'blackJack');
  assert.equal(p.hand.length, before + 2);
  assert.equal(g.viewFor(g.players[(g.turn + 1) % 4].name).pending.card.id, red.id);
  assert.throws(() => g.act(p.name, { type: 'endTurn' }));
  syncTimer(r, 1000);
  assert.equal(r.clock.deadline, 4000);
  assert.equal(tickTimer(r, 3999), false);
  assert.equal(tickTimer(r, 4000), true);
  assert.equal(r.clock.deadline, 24000);
  assert.equal(p.hand.length, before + 3);
  assert.equal(g.viewFor(p.name).transfers.reduce((n, e) => n + e.cards.length, 0), 3);
  assert.equal(count(g), 80);
});

test('Jesse and Pedro have twenty seconds, including rooms without turn limits', () => {
  for (const character of ['Jesse Jones', 'Pedro Ramirez']) {
    const g = game(), p = g.players[g.turn];
    p.char = character;
    const r = { game: g, turnSeconds: 0 };
    syncTimer(r, 1000);
    assert.equal(r.clock.deadline, 21000);
    assert.equal(tickTimer(r, 20999), false);
    assert.equal(tickTimer(r, 21000), true);
    assert.equal(g.phase, 'play');
    assert.equal(r.clock, null);
    assert.equal(count(g), 80);
  }
});

test('Black Jack with a black second card waits three seconds without a bonus', () => {
  const g = game(), p = g.players[g.turn];
  p.char = 'Black Jack';
  const index = g.deck.findIndex((c) => ['S', 'C'].includes(c.suit));
  const black = g.deck.splice(index, 1)[0];
  g.deck.splice(g.deck.length - 1, 0, black);
  const before = p.hand.length;
  g.act(p.name, { type: 'drawChoice', from: 'deck' });
  const r = { game: g, turnSeconds: 0 };
  syncTimer(r, 1000);
  assert.equal(g.pending.red, false);
  assert.equal(tickTimer(r, 3999), false);
  assert.equal(tickTimer(r, 4000), true);
  assert.equal(p.hand.length, before + 2);
  assert.equal(r.clock, null);
  assert.equal(count(g), 80);
});

test('Kit selection keeps faces private and records two cards to hand and one to deck', () => {
  const g = game(), p = g.players[g.turn];
  p.char = 'Kit Carlson';
  g.act(p.name, { type: 'drawChoice', from: 'deck' });
  const offered = [...g.pending.cards];
  const other = g.players[(g.turn + 1) % 4].name;
  assert.deepEqual(g.viewFor(other).pending.cards, [null, null, null]);
  assert.deepEqual(g.viewFor(p.name).pending.cards, offered);
  const r = { game: g, turnSeconds: 20 };
  syncTimer(r, 1000);
  assert.equal(r.clock.deadline, 21000);
  g.act(p.name, { type: 'kit', cardIds: [offered[0].id, offered[2].id] });
  assert.equal(g.deck.at(-1).id, offered[1].id);
  const transfers = g.viewFor(other).transfers;
  assert.deepEqual(transfers.map((e) => [e.from, e.to, e.slots, e.cards]), [
    ['kit', g.turn, [0, 2], [null, null]], ['kit', 'deck', [1], [null]],
  ]);
  assert.equal(count(g), 80);
});

test('response clock pauses the turn and does not reset on unrelated activity', () => {
  const g = game();
  while (g.pending) g.timeout();
  const r = { game: g, turnSeconds: 10 };
  syncTimer(r, 1000);
  const player = (g.turn + 1) % 4;
  g.pending = { type: 'bang', player, source: g.turn, need: 1, got: 0, barrels: 0 };
  syncTimer(r, 4000);
  assert.equal(r.clock.deadline, 14000);
  syncTimer(r, 7000);
  assert.equal(r.clock.deadline, 14000);
  const hp = g.players[player].hp;
  assert.equal(tickTimer(r, 14000), true);
  assert.equal(g.players[player].hp, hp - 1);
  assert.equal(r.clock.deadline, 21000);
  assert.equal(count(g), 80);
  g.winner = 'Sheriff';
  syncTimer(r, 15000);
  assert.equal(r.clock, null);
});

test('all pending choices can time out without losing cards', () => {
  for (const type of ['draw', 'kit', 'store', 'bang', 'indians', 'duel']) {
    const g = game();
    while (g.pending) g.timeout();
    const pi = g.turn;
    if (type === 'draw') g.pending = { type, player: pi, options: ['deck', 'discard'] };
    if (type === 'kit') g.pending = { type, player: pi, cards: g.draw(3) };
    if (type === 'store') g.pending = { type, player: pi, cards: g.draw(4), order: [pi, (pi + 1) % 4, (pi + 2) % 4, (pi + 3) % 4] };
    if (['bang', 'indians', 'duel'].includes(type)) g.pending = { type, player: pi, source: (pi + 1) % 4, other: (pi + 1) % 4, need: 1, got: 0, barrels: 0 };
    while (g.pending) g.timeout();
    assert.equal(count(g), 80, type);
  }
});

test('forfeiting resolves choices and advances past departed players without losing cards', () => {
  for (const type of ['draw', 'kit', 'blackJack', 'store', 'bang', 'indians', 'duel', 'turn']) {
    const g = game();
    while (g.pending) g.timeout();
    // Keep Sheriff alive so this tests continuing a game as well as cleanup.
    const pi = (g.turn + 1) % 4;
    g.turn = pi;
    if (type === 'draw') g.pending = { type, player: pi, options: ['deck'] };
    if (type === 'kit') g.pending = { type, player: pi, cards: g.draw(3) };
    if (type === 'blackJack') g.pending = { type, player: pi, card: g.players[pi].hand[0], red: false };
    if (type === 'store') g.pending = { type, player: pi, cards: g.draw(4), order: [pi, (pi + 1) % 4, (pi + 2) % 4, (pi + 3) % 4] };
    if (['bang', 'indians'].includes(type)) g.pending = { type, player: pi, source: (pi + 1) % 4, need: 1, got: 0, barrels: 0 };
    if (type === 'duel') g.pending = { type, player: (pi + 1) % 4, other: pi };
    g.forfeit(g.players[pi].name);
    assert.equal(g.players[pi].alive, false, type);
    assert.equal(g.players[pi].hand.length, 0, type);
    assert.equal(count(g), 80, type);
    assert.notEqual(g.pending?.player, pi, type);
    if (type !== 'store') assert.notEqual(g.turn, pi, type);
    const r = { game: g, turnSeconds: 10 };
    syncTimer(r, 1000);
    assert.ok(r.clock.deadline > 1000, type);
  }
  const g = game();
  while (g.pending) g.timeout();
  const sheriff = g.players[g.turn];
  g.pending = { type: 'kit', player: (g.turn + 1) % 4, cards: g.draw(3) };
  g.forfeit(sheriff.name);
  assert.equal(g.winner, 'Outlaw');
  assert.equal(count(g), 80);
});

for (const dodgeCity of [false, true]) test(`room API protects settings and passwords, supports reconnect and games (Dodge City: ${dodgeCity})`, async () => {
  // Isolate generated accounts and sessions from the user's server data.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bang-settings-'));
  for (const file of ['server.js', 'game.js', 'power.js', 'room-timer.js', 'room-pause.js', 'room-bots.js']) fs.copyFileSync(path.join(__dirname, '..', file), path.join(dir, file));
  const soundsDir = path.join(dir, 'data', 'sounds');
  fs.mkdirSync(soundsDir, { recursive: true });
  const soundFixture = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
  const approvedSounds = [
    ['bangload.mp3', 'audio/mpeg'], ['indian1.mp3', 'audio/mpeg'],
    ['dynamite_start.wav', 'audio/wav'], ['dynamite_explode.wav', 'audio/wav'],
  ];
  const excludedSounds = ['dynamite.mp3', 'dynamitearmed.mp3', 'dynamiteexploded.mp3'];
  for (const file of [...approvedSounds.map(([file]) => file), ...excludedSounds]) {
    fs.writeFileSync(path.join(soundsDir, file), soundFixture);
  }
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const child = spawn(process.execPath, [path.join(dir, 'server.js')], { env: { ...process.env, PORT: String(port), BANG_DODGE_CITY_FILE: path.join(__dirname, '..', 'dodge-city.json') }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Server startup timed out')), 10000);
      child.stdout.once('data', () => { clearTimeout(timeout); resolve(); });
      child.once('error', reject);
      child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Server exited: ${code}`)); });
    });
    for (const [file, contentType] of approvedSounds) {
      const sample = await fetch(`http://127.0.0.1:${port}/sounds/${file}`);
      assert.equal(sample.status, 200);
      assert.equal(sample.headers.get('content-type'), contentType);
      assert.deepEqual(Buffer.from(await sample.arrayBuffer()), soundFixture);
    }
    for (const file of excludedSounds) assert.equal((await fetch(`http://127.0.0.1:${port}/sounds/${file}`)).status, 404);
    const cookies = [];
    async function request(user, url, body) {
      const res = await fetch(`http://127.0.0.1:${port}${url}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookies[user] || '' }, body: JSON.stringify(body),
      });
      const cookie = res.headers.get('set-cookie');
      if (cookie) cookies[user] = cookie.split(';')[0];
      return { status: res.status, body: await res.json() };
    }
    async function view(user, code) {
      const res = await fetch(`http://127.0.0.1:${port}/api/rooms/${code}/stream`, { headers: { Cookie: cookies[user] } });
      const reader = res.body.getReader();
      let text = '';
      while (!text.includes('\n\n')) text += new TextDecoder().decode((await reader.read()).value);
      await reader.cancel();
      return JSON.parse(text.split('\n\n')[0].slice(6)).room;
    }
    for (let i = 0; i < 4; i++) assert.equal((await request(i, '/api/register', { username: names[i], password: 'secret' })).status, 200);
    assert.equal((await request(0, '/api/rooms', { turnSeconds: 5 })).status, 400);
    for (const characterChoices of [0, 5, 1.5, '2']) assert.equal((await request(0, '/api/rooms', { characterChoices })).status, 400);
    for (const characterSeconds of [-1, 5, 601, '30']) assert.equal((await request(0, '/api/rooms', { characterSeconds })).status, 400);
    assert.equal((await request(4, '/api/register', { username: 'Watcher', password: 'secret' })).status, 200);
    const max = dodgeCity ? 8 : 7;
    const created = await request(0, '/api/rooms', { password: 'room-secret', turnSeconds: 10, dodgeCity });
    assert.equal(created.status, 200);
    const code = created.body.code;
    const url = `/api/rooms/${code}`;
    const denied = await request(1, url + '/join', {});
    assert.equal(denied.status, 403);
    assert.equal(denied.body.passwordRequired, true);
    assert.equal((await request(1, url + '/join', { password: 'wrong' })).status, 403);
    assert.equal((await request(1, url + '/join', { password: 'room-secret' })).status, 200);
    assert.equal((await request(1, url + '/settings', { password: '' })).status, 403);
    assert.equal((await request(1, url + '/add-bot', {})).status, 403);
    for (let i = 1; i <= max - 2; i++) {
      assert.equal((await request(0, url + '/add-bot', {})).status, 200);
      const state = await view(0, code);
      assert.equal(state.players.length, 2 + i);
      assert.equal(state.max, max);
      assert.equal(state.bots.length, i);
      assert.ok(state.online.includes(`Bot ${i}`));
    }
    assert.equal((await request(0, url + '/add-bot', {})).status, 400);
    assert.equal((await request(4, url + '/join', { password: 'room-secret' })).status, 200);
    assert.ok((await view(4, code)).spectators.includes('Watcher'));
    assert.equal((await request(4, url + '/spectator', { spectator: false })).status, 400);
    assert.equal((await request(0, url + '/kick', { player: 'Bot 1' })).status, 200);
    assert.equal((await request(4, url + '/spectator', { spectator: false })).status, 200);
    assert.equal((await view(4, code)).players.length, max);
    assert.equal((await request(0, url + '/start', { characterChoices: 3 })).status, 200);
    assert.equal((await view(0, code)).game.players.length, max);
    assert.equal((await request(4, url + '/leave', {})).status, 200);
    assert.equal((await request(0, url + '/add-bot', {})).status, 200);
    assert.equal((await request(1, url + '/kick', { player: 'Bot 1' })).status, 400);
    assert.equal((await request(0, url + '/kick', { player: 'Bot 1' })).status, 200);
    assert.equal((await request(0, url + '/add-bot', {})).status, 200);
    const withBots = await view(0, code);
    assert.equal(new Set(withBots.players).size, max);
    for (const player of withBots.bots) assert.equal((await request(0, url + '/kick', { player })).status, 200);
    assert.deepEqual((await view(0, code)).bots, []);
    assert.equal((await request(0, url + '/settings', { turnSeconds: 601, password: '' })).status, 400);
    let room = await view(0, code);
    assert.deepEqual(room.server, { features: ['endSummary'], stale: false });
    assert.equal(room.hasPassword, true);
    assert.equal(room.turnSeconds, 10);
    assert.ok(!JSON.stringify(room).includes('room-secret'));
    assert.ok(!JSON.stringify(room).includes('passwordHash'));
    assert.equal((await request(0, url + '/settings', { password: 'changed', turnSeconds: 20 })).status, 200);
    assert.equal((await request(1, url + '/join', {})).status, 200);
    assert.equal((await request(2, url + '/join', { password: 'room-secret' })).status, 403);
    assert.equal((await request(2, url + '/join', { password: 'changed' })).status, 200);
    assert.equal((await request(0, url + '/settings', { password: '' })).status, 200);
    assert.equal((await request(3, url + '/join', {})).status, 200);
    // A spectator host retains room controls, but does not count toward starting.
    assert.equal((await request(0, url + '/spectator', { spectator: 'yes' })).status, 400);
    assert.equal((await request(0, url + '/spectator', { spectator: true })).status, 200);
    room = await view(0, code);
    assert.equal(room.host, names[0]);
    assert.equal(room.players.length, 3);
    assert.deepEqual(room.spectators, [names[0]]);
    assert.equal((await request(0, url + '/start', {})).status, 400);
    assert.equal((await request(0, url + '/spectator', { spectator: false })).status, 200);
    assert.equal((await request(4, url + '/join', {})).status, 200);
    assert.equal((await request(4, url + '/spectator', { spectator: true })).status, 200);
    assert.equal((await request(4, '/api/rooms', {})).status, 400);
    assert.equal((await request(0, url + '/chat', { text: 'hello' })).status, 200);
    assert.equal((await request(1, url + '/settings', { characterChoices: 4 })).status, 403);
    assert.equal((await request(0, url + '/start', { characterChoices: 4, characterSeconds: 45 })).status, 200);
    room = await view(0, code);
    assert.equal(room.characterChoices, 4);
    assert.equal(room.characterSeconds, 45);
    assert.equal(room.game.phase, 'character');
    assert.equal(room.timer.character, true);
    assert.ok(room.timer.deadline - room.serverNow > 40000);
    const watching = await view(4, code);
    assert.equal(watching.game.me, null);
    assert.equal(watching.game.pending.options, undefined);
    assert.equal(watching.game.players.length, 4);
    assert.equal(watching.game.players.filter((p) => p.role).length, 1);
    assert.equal((await request(4, url + '/spectator', { spectator: false })).status, 400);
    assert.equal((await request(4, url + '/action', { action: { type: 'chooseCharacter', character: 'Bart Cassidy' } })).status, 403);
    // Leaving while characters are being chosen must not reset the game.
    assert.equal((await request(4, url + '/leave', {})).status, 200);
    assert.equal((await view(0, code)).game.phase, 'character');
    for (let i = 0; i < 4; i++) {
      const user = names.indexOf(room.game.players[room.game.pending.player].name);
      const own = await view(user, code);
      assert.equal(own.game.pending.options.length, 4);
      assert.equal((await request(user, url + '/action', { action: { type: 'chooseCharacter', character: own.game.pending.options[0] } })).status, 200);
      room = await view(0, code);
    }
    assert.equal((await request(0, url + '/settings', { turnSeconds: 0 })).status, 400);
    assert.equal((await request(0, url + '/add-bot', {})).status, 400);
    room = await view(1, code);
    assert.equal(room.hasPassword, false);
    assert.equal(room.turnSeconds, 20);
    assert.ok(room.timer.deadline > room.serverNow);
    assert.ok(room.chat.some((m) => m.user === names[0] && m.text === 'hello'));
    assert.ok(room.game.me.hand);
    assert.equal(room.game.phase, 'draw');
    assert.equal(room.timer.draw, true);
    const drawDeadline = room.timer.deadline;
    assert.equal((await view(2, code)).timer.deadline, drawDeadline);
    const drawingUser = names.indexOf(room.game.players[room.game.turn].name);
    const drawingView = await view(drawingUser, code);
    const handBefore = drawingView.game.me.hand.length;
    assert.equal((await request(drawingUser, url + '/action', { action: { type: 'drawChoice', from: 'deck' } })).status, 200);
    let drawn = await view(drawingUser, code);
    if (drawn.game.pending?.type === 'kit') {
      assert.equal((await request(drawingUser, url + '/action', { action: { type: 'kit', cardIds: drawn.game.pending.cards.slice(0, 2).map((c) => c.id) } })).status, 200);
      drawn = await view(drawingUser, code);
    }
    if (drawn.game.pending?.type === 'blackJack') {
      assert.equal(drawn.timer.seconds, 3);
      await new Promise((resolve) => setTimeout(resolve, 3300));
      drawn = await view(drawingUser, code);
    }
    assert.equal(drawn.game.phase, 'play');
    assert.ok(drawn.game.me.hand.length >= handBefore + 2);
    assert.ok(drawn.timer.deadline - drawn.serverNow > 19000);
    assert.ok(drawn.game.transfers.length);
    // Mid-game joining becomes spectating, with public views on reconnect.
    assert.equal((await request(4, url + '/join', {})).status, 200);
    const publicRoom = await view(4, code);
    assert.equal(publicRoom.game.me, null);
    assert.ok(publicRoom.spectators.includes('Watcher'));
    assert.ok(publicRoom.game.players.every((p) => !('hand' in p)));
    assert.equal(publicRoom.game.players.filter((p) => p.role).length, 1);
    assert.ok(publicRoom.game.transfers.every((e) => e.from === 'discard' || e.cards.every((c) => c === null)));
    assert.equal((await request(4, url + '/action', { action: { type: 'endTurn' } })).status, 403);
    assert.equal((await request(4, url + '/pause', { type: 'request' })).status, 403);
    assert.equal((await request(4, url + '/chat', { text: 'Watching!' })).status, 200);
    // Pause state is shared on reconnect; only unanimous votes stop game actions.
    assert.equal((await request(0, url + '/pause', { type: 'request' })).status, 200);
    room = await view(1, code);
    const pauseId = room.pause.id;
    assert.ok(!room.pause.voters.includes('Watcher'));
    assert.equal((await request(4, url + '/pause', { type: 'vote', id: pauseId, agree: true })).status, 403);
    assert.equal((await request(4, url + '/leave', {})).status, 200);
    assert.equal((await view(1, code)).pause.id, pauseId);
    assert.equal(room.pause.requester, names[0]);
    assert.equal(room.pause.frozen, false);
    assert.equal((await request(0, url + '/pause', { type: 'vote', id: pauseId, agree: true })).status, 400);
    assert.equal((await request(1, url + '/pause', { type: 'vote', id: pauseId - 1, agree: true })).status, 400);
    for (let i = 1; i < 4; i++) assert.equal((await request(i, url + '/pause', { type: 'vote', id: pauseId, agree: true })).status, 200);
    room = await view(2, code);
    assert.equal(room.pause.phase, 'paused');
    assert.equal(room.pause.frozen, true);
    assert.ok(room.pause.deadline - room.serverNow > 59000);
    assert.equal((await request(1, url + '/action', { action: { type: 'sid', cardIds: [] } })).body.error, 'Ván chơi đang tạm dừng.');
    assert.equal((await request(1, url + '/pause', { type: 'resume', id: pauseId })).status, 400);
    assert.equal((await request(2, url + '/chat', { text: 'paused chat' })).status, 200);
    assert.equal((await request(0, url + '/pause', { type: 'resume', id: pauseId })).status, 200);
    assert.equal((await view(1, code)).pause, null);
    assert.equal((await request(0, url + '/pause', { type: 'request' })).status, 200);
    room = await view(1, code);
    assert.equal((await request(3, url + '/pause', { type: 'vote', id: room.pause.id, agree: false })).status, 200);
    assert.equal((await view(1, code)).pause, null);
    assert.equal((await request(1, url + '/join', {})).status, 200);
    assert.equal((await request(0, url + '/pause', { type: 'request' })).status, 200);
    assert.equal((await request(0, url + '/leave', {})).status, 200);
    room = await view(1, code);
    assert.equal(room.host, names[1]);
    assert.equal(room.pause, null);
    assert.ok(!room.players.includes(names[0]));
    assert.equal(room.game.players.find((p) => p.name === names[0]).alive, false);
    assert.equal((await request(0, url + '/action', { action: { type: 'endTurn' } })).status, 403);
    assert.equal((await request(0, url + '/pause', { type: 'request' })).status, 403);
    // Start another room and leave during character selection.
    const next = await request(0, '/api/rooms', {});
    for (let i = 1; i < 4; i++) {
      assert.equal((await request(i, url + '/leave', {})).status, 200);
      assert.equal((await request(i, `/api/rooms/${next.body.code}/join`, {})).status, 200);
    }
    const nextUrl = `/api/rooms/${next.body.code}`;
    assert.equal((await request(0, nextUrl + '/start', { characterChoices: 2, characterSeconds: 10, turnSeconds: 30 })).status, 200);
    assert.equal((await request(0, nextUrl + '/leave', {})).status, 200);
    room = await view(1, next.body.code);
    assert.equal(room.status, 'waiting');
    assert.equal(room.game, null);
    assert.equal(room.timer, null);
    // Host succession skips bots, and the last human leaving deletes a bot room.
    for (let i = 1; i < 4; i++) assert.equal((await request(i, nextUrl + '/leave', {})).status, 200);
    const botRoom = await request(0, '/api/rooms', {});
    const botUrl = `/api/rooms/${botRoom.body.code}`;
    assert.equal((await request(0, botUrl + '/add-bot', {})).status, 200);
    assert.equal((await request(1, botUrl + '/join', {})).status, 200);
    assert.equal((await request(0, botUrl + '/leave', {})).status, 200);
    assert.equal((await view(1, botRoom.body.code)).host, names[1]);
    assert.equal((await request(1, botUrl + '/leave', {})).status, 200);
    assert.equal((await request(0, botUrl + '/join', {})).status, 404);
  } finally {
    child.kill();
    await new Promise((resolve) => child.exitCode !== null ? resolve() : child.once('exit', resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('room view warns when the code on disk is newer than the running server', async () => {
  // Bản sao riêng để sửa game.js mà không đụng vào mã thật.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bang-stale-'));
  for (const file of ['server.js', 'game.js', 'power.js', 'room-timer.js', 'room-pause.js', 'room-bots.js']) fs.copyFileSync(path.join(__dirname, '..', file), path.join(dir, file));
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const child = spawn(process.execPath, [path.join(dir, 'server.js')], { env: { ...process.env, PORT: String(port), BANG_CODE_CHECK_MS: '100' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Server startup timed out')), 10000);
      child.stdout.once('data', () => { clearTimeout(timeout); resolve(); });
      child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Server exited: ${code}`)); });
    });
    const base = `http://127.0.0.1:${port}`;
    const login = await fetch(base + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'Stale', password: 'secret' }) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const created = await (await fetch(base + '/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: '{}' })).json();
    async function server() {
      const res = await fetch(`${base}/api/rooms/${created.code}/stream`, { headers: { Cookie: cookie } });
      const reader = res.body.getReader();
      let text = '';
      while (!text.includes('\n\n')) text += new TextDecoder().decode((await reader.read()).value);
      await reader.cancel();
      return JSON.parse(text.split('\n\n')[0].slice(6)).room.server;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.deepEqual(await server(), { features: ['endSummary'], stale: false });
    fs.appendFileSync(path.join(dir, 'game.js'), '\n// cập nhật giả lập\n');
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.deepEqual(await server(), { features: ['endSummary'], stale: true });
  } finally {
    child.kill();
    await new Promise((resolve) => child.exitCode !== null ? resolve() : child.once('exit', resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

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
    if (turnSeconds) assert.equal(r.clock.deadline, 61000);
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
  assert.equal(r.clock.deadline, 21000);
  assert.equal(count(g), 80);
  r.turnSeconds = 0;
  assert.equal(tickTimer(r, 50000), false);
  assert.equal(r.clock, null);
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
  for (const type of ['draw', 'kit', 'store', 'bang', 'indians', 'duel', 'turn']) {
    const g = game();
    while (g.pending) g.timeout();
    // Keep Sheriff alive so this tests continuing a game as well as cleanup.
    const pi = (g.turn + 1) % 4;
    g.turn = pi;
    if (type === 'draw') g.pending = { type, player: pi, options: ['deck'] };
    if (type === 'kit') g.pending = { type, player: pi, cards: g.draw(3) };
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

test('room API protects settings and passwords, supports reconnect and games', async () => {
  // Isolate generated accounts and sessions from the user's server data.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bang-settings-'));
  for (const file of ['server.js', 'game.js', 'room-timer.js']) fs.copyFileSync(path.join(__dirname, '..', file), path.join(dir, file));
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const child = spawn(process.execPath, [path.join(dir, 'server.js')], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Server startup timed out')), 10000);
      child.stdout.once('data', () => { clearTimeout(timeout); resolve(); });
      child.once('error', reject);
      child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Server exited: ${code}`)); });
    });
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
    const created = await request(0, '/api/rooms', { password: 'room-secret', turnSeconds: 10 });
    assert.equal(created.status, 200);
    const code = created.body.code;
    const url = `/api/rooms/${code}`;
    const denied = await request(1, url + '/join', {});
    assert.equal(denied.status, 403);
    assert.equal(denied.body.passwordRequired, true);
    assert.equal((await request(1, url + '/join', { password: 'wrong' })).status, 403);
    assert.equal((await request(1, url + '/join', { password: 'room-secret' })).status, 200);
    assert.equal((await request(1, url + '/settings', { password: '' })).status, 403);
    assert.equal((await request(0, url + '/settings', { turnSeconds: 601, password: '' })).status, 400);
    let room = await view(0, code);
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
    assert.equal((await request(0, url + '/chat', { text: 'hello' })).status, 200);
    assert.equal((await request(1, url + '/settings', { characterChoices: 4 })).status, 403);
    assert.equal((await request(0, url + '/start', { characterChoices: 4, characterSeconds: 45 })).status, 200);
    room = await view(0, code);
    assert.equal(room.characterChoices, 4);
    assert.equal(room.characterSeconds, 45);
    assert.equal(room.game.phase, 'character');
    assert.equal(room.timer.character, true);
    assert.ok(room.timer.deadline - room.serverNow > 40000);
    for (let i = 0; i < 4; i++) {
      const user = names.indexOf(room.game.players[room.game.pending.player].name);
      const own = await view(user, code);
      assert.equal(own.game.pending.options.length, 4);
      assert.equal((await request(user, url + '/action', { action: { type: 'chooseCharacter', character: own.game.pending.options[0] } })).status, 200);
      room = await view(0, code);
    }
    assert.equal((await request(0, url + '/settings', { turnSeconds: 0 })).status, 400);
    room = await view(1, code);
    assert.equal(room.hasPassword, false);
    assert.equal(room.turnSeconds, 20);
    assert.ok(room.timer.deadline > room.serverNow);
    assert.ok(room.chat.some((m) => m.user === names[0] && m.text === 'hello'));
    assert.ok(room.game.me.hand);
    assert.equal((await request(1, url + '/join', {})).status, 200);
    assert.equal((await request(0, url + '/leave', {})).status, 200);
    room = await view(1, code);
    assert.equal(room.host, names[1]);
    assert.ok(!room.players.includes(names[0]));
    assert.equal(room.game.players.find((p) => p.name === names[0]).alive, false);
    assert.equal((await request(0, url + '/action', { action: { type: 'endTurn' } })).status, 403);
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
  } finally {
    child.kill();
    await new Promise((resolve) => child.exitCode !== null ? resolve() : child.once('exit', resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

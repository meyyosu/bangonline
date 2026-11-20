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

test('character choice: X distinct characters each, game starts once everyone picks', () => {
  const g = new Game(names, { rng: () => 0.4, charChoices: 3 });
  assert.equal(g.phase, 'choose');
  const all = g.players.flatMap((p) => p.choices);
  assert.equal(all.length, 12);
  assert.equal(new Set(all).size, 12);
  assert.equal(count(g), 80);
  assert.throws(() => g.act(g.players[0].name, { type: 'endTurn' }));
  assert.throws(() => g.act(g.players[0].name, { type: 'chooseChar', char: g.players[1].choices[0] }));
  const want = g.players.map((p) => p.choices[2]);
  g.players.slice(0, 3).forEach((p, i) => g.act(p.name, { type: 'chooseChar', char: want[i] }));
  assert.equal(g.phase, 'choose');
  assert.equal(g.viewFor(names[0]).players.find((p) => p.name === g.players[0].name).picked, true);
  g.act(g.players[3].name, { type: 'chooseChar', char: want[3] });
  assert.notEqual(g.phase, 'choose');
  g.players.forEach((p, i) => { assert.equal(p.char, want[i]); assert.equal(p.hand.length >= p.maxHp, true); });
  assert.equal(count(g), 80);
  // 7 người: 16 nhân vật chỉ đủ 2 lá mỗi người; hết giờ thì tự chọn lá đầu
  const g7 = new Game(['a1', 'b2', 'c3', 'd4', 'e5', 'f6', 'g7'], { charChoices: 3 });
  assert.equal(g7.players[0].choices.length, 2);
  const first = g7.players.map((p) => p.choices[0]);
  g7.timeout();
  assert.deepEqual(g7.players.map((p) => p.char), first);
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
    assert.equal((await request(0, url + '/settings', { charChoices: 6 })).status, 400);
    assert.equal((await request(0, url + '/settings', { charChoices: 2 })).status, 200);
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
    assert.equal((await request(0, url + '/start', {})).status, 200);
    assert.equal((await request(0, url + '/settings', { turnSeconds: 0 })).status, 400);
    room = await view(1, code);
    assert.equal(room.hasPassword, false);
    assert.equal(room.turnSeconds, 20);
    assert.ok(room.timer.deadline > room.serverNow);
    assert.equal(room.chat.at(-2).text, 'hello');
    assert.ok(room.game.me.hand);
    assert.equal(room.charChoices, 2);
    assert.equal(room.game.phase, 'choose');
    assert.equal(room.game.me.choices.length, 2);
    assert.equal(room.game.players.filter((p) => p.char).length, 0, 'nhân vật chưa lộ khi đang chọn');
    assert.equal((await request(1, url + '/join', {})).status, 200);
  } finally {
    child.kill();
    await new Promise((resolve) => child.exitCode !== null ? resolve() : child.once('exit', resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

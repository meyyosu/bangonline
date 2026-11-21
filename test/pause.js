'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Game } = require('../game');
const { syncTimer, tickTimer } = require('../room-timer');
const { pauseAction, finishPause, pauseView } = require('../room-pause');

const names = ['Alice', 'Bobby', 'Carol', 'David'];
function room(options = {}) {
  const r = { players: [...names], game: new Game(names, { rng: () => 0.4, ...options }),
    status: 'playing', turnSeconds: 20, characterSeconds: 30, chat: [] };
  if (r.game.phase === 'draw') r.game.timeout();
  syncTimer(r, 1000);
  return r;
}
function request(r, now = 2000) { pauseAction(r, names[0], { type: 'request' }, now); }
function vote(r, name, agree, now) { pauseAction(r, name, { type: 'vote', id: r.pause.id, agree }, now); }
function unanimous(r, now) { for (const name of names.slice(1)) vote(r, name, true, now); }

test('one refusal or a missing vote cancels; initial voting keeps the game clock running', () => {
  const r = room();
  request(r);
  const deadline = r.clock.deadline;
  assert.equal(r.pause.deadline, 12000);
  vote(r, names[1], true, 3000);
  assert.throws(() => vote(r, names[1], false, 4000));
  vote(r, names[2], true, 5000);
  assert.equal(tickTimer(r, 11999), false);
  assert.equal(tickTimer(r, 12000), true);
  assert.equal(r.pause, null);
  assert.equal(r.clock.deadline, deadline);
  request(r, 12500);
  vote(r, names[1], false, 13000);
  assert.equal(r.pause, null);
  assert.equal(r.clock.deadline, deadline);
});

test('unanimous pause freezes pending response and preserves both response and turn time', () => {
  const r = room();
  while (r.game.pending) r.game.timeout();
  syncTimer(r, 2000);
  const target = (r.game.turn + 1) % 4;
  r.game.pending = { type: 'bang', player: target, source: r.game.turn, need: 1, got: 0, barrels: 0 };
  syncTimer(r, 4000);
  const pending = r.game.pending;
  const savedTurn = r.clock.remaining;
  request(r, 5000);
  unanimous(r, 6000);
  assert.equal(r.pause.deadline, 66000);
  assert.equal(pauseView(r).frozen, true);
  assert.equal(tickTimer(r, 50000), false);
  assert.equal(r.game.pending, pending);
  assert.equal(r.clock.deadline, 24000);
  pauseAction(r, names[0], { type: 'resume', id: r.pause.id }, 51000);
  assert.equal(r.pause, null);
  assert.equal(r.clock.deadline, 69000);
  assert.equal(r.clock.remaining, savedTurn);
  assert.equal(tickTimer(r, 68999), false);
  assert.equal(tickTimer(r, 69000), true);
  assert.equal(r.game.pending, null);
  assert.equal(r.clock.deadline, 69000 + savedTurn);
});

test('renewal repeats, rejects stale votes and resumes on refusal or 10-second expiry', () => {
  for (const refusal of [true, false]) {
    const r = room();
    request(r);
    unanimous(r, 3000);
    const firstId = r.pause.id;
    assert.equal(tickTimer(r, 63000), true);
    assert.equal(r.pause.renewal, true);
    assert.equal(r.pause.phase, 'voting');
    assert.equal(r.pause.deadline, 73000);
    assert.notEqual(r.pause.id, firstId);
    assert.deepEqual(r.pause.accepted, []);
    assert.equal(pauseView(r).frozen, true);
    assert.throws(() => pauseAction(r, names[1], { type: 'vote', id: firstId, agree: true }, 64000));
    unanimous(r, 65000);
    assert.equal(r.pause.deadline, 125000);
    assert.equal(tickTimer(r, 125000), true);
    assert.equal(r.pause.phase, 'voting');
    if (refusal) vote(r, names[2], false, 126000);
    else assert.equal(tickTimer(r, 135000), true);
    assert.equal(r.pause, null);
    const resumed = refusal ? 126000 : 135000;
    assert.equal(r.clock.deadline, resumed + 18000);
  }
});

test('requester alone can resume, including during renewal; departed players invalidate pause', () => {
  const r = room();
  request(r);
  assert.throws(() => request(r));
  assert.throws(() => vote(r, names[0], true, 3000));
  assert.throws(() => vote(r, 'Outsider', true, 3000));
  assert.throws(() => vote(r, names[1], 'yes', 3000));
  unanimous(r, 3000);
  assert.throws(() => pauseAction(r, names[1], { type: 'resume', id: r.pause.id }, 4000));
  tickTimer(r, 63000);
  pauseAction(r, names[0], { type: 'resume', id: r.pause.id }, 64000);
  assert.equal(r.pause, null);
  assert.equal(r.clock.deadline, 82000);
  request(r, 65000);
  unanimous(r, 66000);
  r.players.shift();
  assert.equal(tickTimer(r, 67000), true);
  assert.equal(r.pause, null);
});

test('pause works with character selection, no turn timer, and cleans up ended games', () => {
  for (const characterChoices of [1, 4]) {
    const r = room({ characterChoices });
    const pending = r.game.pending;
    const deadline = r.clock.deadline;
    request(r);
    unanimous(r, 3000);
    tickTimer(r, 50000);
    assert.equal(r.game.pending, pending);
    finishPause(r, 'Left', 51000);
    assert.equal(r.clock.deadline, deadline + 48000);
    request(r, 52000);
    unanimous(r, 53000);
    r.game.winner = 'Outlaw';
    tickTimer(r, 54000);
    assert.equal(r.pause, null);
    assert.equal(r.clock, null);
    assert.throws(() => request(r, 55000));
  }
  const r = room();
  r.turnSeconds = 0;
  syncTimer(r, 1000);
  request(r);
  unanimous(r, 3000);
  tickTimer(r, 63000);
  assert.equal(r.pause.phase, 'voting');
  assert.equal(r.clock, null);
});

test('draw grace period freezes during unanimous pause', () => {
  const r = room();
  r.game.beginDraw();
  syncTimer(r, 1000);
  assert.equal(r.clock.deadline, 6000);
  request(r, 2000);
  unanimous(r, 3000);
  assert.equal(tickTimer(r, 50000), false);
  assert.equal(r.game.phase, 'draw');
  finishPause(r, 'Continue', 51000);
  assert.equal(r.clock.deadline, 54000);
  assert.equal(tickTimer(r, 53999), false);
  assert.equal(tickTimer(r, 54000), true);
  assert.equal(r.game.phase, 'play');
  assert.equal(r.clock.deadline, 74000);
});

test('card flights use the deck, discard, or donor hand and skip old events', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const fn = source.slice(source.indexOf('function showCardTransfers('), source.indexOf('// ---------- rút kiểm tra:'));
  for (const from of ['deck', 'discard', 1]) {
    const rect = (left) => ({ getBoundingClientRect: () => ({ left, top: 100, width: 56, height: 78 }) });
    const origin = rect(200), destination = rect(600), flyers = [];
    let reduced = false;
    const context = {
      window: { matchMedia: () => ({ matches: reduced }) },
      $: (selector) => selector.startsWith('#hand') ? destination : origin,
      cardHTML: () => '<div class="card">Known card</div>',
      document: {
        querySelectorAll: () => [{ dataset: { player: 'Donor' }, querySelector: () => origin }],
        body: { appendChild: (el) => flyers.push(el) },
        createElement: () => ({ style: {}, setAttribute() {}, remove() { this.removed = true; },
          animate(frames, options) { this.frames = frames; this.options = options; return this.animation = {}; } }),
      },
    };
    vm.createContext(context);
    vm.runInContext(fn, context);
    const previous = { transfers: [{ seq: 1 }] };
    const g = { me: { index: 0 }, players: [{ name: 'Recipient' }, { name: 'Donor' }],
      transfers: [{ seq: 1, from, to: 0, cards: [null] }, { seq: 2, from, to: 0, cards: [null, { id: 8 }] }] };
    context.showCardTransfers(g, previous);
    assert.equal(flyers.length, 2);
    assert.equal(flyers[0].style.left, '200px');
    assert.ok(flyers[0].frames.at(-1).transform.includes('translate(400px, 0px)'));
    assert.ok(flyers[0].innerHTML.includes('card-back'));
    assert.ok(flyers[1].innerHTML.includes('Known card'));
    assert.ok(flyers[1].options.delay > flyers[0].options.delay);
    flyers[0].animation.onfinish();
    assert.equal(flyers[0].removed, true);
    context.showCardTransfers(g, null);
    reduced = true;
    context.showCardTransfers(g, previous);
    assert.equal(flyers.length, 2);
  }
});

test('public play animations use the local hand or opponent seat and do not replay SSE history', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const fn = source.slice(source.indexOf('function showPlayedCards('), source.indexOf('function animatePlayedCard('));
  const rendered = [], ownHand = { left: 600, top: 300, width: 76, height: 104 };
  const seat = { dataset: { player: 'Opponent' }, querySelector: () => ({ getBoundingClientRect: () => ({ left: 200, top: 100, width: 20, height: 24 }) }) };
  const context = { document: { querySelectorAll: () => [seat] }, animatePlayedCard: (...args) => rendered.push(args) };
  vm.createContext(context);
  vm.runInContext(fn, context);
  const g = { me: { index: 0 }, players: [{ name: 'Me' }, { name: 'Opponent' }], plays: [
    { seq: 1, player: 1, card: { id: 1 } },
    { seq: 2, player: 0, card: { id: 2 } },
    { seq: 3, player: 1, card: { id: 3 }, recipient: 0 },
    { seq: 4, player: 1, card: { id: 4 }, recipient: null, kind: 'discard' },
    { seq: 5, player: 1, card: { id: 5 }, recipient: null, kind: 'discard' },
  ] };
  context.showPlayedCards(g, { plays: [{ seq: 1 }] }, { 2: ownHand });
  assert.equal(rendered.length, 4);
  assert.equal(rendered[0][1], ownHand);
  assert.equal(rendered[1][1].left, 182);
  assert.equal(rendered[1][1].top, 73);
  assert.equal(rendered[1][2].target, 'Me');
  assert.equal(rendered[2][2].kind, 'discard');
  assert.equal(rendered[2][2].delay, 0);
  assert.equal(rendered[3][2].delay, 110);
  context.showPlayedCards(g, g);
  context.showPlayedCards(g, null);
  assert.equal(rendered.length, 4);
});

test('desktop buttons send authenticated votes; expired votes open the game', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/pause-notifications.js'), 'utf8');
  for (const action of ['agree', 'reject', '']) {
    for (const expired of [false, true]) {
      let click, work, closed = false, focused = false;
      const requests = [];
      vm.runInNewContext(source, {
        self: {
          addEventListener: (type, handler) => { if (type === 'notificationclick') click = handler; },
          location: { origin: 'https://bang.test' },
          clients: { matchAll: async () => [{ url: 'https://bang.test/#ABCD', focus: async () => { focused = true; } }] },
        }, URL, Date,
        fetch: async (url, options) => { requests.push({ url, options }); return { ok: true }; },
      });
      click({ action, notification: { data: { code: 'ABCD', id: 2, deadline: Date.now() + (expired ? -1000 : 10000) }, close: () => { closed = true; } },
        waitUntil: (promise) => { work = promise; } });
      await work;
      assert.equal(closed, true);
      if (action && !expired) {
        assert.equal(requests.length, 1);
        assert.equal(requests[0].url, '/api/rooms/ABCD/pause');
        assert.equal(requests[0].options.credentials, 'same-origin');
        assert.deepEqual(JSON.parse(requests[0].options.body), { type: 'vote', id: 2, agree: action === 'agree' });
        assert.equal(focused, false);
      } else {
        assert.equal(requests.length, 0);
        assert.equal(focused, true);
      }
    }
  }
});

'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
function functionSource(name, next) {
  return source.slice(source.indexOf(`function ${name}(`), source.indexOf(`function ${next}(`));
}

function client() {
  const layers = [];
  const nodes = new Map();
  const rect = { left: 100, top: 100, right: 180, bottom: 220, width: 80, height: 120 };
  const element = () => ({
    children: [],
    style: {}, classList: { add() {}, remove() {}, contains() { return false; } },
    appendChild(child) { this.children.push(child); }, getBoundingClientRect: () => rect,
  });
  for (const selector of ['#deck', '.arena', '#roomName', '#roomBtns', '#chatBox', '#logPanel']) {
    nodes.set(selector, element());
  }
  const context = {
    ui: {}, ME: 'Alice', ROOM: { name: 'Room', host: 'Alice', game: null, chat: [] },
    $: (selector) => nodes.get(selector),
    document: { createElement: element, body: { appendChild: (layer) => layers.push(layer) } },
    window: { scrollX: 0, scrollY: 0, innerHeight: 900 },
    CHECK_INFO: { Barrel: { icon: '', win: ['Win', ''], lose: ['Lose', ''] } },
    esc: String, cardHTML: () => '<div>card</div>',
    requestAnimationFrame: (fn) => fn(), setTimeout() {},
    updateClock() {}, updateChatUnread() {}, renderPause() {}, clearMatchResult() {},
    renderWaiting() {}, renderGame() {}, renderMatchResult() {},
  };
  vm.createContext(context);
  vm.runInContext(functionSource('showCheckReveal', 'isClickable'), context);
  vm.runInContext(functionSource('renderRoom', 'roomSettingsBody'), context);
  return { context, nodes, layers };
}

const game = (seq, kind = 'Barrel', cards = [{ id: 1, name: 'Bang', rank: 'A', suit: 'H' }]) => ({
  players: [{ name: 'Alice' }],
  lastCheck: seq == null ? null : { seq, kind, player: 0, cards, chosen: cards[0].id, ok: true },
});

test('Barrel/Jail/Dynamite reveals repeat across games without a browser reload', () => {
  const { context: c, layers } = client();
  for (let match = 0; match < 3; match++) {
    c.renderRoom(); // về phòng chờ rồi bắt đầu ván mới
    c.showCheckReveal(game(null));
    for (let seq = 1; seq <= 6; seq++) {
      c.showCheckReveal(game(seq, ['Barrel', 'Jail', 'Dynamite'][(seq - 1) % 3]));
      assert.equal(layers.length, match * 6 + seq);
      c.showCheckReveal(game(seq)); // SSE/chat/vẽ lại không phát trùng
      assert.equal(layers.length, match * 6 + seq);
    }
  }
});

test('a new game snapshot resets the check sequence even if the waiting snapshot was missed', () => {
  const { context: c, layers } = client();
  c.showCheckReveal(game(null));
  c.showCheckReveal(game(12));
  c.showCheckReveal(game(null));
  c.showCheckReveal(game(1, 'Jail'));
  assert.equal(layers.length, 2);
});

test('joining an ongoing game skips the old reveal and plays the next check', () => {
  const { context: c, layers } = client();
  c.showCheckReveal(game(5));
  assert.equal(layers.length, 0);
  c.showCheckReveal(game(6));
  assert.equal(layers.length, 1);
});

test('a check is not consumed before the board is available; Lucky Duke still reveals both cards', () => {
  const { context: c, nodes, layers } = client();
  c.showCheckReveal(game(null));
  const deck = nodes.get('#deck');
  nodes.delete('#deck');
  const check = game(1, 'Barrel', [{ id: 1 }, { id: 2 }]);
  c.showCheckReveal(check);
  assert.equal(layers.length, 0);
  nodes.set('#deck', deck);
  c.showCheckReveal(check);
  assert.equal(layers.length, 1);
  assert.equal(layers[0].children.filter((child) => child.className.startsWith('flyer')).length, 2);
  assert.equal(c.ui.lastCheckSeq, 1);
});

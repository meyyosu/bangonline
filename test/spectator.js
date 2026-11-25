'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Game, CARD_INFO, CHAR_INFO, ROLE_INFO } = require('../game');

const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
function section(name, next) {
  return source.slice(source.indexOf(`function ${name}(`), source.indexOf(`function ${next}(`));
}

test('spectator client renders character selection, live play and results without private controls', () => {
  const nodes = new Map();
  const node = () => ({ innerHTML: '', querySelectorAll: () => [], remove() {} });
  const c = {
    ME: 'Watcher', ROOM: {}, META: { cards: CARD_INFO, chars: CHAR_INFO, roles: ROLE_INFO },
    ui: { mode: { kind: 'sid' }, selected: [1] },
    $: (key) => { if (key === '#confirmCharacter') return null; if (!nodes.has(key)) nodes.set(key, node()); return nodes.get(key); },
    document: { querySelectorAll: () => [] },
    window: { matchMedia: () => ({ matches: false, addEventListener() {} }) },
    esc: (s) => String(s ?? ''), ROLE_VI: {}, ROLE_ICON: {}, CHAR_ICON: {},
    tooltipAttrs: () => '', charTipAttrs: () => '', logLineHTML: (line) => line,
    roleBadge: () => '', hpBarHTML: () => '', handFanHTML: () => '',
    playerAvatarHTML: () => '', jailBarsHTML: () => '', discardStackHTML: () => '',
    drawStageHTML: () => '', animateDrawStage() {}, showCheckReveal() {}, updateClock() {}, renderTurnRing() {},
    winnerHTML: () => '<div>Results</div>',
  };
  vm.createContext(c);
  for (const [name, next] of [
    ['renderCharacterSelection', 'renderGame'], ['renderGame', 'drawStageHTML'],
    ['promptHTML', 'actionsHTML'], ['bindGame', 'chooseTargetCard'],
  ]) vm.runInContext(section(name, next), c);
  const g = new Game(['Alice', 'Bobby', 'Carol', 'David'], { characterChoices: 3 });
  c.ROOM = { code: 'TEST', online: [], game: g.viewFor(null) };
  c.renderGame();
  assert.match(nodes.get('#mainArea').innerHTML, /Bạn đang xem trận đấu/);
  assert.doesNotMatch(nodes.get('#mainArea').innerHTML, /id="confirmCharacter"|class="rolecard/);
  while (g.phase === 'character') g.timeout();
  for (const phase of ['draw', 'play', 'ended']) {
    if (phase === 'play') while (g.pending) g.timeout();
    if (phase === 'ended') g.winner = 'Outlaw';
    c.ROOM.game = g.viewFor(null);
    c.renderGame();
    const html = nodes.get('#mainArea').innerHTML;
    assert.match(html, /Bạn đang xem trận đấu/);
    assert.match(html, /class="arena\b/);
    assert.doesNotMatch(html, /id="hand"|id="actions"|data-act=/);
    assert.equal(c.ui.mode, null);
  }
  g.winner = null;
  g.pending = { type: 'store', player: 0, cards: [g.deck[0]] };
  c.cardHTML = (card) => `<div>${card.name}</div>`;
  c.ROOM.game = g.viewFor(null);
  c.renderGame();
  assert.match(nodes.get('#mainArea').innerHTML, /General Store/);
  assert.doesNotMatch(nodes.get('#mainArea').innerHTML, /id="storeCards"/);
});

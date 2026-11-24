'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { Game } = require('../game');
const { tickBots } = require('../room-bots');

module.exports = async function verifyMainFeatures(page, names) {
  const game = new Game(names.slice(0, 4), { rng: () => .4, dodgeCity: true });
  while (game.pending) game.timeout();
  for (const p of game.players) p.char = 'Willy the Kid';
  const me = game.players.find((p) => p.name === names[0]);
  game.turn = game.idx(me.name);
  const moveCard = (name) => {
    const piles = [game.deck, game.discard, ...game.players.map((p) => p.hand)];
    const pile = piles.find((cards) => cards.some((c) => c.name === name));
    const [card] = pile.splice(pile.findIndex((c) => c.name === name), 1);
    me.hand.push(card);
    return card;
  };
  moveCard('Bang'); moveCard('Beer'); moveCard('Bang');
  await page.evaluate((view) => {
    window.mainSavedRoom = ROOM;
    ROOM = { ...ROOM, game: view, timer: { player: view.turn, deadline: Date.now() + 60000, seconds: 60 } };
    ui.serverOffset = 0;
    renderGame();
  }, game.viewFor(me.name));
  try {
    assert.equal(await page.locator('.turn-ring').count(), 1);
    assert.ok(await page.locator('.av img').count() >= 4);
    await page.waitForFunction(() => [...document.querySelectorAll('.av img')].every((img) => img.complete && img.naturalWidth > 0));
    const cardNames = await page.locator('#hand .cname').allTextContents();
    for (const name of new Set(cardNames)) {
      assert.equal(cardNames.lastIndexOf(name) - cardNames.indexOf(name) + 1, cardNames.filter((n) => n === name).length);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.right-col')).bottom === '0px');
    assert.ok(await page.locator('#meInfoToggle').isVisible());
    await page.screenshot({ path: path.join(__dirname, 'shot-main-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1366, height: 768 });
    const card = moveCard('General Store');
    game.act(me.name, { type: 'play', cardId: card.id });
    await page.evaluate((view) => { ROOM.game = view; renderGame(); }, game.viewFor(me.name));
    assert.equal(await page.locator('.store-pop .sp-pickable').count(), 4);
    while (game.pending) game.timeout();
    const gatling = moveCard('Gatling');
    game.act(me.name, { type: 'play', cardId: gatling.id });
    await page.evaluate((view) => { ROOM.game = view; renderGame(); }, game.viewFor(me.name));
    assert.equal(await page.locator('.mass-pop:not(.store-pop) .mp-col').count(), 3);

    // Generate actual end-of-match history for all five result screens.
    let seed = 42;
    const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const result = new Game(names.slice(0, 4), { rng, dodgeCity: true });
    const room = { game: result, bots: names.slice(0, 4), players: names.slice(0, 4), status: 'playing', chat: [] };
    for (let now = 0; !result.winner; now += 1000) {
      assert.ok(now < 20000000, 'result fixture finished');
      tickBots(room, now);
    }
    assert.ok(result.viewFor(names[0]).summary.timeline.pts.length);
    for (const [width, height] of [[1920, 950], [1366, 650], [1280, 720]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate((view) => {
        clearMatchResult(); ROOM.game = view; renderGame(); renderMatchResult(view);
      }, result.viewFor(names[0]));
      for (const step of ['result', 'awards', 'timeline', 'contrib', 'stats']) {
        if (step !== 'result') await page.locator(`#matchResult [data-step="${step}"]`).first().click();
        assert.equal(await page.locator('#matchResult').getAttribute('data-step'), step);
        assert.equal(await page.locator('.result-missing').count(), 0);
        assert.ok(await page.locator('.result-body').textContent());
        assert.ok(await page.locator('#matchResult').evaluate((el) => el.scrollHeight <= el.clientHeight + 2), `${step} fits ${width}x${height}`);
        if (step === 'timeline' && width === 1366) await page.screenshot({ path: path.join(__dirname, 'shot-main-timeline.png') });
      }
      await page.evaluate(() => clearMatchResult());
    }
    console.log('PASS: main portraits, grouped hand, turn ring, mobile dock, Store/Mass popups and all five results screens at three desktop sizes.');
  } finally {
    await page.evaluate(() => { clearMatchResult(); ROOM = window.mainSavedRoom; ui.serverOffset = ROOM.serverNow - Date.now(); renderGame(); });
    await page.setViewportSize({ width: 1366, height: 768 });
  }
};

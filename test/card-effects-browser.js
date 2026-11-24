'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { Game, CARD_INFO, CHAR_INFO, ROLE_INFO } = require('../game');

const root = path.join(__dirname, '..');
const browsers = path.join(root, 'node-tmp', 'pw-browsers');
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync(browsers)) process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;
const { chromium } = require('playwright');

test('browser: Panic and Cat Balou fly from hands/equipment for players and spectators', { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'bang.test') return route.abort();
      if (url.pathname === '/api/meta') return route.fulfill({ json: { cards: CARD_INFO, chars: CHAR_INFO, roles: ROLE_INFO } });
      if (url.pathname === '/api/me') return route.fulfill({ json: { user: null } });
      const file = path.join(root, 'public', url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
      return fs.existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404, body: '' });
    });
    await page.goto('http://bang.test');
    await page.waitForFunction(() => META && document.querySelector('#app form'));
    for (const [width, height] of [[1366, 768], [360, 640], [375, 812], [430, 932]]) {
      await page.setViewportSize({ width, height });
      for (const name of ['Panic', 'Cat Balou']) {
        for (const zone of ['hand', 'eq']) {
          const g = new Game(['Alice', 'Bobby', 'Carol', 'David'], { rng: () => .4 });
          while (g.pending) g.timeout();
          for (const p of g.players) p.char = 'Willy the Kid';
          const actor = g.players[g.turn], victim = g.players[g.nextAlive(g.turn)];
          const piles = [g.deck, g.discard, ...g.players.map((p) => p.hand)];
          const take = (cardName) => {
            const pile = piles.find((cards) => cards.some((c) => c.name === cardName));
            return pile.splice(pile.findIndex((c) => c.name === cardName), 1)[0];
          };
          const card = take(name);
          actor.hand.push(card);
          if (zone === 'eq') victim.eq.push(take('Barrel'));
          const viewers = [actor.name, victim.name, null];
          const before = viewers.map((viewer) => g.viewFor(viewer));
          g.act(actor.name, { type: 'play', cardId: card.id, target: victim.name, targetCard: zone === 'hand' ? 'hand' : victim.eq[0].id });
          for (const [i, viewer] of viewers.entries()) {
            const after = g.viewFor(viewer);
            const result = await page.evaluate(({ before, after, viewer }) => {
              ME = viewer;
              app.innerHTML = '<div id="mainArea"></div><div id="logBox"></div>';
              ROOM = { code: 'TEST', online: before.players.map((p) => p.name), game: before };
              renderGame();
              const origins = captureTransferOrigins(before);
              ROOM.game = after;
              renderGame();
              showCardTransfers(after, before, [], origins);
              const flyer = document.querySelector('.transfer-card');
              if (!flyer) return null;
              const event = after.transfers.at(-1);
              const start = origins[`${event.from}:${event.sourceZone}:${event.cards[0]?.id}`] || origins[`${event.from}:hand`];
              const seat = [...document.querySelectorAll('.player[data-player]')].find((el) => el.dataset.player === after.players[event.to]?.name);
              const target = event.to === 'discard' ? document.querySelector('#discardPile .ds-slot:last-child .card') || document.querySelector('#discardPile')
                : event.to === after.me?.index ? document.querySelector(`#hand [data-card="${event.cards[0].id}"]`) : seat.querySelector('.hand-fan') || seat;
              const end = target.getBoundingClientRect();
              const animation = flyer.getAnimations()[0];
              const frames = animation.effect.getKeyframes();
              animation.pause();
              const result = { left: parseFloat(flyer.style.left), expectedLeft: start.left + start.width / 2 - 28,
                transform: frames.at(-1).transform, dx: end.left + end.width / 2 - start.left - start.width / 2,
                dy: end.top + end.height / 2 - start.top - start.height / 2, hidden: !!flyer.querySelector('.card-back') };
              showCardTransfers(after, after, [], origins);
              result.count = document.querySelectorAll('.transfer-card').length;
              animation.cancel();
              return result;
            }, { before: before[i], after, viewer });
            assert.ok(result, `${name}/${zone}/${viewer}/${width} has a flight`);
            assert.ok(Math.abs(result.left - result.expectedLeft) < .01);
            const [, dx, dy] = result.transform.match(/translate\(([-.\d]+)px, ([-.\d]+)px\)/);
            assert.ok(Math.abs(Number(dx) - result.dx) < .01);
            assert.ok(Math.abs(Number(dy) - result.dy) < .01);
            assert.equal(result.hidden, name === 'Panic' && zone === 'hand' && viewer !== actor.name);
            assert.equal(result.count, 1, 'same SSE snapshot does not replay the flight');
            await page.waitForFunction(() => !document.querySelector('.transfer-card'));
          }
        }
      }
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

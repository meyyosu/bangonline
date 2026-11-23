'use strict';
// Kiểm thử giao diện với 4 trình duyệt. Cần server đang chạy ở localhost:3000.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const BASE = 'http://localhost:3000';

(async () => {
  const browser = await chromium.launch();
  const names = ['Tuan', 'Lan', 'Minh', 'Hoa'].map((n) => n + Math.floor(Math.random() * 1000));
  const pages = [];
  for (const n of names) {
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => { console.error('PAGE ERROR', n, e.message); process.exitCode = 1; });
    await page.goto(BASE);
    await page.click('text=Đăng ký');
    await page.fill('input[name=username]', n);
    await page.fill('input[name=password]', 'secret1');
    await page.click('#authBtn');
    await page.waitForSelector('#createForm');
    pages.push(page);
  }
  await pages[0].screenshot({ path: 'test/shot-lobby.png' });
  await pages[0].fill('input[name=name]', 'Saloon Sài Gòn');
  await pages[0].click('#createForm button');
  await pages[0].waitForSelector('.seat-list');
  const code = (await pages[0].textContent('.room-head .code')).trim();
  for (const p of pages.slice(1)) {
    await p.fill('input[name=code]', code);
    await p.click('#joinForm button');
    await p.waitForSelector('.seat-list');
  }
  await pages[0].waitForSelector('#startBtn:not([disabled])');
  await pages[0].fill('#chatForm input', 'Chào mọi người!');
  await pages[0].press('#chatForm input', 'Enter');
  await pages[0].screenshot({ path: 'test/shot-waiting.png' });
  await pages[0].click('#startBtn');
  for (const p of pages) await p.waitForSelector('.board');
  await new Promise((r) => setTimeout(r, 500));

  // chơi tự động bằng cách bấm giao diện trong vài chục bước
  for (let step = 0; step < 60; step++) {
    let acted = false;
    for (const p of pages) {
      if (await p.$('.prompt.mine')) {
        if (await p.$('[data-act="draw"]')) { await p.click('[data-act="draw"]'); acted = true; break; }
        if (await p.$('#kitCards')) {
          const ks = await p.$$('#kitCards .card'); await ks[0].click(); await (await p.$$('#kitCards .card'))[1].click();
          await p.click('[data-act="confirmKit"]'); acted = true; break;
        }
        if (await p.$('.store-pop .sp-pickable')) { await p.click('.store-pop .sp-pickable'); acted = true; break; }
        const resp = await p.$('#hand .card.playable');
        if (await p.$('[data-act="take"]')) {
          if (resp && Math.random() < 0.6) await resp.click(); else await p.click('[data-act="take"]');
          acted = true; break;
        }
        // lượt của mình: thử đánh 1 lá
        if (resp && Math.random() < 0.7) {
          await resp.click();
          await new Promise((r) => setTimeout(r, 150));
          const tgt = await p.$('.player.targetable');
          if (tgt) {
            await tgt.click();
            await new Promise((r) => setTimeout(r, 150));
            if (await p.$('#modal:not(.hidden) [data-tc]')) await p.click('#modal [data-tc]');
          }
          acted = true; break;
        }
        if (await p.$('[data-act="discardMode"]')) {
          await p.click('[data-act="discardMode"]');
          const need = await p.evaluate(() => { const g = ROOM.game; return g.me.hand.length - g.players[g.me.index].hp; });
          for (let k = 0; k < need; k++) await (await p.$$('#hand .card:not(.selected)'))[0].click();
          await p.click('[data-act="confirmDiscard"]'); acted = true; break;
        }
        if (await p.$('[data-act="endTurn"]')) { await p.click('[data-act="endTurn"]'); acted = true; break; }
      }
    }
    await new Promise((r) => setTimeout(r, 300));
    if (step === 8) for (let i = 0; i < pages.length; i++) await pages[i].screenshot({ path: `test/shot-game-${i}.png` });
    if (!acted) await new Promise((r) => setTimeout(r, 300));
  }
  const log = await pages[0].evaluate(() => ROOM.game.log.slice(-15));
  console.log(log.join('\n'));
  await pages[0].screenshot({ path: 'test/shot-game-end.png' });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

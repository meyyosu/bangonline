'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { SOUND_FILES } = require('../game');

const root = path.join(__dirname, '..');
const localBrowsers = path.join(root, 'node-tmp', 'pw-browsers');
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync(localBrowsers)) process.env.PLAYWRIGHT_BROWSERS_PATH = localBrowsers;
const { chromium } = require('playwright');

test('browser: lobby spectator and mid-game spectator follow the same live match', { timeout: 120000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bang-spectator-browser-'));
  let child, browser;
  const errors = [];
  try {
    for (const file of ['server.js', 'game.js', 'power.js', 'dodge-city.json', 'room-timer.js', 'room-pause.js', 'room-bots.js']) fs.copyFileSync(path.join(root, file), path.join(dir, file));
    fs.cpSync(path.join(root, 'public'), path.join(dir, 'public'), { recursive: true });
    fs.cpSync(path.join(root, 'data', 'sounds'), path.join(dir, 'data', 'sounds'), { recursive: true });
    const probe = net.createServer();
    await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const port = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));
    const env = { ...process.env, PORT: String(port), BANG_RULES_PREVIEW: '0' };
    delete env.BANG_GREEN_CARDS_FILE;
    delete env.BANG_DODGE_CITY_FILE;
    child = spawn(process.execPath, [path.join(dir, 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Server startup timed out')), 10000);
      child.stdout.once('data', () => { clearTimeout(timer); resolve(); });
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Server exited: ${code}`)); });
    });
    const base = `http://127.0.0.1:${port}`;
    browser = await chromium.launch();
    const names = ['HostPlayer', 'PlayerTwo', 'PlayerThree', 'PlayerFour', 'LobbyWatcher', 'LateWatcher'];
    const pages = [];
    for (const name of names) {
      const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce' });
      await context.addInitScript(() => {
        window.audioStarts = [];
        const start = AudioBufferSourceNode.prototype.start;
        AudioBufferSourceNode.prototype.start = function (...args) {
          window.audioStarts.push(this.buffer?.duration);
          return start.apply(this, args);
        };
      });
      // Keep this local gameplay test independent of Google Fonts/network access.
      await context.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ contentType: 'text/css', body: '' }));
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(`${name}: ${error.message}`));
      page.on('console', (message) => { if (message.type() === 'error') errors.push(`${name}: ${message.text()} (${message.location().url})`); });
      await page.goto(base);
      await page.getByText('Đăng ký', { exact: true }).click();
      await page.locator('input[name=username]').fill(name);
      await page.locator('input[name=password]').fill('secret1');
      await page.locator('#authBtn').click();
      await page.locator('#createForm').waitFor();
      pages.push(page);
    }
    const [host, , , , lobby, late] = pages;
    // Decode the actual main assets and verify playback after a user gesture.
    const soundFiles = [...SOUND_FILES];
    const durations = await host.evaluate(async (files) => {
      const audio = new AudioContext();
      try {
        return await Promise.all(files.map(async (file) => {
          const response = await fetch('/sounds/' + file);
          const contentType = file.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg';
          if (!response.ok || response.headers.get('Content-Type') !== contentType) throw new Error(file);
          return (await audio.decodeAudioData(await response.arrayBuffer())).duration;
        }));
      } finally { await audio.close(); }
    }, soundFiles);
    assert.equal(durations.length, soundFiles.length);
    assert.ok(durations.every((duration) => duration > 0));
    await host.locator('#soundToggle').click();
    await host.locator('#soundVolume').evaluate((el) => { el.value = '25'; el.dispatchEvent(new Event('input')); });
    assert.equal(await host.locator('#soundValue').textContent(), '25%');
    await host.evaluate(() => gameAudio.play('gatling'));
    await host.waitForFunction(() => window.audioStarts.length > 0);
    await host.locator('#soundVolume').evaluate((el) => { el.value = '0'; el.dispatchEvent(new Event('input')); });
    assert.equal(await host.locator('#soundToggle').textContent(), '🔇');
    assert.equal(await host.evaluate(() => localStorage.getItem('bang.soundVolume')), '0');
    await host.locator('#soundVolume').evaluate((el) => { el.value = '65'; el.dispatchEvent(new Event('input')); });
    await host.locator('#soundToggle').click();
    await host.locator('#createForm input[name=name]').fill('Spectator browser test');
    await host.locator('#characterChoices').selectOption('3');
    await host.locator('#characterSeconds').fill('0');
    await host.locator('#turnSeconds').fill('0');
    await host.locator('#createForm button').click();
    await host.locator('#spectatorBtn').waitFor();
    for (let count = 1; count <= 6; count++) {
      await host.locator('#addBotBtn').click();
      await host.waitForFunction((n) => ROOM.bots.length === n && ROOM.players.length === n + 1, count);
    }
    assert.equal(await host.locator('#addBotBtn').isDisabled(), true);
    await host.screenshot({ path: path.join(__dirname, 'shot-bot-lobby.png'), fullPage: true });
    for (let i = 1; i <= 6; i++) {
      await host.locator(`[data-kick="Bot ${i}"]`).click();
      await host.waitForFunction((name) => !ROOM.players.includes(name) && !ROOM.bots.includes(name), `Bot ${i}`);
    }
    assert.equal(await host.locator('#addBotBtn').isEnabled(), true);
    const code = (await host.locator('.room-head .code').textContent()).trim();
    for (const page of pages.slice(1, 5)) {
      await page.locator('#joinForm input[name=code]').fill(code);
      await page.locator('#joinForm button').click();
      await page.locator('#spectatorBtn').waitFor();
      assert.equal(await page.locator('#addBotBtn').count(), 0);
    }
    // Changing one's own role updates all clients, and can be reversed before starting.
    await lobby.getByRole('button', { name: 'Làm khán giả', exact: true }).click();
    await host.waitForFunction(() => ROOM.players.length === 4 && ROOM.spectators.includes('LobbyWatcher'));
    await lobby.getByRole('button', { name: 'Tham gia chơi', exact: true }).click();
    await host.waitForFunction(() => ROOM.players.length === 5 && ROOM.spectators.length === 0);
    await lobby.getByRole('button', { name: 'Làm khán giả', exact: true }).click();
    await host.waitForFunction(() => ROOM.players.length === 4 && ROOM.spectators.length === 1);
    await lobby.screenshot({ path: path.join(__dirname, 'shot-spectator-lobby.png'), fullPage: true });
    await host.locator('#startBtn').click();
    await lobby.waitForFunction(() => ROOM?.game?.phase === 'character' && ROOM.game.me === null);
    assert.equal(await lobby.locator('#confirmCharacter').count(), 0);
    assert.equal(await lobby.locator('.rolecard').count(), 0);
    for (let i = 0; i < 4; i++) {
      const name = await host.evaluate(() => ROOM.game.players[ROOM.game.pending.player].name);
      const page = pages[names.indexOf(name)];
      await page.locator('[data-character]').first().click();
      await page.locator('#confirmCharacter').click();
      await host.waitForFunction((previous) => ROOM.game.phase !== 'character' || ROOM.game.players[ROOM.game.pending.player].name !== previous, name);
    }
    await lobby.locator('.arena').waitFor();
    // A person still in the main lobby joins an already running match through Vào xem.
    const join = late.locator(`[data-join="${code}"]`);
    await join.waitFor();
    assert.equal(await join.textContent(), 'Vào xem');
    await join.click();
    await late.waitForFunction(() => ROOM?.game?.me === null && ROOM.spectators.includes('LateWatcher'));
    for (const page of [lobby, late]) {
      await page.locator('.arena').waitFor();
      assert.match(await page.locator('#prompt').textContent(), /Bạn đang xem trận đấu/);
      assert.equal(await page.locator('#hand, #actions, #pauseBtn').count(), 0);
      const view = await page.evaluate(() => ROOM.game);
      assert.equal(view.me, null);
      assert.equal(view.players.length, 4);
      assert.equal(view.players.filter((p) => p.role !== null).length, 1);
      assert.ok(view.players.every((p) => !('hand' in p)));
      assert.equal(view.pending?.options === undefined || view.pending.type === 'draw', true);
    }
    // Reconnect preserves spectator membership and never creates a player seat.
    await late.reload();
    await late.locator('.arena').waitFor();
    assert.equal(await late.evaluate(() => ROOM.game.me), null);
    // Chat and actual player actions travel to both spectators over SSE.
    await late.locator('#chatForm input').fill('Hello from spectator');
    await late.locator('#chatForm button').click();
    await lobby.waitForFunction(() => ROOM.chat.some((m) => m.user === 'LateWatcher' && m.text === 'Hello from spectator'));
    const turn = await host.evaluate(() => ROOM.game.turn);
    const currentName = await host.evaluate(() => ROOM.game.players[ROOM.game.turn].name);
    const player = pages[names.indexOf(currentName)];
    await player.waitForFunction(() => ROOM.game.phase === 'play' || ['kit', 'blackJack'].includes(ROOM.game.pending?.type) || !!document.querySelector('#deck.ready'));
    if (await player.locator('#deck.ready').count()) await player.locator('#deck.ready').click();
    await player.waitForFunction(() => ROOM.game.phase === 'play' || ROOM.game.pending?.type === 'kit' || ROOM.game.pending?.type === 'blackJack');
    if (await player.locator('#kitCards .kit-choice').count()) {
      await player.locator('#kitCards .kit-choice').nth(0).click();
      await player.locator('#kitCards .kit-choice').nth(1).click();
      await player.locator('[data-act=confirmKit]').click();
    }
    await player.waitForFunction(() => ROOM.game.phase === 'play' && !ROOM.game.pending);
    const excess = await player.evaluate(() => ROOM.game.me.hand.length - ROOM.game.me.handLimit);
    if (excess > 0) {
      await player.locator('[data-act=discardMode]').click();
      for (let i = 0; i < excess; i++) await player.locator('#hand .card:not(.selected)').first().click();
      await player.locator('[data-act=confirmDiscard]').click();
    } else await player.locator('[data-act=endTurn]').click();
    for (const page of [lobby, late]) await page.waitForFunction((previous) => ROOM.game.turn !== previous, turn);
    await late.screenshot({ path: path.join(__dirname, 'shot-spectator-midgame.png'), fullPage: true });
    const currentTurn = await host.evaluate(() => ROOM.game.turn);
    await require('./main-features-browser')(host, names);
    await late.locator('#leaveBtn').click();
    await late.locator('#createForm').waitFor();
    await host.waitForFunction(() => !ROOM.spectators.includes('LateWatcher'));
    assert.equal(await host.evaluate(() => ROOM.game.turn), currentTurn);
    assert.equal(await host.evaluate(() => ROOM.status), 'playing');
    assert.deepEqual(errors, []);
    console.log('PASS: lobby role toggle, character selection, mid-game join, hidden data, reconnect, chat, live turn updates and spectator leave; no browser errors.');
  } finally {
    if (browser) await browser.close();
    if (child && child.exitCode === null) {
      child.kill();
      await new Promise((resolve) => child.once('exit', resolve));
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

test('Windows launcher starts current source, recognizes an existing server, and detects stale code', {
  skip: process.platform !== 'win32', timeout: 30000,
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bang-launcher with spaces-'));
  const files = ['server.js', 'game.js', 'power.js', 'room-timer.js', 'room-pause.js', 'room-bots.js'];
  for (const file of files) fs.copyFileSync(path.join(__dirname, '..', file), path.join(root, file));
  const dodgeCityFile = path.join(root, 'dodge-city.json');
  fs.copyFileSync(path.join(__dirname, '../dodge-city.json'), dodgeCityFile);
  const valleyFile = path.join(root, 'valley-of-shadow.json');
  fs.copyFileSync(path.join(__dirname, '../valley-of-shadow.json'), valleyFile);
  fs.mkdirSync(path.join(root, 'tools'));
  fs.copyFileSync(path.join(__dirname, '../tools/start.ps1'), path.join(root, 'tools/start.ps1'));
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'tools/start.ps1'),
    '-NoBrowser', '-SkipFirewall', '-Port', String(port)];
  const env = { ...process.env };
  delete env.BANG_GREEN_CARDS_FILE;
  delete env.BANG_DODGE_CITY_FILE;
  const child = spawn('powershell.exe', args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', serverPid;
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  try {
    await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error(`Launcher did not become ready: ${output}`)), 15000);
      const check = (chunk) => {
        if (/Đã nạp mã mới nhất\. PID (\d+)/u.test(output)) { clearTimeout(deadline); resolve(); }
      };
      child.stdout.on('data', check);
      child.once('error', (error) => { clearTimeout(deadline); reject(error); });
      child.once('exit', (code) => { clearTimeout(deadline); reject(new Error(`Launcher exited ${code}: ${output}`)); });
    });
    serverPid = Number(output.match(/Đã nạp mã mới nhất\. PID (\d+)/u)[1]);
    const health = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
    const revision = crypto.createHash('sha256').update(Buffer.concat(files.map((file) => fs.readFileSync(path.join(root, file))))).digest('hex');
    assert.equal(health.app, 'bang-online');
    assert.equal(health.pid, serverPid);
    assert.equal(health.revision, revision);
    assert.equal(health.greenCardCount, 14);
    assert.equal(health.dodgeCityCardCount, 34);
    assert.equal(health.valleyOfShadowCardCount, 16);
    assert.equal(health.valleyOfShadowRevision, crypto.createHash('sha256').update(fs.readFileSync(valleyFile)).digest('hex'));
    assert.equal(health.greenCardsRevision, crypto.createHash('sha256').update(fs.readFileSync(dodgeCityFile)).digest('hex'));
    const meta = await (await fetch(`http://127.0.0.1:${port}/api/meta`)).json();
    assert.equal(meta.greenCardCount, 14);
    assert.equal(meta.dodgeCityCardCount, 34);
    assert.equal(meta.cards.Bible.type, 'green');
    assert.equal(meta.valleyOfShadowCardCount, 16);
    assert.equal(meta.cards.Ghost.type, 'blue');
    assert.equal(Object.keys(meta.chars).length, 39);
    const cookies = [];
    const request = async (user, url, body) => {
      const response = await fetch(`http://127.0.0.1:${port}${url}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookies[user] || '' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (response.headers.get('set-cookie')) cookies[user] = response.headers.get('set-cookie').split(';')[0];
      const data = await response.json();
      assert.equal(response.status, 200, JSON.stringify(data));
      return data;
    };
    for (let i = 0; i < 4; i++) await request(i, '/api/register', { username: `Dodge${i}`, password: 'secret' });
    const expansion = await request(0, '/api/rooms', { dodgeCity: true, valleyOfShadow: true, characterChoices: 1 });
    const roomUrl = `/api/rooms/${expansion.code}`;
    for (let i = 1; i < 4; i++) await request(i, roomUrl + '/join', {});
    await request(0, roomUrl + '/start', {});
    const stream = await fetch(`http://127.0.0.1:${port}${roomUrl}/stream`, { headers: { Cookie: cookies[0] } });
    const reader = stream.body.getReader();
    let event = '';
    while (!event.includes('\n\n')) event += new TextDecoder().decode((await reader.read()).value);
    await reader.cancel();
    const room = JSON.parse(event.split('\n\n')[0].slice(6)).room;
    assert.equal(room.dodgeCity, true);
    assert.equal(room.valleyOfShadow, true);
    const g = room.game;
    assert.equal(g.deckCount + g.players.reduce((sum, p) => sum + p.handCount + p.eq.length, 0), 130);
    const reused = spawnSync('powershell.exe', args, { env, windowsHide: true, encoding: 'utf8', timeout: 8000 });
    assert.equal(reused.status, 0, reused.stdout + reused.stderr);
    assert.match(reused.stdout, /Server đang chạy ở cửa sổ khác/u);
    const customCardsFile = path.join(root, 'custom cards.json');
    fs.copyFileSync(dodgeCityFile, customCardsFile);
    const custom = spawnSync('powershell.exe', [...args, '-CheckOnly'], {
      env: { ...env, BANG_GREEN_CARDS_FILE: customCardsFile }, windowsHide: true, encoding: 'utf8', timeout: 8000,
    });
    assert.equal(custom.status, 0, custom.stdout + custom.stderr);
    assert.ok(custom.stdout.includes(customCardsFile));
    assert.match(custom.stdout, /Server đã nạp dữ liệu Dodge City mới nhất: True/u);
    assert.match(custom.stdout, /Server đã nạp dữ liệu Valley of Shadow mới nhất: True/u);
    fs.appendFileSync(dodgeCityFile, '\n');
    fs.appendFileSync(valleyFile, '\n');
    const staleData = spawnSync('powershell.exe', [...args, '-CheckOnly'], { env, windowsHide: true, encoding: 'utf8', timeout: 8000 });
    assert.equal(staleData.status, 0, staleData.stdout + staleData.stderr);
    assert.match(staleData.stdout, /Server đã nạp mã mới nhất: True/u);
    assert.match(staleData.stdout, /Server đã nạp dữ liệu Dodge City mới nhất: False/u);
    assert.match(staleData.stdout, /Server đã nạp dữ liệu Valley of Shadow mới nhất: False/u);
    fs.appendFileSync(path.join(root, 'game.js'), '\n// New source has not been loaded by the running process.\n');
    const stale = spawnSync('powershell.exe', [...args, '-CheckOnly'], { env, windowsHide: true, encoding: 'utf8', timeout: 8000 });
    assert.equal(stale.status, 0, stale.stdout + stale.stderr);
    assert.match(stale.stdout, /Server đã nạp mã mới nhất: False/u);
    assert.equal((await (await fetch(`http://127.0.0.1:${port}/api/health`)).json()).pid, serverPid);
    const invalidArgs = [...args];
    invalidArgs[invalidArgs.length - 1] = '0';
    const failed = spawnSync('powershell.exe', invalidArgs, { env, windowsHide: true, encoding: 'utf8', timeout: 5000 });
    assert.equal(failed.status, 1);
    assert.match(failed.stdout, /Không khởi động được game/u);
    assert.match(fs.readFileSync(path.join(root, 'data/launcher.log'), 'utf8'), /Cổng phải nằm trong khoảng/u);
    fs.writeFileSync(path.join(root, 'game.js'), 'module.exports = {};\n');
    const unsupported = spawnSync('powershell.exe', [...args, '-CheckOnly'], { env, windowsHide: true, encoding: 'utf8', timeout: 5000 });
    assert.equal(unsupported.status, 1, unsupported.stdout + unsupported.stderr);
    assert.match(unsupported.stdout, /Game chưa nạp dữ liệu Dodge City/u);
  } finally {
    if (serverPid) { try { process.kill(serverPid); } catch {} }
    child.kill();
  }
});

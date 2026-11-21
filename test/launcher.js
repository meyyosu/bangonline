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
  const files = ['server.js', 'game.js', 'room-timer.js', 'room-pause.js'];
  for (const file of files) fs.copyFileSync(path.join(__dirname, '..', file), path.join(root, file));
  fs.mkdirSync(path.join(root, 'tools'));
  fs.copyFileSync(path.join(__dirname, '../tools/start.ps1'), path.join(root, 'tools/start.ps1'));
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'tools/start.ps1'),
    '-NoBrowser', '-SkipFirewall', '-Port', String(port)];
  const child = spawn('powershell.exe', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
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
    const reused = spawnSync('powershell.exe', args, { windowsHide: true, encoding: 'utf8', timeout: 8000 });
    assert.equal(reused.status, 0, reused.stdout + reused.stderr);
    assert.match(reused.stdout, /Server đang chạy ở cửa sổ khác/u);
    fs.appendFileSync(path.join(root, 'game.js'), '\n// New source has not been loaded by the running process.\n');
    const stale = spawnSync('powershell.exe', [...args, '-CheckOnly'], { windowsHide: true, encoding: 'utf8', timeout: 8000 });
    assert.equal(stale.status, 0, stale.stdout + stale.stderr);
    assert.match(stale.stdout, /Server đã nạp mã mới nhất: False/u);
    assert.equal((await (await fetch(`http://127.0.0.1:${port}/api/health`)).json()).pid, serverPid);
    const invalidArgs = [...args];
    invalidArgs[invalidArgs.length - 1] = '0';
    const failed = spawnSync('powershell.exe', invalidArgs, { windowsHide: true, encoding: 'utf8', timeout: 5000 });
    assert.equal(failed.status, 1);
    assert.match(failed.stdout, /Không khởi động được game/u);
    assert.match(fs.readFileSync(path.join(root, 'data/launcher.log'), 'utf8'), /Cổng phải nằm trong khoảng/u);
  } finally {
    if (serverPid) { try { process.kill(serverPid); } catch {} }
    child.kill();
  }
});

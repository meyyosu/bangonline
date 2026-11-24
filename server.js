'use strict';
// Server Bang! Online — chỉ dùng module có sẵn của Node.js (không cần npm install).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Game, GameError, CARD_INFO, CHAR_INFO, ROLE_INFO, RULES_PREVIEW, SOUND_FILES,
  greenCardCount, dodgeCityCardCount, dodgeCityRevision } = require('./game');
const { syncTimer, tickTimer } = require('./room-timer');
const { pauseAction, finishPause, pauseView } = require('./room-pause');
const { tickBots } = require('./room-bots');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.join(__dirname, 'data', RULES_PREVIEW ? 'preview' : '');
const sessionCookie = RULES_PREVIEW ? 'bang_preview_sid' : 'sid';
const sessionPattern = new RegExp('(?:^|;\\s*)' + sessionCookie + '=([a-f0-9]+)');
const PUBLIC_DIR = path.join(__dirname, 'public');
const SOUNDS_DIR = path.join(__dirname, 'data', 'sounds');
const RUNTIME_FILES = ['server.js', 'game.js', 'power.js', 'room-timer.js', 'room-pause.js', 'room-bots.js'];
const readRevision = () => crypto.createHash('sha256').update(Buffer.concat(RUNTIME_FILES.map((file) => fs.readFileSync(path.join(__dirname, file))))).digest('hex');
const runtimeRevision = readRevision();
// Giao diện dùng 2 thông tin này để cảnh báo trước khi chơi:
// - SERVER_FEATURES: server cũ không gửi trường này → giao diện biết server chưa có thống kê/danh hiệu cuối ván.
// - codeChanged: code trên ổ đĩa đã mới hơn code server đang chạy (cập nhật mà quên khởi động lại).
// - freeReset: hết ván thì mọi người (không chỉ chủ phòng) đều đưa phòng về phòng chờ được.
// - winProb3: timeline cuối ván có tỉ lệ thắng 3 phe từng hành động (tab Diễn biến mới).
const SERVER_FEATURES = ['endSummary', 'freeReset', 'winProb3'];
let codeChanged = false;
setInterval(() => {
  try { codeChanged = readRevision() !== runtimeRevision; } catch { codeChanged = true; }
}, Number(process.env.BANG_CODE_CHECK_MS) || 10000).unref();
const startedAt = new Date().toISOString();
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- lưu trữ ----------
const loadJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const users = loadJson(USERS_FILE, {});      // username(lowercase) -> {name, salt, hash, created}
const sessions = loadJson(SESSIONS_FILE, {}); // token -> username(lowercase)
const save = (f, obj) => fs.writeFile(f, JSON.stringify(obj, null, 2), () => {});

function hashPw(pw, salt) { return crypto.scryptSync(pw, salt, 64).toString('hex'); }

// ---------- phòng chơi ----------
const rooms = new Map();   // code -> room
const roomClients = new Map(); // code -> Set<{res, user}>
const lobbyClients = new Set();

function newCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do { c = Array.from({ length: 4 }, () => chars[crypto.randomInt(chars.length)]).join(''); } while (rooms.has(c));
  return c;
}

function roomCapacity(r) { return r.dodgeCity ? 8 : 7; }

function roomSummary(r) {
  return { code: r.code, name: r.name, host: r.host, players: r.players, bots: r.bots, spectators: r.spectators, status: r.status, max: roomCapacity(r), hasPassword: !!r.passwordHash, turnSeconds: r.turnSeconds, characterChoices: r.characterChoices, characterSeconds: r.characterSeconds, dodgeCity: r.dodgeCity };
}

function roomView(r, user) {
  syncTimer(r);
  const online = [...(roomClients.get(r.code) || [])].map((c) => c.user);
  return {
    ...roomSummary(r),
    online: [...new Set([...online, ...(r.bots || [])])],
    chat: r.chat.slice(-60),
    game: r.game ? r.game.viewFor(r.spectators.includes(user) ? null : user) : null,
    serverNow: Date.now(),
    server: { features: SERVER_FEATURES, stale: codeChanged },
    pause: pauseView(r),
    timer: r.clock ? { deadline: r.clock.deadline, player: r.clock.player, response: !!r.clock.pending, character: !!r.clock.character, draw: !!r.clock.draw, seconds: r.clock.seconds } : null,
  };
}

function sse(res, data) { res.write(`data: ${JSON.stringify(data)}\n\n`); }

function broadcastRoom(r) {
  for (const c of roomClients.get(r.code) || []) {
    if (isMember(r, c.user)) sse(c.res, { type: 'room', room: roomView(r, c.user) });
    else { sse(c.res, { type: 'closed' }); roomClients.get(r.code).delete(c); c.res.end(); }
  }
}
function broadcastLobby() {
  const list = [...rooms.values()].map(roomSummary);
  for (const res of lobbyClients) sse(res, { type: 'lobby', rooms: list });
}
function isMember(r, user) { return r.players.includes(user) || r.spectators.includes(user); }
function findRoomOf(user) { return [...rooms.values()].find((r) => isMember(r, user)); }

function updateSettings(r, body) {
  if (body.characterChoices !== undefined && (!Number.isInteger(body.characterChoices) || body.characterChoices < 1 || body.characterChoices > 4)) {
    throw new GameError('Số nhân vật để chọn phải từ 1 đến 4.');
  }
  if (body.characterSeconds !== undefined && (!Number.isInteger(body.characterSeconds) || (body.characterSeconds !== 0 && (body.characterSeconds < 10 || body.characterSeconds > 600)))) {
    throw new GameError('Thời gian chọn nhân vật phải là 0 (tắt) hoặc từ 10 đến 600 giây.');
  }
  if (body.turnSeconds !== undefined) {
    if (!Number.isInteger(body.turnSeconds) || (body.turnSeconds !== 0 && (body.turnSeconds < 10 || body.turnSeconds > 600))) {
      throw new GameError('Thời gian mỗi lượt phải là 0 (tắt) hoặc từ 10 đến 600 giây.');
    }
  }
  if (body.password !== undefined && (typeof body.password !== 'string' || body.password.length > 64)) {
    throw new GameError('Mật khẩu phòng tối đa 64 ký tự.');
  }
  if (body.password !== undefined) {
    r.passwordSalt = body.password ? crypto.randomBytes(16).toString('hex') : null;
    r.passwordHash = body.password ? hashPw(body.password, r.passwordSalt) : null;
  }
  if (body.turnSeconds !== undefined) r.turnSeconds = body.turnSeconds;
  if (body.characterChoices !== undefined) r.characterChoices = body.characterChoices;
  if (body.characterSeconds !== undefined) r.characterSeconds = body.characterSeconds;
}

function leaveRoom(r, user) {
  r.players = r.players.filter((p) => p !== user);
  r.spectators = r.spectators.filter((p) => p !== user);
  r.bots = (r.bots || []).filter((p) => p !== user);
  const humans = [...r.players, ...r.spectators].filter((p) => !r.bots.includes(p));
  if (!humans.length) { rooms.delete(r.code); return; }
  if (r.host === user) r.host = humans[0];
  r.chat.push({ system: true, text: `${user} đã rời phòng.` });
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };

function send(res, code, obj, headers = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(obj));
}
const err = (res, msg, code = 400) => send(res, code, { error: msg });

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (d) => { b += d; if (b.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
  });
}

function getUser(req) {
  const m = sessionPattern.exec(req.headers.cookie || '');
  const key = m && sessions[m[1]];
  return key && users[key] ? users[key].name : null;
}

function serveStatic(req, res, pathname) {
  const file = path.normalize(path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(PUBLIC_DIR)) return err(res, 'Not found', 404);
  fs.readFile(file, (e, data) => {
    if (e) { // SPA fallback
      return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, d2) => {
        if (e2) return err(res, 'Not found', 404);
        res.writeHead(200, { 'Content-Type': MIME['.html'] }); res.end(d2);
      });
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

function serveSound(req, res, name) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return err(res, 'Method not allowed', 405);
  if (!SOUND_FILES.has(name)) return err(res, 'Not found', 404);
  fs.readFile(path.join(SOUNDS_DIR, name), (error, data) => {
    if (error) return err(res, 'Not found', 404);
    const contentType = name.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg';
    res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': data.length });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  if (req.method === 'GET' && pathname === '/api/health') {
    return send(res, 200, { app: 'bang-online', pid: process.pid, revision: runtimeRevision, greenCardsRevision: dodgeCityRevision, greenCardCount, dodgeCityCardCount, startedAt });
  }
  if (pathname.startsWith('/sounds/')) return serveSound(req, res, pathname.slice('/sounds/'.length));
  if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);

  const user = getUser(req);
  const parts = pathname.split('/').filter(Boolean); // ['api', ...]
  const method = req.method;

  try {
    // ----- tài khoản -----
    if (pathname === '/api/meta') return send(res, 200, { cards: CARD_INFO, chars: CHAR_INFO, roles: ROLE_INFO, rulesPreview: RULES_PREVIEW, greenCardCount, dodgeCityCardCount });
    if (pathname === '/api/me') return send(res, 200, { user, room: user ? findRoomOf(user)?.code || null : null });

    if (method === 'POST' && (pathname === '/api/register' || pathname === '/api/login')) {
      const { username = '', password = '' } = await readBody(req);
      const name = String(username).trim();
      const key = name.toLowerCase();
      if (!/^[\p{L}\p{N}_]{3,16}$/u.test(name)) return err(res, 'Tên đăng nhập 3–16 ký tự, chỉ gồm chữ, số, dấu _.');
      if (String(password).length < 4) return err(res, 'Mật khẩu tối thiểu 4 ký tự.');
      if (pathname === '/api/register') {
        if (users[key]) return err(res, 'Tên này đã có người dùng.');
        const salt = crypto.randomBytes(16).toString('hex');
        users[key] = { name, salt, hash: hashPw(password, salt), created: Date.now() };
        save(USERS_FILE, users);
      } else {
        const u = users[key];
        if (!u || !crypto.timingSafeEqual(Buffer.from(hashPw(password, u.salt), 'hex'), Buffer.from(u.hash, 'hex'))) {
          return err(res, 'Sai tên đăng nhập hoặc mật khẩu.', 401);
        }
      }
      const token = crypto.randomBytes(24).toString('hex');
      sessions[token] = key;
      save(SESSIONS_FILE, sessions);
      return send(res, 200, { user: users[key].name }, { 'Set-Cookie': `${sessionCookie}=${token}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax` });
    }
    if (method === 'POST' && pathname === '/api/logout') {
      const m = sessionPattern.exec(req.headers.cookie || '');
      if (m) { delete sessions[m[1]]; save(SESSIONS_FILE, sessions); }
      return send(res, 200, { ok: true }, { 'Set-Cookie': `${sessionCookie}=; Path=/; Max-Age=0` });
    }

    if (!user) return err(res, 'Bạn cần đăng nhập.', 401);

    // ----- sảnh -----
    if (pathname === '/api/lobby/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      lobbyClients.add(res);
      sse(res, { type: 'lobby', rooms: [...rooms.values()].map(roomSummary) });
      req.on('close', () => lobbyClients.delete(res));
      return;
    }
    if (method === 'POST' && pathname === '/api/rooms') {
      if (findRoomOf(user)) return err(res, 'Bạn đang ở trong một phòng khác.');
      const body = await readBody(req);
      if (body.dodgeCity !== undefined && typeof body.dodgeCity !== 'boolean') return err(res, 'Tuỳ chọn Dodge City phải là bật hoặc tắt.');
      if (body.dodgeCity && !dodgeCityCardCount) return err(res, 'Máy chủ chưa nạp dữ liệu Dodge City.');
      const { name } = body;
      const code = newCode();
      const r = { code, name: String(name || `Phòng của ${user}`).slice(0, 40), host: user, players: [user], bots: [], spectators: [], status: 'waiting', game: null, chat: [] };
      r.turnSeconds = 60;
      r.characterChoices = 3;
      r.characterSeconds = 60;
      r.dodgeCity = body.dodgeCity === true;
      updateSettings(r, body);
      rooms.set(code, r);
      broadcastLobby();
      return send(res, 200, { code });
    }

    // ----- trong phòng: /api/rooms/:code/... -----
    if (parts[1] === 'rooms' && parts[2]) {
      const r = rooms.get(parts[2].toUpperCase());
      if (!r) return err(res, 'Không tìm thấy phòng.', 404);
      const sub = parts[3];

      if (sub === 'stream') {
        if (!isMember(r, user)) return err(res, 'Bạn không ở trong phòng này.', 403);
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        if (!roomClients.has(r.code)) roomClients.set(r.code, new Set());
        const client = { res, user };
        roomClients.get(r.code).add(client);
        broadcastRoom(r);
        req.on('close', () => { roomClients.get(r.code)?.delete(client); if (rooms.has(r.code)) broadcastRoom(r); });
        return;
      }
      if (method !== 'POST') return err(res, 'Method not allowed', 405);
      const body = await readBody(req);

      if (sub === 'join') {
        if (isMember(r, user)) return send(res, 200, { code: r.code });
        if (findRoomOf(user)) return err(res, 'Bạn đang ở trong một phòng khác.');
        if (r.passwordHash && (typeof body.password !== 'string' || body.password.length > 64 ||
          !crypto.timingSafeEqual(Buffer.from(hashPw(body.password, r.passwordSalt), 'hex'), Buffer.from(r.passwordHash, 'hex')))) {
          return send(res, 403, { error: 'Phòng yêu cầu mật khẩu hoặc mật khẩu chưa đúng.', passwordRequired: true });
        }
        const spectator = r.status !== 'waiting' || r.players.length >= roomCapacity(r);
        (spectator ? r.spectators : r.players).push(user);
        r.chat.push({ system: true, text: `${user} đã vào phòng${spectator ? ' để xem trận' : ''}.` });
      } else if (!isMember(r, user)) {
        return err(res, 'Bạn không ở trong phòng này.', 403);
      } else if (sub === 'spectator') {
        if (r.status !== 'waiting') return err(res, 'Chỉ có thể đổi chỗ trong phòng chờ.');
        if (typeof body.spectator !== 'boolean') return err(res, 'Lựa chọn khán giả không hợp lệ.');
        if (!body.spectator && !r.players.includes(user) && r.players.length >= roomCapacity(r)) return err(res, `Đã đủ ${roomCapacity(r)} người chơi.`);
        if (body.spectator !== r.spectators.includes(user)) {
          r.players = r.players.filter((p) => p !== user);
          r.spectators = r.spectators.filter((p) => p !== user);
          (body.spectator ? r.spectators : r.players).push(user);
          r.chat.push({ system: true, text: `${user} chuyển sang ${body.spectator ? 'khán giả' : 'người chơi'}.` });
        }
      } else if (sub === 'settings') {
        if (r.host !== user) return err(res, 'Chỉ chủ phòng mới đổi được cài đặt.', 403);
        if (r.status !== 'waiting') return err(res, 'Chỉ có thể đổi cài đặt trong phòng chờ.');
        updateSettings(r, body);
        r.chat.push({ system: true, text: 'Chủ phòng đã cập nhật cài đặt phòng.' });
      } else if (sub === 'leave') {
        if (r.players.includes(user)) finishPause(r, r.pause ? `${user} rời phòng. Yêu cầu tạm dừng bị huỷ.` : null);
        if (r.status === 'playing' && r.game && r.players.includes(user)) {
          if (r.game.phase === 'character') {
            r.game = null; r.status = 'waiting';
            r.chat.push({ system: true, text: 'Có người rời khi chọn nhân vật. Phòng trở về trạng thái chờ.' });
          } else {
            r.game.forfeit(user);
            if (r.game.winner) r.status = 'ended';
          }
        }
        leaveRoom(r, user);
      } else if (sub === 'add-bot') {
        if (r.host !== user) return err(res, 'Chỉ chủ phòng mới thêm được bot.', 403);
        if (r.status !== 'waiting') return err(res, 'Chỉ có thể thêm bot trong phòng chờ.');
        if (r.players.length >= roomCapacity(r)) return err(res, `Đã đủ ${roomCapacity(r)} người chơi.`);
        let number = 1;
        while (r.bots.includes(`Bot ${number}`)) number++;
        const name = `Bot ${number}`; // Spaces cannot appear in account names.
        r.bots.push(name);
        r.players.push(name);
        r.chat.push({ system: true, text: `Chủ phòng đã thêm ${name}.` });
      } else if (sub === 'kick') {
        if (r.host !== user || r.status === 'playing') return err(res, 'Chỉ chủ phòng mới mời ra được (khi chưa chơi).');
        if (body.player && body.player !== user) leaveRoom(r, body.player);
      } else if (sub === 'start') {
        if (r.host !== user) return err(res, 'Chỉ chủ phòng mới bắt đầu được.');
        if (r.status === 'playing') return err(res, 'Ván đã bắt đầu.');
        if (r.players.length < 4) return err(res, 'Cần ít nhất 4 người để chơi Bang!.');
        updateSettings(r, body);
        r.pause = null; r.clock = null; r.botNextAt = null;
        r.game = new Game(r.players, { characterChoices: r.characterChoices, dodgeCity: r.dodgeCity });
        r.status = 'playing';
        r.chat.push({ system: true, text: 'Ván đấu bắt đầu!' });
      } else if (sub === 'reset') {
        // Ván đã có người thắng: ai trong phòng cũng đưa phòng về phòng chờ được (người khác vẫn xem tiếp màn kết quả).
        if (r.host !== user && !r.game?.winner) return err(res, 'Chỉ chủ phòng mới làm được.');
        if (r.status === 'playing' && !r.game?.winner) return err(res, 'Ván chưa kết thúc.');
        if (r.game) r.chat.push({ system: true, text: `${user} đã đưa phòng về phòng chờ.` });
        r.game = null; r.status = 'waiting'; r.pause = null;
      } else if (sub === 'pause') {
        if (r.spectators.includes(user)) return err(res, 'Khán giả không thể yêu cầu hoặc biểu quyết tạm dừng.', 403);
        if (tickTimer(r)) broadcastRoom(r);
        pauseAction(r, user, body);
      } else if (sub === 'action') {
        if (r.spectators.includes(user)) return err(res, 'Khán giả không thể thực hiện hành động trong ván.', 403);
        if (!r.game) return err(res, 'Chưa có ván đấu.');
        if (tickTimer(r)) { broadcastRoom(r); broadcastLobby(); return err(res, 'Đã hết thời gian. Vui lòng thực hiện theo lượt hiện tại.'); }
        if (r.pause?.frozenAt != null) return err(res, 'Ván chơi đang tạm dừng.');
        r.game.act(user, body.action || {});
        if (r.game.winner) { r.status = 'ended'; finishPause(r); }
      } else if (sub === 'chat') {
        const text = String(body.text || '').trim().slice(0, 300);
        if (text) r.chat.push({ user, text, t: Date.now() });
        if (r.chat.length > 200) r.chat.shift();
      } else return err(res, 'Not found', 404);

      syncTimer(r);
      if (rooms.has(r.code)) broadcastRoom(r);
      else for (const c of roomClients.get(r.code) || []) sse(c.res, { type: 'closed' });
      broadcastLobby();
      return send(res, 200, { ok: true, code: r.code });
    }
    return err(res, 'Not found', 404);
  } catch (e) {
    if (e instanceof GameError) return err(res, e.message);
    console.error(e);
    return err(res, 'Lỗi server.', 500);
  }
});

// Timer chạy trên server kể cả khi người chơi mất kết nối.
setInterval(() => {
  for (const r of rooms.values()) {
    const timerChanged = tickTimer(r);
    const botChanged = tickBots(r);
    if (r.game?.winner) { r.status = 'ended'; finishPause(r); }
    if (timerChanged || botChanged) { syncTimer(r); broadcastRoom(r); broadcastLobby(); }
  }
}, 250);

// giữ kết nối SSE sống qua proxy
setInterval(() => {
  for (const res of lobbyClients) res.write(': ping\n\n');
  for (const set of roomClients.values()) for (const c of set) c.res.write(': ping\n\n');
}, 25000);

server.listen(PORT, RULES_PREVIEW ? '127.0.0.1' : undefined, () => {
  console.log(`🤠 Bang! Online đang chạy tại http://${RULES_PREVIEW ? '127.0.0.1' : 'localhost'}:${PORT}`);
});

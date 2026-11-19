'use strict';
// Server Bang! Online — chỉ dùng module có sẵn của Node.js (không cần npm install).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Game, GameError, CARD_INFO, CHAR_INFO, ROLE_INFO } = require('./game');
const { syncTimer, tickTimer } = require('./room-timer');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
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

function roomSummary(r) {
  return { code: r.code, name: r.name, host: r.host, players: r.players, status: r.status, max: 7, hasPassword: !!r.passwordHash, turnSeconds: r.turnSeconds };
}

function roomView(r, user) {
  const online = [...(roomClients.get(r.code) || [])].map((c) => c.user);
  return {
    ...roomSummary(r),
    online: [...new Set(online)],
    chat: r.chat.slice(-60),
    game: r.game ? r.game.viewFor(user) : null,
    serverNow: Date.now(),
    timer: r.clock ? { deadline: r.clock.deadline, player: r.clock.player, response: !!r.clock.pending } : null,
  };
}

function sse(res, data) { res.write(`data: ${JSON.stringify(data)}\n\n`); }

function broadcastRoom(r) {
  for (const c of roomClients.get(r.code) || []) sse(c.res, { type: 'room', room: roomView(r, c.user) });
}
function broadcastLobby() {
  const list = [...rooms.values()].map(roomSummary);
  for (const res of lobbyClients) sse(res, { type: 'lobby', rooms: list });
}
function findRoomOf(user) { return [...rooms.values()].find((r) => r.players.includes(user)); }

function updateSettings(r, body) {
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
}

function leaveRoom(r, user) {
  r.players = r.players.filter((p) => p !== user);
  if (!r.players.length) { rooms.delete(r.code); return; }
  if (r.host === user) r.host = r.players[0];
  r.chat.push({ system: true, text: `${user} đã rời phòng.` });
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

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
  const m = /(?:^|;\s*)sid=([a-f0-9]+)/.exec(req.headers.cookie || '');
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
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);

  const user = getUser(req);
  const parts = pathname.split('/').filter(Boolean); // ['api', ...]
  const method = req.method;

  try {
    // ----- tài khoản -----
    if (pathname === '/api/meta') return send(res, 200, { cards: CARD_INFO, chars: CHAR_INFO, roles: ROLE_INFO });
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
      return send(res, 200, { user: users[key].name }, { 'Set-Cookie': `sid=${token}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax` });
    }
    if (method === 'POST' && pathname === '/api/logout') {
      const m = /(?:^|;\s*)sid=([a-f0-9]+)/.exec(req.headers.cookie || '');
      if (m) { delete sessions[m[1]]; save(SESSIONS_FILE, sessions); }
      return send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; Path=/; Max-Age=0' });
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
      const { name } = body;
      const code = newCode();
      const r = { code, name: String(name || `Phòng của ${user}`).slice(0, 40), host: user, players: [user], status: 'waiting', game: null, chat: [] };
      r.turnSeconds = 0;
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
        if (!r.players.includes(user)) return err(res, 'Bạn không ở trong phòng này.', 403);
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
        if (r.players.includes(user)) return send(res, 200, { code: r.code });
        if (findRoomOf(user)) return err(res, 'Bạn đang ở trong một phòng khác.');
        if (r.status !== 'waiting') return err(res, 'Phòng đang chơi, không thể vào.');
        if (r.players.length >= 7) return err(res, 'Phòng đã đủ 7 người.');
        if (r.passwordHash && (typeof body.password !== 'string' || body.password.length > 64 ||
          !crypto.timingSafeEqual(Buffer.from(hashPw(body.password, r.passwordSalt), 'hex'), Buffer.from(r.passwordHash, 'hex')))) {
          return send(res, 403, { error: 'Phòng yêu cầu mật khẩu hoặc mật khẩu chưa đúng.', passwordRequired: true });
        }
        r.players.push(user);
        r.chat.push({ system: true, text: `${user} đã vào phòng.` });
      } else if (!r.players.includes(user)) {
        return err(res, 'Bạn không ở trong phòng này.', 403);
      } else if (sub === 'settings') {
        if (r.host !== user) return err(res, 'Chỉ chủ phòng mới đổi được cài đặt.', 403);
        if (r.status !== 'waiting') return err(res, 'Chỉ có thể đổi cài đặt trong phòng chờ.');
        updateSettings(r, body);
        r.chat.push({ system: true, text: 'Chủ phòng đã cập nhật cài đặt phòng.' });
      } else if (sub === 'leave') {
        if (r.status === 'playing' && r.game?.players[r.game.idx(user)]?.alive) return err(res, 'Không thể rời phòng khi đang chơi.');
        leaveRoom(r, user);
      } else if (sub === 'kick') {
        if (r.host !== user || r.status === 'playing') return err(res, 'Chỉ chủ phòng mới mời ra được (khi chưa chơi).');
        if (body.player && body.player !== user) leaveRoom(r, body.player);
      } else if (sub === 'start') {
        if (r.host !== user) return err(res, 'Chỉ chủ phòng mới bắt đầu được.');
        if (r.status === 'playing') return err(res, 'Ván đã bắt đầu.');
        if (r.players.length < 4) return err(res, 'Cần ít nhất 4 người để chơi Bang!.');
        r.game = new Game(r.players);
        r.status = 'playing';
        r.chat.push({ system: true, text: 'Ván đấu bắt đầu!' });
      } else if (sub === 'reset') {
        if (r.host !== user) return err(res, 'Chỉ chủ phòng mới làm được.');
        if (r.status === 'playing' && !r.game?.winner) return err(res, 'Ván chưa kết thúc.');
        r.game = null; r.status = 'waiting';
      } else if (sub === 'action') {
        if (!r.game) return err(res, 'Chưa có ván đấu.');
        if (tickTimer(r)) { broadcastRoom(r); broadcastLobby(); return err(res, 'Đã hết thời gian. Vui lòng thực hiện theo lượt hiện tại.'); }
        r.game.act(user, body.action || {});
        if (r.game.winner) r.status = 'ended';
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
    if (tickTimer(r)) { broadcastRoom(r); broadcastLobby(); }
  }
}, 250);

// giữ kết nối SSE sống qua proxy
setInterval(() => {
  for (const res of lobbyClients) res.write(': ping\n\n');
  for (const set of roomClients.values()) for (const c of set) c.res.write(': ping\n\n');
}, 25000);

server.listen(PORT, () => console.log(`🤠 Bang! Online đang chạy tại http://localhost:${PORT}`));

'use strict';
const $ = (s, el = document) => el.querySelector(s);
const app = $('#app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SUIT = { S: '♠', H: '♥', D: '♦', C: '♣' };
const ROLE_VI = { Sheriff: 'Sheriff', Deputy: 'Deputy', Outlaw: 'Outlaw', Renegade: 'Renegade' };

let META = null, ME = null, ROOM = null;
let lobbyES = null, roomES = null;
const ui = { mode: null, selected: [], lastLogLen: 0, drawTarget: null };

// ---------- tiện ích ----------
async function api(path, body) {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || 'Có lỗi xảy ra.');
  return j;
}
function toast(msg, ok = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (ok ? ' ok' : '');
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), 3200);
}
const run = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message); } };
function closeStreams() { lobbyES?.close(); roomES?.close(); lobbyES = roomES = null; }

function renderUserbox() {
  const box = $('#userbox');
  if (!ME) { box.innerHTML = ''; return; }
  box.innerHTML = `<span>🤠 <b>${esc(ME)}</b></span><button class="btn ghost small" id="logout">Đăng xuất</button>`;
  $('#logout').onclick = run(async () => { await api('/api/logout', {}); ME = null; closeStreams(); renderUserbox(); showAuth(); });
}

// ---------- đăng nhập ----------
function showAuth() {
  let mode = 'login';
  app.innerHTML = `
    <div class="hero"><h1>BANG!</h1><p>Bắn súng miền Tây hoang dã — chơi online cùng bạn bè</p></div>
    <div class="panel auth">
      <div class="tabs"><button data-m="login" class="active">Đăng nhập</button><button data-m="register">Đăng ký</button></div>
      <form id="authForm">
        <label>Tên đăng nhập</label><input type="text" name="username" autocomplete="username" required>
        <label>Mật khẩu</label><input type="password" name="password" autocomplete="current-password" required>
        <div class="err" id="authErr"></div>
        <button class="btn" style="width:100%;margin-top:6px" id="authBtn">Đăng nhập</button>
      </form>
    </div>`;
  app.querySelectorAll('.tabs button').forEach((b) => b.onclick = () => {
    mode = b.dataset.m;
    app.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
    $('#authBtn').textContent = mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản';
  });
  $('#authForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const r = await api(mode === 'login' ? '/api/login' : '/api/register', { username: f.get('username'), password: f.get('password') });
      ME = r.user; renderUserbox(); afterLogin();
    } catch (er) { $('#authErr').textContent = er.message; }
  };
}

async function afterLogin() {
  const me = await api('/api/me');
  const hashCode = location.hash.slice(1).toUpperCase();
  if (me.room) return enterRoom(me.room);
  if (hashCode) {
    try { await api(`/api/rooms/${hashCode}/join`, {}); return enterRoom(hashCode); }
    catch (e) { toast(e.message); history.replaceState(null, '', '/'); }
  }
  showLobby();
}

// ---------- sảnh ----------
function showLobby() {
  closeStreams();
  ROOM = null;
  history.replaceState(null, '', '/');
  app.innerHTML = `
    <div class="lobby">
      <div class="panel">
        <h2>Tạo phòng</h2>
        <form id="createForm">
          <label>Tên phòng</label><input type="text" name="name" placeholder="Phòng của ${esc(ME)}" maxlength="40">
          <button class="btn" style="width:100%;margin-top:10px">🎲 Tạo phòng mới</button>
        </form>
        <h2 style="margin-top:22px">Vào bằng mã</h2>
        <form id="joinForm" class="row">
          <input type="text" name="code" placeholder="VD: AB12" maxlength="4" style="flex:1;text-transform:uppercase">
          <button class="btn blue">Vào</button>
        </form>
        <p class="muted" style="margin-top:18px">Bang! cần 4–7 người. Tạo phòng rồi gửi mã hoặc đường link cho bạn bè.</p>
      </div>
      <div class="panel">
        <h2>Các phòng đang mở</h2>
        <div class="room-list" id="roomList"><div class="empty">Đang tải…</div></div>
      </div>
    </div>`;
  $('#createForm').onsubmit = run(async (e) => {
    e.preventDefault();
    const r = await api('/api/rooms', { name: new FormData(e.target).get('name') });
    enterRoom(r.code);
  });
  $('#joinForm').onsubmit = run(async (e) => {
    e.preventDefault();
    const code = String(new FormData(e.target).get('code')).trim().toUpperCase();
    await api(`/api/rooms/${code}/join`, {});
    enterRoom(code);
  });
  lobbyES = new EventSource('/api/lobby/stream');
  lobbyES.onmessage = (ev) => {
    const d = JSON.parse(ev.data);
    if (d.type !== 'lobby') return;
    const list = $('#roomList');
    if (!list) return;
    if (!d.rooms.length) { list.innerHTML = '<div class="empty">Chưa có phòng nào. Hãy tạo một phòng!</div>'; return; }
    list.innerHTML = d.rooms.map((r) => `
      <div class="room-item">
        <div>
          <div><b>${esc(r.name)}</b> <span class="code">${r.code}</span></div>
          <div class="muted">Chủ phòng: ${esc(r.host)} · ${r.players.length}/7 người</div>
        </div>
        <div class="row">
          <span class="badge ${r.status}">${r.status === 'waiting' ? 'Đang chờ' : r.status === 'playing' ? 'Đang chơi' : 'Đã xong'}</span>
          ${r.players.includes(ME) ? `<button class="btn small green" data-join="${r.code}">Quay lại</button>`
            : r.status === 'waiting' && r.players.length < 7 ? `<button class="btn small" data-join="${r.code}">Tham gia</button>` : ''}
        </div>
      </div>`).join('');
    list.querySelectorAll('[data-join]').forEach((b) => b.onclick = run(async () => {
      await api(`/api/rooms/${b.dataset.join}/join`, {});
      enterRoom(b.dataset.join);
    }));
  };
}

// ---------- phòng ----------
function enterRoom(code) {
  closeStreams();
  ui.mode = null; ui.selected = []; ui.lastLogLen = 0;
  history.replaceState(null, '', '#' + code);
  app.innerHTML = `
    <div class="room">
      <div class="room-head">
        <div class="row"><h2 id="roomName"></h2><span class="code">${code}</span>
          <button class="btn ghost small" id="copyLink">📋 Copy link mời</button></div>
        <div class="row" id="roomBtns"></div>
      </div>
      <div id="mainArea"></div>
      <div class="side">
        <div class="panel" id="logPanel" style="display:none"><h3>Diễn biến</h3><div class="log-box" id="logBox"></div></div>
        <div class="panel"><h3>Trò chuyện</h3><div class="chat-box" id="chatBox"></div>
          <form class="chat-form" id="chatForm"><input type="text" name="text" placeholder="Nhắn gì đó…" autocomplete="off" maxlength="300"><button class="btn small">Gửi</button></form>
        </div>
      </div>
    </div>`;
  $('#copyLink').onclick = () => {
    const link = `${location.origin}/#${code}`;
    navigator.clipboard?.writeText(link).then(() => toast('Đã copy link mời!', true), () => toast(link, true));
  };
  $('#chatForm').onsubmit = run(async (e) => {
    e.preventDefault();
    const inp = e.target.text;
    const text = inp.value.trim();
    if (!text) return;
    inp.value = '';
    await api(`/api/rooms/${code}/chat`, { text });
  });
  roomES = new EventSource(`/api/rooms/${code}/stream`);
  roomES.onmessage = (ev) => {
    const d = JSON.parse(ev.data);
    if (d.type === 'closed') { toast('Phòng đã đóng.'); return showLobby(); }
    if (d.type !== 'room') return;
    if (!d.room.players.includes(ME)) { toast('Bạn không còn ở trong phòng.'); return showLobby(); }
    ROOM = d.room;
    renderRoom();
  };
  roomES.onerror = () => { if (roomES && roomES.readyState === EventSource.CLOSED) showLobby(); };
}

function renderRoom() {
  const r = ROOM;
  $('#roomName').textContent = r.name;
  const btns = $('#roomBtns');
  const isHost = r.host === ME;
  const g = r.game;
  const meAlive = g ? g.players.find((p) => p.name === ME)?.alive : true;
  btns.innerHTML = `
    ${isHost && g?.winner ? '<button class="btn green" id="resetBtn">🔁 Về phòng chờ</button>' : ''}
    ${!g || g.winner || !meAlive ? '<button class="btn secondary" id="leaveBtn">Rời phòng</button>' : ''}`;
  $('#leaveBtn') && ($('#leaveBtn').onclick = run(async () => { await api(`/api/rooms/${r.code}/leave`, {}); showLobby(); }));
  $('#resetBtn') && ($('#resetBtn').onclick = run(() => api(`/api/rooms/${r.code}/reset`, {})));

  // chat
  const cb = $('#chatBox');
  const atBottom = cb.scrollTop + cb.clientHeight >= cb.scrollHeight - 10;
  cb.innerHTML = r.chat.map((m) => m.system ? `<div class="sys">${esc(m.text)}</div>` : `<div><b>${esc(m.user)}:</b> ${esc(m.text)}</div>`).join('') || '<div class="sys">Chưa có tin nhắn.</div>';
  if (atBottom) cb.scrollTop = cb.scrollHeight;

  $('#logPanel').style.display = g ? '' : 'none';
  if (!g) return renderWaiting();
  renderGame();
}

function renderWaiting() {
  const r = ROOM;
  const isHost = r.host === ME;
  const n = r.players.length;
  $('#mainArea').innerHTML = `
    <div class="panel">
      <h2>Phòng chờ (${n}/7)</h2>
      <ul class="seat-list">
        ${r.players.map((p) => `<li><span class="dot ${r.online.includes(p) ? 'on' : ''}"></span>
          <b>${esc(p)}</b> ${p === r.host ? '👑' : ''} ${p === ME ? '<span class="muted">(bạn)</span>' : ''}
          ${isHost && p !== ME ? `<button class="btn small secondary" style="margin-left:auto" data-kick="${esc(p)}">Mời ra</button>` : ''}</li>`).join('')}
      </ul>
      <div class="row" style="margin-top:16px">
        ${isHost ? `<button class="btn" id="startBtn" ${n < 4 ? 'disabled' : ''}>🔫 Bắt đầu ván</button>` : '<span class="muted">Chờ chủ phòng bắt đầu…</span>'}
        ${n < 4 ? `<span class="muted">Cần thêm ${4 - n} người nữa.</span>` : ''}
      </div>
      <div class="rules" style="margin-top:18px">
        <h3>Luật nhanh</h3>
        <ul>
          <li><b>Sheriff</b> (lộ diện) + <b>Deputy</b>: tiêu diệt Outlaw và Renegade.</li>
          <li><b>Outlaw</b>: hạ gục Sheriff. <b>Renegade</b>: là người sống sót cuối cùng.</li>
          <li>Mỗi lượt: rút 2 lá → đánh bài tuỳ ý (mỗi lượt 1 Bang!) → bỏ bớt bài thừa so với máu → kết thúc lượt.</li>
          <li>Khoảng cách tính theo chỗ ngồi; súng tăng tầm bắn. Di chuột lên lá bài/nhân vật để xem mô tả.</li>
        </ul>
      </div>
    </div>`;
  $('#startBtn') && ($('#startBtn').onclick = run(() => api(`/api/rooms/${r.code}/start`, {})));
  document.querySelectorAll('[data-kick]').forEach((b) => b.onclick = run(() => api(`/api/rooms/${r.code}/kick`, { player: b.dataset.kick })));
}

// ---------- bàn chơi ----------
const cardInfo = (c) => META.cards[c.name];
function cardHTML(c, cls = '') {
  const info = cardInfo(c);
  const red = c.suit === 'H' || c.suit === 'D';
  return `<div class="card ${info.type} ${cls}" data-card="${c.id}" title="${esc(c.name + ': ' + info.desc)}">
    <div class="corner ${red ? 'red' : ''}">${c.rank}${SUIT[c.suit]}</div>
    <div class="icon">${info.icon}</div><div class="cname">${esc(c.name)}</div>
    ${info.range ? `<div class="range">tầm ${info.range}</div>` : ''}</div>`;
}
function chipHTML(c, cls = '') {
  const info = cardInfo(c);
  return `<span class="chip ${info.type === 'gun' ? 'gun' : ''} ${cls}" data-eq="${c.id}" title="${esc(info.desc)}">${info.icon} ${esc(c.name)}</span>`;
}
function hpHTML(p) {
  let s = '';
  for (let i = 0; i < p.maxHp; i++) s += i < p.hp ? '❤️' : '<span class="lost">❤️</span>';
  return s;
}
function roleBadge(p) {
  return p.role ? `<span class="role ${p.role}" title="${esc(META.roles[p.role].goal)}">${ROLE_VI[p.role]}</span>` : '<span class="role unknown">?</span>';
}

function effectiveName(c, me) {
  if (me.char === 'Calamity Janet' && c.name === 'Missed') return 'Bang';
  return c.name;
}

// Ai có thể bị chọn làm mục tiêu cho lá bài này?
function targetFilter(card, g, meP) {
  const name = effectiveName(card, meP);
  const others = (p) => p.alive && p.name !== ME;
  switch (name) {
    case 'Bang': return (p) => others(p) && p.distance <= g.me.range;
    case 'Panic': return (p) => others(p) && p.distance <= 1 && (p.handCount > 0 || p.eq.length > 0);
    case 'Cat Balou': return (p) => others(p) && (p.handCount > 0 || p.eq.length > 0);
    case 'Duel': return others;
    case 'Jail': return (p) => others(p) && p.role !== 'Sheriff' && !p.eq.some((c) => c.name === 'Jail');
    default: return null;
  }
}

function renderGame() {
  const g = ROOM.game;
  const meIdx = g.me?.index ?? -1;
  const meP = g.players[meIdx];
  const pend = g.pending;
  const myTurn = g.turn === meIdx && !g.winner;
  const myPrompt = pend && pend.player === meIdx;
  const canPlay = myTurn && !pend && g.phase === 'play' && meP.alive;

  // validate mode
  if (ui.mode?.kind === 'target' && !canPlay) ui.mode = null;
  if (ui.mode && ui.mode.kind !== 'target') {
    const hand = g.me.hand.map((c) => c.id);
    if (ui.mode.kind === 'discard' && (!canPlay || g.me.hand.length <= meP.hp)) ui.mode = null;
    if (ui.mode?.kind === 'sid' && (!meP.alive || meP.hp >= meP.maxHp)) ui.mode = null;
    if (ui.mode && ui.mode.kind !== 'kit') ui.selected = ui.selected.filter((id) => hand.includes(id));
    if (ui.mode?.kind === 'kit' && !(myPrompt && pend.type === 'kit')) ui.mode = null;
  }
  if (myPrompt && pend.type === 'kit' && ui.mode?.kind !== 'kit') { ui.mode = { kind: 'kit' }; ui.selected = []; }
  if (!ui.mode) ui.selected = [];

  let tfilter = null;
  if (ui.mode?.kind === 'target') {
    const card = g.me.hand.find((c) => c.id === ui.mode.cardId);
    tfilter = card ? targetFilter(card, g, meP) : null;
    if (!tfilter) ui.mode = null;
  }

  // thứ tự chỗ ngồi bắt đầu từ người sau mình
  const n = g.players.length;
  const order = [];
  for (let k = 1; k < n; k++) order.push((Math.max(meIdx, 0) + k) % n);
  if (meIdx < 0) order.unshift(0);

  const oppHTML = order.map((i) => {
    const p = g.players[i];
    const cls = [
      g.turn === i && !g.winner ? 'turn' : '',
      pend && pend.player === i ? 'acting' : '',
      !p.alive ? 'dead' : '',
      p.winner ? 'winner' : '',
      tfilter ? (tfilter(p) ? 'targetable' : 'notarget') : '',
    ].join(' ');
    const ch = META.chars[p.char];
    return `<div class="player ${cls}" data-player="${esc(p.name)}">
      <div class="pname"><span class="dot ${ROOM.online.includes(p.name) ? 'on' : ''}"></span>${esc(p.name)} ${roleBadge(p)}</div>
      <span class="pchar" title="${esc(ch.desc)}">${esc(p.char)}</span>
      <div class="hp">${p.alive ? hpHTML(p) : '☠️ Đã chết'}</div>
      <div class="pstats"><span title="Số lá trên tay">🂠 ${p.handCount}</span>
        ${p.distance != null ? `<span title="Khoảng cách từ bạn">📏 ${p.distance}</span>` : ''}
        ${g.turn === i && !g.winner ? '<b style="color:#b5332a">⭐ Đang chơi</b>' : ''}</div>
      <div class="eq">${p.eq.map((c) => chipHTML(c)).join('')}</div>
    </div>`;
  }).join('');

  const tableHTML = `
    <div class="table">
      <div class="piles">
        <div class="pile"><div class="card-back">BANG!</div>Chồng bài: ${g.deckCount}</div>
        <div class="pile">${g.discardTop ? cardHTML(g.discardTop, 'small') : '<div class="card-back" style="opacity:.3"></div>'}<div>Bài bỏ</div></div>
      </div>
      <div class="prompt ${myPrompt || (canPlay && !ui.mode) ? 'mine' : ''}" id="prompt">${promptHTML(g, meIdx, meP)}</div>
    </div>`;

  let meHTML = '';
  if (meP) {
    const ch = META.chars[meP.char];
    const role = META.roles[meP.role];
    const playableIds = new Set(g.me.hand.filter((c) => isClickable(c, g, meP)).map((c) => c.id));
    meHTML = `
      <div class="me ${myTurn ? 'turn' : ''} ${!meP.alive ? 'dead' : ''}">
        <div class="me-head">
          <div class="idcard"><span class="role ${meP.role}" style="margin:0">${ROLE_VI[meP.role]}</span> <b>Vai trò của bạn (bí mật)</b>
            <div style="margin-top:4px">${esc(role.goal)}</div></div>
          <div class="idcard"><b>${esc(meP.char)}</b> — ${esc(ch.desc)}</div>
          <div class="idcard"><div class="hp" style="margin:0">${meP.alive ? hpHTML(meP) : '☠️ Bạn đã chết'}</div>
            <div class="muted">Tầm bắn: ${g.me.range}${g.me.unlimitedBang ? ' · Bang! không giới hạn' : ''}</div></div>
        </div>
        <div class="eq" style="margin-top:10px">${meP.eq.length ? meP.eq.map((c) => chipHTML(c)).join('') : '<span class="muted">Chưa có trang bị</span>'}</div>
        <div class="hand" id="hand">${g.me.hand.map((c) => {
          const sel = ui.selected.includes(c.id) || ui.mode?.cardId === c.id;
          return cardHTML(c, (sel ? 'selected ' : '') + (playableIds.has(c.id) ? 'playable' : (canPlay || myPrompt ? 'dim' : '')));
        }).join('') || '<span class="muted">Không có bài trên tay.</span>'}</div>
        <div class="actions" id="actions">${actionsHTML(g, meP, canPlay)}</div>
      </div>`;
  }

  $('#mainArea').innerHTML = `<div class="board">${g.winner ? winnerHTML(g) : ''}<div class="opponents">${oppHTML}</div>${tableHTML}${meHTML}</div>`;

  // log
  const lb = $('#logBox');
  lb.innerHTML = g.log.map((l) => `<div class="${l.startsWith('—') ? 'turnline' : ''}">${esc(l)}</div>`).join('');
  lb.scrollTop = lb.scrollHeight;

  bindGame(g, meIdx, meP, canPlay, myPrompt);
}

function isClickable(c, g, meP) {
  const pend = g.pending;
  if (!meP.alive || g.winner) return false;
  if (ui.mode && ['discard', 'sid'].includes(ui.mode.kind)) return true;
  if (pend && pend.player === g.me.index) {
    const n = c.name;
    if (pend.type === 'bang') return n === 'Missed' || (n === 'Bang' && meP.char === 'Calamity Janet');
    if (pend.type === 'indians' || pend.type === 'duel') return n === 'Bang' || (n === 'Missed' && meP.char === 'Calamity Janet');
    return false;
  }
  if (g.turn !== g.me.index || pend || g.phase !== 'play') return false;
  const name = effectiveName(c, meP);
  if (name === 'Missed') return false;
  if (name === 'Bang' && g.bangsPlayed >= 1 && !g.me.unlimitedBang) return false;
  if (name === 'Beer' && (meP.hp >= meP.maxHp || g.players.filter((p) => p.alive).length <= 2)) return false;
  if (['Barrel', 'Mustang', 'Scope', 'Dynamite'].includes(c.name) && meP.eq.some((e) => e.name === c.name)) return false;
  const tf = targetFilter(c, g, meP);
  if (tf && !g.players.some(tf)) return false;
  return true;
}

function promptHTML(g, meIdx, meP) {
  const pend = g.pending;
  const P = (i) => `<b>${esc(g.players[i].name)}</b>`;
  if (g.winner) return '<h4>Ván đấu đã kết thúc.</h4><div class="muted">Xem kết quả ở trên.</div>';
  if (ui.mode?.kind === 'target') {
    const c = g.me.hand.find((x) => x.id === ui.mode.cardId);
    return `<h4>🎯 Chọn mục tiêu cho ${esc(c?.name)}</h4><div class="muted">Bấm vào người chơi được viền đỏ.</div>
      <div class="row"><button class="btn secondary small" data-act="cancel">Huỷ</button></div>`;
  }
  if (ui.mode?.kind === 'discard') {
    const ex = g.me.hand.length - meP.hp;
    return `<h4>🗑️ Chọn ${ex} lá để bỏ</h4><div class="muted">Đã chọn ${ui.selected.length}/${ex}.</div>
      <div class="row"><button class="btn" data-act="confirmDiscard" ${ui.selected.length ? '' : 'disabled'}>Bỏ các lá đã chọn</button>
      <button class="btn secondary small" data-act="cancel">Huỷ</button></div>`;
  }
  if (ui.mode?.kind === 'sid') {
    return `<h4>Sid Ketchum: chọn 2 lá để bỏ và hồi 1 máu</h4><div class="muted">Đã chọn ${ui.selected.length}/2.</div>
      <div class="row"><button class="btn" data-act="confirmSid" ${ui.selected.length === 2 ? '' : 'disabled'}>Xác nhận</button>
      <button class="btn secondary small" data-act="cancel">Huỷ</button></div>`;
  }
  if (!pend) {
    if (g.turn === meIdx) {
      return `<h4>⭐ Lượt của bạn!</h4><div class="muted">Bấm vào lá bài sáng để dùng. ${g.me.unlimitedBang ? '' : `Bang! đã dùng: ${g.bangsPlayed}/1.`}
        Khi xong, bấm <b>Kết thúc lượt</b>.</div>`;
    }
    return `<h4>Lượt của ${P(g.turn)}</h4><div class="muted">Đang chờ người chơi hành động…</div>`;
  }
  const mine = pend.player === meIdx;
  switch (pend.type) {
    case 'bang': {
      const left = pend.need - pend.got;
      if (!mine) return `<h4>💥 ${P(pend.source)} bắn ${P(pend.player)}!</h4><div class="muted">Đang chờ ${P(pend.player)} phản ứng…</div>`;
      return `<h4>💥 ${P(pend.source)} bắn bạn!</h4>
        <div>Cần thêm <b>${left}</b> Missed! để né${pend.need > 1 ? ' (Slab the Killer)' : ''}. Bấm lá Missed! trên tay${meP.char === 'Calamity Janet' ? ' (hoặc Bang!)' : ''}.</div>
        <div class="row">${pend.barrels > 0 ? `<button class="btn blue" data-act="barrel">🛢️ Dùng Barrel (${pend.barrels})</button>` : ''}
        <button class="btn secondary" data-act="take">Chịu mất 1 máu</button></div>`;
    }
    case 'indians':
      if (!mine) return `<h4>🪶 Thổ dân tấn công!</h4><div class="muted">Đang chờ ${P(pend.player)} bỏ Bang! hoặc chịu mất máu…</div>`;
      return `<h4>🪶 Thổ dân của ${P(pend.source)} tấn công!</h4><div>Bỏ 1 lá Bang! hoặc mất 1 máu.</div>
        <div class="row"><button class="btn secondary" data-act="take">Chịu mất 1 máu</button></div>`;
    case 'duel':
      if (!mine) return `<h4>🤠 Đấu súng: ${P(pend.player)} vs ${P(pend.other)}</h4><div class="muted">Đang chờ ${P(pend.player)} bỏ Bang!…</div>`;
      return `<h4>🤠 Đấu súng với ${P(pend.other)}!</h4><div>Bỏ 1 lá Bang! để tiếp tục, hoặc chịu thua mất 1 máu.</div>
        <div class="row"><button class="btn secondary" data-act="take">Chịu thua (mất 1 máu)</button></div>`;
    case 'store':
      return `<h4>🏪 General Store — ${mine ? 'chọn 1 lá:' : `đang chờ ${P(pend.player)} chọn…`}</h4>
        <div class="row" id="storeCards">${pend.cards.map((c) => cardHTML(c, 'small ' + (mine ? 'playable' : ''))).join('')}</div>`;
    case 'kit':
      if (!mine) return `<h4>Kit Carlson ${P(pend.player)} đang chọn bài…</h4>`;
      return `<h4>Kit Carlson: chọn 2 lá để giữ</h4>
        <div class="row" id="kitCards">${pend.cards.map((c) => cardHTML(c, 'small playable ' + (ui.selected.includes(c.id) ? 'selected' : ''))).join('')}</div>
        <div class="row"><button class="btn" data-act="confirmKit" ${ui.selected.length === Math.min(2, pend.cards.length) ? '' : 'disabled'}>Giữ 2 lá này</button></div>`;
    case 'draw': {
      if (!mine) return `<h4>${P(pend.player)} đang chọn cách rút bài…</h4>`;
      const opts = [];
      opts.push('<button class="btn" data-act="draw" data-from="deck">Rút 2 lá từ chồng bài</button>');
      if (pend.options.includes('discard') && g.discardTop) opts.push(`<button class="btn blue" data-act="draw" data-from="discard">Lấy ${esc(g.discardTop.name)} từ bài bỏ + 1 lá</button>`);
      if (pend.options.includes('player')) {
        const cand = g.players.filter((p) => p.alive && p.name !== ME && p.handCount > 0);
        opts.push(`<select id="drawTarget">${cand.map((p) => `<option>${esc(p.name)}</option>`).join('')}</select>
          <button class="btn blue" data-act="draw" data-from="player">Lấy ngẫu nhiên 1 lá từ người này + 1 lá</button>`);
      }
      return `<h4>Chọn cách rút bài</h4><div class="row">${opts.join('')}</div>`;
    }
  }
  return '';
}

function actionsHTML(g, meP, canPlay) {
  if (!meP.alive || g.winner) return '';
  const out = [];
  if (canPlay && !ui.mode) {
    const excess = g.me.hand.length - meP.hp;
    if (excess > 0) out.push(`<button class="btn" data-act="discardMode">🗑️ Bỏ bớt ${excess} lá rồi kết thúc</button>`);
    else out.push('<button class="btn green" data-act="endTurn">✅ Kết thúc lượt</button>');
  }
  if (meP.char === 'Sid Ketchum' && meP.hp < meP.maxHp && g.me.hand.length >= 2 && !ui.mode) out.push('<button class="btn blue" data-act="sidMode">Dùng kỹ năng Sid (bỏ 2 lá, +1 máu)</button>');
  out.push(`<span class="muted">Máu ${meP.hp}/${meP.maxHp} · ${g.me.hand.length} lá trên tay (tối đa giữ ${meP.hp} lá khi hết lượt)</span>`);
  return out.join('');
}

function winnerHTML(g) {
  const names = { Sheriff: 'Phe Sheriff', Outlaw: 'Phe Outlaw', Renegade: 'Renegade' };
  const winners = g.players.filter((p) => p.winner).map((p) => esc(p.name)).join(', ');
  const iWon = g.players.find((p) => p.name === ME)?.winner;
  return `<div class="panel winner-banner"><div style="font-size:40px">${iWon ? '🏆' : '💀'}</div>
    <h3>${names[g.winner]} chiến thắng!</h3><div>${winners}</div>
    <div class="muted" style="margin-top:6px">${iWon ? 'Chúc mừng, cao bồi!' : 'Lần sau may mắn hơn nhé.'} ${ROOM.host === ME ? 'Bấm “Về phòng chờ” để chơi ván mới.' : 'Chờ chủ phòng mở ván mới.'}</div></div>`;
}

const sendAction = (action) => api(`/api/rooms/${ROOM.code}/action`, { action });

function bindGame(g, meIdx, meP, canPlay, myPrompt) {
  const main = $('#mainArea');
  const pend = g.pending;

  main.querySelectorAll('#hand .card').forEach((el) => el.onclick = run(async () => {
    const id = Number(el.dataset.card);
    const c = g.me.hand.find((x) => x.id === id);
    if (ui.mode && ['discard', 'sid'].includes(ui.mode.kind)) {
      const max = ui.mode.kind === 'sid' ? 2 : g.me.hand.length - meP.hp;
      if (ui.selected.includes(id)) ui.selected = ui.selected.filter((x) => x !== id);
      else if (ui.selected.length < max) ui.selected.push(id);
      return renderGame();
    }
    if (myPrompt && ['bang', 'indians', 'duel'].includes(pend.type)) {
      if (!isClickable(c, g, meP)) return toast(pend.type === 'bang' ? 'Cần lá Missed! để né.' : 'Cần lá Bang!.');
      return sendAction({ type: 'respond', cardId: id });
    }
    if (!canPlay) return toast(myPrompt ? 'Hãy xử lý yêu cầu ở giữa bàn trước.' : 'Chưa đến lượt bạn.');
    if (ui.mode?.kind === 'target' && ui.mode.cardId === id) { ui.mode = null; return renderGame(); }
    if (!isClickable(c, g, meP)) {
      const nm = effectiveName(c, meP);
      if (nm === 'Missed') return toast('Missed! chỉ dùng khi bị bắn.');
      if (nm === 'Bang') return toast(g.bangsPlayed >= 1 ? 'Mỗi lượt chỉ được 1 Bang!.' : 'Không có ai trong tầm bắn.');
      if (nm === 'Beer') return toast('Không dùng Beer được lúc này.');
      return toast('Không dùng được lá này lúc này.');
    }
    if (targetFilter(c, g, meP)) { ui.mode = { kind: 'target', cardId: id }; return renderGame(); }
    ui.mode = null;
    await sendAction({ type: 'play', cardId: id });
  }));

  main.querySelectorAll('.player').forEach((el) => el.onclick = run(async () => {
    if (ui.mode?.kind !== 'target') return;
    const p = g.players.find((x) => x.name === el.dataset.player);
    const card = g.me.hand.find((x) => x.id === ui.mode.cardId);
    const tf = targetFilter(card, g, meP);
    if (!tf || !tf(p)) return toast('Không chọn được người này.');
    const nm = effectiveName(card, meP);
    if (nm === 'Panic' || nm === 'Cat Balou') {
      if (!p.eq.length) { ui.mode = null; return sendAction({ type: 'play', cardId: card.id, target: p.name, targetCard: 'hand' }); }
      return chooseTargetCard(card, p);
    }
    ui.mode = null;
    await sendAction({ type: 'play', cardId: card.id, target: p.name });
  }));

  main.querySelectorAll('#storeCards .card').forEach((el) => el.onclick = run(async () => {
    if (!myPrompt) return;
    await sendAction({ type: 'pick', cardId: Number(el.dataset.card) });
  }));
  main.querySelectorAll('#kitCards .card').forEach((el) => el.onclick = () => {
    const id = Number(el.dataset.card);
    if (ui.selected.includes(id)) ui.selected = ui.selected.filter((x) => x !== id);
    else if (ui.selected.length < 2) ui.selected.push(id);
    renderGame();
  });

  main.querySelectorAll('[data-act]').forEach((el) => el.onclick = run(async () => {
    const act = el.dataset.act;
    if (act === 'cancel') { ui.mode = null; ui.selected = []; return renderGame(); }
    if (act === 'discardMode') { ui.mode = { kind: 'discard' }; ui.selected = []; return renderGame(); }
    if (act === 'sidMode') { ui.mode = { kind: 'sid' }; ui.selected = []; return renderGame(); }
    if (act === 'confirmDiscard') {
      const ids = ui.selected; ui.mode = null; ui.selected = [];
      await sendAction({ type: 'discard', cardIds: ids });
      const hp = meP.hp;
      if (g.me.hand.length - ids.length <= hp) await sendAction({ type: 'endTurn' });
      return;
    }
    if (act === 'confirmSid') { const ids = ui.selected; ui.mode = null; ui.selected = []; return sendAction({ type: 'sid', cardIds: ids }); }
    if (act === 'confirmKit') { const ids = ui.selected; ui.mode = null; ui.selected = []; return sendAction({ type: 'kit', cardIds: ids }); }
    if (act === 'endTurn') return sendAction({ type: 'endTurn' });
    if (act === 'take') return sendAction({ type: 'take' });
    if (act === 'barrel') return sendAction({ type: 'barrel' });
    if (act === 'draw') return sendAction({ type: 'drawChoice', from: el.dataset.from, target: $('#drawTarget')?.value });
  }));
}

function chooseTargetCard(card, p) {
  const modal = $('#modal');
  modal.innerHTML = `<div class="panel"><h3>${esc(card.name)}: chọn lá của ${esc(p.name)}</h3>
    <div class="row">
      ${p.handCount ? `<button class="btn" data-tc="hand">🂠 1 lá ngẫu nhiên trên tay (${p.handCount})</button>` : ''}
      ${p.eq.map((c) => `<button class="btn blue" data-tc="${c.id}">${cardInfo(c).icon} ${esc(c.name)}</button>`).join('')}
    </div>
    <div class="row" style="margin-top:14px"><button class="btn secondary small" data-tc="cancel">Huỷ</button></div></div>`;
  modal.classList.remove('hidden');
  modal.querySelectorAll('[data-tc]').forEach((b) => b.onclick = run(async () => {
    modal.classList.add('hidden');
    if (b.dataset.tc === 'cancel') return;
    ui.mode = null;
    await sendAction({ type: 'play', cardId: card.id, target: p.name, targetCard: b.dataset.tc === 'hand' ? 'hand' : Number(b.dataset.tc) });
  }));
}

// ---------- khởi động ----------
(async function init() {
  try {
    META = await api('/api/meta');
    const me = await api('/api/me');
    ME = me.user;
    renderUserbox();
    if (ME) afterLogin(); else showAuth();
  } catch (e) {
    app.innerHTML = `<div class="loading">Không kết nối được server: ${esc(e.message)}</div>`;
  }
})();

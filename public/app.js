'use strict';
const $ = (s, el = document) => el.querySelector(s);
const app = $('#app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SUIT = { S: '♠', H: '♥', D: '♦', C: '♣' };
const ROLE_VI = { Sheriff: 'Sheriff', Deputy: 'Deputy', Outlaw: 'Outlaw', Renegade: 'Renegade' };

let META = null, ME = null, ROOM = null;
let lobbyES = null, roomES = null;
const ui = { mode: null, selected: [], lastLogLen: 0, drawTarget: null };

// ---------- tooltip bám chuột ----------
function tooltipAttrs(title, description) {
  return `data-tooltip-title="${esc(title)}" data-tooltip="${esc(description)}"`;
}

function initTooltips() {
  const tooltip = document.createElement('div');
  tooltip.id = 'gameTooltip';
  tooltip.className = 'game-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  const heading = document.createElement('strong');
  const description = document.createElement('div');
  tooltip.append(heading, description);
  document.body.appendChild(tooltip);

  let active = null, pointer = null;
  function hide() {
    active?.removeAttribute('aria-describedby');
    active = null;
    tooltip.hidden = true;
  }
  function update(target) {
    const source = target?.closest?.('[data-tooltip]');
    if (!source || !pointer) { hide(); return; }
    if (active !== source) {
      hide();
      active = source;
      source.setAttribute('aria-describedby', tooltip.id);
    }
    heading.textContent = source.dataset.tooltipTitle || '';
    heading.hidden = !heading.textContent;
    description.textContent = source.dataset.tooltip;
    tooltip.hidden = false;

    const { width, height } = tooltip.getBoundingClientRect();
    const gap = 16, edge = 8;
    let x = pointer.x + gap, y = pointer.y + gap;
    if (x + width > window.innerWidth - edge) x = pointer.x - width - gap;
    if (y + height > window.innerHeight - edge) y = pointer.y - height - gap;
    tooltip.style.left = `${Math.max(edge, Math.min(x, window.innerWidth - width - edge))}px`;
    tooltip.style.top = `${Math.max(edge, Math.min(y, window.innerHeight - height - edge))}px`;
  }
  function track(event) {
    if (event.pointerType === 'touch') return;
    pointer = { x: event.clientX, y: event.clientY };
    update(event.target);
  }
  document.addEventListener('pointerover', track);
  document.addEventListener('pointermove', track);
  document.addEventListener('pointerout', (event) => {
    if (event.pointerType === 'touch') return;
    if (!event.relatedTarget) pointer = null;
    update(event.relatedTarget);
  });
  document.addEventListener('pointercancel', () => { pointer = null; hide(); });
  window.addEventListener('blur', () => { pointer = null; hide(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { pointer = null; hide(); } });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') hide(); });
  const refresh = () => { if (pointer) update(document.elementFromPoint(pointer.x, pointer.y)); };
  document.addEventListener('scroll', refresh, true);
  window.addEventListener('resize', refresh);
  // SSE và thao tác chọn bài thay DOM: kiểm tra lại vùng hover dù chuột đứng yên.
  const observer = new MutationObserver(refresh);
  observer.observe(app, { childList: true, subtree: true });
  observer.observe($('#modal'), { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
}

initTooltips();

// ---------- tiện ích ----------
async function api(path, body) {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(j.error || 'Có lỗi xảy ra.'); e.passwordRequired = j.passwordRequired; throw e; }
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
    try { if (await joinRoom(hashCode)) return; }
    catch (e) { toast(e.message); history.replaceState(null, '', '/'); }
  }
  showLobby();
}

function askRoomPassword(code) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'panel password-dialog';
    dialog.innerHTML = `<form><h2>Vào phòng ${esc(code)}</h2><label for="joinPassword">Mật khẩu phòng</label>
      <input id="joinPassword" type="password" maxlength="64" autocomplete="off" required>
      <div class="row" style="margin-top:16px"><button class="btn">Tham gia</button><button type="button" class="btn secondary">Hủy</button></div></form>`;
    const done = (value) => { dialog.remove(); resolve(value); };
    dialog.querySelector('form').onsubmit = (e) => { e.preventDefault(); done(dialog.querySelector('input').value); };
    dialog.querySelector('[type=button]').onclick = () => done(null);
    dialog.oncancel = (e) => { e.preventDefault(); done(null); };
    document.body.appendChild(dialog);
    dialog.showModal();
    dialog.querySelector('input').focus();
  });
}

async function joinRoom(code) {
  let password;
  for (;;) {
    try {
      await api(`/api/rooms/${code}/join`, { password });
      enterRoom(code);
      return true;
    } catch (e) {
      if (!e.passwordRequired) throw e;
      if (password !== undefined) toast(e.message);
      password = await askRoomPassword(code);
      if (password === null) return false;
    }
  }
}

function timerField(value = 0) {
  return `<label for="turnSeconds">Thời gian mỗi lượt (giây)</label>
    <input id="turnSeconds" type="number" name="turnSeconds" min="0" max="600" step="1" value="${esc(value)}" required>
    <p class="muted">0 = tắt; từ 10–600 giây. Tạm dừng lượt khi chờ phản hồi; mỗi phản hồi có timer riêng cùng thời lượng.</p>`;
}
function charField(value = 3) {
  const v = Number(value) || 3;
  return `<label for="charChoices">Số lá nhân vật mỗi người rút để chọn</label>
    <select id="charChoices" name="charChoices">${[1, 2, 3, 4, 5].map((n) =>
      `<option value="${n}" ${n === v ? 'selected' : ''}>${n}${n === 1 ? ' (chia ngẫu nhiên, không chọn)' : ' lá'}</option>`).join('')}</select>
    <p class="muted">Mặc định 3. Bang! chỉ có 16 nhân vật nên phòng 6–7 người tối đa 2 lá mỗi người.</p>`;
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
          <label for="createPassword">Mật khẩu phòng (không bắt buộc)</label><input id="createPassword" type="password" name="password" maxlength="64" autocomplete="new-password">
          ${timerField()}
          ${charField()}
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
    const f = new FormData(e.target);
    const r = await api('/api/rooms', { name: f.get('name'), password: f.get('password'), turnSeconds: Number(f.get('turnSeconds')), charChoices: Number(f.get('charChoices')) });
    enterRoom(r.code);
  });
  $('#joinForm').onsubmit = run(async (e) => {
    e.preventDefault();
    const code = String(new FormData(e.target).get('code')).trim().toUpperCase();
    await joinRoom(code);
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
          <div><b>${esc(r.name)}</b> <span class="code">${r.code}</span> ${r.hasPassword ? '🔒' : ''}</div>
          <div class="muted">Chủ phòng: ${esc(r.host)} · ${r.players.length}/7 người · ${r.turnSeconds ? r.turnSeconds + ' giây/lượt' : 'Không giới hạn giờ'}</div>
        </div>
        <div class="row">
          <span class="badge ${r.status}">${r.status === 'waiting' ? 'Đang chờ' : r.status === 'playing' ? 'Đang chơi' : 'Đã xong'}</span>
          ${r.players.includes(ME) ? `<button class="btn small green" data-join="${r.code}">Quay lại</button>`
            : r.status === 'waiting' && r.players.length < 7 ? `<button class="btn small" data-join="${r.code}">Tham gia</button>` : ''}
        </div>
      </div>`).join('');
    list.querySelectorAll('[data-join]').forEach((b) => b.onclick = run(async () => {
      await joinRoom(b.dataset.join);
    }));
  };
}

// ---------- phòng ----------
function enterRoom(code) {
  closeStreams();
  ui.mode = null; ui.selected = []; ui.lastLogLen = 0;
  ui.settingsDraft = null;
  ui.lastCheckSeq = null;
  history.replaceState(null, '', '#' + code);
  app.innerHTML = `
    <div class="room">
      <div class="room-head">
        <div class="row"><h2 id="roomName"></h2><span class="code">${code}</span>
          <button class="btn ghost small" id="copyLink">📋 Copy link mời</button>${settingsMenuHTML()}</div>
        <div class="row" id="roomBtns"></div>
        <div id="turnClock" role="timer"></div>
      </div>
      <div id="mainArea"></div>
      <div class="side">
        <div class="panel" id="logPanel" style="display:none"><h3>Diễn biến</h3><div class="log-box" id="logBox"></div></div>
        <div class="panel chat-panel ${chatCollapsed() ? 'collapsed' : ''}" id="chatPanel">
          <h3><button type="button" class="chat-toggle" id="chatToggle" aria-expanded="${!chatCollapsed()}">
            <span>Trò chuyện</span><span class="unread" id="chatUnread" hidden></span><span class="chev" aria-hidden="true">▾</span></button></h3>
          <div class="chat-body"><div class="chat-box" id="chatBox"></div>
            <form class="chat-form" id="chatForm"><input type="text" name="text" placeholder="Nhắn gì đó…" autocomplete="off" maxlength="300"><button class="btn small">Gửi</button></form></div>
        </div>
      </div>
    </div>`;
  bindSettingsMenu();
  ui.chatSeenT = null;
  $('#chatToggle').onclick = () => {
    const collapsed = !$('#chatPanel').classList.contains('collapsed');
    $('#chatPanel').classList.toggle('collapsed', collapsed);
    $('#chatToggle').setAttribute('aria-expanded', String(!collapsed));
    try { localStorage.setItem('bang.chatCollapsed', collapsed ? '1' : '0'); } catch {}
    if (ROOM) updateChatUnread(ROOM.chat);
    if (!collapsed) { const cb = $('#chatBox'); cb.scrollTop = cb.scrollHeight; $('#chatForm').text.focus(); }
  };
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
    ui.serverOffset = ROOM.serverNow - Date.now();
    renderRoom();
  };
  roomES.onerror = () => { if (roomES && roomES.readyState === EventSource.CLOSED) showLobby(); };
}

// Ô trò chuyện thu gọn được (nhớ trên máy); khi thu gọn thì đếm tin mới của người khác
function chatCollapsed() { try { return localStorage.getItem('bang.chatCollapsed') === '1'; } catch { return false; } }
function updateChatUnread(chat) {
  const latest = chat.reduce((t, m) => Math.max(t, m.t || 0), 0);
  const collapsed = $('#chatPanel')?.classList.contains('collapsed');
  if (ui.chatSeenT == null || !collapsed) ui.chatSeenT = latest;
  const n = chat.filter((m) => !m.system && m.user !== ME && (m.t || 0) > ui.chatSeenT).length;
  const badge = $('#chatUnread');
  if (!badge) return;
  badge.hidden = !n;
  badge.textContent = n > 9 ? '9+' : String(n);
}

function renderRoom() {
  const r = ROOM;
  $('#roomName').textContent = r.name;
  updateClock();
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
  updateChatUnread(r.chat);

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
      <div class="room-settings">
        <h3>Cài đặt phòng</h3>
        <p>${r.hasPassword ? '🔒 Có mật khẩu' : '🔓 Không có mật khẩu'} · ${r.turnSeconds ? r.turnSeconds + ' giây/lượt' : 'Không giới hạn thời gian'}
          · ${r.charChoices > 1 ? `Mỗi người rút ${r.charChoices} nhân vật để chọn` : 'Nhân vật chia ngẫu nhiên'}</p>
        ${isHost ? `<form id="settingsForm">
          ${timerField(ui.settingsDraft?.turnSeconds ?? r.turnSeconds)}
          ${charField(ui.settingsDraft?.charChoices ?? r.charChoices)}
          <label for="roomPassword">Mật khẩu mới (để trống để giữ nguyên)</label>
          <input id="roomPassword" type="password" name="password" maxlength="64" autocomplete="new-password" value="${esc(ui.settingsDraft?.password || '')}">
          <label><input type="checkbox" name="removePassword" ${ui.settingsDraft?.removePassword ? 'checked' : ''}> Xóa mật khẩu phòng</label>
          <button class="btn small blue">Lưu cài đặt</button>
        </form>` : '<p class="muted">Chủ phòng có thể đổi cài đặt trước khi bắt đầu.</p>'}
      </div>
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
  const settings = $('#settingsForm');
  if (settings) {
    settings.oninput = () => {
      const f = new FormData(settings);
      ui.settingsDraft = { turnSeconds: f.get('turnSeconds'), charChoices: f.get('charChoices'), password: f.get('password'), removePassword: f.has('removePassword') };
    };
    settings.onsubmit = run(async (e) => {
      e.preventDefault();
      const f = new FormData(settings);
      const body = { turnSeconds: Number(f.get('turnSeconds')), charChoices: Number(f.get('charChoices')) };
      if (f.has('removePassword')) body.password = '';
      else if (f.get('password')) body.password = f.get('password');
      await api(`/api/rooms/${r.code}/settings`, body);
      ui.settingsDraft = null;
      if (ROOM && !ROOM.game) renderWaiting();
      toast('Đã lưu cài đặt phòng.', true);
    });
  }
  document.querySelectorAll('[data-kick]').forEach((b) => b.onclick = run(() => api(`/api/rooms/${r.code}/kick`, { player: b.dataset.kick })));
}

function updateClock() {
  const el = $('#turnClock');
  if (!el) return;
  const t = ROOM?.timer;
  el.hidden = !t;
  if (!t) return;
  const seconds = Math.max(0, Math.ceil((t.deadline - Date.now() - (ui.serverOffset || 0)) / 1000));
  const name = ROOM.game.players[t.player].name;
  el.textContent = ROOM.game.phase === 'choose' ? `⏱ Chọn nhân vật: ${seconds}s` : `⏱ ${name} · ${t.response ? 'Phản hồi' : 'Lượt chơi'}: ${seconds}s`;
  el.classList.toggle('urgent', seconds <= 10);
}
setInterval(updateClock, 250);

// ---------- bàn chơi ----------
const cardInfo = (c) => META.cards[c.name];
function cardHTML(c, cls = '') {
  const info = cardInfo(c);
  const red = c.suit === 'H' || c.suit === 'D';
  return `<div class="card ${info.type} ${cls}" data-card="${c.id}" ${tooltipAttrs(c.name, info.desc)}>
    <div class="corner ${red ? 'red' : ''}">${c.rank}${SUIT[c.suit]}</div>
    <div class="icon">${info.icon}</div><div class="cname">${esc(c.name)}</div>
    ${info.range ? `<div class="range">tầm ${info.range}</div>` : ''}</div>`;
}
// Chồng bài bỏ: 3 lá gần nhất, lá sau đè một phần lên lá trước
function discardStackHTML(g) {
  const cards = g.discardRecent || (g.discardTop ? [g.discardTop] : []);
  if (!cards.length) return '<div class="card-back" style="opacity:.3"></div>';
  const n = cards.length;
  return `<div class="discard-stack" style="--n:${n}">${cards.map((c, i) =>
    `<div class="ds-slot" style="--i:${n - 1 - i}">${cardHTML(c, 'small')}</div>`).join('')}</div>`;
}
// Thẻ trang bị vuông: màu theo loại, huy hiệu góc = tầm bắn (súng) hoặc ±khoảng cách (ngựa/ống ngắm)
const EQ_KIND = { Mustang: ['horse', '+1'], Scope: ['horse', '−1'], Jail: ['jail', ''], Dynamite: ['dyn', ''] };
function eqTileHTML(c, extra = '') {
  const info = cardInfo(c);
  const [kind, badge] = info.type === 'gun' ? ['gun', String(info.range)] : (EQ_KIND[c.name] || ['', '']);
  return `<div class="eqt ${kind} ${extra}" data-eq="${c.id}" ${tooltipAttrs(c.name, info.desc)}>
    <span class="ic">${info.icon}</span><span class="nm">${esc(c.name)}</span>${badge ? `<span class="bd">${badge}</span>` : ''}</div>`;
}
// Thanh máu bằng viên đạn: đạn đồng = máu còn, vỏ đạn xám = máu đã mất
function bulletSVG(full, h) {
  return `<svg width="${Math.round(h * .45)}" height="${h}" viewBox="0 0 10 24" aria-hidden="true">${full
    ? `<path d="M5 0C8 2.5 8.6 5.5 8.6 9H1.4C1.4 5.5 2 2.5 5 0z" fill="#c8682c" stroke="#6b3412" stroke-width=".8"/>
       <rect x="1.4" y="9" width="7.2" height="12" fill="#e2b04a" stroke="#7a5512" stroke-width=".8"/>
       <rect x=".6" y="20.6" width="8.8" height="3" rx=".6" fill="#c9962f" stroke="#7a5512" stroke-width=".8"/>
       <rect x="2.6" y="10" width="1.3" height="10" fill="#fbe39a" opacity=".8"/>`
    : `<rect x="1.4" y="9" width="7.2" height="12" fill="#5d5a55" stroke="#2c2a27" stroke-width=".8" opacity=".75"/>
       <ellipse cx="5" cy="9" rx="3.6" ry="1" fill="#1d1c1a"/>
       <rect x=".6" y="20.6" width="8.8" height="3" rx=".6" fill="#4a4743" stroke="#2c2a27" stroke-width=".8"/>`}</svg>`;
}
function hpBarHTML(p, h = 22) {
  if (!p.alive) return '<div class="hpbar dead">☠️ Đã chết</div>';
  let s = '';
  for (let i = 0; i < p.maxHp; i++) s += bulletSVG(i < p.hp, h);
  return `<div class="hpbar ${p.hp === 1 ? 'low' : ''}" title="Máu ${p.hp}/${p.maxHp}">${s}</div>`;
}
// Số bài trên tay: quạt lưng bài đỏ, lá trước trắng ghi số. Vẽ min(n, 3) lá; hết bài thì 1 lá viền nét đứt.
function handFanHTML(n) {
  if (!n) return `<span class="hand-fan zero" ${tooltipAttrs('Bài trên tay', 'Không còn bài trên tay.')}><span class="c front">0</span></span>`;
  const k = Math.min(n, 3), spread = k > 1 ? 14 : 0;
  let s = '';
  for (let j = 0; j < k; j++) {
    const front = j === k - 1;
    s += `<span class="c ${front ? 'front' : ''}" style="left:${j * 6}px;transform:rotate(${(j - (k - 1) / 2) * spread}deg)">${front ? n : ''}</span>`;
  }
  return `<span class="hand-fan" ${tooltipAttrs('Bài trên tay', 'Số lá bài người chơi đang giữ trên tay: ' + n)} style="width:${17 + (k - 1) * 6}px">${s}</span>`;
}
const CHAR_ICON = {
  // Chỉ dùng emoji đơn (không ghép ZWJ) để hiển thị được trên Windows cũ
  'Bart Cassidy': '🧔', 'Black Jack': '🎩', 'Calamity Janet': '👩', 'El Gringo': '🌵', 'Jesse Jones': '🧑',
  'Jourdonnais': '👴', 'Kit Carlson': '🧓', 'Lucky Duke': '🍀', 'Paul Regret': '👨', 'Pedro Ramirez': '👱',
  'Rose Doolan': '🌹', 'Sid Ketchum': '👦', 'Slab the Killer': '😠', 'Suzy Lafayette': '🎀', 'Vulture Sam': '🦅', 'Willy the Kid': '🤠',
};

// ---------- cài đặt hiển thị (lưu trên máy từng người) ----------
const EQ_SIZES = { sm: 'Nhỏ', md: 'Vừa', lg: 'To' };
function applyEqSize(sz) {
  if (!EQ_SIZES[sz]) sz = 'md';
  document.body.classList.remove('eq-sm', 'eq-md', 'eq-lg');
  document.body.classList.add('eq-' + sz);
  try { localStorage.setItem('bang.eqSize', sz); } catch {}
  document.querySelectorAll('[data-eqsize]').forEach((b) => b.classList.toggle('on', b.dataset.eqsize === sz));
}
function currentEqSize() { try { return localStorage.getItem('bang.eqSize') || 'md'; } catch { return 'md'; } }
applyEqSize(currentEqSize());
function settingsMenuHTML() {
  return `<div class="gear"><button class="btn ghost small" id="gearBtn" aria-expanded="false">⚙️ Cài đặt</button>
    <div class="settings-pop" id="settingsPop" hidden>
      <h4>Cài đặt hiển thị</h4>
      <div class="lbl">Cỡ thẻ trang bị</div>
      <div class="seg">${Object.entries(EQ_SIZES).map(([k, v], i) =>
        `<button type="button" data-eqsize="${k}"><i style="width:${12 + i * 4}px;height:${12 + i * 4}px"></i>${v}</button>`).join('')}</div>
      <div class="muted" style="margin-top:8px">Chỉ áp dụng trên máy của bạn. Cỡ nhỏ ẩn tên thẻ, rê chuột để xem.</div>
    </div></div>`;
}
function bindSettingsMenu() {
  const btn = $('#gearBtn'), pop = $('#settingsPop');
  if (!btn) return;
  btn.onclick = (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; btn.setAttribute('aria-expanded', String(!pop.hidden)); };
  pop.onclick = (e) => { e.stopPropagation(); const b = e.target.closest('[data-eqsize]'); if (b) applyEqSize(b.dataset.eqsize); };
  applyEqSize(currentEqSize());
}
// Bàn đổi bán kính ghế khi qua mốc màn hình hẹp
window.matchMedia('(max-width: 900px)').addEventListener('change', () => { if (ROOM?.game && $('#mainArea')) renderGame(); });
// Bấm ra ngoài hoặc nhấn Esc thì đóng bảng cài đặt
function closeSettingsMenu() {
  const pop = $('#settingsPop');
  if (pop && !pop.hidden) { pop.hidden = true; $('#gearBtn')?.setAttribute('aria-expanded', 'false'); }
}
document.addEventListener('click', closeSettingsMenu);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSettingsMenu(); });
function roleBadge(p) {
  return p.role ? `<span class="role ${p.role}" ${tooltipAttrs(ROLE_VI[p.role], META.roles[p.role].goal)}>${ROLE_VI[p.role]}</span>` : `<span class="role unknown" ${tooltipAttrs('Vai trò bí mật', 'Vai trò của người chơi này chưa được tiết lộ.')}>?</span>`;
}
// Song sắt phủ lên người đang có Jail trước mặt (đến khi rút kiểm tra); hiệu ứng sập xuống chỉ chạy lần đầu thấy
const jailSeen = new Set();
function jailBarsHTML(p) {
  if (!p.jailed) return '';
  const key = `${p.name}:${p.jailed}`;
  const slam = !jailSeen.has(key);
  jailSeen.add(key);
  return `<div class="jail-bars ${slam ? 'slam' : ''}" aria-hidden="true"></div>`;
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

// ---------- chọn nhân vật (trước khi vào trận) ----------
const ROLE_ICON = { Sheriff: '⭐', Deputy: '🛡️', Outlaw: '💀', Renegade: '🎭' };
function renderChoose(g) {
  const me = g.me;
  const meP = me ? g.players[me.index] : null;
  const locked = !me || !!me.picked;
  if (locked) ui.choosePick = null;
  const sel = me?.picked || ui.choosePick;
  const done = g.players.filter((p) => p.picked).length;
  let roleHTML = '';
  if (meP) {
    const role = META.roles[meP.role];
    roleHTML = `<div class="rolecard ${meP.role}"><div class="rstar">${ROLE_ICON[meP.role]}</div>
      <div><h3>Bạn là ${esc(ROLE_VI[meP.role])} · ${esc(role.vi)}</h3><p>${esc(role.goal)}${meP.role === 'Sheriff' ? ' Bạn được +1 máu.' : ''}</p></div>
      <span class="secret">${meP.role === 'Sheriff' ? '👁️ Mọi người đều biết' : '🔒 Chỉ bạn thấy'}</span></div>`;
  }
  const cards = (me?.choices || []).map((name) => {
    const ch = META.chars[name];
    const max = ch.hp + (meP?.role === 'Sheriff' ? 1 : 0);
    let hp = '';
    for (let i = 0; i < max; i++) hp += bulletSVG(true, 22);
    return `<div class="ccard ${sel === name ? 'sel' : ''}" data-char="${esc(name)}" role="button" tabindex="0">
      <div class="por">${CHAR_ICON[name] || '🤠'}</div><div class="nm">${esc(name)}</div>
      <div class="chp" title="${max} máu">${hp}${meP?.role === 'Sheriff' ? '<span class="plus">+1 Sheriff</span>' : ''}</div>
      <div class="ab">${esc(ch.desc)}</div></div>`;
  }).join('');
  const list = g.players.map((p, i) => `<li>${roleBadge(p)} <b>${esc(p.name)}</b>${i === me?.index ? ' <span class="muted">(bạn)</span>' : ''}
    <span class="st ${p.picked ? 'done' : 'wait'}">${p.picked ? '✔ Đã chọn' : 'Đang chọn'}</span></li>`).join('');
  $('#mainArea').innerHTML = `<div class="panel choose">
    ${roleHTML}
    <div class="choose-head"><h2>Chọn nhân vật</h2><span class="muted">${!me ? 'Đang chờ người chơi chọn nhân vật…'
      : locked ? 'Bạn đã chốt nhân vật. Đang chờ những người khác…' : `Bạn được chia ${me.choices.length} lá — bấm vào 1 lá rồi xác nhận.`}</span></div>
    <div class="chars ${sel ? 'has-sel' : ''} ${locked ? 'locked' : ''}" id="chars">${cards}</div>
    <div class="actions" style="justify-content:center">${!me ? '' : locked
      ? `<span class="muted">✔ Bạn chơi <b>${esc(me.picked)}</b>. Ván đấu bắt đầu khi tất cả đã chọn.</span>`
      : `<button class="btn" data-act="confirmChar" ${sel ? '' : 'disabled'}>✔ Chọn ${esc(sel || 'nhân vật')}</button>
         ${ROOM.turnSeconds ? '<span class="muted">Hết giờ sẽ tự chọn lá đầu tiên.</span>' : ''}`}</div>
    <h3 style="margin-top:18px">Người chơi (${done}/${g.players.length} đã chọn)</h3>
    <div class="cprogress"><i style="width:${(done / g.players.length) * 100}%"></i></div>
    <ul class="plist">${list}</ul>
    <p class="muted">Nhân vật của mọi người chỉ lộ ra khi ván đấu bắt đầu.</p>
  </div>`;
  const lb = $('#logBox');
  lb.innerHTML = g.log.map((l) => `<div>${esc(l)}</div>`).join('');
  if (locked) return;
  $('#mainArea').querySelectorAll('[data-char]').forEach((el) => {
    const pickIt = () => { ui.choosePick = el.dataset.char; renderChoose(g); };
    el.onclick = pickIt;
    el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickIt(); } };
  });
  const btn = $('#mainArea [data-act="confirmChar"]');
  if (btn) btn.onclick = run(async () => { btn.disabled = true; await sendAction({ type: 'chooseChar', char: ui.choosePick }); });
}

function renderGame() {
  const g = ROOM.game;
  if (g.phase === 'choose') return renderChoose(g);
  ui.choosePick = null;
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

  // Ghế quanh bàn tròn: mình ở đáy bàn, người sau mình ngồi bên trái, cứ thế theo chiều kim đồng hồ
  const n = g.players.length;
  const start = Math.max(meIdx, 0);
  const narrow = window.matchMedia('(max-width: 900px)').matches;
  const rx = narrow ? 41 : 43, ry = 44;

  const seatsHTML = Array.from({ length: n }, (_, k) => {
    const i = (start + k) % n;
    const p = g.players[i];
    const a = Math.PI / 2 + (k * 2 * Math.PI) / n;
    const x = 50 + rx * Math.cos(a), y = 50 + ry * Math.sin(a);
    const isMe = i === meIdx;
    const cls = [
      isMe ? 'mine' : '',
      g.turn === i && !g.winner ? 'turn' : '',
      pend && pend.player === i ? 'acting' : '',
      !p.alive ? 'dead' : '',
      p.winner ? 'winner' : '',
      tfilter ? (tfilter(p) ? 'targetable' : 'notarget') : '',
      p.jailed ? 'jailed' : '',
    ].join(' ');
    const ch = META.chars[p.char];
    const inRange = !isMe && p.alive && p.distance != null && meP?.alive && p.distance <= g.me.range;
    const dist = isMe || p.distance == null ? ''
      : `<span class="dist ${inRange ? 'in' : ''}" ${tooltipAttrs('Khoảng cách từ bạn', 'Khoảng cách để kiểm tra mục tiêu có nằm trong tầm của thẻ bài hay không.' + (inRange ? ' Trong tầm bắn.' : ''))}>${p.alive ? 'cách ' + p.distance : '☠️'}</span>`;
    const checking = pend?.type === 'check' && pend.player === i ? pend.kind : null;
    const frame = p.eq.length ? `<div class="eqframe">${p.eq.map((c) => eqTileHTML(c, c.name === checking ? 'checking' : '')).join('')}</div>` : '';
    return `<div class="player ${cls}" data-player="${esc(p.name)}" style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%">
      ${frame}${dist}
      <div class="av">${p.alive ? (CHAR_ICON[p.char] || '🤠') : '💀'}${jailBarsHTML(p)}
        ${handFanHTML(p.handCount)}${roleBadge(p)}</div>
      <div class="plate"><span class="dot ${ROOM.online.includes(p.name) ? 'on' : ''}"></span>${g.turn === i && !g.winner ? '⭐ ' : ''}${esc(p.name)}${isMe ? ' (bạn)' : ''}</div>
      ${hpBarHTML(p)}
      <span class="pchar" ${tooltipAttrs(p.char, ch.desc)}>${esc(p.char)}</span>
    </div>`;
  }).join('');

  const tableHTML = `
    <div class="arena">
      <div class="felt"></div>
      <div class="piles">
        <div class="pile"><div class="deck ${pend?.type === 'check' ? (myPrompt ? 'ready' : 'waiting') : ''}" id="deck"><div class="card-back">BANG!</div>
          ${pend?.type === 'check' ? (myPrompt ? '<div class="tap">👆 Bấm để rút!</div>' : `<div class="tap other">⏳ ${esc(g.players[pend.player].name)} đang rút…</div>`) : ''}</div>
          Chồng: ${g.deckCount}</div>
        <div class="pile">${discardStackHTML(g)}<div>Bài bỏ</div></div>
      </div>
      ${seatsHTML}
    </div>`;
  const promptBoxHTML = `<div class="prompt ${myPrompt || (canPlay && !ui.mode) ? 'mine' : ''}" id="prompt">${promptHTML(g, meIdx, meP)}</div>`;

  let meHTML = '';
  if (meP) {
    const ch = META.chars[meP.char];
    const role = META.roles[meP.role];
    const playableIds = new Set(g.me.hand.filter((c) => isClickable(c, g, meP)).map((c) => c.id));
    meHTML = `
      <div class="me ${myTurn ? 'turn' : ''} ${!meP.alive ? 'dead' : ''}">
        <div class="me-head">
          <div class="idcard" ${tooltipAttrs(ROLE_VI[meP.role], role.goal)}><span class="role ${meP.role}" style="margin:0">${ROLE_VI[meP.role]}</span> <b>Vai trò của bạn (bí mật)</b>
            <div style="margin-top:4px">${esc(role.goal)}</div></div>
          <div class="idcard" ${tooltipAttrs(meP.char, ch.desc)}><b>${esc(meP.char)}</b> — ${esc(ch.desc)}</div>
          <div class="idcard"><div class="mehp">${hpBarHTML(meP, 26)}</div>
            <div class="muted">Tầm bắn: ${g.me.range}${g.me.unlimitedBang ? ' · Bang! không giới hạn' : ''}${meP.jailed ? ' · ⛓️ Đang bị giam' : ''}</div></div>
          <div class="idcard myeq"><b>Trang bị</b>
            <div class="eqs">${meP.eq.length ? meP.eq.map((c) => eqTileHTML(c)).join('') : '<span class="muted">Chưa có trang bị</span>'}</div></div>
        </div>
        <div class="hand" id="hand">${g.me.hand.map((c) => {
          const sel = ui.selected.includes(c.id) || ui.mode?.cardId === c.id;
          return cardHTML(c, (sel ? 'selected ' : '') + (playableIds.has(c.id) ? 'playable' : (canPlay || myPrompt ? 'dim' : '')));
        }).join('') || '<span class="muted">Không có bài trên tay.</span>'}</div>
        <div class="actions" id="actions">${actionsHTML(g, meP, canPlay)}</div>
      </div>`;
  }

  // Bàn ở giữa; ô thông báo + bài của mình ở cột bên phải
  $('#mainArea').innerHTML = `<div class="board playing">${g.winner ? winnerHTML(g) : ''}
    <div class="table-col">${tableHTML}</div><div class="right-col">${promptBoxHTML}${meHTML}</div></div>`;

  // log
  const lb = $('#logBox');
  lb.innerHTML = g.log.map((l) => `<div class="${l.startsWith('—') ? 'turnline' : ''}">${esc(l)}</div>`).join('');
  lb.scrollTop = lb.scrollHeight;

  bindGame(g, meIdx, meP, canPlay, myPrompt);
  showCheckReveal(g);
}

// ---------- rút kiểm tra: lá bay ra giữa bàn, lật mặt, báo thành công/thất bại ----------
const CHECK_INFO = {
  Barrel: { icon: '🛢️', need: 'Cần <b>♥ Cơ</b> để Barrel đỡ đạn', win: ['NÉ ĐƯỢC!', 'Barrel đỡ đạn'], lose: ['BARREL TRƯỢT', 'Vẫn có thể bỏ Missed!'] },
  Jail: { icon: '⛓️', need: 'Cần <b>♥ Cơ</b> để thoát tù', win: ['VƯỢT NGỤC!', 'Được chơi lượt này'], lose: ['Ở LẠI TÙ', 'Mất lượt'] },
  Dynamite: { icon: '🧨', need: 'Nổ nếu ra <b>♠ Bích từ 2 đến 9</b>', win: ['AN TOÀN', 'Dynamite chuyền sang người kế'], lose: ['BÙM! −3 MÁU', 'Dynamite phát nổ'] },
};
function showCheckReveal(g) {
  const lc = g.lastCheck;
  if (ui.lastCheckSeq == null) { ui.lastCheckSeq = lc ? lc.seq : 0; return; } // mới vào phòng: không phát lại lần rút cũ
  if (!lc || lc.seq <= ui.lastCheckSeq) return;
  ui.lastCheckSeq = lc.seq;
  const deck = $('#deck'), arena = $('.arena');
  if (!deck || !arena) return;
  const info = CHECK_INFO[lc.kind] || CHECK_INFO.Barrel;
  const sx = window.scrollX, sy = window.scrollY;
  const ar = arena.getBoundingClientRect(), dr = deck.getBoundingClientRect();
  // Lớp hiệu ứng nằm ngoài #mainArea để không bị xoá khi bàn chơi vẽ lại
  const layer = document.createElement('div');
  layer.className = 'check-layer';
  Object.assign(layer.style, { left: ar.left + sx + 'px', top: ar.top + sy + 'px', width: ar.width + 'px', height: ar.height + 'px' });
  const n = lc.cards.length;
  const flyers = lc.cards.map((c, j) => {
    const f = document.createElement('div');
    f.className = 'flyer' + (n > 1 && c.id !== lc.chosen ? ' other' : '');
    Object.assign(f.style, { left: dr.left - ar.left + 'px', top: dr.top - ar.top + 'px', width: dr.width + 'px', height: dr.height + 'px' });
    f.innerHTML = `<div class="inner"><div class="face"><div class="card-back">BANG!</div></div><div class="face front">${cardHTML(c, 'small')}</div></div>`;
    layer.appendChild(f);
    return { f, dx: ar.width / 2 - dr.width / 2 - (dr.left - ar.left) + (j - (n - 1) / 2) * dr.width * 1.9, dy: ar.height * .5 - dr.height / 2 - (dr.top - ar.top) - dr.height * .35 };
  });
  // Bàn đang khuất (đã cuộn xuống xem tay bài) thì cuộn chồng bài vào giữa màn hình để ai cũng thấy lá rút
  if (ar.top + ar.height * .15 < 0 || dr.bottom + 20 > window.innerHeight) deck.scrollIntoView({ block: 'center', behavior: 'smooth' });
  const v = document.createElement('div');
  const [big, small] = lc.ok ? info.win : info.lose;
  const who = g.players[lc.player]?.name || '';
  v.className = 'verdict ' + (lc.ok ? 'win' : 'lose');
  v.innerHTML = `${lc.ok ? '✔' : '✘'} ${esc(big)}<small>${esc(who)} · ${info.icon} ${esc(lc.kind)} · ${esc(small)}</small>`;
  layer.appendChild(v);
  document.body.appendChild(layer);
  const T = (ms, fn) => setTimeout(fn, ms);
  requestAnimationFrame(() => requestAnimationFrame(() => flyers.forEach(({ f, dx, dy }) => { f.style.transform = `translate(${dx}px, ${dy}px) scale(1.6)`; })));
  T(550, () => flyers.forEach(({ f }) => f.classList.add('flipped')));
  T(1100, () => {
    flyers.forEach(({ f }) => { if (!f.classList.contains('other')) f.classList.add(lc.ok ? 'win' : 'lose'); });
    if (!lc.ok && lc.kind === 'Dynamite') flyers.forEach(({ f }) => f.classList.add('boom'));
    v.classList.add('show');
  });
  T(3000, () => {
    v.classList.remove('show');
    const disc = $('.discard-stack') || $('.arena .pile:last-child');
    const r = (disc || deck).getBoundingClientRect();
    // toạ độ trang: đích (lá trên cùng của bài bỏ) trừ vị trí xuất phát của lá bay
    const dx = r.right + window.scrollX - dr.width - (dr.left + sx), dy = r.top + window.scrollY - (dr.top + sy);
    flyers.forEach(({ f }) => {
      f.style.transform = `translate(${dx}px, ${dy}px) scale(1)`;
      f.style.opacity = '0';
    });
  });
  T(3600, () => layer.remove());
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
    case 'check': {
      const ci = CHECK_INFO[pend.kind] || CHECK_INFO.Barrel;
      const luck = g.players[pend.player].char === 'Lucky Duke' ? ' (Lucky Duke lật 2 lá, lấy lá có lợi)' : '';
      if (!mine) return `<h4>${ci.icon} ${P(pend.player)} đang rút kiểm tra ${esc(pend.kind)}…</h4><div class="muted">${ci.need}${luck}.</div>`;
      return `<h4>${ci.icon} Rút kiểm tra ${esc(pend.kind)}</h4><div>${ci.need}${luck}. Bấm vào <b>chồng bài đang sáng</b> để rút.</div>
        <div class="row"><button class="btn" data-act="checkDraw">🃏 Rút bài</button></div>`;
    }
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

  const deckEl = main.querySelector('#deck.ready');
  if (deckEl) deckEl.onclick = run(async () => { deckEl.classList.remove('ready'); await sendAction({ type: 'checkDraw' }); });

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
    if (act === 'checkDraw') return sendAction({ type: 'checkDraw' });
    if (act === 'draw') return sendAction({ type: 'drawChoice', from: el.dataset.from, target: $('#drawTarget')?.value });
  }));
}

function chooseTargetCard(card, p) {
  const modal = $('#modal');
  modal.innerHTML = `<div class="panel"><h3>${esc(card.name)}: chọn lá của ${esc(p.name)}</h3>
    <div class="row">
      ${p.handCount ? `<button class="btn" data-tc="hand">🂠 1 lá ngẫu nhiên trên tay (${p.handCount})</button>` : ''}
      ${p.eq.map((c) => `<button class="btn blue" data-tc="${c.id}" ${tooltipAttrs(c.name, cardInfo(c).desc)}>${cardInfo(c).icon} ${esc(c.name)}</button>`).join('')}
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

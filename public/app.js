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
function closeStreams() {
  lobbyES?.close(); roomES?.close(); lobbyES = roomES = null;
  clearPauseUI();
  clearMatchResult();
}

// ---------- tạm dừng và thông báo desktop ----------
function clearPauseUI() {
  $('#pauseDialog')?.remove();
  ui.pauseDialogKey = null;
  ui.pauseNotification?.close();
  ui.pauseNotification = null;
}

async function enablePauseNotifications() {
  if (!window.isSecureContext || !('Notification' in window)) {
    return toast('Thông báo Windows cần trình duyệt hỗ trợ và kết nối HTTPS hoặc localhost.');
  }
  const permission = await Notification.requestPermission();
  if (permission === 'granted' && 'serviceWorker' in navigator) {
    await navigator.serviceWorker.register('/pause-notifications.js');
    await navigator.serviceWorker.ready;
  }
  toast(permission === 'granted' ? 'Đã bật thông báo Windows.' : 'Chưa được cấp quyền thông báo. Bạn vẫn nhận cửa sổ biểu quyết trong game.', permission === 'granted');
}

async function notifyPause(p, code) {
  try {
    const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (ROOM?.code !== code || ROOM.pause?.id !== p.id || ROOM.pause.phase !== 'voting' || ROOM.pause.accepted.includes(ME)) return;
    const title = `${p.requester} muốn tạm dừng.`;
    const body = `${p.renewal ? 'Gia hạn thêm 60 giây. ' : ''}Chọn Nhất trí hoặc Từ chối trong 10 giây.`;
    ui.pauseNotification?.close();
    if (registration?.active) {
      const tag = `bang-pause-${code}-${p.id}`;
      await registration.showNotification(title, { body, tag, requireInteraction: true,
        actions: [{ action: 'agree', title: 'Nhất trí' }, { action: 'reject', title: 'Từ chối' }],
        data: { code, id: p.id, deadline: p.deadline } });
      const close = () => { registration.getNotifications({ tag }).then((list) => list.forEach((n) => n.close())).catch(() => {}); };
      if (ROOM?.code !== code || ROOM.pause?.id !== p.id || ROOM.pause.phase !== 'voting' || ROOM.pause.accepted.includes(ME)) close();
      else ui.pauseNotification = { close };
    } else {
      const notification = ui.pauseNotification = new Notification(title, { body: body + ' Mở game để bỏ phiếu.', tag: 'bang-pause' });
      notification.onclick = () => { window.focus(); $('#pauseDialog')?.focus(); notification.close(); };
    }
  } catch { /* Cửa sổ trong game vẫn hoạt động khi desktop không hỗ trợ. */ }
}

function renderPause() {
  const p = ROOM.pause;
  const main = $('#mainArea');
  if (main) main.inert = !!p?.frozen;
  if (!p) { clearPauseUI(); return; }
  const own = p.requester === ME;
  const voted = p.accepted.includes(ME);
  const canVote = p.phase === 'voting' && p.voters.includes(ME) && !voted;
  const key = `${ROOM.code}:${p.id}:${p.phase}:${own}:${voted}`;
  if (canVote && ui.pauseNotified !== `${ROOM.code}:${p.id}`) {
    ui.pauseNotified = `${ROOM.code}:${p.id}`;
    if ('Notification' in window && Notification.permission === 'granted') {
      void notifyPause(p, ROOM.code);
    }
  }
  if (!canVote) { ui.pauseNotification?.close(); ui.pauseNotification = null; }
  if (ui.pauseDialogKey !== key) {
    $('#pauseDialog')?.remove();
    ui.pauseDialogKey = key;
    const dialog = document.createElement('dialog');
    dialog.id = 'pauseDialog';
    dialog.className = 'panel pause-dialog';
    dialog.setAttribute('aria-labelledby', 'pauseTitle');
    dialog.innerHTML = `<h2 id="pauseTitle">${p.phase === 'voting' ? `${esc(p.requester)} muốn tạm dừng.` : '⏸ Ván chơi đang tạm dừng'}</h2>
      <p>${p.phase === 'voting' ? `${p.renewal ? 'Gia hạn thêm 60 giây. ' : ''}Cần tất cả người chơi khác nhất trí. Không chọn trong 10 giây được tính là từ chối.` : `Chờ ${esc(p.requester)} tiếp tục. Hết 60 giây sẽ biểu quyết gia hạn.`}</p>
      <p data-pause-clock role="timer"></p><p id="pauseVotes" class="muted"></p>
      ${voted && p.phase === 'voting' ? '<p>Bạn đã nhất trí. Đang chờ những người còn lại.</p>' : ''}
      <div class="row">${canVote ? '<button class="btn green" data-pause-vote="yes">Nhất trí</button><button class="btn secondary" data-pause-vote="no">Từ chối</button>' : ''}
      ${own ? `<button class="btn" id="resumeGame">${p.frozen ? 'Tiếp tục' : 'Huỷ yêu cầu'}</button>` : ''}</div>`;
    dialog.oncancel = (event) => event.preventDefault();
    document.body.appendChild(dialog);
    dialog.showModal();
    dialog.querySelectorAll('[data-pause-vote]').forEach((button) => {
      button.onclick = run(async () => {
        dialog.querySelectorAll('button').forEach((b) => { b.disabled = true; });
        try { await api(`/api/rooms/${ROOM.code}/pause`, { type: 'vote', id: p.id, agree: button.dataset.pauseVote === 'yes' }); }
        finally { dialog.querySelectorAll('button').forEach((b) => { b.disabled = false; }); }
      });
    });
    const resume = dialog.querySelector('#resumeGame');
    if (resume) resume.onclick = run(() => api(`/api/rooms/${ROOM.code}/pause`, { type: 'resume', id: p.id }));
  }
  $('#pauseVotes').textContent = p.phase === 'voting' ? `Đã nhất trí: ${p.accepted.length}/${p.voters.length}` : '';
  updateClock();
}

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

function timerField(value = 60) {
  return `<label for="turnSeconds">Thời gian mỗi lượt (giây)</label>
    <input id="turnSeconds" type="number" name="turnSeconds" min="0" max="600" step="1" value="${esc(value)}" required>
    <p class="muted">0 = tắt; từ 10–600 giây. Tạm dừng lượt khi chờ phản hồi; mỗi phản hồi có timer riêng cùng thời lượng.</p>`;
}
function characterFields(choices = 3, seconds = 60) {
  return `<label for="characterChoices">Số nhân vật để chọn đầu game</label>
    <select id="characterChoices" name="characterChoices">${[1, 2, 3, 4].map((n) => `<option value="${n}" ${Number(choices) === n ? 'selected' : ''}>${n}${n === 1 ? ' (chia ngẫu nhiên)' : ''}</option>`).join('')}</select>
    <label for="characterSeconds">Thời gian chọn nhân vật mỗi người (giây)</label>
    <input id="characterSeconds" type="number" name="characterSeconds" min="0" max="600" step="1" value="${esc(seconds)}" required>
    <p class="muted">0 = tắt; từ 10–600 giây, riêng với timer lượt. Chọn lần lượt, không trùng nhân vật; hết giờ tự chọn ngẫu nhiên. Khi đặt 1 nhân vật, game tự chia và bỏ qua bước chọn.</p>`;
}

// ---------- sảnh ----------
function showLobby() {
  closeStreams();
  ROOM = null;
  history.replaceState(null, '', '/');
  app.innerHTML = `
    <div class="lobby">
      <div class="panel">
        ${META.rulesPreview ? '<p><b>Bản thử cơ chế</b></p>' : ''}
        <h2>Tạo phòng</h2>
        <form id="createForm">
          <label>Tên phòng</label><input type="text" name="name" placeholder="Phòng của ${esc(ME)}" maxlength="40">
          <label for="createPassword">Mật khẩu phòng (không bắt buộc)</label><input id="createPassword" type="password" name="password" maxlength="64" autocomplete="new-password">
          ${characterFields()}
          ${timerField()}
          <label><input type="checkbox" name="dodgeCity" aria-describedby="dodgeCityDetails" ${META.greenCardCount ? '' : 'disabled'}> Bản mở rộng: Dodge City</label>
          <p class="muted" id="dodgeCityDetails">${META.greenCardCount ? `Thêm ${META.greenCardCount} lá viền xanh lá vào bộ bài của phòng.` : 'Máy chủ chưa nạp dữ liệu lá viền xanh lá.'}</p>
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
    const r = await api('/api/rooms', { name: f.get('name'), password: f.get('password'), turnSeconds: Number(f.get('turnSeconds')), characterChoices: Number(f.get('characterChoices')), characterSeconds: Number(f.get('characterSeconds')), dodgeCity: f.has('dodgeCity') });
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
          <div><b>${esc(r.name)}</b> <span class="code">${r.code}</span> ${r.hasPassword ? '🔒' : ''} ${r.dodgeCity ? '· Dodge City' : ''}</div>
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
        <div class="row"><h2 id="roomName"></h2><span class="code">${code}</span>${META.rulesPreview ? '<span>Bản thử cơ chế</span>' : ''}
          <button class="btn ghost small" id="copyLink">📋 Copy link mời</button>${settingsMenuHTML()}</div>
        <div class="row" id="roomBtns"></div>
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
    const previousGame = ROOM?.game;
    const handOrigins = Object.fromEntries([...document.querySelectorAll('#hand [data-card]')].map((el) => [el.dataset.card, el.getBoundingClientRect()]));
    const drawOrigins = [...document.querySelectorAll('.draw-stage .draw-slot')].map((el) => el.getBoundingClientRect());
    ROOM = d.room;
    ui.serverOffset = ROOM.serverNow - Date.now();
    renderRoom();
    showPlayedCards(ROOM.game, previousGame, handOrigins);
    showCardTransfers(ROOM.game, previousGame, drawOrigins);
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
  btns.innerHTML = `
    ${isHost && g?.winner ? '<button class="btn green" id="resetBtn">🔁 Về phòng chờ</button>' : ''}
    ${g && !g.winner ? `<button class="btn" id="pauseBtn" ${r.pause ? 'disabled' : ''}>Tạm dừng</button><button class="btn ghost small" id="pauseNotifications">Bật thông báo Windows</button>` : ''}
    <button class="btn secondary" id="leaveBtn">Rời phòng${g && !g.winner ? ' giữa ván' : ''}</button>`;
  $('#pauseBtn') && ($('#pauseBtn').onclick = run(() => api(`/api/rooms/${r.code}/pause`, { type: 'request' })));
  $('#pauseNotifications') && ($('#pauseNotifications').onclick = run(enablePauseNotifications));
  $('#leaveBtn') && ($('#leaveBtn').onclick = run(async () => { await api(`/api/rooms/${r.code}/leave`, {}); showLobby(); }));
  $('#resetBtn') && ($('#resetBtn').onclick = run(() => api(`/api/rooms/${r.code}/reset`, {})));

  // chat
  const cb = $('#chatBox');
  const atBottom = cb.scrollTop + cb.clientHeight >= cb.scrollHeight - 10;
  cb.innerHTML = r.chat.map((m) => m.system ? `<div class="sys">${esc(m.text)}</div>` : `<div><b>${esc(m.user)}:</b> ${esc(m.text)}</div>`).join('') || '<div class="sys">Chưa có tin nhắn.</div>';
  if (atBottom) cb.scrollTop = cb.scrollHeight;
  updateChatUnread(r.chat);

  $('#logPanel').style.display = g ? '' : 'none';
  renderPause();
  if (!g?.winner) clearMatchResult();
  if (!g) {
    ui.lastCheckSeq = null;
    return renderWaiting();
  }
  renderGame();
  renderMatchResult(g);
  updateClock();
}

function roomSettingsBody(form) {
  const f = new FormData(form);
  const body = { turnSeconds: Number(f.get('turnSeconds')), characterChoices: Number(f.get('characterChoices')), characterSeconds: Number(f.get('characterSeconds')) };
  if (f.has('removePassword')) body.password = '';
  else if (f.get('password')) body.password = f.get('password');
  return body;
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
        ${r.dodgeCity ? '<p>Bản mở rộng: Dodge City</p>' : ''}
        <p>${r.hasPassword ? '🔒 Có mật khẩu' : '🔓 Không có mật khẩu'} · ${r.turnSeconds ? r.turnSeconds + ' giây/lượt' : 'Không giới hạn thời gian'}</p>
        <p>Chọn 1 trong ${r.characterChoices} nhân vật · ${r.characterSeconds ? r.characterSeconds + ' giây/người để chọn' : 'Không giới hạn giờ chọn nhân vật'}</p>
        ${isHost ? `<form id="settingsForm">
          <label for="roomPassword">Mật khẩu mới (để trống để giữ nguyên)</label>
          <input id="roomPassword" type="password" name="password" maxlength="64" autocomplete="new-password" value="${esc(ui.settingsDraft?.password || '')}">
          <label><input type="checkbox" name="removePassword" ${ui.settingsDraft?.removePassword ? 'checked' : ''}> Xóa mật khẩu phòng</label>
          ${characterFields(ui.settingsDraft?.characterChoices ?? r.characterChoices, ui.settingsDraft?.characterSeconds ?? r.characterSeconds)}
          ${timerField(ui.settingsDraft?.turnSeconds ?? r.turnSeconds)}
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
  $('#startBtn') && ($('#startBtn').onclick = run(async () => {
    const form = $('#settingsForm');
    if (form && !form.reportValidity()) return;
    // Save the visible settings even when the host starts without pressing Save.
    const settings = form ? roomSettingsBody(form) : {};
    await api(`/api/rooms/${r.code}/start`, settings);
    ui.settingsDraft = null;
  }));
  const settings = $('#settingsForm');
  if (settings) {
    settings.oninput = () => {
      const f = new FormData(settings);
      ui.settingsDraft = { turnSeconds: f.get('turnSeconds'), characterChoices: f.get('characterChoices'), characterSeconds: f.get('characterSeconds'), password: f.get('password'), removePassword: f.has('removePassword') };
    };
    settings.onsubmit = run(async (e) => {
      e.preventDefault();
      const body = roomSettingsBody(settings);
      await api(`/api/rooms/${r.code}/settings`, body);
      ui.settingsDraft = null;
      if (ROOM && !ROOM.game) renderWaiting();
      toast('Đã lưu cài đặt phòng.', true);
    });
  }
  document.querySelectorAll('[data-kick]').forEach((b) => b.onclick = run(() => api(`/api/rooms/${r.code}/kick`, { player: b.dataset.kick })));
}

function updateClock() {
  const t = ROOM?.timer;
  const g = ROOM?.game;
  const seconds = t ? Math.max(0, Math.ceil((t.deadline - Date.now() - (ui.serverOffset || 0)) / 1000)) : 0;
  const name = g?.players[t?.player]?.name || '';
  const p = ROOM?.pause;
  const pauseSeconds = p ? Math.max(0, Math.ceil((p.deadline - Date.now() - (ui.serverOffset || 0)) / 1000)) : 0;
  document.querySelectorAll('[data-pause-clock]').forEach((el) => {
    el.textContent = `${p?.phase === 'voting' ? 'Thời gian biểu quyết' : 'Tạm dừng còn'}: ${pauseSeconds} giây`;
  });
  if (p && pauseSeconds === 0) { ui.pauseNotification?.close(); ui.pauseNotification = null; }
  document.querySelectorAll('[data-draw-clock]').forEach((el) => { el.textContent = p?.frozen ? 'Đang tạm dừng' : `${seconds} giây`; });
  const drawLabels = { blackJack: 'Black Jack lật bài', kit: 'Chọn 2 lá', copyAbility: 'Chọn kỹ năng' };
  const drawLabel = drawLabels[g?.pending?.type] || `Rút bài (tự động sau ${t?.seconds || 5} giây)`;
  const text = p?.frozen ? '⏸ Ván chơi tạm dừng · Đồng hồ lượt được giữ nguyên' : t ? `⏱ ${name} · ${t.character ? 'Chọn nhân vật' : t.draw ? drawLabel : t.response ? 'Phản hồi' : 'Lượt chơi'}: ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
    : `⏱ ${g?.phase === 'character' ? 'Chọn nhân vật' : 'Lượt chơi'}: không giới hạn`;
  document.querySelectorAll('[data-room-clock]').forEach((el) => {
    el.hidden = !g || !!g.winner;
    el.textContent = text;
    el.classList.toggle('urgent', !p?.frozen && !!t && seconds <= 10);
  });
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
function eqTileHTML(c, extra = '', owner = null) {
  const info = cardInfo(c);
  const [kind, badge] = info.type === 'green' ? ['green', c.ready ? '✓' : '⏳']
    : info.type === 'gun' ? ['gun', String(info.range)] : (EQ_KIND[c.name] || ['', '']);
  const tag = owner === null ? 'div' : 'button';
  const action = owner === null ? '' : `type="button" data-act="patDraw" data-owner="${esc(owner)}" aria-label="Lấy ${esc(c.name)} của ${esc(owner)}"`;
  const desc = c.disabled ? `${info.desc} Đang bị Belle Star vô hiệu hóa.` : info.desc;
  return `<${tag} class="eqt ${kind} ${extra}${c.disabled ? ' inactive' : ''}" ${action} data-eq="${c.id}" ${tooltipAttrs(c.name, desc)}>
    <span class="ic">${info.icon}</span><span class="nm">${esc(c.name)}</span>${badge ? `<span class="bd">${badge}</span>` : ''}</${tag}>`;
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

// Bàn chơi và màn hình kết quả dùng chung avatar theo nhân vật/trạng thái.
function playerAvatarHTML(player) {
  const icon = player.alive ? (CHAR_ICON[player.char] || '🤠') : '💀';
  const label = `${player.char || 'Cao bồi'}${player.alive ? '' : ' · Đã bị hạ'}`;
  return `<span class="character-avatar" role="img" aria-label="${esc(label)}">${icon}</span>`;
}

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

const abilityOf = (p) => p.ability ?? p.char;
const discardExcess = (g, p) => g.me.hand.length - (g.me.handLimit ?? p.hp);
const docTarget = (p, g) => p.alive && p.name !== ME && p.distance <= g.me.range;
const blueCard = (c) => ['blue', 'gun'].includes(cardInfo(c).type);

function effectiveName(c, me) {
  if (abilityOf(me) === 'Calamity Janet' && c.name === 'Missed') return 'Bang';
  return c.name;
}

// Ai có thể bị chọn làm mục tiêu cho lá bài này?
function targetFilter(card, g, meP) {
  const name = effectiveName(card, meP);
  const others = (p) => p.alive && p.name !== ME;
  const info = cardInfo(card);
  switch (card.ready ? info.effect : name) {
    case 'Bang': return (p) => others(p) && p.distance <= g.me.range;
    case 'attack': {
      const range = info.maxDistance === 'weapon' ? g.me.range : (info.maxDistance ?? Infinity);
      return (p) => others(p) && p.distance <= range;
    }
    case 'take':
    case 'discard': return (p) => others(p) && p.distance <= (info.maxDistance ?? Infinity) && (p.handCount > 0 || p.eq.length > 0);
    case 'Panic': return (p) => others(p) && p.distance <= 1 && (p.handCount > 0 || p.eq.length > 0);
    case 'Cat Balou': return (p) => others(p) && (p.handCount > 0 || p.eq.length > 0);
    case 'Duel': return others;
    case 'Jail': return (p) => others(p) && p.role !== 'Sheriff' && !p.eq.some((c) => c.name === 'Jail');
    default: return null;
  }
}

function targetingCard(g, meP) {
  const cards = ui.mode.activate ? meP.eq : g.me.hand;
  return cards.find((c) => c.id === ui.mode.cardId);
}

// ---------- chọn nhân vật (trước khi vào trận) ----------
const ROLE_ICON = { Sheriff: '⭐', Deputy: '🛡️', Outlaw: '💀', Renegade: '🎭' };
function renderCharacterSelection() {
  const g = ROOM.game;
  const meP = g.players[g.me.index];
  const mine = g.pending.player === g.me.index;
  const options = mine ? g.pending.options : meP.char ? [meP.char] : [];
  const choiceKey = `${ROOM.code}:${g.pending.player}`;
  if (ui.chooseFor !== choiceKey) { ui.chooseFor = choiceKey; ui.choosePick = null; }
  if (!options.includes(ui.choosePick)) ui.choosePick = null;
  const selected = meP.char || ui.choosePick;
  const done = g.players.filter((p) => p.char).length;
  const role = META.roles[meP.role];
  const cards = options.map((name) => {
    const ch = META.chars[name];
    const max = ch.hp + (meP.role === 'Sheriff' ? 1 : 0);
    return `<div class="ccard ${selected === name ? 'sel' : ''}" ${mine ? `data-character="${esc(name)}" role="button" tabindex="0" aria-pressed="${selected === name}"` : ''}>
      <div class="por">${CHAR_ICON[name] || '🤠'}</div><div class="nm">${esc(name)}</div>
      <div class="chp" title="${max} máu">${Array.from({ length: max }, () => bulletSVG(true, 22)).join('')}${meP.role === 'Sheriff' ? '<span class="plus">+1 Sheriff</span>' : ''}</div>
      <div class="ab">${esc(ch.desc)}</div></div>`;
  }).join('');
  $('#mainArea').innerHTML = `<div class="panel choose">
    <div class="rolecard ${meP.role}"><div class="rstar">${ROLE_ICON[meP.role]}</div>
      <div><h3>Bạn là ${esc(ROLE_VI[meP.role])} · ${esc(role.vi)}</h3><p>${esc(role.goal)}${meP.role === 'Sheriff' ? ' Bạn được +1 máu.' : ''}</p></div>
      <span class="secret">${meP.role === 'Sheriff' ? '👁️ Mọi người đều biết' : '🔒 Chỉ bạn thấy'}</span></div>
    <div class="choose-head"><h2>Chọn nhân vật</h2><span class="muted">${mine ? `Bạn được chia ${options.length} lá — bấm vào 1 lá rồi xác nhận.` : `Đang chờ ${esc(g.players[g.pending.player].name)} chọn nhân vật…`}</span></div>
    <div class="room-clock" data-room-clock role="timer"></div>
    <div class="chars ${selected ? 'has-sel' : ''} ${mine ? '' : 'locked'}">${cards}</div>
    <div class="actions" style="justify-content:center">${mine ? `<button class="btn" id="confirmCharacter" ${selected ? '' : 'disabled'}>✔ Chọn ${esc(selected || 'nhân vật')}</button>` : meP.char ? `<span class="muted">✔ Bạn chơi <b>${esc(meP.char)}</b>. Đang chờ những người khác…</span>` : '<span class="muted">Chờ tới lượt của bạn.</span>'}
      ${mine && ROOM.characterSeconds ? '<span class="muted">Hết giờ sẽ tự chọn ngẫu nhiên.</span>' : ''}</div>
    <h3 style="margin-top:18px">Người chơi (${done}/${g.players.length} đã chọn)</h3>
    <div class="cprogress"><i style="width:${done / g.players.length * 100}%"></i></div>
    <ul class="plist">${g.players.map((p, i) => `<li>${roleBadge(p)} <b>${esc(p.name)}</b>${i === g.me.index ? ' (bạn)' : ''}<span class="st ${p.char ? 'done' : 'wait'}">${p.char ? '✔ Đã chọn' : i === g.pending.player ? 'Đang chọn' : 'Chờ tới lượt'}</span></li>`).join('')}</ul>
    <p class="muted">Ván đấu và timer lượt bắt đầu khi mọi người đã chọn xong.</p>
  </div>`;
  document.querySelectorAll('[data-character]').forEach((el) => {
    const select = () => { ui.choosePick = el.dataset.character; renderCharacterSelection(); };
    el.onclick = select;
    el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); } };
  });
  const confirm = $('#confirmCharacter');
  if (confirm) confirm.onclick = run(async () => {
    confirm.disabled = true;
    try { await sendAction({ type: 'chooseCharacter', character: ui.choosePick }); }
    finally { if (confirm.isConnected) confirm.disabled = false; }
  });
  $('#logBox').innerHTML = g.log.map((l) => `<div>${esc(l)}</div>`).join('');
  updateClock();
}

function renderGame() {
  const g = ROOM.game;
  if (g.phase === 'character') return renderCharacterSelection();
  ui.choosePick = null;
  const meIdx = g.me?.index ?? -1;
  const meP = g.players[meIdx];
  const pend = g.pending;
  const myTurn = g.turn === meIdx && !g.winner;
  const myPrompt = pend && pend.player === meIdx;
  const canPlay = myTurn && !pend && g.phase === 'play' && meP.alive;
  const patDraw = myPrompt && pend.type === 'draw' && pend.options.includes('equipment');

  // validate mode
  if (ui.mode?.kind === 'target' && !canPlay) ui.mode = null;
  if (ui.mode && ui.mode.kind !== 'target') {
    const hand = g.me.hand.map((c) => c.id);
    if (ui.mode.kind === 'discard' && (!canPlay || discardExcess(g, meP) <= 0)) ui.mode = null;
    if (ui.mode?.kind === 'sid' && (!meP.alive || meP.hp >= meP.maxHp || abilityOf(meP) !== 'Sid Ketchum')) ui.mode = null;
    if (ui.mode?.kind === 'skill' && (!canPlay || g.me.activeSkill !== ui.mode.skill)) ui.mode = null;
    if (ui.mode && ui.mode.kind !== 'kit') ui.selected = ui.selected.filter((id) => hand.includes(id));
    if (ui.mode?.kind === 'kit' && !(myPrompt && pend.type === 'kit')) ui.mode = null;
  }
  if (myPrompt && pend.type === 'kit' && ui.mode?.kind !== 'kit') { ui.mode = { kind: 'kit' }; ui.selected = []; }
  if (!ui.mode) ui.selected = [];

  let tfilter = null;
  if (ui.mode?.kind === 'target') {
    const card = targetingCard(g, meP);
    tfilter = card ? targetFilter(card, g, meP) : null;
    if (!tfilter || !g.players.some(tfilter)) { ui.mode = null; tfilter = null; }
  }
  if (myPrompt && pend.type === 'draw' && pend.options.includes('player')) {
    tfilter = (p) => p.alive && p.name !== ME && p.handCount > 0;
  }
  if (ui.mode?.kind === 'skill' && ui.mode.skill === 'Doc Holyday' && ui.selected.length === 2) tfilter = (p) => docTarget(p, g);

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
      myPrompt && pend.type === 'draw' && pend.options.includes('player') && tfilter?.(p) ? 'draw-target' : '',
      p.jailed ? 'jailed' : '',
    ].join(' ');
    const ch = META.chars[p.char];
    const inRange = !isMe && p.alive && p.distance != null && meP?.alive && p.distance <= g.me.range;
    const dist = isMe || p.distance == null ? ''
      : `<span class="dist ${inRange ? 'in' : ''}" ${tooltipAttrs('Khoảng cách từ bạn', 'Khoảng cách để kiểm tra mục tiêu có nằm trong tầm của thẻ bài hay không.' + (inRange ? ' Trong tầm bắn.' : ''))}>${p.alive ? 'cách ' + p.distance : '☠️'}</span>`;
    const checking = pend?.type === 'check' && pend.player === i ? pend.kind : null;
    const frame = p.eq.length ? `<div class="eqframe">${p.eq.map((c) => eqTileHTML(c, c.name === checking ? 'checking' : '', patDraw && p.alive ? p.name : null)).join('')}</div>` : '';
    return `<div class="player ${cls}" data-player="${esc(p.name)}" style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%">
      ${frame}${dist}
      <div class="av">${playerAvatarHTML(p)}${jailBarsHTML(p)}
        ${handFanHTML(p.handCount)}${roleBadge(p)}</div>
      <div class="plate"><span class="dot ${ROOM.online.includes(p.name) ? 'on' : ''}"></span>${g.turn === i && !g.winner ? '⭐ ' : ''}${esc(p.name)}${isMe ? ' (bạn)' : ''}</div>
      ${hpBarHTML(p)}
      <span class="pchar" ${tooltipAttrs(p.char, ch.desc)}>${esc(p.char)}${p.char === 'Vera Custer' && p.ability ? ` · ${esc(p.ability)}` : ''}</span>
    </div>`;
  }).join('');

  const tableHTML = `
    <div class="arena">
      <div class="felt"></div>
      <div class="piles">
        <div class="pile"><div class="deck ${['check', 'draw'].includes(pend?.type) ? (myPrompt ? 'ready' : 'waiting') : ''}" id="deck"><div class="card-back">BANG!</div>
          ${['check', 'draw'].includes(pend?.type) && !myPrompt ? `<div class="tap other">⏳ ${esc(g.players[pend.player].name)} đang rút…</div>` : ''}</div>
          Chồng: ${g.deckCount}</div>
        <div class="pile ${myPrompt && pend?.type === 'draw' && pend.options.includes('discard') ? 'draw-source' : ''}" id="discardPile">${discardStackHTML(g)}<div>Bài bỏ</div></div>
      </div>
      ${seatsHTML}
      ${drawStageHTML(g)}
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
          <div class="idcard" ${tooltipAttrs(meP.char, ch.desc)}><b>${esc(meP.char)}</b> — ${esc(ch.desc)}${meP.char === 'Vera Custer' && meP.ability ? `<div>Kỹ năng hiện tại: <b>${esc(meP.ability)}</b> — ${esc(META.chars[meP.ability].desc)}</div>` : ''}</div>
          <div class="idcard"><div class="mehp">${hpBarHTML(meP, 26)}</div>
            <div class="muted">Tầm bắn: ${g.me.range}${g.me.unlimitedBang ? ' · Bang! không giới hạn' : ''}${meP.jailed ? ' · ⛓️ Đang bị giam' : ''}</div></div>
          <div class="idcard myeq"><b>Trang bị</b>
            <div class="eqs">${meP.eq.length ? meP.eq.map((c) => eqTileHTML(c)).join('') : '<span class="muted">Chưa có trang bị</span>'}</div></div>
        </div>
        <div class="hand" id="hand">${g.me.hand.filter((c) => !(pend?.type === 'blackJack' && pend.player === meIdx && pend.card.id === c.id)).map((c) => {
          const sel = ui.selected.includes(c.id) || ui.mode?.cardId === c.id;
          return cardHTML(c, (sel ? 'selected ' : '') + (playableIds.has(c.id) ? 'playable' : (canPlay || myPrompt ? 'dim' : '')));
        }).join('') || '<span class="muted">Không có bài trên tay.</span>'}</div>
        <div class="actions" id="actions">${actionsHTML(g, meP, canPlay)}</div>
      </div>`;
  }

  // Bàn ở giữa; ô thông báo + bài của mình ở cột bên phải
  $('#mainArea').innerHTML = `<div class="board playing">${g.winner ? winnerHTML(g) : ''}
    <div class="table-col">${tableHTML}</div><div class="right-col"><div class="room-clock" data-room-clock role="timer"></div>${promptBoxHTML}${meHTML}</div></div>`;

  // log
  const lb = $('#logBox');
  lb.innerHTML = g.log.map((l) => `<div class="${l.startsWith('—') ? 'turnline' : ''}">${esc(l)}</div>`).join('');
  lb.scrollTop = lb.scrollHeight;

  bindGame(g, meIdx, meP, canPlay, myPrompt);
  animateDrawStage(g);
  showCheckReveal(g);
  updateClock();
}

function drawStageHTML(g) {
  const pend = g.pending;
  if (!pend || !['kit', 'blackJack'].includes(pend.type)) return '';
  const mine = pend.player === g.me?.index;
  const kit = pend.type === 'kit';
  const cards = kit ? pend.cards : [pend.card];
  return `<div class="draw-stage ${kit ? 'kit-stage' : 'black-jack-stage'}" data-stage="${pend.stage}">
    <div class="draw-stage-title">${kit ? `${esc(g.players[pend.player].name)} · Kit Carlson chọn 2 lá <span data-draw-clock></span>` : `Black Jack · Lá thứ hai ${pend.red ? '♥ / ♦: rút thêm 1 lá' : '♠ / ♣: không rút thêm'}`}</div>
    <div class="stage-cards" id="${kit ? 'kitCards' : 'blackJackCard'}">${cards.map((card, slot) => {
      const selected = card && ui.selected.includes(card.id);
      const content = card ? cardHTML(card, `small ${selected ? 'selected' : ''}`) : '<div class="card-back">BANG!</div>';
      const face = kit ? content : `<div class="stage-flip"><div class="stage-front">${content}</div><div class="stage-back"><div class="card-back">BANG!</div></div></div>`;
      return kit && mine ? `<button type="button" class="draw-slot kit-choice" data-slot="${slot}" data-kit-id="${card.id}" aria-label="${esc(card.name)} ${esc(card.rank)}" aria-pressed="${!!selected}">${face}</button>`
        : `<div class="draw-slot" data-slot="${slot}">${face}</div>`;
    }).join('')}</div>
    ${kit && mine ? `<button class="btn" data-act="confirmKit" ${ui.selected.length === Math.min(2, cards.length) ? '' : 'disabled'}>Giữ 2 lá đã chọn</button>` : ''}
  </div>`;
}

function animateDrawStage(g) {
  const pend = g.pending;
  const stage = $('.draw-stage');
  if (!stage) { ui.drawStageKey = null; return; }
  const key = `${pend.type}:${pend.stage}`;
  if (ui.drawStageKey === key) return;
  ui.drawStageKey = key;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const deck = $('#deck .card-back').getBoundingClientRect();
  stage.querySelectorAll('.draw-slot').forEach((slot, i) => {
    const end = slot.getBoundingClientRect();
    slot.animate([
      { transform: `translate(${deck.left - end.left}px, ${deck.top - end.top}px) scale(.7) rotate(-12deg)`, opacity: 0 },
      { transform: 'translate(0, 0) scale(1) rotate(0)', opacity: 1 },
    ], { duration: 500, delay: i * 100, easing: 'ease-out', fill: 'backwards' });
  });
  stage.querySelector('.stage-flip')?.animate([{ transform: 'rotateY(180deg)' }, { transform: 'rotateY(0deg)' }], { duration: 400, easing: 'ease-in-out' });
}

// Transfers come from the server so steals animate on every player's screen.
function showCardTransfers(g, previous, drawOrigins = []) {
  if (!g || !previous || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const lastSeq = previous.transfers?.at(-1)?.seq || 0;
  const seatHand = (index) => {
    const seat = [...document.querySelectorAll('.player[data-player]')].find((el) => el.dataset.player === g.players[index]?.name);
    return seat?.querySelector('.hand-fan') || seat;
  };
  let order = 0;
  for (const event of g.transfers || []) {
    if (event.seq <= lastSeq) continue;
    const source = event.from === 'deck' ? $('#deck .card-back')
      : event.from === 'discard' ? $('.arena .pile:last-child .discard-stack') || $('.arena .pile:last-child .card-back')
      : seatHand(event.from);
    for (const [index, card] of event.cards.entries()) {
      const target = event.to === 'deck' ? $('#deck .card-back') : event.to === g.me?.index ? (card && $(`#hand [data-card="${card.id}"]`)) || $('#hand') : seatHand(event.to);
      const origin = ['kit', 'reveal'].includes(event.from) ? drawOrigins[event.slots?.[index] ?? 0] : null;
      if ((!source && !origin) || !target) continue;
      const start = origin || source.getBoundingClientRect(), end = target.getBoundingClientRect();
      const flyer = document.createElement('div');
      flyer.className = 'transfer-card';
      flyer.setAttribute('aria-hidden', 'true');
      // Only the recipient sees a hidden card's face; public discard cards stay visible.
      flyer.innerHTML = card ? cardHTML(card, 'small') : '<div class="card-back">BANG!</div>';
      Object.assign(flyer.style, { left: `${start.left + start.width / 2 - 28}px`, top: `${start.top + start.height / 2 - 39}px` });
      document.body.appendChild(flyer);
      const dx = end.left + end.width / 2 - start.left - start.width / 2;
      const dy = end.top + end.height / 2 - start.top - start.height / 2;
      const animation = flyer.animate([
        { transform: 'translate(0, 0) rotate(-8deg) scale(1)', opacity: 1 },
        { transform: `translate(${dx * .5}px, ${dy * .5 - 45}px) rotate(5deg) scale(1.15)`, opacity: 1, offset: .5 },
        { transform: `translate(${dx}px, ${dy}px) rotate(0deg) scale(.85)`, opacity: 0 },
      ], { duration: 650, delay: (event.from === 'deck' && previous.pending?.type === 'blackJack' ? 650 : 0) + order++ * 130, easing: 'ease-in-out', fill: 'both' });
      animation.onfinish = () => flyer.remove();
      animation.oncancel = () => flyer.remove();
    }
  }
}

// ---------- rút kiểm tra: lá bay ra giữa bàn, lật mặt, báo thành công/thất bại ----------
const CHECK_INFO = {
  Barrel: { icon: '🛢️', need: 'Cần <b>♥ Cơ</b> để Barrel đỡ đạn', win: ['NÉ ĐƯỢC!', 'Barrel đỡ đạn'], lose: ['BARREL TRƯỢT', 'Vẫn có thể bỏ Missed!'] },
  Jail: { icon: '⛓️', need: 'Cần <b>♥ Cơ</b> để thoát tù', win: ['VƯỢT NGỤC!', 'Được chơi lượt này'], lose: ['Ở LẠI TÙ', 'Mất lượt'] },
  Dynamite: { icon: '🧨', need: 'Nổ nếu ra <b>♠ Bích từ 2 đến 9</b>', win: ['AN TOÀN', 'Dynamite chuyền sang người kế'], lose: ['BÙM! −3 MÁU', 'Dynamite phát nổ'] },
};
function showCheckReveal(g) {
  const lc = g.lastCheck;
  // Mỗi ván đếm seq lại từ 1; không giữ mốc của ván trước khi chưa có lần rút nào.
  if (!lc) { ui.lastCheckSeq = 0; return; }
  if (ui.lastCheckSeq == null) { ui.lastCheckSeq = lc.seq; return; } // mới vào phòng: không phát lại lần rút cũ
  if (lc.seq <= ui.lastCheckSeq) return;
  const deck = $('#deck'), arena = $('.arena');
  if (!deck || !arena) return;
  ui.lastCheckSeq = lc.seq;
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
  if (ui.mode?.kind === 'skill') return ui.mode.skill === 'Doc Holyday' || blueCard(c);
  if (pend && pend.player === g.me.index) {
    const n = c.name;
    if (pend.type === 'bang') return pend.responseCardIds?.includes(c.id) ?? (n === 'Missed' || (n === 'Bang' && abilityOf(meP) === 'Calamity Janet'));
    if (pend.type === 'indians' || pend.type === 'duel') return n === 'Bang' || (n === 'Missed' && abilityOf(meP) === 'Calamity Janet');
    return false;
  }
  if (g.turn !== g.me.index || pend || g.phase !== 'play') return false;
  const name = effectiveName(c, meP);
  if (name === 'Missed') return false;
  if (name === 'Bang' && g.bangsPlayed >= 1 && !g.me.unlimitedBang) return false;
  if (name === 'Beer' && (meP.hp >= meP.maxHp || g.players.filter((p) => p.alive).length <= 2)) return false;
  if ((cardInfo(c).type === 'green' || ['Barrel', 'Mustang', 'Scope', 'Dynamite'].includes(c.name)) && meP.eq.some((e) => e.name === c.name)) return false;
  const tf = targetFilter(c, g, meP);
  if (tf && !g.players.some(tf)) return false;
  return true;
}

function promptHTML(g, meIdx, meP) {
  const pend = g.pending;
  const P = (i) => `<b>${esc(g.players[i].name)}</b>`;
  if (g.winner) return '<h4>Ván đấu đã kết thúc.</h4><div class="muted">Xem kết quả ở trên.</div>';
  if (ui.mode?.kind === 'target') {
    const c = targetingCard(g, meP);
    return `<h4>🎯 Chọn mục tiêu cho ${esc(c?.name)}</h4><div class="muted">Bấm vào người chơi có viền vàng nhấp nháy.</div>
      <div class="row"><button class="btn secondary small" data-act="cancel">Huỷ</button></div>`;
  }
  if (ui.mode?.kind === 'discard') {
    const ex = discardExcess(g, meP);
    return `<h4>🗑️ Chọn ${ex} lá để bỏ</h4><div class="muted">Đã chọn ${ui.selected.length}/${ex}.</div>
      <div class="row"><button class="btn" data-act="confirmDiscard" ${ui.selected.length ? '' : 'disabled'}>Bỏ các lá đã chọn</button>
      <button class="btn secondary small" data-act="cancel">Huỷ</button></div>`;
  }
  if (ui.mode?.kind === 'sid') {
    return `<h4>Sid Ketchum: chọn 2 lá để bỏ và hồi 1 máu</h4><div class="muted">Đã chọn ${ui.selected.length}/2.</div>
      <div class="row"><button class="btn" data-act="confirmSid" ${ui.selected.length === 2 ? '' : 'disabled'}>Xác nhận</button>
      <button class="btn secondary small" data-act="cancel">Huỷ</button></div>`;
  }
  if (ui.mode?.kind === 'skill') {
    const doc = ui.mode.skill === 'Doc Holyday';
    const ready = ui.selected.length === (doc ? 2 : 1);
    const step = doc ? (ready ? 'Chọn người chơi đang sáng để bắn' : `Chọn 2 lá để bỏ (${ui.selected.length}/2)`) : 'Chọn 1 lá viền xanh dương để bỏ';
    return `<h4>${esc(ui.mode.skill)} · ${step}</h4><div class="row">
      ${!doc && ready ? '<button class="btn" data-act="confirmSkill">Bỏ lá và rút 2 lá</button>' : ''}
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
    case 'copyAbility':
      if (!mine) return `<h4>${P(pend.player)} đang chọn kỹ năng để sao chép…</h4>`;
      return `<h4>Vera Custer · Chọn kỹ năng để sao chép</h4><div class="row">
        ${g.players.filter((p, i) => p.alive && i !== meIdx).map((p) => `<button class="btn small" data-act="copyAbility" data-owner="${esc(p.name)}" ${tooltipAttrs(p.char, META.chars[p.char].desc)}>${esc(p.char)} · ${esc(p.name)}</button>`).join('')}</div>`;
    case 'bang': {
      const left = pend.need - pend.got;
      if (!mine) return `<h4>💥 ${P(pend.source)} bắn ${P(pend.player)}!</h4><div class="muted">Đang chờ ${P(pend.player)} phản ứng…</div>`;
      return `<h4>💥 ${P(pend.source)} bắn bạn!</h4>
        <div>Cần né thêm <b>${left}</b> lần${pend.need > 1 ? ' (Slab the Killer)' : ''}. Chọn lá đang sáng hoặc trang bị có thể dùng.</div>
        <div class="row">${pend.barrels > 0 ? `<button class="btn blue" data-act="barrel">🛢️ Dùng Barrel (${pend.barrels})</button>` : ''}
        ${meP.eq.filter((c) => pend.responseCardIds?.includes(c.id)).map((c) => `<button class="btn green" data-act="respondEquipment" data-eqid="${c.id}">Dùng ${esc(c.name)}</button>`).join('')}
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
      const luck = abilityOf(g.players[pend.player]) === 'Lucky Duke' ? ' (Lucky Duke lật 2 lá, lấy lá có lợi)' : '';
      if (!mine) return `<h4>${ci.icon} ${P(pend.player)} đang rút kiểm tra ${esc(pend.kind)}…</h4><div class="muted">${ci.need}${luck}.</div>`;
      return `<h4>${ci.icon} Rút kiểm tra ${esc(pend.kind)}</h4><div>${ci.need}${luck}. Bấm vào <b>chồng bài đang sáng</b> để rút.</div>
        <div class="row"><button class="btn" data-act="checkDraw">🃏 Rút bài</button></div>`;
    }
    case 'kit':
      if (!mine) return `<h4>Kit Carlson ${P(pend.player)} đang chọn bài…</h4>`;
      return '<h4>Kit Carlson: chọn 2 lá ở giữa bàn</h4><p>Bạn có 20 giây để chọn. Hai lá đã chọn về tay; lá còn lại trở về bộ bài.</p>';
    case 'blackJack':
      return `<h4>Black Jack đang lật lá thứ hai trong 3 giây</h4><p>${pend.red ? 'Lá Cơ hoặc Rô: sẽ rút thêm 1 lá sau khi thu lá này về tay.' : 'Lá Bích hoặc Chuồn: thu lá này về tay rồi bắt đầu lượt.'}</p>`;
    case 'draw': {
      if (!mine) return `<h4>${P(pend.player)} đang chọn cách rút bài…</h4>`;
      const seconds = ['Jesse Jones', 'Pedro Ramirez', 'Pat Brennan'].includes(abilityOf(meP)) ? 20 : 5;
      const source = pend.options.includes('player') ? ' Hoặc bấm trực tiếp người chơi có bài đang sáng để lấy 1 lá từ tay họ và rút thêm 1 lá.'
        : pend.options.includes('discard') ? ' Hoặc bấm trực tiếp chồng bài bỏ đang sáng để lấy lá trên cùng và rút thêm 1 lá.'
          : pend.options.includes('equipment') ? ' Hoặc bấm một lá trang bị đang sáng trên bàn để lấy vào tay.' : '';
      return `<h4>Rút bài đầu lượt</h4><p>Bấm chồng bài để rút.${source} Sau ${seconds} giây sẽ tự rút. Đồng hồ lượt bắt đầu khi rút xong.</p>`;
    }
  }
  return '';
}

function actionsHTML(g, meP, canPlay) {
  if (!meP.alive || g.winner) return '';
  const out = [];
  if (canPlay && !ui.mode) {
    for (const c of meP.eq) {
      if (!c.ready || !cardInfo(c).activate) continue;
      if (cardInfo(c).effect === 'heal' && meP.hp >= meP.maxHp) continue;
      const filter = targetFilter(c, g, meP);
      if (filter && !g.players.some(filter)) continue;
      out.push(`<button class="btn green" data-act="activate" data-eqid="${c.id}">Dùng ${esc(c.name)}</button>`);
    }
    if (g.me.activeSkill && (g.me.activeSkill !== 'Doc Holyday' || g.players.some((p) => docTarget(p, g)))) {
      const label = g.me.activeSkill === 'Chuck Wengam' ? 'Trả 1 máu để rút 2 lá' : `Dùng kỹ năng ${g.me.activeSkill}`;
      out.push(`<button class="btn blue" data-act="skill">${esc(label)}</button>`);
    }
    const excess = discardExcess(g, meP);
    if (excess > 0) out.push(`<button class="btn" data-act="discardMode">🗑️ Bỏ bớt ${excess} lá rồi kết thúc</button>`);
    else out.push('<button class="btn green" data-act="endTurn">✅ Kết thúc lượt</button>');
  }
  if (abilityOf(meP) === 'Sid Ketchum' && meP.hp < meP.maxHp && g.me.hand.length >= 2 && !ui.mode) out.push('<button class="btn blue" data-act="sidMode">Dùng kỹ năng Sid (bỏ 2 lá, +1 máu)</button>');
  out.push(`<span class="muted">Máu ${meP.hp}/${meP.maxHp} · ${g.me.hand.length} lá trên tay (tối đa giữ ${g.me.handLimit ?? meP.hp} lá khi hết lượt)</span>`);
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

// Kết quả dùng cờ winner do server tính, kể cả đồng đội đã bị loại.
function clearMatchResult() {
  $('#matchResult')?.remove();
  document.body.classList.remove('match-result-open');
  ui.resultDismissed = false;
}

function resultFaction(role) {
  return role === 'Sheriff' || role === 'Deputy' ? 'law' : role;
}


// 12 danh hiệu cuối ván: id → [biểu tượng, tên, mô tả, loại]. glory = vinh danh, tease = chọc ghẹo.
const AWARD_INFO = {
  gunslinger: ['🔫', 'Tay súng nóng nhất', 'Bắn nhiều Bang! nhất', 'glory'],
  damage: ['💥', 'Kẻ gây tổn thương', 'Gây nhiều sát thương nhất', 'glory'],
  mass: ['🏹', 'Đại đại đi', 'Đánh nhiều Gatling + Indians! nhất', 'glory'],
  schemer: ['🧠', 'Kẻ ủ mưu', 'Gây nhiều sát thương nhất trong 1 lượt', 'glory'],
  saloon: ['🍺', 'Khách quen Saloon', 'Hồi nhiều máu nhất bằng Beer / Saloon', 'glory'],
  bandit: ['🏴‍☠️', 'Tướng cướp', 'Outlaw đầu tiên nhắm vào Sheriff (Bang!, Panic!, Cat Balou, Duel, Jesse Jones)', 'glory'],
  rich: ['💰', 'Nhà giàu', 'Đặt nhiều lá trang bị nhất', 'glory'],
  popular: ['💘', 'Ai cũng quý bạn', 'Bị nhắm nhiều nhất (Bang!, Panic!, Cat Balou, Duel, Jail)', 'tease'],
  lucky: ['🍀', 'Nhân phẩm tốt', 'Rút kiểm tra may hơn kỳ vọng nhiều nhất (từ 3 lần)', 'glory'],
  unlucky: ['🐕', 'Sống chó', 'Rút kiểm tra xui hơn kỳ vọng nhiều nhất (từ 3 lần)', 'tease'],
  friendlyFire: ['🤦', 'Bắn nhầm đồng đội', 'Gây nhiều sát thương nhất cho người cùng phe', 'tease'],
  passenger: ['🪑', 'Có tham dự', 'Người phe thắng gây ít sát thương nhất', 'tease'],
};
const RESULT_STEPS = [['result', 'Kết quả'], ['awards', 'Danh hiệu'], ['stats', 'Thống kê']];
const STAT_COLUMNS = [
  ['bangs', 'Bang! bắn'], ['dealt', 'Sát thương gây'], ['taken', 'Máu mất'], ['kills', 'Hạ gục'],
  ['dodged', 'Né được'], ['healed', 'Hồi máu'], ['equips', 'Trang bị'], ['targeted', 'Bị nhắm'],
];

function resultHeaderHTML(g, won) {
  const names = { Sheriff: 'Sheriff & Deputy', Outlaw: 'Outlaw', Renegade: 'Renegade' };
  const nav = RESULT_STEPS.map(([k, l], i) => `<button type="button" data-step="${k}" class="${ui.resultStep === k ? 'on' : ''}"><span>${i + 1}</span>${l}</button>`).join('');
  return `<p class="result-mini">Phe ${names[g.winner]} chiến thắng · ${won ? 'Bạn đã thắng' : 'Bạn đã thua'}</p>
    <nav class="result-steps" aria-label="Màn kết quả">${nav}</nav>`;
}

function awardCardHTML(g, award) {
  const [icon, title, desc, kind] = AWARD_INFO[award.id];
  const roleOf = (name) => g.players.find((p) => p.name === name)?.role;
  const mine = award.ranks[0]?.players.includes(ME);
  const row = (rank, i) => {
    if (!rank) return `<div class="aw-rank r${i + 1} none"><span class="aw-medal">${i ? '🥈' : '🥇'}</span><span class="aw-who">— không có ai —</span></div>`;
    const who = rank.players.map((n) => `<span class="aw-name ${n === ME ? 'aw-me' : ''}"><b>${esc(n)}</b>${n === ME ? ' <i>(bạn)</i>' : ''}${rank.players.length === 1 ? ` <span class="aw-role role-${roleOf(n).toLowerCase()}">${esc(roleOf(n))}</span>` : ''}</span>`).join('');
    return `<div class="aw-rank r${i + 1} ${rank.players.includes(ME) ? 'aw-mine' : ''}"><span class="aw-medal">${i ? '🥈' : '🥇'}</span>
      <span class="aw-who">${who}</span><span class="aw-val">${esc(rank.value)}${rank.sub ? `<small>${esc(rank.sub)}</small>` : ''}</span></div>`;
  };
  return `<div class="aw-card ${kind} ${mine ? 'mine' : ''}">${mine ? '<span class="aw-you">Bạn!</span>' : ''}
    <div class="aw-head"><span class="aw-icon">${icon}</span><div><div class="aw-title">${title}</div><div class="aw-desc">${desc}</div></div></div>
    ${row(award.ranks[0], 0)}${row(award.ranks[1], 1)}</div>`;
}

function resultAwardsHTML(g, won) {
  const awards = g.summary?.awards || [];
  const mine = awards.filter((a) => a.ranks.some((r) => r.players.includes(ME))).length;
  return `${resultHeaderHTML(g, won)}
    <div class="aw-bar"><span>Bạn lên bục <b>${mine}</b>/${awards.length} danh hiệu</span>
      <span class="aw-legend"><span><i class="glory"></i>Vinh danh</span><span><i class="tease"></i>Chọc ghẹo</span></span></div>
    <div class="aw-grid">${awards.map((a) => awardCardHTML(g, a)).join('')}</div>
    <div class="result-foot"><button type="button" class="btn ghost" data-step="result">← Kết quả</button><span></span>
      <button type="button" class="result-continue small" data-step="stats"><span aria-hidden="true">✺</span> Tiếp tục</button></div>`;
}

function resultStatsHTML(g, won) {
  const sum = g.summary || { stats: [], turns: 0 };
  const byName = Object.fromEntries(sum.stats.map((s) => [s.name, s]));
  const rows = [...g.players].sort((a, b) => b.winner - a.winner);
  const best = Object.fromEntries(STAT_COLUMNS.map(([k]) => [k, Math.max(0, ...sum.stats.map((s) => s[k]))]));
  const total = (k) => sum.stats.reduce((n, s) => n + s[k], 0);
  const kpi = (v, l) => `<div class="st-kpi"><b>${v}</b>${l}</div>`;
  const body = rows.map((p) => {
    const s = byName[p.name] || {};
    return `<tr class="${p.winner ? 'win' : 'lose'} ${p.name === ME ? 'st-me' : ''}">
      <td><div class="st-player"><span class="st-av">${p.alive ? playerAvatarHTML(p) : '💀'}</span>
        <div><b>${esc(p.name)}</b>${p.name === ME ? ' <i>(bạn)</i>' : ''}<small>${esc(p.char || '')}</small></div></div></td>
      <td><span class="aw-role role-${p.role.toLowerCase()}">${esc(p.role)}</span></td>
      <td><span class="st-res ${p.winner ? 'w' : 'l'}">${p.winner ? 'Thắng' : 'Thua'}</span></td>
      ${STAT_COLUMNS.map(([k]) => `<td><span class="${best[k] > 0 && s[k] === best[k] ? 'st-best' : ''}">${s[k] ?? 0}</span></td>`).join('')}
      <td>${s.checksOk ?? 0}/${s.checks ?? 0}</td></tr>`;
  }).join('');
  return `${resultHeaderHTML(g, won)}
    <div class="st-kpis">${kpi(sum.turns, 'lượt chơi')}${kpi(sum.minutes ? `${sum.minutes}′` : '—', 'thời gian')}${kpi(total('bangs'), 'phát Bang! cả bàn')}${kpi(total('taken'), 'máu đã đổ')}</div>
    <div class="st-panel"><div class="st-scroll"><table class="st-table">
      <thead><tr><th>Người chơi</th><th>Vai trò</th><th>Kết quả</th>${STAT_COLUMNS.map(([, l]) => `<th>${l}</th>`).join('')}<th>Rút kiểm tra</th></tr></thead>
      <tbody>${body}</tbody></table></div>
      <div class="st-note">Ô tô vàng = cao nhất ván · Rút kiểm tra = số lần thành công / số lần rút (Barrel, Jail, Dynamite)</div></div>
    <div class="result-foot"><button type="button" class="btn ghost" data-step="awards">← Danh hiệu</button><span></span>
      <button type="button" class="btn ghost" data-close>Xem bàn chơi</button>
      ${ROOM.host === ME ? '<button type="button" class="result-continue small" data-reset><span aria-hidden="true">🔁</span> Về phòng chờ</button>' : '<span class="st-wait">Chờ chủ phòng mở ván mới…</span>'}</div>`;
}

function resultMainHTML(g, won, team) {
  const names = { Sheriff: 'Sheriff & Deputy', Outlaw: 'Outlaw', Renegade: 'Renegade' };
  return `<h2 id="resultHeadline" class="result-headline">${won ? 'CHIẾN THẮNG' : 'THUA CUỘC'}</h2>
    <div class="result-emblem" aria-hidden="true"><span></span><img src="/result-revolvers.svg" alt=""><span></span></div>
    <p id="resultSummary" class="result-summary">Phe ${names[g.winner]} chiến thắng!</p>
    <div class="result-team">${team.map((p) => `<div class="result-member ${p.name === ME ? 'result-you' : ''}">
      <div class="result-portrait"><div class="result-medallion"><div class="result-avatar role-${p.role.toLowerCase()}">
        ${playerAvatarHTML(p)}${!p.alive ? '<div class="result-eliminated"><span>ĐÃ BỊ HẠ</span></div>' : ''}
      </div></div><span class="result-role role-${p.role.toLowerCase()}">${esc(p.role)}</span></div>
      <div class="result-player"><span title="${esc(p.name)}">${esc(p.name)}</span>${p.name === ME ? '<b>Bạn</b>' : ''}</div>
      <div class="result-character">${esc(p.char)}</div>
    </div>`).join('')}</div>
    <button type="button" class="result-continue" data-step="awards"><span aria-hidden="true">✺</span> Tiếp tục</button>`;
}

// Desktop: thu nhỏ cả màn (zoom) cho vừa chiều cao cửa sổ, không bao giờ phải cuộn.
// Màn hẹp (điện thoại) thì giữ cỡ chữ bình thường và cho cuộn.
function fitMatchResult(dialog) {
  const body = dialog.querySelector('.result-body');
  if (!body) return;
  body.style.zoom = '';
  if (innerWidth < 900) return;
  const frame = body.parentElement;
  const px = (el, prop) => parseFloat(getComputedStyle(el)[prop]) || 0;
  const avail = dialog.clientHeight - px(dialog, 'paddingTop') - px(dialog, 'paddingBottom')
    - px(frame, 'paddingTop') - px(frame, 'paddingBottom') - px(frame, 'borderTopWidth') - px(frame, 'borderBottomWidth');
  let zoom = 1;
  for (let k = 0; k < 4; k++) {
    const need = body.getBoundingClientRect().height;
    if (need <= avail + 1) break;
    zoom = Math.max(0.45, zoom * (avail / need) - 0.005);
    body.style.zoom = zoom;
  }
}

// Màn kết thúc: ① Kết quả → Tiếp tục → ② Danh hiệu → Tiếp tục → ③ Thống kê
function renderMatchResult(g) {
  if (!g.winner || ui.resultDismissed || $('#matchResult')) return;
  const me = g.players.find((p) => p.name === ME);
  const won = !!me?.winner;
  const team = g.players.filter((p) => me ? resultFaction(p.role) === resultFaction(me.role) : p.winner);
  // Đóng lựa chọn bài còn mở khi server vừa xác định thắng cuộc.
  $('#modal').classList.add('hidden');
  $('#modal').innerHTML = '';
  const dialog = document.createElement('dialog');
  dialog.id = 'matchResult';
  dialog.className = `match-result ${won ? 'result-victory' : 'result-defeat'}`;
  dialog.setAttribute('aria-labelledby', 'resultHeadline');
  dialog.setAttribute('aria-describedby', 'resultSummary');
  const refit = () => fitMatchResult(dialog);
  const resizeWatch = new ResizeObserver(refit); // co giãn lại mỗi khi cửa sổ đổi cỡ
  const dismiss = () => {
    ui.resultDismissed = true;
    resizeWatch.disconnect();
    dialog.remove();
    document.body.classList.remove('match-result-open');
    ($('#resetBtn') || $('#leaveBtn'))?.focus();
  };
  const show = (step) => {
    ui.resultStep = step;
    dialog.dataset.step = step;
    const html = step === 'awards' ? resultAwardsHTML(g, won) : step === 'stats' ? resultStatsHTML(g, won) : resultMainHTML(g, won, team);
    dialog.innerHTML = `<div class="result-frame step-${step}"><div class="result-body">${html}</div></div>`;
    dialog.scrollTop = 0;
    dialog.querySelectorAll('[data-step]').forEach((b) => { b.onclick = () => show(b.dataset.step); });
    const close = dialog.querySelector('[data-close]');
    if (close) close.onclick = dismiss;
    const reset = dialog.querySelector('[data-reset]');
    if (reset) reset.onclick = () => { dismiss(); $('#resetBtn')?.click(); };
    (dialog.querySelector('.result-continue') || dialog.querySelector('[data-close]'))?.focus();
    fitMatchResult(dialog);
  };
  dialog.oncancel = (event) => { event.preventDefault(); dismiss(); };
  document.body.appendChild(dialog);
  document.body.classList.add('match-result-open');
  show('result');
  dialog.showModal();
  fitMatchResult(dialog);
  resizeWatch.observe(dialog);
  document.fonts?.ready.then(refit); // font tải xong có thể làm chữ cao hơn
}

const sendAction = (action) => api(`/api/rooms/${ROOM.code}/action`, { action });

function showPlayedCards(g, previous, handOrigins = {}) {
  if (!g || !previous) return;
  const lastSeq = previous.plays?.at(-1)?.seq || 0;
  let discardOrder = 0;
  for (const event of g.plays || []) {
    if (event.seq <= lastSeq) continue;
    const player = g.players[event.player]?.name;
    if (!player) continue;
    let origin = event.player === g.me?.index ? handOrigins[event.card.id] : null;
    if (!origin) {
      const seat = [...document.querySelectorAll('.player[data-player]')].find((el) => el.dataset.player === player);
      const hand = seat?.querySelector('.hand-fan') || seat;
      if (!hand) continue;
      const rect = hand.getBoundingClientRect();
      origin = { left: rect.left + rect.width / 2 - 28, top: rect.top + rect.height / 2 - 39, width: 56, height: 78 };
    }
    animatePlayedCard(event.card, origin, {
      target: g.players[event.recipient]?.name, kind: event.kind,
      delay: event.kind === 'discard' ? discardOrder++ * 110 : 0,
    }, player);
  }
}

function animatePlayedCard(card, origin, action, player) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const equipment = action.kind !== 'discard' && ['blue', 'gun', 'green'].includes(cardInfo(card).type);
  const recipient = card.name === 'Jail' ? action.target : player;
  const seat = [...document.querySelectorAll('.player[data-player]')].find((el) => el.dataset.player === recipient);
  const target = equipment ? seat?.querySelector(`[data-eq="${card.id}"]`) || seat?.querySelector('.eqframe') || seat?.querySelector('.av')
    : $('#discardPile .ds-slot:last-child .card') || $('#discardPile');
  if (!target) return;
  const end = target.getBoundingClientRect();
  const flyer = document.createElement('div');
  flyer.className = 'played-card-flight';
  flyer.setAttribute('aria-hidden', 'true');
  flyer.innerHTML = cardHTML(card);
  Object.assign(flyer.style, { left: `${origin.left}px`, top: `${origin.top}px`, width: `${origin.width}px`, height: `${origin.height}px` });
  document.body.appendChild(flyer);
  const dx = end.left + end.width / 2 - origin.left - origin.width / 2;
  const dy = end.top + end.height / 2 - origin.top - origin.height / 2;
  const scale = Math.min(end.width / origin.width, end.height / origin.height);
  const animation = flyer.animate([
    { transform: 'translate(0, 0) rotate(0deg) scale(1)', opacity: 1 },
    { transform: `translate(${dx * .5}px, ${dy * .5 - 45}px) rotate(-10deg) scale(1.08)`, opacity: 1, offset: .5 },
    { transform: `translate(${dx}px, ${dy}px) rotate(0deg) scale(${scale})`, opacity: 1, offset: .9 },
    { transform: `translate(${dx}px, ${dy}px) rotate(0deg) scale(${scale})`, opacity: 0 },
  ], { duration: 650, delay: action.delay || 0, easing: 'ease-in-out', fill: 'both' });
  animation.onfinish = () => flyer.remove();
  animation.oncancel = () => flyer.remove();
}

function bindGame(g, meIdx, meP, canPlay, myPrompt) {
  const main = $('#mainArea');
  const pend = g.pending;

  main.querySelectorAll('#hand .card').forEach((el) => el.onclick = run(async () => {
    const id = Number(el.dataset.card);
    const c = g.me.hand.find((x) => x.id === id);
    if (ui.mode && ['discard', 'sid', 'skill'].includes(ui.mode.kind)) {
      if (!isClickable(c, g, meP)) return;
      const max = ui.mode.kind === 'discard' ? discardExcess(g, meP) : ui.mode.skill === 'José Delgado' ? 1 : 2;
      if (ui.selected.includes(id)) ui.selected = ui.selected.filter((x) => x !== id);
      else if (ui.selected.length < max) ui.selected.push(id);
      else if (max === 1 && ui.mode.skill === 'José Delgado') ui.selected = [id];
      return renderGame();
    }
    if (myPrompt && ['bang', 'indians', 'duel'].includes(pend.type)) {
      if (!isClickable(c, g, meP)) return toast(pend.type === 'bang' ? 'Lá này không thể dùng để né đòn.' : 'Cần lá Bang!.');
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
    if (myPrompt && pend.type === 'draw' && pend.options.includes('player')) {
      const target = g.players.find((p) => p.name === el.dataset.player);
      if (!target?.alive || target.name === ME || !target.handCount) return;
      return sendAction({ type: 'drawChoice', from: 'player', target: target.name });
    }
    if (ui.mode?.kind === 'skill' && ui.mode.skill === 'Doc Holyday' && ui.selected.length === 2) {
      const target = g.players.find((p) => p.name === el.dataset.player);
      if (!docTarget(target, g)) return;
      const cardIds = ui.selected;
      ui.mode = null; ui.selected = [];
      return sendAction({ type: 'skill', cardIds, target: target.name });
    }
    if (ui.mode?.kind !== 'target') return;
    const p = g.players.find((x) => x.name === el.dataset.player);
    const card = targetingCard(g, meP);
    const tf = card && targetFilter(card, g, meP);
    if (!tf || !tf(p)) return toast('Không chọn được người này.');
    const nm = effectiveName(card, meP);
    const type = ui.mode.activate ? 'activate' : 'play';
    if (nm === 'Panic' || nm === 'Cat Balou' || ['take', 'discard'].includes(cardInfo(card).effect)) {
      if (!p.eq.length) { ui.mode = null; return sendAction({ type, cardId: card.id, target: p.name, targetCard: 'hand' }); }
      return chooseTargetCard(card, p, type);
    }
    ui.mode = null;
    await sendAction({ type, cardId: card.id, target: p.name });
  }));

  const deckEl = main.querySelector('#deck.ready');
  if (deckEl) deckEl.onclick = run(async () => {
    deckEl.classList.remove('ready');
    await sendAction(g.pending.type === 'draw' ? { type: 'drawChoice', from: 'deck' } : { type: 'checkDraw' });
  });
  const discardEl = main.querySelector('#discardPile.draw-source');
  if (discardEl) discardEl.onclick = run(() => sendAction({ type: 'drawChoice', from: 'discard' }));

  main.querySelectorAll('#storeCards .card').forEach((el) => el.onclick = run(async () => {
    if (!myPrompt) return;
    await sendAction({ type: 'pick', cardId: Number(el.dataset.card) });
  }));
  main.querySelectorAll('#kitCards .kit-choice').forEach((el) => el.onclick = () => {
    if (!myPrompt || pend.type !== 'kit') return;
    const id = Number(el.dataset.kitId);
    if (ui.selected.includes(id)) ui.selected = ui.selected.filter((x) => x !== id);
    else if (ui.selected.length < 2) ui.selected.push(id);
    renderGame();
  });

  main.querySelectorAll('[data-act]').forEach((el) => el.onclick = run(async (event) => {
    const act = el.dataset.act;
    if (act === 'cancel') { ui.mode = null; ui.selected = []; return renderGame(); }
    if (act === 'discardMode') { ui.mode = { kind: 'discard' }; ui.selected = []; return renderGame(); }
    if (act === 'sidMode') { ui.mode = { kind: 'sid' }; ui.selected = []; return renderGame(); }
    if (act === 'skill') {
      if (g.me.activeSkill === 'Chuck Wengam') return sendAction({ type: 'skill' });
      ui.mode = { kind: 'skill', skill: g.me.activeSkill }; ui.selected = [];
      return renderGame();
    }
    if (act === 'confirmSkill') {
      const cardIds = ui.selected; ui.mode = null; ui.selected = [];
      return sendAction({ type: 'skill', cardIds });
    }
    if (act === 'copyAbility') return sendAction({ type: 'copyAbility', target: el.dataset.owner });
    if (act === 'patDraw') {
      event.stopPropagation();
      return sendAction({ type: 'drawChoice', from: 'equipment', target: el.dataset.owner, cardId: Number(el.dataset.eq) });
    }
    if (act === 'confirmDiscard') {
      const ids = ui.selected; ui.mode = null; ui.selected = [];
      await sendAction({ type: 'discard', cardIds: ids });
      if (discardExcess(g, meP) <= ids.length) await sendAction({ type: 'endTurn' });
      return;
    }
    if (act === 'confirmSid') { const ids = ui.selected; ui.mode = null; ui.selected = []; return sendAction({ type: 'sid', cardIds: ids }); }
    if (act === 'confirmKit') { const ids = ui.selected; ui.mode = null; ui.selected = []; return sendAction({ type: 'kit', cardIds: ids }); }
    if (act === 'endTurn') return sendAction({ type: 'endTurn' });
    if (act === 'take') return sendAction({ type: 'take' });
    if (act === 'barrel') return sendAction({ type: 'barrel' });
    if (act === 'respondEquipment') return sendAction({ type: 'respond', cardId: Number(el.dataset.eqid) });
    if (act === 'activate') {
      const cardId = Number(el.dataset.eqid);
      const card = meP.eq.find((c) => c.id === cardId);
      if (targetFilter(card, g, meP)) {
        ui.mode = { kind: 'target', cardId, activate: true };
        return renderGame();
      }
      return sendAction({ type: 'activate', cardId });
    }
    if (act === 'checkDraw') return sendAction({ type: 'checkDraw' });
    if (act === 'draw') return sendAction({ type: 'drawChoice', from: el.dataset.from, target: $('#drawTarget')?.value });
  }));
}

function chooseTargetCard(card, p, type) {
  const modal = $('#modal');
  modal.innerHTML = `<div class="panel"><h3>${esc(card.name)}: chọn lá của ${esc(p.name)}</h3>
    <div class="row">
      ${p.handCount ? `<button class="btn" data-tc="hand">🂠 1 lá ngẫu nhiên trên tay (${p.handCount})</button>` : ''}
      ${p.eq.map((c) => {
        const info = cardInfo(c);
        return `<button class="btn ${info.type === 'green' ? 'green' : 'blue'}" data-tc="${c.id}" ${tooltipAttrs(c.name, info.desc)}>${info.icon} ${esc(c.name)}</button>`;
      }).join('')}
    </div>
    <div class="row" style="margin-top:14px"><button class="btn secondary small" data-tc="cancel">Huỷ</button></div></div>`;
  modal.classList.remove('hidden');
  modal.querySelectorAll('[data-tc]').forEach((b) => b.onclick = run(async () => {
    modal.classList.add('hidden');
    if (b.dataset.tc === 'cancel') return;
    ui.mode = null;
    await sendAction({ type, cardId: card.id, target: p.name, targetCard: b.dataset.tc === 'hand' ? 'hand' : Number(b.dataset.tc) });
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

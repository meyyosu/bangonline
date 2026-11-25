'use strict';
const $ = (s, el = document) => el.querySelector(s);
const app = $('#app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SUIT = { S: '♠', H: '♥', D: '♦', C: '♣' };
const ROLE_VI = { Sheriff: 'Sheriff', Deputy: 'Deputy', Outlaw: 'Outlaw', Renegade: 'Renegade' };

let META = null, ME = null, ROOM = null;
let lobbyES = null, roomES = null;
const ui = { mode: null, selected: [], lastLogLen: 0, drawTarget: null };
const DAMAGE_EFFECT_MS = 650;

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
  gameAudio.stop();
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
function fasterBotsField(checked = false) {
  return `<label><input type="checkbox" name="fasterBots" ${checked ? 'checked' : ''}> Faster Bots</label>
    <p class="muted">Bỏ khoảng chờ 2 giây giữa các hành động của bot.</p>`;
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
  $('#fanHand')?.remove();
  ROOM = null;
  history.replaceState(null, '', '/');
  const dodgeCount = META.dodgeCityCardCount ?? META.greenCardCount;
  const dodgeDescription = dodgeCount
    ? `Thêm ${dodgeCount} lá Dodge City vào bộ bài của phòng.`
    : 'Máy chủ chưa nạp dữ liệu Dodge City.';
  const valleyCount = META.valleyOfShadowCardCount;
  const valleyDescription = valleyCount
    ? `Thêm ${valleyCount} lá và cơ chế mới từ phiên bản mở rộng Valley of Shadows.`
    : 'Máy chủ chưa nạp dữ liệu Valley of Shadows.';
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
          ${fasterBotsField()}
          <label ${tooltipAttrs('Dodge City', dodgeDescription)}><input type="checkbox" name="dodgeCity" aria-description="${esc(dodgeDescription)}" ${dodgeCount ? '' : 'disabled'}> Bản mở rộng: Dodge City</label>
          <label ${tooltipAttrs('Valley of Shadows', valleyDescription)}><input type="checkbox" name="valleyOfShadow" aria-description="${esc(valleyDescription)}" ${valleyCount ? '' : 'disabled'}> Bản mở rộng: Valley of Shadows</label>
          <button class="btn" style="width:100%;margin-top:10px">🎲 Tạo phòng mới</button>
        </form>
        <h2 style="margin-top:22px">Vào bằng mã</h2>
        <form id="joinForm" class="row">
          <input type="text" name="code" placeholder="VD: AB12" maxlength="4" style="flex:1;text-transform:uppercase">
          <button class="btn blue">Vào</button>
        </form>
        <p class="muted" style="margin-top:18px">Bang! cần 4–7 người, tối đa 8 người khi bật Dodge City. Tạo phòng rồi gửi mã hoặc đường link cho bạn bè.</p>
      </div>
      <div class="panel">
        <h2>Các phòng đang mở</h2>
        <div class="room-list" id="roomList"><div class="empty">Đang tải…</div></div>
      </div>
    </div>`;
  $('#createForm').onsubmit = run(async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const r = await api('/api/rooms', { name: f.get('name'), password: f.get('password'), turnSeconds: Number(f.get('turnSeconds')), characterChoices: Number(f.get('characterChoices')), characterSeconds: Number(f.get('characterSeconds')), dodgeCity: f.has('dodgeCity'), valleyOfShadow: f.has('valleyOfShadow'), fasterBots: f.has('fasterBots') });
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
          <div><b>${esc(r.name)}</b> <span class="code">${r.code}</span> ${r.hasPassword ? '🔒' : ''} ${r.dodgeCity ? '· Dodge City' : ''} ${r.valleyOfShadow ? '· Valley of Shadows' : ''} ${r.fasterBots ? '· Faster Bots' : ''}</div>
          <div class="muted">Chủ phòng: ${esc(r.host)} · ${r.players.length}/${r.max} người chơi · ${(r.spectators || []).length} khán giả · ${r.turnSeconds ? r.turnSeconds + ' giây/lượt' : 'Không giới hạn giờ'}</div>
        </div>
        <div class="row">
          <span class="badge ${r.status}">${r.status === 'waiting' ? 'Đang chờ' : r.status === 'playing' ? 'Đang chơi' : 'Đã xong'}</span>
          ${(r.players.includes(ME) || r.spectators?.includes(ME)) ? `<button class="btn small green" data-join="${r.code}">Quay lại</button>`
            : `<button class="btn small" data-join="${r.code}">${r.status === 'waiting' && r.players.length < r.max ? 'Tham gia' : 'Vào xem'}</button>`}
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
  const stream = roomES = new EventSource(`/api/rooms/${code}/stream`);
  let receivedSnapshot = false;
  stream.onmessage = (ev) => {
    if (roomES !== stream) return;
    const d = JSON.parse(ev.data);
    if (d.type === 'closed') { toast('Phòng đã đóng.'); return showLobby(); }
    if (d.type !== 'room') return;
    if (!d.room.players.includes(ME) && !d.room.spectators?.includes(ME)) { toast('Bạn không còn ở trong phòng.'); return showLobby(); }
    const previous = ROOM;
    const previousGame = previous?.game;
    const previousLiveGame = receivedSnapshot ? previousGame : null;
    const handOrigins = Object.fromEntries(shownHandCards().map((el) => [el.dataset.card, el.getBoundingClientRect()]));
    const drawOrigins = [...document.querySelectorAll('.draw-stage .draw-slot')].map((el) => el.getBoundingClientRect());
    const transferOrigins = captureTransferOrigins(previousGame);
    ROOM = d.room;
    if (receivedSnapshot) showRoomSounds(ROOM, previous);
    receivedSnapshot = true;
    ui.serverOffset = ROOM.serverNow - Date.now();
    renderRoom(previousLiveGame);
    showPlayedCards(ROOM.game, previousGame, handOrigins);
    showCardTransfers(ROOM.game, previousGame, drawOrigins, transferOrigins);
  };
  stream.onerror = () => {
    receivedSnapshot = false;
    if (roomES === stream && stream.readyState === EventSource.CLOSED) showLobby();
  };
}

function showRoomSounds(room, previous) {
  if (!previous || previous.code !== room.code) return;
  if (room.players.some((name) => !previous.players.includes(name))) gameAudio.play('playerjoin');
  const lastSeq = previous.game?.soundSeq || 0;
  for (const cue of room.game?.sounds || []) {
    if (cue.seq > lastSeq) gameAudio.play(...cue.files);
  }
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

function renderRoom(previousGame) {
  const r = ROOM;
  $('#roomName').textContent = r.name;
  updateClock();
  const btns = $('#roomBtns');
  const isHost = r.host === ME;
  const g = r.game;
  btns.innerHTML = `
    ${g && r.spectators?.length ? `<span class="muted" title="${esc(r.spectators.join(', '))}">👁️ ${r.spectators.length} khán giả</span>` : ''}
    ${g?.winner && canReset() ? '<button class="btn green" id="resetBtn">🔁 Về phòng chờ</button>' : ''}
    ${g?.me && !g.winner ? `<button class="btn" id="pauseBtn" ${r.pause ? 'disabled' : ''}>Tạm dừng</button><button class="btn ghost small" id="pauseNotifications">Bật thông báo Windows</button>` : ''}
    <button class="btn secondary" id="leaveBtn">Rời phòng${g?.me && !g.winner ? ' giữa ván' : ''}</button>`;
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
  // Mỗi người tự xem màn kết quả: phòng về phòng chờ thì màn kết quả đang mở vẫn giữ (đã có số liệu ván cũ),
  // chỉ đóng khi ván mới bắt đầu.
  const openResult = $('#matchResult');
  if (g?.winner) ui.lastResult = { code: r.code, g };
  else if (g) { ui.lastResult = null; clearMatchResult(); }
  else if (!openResult) ui.resultDismissed = false;
  else if (!openResult.dataset.roomWaiting) { openResult.dataset.roomWaiting = '1'; openResult.refresh?.(); }
  if (!g) {
    ui.lastCheckSeq = null;
    $('#fanHand')?.remove();
    return renderWaiting();
  }
  renderGame();
  const showedDamage = showCombatEffects(g, previousGame);
  if (g.winner && showedDamage && ui.resultDelay == null) {
    ui.resultDelay = setTimeout(() => {
      ui.resultDelay = null;
      renderMatchResult(g);
    }, DAMAGE_EFFECT_MS);
  }
  if (ui.resultDelay == null) renderMatchResult(g);
  updateClock();
}

function roomSettingsBody(form) {
  const f = new FormData(form);
  const body = { turnSeconds: Number(f.get('turnSeconds')), characterChoices: Number(f.get('characterChoices')), characterSeconds: Number(f.get('characterSeconds')), fasterBots: f.has('fasterBots') };
  if (f.has('removePassword')) body.password = '';
  else if (f.get('password')) body.password = f.get('password');
  return body;
}

// Phát hiện server chạy bản cũ trước khi chơi, để ván không kết thúc mà thiếu danh hiệu/thống kê.
// Server cũ không gửi r.server; server mới báo stale khi code trên ổ đĩa mới hơn code đang chạy.
function serverOutdated(r) {
  return !r.server?.features?.includes('winProb3') || !!r.server.stale;
}

function serverWarningHTML(r) {
  if (!serverOutdated(r)) return '';
  const isHost = r.host === ME;
  return `<div class="server-warning" role="alert"><b>⚠️ Server đang chạy bản cũ</b>
    <p>Ván chơi trên server này sẽ <b>không có danh hiệu và thống kê</b> cuối ván.</p>
    <p>${isHost ? 'Bạn là host: hãy' : 'Nhắc host'} chạy lại <code>CHAY-GAME.bat</code> và nhấn <b>Enter</b> để khởi động lại server trước khi bắt đầu.
    Khởi động lại sẽ đóng các phòng đang mở; mọi người chỉ cần vào lại.</p></div>`;
}

function renderWaiting() {
  const r = ROOM;
  const isHost = r.host === ME;
  const n = r.players.length;
  const spectator = r.spectators?.includes(ME);
  $('#mainArea').innerHTML = `
    ${serverWarningHTML(r)}
    <div class="panel">
      <h2>Phòng chờ (${n}/${r.max})</h2>
      ${ui.lastResult?.code === r.code && !$('#matchResult') ? '<button class="btn small secondary" id="lastResultBtn">📊 Xem lại kết quả ván trước</button>' : ''}
      <ul class="seat-list">
        ${r.players.map((p) => `<li><span class="dot ${r.online.includes(p) ? 'on' : ''}"></span>
          <b>${esc(p)}</b> ${r.bots?.includes(p) ? '<span class="muted">🤖 Bot</span>' : ''} ${p === r.host ? '👑' : ''} ${p === ME ? '<span class="muted">(bạn)</span>' : ''}
          ${isHost && p !== ME ? `<button class="btn small secondary" style="margin-left:auto" data-kick="${esc(p)}">Mời ra</button>` : ''}</li>`).join('')}
      </ul>
      ${isHost ? `<button class="btn secondary" id="addBotBtn" ${n >= r.max ? 'disabled' : ''}>🤖 Thêm bot</button>` : ''}
      <h3>Khán giả (${(r.spectators || []).length})</h3>
      <ul class="seat-list">${(r.spectators || []).map((p) => `<li><span class="dot ${r.online.includes(p) ? 'on' : ''}"></span><b>${esc(p)}</b> ${p === r.host ? '👑' : ''} ${p === ME ? '(bạn)' : ''}${isHost && p !== ME ? `<button class="btn small secondary" data-kick="${esc(p)}">Mời ra</button>` : ''}</li>`).join('')}</ul>
      <button class="btn secondary" id="spectatorBtn" ${spectator && n >= r.max ? 'disabled' : ''}>${spectator ? 'Tham gia chơi' : 'Làm khán giả'}</button>
      <p class="muted">${spectator ? 'Bạn đang làm khán giả.' : 'Bạn đang là người chơi.'} Khán giả không chiếm ghế và chỉ xem thông tin công khai.</p>
      <div class="room-settings">
        <h3>Cài đặt phòng</h3>
        ${r.dodgeCity ? '<p>Bản mở rộng: Dodge City</p>' : ''}
        ${r.valleyOfShadow ? '<p>Bản mở rộng: Valley of Shadows</p>' : ''}
        <p>${r.hasPassword ? '🔒 Có mật khẩu' : '🔓 Không có mật khẩu'} · ${r.turnSeconds ? r.turnSeconds + ' giây/lượt' : 'Không giới hạn thời gian'}</p>
        <p>Chọn 1 trong ${r.characterChoices} nhân vật · ${r.characterSeconds ? r.characterSeconds + ' giây/người để chọn' : 'Không giới hạn giờ chọn nhân vật'}</p>
        ${!isHost && r.fasterBots ? '<p>Faster Bots</p>' : ''}
        ${isHost ? `<form id="settingsForm">
          <label for="roomPassword">Mật khẩu mới (để trống để giữ nguyên)</label>
          <input id="roomPassword" type="password" name="password" maxlength="64" autocomplete="new-password" value="${esc(ui.settingsDraft?.password || '')}">
          <label><input type="checkbox" name="removePassword" ${ui.settingsDraft?.removePassword ? 'checked' : ''}> Xóa mật khẩu phòng</label>
          ${characterFields(ui.settingsDraft?.characterChoices ?? r.characterChoices, ui.settingsDraft?.characterSeconds ?? r.characterSeconds)}
          ${timerField(ui.settingsDraft?.turnSeconds ?? r.turnSeconds)}
          ${fasterBotsField(ui.settingsDraft?.fasterBots ?? r.fasterBots)}
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
    if (serverOutdated(ROOM) && !confirm('Server đang chạy bản cũ: ván này sẽ KHÔNG có danh hiệu và thống kê cuối ván.\n\nNên khởi động lại server (chạy lại CHAY-GAME.bat, nhấn Enter) trước.\n\nVẫn bắt đầu ván?')) return;
    // Save the visible settings even when the host starts without pressing Save.
    const settings = form ? roomSettingsBody(form) : {};
    await api(`/api/rooms/${r.code}/start`, settings);
    ui.settingsDraft = null;
  }));
  $('#addBotBtn') && ($('#addBotBtn').onclick = run(() => api(`/api/rooms/${r.code}/add-bot`, {})));
  $('#lastResultBtn') && ($('#lastResultBtn').onclick = () => {
    ui.resultDismissed = false;
    renderMatchResult(ui.lastResult.g);
    const dlg = $('#matchResult');
    if (dlg) { dlg.dataset.roomWaiting = '1'; dlg.refresh(); }
    $('#lastResultBtn')?.remove();
  });
  $('#spectatorBtn').onclick = run(() => api(`/api/rooms/${r.code}/spectator`, { spectator: !spectator }));
  const settings = $('#settingsForm');
  if (settings) {
    settings.oninput = () => {
      const f = new FormData(settings);
      ui.settingsDraft = { turnSeconds: f.get('turnSeconds'), characterChoices: f.get('characterChoices'), characterSeconds: f.get('characterSeconds'), fasterBots: f.has('fasterBots'), password: f.get('password'), removePassword: f.has('removePassword') };
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
  const text = p?.frozen ? '⏸ Ván chơi tạm dừng · Đồng hồ lượt được giữ nguyên' : t ? `⏱ ${name ? `${name} · ` : ''}${t.character ? 'Chọn nhân vật' : t.draw ? drawLabel : t.response ? 'Phản hồi' : 'Lượt chơi'}: ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
    : `⏱ ${g?.phase === 'character' ? 'Chọn nhân vật' : 'Lượt chơi'}: không giới hạn`;
  document.querySelectorAll('[data-room-clock]').forEach((el) => {
    el.hidden = !g || !!g.winner;
    el.textContent = text;
    el.classList.toggle('urgent', !p?.frozen && !!t && seconds <= 10);
  });
  updateTurnRing();
}
setInterval(updateClock, 250);

// Vòng đếm ngược quanh avatar người mà đồng hồ đang đếm (ROOM.timer.player).
// Vòng chạy bằng CSS animation; mỗi lần vẽ lại bàn thì tính lại số giây còn lại theo hạn của server.
const RING_URGENT = 10, RING_FINAL = 4;
const timerLeft = (t) => (t.deadline - Date.now() - (ui.serverOffset || 0)) / 1000;
function renderTurnRing() {
  const t = ROOM?.timer, g = ROOM?.game;
  if (!t || !g || g.winner || ROOM.pause?.frozen) return;
  const p = g.players[t.player];
  const seat = p && $(`.player[data-player="${CSS.escape(p.name)}"]`);
  if (!seat) return;
  const ring = document.createElement('div');
  ring.className = 'turn-ring';
  ring.style.setProperty('--ring-total', t.seconds || (t.character ? ROOM.characterSeconds : ROOM.turnSeconds));
  ring.style.setProperty('--ring-left', Math.max(0, timerLeft(t)).toFixed(2));
  seat.classList.add('ticking');
  seat.querySelector('.av').appendChild(ring);
  updateTurnRing();
}
// Nhấp nháy khi gần hết (gọi trong updateClock, mỗi 250ms)
function updateTurnRing() {
  const seat = $('.player.ticking');
  if (!seat) return;
  const t = ROOM?.timer;
  const left = t && !ROOM.pause?.frozen ? timerLeft(t) : Infinity;
  seat.classList.toggle('urgent', left <= RING_URGENT);
  seat.classList.toggle('final', left <= RING_FINAL);
}

// ---------- bàn chơi ----------
const cardInfo = (c) => META.cards[c.name];
// Bài trên tay: lá cùng tên đứng cạnh nhau (vd. 2 lá Missed), giữ thứ tự loại theo lần đầu xuất hiện
function groupSameCards(cards) {
  const first = new Map();
  cards.forEach((c, i) => { if (!first.has(c.name)) first.set(c.name, i); });
  return cards.map((c, i) => [c, i]).sort((a, b) => first.get(a[0].name) - first.get(b[0].name) || a[1] - b[1]).map(([c]) => c);
}
// Tranh lá bài thật: public/cards/<tên-không-dấu>.jpg (160x160, cắt bằng tools/crop-card-art.ps1). Lá chưa có ảnh dùng icon.
const CARD_ART = new Set(['Bang', 'Missed', 'Beer', 'Saloon', 'Stagecoach', 'Wells Fargo', 'General Store', 'Panic', 'Cat Balou', 'Duel',
  'Indians', 'Gatling', 'Barrel', 'Mustang', 'Scope', 'Jail', 'Dynamite', 'Volcanic', 'Schofield', 'Remington', 'Rev. Carabine', 'Winchester',
  'Bible', 'Buffalo Rifle', 'Can Can', 'Canteen', 'Conestoga', 'Derringer', 'Howitzer', 'Iron Plate', 'Knife', 'Pepperbox', 'Pony Express',
  'Sombrero', 'Ten Gallon Hat', 'Rag Time', 'Brawl', 'Dodge', 'Springfield', 'Tequila', 'Whisky', 'Binocular', 'Hideout', 'Punch']);
const cardArtSrc = (name) => `/cards/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.jpg`;
function cardIconHTML(c, info) {
  return CARD_ART.has(c.name) ? `<div class="icon art"><img src="${cardArtSrc(c.name)}" alt="" draggable="false"></div>` : `<div class="icon">${info.icon}</div>`;
}
function cardHTML(c, cls = '', pressed = null) {
  const info = cardInfo(c);
  const red = c.suit === 'H' || c.suit === 'D';
  const choice = pressed === null ? '' : `role="button" tabindex="0" aria-pressed="${pressed}"`;
  return `<div class="card ${info.type} ${cls}" data-card="${c.id}" ${tooltipAttrs(c.name, info.desc)} ${choice}>
    <div class="corner ${red ? 'red' : ''}">${c.rank}${SUIT[c.suit]}</div>
    ${cardIconHTML(c, info)}<div class="cname">${esc(c.name)}</div>
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
const EQ_KIND = { Mustang: ['horse', '+1'], Scope: ['horse', '−1'], Binocular: ['', '−1'], Hideout: ['', '+1'], Jail: ['jail', ''], Dynamite: ['dyn', ''] };
function eqTileHTML(c, extra = '', owner = null) {
  const info = cardInfo(c);
  const [kind, badge] = info.type === 'green' ? ['green', c.ready ? '✓' : '⏳']
    : info.type === 'gun' ? ['gun', String(info.range)] : (EQ_KIND[c.name] || ['', '']);
  const tag = owner === null ? 'div' : 'button';
  const action = owner === null ? '' : `type="button" data-act="patDraw" data-owner="${esc(owner)}" aria-label="Lấy ${esc(c.name)} của ${esc(owner)}"`;
  const desc = c.disabled ? `${info.desc} Đang bị Belle Star vô hiệu hóa.` : info.desc;
  const art = CARD_ART.has(c.name);
  return `<${tag} class="eqt ${kind} ${extra}${c.disabled ? ' inactive' : ''}${art ? ' has-art' : ''}" ${action} data-eq="${c.id}" ${tooltipAttrs(c.name, desc)}>
    ${art ? `<span class="ic art"><img src="${cardArtSrc(c.name)}" alt="" draggable="false"></span>` : `<span class="ic">${info.icon}</span>`}<span class="nm">${esc(c.name)}</span>${badge ? `<span class="bd">${badge}</span>` : ''}</${tag}>`;
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
  if (p.ghost) return '<div class="hpbar">👻 Ghost · 0 máu</div>';
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
// Ảnh chân dung nhân vật trong public/avatars, đặt tên theo nhân vật.
const charSlug = (name) => name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// Chiều rộng, chiều cao ảnh gốc và vùng vuông [x, y, cạnh] quanh khuôn mặt.
const AVATAR_CROPS = {
  'annie-versary': [309, 466, 100, 62, 124],
  'black-flower': [194, 310, 45, 51, 90],
  'colorado-bill': [218, 316, 48, 56, 88],
  'der-spot-burst-ringer': [204, 319, 43, 56, 92],
  'evelyn-shebang': [208, 327, 72, 65, 68],
  'henry-block': [202, 314, 42, 51, 97],
  'lemonade-jim': [221, 324, 50, 63, 74],
  'mick-defender': [214, 319, 60, 63, 91],
  'tuco-franziskaner': [209, 317, 44, 61, 112],
};
// Tooltip nhân vật: số máu + kỹ năng; nhân vật của Sheriff (vai trò công khai) ghi thêm +1.
const charTipAttrs = (name) => {
  const ch = META.chars?.[name];
  if (!ch) return '';
  const sheriff = ROOM?.game?.players?.some((p) => p.char === name && p.role === 'Sheriff');
  return tooltipAttrs(name, `❤ ${ch.hp + (sheriff ? 1 : 0)} máu${sheriff ? ' (+1 vì là Sheriff)' : ''}\n${ch.desc}`);
};
let charNameRe = null;
// Một dòng Diễn biến: tên nhân vật thành chữ gạch chân chấm, rê chuột xem tooltip.
function logLineHTML(line) {
  const names = Object.keys(META.chars || {});
  if (!names.length) return esc(line);
  if (!charNameRe || charNameRe.n !== names.length) {
    charNameRe = new RegExp(`(${names.sort((a, b) => b.length - a.length).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
    charNameRe.n = names.length;
  }
  return line.split(charNameRe).map((part, i) => (i % 2 ? `<span class="log-char" ${charTipAttrs(part)}>${esc(part)}</span>` : esc(part))).join('');
}
function charPortrait(name) {
  if (!name || !META.chars?.[name]) return '';
  const slug = charSlug(name);
  const crop = AVATAR_CROPS[slug];
  if (!crop) return `<img class="char-img" src="/avatars/${slug}.jpg" alt="" draggable="false">`;
  const [width, height, x, y, size] = crop;
  const percent = (pixels) => `${pixels * 100 / size}%`;
  const style = `width:${percent(width)};height:${percent(height)};left:${percent(-x)};top:${percent(-y)}`;
  return `<span class="avatar-crop"><img class="char-img" src="/avatars/${slug}.png" style="${style}" alt="" draggable="false"></span>`;
}

function playerAvatarHTML(player) {
  const img = charPortrait(player.char);
  const label = `${player.char || 'Cao bồi'}${player.alive ? '' : ' · Đã bị hạ'}`;
  // Chưa có nhân vật thì giữ biểu tượng cũ; người đã chết vẫn hiện chân dung (tô xám bằng CSS)
  return `<span class="character-avatar ${img ? 'has-img' : ''} ${player.alive ? '' : 'dead'}" role="img" aria-label="${esc(label)}">${img || (player.alive ? '🤠' : '💀')}</span>`;
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
      <div class="lbl" style="margin-top:12px">Bài trên tay</div>
      <div class="hand-views">${Object.entries(HAND_VIEWS).map(([k, label]) =>
        `<button type="button" class="hv" data-handview="${k}"><span class="tick"></span>${label}</button>`).join('')}</div>
      <div class="muted" style="margin-top:6px">Bật một hoặc cả hai. Xoè bài: rê chuột để lá trồi lên. Khung bài ở cột phải dễ xem rõ từng lá. Điện thoại luôn dùng dải bài.</div>
    </div></div>`;
}
function bindSettingsMenu() {
  const btn = $('#gearBtn'), pop = $('#settingsPop');
  if (!btn) return;
  btn.onclick = (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; btn.setAttribute('aria-expanded', String(!pop.hidden)); };
  pop.onclick = (e) => {
    e.stopPropagation();
    const b = e.target.closest('[data-eqsize]');
    if (b) applyEqSize(b.dataset.eqsize);
    const hv = e.target.closest('[data-handview]');
    if (hv) toggleHandView(hv.dataset.handview);
  };
  applyEqSize(currentEqSize());
  syncHandViewButtons();
}

// ---------- bài trên tay: xoè bài ở mép dưới (kiểu Hearthstone) và/hoặc khung bài ở cột phải ----------
// Lưu trên máy (bang.handViews), luôn bật ít nhất một kiểu; mặc định chỉ xoè bài. Điện thoại dọc luôn dùng dải bài cũ.
// #fanHand là bản sao các lá của #hand (gắn vào body); bấm lá ở quạt = bấm lá đó trong #hand nên dùng nguyên xử lý của bindGame.
const HAND_VIEWS = { fan: 'Xoè bài ở mép dưới', panel: 'Khung bài ở cột phải' };
function handViews() {
  let v = { fan: true, panel: false };
  try { v = { ...v, ...JSON.parse(localStorage.getItem('bang.handViews') || '{}') }; } catch {}
  if (!v.panel && !v.fan) v.fan = true;
  return v;
}
function toggleHandView(key) {
  const v = handViews(), other = key === 'panel' ? 'fan' : 'panel';
  if (v[key] && !v[other]) return; // không cho tắt kiểu cuối cùng
  v[key] = !v[key];
  try { localStorage.setItem('bang.handViews', JSON.stringify(v)); } catch {}
  applyHandViews();
}
function syncHandViewButtons() {
  const v = handViews();
  document.querySelectorAll('[data-handview]').forEach((b) => {
    const k = b.dataset.handview, last = v[k] && !v[k === 'panel' ? 'fan' : 'panel'];
    b.classList.toggle('on', v[k]);
    b.setAttribute('aria-pressed', String(v[k]));
    b.classList.toggle('locked', last);
    b.title = last ? 'Phải bật ít nhất một kiểu xem bài' : '';
  });
}
// Lá trên tay đang hiện trên màn hình (cho hiệu ứng bay): ưu tiên quạt bài
const shownHand = () => $('#fanHand') || $('#hand');
const shownHandCards = () => [...(shownHand()?.querySelectorAll('.card[data-card]') || [])];
const FAN = { hoverId: null, leave: 0 };
function applyHandViews() {
  const v = handViews(), hand = $('#hand');
  const fanOn = v.fan && !isPhone() && !!hand;
  document.body.classList.toggle('hand-panel-off', fanOn && !v.panel);
  document.body.classList.toggle('fan-on', fanOn);
  syncHandViewButtons();
  let fan = $('#fanHand');
  if (!fanOn) { fan?.remove(); return; }
  if (!fan) { fan = document.createElement('div'); fan.id = 'fanHand'; document.body.appendChild(fan); }
  fan.setAttribute('aria-hidden', String(v.panel)); // cả hai cùng bật thì trình đọc màn hình chỉ đọc khung bài
  fan.innerHTML = '';
  // Vẽ lại (mỗi bản tin SSE) thì đặt lá vào chỗ ngay, không cho lá bay từ giữa ra
  fan.classList.add('instant');
  requestAnimationFrame(() => requestAnimationFrame(() => fan.classList.remove('instant')));
  const cards = [...hand.querySelectorAll(':scope > .card')];
  if (!cards.length) { fan.innerHTML = '<span class="fan-empty">Không có bài trên tay</span>'; return; }
  for (const src of cards) {
    const el = src.cloneNode(true);
    const c = ROOM.game.me?.hand.find((x) => String(x.id) === src.dataset.card);
    // Lá phóng to ghi mô tả ngay trên mặt lá → bỏ tooltip để khỏi che
    if (c) el.insertAdjacentHTML('beforeend', `<div class="desc">${esc(cardInfo(c).desc)}</div>`);
    el.removeAttribute('data-tooltip'); el.removeAttribute('data-tooltip-title');
    if (v.panel) el.removeAttribute('tabindex');
    const slot = document.createElement('div');
    slot.className = 'fan-slot ' + ['playable', 'dim', 'selected'].filter((k) => src.classList.contains(k)).join(' ');
    slot.dataset.card = src.dataset.card;
    slot.appendChild(el);
    const forward = () => $(`#hand .card[data-card="${src.dataset.card}"]`)?.click();
    slot.onclick = forward;
    el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); forward(); } };
    fan.appendChild(slot);
  }
  fan.onmouseover = (e) => { const s = e.target.closest('.fan-slot'); if (s) fanHover(s.dataset.card); };
  fan.onmouseout = (e) => {
    if (e.relatedTarget && fan.contains(e.relatedTarget)) return;
    clearTimeout(FAN.leave);
    FAN.leave = setTimeout(() => fanHover(null), 70); // đi qua khe giữa hai lá không bị giật
  };
  fanLayout();
}
function fanHover(id) {
  clearTimeout(FAN.leave);
  if (id === FAN.hoverId) return;
  FAN.hoverId = id;
  fanLayout();
}
/* Lá i nằm trên một cung: khoảng cách co lại khi nhiều lá, góc nghiêng tăng ra hai mép, mép thấp xuống.
   Trỏ vào một lá: dựng thẳng + phóng to + đáy chạm mép màn hình; hai bên dạt ra (gần thì dạt nhiều). */
const FAN_ARC = 6; // độ nghiêng mỗi lá khi ít lá
function fanLayout() {
  const fan = $('#fanHand');
  if (!fan) return;
  const slots = [...fan.querySelectorAll('.fan-slot')];
  const n = slots.length, st = getComputedStyle(fan);
  const cw = parseFloat(st.getPropertyValue('--cw')), ch = parseFloat(st.getPropertyValue('--ch'));
  const zoom = parseFloat(st.getPropertyValue('--zoom')), sink = parseFloat(st.getPropertyValue('--sink'));
  const maxW = Math.min(window.innerWidth * .5, 820);
  const gap = n > 1 ? Math.min(cw * .78, (maxW - cw) / (n - 1)) : 0;
  const step = n > 1 ? Math.min(FAN_ARC, (FAN_ARC * 7) / (n - 1)) : 0;
  const mid = (n - 1) / 2;
  const hov = slots.findIndex((s) => s.dataset.card === FAN.hoverId);
  if (hov < 0) FAN.hoverId = null;
  slots.forEach((el, i) => {
    const d = i - mid;
    let x = d * gap;
    const y = ch * sink + Math.abs(d) ** 1.7 * (FAN_ARC * .55);
    if (hov >= 0 && i !== hov) x += Math.sign(i - hov) * Math.max(0, (cw * zoom - gap) * .55) / Math.abs(i - hov) ** .9;
    el.style.setProperty('--x', x + 'px');
    el.style.setProperty('--y', y + 'px');
    el.style.setProperty('--r', d * step + 'deg');
    el.style.setProperty('--lift', -(y + 6) + 'px');
    el.style.zIndex = i === hov ? 100 : i + 1;
    el.classList.toggle('hover', i === hov);
  });
}
window.addEventListener('resize', fanLayout);
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
  // Vai trò chưa lộ thì không hiện gì (không còn huy hiệu "?")
  return p.role ? `<span class="role ${p.role}" ${tooltipAttrs(ROLE_VI[p.role], META.roles[p.role].goal)}>${ROLE_VI[p.role]}</span>` : '';
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
const discardExcess = (g, p) => p.ghost ? 0 : g.me.hand.length - (g.me.handLimit ?? p.hp);
const docTarget = (p, g) => p.alive && p.name !== ME && p.distance <= g.me.range;
const targetedSkill = (skill) => ['Doc Holyday', 'Black Flower'].includes(skill);
const skillCardCount = (skill) => skill === 'Doc Holyday' ? 2 : 1;
const canFire = (g) => !g.bangsPlayed || g.me.unlimitedBang;
const bangConversion = (g, p) => abilityOf(p) === 'Annie Versary' ? 'Annie Versary' : g.me.lemat ? 'LeMat' : null;
const aimPayment = (c, aimId, g, p) => c.id !== aimId && (effectiveName(c, p) === 'Bang' || bangConversion(g, p));
const blueCard = (c) => ['blue', 'gun'].includes(cardInfo(c).type);
const hasCards = (p) => p.handCount > 0 || p.eq.length > 0;
const brawlTargets = (g) => g.players.filter((p) => p.alive && !p.ghost && p.name !== ME && hasCards(p));

function effectiveName(c, me) {
  if (abilityOf(me) === 'Calamity Janet' && c.name === 'Missed') return 'Bang';
  return c.name;
}

// Ai có thể bị chọn làm mục tiêu cho lá bài này?
function targetFilter(card, g, meP) {
  const name = effectiveName(card, meP);
  const others = (p) => p.alive && p.name !== ME;
  const info = cardInfo(card);
  switch (info.type === 'green' && !card.ready ? name : (info.effect || name)) {
    case 'Bang':
    case 'Aim':
    case 'Fanning': return (p) => docTarget(p, g);
    case 'attack': {
      const range = info.maxDistance === 'weapon' ? g.me.range : (info.maxDistance ?? Infinity);
      return (p) => others(p) && p.distance <= range;
    }
    case 'take':
    case 'discard': return (p) => others(p) && p.distance <= (info.maxDistance ?? Infinity) && hasCards(p);
    case 'healOther': return (p) => others(p) && !p.ghost && p.hp < p.maxHp;
    case 'Panic': return (p) => others(p) && p.distance <= 1 && (p.handCount > 0 || p.eq.length > 0);
    case 'Cat Balou': return (p) => others(p) && (p.handCount > 0 || p.eq.length > 0);
    case 'Duel': return others;
    case 'Jail': return (p) => others(p) && p.role !== 'Sheriff' && !p.eq.some((c) => c.name === 'Jail');
    case 'Ghost': return (p) => p.revivable;
    case 'Bounty': return (p) => others(p) && !p.eq.some((c) => c.name === name);
    case 'Rattlesnake': return (p) => p.alive && !p.eq.some((c) => c.name === name);
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
  const meP = g.players[g.me?.index] || {};
  const mine = g.pending.player === g.me?.index;
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
      <div class="por">${charPortrait(name) || '🤠'}</div><div class="nm">${esc(name)}</div>
      <div class="chp" title="${max} máu">${Array.from({ length: max }, () => bulletSVG(true, 22)).join('')}${meP.role === 'Sheriff' ? '<span class="plus">+1 Sheriff</span>' : ''}</div>
      <div class="ab">${esc(ch.desc)}</div></div>`;
  }).join('');
  // Bàn chơi thu nhỏ: cùng cách xếp ghế với trận đấu (desktop viên thuốc, điện thoại tròn).
  // Mỗi ghế: ảnh + tên nhân vật đã chọn (tooltip), vai trò đã biết (Sheriff công khai, vai trò của mình).
  const n = g.players.length;
  const start = Math.max(g.me?.index ?? 0, 0);
  const capsule = !isPhone();
  const picker = g.players[g.pending.player];
  const seats = Array.from({ length: n }, (_, k) => {
    const i = (start + k) % n;
    const p = g.players[i];
    const a = Math.PI / 2 + (k * 2 * Math.PI) / n;
    const [x, y] = capsule ? capsuleSeat(k, n) : [50 + 37 * Math.cos(a), 50 + 43 * Math.sin(a)];
    const picking = i === g.pending.player;
    return `<div class="player cseat ${i === g.me?.index ? 'mine' : ''} ${picking ? 'acting turn' : ''} ${p.char ? 'chosen' : ''}" data-player="${esc(p.name)}" style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%">
      <div class="av">${playerAvatarHTML(p)}${roleBadge(p)}</div>
      <div class="plate"><span class="dot ${ROOM.online.includes(p.name) ? 'on' : ''}"></span>${esc(p.name)}${i === g.me?.index ? ' (bạn)' : ''}</div>
      ${p.char ? `${hpBarHTML(p)}<span class="pchar" ${charTipAttrs(p.char)}>${esc(p.char)}</span>` : `<span class="cstat">${picking ? '✋ Đang chọn…' : 'Chờ lượt'}</span>`}
    </div>`;
  }).join('');
  const center = `<div class="choose-center">
    ${g.me ? `<div class="crole" ${tooltipAttrs(ROLE_VI[meP.role], role.goal)}>${ROLE_ICON[meP.role]} Bạn là <span class="role ${meP.role}">${esc(ROLE_VI[meP.role])}</span></div>
      <div class="cgoal">${esc(role.goal)} <span class="csecret">${meP.role === 'Sheriff' ? '👁️ Mọi người đều biết' : '🔒 Chỉ bạn thấy'}</span></div>` : '<div class="crole">👁️ Bạn đang xem trận đấu</div>'}
    <div class="cwait">${mine ? '👉 Tới lượt bạn chọn nhân vật' : `⏳ ${esc(picker.name)} đang chọn…`} <span class="ccount">(${done}/${n} đã chọn)</span></div>
    <div class="cprogress"><i style="width:${done / n * 100}%"></i></div>
  </div>`;
  $('#mainArea').innerHTML = `<div class="panel choose">
    <div class="choose-head"><h2>Chọn nhân vật</h2><span class="muted">${mine ? `Bạn được chia ${options.length} lá — bấm vào 1 lá rồi xác nhận.` : 'Sheriff chọn trước, rồi lần lượt theo chiều lượt chơi.'}</span>
      <div class="room-clock" data-room-clock role="timer"></div></div>
    <div class="arena choose-table${capsule ? ' capsule' : ''}"><div class="felt"></div>${center}${seats}</div>
    ${options.length ? `<div class="chars ${selected ? 'has-sel' : ''} ${mine ? '' : 'locked'}">${cards}</div>` : ''}
    <div class="actions" style="justify-content:center">${mine ? `<button class="btn" id="confirmCharacter" ${selected ? '' : 'disabled'}>✔ Chọn ${esc(selected || 'nhân vật')}</button>` : meP.char ? `<span class="muted">✔ Bạn chơi <b>${esc(meP.char)}</b>. Đang chờ những người khác…</span>` : `<span class="muted">${g.me ? 'Chờ tới lượt của bạn.' : 'Đang chờ người chơi chọn nhân vật.'}</span>`}
      ${mine && ROOM.characterSeconds ? '<span class="muted">Hết giờ sẽ tự chọn ngẫu nhiên.</span>' : ''}</div>
    <p class="muted" style="text-align:center">Ván đấu và timer lượt bắt đầu khi mọi người đã chọn xong.</p>
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
  $('#logBox').innerHTML = g.log.map((l) => `<div>${logLineHTML(l)}</div>`).join('');
  renderTurnRing();
  updateClock();
}

function renderGame() {
  const g = ROOM.game;
  if (g.phase === 'character') { $('#fanHand')?.remove(); return renderCharacterSelection(); }
  ui.choosePick = null;
  const meIdx = g.me?.index ?? -1;
  const meP = g.players[meIdx];
  const pend = g.pending;
  const myTurn = g.turn === meIdx && !g.winner;
  const myPrompt = pend && pend.player === meIdx;
  const canPlay = myTurn && !pend && g.phase === 'play' && meP.alive;
  const patDraw = myPrompt && pend.type === 'draw' && pend.options.includes('equipment');
  const evelynDraw = myPrompt && pend.type === 'draw' && pend.remaining !== undefined;
  const cardChoice = myPrompt && ['kit', 'valleyDiscard'].includes(pend.type) ? pend.type : null;

  if (!g.me) { ui.mode = null; ui.selected = []; }
  // validate mode
  if (['target', 'cost', 'brawl', 'aim', 'asBang', 'fanning'].includes(ui.mode?.kind) && !canPlay) ui.mode = null;
  if (ui.mode?.costCardId && !g.me.hand.some((c) => c.id === ui.mode.costCardId)) ui.mode = null;
  if (['cost', 'brawl', 'aim', 'fanning'].includes(ui.mode?.kind) && !g.me.hand.some((c) => c.id === ui.mode.cardId)) ui.mode = null;
  if (ui.mode && ui.mode.kind !== 'target') {
    const hand = g.me.hand.map((c) => c.id);
    if (ui.mode.kind === 'discard' && (!canPlay || discardExcess(g, meP) <= 0)) ui.mode = null;
    if (ui.mode?.kind === 'sid' && (!meP.alive || meP.ghost || meP.hp >= meP.maxHp || abilityOf(meP) !== 'Sid Ketchum')) ui.mode = null;
    if (ui.mode?.kind === 'skill' && (!canPlay || g.me.activeSkill !== ui.mode.skill)) ui.mode = null;
    if (ui.mode && ui.mode.kind !== 'kit') ui.selected = ui.selected.filter((id) => hand.includes(id));
    if (['kit', 'valleyDiscard'].includes(ui.mode?.kind) && ui.mode.kind !== cardChoice) ui.mode = null;
  }
  if (cardChoice && ui.mode?.kind !== cardChoice && ui.mode?.kind !== 'sid') {
    ui.mode = { kind: cardChoice };
    ui.selected = [];
  }
  if (!ui.mode) ui.selected = [];

  let tfilter = null;
  if (ui.mode?.kind === 'target') {
    const card = targetingCard(g, meP);
    tfilter = ui.mode.asBang ? (p) => docTarget(p, g) : card ? targetFilter(card, g, meP) : null;
    if (!tfilter || !g.players.some(tfilter)) { ui.mode = null; tfilter = null; }
  }
  if (myPrompt && pend.type === 'draw' && pend.options.includes('player')) {
    tfilter = (p) => p.alive && p.name !== ME && p.handCount > 0;
  }
  if (evelynDraw && pend.options.includes('evelyn')) tfilter = (p) => docTarget(p, g);
  if (ui.mode?.kind === 'skill' && targetedSkill(ui.mode.skill) && ui.selected.length === skillCardCount(ui.mode.skill)) {
    tfilter = (p) => docTarget(p, g);
  }

  // Desktop: bàn viên thuốc nằm ngang, mình ở mép dưới (capsuleSeat). Điện thoại dọc (mobile.css): vẫn bàn tròn,
  // mình ở đáy bàn, người sau mình ngồi bên trái, cứ thế theo chiều kim đồng hồ; ghế lùi vào để không tràn mép.
  const n = g.players.length;
  const start = Math.max(meIdx, 0);
  const capsule = !isPhone();
  const rx = 37, ry = 43;

  const seatsHTML = Array.from({ length: n }, (_, k) => {
    const i = (start + k) % n;
    const p = g.players[i];
    const a = Math.PI / 2 + (k * 2 * Math.PI) / n;
    const [x, y] = capsule ? capsuleSeat(k, n) : [50 + rx * Math.cos(a), 50 + ry * Math.sin(a)];
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
    const shootControl = evelynDraw && tfilter?.(p) ? ` role="button" tabindex="0" aria-label="Bắn ${esc(p.name)}"` : '';
    return `<div class="player ${cls}" data-player="${esc(p.name)}" style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%"${shootControl}>
      ${frame}${dist}
      <div class="av">${playerAvatarHTML(p)}${jailBarsHTML(p)}
        ${handFanHTML(p.handCount)}${roleBadge(p)}</div>
      <div class="plate"><span class="dot ${ROOM.online.includes(p.name) ? 'on' : ''}"></span>${g.turn === i && !g.winner ? '⭐ ' : ''}${esc(p.name)}${isMe ? ' (bạn)' : ''}</div>
      ${hpBarHTML(p)}
      <span class="pchar" ${charTipAttrs(p.char)}>${esc(p.char)}${p.char === 'Vera Custer' && p.ability ? ` · ${esc(p.ability)}` : ''}</span>
    </div>`;
  }).join('');

  const promptBoxHTML = `<div class="prompt ${myPrompt || (canPlay && !ui.mode) ? 'mine' : ''}" id="prompt">${!g.me ? '<h4>👁️ Bạn đang xem trận đấu</h4><p class="muted">Bạn chỉ xem thông tin công khai.</p>' : ''}${promptHTML(g, meIdx, meP)}</div>`;
  const tableHTML = `
    <div class="arena${capsule ? ' capsule' : ''}">
      <div class="felt"></div>
      <div class="piles">
        <div class="pile"><div class="deck ${['check', 'draw'].includes(pend?.type) ? (myPrompt ? 'ready' : 'waiting') : ''}" id="deck"${evelynDraw ? ' role="button" tabindex="0" aria-label="Rút 1 lá"' : ''}><div class="card-back">BANG!</div>
          ${['check', 'draw'].includes(pend?.type) && !myPrompt ? `<div class="tap other">⏳ ${esc(g.players[pend.player].name)} đang rút…</div>` : ''}</div>
          Chồng: ${g.deckCount}</div>
        <div class="pile ${myPrompt && pend?.type === 'draw' && pend.options.includes('discard') ? 'draw-source' : ''}" id="discardPile">${discardStackHTML(g)}<div>Bài bỏ</div></div>
      </div>
      ${seatsHTML}
      ${drawStageHTML(g)}
    </div>`;

  let meHTML = '';
  if (meP) {
    const ch = META.chars[meP.char];
    const role = META.roles[meP.role];
    const playableIds = new Set(g.me.hand.filter((c) => isClickable(c, g, meP)).map((c) => c.id));
    meHTML = `
      <div class="me ${myTurn ? 'turn' : ''} ${!meP.alive ? 'dead' : ''} ${ui.meInfo ? 'info-open' : ''}">
        <button type="button" class="me-info-toggle" id="meInfoToggle" aria-expanded="${!!ui.meInfo}">${ui.meInfo ? '▾ Ẩn' : '▸ Xem'} vai trò, nhân vật, trang bị</button>
        <div class="me-head">
          <div class="idcard" ${tooltipAttrs(ROLE_VI[meP.role], role.goal)}><span class="role ${meP.role}" style="margin:0">${ROLE_VI[meP.role]}</span> <b>Vai trò của bạn (bí mật)</b>
            <div style="margin-top:4px">${esc(role.goal)}</div></div>
          <div class="idcard" ${tooltipAttrs(meP.char, ch.desc)}><b>${esc(meP.char)}</b> — ${esc(ch.desc)}${meP.char === 'Vera Custer' && meP.ability ? `<div>Kỹ năng hiện tại: <b>${esc(meP.ability)}</b> — ${esc(META.chars[meP.ability].desc)}</div>` : ''}</div>
          <div class="idcard"><div class="mehp">${hpBarHTML(meP, 26)}</div>
            <div class="muted">Tầm bắn: ${g.me.range}${g.me.unlimitedBang ? ' · Bang! không giới hạn' : ''}${meP.jailed ? ' · ⛓️ Đang bị giam' : ''}</div></div>
          <div class="idcard myeq"><b>Trang bị</b>
            <div class="eqs">${meP.eq.length ? meP.eq.map((c) => eqTileHTML(c)).join('') : '<span class="muted">Chưa có trang bị</span>'}</div></div>
        </div>
        <div class="hand" id="hand">${groupSameCards(g.me.hand.filter((c) => !(pend?.type === 'blackJack' && pend.player === meIdx && pend.card.id === c.id))).map((c) => {
          const sel = ui.selected.includes(c.id) || ui.mode?.cardId === c.id || ui.mode?.costCardId === c.id;
          const pressed = ui.mode?.kind === 'valleyDiscard' && pend.count > 0 ? sel : null;
          return cardHTML(c, (sel ? 'selected ' : '') + (playableIds.has(c.id) ? 'playable' : (canPlay || myPrompt ? 'dim' : '')), pressed);
        }).join('') || '<span class="muted">Không có bài trên tay.</span>'}</div>
        <div class="actions" id="actions">${actionsHTML(g, meP, canPlay)}</div>
      </div>`;
  }

  // Bàn ở giữa; ô thông báo + bài của mình ở cột bên phải
  $('#mainArea').innerHTML = `<div class="board playing">${g.winner ? winnerHTML(g) : ''}
    <div class="table-col">${tableHTML}</div><div class="right-col"><div class="room-clock" data-room-clock role="timer"></div>${promptBoxHTML}${meHTML}</div></div>`;

  // log
  const lb = $('#logBox');
  lb.innerHTML = g.log.map((l) => `<div class="${l.startsWith('—') ? 'turnline' : ''}">${logLineHTML(l)}</div>`).join('');
  lb.scrollTop = lb.scrollHeight;

  bindGame(g, meIdx, meP, canPlay, myPrompt);
  applyHandViews();
  watchDock();
  renderAttackLine(g);
  animateDrawStage(g);
  renderMassPopup(g);
  renderStorePopup(g);
  renderTurnRing();
  showCheckReveal(g);
  updateClock();
}

function combatAvatarCenter(game, index) {
  const name = game.players[index]?.name;
  if (!name) return null;
  const rect = $(`.arena .player[data-player="${CSS.escape(name)}"] .av`)?.getBoundingClientRect();
  if (!rect?.width) return null;
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, radius: rect.width / 2 };
}

function renderAttackLine(game) {
  const pending = game.pending;
  if (!pending?.directAttack) return;
  const arena = $('.arena');
  if (!arena) return;
  const line = document.createElement('div');
  line.className = 'combat-line';
  line.setAttribute('aria-hidden', 'true');
  arena.appendChild(line);

  const position = () => {
    if (!arena.isConnected) { observer.disconnect(); return; }
    const from = combatAvatarCenter(game, pending.source), to = combatAvatarCenter(game, pending.player);
    if (!from || !to) return;
    const bounds = arena.getBoundingClientRect();
    const dx = to.x - from.x, dy = to.y - from.y;
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    Object.assign(line.style, {
      left: `${from.x - bounds.left}px`,
      top: `${from.y - bounds.top}px`,
      width: `${Math.max(0, Math.hypot(dx, dy) - from.radius - to.radius)}px`,
      transform: `translateY(-50%) rotate(${angle}deg) translateX(${from.radius}px)`,
    });
  };
  const observer = new ResizeObserver(position);
  position();
  observer.observe(arena);
}

// ---------- bàn viên thuốc nằm ngang (desktop) ----------
// Trả [x, y] theo % khu bàn cho ghế thứ k (k = 0 là mình). Hai đầu bàn mỗi đầu 1 người; còn lại chia hai
// mép dài, mép trên nhiều hơn khi lẻ (5 người: 2 trên · 1 dưới; 7: 3 · 2). Mình luôn ngồi mép dưới:
// chính giữa, hoặc ghế bên phải khi mép dưới có số ghế chẵn (2 ghế → ghế phải).
// Ghế theo chiều kim đồng hồ: đầu trái → mép trên trái → phải → đầu phải → mép dưới phải → trái;
// người sau mình là ghế kế tiếp theo chiều đó (bên trái mình).
// CAPSULE_EDGE khớp với top/bottom của .arena.capsule .felt trong style.css.
const CAPSULE_EDGE = 18.5;
function capsuleSeat(k, n) {
  const rest = n - 2, top = Math.ceil(rest / 2), bottom = rest - top;
  const xAt = (j, m) => (m === 1 ? 50 : 27 + (46 * j) / (m - 1));
  const ring = [[7, 50]];
  for (let j = 0; j < top; j++) ring.push([xAt(j, top), CAPSULE_EDGE]);
  ring.push([93, 50]);
  for (let j = bottom - 1; j >= 0; j--) ring.push([xAt(j, bottom), 100 - CAPSULE_EDGE]);
  const me = top + 2 + (bottom - 1 - Math.floor(bottom / 2)); // ghế mép dưới thứ floor(bottom/2) tính từ trái
  return ring[(me + k) % n];
}

// ---------- điện thoại dọc ----------
// mobile.css ghim cột phải (đồng hồ, thông báo, bài trên tay) ở đáy màn hình;
// bàn tròn lấy phần chiều cao còn lại nên cần biết thanh đáy cao bao nhiêu (--dock-h).
const PHONE_MQ = window.matchMedia('(max-width: 600px)');
const isPhone = () => PHONE_MQ.matches;
PHONE_MQ.addEventListener('change', () => { if (ROOM?.game) applyHandViews(); }); // qua mốc điện thoại: bật/tắt xoè bài
let dockObserver = null;
function watchDock() {
  const dock = $('.right-col'), board = $('.board.playing');
  dockObserver?.disconnect();
  if (!dock || !board || !isPhone()) return;
  const measureDock = () => board.style.setProperty('--dock-h', `${Math.ceil(dock.getBoundingClientRect().height)}px`);
  measureDock();
  dockObserver = new ResizeObserver(measureDock);
  dockObserver.observe(dock);
}
PHONE_MQ.addEventListener('change', () => { if (ROOM?.game) renderGame(); });

// ---------- pop-up đánh chung ----------
// Hiện giữa bàn: lá đã đánh ➜ mỗi người bị nhắm một cột (tên + cách phản hồi). Xong hết thì thu gọn rồi tự ẩn.
const MASS_MINI_MS = 2500, MASS_HIDE_MS = 5000;
const massClock = () => Date.now() + (ui.serverOffset || 0);
const massDone = (g, m, now = massClock()) => !(m.revealAt > now) &&
  !(m.card.name === 'Poker' && g.pending?.type === 'poker') &&
  m.targets.every((t) => t.res || !g.players[t.i].alive);
function massResHTML(r, dead, flip, picks, pokerChoices) {
  const f = flip ? ' flip' : '';
  if (r?.card) return cardHTML(r.card, 'mp-res ok' + f);
  if (r?.faceDown) return '<div class="card-back mp-facedown">Đã chọn</div>';
  if (r?.discarded) {
    return `<div class="mp-res mp-batch${f}">
      ${r.discarded.map((c) => {
        const picked = picks?.includes(c.id);
        const selected = pokerChoices?.get(c.id) ?? null;
        const cls = selected === null ? 'mp-discard' : 'mp-discard mp-poker-card';
        return `<div class="mp-discard-row">${cardHTML(c, cls, selected)}${picked ? '<span class="mp-picked">Đã lấy</span>' : ''}</div>`;
      }).join('') || '<span>Không bỏ lá</span>'}
      ${r.drawn != null ? `<span class="mp-drawn">Rút ${r.drawn} lá</span>` : ''}
    </div>`;
  }
  if (r?.immune) return '<div class="mp-res">Miễn nhiễm</div>';
  if (r?.skipped) return '<div class="mp-res">Bỏ qua</div>';
  if (r?.saved) return `<div class="mp-res ok${f}"><div class="ic">🛟</div>Saved!</div>`;
  if (r?.ghost) return `<div class="mp-res ok${f}"><div class="ic">👻</div>Ghost</div>`;
  if (r?.barrel) return `<div class="mp-res barrel ok${f}"><div class="ic">🛢️</div>Barrel<br>né được</div>`;
  if (r?.dead || dead) return `<div class="mp-res dead${f}"><div class="ic">💀</div>Bị hạ</div>`;
  if (r?.hurt) return `<div class="mp-res hurt${f}"><div class="big">−${r.hurt}</div>máu</div>`;
  return '<div class="mp-res wait">chờ…</div>';
}
function massSum(r, dead) {
  if (r?.faceDown) return 'Đã chọn';
  if (r?.discarded) {
    const n = r.discarded.length;
    return r.drawn != null ? `−${n}/+${r.drawn} lá` : `Bỏ ${n} lá`;
  }
  if (r?.immune) return 'Miễn nhiễm';
  if (r?.skipped) return 'Bỏ qua';
  return r?.card ? cardInfo(r.card).icon : r?.saved ? '🛟' : r?.ghost ? '👻' : r?.barrel ? '🛢️' : r?.dead || dead ? '💀' : r?.hurt ? `−${r.hurt}❤` : '…';
}

function renderMassPopup(g) {
  $('.mass-pop:not(.store-pop):not(.out)')?.remove();
  const m = g.mass, arena = $('.arena');
  if (!m || !arena || g.winner || centerPopupKind(g) !== 'mass') return;
  const now = massClock();
  const done = massDone(g, m, now);
  const poker = m.card.name === 'Poker' && g.pending?.type === 'poker';
  const myPick = poker && g.pending.player === g.me?.index;
  let st = ui.mass;
  if (st?.key !== `${m.seq}:${m.t0}`) {
    // Vào phòng khi lá đánh chung đã xong từ trước thì không hiện lại
    clearTimeout(st?.timer);
    clearTimeout(st?.revealTimer);
    const age = now - (m.revealAt ?? m.t);
    st = ui.mass = { key: `${m.seq}:${m.t0}`, seen: new Set(), mini: false, hidden: done && age > MASS_MINI_MS, enter: true };
  }
  if (myPick) {
    st.hidden = false;
    st.mini = false;
    if (st.timer === 'manual') st.timer = null;
  }
  if (st.hidden) return;
  clearTimeout(st.revealTimer);
  const nextReveal = m.targets.find((t) => t.revealAt > now)?.revealAt;
  if (nextReveal) {
    st.revealTimer = setTimeout(() => {
      if (ui.mass === st && ROOM?.game) renderMassPopup(ROOM.game);
    }, nextReveal - now);
  }
  if (done && !st.timer) {
    st.timer = setTimeout(() => {
      st.mini = true;
      if (ui.mass === st && ROOM?.game) renderMassPopup(ROOM.game);
      st.timer = setTimeout(() => hideMassPopup(st), MASS_HIDE_MS);
    }, MASS_MINI_MS);
  }
  const by = g.players[m.by];
  const active = m.targets.find((t) => t.i === g.pending?.player && !t.res && g.players[t.i].alive);
  const result = (t) => t.revealAt > now ? null : t.res;
  const fresh = m.targets.filter((t) => (result(t) || (!t.res && !g.players[t.i].alive)) && !t.res?.faceDown && !st.seen.has(t.i));
  const group = ['Poker', 'Tornado', 'Bandidos', 'Brawl'].includes(m.card.name);
  const selected = myPick ? (st.pokerSelection ??= new Set()) : null;
  const choices = myPick ? new Map(g.pending.cards.map(({ id }) => [id, selected.has(id)])) : null;
  const limit = myPick ? Math.min(2, choices.size) : 0;
  let footer = '';
  if (m.card.name === 'Poker') {
    if (m.ace == null) footer = 'Các lá sẽ lật cùng lúc';
    else if (m.ace) footer = 'Có lá Át · Poker kết thúc';
    else if (myPick) footer = `<div class="mp-poker-actions"><span>Đã chọn ${selected.size}/${limit} lá</span>
      <button type="button" class="btn small" data-poker-confirm>${selected.size ? 'Lấy bài' : 'Bỏ qua'}</button></div>`;
    else if (poker) footer = `${esc(by.name)} đang chọn tối đa 2 lá`;
  }
  const targets = `<div class="mp-targets">${m.targets.map((t) => {
    const p = g.players[t.i], dead = !p.alive && !t.res, mine = t.i === g.me?.index;
    const res = result(t);
    return `<div class="mp-col${mine ? ' mine' : ''}${t === active ? ' active' : ''}">
      <div class="mp-name" title="${esc(p.name)}" data-sum="${massSum(res, dead)}">${mine ? 'Bạn' : esc(p.name)}</div>
      <div class="mp-slot">${massResHTML(res, dead, fresh.includes(t) && !st.enter, m.picks, choices)}</div></div>`;
  }).join('')}</div>`;
  // Lúc có người đang rút kiểm tra (Barrel) thì thu gọn để lộ chồng bài
  const mini = st.mini || g.pending?.type === 'check';
  const el = document.createElement('div');
  el.className = `mass-pop${group ? ' group-pop' : ''}${myPick ? ' poker-picking' : ''}${mini ? ' mini' : ''}${st.enter ? ' enter' : ''}`;
  el.setAttribute('role', myPick ? 'group' : 'status');
  if (myPick) el.setAttribute('aria-label', 'Chọn bài Poker');
  else el.title = mini ? 'Bấm để mở rộng' : 'Bấm để thu gọn';
  el.innerHTML = `
    <div class="mp-src"><div class="who"><span class="mini-ic">${cardInfo(m.card).icon} </span>${esc(by.name)}</div>${cardHTML(m.card)}</div>
    <div class="mp-arrow">➜</div>
    ${group ? `<div class="mp-group-content">${targets}${footer ? `<div class="mp-group-footer">${footer}</div>` : ''}</div>` : targets}
    ${myPick ? '' : '<button type="button" class="mp-close" title="Đóng" aria-label="Đóng">✕</button>'}`;
  el.onclick = (e) => {
    if (myPick) {
      if (st.submitting) return;
      const pick = e.target.closest('.mp-poker-card');
      if (pick) {
        const id = Number(pick.dataset.card);
        if (!selected.delete(id)) {
          if (selected.size >= limit) return toast(`Chọn tối đa ${limit} lá.`);
          selected.add(id);
        }
        renderMassPopup(ROOM.game);
        arena.querySelector(`.mp-poker-card[data-card="${id}"]`)?.focus({ preventScroll: true });
      } else if (e.target.closest('[data-poker-confirm]')) {
        return run(async () => {
          st.submitting = true;
          try { await sendAction({ type: 'poker', cardIds: [...selected] }); }
          finally { st.submitting = false; }
        })();
      }
      return;
    }
    if (e.target.closest('.mp-close')) return hideMassPopup(st);
    clearTimeout(st.timer); st.timer = 'manual'; // đã bấm thì giữ nguyên cho tới khi tự đóng
    st.mini = !mini;
    renderMassPopup(ROOM.game);
  };
  if (myPick) el.onkeydown = (e) => {
    const pick = e.target.closest('.mp-poker-card');
    if (!pick || !['Enter', ' '].includes(e.key)) return;
    e.preventDefault();
    pick.click();
  };
  arena.appendChild(el);
  if (!st.enter) {
    for (const t of fresh) {
      if (t.res?.hurt || t.res?.dead) $(`.player[data-player="${CSS.escape(g.players[t.i].name)}"]`)?.classList.add('mp-hit');
    }
  }
  for (const t of fresh) st.seen.add(t.i);
  st.enter = false;
}
function hideMassPopup(st) {
  clearTimeout(st.timer);
  clearTimeout(st.revealTimer);
  st.hidden = true;
  const el = $('.mass-pop:not(.store-pop)');
  if (!el || ui.mass !== st) return;
  el.classList.add('out');
  el.addEventListener('animationend', () => el.remove(), { once: true });
  setTimeout(() => el.remove(), 600); // phòng khi tắt hiệu ứng
}

// Các pop-up dùng chung chỗ giữa bàn: chỉ hiện cái đang diễn ra / mới nhất
function centerPopupKind(g) {
  if (g.pending?.type === 'store') return 'store';
  if (g.mass && !massDone(g, g.mass)) return 'mass';
  return (g.store?.t || 0) > (g.mass?.t || 0) ? 'store' : 'mass';
}

// ---------- pop-up General Store ----------
// Mỗi người một cột theo thứ tự chọn (tên + lá đã lấy); hàng dưới là lá còn trên quầy, tới lượt mình thì bấm để lấy.
function renderStorePopup(g) {
  $('.store-pop:not(.out)')?.remove();
  const s = g.store, arena = $('.arena');
  if (!s || !arena || g.winner || centerPopupKind(g) !== 'store') return;
  const picking = g.pending?.type === 'store' ? g.pending.player : null;
  const myTurn = picking != null && picking === g.me?.index;
  let st = ui.store;
  if (st?.key !== `${s.seq}:${s.t0}`) {
    const age = Date.now() + (ui.serverOffset || 0) - s.t;
    clearTimeout(st?.timer);
    st = ui.store = { key: `${s.seq}:${s.t0}`, seen: new Set(), mini: false, hidden: picking == null && age > MASS_MINI_MS, enter: true };
  }
  if (myTurn) { st.hidden = false; st.mini = false; } // tới lượt mình thì luôn mở để chọn được
  if (st.hidden) return;
  if (picking == null && !st.timer) {
    st.timer = setTimeout(() => {
      st.mini = true;
      if (ui.store === st && ROOM?.game) renderStorePopup(ROOM.game);
      st.timer = setTimeout(() => hideStorePopup(st), MASS_HIDE_MS);
    }, MASS_MINI_MS);
  }
  const pickOf = (id) => s.picks.find((x) => x.card.id === id);
  const pickBy = (i) => s.picks.find((x) => x.i === i);
  const remaining = picking == null ? [] : s.revealed.filter((c) => !pickOf(c.id));
  const fresh = s.picks.filter((x) => !st.seen.has(x.card.id));
  const mini = st.mini;
  const el = document.createElement('div');
  el.className = `mass-pop store-pop${mini ? ' mini' : ''}${st.enter ? ' enter' : ''}${myTurn ? ' my-turn' : ''}`;
  el.setAttribute('role', 'status');
  el.title = myTurn ? 'Tới lượt bạn: bấm 1 lá trên quầy' : mini ? 'Bấm để mở rộng' : 'Bấm để thu gọn';
  el.innerHTML = `
    <div class="mp-src"><div class="who"><span class="mini-ic">${cardInfo(s.card).icon} </span>${esc(g.players[s.by].name)}</div>${cardHTML(s.card)}</div>
    <div class="mp-arrow">➜</div>
    <div class="sp-right">
      <div class="mp-targets">${s.order.map((i) => {
        const p = g.players[i], pk = pickBy(i), now = i === picking, mine = i === g.me?.index;
        const gone = !pk && !now && !p.alive;
        const slot = pk ? cardHTML(pk.card, 'mp-res ok' + (fresh.includes(pk) && !st.enter ? ' flip' : ''))
          : gone ? '<div class="mp-res dead"><div class="ic">💀</div></div>'
          : `<div class="mp-res wait">${now ? 'đang<br>chọn…' : picking == null ? '—' : 'chờ…'}</div>`;
        return `<div class="mp-col${mine ? ' mine' : ''}${now ? ' active' : ''}">
          <div class="mp-name" title="${esc(p.name)}" data-sum="${pk ? cardInfo(pk.card).icon : now ? '…' : ''}">${mine ? 'Bạn' : esc(p.name)}</div>
          <div class="mp-slot">${slot}</div></div>`;
      }).join('')}</div>
      ${remaining.length ? `<div class="sp-left"><span>${myTurn ? '👉 Bấm 1 lá để lấy' : 'Còn trên quầy'}</span>${remaining.map((c) => cardHTML(c, 'sp-tiny' + (myTurn ? ' sp-pickable' : ''))).join('')}</div>` : ''}
    </div>
    ${myTurn ? '' : '<button type="button" class="mp-close" title="Đóng" aria-label="Đóng">✕</button>'}`;
  el.onclick = (e) => {
    if (e.target.closest('.mp-close')) return hideStorePopup(st);
    const pick = e.target.closest('.sp-pickable');
    if (pick) return run(() => sendAction({ type: 'pick', cardId: Number(pick.dataset.card) }))();
    if (myTurn) return;
    clearTimeout(st.timer); st.timer = 'manual';
    st.mini = !mini;
    renderStorePopup(ROOM.game);
  };
  arena.appendChild(el);
  for (const x of fresh) st.seen.add(x.card.id);
  st.enter = false;
}
function hideStorePopup(st) {
  clearTimeout(st.timer);
  st.hidden = true;
  const el = $('.store-pop');
  if (!el || ui.store !== st) return;
  el.classList.add('out');
  el.addEventListener('animationend', () => el.remove(), { once: true });
  setTimeout(() => el.remove(), 600);
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
function captureTransferOrigins(g) {
  const origins = {};
  for (const [index, player] of (g?.players || []).entries()) {
    const seat = [...document.querySelectorAll('.player[data-player]')].find((el) => el.dataset.player === player.name);
    const hand = index === g.me?.index ? shownHand() : seat?.querySelector('.hand-fan');
    origins[`${index}:hand`] = (hand || seat)?.getBoundingClientRect();
    for (const el of seat?.querySelectorAll('[data-eq]') || []) {
      const rect = el.getBoundingClientRect();
      if (rect.width && rect.height) origins[`${index}:eq:${el.dataset.eq}`] = rect;
    }
    if (index === g.me?.index) {
      for (const el of shownHandCards()) {
        origins[`${index}:hand:${el.dataset.card}`] = el.getBoundingClientRect();
      }
    }
  }
  return origins;
}

function showCardTransfers(g, previous, drawOrigins = [], transferOrigins = {}) {
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
      const target = event.to === 'discard' ? $('#discardPile .ds-slot:last-child .card') || $('#discardPile')
        : event.to === 'deck' ? $('#deck .card-back') : event.to === g.me?.index ? (card && shownHand()?.querySelector(`.card[data-card="${card.id}"]`)) || shownHand() : seatHand(event.to);
      const origin = ['kit', 'reveal'].includes(event.from) ? drawOrigins[event.slots?.[index] ?? 0]
        : event.sourceZone ? transferOrigins[`${event.from}:${event.sourceZone}:${card?.id}`] || transferOrigins[`${event.from}:hand`] : null;
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
      ], { duration: 650, delay: (event.sourceZone ? 220 : event.from === 'deck' && previous.pending?.type === 'blackJack' ? 650 : 0) + order++ * 130, easing: 'ease-in-out', fill: 'both' });
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
  Rattlesnake: { icon: '🐍', need: 'Mất 1 máu nếu ra <b>♠ Bích</b>', win: ['AN TOÀN', 'Rattlesnake vẫn ở trên bàn'], lose: ['RẮN CẮN', 'Rattlesnake vẫn ở trên bàn'] },
  'Colorado Bill': { icon: '🎯', need: 'Không thể né nếu ra <b>♠ Bích</b>', win: ['KHÔNG THỂ NÉ', 'Phát bắn trúng đích'], lose: ['CÓ THỂ NÉ', 'Mục tiêu phản ứng như thường'] },
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
  if (ui.mode?.kind === 'skill') {
    const { skill } = ui.mode;
    if (skill === 'Black Flower') return c.suit === 'C';
    if (skill === 'Der Spot-Burst Ringer') return c.name === 'Bang';
    return skill === 'Doc Holyday' || blueCard(c);
  }
  if (pend && pend.player === g.me.index) {
    const n = c.name;
    if (pend.type === 'valleyDiscard') return pend.count > 0;
    if (pend.type === 'bang') return pend.responseCardIds?.includes(c.id) ?? (n === 'Missed' || (n === 'Bang' && abilityOf(meP) === 'Calamity Janet'));
    if (pend.type === 'indians' || pend.type === 'duel') return pend.responseCardIds?.includes(c.id) ?? (effectiveName(c, meP) === 'Bang');
    return false;
  }
  if (g.turn !== g.me.index || pend || g.phase !== 'play') return false;
  const name = effectiveName(c, meP);
  const info = cardInfo(c);
  if (ui.mode?.kind === 'cost') return c.id !== ui.mode.cardId;
  if (ui.mode?.kind === 'aim') return aimPayment(c, ui.mode.cardId, g, meP);
  if (ui.mode?.kind === 'asBang') return true;
  if (['brawl', 'fanning'].includes(ui.mode?.kind)) return false;
  if (name === 'Missed') return false;
  if (['Saved!', 'Escape'].includes(name)) return false;
  if (info.type === 'brown' && info.defense) return false;
  if (info.discardCost && g.me.hand.length < 2) return false;
  if (info.type === 'brown' && info.effect === 'heal' && (meP.ghost || meP.hp >= meP.maxHp)) return false;
  if (['Bang', 'Aim', 'Fanning'].includes(name) && !canFire(g)) return false;
  if (name === 'Aim' && !g.me.hand.some((t) => aimPayment(t, c.id, g, meP))) return false;
  if (name === 'Beer' && (meP.ghost || meP.hp >= meP.maxHp || g.players.filter((p) => p.alive).length <= 2)) return false;
  if ((info.type === 'green' || (info.type === 'blue' && !['Jail', 'Bounty', 'Rattlesnake'].includes(name))) && meP.eq.some((e) => e.name === c.name)) return false;
  const tf = targetFilter(c, g, meP);
  if (tf && !g.players.some(tf)) return false;
  return true;
}

function promptHTML(g, meIdx, meP) {
  const pend = g.pending;
  const P = (i) => `<b>${esc(g.players[i].name)}</b>`;
  if (g.winner) return '<h4>Ván đấu đã kết thúc.</h4><div class="muted">Xem kết quả ở trên.</div>';
  if (ui.mode?.kind === 'cost') {
    const c = g.me.hand.find((card) => card.id === ui.mode.cardId);
    return `<h4>${esc(c.name)} · Chọn thêm 1 lá trên tay để bỏ</h4>
      <div class="row"><button class="btn secondary small" data-act="cancel">Huỷ</button></div>`;
  }
  if (['aim', 'asBang'].includes(ui.mode?.kind)) {
    return `<h4>${ui.mode.kind === 'aim' ? 'Aim · Chọn lá Bang! dùng kèm' : `${bangConversion(g, meP)} · Chọn lá trên tay để dùng như Bang!`}</h4>
      <button class="btn secondary small" data-act="cancel">Huỷ</button>`;
  }
  if (ui.mode?.kind === 'fanning') {
    const options = new Map(g.me.fanningTargets).get(ui.mode.target) || [];
    return `<h4>Fanning · Chọn mục tiêu thứ hai</h4><div class="row">
      ${options.map((name) => `<button class="btn small" data-act="secondTarget" data-owner="${esc(name)}">${esc(name)}</button>`).join('')}
      <button class="btn secondary small" data-act="cancel">Huỷ</button></div>`;
  }
  if (ui.mode?.kind === 'brawl') {
    return `<h4>Brawl · Chọn một lá để bỏ của từng người</h4>
      ${brawlTargets(g).map((p) => {
        const choices = p.eq.map((c) => [String(c.id), `${c.name} ${c.rank}${SUIT[c.suit]}`]);
        if (p.handCount) choices.unshift(['hand', 'Một lá ngẫu nhiên trên tay']);
        const picked = ui.mode.choices.get(p.name);
        return `<label>${esc(p.name)}<select data-brawl-target="${esc(p.name)}">${choices.map(([id, label]) => `<option value="${id}" ${id === picked ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></label>`;
      }).join('')}
      <div class="row"><button class="btn" data-act="confirmBrawl">Đánh Brawl</button><button class="btn secondary small" data-act="cancel">Huỷ</button></div>`;
  }
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
    const { skill } = ui.mode;
    const targeted = targetedSkill(skill);
    const ready = ui.selected.length === skillCardCount(skill);
    const instructions = { 'Doc Holyday': 'Chọn 2 lá để bỏ', 'Black Flower': 'Chọn 1 lá chất Chuồn',
      'Der Spot-Burst Ringer': 'Chọn 1 lá Bang!', 'José Delgado': 'Chọn 1 lá viền xanh dương để bỏ' };
    const step = targeted && ready ? 'Chọn người chơi đang sáng để bắn' : instructions[skill];
    return `<h4>${esc(ui.mode.skill)} · ${step}</h4><div class="row">
      ${!targeted && ready ? `<button class="btn" data-act="confirmSkill">${skill === 'José Delgado' ? 'Bỏ lá và rút 2 lá' : 'Dùng như Gatling'}</button>` : ''}
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
  const escapeButtons = () => g.me.hand.filter((c) => pend.escapeIds?.includes(c.id)).map((c) =>
    `<button class="btn blue small" data-act="escape" data-card-id="${c.id}">Né hiệu ứng bằng ${esc(c.name)}</button>`).join('');
  switch (pend.type) {
    case 'avoid':
      if (!mine) return '<h4>Đang chờ phản hồi…</h4>';
      return `<h4>${esc(pend.name)} · Hiệu ứng nhắm vào bạn</h4><div class="row">${escapeButtons()}
        <button class="btn secondary" data-act="take">Chấp nhận</button></div>`;
    case 'saved': {
      if (!mine) return '<h4>Đang chờ phản hồi…</h4>';
      const saved = g.me.hand.find((c) => c.name === 'Saved!');
      return `<h4>Saved! · Ngăn ${P(pend.target)} mất 1 máu</h4><div class="row">
        <button class="btn" data-act="saved" data-card-id="${saved?.id}" data-from="deck">Cứu và rút từ chồng bài</button>
        <button class="btn" data-act="saved" data-card-id="${saved?.id}" data-from="hand">Cứu và lấy bài trên tay</button>
        <button class="btn secondary" data-act="take">Bỏ qua</button></div>`;
    }
    case 'valleyDiscard':
      if (!mine) return `<h4>${P(pend.player)} đang xử lý ${esc(pend.name)}…</h4>`;
      return `<h4>${esc(pend.name)} · ${pend.count ? `Chọn ${pend.count} lá trên tay để bỏ` : 'Bạn đã hết bài'}</h4>
        ${pend.count ? `<div class="muted">Bấm trực tiếp vào bài trên tay. Đã chọn ${ui.selected.length}/${pend.count}.</div>` : ''}
        <div class="row">
        ${pend.count ? `<button class="btn" data-act="valleyDiscard" ${ui.selected.length === pend.count ? '' : 'disabled'}>Bỏ bài đã chọn</button>` : ''}
        ${pend.name === 'Bandidos' ? '<button class="btn secondary" data-act="take">Chịu đòn</button>' : ''}</div>`;
    case 'poker':
      if (!mine) return `<h4>${P(pend.player)} đang chọn bài từ Poker…</h4>`;
      return '<h4>Poker · Chọn bài giữa bàn</h4>';
    case 'lemonade':
      if (!mine) return `<h4>${P(pend.player)} có thể dùng kỹ năng Lemonade Jim…</h4>`;
      return `<h4>Lemonade Jim · Bỏ một lá để hồi 1 máu</h4><div class="row">
        ${g.me.hand.map((c) => `<button class="btn small" data-act="lemonade" data-card-id="${c.id}">${esc(c.name)} ${c.rank}${SUIT[c.suit]}</button>`).join('')}
        <button class="btn secondary" data-act="take">Bỏ qua</button></div>`;
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
        ${escapeButtons()}<button class="btn secondary" data-act="take">${meP.ghost ? 'Chịu đòn' : `Chịu mất ${pend.amount ?? 1} máu`}</button></div>`;
    }
    case 'indians':
      if (!mine) return `<h4>🪶 Thổ dân tấn công!</h4><div class="muted">Đang chờ ${P(pend.player)} bỏ Bang! hoặc chịu mất máu…</div>`;
      return `<h4>🪶 Thổ dân của ${P(pend.source)} tấn công!</h4><div>Bỏ 1 lá Bang! hoặc mất 1 máu.</div>
        <div class="row">${escapeButtons()}<button class="btn secondary" data-act="take">Chịu đòn</button></div>`;
    case 'duel':
      if (!mine) return `<h4>🤠 Đấu súng: ${P(pend.player)} vs ${P(pend.other)}</h4><div class="muted">Đang chờ ${P(pend.player)} bỏ Bang!…</div>`;
      return `<h4>🤠 Đấu súng với ${P(pend.other)}!</h4><div>Bỏ 1 lá Bang! để tiếp tục, hoặc chịu thua mất 1 máu.</div>
        <div class="row">${escapeButtons()}<button class="btn secondary" data-act="take">Chịu thua</button></div>`;
    case 'store':
      // Các lá nằm trên pop-up giữa bàn (renderStorePopup)
      return mine ? '<h4>🏪 General Store — tới lượt bạn!</h4><div>Bấm 1 lá trên <b>quầy giữa bàn</b> để lấy.</div>'
        : `<h4>🏪 General Store</h4><div class="muted">Đang chờ ${P(pend.player)} chọn…</div>`;
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
      const ability = abilityOf(meP);
      if (pend.remaining !== undefined) {
        const shoot = pend.options.includes('evelyn') ? 'Bấm người đang sáng để bắn hoặc bấm' : 'Bấm';
        return `<h4>Evelyn Shebang · Còn ${pend.remaining} lựa chọn</h4><p>${shoot} chồng bài để rút 1 lá.</p>
          <div class="row"><button class="btn secondary" data-act="draw" data-from="deck">${pend.remaining === 2 ? 'Draw 2 cards' : 'Draw 1 card'}</button></div>`;
      }
      if (ability === 'Pat Brennan') {
        const equipment = pend.options.includes('equipment')
          ? '<p>Hoặc bấm một lá viền xanh dương hay xanh lá đang sáng trên bàn, kể cả của bạn. Bạn sẽ chỉ lấy đúng 1 lá này.</p>' : '';
        return `<h4>Pat Brennan · Rút bài đầu lượt</h4>${equipment}
          <div class="row"><button class="btn" data-act="draw" data-from="deck">Rút 2 lá từ chồng bài</button></div>
          <p class="muted">Sau 20 giây, game tự rút 2 lá nếu bạn chưa chọn.</p>`;
      }
      const seconds = ['Jesse Jones', 'Pedro Ramirez'].includes(ability) ? 20 : 5;
      const source = pend.options.includes('player') ? ' Hoặc bấm trực tiếp người chơi có bài đang sáng để lấy 1 lá từ tay họ và rút thêm 1 lá.'
        : pend.options.includes('discard') ? ' Hoặc bấm trực tiếp chồng bài bỏ đang sáng để lấy lá trên cùng và rút thêm 1 lá.' : '';
      return `<h4>Rút bài đầu lượt</h4><p>Bấm chồng bài để rút.${source} Sau ${seconds} giây sẽ tự rút. Đồng hồ lượt bắt đầu khi rút xong.</p>`;
    }
  }
  return '';
}

function actionsHTML(g, meP, canPlay) {
  if (!meP.alive || g.winner) return '';
  const out = [];
  const save = g.pending?.savedReaction;
  if (save) {
    const name = esc(g.players[save.target].name);
    const card = g.me.hand.find((c) => c.name === 'Saved!');
    out.push(`<span class="muted">Saved! · Cứu ${name} ngay</span>
      <button class="btn blue small" data-act="saved" data-card-id="${card.id}" data-from="deck" data-owner="${name}">Cứu và rút từ chồng bài</button>
      <button class="btn blue small" data-act="saved" data-card-id="${card.id}" data-from="hand" data-owner="${name}">Cứu và lấy bài trên tay</button>`);
  }
  if (canPlay && !ui.mode) {
    for (const c of meP.eq) {
      if (!c.ready || !cardInfo(c).activate) continue;
      if (cardInfo(c).effect === 'heal' && (meP.ghost || meP.hp >= meP.maxHp)) continue;
      const filter = targetFilter(c, g, meP);
      if (filter && !g.players.some(filter)) continue;
      out.push(`<button class="btn green" data-act="activate" data-eqid="${c.id}">Dùng ${esc(c.name)}</button>`);
    }
    const conversion = bangConversion(g, meP);
    if (conversion && canFire(g) && g.me.hand.length && g.players.some((p) => docTarget(p, g))) {
      out.push(`<button class="btn blue" data-act="asBang">Dùng ${conversion}</button>`);
    }
    if (g.me.activeSkill && (!targetedSkill(g.me.activeSkill) || g.players.some((p) => docTarget(p, g)))) {
      const label = g.me.activeSkill === 'Chuck Wengam' ? 'Trả 1 máu để rút 2 lá' : `Dùng kỹ năng ${g.me.activeSkill}`;
      out.push(`<button class="btn blue" data-act="skill">${esc(label)}</button>`);
    }
    const excess = discardExcess(g, meP);
    if (excess > 0) out.push(`<button class="btn" data-act="discardMode">🗑️ Bỏ bớt ${excess} lá rồi kết thúc</button>`);
    else out.push('<button class="btn green" data-act="endTurn">✅ Kết thúc lượt</button>');
  }
  if (abilityOf(meP) === 'Sid Ketchum' && !meP.ghost && meP.hp < meP.maxHp && g.me.hand.length >= 2 && (!ui.mode || ui.mode.kind === 'valleyDiscard')) out.push('<button class="btn blue" data-act="sidMode">Dùng kỹ năng Sid (bỏ 2 lá, +1 máu)</button>');
  out.push(meP.ghost ? '<span class="muted">Cuối lượt Ghost tự bỏ bài trên tay và các trang bị khác.</span>'
    : `<span class="muted">Máu ${meP.hp}/${meP.maxHp} · ${g.me.hand.length} lá trên tay (tối đa giữ ${g.me.handLimit ?? meP.hp} lá khi hết lượt)</span>`);
  return out.join('');
}

function winnerHTML(g) {
  const names = { Sheriff: 'Phe Sheriff', Outlaw: 'Phe Outlaw', Renegade: 'Renegade' };
  const winners = g.players.filter((p) => p.winner).map((p) => esc(p.name)).join(', ');
  const iWon = g.players.find((p) => p.name === ME)?.winner;
  return `<div class="panel winner-banner"><div style="font-size:40px">${!g.me || iWon ? '🏆' : '💀'}</div>
    <h3>${names[g.winner]} chiến thắng!</h3><div>${winners}</div>
    <div class="muted" style="margin-top:6px">${!g.me ? 'Bạn đã theo dõi ván đấu.' : iWon ? 'Chúc mừng, cao bồi!' : 'Lần sau may mắn hơn nhé.'} ${ROOM.host === ME ? 'Bấm “Về phòng chờ” để chơi ván mới.' : 'Chờ chủ phòng mở ván mới.'}</div></div>`;
}

// Kết quả dùng cờ winner do server tính, kể cả đồng đội đã bị loại.
function clearMatchResult() {
  clearTimeout(ui.resultDelay);
  ui.resultDelay = null;
  $('#matchResult')?.remove();
  document.body.classList.remove('match-result-open');
  ui.resultDismissed = false;
}

function resultFaction(role) {
  return role === 'Sheriff' || role === 'Deputy' ? 'law' : role;
}


// 12 danh hiệu cuối ván (thứ tự do awards() trong game.js quyết định, lưới 4×3): id → [biểu tượng, tên, mô tả, loại].
// glory = Vinh danh, tease = Troll. Ô may rủi là lucky HOẶC unlucky; ô cuối là passenger HOẶC iknew (Renegade thắng).
const AWARD_INFO = {
  damage: ['💥', 'Kẻ gây tổn thương', 'Gây nhiều sát thương nhất', 'glory'],
  killer: ['☠️', 'Thần chết', 'Hạ gục nhiều người nhất', 'glory'],
  schemer: ['🧠', 'Kẻ ủ mưu', 'Gây nhiều sát thương nhất trong 1 lượt', 'glory'],
  dodger: ['🐍', 'Lươn chúa', 'Tránh được nhiều sát thương nhất trong 1 vòng', 'glory'],
  bandit: ['🏴‍☠️', 'Tướng cướp', 'Outlaw nhắm vào Sheriff sớm nhất', 'glory'],
  legacy: ['📜', 'Di sản', 'Đã nằm xuống nhưng gây sát thương mỗi lượt nhiều nhất', 'glory'],
  tough: ['🩸', 'Sống dai', 'Nhiều lượt sống lay lắt (≤ 2 máu) nhất', 'glory'],
  lucky: ['🔴', 'Số đỏ', 'Rút kiểm tra may hơn kỳ vọng nhiều nhất (từ 3 lần)', 'glory'],
  unlucky: ['🐕', 'Sống chó', 'Rút kiểm tra xui hơn kỳ vọng nhiều nhất (từ 3 lần)', 'tease'],
  snatcher: ['🦴', 'Đớp mạng', 'Ăn mạng khi người khác gây sát thương', 'tease'],
  popular: ['💘', 'Ai cũng quý bạn', 'Bị nhắm nhiều nhất', 'tease'],
  deadweight: ['🏋️‍♂️', 'Quả tạ vàng', 'Nhắm vào đồng đội nhiều nhất', 'tease'],
  passenger: ['🪑', 'Được gánh', 'Người phe thắng gây ít sát thương nhất — đồng đội gánh cả ván', 'tease'],
  iknew: ['🙄', 'Tao biết mà', 'Người đã cố ngăn cản Kẻ phản bội nhiều nhất', 'tease'],
};
const RESULT_STEPS = [['result', 'Kết quả'], ['awards', 'Danh hiệu'], ['timeline', 'Diễn biến'], ['contrib', 'Đóng góp'], ['stats', 'Thống kê']];
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

// Server chạy bản cũ (chưa khởi động lại sau khi cập nhật) sẽ không gửi g.summary:
// báo rõ cho người chơi thay vì để màn Danh hiệu trống và bảng Thống kê toàn số 0.
function resultMissingSummaryHTML(g, won, back, next) {
  return `${resultHeaderHTML(g, won)}
    <div class="result-missing" role="alert"><b>⚠️ Không có số liệu cuối ván</b>
      <p>Server đang chạy bản cũ nên chưa gửi danh hiệu và thống kê.</p>
      <p>Người làm host hãy chạy lại <code>CHAY-GAME.bat</code>, nhấn <b>Enter</b> để khởi động lại server, rồi mở ván mới.</p></div>
    <div class="result-foot"><button type="button" class="btn ghost" data-step="${back[0]}">← ${back[1]}</button><span></span>${next}</div>`;
}

// Hết ván thì ai cũng về phòng chờ được; server cũ (chưa có freeReset) chỉ cho chủ phòng.
function canReset() {
  return ROOM.host === ME || !!ROOM.server?.features?.includes('freeReset');
}

function resultFinalButtonsHTML() {
  const back = '<button type="button" class="result-continue small" data-reset><span aria-hidden="true">🔁</span> Về phòng chờ</button>';
  if (!ROOM.game) return `<span class="st-wait">Phòng đã về phòng chờ.</span>${back}`;
  return `<button type="button" class="btn ghost" data-close>Xem bàn chơi</button>
    ${canReset() ? back : '<span class="st-wait">Chờ chủ phòng mở ván mới…</span>'}`;
}

function resultAwardsHTML(g, won) {
  if (!g.summary) return resultMissingSummaryHTML(g, won, ['result', 'Kết quả'], '<button type="button" class="result-continue small" data-step="stats"><span aria-hidden="true">✺</span> Tiếp tục</button>');
  // Bỏ qua danh hiệu lạ nếu server và giao diện lệch phiên bản, tránh lỗi làm hỏng cả màn.
  const awards = (g.summary.awards || []).filter((a) => AWARD_INFO[a.id]);
  // Đếm riêng Vinh danh và Troll: "lên bục" = có tên ở hạng 1 hoặc 2
  const podium = (kind) => {
    const list = awards.filter((a) => AWARD_INFO[a.id][3] === kind);
    return `<b>${list.filter((a) => a.ranks.some((r) => r.players.includes(ME))).length}</b>/${list.length}`;
  };
  return `${resultHeaderHTML(g, won)}
    <div class="aw-bar"><span>Bạn lên bục ${podium('glory')} danh hiệu vinh danh · ${podium('tease')} danh hiệu troll</span>
      <span class="aw-legend"><span><i class="glory"></i>Vinh danh</span><span><i class="tease"></i>Troll</span></span></div>
    <div class="aw-grid">${awards.map((a) => awardCardHTML(g, a)).join('')}</div>
    <div class="result-foot"><button type="button" class="btn ghost" data-step="result">← Kết quả</button><span></span>
      <button type="button" class="result-continue small" data-step="timeline"><span aria-hidden="true">✺</span> Tiếp tục</button></div>`;
}

// ---------- Diễn biến & Đóng góp: dựa trên cán cân sức mạnh (power.js) game ghi sau mỗi hành động ----------
const TEAM_OF = { Sheriff: 'law', Deputy: 'law', Outlaw: 'out', Renegade: 'ren' };
const resultNext = (step, label = 'Tiếp tục') => `<button type="button" class="result-continue small" data-step="${step}"><span aria-hidden="true">✺</span> ${label}</button>`;
// Màu vai trò (khớp biến CSS --sheriff/--deputy/--outlaw/--renegade trong style.css) cho SVG vẽ bằng JS
const ROLE_COLOR = { Sheriff: '#1d3a6b', Deputy: '#3d7cc9', Outlaw: '#8a2b1d', Renegade: '#e2b31e', law: '#3d7cc9' };
// Deputy/Outlaw nhạt dần theo thứ tự đóng góp (sắc đầu = màu vai trò chung)
const ROLE_SHADES = { Deputy: ['#3d7cc9', '#78a9e0', '#b0cff0'], Outlaw: ['#8a2b1d', '#c0563f', '#e39a7f'] };
const LIGHT_SLICE = [ROLE_COLOR.Renegade, '#b0cff0', '#e39a7f']; // lát sáng → chữ tối
const signed = (v, d = 2) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d).replace('.', ',')}`;

// Tô tên người chơi trong câu log theo phe (tên dài thay trước để không bị cắt nhầm)
function teamNames(g, text) {
  let out = esc(text);
  const players = [...g.players].sort((a, b) => b.name.length - a.name.length);
  const marks = [];
  players.forEach((p, k) => {
    const re = new RegExp(esc(p.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    out = out.replace(re, () => { marks.push(`<span class="tl-who ${p.role.toLowerCase()}">${esc(p.name)}</span>`); return `\u0000${marks.length - 1}\u0000`; });
  });
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => marks[i]);
}

// ---------- Diễn biến: tỉ lệ thắng 3 phe (power.winProb, game.compactTimeline) ----------
// Dữ liệu: summary.timeline.pts[k] có w = [Luật pháp, Outlaw, Renegade], h = máu mọi người, cf = kịch bản Barrel ngược lại.
// Tab gồm: Loại trận · 3 thẻ phe · biểu đồ dải chồng 100% · "Những lượt quyết định" (lượt ảnh hưởng lớn + lượt rút kiểm tra
// hên/xui đặc biệt, mỗi lượt tối đa 3 hành động tác động mạnh nhất). Nháp gốc: drafts/tab-dien-bien-v2.html.
const RESULT_NO_TIMELINE = `<div class="result-missing" role="status"><b>Không có dữ liệu diễn biến</b><p>Ván này được chơi trên server bản cũ nên chưa ghi tỉ lệ thắng theo từng hành động.</p></div>`;
const WT_BANDS = ['law', 'ren', 'out']; // thứ tự dải từ dưới lên
const WT_NAME = { law: 'Luật pháp', out: 'Outlaw', ren: 'Renegade' };
const WT_COLOR = { law: ROLE_COLOR.law, out: ROLE_COLOR.Outlaw, ren: ROLE_COLOR.Renegade };
const WIN_OF = { Sheriff: 'law', Outlaw: 'out', Renegade: 'ren' };
const wtPct = (v) => `${Math.round(v * 100)}%`;
const wtSigned = (v) => { const r = Math.round(v * 100); return `${r === 0 ? '±' : r > 0 ? '+' : '−'}${Math.abs(r)}`; };
const wtMaxFac = (d) => ['law', 'ren', 'out'].reduce((a, f) => (Math.abs(d[f]) > Math.abs(d[a]) ? f : a), 'law');
const wtDiff = (a, b) => ({ law: a.law - b.law, out: a.out - b.out, ren: a.ren - b.ren });
const wtObj = (w) => ({ law: w[0], out: w[1], ren: w[2] });
const WT_ACT_MIN = 0.03;  // hành động làm một phe đổi ≥ 3 điểm % mới đáng kể
const WT_LUCK_MIN = 0.1;  // Barrel làm tỉ lệ thắng chênh ≥ 10 điểm % so với kịch bản ngược lại → hên/xui đặc biệt

// Gom các điểm thành từng lượt: tỉ lệ thắng trước/sau, máu trước/sau, người gục, log
function winTurns(g) {
  const tl = g.summary?.timeline;
  if (!tl?.pts?.length || !tl.pts[0].w) return null;
  const idx = (name) => g.players.findIndex((p) => p.name === name);
  const pts = tl.pts.map((p) => ({ ...p, P: wtObj(p.w) }));
  const start = { P: wtObj(tl.w0), h: tl.start.map((x) => x[0]) };
  const deaths = [];
  pts.forEach((p, k) => p.log.forEach((l) => {
    const m = l.match(/^☠️ (.+) đã chết! Vai trò: (\w+)/);
    if (m && idx(m[1]) >= 0) deaths.push({ k, t: p.t, i: idx(m[1]), name: m[1], role: m[2] });
  }));
  const turns = [];
  pts.forEach((p, k) => {
    let tr = turns[turns.length - 1];
    if (!tr || tr.t !== p.t) { tr = { t: p.t, r: p.r, o: p.o, k0: k, log: [] }; turns.push(tr); }
    tr.k1 = k; tr.log.push(...p.log);
  });
  turns.forEach((tr, j) => {
    const b = j ? pts[turns[j - 1].k1] : start, a = pts[tr.k1];
    tr.before = b.P; tr.after = a.P; tr.hp0 = b.h; tr.hp1 = a.h;
    tr.d = wtDiff(a.P, b.P);
    tr.swing = (Math.abs(tr.d.law) + Math.abs(tr.d.out) + Math.abs(tr.d.ren)) / 2;
    tr.deaths = deaths.filter((d) => d.k >= tr.k0 && d.k <= tr.k1);
  });
  return { pts, start, turns, deaths };
}

// Phe dẫn có độ trễ: chỉ đổi khi phe mới hơn phe đang dẫn ≥ 10 điểm %
function winLeaders(list) {
  let cur = null;
  return list.map((tr) => {
    const p = tr.after, best = ['law', 'out', 'ren'].reduce((x, f) => (p[f] > p[x] ? f : x), 'law');
    if (!cur || (best !== cur && p[best] - p[cur] >= 0.1)) cur = best;
    return cur;
  });
}

// ---------- Loại trận (kiểu chess.com) theo cửa thắng của phe thắng ----------
// Ngưỡng tạm đặt theo các ván nháp, chưa chỉnh bằng mô phỏng hàng loạt.
const MATCH_TYPES = {
  renegade: ['🎭', 'Kẻ phản bội cân cả bàn'], chaos: ['🔥', 'Trận điên rồ'], thrown: ['💔', 'Dẫn cả trận vẫn để thua'],
  comeback: ['🔄', 'Lật kèo'], crush: ['👑', 'Áp đảo một chiều'], close: ['⚖️', 'Giằng co tới phút chót'], steady: ['🎯', 'Thắng chắc tay'],
};
const MATCH_RULE = { chaosSwaps: 3, thrownShare: 0.65, comebackLow: 0.2, crushShare: 0.9, crushMean: 0.6, closeBand: 0.15, closeShare: 0.7 };
function classifyMatch(g, data) {
  const W = WIN_OF[g.winner], body = data.turns.slice(0, -1);
  if (W === 'ren') {
    const r = g.players.find((p) => p.role === 'Renegade');
    return { type: 'renegade', text: `${r ? r.name : 'Renegade'} sống sót tới cuối, một mình đứng trên mọi phe — đầu ván chỉ có ${wtPct(data.start.P.ren)} cửa thắng.` };
  }
  if (body.length < 3) return { type: 'crush', text: `Phe ${WT_NAME[W]} kết thúc ván chỉ sau ${data.turns.length} lượt.` };
  const R = MATCH_RULE, pw = body.map((tr) => tr.after[W]), L = winLeaders(body);
  let swaps = 0; for (let j = 1; j < L.length; j++) if (L[j] !== L[j - 1]) swaps++;
  const share = (f) => body.filter(f).length / body.length;
  const low = Math.min(...pw), lowT = body[pw.indexOf(low)];
  const mean = pw.reduce((a, b) => a + b, 0) / pw.length;
  if (swaps >= R.chaosSwaps) return { type: 'chaos', text: `Thế dẫn đổi chủ ${swaps} lần — không phe nào giữ lợi thế được lâu.` };
  const lost = share((_, j) => L[j] !== W);
  if (lost >= R.thrownShare) { const o = L.find((x) => x !== W); return { type: 'thrown', text: `Phe ${WT_NAME[o]} dẫn ${wtPct(lost)} thời gian của ván nhưng để tuột chiến thắng ở cuối.` }; }
  if (low <= R.comebackLow) return { type: 'comeback', text: `Phe ${WT_NAME[W]} từng chỉ còn ${wtPct(low)} cửa thắng ở lượt ${lowT.t} rồi lật ngược thế trận.` };
  if (share((_, j) => L[j] === W) >= R.crushShare && mean >= R.crushMean) return { type: 'crush', text: `Phe ${WT_NAME[W]} dẫn gần như suốt ván, cửa thắng trung bình ${wtPct(mean)}.` };
  if (share((tr) => Math.abs(tr.after.law - tr.after.out) <= R.closeBand) >= R.closeShare) return { type: 'close', text: 'Hai phe ngang ngửa gần cả ván, chỉ ngã ngũ ở những lượt cuối.' };
  return { type: 'steady', text: `Phe ${WT_NAME[W]} tạo được lợi thế rồi giữ vững tới cuối.` };
}

// ---------- Rút kiểm tra hên / xui đặc biệt ----------
//  hên: thoát tù (1/4) · Barrel đỡ được khi chỉ còn 1 máu · Barrel đỡ 2 lần liền · Barrel đỡ mà cửa thắng chênh ≥ 10 điểm %
//  xui: Dynamite nổ · Barrel trượt rồi gục · Barrel trượt mà cửa thắng chênh ≥ 10 điểm %
// Với Barrel, độ hên/xui = tỉ lệ thắng thật − tỉ lệ thắng nếu Barrel ra ngược lại (cf do server tính).
function winLuck(g, data, tr) {
  const ev = [], streak = {}, pts = data.pts;
  const withCf = (e) => {
    const cf = pts[e.k].cf?.find((c) => c[0] === e.i);
    if (!cf) return e;
    const a = pts[e.ok ? e.k : e.kEnd].P;
    e.d = wtDiff(a, { law: cf[2], out: cf[3], ren: cf[4] });
    e.mag = Math.max(...Object.values(e.d).map(Math.abs));
    e.vs = e.ok ? 'so với nếu Barrel trượt' : 'so với nếu Barrel đỡ được';
    return e;
  };
  for (let k = tr.k0; k <= tr.k1; k++) for (const l of pts[k].log) {
    const m = l.match(/^(.+?) rút kiểm tra \((\w+)\): (.+?) → (thành công|thất bại)/);
    if (!m) continue;
    const [, who, kind, card, r] = m, i = g.players.findIndex((p) => p.name === who), ok = r === 'thành công';
    if (i < 0) continue;
    const role = g.players[i].role, hp0 = (k ? pts[k - 1].h : data.start.h)[i];
    if (kind === 'Barrel') streak[who] = ok ? (streak[who] || 0) + 1 : 0;
    if (kind === 'Jail' && ok) ev.push({ k, i, kind: 'hen', text: `${who} rút ${card}, thoát tù`, short: 'thoát tù, cơ hội 1/4' });
    else if (kind === 'Dynamite' && !ok) ev.push({ k, i, kind: 'xui', text: `Dynamite nổ trúng ${who}`, short: 'Dynamite nổ, cơ hội ~1/6' });
    else if (kind === 'Barrel' && ok) {
      const e = withCf({ k, i, ok, kind: 'hen' });
      if (hp0 === 1) ev.push(Object.assign(e, { text: `Barrel cứu mạng ${who} khi chỉ còn 1 máu`, short: `${who} còn 1 máu, trượt là gục` }));
      else if (streak[who] === 2) ev.push(Object.assign(e, { text: `Barrel của ${who} đỡ 2 lần liền`, short: 'Barrel đỡ 2 lần liền' }));
      else if ((e.mag || 0) >= WT_LUCK_MIN) ev.push(Object.assign(e, { text: `Barrel đỡ đòn cho ${role} ${who}`, short: `Barrel đỡ cho ${role} ${who}` }));
    } else if (kind === 'Barrel') {
      // trượt: tìm lúc người đó thật sự mất máu (kịp dùng Missed! thì không tính)
      let kEnd = -1; for (let j = k; j <= tr.k1; j++) if (pts[j].h[i] < hp0) { kEnd = j; break; }
      if (kEnd < 0) continue;
      const e = withCf({ k, i, ok, kind: 'xui', kEnd });
      if (tr.deaths.some((x) => x.i === i && x.k === kEnd)) ev.push(Object.assign(e, { text: `Barrel của ${who} trượt, gục ngay sau đó`, short: 'Barrel trượt đúng lúc nguy' }));
      else if ((e.mag || 0) >= WT_LUCK_MIN) ev.push(Object.assign(e, { text: `Barrel của ${role} ${who} trượt`, short: `Barrel của ${role} ${who} trượt` }));
    }
  }
  return ev;
}

// Chọn lượt: tối đa 3 lượt ảnh hưởng lớn nhất (đổi ≥ 8 điểm %) + tối đa 3 lượt rút kiểm tra hên/xui đặc biệt.
// Bỏ lượt cuối (phát bắn cuối chỉ "chốt" kết quả). Bước ngoặt / chạm đáy chỉ là nhãn khi lượt đã được chọn.
function pickWinTurns(g, data) {
  const W = WIN_OF[g.winner], body = data.turns.slice(0, -1);
  if (!body.length) return { picked: [], turning: null };
  const L = winLeaders(body);
  let turning = null; for (let j = body.length - 1; j > 0; j--) if (L[j] === W && L[j - 1] !== W) { turning = body[j]; break; }
  const pw = body.map((tr) => tr.after[W]), low = Math.min(...pw), lowT = low < 0.3 ? body[pw.indexOf(low)] : null;
  const bySwing = [...body].sort((a, b) => b.swing - a.swing);
  let big = bySwing.filter((tr) => tr.swing >= 0.08).slice(0, 3);
  if (big.length < 2) big = bySwing.slice(0, 2);
  body.forEach((tr) => { tr.luck = winLuck(g, data, tr); });
  const luckMag = (tr) => Math.max(...tr.luck.map((e) => e.mag ?? tr.swing));
  const lucky = body.filter((tr) => tr.luck.length).sort((a, b) => luckMag(b) - luckMag(a)).slice(0, 3);
  const picked = [...new Set([...big, ...lucky])].sort((a, b) => a.t - b.t);
  picked.forEach((tr) => {
    tr.kinds = [];
    if (big.includes(tr)) tr.kinds.push('big');
    if (lucky.includes(tr)) tr.kinds.push(...new Set(tr.luck.map((e) => e.kind)));
    if (tr === turning) tr.kinds.push('turn');
    if (tr === lowT) tr.kinds.push('low');
  });
  return { picked, turning };
}

// ---------- mô tả lượt & hành động ----------
const WT_ACT = /^(💥|🔫|🪶|🤠|🍺|⛓️|💃|😱|🏪|🥃)\s*/;
function winTurnTitle(g, tr) {
  if (!tr.kinds.includes('big') && tr.luck?.length) { const e = tr.luck[0]; return `${e.kind === 'hen' ? '🍀' : '🌧️'} ${e.text}`; }
  const own = tr.log.filter((l) => WT_ACT.test(l)).join(' ');
  if (tr.deaths.length >= 2) return `💀 Liên hoàn: ${tr.deaths.length} người gục`;
  if (tr.deaths.length) {
    const d = tr.deaths[0], o = g.players[tr.o];
    const tragic = o && d.i !== tr.o && o.role !== 'Renegade' && TEAM_OF[o.role] === TEAM_OF[d.role];
    return `${tragic ? '💔 Bi kịch: ' : '💀 '}${d.role} ${d.name} gục ngã`;
  }
  if (/Dynamite nổ/.test(tr.log.join(' '))) return '💣 Dynamite phát nổ';
  if (/Gatling|Howitzer/.test(own)) return '🔫 Gatling quét cả bàn';
  if (/thổ dân/.test(own)) return '🪶 Thổ dân tràn vào';
  if (/thách đấu/.test(own)) return '🤠 Đấu tay đôi';
  if (/bỏ tù/.test(own)) return '⛓️ Song sắt khép lại';
  if (/buộc .* bỏ|lấy .* của/.test(own)) return '😱 Tước vũ khí đối thủ';
  if (/Beer|Saloon/.test(own)) return '🍺 Hồi sức đúng lúc';
  if (/bắn/.test(own)) return '💥 Loạt đạn quyết định';
  return `⚖️ ${WT_NAME[wtMaxFac(tr.d)]} đổi thế`;
}

// Mỗi "chuỗi" bắt đầu bằng một lá đánh / trang bị / lần rút kiểm tra / sự kiện và gom các phản hồi theo sau
// (né, mất máu, gục…). Rút Barrel là phản hồi của đòn đang diễn ra nên thuộc chuỗi của đòn đó.
// Phần rút bài đầu lượt (trước hành động đầu tiên) không phải hành động nên bỏ.
const WT_STARTER = /^(💥|🔫|🪶|🤠|🍺|⛓️|💃|😱|🏪|🥃)|rút kiểm tra|trang bị |Dynamite nổ|bị giam|thoát khỏi nhà tù|bỏ \d+ lá để hồi/;
function winChains(data, tr) {
  const pts = data.pts, out = [];
  let cur = null;
  for (let k = tr.k0; k <= tr.k1; k++) {
    const lines = pts[k].log;
    const si = lines.findIndex((l) => WT_STARTER.test(l) && !(cur && /rút kiểm tra \(Barrel\)/.test(l)));
    if (si >= 0) { cur = { k0: k, head: lines[si], rest: lines.filter((_, j) => j !== si) }; out.push(cur); }
    else if (!cur) { cur = { k0: k, head: null, rest: [...lines] }; out.push(cur); }
    else cur.rest.push(...lines);
    cur.k1 = k;
  }
  out.forEach((c) => {
    c.d = wtDiff(pts[c.k1].P, c.k0 ? pts[c.k0 - 1].P : data.start.P);
    c.mag = Math.max(...Object.values(c.d).map(Math.abs));
  });
  return out.filter((c) => c.head);
}
const wtStripIcon = (s) => s.replace(/^\S+\s/u, (m) => (/\p{Extended_Pictographic}/u.test(m) ? '' : m));
function winActor(g, tr, c) {
  const s = wtStripIcon(c.head);
  let best = -1;
  g.players.forEach((p, i) => { if (s.startsWith(p.name + ' ') && (best < 0 || p.name.length > g.players[best].name.length)) best = i; });
  return best >= 0 ? best : tr.o;
}
function winActionHTML(g, c) {
  const ic = c.head.match(/^(\S+)\s/u)?.[1];
  const check = /rút kiểm tra/.test(c.head);
  const icon = check ? '🎴' : /trang bị/.test(c.head) ? '🛡️' : /để hồi/.test(c.head) ? '🍺' : ic && /\p{Extended_Pictographic}/u.test(ic) ? ic : '•';
  let s = teamNames(g, wtStripIcon(c.head).replace(/[.!]$/, ''));
  if (check) s = s.replace(/→ (thành công|thất bại)/, (_, r) => `→ <b class="${r === 'thành công' ? 'ok' : 'bad'}">${r}</b>`);
  return `<span class="wt-ic">${icon}</span><span>${s}</span>`;
}
// Giải thích ngắn: hậu quả (gục > mất máu > Barrel/né > còn lại), đánh dấu khi trúng đồng đội của người làm
function winExplainHTML(g, c, actor) {
  const P = g.players, iOf = (nm) => P.findIndex((p) => p.name === nm);
  const mate = (nm) => { const i = iOf(nm); return i >= 0 && i !== actor && P[actor].role !== 'Renegade' && TEAM_OF[P[i].role] === TEAM_OF[P[actor].role]; };
  const who = (nm) => `${teamNames(g, nm)} <span class="wt-rl">${esc(P[iOf(nm)]?.role || '')}</span>${mate(nm) ? ' <span class="wt-mate">⚠ đồng đội</span>' : ''}`;
  const items = [];
  c.rest.forEach((l, j) => {
    let m;
    if ((m = l.match(/^☠️ (.+?) đã chết!/))) items.push([0, j, `☠️ ${who(m[1])} gục`]);
    else if ((m = l.match(/^(.+?) mất (\d+) máu \(còn (\d+)\)/))) items.push([1, j, `${who(m[1])} −${m[2]} máu, còn ${m[3]}`]);
    else if ((m = l.match(/^(.+?) rút kiểm tra \(Barrel\): .+? → (thành công|thất bại)/))) items.push([2, j, `Barrel của ${teamNames(g, m[1])} <b class="${m[2] === 'thành công' ? 'ok' : 'bad'}">${m[2] === 'thành công' ? 'đỡ được' : 'trượt'}</b>`]);
    else if ((m = l.match(/^(.+?) đã né được/))) items.push([2, j, `${teamNames(g, m[1])} né được`]);
    else if (/ vừa cứu .+ khỏi một pha đấu súng!$/.test(l)) items.push([1, j, `🛟 ${teamNames(g, l)}`]);
    else if ((m = l.match(/Dynamite được chuyền sang (.+?)\./))) items.push([3, j, `Dynamite chuyền sang ${teamNames(g, m[1])}`]);
    else if (/Dynamite nổ/.test(l)) items.push([0, j, '💣 Dynamite nổ']);
    else if ((m = l.match(/^(.+?) bị giam, mất lượt/))) items.push([1, j, `${teamNames(g, m[1])} bị giam, mất lượt`]);
    else if ((m = l.match(/^(.+?) thoát khỏi nhà tù/))) items.push([2, j, `${teamNames(g, m[1])} ra tù`]);
    else if ((m = l.match(/được thưởng (\d+) lá/))) items.push([3, j, `thưởng ${m[1]} lá`]);
  });
  const out = items.sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, 4).sort((a, b) => a[1] - b[1]).map((x) => x[2]);
  if (out.length) return out.join(' · ');
  const h = c.head;
  if (/Beer|để hồi/.test(h)) return 'hồi 1 máu';
  if (/Saloon/.test(h)) return 'cả bàn hồi 1 máu';
  if (/trang bị/.test(h)) return 'lắp trang bị lên bàn';
  if (/bỏ tù/.test(h)) return 'đối thủ có thể mất lượt sau';
  if (/General Store/.test(h)) return 'mỗi người chọn một lá';
  if (/buộc .* bỏ|lấy .* của/.test(h)) return 'đối thủ mất một lá';
  if (/rút kiểm tra \(Jail\)/.test(h)) return /thành công/.test(h) ? 'thoát tù, được chơi lượt này' : 'mất lượt';
  if (/rút kiểm tra \(Dynamite\)/.test(h)) return /thành công/.test(h) ? 'Dynamite không nổ' : 'Dynamite nổ';
  return 'không trúng ai';
}
const winDeltaHTML = (f, v, big) => { const r = Math.round(v * 100); return `<span class="wt-d ${f} ${big ? 'big' : ''}"><b>${r > 0 ? '▲' : r < 0 ? '▼' : ''} ${wtSigned(v)}%</b><small>${WT_NAME[f]}</small></span>`; };
// Tối đa 3 hành động: hành động có rút kiểm tra hên/xui trước (nếu lượt lọt vì nó), rồi tới tác động mạnh nhất.
// Số bên trái = phe đổi nhiều nhất; với Barrel hên/xui là độ hên/xui so với kịch bản ngược lại.
function winActsHTML(g, data, tr) {
  const lucky = tr.kinds.includes('hen') || tr.kinds.includes('xui');
  const all = winChains(data, tr);
  all.forEach((c) => { c.luck = lucky ? (tr.luck || []).filter((e) => e.k >= c.k0 && e.k <= c.k1) : []; });
  const byMag = [...all].sort((a, b) => b.mag - a.mag);
  let shown = [...byMag.filter((c) => c.luck.length), ...byMag.filter((c) => !c.luck.length && c.mag >= WT_ACT_MIN)].slice(0, 3);
  if (!shown.length) shown = byMag.slice(0, 1);
  shown.sort((a, b) => a.k0 - b.k0);
  const rest = all.length - shown.length;
  return `<div class="wt-acts">${shown.map((c) => {
    const le = c.luck.find((e) => e.d), d = le ? le.d : c.d, f = wtMaxFac(d), actor = winActor(g, tr, c);
    const tags = c.luck.map((e) => `<span class="wt-luck ${e.kind}">${e.kind === 'hen' ? '🍀 hên' : '🌧️ xui'}: ${teamNames(g, e.short)}${e.vs ? ` <i>(${e.vs})</i>` : ''}</span> `).join('');
    return `<div class="wt-act ${Math.abs(d[f]) >= 0.1 ? 'big' : ''} ${le ? 'cf' : ''}">${winDeltaHTML(f, d[f])}<div class="wt-txt">${winActionHTML(g, c)}</div><div class="wt-why">${tags}${winExplainHTML(g, c, actor)}</div></div>`;
  }).join('')}${rest > 0 ? `<div class="wt-more">+ ${rest} hành động khác ảnh hưởng nhỏ</div>` : ''}</div>`;
}

// ---------- biểu đồ dải chồng 100% ----------
// Mỗi lượt rộng bằng nhau, các hành động trong lượt chia đều. Điện thoại dùng khung hẹp hơn để chữ không bé đi.
let WT_CHART = null; // hình học của biểu đồ đang hiện (cho rê chuột)
function winChartSVG(g, data, picked, turning) {
  const { pts, turns, start, deaths } = data;
  const phone = innerWidth < 600;
  const W = phone ? 420 : 1000, H = phone ? 230 : 165, T = turns.length;
  const x0 = 30, x1 = W - 6, top = 24, bot = H - 32;
  const pos = []; turns.forEach((tr, j) => { for (let k = tr.k0; k <= tr.k1; k++) pos[k] = j + (k - tr.k0 + 1) / (tr.k1 - tr.k0 + 1); });
  const x = (k) => x0 + (k < 0 ? 0 : pos[k] / T) * (x1 - x0), y = (v) => bot - v * (bot - top);
  const xs = [x(-1), ...pts.map((_, k) => x(k))], P = [start.P, ...pts.map((p) => p.P)];
  const cum = P.map((p) => [0, p.law, p.law + p.ren, 1]);
  let h = '';
  WT_BANDS.forEach((f, b) => {
    const up = P.map((_, k) => `${xs[k].toFixed(1)},${y(cum[k][b + 1]).toFixed(1)}`), dn = P.map((_, k) => `${xs[k].toFixed(1)},${y(cum[k][b]).toFixed(1)}`).reverse();
    h += `<polygon points="${up.concat(dn).join(' ')}" fill="${WT_COLOR[f]}"/>`;
  });
  let lastR = null;
  turns.forEach((tr, j) => {
    if (tr.r === lastR) return; lastR = tr.r;
    const X = x0 + (j / T) * (x1 - x0);
    h += `<line x1="${X}" x2="${X}" y1="${top}" y2="${bot}" stroke="#fff" stroke-opacity=".35"/><text x="${X + 3}" y="${H - 3}" font-size="10" fill="#8b7355">V${tr.r}</text>`;
  });
  h += `<line x1="${x0}" x2="${x1}" y1="${y(0.5)}" y2="${y(0.5)}" stroke="#fff" stroke-dasharray="4 4" stroke-opacity=".75"/>`;
  [0, 0.5, 1].forEach((v) => { h += `<text x="${x0 - 4}" y="${y(v) + 3}" font-size="10" text-anchor="end" fill="#8b7355">${wtPct(v)}</text>`; });
  picked.forEach((tr, i) => {
    const a = x0 + (turns.indexOf(tr) / T) * (x1 - x0), w = Math.max(4, (x1 - x0) / T), c = tr === turning ? '#d9a441' : WT_COLOR[wtMaxFac(tr.d)];
    h += `<rect x="${a}" y="${top}" width="${w}" height="${bot - top}" fill="${tr === turning ? '#fde68a' : '#fff'}" opacity="${tr === turning ? 0.55 : 0.28}" class="wt-mk" data-ev="${i}"/>`;
    h += `<g class="wt-mk" data-ev="${i}"><circle cx="${a + w / 2}" cy="${top - 12}" r="10" fill="${c}" stroke="#fffaf0" stroke-width="2"/><text x="${a + w / 2}" y="${top - 8}" font-size="11" font-weight="800" text-anchor="middle" fill="${tr === turning || c === WT_COLOR.ren ? '#2a160a' : '#fff'}">${i + 1}</text></g>`;
  });
  deaths.forEach((d) => { h += `<g><circle cx="${x(d.k)}" cy="${bot + 10}" r="7" fill="${ROLE_COLOR[d.role]}" stroke="#fffaf0" stroke-width="1.5"/><text x="${x(d.k)}" y="${bot + 13.5}" font-size="8.5" text-anchor="middle">☠</text><title>${esc(d.name)} (${d.role}) gục — lượt ${d.t}</title></g>`; });
  h += `<line class="wt-cross" y1="${top}" y2="${bot}" stroke="#2a1a0e" stroke-width="1.5" opacity="0"/>`;
  WT_CHART = { g, data, xs: pts.map((_, k) => x(k)), W };
  return `<svg class="wt-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Tỉ lệ thắng của 3 phe theo từng hành động">${h}</svg>`;
}
// Rê chuột / chạm lên biểu đồ: vạch dọc + ô ghi lượt, chủ lượt, tỉ lệ 3 phe và việc vừa xảy ra
function wireWinChart(dialog) {
  const svg = dialog.querySelector('.wt-chart'), tip = dialog.querySelector('.wt-tip');
  if (!svg || !tip || !WT_CHART) return;
  const { g, data, xs, W } = WT_CHART, cross = svg.querySelector('.wt-cross');
  const move = (ev) => {
    const r = svg.getBoundingClientRect(), mx = (ev.clientX - r.left) / r.width * W;
    let k = 0, bd = Infinity; xs.forEach((X, j) => { const d = Math.abs(X - mx); if (d < bd) { bd = d; k = j; } });
    const p = data.pts[k], o = g.players[p.o];
    cross.setAttribute('x1', xs[k]); cross.setAttribute('x2', xs[k]); cross.setAttribute('opacity', 0.7);
    tip.innerHTML = `<b>Lượt ${p.t}</b> · ${o ? `${teamNames(g, o.name)} (${esc(o.role)})` : ''}
      <div class="wt-tip-row">${['law', 'ren', 'out'].map((f) => `<span style="--c:${WT_COLOR[f]}">${WT_NAME[f]} ${wtPct(p.P[f])}</span>`).join('')}</div>
      ${p.log.length ? `<div class="wt-tip-log">${p.log.slice(0, 2).map((l) => teamNames(g, l)).join(' · ')}</div>` : ''}`;
    const box = svg.parentElement.getBoundingClientRect(), zoom = svg.parentElement.offsetWidth ? box.width / svg.parentElement.offsetWidth : 1;
    let left = (ev.clientX - box.left) / zoom + 14;
    if (left + tip.offsetWidth > svg.parentElement.offsetWidth - 6) left -= tip.offsetWidth + 28;
    tip.style.left = `${Math.max(4, left)}px`;
    tip.style.top = `${(r.top - box.top) / zoom + 24}px`;
    tip.classList.add('on');
  };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', () => { tip.classList.remove('on'); cross.setAttribute('opacity', 0); });
}

function resultTimelineHTML(g, won) {
  const data = winTurns(g);
  const foot = `<div class="result-foot"><button type="button" class="btn ghost" data-step="awards">← Danh hiệu</button><span></span>${resultNext('contrib')}</div>`;
  if (!data) return `${resultHeaderHTML(g, won)}${RESULT_NO_TIMELINE}${foot}`;
  const W = WIN_OF[g.winner], { turns } = data, body = turns.slice(0, -1);
  const { picked, turning } = pickWinTurns(g, data);
  const mt = classifyMatch(g, data), [mtIcon, mtName] = MATCH_TYPES[mt.type];
  // 3 thẻ phe: đầu ván · cao nhất · thấp nhất (phe thắng) / cuối ván (phe thua)
  const odds = ['law', 'ren', 'out'].filter((f) => g.players.some((p) => TEAM_OF[p.role] === f)).map((f) => {
    const vals = (body.length ? body : turns).map((tr) => tr.after[f]), list = body.length ? body : turns;
    const hi = Math.max(...vals), hiT = list[vals.indexOf(hi)], lo = Math.min(...vals), loT = list[vals.indexOf(lo)];
    const members = g.players.filter((p) => TEAM_OF[p.role] === f), gone = data.deaths.filter((d) => TEAM_OF[d.role] === f);
    const res = f === W ? '🏆 Thắng' : f !== 'law' && gone.length === members.length ? `hết người · L${gone[gone.length - 1].t}` : 'Thua';
    const third = f === W ? `<div>thấp nhất<b>${wtPct(lo)}</b><small>lượt ${loT.t}</small></div>` : `<div>cuối ván<b>${wtPct(vals[vals.length - 1])}</b><small>trước phát cuối</small></div>`;
    return `<div class="wt-odd ${f} ${f === W ? 'win' : ''}"><div class="wt-odd-nm">${WT_NAME[f]}<span>${res}</span></div>
      <div class="wt-facts"><div>đầu ván<b>${wtPct(data.start.P[f])}</b><small>${g.players.length} người</small></div><div>cao nhất<b>${wtPct(hi)}</b><small>lượt ${hiT.t}</small></div>${third}</div></div>`;
  }).join('');
  const rows = picked.map((tr, i) => {
    const o = g.players[tr.o], of = wtMaxFac(tr.d);
    const tags = [tr.kinds.includes('big') ? '<span class="wt-tag big">ẢNH HƯỞNG LỚN</span>' : '',
      tr.kinds.includes('hen') ? '<span class="wt-tag hen">🍀 HÊN</span>' : '', tr.kinds.includes('xui') ? '<span class="wt-tag xui">🌧️ XUI</span>' : '',
      tr.kinds.includes('turn') ? '<span class="wt-tag turn">BƯỚC NGOẶT</span>' : '',
      tr.kinds.includes('low') ? `<span class="wt-tag low">${WT_NAME[W].toUpperCase()} CHẠM ĐÁY ${wtPct(tr.after[W])}</span>` : ''].join('');
    return `<div class="wt-ev ${tr === turning ? 'turning' : ''}" id="wtEv${i}" style="--c:${WT_COLOR[of]}">
      <span class="wt-num ${of}">${i + 1}</span>
      <div class="wt-who" style="--rc:${ROLE_COLOR[o?.role] || '#7a5b3a'}"><span class="wt-av">${o ? charPortrait(o.char) || '🤠' : '🤠'}</span>
        <div>Lượt ${tr.t} · vòng ${tr.r}<b>${o ? teamNames(g, o.name) : '?'}</b>${o ? `<span class="aw-role role-${o.role.toLowerCase()}">${esc(o.role)}</span>` : ''}</div></div>
      <div class="wt-body"><div class="wt-title">${teamNames(g, winTurnTitle(g, tr))}${tags}</div>${winActsHTML(g, data, tr)}</div>
      <div class="wt-sum"><small>Cả lượt · ${WT_NAME[of]}</small>${winDeltaHTML(of, tr.d[of], true)}<small>${wtPct(tr.before[of])} → ${wtPct(tr.after[of])}</small></div>
    </div>`;
  }).join('') || '<p class="wt-none">Ván quá ngắn, không có lượt nào nổi bật.</p>';
  return `${resultHeaderHTML(g, won)}
    <div class="wt-top">
      <div class="tl-type ${mt.type}"><span class="tl-type-ic">${mtIcon}</span><div><div class="tl-type-k">Loại trận</div><b>${esc(mtName)}</b><p>${teamNames(g, mt.text)}</p></div></div>
      <div class="wt-odds">${odds}</div>
    </div>
    <section class="tl-panel wt-chart-panel"><div class="tl-head"><h3>Cửa thắng của 3 phe</h3>
      <div class="tl-legend"><span><i style="background:var(--law)"></i>Luật pháp</span><span><i style="background:var(--renegade)"></i>Renegade</span><span><i style="background:var(--outlaw)"></i>Outlaw</span><span>① lượt quyết định</span><span><i class="turn"></i>Bước ngoặt</span><span>☠ có người gục</span></div></div>
      ${winChartSVG(g, data, picked, turning)}<div class="wt-tip" aria-hidden="true"></div></section>
    <section class="tl-panel tl-events"><div class="tl-head"><h3>Những lượt quyết định</h3><span class="tl-legend">lượt đổi cửa thắng nhiều nhất · lượt rút kiểm tra hên / xui đặc biệt · 3 hành động tác động mạnh nhất mỗi lượt</span></div>
      <div class="wt-list">${rows}</div></section>
    ${foot}`;
}

// Đóng góp: Δ cán cân của mỗi hành động cộng cho người được ghi công, đổi dấu theo đội,
// KHÔNG tính phát súng cuối (cán cân "chạm trần" ±1), chia cho số lượt người đó được chơi.
// Renegade có mặt ở cả 2 đội: phần đẩy về Luật pháp vào đội Luật pháp, phần đẩy về Outlaw vào đội Outlaw.
function contribData(g) {
  const tl = g.summary?.timeline;
  if (!tl?.pts?.length) return null;
  const N = g.players.length, last = tl.pts.length - 1;
  const raw = Array(N).fill(0), renToward = { law: 0, out: 0 };
  let fate = 0, prev = 0;
  tl.pts.forEach((p, k) => {
    const d = p.b - prev; prev = p.b;
    if (k === last) return;
    if (p.a == null || p.a < 0) { fate += d; return; }
    raw[p.a] += d;
    if (g.players[p.a]?.role === 'Renegade') { if (d > 0) renToward.law += d; else renToward.out -= d; }
  });
  const byName = Object.fromEntries((g.summary.stats || []).map((s) => [s.name, s]));
  const turns = g.players.map((p) => Math.max(1, byName[p.name]?.turns || 1));
  return { raw, renToward, fate, turns };
}

function contribPieSVG(rows, posSum, team, teamTotal) {
  const arc = (a0, a1) => {
    const pt = (a) => [105 + 95 * Math.sin(a), 105 - 95 * Math.cos(a)];
    const [x0, y0] = pt(a0), [x1, y1] = pt(a1);
    return `M105,105 L${x0},${y0} A95,95 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1},${y1} Z`;
  };
  const pos = rows.filter((m) => m.v > 0);
  let a = 0, svg = pos.length ? '' : '<circle cx="105" cy="105" r="95" fill="#e6dccb"/>';
  pos.forEach((m) => {
    const sweep = (m.v / posSum) * Math.PI * 2;
    svg += pos.length === 1 ? `<circle cx="105" cy="105" r="95" fill="${m.col}"/>` : `<path d="${arc(a, a + sweep)}" fill="${m.col}" stroke="#fffaf0" stroke-width="2"/>`;
    const mid = a + sweep / 2;
    if (sweep > 0.35) svg += `<text x="${105 + 62 * Math.sin(mid)}" y="${109 - 62 * Math.cos(mid)}" text-anchor="middle" font-size="13" font-weight="800" fill="${LIGHT_SLICE.includes(m.col) ? '#2a1a0e' : '#fff'}">${Math.round(m.v / posSum * 100)}%</text>`;
    a += sweep;
  });
  svg += `<circle cx="105" cy="105" r="42" fill="#fffaf0"/><text x="105" y="100" text-anchor="middle" font-size="10.5" fill="#8b7355">cả đội /lượt</text>
    <text x="105" y="120" text-anchor="middle" font-size="17" font-weight="900" fill="${team === 'law' ? ROLE_COLOR.law : ROLE_COLOR.Outlaw}">${signed(teamTotal, 3)}</text>`;
  return `<svg class="cg-pie" viewBox="0 0 210 210" role="img" aria-label="Tỉ lệ đóng góp">${svg}</svg>`;
}

function resultContribHTML(g, won) {
  const data = contribData(g);
  const foot = `<div class="result-foot"><button type="button" class="btn ghost" data-step="timeline">← Diễn biến</button><span></span>${resultNext('stats')}</div>`;
  if (!data) return `${resultHeaderHTML(g, won)}${RESULT_NO_TIMELINE}${foot}`;
  const { raw, renToward, fate, turns } = data;
  const SIGN = { law: 1, out: -1 };
    const ren = g.players.findIndex((p) => p.role === 'Renegade');
  const panel = (team) => {
    const rows = g.players.map((p, i) => ({ p, i, t: turns[i], v: raw[i] * SIGN[team] / turns[i] }))
      .filter((m) => TEAM_OF[m.p.role] === team).sort((a, b) => b.v - a.v);
    // màu vai trò chung; trong cùng vai trò, người đóng góp nhiều hơn màu đậm hơn (rows đã xếp giảm dần)
    const shade = { Deputy: 0, Outlaw: 0 };
    rows.forEach((m) => { m.col = ROLE_SHADES[m.p.role] ? ROLE_SHADES[m.p.role][Math.min(shade[m.p.role]++, ROLE_SHADES[m.p.role].length - 1)] : ROLE_COLOR[m.p.role]; });
    if (ren >= 0) rows.push({ p: g.players[ren], i: ren, t: turns[ren], v: renToward[team] / turns[ren], col: ROLE_COLOR.Renegade, ren: true });
    const posSum = rows.filter((m) => m.v > 0).reduce((s, m) => s + m.v, 0) || 1;
    const teamTotal = rows.filter((m) => !m.ren).reduce((s, m) => s + m.v, 0);
    const winTeam = (g.winner === 'Sheriff') === (team === 'law') && g.winner !== 'Renegade';
    const share = (m) => (m.v > 0 ? `${Math.round(m.v / posSum * 100)}% công` : m.ren ? 'không tác động' : m.v === 0 ? '0% công' : 'kéo lùi đội');
    const legend = rows.map((m) => `<div class="cg-li ${m.v < 0 ? 'neg' : ''} ${m.p.name === ME ? 'me' : ''} ${m.ren ? 'ren' : ''}">
        <i style="background:${m.v > 0 ? m.col : '#d9d0c4'}"></i>
        <span class="cg-nm">${esc(m.p.name)}${m.p.name === ME ? ' (bạn)' : ''}<small>${esc(m.p.role)}${m.ren ? ' · giúp gián tiếp' : ''}</small></span>
        <span class="cg-v">${m.ren && m.v === 0 ? '0' : signed(m.v, 3)}<small class="u">/lượt</small><small>${share(m)} · ${m.t} lượt</small></span></div>`).join('');
    return `<section class="cg-team ${team} ${winTeam ? 'win' : ''}"><h3>${team === 'law' ? 'Luật pháp' : 'Tội phạm (Outlaw)'}${winTeam ? '<span class="cg-wtag">THẮNG</span>' : ''}</h3>
      <div class="cg-sub">Trung bình mỗi lượt được chơi, người đó đẩy cán cân về phía ${team === 'law' ? 'Luật pháp' : 'Outlaw'} bao nhiêu (không tính phát súng cuối)</div>
      <div class="cg-row">${contribPieSVG(rows, posSum, team, teamTotal)}<div class="cg-legend">${legend}</div></div></section>`;
  };
  return `${resultHeaderHTML(g, won)}
    <div class="cg-teams">${panel('law')}${panel('out')}</div>
    <p class="cg-note">${ren >= 0 ? `Renegade ${esc(g.players[ren].name)} (vàng) có mặt ở cả hai đội: phần hành động có lợi cho mỗi đội tính riêng. · ` : ''}Số phận (Dynamite, Jail) ${fate >= 0 ? 'có lợi cho Luật pháp' : 'có lợi cho Outlaw'} ${Math.abs(fate).toFixed(2).replace('.', ',')}</p>
    ${foot}`;
}

function resultStatsHTML(g, won) {
  if (!g.summary) return resultMissingSummaryHTML(g, won, ['awards', 'Danh hiệu'], resultFinalButtonsHTML());
  const sum = g.summary;
  const byName = Object.fromEntries(sum.stats.map((s) => [s.name, s]));
  const rows = [...g.players].sort((a, b) => b.winner - a.winner);
  const best = Object.fromEntries(STAT_COLUMNS.map(([k]) => [k, Math.max(0, ...sum.stats.map((s) => s[k]))]));
  const total = (k) => sum.stats.reduce((n, s) => n + s[k], 0);
  const kpi = (v, l) => `<div class="st-kpi"><b>${v}</b>${l}</div>`;
  const body = rows.map((p) => {
    const s = byName[p.name] || {};
    return `<tr class="${p.winner ? 'win' : 'lose'} ${p.name === ME ? 'st-me' : ''}">
      <td><div class="st-player"><span class="st-av">${playerAvatarHTML(p)}</span>
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
    <div class="result-foot"><button type="button" class="btn ghost" data-step="contrib">← Đóng góp</button><span></span>
      ${resultFinalButtonsHTML()}</div>`;
}

function resultMainHTML(g, won, team) {
  const names = { Sheriff: 'Sheriff & Deputy', Outlaw: 'Outlaw', Renegade: 'Renegade' };
  return `<h2 id="resultHeadline" class="result-headline">${!g.me ? 'KẾT QUẢ VÁN ĐẤU' : won ? 'CHIẾN THẮNG' : 'THUA CUỘC'}</h2>
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

// Màn kết thúc: ① Kết quả → ② Danh hiệu → ③ Diễn biến → ④ Đóng góp → ⑤ Thống kê (nút Tiếp tục đi lần lượt)
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
    if (ROOM && !ROOM.game) renderWaiting(); // hiện nút "Xem lại kết quả ván trước"
    ($('#resetBtn') || $('#leaveBtn'))?.focus();
  };
  const show = (step) => {
    ui.resultStep = step;
    dialog.dataset.step = step;
    const render = { awards: resultAwardsHTML, timeline: resultTimelineHTML, contrib: resultContribHTML, stats: resultStatsHTML }[step];
    const html = render ? render(g, won) : resultMainHTML(g, won, team);
    dialog.innerHTML = `<div class="result-frame step-${step}"><div class="result-body">${html}</div></div>`;
    dialog.scrollTop = 0;
    // Diễn biến: bấm số / vệt sáng trên biểu đồ → cuộn tới lượt tương ứng trong danh sách; rê chuột → ô tỉ lệ thắng
    dialog.querySelectorAll('.wt-mk').forEach((mk) => {
      mk.onclick = () => {
        const ev = dialog.querySelector(`#wtEv${mk.dataset.ev}`);
        dialog.querySelectorAll('.wt-ev.hl').forEach((e) => e.classList.remove('hl'));
        ev?.classList.add('hl');
        ev?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      };
    });
    wireWinChart(dialog);
    dialog.querySelectorAll('[data-step]').forEach((b) => { b.onclick = () => show(b.dataset.step); });
    const close = dialog.querySelector('[data-close]');
    if (close) close.onclick = dismiss;
    const reset = dialog.querySelector('[data-reset]');
    // Phòng còn giữ ván đã xong → đưa phòng về phòng chờ; phòng đã về rồi → chỉ đóng màn của mình.
    if (reset) reset.onclick = () => { dismiss(); if (ROOM.game?.winner) $('#resetBtn')?.click(); };
    (dialog.querySelector('.result-continue') || dialog.querySelector('[data-close]'))?.focus();
    fitMatchResult(dialog);
  };
  dialog.refresh = () => show(ui.resultStep || 'result'); // vẽ lại nút cuối khi phòng vừa về phòng chờ
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

const PROJECTILE_ROTATION = { bullet: 90, fist: 90, knife: 49 };

function showCombatEffects(game, previous) {
  if (!previous) return false;
  const lastSeq = previous.combatEffects?.at(-1)?.seq ?? 0;
  const events = (game.combatEffects || []).filter((event) => event.seq > lastSeq);
  if (!events.length) return false;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const centers = game.players.map((_, index) => combatAvatarCenter(game, index));
  const place = (tag, className, { x, y }) => {
    const node = document.createElement(tag);
    node.className = `combat-fx ${className}`;
    node.setAttribute('aria-hidden', 'true');
    Object.assign(node.style, { left: `${x}px`, top: `${y}px` });
    app.appendChild(node);
    return node;
  };
  const animate = (node, frames, duration) => {
    const animation = node.animate(frames, { duration, fill: 'both' });
    animation.onfinish = animation.oncancel = () => node.remove();
  };
  let showedDamage = false;
  for (const event of events) {
    if (event.type === 'shot' && !reducedMotion) {
      const from = centers[event.source], to = centers[event.target];
      if (!from || !to) continue;
      const dx = to.x - from.x, dy = to.y - from.y;
      const distance = Math.hypot(dx, dy);
      const duration = Math.max(180, Math.min(380, distance * .55));
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;
      const projectile = Object.hasOwn(PROJECTILE_ROTATION, event.projectile) ? event.projectile : 'bullet';
      const image = place('img', 'combat-projectile', from);
      image.alt = '';
      image.src = `/effects/${projectile}.png`;
      image.dataset.projectile = projectile;
      const rotate = `translate(-50%, -50%) rotate(${angle + PROJECTILE_ROTATION[projectile]}deg)`;
      animate(image, [
        { transform: rotate },
        { transform: `translate(${dx}px, ${dy}px) ${rotate}` },
      ], duration);
    } else if (event.type === 'damage' && centers[event.player]) {
      const impact = place('div', 'combat-impact', centers[event.player]);
      impact.textContent = `−${event.amount}`;
      if (reducedMotion) setTimeout(() => impact.remove(), DAMAGE_EFFECT_MS);
      else animate(impact, [
        { transform: 'translate(-50%, -50%) scale(.65)', opacity: .65 },
        { transform: 'translate(-50%, -50%) scale(1.12)', opacity: 1, offset: .22 },
        { transform: 'translate(-50%, -60%) scale(1)', opacity: 1, offset: .7 },
        { transform: 'translate(-50%, -72%) scale(.95)', opacity: 0 },
      ], DAMAGE_EFFECT_MS);
      showedDamage = true;
    }
  }
  return showedDamage;
}

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
  if (!g.me) return;
  const main = $('#mainArea');
  const pend = g.pending;
  const infoBtn = $('#meInfoToggle');
  if (infoBtn) infoBtn.onclick = () => { ui.meInfo = !ui.meInfo; renderGame(); };

  main.querySelectorAll('#hand .card').forEach((el) => el.onclick = run(async () => {
    const id = Number(el.dataset.card);
    const c = g.me.hand.find((x) => x.id === id);
    if (ui.mode && ['discard', 'sid', 'skill', 'valleyDiscard'].includes(ui.mode.kind)) {
      if (!isClickable(c, g, meP)) return;
      let max = 2;
      if (ui.mode.kind === 'discard') max = discardExcess(g, meP);
      if (ui.mode.kind === 'skill') max = skillCardCount(ui.mode.skill);
      if (ui.mode.kind === 'valleyDiscard') max = pend.count;
      if (ui.selected.includes(id)) ui.selected = ui.selected.filter((x) => x !== id);
      else if (ui.selected.length < max) ui.selected.push(id);
      else if (max === 1 && ui.mode.kind === 'skill') ui.selected = [id];
      return renderGame();
    }
    if (myPrompt && ['bang', 'indians', 'duel'].includes(pend.type)) {
      if (!isClickable(c, g, meP)) return toast(pend.type === 'bang' ? 'Lá này không thể dùng để né đòn.' : 'Cần lá Bang!.');
      return sendAction({ type: 'respond', cardId: id });
    }
    if (!canPlay) return toast(myPrompt ? 'Hãy xử lý yêu cầu ở giữa bàn trước.' : 'Chưa đến lượt bạn.');
    if (ui.mode?.kind === 'aim' || ui.mode?.kind === 'asBang') {
      if (!isClickable(c, g, meP)) return;
      ui.mode = ui.mode.kind === 'aim' ? { kind: 'target', cardId: ui.mode.cardId, bangCardId: id }
        : { kind: 'target', cardId: id, asBang: true };
      return renderGame();
    }
    if (ui.mode?.kind === 'cost') {
      const cardId = ui.mode.cardId;
      if (id === cardId) { ui.mode = null; return renderGame(); }
      const paidCard = g.me.hand.find((card) => card.id === cardId);
      if (cardInfo(paidCard).effect === 'discardAll') {
        ui.mode = { kind: 'brawl', cardId, costCardId: id, choices: new Map() };
        return renderGame();
      }
      if (targetFilter(paidCard, g, meP)) {
        ui.mode = { kind: 'target', cardId, costCardId: id };
        return renderGame();
      }
      ui.mode = null;
      return sendAction({ type: 'play', cardId, costCardId: id });
    }
    if (ui.mode?.kind === 'target' && ui.mode.cardId === id) { ui.mode = null; return renderGame(); }
    if (!isClickable(c, g, meP)) {
      const nm = effectiveName(c, meP);
      if (nm === 'Missed') return toast('Missed! chỉ dùng khi bị bắn.');
      if (nm === 'Bang') return toast(g.bangsPlayed >= 1 ? 'Mỗi lượt chỉ được 1 Bang!.' : 'Không có ai trong tầm bắn.');
      if (nm === 'Beer') return toast('Không dùng Beer được lúc này.');
      return toast('Không dùng được lá này lúc này.');
    }
    if (cardInfo(c).discardCost) { ui.mode = { kind: 'cost', cardId: id }; return renderGame(); }
    if (c.name === 'Aim') { ui.mode = { kind: 'aim', cardId: id }; return renderGame(); }
    if (targetFilter(c, g, meP)) {
      if (c.name === 'Bang') gameAudio.play('bangload');
      ui.mode = { kind: 'target', cardId: id };
      return renderGame();
    }
    ui.mode = null;
    await sendAction({ type: 'play', cardId: id });
  }));
  main.querySelectorAll('#hand .card[aria-pressed]').forEach((el) => el.onkeydown = (event) => {
    if (!['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    el.click();
    main.querySelector(`#hand [data-card="${el.dataset.card}"]`)?.focus();
  });

  main.querySelectorAll('.player').forEach((el) => el.onclick = run(async () => {
    if (myPrompt && pend.type === 'draw' && pend.options.includes('evelyn')) {
      const target = g.players.find((p) => p.name === el.dataset.player);
      if (target && docTarget(target, g)) return sendAction({ type: 'drawChoice', from: 'evelyn', target: target.name });
      return;
    }
    if (myPrompt && pend.type === 'draw' && pend.options.includes('player')) {
      const target = g.players.find((p) => p.name === el.dataset.player);
      if (!target?.alive || target.name === ME || !target.handCount) return;
      return sendAction({ type: 'drawChoice', from: 'player', target: target.name });
    }
    if (ui.mode?.kind === 'skill' && targetedSkill(ui.mode.skill) && ui.selected.length === skillCardCount(ui.mode.skill)) {
      const target = g.players.find((p) => p.name === el.dataset.player);
      if (!docTarget(target, g)) return;
      const cardIds = ui.selected;
      ui.mode = null; ui.selected = [];
      return sendAction({ type: 'skill', cardIds, target: target.name });
    }
    if (ui.mode?.kind !== 'target') return;
    const p = g.players.find((x) => x.name === el.dataset.player);
    const card = targetingCard(g, meP);
    const { asBang, bangCardId, costCardId } = ui.mode;
    const tf = asBang ? (q) => docTarget(q, g) : card && targetFilter(card, g, meP);
    if (!tf || !tf(p)) return toast('Không chọn được người này.');
    const nm = effectiveName(card, meP);
    const type = ui.mode.activate ? 'activate' : 'play';
    if (!asBang && nm === 'Fanning' && new Map(g.me.fanningTargets).get(p.name)?.length) {
      ui.mode = { kind: 'fanning', cardId: card.id, target: p.name };
      return renderGame();
    }
    if (!asBang && (nm === 'Panic' || nm === 'Cat Balou' || ['take', 'discard'].includes(cardInfo(card).effect))) {
      if (!p.eq.length) { ui.mode = null; return sendAction({ type, cardId: card.id, costCardId, target: p.name, targetCard: 'hand' }); }
      return chooseTargetCard(card, p, type, costCardId);
    }
    ui.mode = null;
    await sendAction({ type, cardId: card.id, costCardId, target: p.name, asBang, bangCardId });
  }));

  const deckEl = main.querySelector('#deck.ready');
  if (deckEl) deckEl.onclick = run(async () => {
    deckEl.classList.remove('ready');
    if (pend.type !== 'draw') return sendAction({ type: 'checkDraw' });
    return sendAction({ type: 'drawChoice', from: pend.options.includes('deckOne') ? 'deckOne' : 'deck' });
  });
  main.querySelectorAll('.player[role="button"], #deck[role="button"]').forEach((el) => el.onkeydown = (event) => {
    if (!['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    el.click();
  });
  const discardEl = main.querySelector('#discardPile.draw-source');
  if (discardEl) discardEl.onclick = run(() => sendAction({ type: 'drawChoice', from: 'discard' }));

  main.querySelectorAll('#kitCards .kit-choice').forEach((el) => el.onclick = () => {
    if (!myPrompt || pend.type !== 'kit') return;
    const id = Number(el.dataset.kitId);
    if (ui.selected.includes(id)) ui.selected = ui.selected.filter((x) => x !== id);
    else if (ui.selected.length < 2) ui.selected.push(id);
    renderGame();
  });
  main.querySelectorAll('[data-brawl-target]').forEach((el) => el.onchange = () => {
    if (ui.mode?.kind === 'brawl') ui.mode.choices.set(el.dataset.brawlTarget, el.value);
  });

  main.querySelectorAll('[data-act]').forEach((el) => el.onclick = run(async (event) => {
    const act = el.dataset.act;
    if (act === 'cancel') { ui.mode = null; ui.selected = []; return renderGame(); }
    if (act === 'asBang') { ui.mode = { kind: 'asBang' }; return renderGame(); }
    if (act === 'secondTarget' && ui.mode?.kind === 'fanning') {
      const { cardId, target } = ui.mode;
      ui.mode = null;
      return sendAction({ type: 'play', cardId, target, secondTarget: el.dataset.owner });
    }
    if (['escape', 'saved', 'lemonade'].includes(act)) {
      return sendAction({ type: act, cardId: Number(el.dataset.cardId), from: el.dataset.from, target: el.dataset.owner });
    }
    if (act === 'valleyDiscard') {
      if (ui.mode?.kind !== 'valleyDiscard' || ui.selected.length !== pend.count) return;
      return sendAction({ type: act, cardIds: [...ui.selected] });
    }
    if (act === 'confirmBrawl' && ui.mode?.kind === 'brawl') {
      const { cardId, costCardId } = ui.mode;
      const targets = [...main.querySelectorAll('[data-brawl-target]')].map((select) => ({
        target: select.dataset.brawlTarget, targetCard: select.value === 'hand' ? 'hand' : Number(select.value),
      }));
      return sendAction({ type: 'play', cardId, costCardId, targets });
    }
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

function chooseTargetCard(card, p, type, costCardId) {
  const modal = $('#modal');
  modal.innerHTML = `<div class="panel"><h3>${esc(card.name)}: chọn lá của ${esc(p.name)}</h3>
    <div class="row">
      ${p.handCount ? `<button class="btn" data-tc="hand">🂠 1 lá ngẫu nhiên trên tay (${p.handCount})</button>` : ''}
      ${p.eq.map((c) => {
        const info = cardInfo(c);
        return `<button class="btn ${info.type === 'green' ? 'green' : 'blue'}" data-tc="${c.id}" ${tooltipAttrs(c.name, info.desc)}>${CARD_ART.has(c.name) ? `<img class="btn-art" src="${cardArtSrc(c.name)}" alt="">` : info.icon} ${esc(c.name)}</button>`;
      }).join('')}
    </div>
    <div class="row" style="margin-top:14px"><button class="btn secondary small" data-tc="cancel">Huỷ</button></div></div>`;
  modal.classList.remove('hidden');
  modal.querySelectorAll('[data-tc]').forEach((b) => b.onclick = run(async () => {
    modal.classList.add('hidden');
    if (b.dataset.tc === 'cancel') return;
    ui.mode = null;
    await sendAction({ type, cardId: card.id, costCardId, target: p.name, targetCard: b.dataset.tc === 'hand' ? 'hand' : Number(b.dataset.tc) });
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

// Phần khởi động cho tools/demo-capsule-table.js — nối sau các hàm của app.js (bàn + pop-up là code thật). Có sẵn: demoViews.

let demoN = 6;
function demoShow(n) {
  clearInterval(demoTimer);
  demoN = n;
  const view = structuredClone(demoViews[n]);
  if (new URLSearchParams(location.search).get('equipment') === '7') {
    view.players.forEach((player, index) => {
      player.eq = ['Volcanic', 'Barrel', 'Mustang', 'Scope', 'Jail', 'Dynamite', 'Hideout']
        .map((name, i) => ({ id: 99000 + index * 10 + i, name, suit: 'S', rank: 'K' }));
    });
    view.discardRecent = ['Bang', 'Missed', 'Beer'].map((name, i) => ({ id: 99100 + i, name, suit: 'H', rank: '7' }));
    view.discardTop = view.discardRecent[view.discardRecent.length - 1];
  }
  ME = view.players[view.me.index].name;
  ROOM = {
    code: 'DEMO', name: 'Saloon miền Tây', host: ME, game: view, online: view.players.map((p) => p.name),
    chat: [{ system: true, text: 'Ván đấu bắt đầu!' }], timer: { deadline: Date.now() + 25000, player: view.turn, seconds: 30 },
  };
  renderRoom();
  demoBar.querySelectorAll('[data-n]').forEach((b) => b.classList.toggle('on', +b.dataset.n === n));
}
const first = structuredClone(demoViews[demoN]);
ME = first.players[first.me.index].name;
ROOM = { code: 'DEMO', name: 'Saloon miền Tây', host: ME, game: first, online: first.players.map((p) => p.name), chat: [{ system: true, text: 'Ván đấu bắt đầu!' }] };
enterRoom('DEMO');
closeStreams(); // demo không có server phòng thật
document.querySelector('#userbox').textContent = 'Bản nháp · Không cần đăng nhập';
const demoBar = document.createElement('div');
demoBar.className = 'demo-bar';
demoBar.innerHTML = `<strong>DEMO BÀN CHƠI</strong>
  ${[4, 5, 6, 7, 8].map((n) => `<button data-n="${n}">${n} người</button>`).join('')}
  <button data-other>Đổi người đang đánh</button>
  <button data-pop="Indians">🏹 Indians</button><button data-pop="Gatling">🔫 Gatling</button><button data-pop="store">🏪 General Store</button>`;

// ---- pop-up giữa bàn (code thật renderMassPopup/renderStorePopup), dữ liệu giả lập phát từng bước ----
let demoTimer = null, demoCardId = 90000;
const demoCard = (name, suit = 'S', rank = 'K') => ({ id: demoCardId++, name, suit, rank });
function demoPopup(kind) {
  clearInterval(demoTimer);
  const g = ROOM.game, n = g.players.length, me = g.me.index;
  const by = (me + 2) % n; // người đánh: không phải mình để thấy cả lúc mình phản hồi / chọn
  const after = Array.from({ length: n - 1 }, (_, k) => (by + 1 + k) % n);
  g.pending = null;
  const now = () => Date.now() + (ui.serverOffset || 0);
  if (kind === 'store') {
    const pool = ['Beer', 'Bang', 'Missed', 'Panic', 'Barrel', 'Saloon', 'Stagecoach', 'Cat Balou'];
    const order = [by, ...after];
    g.mass = null;
    g.store = { seq: demoCardId, by, card: demoCard('General Store', 'C', '9'), order, revealed: order.map((_, k) => demoCard(pool[k % pool.length], k % 2 ? 'H' : 'S', String(k + 2))), picks: [], t: now(), t0: now() };
    const step = () => {
      const s = ROOM.game.store, left = s.revealed.filter((c) => !s.picks.some((p) => p.card.id === c.id));
      const who = s.order[s.picks.length];
      if (who == null) { clearInterval(demoTimer); ROOM.game.pending = null; s.t = now(); renderRoom(); return; }
      ROOM.game.pending = { type: 'store', player: who };
      if (who === me) { clearInterval(demoTimer); renderRoom(); return; } // chờ bạn bấm lá trên pop-up
      s.picks.push({ i: who, card: left[0] });
      renderRoom();
    };
    // mình bấm lá trên quầy: xử lý tại chỗ thay vì gửi lên server
    api = async (path, { action: a } = {}) => {
      const s = ROOM.game.store;
      if (a?.type !== 'pick' || ROOM.game.pending?.player !== me) return;
      s.picks.push({ i: me, card: s.revealed.find((c) => c.id === a.cardId) });
      ROOM.game.pending = null;
      renderRoom();
      demoTimer = setInterval(step, 1100);
      setTimeout(step, 50);
    };
    ROOM.game.pending = { type: 'store', player: by };
    renderRoom();
    demoTimer = setInterval(step, 1100);
    return;
  }
  const results = kind === 'Indians'
    ? [{ card: demoCard('Bang') }, { hurt: 1 }, { card: demoCard('Bang', 'H', 'A') }, { hurt: 1 }, { card: demoCard('Bang', 'D', '7') }, { hurt: 1 }, { card: demoCard('Bang') }]
    : [{ barrel: true }, { card: demoCard('Missed', 'C', '10') }, { hurt: 1 }, { card: demoCard('Missed') }, { hurt: 1 }, { card: demoCard('Missed', 'D', '4') }, { hurt: 1 }];
  g.store = null;
  g.mass = { seq: demoCardId, by, card: demoCard(kind, kind === 'Indians' ? 'D' : 'H', kind === 'Indians' ? 'K' : '10'), targets: after.map((i) => ({ i, res: null })), t: now(), t0: now() };
  let k = 0;
  renderRoom();
  demoTimer = setInterval(() => {
    const m = ROOM.game.mass;
    if (k >= m.targets.length) return clearInterval(demoTimer);
    m.targets[k].res = results[k % results.length];
    m.t = now();
    k++;
    renderRoom();
  }, 900);
}
document.querySelector('.room-head > .row').appendChild(demoBar);

demoBar.onclick = (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.pop) demoPopup(b.dataset.pop);
  else if (b.dataset.n) { clearInterval(demoTimer); demoShow(+b.dataset.n); }
  else {
    const g = ROOM.game;
    g.turn = (g.turn + 1) % g.players.length;
    ROOM.timer = { deadline: Date.now() + 25000, player: g.turn, seconds: 30 };
    renderRoom();
  }
};
demoShow(demoN);

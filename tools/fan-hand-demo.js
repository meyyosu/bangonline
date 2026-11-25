// Phần khởi động cho tools/demo-fan-hand.js — nối sau các hàm của app.js (giao diện ván + xoè bài đều là code thật). Có sẵn: demoViews.
// Bật/tắt xoè bài · khung bài ở ⚙️ Cài đặt như trong game.

let demoSize = 7;
function demoShow(k) {
  demoSize = k;
  const view = structuredClone(demoViews[k]);
  ME = view.players[view.me.index].name;
  ROOM = {
    code: 'DEMO', name: 'Saloon miền Tây', host: ME, game: view, online: view.players.map((p) => p.name),
    chat: [{ system: true, text: 'Ván đấu bắt đầu!' }], timer: { deadline: Date.now() + 25000, player: view.turn, seconds: 30 },
  };
  ui.mode = null; ui.selected = [];
  renderRoom();
  demoBar.querySelectorAll('[data-k]').forEach((b) => b.classList.toggle('on', +b.dataset.k === demoSize));
}
const first = structuredClone(demoViews[demoSize]);
ME = first.players[first.me.index].name;
ROOM = { code: 'DEMO', name: 'Saloon miền Tây', host: ME, game: first, online: first.players.map((p) => p.name), chat: [{ system: true, text: 'Ván đấu bắt đầu!' }] };
enterRoom('DEMO');
closeStreams(); // demo không có server phòng thật
document.querySelector('#userbox').textContent = 'Bản nháp · Không cần đăng nhập';

// Không có server: đánh lá nào thì bỏ lá đó ra chồng bài bỏ, còn lại bỏ qua
api = async (_path, { action } = {}) => {
  const g = ROOM.game, id = action?.cardId;
  const i = g.me.hand.findIndex((c) => c.id === id);
  if (i < 0) return;
  const [c] = g.me.hand.splice(i, 1);
  g.players[g.me.index].handCount = g.me.hand.length;
  g.discardRecent = [...(g.discardRecent || []), c].slice(-3);
  g.discardTop = c;
  g.log.push(`${ME} đánh ${c.name}.`);
  ui.mode = null; ui.selected = [];
  renderRoom();
};

const demoBar = document.createElement('div');
demoBar.className = 'demo-bar';
demoBar.innerHTML = `<strong>DEMO TAY BÀI · 8 người</strong>
  ${[4, 7, 10].map((k) => `<button data-k="${k}">${k} lá</button>`).join('')}
  <button data-draw>Rút 1 lá</button>
  <span>Bật/tắt xoè bài · khung bài: ⚙️ Cài đặt</span>`;
document.querySelector('.room-head > .row').appendChild(demoBar);
demoBar.onclick = (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.k) demoShow(+b.dataset.k);
  else if (b.hasAttribute('data-draw')) {
    const g = ROOM.game, pool = ['Bang!', 'Missed!', 'Beer', 'Panic!', 'Cat Balou', 'Stagecoach', 'Barrel', 'Duel'].filter((n) => META.cards[n]);
    const name = pool[Math.floor(Math.random() * pool.length)] || 'Bang!';
    g.me.hand.push({ id: 80000 + Math.floor(Math.random() * 9999), name, suit: 'HDCS'[Math.floor(Math.random() * 4)], rank: String(2 + Math.floor(Math.random() * 9)) });
    g.players[g.me.index].handCount = g.me.hand.length;
    renderRoom();
  }
};
demoShow(demoSize);

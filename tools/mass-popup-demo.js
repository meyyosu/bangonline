// Phần khởi động cho tools/demo-mass-popup.js — nối sau các hàm của app.js.
// demoScenes[key] = các trạng thái game (viewFor) lần lượt: trước khi đánh, sau khi đánh, sau mỗi người phản hồi.
let demo = null, demoTimer = null;

function demoShow(view) {
  const previous = ROOM.game;
  ROOM.game = structuredClone(view);
  renderRoom();
  showPlayedCards(ROOM.game, previous, {});
  showCardTransfers(ROOM.game, previous, []);
}
function demoStart(key) {
  clearInterval(demoTimer);
  clearTimeout(ui.mass?.timer);
  ui.mass = null;
  demo = { views: demoScenes[key], k: 0 };
  ROOM.game = structuredClone(demo.views[0]);
  renderRoom();
  demoTimer = setTimeout(() => {
    demoStep();
    if (document.querySelector('#mpAuto').checked) demoTimer = setInterval(demoStep, 1300);
  }, 400);
}
function demoStep() {
  if (!demo || demo.k >= demo.views.length - 1) return clearInterval(demoTimer);
  demoShow(demo.views[++demo.k]);
}

const first = demoScenes.indians[0];
ME = first.players[first.me.index].name;
ROOM = {
  code: 'DEMO', name: 'Saloon miền Tây', host: ME, game: structuredClone(first), online: first.players.map((p) => p.name),
  chat: [{ system: true, text: 'Ván đấu bắt đầu!' }, { user: first.players[1].name, text: 'cẩn thận Indians nhé 😂' }],
};
// Dựng phòng y như khi chơi thật (enterRoom + renderRoom của app.js), chỉ thêm thanh điều khiển demo
enterRoom('DEMO');
closeStreams(); // demo không có server phòng thật
renderRoom();
document.querySelector('#userbox').textContent = 'Bản xem thử · Không cần đăng nhập';
const demoBar = document.createElement('div');
demoBar.className = 'demo-bar';
demoBar.innerHTML = `<strong>DEMO POP-UP</strong>
    <button data-mp="indians">🪶 Indians</button><button data-mp="gatling">🔫 Gatling</button>
    <button data-mp="step">Người tiếp theo trả lời ▶</button><button data-mp="all">Hiện hết</button>
    <label style="margin:0;display:flex;gap:6px;align-items:center;font-weight:400"><input type="checkbox" id="mpAuto" checked> tự chạy</label>`;
document.querySelector('.room-head > .row').appendChild(demoBar); // #roomBtns bị renderRoom() vẽ lại
demoBar.addEventListener('click', (e) => {
  const b = e.target.closest('[data-mp]');
  if (!b) return;
  if (b.dataset.mp === 'step') { clearInterval(demoTimer); demoStep(); }
  else if (b.dataset.mp === 'all') { clearInterval(demoTimer); if (demo) { demo.k = demo.views.length - 2; demoStep(); } }
  else demoStart(b.dataset.mp);
});
setTimeout(() => demoStart('indians'), 600);

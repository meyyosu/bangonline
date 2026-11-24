// Phần khởi động cho tools/demo-store-popup.js — nối sau các hàm của app.js.
// Pop-up là code thật (renderStorePopup); demo chỉ thay server phòng bằng server demo.
async function demoFetch(url) {
  const d = await (await fetch(url)).json();
  if (d.error) toast(d.error);
  const previous = ROOM.game;
  ROOM.game = d.view;
  renderRoom();
  showPlayedCards(ROOM.game, previous, {});
}
// Hành động chọn lá (từ pop-up) đi qua api(): chuyển sang server demo
api = async (p, body) => {
  if (body?.action?.type === 'pick') return demoFetch(`/demo/pick?id=${body.action.cardId}`);
  toast('Bản demo chỉ thử General Store.');
};

ROOM = { code: 'DEMO', name: 'Saloon miền Tây', host: '', game: null, online: [], chat: [{ system: true, text: 'Ván đấu bắt đầu!' }] };
(async () => {
  const d = await (await fetch('/demo/state')).json();
  ME = d.view.players[d.view.me.index].name;
  Object.assign(ROOM, { game: d.view, host: ME, online: d.view.players.map((p) => p.name) });
  enterRoom('DEMO');
  closeStreams(); // demo không có server phòng thật
  renderRoom();
  document.querySelector('#userbox').textContent = 'Bản xem thử · Không cần đăng nhập';
  const bar = document.createElement('div');
  bar.className = 'demo-bar';
  bar.innerHTML = `<strong>DEMO GENERAL STORE</strong><button data-reset>🏪 Mở chợ mới</button>
    <label style="margin:0;display:flex;gap:6px;align-items:center;font-weight:400"><input type="checkbox" id="spAuto" checked> bot tự chọn</label>`;
  document.querySelector('.room-head > .row').appendChild(bar);
  bar.querySelector('[data-reset]').onclick = () => demoFetch('/demo/reset');
  setInterval(() => {
    const pend = ROOM.game.pending;
    if (document.querySelector('#spAuto').checked && pend?.type === 'store' && pend.player !== ROOM.game.me.index) demoFetch('/demo/bot');
  }, 1400);
})();

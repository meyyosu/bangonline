// Phần khởi động cho tools/demo-turn-ring.js — nối sau các hàm của app.js (vòng đếm ngược là code thật: renderTurnRing/updateTurnRing). Có sẵn: demoView.
let demoTotal = 30;
function demoStart(total, left = total) {
  demoTotal = total;
  ROOM.timer = { deadline: Date.now() + left * 1000, player: ROOM.game.turn, seconds: total };
  renderRoom();
}
ME = demoView.players[demoView.me.index].name;
ROOM = {
  code: 'DEMO', name: 'Saloon miền Tây', host: ME, game: structuredClone(demoView), online: demoView.players.map((p) => p.name),
  chat: [{ system: true, text: 'Ván đấu bắt đầu!' }],
};
enterRoom('DEMO');
closeStreams(); // demo không có server phòng thật
document.querySelector('#userbox').textContent = 'Bản xem thử · Không cần đăng nhập';
const demoBar = document.createElement('div');
demoBar.className = 'demo-bar';
demoBar.innerHTML = `<strong>DEMO VÒNG ĐẾM NGƯỢC</strong>
  <button data-t="30">Lượt 30 giây</button><button data-t="15">Lượt 15 giây</button>
  <button data-last="12">Nhảy tới 12 giây cuối</button><button data-other>Đổi người đang đánh</button>`;
document.querySelector('.room-head > .row').appendChild(demoBar);
demoBar.onclick = (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.t) demoStart(+b.dataset.t);
  else if (b.dataset.last) demoStart(demoTotal, +b.dataset.last);
  else { ROOM.game.turn = (ROOM.game.turn + 1) % ROOM.game.players.length; demoStart(demoTotal); }
};
// hết giờ thì tự quay lại từ đầu cho dễ xem
setInterval(() => { if (ROOM.timer && ROOM.timer.deadline < Date.now() - 1500) demoStart(demoTotal); }, 500);
demoStart(30);

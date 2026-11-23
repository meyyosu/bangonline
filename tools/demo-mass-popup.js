'use strict';
// Xem thử pop-up đánh chung (Indians / Gatling) trên bàn chơi thật.
// Server tự chơi các nước bằng luật thật (game.act) rồi gửi từng trạng thái cho trang phát lại như nhận SSE.
// Chạy: node tools/demo-mass-popup.js rồi mở http://localhost:3009
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Game, CARD_INFO, CHAR_INFO, ROLE_INFO } = require('../game');
const publicDir = path.resolve(__dirname, '../public');
const names = ['CaoBoiMienTay', 'ThanhXaThu99', 'HoangHonDo', 'TuongCuopSaMac', 'BongMaThungLung', 'SieuDaoChich', 'KeHaiMat_VN'];

// plan: cách từng người (theo thứ tự sau người đánh) phản hồi
function buildScene(cardName, plan) {
  let seed = 7;
  const rng = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const game = new Game(names, { rng });
  const P = game.players;
  const pull = (pred) => {
    const i = game.deck.findIndex(pred);
    return i >= 0 ? game.deck.splice(i, 1)[0] : game.discard.splice(game.discard.findIndex(pred), 1)[0];
  };
  game.pending = null; game.queue = []; game.phase = 'play';
  const shooter = game.turn;
  P[2].eq.push(pull((c) => c.name === 'Mustang'), pull((c) => c.name === 'Schofield'));
  P[4].eq.push(pull((c) => c.name === 'Volcanic'));
  const card = pull((c) => c.name === cardName);
  P[shooter].hand.push(card);
  const targets = Array.from({ length: P.length - 1 }, (_, k) => (shooter + 1 + k) % P.length);
  const me = targets[2];
  const steps = [];
  targets.forEach((ti, k) => {
    const t = P[ti], how = plan[k];
    t.hand = t.hand.filter((c) => !['Bang', 'Missed', 'Beer'].includes(c.name) || (game.discard.push(c), false));
    if (how === 'Bang' || how === 'Missed') {
      const c = pull((x) => x.name === how);
      t.hand.push(c);
      steps.push([t.name, { type: 'respond', cardId: c.id }]);
    } else if (how === 'barrel') {
      t.eq.push(pull((c) => c.name === 'Barrel'));
      steps.push([t.name, { type: 'barrel' }], [t.name, { type: 'checkDraw', heart: true }]);
    } else {
      if (how === 'dead') { t.hp = 1; game.discard.push(...t.hand.splice(0)); }
      else t.hp = Math.max(t.hp, 2);
      steps.push([t.name, { type: 'take' }]);
    }
  });
  const views = [];
  const snap = () => views.push(game.viewFor(P[me].name));
  snap();
  game.act(P[shooter].name, { type: 'play', cardId: card.id });
  snap();
  for (const [name, a] of steps) {
    if (a.heart) { const h = pull((c) => c.suit === 'H'); game.deck.push(h, pull((c) => c.suit === 'H')); delete a.heart; }
    game.act(name, a);
    snap();
  }
  return views;
}

const scenes = {
  indians: buildScene('Indians', ['Bang', 'Bang', 'take', 'take', 'dead', 'Bang']),
  gatling: buildScene('Gatling', ['barrel', 'Missed', 'take', 'Missed', 'take', 'Missed']),
};
const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8'); // đọc lại mỗi lần tải trang
const header = `
META = ${JSON.stringify({ cards: CARD_INFO, chars: CHAR_INFO, roles: ROLE_INFO })};
const demoScenes = ${JSON.stringify(scenes)};
`;

const port = Number(process.env.DEMO_PORT) || 3009;
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/demo-mass-app.js') {
    const source = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(source.slice(0, source.indexOf('(async function init()')) + header + read('mass-popup-demo.js'));
  }
  if (url.pathname === '/') {
    const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8')
      .replace('/app.js', '/demo-mass-app.js')
      .replace('</head>', `<style>${read('mass-popup-demo.css')}</style></head>`);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(html);
  }
  const file = path.resolve(publicDir, '.' + decodeURIComponent(url.pathname));
  if (!file.startsWith(publicDir + path.sep)) { res.writeHead(404); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': { '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.js': 'text/javascript; charset=utf-8' }[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(port, '127.0.0.1', () => console.log('Demo pop-up: http://localhost:' + port));

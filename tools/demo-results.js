'use strict';
// Local preview using the production result renderer; no accounts or room changes.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Game, CARD_INFO, CHAR_INFO, ROLE_INFO } = require('../game');
const publicDir = path.resolve(__dirname, '../public');
const names = ['CaoBoiMienTay', 'ThanhXaThu99', 'HoangHonDo', 'TuongCuopSaMac', 'BongMaThungLung', 'SieuDaoChich', 'KeHaiMat_VN'];
const roles = ['Sheriff', 'Deputy', 'Deputy', 'Outlaw', 'Outlaw', 'Outlaw', 'Renegade'];
const chars = ['Willy the Kid', 'Calamity Janet', 'Bart Cassidy', 'Slab the Killer', 'Jesse Jones', 'El Gringo', 'Vulture Sam'];
const game = new Game(names);
game.players.forEach((p, i) => { p.name = names[i]; p.role = roles[i]; p.char = chars[i]; });
game.pending = null;
game.phase = 'play';
const samples = {};
for (const winner of ['Sheriff', 'Outlaw', 'Renegade']) {
  game.winner = winner;
  game.players.forEach((p, i) => {
    p.alive = winner === 'Sheriff' ? i < 2 : winner === 'Outlaw' ? i === 3 || i === 6 : i === 6;
    p.hp = p.alive ? 2 : 0;
  });
  samples[winner] = Object.fromEntries([0, 3, 6].map((i) => [roles[i], game.viewFor(names[i])]));
}
const bootstrap = `
META = ${JSON.stringify({cards:CARD_INFO,chars:CHAR_INFO,roles:ROLE_INFO})};
const demoSamples = ${JSON.stringify(samples)};
let demoRole = 'Sheriff';
let demoWon = true;
function demoControls() {
  const controls = document.createElement('div');
  controls.className = 'demo-controls';
  controls.innerHTML = '<strong>DEMO KẾT THÚC TRẬN</strong><button data-outcome="win">Chiến thắng</button><button data-outcome="lose">Thua cuộc</button><select aria-label="Phe của bạn"><option value="Sheriff">Sheriff & Deputy</option><option value="Outlaw">Outlaw</option><option value="Renegade">Renegade</option></select><button data-replay>Xem lại kết quả</button>';
  controls.querySelector('select').value = demoRole;
  controls.querySelectorAll('[data-outcome]').forEach(b => {
    b.setAttribute('aria-pressed', String((b.dataset.outcome === 'win') === demoWon));
    b.onclick = () => { demoWon = b.dataset.outcome === 'win'; showDemo(); };
  });
  controls.querySelector('select').onchange = e => { demoRole = e.target.value; showDemo(); };
  controls.querySelector('[data-replay]').onclick = () => showDemo();
  return controls;
}
function showDemo() {
  clearMatchResult();
  const winner = demoWon ? demoRole : demoRole === 'Sheriff' ? 'Outlaw' : 'Sheriff';
  const g = structuredClone(demoSamples[winner][demoRole]);
  ME = g.players[g.me.index].name;
  ROOM = {code:'DEMO',name:'Saloon miền Tây · Ván demo',host:ME,game:g,online:namesForDemo(g)};
  app.innerHTML = '<div class="room"><div class="room-head"><h2>Saloon miền Tây · Ván demo 7 người</h2><span class="code">DEMO</span></div><div id="demoToolbar"></div><div id="mainArea"></div><div class="panel" style="margin-top:20px"><h3>Diễn biến trận đấu</h3><div id="logBox" class="log-box"></div></div></div>';
  document.querySelector('#demoToolbar').appendChild(demoControls());
  renderGame();
  renderMatchResult(g);
  document.querySelector('#matchResult').appendChild(demoControls());
  document.querySelector('#userbox').textContent = 'Bản xem thử · Không cần đăng nhập';
}
function namesForDemo(g) { return g.players.map(p => p.name); }
showDemo();
`;
const demoStyles = `<style>
.demo-controls { position: relative; display:flex; flex-wrap:wrap; align-items:center; justify-content:center; gap:8px; padding:10px; background:#1c1008f5; border:1px solid #ad792c; border-radius:10px; color:#fde68a; font-size:12px; }
.demo-controls button,.demo-controls select { padding:8px 10px; border:1px solid #8c6239; border-radius:6px; background:#382315; color:#fff; cursor:pointer; font:inherit; }
.demo-controls button[aria-pressed="true"] { background:#9a5b13; border-color:#facc15; }
.match-result > .demo-controls { position:fixed; top:10px; right:10px; left:10px; width:fit-content; max-width:calc(100% - 20px); margin-left:auto; }
.match-result .result-frame { padding-top:100px; }
@media(max-width:600px) { .demo-controls strong { width:100%; } .match-result .result-frame { padding-top:130px; } }
</style>`;
const port = Number(process.env.DEMO_PORT) || 3007;
const server = http.createServer((req,res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/demo-results-app.js') {
    const source = fs.readFileSync(path.join(publicDir,'app.js'),'utf8');
    res.writeHead(200, {'Content-Type':'text/javascript; charset=utf-8'});
    return res.end(source.slice(0, source.indexOf('(async function init()')) + bootstrap);
  }
  if (url.pathname === '/' || url.pathname === '/demo-results.html') {
    const html = fs.readFileSync(path.join(publicDir,'index.html'),'utf8').replace('/app.js','/demo-results-app.js').replace('</head>',demoStyles+'</head>');
    res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});return res.end(html);
  }
  const file = path.resolve(publicDir, '.' + decodeURIComponent(url.pathname));
  if (!file.startsWith(publicDir + path.sep)) { res.writeHead(404);return res.end(); }
  fs.readFile(file,(error,data)=>{
    if(error){res.writeHead(404);return res.end();}
    res.writeHead(200,{'Content-Type':{'.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.js':'text/javascript; charset=utf-8'}[path.extname(file)] || 'application/octet-stream'});res.end(data);
  });
});
server.listen(port,'127.0.0.1',()=>console.log('Demo: http://localhost:'+port+'/demo-results.html'));

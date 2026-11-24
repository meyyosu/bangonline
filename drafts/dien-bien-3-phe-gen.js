'use strict';
// Sinh ván bot cho nháp "Diễn biến 3 phe": chọn vài ván Renegade sống lâu, tính tỉ lệ thắng 3 phe
// cho từng hành động bằng hồi quy logistic (drafts/ty-le-thang.js + ty-le-thang-trong-so.json).
// Chạy: node drafts/dien-bien-3-phe-gen.js  → ghi drafts/dien-bien-3-phe-data.js
const path = require('path');
const fs = require('fs');
const { play } = require('./bot-ngau-nhien');
const TL = require('./ty-le-thang');
const POWER = require(path.join(__dirname, '..', 'power.js'));
const MODEL = JSON.parse(fs.readFileSync(path.join(__dirname, 'ty-le-thang-trong-so.json'), 'utf8'));
const OUT = path.join(__dirname, 'dien-bien-3-phe-data.js');

function pack(g, label) {
  const roles = g.players.map((p) => p.role);
  const maxHp = g.players.map((p) => p.maxHp);
  const T = g.timeline;
  const deaths = [];
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const prob = (ps) => TL.predict(MODEL, TL.snapshot(ps, g.tlStart, roles, maxHp));
  const r3p = (q) => ({ law: r3(q.law), out: r3(q.out), ren: r3(q.ren) });
  // Kịch bản "nếu Barrel ra ngược lại" — chỉ để đo độ hên/xui của lần rút Barrel:
  //  Barrel đỡ được → giả sử trượt: người rút mất 1 máu (sức mạnh trừ đúng giá trị máu đó theo power.js), còn 1 máu thì gục.
  //  Barrel trượt  → giả sử đỡ được: bàn giữ nguyên như lúc rút (chưa ai mất máu).
  const winnerIf = (alive) => {
    const has = (f) => alive.some((a, i) => a && TL.FAC[roles[i]] === f);
    // Sheriff chết: chỉ còn mỗi Renegade → Renegade thắng, còn lại → Outlaw thắng (luật Bang!)
    if (!alive[roles.indexOf('Sheriff')]) return alive.filter(Boolean).length === 1 && has('ren') ? 'ren' : 'out';
    if (!has('out') && !has('ren')) return 'law';
    return null;
  };
  const hurt = (ps, i) => {
    const q = ps.map((x) => [...x]), hp = q[i][0];
    if (hp <= 1) { q[i] = [0, 0, 0, q[i][3]]; return q; }
    const marg = hp === 2 ? POWER.W.hpSecond : POWER.W.hpRest; // máu thứ 2 quý hơn các máu sau
    q[i][0] = hp - 1; q[i][2] = Math.max(0, q[i][2] - marg * (roles[i] === 'Sheriff' ? POWER.W.sheriff : 1));
    return q;
  };
  const probIf = (ps) => { const w = winnerIf(ps.map((x) => x[1])); return w ? { law: +(w === 'law'), out: +(w === 'out'), ren: +(w === 'ren') } : prob(ps); };
  const pts = T.map((p, k) => {
    const prev = k ? T[k - 1].ps : g.tlStart;
    p.ps.forEach((x, i) => { if (!x[1] && prev[i][1]) deaths.push({ k, t: p.t, i, name: g.players[i].name, role: roles[i] }); });
    // điểm cuối: phe thắng = 100%
    const pb = k === T.length - 1 ? { law: +(g.winner === 'Sheriff'), out: +(g.winner === 'Outlaw'), ren: +(g.winner === 'Renegade') } : prob(p.ps);
    const cf = [];
    for (const l of p.log) {
      const m = l.match(/^(.+?) rút kiểm tra \(Barrel\): .+ → (thành công|thất bại)/); if (!m) continue;
      const i = g.players.findIndex((q) => q.name === m[1]), ok = m[2] === 'thành công';
      cf.push({ i, ok, ...r3p(ok ? probIf(hurt(p.ps, i)) : prob(prev)) });
    }
    return { t: p.t, r: p.r, o: p.o, a: p.a, law: r3(pb.law), out: r3(pb.out), ren: r3(pb.ren), hp: p.ps.map((x) => x[0]), ...(cf.length ? { cf } : {}), log: p.log.filter((l) => !/^(— |.+ rút \d+ lá\.$|.+ kết thúc lượt\.$|.+ đã chọn |Chồng bài)/.test(l)) };
  });
  return { label, n: roles.length, winner: g.winner, turns: g.turnNumber, names: g.players.map((p) => p.name), chars: g.players.map((p) => p.char), roles, prior: MODEL.prior[roles.length], start: prob(g.tlStart), pts, deaths };
}

// chọn ván: (a) Renegade thắng, (b) Renegade sống tới gần cuối nhưng thua, (c) Outlaw thắng, Renegade đứng ngoài
const picks = [];
const want = [
  { label: 'Renegade thắng một mình', test: (g) => g.winner === 'Renegade' && g.turnNumber >= 25 },
  { label: 'Renegade sống tới cuối nhưng thua', test: (g) => g.winner === 'Sheriff' && (() => { const T = g.timeline, ri = g.players.findIndex((p) => p.role === 'Renegade'); const k = T.findIndex((p) => !p.ps[ri][1]); return k < 0 || k > T.length * 0.85; })() && g.turnNumber >= 25 },
  { label: 'Outlaw thắng, Renegade đứng ngoài', test: (g) => g.winner === 'Outlaw' && g.players.find((p) => p.role === 'Renegade')?.alive && g.turnNumber >= 18 },
];
for (const w of want) {
  for (let s = 1; s < 3000; s++) {
    const g = play(777000 + s * 7 + want.indexOf(w), 6 + (s % 2));
    if (w.test(g)) { picks.push(pack(g, w.label)); break; }
  }
}
fs.writeFileSync(OUT, 'window.GAMES3 = ' + JSON.stringify({ model: MODEL.note, prior: MODEL.prior, games: picks }) + ';\n');
console.log(picks.map((p) => `${p.label}: ${p.n} người, ${p.turns} lượt, ${p.pts.length} điểm`).join('\n'));

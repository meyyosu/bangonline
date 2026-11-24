'use strict';
// Phân tích tỉ lệ thắng 3 phe trên nhiều ván bot: so công thức tay với hồi quy logistic (drafts/ty-le-thang.js),
// (chỉ phân tích; học trọng số dùng thật bằng drafts/ty-le-thang-hoc.js).
// Chạy: node drafts/ty-le-thang-phan-tich.js [sốVán=2000]
// Lưu ý: bot chơi ngẫu nhiên (không biết phe), nên đây là "luật chơi + may rủi", chưa phải người thật.
const path = require('path');
const fs = require('fs');
const { play } = require('./bot-ngau-nhien');
const TL = require('./ty-le-thang');

const FAC = { Sheriff: 'law', Deputy: 'law', Outlaw: 'out', Renegade: 'ren' };
const FS = ['law', 'out', 'ren'];
const N = Number(process.argv[2] || 2000);
const t0 = Date.now();

// ---------- 1. Chạy ván, ghi đặc trưng ở mỗi hành động ----------
const games = [];
for (let s = 1; s <= N; s++) {
  const n = 4 + (s % 4);
  const g = play(500000 + s, n);
  if (!g.winner) continue;
  const roles = g.players.map((p) => p.role);
  const sh = roles.indexOf('Sheriff');
  const maxHp = g.players.map((p) => p.maxHp);
  const T = g.timeline;
  const pts = T.slice(0, -1).map((p, k) => { // bỏ điểm cuối (đã biết kết quả)
    const log = p.log.join(' ');
    return {
      ...TL.snapshot(p.ps, g.tlStart, roles, maxHp),
      prog: k / (T.length - 1), t: p.t, shHp: p.ps[sh][0],
      kind: /chết!/.test(log) ? 'chết' : /mất \d+ máu/.test(log) ? 'mất máu' : /rút \d+ lá\./.test(log) ? 'rút bài' : /Beer|hồi/.test(log) ? 'hồi máu' : 'khác',
    };
  });
  games.push({ n, winner: FAC[g.winner === 'Sheriff' ? 'Sheriff' : g.winner], pts, turns: g.turnNumber });
}
console.log(`Đã chạy ${games.length} ván (${((Date.now() - t0) / 1000).toFixed(0)} giây), ${games.reduce((a, g) => a + g.pts.length, 0)} điểm.`);

// tỉ lệ thắng gốc theo cỡ bàn (dùng nửa đầu làm "train", nửa sau "test" cho công bằng)
const half = (i) => Math.floor(i / 4) % 2; // cỡ bàn xoay vòng 4 ván một lần → chia theo cụm 4 để train/test đủ mọi cỡ
const train = games.filter((_, i) => half(i) === 0), test = games.filter((_, i) => half(i) === 1);
const prior = {};
for (const n of [4, 5, 6, 7]) {
  const w = { law: 0, out: 0, ren: 0 }; const gs = train.filter((g) => g.n === n);
  gs.forEach((g) => w[g.winner]++);
  prior[n] = { law: w.law / gs.length, out: w.out / gs.length, ren: Math.max(0.005, w.ren / gs.length) };
}
console.log('\nTỉ lệ thắng gốc (bot ngẫu nhiên):');
for (const n in prior) console.log(`  ${n} người: Luật pháp ${pct(prior[n].law)} · Outlaw ${pct(prior[n].out)} · Renegade ${pct(prior[n].ren)}`);

// ---------- 2. Công thức ----------
function heur(p, n, P = { gamma: 2, a: 0.6, b: 2.5 }) {
  const pr = prior[n];
  const w = {
    law: pr.law * Math.pow(p.rL, P.gamma),
    out: pr.out * Math.pow(p.rO, P.gamma) * (1 + P.a - P.a * Math.min(1, p.shRel)),
    ren: pr.ren * Math.pow(p.rR, P.gamma) * (p.renA ? 1 + P.b * (1 - (p.aliveFrac * n - 2) / (n - 2)) : 0),
  };
  const tot = w.law + w.out + w.ren || 1;
  return { law: w.law / tot, out: w.out / tot, ren: w.ren / tot };
}
const priorOnly = (p, n) => prior[n];
const cur = (p, n) => heur(p, n);

// log loss & Brier, mỗi ván trọng số bằng nhau (ván dài không lấn át)
function score(model, gs, filter = () => true) {
  let ll = 0, br = 0, acc = 0, W = 0;
  for (const g of gs) {
    const ps = g.pts.filter(filter); if (!ps.length) continue;
    const w = 1 / ps.length;
    for (const p of ps) {
      const q = model(p, g.n, g);
      ll -= w * Math.log(Math.max(1e-3, q[g.winner]));
      br += w * FS.reduce((a, f) => a + (q[f] - (f === g.winner ? 1 : 0)) ** 2, 0);
      acc += w * (FS.reduce((a, f) => (q[f] > q[a] ? f : a), 'law') === g.winner ? 1 : 0);
    }
    W++;
  }
  return { ll: ll / W, br: br / W, acc: acc / W };
}
function pct(v) { return (v * 100).toFixed(0) + '%'; }
function row(name, s) { return `  ${name.padEnd(34)} log-loss ${s.ll.toFixed(3)}  Brier ${s.br.toFixed(3)}  đoán đúng phe thắng ${pct(s.acc)}`; }

console.log('\n=== Độ chuẩn trên tập test (thấp hơn = tốt hơn) ===');
console.log(row('Chỉ tỉ lệ gốc (không nhìn bàn)', score(priorOnly, test)));
console.log(row('Công thức hiện tại (γ2, a.6, b2.5)', score(cur, test)));
console.log(row('Bỏ 2 điều chỉnh (γ2, a0, b0)', score((p, n) => heur(p, n, { gamma: 2, a: 0, b: 0 }), test)));

// theo giai đoạn ván
console.log('\nTheo giai đoạn ván (log-loss: gốc → công thức):');
for (const [lo, hi, name] of [[0, .25, 'đầu (0–25%)'], [.25, .5, 'giữa sớm'], [.5, .75, 'giữa muộn'], [.75, 1.01, 'cuối (75–100%)']]) {
  const f = (p) => p.prog >= lo && p.prog < hi;
  console.log(`  ${name.padEnd(16)} ${score(priorOnly, test, f).ll.toFixed(3)} → ${score(cur, test, f).ll.toFixed(3)}  (đoán đúng ${pct(score(cur, test, f).acc)})`);
}

// bảng hiệu chuẩn: công thức nói X% thì thực tế thắng bao nhiêu
console.log('\nHiệu chuẩn (công thức nói X% → thực tế thắng):');
for (const f of FS) {
  const bins = Array.from({ length: 10 }, () => ({ n: 0, w: 0, s: 0 }));
  for (const g of test) for (const p of g.pts) { const q = heur(p, g.n)[f]; const b = bins[Math.min(9, Math.floor(q * 10))]; b.n++; b.s += q; b.w += g.winner === f ? 1 : 0; }
  console.log(`  ${f.padEnd(4)} ` + bins.map((b) => (b.n < 200 ? '   ·   ' : `${pct(b.s / b.n).padStart(3)}→${pct(b.w / b.n).padStart(3)}`)).join(' '));
}

// ---------- 3. Chỉnh hệ số ----------
let best = null;
for (const gamma of [0.5, 1, 1.5, 2, 3, 4]) for (const a of [0, 0.6, 1.5, 3, 6]) for (const b of [0, 1, 2.5, 5, 10]) {
  const s = score((p, n) => heur(p, n, { gamma, a, b }), train);
  if (!best || s.ll < best.s.ll) best = { gamma, a, b, s };
}
console.log(`\nHệ số tốt nhất trên train: γ=${best.gamma}, a=${best.a}, b=${best.b}`);
console.log(row('Công thức đã chỉnh (test)', score((p, n) => heur(p, n, best), test)));

console.log('  Hiệu chuẩn công thức đã chỉnh (Renegade):');
{ const bins = Array.from({ length: 10 }, () => ({ n: 0, w: 0, s: 0 }));
  for (const g of test) for (const p of g.pts) { const q = heur(p, g.n, best).ren; const b = bins[Math.min(9, Math.floor(q * 10))]; b.n++; b.s += q; b.w += g.winner === 'ren' ? 1 : 0; }
  console.log('  ren  ' + bins.map((b) => (b.n < 200 ? '   ·   ' : `${pct(b.s / b.n).padStart(3)}→${pct(b.w / b.n).padStart(3)}`)).join(' ')); }
// ---------- 4. Hồi quy logistic 3 lớp trên đặc trưng tách rời ----------
// mẫu: tối đa ~40 điểm mỗi ván cho cân (ván dài không lấn át)
const samplesOf = (gs, per = 40) => { const out = []; gs.forEach((g) => { const step = Math.max(1, Math.floor(g.pts.length / per)); for (let k = 0; k < g.pts.length; k += step) out.push([TL.features(g.pts[k], prior), g.winner, TL.possible(g.pts[k])]); }); return out; };
const Wt = TL.train(samplesOf(train));
const logi = (p) => TL.softmax(Wt, TL.features(p, prior), TL.possible(p));
console.log(row('Hồi quy logistic (test)', score(logi, test)));
console.log('  Hiệu chuẩn logistic (test):');
for (const f of FS) {
  const bins = Array.from({ length: 10 }, () => ({ n: 0, w: 0, s: 0 }));
  for (const g of test) for (const p of g.pts) { const q = logi(p)[f]; const b = bins[Math.min(9, Math.floor(q * 10))]; b.n++; b.s += q; b.w += g.winner === f ? 1 : 0; }
  console.log(`  ${f.padEnd(4)} ` + bins.map((b) => (b.n < 200 ? '   ·   ' : `${pct(b.s / b.n).padStart(3)}→${pct(b.w / b.n).padStart(3)}`)).join(' '));
}
console.log('  Trọng số (Luật pháp − Outlaw, lớn = đặc trưng đẩy về Luật pháp):');
console.log('   ' + TL.FEAT.map((nm, j) => `${nm} ${(Wt.law[j] - Wt.out[j]).toFixed(2)}`).join(' · '));
console.log('  Trọng số (Renegade − Outlaw):');
console.log('   ' + TL.FEAT.map((nm, j) => `${nm} ${(Wt.ren[j] - Wt.out[j]).toFixed(2)}`).join(' · '));
// ---------- 5. Nhiễu: xác suất nhảy bao nhiêu theo loại hành động ----------
console.log('\nXác suất Luật pháp thay đổi trung bình mỗi hành động (logistic):');
const jump = {};
for (const g of test) for (let k = 1; k < g.pts.length; k++) {
  const d = Math.abs(logi(g.pts[k]).law - logi(g.pts[k - 1]).law), kd = g.pts[k].kind;
  (jump[kd] ||= { n: 0, s: 0, big: 0 }); jump[kd].n++; jump[kd].s += d; if (d > 0.05) jump[kd].big++;
}
const totalBig = Object.values(jump).reduce((a, j) => a + j.big, 0);
for (const [k, j] of Object.entries(jump).sort((a, b) => b[1].s - a[1].s)) console.log(`  ${k.padEnd(9)} ${String(j.n).padStart(6)} lần · TB ${(j.s / j.n * 100).toFixed(2)} điểm % · chiếm ${pct(j.big / totalBig)} số cú nhảy > 5 điểm %`);

// ---------- 6. Một vài câu hỏi cụ thể ----------
console.log('\nCâu hỏi cụ thể (tất cả ván):');
const all = games;
// a) ai dẫn ở giữa ván thì thắng bao nhiêu
const mid = all.map((g) => { const p = g.pts[Math.floor(g.pts.length / 2)]; const q = logi(p); return FS.reduce((a, f) => (q[f] > q[a] ? f : a), 'law') === g.winner; });
console.log(`  Phe dẫn ở giữa ván (theo logistic) thắng ${pct(mid.filter(Boolean).length / mid.length)} số ván`);
// b) Sheriff còn 1 máu
const sh1 = all.filter((g) => g.pts.some((p) => p.shHp === 1));
console.log(`  Sheriff từng xuống 1 máu: ${pct(sh1.length / all.length)} số ván, phe Luật pháp vẫn thắng ${pct(sh1.filter((g) => g.winner === 'law').length / sh1.length)} (gốc ${pct(all.filter((g) => g.winner === 'law').length / all.length)})`);
// c) Outlaw chết hết trước Sheriff → Renegade 1v1?
const renDuel = all.filter((g) => g.pts.some((p) => p.outA === 0 && p.renA && p.lawA > 0));
console.log(`  Hết Outlaw mà Renegade còn sống: ${pct(renDuel.length / all.length)} số ván → Renegade thắng ${pct(renDuel.filter((g) => g.winner === 'ren').length / renDuel.length)}`);
const duel1 = all.filter((g) => g.pts.some((p) => p.aliveFrac * g.n === 2 && p.renA && p.lawA > 0));
console.log(`  Còn đúng Sheriff vs Renegade: ${pct(duel1.length / all.length)} số ván → Renegade thắng ${pct(duel1.filter((g) => g.winner === 'ren').length / duel1.length)}`);
// d) đổi người dẫn bao nhiêu lần / ván
const flips = all.map((g) => { let c = 0, last = null; g.pts.forEach((p) => { const q = logi(p); const l = FS.reduce((a, f) => (q[f] > q[a] ? f : a), 'law'); if (last && l !== last) c++; last = l; }); return c; });
flips.sort((a, b) => a - b);
console.log(`  Số lần đổi phe dẫn mỗi ván: trung vị ${flips[flips.length >> 1]}, 90% ván ≤ ${flips[Math.floor(flips.length * 0.9)]}`);
// e) mất 1 máu của Sheriff vs của Deputy/Outlaw: xác suất đổi bao nhiêu (logistic)
// Trọng số dùng thật: node drafts/ty-le-thang-hoc.js (học trên toàn bộ ván, ghi ty-le-thang-trong-so.json)
console.log(`\nXong sau ${((Date.now() - t0) / 1000).toFixed(0)} giây.`);

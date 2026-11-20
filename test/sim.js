'use strict';
// Mô phỏng ván đấu với bot ngẫu nhiên để kiểm tra logic. Chạy: node test/sim.js [sốVán]
const { Game, GameError } = require('../game');

function seeded(seed) {
  return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
}

function countCards(g) {
  let n = g.deck.length + g.discard.length;
  for (const p of g.players) n += p.hand.length + p.eq.length;
  if (g.pending && (g.pending.type === 'store' || g.pending.type === 'kit')) n += g.pending.cards.length;
  for (const q of g.queue) if (q.cards) n += q.cards.length;
  return n;
}

function candidates(g, pi, rng) {
  const p = g.players[pi];
  const others = g.players.filter((q, i) => q.alive && i !== pi).map((q) => q.name);
  const pick = (a) => a[Math.floor(rng() * a.length)];
  const out = [];
  if (g.phase === 'character') return g.pending.options.map((character) => ({ type: 'chooseCharacter', character }));
  const pend = g.pending;
  if (pend) {
    if (pend.type === 'draw') for (const from of pend.options) out.push({ type: 'drawChoice', from, target: pick(others) });
    if (pend.type === 'kit') out.push({ type: 'kit', cardIds: pend.cards.slice(0, 2).map((c) => c.id) });
    if (pend.type === 'store') out.push({ type: 'pick', cardId: pick(pend.cards).id });
    if (pend.type === 'check') { out.push({ type: 'checkDraw' }); out.push({ type: 'take' }); }
    if (['bang', 'indians', 'duel'].includes(pend.type)) {
      for (const c of p.hand) out.push({ type: 'respond', cardId: c.id });
      out.push({ type: 'barrel' });
      out.push({ type: 'take' });
    }
    return out;
  }
  for (const c of p.hand) {
    const t = pick(others);
    const tp = g.players[g.idx(t)];
    const tc = rng() < 0.5 || !tp.eq.length ? 'hand' : pick(tp.eq).id;
    out.push({ type: 'play', cardId: c.id, target: t, targetCard: tc });
  }
  if (p.hand.length > p.hp) out.push({ type: 'discard', cardIds: [p.hand[0].id] });
  if (rng() < 0.3) out.push({ type: 'endTurn' });
  if (p.char === 'Sid Ketchum' && p.hand.length >= 2) out.push({ type: 'sid', cardIds: [p.hand[0].id, p.hand[1].id] });
  return out;
}

const N = Number(process.argv[2] || 500);
let wins = {}, totalActions = 0;
const checks = {}; // số lần phải chờ rút kiểm tra theo loại
for (let s = 1; s <= N; s++) {
  const rng = seeded(s);
  const names = Array.from({ length: 4 + (s % 4) }, (_, i) => `P${i + 1}`);
  const g = new Game(names, { rng, characterChoices: 1 + (s % 4) }); // Exercise all room choice counts.
  let steps = 0;
  while (!g.winner) {
    if (++steps > 20000) throw new Error(`Ván ${s}: kẹt vòng lặp`);
    if (g.pending?.type === 'check') checks[g.pending.kind] = (checks[g.pending.kind] || 0) + 1;
    const pi = g.pending ? g.pending.player : g.turn;
    const cands = candidates(g, pi, rng);
    // ưu tiên hành động "có ích" bằng cách thử ngẫu nhiên tới khi hợp lệ
    let done = false;
    for (let k = 0; k < 40 && !done && cands.length; k++) {
      const a = cands[Math.floor(rng() * cands.length)];
      try { g.act(g.players[pi].name, a); done = true; totalActions++; } catch (e) { if (!(e instanceof GameError)) { console.error('Seed', s, a, e); process.exit(1); } }
    }
    if (!done) {
      // không có hành động ngẫu nhiên nào hợp lệ: bỏ bài thừa / chịu đòn / kết thúc
      const p = g.players[pi];
      const fallback = g.pending ? (g.pending.type === 'store' ? { type: 'pick', cardId: g.pending.cards[0].id }
        : g.pending.type === 'check' ? { type: 'checkDraw' } : { type: 'take' })
        : (p.hand.length > p.hp ? { type: 'discard', cardIds: p.hand.slice(0, p.hand.length - p.hp).map((c) => c.id) } : { type: 'endTurn' });
      g.act(p.name, fallback);
    }
    const n = countCards(g);
    if (n !== 80) { console.error(`Seed ${s}: số lá = ${n}`, g.log.slice(-10)); process.exit(1); }
    for (const nm of names) g.viewFor(nm);
  }
  wins[g.winner] = (wins[g.winner] || 0) + 1;
}
console.log(`OK: ${N} ván, ${totalActions} hành động. Kết quả:`, wins, 'Rút kiểm tra:', checks);

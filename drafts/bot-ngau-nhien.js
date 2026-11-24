'use strict';
// Bot chơi ngẫu nhiên (giống test/sim.js) dùng cho các script nháp: play(seed, sốNgười) → Game đã xong.
const path = require('path');
const { Game, GameError } = require(path.join(__dirname, '..', 'game.js'));

function seeded(seed) { return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; }
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
      out.push({ type: 'barrel' }); out.push({ type: 'take' });
    }
    return out;
  }
  for (const c of p.hand) {
    const t = pick(others); const tp = g.players[g.idx(t)];
    out.push({ type: 'play', cardId: c.id, target: t, targetCard: rng() < 0.5 || !tp.eq.length ? 'hand' : pick(tp.eq).id });
  }
  if (p.hand.length > p.hp) out.push({ type: 'discard', cardIds: [p.hand[0].id] });
  if (rng() < 0.3) out.push({ type: 'endTurn' });
  return out;
}
function play(seed, n) {
  const rng = seeded(seed);
  const g = new Game(Array.from({ length: n }, (_, i) => `P${i + 1}`), { rng, characterChoices: 1 });
  let steps = 0;
  while (!g.winner && ++steps < 20000) {
    if (g.pending?.type === 'blackJack') { g.timeout(); continue; }
    const pi = g.pending ? g.pending.player : g.turn;
    const cands = candidates(g, pi, rng);
    let done = false;
    for (let k = 0; k < 40 && !done && cands.length; k++) {
      try { g.act(g.players[pi].name, cands[Math.floor(rng() * cands.length)]); done = true; } catch (e) { if (!(e instanceof GameError)) throw e; }
    }
    if (!done) {
      const p = g.players[pi];
      g.act(p.name, g.pending ? (g.pending.type === 'store' ? { type: 'pick', cardId: g.pending.cards[0].id } : g.pending.type === 'check' ? { type: 'checkDraw' } : { type: 'take' })
        : (p.hand.length > p.hp ? { type: 'discard', cardIds: p.hand.slice(0, p.hand.length - p.hp).map((c) => c.id) } : { type: 'endTurn' }));
    }
  }
  return g;
}
module.exports = { play };

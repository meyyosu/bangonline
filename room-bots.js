'use strict';

const { GameError, CARD_INFO } = require('./game');
const { pauseAction } = require('./room-pause');

// Make one move per tick so clients can follow each bot's actions.
function tickBots(room, now = Date.now()) {
  const g = room.game;
  if (room.status !== 'playing' || !g || g.winner) return false;
  let changed = false;
  for (const name of room.bots || []) {
    const vote = room.pause;
    if (vote?.phase === 'voting' && now < vote.deadline && vote.voters.includes(name) && !vote.accepted.includes(name)) {
      pauseAction(room, name, { type: 'vote', id: vote.id, agree: true }, now);
      changed = true;
    }
  }
  if (room.pause?.frozenAt != null) return changed;
  const p = g.players[g.pending ? g.pending.player : g.turn];
  if (!room.bots?.includes(p?.name)) { room.botNextAt = null; return changed; }
  if (room.botNextAt == null) room.botNextAt = now + 750;
  if (now < room.botNextAt) return changed;
  room.botNextAt = now + 750;
  const actions = [];
  const pending = g.pending;
  if (g.phase === 'character') {
    actions.push({ type: 'chooseCharacter', character: pending.options[0] });
  } else if (pending) {
    if (['bang', 'indians', 'duel'].includes(pending.type)) {
      actions.push({ type: 'barrel' });
      for (const c of p.hand) actions.push({ type: 'respond', cardId: c.id });
    }
    if (pending.type === 'check') actions.push({ type: 'checkDraw' });
    if (pending.type === 'draw') actions.push({ type: 'drawChoice', from: 'deck' });
    if (pending.type === 'kit') actions.push({ type: 'kit', cardIds: pending.cards.slice(0, 2).map((c) => c.id) });
    if (pending.type === 'store') actions.push({ type: 'pick', cardId: pending.cards[0].id });
    if (pending.type === 'copyAbility') actions.push({ type: 'copyAbility', target: g.players.find((q) => q.alive && q !== p)?.name });
    actions.push({ type: 'take' });
  } else {
    // Only use the bot's own hand and public information about other players.
    const targets = g.players.filter((q) => q.alive && q !== p);
    if (p.role === 'Outlaw') targets.sort((a, b) => Number(b.role === 'Sheriff') - Number(a.role === 'Sheriff'));
    const enemies = targets.filter((q) => !(['Sheriff', 'Deputy'].includes(p.role) && q.role === 'Sheriff'));
    for (const c of [...p.eq.filter((card) => CARD_INFO[card.name].type === 'green' && !p.coolingGreen.has(card.id)), ...p.hand]) {
      const type = p.eq.includes(c) ? 'activate' : 'play';
      const info = CARD_INFO[c.name];
      const cost = info.discardCost ? p.hand.find((card) => card.id !== c.id) : null;
      if (info.discardCost && !cost) continue;
      const payment = cost ? { costCardId: cost.id } : {};
      if (info.effect === 'discardAll') {
        const choices = targets.filter((q) => q.hand.length || q.eq.length).map((q) => ({
          target: q.name, targetCard: q.hand.length ? 'hand' : q.eq[0].id,
        }));
        actions.push({ type, cardId: c.id, ...payment, targets: choices });
        continue;
      }
      for (const target of enemies) {
        for (const targetCard of ['hand', ...target.eq.map((card) => card.id)]) {
          actions.push({ type, cardId: c.id, target: target.name, targetCard, ...payment });
        }
      }
      actions.push({ type, cardId: c.id, ...payment });
    }
  }
  for (const action of actions) {
    try { g.act(p.name, action); return true; }
    catch (e) { if (!(e instanceof GameError)) throw e; }
  }
  // The rules engine supplies safe defaults for remaining choices and excess cards.
  g.timeout();
  return true;
}

module.exports = { tickBots };

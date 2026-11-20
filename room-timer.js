'use strict';

// Preserve the turn's remaining time while a separate response clock runs.
function syncTimer(room, now = Date.now()) {
  const g = room.game;
  if (g?.phase === 'character') {
    const duration = (room.characterSeconds || 0) * 1000;
    if (!duration) { room.clock = null; return; }
    if (room.clock?.pending !== g.pending) {
      room.clock = { character: true, deadline: now + duration, pending: g.pending, player: g.pending.player };
    }
    return;
  }
  const duration = room.turnSeconds * 1000;
  if (!g || g.winner || !duration) { room.clock = null; return; }
  let c = room.clock;
  if (!c || c.character || c.turn !== g.turnNumber) {
    c = room.clock = { turn: g.turnNumber, remaining: duration, deadline: now + duration, pending: null, player: g.turn };
  }
  const pending = g.pending;
  if (pending) {
    if (!c.pending) c.remaining = Math.max(0, c.deadline - now);
    if (c.pending !== pending || c.player !== pending.player) c.deadline = now + duration;
    c.pending = pending;
    c.player = pending.player;
  } else {
    if (c.pending) c.deadline = now + c.remaining;
    c.pending = null;
    c.player = g.turn;
  }
}

function tickTimer(room, now = Date.now()) {
  syncTimer(room, now);
  if (!room.clock || now < room.clock.deadline) return false;
  room.game.timeout();
  syncTimer(room, now);
  if (room.game.winner) room.status = 'ended';
  return true;
}

module.exports = { syncTimer, tickTimer };

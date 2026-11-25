'use strict';

const { tickPause } = require('./room-pause');

// Preserve the turn's remaining time while a separate response clock runs.
function syncTimer(room, now = Date.now()) {
  const g = room.game;
  if (!g || g.winner) { room.clock = null; return; }
  if (room.pause?.frozenAt != null) return;
  if (g.phase === 'character') {
    const duration = (room.characterSeconds || 0) * 1000;
    if (!duration) { room.clock = null; return; }
    if (room.clock?.pending !== g.pending) {
      room.clock = { character: true, deadline: now + duration, pending: g.pending, player: g.pending.player };
    }
    return;
  }
  // Drawing has its own grace period, including rooms without a turn limit.
  if (g.phase === 'draw' && g.pending) {
    if (!room.clock?.draw || room.clock.pending !== g.pending) {
      const type = g.pending.type;
      const character = g.ability(g.players[g.pending.player]);
      const needsChoice = ['kit', 'copyAbility'].includes(type) || ['Jesse Jones', 'Pedro Ramirez', 'Pat Brennan', 'Evelyn Shebang'].includes(character);
      const seconds = type === 'blackJack' ? 3 : needsChoice ? 20 : 5;
      room.clock = { draw: true, seconds, turn: g.turnNumber, deadline: now + seconds * 1000, pending: g.pending, player: g.pending.player };
    }
    return;
  }
  const duration = room.turnSeconds * 1000;
  if (!duration) { room.clock = null; return; }
  let c = room.clock;
  if (!c || c.character || c.draw || c.turn !== g.turnNumber) {
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
  const pauseChanged = tickPause(room, now);
  syncTimer(room, now);
  if (room.pause?.frozenAt != null || !room.clock || now < room.clock.deadline) return pauseChanged;
  room.game.timeout();
  syncTimer(room, now);
  if (room.game.winner) { room.status = 'ended'; tickPause(room, now); }
  return true;
}

module.exports = { syncTimer, tickTimer };

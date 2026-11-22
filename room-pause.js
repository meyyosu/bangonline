'use strict';

const { GameError } = require('./game');
const VOTE_MS = 10000;
const PAUSE_MS = 60000;

function note(room, text) { room.chat.push({ system: true, text }); }

function finishPause(room, text, now = Date.now()) {
  const p = room.pause;
  if (!p) return;
  if (p.frozenAt != null && room.clock) room.clock.deadline += now - p.frozenAt;
  room.pause = null;
  if (text) note(room, text);
}

function openVote(room, p, now) {
  p.id = room.pauseSequence = (room.pauseSequence || 0) + 1;
  p.phase = 'voting';
  p.deadline = now + VOTE_MS;
  p.voters = room.players.filter((name) => name !== p.requester);
  p.accepted = [];
  note(room, `${p.requester} muốn tạm dừng.${p.renewal ? ' Gia hạn thêm 60 giây.' : ''}`);
}

function tickPause(room, now = Date.now()) {
  const p = room.pause;
  if (!p) return false;
  if (!room.game || room.game.winner || room.status !== 'playing' || !room.players.includes(p.requester)) {
    finishPause(room, null, now);
    return true;
  }
  if (now < p.deadline) return false;
  if (p.phase === 'voting') {
    finishPause(room, 'Yêu cầu tạm dừng bị huỷ: có người không trả lời trong 10 giây.', now);
  } else {
    p.renewal = true;
    openVote(room, p, now);
  }
  return true;
}

function pauseAction(room, user, body, now = Date.now()) {
  if (!room.game || room.game.winner || room.status !== 'playing') throw new GameError('Chỉ có thể tạm dừng khi đang chơi.');
  if (!room.players.includes(user)) throw new GameError('Bạn không ở trong phòng này.');
  if (body.type === 'request') {
    if (room.pause) throw new GameError('Đang có yêu cầu tạm dừng.');
    const p = room.pause = { requester: user, renewal: false, frozenAt: null };
    openVote(room, p, now);
    return;
  }
  const p = room.pause;
  if (!p || body.id !== p.id) throw new GameError('Yêu cầu tạm dừng này đã hết hiệu lực.');
  if (body.type === 'resume') {
    if (user !== p.requester) throw new GameError('Chỉ người yêu cầu tạm dừng mới có thể bấm tiếp tục.');
    finishPause(room, `${user} đã tiếp tục ván chơi.`, now);
    return;
  }
  if (body.type !== 'vote' || typeof body.agree !== 'boolean') throw new GameError('Lựa chọn không hợp lệ.');
  if (p.phase !== 'voting' || now >= p.deadline || !p.voters.includes(user) || p.accepted.includes(user)) {
    throw new GameError('Bạn không thể bỏ phiếu lúc này.');
  }
  if (!body.agree) {
    finishPause(room, `${user} từ chối. Yêu cầu tạm dừng bị huỷ.`, now);
    return;
  }
  p.accepted.push(user);
  if (p.accepted.length === p.voters.length) {
    p.phase = 'paused';
    p.deadline = now + PAUSE_MS;
    if (p.frozenAt == null) p.frozenAt = now;
    note(room, 'Tất cả người chơi nhất trí. Ván chơi tạm dừng 60 giây.');
  }
}

function pauseView(room) {
  const p = room.pause;
  return p ? { id: p.id, requester: p.requester, phase: p.phase, deadline: p.deadline, renewal: p.renewal,
    frozen: p.frozenAt != null, voters: p.voters, accepted: p.accepted } : null;
}

module.exports = { pauseAction, tickPause, finishPause, pauseView };

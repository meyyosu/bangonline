// NHÁP tab Đóng góp — cách tính đã chốt:
//  • mỗi hành động làm cán cân dịch chuyển Δ, ghi công cho 1 người (tấn công → người tấn công; Duel → đối thủ; Dynamite/Jail → Số phận)
//  • KHÔNG tính phát súng cuối (cán cân "chạm trần" ±1 khi phe cuối bị xoá sổ, không phản ánh thế trận)
//  • chia cho số lượt người đó được chơi (tới lúc chết) → người hy sinh sớm vẫn được ghi nhận
//  • Renegade có mặt ở cả 2 biểu đồ: phần Δ đẩy về Luật pháp vào biểu đồ Luật pháp, phần đẩy về Outlaw vào biểu đồ Outlaw
const NICK = { P1: 'CaoBoiMienTay', P2: 'ThanhXaThu99', P3: 'HoangHonDo', P4: 'TuongCuopSaMac', P5: 'BongMaThungLung', P6: 'SieuDaoChich', P7: 'KeHaiMat_VN' };
const ME = 'P2';
const TEAM = { Sheriff: 'law', Deputy: 'law', Outlaw: 'out', Renegade: 'ren' };
const SIGN = { law: 1, out: -1 };
const PALETTE = { law: ['#2f5d8a', '#5b8cc0', '#9cc0e3', '#c9dcef'], out: ['#8a2b1d', '#c0563f', '#e39a7f', '#f1c6b4'] };
const REN_COLOR = '#7a5aa6';

fetch('can-can-van-mau.json').then((r) => r.json()).then((G) => {
  const N = G.names.length, last = G.pts.length - 1;
  const raw = Array(N).fill(0), renToward = { law: 0, out: 0 };
  let fate = 0, prev = 0;
  G.pts.forEach((p, k) => {
    const d = p.b - prev; prev = p.b;
    if (k === last) return;                                   // bỏ phát súng cuối
    if (p.a < 0) { fate += d; return; }
    raw[p.a] += d;
    if (G.roles[p.a] === 'Renegade') { if (d > 0) renToward.law += d; else renToward.out += -d; }
  });
  const turns = G.names.map((n) => G.pts.reduce((s, p) => s + p.log.filter((l) => l.startsWith(`— Lượt của ${n} —`)).length, 0));
  const fmt = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(3).replace('.', ',')}`;
  const arc = (cx, cy, r, a0, a1) => {
    const pt = (a) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
    const [x0, y0] = pt(a0), [x1, y1] = pt(a1);
    return `M${cx},${cy} L${x0},${y0} A${r},${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1},${y1} Z`;
  };
  const renIdx = G.roles.indexOf('Renegade');

  for (const team of ['law', 'out']) {
    const rows = G.names.map((n, i) => ({ n, i, role: G.roles[i], t: turns[i], v: raw[i] * SIGN[team] / Math.max(1, turns[i]) }))
      .filter((m) => TEAM[m.role] === team).sort((a, b) => b.v - a.v);
    rows.forEach((m, k) => { m.col = PALETTE[team][k % 4]; });
    if (renIdx >= 0) { // Renegade luôn có tên ở cả 2 đội, kể cả khi tác động = 0
      rows.push({ n: G.names[renIdx], i: renIdx, role: 'Renegade', t: turns[renIdx], v: renToward[team] / Math.max(1, turns[renIdx]), col: REN_COLOR, ren: true });
    }
    const pos = rows.filter((m) => m.v > 0), posSum = pos.reduce((s, m) => s + m.v, 0) || 1;
    const teamOnly = rows.filter((m) => !m.ren).reduce((s, m) => s + m.v, 0);

    let a = 0, svg = '';
    pos.forEach((m) => {
      const sweep = (m.v / posSum) * Math.PI * 2;
      svg += pos.length === 1 ? `<circle cx="105" cy="105" r="95" fill="${m.col}"/>` : `<path d="${arc(105, 105, 95, a, a + sweep)}" fill="${m.col}" stroke="#fffaf0" stroke-width="2"/>`;
      const mid = a + sweep / 2;
      if (sweep > 0.35) svg += `<text x="${105 + 62 * Math.sin(mid)}" y="${109 - 62 * Math.cos(mid)}" text-anchor="middle" font-size="13" font-weight="800" fill="#fff" stroke="rgba(0,0,0,.25)" stroke-width=".6">${Math.round(m.v / posSum * 100)}%</text>`;
      a += sweep;
    });
    svg += `<circle cx="105" cy="105" r="42" fill="#fffaf0"/><text x="105" y="100" text-anchor="middle" font-size="10.5" fill="#8b7355">cả đội /lượt</text><text x="105" y="120" text-anchor="middle" font-size="17" font-weight="900" fill="${team === 'law' ? '#2f5d8a' : '#8a2b1d'}">${fmt(teamOnly)}</text>`;

    const won = (G.winner === 'Sheriff') === (team === 'law');
    const share = (m) => (m.v > 0 ? Math.round(m.v / posSum * 100) + '% công' : m.ren ? 'không tác động' : m.v === 0 ? '0% công' : 'kéo lùi đội');
    const legend = rows.map((m) => `<div class="li ${m.v < 0 ? 'neg' : ''} ${m.n === ME ? 'me' : ''} ${m.ren ? 'ren' : ''}">
        <i style="background:${m.v > 0 ? m.col : '#d9d0c4'}"></i>
        <span class="nm">${NICK[m.n]}${m.n === ME ? ' (bạn)' : ''}<small>${m.role}${m.ren ? ' · giúp gián tiếp' : ''}</small></span>
        <span class="v">${m.ren && m.v === 0 ? '0' : fmt(m.v)}<small style="display:inline;margin-left:2px">/lượt</small><small>${share(m)} · ${m.t} lượt</small></span></div>`).join('');
    const box = document.getElementById(team);
    box.className = `pd ${team} ${won ? 'win' : ''}`;
    box.innerHTML = `<h3>${team === 'law' ? 'Luật pháp' : 'Tội phạm (Outlaw)'}${won ? '<span class="wtag">THẮNG</span>' : ''}</h3>
      <div class="sub">Trung bình mỗi lượt được chơi, người đó đẩy cán cân về phía ${team === 'law' ? 'Luật pháp' : 'Outlaw'} bao nhiêu (không tính phát súng cuối)</div>
      <div class="row"><svg class="pie" viewBox="0 0 210 210">${svg}</svg><div class="legend">${legend}</div></div>`;
  }
  document.getElementById('note').innerHTML = `Renegade ${renIdx >= 0 ? NICK[G.names[renIdx]] : ''} (tím) có mặt ở cả hai biểu đồ: phần hành động có lợi cho mỗi đội tính riêng.
    · Số phận (Dynamite, Jail) ${fate >= 0 ? 'có lợi cho Luật pháp' : 'có lợi cho Outlaw'} ${Math.abs(fate).toFixed(2).replace('.', ',')}`;
});

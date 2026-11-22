# Bang! Online — ghi chú cho Claude Code

Web chơi board game Bang! (bản gốc) online với bạn bè. Giao tiếp với người dùng bằng tiếng Việt; giao diện game cũng bằng tiếng Việt (tên lá bài/nhân vật giữ tiếng Anh).

## Nguyên tắc
- **Không dùng thư viện ngoài**: chỉ module có sẵn của Node.js (>=18). Không thêm framework nếu người dùng chưa đồng ý.
- Frontend là JavaScript thuần, không build step.
- Màn kết thúc trận (Kết quả → Danh hiệu → Thống kê) phải **luôn vừa một màn hình desktop, không phải cuộn**: nội dung nằm trong `.result-body`, `fitMatchResult()` (app.js) tự `zoom` nhỏ lại theo chiều cao cửa sổ (ResizeObserver). Màn ≥ 900px giữ lưới danh hiệu 4 cột; thêm nội dung mới thì kiểm tra lại ở 1920×950, 1366×650, 1280×720.

## Kiến trúc
- `game.js` — toàn bộ luật chơi, class `Game`. Lỗi luật ném `GameError` (thông báo tiếng Việt). Trạng thái phản hồi dùng `this.pending` + hàng đợi `this.queue` (các loại: `bang`, `indians`, `duel`, `store`, `kit`, `draw`, `check` — chờ người chơi bấm rút kiểm tra Dynamite/Jail/Barrel; kết quả lần rút gần nhất nằm ở `lastCheck` để giao diện lật bài). Khi `opts.charChoices` > 1, ván mở đầu bằng `phase: 'choose'`: mỗi người có `choices` (X nhân vật, tự giảm còn ⌊16/số người⌋), gửi `{type:'chooseChar', char}`; chọn đủ thì mới chia bài (`beginGame`). Phòng lưu X ở `charChoices` (1–5, mặc định 3). `viewFor(name)` trả dữ liệu đã ẩn thông tin bí mật (vai trò, bài trên tay người khác). Thống kê cuối ván: mỗi người có `this.stats[i]` (ghi trong `damage`/`check`/`playCard`…); khi có winner, `viewFor` kèm `summary` = `{turns, minutes, stats, awards}` với 12 danh hiệu (`awards()`, mỗi cái tối đa 2 hạng, bằng điểm thì chung hạng; riêng Tướng cướp xếp theo thứ tự Outlaw nhắm vào Sheriff lần đầu, ghi ở `this.bandits` qua `noteSheriffTarget`).
- `server.js` — HTTP server: đăng ký/đăng nhập (scrypt, `data/users.json`, cookie `sid`), phòng mã 4 ký tự (lưu trong bộ nhớ), realtime bằng Server-Sent Events, chat. API chính: `POST /api/rooms/:code/action` với `{action}`. Mỗi bản tin phòng có `server: {features, stale}`: giao diện (luôn đọc mới từ ổ đĩa) dùng nó để cảnh báo ở phòng chờ và hỏi lại khi bấm Bắt đầu nếu server chạy bản cũ — server cũ không gửi trường này, còn `stale` = code trên ổ đĩa đã đổi mà server chưa khởi động lại (kiểm tra mỗi 10 giây, đổi bằng `BANG_CODE_CHECK_MS`). Thêm tính năng cần server mới thì thêm tên vào `SERVER_FEATURES`.
- `public/` — `index.html`, `style.css`, `app.js` (render lại toàn bộ khi nhận SSE; trạng thái giao diện trong biến `ui`).

## Khởi động trên Windows
- `CHAY-GAME.bat` → gọi `tools/start.ps1`: tải Node.js portable vào `node/` nếu máy chưa có, thêm luật tường lửa "Bang Online" cho cổng 3000, tìm IP Radmin VPN (26.*), copy link, chạy server và mở trình duyệt. Người dùng chơi với bạn qua Radmin VPN.
- Giữ `start.ps1` ở dạng UTF-8 có BOM + CRLF (PowerShell 5.1 cần BOM để đọc tiếng Việt); `.bat` chỉ ASCII + CRLF.

## Lệnh
- Chạy: `node server.js` (cổng mặc định 3000, đổi bằng `PORT`)
- Test luật: `node test/sim.js 500` — bot chơi ngẫu nhiên, kiểm tra luôn đủ 80 lá. Chạy lại sau mỗi lần sửa `game.js`.
- Test giao diện: `node test/e2e.js` (cần Playwright, server đang chạy)
- Xem thử màn kết thúc (Kết quả → Danh hiệu → Thống kê) với số liệu mẫu: `node tools/demo-results.js` rồi mở http://localhost:3007

## Chỗ đã đơn giản hoá so với luật gốc
Beer tự dùng khi sắp chết; Lucky Duke tự chọn lá có lợi; phòng mất khi khởi động lại server.

## Ý tưởng tiếp theo
Lưu phòng ra file, âm thanh, bản mở rộng Dodge City.

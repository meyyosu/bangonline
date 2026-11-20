# Bang! Online — ghi chú cho Claude Code

Web chơi board game Bang! (bản gốc) online với bạn bè. Giao tiếp với người dùng bằng tiếng Việt; giao diện game cũng bằng tiếng Việt (tên lá bài/nhân vật giữ tiếng Anh).

## Nguyên tắc
- **Không dùng thư viện ngoài**: chỉ module có sẵn của Node.js (>=18). Không thêm framework nếu người dùng chưa đồng ý.
- Frontend là JavaScript thuần, không build step.

## Kiến trúc
- `game.js` — toàn bộ luật chơi, class `Game`. Lỗi luật ném `GameError` (thông báo tiếng Việt). Trạng thái phản hồi dùng `this.pending` + hàng đợi `this.queue` (các loại: `bang`, `indians`, `duel`, `store`, `kit`, `draw`, `check` — chờ người chơi bấm rút kiểm tra Dynamite/Jail/Barrel; kết quả lần rút gần nhất nằm ở `lastCheck` để giao diện lật bài). Khi `opts.charChoices` > 1, ván mở đầu bằng `phase: 'choose'`: mỗi người có `choices` (X nhân vật, tự giảm còn ⌊16/số người⌋), gửi `{type:'chooseChar', char}`; chọn đủ thì mới chia bài (`beginGame`). Phòng lưu X ở `charChoices` (1–5, mặc định 3). `viewFor(name)` trả dữ liệu đã ẩn thông tin bí mật (vai trò, bài trên tay người khác).
- `server.js` — HTTP server: đăng ký/đăng nhập (scrypt, `data/users.json`, cookie `sid`), phòng mã 4 ký tự (lưu trong bộ nhớ), realtime bằng Server-Sent Events, chat. API chính: `POST /api/rooms/:code/action` với `{action}`.
- `public/` — `index.html`, `style.css`, `app.js` (render lại toàn bộ khi nhận SSE; trạng thái giao diện trong biến `ui`).

## Khởi động trên Windows
- `CHAY-GAME.bat` → gọi `tools/start.ps1`: tải Node.js portable vào `node/` nếu máy chưa có, thêm luật tường lửa "Bang Online" cho cổng 3000, tìm IP Radmin VPN (26.*), copy link, chạy server và mở trình duyệt. Người dùng chơi với bạn qua Radmin VPN.
- Giữ `start.ps1` ở dạng UTF-8 có BOM + CRLF (PowerShell 5.1 cần BOM để đọc tiếng Việt); `.bat` chỉ ASCII + CRLF.

## Lệnh
- Chạy: `node server.js` (cổng mặc định 3000, đổi bằng `PORT`)
- Test luật: `node test/sim.js 500` — bot chơi ngẫu nhiên, kiểm tra luôn đủ 80 lá. Chạy lại sau mỗi lần sửa `game.js`.
- Test giao diện: `node test/e2e.js` (cần Playwright, server đang chạy)

## Chỗ đã đơn giản hoá so với luật gốc
Beer tự dùng khi sắp chết; Lucky Duke tự chọn lá có lợi; phòng mất khi khởi động lại server.

## Ý tưởng tiếp theo
Lưu phòng ra file, âm thanh, bản mở rộng Dodge City.

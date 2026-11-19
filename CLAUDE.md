# Bang! Online — ghi chú cho Claude Code

Web chơi board game Bang! (bản gốc) online với bạn bè. Giao tiếp với người dùng bằng tiếng Việt; giao diện game cũng bằng tiếng Việt (tên lá bài/nhân vật giữ tiếng Anh).

## Nguyên tắc
- **Không dùng thư viện ngoài**: chỉ module có sẵn của Node.js (>=18). Không thêm framework nếu người dùng chưa đồng ý.
- Frontend là JavaScript thuần, không build step.

## Kiến trúc
- `game.js` — toàn bộ luật chơi, class `Game`. Lỗi luật ném `GameError` (thông báo tiếng Việt). Trạng thái phản hồi dùng `this.pending` + hàng đợi `this.queue` (các loại: `bang`, `indians`, `duel`, `store`, `kit`, `draw`). `viewFor(name)` trả dữ liệu đã ẩn thông tin bí mật (vai trò, bài trên tay người khác).
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
Nhân vật chia ngẫu nhiên; Beer tự dùng khi sắp chết; Lucky Duke tự chọn lá có lợi; phòng mất khi khởi động lại server.

## Ý tưởng tiếp theo
Giới hạn thời gian mỗi lượt, chọn nhân vật (1 trong 2), lưu phòng ra file, âm thanh, bản mở rộng Dodge City.

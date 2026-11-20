# 🤠 Bang! Online

Phiên bản web của board game **Bang!** (bản gốc) để chơi cùng bạn bè: đăng nhập, tạo phòng, vào phòng bằng mã/link, chơi theo thời gian thực, có chat.

**Không cần cài thư viện nào.** Chỉ cần Node.js 18 trở lên.

## Cách nhanh nhất (Windows): bấm đúp `CHAY-GAME.bat`

Giải nén rồi bấm đúp **`CHAY-GAME.bat`**. Script sẽ tự:
1. Tải Node.js bản portable vào thư mục `node/` (chỉ lần đầu, cần Internet). Không cài gì vào hệ thống.
2. Mở cổng 3000 trên tường lửa (chỉ lần đầu; khi Windows hỏi quyền Administrator thì bấm **Yes**).
3. Tìm IP Radmin VPN (26.x.x.x), copy link cho bạn bè vào clipboard và mở trình duyệt.

Giữ cửa sổ đen mở trong lúc chơi; đóng nó là tắt server. Bạn bè chỉ cần mở link bằng trình duyệt, không phải cài gì.

## Chạy thủ công

```bash
cd bang-online
node server.js          # hoặc: npm start
```

Mở http://localhost:3000. Đổi cổng bằng `PORT=8080 node server.js`.

## Chơi với bạn bè

- **Cùng mạng Wi-Fi/LAN:** bạn bè mở `http://<IP-máy-bạn>:3000` (xem IP bằng `ipconfig` trên Windows hoặc `ifconfig`/`ip a` trên macOS/Linux).
- **Qua Internet, nhanh nhất:** chạy server rồi mở một đường hầm, ví dụ `cloudflared tunnel --url http://localhost:3000` hoặc `ngrok http 3000`, sau đó gửi link cho bạn bè.
- **Lâu dài:** deploy lên một dịch vụ chạy Node như Render, Railway, Fly.io hoặc một VPS. Lệnh khởi động là `node server.js`; dịch vụ tự đặt biến `PORT`.

Cách chơi: mỗi người tự đăng ký tài khoản → chủ phòng bấm **Tạo phòng** → bấm **Copy link mời** gửi cho bạn bè (hoặc gửi mã 4 ký tự) → đủ 4–7 người thì chủ phòng bấm **Bắt đầu ván**.

## Tính năng

- Đăng ký/đăng nhập (mật khẩu được băm bằng scrypt, lưu trong `data/users.json`)
- Sảnh xem các phòng đang mở; vào phòng bằng mã hoặc link; chủ phòng có thể mời người khác ra
- Cài đặt tại lúc tạo phòng hoặc trong phòng chờ: chủ phòng đặt, đổi, xóa mật khẩu; người vào bằng mã/link cũng phải nhập mật khẩu (thành viên quay lại không cần nhập lại).
- Timer mỗi lượt: mặc định tắt (0), có thể đặt 10–600 giây. Hết giờ tự bỏ các lá đầu tay cho đủ giới hạn máu rồi kết thúc lượt. Khi chờ phản hồi, timer lượt tạm dừng; mỗi bước phản hồi có cùng thời lượng riêng. Hết giờ phản hồi sẽ tự chịu đòn, rút từ bộ bài hoặc chọn các lá đầu tiên. Timer tiếp tục chạy khi mất kết nối.
- Chọn nhân vật đầu game: chủ phòng đặt số lựa chọn từ 1–4 tại lúc tạo phòng hoặc trong phòng chờ. Mặc định 1 là chia ngẫu nhiên; từ 2–4, người chơi chọn lần lượt từ các nhân vật còn lại, không trùng nhau. Timer chọn riêng cho mỗi người, mặc định 30 giây, có thể tắt (0) hoặc đặt 10–600 giây. Hết giờ tự chọn ngẫu nhiên; timer lượt chỉ chạy sau khi mọi người chọn xong. Tải lại trang vẫn tiếp tục bước chọn và giữ nguyên giờ còn lại.
- Cập nhật thời gian thực (Server-Sent Events); tải lại trang hay mất mạng thì vẫn vào lại được ván đang chơi
- Chat trong phòng, nhật ký diễn biến ván đấu, chấm xanh báo ai đang online
- Bàn chơi tròn với ghế theo thứ tự người chơi, bài và trang bị hiển thị quanh bàn; có thể thu gọn chat và đổi cỡ thẻ trang bị.
- Countdown hiện ở đầu phòng và ngay khu vực chơi/chọn nhân vật. Bấm bắt đầu sẽ lưu luôn cài đặt đang hiển thị trong phòng chờ.
- Có thể rời phòng giữa ván: người còn sống được tính là bỏ cuộc và bị loại, chủ phòng được chuyển cho người còn lại. Nếu rời trong bước chọn nhân vật, phòng trở về trạng thái chờ.
- Đủ luật bản gốc: 80 lá bài, 16 nhân vật với kỹ năng riêng, 4 vai trò, khoảng cách và tầm súng, Dynamite, Jail, Barrel, General Store, Duel, Indians, Gatling, phần thưởng khi hạ Outlaw và hình phạt khi Sheriff giết Deputy

### Một số chỗ đơn giản hoá

- Mặc định nhân vật được chia ngẫu nhiên; có thể bật chọn 1 trong 2–4 trong cài đặt phòng.
- Khi sắp chết, Beer được tự động dùng (Sid Ketchum tự bỏ 2 lá nếu không có Beer).
- Lucky Duke tự động chọn lá có lợi khi rút kiểm tra.
- Phòng chơi lưu trong bộ nhớ: khởi động lại server thì mất các ván đang chơi (tài khoản vẫn còn).

## Cấu trúc

```
server.js        HTTP server: đăng nhập, phòng, realtime, chat
game.js          Toàn bộ luật chơi (độc lập, dễ đọc và sửa)
public/          Giao diện: index.html, style.css, app.js
test/sim.js      Mô phỏng hàng trăm ván ngẫu nhiên để kiểm tra luật (npm test)
test/e2e.js      Kiểm thử giao diện bằng Playwright với 4 trình duyệt
data/            Tự tạo khi chạy: users.json, sessions.json
```

## Phát triển tiếp

Một vài ý tưởng: thêm bản mở rộng (Dodge City…), thêm hiệu ứng âm thanh, lưu phòng vào file để không mất khi khởi động lại.

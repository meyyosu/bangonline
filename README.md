# 🤠 Bang! Online

Phiên bản web của board game **Bang!** (bản gốc) để chơi cùng bạn bè: đăng nhập, tạo phòng, vào phòng bằng mã/link, chơi theo thời gian thực, có chat.

**Không cần cài thư viện nào.** Chỉ cần Node.js 18 trở lên.

## Cách nhanh nhất (Windows): bấm đúp `CHAY-GAME.bat`

Giải nén rồi bấm đúp **`CHAY-GAME.bat`**. Script sẽ tự:
1. Tải Node.js bản portable vào thư mục `node/` (chỉ lần đầu, cần Internet). Không cài gì vào hệ thống.
2. Mở cổng 3000 trên tường lửa (chỉ lần đầu; khi Windows hỏi quyền Administrator thì bấm **Yes**).
3. Tìm IP Radmin VPN (26.x.x.x), copy link cho bạn bè vào clipboard và mở trình duyệt.

Giữ cửa sổ đen mở trong lúc chơi; đóng nó là tắt server. Bạn bè chỉ cần mở link bằng trình duyệt, không phải cài gì.

Launcher hiển thị thư mục đang chạy, kiểm tra server đã nạp đúng mã mới nhất trước khi mở trình duyệt và giữ cửa sổ để đọc lỗi. Nếu server cũ vẫn giữ cổng 3000, nhập **R** khi được hỏi để khởi động lại (các phòng/ván trong bộ nhớ sẽ mất, tài khoản được giữ). Nếu server đã ở bản mới nhất, file BAT chỉ mở lại trình duyệt và báo server đang chạy ở cửa sổ khác. Lỗi khởi động được lưu tại `data/launcher.log`. File BAT trong thư mục con `bangonline/` chuyển về launcher chính để tránh mở bản sao cũ.

Chẩn đoán mà không khởi động/dừng server: `powershell -NoProfile -ExecutionPolicy Bypass -File tools/start.ps1 -CheckOnly`. Có thể truyền `-Port 3001` để dùng cổng khác; `-NoBrowser -SkipFirewall` dành cho kiểm thử cục bộ.

## Chạy thủ công

```bash
cd bang-online
node server.js          # hoặc: npm start
```

Mở http://localhost:3000. Đổi cổng bằng `PORT=8080 node server.js`.

### Chạy bản thử cơ chế trên Windows

Trong một cửa sổ PowerShell riêng tại thư mục dự án, chạy:

```powershell
$env:BANG_RULES_PREVIEW = '1'
$env:PORT = '3001'
$env:BANG_GREEN_CARDS_FILE = (Resolve-Path .\green-cards.json).Path
node server.js
```

Mở [127.0.0.1:3001](http://127.0.0.1:3001) trên máy này và đăng ký tài khoản thử. Dùng bốn hồ sơ trình duyệt riêng để tạo và vào cùng một phòng. Có thể đặt số lựa chọn nhân vật thành **1** để vào ván ngay. Tài khoản và phiên đăng nhập của bản thử được lưu riêng.

### Nạp bộ lá viền xanh lá

Trước khi khởi động server, đặt `$env:BANG_GREEN_CARDS_FILE` thành đường dẫn tới `green-cards.json` hoặc tệp dữ liệu tương thích. Khi dữ liệu đã nạp, ô **Bản mở rộng: Dodge City** ở mục **Tạo phòng** có thể được chọn. Phòng bật bản mở rộng dùng 94 lá và danh sách 31 nhân vật. Phòng mặc định dùng 80 lá và 16 nhân vật.

Tệp JSON là một mảng gồm 13 loại lá, tổng cộng 14 bản. Mỗi loại có `name` (tên riêng không trùng lá gốc), `effect` và `copies`. Mỗi phần tử trong `copies` có `suit` (`S`, `H`, `D` hoặc `C`) và `rank` (chuỗi từ `2` đến `10`, hoặc `J`, `Q`, `K`, `A`).

| `effect` | Tham số có thể đặt |
| --- | --- |
| `draw` | `draw` từ 1 đến 3, mặc định 1 |
| `dodge` | `draw` từ 0 đến 3, mặc định 0 |
| `attack` | `maxDistance` giới hạn khoảng cách, hoặc `"weapon"` để dùng tầm súng. `draw` từ 0 đến 3, mặc định 0 |
| `attackAll` | Tấn công lần lượt tất cả người khác |
| `take`, `discard` | `maxDistance` giới hạn khoảng cách |
| `heal` | `heal` từ 1 đến 2, mặc định 1 |

Khi dùng khoảng cách cố định, `maxDistance` nhận giá trị từ 1 đến 7. Bỏ trường này để chọn mục tiêu ở mọi khoảng cách. Lá xanh lá sẵn sàng từ đầu lượt tiếp theo của người đặt, rồi được bỏ sau khi dùng.

## Chơi với bạn bè

- **Cùng mạng Wi-Fi/LAN:** bạn bè mở `http://<IP-máy-bạn>:3000` (xem IP bằng `ipconfig` trên Windows hoặc `ifconfig`/`ip a` trên macOS/Linux).
- **Qua Internet, nhanh nhất:** chạy server rồi mở một đường hầm, ví dụ `cloudflared tunnel --url http://localhost:3000` hoặc `ngrok http 3000`, sau đó gửi link cho bạn bè.
- **Lâu dài:** deploy lên một dịch vụ chạy Node như Render, Railway, Fly.io hoặc một VPS. Lệnh khởi động là `node server.js`; dịch vụ tự đặt biến `PORT`.

Cách chơi: mỗi người tự đăng ký tài khoản → chủ phòng bấm **Tạo phòng** → bấm **Copy link mời** gửi cho bạn bè (hoặc gửi mã 4 ký tự) → đủ 4–7 người thì chủ phòng bấm **Bắt đầu ván**.

## Tính năng

- Rút bài đầu lượt bằng cách bấm chồng bài. Sau 5 giây không rút, server tự rút từ bộ bài kể cả khi tắt timer lượt hoặc mất kết nối; riêng Jesse Jones/Pedro Ramirez có 20 giây. Jesse bấm trực tiếp người chơi có bài đang sáng; Pedro bấm trực tiếp bài bỏ để dùng kỹ năng, không cần menu. Kit Carlson xem 3 lá giữa bàn và có 20 giây chọn 2 lá về tay, lá còn lại bay về bộ bài; người khác chỉ thấy 3 lá úp. Black Jack lật công khai lá thứ hai giữa bàn trong 3 giây rồi thu về tay; nếu là Cơ/Rô sẽ rút thêm 1 lá với animation. Timer lượt bắt đầu sau khi hoàn tất bước rút/chọn/lật bài. Animation thể hiện đúng nguồn và đích; bài bí mật chỉ hiện mặt cho người nhận.
- Đăng ký/đăng nhập (mật khẩu được băm bằng scrypt, lưu trong `data/users.json`)
- Sảnh xem các phòng đang mở; vào phòng bằng mã hoặc link; chủ phòng có thể mời người khác ra
- Cài đặt tại lúc tạo phòng hoặc trong phòng chờ: chủ phòng đặt, đổi, xóa mật khẩu; người vào bằng mã/link cũng phải nhập mật khẩu (thành viên quay lại không cần nhập lại).
- Timer mỗi lượt: mặc định 60 giây, có thể tắt (0) hoặc đặt 10–600 giây. Hết giờ tự bỏ các lá đầu tay cho đủ giới hạn máu rồi kết thúc lượt. Khi chờ phản hồi, timer lượt tạm dừng; mỗi bước phản hồi có cùng thời lượng riêng. Hết giờ phản hồi sẽ tự chịu đòn, rút từ bộ bài hoặc chọn các lá đầu tiên. Timer tiếp tục chạy khi mất kết nối.
- Chọn nhân vật đầu game: chủ phòng đặt số lựa chọn từ 1–4 tại lúc tạo phòng hoặc trong phòng chờ. Mặc định có 3 nhân vật để chọn; đặt 1 là chia ngẫu nhiên; từ 2–4, người chơi chọn lần lượt từ các nhân vật còn lại, không trùng nhau. Timer chọn riêng cho mỗi người, mặc định 60 giây, có thể tắt (0) hoặc đặt 10–600 giây. Hết giờ tự chọn ngẫu nhiên; timer lượt chỉ chạy sau khi mọi người chọn xong. Tải lại trang vẫn tiếp tục bước chọn và giữ nguyên giờ còn lại.
- Cập nhật thời gian thực (Server-Sent Events); tải lại trang hay mất mạng thì vẫn vào lại được ván đang chơi
- Tạm dừng qua biểu quyết: bấm **Tạm dừng**, mọi người khác (kể cả người đã bị loại còn trong phòng) nhận cửa sổ “<người chơi> muốn tạm dừng.” và chọn **Nhất trí** / **Từ chối** trong 10 giây. Một người từ chối hoặc hết giờ không chọn là huỷ. Khi tất cả nhất trí, dừng ván và giữ nguyên đồng hồ lượt/phản hồi/chọn nhân vật trong 60 giây; người yêu cầu có thể bấm **Tiếp tục** bất cứ lúc nào. Hết 60 giây sẽ biểu quyết gia hạn, lặp lại cho đến khi bị từ chối hoặc người yêu cầu tiếp tục. Ván vẫn dừng trong khi biểu quyết gia hạn; biểu quyết lần đầu chưa dừng đồng hồ. Rời phòng sẽ huỷ yêu cầu. Tải lại trang vẫn giữ biểu quyết và thời hạn trên server.
- Bấm **Bật thông báo Windows** để cấp quyền thông báo desktop với hai nút **Nhất trí** / **Từ chối** khi trình duyệt hỗ trợ; bấm nội dung thông báo để quay lại game. Tính năng này cần quyền thông báo và HTTPS hoặc localhost; khi chơi qua địa chỉ LAN/Radmin HTTP vẫn có cửa sổ biểu quyết trong game.
- Chat trong phòng, nhật ký diễn biến ván đấu, chấm xanh báo ai đang online
- Bàn chơi tròn với ghế theo thứ tự người chơi, bài và trang bị hiển thị quanh bàn; có thể thu gọn chat và đổi cỡ thẻ trang bị.
- Khi có đội thắng, màn hình kết quả toàn màn hình tự hiện với tiêu đề chiến thắng/thua cuộc theo người chơi, vai trò và nhân vật của đồng đội (kể cả người đã bị loại). Bấm **Tiếp tục** để xem màn **Danh hiệu** (12 danh hiệu, mỗi cái có 🥇 top 1 và 🥈 top 2), bấm tiếp để xem **Thống kê** chi tiết từng người, rồi bấm **Xem bàn chơi** để xem lại bàn; chủ phòng bấm **Về phòng chờ** để chuẩn bị ván mới.
- Tất cả người chơi đều thấy lá vừa đánh/phản hồi bay từ tay người đánh ra bài bỏ; lá trang bị bay tới khu vực trang bị của người nhận. Mục tiêu có thể chọn được đánh dấu bằng viền avatar vàng nhấp nháy.
- Các lá bỏ bớt cuối lượt bay lần lượt từ tay xuống bài bỏ cho cả bàn cùng thấy, kể cả khi server tự bỏ do hết giờ. Lá xanh/súng bị bỏ cũng đi xuống bài bỏ.
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

# Khởi động Bang! Online trên Windows: tự tải Node.js portable, mở tường lửa, bật server, mở trình duyệt.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # tải nhanh hơn nhiều trên PowerShell 5
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
$Host.UI.RawUI.WindowTitle = 'Bang! Online - SERVER (đừng tắt cửa sổ này khi đang chơi)'

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$port = 3000

function Say($msg, $color = 'Gray') { Write-Host $msg -ForegroundColor $color }

Say ''
Say '  ==============================' Yellow
Say '        BANG!  ONLINE' Yellow
Say '  ==============================' Yellow
Say ''

# ---------- 1. Node.js ----------
$node = Join-Path $root 'node\node.exe'
if (-not (Test-Path $node)) {
  $sys = Get-Command node -ErrorAction SilentlyContinue
  if ($sys) {
    $node = $sys.Source
  } else {
    Say '[1/3] Lần đầu chạy: đang tải Node.js portable (~30 MB), chờ chút...' Cyan
    try {
      [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
      $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
      $index = Invoke-RestMethod 'https://nodejs.org/dist/index.json' -UseBasicParsing
      $ver = ($index | Where-Object { $_.lts } | Select-Object -First 1).version
      $name = "node-$ver-win-$arch"
      $zip = Join-Path $env:TEMP "$name.zip"
      Invoke-WebRequest "https://nodejs.org/dist/$ver/$name.zip" -OutFile $zip -UseBasicParsing
      $tmp = Join-Path $root 'node-tmp'
      if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
      Expand-Archive $zip -DestinationPath $tmp -Force
      Move-Item (Join-Path $tmp $name) (Join-Path $root 'node')
      Remove-Item $tmp -Recurse -Force
      Remove-Item $zip -Force
      Say "      Đã tải xong Node.js $ver." Green
    } catch {
      Say "      Không tải được Node.js: $($_.Exception.Message)" Red
      Say '      Kiểm tra kết nối Internet rồi chạy lại, hoặc tự cài Node.js từ https://nodejs.org' Red
      Read-Host 'Nhấn Enter để thoát'
      exit 1
    }
  }
}
Say "[1/3] Node.js: OK" Green

# ---------- 2. Tường lửa ----------
$rule = Get-NetFirewallRule -DisplayName 'Bang Online' -ErrorAction SilentlyContinue
if (-not $rule) {
  Say '[2/3] Mở cổng 3000 trên tường lửa để bạn bè vào được.' Cyan
  Say '      Windows sẽ hỏi quyền Administrator: hãy bấm YES.' Cyan
  try {
    $cmd = "New-NetFirewallRule -DisplayName 'Bang Online' -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow -Profile Any | Out-Null"
    Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile', '-Command', $cmd
  } catch {
    Say '      Chưa mở được cổng (bạn đã bấm No?). Bạn bè có thể không vào được; chạy lại file để thử lại.' Red
  }
}
if (Get-NetFirewallRule -DisplayName 'Bang Online' -ErrorAction SilentlyContinue) { Say '[2/3] Tường lửa: OK' Green }

# ---------- 3. Địa chỉ IP ----------
$ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty IPAddress
$radmin = $ips | Where-Object { $_ -like '26.*' } | Select-Object -First 1
$lan = $ips | Where-Object { $_ -like '192.168.*' -or $_ -like '10.*' } | Select-Object -First 1
$ip = if ($radmin) { $radmin } elseif ($lan) { $lan } else { 'localhost' }
$url = "http://${ip}:$port"

Say ''
Say '  -----------------------------------------------' Yellow
if ($radmin) { Say "  Radmin VPN: $radmin" White } else { Say '  (Không thấy IP Radmin 26.x.x.x - Radmin VPN đã bật chưa?)' DarkYellow }
Say "  LINK CHO BẠN BÈ:  $url" Green
Say '  Bạn bè chỉ cần mở link này bằng trình duyệt.' White
Say '  Đóng cửa sổ này = tắt server.' White
Say '  -----------------------------------------------' Yellow
Say ''
try { Set-Clipboard $url; Say '  (Đã copy link vào clipboard, dán vào Zalo/Messenger cho bạn bè)' DarkGray } catch {}
Say ''

# Nếu server đã chạy sẵn thì chỉ mở trình duyệt
if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
  Say 'Server đã đang chạy ở một cửa sổ khác. Mở trình duyệt...' Cyan
  Start-Process $url
  Start-Sleep 3
  exit 0
}

# ---------- 4. Chạy server + mở trình duyệt ----------
$p = Start-Process $node -ArgumentList 'server.js' -NoNewWindow -PassThru
Start-Sleep -Seconds 2
Start-Process $url
$p.WaitForExit()
Say ''
Say 'Server đã dừng.' Red
Read-Host 'Nhấn Enter để đóng'

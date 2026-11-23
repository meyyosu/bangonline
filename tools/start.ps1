param(
  [int]$Port = 3000,
  [switch]$Restart,
  [switch]$NoBrowser,
  [switch]$SkipFirewall,
  [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
try { $Host.UI.RawUI.WindowTitle = 'Bang! Online - SERVER (đừng tắt khi đang chơi)' } catch {}
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root

function Say($message, $color = 'Gray') { Write-Host $message -ForegroundColor $color }
function Read-JsonUrl($url) {
  try { return Invoke-RestMethod -Uri $url -TimeoutSec 3 -UseBasicParsing } catch { return $null }
}
function Find-Listener {
  # netstat also works when the NetTCPIP/WMI cmdlets cannot inspect listeners.
  foreach ($line in (& netstat -ano -p tcp)) {
    if ($line -match "^\s*TCP\s+\S+:$Port\s+\S+\s+LISTENING\s+(\d+)\s*$") {
      return [int]$Matches[1]
    }
  }
  return $null
}
function Open-Game($url) { if (-not $NoBrowser) { Start-Process $url } }

try {
  if ($Port -lt 1 -or $Port -gt 65535) { throw 'Cổng phải nằm trong khoảng 1–65535.' }
  Say "`n  BANG! ONLINE" Yellow
  Say "  Thư mục chạy: $root" Cyan
  Say "  Cổng: $Port"

  $node = Join-Path $root 'node\node.exe'
  if (-not (Test-Path -LiteralPath $node)) {
    $installed = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($installed) { $node = $installed.Source }
    elseif ($CheckOnly) { throw 'Chưa có Node.js. Chạy file BAT để tải Node.js hoặc cài Node.js 18 trở lên.' }
    else {
      Say 'Đang tải Node.js portable, vui lòng chờ...' Cyan
      [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
      $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
      $index = Invoke-RestMethod 'https://nodejs.org/dist/index.json' -UseBasicParsing
      $version = ($index | Where-Object { $_.lts } | Select-Object -First 1).version
      $name = "node-$version-win-$arch"
      # Fresh directory: do not remove another download or installed runtime.
      $download = Join-Path $root ('node-tmp-' + [Guid]::NewGuid().ToString('N'))
      New-Item -ItemType Directory -Path $download | Out-Null
      $zip = Join-Path $download 'node.zip'
      Invoke-WebRequest "https://nodejs.org/dist/$version/$name.zip" -OutFile $zip -UseBasicParsing
      Expand-Archive -LiteralPath $zip -DestinationPath $download -Force
      $extracted = [IO.Path]::GetFullPath((Join-Path $download $name))
      $destination = [IO.Path]::GetFullPath((Join-Path $root 'node'))
      $workspacePrefix = [IO.Path]::GetFullPath($root).TrimEnd('\') + '\'
      if (-not $extracted.StartsWith($workspacePrefix, [StringComparison]::OrdinalIgnoreCase) -or -not $destination.StartsWith($workspacePrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Đường dẫn Node.js nằm ngoài thư mục game.'
      }
      Move-Item -LiteralPath $extracted -Destination $destination
      Remove-Item -LiteralPath $zip -Force
    }
  }
  $major = & $node -p 'parseInt(process.versions.node)'
  if ($LASTEXITCODE -ne 0 -or [int]$major -lt 18) { throw 'Game cần Node.js 18 trở lên.' }
  Say "Node.js: $node" Green
  $dodgeCityFile = if ($env:BANG_DODGE_CITY_FILE) { $env:BANG_DODGE_CITY_FILE }
    elseif ($env:BANG_GREEN_CARDS_FILE) { $env:BANG_GREEN_CARDS_FILE } else { Join-Path $root 'dodge-city.json' }
  $dodgeCityData = & $node -e "const g=require('./game'); if(!g.dodgeCityCardCount||!g.dodgeCityRevision)process.exit(1); console.log(JSON.stringify({count:g.dodgeCityCardCount,revision:g.dodgeCityRevision}));"
  if ($LASTEXITCODE -ne 0) { throw 'Game chưa nạp dữ liệu Dodge City. Hãy kiểm tra mã game và tệp dữ liệu.' }
  $dodgeCityData = $dodgeCityData | ConvertFrom-Json
  Say "Dữ liệu Dodge City: $dodgeCityFile ($($dodgeCityData.count) lá)" Green
  $revision = & $node -e "const fs=require('fs'),crypto=require('crypto'); console.log(crypto.createHash('sha256').update(Buffer.concat(['server.js','game.js','room-timer.js','room-pause.js'].map(f=>fs.readFileSync(f)))).digest('hex'));"
  if ($LASTEXITCODE -ne 0) { throw 'Không đọc được mã nguồn game trong thư mục hiện tại.' }

  $localUrl = "http://127.0.0.1:$Port"
  $listenerId = Find-Listener
  $health = Read-JsonUrl "$localUrl/api/health"
  $meta = if (-not $health) { Read-JsonUrl "$localUrl/api/meta" } else { $null }
  $isBang = $health.app -eq 'bang-online' -or ($meta.cards.Bang -and $meta.roles.Sheriff)
  if ($CheckOnly) {
    Say "Đường dẫn đúng: $(Join-Path $root 'server.js')"
    Say "PID giữ cổng: $listenerId"
    Say "Server Bang đang chạy: $([bool]$isBang)"
    Say "Server đã nạp mã mới nhất: $([bool]($health -and $health.revision -eq $revision))"
    Say "Server đã nạp dữ liệu Dodge City mới nhất: $([bool]($health -and $health.greenCardsRevision -eq $dodgeCityData.revision -and $health.dodgeCityCardCount -eq $dodgeCityData.count))"
    exit 0
  }
  if ($listenerId -or $health -or $meta) {
    if (-not $isBang) { throw "Cổng $Port đang được chương trình khác sử dụng. Game chưa được khởi động." }
    $stale = -not $health -or $health.revision -ne $revision -or $health.greenCardsRevision -ne $dodgeCityData.revision -or $health.dodgeCityCardCount -ne $dodgeCityData.count
    if ($stale -and -not $Restart) {
      Say 'Server đang chạy mã hoặc dữ liệu Dodge City cũ. Mở lại trình duyệt sẽ chưa áp dụng bản mới.' Yellow
      Say 'Khởi động lại sẽ mất các phòng/ván đang mở; tài khoản vẫn được giữ.' Yellow
      $answer = Read-Host 'Nhập R để khởi động lại, hoặc Enter để giữ server đang chạy'
      $Restart = $answer -eq 'R'
    }
    if (-not $Restart) {
      Say "Server đang chạy ở cửa sổ khác: $localUrl" Green
      Say 'Cửa sổ này chỉ mở lại game. Giữ cửa sổ server gốc nếu đang chơi.'
      Open-Game $localUrl
      exit 0
    }
    if (-not $listenerId) { throw 'Không xác định được PID của server cũ. Hãy đóng cửa sổ server cũ rồi chạy lại.' }
    $existing = Get-Process -Id $listenerId -ErrorAction Stop
    if ($existing.ProcessName -ne 'node') { throw 'Tiến trình giữ cổng không phải Node.js; không tự dừng chương trình này.' }
    Say "Đang dừng server cũ (PID $listenerId)..." Yellow
    Stop-Process -Id $listenerId -ErrorAction Stop
    $existing.WaitForExit()
  }

  if (-not $SkipFirewall) {
    $rule = Get-NetFirewallRule -DisplayName 'Bang Online' -ErrorAction SilentlyContinue
    if (-not $rule) {
      Say "Cần mở cổng $Port cho bạn bè. Windows có thể hỏi quyền Administrator." Cyan
      try {
        $command = "New-NetFirewallRule -DisplayName 'Bang Online' -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Any | Out-Null"
        Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile', '-Command', $command
      } catch { Say 'Chưa mở được tường lửa. Game vẫn dùng được trên máy này.' Yellow }
    }
  }
  $ips = @()
  try {
    $ips = [Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() |
      Where-Object { $_.OperationalStatus -eq 'Up' } |
      ForEach-Object { $_.GetIPProperties().UnicastAddresses } |
      Where-Object { $_.Address.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork } |
      ForEach-Object { $_.Address.ToString() }
  } catch {}
  $radmin = $ips | Where-Object { $_ -like '26.*' } | Select-Object -First 1
  $lan = $ips | Where-Object { $_ -like '192.168.*' -or $_ -like '10.*' } | Select-Object -First 1
  $address = if ($radmin) { $radmin } elseif ($lan) { $lan } else { 'localhost' }
  $shareUrl = "http://${address}:$Port"
  Say "`nLINK CHO BẠN BÈ: $shareUrl" Green
  Say 'Đóng cửa sổ server này = tắt game.' Yellow
  if (-not $NoBrowser) { try { Set-Clipboard $shareUrl } catch {} }

  $env:PORT = [string]$Port
  $serverPath = Join-Path $root 'server.js'
  $process = Start-Process -FilePath $node -ArgumentList ('"' + $serverPath + '"') -WorkingDirectory $root -NoNewWindow -PassThru
  $ready = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    $process.Refresh()
    if ($process.HasExited) { throw "Server vừa khởi động đã dừng (mã lỗi $($process.ExitCode)). Xem thông báo Node.js phía trên." }
    $running = Read-JsonUrl "$localUrl/api/health"
    if ($running.pid -eq $process.Id -and $running.revision -eq $revision -and $running.greenCardsRevision -eq $dodgeCityData.revision -and $running.dodgeCityCardCount -eq $dodgeCityData.count) { $ready = $true; break }
    Start-Sleep -Milliseconds 250
  }
  if (-not $ready) { throw 'Server chưa sẵn sàng. Không mở lại nhầm server cũ.' }
  Say "Đã nạp mã mới nhất. PID $($process.Id)." Green
  Say 'Đã nạp dữ liệu Dodge City. Có thể bật bản mở rộng khi tạo phòng.' Green
  Open-Game $shareUrl
  $process.WaitForExit()
  Say "Server đã dừng. Mã thoát: $($process.ExitCode)." Yellow
  exit $process.ExitCode
} catch {
  Say "`nKhông khởi động được game: $($_.Exception.Message)" Red
  try {
    $logDir = Join-Path $root 'data'
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    Add-Content -LiteralPath (Join-Path $logDir 'launcher.log') -Encoding UTF8 -Value "$(Get-Date -Format o) | $root | $($_.Exception.Message)"
    Say "Chi tiết lỗi: $(Join-Path $logDir 'launcher.log')" Yellow
  } catch {}
  exit 1
}

# Cắt phần tranh vuông từ ảnh lá bài (180x279) → public/cards/<tên-không-dấu>.jpg (160x160), dùng thay icon trong cardHTML (app.js).
# Chạy: powershell -ExecutionPolicy Bypass -File tools/crop-card-art.ps1 -Src "<thư mục ảnh lá>" [-Sheet <file png xem thử>]
param(
  [Parameter(Mandatory = $true)][string]$Src,
  [string]$Out = '',
  [string]$Sheet = ''
)
if (-not $Out) { $Out = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) '..\public\cards' }
Add-Type -AssemblyName System.Drawing

# file ảnh → tên lá trong game.js
$map = [ordered]@{
  'Bang_Playable_Card' = 'Bang'; 'MISSED21_card' = 'Missed'; 'BEER_Card' = 'Beer'; 'SALOON' = 'Saloon'; 'STAGECOACH' = 'Stagecoach'
  'WELLS_FARGO' = 'Wells Fargo'; 'GENERAL_STORE' = 'General Store'; 'PANIC21' = 'Panic'; 'CAT_BALOU' = 'Cat Balou'; 'DUEL' = 'Duel'
  'INDIANS' = 'Indians'; 'GATLING' = 'Gatling'; 'BARREL' = 'Barrel'; 'MUSTANG' = 'Mustang'; 'SCOPE' = 'Scope'; 'JAIL' = 'Jail'
  'DYNAMITE' = 'Dynamite'; 'VOLCANIC' = 'Volcanic'; 'SCHOFIELD' = 'Schofield'; 'REMINGTON' = 'Remington'; 'REV._CARABINE' = 'Rev. Carabine'
  'WINCHESTER' = 'Winchester'; 'BIBLE' = 'Bible'; 'BUFFALO_RIFLE' = 'Buffalo Rifle'; 'CAN_CAN' = 'Can Can'; 'CANTEEN' = 'Canteen'
  'CONESTOGA' = 'Conestoga'; 'DERRINGER' = 'Derringer'; 'HOWITZER' = 'Howitzer'; 'IRON_PLATE' = 'Iron Plate'; 'KNIFE' = 'Knife'
  'PEPPERBOX' = 'Pepperbox'; 'PONY_EXPRESS' = 'Pony Express'; 'SOMBRERO' = 'Sombrero'; 'TEN_GALLON_HAT' = 'Ten Gallon Hat'
  'RAG_TIME' = 'Rag Time'; 'BRAWL' = 'Brawl'; 'DODGE' = 'Dodge'; 'SPRINGFIELD' = 'Springfield'; 'TEQUILA' = 'Tequila'; 'WHISKY' = 'Whisky'
  'BINACULAR' = 'Binocular'; 'HIDEOUT' = 'Hideout'; 'PUNCH' = 'Punch'
}
# Vùng vuông mặc định (x, y, cạnh) trên ảnh 180x279: dưới tên lá, trên dòng ký hiệu/luật
$default = @(26, 68, 128)
# Lá có tranh lệch chỗ / thấp hơn: chỉnh riêng
# Tranh kéo sát đoạn chữ luật → vùng mặc định ăn vào ký hiệu quyển sách đầu đoạn luật: cắt nhỏ hơn, dừng trên quyển sách
$over = @{
  'Duel' = @(37, 66, 108); 'Dynamite' = @(37, 66, 108); 'General Store' = @(37, 66, 108); 'Indians' = @(37, 66, 108); 'Jail' = @(37, 66, 108)
}
# Lá súng: hình súng nằm chéo gần kín bề ngang nên không cắt vuông được → dò khung bao nét vẽ (pixel tối) trong vùng
# (x1, y1, x2, y2) — dưới tên lá, trên số tầm / dòng luật — rồi thu cả khẩu súng vào ô vuông nền trắng
$fit = @{
  'Volcanic' = @(14, 54, 166, 150); 'Schofield' = @(14, 54, 166, 196); 'Remington' = @(14, 54, 166, 196)
  'Rev. Carabine' = @(14, 54, 166, 196); 'Winchester' = @(14, 54, 166, 196)
}
function Get-InkBox($img, $r) {
  $bmp = New-Object System.Drawing.Bitmap $img
  $x1 = 999; $y1 = 999; $x2 = -1; $y2 = -1
  for ($y = $r[1]; $y -lt $r[3]; $y++) {
    for ($x = $r[0]; $x -lt $r[2]; $x++) {
      $c = $bmp.GetPixel($x, $y)
      $hi = [math]::Max($c.R, [math]::Max($c.G, $c.B)); $lo = [math]::Min($c.R, [math]::Min($c.G, $c.B))
      if (($c.R + $c.G + $c.B) / 3 -lt 150 -and ($hi - $lo) -lt 45) { # nét mực xám/đen, bỏ viền xanh của lá
        if ($x -lt $x1) { $x1 = $x }; if ($x -gt $x2) { $x2 = $x }
        if ($y -lt $y1) { $y1 = $y }; if ($y -gt $y2) { $y2 = $y }
      }
    }
  }
  $bmp.Dispose()
  return @($x1, $y1, ($x2 - $x1 + 1), ($y2 - $y1 + 1))
}

$slug = { param($n) ($n.ToLower() -replace '[^a-z0-9]+', '-').Trim('-') }
New-Item -ItemType Directory -Force $Out | Out-Null
$names = @()
foreach ($k in $map.Keys) {
  $file = Join-Path $Src "$k.jpg"
  if (-not (Test-Path $file)) { Write-Warning "Thiếu $file"; continue }
  $r = if ($over.ContainsKey($map[$k])) { $over[$map[$k]] } else { $default }
  $img = [System.Drawing.Image]::FromFile($file)
  $bmp = New-Object System.Drawing.Bitmap 160, 160
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = 'HighQualityBicubic'; $g.PixelOffsetMode = 'HighQuality'
  if ($fit.ContainsKey($map[$k])) {
    $b = Get-InkBox $img $fit[$map[$k]]
    $pad = 10; $s = [math]::Min((160 - 2 * $pad) / $b[2], (160 - 2 * $pad) / $b[3])
    $w = [int]($b[2] * $s); $h = [int]($b[3] * $s)
    $px = New-Object System.Drawing.Bitmap $img; $bg = $px.GetPixel(90, 56); $px.Dispose()
    $g.Clear($bg) # nền đệm = màu giấy của chính lá đó (ngay dưới tên lá) để không lộ mép
    $g.DrawImage($img, (New-Object System.Drawing.Rectangle ([int]((160 - $w) / 2)), ([int]((160 - $h) / 2)), $w, $h), (New-Object System.Drawing.Rectangle $b[0], $b[1], $b[2], $b[3]), 'Pixel')
  } else {
    $g.DrawImage($img, (New-Object System.Drawing.Rectangle 0, 0, 160, 160), (New-Object System.Drawing.Rectangle $r[0], $r[1], $r[2], $r[2]), 'Pixel')
  }
  $enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
  $p = New-Object System.Drawing.Imaging.EncoderParameters 1
  $p.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), 88L
  $dest = Join-Path $Out ((& $slug $map[$k]) + '.jpg')
  $bmp.Save($dest, $enc, $p)
  $g.Dispose(); $bmp.Dispose(); $img.Dispose()
  $names += $map[$k]
}
"Đã cắt $($names.Count) lá vào $Out"

# Bảng xem thử: 11 cột, mỗi ô 100px + tên
if ($Sheet) {
  $cols = 11; $cell = 100; $rows = [math]::Ceiling($names.Count / $cols)
  $sh = New-Object System.Drawing.Bitmap ($cols * $cell), ($rows * ($cell + 14))
  $g = [System.Drawing.Graphics]::FromImage($sh); $g.Clear([System.Drawing.Color]::White)
  $font = New-Object System.Drawing.Font 'Arial', 8
  for ($i = 0; $i -lt $names.Count; $i++) {
    $x = ($i % $cols) * $cell; $y = [math]::Floor($i / $cols) * ($cell + 14)
    $im = [System.Drawing.Image]::FromFile((Join-Path $Out ((& $slug $names[$i]) + '.jpg')))
    $g.DrawImage($im, $x + 2, $y, $cell - 4, $cell - 4); $im.Dispose()
    $g.DrawString($names[$i], $font, [System.Drawing.Brushes]::Black, $x + 2, $y + $cell - 3)
  }
  $sh.Save($Sheet, [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $sh.Dispose()
}

param([string]$AppRoot, [string]$ProductName = 'Nolys')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$logo = [System.Drawing.Image]::FromFile((Join-Path $AppRoot 'src-tauri/icons/128x128@2x.png'))
try {
    $header = [System.Drawing.Bitmap]::new(150, 57, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $g = [System.Drawing.Graphics]::FromImage($header)
    $g.Clear([System.Drawing.Color]::White)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawImage($logo, 96, 3, 51, 51)
    $g.Dispose()
    $header.Save((Join-Path $AppRoot 'src-tauri/installer/installerHeader.bmp'), [System.Drawing.Imaging.ImageFormat]::Bmp)
    $header.Dispose()
    $sidebar = [System.Drawing.Bitmap]::new(164, 314, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $g = [System.Drawing.Graphics]::FromImage($sidebar)
    $g.Clear([System.Drawing.ColorTranslator]::FromHtml('#080E25'))
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $g.DrawImage($logo, 22, 40, 120, 120)
    $titleFont = [System.Drawing.Font]::new('Segoe UI', 23, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $smallFont = [System.Drawing.Font]::new('Segoe UI', 11, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
    $titleBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#F1F3FF'))
    $smallBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#B8C9FF'))
    $format = [System.Drawing.StringFormat]::new()
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $g.DrawString($ProductName, $titleFont, $titleBrush, [System.Drawing.RectangleF]::new(8, 180, 148, 35), $format)
    $g.DrawString('Votre îlot Windows', $smallFont, $smallBrush, [System.Drawing.RectangleF]::new(8, 223, 148, 24), $format)
    $g.DrawString('NALYD2400', $smallFont, $smallBrush, [System.Drawing.RectangleF]::new(8, 283, 148, 24), $format)
    $g.Dispose()
    $sidebar.Save((Join-Path $AppRoot 'src-tauri/installer/installerSidebar.bmp'), [System.Drawing.Imaging.ImageFormat]::Bmp)
    $sidebar.Dispose()
    $format.Dispose(); $titleFont.Dispose(); $smallFont.Dispose(); $titleBrush.Dispose(); $smallBrush.Dispose()
} finally { $logo.Dispose() }
Write-Output 'NSIS header and sidebar updated.'

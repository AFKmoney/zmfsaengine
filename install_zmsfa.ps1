# ZMSFA Engine - Setup Script
$InstallDir = "C:\Users\PHIL\zmsfaengine_final"
$BatPath = "C:\Users\PHIL\zmsfa.bat"
$ShortcutName = "ZMSFA Engine.lnk"
$DesktopPath = [System.IO.Path]::Combine([Environment]::GetFolderPath("Desktop"), $ShortcutName)

Write-Host "--- Initialisation de l'Installation ZMSFA ---" -ForegroundColor Cyan

# 1. Verification
if (-not (Test-Path $BatPath)) {
    Write-Host "Creation du point d'entree universel..." -ForegroundColor Yellow
    $BatContent = "@echo off`nnode $InstallDir\packages\cli\dist\index.js --yolo --autonomous `"ZMSFA Omega-MODE ACTIVATED. Initiate continuous evolution. Objective: %*`""
    Set-Content -Path $BatPath -Value $BatContent
}

# 2. Raccourci
Write-Host "Creation du raccourci sur le Bureau..." -ForegroundColor Yellow
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($DesktopPath)
$Shortcut.TargetPath = "cmd.exe"
$Shortcut.Arguments = "/K zmsfa"
$Shortcut.Description = "ZMSFA Omega Triadic Torus Engine"
$Shortcut.WorkingDirectory = $InstallDir
$Shortcut.IconLocation = "cmd.exe,0"
$Shortcut.Save()

# 3. PATH
$CurrentPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($CurrentPath -notlike "*C:\Users\PHIL*") {
    Write-Host "Ajout au PATH..." -ForegroundColor Yellow
    $NewPath = $CurrentPath + ";C:\Users\PHIL"
    [Environment]::SetEnvironmentVariable("Path", $NewPath, "User")
}

Write-Host "--- Installation Terminee ! ---" -ForegroundColor Green

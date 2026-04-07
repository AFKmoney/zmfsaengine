# ZMSFA Engine - Setup Script (Official v-Infinity)
$InstallDir = "C:\Users\PHIL\zmsfaengine_final"
$BatPath = "C:\Users\PHIL\zmfsa.bat"
$ShortcutName = "ZMSFA Omega Engine.lnk"
$DesktopPath = [System.IO.Path]::Combine([Environment]::GetFolderPath("Desktop"), $ShortcutName)

Write-Host "--- Initialisation de l'Installation ZMSFA ---" -ForegroundColor Cyan

# 1. Point d'entrée BAT (zmfsa)
Write-Host "Configuration du point d'entree universel (zmfsa)..." -ForegroundColor Yellow
$BatContent = "@echo off`nnode $InstallDir\packages\cli\dist\index.js --yolo --autonomous `"ZMSFA Omega-MODE ACTIVATED. Initiate continuous evolution. Objective: %*`""
Set-Content -Path $BatPath -Value $BatContent

# 2. Liaison Globale via NPM
Write-Host "Liaison globale au systeme (npm link)..." -ForegroundColor Yellow
Set-Location -Path "$InstallDir\packages\cli"
npm link --force
Set-Location -Path $InstallDir

# 3. Raccourci Bureau
Write-Host "Creation du raccourci sur le Bureau..." -ForegroundColor Yellow
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($DesktopPath)
$Shortcut.TargetPath = "cmd.exe"
$Shortcut.Arguments = "/K zmfsa"
$Shortcut.Description = "ZMSFA Omega Triadic Torus Engine v-Infinity"
$Shortcut.WorkingDirectory = $InstallDir
$Shortcut.IconLocation = "cmd.exe,0"
$Shortcut.Save()

# 4. PATH Windows
$CurrentPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($CurrentPath -notlike "*C:\Users\PHIL*") {
    Write-Host "Mise a jour du PATH Windows..." -ForegroundColor Yellow
    $NewPath = $CurrentPath + ";C:\Users\PHIL"
    [Environment]::SetEnvironmentVariable("Path", $NewPath, "User")
}

Write-Host "--- ZMSFA Ω-ENGINE : INSTALLATION TERMINEE ---" -ForegroundColor Green
Write-Host "L'Engine est pret. Utilise la commande 'zmfsa' ou le raccourci Bureau." -ForegroundColor White

# sudocode installer for Windows
# Usage: irm https://raw.githubusercontent.com/sudocode-ai/sudocode/main/scripts/install.ps1 | iex

$ErrorActionPreference = "Stop"

$GITHUB_REPO = "sudocode-ai/sudocode"
$GITHUB_RELEASES = "https://github.com/$GITHUB_REPO/releases"
$INSTALL_DIR = if ($env:SUDOCODE_INSTALL_DIR) { $env:SUDOCODE_INSTALL_DIR } else { "$env:LOCALAPPDATA\sudocode" }

function Write-Info($msg)    { Write-Host "[info] $msg" -ForegroundColor Cyan }
function Write-Success($msg) { Write-Host "[ok] $msg" -ForegroundColor Green }
function Write-Warn($msg)    { Write-Host "[warn] $msg" -ForegroundColor Yellow }
function Write-Err($msg)     { Write-Host "[error] $msg" -ForegroundColor Red }
function Stop-WithError($msg) { Write-Err $msg; exit 1 }

# Parse arguments
$Channel = "stable"
$Version = ""

for ($i = 0; $i -lt $args.Count; $i++) {
    switch ($args[$i]) {
        "--dev"     { $Channel = "dev" }
        "--version" { $i++; $Version = $args[$i]; $Channel = "version" }
        "--help"    {
            Write-Host @"
sudocode installer for Windows

Usage:
  irm https://raw.githubusercontent.com/sudocode-ai/sudocode/main/scripts/install.ps1 | iex

Options:
  --dev              Install latest development build
  --version TAG      Install specific version (e.g. v0.1.22)
  --help             Show this help message

Environment:
  SUDOCODE_INSTALL_DIR   Custom install directory (default: %LOCALAPPDATA%\sudocode)
"@
            exit 0
        }
    }
}

Write-Info "sudocode installer"
Write-Host ""

# Detect platform
$Arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { Stop-WithError "Only 64-bit Windows is supported." }
$Platform = "win-$Arch"
Write-Info "Platform: $Platform"

# Resolve version
switch ($Channel) {
    "stable" {
        Write-Info "Fetching latest stable version..."
        $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$GITHUB_REPO/releases/latest" -ErrorAction Stop
        $Version = $release.tag_name
    }
    "dev" {
        Write-Info "Fetching latest dev build..."
        $releases = Invoke-RestMethod -Uri "https://api.github.com/repos/$GITHUB_REPO/releases?per_page=20" -ErrorAction Stop
        $devRelease = $releases | Where-Object { $_.tag_name -match "^dev-" } | Select-Object -First 1
        if (-not $devRelease) { Stop-WithError "No dev builds found." }
        $Version = $devRelease.tag_name
    }
    "version" {
        # already set
    }
}

if (-not $Version) { Stop-WithError "Failed to determine version." }
Write-Info "Installing sudocode $Version for $Platform"

# Create temp directory
$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) "sudocode-install-$(Get-Random)"
New-Item -ItemType Directory -Path $TempDir -Force | Out-Null

try {
    # Download manifest
    $ManifestUrl = "$GITHUB_RELEASES/download/$Version/manifest.json"
    $ManifestPath = Join-Path $TempDir "manifest.json"
    Write-Info "Downloading manifest..."
    Invoke-WebRequest -Uri $ManifestUrl -OutFile $ManifestPath -UseBasicParsing -ErrorAction Stop

    $Manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json
    $PlatformInfo = $Manifest.platforms.$Platform
    if (-not $PlatformInfo) { Stop-WithError "Platform $Platform not found in manifest." }

    $DownloadUrl = $PlatformInfo.url
    $ExpectedChecksum = $PlatformInfo.sha256

    # Download zip
    $ZipPath = Join-Path $TempDir "sudocode.zip"
    Write-Info "Downloading sudocode..."
    Invoke-WebRequest -Uri $DownloadUrl -OutFile $ZipPath -UseBasicParsing -ErrorAction Stop

    # Verify checksum
    Write-Info "Verifying checksum..."
    $ComputedHash = (Get-FileHash -Path $ZipPath -Algorithm SHA256).Hash.ToLower()
    if ($ComputedHash -ne $ExpectedChecksum) {
        Stop-WithError "Checksum mismatch!`n  Expected: $ExpectedChecksum`n  Got:      $ComputedHash"
    }
    Write-Success "Checksum verified"

    # Extract
    $ExtractDir = Join-Path $TempDir "extract"
    Expand-Archive -Path $ZipPath -DestinationPath $ExtractDir -Force
    $Extracted = Get-ChildItem -Path $ExtractDir -Directory | Select-Object -First 1
    if (-not $Extracted) { Stop-WithError "Empty archive" }

    # Install to INSTALL_DIR
    Write-Info "Installing to $INSTALL_DIR..."
    if (Test-Path $INSTALL_DIR) { Remove-Item -Path $INSTALL_DIR -Recurse -Force }
    New-Item -ItemType Directory -Path $INSTALL_DIR -Force | Out-Null

    # Copy contents
    Copy-Item -Path "$($Extracted.FullName)\*" -Destination $INSTALL_DIR -Recurse -Force
    Write-Success "Installed to $INSTALL_DIR"

    # Add bin\ to user PATH
    $BinDir = Join-Path $INSTALL_DIR "bin"
    $UserPath = [Environment]::GetEnvironmentVariable("PATH", "User")
    $PathModified = $false

    if ($UserPath -split ";" | Where-Object { $_ -eq $BinDir }) {
        Write-Info "$BinDir already in PATH"
    } else {
        Write-Info "Adding $BinDir to user PATH..."
        $NewPath = "$BinDir;$UserPath"
        [Environment]::SetEnvironmentVariable("PATH", $NewPath, "User")
        # Also update current session
        $env:PATH = "$BinDir;$env:PATH"
        $PathModified = $true
        Write-Success "Added $BinDir to PATH"
    }

    Write-Host ""
    Write-Success "sudocode installed!"
    Write-Host ""

    if ($PathModified) {
        Write-Host "  Restart your terminal, then verify:" -ForegroundColor White
    } else {
        Write-Host "  Verify:" -ForegroundColor White
    }
    Write-Host "    sudocode --version" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Get started:" -ForegroundColor White
    Write-Host "    cd <project>" -ForegroundColor Yellow
    Write-Host "    sudocode init" -ForegroundColor Yellow
    Write-Host ""

} finally {
    # Cleanup temp
    if (Test-Path $TempDir) { Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue }
}

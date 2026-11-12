param([string]$Dotnet = 'dotnet', [string]$Iscc = '', [switch]$SkipPortable)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $projectRoot
if (!$SkipPortable) { & "$PSScriptRoot/build-windows.ps1" -Dotnet $Dotnet }
$version = (Get-Content -LiteralPath package.json -Raw | ConvertFrom-Json).version
$packageDirectory = Join-Path $projectRoot "release/SpineShelf-$version-win-x64"
if (!(Test-Path -LiteralPath (Join-Path $packageDirectory 'SpineShelf.exe'))) { throw 'Build the portable Windows app first.' }
python scripts/prepare-installer.py
if ($LASTEXITCODE) { throw 'Prerequisite preparation failed.' }
$bootstrapper = Join-Path $projectRoot '.cache/installer/MicrosoftEdgeWebview2Setup.exe'
$signature = Get-AuthenticodeSignature -LiteralPath $bootstrapper
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Microsoft Corporation') { throw 'The WebView2 bootstrapper does not have a valid Microsoft signature.' }
if (!$Iscc) {
    $compiler = Get-Command ISCC.exe -ErrorAction SilentlyContinue
    if ($compiler) { $Iscc = $compiler.Source }
    else {
        foreach ($candidate in @("${env:ProgramFiles(x86)}/Inno Setup 6/ISCC.exe", "$env:ProgramFiles/Inno Setup 7/ISCC.exe")) {
            if (Test-Path -LiteralPath $candidate) { $Iscc = $candidate; break }
        }
    }
}
if (!$Iscc) { throw 'Install Inno Setup from jrsoftware.org, or pass -Iscc with its compiler path.' }
& $Iscc "/DAppVersion=$version" "/DPackageDir=$packageDirectory" "/DDepsFile=$projectRoot/.cache/installer/Prerequisites.iss" "$projectRoot/installer/SpineShelf.iss"
if ($LASTEXITCODE) { throw 'Installer compilation failed.' }
$installer = Join-Path $projectRoot "release/SpineShelf-$version-Setup-x64.exe"
Get-FileHash -LiteralPath $installer -Algorithm SHA256 | Format-List

param([string]$Dotnet = 'dotnet', [switch]$SkipFrontend)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $projectRoot
$env:DOTNET_CLI_HOME = Join-Path $projectRoot '.cache/dotnet'
$env:NUGET_PACKAGES = Join-Path $projectRoot '.cache/nuget'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE = '1'
$version = (Get-Content -LiteralPath package.json -Raw | ConvertFrom-Json).version
$destination = Join-Path $projectRoot "release/SpineShelf-$version-win-x64"
New-Item -ItemType Directory -Force -Path $destination | Out-Null
python scripts/generate_assets.py
if ($LASTEXITCODE) { throw 'Asset generation failed.' }
if (!$SkipFrontend) {
    & npm.cmd ci --no-audit --no-fund
    if ($LASTEXITCODE) { throw 'Frontend dependency installation failed.' }
    & npm.cmd run build
    if ($LASTEXITCODE) { throw 'Frontend build failed.' }
}
& $Dotnet publish desktop/SpineShelf.csproj -c Release -r win-x64 --self-contained false -o $destination --nologo
if ($LASTEXITCODE) { throw 'Desktop build failed.' }
$appDirectory = Join-Path $destination 'app'
New-Item -ItemType Directory -Force -Path $appDirectory | Out-Null
foreach ($name in @('shelf.py', 'undertone.py', 'index.html', 'app.js', 'music.js', 'style.css', 'button-click.wav')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $name) -Destination $appDirectory -Force
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'dist') -Destination $appDirectory -Recurse -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'assets') -Destination $appDirectory -Recurse -Force
foreach ($name in @('LICENSE','README.md','THIRD_PARTY_NOTICES.md','CHANGELOG.md')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $name) -Destination $destination -Force
}
$pythonArchive = Join-Path $projectRoot '.cache/python-3.15.0-embed-amd64.zip'
if (!(Test-Path -LiteralPath $pythonArchive)) {
    Invoke-WebRequest 'https://www.python.org/ftp/python/3.15.0/python-3.15.0-embed-amd64.zip' -OutFile $pythonArchive
}
$expectedHash = 'A6999BCBCBE56F937159EF79C2630260ECA99F65F7860BC5CD20430324079A44'
if ((Get-FileHash -LiteralPath $pythonArchive -Algorithm SHA256).Hash -ne $expectedHash) { throw 'Python archive checksum mismatch.' }
Expand-Archive -LiteralPath $pythonArchive -DestinationPath (Join-Path $destination 'python') -Force
# Embedded Python uses an isolated import path, so explicitly include our app modules.
Set-Content -LiteralPath (Join-Path $destination 'python/python315._pth') -Value "python315.zip`n.`n../app" -Encoding ascii
& (Join-Path $destination 'python/python.exe') -c "import undertone"
if ($LASTEXITCODE) { throw 'Packaged Python cannot import the Undertone adapter.' }
$licenses = Join-Path $destination 'licenses'
New-Item -ItemType Directory -Force -Path $licenses | Out-Null
Copy-Item -LiteralPath (Join-Path $env:NUGET_PACKAGES 'microsoft.web.webview2/1.0.3650.58/LICENSE.txt') -Destination (Join-Path $licenses 'WebView2.txt') -Force
foreach ($package in @('react','react-dom','scheduler','motion','framer-motion','motion-dom','motion-utils','@hugeicons/react','@hugeicons/core-free-icons')) {
    Get-ChildItem -Path (Join-Path $projectRoot "node_modules/$package/LICENSE*") | ForEach-Object {
        $name = $package.Replace('/','-').Replace('@','') + '-' + $_.Name
        Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $licenses $name) -Force
    }
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'node_modules/ogl/README.md') -Destination (Join-Path $licenses 'OGL-README-and-Unlicense.md') -Force
$archive = Join-Path $projectRoot "release/SpineShelf-$version-win-x64.zip"
Compress-Archive -Path $destination -DestinationPath $archive -Force
Get-Item -LiteralPath $archive | Select-Object FullName, Length

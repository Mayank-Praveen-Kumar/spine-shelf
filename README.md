# Spine Shelf

A personal EPUB library and reader for Windows.

## Windows app

Download `SpineShelf-0.3.1-Setup-x64.exe` from Releases and run it. Setup installs for
your Windows account, adds a Start menu shortcut, offers a desktop shortcut, and
registers an uninstaller. It installs shared Microsoft runtimes only if missing;
the .NET runtime step may require an administrator prompt. Your books and reading
preferences survive upgrades and uninstall.

For a portable copy, download the Windows ZIP from Releases, extract the folder, and open
`SpineShelf.exe`. No Python or Node installation is needed for the packaged app.
The lightweight build uses the shared .NET 10 Desktop Runtime and Microsoft Edge
WebView2 Runtime. Both must be installed. It does not bundle Electron or Chromium.

The native window has its own icon and standard Windows minimize/maximize/close controls.
Closing the window stops its local server; minimizing suspends the embedded browser.

## Run from source

Install Python 3, Node.js and the .NET 10 SDK. Then run:

```powershell
npm ci
npm run build
python scripts/generate_assets.py
dotnet build desktop/SpineShelf.csproj -c Release -o build/desktop
& './build/desktop/SpineShelf.exe' --app-root $PWD
```

You can also run `python shelf.py` to use the browser version, or double-click
`Open Spine Shelf.cmd` after building the desktop executable.

Create a portable Windows release with `./scripts/build-windows.ps1`.
Pass `-Dotnet 'path/to/dotnet.exe'` if the SDK is not on PATH.

To build the installer, install Inno Setup 6.3+ or 7 from jrsoftware.org, then run
`./scripts/build-installer.ps1`. Pass `-SkipPortable` if the matching portable folder
is already built, and `-Iscc 'path/to/ISCC.exe'` for a custom compiler location.
The build verifies the official .NET download's SHA-512 and the WebView2 bootstrapper's
Microsoft signature. Setup checks the .NET download's SHA-256 before running it.

Features include EPUB import, a cover carousel, named shelves, custom backgrounds,
reader fonts and themes, saved reading progress, and external book searches.

Books are stored in `%LOCALAPPDATA%\SpineShelf`. Browser storage holds preferences,
fonts, shelf membership, backgrounds, and reading progress. Personal books and
download lists are excluded from this repository.

The desktop window uses its own persistent WebView2 profile in
`%LOCALAPPDATA%\SpineShelf\Desktop Profile`. Existing EPUB files are shared with the
browser version, but browser-specific preferences and progress are separate.

## Undertone music player

Use the music-note icon in the sidebar to open the Undertone player. Install Undertone
1.8.2 or a newer build with Local API support, then switch on **Settings → Integrations
→ Local API** in Undertone and click **Connect** in Spine Shelf.

The page shows the current track and artwork, playback controls, seek and volume,
library search, and the upcoming queue. Play a search result immediately or add it
to the queue. Audio plays in Undertone, using its existing library and audio settings.
The reader's Music button takes you to this page.

The Windows app can launch Undertone. Use Connection settings to locate a portable
Undertone executable or select a custom data folder containing `local-api.json`.
The normal data folder is `%APPDATA%\Undertone`. No token needs to be pasted: the
local Python service reads Undertone's discovery file and keeps its token out of
the web page. Requests go only to the loopback interface, and remote redirects are
rejected. Turning off Local API in Undertone disconnects the player.

## Shared appearance

Spine Shelf follows Undertone's active theme, light/dark mode, accent and chosen icon
palette through the local appearance endpoint. This includes listening modes, custom
themes and artwork accents. The matching book icon updates in the app, title bar and
taskbar; the shortcut's embedded icon uses the same default violet palette as Undertone.
The last appearance is cached for starts when Undertone is closed. Theme checks run
once every 15 seconds while visible, stop while hidden or reading, and refresh on focus.

Buttons and single-line fields use capsule corners on every page. Reading paper themes
remain available. Both apps use the same original soft click sound; Undertone's switch
is under Settings → General → Interface click sounds.

## Performance

Autoplay is off. The cover carousel renders on demand, stops while hidden or reading,
caps its render target at 1.5 million pixels and uploads covers at up to 768 pixels
on the longest edge. WebView2 suspends when minimized. There are no background
download-folder checks until an OceanofPDF search is opened. Music status is polled only
while its page is visible; it stops while reading, on other pages, or when hidden.

## Versions and license

`v0.1.0` preserves the original browser app source; `v0.2.0` adds the desktop window
and refreshed interface; `v0.2.1` adds the Windows installer; `v0.3.0` adds the Undertone player, and `v0.3.1` shares its theme and icon colours. See CHANGELOG.md for version history.
Application source is MIT licensed; dependencies retain their respective licenses.

The original third-party click sound is replaced by an original generated sound.
The original browser version's source is available under the `v0.1.0` tag.

Runtime downloads: [Microsoft .NET Desktop Runtime](https://dotnet.microsoft.com/en-us/download/dotnet/10.0)
and [Microsoft WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).

# Spine Shelf

A personal EPUB library and reader for Windows.

## Windows app

Download the latest Windows ZIP from Releases, extract the entire folder, and open
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

Features include EPUB import, a cover carousel, named shelves, custom backgrounds,
reader fonts and themes, saved reading progress, and external book searches.

Books are stored in `%LOCALAPPDATA%\SpineShelf`. Browser storage holds preferences,
fonts, shelf membership, backgrounds, and reading progress. Personal books and
download lists are excluded from this repository.

The desktop window uses its own persistent WebView2 profile in
`%LOCALAPPDATA%\SpineShelf\Desktop Profile`. Existing EPUB files are shared with the
browser version, but browser-specific preferences and progress are separate.

## Performance

Autoplay is off. The cover carousel renders on demand, stops while hidden or reading,
caps its render target at 1.5 million pixels and uploads covers at up to 768 pixels
on the longest edge. WebView2 suspends when minimized. There are no background
download-folder checks until an OceanofPDF search is opened.

## Versions and license

`v0.1.0` preserves the original browser app source; `v0.2.0` adds the desktop window
and refreshed interface. See CHANGELOG.md for known version history.
Application source is MIT licensed; dependencies retain their respective licenses.

The original third-party click sound is replaced by an original generated sound.
The original browser version's source is available under the `v0.1.0` tag.

Runtime downloads: [Microsoft .NET Desktop Runtime](https://dotnet.microsoft.com/en-us/download/dotnet/10.0)
and [Microsoft WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).

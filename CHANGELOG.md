# Changelog

## 0.3.1 — 2026-11-12

- Follow Undertone’s current theme, accent, light/dark mode and all ten icon palettes.
- Match the window/taskbar icon colours and cache the last appearance.
- Enforce pill-shaped buttons and fields throughout search, library, reader and player.
- Suspend theme checks while hidden or reading. Requires Undertone 1.8.2 for theme sync.

## 0.3.0 — 2026-11-12

- Dedicated Undertone player page, accessible from the sidebar and reader.
- Playback controls, seeking, volume, artwork, library search and queue management.
- Launch or locate Undertone from the Windows app; support custom data folders.
- Keep Local API tokens in the backend and pause polling while the player is hidden.
- Requires Undertone with the restored Settings → Integrations → Local API switch.

## 0.2.1 — 2026-11-12

- Downloadable per-user Windows installer with Start menu and optional desktop shortcuts.
- Detect shared .NET 10 Desktop Runtime and WebView2; install only missing components.
- Verify prerequisite downloads and preserve books/preferences during uninstall.
- Build both portable ZIP and installer EXE in GitHub release automation.

## 0.2.0 — 2026-11-12

- Undertone-inspired charcoal interface, red accents, rounded controls and navigation rail.
- Native Windows app window, app icon, single-instance activation and quiet local backend.
- Retained cover carousel with smaller render targets and capped cover textures.
- Stop carousel rendering when hidden or reading; suspend WebView2 when minimized.
- Check completed downloads only after opening a search window and while visible.
- Fix the reader pagination function being shadowed by the navigation handler.
- Original generated click sound and MIT license.

## 0.1.0 — preserved 2026-11-12

The original browser-hosted source from the existing working folder, including shelves,
EPUB import/reader, custom fonts/backgrounds, cover carousel and external searches.
This is a source snapshot, not a reconstructed historical Windows executable.
No earlier committed versions or build archives were found in the project, Desktop,
or Downloads folders at the time of preservation.

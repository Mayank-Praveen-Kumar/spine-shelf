"""Batch download English EPUBs with a visible browser for site verification."""

import argparse
from pathlib import Path
import re
import tempfile
import xml.etree.ElementTree as ET
import zipfile
from time import monotonic
from urllib.parse import urlencode, urlsplit

from shelf import describe, INVALID_EPUB, MAX_SIZE

SITE = "https://oceanofpdf.com"
ENGLISH = re.compile(r"\b(?:Edition\s+)?Language\s*:\s*English\b", re.I)


def wait_for_verification(page):
    """Leave verification to the user; do not spend the download timeout here."""
    while not page.is_closed():
        heading = page.title().casefold()
        body = page.locator("body").inner_text().casefold()
        blocked = (any(text in heading for text in ("just a moment", "security verification", "attention required"))
                   or any(text in body for text in ("verify you are human", "verifying you are human",
                                                    "performing security verification")))
        if not blocked:
            return True
        page.bring_to_front()
        print("\nSite verification needs your help. Complete it in the browser, "
              "then return here. The download timer has not started.", flush=True)
        try:
            answer = input("Press Enter to resume, or type skip to skip this title: ").strip().casefold()
        except EOFError:
            print("No interactive terminal is available; skipping this title.", flush=True)
            return False
        if answer == "skip":
            return False
        if page.is_closed():
            return False
        # Let Playwright process navigation events after the terminal pause.
        page.wait_for_timeout(500)
    return False


def find_edition(page, title):
    search_url = SITE + "/?" + urlencode({"s": title})
    page.goto(search_url, wait_until="domcontentloaded")
    if not wait_for_verification(page):
        return None
    # Link roles work across search layouts without assuming article containers.
    matches = page.get_by_role("link").filter(
        has_text=re.compile(r"^\s*(?:\[PDF\]\s*)?(?:\[EPUB\]\s*)?"
                            + re.escape(title) + r"(?:\s+Download)?\s*$", re.I)
    )
    try:
        matches.first.wait_for(state="visible", timeout=15000)
    except Exception as error:
        from playwright.sync_api import TimeoutError
        if not isinstance(error, TimeoutError):
            raise
        if not wait_for_verification(page):
            return None
        # Verification may have finished while waiting for the result links.
        if not matches.count():
            print(f"Could not detect matching result links on {page.url}. "
                  f"Page title: {page.title()}. Book availability is unknown.", flush=True)
            return False
    candidates = dict.fromkeys(matches.evaluate_all("(links) => links.map(link => link.href)"))
    print(f"Found {len(candidates)} matching listing link(s).", flush=True)
    for url in candidates:
        address = urlsplit(url)
        if address.scheme != "https" or address.hostname not in {"oceanofpdf.com", "www.oceanofpdf.com"}:
            continue
        page.goto(url, wait_until="domcontentloaded")
        if not wait_for_verification(page):
            return None
        details = page.locator("body").inner_text()
        if ENGLISH.search(details):
            return True
    page.goto(search_url, wait_until="domcontentloaded")
    return False


def find_1lib_edition(page, title, author=""):
    page.goto("https://1lib.sk/s/?" + urlencode({
        "q": f"{title} {author}".strip(), "languages[]": "english", "extensions[]": "EPUB"
    }), wait_until="domcontentloaded")
    page.wait_for_timeout(3000)
    if not wait_for_verification(page):
        return None
    links = page.locator('a[href*="/book/"]')
    candidates = dict.fromkeys(links.evaluate_all("links => links.map(a => a.href)"))
    for url in list(candidates)[:20]:
        if urlsplit(url).hostname != "1lib.sk":
            continue
        page.goto(url, wait_until="domcontentloaded")
        page.wait_for_timeout(1000)
        if not wait_for_verification(page):
            return None
        heading = page.locator("h1").inner_text() if page.locator("h1").count() else ""
        details = page.locator("body").inner_text()
        if author and not page.get_by_role("link", name=re.compile(r"^\s*" + re.escape(author) + r"\s*$", re.I)).count():
            continue
        if (heading.strip().casefold() == title.casefold() and ENGLISH.search(details)
                and page.locator('a[href*="/dl/"]').filter(has_text=re.compile("EPUB", re.I)).count()):
            return True
    return False


def validate_download(path, listing_is_english=False):
    try:
        return describe(path, english_only=True)
    except ValueError:
        if not listing_is_english:
            raise
        # Some EPUBs use UND despite their edition listing specifying English.
        # Only fall back for unknown tags, never an explicitly different language.
        with zipfile.ZipFile(path) as book:
            container = ET.fromstring(book.read("META-INF/container.xml"))
            package = container.find(".//{*}rootfile").get("full-path")
            metadata = ET.fromstring(book.read(package)).find("{*}metadata")
            languages = [(item.text or "").strip().casefold()
                         for item in metadata.findall("{*}language")]
        if any(language not in ("", "und") for language in languages):
            raise
        result = describe(path)
        print("EPUB language is unspecified; using the edition listing's English label.", flush=True)
        return result


def download_book(context, page, title, destination, timeout, source="ocean", author=""):
    downloads = []
    watched = []

    def record_download(download):
        downloads.append(download)

    def watch(tab):
        tab.on("download", record_download)
        watched.append(tab)

    watch(page)
    context.on("page", watch)
    try:
        edition = find_1lib_edition(page, title, author) if source == "1lib" else find_edition(page, title)
        if edition is None:
            return None
        if not edition:
            print("Automatic listing detection did not complete. Check the open page to continue.", flush=True)
        else:
            controls = page.locator(
                'main article input[type="image"][alt*="epub" i], '
                'main article input[type="submit"][value*="epub" i], '
                'main article form:has(input[type="hidden"][value$=".epub" i]) :is(button, input[type="image"], input[type="submit"]), '
                'main article a[href$=".epub" i]'
            ).filter(visible=True)
            if source == "1lib":
                controls = page.locator('a[href*="/dl/"]').filter(has_text=re.compile("EPUB", re.I)).filter(visible=True)
                if controls.count():
                    controls = controls.first
            if controls.count() == 1:
                print(f"Starting EPUB download from {page.url}", flush=True)
                controls.click(timeout=5000)
        print("Use the browser to click EPUB if needed and complete any verification.", flush=True)
        deadline = monotonic() + timeout
        while monotonic() < deadline:
            while downloads:
                download = downloads.pop(0)
                filename = Path(download.suggested_filename).name
                if Path(filename).suffix.lower() != ".epub":
                    download.cancel()
                    print(f"Skipped non-EPUB download: {filename}", flush=True)
                    continue
                with tempfile.TemporaryDirectory(dir=destination) as directory:
                    staged = Path(directory) / filename
                    download.save_as(staged)
                    try:
                        if staged.stat().st_size > MAX_SIZE:
                            raise ValueError("EPUB exceeds 150 MB")
                        book = validate_download(staged, listing_is_english=source == "1lib" and edition is True)
                        if author and author.casefold() not in book["author"].casefold():
                            raise ValueError(f"Expected author {author}; EPUB credits {book['author']}")
                    except INVALID_EPUB as error:
                        print(f"Skipped invalid or non-English EPUB: {filename} ({error})", flush=True)
                        continue
                    target = destination / filename
                    if target.exists() and target.read_bytes() == staged.read_bytes():
                        return target
                    number = 2
                    while target.exists():
                        target = destination / f"{staged.stem} ({number}){staged.suffix}"
                        number += 1
                    staged.rename(target)
                    return target
            if page.is_closed():
                return None
            page.wait_for_timeout(250)
        return None
    finally:
        context.remove_listener("page", watch)
        for tab in watched:
            tab.remove_listener("download", record_download)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", choices=("ocean", "1lib"), default="ocean")
    parser.add_argument("titles", type=Path, help="One title per line, optionally Title | Author")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--browser", choices=("chrome", "msedge"), default="chrome", help="Browser to use (default: chrome)")
    parser.add_argument("--wait", type=int, default=180, help="Seconds to wait per title")
    args = parser.parse_args()
    if args.output is None:
        args.output = Path("1lib EPUBs" if args.source == "1lib" else "Ocean EPUBs")
    if args.wait <= 0:
        parser.error("--wait must be positive")
    try:
        titles = list(dict.fromkeys(line.strip() for line in args.titles.read_text(encoding="utf-8-sig").splitlines()
                                    if line.strip()))
    except (OSError, UnicodeError) as error:
        parser.error(str(error))
    if not titles:
        parser.error("The title list is empty.")
    try:
        from playwright.sync_api import Error, sync_playwright
    except ImportError:
        parser.exit(2, "Install Playwright first: python -m pip install playwright\n")
    args.output.mkdir(parents=True, exist_ok=True)
    failures = []
    with sync_playwright() as playwright:
        with playwright.chromium.launch(channel=args.browser, headless=False) as browser:
            # Reuse cookies so a completed verification can carry across titles.
            with browser.new_context(accept_downloads=True) as context:
                for number, entry in enumerate(titles, 1):
                    title, separator, author = entry.partition("|")
                    title, author = title.strip(), author.strip()
                    print(f"\n[{number}/{len(titles)}] {title}", flush=True)
                    page = context.new_page()
                    try:
                        try:
                            result = download_book(context, page, title, args.output, args.wait, args.source, author)
                        except (Error, OSError) as error:
                            print(f"Browser error: {error}", flush=True)
                            result = None
                    finally:
                        for tab in list(context.pages):
                            tab.close()
                    if result is None:
                        failures.append(title)
                        print("No English EPUB saved for this title.", flush=True)
                    else:
                        print(f"Saved {result}", flush=True)
    if failures:
        print("\nTitles to retry:\n" + "\n".join(failures))
    return bool(failures)


if __name__ == "__main__":
    raise SystemExit(main())

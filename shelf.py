from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import argparse
from pathlib import Path
import hashlib
import json
import mimetypes
import os
import posixpath
import re
import subprocess
import tempfile
from threading import Lock
from urllib.parse import unquote, urlsplit, quote, urlencode
from urllib.request import Request, urlopen
import webbrowser
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parent
LIBRARY = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "SpineShelf"
MAX_SIZE = 150 * 1024 * 1024
DOWNLOAD_LOCK = Lock()
INVALID_EPUB = (ValueError, AttributeError, KeyError, OSError, RuntimeError, zipfile.BadZipFile, ET.ParseError)


def open_app_window(url, profile=None):
    for base in ("ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"):
        directory = os.environ.get(base)
        if not directory:
            continue
        edge = Path(directory) / "Microsoft/Edge/Application/msedge.exe"
        if edge.is_file():
            args = [str(edge), f"--app={url}"]
            if profile is not None:
                args.append(f"--user-data-dir={profile}")
            subprocess.Popen(args)
            return
    raise OSError("Microsoft Edge is required to open the app window.")


def describe(path, english_only=False):
    with zipfile.ZipFile(path) as book:
        def xml(name):
            with book.open(name) as source:
                return ET.fromstring(source.read(4 * 1024 * 1024))

        package = xml("META-INF/container.xml").find(".//{*}rootfile").get("full-path")
        opf = xml(package)
        metadata = opf.find("{*}metadata")
        if english_only and not any(
            (language.text or "").strip().casefold().split("-")[0] == "en"
            for language in metadata.findall("{*}language")
        ):
            languages = [language.text or "" for language in metadata.findall("{*}language")]
            raise ValueError(f"The downloaded EPUB is not marked as English (language tags: {languages!r})")
        manifest = {item.get("id"): item for item in opf.findall("{*}manifest/{*}item")}
        cover_meta = metadata.find("{*}meta[@name='cover']")
        cover = next((item for item in manifest.values()
                      if "cover-image" in item.get("properties", "").split()), None)
        if cover is None and cover_meta is not None:
            cover = manifest.get(cover_meta.get("content"))

        def url(item):
            href = urlsplit(item.get("href"))
            if href.scheme or href.netloc:
                raise ValueError("External EPUB resource")
            member = posixpath.normpath(posixpath.join(posixpath.dirname(package), unquote(href.path)))
            book.getinfo(member)
            return f"/book/{path.stem}/{quote(member)}"

        chapters = [url(manifest[item.get("idref")]) for item in opf.findall("{*}spine/{*}itemref")]
        if not chapters:
            raise ValueError("This EPUB has no readable spine")
        return dict(id=path.stem, title=metadata.findtext("{*}title") or "Untitled",
                    author=metadata.findtext("{*}creator") or "", chapters=chapters,
                    cover=url(cover) if cover is not None else None)


def open_ocean_window(title):
    profile = LIBRARY / "Ocean Edge"
    downloads = LIBRARY / "Ocean Downloads"
    preferences = profile / "Default" / "Preferences"
    with DOWNLOAD_LOCK:
        downloads.mkdir(exist_ok=True)
        if not preferences.exists():
            preferences.parent.mkdir(parents=True, exist_ok=True)
            preferences.write_text(json.dumps({"download": {
                "default_directory": str(downloads.resolve()), "prompt_for_download": False,
                "directory_upgrade": True
            }}), encoding="utf-8")
        open_app_window("https://oceanofpdf.com/?" + urlencode({"s": title}), profile)


def import_epub(source, length, english_only=False):
    digest = hashlib.sha256()
    with tempfile.TemporaryDirectory(dir=LIBRARY) as staging:
        temporary = Path(staging) / "upload.epub"
        with temporary.open("wb") as output:
            while length:
                chunk = source.read(min(length, 1024 * 1024))
                if not chunk:
                    raise ValueError("Incomplete upload")
                digest.update(chunk)
                output.write(chunk)
                length -= len(chunk)
        target = LIBRARY / (digest.hexdigest() + ".epub")
        staged = temporary.rename(Path(staging) / target.name)
        result = describe(staged, english_only=english_only)
        if not target.exists():
            os.replace(staged, target)
        return result


def import_ocean_downloads():
    imported = []
    with DOWNLOAD_LOCK:
        for path in (LIBRARY / "Ocean Downloads").glob("*"):
            if path.suffix.lower() != ".epub":
                continue
            try:
                length = path.stat().st_size
                if not 0 < length <= MAX_SIZE:
                    continue
                with path.open("rb") as source:
                    book = import_epub(source, length, english_only=True)
                path.unlink()
                imported.append(book)
            except INVALID_EPUB:
                continue
    return imported


def find_artwork(book):
    params = {"title": book["title"], "limit": 5, "fields": "title,cover_i,author_name,author_key"}
    if book["author"]:
        params["author"] = book["author"]
    request = Request("https://openlibrary.org/search.json?" + urlencode(params),
                      headers={"User-Agent": "SpineShelf/1.0"})
    with urlopen(request, timeout=8) as response:
        results = json.loads(response.read(1024 * 1024))["docs"]

    def normalize(value):
        return "".join(character for character in value.casefold() if character.isalnum())

    images = []
    for work in results:
        if normalize(work["title"]) != normalize(book["title"]):
            continue
        if book["author"] and not any(normalize(name) == normalize(book["author"])
                                      for name in work.get("author_name", [])):
            continue
        cover = work.get("cover_i")
        if isinstance(cover, int) and cover > 0:
            images.append({"label": "Book cover · Open Library",
                           "url": f"https://covers.openlibrary.org/b/id/{cover}-L.jpg?default=false"})
        for key in work.get("author_key", []):
            if re.fullmatch(r"OL\d+A", key):
                images.append({"label": "Author portrait · Open Library",
                               "url": f"https://covers.openlibrary.org/a/olid/{key}-L.jpg?default=false"})
        if images:
            break
    return images


class Handler(SimpleHTTPRequestHandler):
    def reply(self, body, kind, status=200):
        self.send_response(status)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy",
                         "sandbox allow-same-origin; default-src 'none'; style-src 'self' 'unsafe-inline'; "
                         "img-src 'self' data:; font-src 'self' data: blob:; media-src 'self'"
                         if self.path.startswith("/book/") else
                         "default-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; "
                         "img-src 'self' blob: data: https://covers.openlibrary.org")
        self.end_headers()
        self.wfile.write(body)

    def json(self, value, status=200):
        self.reply(json.dumps(value).encode(), "application/json", status)

    def do_GET(self):
        route = urlsplit(self.path).path
        if route == "/health":
            self.json({"app": "SpineShelf", "version": "0.2.1"})
        elif route == "/library":
            books = []
            for path in sorted(LIBRARY.glob("*.epub"), key=lambda item: item.stat().st_mtime):
                try:
                    books.append(describe(path))
                except (ValueError, AttributeError, KeyError, OSError, zipfile.BadZipFile, ET.ParseError):
                    continue
            self.json(books)
        elif route == "/ocean-imports":
            if self.headers.get("Sec-Fetch-Site") != "same-origin":
                self.send_error(403)
                return
            self.json(import_ocean_downloads())
        elif route.startswith("/artwork/"):
            key = route.removeprefix("/artwork/")
            if self.headers.get("Sec-Fetch-Site") != "same-origin" or not re.fullmatch(r"[a-f0-9]{64}", key):
                self.send_error(403)
                return
            try:
                book = describe(LIBRARY / (key + ".epub"))
                self.json(find_artwork(book))
            except (ValueError, AttributeError, KeyError, OSError, zipfile.BadZipFile, ET.ParseError):
                self.json({"error": "Online artwork lookup is unavailable."}, 502)
        elif route.startswith("/book/"):
            _, _, key, member = route.split("/", 3) if route.count("/") >= 3 else ("", "", "", "")
            if len(key) != 64 or any(char not in "0123456789abcdef" for char in key):
                self.send_error(404)
                return
            member = unquote(member)
            try:
                with zipfile.ZipFile(LIBRARY / (key + ".epub")) as book:
                    entry = book.getinfo(member)
                    if entry.file_size > MAX_SIZE:
                        self.send_error(413)
                        return
                    content = book.read(entry)
                kind = mimetypes.guess_type(member)[0] or "application/octet-stream"
                if member.lower().endswith(".xhtml"):
                    kind = "application/xhtml+xml"
                self.reply(content, kind)
            except (KeyError, OSError, RuntimeError, zipfile.BadZipFile):
                self.send_error(404)
        elif route in ("/", "/style.css", "/app.js", "/dist/carousel.css", "/dist/carousel.js", "/button-click.wav", "/assets/spine-shelf.ico"):
            path = ROOT / ("index.html" if route == "/" else route[1:])
            if not path.is_file():
                self.send_error(404)
                return
            kind = {".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".wav": "audio/wav", ".ico": "image/x-icon"}[path.suffix]
            self.reply(path.read_bytes(), kind if path.suffix in (".wav", ".ico") else kind + "; charset=utf-8")
        else:
            self.send_error(404)

    def do_POST(self):
        origin = f"http://127.0.0.1:{self.server.server_port}"
        if self.path == "/open-ocean":
            if self.headers.get("Origin") != origin or self.headers.get_content_type() != "text/plain":
                self.json({"error": "The app rejected the search request. Reopen Spine Shelf and try again."}, 403)
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 2048:
                    raise ValueError
                title = self.rfile.read(length).decode("utf-8").strip()
                if not title:
                    raise ValueError
                open_ocean_window(title)
            except ValueError:
                self.json({"error": "Enter a book title up to 2 KB."}, 400)
            except OSError:
                self.json({"error": "Could not open the Microsoft Edge app window."}, 503)
            else:
                self.json({"opened": True})
            return
        if (self.path != "/import" or self.headers.get("Origin") != origin
                or self.headers.get("Content-Type") != "application/epub+zip"):
            self.send_error(403)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= MAX_SIZE:
                self.json({"error": "Choose an EPUB under 150 MB."}, 413)
                return
            self.json(import_epub(self.rfile, length))
        except INVALID_EPUB:
            self.json({"error": "This file could not be read as an EPUB."}, 400)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Spine Shelf local server")
    parser.add_argument("--server-only", action="store_true", help="Serve without opening a browser")
    parser.add_argument("--port", type=int, default=48731)
    args = parser.parse_args()
    LIBRARY.mkdir(parents=True, exist_ok=True)
    # A stable port keeps reading progress available between launches.
    with ThreadingHTTPServer(("127.0.0.1", args.port), Handler) as server:
        url = f"http://127.0.0.1:{server.server_port}"
        if not args.server_only:
            try:
                open_app_window(url)
            except OSError:
                webbrowser.open(url)
        print(f"Spine Shelf is running at {url}. Close this console to stop it.", flush=True)
        server.serve_forever()





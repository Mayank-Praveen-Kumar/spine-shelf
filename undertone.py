"""Local, token-authenticated Undertone API v1 adapter; never exposes its token."""
import json
import math
import os
from pathlib import Path
import re
from http.client import HTTPException
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener
import uuid

class LinkError(Exception):
    def __init__(self, message, code="unavailable", status=503):
        super().__init__(message)
        self.code, self.status = code, status

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, url):
        return None

class UndertoneLink:
    def __init__(self, library, roaming=None):
        self.library = Path(library)
        self.roaming = Path(roaming or os.environ.get("APPDATA", Path.home() / ".config"))
        self.opener = build_opener(ProxyHandler({}), NoRedirect())

    def discovery(self):
        paths = []
        try:
            settings = json.loads((self.library / "undertone-link.json").read_text(encoding="utf-8-sig"))
            directory = settings.get("dataDirectory")
            if isinstance(directory, str) and directory:
                paths.append(Path(directory) / "local-api.json")
        except (OSError, ValueError, AttributeError): pass
        if os.environ.get("UNDERTONE_DATA_DIR"):
            paths.append(Path(os.environ["UNDERTONE_DATA_DIR"]) / "local-api.json")
        paths.extend(self.roaming / name / "local-api.json" for name in ("Undertone", "Undertone-dev"))
        disabled = False
        for path in dict.fromkeys(paths):
            try:
                with path.open("rb") as source: data = json.loads(source.read(16384))
                if not isinstance(data, dict): continue
                if data.get("running") is not True:
                    disabled = True
                    continue
                port, token = data.get("port"), data.get("token")
                if data.get("apiVersion") != 1 or type(port) is not int or not 1 <= port <= 65535: continue
                if not isinstance(token, str) or not re.fullmatch(r"[a-fA-F0-9]{64}", token): continue
                return port, token
            except (OSError, ValueError, TypeError): continue
        code = "api_disabled" if disabled else "not_linked"
        raise LinkError("Open Undertone and turn on Local API in Settings → Integrations, then connect again.", code)

    def request(self, route, body=None, artwork=False):
        port, token = self.discovery()
        payload = json.dumps(body).encode() if body is not None else None
        headers = {"Authorization": "Bearer " + token, "User-Agent": "SpineShelf/0.3.1"}
        if payload is not None: headers["Content-Type"] = "application/json"
        request = Request(f"http://127.0.0.1:{port}/api/v1{route}", data=payload, headers=headers)
        try:
            with self.opener.open(request, timeout=3) as response:
                maximum = 8 * 1024 * 1024 if artwork else 1024 * 1024
                content = response.read(maximum + 1)
                if len(content) > maximum: raise LinkError("Undertone returned too much data.", "invalid_response", 502)
                if artwork:
                    kind = response.headers.get_content_type()
                    if kind not in {"image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp"}: raise LinkError("Artwork is unavailable.", "no_artwork", 404)
                    return content, kind
                if response.headers.get_content_type() != "application/json": raise ValueError
                result = json.loads(content)
                if not isinstance(result, dict): raise ValueError
                return result
        except HTTPError as error:
            if error.code == 401: raise LinkError("Undertone’s access token changed. Reconnect to use the new token.", "unauthorized", 401) from None
            if error.code == 404 and artwork: raise LinkError("No artwork for this track.", "no_artwork", 404) from None
            if error.code == 429: raise LinkError("Undertone is busy. Wait a moment and reconnect.", "rate_limited", 429) from None
            if error.code in (400,409): raise LinkError("Undertone could not apply that control. Choose a track and try again.", "command_failed", error.code) from None
            raise LinkError("Undertone’s Local API could not complete the request.", "upstream_error", 502) from None
        except (URLError, OSError, TimeoutError, HTTPException): raise LinkError("Undertone isn’t responding. Open it, then connect again.", "not_running") from None
        except (ValueError,TypeError): raise LinkError("Undertone returned an unreadable response.", "invalid_response", 502) from None

    def state(self): return {"connected": True, "nowPlaying": self.request("/now-playing")}
    def appearance(self): return self.request("/appearance")
    def queue(self): return self.request("/queue?limit=30")
    def search(self, query):
        if not isinstance(query,str) or not 1 <= len(query.strip()) <= 200: raise LinkError("Enter a song, artist, or album (up to 200 characters).", "bad_request", 400)
        return self.request("/library/search?" + urlencode({"q":query.strip(),"limit":20}))
    @staticmethod
    def track_id(value):
        try: return str(uuid.UUID(value))
        except (ValueError,TypeError,AttributeError): raise LinkError("Choose a valid track from Undertone.", "bad_request", 400) from None
    def artwork(self, track): return self.request("/artwork/" + self.track_id(track), artwork=True)
    def command(self, body):
        if not isinstance(body,dict) or not isinstance(body.get("action"),str): raise LinkError("Choose a playback control.", "bad_request", 400)
        action = body["action"]
        if action in {"play","pause","toggle","next","previous","shuffle","repeat"}: return self.request("/playback/" + action,{})
        if action in {"seek","volume"}:
            key, limit = ("positionMs",604800000) if action == "seek" else ("volume",100)
            value = body.get(key)
            if type(value) not in (int,float) or not 0 <= value <= limit or not math.isfinite(value): raise LinkError("That playback value is outside the supported range.", "bad_request", 400)
            return self.request("/playback/" + action,{key:value})
        if action in {"play-track","queue-track"}:
            track = self.track_id(body.get("trackId"))
            result = self.request("/queue/add",{"trackIds":[track],"mode":"next" if action == "play-track" else "end"})
            if not result.get("added"): raise LinkError("This track is no longer in Undertone’s library. Search again.", "not_found", 404)
            return self.request("/playback/next",{}) if action == "play-track" else result
        raise LinkError("That playback control is not supported.", "bad_request", 400)

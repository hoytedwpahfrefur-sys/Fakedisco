#!/usr/bin/env python3
"""Local backend for Biscord.

Run: python x_backend_local.py
"""
from __future__ import annotations

import json
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

HOST = "127.0.0.1"
PORT = 8787
API_BASE = "https://discord.com/api/v10"

STATE = {
    "token": None,
    "profile": None,
    "guild_count": 0,
}


def require_session() -> str:
    token = STATE.get("token")
    if not token:
        raise ValueError("No active bot session")
    return token


def discord_get(path: str):
    token = require_session()

    req = Request(
        API_BASE + path,
        headers={
            "Authorization": f"Bot {token}",
            "User-Agent": "BiscordLocalBackend/1.0",
        },
    )
    with urlopen(req, timeout=15) as res:
        return json.loads(res.read().decode("utf-8"))


def avatar_url(profile: dict) -> str:
    avatar = profile.get("avatar")
    if not avatar:
        return ""
    ext = "gif" if str(avatar).startswith("a_") else "png"
    return f"https://cdn.discordapp.com/avatars/{profile.get('id')}/{avatar}.{ext}?size=128"


class Handler(BaseHTTPRequestHandler):
    def _json(self, code: int, payload: dict):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length > 0 else b"{}"
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return {}

    def do_OPTIONS(self):  # noqa: N802
        self._json(200, {"ok": True})

    def do_GET(self):  # noqa: N802
        try:
            if self.path == "/api/session/status":
                self._json(
                    200,
                    {
                        "active": bool(STATE.get("token")),
                        "profile": STATE.get("profile"),
                        "guild_count": STATE.get("guild_count", 0),
                    },
                )
                return

            if self.path == "/api/guilds":
                guilds = discord_get("/users/@me/guilds")
                self._json(200, {"guilds": guilds})
                return

            if self.path.startswith("/api/guilds/") and self.path.endswith("/channels"):
                guild_id = self.path.split("/")[3]
                channels = discord_get(f"/guilds/{guild_id}/channels")
                self._json(200, {"channels": channels})
                return

            self._json(404, {"error": "Not found"})
        except ValueError as err:
            self._json(401, {"error": str(err)})
        except HTTPError as err:
            self._json(err.code, {"error": "Discord API error"})
        except URLError:
            self._json(502, {"error": "Could not reach Discord API"})

    def do_POST(self):  # noqa: N802
        try:
            if self.path == "/api/session/start":
                data = self._read_json()
                token = str(data.get("token", "")).strip()
                if not token:
                    self._json(400, {"error": "Token is required"})
                    return

                STATE["token"] = token
                profile = discord_get("/users/@me")
                guilds = discord_get("/users/@me/guilds")
                STATE["profile"] = {
                    "id": profile.get("id"),
                    "username": profile.get("username"),
                    "avatar_url": avatar_url(profile),
                }
                STATE["guild_count"] = len(guilds) if isinstance(guilds, list) else 0
                self._json(200, {"ok": True, "profile": STATE["profile"], "guild_count": STATE["guild_count"]})
                return

            if self.path == "/api/messages/send":
                token = require_session()
                data = self._read_json()
                channel_id = str(data.get("channel_id", "")).strip()
                content = str(data.get("content", "")).strip()
                if not channel_id or not content:
                    self._json(400, {"error": "channel_id and content are required"})
                    return

                payload = json.dumps({"content": content}).encode("utf-8")
                req = Request(
                    f"{API_BASE}/channels/{channel_id}/messages",
                    data=payload,
                    headers={
                        "Authorization": f"Bot {token}",
                        "Content-Type": "application/json",
                        "User-Agent": "BiscordLocalBackend/1.0",
                    },
                    method="POST",
                )
                with urlopen(req, timeout=15) as res:
                    message = json.loads(res.read().decode("utf-8"))
                self._json(200, {"ok": True, "message": message})
                return

            if self.path == "/api/console/run":
                require_session()
                data = self._read_json()
                command = str(data.get("command", "")).strip()
                if not command:
                    self._json(400, {"error": "command is required"})
                    return

                completed = subprocess.run(
                    command,
                    shell=True,
                    check=False,
                    capture_output=True,
                    text=True,
                    timeout=15,
                )
                output = (completed.stdout + completed.stderr).strip()
                self._json(
                    200,
                    {
                        "ok": True,
                        "exit_code": completed.returncode,
                        "output": output[:3500] or "(no output)",
                    },
                )
                return

            self._json(404, {"error": "Not found"})
        except subprocess.TimeoutExpired:
            self._json(408, {"error": "Command timed out after 15s"})
        except ValueError as err:
            self._json(401, {"error": str(err)})
        except HTTPError as err:
            STATE["token"] = None
            STATE["profile"] = None
            STATE["guild_count"] = 0
            if err.code == 401:
                self._json(401, {"error": "Invalid bot token"})
            else:
                self._json(err.code, {"error": "Discord API error"})
        except URLError:
            self._json(502, {"error": "Could not reach Discord API"})


def main():
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Biscord local backend running on http://{HOST}:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()

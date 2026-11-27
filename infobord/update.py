"""Zelf bijwerken vanaf GitHub: downloadt de nieuwste code als zip en vervangt de programmabestanden.

De map data/ (instellingen, uploads, cache) en venv/ blijven altijd staan. Na het bijwerken stopt het
proces; systemd (Restart=always) of Docker (restart: unless-stopped) start het direct opnieuw.
Er is geen git nodig in de container.
"""
import io
import json
import logging
import os
import shutil
import stat
import tempfile
import threading
import zipfile
from pathlib import Path

import requests

from .store import DATA_DIR

log = logging.getLogger(__name__)
APP_DIR = Path(__file__).resolve().parent.parent
VERSION_FILE = DATA_DIR / "version.json"
KEEP = {"data", "venv", ".venv", ".git"}


def _headers(token=""):
    h = {"Accept": "application/vnd.github+json", "User-Agent": "infobord-updater"}
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


def current():
    try:
        return json.loads(VERSION_FILE.read_text())
    except (FileNotFoundError, ValueError):
        return {"sha": "", "date": "", "message": ""}


def latest(repo, branch="main", token=""):
    if not repo or "/" not in repo:
        raise RuntimeError("Vul de GitHub-repository in als eigenaar/naam, bijv. graafotto/infobord.")
    r = requests.get(f"https://api.github.com/repos/{repo.strip()}/commits/{branch or 'main'}",
                     headers=_headers(token), timeout=20)
    if r.status_code == 404:
        raise RuntimeError(f"Repository {repo} (branch {branch}) niet gevonden. Is hij privé? Vul dan een token in.")
    r.raise_for_status()
    j = r.json()
    return {"sha": j["sha"], "date": j["commit"]["committer"]["date"],
            "message": j["commit"]["message"].splitlines()[0]}


def status(cfg):
    up = cfg.get("update", {})
    cur = current()
    try:
        new = latest(up.get("repo", ""), up.get("branch", "main"), up.get("token", ""))
    except Exception as e:  # noqa: BLE001
        return {"current": cur, "error": str(e)}
    return {"current": cur, "latest": new, "available": new["sha"] != cur.get("sha")}


def apply(cfg, restart=True):
    up = cfg.get("update", {})
    repo, branch, token = up.get("repo", "").strip(), up.get("branch", "main") or "main", up.get("token", "")
    info = latest(repo, branch, token)
    r = requests.get(f"https://api.github.com/repos/{repo}/zipball/{info['sha']}", headers=_headers(token), timeout=120)
    r.raise_for_status()
    with tempfile.TemporaryDirectory() as tmp, zipfile.ZipFile(io.BytesIO(r.content)) as zf:
        zf.extractall(tmp)
        roots = [p for p in Path(tmp).iterdir() if p.is_dir()]
        if len(roots) != 1:
            raise RuntimeError("Onverwachte inhoud van de download.")
        src = roots[0]
        if not (src / "infobord" / "__init__.py").exists():
            # repository kan de projectmap ook als submap bevatten
            sub = next((p.parent.parent for p in src.rglob("infobord/__init__.py")), None)
            if sub is None:
                raise RuntimeError("Geen infobord-code gevonden in de repository.")
            src = sub
        # oude programmacode opzij zetten (zodat verwijderde bestanden verdwijnen); bij een fout terugzetten
        pkg, old = APP_DIR / "infobord", APP_DIR / "infobord.old"
        shutil.rmtree(old, ignore_errors=True)
        pkg.rename(old)
        try:
            for item in src.iterdir():
                if item.name in KEEP:
                    continue
                dest = APP_DIR / item.name
                if item.is_dir():
                    shutil.copytree(item, dest, dirs_exist_ok=True)
                else:
                    shutil.copy2(item, dest)
        except Exception:
            shutil.rmtree(pkg, ignore_errors=True)
            old.rename(pkg)
            raise
        shutil.rmtree(old, ignore_errors=True)
        for sh in APP_DIR.glob("*.sh"):
            sh.chmod(sh.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    VERSION_FILE.write_text(json.dumps(info))
    log.info("Bijgewerkt naar %s (%s)", info["sha"][:7], info["message"])
    if restart:
        threading.Timer(1.5, lambda: os._exit(3)).start()  # systemd/Docker start ons opnieuw
    return info

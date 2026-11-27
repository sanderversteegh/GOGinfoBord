"""Opslag van configuratie (data/config.json) en cache van opgehaalde gegevens (data/cache.json)."""
import copy
import json
import os
import threading
import time
import uuid
from pathlib import Path

DATA_DIR = Path(os.environ.get("INFOBORD_DATA", Path(__file__).resolve().parent.parent / "data"))
UPLOAD_DIR = DATA_DIR / "uploads"
CONFIG_FILE = DATA_DIR / "config.json"
CACHE_FILE = DATA_DIR / "cache.json"


def _sid():
    return uuid.uuid4().hex[:8]


DEFAULT_CONFIG = {
    "general": {
        "title": "Scouting Graaf Otto Groep",
        "subtitle": "Lochem",
        "logo": "",
        "logo_size": "normal",
        "show_title": True,
        "timezone": "Europe/Amsterdam",
        "lat": 52.1595,
        "lon": 6.4140,
        "primary": "#1f3d2b",
        "accent": "#e07a2e",
        "ticker": "",
        "admin_password_hash": "",
    },
    "sidebar": {
        "show_weather": True,
        "show_stook": True,
        "show_agenda": True,
        "agenda_days": 21,
        "agenda_max": 7,
        "show_labels": True,
    },
    "sources": {
        "verhuur": [
            {"name": "Clubhuis", "url": "https://www.graafottogroep.nl/boekingspagina/"},
            {"name": "Witte Wieven", "url": "https://www.graafottogroep.nl/boekingspagina-witte-wieven-clubhuis/"},
        ],
        "verhuur_months": 3,
        "verhuur_minutes": 30,
        "weather_minutes": 15,
        "weather_alert_area": "Gelderland",
        "stook_url": "https://www.brandweer.nl/natuurbrandrisico/",
        "stook_region": "Noord- en Oost-Gelderland",
        "stook_minutes": 60,
        "stook_override": "",
        "stook_note": "",
        "jaarplanning_pdf": "https://www.graafottogroep.nl/wp-content/uploads/2026/10/Jaarplanning-2026-2027-jeugdleden.pdf",
        "facebook_method": "auto",
        "facebook_web_url": "https://www.graafottogroep.nl/over-ons/",
        "facebook_page_id": "",
        "facebook_token": "",
        "facebook_count": 8,
        "facebook_minutes": 20,
        "facebook_graph_version": "",
    },
    "jaarplanning": [],
    "slides": [
        {"id": "welkom", "type": "text", "enabled": True, "duration": 15,
         "title": "Welkom bij de Graaf Otto Groep!",
         "body": "Fijn dat je er bent.\n\n- Kijk rechts voor het weer en de verhuuragenda\n- Vragen? Spreek een van de leiding aan",
         "image": "", "theme": "light", "from": "", "until": ""},
        {"id": "planning", "type": "jaarplanning", "enabled": True, "duration": 15,
         "title": "Komende activiteiten", "count": 8, "from": "", "until": ""},
        {"id": "verhuur", "type": "verhuur", "enabled": True, "duration": 15,
         "title": "Bezetting gebouwen", "weeks": 4, "from": "", "until": ""},
        {"id": "weer", "type": "weather", "enabled": True, "duration": 12,
         "title": "Weersverwachting", "from": "", "until": ""},
        {"id": "fbposts", "type": "fbposts", "enabled": True, "duration": 20, "layout": "list",
         "title": "Nieuws van Facebook", "count": 4, "max_age_days": 60, "from": "", "until": ""},
        {"id": "facebook", "type": "facebook", "enabled": False, "duration": 20,
         "title": "Volg ons op Facebook",
         "url": "https://www.facebook.com/graafottogroep/",
         "text": "Foto's en nieuws van alle speltakken.", "from": "", "until": ""},
        {"id": "website", "type": "qr", "enabled": True, "duration": 12,
         "title": "Lid worden of meer weten?",
         "text": "Scan de code voor onze website, de jaarplanning en het verhuren van onze gebouwen.",
         "url": "https://www.graafottogroep.nl/", "from": "", "until": ""},
    ],
    "update": {
        "repo": "sanderversteegh/GOGinfoBord",
        "branch": "main",
        "token": "",
        "auto": False,
    },
    "screen": {
        "enabled": False,
        "on": "07:30",
        "off": "22:30",
        "cmd_on": "echo 'on 0' | cec-client -s -d 1",
        "cmd_off": "echo 'standby 0' | cec-client -s -d 1",
    },
}


def deep_merge(default, override):
    """Vul ontbrekende sleutels in override aan met waarden uit default (alleen voor dicts)."""
    if not isinstance(default, dict) or not isinstance(override, dict):
        return copy.deepcopy(override)
    out = copy.deepcopy(default)
    for k, v in override.items():
        if k in out and isinstance(out[k], dict) and isinstance(v, dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


def _atomic_write(path: Path, data):
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def _load(path: Path, fallback):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return fallback


class Store:
    def __init__(self):
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self.config = deep_merge(DEFAULT_CONFIG, _load(CONFIG_FILE, {}))
        for s in self.config["slides"]:
            s.setdefault("id", _sid())
        self.cache = _load(CACHE_FILE, {})
        self.version = int(time.time())
        if not CONFIG_FILE.exists():
            _atomic_write(CONFIG_FILE, self.config)

    def get_config(self):
        with self._lock:
            return copy.deepcopy(self.config)

    def save_config(self, cfg):
        with self._lock:
            merged = deep_merge(DEFAULT_CONFIG, cfg)
            for s in merged["slides"]:
                if not s.get("id"):
                    s["id"] = _sid()
            merged["jaarplanning"] = sorted(merged.get("jaarplanning", []), key=lambda i: i.get("date", ""))
            _atomic_write(CONFIG_FILE, merged)
            self.config = merged
            self.version += 1
            return copy.deepcopy(merged)

    def get_cache(self):
        with self._lock:
            return copy.deepcopy(self.cache)

    def set_cache(self, key, value):
        with self._lock:
            self.cache[key] = value
            _atomic_write(CACHE_FILE, self.cache)


store = Store()

"""Best-effort import van de jaarplanning-PDF.

De PDF bevat regels als 'Vrij 5 Opkomst' onder maandkoppen als 'September 2026'.
Waar een maandkop ontbreekt, wordt de maand afgeleid uit de weekdag + het dagnummer.
Het resultaat is bedoeld om in het beheerscherm na te kijken en aan te passen.
"""
import datetime as dt
import io
import re

import requests
from pypdf import PdfReader

from . import USER_AGENT

MONTHS = {"januari": 1, "februari": 2, "maart": 3, "april": 4, "mei": 5, "juni": 6, "juli": 7,
          "augustus": 8, "september": 9, "oktober": 10, "november": 11, "december": 12}
DAYS = {"ma": 0, "maandag": 0, "di": 1, "dinsdag": 1, "wo": 2, "woensdag": 2, "do": 3, "donderdag": 3,
        "vr": 4, "vrij": 4, "vrijdag": 4, "za": 5, "zat": 5, "zaterdag": 5, "zo": 6, "zondag": 6}

HEAD_RE = re.compile(r"^\s*(" + "|".join(MONTHS) + r")\s*(\d{4})?\b", re.I)
LINE_RE = re.compile(
    r"^\s*(maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag|vrij|zat|ma|di|wo|do|vr|za|zo)\.?\s+"
    r"(\d{1,2})(?:\s*(?:t/?m|-|–)\s*(?:[a-z]{2,9}\.?\s+)?(\d{1,2}))?\s*[:\-–]?\s+(.+)$",
    re.I)
SEASON_RE = re.compile(r"(20\d{2})\s*[-–/]\s*(20\d{2})")


def _add_month(y, m, k=1):
    m += k
    while m > 12:
        y, m = y + 1, m - 12
    return y, m


def _fit(y, m, day, wd, ahead=3):
    for k in range(ahead + 1):
        yy, mm = _add_month(y, m, k)
        try:
            d = dt.date(yy, mm, day)
        except ValueError:
            continue
        if wd is None or d.weekday() == wd:
            return d
    return None


def parse_text(text, hint=""):
    season = SEASON_RE.search(hint) or SEASON_RE.search(text)
    if season:
        y, m = int(season.group(1)), 8
    else:
        today = dt.date.today()
        y, m = today.year, today.month
    last_day = 0
    items = []
    for raw in text.splitlines():
        line = " ".join(raw.split())
        if not line:
            continue
        h = HEAD_RE.match(line)
        if h and not LINE_RE.match(line):
            m = MONTHS[h.group(1).lower()]
            if h.group(2):
                y = int(h.group(2))
            elif season and m < 8:
                y = int(season.group(2))
            last_day = 0
            continue
        mo = LINE_RE.match(line)
        if not mo:
            continue
        wd = DAYS.get(mo.group(1).lower())
        day = int(mo.group(2))
        if day < last_day:
            y, m = _add_month(y, m)
        d = _fit(y, m, day, wd)
        if not d:
            continue
        y, m, last_day = d.year, d.month, day
        end = ""
        if mo.group(3):
            end_day = int(mo.group(3))
            ey, em = (y, m) if end_day >= day else _add_month(y, m)
            try:
                end = dt.date(ey, em, end_day).isoformat()
            except ValueError:
                end = ""
        items.append({"date": d.isoformat(), "end": end, "title": mo.group(4).strip(), "group": ""})
    return items


def fetch_pdf(url):
    r = requests.get(url, headers=USER_AGENT, timeout=30)
    r.raise_for_status()
    reader = PdfReader(io.BytesIO(r.content))
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    items = parse_text(text, hint=url)
    if not items:
        raise RuntimeError("Geen activiteiten herkend in de PDF.")
    return items

"""Natuurbrandrisico (stookadvies) per veiligheidsregio van brandweer.nl."""
import re

import requests
from bs4 import BeautifulSoup

from . import USER_AGENT

PHASES = {
    1: {"title": "Fase 1", "color": "green",
        "text": "Normale situatie. Wees altijd voorzichtig met vuur en laat het nooit onbeheerd."},
    2: {"title": "Fase 2", "color": "orange",
        "text": "Verhoogd natuurbrandrisico door aanhoudende droogte. Wees extra alert en "
                "overleg met de leiding vóór je een vuur aansteekt."},
}

FASE_RE = re.compile(r"Fase\s*(\d)", re.I)


def _norm(s):
    return re.sub(r"[^a-z]", "", s.lower())


def phase_info(level, region="", source="brandweer.nl"):
    level = int(level)
    info = dict(PHASES.get(level) or {
        "title": f"Fase {level}", "color": "red",
        "text": "Hoog natuurbrandrisico. Geen open vuur; volg de aanwijzingen van brandweer en gemeente."})
    info.update(level=level, region=region, source=source)
    return info


def parse(html, region):
    text = " ".join(BeautifulSoup(html, "html.parser").get_text(" ", strip=True).split())
    want = _norm(region)
    pos = 0
    for m in FASE_RE.finditer(text):
        tail = text[max(pos, m.start() - 150):m.start()]
        if want and want in _norm(tail):
            return int(m.group(1))
        pos = m.end()
    return None


def fetch(url, region):
    r = requests.get(url, headers=USER_AGENT, timeout=20)
    r.raise_for_status()
    level = parse(r.text, region)
    if level is None:
        raise RuntimeError(f"Regio '{region}' of fase niet gevonden op {url}")
    return phase_info(level, region)

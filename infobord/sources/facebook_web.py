"""Facebook-posts uitlezen van een webpagina met een Facebook-widget (bijv. Smash Balloon
'Custom Facebook Feed' op graafottogroep.nl/over-ons/). Geen Facebook-token nodig.

De widget toont datums als '1 week geleden'; die worden omgerekend naar een (geschatte) datum.
Eerst wordt de bekende Smash Balloon-opmaak (.cff-item) gezocht; lukt dat niet, dan wordt elk blok
rond een 'Bekijk op Facebook'-link als post gezien.
"""
import datetime as dt
import re

import requests
from bs4 import BeautifulSoup

from . import USER_AGENT

VIEW_RE = re.compile(r"bekijk op facebook|view on facebook", re.I)
NOISE_RE = re.compile(r"^(zie meer|zie minder|see more|see less|foto|photo|video|deel|share|"
                      r"bekijk op facebook|view on facebook|\.\.\.|…)$", re.I)
UNITS = {
    "seconde": 1 / 86400, "seconden": 1 / 86400, "second": 1 / 86400, "sec": 1 / 86400,
    "minuut": 1 / 1440, "minuten": 1 / 1440, "minute": 1 / 1440, "min": 1 / 1440,
    "uur": 1 / 24, "uren": 1 / 24, "hour": 1 / 24, "u": 1 / 24,
    "dag": 1, "dagen": 1, "day": 1,
    "week": 7, "weken": 7, "wk": 7,
    "maand": 30, "maanden": 30, "month": 30,
    "jaar": 365, "jaren": 365, "year": 365,
}
REL_RE = re.compile(r"\b(?:(\d+)\s*|(een|één|a|an)\s+)(" + "|".join(sorted(UNITS, key=len, reverse=True)) + r")s?\b", re.I)
MONTHS = {"januari": 1, "februari": 2, "maart": 3, "april": 4, "mei": 5, "juni": 6, "juli": 7,
          "augustus": 8, "september": 9, "oktober": 10, "november": 11, "december": 12,
          "january": 1, "february": 2, "march": 3, "may": 5, "june": 6, "july": 7, "august": 8,
          "october": 10, "jan": 1, "feb": 2, "mrt": 3, "mar": 3, "apr": 4, "jun": 6, "jul": 7,
          "aug": 8, "sep": 9, "sept": 9, "okt": 10, "oct": 10, "nov": 11, "dec": 12}
ABS_RE = re.compile(r"(\d{1,2})\s+([a-z]+)\.?(?:\s+(\d{4}))?", re.I)
ABS_EN_RE = re.compile(r"([a-z]+)\.?\s+(\d{1,2}),?(?:\s+(\d{4}))?", re.I)


def parse_date(label, now, attrs=None):
    """'1 week geleden' / 'gisteren' / '12 november 2026' / unix-timestamp -> aware datetime of None."""
    for v in (attrs or {}).values():
        if isinstance(v, str) and re.fullmatch(r"1[5-9]\d{8}", v.strip()):
            return dt.datetime.fromtimestamp(int(v), dt.timezone.utc)
    t = " ".join((label or "").lower().split())
    if not t:
        return None
    if any(w in t for w in ("zojuist", "net nu", "just now", "vandaag", "today")):
        return now
    if any(w in t for w in ("gisteren", "yesterday")):
        return now - dt.timedelta(days=1)
    m = REL_RE.search(t)
    if m:
        n = int(m.group(1)) if m.group(1) else 1
        return now - dt.timedelta(days=n * UNITS[m.group(3).lower()])
    for rx, order in ((ABS_RE, "dmy"), (ABS_EN_RE, "mdy")):
        m = rx.search(t)
        if not m:
            continue
        day, mon = (m.group(1), m.group(2)) if order == "dmy" else (m.group(2), m.group(1))
        month = MONTHS.get(mon.lower())
        if not month:
            continue
        year = int(m.group(3)) if m.group(3) else now.year
        try:
            d = dt.datetime(year, month, int(day), 12, tzinfo=dt.timezone.utc)
        except ValueError:
            continue
        if not m.group(3) and d > now + dt.timedelta(days=1):
            d = d.replace(year=year - 1)  # '20 december' gezien in januari
        return d
    return None


def _text(el):
    """Tekst met regeleinden voor <br> en <p>, zonder 'Zie meer'-knoppen."""
    el = BeautifulSoup(str(el), "html.parser")
    for junk in el.select(".cff-expand, .cff-more, .cff-less, .cff-media-link, .cff-post-links, script, style"):
        junk.decompose()
    for br in el.find_all("br"):
        br.replace_with("\n")
    for p in el.find_all(["p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6", "article", "section"]):
        p.insert_after("\n")
    lines = [" ".join(line.split()) for line in el.get_text("").splitlines()]
    out, blank = [], False
    for line in lines:
        if not line or NOISE_RE.match(line):
            blank = bool(out)
            continue
        if blank and out:
            out.append("")
        out.append(line)
        blank = False
    text = "\n".join(out).strip()
    return re.sub(r"\s*(\.\.\.|…)\s*$", "…", text) if text.endswith(("...", "…")) else text


def _items(soup):
    items = soup.select(".cff-item")
    if items:
        return items, "smash-balloon"
    # Algemene terugval: het kleinste blok rond elke 'Bekijk op Facebook'-link
    found = []
    for a in soup.find_all("a"):
        if not VIEW_RE.search(a.get_text(" ", strip=True) + " " + (a.get("title") or "")):
            continue
        node = a
        while node.parent is not None and node.parent.name not in ("body", "html", "[document]"):
            parent = node.parent
            links = [x for x in parent.find_all("a")
                     if VIEW_RE.search(x.get_text(" ", strip=True) + " " + (x.get("title") or ""))]
            if len(links) > 1:
                break
            node = parent
        if node not in found:
            found.append(node)
    return found, "algemeen"


def parse(html, now=None, count=8):
    now = now or dt.datetime.now(dt.timezone.utc)
    soup = BeautifulSoup(html, "html.parser")
    items, mode = _items(soup)
    page = {"name": "", "url": "", "picture": ""}
    posts = []
    for it in items:
        author = it.select_one(".cff-author a, .cff-page-name a")
        if author and not page["name"]:
            page["name"] = author.get_text(" ", strip=True)
            page["url"] = author.get("href", "")
        avatar = it.select_one(".cff-author-img img, .cff-author img")
        if avatar and not page["picture"]:
            page["picture"] = avatar.get("src") or avatar.get("data-avatar") or ""

        link = it.select_one("a.cff-viewpost-facebook, a.cff-viewpost") or next(
            (a for a in it.find_all("a") if VIEW_RE.search(a.get_text(" ", strip=True) + " " + (a.get("title") or ""))), None)
        url = link.get("href", "") if link else ""

        date_el = it.select_one(".cff-date") or it.find("time") or it.find(class_=re.compile("date|time", re.I))
        date_label = date_el.get_text(" ", strip=True) if date_el else ""
        iso = date_el.get("datetime") if date_el is not None else None
        if not date_label:  # korte tekst die als datum te lezen is ('3 dagen geleden', '12 november')
            date_label = next((t.strip() for t in it.find_all(string=True)
                               if 3 < len(t.strip()) < 30 and parse_date(t, now)), "")
        created = None
        if iso:
            try:
                created = dt.datetime.fromisoformat(iso.replace("Z", "+00:00"))
                created = created if created.tzinfo else created.replace(tzinfo=dt.timezone.utc)
            except ValueError:
                created = None
        created = created or parse_date(date_label, now, it.attrs) or now

        text_el = it.select_one(".cff-post-text .cff-text") or it.select_one(".cff-post-text") \
            or it.find(class_=re.compile(r"(post-)?text|message|content", re.I))
        if text_el is None:  # algemene terugval: hele blok zonder kop/datum/links
            text_el = BeautifulSoup(str(it), "html.parser")
            for junk in text_el.select("[class*=author], [class*=date], time, a, h1, h2, h3, h4, h5, h6"):
                junk.decompose()
            if date_label:
                for node in text_el.find_all(string=lambda t: t and t.strip() == date_label):
                    node.extract()
        text = _text(text_el)

        image = ""
        skip = set(map(id, it.select(".cff-author img, .cff-author-img img, [class*=avatar] img")))
        for img in it.find_all("img"):
            if id(img) in skip:
                continue
            src = img.get("data-img-src-set") or img.get("data-src") or img.get("src") or ""
            if src.startswith("{"):  # Smash Balloon Pro: JSON met formaten
                m = re.findall(r'"(https?:[^"]+)"', src.replace("\\/", "/"))
                src = m[-1] if m else ""
            if src.startswith("http"):
                image = src
                break

        if not text and not image:
            continue
        posts.append({
            "id": it.get("id") or url or str(len(posts)),
            "text": text,
            "created": created.isoformat(),
            "date_label": date_label,
            "image": image,
            "url": url,
        })
        if len(posts) >= int(count):
            break
    return {"page": page, "posts": posts, "mode": mode}


def fetch(url, count=8):
    r = requests.get(url, headers=USER_AGENT, timeout=25)
    r.raise_for_status()
    data = parse(r.text, count=count)
    if not data["posts"]:
        raise RuntimeError(f"Geen Facebook-posts gevonden op {url}. Staat de Facebook-widget nog op die pagina?")
    return data

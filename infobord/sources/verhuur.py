"""Verhuuragenda uit de WP Booking System-kalenders op graafottogroep.nl.

De boekingspagina's tonen per maand een kalender. Met ?wpbs-start-year=JJJJ&wpbs-start-month=M
kun je een andere maand opvragen. Elke dag is een element met data-year/data-month/data-day;
de status zit in een klasse 'wpbs-legend-item-<id>' en de omschrijving in een tooltip.
De parser is bewust ruim opgezet zodat kleine wijzigingen in de plugin hem niet meteen breken.
"""
import datetime as dt
import re
from collections import Counter
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import requests
from bs4 import BeautifulSoup

from . import USER_AGENT

FREE_WORDS = ("beschikbaar", "available", "vrij", "free", "open")
BOOKED_WORDS = ("geboekt", "booked", "bezet", "verhuurd", "gereserveerd", "onbeschikbaar",
                "niet beschikbaar", "unavailable", "optie", "intern", "extern")
LEGEND_RE = re.compile(r"wpbs-legend-item(?:-icon)?-(\d+)$")
YEAR_RE = re.compile(r"\b(19|20)\d{2}\b")


def month_url(url, year, month):
    p = urlparse(url)
    q = dict(parse_qsl(p.query))
    q["wpbs-start-year"] = str(year)
    q["wpbs-start-month"] = str(month)
    return urlunparse(p._replace(query=urlencode(q)))


def _legend_id(tag):
    for el in [tag] + tag.find_all(True):
        for c in el.get("class", []) or []:
            m = LEGEND_RE.match(c)
            if m:
                return m.group(1)
    return None


def parse_legend(soup):
    legend = {}
    for item in soup.select(".wpbs-legend-item"):
        lid = _legend_id(item)
        name_el = item.select_one(".wpbs-legend-item-name")
        name = (name_el or item).get_text(" ", strip=True)
        if lid and name:
            legend.setdefault(lid, name)
    return legend


def _cell_label(cell):
    texts = []
    for tip in cell.find_all(class_=re.compile(r"tooltip", re.I)):
        for part in tip.stripped_strings:
            # datumkop in de tooltip ("6 november 2026") overslaan
            if YEAR_RE.search(part) and len(part) < 32:
                continue
            texts.append(part)
    for attr in ("data-tooltip", "data-description", "title"):
        if cell.get(attr):
            texts.append(cell[attr].strip())
    return " · ".join(dict.fromkeys(t for t in texts if t))


def _is_free_name(name):
    n = name.lower()
    if any(b in n for b in BOOKED_WORDS):
        return False
    return any(f in n for f in FREE_WORDS)


def parse(html):
    """Geef (geboekte_dagen, diagnose) terug. geboekte_dagen = {date: label}."""
    soup = BeautifulSoup(html, "html.parser")
    legend = parse_legend(soup)
    raw = {}
    for cell in soup.select("[data-day][data-month][data-year]"):
        try:
            d = dt.date(int(cell["data-year"]), int(cell["data-month"]), int(cell["data-day"]))
        except (ValueError, KeyError):
            continue
        lid = _legend_id(cell)
        label = _cell_label(cell)
        if d in raw:  # dubbele elementen samenvoegen
            plid, plabel = raw[d]
            raw[d] = (plid or lid, plabel if len(plabel) >= len(label) else label)
        else:
            raw[d] = (lid, label)

    free_ids = {lid for lid, name in legend.items() if _is_free_name(name)}
    if not free_ids and raw:
        # Geen legenda gevonden: de meest voorkomende status zonder omschrijving is 'vrij'.
        counts = Counter(lid for lid, label in raw.values() if not label)
        if counts:
            free_ids = {counts.most_common(1)[0][0]}

    booked = {}
    for d, (lid, label) in raw.items():
        is_booked = bool(label) or (lid is not None and lid not in free_ids)
        if is_booked:
            booked[d] = label or legend.get(lid, "") or "Geboekt"
            if _is_free_name(booked[d]):
                booked[d] = "Geboekt"
    diag = {"cells": len(raw), "legend": legend, "free_ids": sorted(free_ids), "booked": len(booked)}
    return booked, diag


def fetch_building(url, months, today=None):
    today = today or dt.date.today()
    booked, diags = {}, []
    y, m = today.year, today.month
    for _ in range(max(1, int(months))):
        r = requests.get(month_url(url, y, m), headers=USER_AGENT, timeout=25)
        r.raise_for_status()
        b, diag = parse(r.text)
        diag["month"] = f"{y}-{m:02d}"
        diags.append(diag)
        booked.update(b)
        m += 1
        if m > 12:
            y, m = y + 1, 1
    return booked, diags


def fetch(buildings, months=3, today=None):
    out = []
    total_cells = 0
    for b in buildings:
        if not b.get("url"):
            continue
        booked, diags = fetch_building(b["url"], months, today)
        total_cells += sum(d["cells"] for d in diags)
        out.append({
            "name": b.get("name") or "Gebouw",
            "url": b["url"],
            "booked": [{"date": d.isoformat(), "label": lbl} for d, lbl in sorted(booked.items())],
            "diagnostics": diags,
        })
    if out and total_cells == 0:
        raise RuntimeError("Geen kalenderdagen gevonden op de boekingspagina's; "
                           "mogelijk is de opmaak van de website veranderd.")
    return {"buildings": out}

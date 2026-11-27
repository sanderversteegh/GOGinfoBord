"""Stelt de JSON samen die het scherm (display.js) ophaalt."""
import datetime as dt
import io
from zoneinfo import ZoneInfo

import qrcode
import qrcode.image.svg

from .sources import stook as stook_source

_qr_cache = {}


def qr_svg(data):
    if data not in _qr_cache:
        if len(_qr_cache) > 200:
            _qr_cache.clear()
        img = qrcode.make(data, image_factory=qrcode.image.svg.SvgPathImage, border=1)
        buf = io.BytesIO()
        img.save(buf)
        svg = buf.getvalue().decode("utf-8")
        svg = svg[svg.find("<svg"):]
        _qr_cache[data] = svg
    return _qr_cache[data]


def merge_ranges(booked):
    out = []
    for b in sorted(booked, key=lambda x: x["date"]):
        d = dt.date.fromisoformat(b["date"])
        label = b.get("label") or "Geboekt"
        if out and out[-1]["label"] == label and out[-1]["end"] + dt.timedelta(days=1) == d:
            out[-1]["end"] = d
        else:
            out.append({"start": d, "end": d, "label": label})
    return out


def _active(slide, today):
    if not slide.get("enabled", True):
        return False
    try:
        if slide.get("from") and dt.date.fromisoformat(slide["from"]) > today:
            return False
        if slide.get("until") and dt.date.fromisoformat(slide["until"]) < today:
            return False
        if slide.get("type") == "countdown" and slide.get("target") \
                and dt.date.fromisoformat(slide["target"]) < today:
            return False
    except ValueError:
        pass
    return True


def _fb_posts(s, cache, today):
    """Recente posts uit de cache, gefilterd op leeftijd en aantal."""
    data = (cache.get("facebook") or {}).get("data") or {}
    max_age = int(s.get("max_age_days") or 0)
    out = []
    for p in data.get("posts", []):
        try:
            created = dt.datetime.fromisoformat(p["created"].replace("+0000", "+00:00"))
        except (KeyError, ValueError):
            continue
        if max_age and (today - created.date()).days > max_age:
            continue
        out.append(dict(p, created=created.isoformat()))
        if len(out) >= int(s.get("count") or 4):
            break
    return out, data.get("page") or {}


def _fb_post_slides(s, cache, today):
    """Layout 'single': elke recente post wordt een eigen slide."""
    posts, page = _fb_posts(s, cache, today)
    return [{
        "id": f'{s["id"]}-{p["id"]}',
        "type": "fbpost",
        "duration": s.get("duration") or 12,
        "kicker": s.get("title") or "Nieuws van Facebook",
        "page": page.get("name", ""),
        "page_picture": page.get("picture", ""),
        "created": p["created"],
        "approx": bool(p.get("date_label")),  # datum van de website is een schatting ('1 week geleden')
        "text": p.get("text", ""),
        "image": p.get("image", ""),
        "url": p.get("url", ""),
        "qr": qr_svg(p["url"]) if p.get("url") else "",
    } for p in posts]


def _fb_feed_slide(s, cache, today, page_id=""):
    """Layout 'list': één overzichtsslide met de nieuwste post groot en de vorige ernaast."""
    s = dict(s, count=max(1, min(5, int(s.get("count") or 4))))
    posts, page = _fb_posts(s, cache, today)
    if not posts:
        return None
    page_url = page.get("url") or (f"https://www.facebook.com/{page_id}" if page_id else "")
    return {
        "id": s["id"],
        "type": "fbfeed",
        "duration": s.get("duration") or 20,
        "title": s.get("title") or "Nieuws van Facebook",
        "page": page.get("name", ""),
        "page_qr": qr_svg(page_url) if page_url else "",
        "posts": [{k: p.get(k, "") for k in ("id", "created", "text", "image")} for p in posts],
    }


SEASONS = {12: "winter", 1: "winter", 2: "winter", 3: "spring", 4: "spring", 5: "spring",
           9: "autumn", 10: "autumn", 11: "autumn"}


def _md_date(year, iso):
    """Datum met maand/dag uit iso in het gegeven jaar (29 feb -> 28 feb)."""
    d = dt.date.fromisoformat(iso)
    try:
        return d.replace(year=year)
    except ValueError:
        return d.replace(year=year, day=28)


def moment_active(m, today):
    if not m.get("date"):
        return False
    try:
        start = dt.date.fromisoformat(m["date"])
        end = dt.date.fromisoformat(m["until"]) if m.get("until") else start
    except ValueError:
        return False
    if not m.get("yearly"):
        return start <= today <= max(start, end)
    for y in (today.year, today.year - 1):  # ook periodes over de jaarwisseling
        s = _md_date(y, m["date"])
        e = _md_date(y, m["until"] if m.get("until") else m["date"])
        if e < s:
            e = _md_date(y + 1, m["until"])
        if s <= today <= e:
            return True
    return False


def effects(cfg, today):
    ef = cfg.get("effects", {})
    season = ef.get("season", "auto")
    if season == "auto":
        season = SEASONS.get(today.month, "")
    if season not in ("autumn", "winter", "spring"):
        season = ""
    confetti = lights = False
    hide_season = False
    messages = []
    if ef.get("christmas_auto", True) and ((today.month == 12 and today.day >= 7) or (today.month == 1 and today.day <= 6)):
        lights = True
    for m in ef.get("moments", []):
        if not moment_active(m, today):
            continue
        if m.get("type") == "christmas":
            lights = True
        else:
            confetti = True
        if m.get("with_season") is False:  # moment zonder seizoensanimatie
            hide_season = True
        if m.get("text"):
            messages.append({"type": m.get("type", "birthday"), "text": m["text"]})
    if hide_season:
        season = ""
    amounts = {k: ef.get(f"amount_{k}") or "normal" for k in ("autumn", "winter", "spring", "confetti")}
    return {"season": season, "amounts": amounts, "confetti": confetti,
            "lights": lights, "messages": messages}


def build_state(cfg, cache, boot, version):
    g, side, src = cfg["general"], cfg["sidebar"], cfg["sources"]
    today = dt.datetime.now(ZoneInfo(g["timezone"])).date()
    show_labels = side.get("show_labels", True)

    # --- verhuur ---
    vh = cache.get("verhuur") or {}
    buildings = []
    for b in (vh.get("data") or {}).get("buildings", []):
        booked = b.get("booked", [])
        if not show_labels:
            booked = [{"date": x["date"], "label": "Geboekt"} for x in booked]
        buildings.append({"name": b["name"], "booked": booked, "ranges": merge_ranges(booked)})

    horizon = today + dt.timedelta(days=int(side.get("agenda_days", 21)))
    agenda, today_status = [], []
    for b in buildings:
        now_label = next((r["label"] for r in b["ranges"] if r["start"] <= today <= r["end"]), None)
        today_status.append({"name": b["name"], "busy": now_label is not None, "label": now_label or ""})
        for r in b["ranges"]:
            if r["end"] >= today and r["start"] <= horizon:
                agenda.append({"start": max(r["start"], today).isoformat(), "end": r["end"].isoformat(),
                               "building": b["name"], "label": r["label"]})
    agenda.sort(key=lambda a: (a["start"], a["building"]))

    # --- stookadvies ---
    st = cache.get("stook") or {}
    stook = st.get("data")
    if src.get("stook_override"):
        stook = stook_source.phase_info(src["stook_override"], src.get("stook_region", ""), source="handmatig")
    if stook is not None:
        stook = dict(stook, note=src.get("stook_note", ""))

    # --- slides ---
    slides = []
    for s in cfg["slides"]:
        if not _active(s, today):
            continue
        s = dict(s)
        t = s.get("type")
        if t == "jaarplanning":
            items = [i for i in cfg.get("jaarplanning", [])
                     if (i.get("end") or i.get("date", "")) >= today.isoformat()]
            s["items"] = items[: int(s.get("count") or 8)]
        elif t == "verhuur":
            start = today - dt.timedelta(days=today.weekday())
            s["start"] = start.isoformat()
            s["days"] = 7 * max(1, min(8, int(s.get("weeks") or 4)))
            s["buildings"] = [{"name": b["name"], "booked": {x["date"]: x["label"] or "Geboekt" for x in b["booked"]}}
                              for b in buildings]
        elif t == "fbposts":
            if (s.get("layout") or "list") == "list":
                feed = _fb_feed_slide(s, cache, today, src.get("facebook_page_id", ""))
                if feed:
                    slides.append(feed)
            else:
                slides.extend(_fb_post_slides(s, cache, today))
            continue
        elif t in ("qr", "facebook") and s.get("url"):
            s["qr"] = qr_svg(s["url"])
        slides.append(s)

    def meta(name):
        c = cache.get(name) or {}
        return {"updated": c.get("updated"), "error": c.get("error")}

    return {
        "boot": boot,
        "version": version,
        "today": today.isoformat(),
        "general": {k: v for k, v in g.items() if k != "admin_password_hash"},
        "sidebar": side,
        "weather": (cache.get("weather") or {}).get("data"),
        "weather_meta": meta("weather"),
        "stook": stook,
        "verhuur": {"today": today_status, "agenda": agenda[: int(side.get("agenda_max", 7))],
                    "meta": meta("verhuur")},
        "slides": slides,
        "effects": effects(cfg, today),
    }

"""Weer via Open-Meteo (gratis, geen API-sleutel) + waarschuwingen via MeteoAlarm."""
import datetime as dt
import logging

import requests

from . import USER_AGENT

log = logging.getLogger(__name__)

# WMO-weercodes -> (omschrijving, icoon dag, icoon nacht)
WMO = {
    0: ("Onbewolkt", "☀️", "🌙"),
    1: ("Overwegend helder", "🌤️", "🌙"),
    2: ("Half bewolkt", "⛅", "☁️"),
    3: ("Bewolkt", "☁️", "☁️"),
    45: ("Mist", "🌫️", "🌫️"),
    48: ("Rijpmist", "🌫️", "🌫️"),
    51: ("Lichte motregen", "🌦️", "🌧️"),
    53: ("Motregen", "🌦️", "🌧️"),
    55: ("Dichte motregen", "🌧️", "🌧️"),
    56: ("Lichte ijzel", "🌧️", "🌧️"),
    57: ("IJzel", "🌧️", "🌧️"),
    61: ("Lichte regen", "🌦️", "🌧️"),
    63: ("Regen", "🌧️", "🌧️"),
    65: ("Zware regen", "🌧️", "🌧️"),
    66: ("Lichte ijzelregen", "🌧️", "🌧️"),
    67: ("IJzelregen", "🌧️", "🌧️"),
    71: ("Lichte sneeuw", "🌨️", "🌨️"),
    73: ("Sneeuw", "🌨️", "🌨️"),
    75: ("Zware sneeuw", "❄️", "❄️"),
    77: ("Sneeuwkorrels", "🌨️", "🌨️"),
    80: ("Lichte buien", "🌦️", "🌧️"),
    81: ("Buien", "🌧️", "🌧️"),
    82: ("Zware buien", "⛈️", "⛈️"),
    85: ("Sneeuwbuien", "🌨️", "🌨️"),
    86: ("Zware sneeuwbuien", "❄️", "❄️"),
    95: ("Onweer", "⛈️", "⛈️"),
    96: ("Onweer met hagel", "⛈️", "⛈️"),
    99: ("Zwaar onweer met hagel", "⛈️", "⛈️"),
}

DIRS = ["N", "NNO", "NO", "ONO", "O", "OZO", "ZO", "ZZO", "Z", "ZZW", "ZW", "WZW", "W", "WNW", "NW", "NNW"]
BFT = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118]


def _wmo(code, is_day=True):
    desc, day, night = WMO.get(int(code or 0), ("Onbekend", "🌡️", "🌡️"))
    return desc, (day if is_day else night)


def beaufort(kmh):
    for i, limit in enumerate(BFT):
        if kmh < limit:
            return i
    return 12


def wind_dir(deg):
    return DIRS[int(((deg or 0) + 11.25) // 22.5) % 16]


def fetch(lat, lon, tz="Europe/Amsterdam", alert_area="Gelderland"):
    params = {
        "latitude": lat,
        "longitude": lon,
        "timezone": tz,
        "current": "temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,"
                   "wind_gusts_10m,precipitation,is_day,relative_humidity_2m",
        "hourly": "temperature_2m,precipitation_probability,precipitation,weather_code,is_day",
        "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,"
                 "precipitation_sum,sunrise,sunset,wind_speed_10m_max",
        "forecast_days": 7,
        "wind_speed_unit": "kmh",
    }
    r = requests.get("https://api.open-meteo.com/v1/forecast", params=params, headers=USER_AGENT, timeout=20)
    r.raise_for_status()
    j = r.json()

    c = j["current"]
    desc, icon = _wmo(c["weather_code"], bool(c.get("is_day", 1)))
    current = {
        "temp": c["temperature_2m"],
        "feels": c["apparent_temperature"],
        "code": c["weather_code"],
        "desc": desc,
        "icon": icon,
        "wind_kmh": c["wind_speed_10m"],
        "gusts_kmh": c.get("wind_gusts_10m"),
        "bft": beaufort(c["wind_speed_10m"]),
        "wind_dir": wind_dir(c["wind_direction_10m"]),
        "humidity": c.get("relative_humidity_2m"),
        "precip": c.get("precipitation"),
    }

    d = j["daily"]
    daily = []
    for i, day in enumerate(d["time"]):
        ddesc, dicon = _wmo(d["weather_code"][i])
        daily.append({
            "date": day,
            "code": d["weather_code"][i],
            "desc": ddesc,
            "icon": dicon,
            "tmax": d["temperature_2m_max"][i],
            "tmin": d["temperature_2m_min"][i],
            "pop": d["precipitation_probability_max"][i],
            "rain": d["precipitation_sum"][i],
            "wind_bft": beaufort(d["wind_speed_10m_max"][i] or 0),
            "sunrise": (d["sunrise"][i] or "")[11:16],
            "sunset": (d["sunset"][i] or "")[11:16],
        })

    h = j["hourly"]
    now_key = c["time"][:13]  # "2026-11-24T13"
    start = next((i for i, t in enumerate(h["time"]) if t[:13] >= now_key), 0)
    hourly = []
    for i in range(start, min(start + 24, len(h["time"]))):
        hdesc, hicon = _wmo(h["weather_code"][i], bool(h["is_day"][i]))
        hourly.append({
            "time": h["time"][i][11:16],
            "temp": h["temperature_2m"][i],
            "pop": h["precipitation_probability"][i],
            "rain": h["precipitation"][i],
            "icon": hicon,
            "desc": hdesc,
        })

    alerts = []
    if alert_area:
        try:
            alerts = fetch_alerts(alert_area)
        except Exception as e:  # waarschuwingen zijn optioneel
            log.warning("MeteoAlarm ophalen mislukt: %s", e)

    return {"current": current, "daily": daily, "hourly": hourly, "alerts": alerts}


LEVELS = {"yellow": ("geel", 2), "orange": ("oranje", 3), "red": ("rood", 4)}


def fetch_alerts(area):
    r = requests.get("https://feeds.meteoalarm.org/api/v1/warnings/feeds-netherlands",
                     headers=USER_AGENT, timeout=20)
    r.raise_for_status()
    now = dt.datetime.now(dt.timezone.utc)
    seen, out = set(), []
    for w in r.json().get("warnings", []):
        infos = (w.get("alert") or {}).get("info") or []
        info = next((i for i in infos if str(i.get("language", "")).lower().startswith("nl")),
                    infos[0] if infos else None)
        if not info:
            continue
        areas = " ".join(a.get("areaDesc", "") for a in info.get("area", []))
        if area.lower() not in areas.lower():
            continue
        try:
            if info.get("expires") and dt.datetime.fromisoformat(info["expires"]) < now:
                continue
        except ValueError:
            pass
        color = ""
        for p in info.get("parameter", []):
            if p.get("valueName") == "awareness_level":
                parts = [x.strip() for x in str(p.get("value", "")).split(";")]
                color = parts[1] if len(parts) > 1 else ""
        if color not in LEVELS:
            continue
        key = (info.get("event"), color)
        if key in seen:
            continue
        seen.add(key)
        out.append({
            "event": info.get("event", "Weerswaarschuwing"),
            "headline": info.get("headline", ""),
            "level": color,
            "level_nl": LEVELS[color][0],
            "onset": info.get("onset", ""),
            "expires": info.get("expires", ""),
        })
    out.sort(key=lambda a: -LEVELS[a["level"]][1])
    return out

"""Recente posts van de eigen Facebook-pagina via de Graph API (Pages API) of via de website-widget.

Nodig: het pagina-ID en een Page access token met de rechten pages_show_list en
pages_read_engagement. Een Page-token dat is afgeleid van een long-lived user token verloopt niet;
de koppelhulp in het beheerscherm (exchange_token) regelt dat in één stap.
"""
import requests

from . import USER_AGENT
from . import facebook_web

GRAPH = "https://graph.facebook.com"


def _url(version, path):
    version = (version or "").strip().strip("/")
    return f"{GRAPH}/{version}/{path}" if version else f"{GRAPH}/{path}"


def _get(version, path, params):
    r = requests.get(_url(version, path), params=params, headers=USER_AGENT, timeout=25)
    try:
        j = r.json()
    except ValueError:
        r.raise_for_status()
        raise
    if "error" in j:
        e = j["error"]
        msg = e.get("message", "onbekende fout")
        if "Application" in msg or e.get("code") == 12:
            msg = ("Het ingevulde pagina-ID is het ID van je Facebook-app, niet van de pagina. "
                   "Gebruik 'Koppelen met Facebook' (vult het juiste ID in) of vul het pagina-ID handmatig in. (" + msg + ")")
        elif e.get("code") == 190:
            msg = "Facebook-token is verlopen of ingetrokken — koppel opnieuw via Beheer → Bronnen. (" + msg + ")"
        raise RuntimeError(f"Facebook: {msg}")
    r.raise_for_status()
    return j


def fetch(page_id, token, count=8, version=""):
    page = _get(version, page_id, {"fields": "name,link,picture{url}", "access_token": token})
    j = _get(version, f"{page_id}/posts", {
        "fields": "id,message,story,created_time,full_picture,permalink_url,status_type",
        "limit": max(1, min(25, int(count) * 2)),  # ruim ophalen; lege posts vallen af
        "access_token": token,
    })
    posts = []
    for p in j.get("data", []):
        text = (p.get("message") or "").strip()
        if not text and not p.get("full_picture"):
            continue  # bijv. 'heeft de omslagfoto bijgewerkt' zonder inhoud
        posts.append({
            "id": p["id"],
            "text": text or (p.get("story") or ""),
            "created": p.get("created_time", ""),
            "image": p.get("full_picture", ""),
            "url": p.get("permalink_url") or f"https://www.facebook.com/{p['id']}",
        })
        if len(posts) >= int(count):
            break
    return {
        "page": {"name": page.get("name", ""), "url": page.get("link", ""),
                 "picture": ((page.get("picture") or {}).get("data") or {}).get("url", "")},
        "posts": posts,
    }


def exchange_token(app_id, app_secret, user_token, version="", page_id=""):
    """Kort user-token -> long-lived user-token -> lijst pagina's met niet-verlopende Page-tokens."""
    ll = _get(version, "oauth/access_token", {
        "grant_type": "fb_exchange_token",
        "client_id": app_id,
        "client_secret": app_secret,
        "fb_exchange_token": user_token,
    })["access_token"]
    pages = _get(version, "me/accounts", {"fields": "id,name,access_token", "limit": 100, "access_token": ll})
    found = [{"id": p["id"], "name": p.get("name", ""), "token": p["access_token"]}
             for p in pages.get("data", []) if p.get("access_token")]
    if found:
        return found
    # Pagina's in een Meta Business-portfolio staan soms niet in me/accounts: vraag de pagina direct op.
    tried = ""
    if page_id:
        try:
            p = _get(version, str(page_id).strip(), {"fields": "id,name,access_token", "access_token": ll})
            if p.get("access_token"):
                return [{"id": p["id"], "name": p.get("name", ""), "token": p["access_token"]}]
            tried = f" Pagina {page_id} gaf geen token terug (geen beheerrechten met dit account?)."
        except RuntimeError as e:
            tried = f" Direct opvragen van pagina {page_id} mislukte: {e}."
    granted, declined = [], []
    try:
        for perm in _get(version, "me/permissions", {"access_token": ll}).get("data", []):
            (granted if perm.get("status") == "granted" else declined).append(perm.get("permission"))
    except RuntimeError:
        pass
    missing = [x for x in ("pages_show_list", "pages_read_engagement") if x not in granted]
    tip = []
    if missing:
        tip.append("Ontbrekende rechten: " + ", ".join(missing) + ". Voeg ze toe in de Graph API Explorer en maak een nieuw token.")
    else:
        tip.append("De rechten zijn in orde, maar Facebook gaf geen pagina's. Kies bij het inloggen in de Graph API Explorer "
                   "expliciet de scoutingpagina ('Opnieuw verbinden' / 'Toegang bewerken').")
        if "business_management" not in granted:
            tip.append("Valt de pagina onder een Meta Business-portfolio? Voeg dan ook het recht business_management toe.")
    raise RuntimeError("Geen pagina's gevonden voor dit account." + tried + " " + " ".join(tip)
                       + f" (Toegekende rechten: {', '.join(granted) or 'geen'})")


def fetch_configured(src, overrides=None):
    """Haal posts op volgens de gekozen methode.

    auto = token gebruiken als die is ingesteld, anders (of als de token faalt) de website uitlezen.
    api  = alleen de token-methode.  web = alleen de website.
    """
    s = dict(src, **{k: v for k, v in (overrides or {}).items() if v not in (None, "")})
    method = s.get("facebook_method") or "auto"
    count = s.get("facebook_count") or 8
    has_api = bool(s.get("facebook_page_id") and s.get("facebook_token"))
    has_web = bool(s.get("facebook_web_url"))
    api_error = None
    if method in ("auto", "api") and has_api:
        try:
            return dict(fetch(s["facebook_page_id"], s["facebook_token"], count,
                              s.get("facebook_graph_version", "")), source="api")
        except Exception as e:  # noqa: BLE001
            if method == "api" or not has_web:
                raise
            api_error = str(e)
    if method in ("auto", "web") and has_web:
        data = dict(facebook_web.fetch(s["facebook_web_url"], count), source="web")
        if api_error:
            data["warning"] = "Token-methode mislukt, posts van de website gebruikt: " + api_error
        return data
    if method == "api":
        raise RuntimeError("Token-methode gekozen, maar pagina-ID of token ontbreekt.")
    raise RuntimeError("Facebook is niet ingesteld: koppel een token of vul een website-adres in.")


def configured(src):
    method = src.get("facebook_method") or "auto"
    has_api = bool(src.get("facebook_page_id") and src.get("facebook_token"))
    has_web = bool(src.get("facebook_web_url"))
    return {"auto": has_api or has_web, "api": has_api, "web": has_web}.get(method, False)

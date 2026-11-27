"""Flask-app: het infobord (/) en het beheerscherm (/admin)."""
import logging
import secrets
import uuid
from functools import wraps

from flask import (Flask, jsonify, redirect, render_template, request, send_from_directory,
                   session, url_for)
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename

from .sources import facebook as fb_source
from .sources import jaarplanning as jp_source
from .sources import stook as stook_source
from .sources import verhuur as vh_source
from .state import build_state
from .store import DATA_DIR, UPLOAD_DIR, store
from . import update as self_update
from .updater import updater

log = logging.getLogger(__name__)
BOOT_ID = uuid.uuid4().hex
ALLOWED_UPLOADS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}


def _secret_key():
    path = DATA_DIR / "secret.key"
    if not path.exists():
        path.write_text(secrets.token_hex(32))
        path.chmod(0o600)
    return path.read_text().strip()


app = Flask(__name__)
app.secret_key = _secret_key()
app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"


def _password_set():
    return bool(store.get_config()["general"].get("admin_password_hash"))


def login_required(fn):
    @wraps(fn)
    def wrapper(*a, **kw):
        if _password_set() and not session.get("admin"):
            if request.path.startswith("/api/"):
                return jsonify(error="Niet ingelogd"), 401
            return redirect(url_for("login", next=request.path))
        return fn(*a, **kw)
    return wrapper


# ---------------- scherm ----------------

@app.get("/")
def display():
    return render_template("display.html", v=BOOT_ID[:8])


@app.get("/api/state")
def api_state():
    resp = jsonify(build_state(store.get_config(), store.get_cache(), BOOT_ID, store.version))
    resp.headers["Cache-Control"] = "no-store"
    return resp


@app.get("/uploads/<path:name>")
def uploads(name):
    return send_from_directory(UPLOAD_DIR, name, max_age=3600)


# ---------------- beheer ----------------

@app.route("/login", methods=["GET", "POST"])
def login():
    error = None
    if request.method == "POST":
        h = store.get_config()["general"].get("admin_password_hash")
        if h and check_password_hash(h, request.form.get("password", "")):
            session["admin"] = True
            session.permanent = True
            nxt = request.args.get("next", "/admin")
            return redirect(nxt if nxt.startswith("/") and not nxt.startswith("//") else "/admin")
        error = "Onjuist wachtwoord"
    return render_template("login.html", error=error)


@app.get("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.get("/admin")
@login_required
def admin():
    return render_template("admin.html", v=BOOT_ID[:8], password_set=_password_set())


@app.get("/api/admin/config")
@login_required
def get_config():
    cfg = store.get_config()
    cfg["general"].pop("admin_password_hash", None)
    return jsonify(cfg)


@app.post("/api/admin/config")
@login_required
def save_config():
    new = request.get_json(force=True)
    cur = store.get_config()
    new.setdefault("general", {})["admin_password_hash"] = cur["general"].get("admin_password_hash", "")
    old_src = cur["sources"]
    cfg = store.save_config(new)
    # bronnen opnieuw ophalen als relevante instellingen zijn gewijzigd
    changed = []
    if cfg["sources"]["verhuur"] != old_src["verhuur"] or cfg["sources"]["verhuur_months"] != old_src["verhuur_months"]:
        changed.append("verhuur")
    if (cfg["sources"]["stook_region"], cfg["sources"]["stook_url"]) != (old_src["stook_region"], old_src["stook_url"]):
        changed.append("stook")
    if (cfg["general"]["lat"], cfg["general"]["lon"], cfg["sources"]["weather_alert_area"]) != \
            (cur["general"]["lat"], cur["general"]["lon"], old_src["weather_alert_area"]):
        changed.append("weather")
    fb_keys = ("facebook_method", "facebook_web_url", "facebook_page_id", "facebook_token",
               "facebook_count", "facebook_graph_version")
    if any(cfg["sources"].get(k) != old_src.get(k) for k in fb_keys):
        changed.append("facebook")
    if changed:
        updater.refresh(changed)
    return jsonify(ok=True, version=store.version)


@app.post("/api/admin/password")
@login_required
def set_password():
    pw = (request.get_json(force=True) or {}).get("password", "")
    if len(pw) < 6:
        return jsonify(error="Gebruik minimaal 6 tekens"), 400
    cfg = store.get_config()
    cfg["general"]["admin_password_hash"] = generate_password_hash(pw)
    store.save_config(cfg)
    session["admin"] = True
    return jsonify(ok=True)


@app.post("/api/admin/upload")
@login_required
def upload():
    f = request.files.get("file")
    if not f or not f.filename:
        return jsonify(error="Geen bestand"), 400
    name = secure_filename(f.filename) or "bestand"
    ext = ("." + name.rsplit(".", 1)[-1].lower()) if "." in name else ""
    if ext not in ALLOWED_UPLOADS:
        return jsonify(error="Alleen afbeeldingen (png, jpg, gif, webp, svg)"), 400
    final = f"{uuid.uuid4().hex[:8]}-{name}"
    f.save(UPLOAD_DIR / final)
    return jsonify(url=f"/uploads/{final}")


@app.get("/api/admin/uploads")
@login_required
def list_uploads():
    files = sorted(UPLOAD_DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)
    return jsonify([f"/uploads/{p.name}" for p in files if p.is_file()])


@app.post("/api/admin/refresh")
@login_required
def refresh():
    updater.refresh()
    return jsonify(ok=True)


@app.get("/api/admin/status")
@login_required
def status():
    cache = store.get_cache()
    out = {}
    for name in ("weather", "verhuur", "stook", "facebook"):
        c = cache.get(name) or {}
        item = {"updated": c.get("updated"), "error": c.get("error"), "error_time": c.get("error_time")}
        if name == "verhuur" and c.get("data"):
            item["buildings"] = [{"name": b["name"], "booked_days": len(b["booked"]),
                                  "diagnostics": b.get("diagnostics", [])} for b in c["data"]["buildings"]]
        if name == "stook" and c.get("data"):
            item["summary"] = f'{c["data"]["title"]} ({c["data"]["region"]})'
        if name == "facebook" and c.get("data"):
            posts = c["data"].get("posts", [])
            newest = posts[0]["created"][:10] if posts else "—"
            via = "website" if c["data"].get("source") == "web" else "token"
            item["summary"] = f'{c["data"]["page"].get("name", "")}: {len(posts)} posts via {via}, nieuwste {newest}'
            if c["data"].get("warning"):
                item["error"] = item["error"] or c["data"]["warning"]
        if name == "weather" and c.get("data"):
            cur = c["data"]["current"]
            item["summary"] = f'{cur["temp"]}°C, {cur["desc"]}; {len(c["data"].get("alerts", []))} waarschuwing(en)'
        out[name] = item
    return jsonify(out)


@app.post("/api/admin/import-jaarplanning")
@login_required
def import_jaarplanning():
    url = (request.get_json(force=True) or {}).get("url") or store.get_config()["sources"]["jaarplanning_pdf"]
    try:
        items = jp_source.fetch_pdf(url)
    except Exception as e:  # noqa: BLE001
        return jsonify(error=f"Importeren mislukt: {e}"), 400
    return jsonify(items=items)


@app.post("/api/admin/test-verhuur")
@login_required
def test_verhuur():
    url = (request.get_json(force=True) or {}).get("url", "")
    try:
        booked, diags = vh_source.fetch_building(url, 1)
    except Exception as e:  # noqa: BLE001
        return jsonify(error=str(e)), 400
    return jsonify(diagnostics=diags, booked={d.isoformat(): l for d, l in sorted(booked.items())})


@app.post("/api/admin/test-stook")
@login_required
def test_stook():
    src = store.get_config()["sources"]
    try:
        return jsonify(stook_source.fetch(src["stook_url"], src["stook_region"]))
    except Exception as e:  # noqa: BLE001
        return jsonify(error=str(e)), 400


@app.post("/api/admin/facebook-connect")
@login_required
def facebook_connect():
    """Wissel een kort user-token om voor niet-verlopende Page-tokens. Het app-geheim wordt niet opgeslagen."""
    j = request.get_json(force=True) or {}
    if not all(j.get(k) for k in ("app_id", "app_secret", "user_token")):
        return jsonify(error="Vul App-ID, App-geheim en het user-token in"), 400
    try:
        pages = fb_source.exchange_token(j["app_id"].strip(), j["app_secret"].strip(), j["user_token"].strip(),
                                         store.get_config()["sources"].get("facebook_graph_version", ""),
                                         (j.get("page_id") or "").strip())
    except Exception as e:  # noqa: BLE001
        return jsonify(error=str(e)), 400
    if not pages:
        return jsonify(error="Geen pagina's gevonden. Ben je beheerder van de pagina en gaf je toegang tot de pagina?"), 400
    return jsonify(pages=pages)


@app.post("/api/admin/test-facebook")
@login_required
def test_facebook():
    """Test met de (nog niet opgeslagen) waarden uit het beheerscherm."""
    j = request.get_json(force=True) or {}
    keys = ("facebook_method", "facebook_web_url", "facebook_page_id", "facebook_token", "facebook_graph_version")
    try:
        data = fb_source.fetch_configured(store.get_config()["sources"], {k: j.get(k) for k in keys})
    except Exception as e:  # noqa: BLE001
        return jsonify(error=str(e)), 400
    return jsonify(page=data["page"].get("name", ""), source=data.get("source"), warning=data.get("warning"),
                   posts=[{"created": p["created"], "label": p.get("date_label", ""), "text": p["text"][:80],
                           "image": bool(p.get("image"))} for p in data["posts"]])


@app.get("/api/admin/update-status")
@login_required
def update_status():
    return jsonify(self_update.status(store.get_config()))


@app.post("/api/admin/update")
@login_required
def update_now():
    try:
        info = self_update.apply(store.get_config())
    except Exception as e:  # noqa: BLE001
        return jsonify(error=f"Bijwerken mislukt: {e}"), 400
    return jsonify(ok=True, version=info)


def start_background():
    updater.start()

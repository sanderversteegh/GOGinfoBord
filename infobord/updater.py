"""Achtergrondthread die periodiek de bronnen ververst en het scherm aan/uit zet."""
import datetime as dt
import logging
import threading
import time

from . import screen, update
from .sources import facebook, stook, verhuur, weather
from .store import store

log = logging.getLogger(__name__)
RETRY_AFTER_ERROR = 120  # seconden


def _now_iso():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


class Updater(threading.Thread):
    def __init__(self):
        super().__init__(daemon=True, name="updater")
        self._wake = threading.Event()
        self._lock = threading.Lock()
        self._force = set()
        self._last = {}

    def _jobs(self, cfg):
        g, src = cfg["general"], cfg["sources"]
        jobs = {
            "weather": (src["weather_minutes"] * 60,
                        lambda: weather.fetch(g["lat"], g["lon"], g["timezone"], src.get("weather_alert_area"))),
            "verhuur": (src["verhuur_minutes"] * 60,
                        lambda: verhuur.fetch(src["verhuur"], src["verhuur_months"])),
        }
        if src.get("stook_region") and src.get("stook_url"):
            jobs["stook"] = (src["stook_minutes"] * 60, lambda: stook.fetch(src["stook_url"], src["stook_region"]))
        if facebook.configured(src):
            jobs["facebook"] = (max(5, src.get("facebook_minutes") or 20) * 60,
                                lambda: facebook.fetch_configured(src))
        return jobs

    def _auto_update(self, cfg):
        """Elke nacht om ±04:30 automatisch bijwerken als dat aanstaat."""
        up = cfg.get("update", {})
        now = dt.datetime.now()
        if not (up.get("auto") and up.get("repo")) or now.strftime("%H:%M") < "04:30" or now.hour >= 5:
            return
        if self._last.get("auto_update_day") == now.date().toordinal():
            return
        self._last["auto_update_day"] = now.date().toordinal()
        try:
            st = update.status(cfg)
            if st.get("available"):
                update.apply(cfg)
        except Exception as e:  # noqa: BLE001
            log.warning("Automatisch bijwerken mislukt: %s", e)

    def refresh(self, names=None):
        with self._lock:
            self._force.update(names or ["weather", "verhuur", "stook", "facebook"])
        self._wake.set()

    def run_job(self, name, fn):
        try:
            data = fn()
            store.set_cache(name, {"data": data, "updated": _now_iso(), "error": None})
            log.info("%s bijgewerkt", name)
        except Exception as e:  # noqa: BLE001 - fouten tonen in beheer, oude data blijft staan
            log.warning("%s mislukt: %s", name, e)
            prev = store.get_cache().get(name) or {}
            prev.update(error=str(e), error_time=_now_iso())
            store.set_cache(name, prev)
            return False
        return True

    def run(self):
        while True:
            cfg = store.get_config()
            for name, (interval, fn) in self._jobs(cfg).items():
                with self._lock:
                    forced = name in self._force
                    self._force.discard(name)
                if not forced and time.time() - self._last.get(name, 0) < interval:
                    continue
                ok = self.run_job(name, fn)
                self._last[name] = time.time() if ok else time.time() - interval + RETRY_AFTER_ERROR
            self._auto_update(cfg)
            try:
                screen.tick(cfg)
            except Exception as e:  # noqa: BLE001
                log.warning("Schermschakeling mislukt: %s", e)
            self._wake.wait(20)
            self._wake.clear()


updater = Updater()

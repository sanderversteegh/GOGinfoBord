"""TV aan/uit volgens tijdschema (standaard via HDMI-CEC met cec-client)."""
import datetime as dt
import logging
import subprocess
from zoneinfo import ZoneInfo

log = logging.getLogger(__name__)
_state = {"on": None}


def in_window(now_hm, on, off):
    if on == off:
        return True
    if on < off:
        return on <= now_hm < off
    return now_hm >= on or now_hm < off  # over middernacht


def run(cmd):
    if not cmd:
        return
    log.info("Schermcommando: %s", cmd)
    subprocess.run(cmd, shell=True, timeout=30, check=False,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def tick(cfg):
    sc = cfg["screen"]
    if not sc.get("enabled"):
        _state["on"] = None
        return
    now = dt.datetime.now(ZoneInfo(cfg["general"]["timezone"])).strftime("%H:%M")
    should = in_window(now, sc.get("on", "00:00"), sc.get("off", "00:00"))
    if _state["on"] is not should:
        run(sc.get("cmd_on") if should else sc.get("cmd_off"))
        _state["on"] = should

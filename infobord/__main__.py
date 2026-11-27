"""Start met: python -m infobord   (luistert standaard op poort 8080)"""
import logging
import os

from waitress import serve

from .app import app, start_background


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    host = os.environ.get("INFOBORD_HOST", "0.0.0.0")
    port = int(os.environ.get("INFOBORD_PORT", "8080"))
    start_background()
    logging.getLogger("infobord").info("Infobord op http://%s:%s  (beheer: /admin)", host, port)
    serve(app, host=host, port=port, threads=6)


if __name__ == "__main__":
    main()

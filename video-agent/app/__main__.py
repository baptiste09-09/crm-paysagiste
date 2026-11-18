"""Lancement : python -m app"""
import shutil
import socket

import uvicorn

from . import config


def _lan_ip() -> str | None:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))  # aucun paquet envoyé, sert à trouver l'IP Wi-Fi
            return s.getsockname()[0]
    except OSError:
        return None


def main() -> None:
    if not shutil.which("ffmpeg"):
        print("\n⚠️  FFmpeg introuvable. Installe-le avec :  brew install ffmpeg\n")
    local = f"http://localhost:{config.PORT}/?t={config.TOKEN}"
    print("\n🎬 Agent montage vidéo")
    print(f"   Sur le Mac      : {local}")
    ip = _lan_ip()
    if ip and config.HOST == "0.0.0.0":
        phone = f"http://{ip}:{config.PORT}/?t={config.TOKEN}"
        print(f"   Sur le téléphone (même Wi-Fi) : {phone}")
        try:
            import qrcode

            qr = qrcode.QRCode(border=1)
            qr.add_data(phone)
            qr.print_ascii(invert=True)
        except ImportError:
            pass
    print(f"   Dossier de travail : {config.HOME}\n")
    from .server import app

    uvicorn.run(app, host=config.HOST, port=config.PORT, log_level="warning")


if __name__ == "__main__":
    main()

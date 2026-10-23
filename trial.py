#!/usr/bin/env python3
"""Run FireFirst on your phone: one command on your computer.

    python3 trial.py            (Windows: py trial.py)

What it does:
  1. Installs the backend into .venv and the mobile app's packages (first run only)
  2. Creates a local database (trial.sqlite3) with a demo department
  3. Starts the server, reachable from your phone over Wi-Fi through the app's dev server
  4. Starts the app and shows a QR code. Scan it with Expo Go on your phone.

Your phone and computer must be on the same Wi-Fi. Press Ctrl+C to stop.

Options:
  --host 192.168.1.20   use this address if the detected one is wrong
  --port 8000           backend port (used only on this computer)
  --reset               start over with a fresh demo database
"""

import argparse
import os
import shutil
import socket
import subprocess
import sys
import venv
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
MOBILE = ROOT / "mobile"
WEB = ROOT / "web"
VENV = ROOT / ".venv"
DB = BACKEND / "trial.sqlite3"


def say(message):
    print(f"\n\033[1;31m▶\033[0m {message}", flush=True)


def fail(message):
    print(f"\n✖ {message}", file=sys.stderr)
    sys.exit(1)


def venv_python():
    scripts = "Scripts" if os.name == "nt" else "bin"
    exe = "python.exe" if os.name == "nt" else "python"
    return VENV / scripts / exe


def lan_address():
    """The address other devices on the network use to reach this computer."""
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        try:
            s.connect(
                ("10.255.255.255", 1)
            )  # No packet is sent; this just picks the outgoing interface.
            return s.getsockname()[0]
        except OSError:
            return "127.0.0.1"


def packages_are_stale(app):
    """True when an app's packages were never installed, or an update (git pull) changed which it needs."""
    installed = (
        app / "node_modules" / ".package-lock.json"
    )  # npm rewrites this on every install
    if not installed.exists():
        return True
    return (app / "package-lock.json").stat().st_mtime > installed.stat().st_mtime


def web_build_is_stale():
    """True when the officer web app has never been built, or its source changed since (e.g. after git pull)."""
    index = WEB / "dist" / "index.html"
    if not index.exists():
        return True
    sources = [WEB / "index.html", WEB / "package.json", *(WEB / "src").rglob("*")]
    built = index.stat().st_mtime
    return any(path.is_file() and path.stat().st_mtime > built for path in sources)


def run(cmd, **kwargs):
    result = subprocess.run(cmd, check=False, **kwargs)
    if result.returncode != 0:
        fail(f"This step failed: {' '.join(str(c) for c in cmd)}")


def main():
    parser = argparse.ArgumentParser(description="Run FireFirst on your phone.")
    parser.add_argument(
        "--host", help="this computer's Wi-Fi address (detected automatically)"
    )
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument(
        "--reset", action="store_true", help="delete the trial database and start fresh"
    )
    args = parser.parse_args()

    if sys.version_info < (3, 12):
        fail(
            f"Python 3.12 or newer is needed (you have {sys.version.split()[0]}). Get it from python.org."
        )
    npm = shutil.which("npm")
    npx = shutil.which("npx")
    if not npm or not npx:
        fail(
            "Node.js is needed. Install the LTS version from nodejs.org, then run this again."
        )

    host = args.host or lan_address()
    if not args.host and host.startswith("127."):
        fail(
            "Couldn't find this computer's Wi-Fi address. Connect to Wi-Fi, or pass --host <address>."
        )
    # The phone reaches the API through the Expo dev server (port 8081), which forwards it to Django.
    # Then only one program needs to be reachable over Wi-Fi.
    server = f"http://{host}:8081"
    backend = f"http://127.0.0.1:{args.port}"

    # 1. Install (first run only).
    if not venv_python().exists():
        say("Setting up the backend (first run only, takes a minute)…")
        venv.create(VENV, with_pip=True)
    run(
        [
            venv_python(),
            "-m",
            "pip",
            "install",
            "-q",
            "-r",
            str(BACKEND / "requirements.txt"),
        ]
    )
    for app, name in ((MOBILE, "mobile app"), (WEB, "web app")):
        if packages_are_stale(app):
            say(
                f"Installing the {name}'s packages (takes a few minutes the first time)…"
            )
            run([npm, "ci", "--no-audit", "--no-fund"], cwd=app)
    if web_build_is_stale():
        say("Building the officer web app…")
        run([npm, "run", "build"], cwd=WEB)

    env = {
        **os.environ,
        "DATABASE_URL": os.environ.get("DATABASE_URL", f"sqlite:///{DB.as_posix()}"),
        "DJANGO_DEBUG": "true",
        "DJANGO_ALLOWED_HOSTS": f"localhost,127.0.0.1,{host}",
    }

    # 2. Database with the demo department.
    if args.reset and DB.exists():
        DB.unlink()
    say("Preparing the database…")
    run([venv_python(), "manage.py", "migrate", "-v0"], cwd=BACKEND, env=env)
    has_demo = (
        subprocess.run(
            [
                venv_python(),
                "manage.py",
                "shell",
                "-c",
                "from apps.core.models import Department; print(Department.objects.filter(slug='demo').exists())",
            ],
            cwd=BACKEND,
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        .stdout.strip()
        .endswith("True")
    )
    if not has_demo:
        run([venv_python(), "manage.py", "seed_demo"], cwd=BACKEND, env=env)

    # 3. Server, reached by the phone through the Expo dev server.
    say(f"Starting the server at {backend}")
    django = subprocess.Popen(
        [
            venv_python(),
            "manage.py",
            "runserver",
            f"127.0.0.1:{args.port}",
            "--noreload",
        ],
        cwd=BACKEND,
        env=env,
    )

    # 4. The app, pointed at the server.
    print(
        f"""
────────────────────────────────────────────────────────────────
  On your phone:
    1. Install "Expo Go" from the App Store or Google Play.
    2. Scan the QR code below (iPhone: with the Camera app;
       Android: from inside Expo Go).
    3. Sign in. Password for every demo account: firefirst-demo
         demo-a1-firefighter   a firefighter on A shift
         demo-a1-captain       an officer (can approve)
         demo-chief            department admin
  If the app can't connect: allow Node through this computer's
  firewall, and check the "Server" field on the sign-in screen
  says {server}

  Officer web app (apparatus, stations, people, schedules, setup):
    open http://localhost:{args.port} in a browser on this computer
    and sign in as demo-chief or demo-a1-captain.
  Press Ctrl+C here to stop.
────────────────────────────────────────────────────────────────
""",
        flush=True,
    )
    try:
        subprocess.run(
            [npx, "expo", "start", "--lan", "--clear"],
            cwd=MOBILE,
            env={
                **os.environ,
                "EXPO_PUBLIC_API_URL": server,
                "FIREFIRST_API_PROXY": backend,
                "REACT_NATIVE_PACKAGER_HOSTNAME": host,
            },
            check=False,
        )
    except KeyboardInterrupt:
        pass
    finally:
        django.terminate()
        print("\nStopped.")


if __name__ == "__main__":
    main()

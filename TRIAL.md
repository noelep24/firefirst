# Try FireFirst on your phone

This runs FireFirst on your own computer and opens the crew app on your phone
through **Expo Go**. You don't need an app store account or a build. It takes
about 10 minutes the first time and 30 seconds after that.

## What you need

- A Mac, Windows or Linux computer, and your phone, **on the same Wi-Fi**
  (not a guest network, which often blocks devices from seeing each other)
- **Python 3.12 or newer**: [python.org/downloads](https://www.python.org/downloads/)
  (on Windows, tick "Add python.exe to PATH" in the installer)
- **Node.js LTS**: [nodejs.org](https://nodejs.org/)
- **Git**: [git-scm.com](https://git-scm.com/downloads) (Macs prompt you to install it the first time you type `git`)
- **Expo Go** on your phone: [App Store](https://apps.apple.com/app/expo-go/id982107779) ·
  [Google Play](https://play.google.com/store/apps/details?id=host.exp.exponent)

## Steps

1. Open a terminal (Mac: Terminal; Windows: PowerShell) and get the code:

   ```bash
   git clone https://github.com/noelep24/firefirst.git
   cd firefirst
   ```

2. Start it:

   ```bash
   python3 trial.py        # Windows: py trial.py
   ```

   The first run installs everything, creates a demo department ("Demo Fire
   Rescue", 25 members, 2 stations, rigs and supplies) and then shows a QR
   code. If your computer asks whether to allow Python or Node to accept
   network connections, click **Allow**.

3. On your phone, scan the QR code:
   - **iPhone**: with the Camera app, then tap the Expo Go banner
   - **Android**: open Expo Go and tap "Scan QR code"

   The first load takes a minute while the app is sent to your phone.

4. Sign in. Every demo account's password is `firefirst-demo`:

   | Username | Who |
   | --- | --- |
   | `demo-a1-firefighter` | Firefighter on A shift, Station 1 |
   | `demo-b1-firefighter` | Firefighter on B shift (try a shift trade with the one above) |
   | `demo-a1-captain` | Officer: approves leave and trades |
   | `demo-chief` | Department admin |

Things to try: a rig check on E1 (mark an item deficient and watch a work
order appear), try the barcode scanner in Supplies, request leave, RSVP to an event,
and turn on airplane mode, log a rig check, then turn it off and watch it
sync.

Press **Ctrl+C** in the terminal to stop. Run `python3 trial.py` again any
time to pick up where you left off, or `python3 trial.py --reset` for a fresh
demo department.

## If something goes wrong

| Problem | Fix |
| --- | --- |
| The phone says it can't connect to the development server | Phone and computer must be on the same Wi-Fi. Turn off VPNs. Allow Node through the firewall (Windows: Windows Security → Firewall → Allow an app). |
| The app opens but sign-in says it can't reach the server | Allow Python through the firewall. Check that "Server" on the sign-in screen shows the address printed in the terminal. |
| The detected address is wrong (several network adapters, VPN) | Find your Wi-Fi IP (Mac: System Settings → Wi-Fi → Details; Windows: `ipconfig`) and run `python3 trial.py --host 192.168.x.x` |
| Expo Go says the project needs a newer or older SDK | Update Expo Go from the app store. |
| Port 8000 is taken | `python3 trial.py --port 8001` |

The trial keeps its data in `backend/trial.sqlite3` on your computer and is
for trying the app only. To run FireFirst for a department, see
[DEPLOY.md](DEPLOY.md).

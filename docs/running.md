# Running AutoSaarthi — the web app and the phone app

This guide takes you from a fresh checkout to both apps running on your own computer. Every step says
what to type, what you should see, and what to do if you do not see it. Commands are for **Windows
PowerShell**; where Mac or Linux differs it says so.

* [1. What you are starting](#1-what-you-are-starting)
* [2. Install once](#2-install-once)
* [3. Set up once](#3-set-up-once)
* [4. Start the web app](#4-start-the-web-app)
* [5. Sign in](#5-sign-in)
* [6. Run the phone app](#6-run-the-phone-app)
* [7. Stop everything](#7-stop-everything)
* [8. Day-to-day cheat sheet](#8-day-to-day-cheat-sheet)
* [9. When something goes wrong](#9-when-something-goes-wrong)

---

## 1. What you are starting

AutoSaarthi is four programs that talk to each other. You start them in this order, because each one
needs the one before it.

```
  Docker ─────────────►  Backend  ─────────────►  Web app        (the website, in a browser)
  (database + broker)    (the brain, port 8010)  │ port 5173
                                                 └►  Phone app     (Expo, port 8081)
```

| Program | What it is | Port | Where it lives |
|---|---|---|---|
| **Database** | PostgreSQL with Timescale, holds every car, reading and booking | 5433 | Docker |
| **Message broker** | MQTT, carries live car readings | 1884 | Docker |
| **Backend** | The Python API (FastAPI) and the AI helpers | 8010 | `backend/` |
| **Web app** | The public site, the sign-in page, the staff console and the owner app | 5173 | `frontend/` |
| **Phone app** | The owner's Android app (Expo / React Native) | 8081 | `mobile/` |

The web app and the phone app never talk to the database directly. They only talk to the backend.

### What the web app shows

| Address | What you see |
|---|---|
| `http://localhost:5173/` | The public site (signed out), or your dashboard (signed in) |
| `http://localhost:5173/login` | The sign-in page |
| `http://localhost:5173/app` | The car owner's app, laid out like a phone |

---

## 2. Install once

You need these programs. Install them once; you will not need to repeat this.

| Program | Version | Why | Check it with |
|---|---|---|---|
| **Git** | any | gets the code | `git --version` |
| **Python** | 3.11 | runs the backend | `python --version` |
| **Node.js** | 20 or newer (24 works) | runs the web app and phone app tooling | `node --version` |
| **Docker Desktop** | any recent | runs the database | `docker --version` |

For the phone app you also need **one** of these (see [section 6](#6-run-the-phone-app)):

* just a browser (nothing extra — easiest),
* **Android Studio** with an emulator, or
* an Android phone with a USB cable.

Mac or Linux: the same programs apply. Replace `.venv\Scripts\activate` with `source .venv/bin/activate`
and ignore the Docker Desktop launch line.

---

## 3. Set up once

Open PowerShell in the project folder (the one that contains `backend`, `frontend` and `mobile`).

### 3.1 Get the code

```powershell
git clone https://github.com/MrBKiran/Major-Project.git
cd Major-Project
```

If you already have the folder (for example `C:\Major Project`), just `cd` into it.

### 3.2 Install the backend (Python)

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

* The first line makes a private box (`.venv`) for the Python packages.
* After the second line your prompt starts with `(.venv)`. That means the box is on.
* The install takes a few minutes. Warnings in yellow are fine; red `ERROR` lines are not.

### 3.3 Install the web app and the shared packages (Node)

Run this **in the project root**, not inside `frontend`:

```powershell
npm install
```

The project root installs `frontend` and the shared design packages together.

### 3.4 Install the phone app

```powershell
cd mobile
npm install
cd ..
```

### 3.5 Make your settings file

```powershell
copy .env.example .env
```

Open `.env` in any editor and check these lines. Everything else can stay as it is.

| Line | Set it to | Why |
|---|---|---|
| `DATABASE_URL=` | `postgresql+psycopg://autosaarthi:autosaarthi@localhost:5433/autosaarthi` | The database listens on **5433**, not the usual 5432 (another Postgres on Windows often owns 5432). |
| `MQTT_PORT=` | `1884` | Same reason: the broker is on 1884. |
| `DEMO_MODE=` | `1` | The AI answers from saved examples, so it works with **no API keys and no internet**. |
| `ENVIRONMENT=` | `development` | Makes demo accounts and development shortcuts available. |
| `SMS_PROVIDER=` | `console` | Phone sign-in codes are printed in the backend window instead of sent as text messages. |
| `PUSH_PROVIDER=` | `console` | Same idea for app notifications. |

Optional: `GROQ_API_KEY` (free from console.groq.com) turns on the real AI model and voice. Leave it
empty to stay in demo mode. Never share this file or commit it; it is already ignored by git.

### 3.6 Start the database and fill it with the demo data

Start **Docker Desktop** (open it from the Start menu and wait until it says it is running), then:

```powershell
docker compose up -d db mqtt
```

You should see `Container ... Started` twice. Check it:

```powershell
docker compose ps
```

The `db` line should say **(healthy)**. If it says `starting`, wait ten seconds and run it again.

Now fill the database. Run these lines **in order**, from the project root, with `(.venv)` on:

```powershell
cd backend
python -m app.db.seed
python -m app.db.tenancy_seed
python -m app.db.history_seed
python -m app.db.demand_seed
python scripts/seed_telemetry.py
python -m alembic stamp head
cd ..
```

What each one does:

| Command | Adds |
|---|---|
| `app.db.seed` | the tables, 10 demo cars, 11 service centres, repair slots |
| `app.db.tenancy_seed` | the demo companies and **the sign-in accounts** |
| `app.db.history_seed` | about 500 more cars and their repair history |
| `app.db.demand_seed` | past workshop demand (used for the forecast) |
| `seed_telemetry.py` | each demo car's sensor readings |
| `alembic stamp head` | tells the migration tool the tables are already up to date (the seed scripts built them) |

Each prints a short summary such as `[seed] 10 vehicles, 11 service centres…`. You only do section 3
once. To put the demo back to its starting state later, see [section 8](#8-day-to-day-cheat-sheet).

---

## 4. Start the web app

Do this every time you want to use the app. You need **three windows** open (PowerShell windows or
terminal tabs). Leave all three running.

### Window 1 — the database

Docker Desktop must be running. Then:

```powershell
docker compose up -d db mqtt
```

You do not have to repeat this if `docker compose ps` already shows both running.

### Window 2 — the backend

```powershell
cd backend
..\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8010
```

Wait for these lines:

```
INFO:     Application startup complete.
INFO:     Uvicorn running on http://127.0.0.1:8010
```

A yellow warning about `JWT_SECRET is not set` is normal in development. The backend makes its own
key and remembers it.

Quick check (in any window):

```powershell
curl http://127.0.0.1:8010/api/health
```

You should see `{"ok":true, ...}` with `database`, `mqtt` and `ml_artifacts` all `ok`. Open
`http://localhost:8010/docs` for the full list of API endpoints.

### Window 3 — the web app

```powershell
cd frontend
npx vite --port 5173
```

Wait for `Local: http://localhost:5173/`, then open **http://localhost:5173** in your browser. You
should see the AutoSaarthi home page with "Fix it before it breaks."

> The web app forwards everything under `/api` to the backend on port 8010 by itself, so there is
> nothing to configure and no cross-site setting to change.

---

## 5. Sign in

All demo accounts use the password **`autosaarthi`**. Click **Sign in** on the home page, or go to
`http://localhost:5173/login`.

| Email | Who they are | What they see |
|---|---|---|
| `admin@autosaarthi.io` | Platform admin | Everything: all 10 cars, owner details visible |
| `soc@autosaarthi.io` | Security analyst | The security log and checks |
| `quality@mahindra.example` | Manufacturer quality engineer | Their brand's cars; owner names hidden |
| `qmanager@mahindra.example` | Manufacturer quality manager | Same brand, with approval rights |
| `analyst@hero.example` | Hero analyst | The one Hero car; owner names hidden |
| `advisor@westernauto.example` | Dealer service advisor (west) | The 6 cars at their centres |
| `manager@westernauto.example` | Dealer centre manager | Same group, with management rights |
| `advisor@southernmotors.example` | Dealer service advisor (south) | The 4 cars at their centres |
| `ops@ramanlogistics.example` | Fleet manager **and** car owner | Asks which role to continue as |
| `ramesh.pawar@example.in` | Car owner (the demo's hero car) | Only their own car |
| `aditi.nair@example.in` | Car owner | Only their own car |

Good ones to try first:

* **`admin@autosaarthi.io`** to see the whole staff console.
* **`ramesh.pawar@example.in`** to see what a car owner sees, including the assistant you can talk to.
  Owners use the owner app at **http://localhost:5173/app** (it is laid out like a phone screen).

Other ways in, when the backend has them switched on:

| Method | Works for | Needs |
|---|---|---|
| Email and password | everyone | nothing |
| Phone number and code | car owners | `SMS_PROVIDER=console`. The six-digit code appears **in the backend window** (Window 2). |
| Continue with Google | accounts already created | `GOOGLE_CLIENT_ID` in `.env` |

---

## 6. Run the phone app

The phone app is for **car owners**. It needs the backend from section 4 (Windows 1 and 2); it does
**not** need the web app (Window 3).

Pick **one** way to run it. Start with A: it needs nothing extra.

### A. In your browser (easiest, no phone needed)

```powershell
cd mobile
npx expo start --port 8081
```

When it says `Waiting on http://localhost:8081`, open **http://localhost:8081** in your browser. The
first load builds the app and takes about 20 seconds (a blank page until then is normal). You get the
phone app in a tab. The sign-in screen opens on the **Phone** tab: tap **Email**, then sign in with
`ramesh.pawar@example.in` and password `autosaarthi`.

Limits of the browser version: it forgets you when you reload the tab (there is no secure storage in
a browser), and it cannot send push notifications.

### B. Android emulator (a pretend phone on your computer)

1. Install **Android Studio**. Open it, then **More Actions → Virtual Device Manager → Create
   device**, pick a Pixel, pick a recent Android image, and start it.
2. Start the backend (section 4, Windows 1 and 2).
3. Start the phone app:

   ```powershell
   cd mobile
   npx expo start --port 8081
   ```

4. In that window press **`a`**. Expo opens the app in the emulator.

Inside the emulator the address `10.0.2.2` means "your computer", and the app already uses it, so you
do not need to set anything.

### C. A real Android phone on a USB cable (no Wi-Fi setup)

1. On the phone: **Settings → About phone**, tap **Build number** seven times, then
   **Settings → Developer options → USB debugging → On**.
2. Plug the phone in and tap **Allow** on the phone. Check that the computer sees it:

   ```powershell
   adb devices
   ```

   (`adb` comes with Android Studio, in `platform-tools`.) You should see one device marked `device`.
3. Tell the phone that "localhost" means your computer:

   ```powershell
   adb reverse tcp:8081 tcp:8081
   adb reverse tcp:8010 tcp:8010
   ```

4. Start the app, pointing it at the backend:

   ```powershell
   cd mobile
   $env:EXPO_PUBLIC_API_URL = "http://localhost:8010"
   npx expo start --localhost --port 8081
   ```

5. Install the app on the phone using the **development build** below (the Play Store's Expo Go can be
   a version behind this project and refuse to open it).

### D. A real phone on the same Wi-Fi

1. Find your computer's address: run `ipconfig` and note the **IPv4 Address** (for example
   `192.168.1.20`).
2. Start the backend so the network can reach it. In Window 2 use `--host 0.0.0.0` instead of
   `127.0.0.1`. Allow it through the Windows firewall if asked.
3. Start the app, pointing at that address:

   ```powershell
   cd mobile
   $env:EXPO_PUBLIC_API_URL = "http://192.168.1.20:8010"
   npx expo start --port 8081
   ```

4. Install the development build (below) on the phone.

Google sign-in does not work over a plain `http://192...` address. Use email or phone sign-in.

### The development build (needed for a real phone)

This turns the project into an Android app file (`.apk`) once, and then the phone loads the live code
from your computer.

You need Android Studio's SDK. Set `ANDROID_HOME` to the SDK folder (usually
`C:\Users\<you>\AppData\Local\Android\Sdk`) and install **CMake 3.31 or newer** from Android Studio's
**SDK Manager → SDK Tools** (Windows only — the default CMake is too old for this project).

```powershell
cd mobile
npx expo prebuild --platform android
cd android
.\gradlew.bat app:assembleDebug
adb install -r app\build\outputs\apk\debug\app-debug.apk
```

The app installs on the phone as **AutoSaarthi**. The first build takes a long time (ten minutes is
normal). After this, you only need `npx expo start` and the app opens against it. Re-run `prebuild`
only if you change `app.json` or the icons.

### Signing in on the phone

* **Email and password:** `ramesh.pawar@example.in` / `autosaarthi`.
* **Phone number and code:** enter the owner's number, then look in **Window 2** (the backend) for the
  line with the six-digit code and type it in.

---

## 7. Stop everything

Press **Ctrl + C** in each window (the backend, the web app, the phone app).

To stop the database as well:

```powershell
docker compose stop
```

Your data stays. `docker compose down` also removes the containers but still keeps the data. Only
`docker compose down -v` deletes the data, and you would redo section 3.6.

---

## 8. Day-to-day cheat sheet

Start (separate windows):

| Window | Commands |
|---|---|
| 1 | `docker compose up -d db mqtt` |
| 2 | `cd backend` then `..\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8010` |
| 3 | `cd frontend` then `npx vite --port 5173` |
| 4 (phone app) | `cd mobile` then `npx expo start --port 8081` |

Put the demo back to its starting state (clears bookings and predictions, reopens repair slots):

```powershell
cd backend
..\.venv\Scripts\python.exe scripts/reset_demo.py
```

Run the checks:

```powershell
npm test                      # web app and shared packages, from the project root
npm run test:mobile           # phone app
cd backend; python -m pytest tests -q    # backend (it makes its own throwaway database)
```

Make a new sign-in account:

```powershell
cd backend
python -m app.auth.manage create-user --email a@b.com --name "A B" --org ORG-RAMAN --role fleet_manager --password-prompt
```

---

## 9. When something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| `failed to connect to the docker API` or `dockerDesktopLinuxEngine` | Docker Desktop is not running | Open Docker Desktop, wait until it says it is running, run the command again |
| `password authentication failed` | You are talking to a different Postgres on port 5432 | Make sure `.env` says port **5433**, and `docker compose ps` shows `db` healthy |
| Backend cannot start: connection refused | The database is not up | Window 1, then `docker compose ps` should show `healthy` |
| Web page loads but sign-in says it cannot reach the server | The backend is not running | Start Window 2; check `curl http://127.0.0.1:8010/api/health` |
| Sign-in says wrong email or password | The demo accounts are missing | Run `python -m app.db.tenancy_seed` (section 3.6). The password is `autosaarthi` |
| `Port 5173 is already in use` | The web app is already running somewhere | Close the other window, or find it: `Get-NetTCPConnection -LocalPort 5173 -State Listen` then `Stop-Process -Id <number>` |
| A blank page and `useAuth() must be used inside <AuthProvider>` in the console | A live-reload hiccup while editing | Reload the page |
| `alembic upgrade head` says `relation ... already exists` | The tables were created by the seed scripts, so the migration history is behind | Run `python -m alembic stamp head` in `backend` once; it records that the tables are already current. (New databases should do this at the end of section 3.6.) |
| The phone app stays on the splash screen | The phone app's server is stuck | Stop it, then `npx expo start --port 8081 --clear` |
| Phone cannot reach the backend | Wrong address for where it runs | Emulator: nothing to set. USB: `adb reverse` lines in step C. Wi-Fi: `EXPO_PUBLIC_API_URL` and `--host 0.0.0.0` in step D |
| The build fails with a very long file path | Old CMake | Install CMake 3.31 or newer from Android Studio's SDK Manager, then `npx expo prebuild --platform android` again |
| Nothing is in the sign-in code box on the phone | The code goes to the backend window, not a real SMS | Read it from Window 2. A real SMS needs `SMS_PROVIDER=twilio` and Twilio settings |
| Voice or a smarter assistant does not work | `DEMO_MODE=1` answers from saved examples | Add `GROQ_API_KEY` to `.env`, set `DEMO_MODE=0`, restart the backend |

Still stuck? The backend window prints every request and every error with a request id; the browser
console (**F12**) shows what the page saw. The deeper guides are
[`authentication.md`](authentication.md) (sign-in methods and security), [`design-system.md`](design-system.md)
(how the screens are built) and the phone app's own [`mobile/README.md`](../mobile/README.md).

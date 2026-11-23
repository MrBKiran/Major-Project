# Android Auto

The owner's phone app has a screen in the car. When the phone connects to a car running Android Auto,
**AutoSaarthi** appears in the car's app launcher and shows how the car is, what it costs to fix now
rather than later, and — only while parked — lets the driver book the service.

| | |
|---|---|
| Built with | the Android for Cars App Library 1.7.0 (`androidx.car.app`), the category **IOT** ("connected devices"), minimum car API level 6 |
| Where the code is | [`mobile/modules/autosaarthi-car`](../mobile/modules/autosaarthi-car) (Kotlin) and [`mobile/src/car`](../mobile/src/car) (TypeScript) |
| Data from | the same server endpoints the web head unit uses: `GET /api/car/{vin}/screen` and `POST /api/car/{vin}/book` ([`backend/app/car.py`](../backend/app/car.py)) |
| Status | Built and tested up to the car host (see [Testing](#testing)). **Not yet run on Android Auto or the Desktop Head Unit** — see [What is not done](#what-is-not-done). |

## What the driver sees

Parked — the whole picture, and a way to act:

```
┌ Bolero · MH12AB1001 ─────────────────────────────┐
│ Your water pump is wearing out                    │
│   Urgent                                          │
│   About 5 days of driving left, on current use.   │
│ Repair now ₹2,400                                 │
│   If it fails on the road ₹18,500                 │
│                                                   │
│   [ Book a service ]        [ Refresh ]           │
└───────────────────────────────────────────────────┘
```

Moving — one line, nothing to tap:

```
┌ Bolero · MH12AB1001 ─────────────────────────────┐
│ Water pump service needed within 5 days.          │
│   I'll call you about it.                         │
│   Booking opens when you park.                    │
└───────────────────────────────────────────────────┘
```

Booking is **Book a service → pick a time → done**: a list of up to three times (day, time, service
centre), then a confirmation. An owner with more than one car also gets **Change car**.

The words are the phone's and the web's (`@autosaarthi/core`: "Urgent", "Repair now", "If it fails on
the road"), chosen in TypeScript and drawn by the native side.

### Who decides what is safe

Not the app. The server reads the car's own telemetry and says what state the car is in and what a
screen may offer ([`backend/app/car.py`](../backend/app/car.py), rules G6 and G7 in
[`config/agent_policy.yaml`](../config/agent_policy.yaml)). The car screen only shows what it is told:

| The server says | The car screen shows |
|---|---|
| **Parked** (`allowed.touch`) | The whole card. **Book a service** when times are on offer; **Refresh**, or **Change car**. |
| **Stopped briefly** | One line — "Water pump needs service within 5 days · Details when you park." No buttons. |
| **Driving** — including *no reading*, a *reading more than two minutes old* and a car that reports parked while moving, which the server all counts as moving | One line, as above. No buttons. No times (the server does not even send them). |

On top of that:

* a booking is checked again on the server, which refuses it unless the car is parked;
* every tap that books is marked **parked-only**, so the car's own host refuses it while the car moves too;
* if the server stops allowing touch while the driver is in the booking flow, the app closes it at the
  next ten-second refresh;
* after three failed refreshes in a row the car stops showing what it last knew and says there is no
  connection: a "Book" button that may be out of date is worse than none;
* a brief stop looks exactly like driving, so a car that stops at every traffic light does not change its screen at
  every light.

## How it works

```
Android Auto ──binds──▶ AutoSaarthiCarService ──▶ Session ──▶ ModelScreen ─ draws ─▶ the car
 (on the phone)          (the door)                              ▲   │ taps
                                                                 │   ▼
                                                              CarBridge  ◀── events ──  Expo module
                                                           (what to show)  ── screens ─▶     │
                                                                                              ▼
                                                  the app's JavaScript:  CarController ── shared API client ──▶ server
                                                  (src/car/controller.ts)   (src/lib/shared.ts)
```

* **The JavaScript owns the session, the data and the words.** It sends whole screens to the car
  (`root`, `push`, `update`, `pop`) as small JSON documents ([`model.ts`](../mobile/src/car/model.ts) ↔
  [`CarModel.kt`](../mobile/modules/autosaarthi-car/android/src/main/java/expo/modules/autosaarthicar/CarModel.kt)).
  The native side draws them as `Pane`, `List` and `Message` templates and reports taps; it decides nothing.
* **One API client.** The phone's screens and the car's controller share one client
  ([`shared.ts`](../mobile/src/lib/shared.ts)). The refresh token rotates every time it is used, so two clients
  renewing from the same stored token would look to the server like a replayed, stolen token.
* **The app does not have to be open.** Android Auto can bind to the app while the phone is in a pocket and the
  app was never opened. The native bridge then starts the React host, which runs the bundle's entry
  ([`index.ts`](../mobile/index.ts) → [`src/car/entry.ts`](../mobile/src/car/entry.ts)); that attaches the
  controller, which signs in from the stored session. If no first screen arrives within 15 seconds the car says
  **"AutoSaarthi could not start. Open the app on your phone, then try again."** with a **Try again** button.
* **Nothing is kept past a connection.** When the car disconnects the native side forgets every screen; the next
  drive starts from a spinner and the JavaScript sends them again.
* **Owners only**, like the phone app: a staff account sees "AutoSaarthi in the car is for vehicle owners".
* **Signed out or offline** are screens, not failures: "Open AutoSaarthi on your phone and sign in" (the car
  notices the moment the owner does) and "No connection right now" with **Try again**.

### The template limit — the rule that shapes how the screens change

Android Auto lets an app show **at most five templates in a task and closes the app, with an error on the car's
screen, when a sixth is sent** (the `Screen.onGetTemplate` documentation). A change that the host calls a *refresh*
does not count; anything else does. For a pane or a list, a refresh keeps the **title, the number of rows and each
row's title** — the lines of text under a title may change — or follows a template that was loading. For a message,
it keeps the title and the words. A different kind of template is never a refresh.

A car screen that changes with the car — parked, moving, a new reading, a booking — would use up five templates
within a few traffic lights if it were simply redrawn. So:

* **Words that change as the car does are the text under a title**, not the title: "About 5 days of driving left"
  is a second line, "Your water pump is wearing out" is the row's title.
* **Whether a change is a refresh is decided in one place** — [`Refresh.kt`](../mobile/modules/autosaarthi-car/android/src/main/java/expo/modules/autosaarthicar/Refresh.kt),
  read a little more strictly than the documentation — and the bridge acts on it. A refresh is drawn in place. Anything
  else is made by putting a **new screen** where the old one was and removing the old one, so a screen has only ever
  sent one template that counts, however many times the car parks and moves.
* **Loading is a pane**, because a pane that follows a loading pane is a refresh: the first card arrives free.
* **The booking is one pane of its own** (a spinner, then the result in the same pane), so the whole flow is three
  templates: the card, the times, the booking.
* **Only the screen being looked at is ever changed.** While a flow is open the card underneath is left alone and
  drawn again when the flow closes. A screen that comes back after a back press must answer with the kind of
  template it last sent, or the host errors; if its kind changed meanwhile it answers as before and is then replaced.

`CarBridgeTest` holds this: forty alternating parked/moving changes leave one screen that has sent one counting
template, and the whole booking flow, card included, adds up to three.

### Files

| File | What it is |
|---|---|
| `mobile/modules/autosaarthi-car/android/src/main/AndroidManifest.xml` | declares the car service (category `IOT`), `minCarApiLevel` 6 and the template descriptor; merged into the app |
| `…/res/xml/automotive_app_desc.xml` | tells Android Auto the app draws with templates |
| `…/AutoSaarthiCarService.kt` | the door; accepts only Google's car hosts in a release build, any host in a debug one |
| `…/AutoSaarthiCarSession.kt`, `ModelScreen.kt` | one connection to a car; one screen on it |
| `…/CarBridge.kt` | what is shown, the open screens, events to and from JavaScript, and starting the app's JavaScript |
| `…/CarModel.kt`, `TemplateBuilder.kt` | the JSON screen model and its translation into car templates |
| `…/Refresh.kt` | which changes the host counts against its five-template limit |
| `…/AutoSaarthiCarModule.kt` | the Expo module the JavaScript calls |
| `mobile/src/car/view.ts` | the screens, from what the server said (pure functions) |
| `mobile/src/car/controller.ts` | the session: sign-in, loading, polling, taps, booking |
| `mobile/src/car/entry.ts`, `mobile/index.ts` | start the controller when the JavaScript loads |

## Testing

### Automated

```powershell
# the native module: JVM tests, with the Car App Library's own test host standing in for Android Auto
cd mobile\android
.\gradlew.bat :autosaarthi-car:testDebugUnitTest

# the TypeScript: view, controller (with a fake car and a fake server), shared client
cd mobile
npx jest
```

The Kotlin tests build every template through the real library, which checks its own rules as it builds (how
many buttons, which kinds, how many rows), so a screen that builds there is one a host accepts. They also
check the manifest as Android Auto reads it, and the host validator in both debug and release.

### What has been run on a device

On an Android 15 emulator (no Google Play, so no Android Auto), with the real debug build:

* the app builds with the module linked (`gradlew :app:assembleDebug`) and the built APK's manifest carries the car
  service in the `IOT` category, `minCarApiLevel` 6 and the template descriptor (`aapt2 dump xmltree`);
* Android's package manager lists the service for `androidx.car.app.CarAppService` / `androidx.car.app.category.IOT`
  (`adb shell cmd package query-services`);
* the app bundles from the new entry file (`index.ts`, 1,721 modules), starts, and shows its sign-in screen;
* the car controller starts **before** the app's first screen mounts and the native module answers it — the log reads
  `[car] ready, car connected: false`, then `Running "main"`. That ordering is what lets a car connection with the app
  closed work: the JavaScript it needs is already attached when it starts.

What an emulator cannot do is be a car: no Android Auto host binds to the service, so no template has been drawn by a
real host.

### On a car screen: the Desktop Head Unit

Google's Desktop Head Unit (DHU) is a car's screen on your computer. Nothing below has been run yet.

1. **Install the DHU.** Android Studio → SDK Manager → *SDK Tools* → *Android Auto Desktop Head Unit
   Emulator*. It lands in `<sdk>\extras\google\auto` (here: `C:\Users\<you>\AppData\Local\Android\Sdk\extras\google\auto`).
2. **Phone.** Install **Android Auto** from Google Play. In Android Auto's settings tap *Version and permission
   info* ten times and accept the prompt to turn on developer mode; then, from the three-dot menu, choose
   **Start head unit server**.
3. **Install and start AutoSaarthi** on the phone as a development build ([running.md](running.md#the-development-build-needed-for-a-real-phone)),
   with the backend and Metro running, and **sign in once** as `ramesh.pawar@example.in` / `autosaarthi`.
4. **Connect.** USB cable, then:
   ```powershell
   adb forward tcp:5277 tcp:5277
   & "$env:LOCALAPPDATA\Android\Sdk\extras\google\auto\desktop-head-unit.exe"
   ```
5. **Open AutoSaarthi** from the DHU's app launcher. You should see "Checking your car…" and then the card.

### Making the car park and drive (demo)

The drive state is the server's, read from the car's latest telemetry. With `DEMO_MODE=1` an administrator can
change what the car *reports*:

1. In the web console, sign in as `admin@autosaarthi.io` and open **In-Car Console**.
2. Pick the vehicle **MH12AB1001** (Ramesh Pawar's), then **Parked**, **Stopped briefly** or **Driving**.
3. The car screen follows within ten seconds (or tap **Refresh**).

A reading older than **two minutes counts as no reading, and the server then treats the car as moving** — so a
"Parked" you set by hand drops back to the one-line screen after two minutes unless the car keeps reporting.
Press **Parked** again to refresh it.

## What is not done

Said plainly:

* **It has not run on Android Auto.** This machine has an Android 15 emulator *without* Google Play, which cannot run
  Android Auto, and no Desktop Head Unit installed. Everything up to the host — the templates, the manifest, the
  host check, the bridge, the controller, the bundle, the app starting on a device — is built and tested; what the
  host then does with the templates is the part still to be seen. If a screen looks wrong on the DHU, that is the
  first thing to fix.
* **The five-template limit is built to the documentation, not observed.** `Refresh.kt` follows what the
  template classes' documentation says counts as a refresh. A real host may count differently; if the DHU closes the
  app with a template-limit error after a few changes, that is where to look.
* **Starting the app's JavaScript from the car with the app closed** (the React host started by the bridge) is the
  least certain part, because it cannot be reproduced in a JVM test. It has a time-out and a retry button for
  that reason. Test it on the DHU with the app *swiped away* before connecting.
* **Google Play.** A car-app category needs Google's review against its quality guidelines for that category
  (IOT here), and, per Google's testing guide, a template app on a real car has to be installed from Google Play
  (an internal test track is enough); a sideloaded build works on the DHU, not in a car. None of that has been
  applied for.
* **The release host list** is the library's own sample list (`hosts_allowlist_sample`), which holds Google's Android
  Auto and Automotive hosts. Check it against Google's current list before publishing.
* **No notifications to the car**, no voice, and English only (the phone app is English only too).
* **A debug build accepts any host**, which is what lets the DHU in. Never ship a debuggable build.

## Troubleshooting

| What you see | What it means | What to do |
|---|---|---|
| AutoSaarthi is not in the DHU's launcher | The car service is not installed, or Android Auto has not re-read the app list | `adb shell pm list packages io.autosaarthi.owner`; reinstall the debug build; stop and start the head unit server |
| "AutoSaarthi could not start" | The app's JavaScript did not answer in 15 seconds — Metro not reachable (debug build), or the app crashed on start | `adb logcat -s AutoSaarthiCar ReactNative`; check Metro and `EXPO_PUBLIC_API_URL`; tap **Try again** |
| "Open AutoSaarthi on your phone and sign in" | No session on the phone | Sign in on the phone; the car updates by itself within five seconds |
| One line and no buttons although the car is parked | The server counts the car as moving: no reading, or one older than two minutes | In the web console's In-Car Console, press **Parked** again; its "What the server decided" box says why |
| "No connection right now" | Three refreshes in a row failed | Check the phone's connection to the backend; it recovers by itself |
| "AutoSaarthi in the car is for vehicle owners" | A staff account is signed in on the phone | Sign in with an owner account |

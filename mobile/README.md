# AutoSaarthi — the owner's phone app

Expo SDK 58 (React Native 0.88, React 19), TypeScript, Expo Router. Android first; iOS builds
from the same code but is not a target yet. The car screen (Android Auto) is Phase 5.

What it does, for a vehicle owner:

| Screen | What it shows |
|---|---|
| Sign in | email + password, or a code sent by SMS (when the server has it on), then the second factor if the account has one |
| My car | one sentence: quiet when healthy; what is wearing, how long is left and what each choice costs; the booking |
| Why this part? | the model's confidence, the reading that shows the wear (engine-running readings only), trouble codes |
| Book | open slots in the car's city; book, move or cancel — one booking per car, moved in one step |
| Agent | the same conversation as the web owner app and the console (`/api/chat/*`), resumed where it left off |
| History | every service visit |
| Account | who is signed in, whether notifications reach this phone, sign out (everywhere) |

Dark mode follows the phone. Everything is reachable with TalkBack, tap targets are at least 48 pt,
and text scales with the phone's font size (capped at 1.8×).

## How it holds a session

The refresh token comes back in the response body (`X-Client: mobile`) and is kept in the Android
Keystore / iOS Keychain via `expo-secure-store`; the access token lives only in memory. An expired
access token is renewed once however many requests find it expired, and only a refresh the
server *refuses* ends the session — no signal is "offline", not "signed out". See
`src/lib/api.ts` and `docs/authentication.md` ("The mobile app").

The browser preview has no secure storage, so it keeps the session in memory: a reload signs it out.

## Run it

The backend must be running (`:8010`).

```bash
npm install
npx expo start --port 8081        # then open http://localhost:8081 for the browser preview
```

The browser preview calls `/api` on its own origin and the development server forwards it to the
backend (`metro.config.js`), so it needs no CORS change.

**Android emulator.** `10.0.2.2` is the computer from inside the emulator, which is the default
(`src/lib/config.ts`). Expo Go runs everything except push notifications; push needs a
development build (`npx expo run:android`, which needs `ANDROID_HOME` pointing at the Android SDK).

**A phone on the network.** Start the backend on `0.0.0.0` and set
`EXPO_PUBLIC_API_URL=http://<computer's IP>:8010`. Outside development it must be `https`.

### Push notifications

The app registers its Expo push token with the backend (`POST /api/me/devices`) after sign-in —
only on a real device or development build, with the owner's permission, and when an EAS project
id is configured (`app.json` → `expo.extra.eas.projectId`, created by `npx eas-cli init`). The
backend sends through Expo when `PUSH_PROVIDER=expo`; Expo needs the app's FCM credentials uploaded
to the project. Until all that exists the app simply does not register, and Account says so.

A tapped notification opens one of the app's own screens (`autosaarthi://book`, `agent`,
`evidence`, `history`), or Home — never a URL from the payload.

## Test

```bash
npm test            # Jest (jest-expo) + React Native Testing Library 14
npm run typecheck
npm run lint
```

Screen tests render inside the real session provider and API client, with only the network
replaced by a fake server (`src/test/harness.tsx`), so they exercise the same sign-in, refresh and
error handling the app runs. Fixtures follow the server's real responses — a fixture with a field
the server never sends once let a test pass while the screen showed nothing.

## Layout

```
src/app/            routes (Expo Router) — thin files that re-export screens
src/screens/        the screens and their tests
src/components/     ui.tsx (Txt, Button, Card, Field, Notice…), car.tsx, OfflineBanner
src/lib/            api.ts (session + requests), session.tsx, garage.tsx (the car), push.ts
src/theme/          colours, type scale and radii from packages/tokens
```

Formatting (dates, rupees, "1 day"), sensor names and part names come from `packages/core`, shared
with the web app; colours and type from `packages/tokens`. Both are linked from `../packages`, so
this app keeps its own `node_modules` (React 19) apart from the web app's (React 18).

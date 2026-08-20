# Firestore data model — NBE Youth / Acsend

One document per user holds everything a screen needs at load. Lists that grow
live in sub-collections. This keeps a cold start to **one document read**, which
matters on the Spark (free) plan.

```
users/{uid}                              ← single doc, read once on sign-in
users/{uid}/goals/{goalId}               ← sub-collection
users/{uid}/holdings/{holdingId}         ← sub-collection
catalogue/certificates/items/{productId} ← shared, read-only to clients
catalogue/funds/items/{productId}        ← shared, read-only to clients
```

---

## `users/{uid}`

| Field | Type | Notes |
|---|---|---|
| `displayName` | string | From sign-up, shown on Home |
| `email` | string | Mirrors the auth record |
| `initials` | string | 2 chars for the avatar circle |
| `createdAt` | timestamp | `serverTimestamp()` |
| `flags` | map | Where the user is in the app — see below |
| `prefs` | map | Settings screen writes here |
| `limits` | map | Investment cap for the current cycle |
| `stats` | map | Points, level, streak |

### `flags` — routing and progress

| Field | Type | Drives |
|---|---|---|
| `onboardingComplete` | bool | `false` → land on the onboarding carousel instead of Home |
| `firstGoalSet` | bool | `false` → onboarding hands off to the goal sheet |
| `hasSubscribed` | bool | `true` after the first certificate or fund is added |
| `funnelStage` | string | One of `curious`, `understands`, `account_opened`, `first_subscription`, `recurring`, `limit_raised`. Fed to Acsend's `{{funnel_stage}}` slot |
| `toursSeen` | map of bool | Keys `home`, `invest`, `learn`, `goals`, `rewards`. Each first-open walkthrough writes its key here so it never repeats — including on a new device |

### `prefs` — Settings screen

| Field | Type | Default |
|---|---|---|
| `darkMode` | bool | `true` |
| `language` | `"en"` \| `"ar"` | `"en"` |
| `faceId` | bool | `false` |
| `reduceMotion` | bool | `false` |
| `notifications.reminders` | bool | `true` |
| `notifications.certs` | bool | `true` |
| `notifications.growth` | bool | `true` |

### `limits`

| Field | Type | Notes |
|---|---|---|
| `remaining` | number | EGP still committable this cycle. Decremented on each subscription |
| `cycleCap` | number | What the cycle started at |
| `resetDate` | string | ISO date. Fed to Acsend's `{{reset_date}}` slot |

### `stats`

`points` (number), `level` (number), `streakDays` (number).

---

## `users/{uid}/goals/{goalId}`

| Field | Type |
|---|---|
| `name` | string |
| `budget` | string (as typed, e.g. `"EGP 30,000"`) |
| `start` / `end` | string, ISO date |
| `type` | `"user"` \| `"builtin"` |
| `builtinIndex` | number, only when `type === "builtin"` |
| `pct` | number, 0–100 |
| `createdAt` | timestamp |

## `users/{uid}/holdings/{holdingId}`

Written when a subscription completes. This is what `{{holdings}}` is built from.

| Field | Type | Notes |
|---|---|---|
| `kind` | `"certificate"` \| `"fund"` | |
| `productName` | string | e.g. `"Premium Certificate"` |
| `amount` | number | EGP committed |
| `rate` | number | Contractual % for certificates; historical average for funds |
| `term` | string | e.g. `"1 Year"` or `"Daily Access"` |
| `status` | `"active"` \| `"pending"` \| `"matured"` | |
| `purchasedAt` | string, ISO date | |
| `maturesAt` | string, ISO date | Certificates only |

> Rates are **copied onto the holding at purchase time**, not referenced. A
> certificate's rate is fixed at subscription, so later catalogue repricing must
> not retroactively change what an existing holding shows.

---

## Security rules

Paste into **Firestore → Rules**. Each user reads and writes only their own tree;
the catalogue is read-only from the client.

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    match /users/{uid} {
      allow read, update, delete: if request.auth != null && request.auth.uid == uid;
      allow create: if request.auth != null && request.auth.uid == uid;

      match /{sub=**} {
        allow read, write: if request.auth != null && request.auth.uid == uid;
      }
    }

    match /catalogue/{document=**} {
      allow read: if request.auth != null;
      allow write: if false;          // seed from the console or a server SDK
    }
  }
}
```

Client writes are not trustworthy — `limits.remaining` can be edited by anyone
who can call Firestore as themselves. For a demo that is fine. Before this holds
real money, move subscription writes behind a Cloud Function that recalculates
the limit server-side and rejects anything over it.

---

## Console setup

1. Create the project, then **Build → Authentication → Sign-in method → Email/Password → Enable**.
2. **Build → Firestore Database → Create database** → production mode, region `eur3` or `nam5`.
3. Paste the rules above.
4. **Project settings → General → Your apps → Web** → register, copy the config
   into `.env` (six `VITE_FIREBASE_*` values).
5. Restart the dev server — Vite reads `.env` only at boot.

With those six values blank the app still runs: auth and storage fall back to
`localStorage` so the demo works with no backend at all.

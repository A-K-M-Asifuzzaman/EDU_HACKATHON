# Accounts and roles with Firebase Authentication (V4)

Public forecasting, model evidence, weather, the map and hospital routing never need an account. Accounts exist only for operational
work: officers review model alerts and draft response plans; administrators grant roles, approve plans and read the audit log.

## How it works

| Piece | Where | What it does |
|---|---|---|
| Sign-in | Firebase Authentication (browser SDK, `frontend/lib/firebase.ts`, `lib/auth.tsx`) | Email and password or Google; email verification; TOTP second factor; tab-scoped session |
| Token check | FastAPI (`dengueshield/api/auth.py`) | Verifies every Firebase ID token: RS256 signature against Google's published keys, audience = project, issuer, expiry, session no older than 8 hours |
| Roles | FastAPI + SQLite (`var/dengueshield_auth.db`, git-ignored) | reader (created at first sign-in) < officer < administrator; officer/admin need a verified email; admin needs the second-factor claim |
| Officer workflows | `dengueshield/api/ops.py` | Alert review (acknowledge, escalate, dismiss, resolve), generic response plans; admin approves, never their own plan |
| Audit | same database | Account creation, sign-ins, role grants, activation changes, alert reviews, plan drafts and approvals |

DengueShield never receives a password. There are no default accounts. The SMS/AppLink module was removed from the roadmap and does not exist.

## Switching it on (owner, about 15 minutes)

1. Create a Firebase project (https://console.firebase.google.com). Add a **Web app** and copy its config.
2. Build > Authentication: click **Get started** once (until then every sign-in fails with `auth/configuration-not-found`), then
   Sign-in method: enable **Email/Password** and **Google**.
3. Authentication > Settings > Authorized domains: add `localhost`, `127.0.0.1` and the deployed frontend domain.
4. Administrator MFA: in Authentication settings enable **multi-factor authentication** with **TOTP** (this needs Firebase Authentication
   with Identity Platform; check its pricing before upgrading; there is a free tier). Without TOTP enabled, nobody can open administration,
   which is the safe default.
5. Frontend: put the web config in `frontend/.env.local` (see `frontend/.env.example`):
   `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID`,
   then rebuild (`npm run build`). The web config is public by design.
6. Server: set `FIREBASE_PROJECT_ID` (same project ID) in `.env` and restart the API.
7. First administrator: `.venv/bin/python -m dengueshield.api.auth grant --email you@example.org --role admin`. Sign in with that
   email, verify it, open Administration and add an authenticator app when asked, then sign in again with the code.
8. Officers: an administrator gives the role by email (Administration > Give someone a role). It applies at their next request, once
   their email is verified.

## Security properties (tested in `tests/test_auth.py`)

- Every protected endpoint uses one dependency, `require(role)`: 401 without a valid token, 403 below the role, inactive, unverified email
  for elevated roles, or (admin) without the second factor.
- Tokens are sent as `Authorization: Bearer`, never stored in cookies or local storage by our code (Firebase keeps its own session in
  tab-scoped storage), so cross-site request forgery does not apply.
- Sessions end on tab close, after 60 idle minutes (officers and admins, in the browser) and after 8 hours (enforced by the server).
- Deactivation and role changes take effect on the next request; administrators cannot change their own role or status.
- Writes are limited to 60 per minute per account. Responses never contain tokens, password hashes or secrets.
- Without `FIREBASE_PROJECT_ID`, protected routes answer 503 and the public site is unaffected.

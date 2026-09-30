# Deploying beyond your own machine

Everything in `README.md`'s "Running locally" section is tuned for a
zero-friction demo: no login, wide-open CORS, no secrets to manage. That's
the right default for trying the project out, and the wrong default for
anything reachable by the public internet. This page is the checklist for
the difference.

The backend itself checks the two most dangerous defaults (auth mode and
CORS) at startup and logs a loud warning if either is still demo-safe
rather than production-safe — if you skip this page, you won't get far
without noticing.

## Render (backend) + Vercel (frontend)

**Vercel can't host the backend as built.** Its Python functions are
stateless serverless — read-only filesystem, no persistent SQLite, and no
support for this backend's continuous background weather-polling task or
its multiprocess forecasting worker pool. Vercel is a great fit for the
frontend (a static Vite build); the backend needs a platform that runs it
as a real, persistent process. Render's free tier does that and deploys
straight from the existing `backend/Dockerfile`.

### Backend on Render

1. **New → Web Service**, connect this repo, set **Root Directory** to
   `backend` and **Environment** to `Docker` (it picks up the `Dockerfile`
   automatically — no build/start command to fill in).
2. **Add a persistent disk**: mount path `/app/app/data/generated`, 1 GB is
   plenty. Without this, the generated dataset and the SQLite ledger
   (transfers, crisis log, audit trail) reset on every deploy and every
   free-tier spin-down.
   - Render's disk mounts **empty** on first deploy, which would otherwise
     hide everything the Dockerfile generated at build time — the
     Dockerfile's `CMD` already accounts for this (regenerates the dataset
     at boot if the disk is empty), so this just works.
3. **Environment variables** (Render's dashboard, not committed anywhere):
   `GEMINI_API_KEY`, `AUTH_MODE=token`, `JWT_SECRET`, `DEMO_USER_PASSWORD` —
   see §1 below for what these do and how to generate them. Leave
   `CORS_ORIGINS` for step 3 below, once the frontend has a URL.
4. Deploy, then copy the service's public URL
   (`https://<something>.onrender.com`).
5. **Free-tier note**: the service sleeps after inactivity; the first
   request after that takes ~30-60s to wake it. If a judge might load a
   cold instance during a demo, open the app yourself a minute beforehand.

### Frontend on Vercel

1. **New Project**, import this repo, set **Root Directory** to `frontend`.
   Vercel auto-detects Vite — no framework config needed.
2. Add the environment variable `VITE_API_URL` = your Render backend's
   public URL (from step 4 above), with `https://` and no trailing slash.
   It's baked in at build time, not read at runtime, so changing it later
   means a redeploy.
3. `frontend/vercel.json` (already in the repo) rewrites every path to
   `index.html` — required for this app's client-side routing
   (`react-router-dom`'s `BrowserRouter`); without it, refreshing on
   anything but `/` 404s on Vercel.
4. Deploy, then copy the frontend's URL
   (`https://<something>.vercel.app`).

### Close the loop: lock down CORS

Back in Render's dashboard, set `CORS_ORIGINS=["https://<your-app>.vercel.app"]`
(include any custom domain too, once you have one) and let it redeploy.
Until this step, the backend still accepts requests from any origin — fine
transiently while wiring things up, not the state to leave it in.

## 1. Turn on real authentication

Demo mode (`AUTH_MODE=demo`, the default) has **no authentication at all**
on any console route — `services/auth.py`'s own docstring calls it "fine
for a demo, unsafe anywhere real." Anyone who can reach the backend can set
an `X-User-Id: national_admin` header, no password, and act as the
top-level admin: trigger a crisis, execute a transfer, or wipe the entire
dataset via `/api/crisis/reset`.

Set:

```bash
AUTH_MODE=token
JWT_SECRET=$(python -c "import secrets; print(secrets.token_urlsafe(48))")
```

Leaving `JWT_SECRET` unset doesn't fail closed — the backend generates an
ephemeral one instead, so it still runs, but every session is silently
signed out on the next restart. Set it explicitly so restarts don't
surprise anyone mid-session.

### Set real per-user passwords

`DEMO_USER_PASSWORD` (in `.env`) only seeds the *first* password for every
demo account, all sharing the one value — fine to get started, not what you
want for real distinct operators. Once the container's up, set real,
distinct passwords per account by running `manage_users.py` inside it —
Render's dashboard has a **Shell** tab that opens a terminal straight into
the running service; `docker compose exec` is the equivalent locally:

```bash
python -m app.scripts.manage_users list
python -m app.scripts.manage_users set-password national_admin
python -m app.scripts.manage_users set-password state_coordinator_mh
# ...repeat per account, or deactivate ones you don't need:
python -m app.scripts.manage_users deactivate phc_operator_128
```

A deactivated account is refused at login and loses any existing session
immediately.

## 2. Lock down CORS

`CORS_ORIGINS` defaults to `["*"]` — any website can call this API from a
browser. Set it to your deployed frontend's exact origin(s), as a JSON
array with no trailing slash:

```bash
CORS_ORIGINS=["https://setuhealth.example.org"]
```

(The backend never sets cookies — every request authenticates via a header,
`Authorization: Bearer` or `X-User-Id` — so this alone is enough; there's no
separate credentials flag to also configure.)

## 3. Put it behind HTTPS

Neither the FastAPI backend nor the nginx container in `frontend/Dockerfile`
terminates TLS — that's expected for containers meant to sit behind a
reverse proxy or a platform's own load balancer (nginx, Caddy, Cloudflare,
your cloud provider's ingress, etc.), not a gap to patch in the app itself.
Terminate HTTPS there, and make sure `VITE_API_URL` (baked into the frontend
at build time — see `docker-compose.yml`) points at the backend's public
`https://` URL, not `http://localhost:8000`.

## 4. Rotate any secret that was ever typed into a chat, ticket or log

If a `GEMINI_API_KEY` (or anything else in `.env`) was ever pasted into a
chat window, an issue, or shown in a log during setup, treat it as
compromised and issue a fresh one from
[Google AI Studio](https://aistudio.google.com/apikey) before going live —
regardless of whether anything has gone wrong with it yet.

## 5. Know what jurisdiction scoping is (and isn't)

The frontend gives each role (`phc_operator`, `state_coordinator`,
`national_admin`) a scoped navigation experience and disables actions
outside their jurisdiction — see `frontend/src/lib/AuthContext.tsx`. This is
a workflow boundary, not a security one: the backend's read endpoints
aren't filtered by role, so a signed-in user hitting the API directly (not
through the UI) still gets full national data. The one place jurisdiction
*is* enforced server-side is transfer execution
(`services/auth.py::authorize_transfer`). If read-level data isolation
between states/facilities matters for your deployment, that's separate,
larger backend work — ask before assuming it's covered.

## 6. Quick checklist

- [ ] `AUTH_MODE=token`
- [ ] `JWT_SECRET` set to a real random value
- [ ] Real per-user passwords set via `manage_users.py`; unused demo
      accounts deactivated
- [ ] `CORS_ORIGINS` set to your real frontend origin(s)
- [ ] HTTPS terminated in front of both containers
- [ ] `VITE_API_URL` points at the backend's public HTTPS URL
- [ ] Any secret pasted into a chat/log/ticket during setup has been rotated
- [ ] Backend startup logs show no `AUTH_MODE=demo` or `CORS_ORIGINS` warning

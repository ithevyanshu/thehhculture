# Deploying DHH/CULTURE

| Part | Host | URL |
|---|---|---|
| Frontend (React) | Vercel | `https://dhhculture.in` (+ `www`) |
| Backend (API) | Railway, US East region | `https://api.dhhculture.in` |
| Database | Neon (existing) | - |
| DNS | GoDaddy | - |

The frontend and API share the `dhhculture.in` domain, so the login cookie is first-party and works in every browser.

## 0. Before you start

1. **Rotate secrets.** The Neon password was shared in chat during development. In Neon → *Roles* → reset the `neondb_owner` password and use the new connection strings below.
2. Generate a fresh JWT secret for production (keep it private):

   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

## 1. Push the code to GitHub

```bash
cd D:\ProjectDHH
git add -A
git commit -m "DHH/CULTURE initial release"
git push -u origin main
```

`.env` files are git-ignored, so no secrets are uploaded.

## 2. Backend on Railway

1. Go to https://railway.com, sign in with GitHub, click **New Project → Deploy from GitHub repo**, and pick the repo.
2. Open the service → **Settings**:
   - **Root Directory:** `backend`
   - **Region:** US East (closest to Neon's `us-east-2`)
   - Build and start commands come from `backend/railway.json` (`npm run build` / `npm run start:prod`, which runs DB migrations first). Health check: `/health`.
3. **Variables** tab → add:

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | Neon **unpooled** URL (no `-pooler` in the host), the same value as `DIRECT_URL`. See the note below. |
   | `DIRECT_URL` | Same URL **without** `-pooler` in the host |
   | `NODE_ENV` | `production` |
   | `JWT_ACCESS_SECRET` | the secret from step 0 |
   | `CORS_ORIGINS` | `https://dhhculture.in,https://www.dhhculture.in` |
   | `COOKIE_SECURE` | `true` |
   | `ACCESS_TOKEN_TTL` | `15m` |
   | `REFRESH_TOKEN_TTL_DAYS` | `30` |

   (Don't add `pgbouncer=true` or `channel_binding=require` to the URLs. `PORT` is set by Railway automatically.)

   **Why unpooled:** Neon's pooled endpoint shares Postgres sessions between clients, and those sessions cache query plans. After a migration that changes a column's type, queries touching that column fail with `cached plan must not change result type` until the sessions recycle — retries and restarts don't help, because the pooler hands back the same sessions. The unpooled endpoint has none of that, and one long-lived backend uses only a handful of connections. If you ever do switch back to the pooled URL and see that error, restart the Neon compute to clear every session at once.
4. Deploy. Test the generated URL: `https://<something>.up.railway.app/health` should return `{"status":"ok"}`.
5. **Settings → Networking → Custom Domain** → enter `api.dhhculture.in`. Railway shows a **CNAME** target (and sometimes a **TXT** verification record). Keep this tab open for step 4.

## 3. Frontend on Vercel

1. Go to https://vercel.com, sign in with GitHub, click **Add New → Project**, and import the same repo.
2. **Root Directory:** `frontend` (Vercel detects Vite; `frontend/vercel.json` adds the SPA fallback so page refreshes on `/artists/...` work).
3. **Environment Variables:**

   | Name | Value |
   |---|---|
   | `VITE_API_URL` | `https://api.dhhculture.in/api/v1` |

4. Deploy.
5. **Settings → Domains** → add `dhhculture.in` and `www.dhhculture.in` (set one to redirect to the other). Vercel shows the DNS records to create.

## 4. DNS at GoDaddy

GoDaddy → **My Products → dhhculture.in → DNS → Manage DNS**. Add or edit the records **exactly as Vercel and Railway show them**. They usually look like this:

| Type | Name | Value | Purpose |
|---|---|---|---|
| A | `@` | `76.76.21.21` (use Vercel's value) | dhhculture.in → Vercel |
| CNAME | `www` | `cname.vercel-dns.com` (use Vercel's value) | www → Vercel |
| CNAME | `api` | `xxxx.up.railway.app` (from Railway) | API → Railway |
| TXT | (as shown) | (as shown) | Railway verification, if asked |

- Delete GoDaddy's default **A record for `@`** ("Parked") and any existing `www` CNAME, or they'll conflict.
- DNS usually applies within minutes, but can take up to a few hours. Vercel and Railway issue HTTPS certificates automatically once the records resolve.

## 5. After it's live

1. Open `https://api.dhhculture.in/health` → `{"status":"ok"}`.
2. Open `https://dhhculture.in`, log in with your admin account, and check the admin panel.
3. Reload a deep link like `https://dhhculture.in/artists/divine`: it should load, not 404.
4. Log in, then reload the page: you should stay logged in (this confirms cookies work).

## Updating the site later

Push to `main` and both Vercel and Railway redeploy automatically. Schema changes are applied on the API's next start (`prisma migrate deploy`).

## Notes

- Run **one** Railway replica. The click de-duplication and settings cache are in memory.
- Handy one-off commands can be run from Railway's service shell (or locally against the production `.env`), e.g. `npm run images:fetch`, `npm run socials:fetch`, `npm run shows:seed`.
- The demo account is created only when seeding outside production **and** `DEMO_PASSWORD` is set. Your live database already has one from development, with a password that used to be printed in the README: **disable `demo` in Admin → Users.** Treat that password as public.

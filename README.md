# DHH/CULTURE

A home for the Indian hip hop scene: artist pages, a full song catalog, playlists, and a home screen personalized to each listener.

```
ProjectDHH/
├── backend/    Express 5 + TypeScript + Prisma + PostgreSQL - standalone REST API (/api/v1)
├── frontend/   React 19 + Vite + Tailwind v4 - talks to the API over HTTP only
└── docs/       API reference and expansion roadmap
```

The two apps share no code. The backend is a plain JSON API that any client can use: this web app, a future mobile app, or another service. See [docs/API.md](docs/API.md).

## Features

- **Artists**: browse by sound (gully rap, boom bap, drill…) and city. Each artist page has stats, popular songs, discography, features, similar artists, and a full paginated catalog.
- **Songs**: a filterable catalog (genre, city, year, sort), song pages with Spotify/YouTube embeds (search links when no ID is set), "more from" and "similar sound" lists.
- **Auth**: email/username + password (bcrypt), short-lived JWT access tokens, and rotating refresh tokens with reuse detection. Refresh tokens are httpOnly cookies for browsers, or JSON tokens for other clients (`X-Auth-Mode: token`).
- **Personalized home**, built from:
  - followed artists (new releases, hero spotlight)
  - favourite genres and cities (picked during onboarding, editable in settings)
  - liked songs and playlists ("Made for you")
  - recently viewed artists and songs ("Jump back in")
- **Library**: liked songs, followed artists, playlists (public/private), recently viewed.
- **Admin panel**: CRUD for artists, albums, songs, genres and cities. Paste a Spotify or YouTube link and the ID is extracted automatically.
- **Artist photos from Wikipedia**:
  - "Find on Wikipedia" in the artist form shows photo candidates; you can search by name or paste an article URL.
  - "Fetch missing photos" (or `npm run images:fetch`) auto-matches every artist without a photo. It only accepts a page whose title matches the artist and whose description says musician.
  - The author and license credit from Wikimedia Commons is stored and shown on the artist page.
- **Instagram links**:
  - Shown as an `@handle` button on artist pages and an icon on artist cards.
  - Filled from Wikidata (official usernames only) with "Fetch Instagram" in Admin → Artists or `npm run socials:fetch`.
  - Artists missing from Wikidata can be added by hand; the field accepts `@handle` or a profile link.
- **Rap shows (Hustle, Legacy…)**:
  - Each show has seasons, and each season has a cast: winner, runner-up, finalists, contestants, featured artists (showcases like Red Bull 64 Bars, with their track), judges, guest judges and hosts.
  - Public Shows pages have podiums and panels, and a "Rap shows" block shows on the front page.
  - Artist pages get "As seen on" badges.
  - Admins manage it all in Admin → Shows. `npm run shows:seed` loads MTV Hustle S1–4 and Legacy S1.
- **@handles, producers & cities**:
  - Every artist has an `@handle`: their Instagram username when known, otherwise `@stage_name` (e.g. `@seedhe_maut`). It's editable in the artist form; leave it empty to go back to automatic.
  - An automatic `@stage_name` switches to the Instagram username once Instagram is added. A hand-edited handle is never overwritten.
  - In the song form, typing a name or handle suggests artists by `@handle`. Someone new can be added with `@stage_name` after a confirm step.
  - Producers get "Prod. @handle" credits and a "Produced" section on their page.
  - The artist form has "+ Add a new city" for places that aren't listed yet.
- **Front page control (Admin → Front page)**: changes go live on save. You can set:
  - the cover story carousel: artist features or news stories (headline, story, image link, "read more" link, tagged artists), each with a sticker and schedule, topped up to 3 with the latest drops, autoplaying (pauses on hover, off for reduced motion)
  - the section layout: reorder, hide, rename, and add curated song/artist sections
  - the chart: pinned and excluded songs
  - the "New drops" ticker: your picks (songs, artists, shows, text with any link) followed by the latest releases (count, last N days, genre and city filters), plus speed and colour
  - a site-wide announcement banner
  - the issue number: week of the year, or your own number that can count up by one every week

  Settings are validated JSON in the `SiteSetting` table, so new options don't need migrations.
- **Artist ranking by clicks**:
  - Profile opens are counted, with each visitor (account or IP) counted at most once per artist every 30 minutes.
  - The data drives the "Trending (7 days)" sort, the "Most viewed this week" front-page block, and top-artist stats in admin.
- **Suggestions ("Something missing?")**:
  - Signed-in users send missing artists or songs, corrections and ideas from a floating button, empty search results, the footer, or artist and song pages.
  - Admins triage them in Admin → Suggestions: set a status, reply, or delete.
  - Users see the status and replies in their suggestion box.
- **User management (Admin → Users)**:
  - Roles: user, sub-admin, admin. Disable accounts. Disabling or changing a role signs the user out everywhere, and the last active admin can't be removed.
  - **Sub-admins** only get the admin sections an admin ticks for them (front page, artists, albums, songs, shows, genres & cities, suggestions, users). Access is checked on every request, so changes apply immediately.
  - A sub-admin with "users" access can only disable or reset regular users; admins and sub-admins are managed by full admins.
  - **Password reset** generates a temporary password (shown once) and signs the user out; they must choose a new one at their next sign-in. Everyone can change their password in Settings.
- **Artist Studio (`/studio`)**:
  - An admin links one account to one artist profile (Admin → Studio). The account gets the `ARTIST` role and a Studio link.
  - Artists edit their profile (bio, photo, links, city, genres, @handle), add, edit and remove their own songs and releases, and post short updates. Verified, featured, slugs and Spotify IDs stay admin-only.
  - Stats: followers (7 and 30 days), profile views (30-day chart), likes and playlist adds per song.
  - Admins choose per kind of change (profile, releases, posts) whether it goes live immediately or waits in the review queue, where they see current and proposed values and approve or reject with a note. Every change is logged either way.
  - Posts show on the artist page ("Updates", with an "Official" tag on managed profiles) and in the "From the artists" home block.
- **Roles**: `USER`, `ARTIST`, `SUB_ADMIN`, `ADMIN`.

## Getting started

Prerequisites: Node 20+ and a PostgreSQL database. A free [Neon](https://neon.tech) or [Supabase](https://supabase.com) project works.

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env
```

Edit `backend/.env`:

- `DATABASE_URL`: your pooled connection string. For Neon don't add `pgbouncer=true`: its pooler supports prepared statements, and the flag makes every query ~5x slower. Drop `channel_binding=require` (Prisma doesn't need it).
- `DIRECT_URL`: the direct (non-pooled) connection string, used for migrations. If you only have one URL, use it for both.
- `JWT_ACCESS_SECRET`: a long random string: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- `ADMIN_EMAIL` / `ADMIN_PASSWORD`: your admin login, created by the seed

Then create the tables, load the starter catalog and start the API:

```bash
npm run db:deploy   # apply migrations
npm run db:seed     # genres, cities, starter artists/songs, admin + demo user
npm run dev         # http://localhost:4000/api/v1
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev         # http://localhost:5173 (proxies /api -> :4000)
```

Or, from the repo root, run both at once: `npm install && npm run dev`.

### Accounts after seeding

| Account | Login | Notes |
|---|---|---|
| Admin | your `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Opens `/admin` |
| Demo listener | `demo` / `demo12345` | Development only (not created when `NODE_ENV=production`). Already follows artists and has likes, so the personalized home has data. |

## Starter data

The seed loads **15 artists / 10 albums / 31 songs** so the app isn't empty on day one. Release dates and credits are best-effort starter data: **verify and extend them in the admin panel.** After seeding, run `npm run images:fetch` to pull artist photos from Wikipedia. Artists without a match (and all album/song artwork) fall back to generated gradients. Songs show "Listen on Spotify/YouTube" search links until you paste a track or video link.

## Useful scripts (backend)

| Script | What it does |
|---|---|
| `npm run dev` | API with hot reload (tsx) |
| `npm run build && npm start` | Production build / run |
| `npm run db:migrate` | Create a new migration after editing `prisma/schema.prisma` |
| `npm run db:deploy` | Apply migrations (CI/production) |
| `npm run db:seed` | Re-run the idempotent seed |
| `npm run db:studio` | Browse the database in Prisma Studio |
| `npm run images:fetch` | Fill missing artist photos from Wikipedia (`-- --force` re-fetches all) |
| `npm run socials:fetch` | Fill missing artist Instagram links from Wikidata (`-- --force` re-checks all) |
| `npm run shows:seed` | Load/refresh MTV Hustle S1–4 and Legacy S1 (idempotent) |
| `npm run shows:import` | Import full show casts from `prisma/data/show-contestants.json` (MTV Hustle S1–5, LEGACY S1). Add `-- --dry` to preview |
| `npm run shows:import:64bars` | Import Red Bull 64 Bars S1–S4 + Booth 2025 from `prisma/data/red-bull-64-bars.json`, creating each track as a song with producer credits |
| `npm run handles:backfill` | Give artists without a handle one (Instagram username, else stage_name) |

## Deploying

Step-by-step guide for dhhculture.in (Vercel + Railway + GoDaddy DNS): **[docs/DEPLOY.md](docs/DEPLOY.md)**.

- **Backend**: any Node host (Render, Railway, Fly.io, a VPS). Set the env vars, run `npm run build && npm run db:deploy && npm start`. Set `COOKIE_SECURE=true` and add your frontend origin to `CORS_ORIGINS`.
- **Frontend**: any static host (Vercel, Netlify, Cloudflare Pages). Set `VITE_API_URL=https://your-api/api/v1` and configure an SPA fallback to `index.html`.
- When frontend and backend are on different domains, the refresh cookie is sent with `SameSite=None; Secure`, which needs HTTPS on both sides.

## Roadmap

[docs/ROADMAP.md](docs/ROADMAP.md) has step-by-step plans for:

1. **Spotify import**: fill catalogs automatically (the `spotifyId` columns already exist)
2. **Google login**: `OAuthAccount` table and a nullable password are already in the schema
3. **Artist accounts**: shipped as the Artist Studio; next steps are a public "claim this profile" flow and image uploads

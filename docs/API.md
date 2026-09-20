# DHH API reference (v1)

Base URL: `http://localhost:4000/api/v1` (dev). All bodies are JSON. Errors look like:

```json
{ "error": { "message": "Validation failed", "details": { "email": ["Invalid email"] } } }
```

List endpoints return `{ items, meta: { page, limit, total, totalPages } }` and accept `page` / `limit` (max 100).

## Authentication

Send the access token on every request: `Authorization: Bearer <accessToken>` (15 min TTL by default).

| Client type | How the refresh token travels |
|---|---|
| Browser (default) | httpOnly cookie `dhh_refresh`, scoped to `/api/v1/auth`. Use `credentials: 'include'`. |
| Mobile / server / scripts | Send header `X-Auth-Mode: token` on login/register/refresh → `refreshToken` is returned in the JSON body. Pass it back as `{ "refreshToken": "..." }` to `/auth/refresh` and `/auth/logout`. |

Refresh tokens rotate on every use. Re-using an old token (after a 30s grace window) revokes every session for that user.

| Method | Path | Auth | Body / notes |
|---|---|---|---|
| POST | `/auth/register` | – | `{ email, username, password, displayName? }` → `{ user, accessToken }` |
| POST | `/auth/login` | – | `{ identifier (email or username), password }` → `{ user, accessToken }` |
| POST | `/auth/refresh` | cookie / body | → `{ user, accessToken }` |
| POST | `/auth/logout` | cookie / body | revokes the refresh token, 204 |
| GET | `/auth/me` | ✔ | → `{ user }` |
| POST | `/auth/password` | ✔ | `{ currentPassword, newPassword }` → `{ user }`; clears `mustChangePassword` after an admin reset |

## Catalog (public; personal flags such as `isFollowing` / `isLiked` are filled when a token is sent)

| Method | Path | Query / notes |
|---|---|---|
| GET | `/home` | Personalised sections when authenticated, editorial sections otherwise |
| GET | `/artists` | `q, genre, region, featured, sort=popular\|name\|new` |
| GET | `/artists/:slug` | artist + stats, albums, `topSongs`, `latestSongs`, `featuredOn`, `related` |
| GET | `/artists/:slug/songs` | full catalog: `sort=new\|old\|popular\|title, include=all\|own` |
| POST / DELETE | `/artists/:slug/follow` | ✔ follow / unfollow |
| GET | `/songs` | `q, genre, artist, region, year, sort=new\|old\|popular\|title` |
| GET | `/songs/:slug` | song + `moreFromArtist`, `similar` |
| POST / DELETE | `/songs/:slug/like` | ✔ like / unlike |
| GET | `/albums/:slug` | album + tracklist + `moreAlbums` |
| GET | `/genres`, `/regions` | taxonomy with counts |
| GET | `/search?q=` | `{ artists, songs, albums }` |

## Home feed format

```jsonc
{
  "personalized": true,
  "onboarded": true,
  "greetingName": "Demo Listener",
  // Cover-story carousel, in order (max 8). "hero" = heroes[0], kept for older clients.
  "heroes": [
    { "type": "artist", "artist": {…}, "song": {…}, "reason": "following" | "featured" | "editorial", "kicker": null, "blurb": null },
    { "type": "news", "reason": "editorial", "kicker": "Breaking", "headline": "…", "body": "…", "imageUrl": null, "linkUrl": "/shows/…", "linkLabel": null, "artists": [ /* ArtistRef */ ] }
  ],
  "heroInterval": 7,
  "hero": { … },
  "sections": [
    { "id": "following", "kind": "songs", "title": "New from artists you follow", "items": [ /* SongCard */ ] },
    { "id": "genre-boom-bap", "kind": "artists", "title": "Because you like Boom Bap", "seeAll": { "type": "artists", "params": { "genre": "boom-bap" } }, "items": [ … ] }
  ]
}
```

`kind` is one of `songs | artists | recent | playlists | genres`. Clients render by `kind`, so new sections can be added server-side without client changes.

Personal sections (in order): Jump back in (recently viewed) → New from artists you follow → Made for you (liked + favourite genres/artists) → Because you like *genre* → Straight outta *city* → Artists you might like → Your playlists → Trending → Fresh drops → Browse by sound.

## Me (✔ required)

| Method | Path | Body / notes |
|---|---|---|
| PATCH | `/me/profile` | `{ displayName?, bio?, avatarUrl? }` |
| PUT | `/me/preferences` | `{ genreSlugs[], regionSlugs[], followArtistSlugs?[] }` - replaces favourites, marks onboarded |
| GET | `/me/following` | followed artists |
| GET | `/me/likes` | liked songs |
| GET / DELETE | `/me/recent` | recently viewed artists & songs / clear |

## Playlists

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/playlists/mine` | ✔ | |
| POST | `/playlists` | ✔ | `{ name, description?, isPublic? }` |
| GET | `/playlists/:id` | optional | private playlists visible to owner only |
| PATCH / DELETE | `/playlists/:id` | ✔ owner | |
| POST | `/playlists/:id/songs` | ✔ owner | `{ songId }` (appended) |
| DELETE | `/playlists/:id/songs/:songId` | ✔ owner | |

## Shows

| Method | Path | Notes |
|---|---|---|
| GET | `/shows` | shows with `latestSeason` (+ its winners) |
| GET | `/shows/:slug` | show + seasons, each with `cast: [{ role, artist }]` (podium first) |

`GET /artists/:slug` also returns `appearances` (show/season/role) and `produced` (songs they made the beat for). `GET /artists?q=@handle` searches by handle; `producer=true` filters producers. Song cards include `producers`.

Admin: `GET/POST /admin/shows`, `GET/PATCH/DELETE /admin/shows/:id`, `POST /admin/shows/:id/seasons`, `PATCH/DELETE /admin/seasons/:id`, `PUT /admin/seasons/:id/cast` `{ cast: [{ artistId, role }] }` (replaces the cast). Songs accept `producerArtistIds[]`; artists accept `isProducer`.

## Site chrome & suggestions

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/site` | - | `{ announcement \| null, ticker \| null }` for the banner and ticker |
| POST | `/suggestions` | ✔ | `{ type: MISSING_ARTIST\|MISSING_SONG\|CORRECTION\|FEATURE\|OTHER, message, contextUrl? }`, max 10/hour per user |
| GET | `/suggestions/mine` | ✔ | your last 20 suggestions with `status` + `adminNote` |

`GET /artists?sort=trending` ranks by de-duplicated profile clicks over the last 7 days (then all-time clicks, then followers); items include `views: { week, allTime }`.

## Artist Studio (✔ account linked to an artist; everything is scoped to that artist)

Writes return `{ status: "APPLIED" | "PENDING", change }`: live now, or queued for review depending on the admin's auto-publish settings (per kind: profile, releases, posts).

| Method | Path | Notes |
|---|---|---|
| GET | `/studio` | `{ artist, pending, autoPublish }` |
| GET | `/studio/stats` | followers (total, last 7/30 days), profile views (week, all time, daily for 30 days), likes, per-song likes and playlist adds |
| PATCH | `/studio/profile` | name, handle, realName, bio, imageUrl, imageCredit, bannerUrl, activeSince, regionSlug, genreSlugs, instagram/youtube/spotify URLs. Admin-only fields are ignored |
| GET/POST | `/studio/albums` | own releases; POST body as the admin album form minus `artistId`/`slug` |
| GET/PATCH/DELETE | `/studio/albums/:id` | own albums only (404 otherwise) |
| GET/POST | `/studio/songs` | own songs; albums must be the artist's own, credited artists must exist |
| GET/PATCH/DELETE | `/studio/songs/:id` | own songs only |
| GET/POST | `/studio/posts` | `{ text ≤ 280, linkUrl? }` (site path or https) |
| DELETE | `/studio/posts/:id` | immediate, no review |
| GET | `/studio/changes` | activity log, `status?`, paginated |
| DELETE | `/studio/changes/:id` | withdraw a pending change |

## Admin (✔ role `ADMIN`, or `SUB_ADMIN` for granted sections)

Sub-admins pass only for routes their `permissions` open (`artists`, `albums`, `songs`, `taxonomy`, `shows`, `frontPage`, `suggestions`, `users`, `studio`; see `backend/src/lib/permissions.ts`); anything else is 403. `/admin/stats` is open to all staff.

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/stats` | `{ counts, newSuggestions, views: { week, allTime }, topArtists: { week[], allTime[] } }` |
| GET | `/admin/site-config` | `{ config, builtins, refs }`: the whole front-page config plus names for every referenced song/artist |
| PUT | `/admin/site-config/:key` | key ∈ `coverStory`, `sections`, `chart`, `ticker`, `announcement`, `issue`; body = that setting (validated). `chart` takes `{ title?, subtitle?, size, pinnedSongIds[], excludedSongIds[], artistIds[], sort: likes|new|random, maxPerArtist }` |
| GET | `/admin/users` | `q, role, status=active\|disabled, page, limit` |
| PATCH | `/admin/users/:id` | `{ role?: USER\|SUB_ADMIN\|ADMIN, permissions?: string[], disabled? }`: role/disable sign the user out everywhere; can't target yourself or the last admin. Role and permissions are full-admin only; sub-admins may only act on regular users |
| POST | `/admin/users/:id/reset-password` | → `{ temporaryPassword }` (shown once); signs the user out and sets `mustChangePassword`. Not for your own account |
| GET | `/admin/import/candidates` | `artistId` → iTunes artists with that name, for a human to pick |
| GET | `/admin/import/preview` | `artistId`, `itunesId` → their tracks, each marked `skip: already-here \| junk \| null` |
| POST | `/admin/import/run` | `{ artistId, itunesId, trackIds[] }`: creates the songs and any albums in one transaction, returns the batch |
| GET | `/admin/import/batches` | past runs, newest first |
| GET | `/admin/import/batches/:id/impact` | what an undo would delete right now (songs, albums, likes, playlist entries) |
| POST | `/admin/import/batches/:id/undo` | deletes exactly the rows that run created; a run can only be undone once |
| GET | `/admin/sheets` | column definitions per kind (songs, albums, artists) |
| GET | `/admin/sheets/template/:kind` | .xlsx template with headers, an example row and the notes sheet |
| POST | `/admin/sheets/preview` | `?kind&filename`, raw file body (.xlsx/.csv, ≤8 MB) → per-row plan: `create | update | unchanged | error` with before/after per field |
| POST | `/admin/sheets/apply` | same body; writes in one transaction, ≤400 changed rows, returns the batch |
| POST | `/admin/import/batches/:id/undo` | also undoes spreadsheet batches: deletes what they created and restores what they edited |
| GET/PUT | `/admin/studio/settings` | `{ autoPublish: { profile, releases, posts } }` |
| GET | `/admin/studio/links` | artists with their linked account |
| GET | `/admin/studio/users` | `q`: account search for linking |
| PUT | `/admin/studio/links/:artistId` | `{ userId }`: one account per artist and one artist per account; regular users become `ARTIST` |
| DELETE | `/admin/studio/links/:artistId` | unlink (`ARTIST` goes back to `USER`) |
| GET | `/admin/studio/changes` | `status=PENDING\|APPLIED\|REJECTED`; pending items include `current` values for comparison, plus `names` for referenced ids |
| POST | `/admin/studio/changes/:id/approve` | re-validates and publishes; 4xx if it no longer applies |
| POST | `/admin/studio/changes/:id/reject` | `{ note? }` shown to the artist |
| GET | `/admin/suggestions` | `status, type, q, page, limit` → items + `counts` per status |
| PATCH / DELETE | `/admin/suggestions/:id` | `{ status?, adminNote? }` |
| GET/POST/PATCH/DELETE | `/admin/artists[/:id]` | `{ name, slug?, realName?, bio?, imageUrl?, bannerUrl?, activeSince?, verified?, featured?, regionSlug?, genreSlugs?, instagramUrl?, youtubeUrl?, spotifyUrl?, spotifyId? }` |
| GET/POST/PATCH/DELETE | `/admin/albums[/:id]` | `{ title, artistId, type?, releaseDate?, coverUrl?, spotifyId?, slug? }`; list accepts `artistId, q` |
| GET/POST/PATCH/DELETE | `/admin/songs[/:id]` | `{ title, artistId, albumId?, trackNumber?, releaseDate?, durationSec?, coverUrl?, explicit?, genreSlugs?, featureArtistIds?, spotifyTrackId?, youtubeVideoId?, lyricsUrl?, slug? }` |
| POST/DELETE | `/admin/genres[/:id]`, `/admin/regions[/:id]` | |

Slugs are generated automatically when omitted. Empty strings in optional fields are stored as `null`.

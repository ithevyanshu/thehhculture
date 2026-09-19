# Roadmap & expansion plans

The v1 schema already contains the hooks for these, so none of them require reshaping existing data.

## 1. Spotify catalog import (data source option 2)

**Already in place:** `Artist.spotifyId`, `Album.spotifyId`, `Song.spotifyTrackId` (unique), admin fields that accept a pasted Spotify URL, and Spotify embeds on song pages.

**Plan:**
1. Create a Spotify developer app. Add `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` to `backend/.env` (Client Credentials flow, no user login needed).
2. Add `backend/src/modules/importers/spotify.ts`:
   - `getToken()`: client-credentials token, cached until expiry.
   - `importArtist(spotifyArtistId)`: upsert Artist (name, image) by `spotifyId`, then page through `/artists/{id}/albums?include_groups=album,single,appears_on`.
   - For each album: upsert Album by `spotifyId`, then its tracks. Upsert Song by `spotifyTrackId` with `durationSec`, `trackNumber`, `explicit`, cover. Link featured artists that already exist in DHH through `SongFeature`.
   - **Never overwrite manually curated fields** (bio, region, genres, featured/verified). Only fill blanks and refresh artwork/durations.
3. Expose `POST /admin/import/spotify/artist` `{ spotifyId }` and an "Import from Spotify" button on the admin artist form.
4. Optional: a nightly job (`npm run import:sync`) that re-syncs every artist with a `spotifyId` to catch new releases.
5. Respect Spotify's developer terms: show their attribution, use embeds for playback, and don't cache audio.

## 2. Google / social login (auth option 2)

**Already in place:** the `OAuthAccount` model (`provider`, `providerAccountId`), a nullable `User.passwordHash`, and a token layer (`issueTokens`) that is independent of how the user signed in.

**Plan:**
1. Create a Google Cloud OAuth client. Add `GOOGLE_CLIENT_ID` to the backend and `VITE_GOOGLE_CLIENT_ID` to the frontend.
2. Frontend: add the Google Identity Services button and send the returned ID token to the backend.
3. Backend: `POST /auth/google` `{ idToken }`. Verify it with `google-auth-library`, then:
   - If an `OAuthAccount(google, sub)` exists, sign in that user.
   - Else if a user with the same **verified** email exists, link the account.
   - Else create a new user (`passwordHash = null`, username derived from the email) and return `needsOnboarding`.
4. Reuse the same `sendSession()` flow, so cookie and token modes both keep working for web and mobile clients.
5. Settings: "Connected accounts". Allow setting a password for OAuth-only users, and block unlinking the last sign-in method.

## 3. Artist accounts (roles option 2)

**Already in place:** `Role.ARTIST` and `Artist.managedById → User` (the "ArtistManager" relation).

**Plan:**
1. Claim flow: `POST /artists/:slug/claim` creates an `ArtistClaim` (new model: userId, artistId, proof links, status). Admins approve it in the panel, which sets `artist.managedById` and gives the user the `ARTIST` role.
2. Middleware `requireArtistOwner(artistIdParam)` allows the request if the user is an admin **or** `artist.managedById === user.id`.
3. `/studio` routes that reuse the admin forms, scoped to the artist's own profile, albums and songs. Hide `featured` / `verified` (admin-only).
4. Artist dashboard: follower growth, likes per song, and playlist adds (add a daily snapshot table for trends).
5. Optional: release announcements that go to followers' home feeds as a "New drop" section.

## Other ideas

- Image uploads (S3 / Cloudinary) instead of pasting URLs
- Lyrics and annotations (Genius-style) per song
- Events / gigs per city with a "shows near you" home section
- Charts: weekly most-liked songs, rising artists
- Full-text search with `pg_trgm` or Meilisearch for typo tolerance
- Redis caching for `/home` and the rate limiter in multi-instance deployments
- Automated tests (Vitest + Supertest against a throwaway Postgres)
